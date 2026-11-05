import { CERTIFIED } from "./certified.ts";
import { CAPABILITY_LABELS, MODEL_ROLES, PANEL_DEFAULT_ROLES, PANEL_ROLES, TIER_ORDER } from "./registry.ts";
import type { AdapterConfig, ModelSpec } from "./config.ts";
import { trustWarning } from "./config.ts";
import { type FilterOrigin, briefLine, describeOrigin, filterOf, isRestricting } from "./filter.ts";
import { type PanelSeat, type ResolutionContext, type ResolvedPanel, type RoleResolution, defaultSeats, resolvePanel, resolveRole } from "./pools.ts";

export { resolvePanel } from "./pools.ts";
export type { PanelSeat, ResolvedPanel } from "./pools.ts";
import { DELEGATION_BACKENDS, delegationOrder } from "./delegation.ts";
import type { PrerequisiteReport } from "./capabilities.ts";
import type {
  CapabilityStatus,
  DelegationProvider,
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
  /** The model filter in force and where it came from. None when omitted. */
  readonly filter?: FilterOrigin;
  /** `provider/id` of the session's model, which an inheriting role runs on. */
  readonly parentModel?: string;
}

export function renderStatus(input: StatusInput): string {
  const { config, source } = input;
  const origin = input.filter ?? { kind: "none" };
  const context: ResolutionContext = { filter: filterOf(origin), parentModel: input.parentModel };
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
  lines.push(`| plugin directory | ${source.pluginDir} |`);
  lines.push(`| generated resources | ${input.generation.outDir} |`);
  lines.push(`| generated skills | ${input.generation.skillsDir} |`);
  lines.push(`| agent prompts | ${input.generation.agentPromptsDir} |`);
  lines.push(`| cache root | ${input.cacheRoot} |`);
  lines.push(`| cache state | ${input.bootstrapped ? "downloaded this session" : "reused, no network needed"} |`);
  lines.push(`| namespace | ${config.namespace} |`);
  lines.push(`| config layers | ${config.sources.length > 0 ? config.sources.join(", ") : "built-in defaults"} |`);
  lines.push(`| platform | ${input.platformName} (${input.platform}) |`);
  lines.push(`| Poteto Mode | ${input.modeActive ? "active" : "off"} |`);
  lines.push(`| delegation order | ${delegationOrder(config.delegation).map((backend) => backend.id).join(", then ")} |`);
  lines.push(`| delegation | ${describeDelegation(input.capabilities)} |`);
  lines.push(`| model filter | ${describeOrigin(origin)} |`);
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
  lines.push(`| role | model | thinking |`);
  lines.push(`| --- | --- | --- |`);
  for (const role of [...MODEL_ROLES, ...extraRoles(config)]) {
    const [model, thinking] = describeRole(resolveRole(config, role, context), role);
    lines.push(`| ${role} | ${model} | ${thinking} |`);
  }
  lines.push("");
  const policy = renderModelPolicy(config, origin, input.parentModel);
  if (policy) {
    lines.push(policy);
    lines.push("");
  }

  lines.push(`## Panel roles`);
  lines.push("");
  lines.push("A panel runs one seat per entry. An unset panel uses `judgment`, then `general`.");
  lines.push("");
  lines.push(`| panel | seats | source |`);
  lines.push(`| --- | --- | --- |`);
  const panels = PANEL_ROLES.map((panel) => resolvePanel(config, panel, context));
  for (const panel of panels) {
    lines.push(`| ${panel.role} | ${panel.seats.map(describeSeat).join("; ")} | ${panel.configured ? "configured" : `unset, so ${PANEL_DEFAULT_ROLES.join(", ")}`} |`);
  }
  lines.push("");
  for (const panel of panels) {
    const warning = panelWarning(panel, config, context);
    if (warning) {
      lines.push(`> Warning. ${warning}`);
      lines.push("");
    }
  }

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

function describeSpec(spec: ModelSpec): string {
  return `${spec.model} at ${spec.thinking ?? "backend default"}`;
}

function describeSeat(seat: PanelSeat): string {
  const origin = seat.from ? ` (${seat.from})` : "";
  switch (seat.kind) {
    case "parent":
      return `model of the agent that starts the panel${origin}`;
    case "model":
      return `${describeSpec(seat.spec)}${origin}`;
    case "choice":
      return `ranked ${seat.choices.map(describeSpec).join(", then ")}; as \`pstack:${seat.from}\` it runs once on the first, unless the delegating agent overrides the ranking${origin}`;
    case "blocked":
      return `BLOCKED, ${seat.reason}${origin}`;
  }
}

const PARENT_MODEL = "the model of the agent that starts the panel";

/** The model a seat runs on, when it is already determined. */
function seatModel(seat: PanelSeat): string | undefined {
  switch (seat.kind) {
    case "parent":
      return PARENT_MODEL;
    case "model":
      return seat.spec.model;
    case "choice":
      // A default seat runs as `pstack:<role>`, so the ranked pick puts it on the first choice.
      return seat.choices[0]?.model;
    case "blocked":
      return undefined;
  }
}

function seatModels(seats: readonly PanelSeat[]): Set<string> | undefined {
  const models = new Set<string>();
  for (const seat of seats) {
    const model = seatModel(seat);
    if (model !== undefined) models.add(model);
    else if (seat.kind === "choice") return undefined;
  }
  return models;
}

/**
 * Upstream's default panels span two model families. A panel whose seats all land on one model
 * lost that because of configuration, not because no other model exists, so say so where the
 * agent reads it. Families are left to the agent, which knows them better than a prefix list.
 */
export function panelWarning(panel: ResolvedPanel, config: AdapterConfig, context: ResolutionContext = {}): string | undefined {
  const usable = panel.seats.filter((seat) => seat.kind !== "blocked");
  const models = seatModels(usable);
  const pool = panel.role === "arena-cross-judge-pool";
  // Upstream lets a panel line hold one entry on purpose, so only the judge pool warns at one seat.
  if (models === undefined || models.size !== 1 || (usable.length < 2 && !pool)) return undefined;
  const [model] = [...models];
  const named = model === PARENT_MODEL ? PARENT_MODEL : `\`${model}\``;
  const cause = panel.configured
    ? `its configured entries all name ${named}`
    : `it is unset, and ${PANEL_DEFAULT_ROLES.map((role) => `\`${role}\``).join(" and ")} both resolve to ${named}`;
  return `Every seat of \`${panel.role}\` runs on ${named}, because ${cause}, ${pool ? poolEffect(panel, config, model, context) : "so the panel has one model and no second family"}. This comes from the adapter configuration, not from which models are available. Run \`/skill:${config.namespace}-setup\` to put this panel on two model families, as upstream's defaults do.`;
}

