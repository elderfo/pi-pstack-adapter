import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_DELEGATION,
  type DelegationHost,
  type ToolPresence,
  callableTool,
  delegationHost,
  resolveDelegation,
} from "./delegation.ts";
import type { DelegationProvider, GeneratedSkill } from "./types.ts";

/** The slice of Pi's tool registry that activation reads and writes. */
export interface ToolLoadout {
  getAllTools(): readonly ToolPresence[];
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

export type ActivationResult =
  | { readonly kind: "already-active"; readonly backend: DelegationProvider }
  | { readonly kind: "activated"; readonly backend: DelegationProvider }
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
  platform: NodeJS.Platform = process.platform,
): GeneratedSkill | undefined {
  const paths = platform === "win32" ? win32 : posix;
  // Windows file systems are case-insensitive, so `c:\x` and `C:\X` name the same SKILL.md.
  const key = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const resolved = resolveToolPath(path, cwd, platform);
  if (resolved === undefined) return undefined;
  const target = key(resolved);
  return skills.find((skill) => key(paths.resolve(skill.path, "SKILL.md")) === target);
}

/**
 * Adds the delegation backend that capability detection resolves to the active tools, with its
 * companion tools, so a delegation skill never depends on the model loading it first. For
 * pi-subagents that is the selection `subagents_enable` makes; T3's `delegate_task` may be
 * deferred behind `tool_search`. Pi applies the new loadout on the next model request.
 */
export function activateDelegation(
  loadout: ToolLoadout,
  preferred: DelegationProvider = DEFAULT_DELEGATION,
  host: DelegationHost = delegationHost(),
): ActivationResult {
  const registered = loadout.getAllTools();
  const resolution = resolveDelegation(registered, preferred, host);
  if (resolution.kind === "unavailable") return { kind: "unavailable" };
  const { backend, companions } = resolution;
  const wanted = [backend.tool, ...companions];
  const active = loadout.getActiveTools();
  const missing = wanted.filter((name) => !active.includes(name));
  if (missing.length === 0) return { kind: "already-active", backend: backend.id };
  loadout.setActiveTools([...active, ...missing]);
  return { kind: "activated", backend: backend.id };
}

export interface ActivationSources {
  /** Generated skills, or none while the adapter has no upstream checkout. */
  readonly skills: () => readonly GeneratedSkill[];
  readonly modeActive: () => boolean;
  /** The configured backend preference, read at activation time. */
  readonly preferred: () => DelegationProvider;
  /** Defaults to the running process's T3 Code bridge, if any. */
  readonly host?: DelegationHost;
}

type ActivationHost = Pick<ExtensionAPI, "on" | "getAllTools" | "getActiveTools" | "setActiveTools">;

/**
 * A delegation skill must not depend on the model remembering to load its delegation tool,
 * so a slash command, a model-initiated SKILL.md read, and Poteto Mode each activate it in code.
 */
export function registerDelegationActivation(pi: ActivationHost, sources: ActivationSources): void {
  const activate = () => activateDelegation(pi, sources.preferred(), sources.host ?? delegationHost());
  // `input` runs before Pi copies the tool list for the prompt, so the first model request
  // already carries the tool. It also covers messages queued while the agent is streaming.
  pi.on("input", async (event) => {
    const skill = skillFromPrompt(event.text, sources.skills());
    if (sources.modeActive() || (skill && needsDelegation(skill))) activate();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "read") return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return;
    const skill = skillFromReadPath(path, ctx.cwd, sources.skills());
    if (skill && needsDelegation(skill)) activate();
  });

  // Backstop for prompts that reach the agent without an `input` event.
  pi.on("before_agent_start", async () => {
    if (sources.modeActive()) activate();
  });
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Mirrors `resolveToCwd` in Pi 0.86 through 1.0 (`utils/paths.js`), which the `read` tool uses: Unicode
 * spaces, the `@` prefix, Git Bash drive paths on Windows, `~`, and `file://` URLs. Pi does not
 * export it, so a change there needs a matching change here. Other forms simply do not match.
 */
function resolveToolPath(path: string, cwd: string, platform: NodeJS.Platform): string | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const value = normalizeToolPath(path.replace(UNICODE_SPACES, " ").replace(/^@/, ""), platform);
  // Pi normalizes the base the same way, without the space and `@` handling.
  const base = normalizeToolPath(cwd, platform);
  if (value === undefined || base === undefined) return undefined;
  return paths.isAbsolute(value) ? paths.resolve(value) : paths.resolve(base, value);
}

/** Pi's `normalizePath`: Git Bash drive paths on Windows, `~`, and `file://` URLs. */
function normalizeToolPath(input: string, platform: NodeJS.Platform): string | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const value = platform === "win32" ? windowsShellPath(input) : input;
  if (value === "~") return homedir();
  if (value.startsWith("~/") || (platform === "win32" && value.startsWith("~\\"))) {
    return paths.join(homedir(), value.slice(2));
  }
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

/** Pi's `normalizeWindowsShellPath`: `/c/x`, `/mnt/c/x`, and `/cygdrive/c/x` become `C:\x`. */
function windowsShellPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return value;
  const match = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return value;
  return `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}
