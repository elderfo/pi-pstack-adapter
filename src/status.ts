import { CERTIFIED } from "./certified.ts";
import { CAPABILITY_LABELS, MODEL_ROLES, TIER_ORDER } from "./registry.ts";
import type { AdapterConfig } from "./config.ts";
import { trustWarning } from "./config.ts";
import type { PrerequisiteReport } from "./capabilities.ts";
import type {
  CapabilityStatus,
  Diagnostic,
  GeneratedSkill,
  GenerationResult,
  PlatformSupport,
  RegistryEntry,
  ResolvedSource,
  SupportTier,
} from "./types.ts";

export interface StatusInput {
  readonly adapterVersion: string;
  readonly config: AdapterConfig;
  readonly source: ResolvedSource;
  readonly upstreamVersion: string;
  readonly generation: GenerationResult;
  readonly capabilities: readonly CapabilityStatus[];
  readonly platform: PlatformSupport;
  readonly platformName: string;
  readonly modeActive: boolean;
  readonly cacheRoot: string;
  readonly bootstrapped: boolean;
  /** Runtime findings that generation could not know, such as agent registration results. */
  readonly runtimeDiagnostics?: readonly Diagnostic[];
}

export function renderStatus(input: StatusInput): string {
  const { config, source } = input;
  const lines: string[] = [];

  lines.push(`# ${config.namespace} adapter status`);
  lines.push("");
  lines.push(`| field | value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| adapter version | ${input.adapterVersion} |`);
  lines.push(`| upstream pstack version | ${input.upstreamVersion} |`);
  lines.push(`| certified pstack version | ${CERTIFIED.pstackVersion} |`);
  lines.push(`| configured source | ${describeSelection(input)} |`);
  lines.push(`| resolved commit | ${source.commit || "(not a git checkout)"} |`);
  lines.push(`| certified commit | ${CERTIFIED.commit} |`);
  lines.push(`| trust | ${source.trust} |`);
  lines.push(`| checkout | ${source.checkoutDir} |`);
  lines.push(`| generated resources | ${input.generation.outDir} |`);
  lines.push(`| cache root | ${input.cacheRoot} |`);
  lines.push(`| cache state | ${input.bootstrapped ? "downloaded this session" : "reused, no network needed"} |`);
  lines.push(`| namespace | ${config.namespace} |`);
  lines.push(`| config layers | ${config.sources.length > 0 ? config.sources.join(", ") : "built-in defaults"} |`);
  lines.push(`| platform | ${input.platformName} (${input.platform}) |`);
  lines.push(`| Poteto Mode | ${input.modeActive ? "active" : "off"} |`);
  lines.push("");

  const warning = trustWarning(source.trust, config);
  if (warning) {
    lines.push(`> Warning. ${warning}`);
    lines.push("");
  }
  if (input.platform === "experimental") {
    lines.push(
      `> Warning. ${input.platformName} is experimental for this release. Adapter-owned code is portable, but upstream pstack skills call POSIX shell tools that this platform may not provide. Only Linux, macOS, and Windows are certified.`,
    );
    lines.push("");
  }

  lines.push(`## Capabilities`);
  lines.push("");
  lines.push(`| capability | state | note |`);
  lines.push(`| --- | --- | --- |`);
  for (const capability of input.capabilities) {
    const note = capability.available
      ? CAPABILITY_LABELS[capability.id]
      : capability.recommendation;
    lines.push(`| ${capability.id} | ${capability.available ? "available" : "missing"} | ${note} |`);
  }
  lines.push("");

  lines.push(`## Model roles`);
  lines.push("");
  lines.push(`| role | model |`);
  lines.push(`| --- | --- |`);
  for (const role of MODEL_ROLES) {
    lines.push(`| ${role} | ${config.models[role] ?? "inherit (parent session model)"} |`);
  }
  const extra = Object.keys(config.models).filter((role) => !MODEL_ROLES.includes(role)).sort();
  for (const role of extra) {
    lines.push(`| ${role} | ${config.models[role]} |`);
  }
  lines.push("");

  lines.push(`## Support tiers`);
  lines.push("");
  const byTier = groupByTier(input.generation);
  lines.push(`| tier | count | skills |`);
  lines.push(`| --- | --- | --- |`);
  for (const tier of TIER_ORDER) {
    const names = byTier.get(tier) ?? [];
    if (names.length === 0) continue;
    lines.push(`| ${tier} | ${names.length} | ${names.join(", ")} |`);
  }
  lines.push("");
  lines.push(
    `${input.generation.skills.length} skills and ${input.generation.agents.length} agents are registered under \`${config.namespace}\`.`,
  );
  lines.push("");

  lines.push(`## Diagnostics`);
  lines.push("");
  const diagnostics = [...input.generation.diagnostics, ...(input.runtimeDiagnostics ?? [])];
  if (diagnostics.length === 0) {
    lines.push("No upstream resource problems found.");
  } else {
    lines.push(`| level | resource | message | action |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const diagnostic of sortDiagnostics(diagnostics)) {
      lines.push(`| ${diagnostic.level} | ${diagnostic.resource} | ${diagnostic.message} | ${diagnostic.action ?? "-"} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function describeSelection(input: StatusInput): string {
  const { config } = input;
  if (config.localPath) return `local checkout ${config.localPath}`;
  const pin = config.pinnedCommit ? ` pinned at ${config.pinnedCommit}` : ` at ref ${config.ref}`;
  return `${config.repo}${pin}`;
}

function groupByTier(generation: GenerationResult): Map<SupportTier, string[]> {
  const grouped = new Map<SupportTier, string[]>();
  for (const skill of generation.skills) {
    const names = grouped.get(skill.tier) ?? [];
    names.push(skill.generatedName);
    grouped.set(skill.tier, names);
  }
  return grouped;
}

const LEVEL_RANK = { error: 0, warning: 1, info: 2 } as const;

function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.resource.localeCompare(b.resource),
  );
}

export function renderCheck(
  skill: GeneratedSkill,
  entry: RegistryEntry,
  report: PrerequisiteReport,
): string {
  const parts = [`\`/skill:${skill.generatedName}\` is tier **${skill.tier}**.`];
  if (entry.note) parts.push(entry.note);
  if (skill.tier === "unsupported") {
    parts.push(
      "Pi cannot provide what this workflow needs, so it cannot reach its purpose here. Prerequisite checks do not change that.",
    );
  }
  if (!report.ok) {
    parts.push(`Do not start this workflow yet.\n${report.lines.map((line) => `- ${line}`).join("\n")}`);
  } else if (skill.tier !== "unsupported") {
    parts.push("Prerequisites satisfied. Start the workflow.");
  }
  if (skill.tier === "experimental" && report.ok) {
    parts.push("Tier `experimental` means parts of this workflow have no Pi equivalent. Expect gaps.");
  }
  return parts.join("\n\n");
}

/** Platforms a release certifies. Windows means native Windows with Pi's Git Bash `bash` tool. */
export function platformSupport(platform: string): PlatformSupport {
  return platform === "linux" || platform === "darwin" || platform === "win32" ? "supported" : "experimental";
}

export interface ShellState {
  /** Why Pi could not resolve the shell its `bash` tool runs, or undefined when it can. */
  readonly shellError?: string;
  /** Whether the `bash` tool is in the active tool set, for example not replaced by `powershell`. */
  readonly bashToolActive: boolean;
}

/**
 * Upstream skill bodies are written as Bash commands for Pi's `bash` tool, so a session without
 * that tool or its shell cannot run them. On Windows that shell is Git Bash.
 */
export function shellDiagnostics(state: ShellState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (state.shellError !== undefined) {
    diagnostics.push({
      level: "error",
      resource: "shell",
      message: `Pi cannot find the Bash shell its \`bash\` tool runs, and pstack skills run their commands there. ${state.shellError.split("\n")[0]}`,
      action: "Install Git for Windows, or set `shellPath` in Pi settings to a Bash executable, then run /reload.",
    });
  }
  if (!state.bashToolActive) {
    diagnostics.push({
      level: "warning",
      resource: "shell",
      message: "The `bash` tool is not active in this session. pstack skill bodies are written as Bash commands, and PowerShell does not run them.",
      action: "Add `\"bash\"` to the `defaultTools` list in Pi settings, or remove that setting, then restart Pi.",
    });
  }
  return diagnostics;
}