/**
 * Arena's judge is never from the session's family. When no pool entry qualifies, upstream tries
 * its default pool, which here is `judgment`, then `general`, before it skips the judge.
 */
function poolEffect(panel: ResolvedPanel, config: AdapterConfig, model: string | undefined, context: ResolutionContext): string {
  const fallback = defaultSeats(config, context);
  const fallbackModels = seatModels(fallback);
  const lead =
    model === PARENT_MODEL
      ? "and an `inherit` entry never judges, so arena"
      : `so a session on the family of \`${model}\` gets no judge from the pool, and arena`;
  const sameFallback = !panel.configured || (fallbackModels?.size === 1 && fallbackModels.has(model ?? PARENT_MODEL));
  return sameFallback
    ? `${lead} skips the judge`
    : `${lead} tries its default pool, ${fallback.map(describeSeat).join("; ")}, before it skips the judge`;
}

/** The panels a workflow reads, for its `check` report. */
export function renderPanels(config: AdapterConfig, roles: readonly string[], context: ResolutionContext = {}): string {
  const lines = roles.map((role) => {
    const panel = resolvePanel(config, role, context);
    const source = panel.configured ? "configured" : `unset, so ${PANEL_DEFAULT_ROLES.join(", ")}`;
    const warning = panelWarning(panel, config, context);
    return `- \`${role}\` (${source}): ${panel.seats.map(describeSeat).join("; ")}.${warning ? ` Warning. ${warning}` : ""}`;
  });
  return `Panels this workflow uses, one seat per entry:\n${lines.join("\n")}`;
}

/** One `model roles` row: the model column and the thinking column. */
function describeRole(resolution: RoleResolution, role: string): readonly [string, string] {
  const via = resolution.from === role ? "" : ` (from ${resolution.from})`;
  switch (resolution.kind) {
    case "inherit":
      return ["inherit (parent session model)", "inherit (parent session thinking)"];
    case "blocked": {
      const excluded = resolution.choices.map((choice) => choice.spec.model);
      return [`BLOCKED, ${resolution.reason}${excluded.length > 0 ? `: ${excluded.join(", ")}` : ""}. Do not delegate this role${via}`, "-"];
    }
    case "pool": {
      const [only] = resolution.choices;
      if (resolution.choices.length === 1 && only) return [`${only.spec.model}${via}`, `${only.spec.thinking ?? "backend default"}${via}`];
      const eligible = resolution.choices.filter((choice) => choice.eligible).map((choice) => describeSpec(choice.spec));
      const excluded = resolution.choices.filter((choice) => !choice.eligible).map((choice) => describeSpec(choice.spec));
      const tail = excluded.length > 0 ? `; excluded by the model filter: ${excluded.join(", ")}` : "";
      return [`pool, ranked ${eligible.join(", then ")}${tail}${via}`, `per choice${via}`];
    }
  }
}

/**
 * The delegation rules a workflow's `check` report adds when pools, a model filter, or blocked roles
 * are in play. Nothing when none of them is, so the report stays as it was.
 */
