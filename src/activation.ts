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
import { samePath } from "./paths.ts";
import type { DelegationProvider, GeneratedSkill } from "./types.ts";

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

export function skillFromPrompt(text: string, skills: readonly GeneratedSkill[]): GeneratedSkill | undefined {
  if (!text.startsWith("/skill:")) return undefined;
  const rest = text.slice("/skill:".length);
  const end = rest.indexOf(" ");
  const name = end < 0 ? rest : rest.slice(0, end);
  return skills.find((skill) => skill.generatedName === name);
}

export function skillFromReadPath(
  path: string,
  cwd: string,
  skills: readonly GeneratedSkill[],
  platform: NodeJS.Platform = process.platform,
): GeneratedSkill | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const resolved = piResolveToCwd(path, cwd, platform);
  if (resolved === undefined) return undefined;
  return skills.find((skill) => samePath(paths.resolve(skill.path, "SKILL.md"), resolved, platform));
}

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
  readonly skills: () => readonly GeneratedSkill[];
  readonly modeActive: () => boolean;
  readonly preferred: () => DelegationProvider;
  readonly host?: DelegationHost;
}

type ActivationHost = Pick<ExtensionAPI, "on" | "getAllTools" | "getActiveTools" | "setActiveTools">;

export function registerDelegationActivation(pi: ActivationHost, sources: ActivationSources): void {
  const activate = () => activateDelegation(pi, sources.preferred(), sources.host ?? delegationHost());
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

  pi.on("before_agent_start", async () => {
    if (sources.modeActive()) activate();
  });
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function piResolveToCwd(path: string, cwd: string, platform: NodeJS.Platform): string | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const value = piNormalizePath(path.replace(UNICODE_SPACES, " ").replace(/^@/, ""), platform);
  const base = piNormalizePath(cwd, platform);
  if (value === undefined || base === undefined) return undefined;
  return paths.isAbsolute(value) ? paths.resolve(value) : paths.resolve(base, value);
}

function piNormalizePath(input: string, platform: NodeJS.Platform): string | undefined {
  const paths = platform === "win32" ? win32 : posix;
  const value = platform === "win32" ? piNormalizeWindowsShellPath(input) : input;
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

function piNormalizeWindowsShellPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return value;
  const match = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return value;
  return `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}
