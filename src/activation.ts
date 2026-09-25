import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GeneratedSkill } from "./types.ts";

/** The pi-subagents tool a delegation skill calls. */
export const DELEGATION_TOOL = "subagent";
/** The pi-subagents loader that exposes a registered but inactive `subagent` tool. */
export const DELEGATION_LOADER = "subagents_enable";

/** The slice of Pi's tool registry that activation reads and writes. */
export interface ToolLoadout {
  getAllTools(): readonly { readonly name: string }[];
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

export type ActivationResult =
  | { readonly kind: "already-active" }
  | { readonly kind: "activated" }
  | { readonly kind: "unavailable" };

export function needsDelegation(skill: GeneratedSkill): boolean {
  return skill.capabilities.includes("delegation");
}

/**
 * Returns the generated skill a `/skill:<name>` prompt starts, if it is one of ours. The name
 * ends at the first space, as in Pi's own skill expansion.
 */
export function skillFromPrompt(text: string, skills: readonly GeneratedSkill[]): GeneratedSkill | undefined {
  if (!text.startsWith("/skill:")) return undefined;
  const rest = text.slice("/skill:".length);
  const end = rest.indexOf(" ");
  const name = end < 0 ? rest : rest.slice(0, end);
  return skills.find((skill) => skill.generatedName === name);
}

/** Returns the generated skill whose SKILL.md a `read` tool call opens, if it is one of ours. */
export function skillFromReadPath(
  path: string,
  cwd: string,
  skills: readonly GeneratedSkill[],
): GeneratedSkill | undefined {
  const target = resolveToolPath(path, cwd);
  return skills.find((skill) => join(skill.path, "SKILL.md") === target);
}

/**
 * Adds `subagent` to the active tools, the same selection `subagents_enable` makes, so a
 * delegation skill never depends on the model remembering to call the loader first.
 * Pi applies the new loadout on the next model request.
 */
export function activateDelegation(loadout: ToolLoadout): ActivationResult {
  if (!loadout.getAllTools().some((tool) => tool.name === DELEGATION_TOOL)) return { kind: "unavailable" };
  const active = loadout.getActiveTools();
  if (active.includes(DELEGATION_TOOL)) return { kind: "already-active" };
  loadout.setActiveTools([...active, DELEGATION_TOOL]);
  return { kind: "activated" };
}

export interface ActivationSources {
  /** Generated skills, or none while the adapter has no upstream checkout. */
  readonly skills: () => readonly GeneratedSkill[];
  readonly modeActive: () => boolean;
}

type ActivationHost = Pick<ExtensionAPI, "on" | "getAllTools" | "getActiveTools" | "setActiveTools">;

/**
 * A delegation skill must not depend on the model remembering to call `subagents_enable`,
 * so a slash command, a model-initiated SKILL.md read, and Poteto Mode each activate
 * `subagent` in code.
 */
export function registerDelegationActivation(pi: ActivationHost, sources: ActivationSources): void {
  // `input` runs before Pi copies the tool list for the prompt, so the first model request
  // already carries `subagent`. It also covers messages queued while the agent is streaming.
  pi.on("input", async (event) => {
    const skill = skillFromPrompt(event.text, sources.skills());
    if (sources.modeActive() || (skill && needsDelegation(skill))) activateDelegation(pi);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "read") return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return;
    const skill = skillFromReadPath(path, ctx.cwd, sources.skills());
    if (skill && needsDelegation(skill)) activateDelegation(pi);
  });

  // Backstop for prompts that reach the agent without an `input` event.
  pi.on("before_agent_start", async () => {
    if (sources.modeActive()) activateDelegation(pi);
  });
}

/** Mirrors the `@` and `~` handling of Pi's `resolveToCwd`. Other forms simply do not match. */
function resolveToolPath(path: string, cwd: string): string {
  const stripped = path.startsWith("@") ? path.slice(1) : path;
  if (stripped === "~") return homedir();
  if (stripped.startsWith("~/")) return join(homedir(), stripped.slice(2));
  return isAbsolute(stripped) ? resolve(stripped) : resolve(cwd, stripped);
}