export function renderModelPolicy(config: AdapterConfig, origin: FilterOrigin, parentModel: string | undefined): string | undefined {
  const filter = filterOf(origin);
  const context: ResolutionContext = { filter, parentModel };
  const roles = [...MODEL_ROLES, ...extraRoles(config)];
  const resolutions = roles.map((role) => [role, resolveRole(config, role, context)] as const);
  const blocked = resolutions.filter(([, resolution]) => resolution.kind === "blocked");
  const pools = resolutions.filter(([, resolution]) => resolution.kind === "pool" && resolution.choices.length > 1);
  if (!isRestricting(filter) && pools.length === 0 && blocked.length === 0) return undefined;
  const lines: string[] = [];
  if (isRestricting(filter)) {
    lines.push(`Model filter: ${describeOrigin(origin)}. The adapter blocks a delegation whose model it excludes, or whose model it cannot tell.`);
    lines.push(`Put this line in each brief, verbatim: "${briefLine(filter)}"`);
  }
  if (pools.length > 0) {
    lines.push(
      `Pools: ${pools.map(([role, resolution]) => `\`${role}\` is ranked ${describeRole(resolution, role)[0].replace(/^pool, ranked /, "")}`).join("; ")}. Delegate a role as \`pstack:<role>\`, and the adapter runs it on the first eligible model in the role's ranking. As the delegating agent, you may override the ranking with \`pstack:<role>@<provider/model>\`, naming another eligible model from the pool when the task clearly fits it better; say which model you picked and why. A pool is not a retry list and not a panel: do not start the same task on several of its models, and when a delegation fails, report the failure instead of trying another model.`,
    );
  }
  if (blocked.length > 0) {
    lines.push(
      `Blocked roles: ${blocked.map(([role, resolution]) => `\`${role}\` (${resolution.kind === "blocked" ? resolution.reason : ""})`).join("; ")}. Do not delegate work for a blocked role, and do not move it to \`general\` or your own model. Tell the user which role is blocked and why.`,
    );
  }
  return lines.join("\n\n");
}

function extraRoles(config: AdapterConfig): string[] {
  return Object.keys(config.models)
    .filter((role) => !MODEL_ROLES.includes(role) && !PANEL_ROLES.includes(role))
    .sort();
}

function describeDelegation(capabilities: readonly CapabilityStatus[]): string {
  const backend = capabilities.find((capability) => capability.id === "delegation")?.backend;
  if (!backend) return "none available";
  const { label, tool } = DELEGATION_BACKENDS[backend];
  return `${backend} (${label}, \`${tool}\`)`;
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
  /** The resolved `delegation` capability, named for a workflow that delegates. */
  delegation?: CapabilityStatus,
  /** The workflow's panels, from `renderPanels`. */
  panels?: string,
  /** Pools, the model filter, and blocked roles, from `renderModelPolicy`. */
  policy?: string,
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
  if (skill.capabilities.includes("delegation")) {
    parts.push(
      delegation?.backend ? delegationInstruction(delegation.backend, delegation.tools) : "No delegation tool is usable in this session, so do not delegate.",
    );
  }
  if (panels && skill.tier !== "unsupported") parts.push(panels);
  if (policy && skill.capabilities.includes("delegation") && skill.tier !== "unsupported") parts.push(policy);
  if (skill.tier === "experimental" && report.ok) {
    parts.push("Tier `experimental` means parts of this workflow have no Pi equivalent. Expect gaps.");
  }
  return parts.join("\n\n");
}

function delegationInstruction(backend: DelegationProvider, tools: readonly string[] | undefined): string {
  const { tool, companions } = DELEGATION_BACKENDS[backend];
  const vetted = tools ?? [tool];
  const lines = [
    `Delegate only with \`${tool}\` (${backend}). The adapter resolved this backend for the session, so do not use any other delegation tool.`,
  ];
  if (companions.length > 0) {
    const usable = companions.filter((name) => vetted.includes(name));
    const unusable = companions.filter((name) => !vetted.includes(name));
    if (usable.length > 0) lines.push(`You may also call ${usable.map((name) => `\`${name}\``).join(", ")}.`);
    if (unusable.length > 0) {
      lines.push(
        `Do not call ${unusable.map((name) => `\`${name}\``).join(", ")}, even if it is in your tools: the adapter could not confirm it belongs to this backend. Wait for children to report back instead.`,
      );
    }
  }
  return lines.join(" ");
}

/** Platforms a release certifies. Windows means native Windows with Pi's Git Bash `bash` tool. */
export function platformSupport(platform: string): PlatformSupport {
  return platform === "linux" || platform === "darwin" || platform === "win32" ? "supported" : "experimental";
}

export interface ShellState {
  /** Why Pi could not resolve the shell its `bash` tool runs, or undefined when it can. */
  readonly shellError?: string;
  /** Why the resolved shell could not run a command, when a probe ran and failed. */
  readonly runError?: string;
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
  if (state.runError !== undefined) {
    diagnostics.push({ level: "error", resource: "shell", message: state.runError });
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
