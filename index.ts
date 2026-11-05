import { readFileSync } from "node:fs";
import { platform } from "node:os";
import { DEFAULT_NAMESPACE } from "./src/namespace.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDelegationActivation } from "./src/activation.ts";
import { registerAgents, unregisteredAgentDiagnostics, type RuntimeRegistration } from "./src/agents.ts";
import { DEFAULT_DELEGATION, SUBAGENT_TOOL, T3_DELEGATE_TOOL } from "./src/delegation.ts";
import {
  FILTER_ENTRY_TYPE,
  type ModelFilter,
  activeFilter,
  describeOrigin,
  filterOf,
  parseModelFilter,
  sessionFilterFromEntries,
} from "./src/filter.ts";
import { gateDelegation } from "./src/gate.ts";
import { applyRewrite, routeDelegation } from "./src/route.ts";
import { checkPrerequisites, detectCapabilities, type ToolDescriptor } from "./src/capabilities.ts";
import {
  type AdapterConfig,
  type ConfigFile,
  type ConfigLayer,
  THINKING_LEVELS,
  environmentLayer,
  invalidRoleMessage,
  isValidModelSpec,
  isValidRole,
  joinModelSpec,
  mergeConfig,
  planModelAssignment,
  planPanelAssignment,
  planPoolAssignment,
  readConfigFile,
  trustWarning,
  updateConfigFile,
} from "./src/config.ts";
import { generate } from "./src/generate.ts";
import { safeEcho } from "./src/echo.ts";
import { MODE_ENTRY_TYPE, modeFromEntries, modeInstruction } from "./src/mode.ts";
import { CONFIG_FILE_NAME, agentDir, cacheRoot } from "./src/paths.ts";
import { bashToolContext, probeExecutables } from "./src/executables.ts";
import { SKILL_PANELS, entryFor, isPanelRole } from "./src/registry.ts";
import {
  platformSupport,
  renderCheck,
  renderModelPolicy,
  renderPanels,
  renderStatus,
  shellDiagnostics,
  type ShellState,
} from "./src/status.ts";
import { BootstrapRequiredError, resolveRefToCommit, resolveSource } from "./src/upstream.ts";
import { normalizeRepo } from "./src/config.ts";
import type { CapabilityStatus, Diagnostic, GeneratedAgent, GenerationResult, ResolvedSource } from "./src/types.ts";

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const ADAPTER_VERSION = readAdapterVersion();

interface AdapterState {
  readonly config: AdapterConfig;
  readonly source: ResolvedSource;
  readonly generation: GenerationResult;
  readonly upstreamVersion: string;
  readonly cacheRoot: string;
  readonly bootstrapped: boolean;
}

export default function (pi: ExtensionAPI) {
  let state: AdapterState | undefined;
  let startupError: Error | undefined;
  let registrations: readonly RuntimeRegistration[] = [];
  let agentDiagnostics: readonly Diagnostic[] = [];
  let unregisteredAgents: readonly GeneratedAgent[] = [];
  let modeActive = false;
  /** This session's own model filter, restored from the active branch. It wins over a saved one. */
  let sessionFilter: ModelFilter | undefined;
  let savedFilter: AdapterConfig["modelFilter"];
  /** Why the config files could not be read, so the saved filter is unknown. */
  let configError: string | undefined;
  const commandNamespace = startupNamespace();

  pi.on("session_start", async (_event, ctx) => {
    disposeAgents();
    state = undefined;
    startupError = undefined;
    modeActive = modeFromEntries(ctx.sessionManager.getBranch() as never[]);
    sessionFilter = sessionFilterFromEntries(ctx.sessionManager.getBranch() as never[]);
    savedFilter = undefined;
    configError = undefined;

    let config: AdapterConfig;
    try {
      config = loadConfig(ctx);
    } catch (error) {
      startupError = error as Error;
      try {
        savedFilter = loadConfig(ctx, true).modelFilter;
      } catch (filterError) {
        configError = (filterError as Error).message;
      }
      if (ctx.hasUI) ctx.ui.notify(`pstack adapter: ${(error as Error).message}`, "error");
      return;
    }
    savedFilter = config.modelFilter;

    try {
      state = await bringUpUpstream(config, ctx);
    } catch (error) {
      startupError = error as Error;
      if (ctx.hasUI) ctx.ui.notify(`pstack adapter: ${(error as Error).message}`, "error");
      return;
    }

    const warning = trustWarning(state.source.trust, state.config);
    if (warning && ctx.hasUI) ctx.ui.notify(`pstack adapter: ${warning}`, "warning");
    if (platformSupport(platform()) === "experimental" && ctx.hasUI) {
      ctx.ui.notify(
        `pstack adapter: ${platform()} is experimental. Upstream pstack skills expect POSIX tools that may be missing.`,
        "warning",
      );
    }
    for (const diagnostic of shellDiagnostics(shellState(ctx, pi.getActiveTools()))) {
      if (ctx.hasUI && diagnostic.level === "error") ctx.ui.notify(`pstack adapter: ${diagnostic.message}`, "error");
    }

    const result = registerAgents(pi.events, state.generation.agents, state.config.namespace);
    registrations = result.registrations;
    unregisteredAgents = result.unregistered;
    const diagnostics: Diagnostic[] = [...result.diagnostics];
    if (result.registrations.length > 0) {
      diagnostics.push({
        level: "info",
        resource: "agents",
        message: `${result.registrations.length} pstack agents registered with the installed delegation provider.`,
      });
    }
    agentDiagnostics = diagnostics;

    for (const diagnostic of result.diagnostics) {
      if (ctx.hasUI && diagnostic.level === "error") ctx.ui.notify(`pstack adapter: ${diagnostic.message}`, "error");
    }
  });

  // `/tree` moves the active branch, and with it the session filter that branch recorded.
  pi.on("session_tree", async (_event, ctx) => {
    sessionFilter = sessionFilterFromEntries(ctx.sessionManager.getBranch() as never[]);
  });

  // A `pstack:<role>` model is rewritten to the model the adapter picks for that role. The model
  // filter then applies to every delegation in this session, pstack or not, because a call that
  // names a concrete model names no role. A blocked call fails; nothing retries it.
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== T3_DELEGATE_TOOL && event.toolName !== SUBAGENT_TOOL) return;
    const unreadable = configBlock();
    if (unreadable) return unreadable;
    const context = {
      filter: filterOf(activeFilter(sessionFilter, savedFilter)),
      parentModel: parentModelOf(ctx),
      resolveModel: (model: string) => resolveRegistryModel(ctx, model),
    };
    const route = await routeDelegation(event.toolName, event.input, { ...context, config: state?.config, parentThinking: ctx.thinkingLevel });
    if (route.kind === "block") return { block: true, reason: route.reason };
    if (route.kind === "rewrite") applyRewrite(event.input as Record<string, unknown>, route.input);
    // Read the config state and filter again: a pick that waits on a service could span a reload or a `set_filter`.
    const unreadableNow = configBlock();
    if (unreadableNow) return unreadableNow;
    const decision = gateDelegation(event.toolName, event.input, { ...context, filter: filterOf(activeFilter(sessionFilter, savedFilter)) });
    if (decision.kind === "block") return { block: true, reason: decision.reason };
  });

  function configBlock(): { block: true; reason: string } | undefined {
    if (sessionFilter !== undefined || configError === undefined) return undefined;
    return {
      block: true,
      reason: `Blocked by the pstack adapter: its config could not be read, so it cannot tell whether a saved model filter applies. ${configError} Fix the config and reload, or ask the user whether to set an explicit session filter with \`set_filter\`.`,
    };
  }

  pi.on("resources_discover", async () => {
    if (!state) return {};
    return { skillPaths: [state.generation.skillsDir] };
  });

  registerDelegationActivation(pi, {
    skills: () => state?.generation.skills ?? [],
    modeActive: () => modeActive && state !== undefined,
    preferred: () => state?.config.delegation ?? DEFAULT_DELEGATION,
  });

  pi.on("before_agent_start", async (event) => {
    if (!modeActive || !state) return;
    const skillPath = join(state.generation.skillsDir, `${state.config.namespace}-poteto-mode`, "SKILL.md");
    return { systemPrompt: `${event.systemPrompt}\n\n${modeInstruction(state.config.namespace, skillPath)}` };
  });

  pi.on("session_shutdown", async () => {
    disposeAgents();
  });

  pi.registerTool({
    name: "pstack_adapter",
    label: "pstack adapter",
    description:
      "Inspect and configure the pstack adapter. Use `status` for the full report, `check` before starting a pstack workflow, `models` to list real Pi model ids, `set_model` to assign a pstack role or a pool of models, `set_filter` to restrict which models delegation may use, and `set_source` to select another upstream revision.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("status"),
          Type.Literal("check"),
          Type.Literal("models"),
          Type.Literal("set_model"),
          Type.Literal("set_filter"),
          Type.Literal("set_source"),
        ],
        { description: "Operation to run" },
      ),
      skill: Type.Optional(Type.String({ description: "Skill name for `check`, with or without the namespace prefix" })),
      role: Type.Optional(Type.String({ description: "pstack model role for `set_model`" })),
      model: Type.Optional(
        Type.Union([Type.String(), Type.Array(Type.String())], {
          description:
            "`provider/model` id, or `inherit` to clear the role. A list of ids gives an ordinary role a pool, ranked in list order: a `pstack:<role>` delegation runs on the first one the model filter allows. For a panel role such as `arena-runners`, a string of entries separated by commas, one seat each.",
        }),
      ),
      thinking: Type.Optional(
        Type.String({
          description: `Thinking level for \`set_model\`: ${THINKING_LEVELS.join(", ")}. Omit to pass no level, which also clears a level set earlier.`,
        }),
      ),
      repo: Type.Optional(Type.String({ description: "Upstream repository URL for `set_source`" })),
      ref: Type.Optional(Type.String({ description: "Branch, tag, or commit for `set_source`" })),
      localPath: Type.Optional(Type.String({ description: "Local pstack checkout for `set_source`" })),
      include: Type.Optional(
        Type.Array(Type.String(), {
          description: "`set_filter`: patterns a delegation model must match, such as `gpt-*`. `*` is the only wildcard; a pattern with `/` matches `provider/model`.",
        }),
      ),
      exclude: Type.Optional(Type.Array(Type.String(), { description: "`set_filter`: patterns no delegation model may match, such as `claude-*`. Exclude wins." })),
      clear: Type.Optional(Type.Boolean({ description: "`set_filter`: remove the filter at `scope` instead of setting one." })),
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("user"), Type.Literal("project")], {
          description: "`set_filter` defaults to session, this session only. `set_model` and `set_source` write a config file: user (default) or project.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = await runAction(params, ctx);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  registerCommands(commandNamespace);

  function registerCommands(namespace: string): void {
    pi.registerCommand(`${namespace}-status`, {
      description: "Show the pstack adapter status report",
      handler: async (_args, ctx) => {
        pi.sendMessage({ customType: "pistack-status", content: await runAction({ action: "status" }, ctx), display: true });
      },
    });
    pi.registerCommand(`${namespace}-check`, {
      description: "Report whether this environment satisfies one pstack workflow's prerequisites",
      getArgumentCompletions: (prefix) => {
        const names = (state?.generation.skills ?? []).map((skill) => skill.generatedName);
        const matches = names.filter((name) => name.startsWith(prefix)).map((value) => ({ value, label: value }));
        return matches.length > 0 ? matches : null;
      },
      handler: async (args, ctx) => {
        pi.sendMessage({ customType: "pistack-check", content: checkSkill(args.trim(), ctx), display: true });
        if (args.trim() === "") ctx.ui.notify(`Usage: /${namespace}-check <skill>`, "info");
      },
    });
    pi.registerCommand(`${namespace}-mode`, {
      description: "Turn Poteto Mode on or off for this session, or show its state",
      getArgumentCompletions: (prefix) =>
        ["on", "off", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
      handler: async (args, ctx) => {
        const requested = args.trim().toLowerCase();
        if (requested === "on" || requested === "off") {
          modeActive = requested === "on";
          pi.appendEntry(MODE_ENTRY_TYPE, { active: modeActive });
        } else if (requested !== "" && requested !== "status") {
          ctx.ui.notify(`Usage: /${namespace}-mode on|off|status`, "error");
          return;
        }
        ctx.ui.notify(`Poteto Mode is ${modeActive ? "active for this session" : "off"}.`, "info");
      },
    });
  }

  async function runAction(
    params: {
      action: string;
      skill?: string;
      role?: string;
      model?: string | string[];
      thinking?: string;
      repo?: string;
      ref?: string;
      localPath?: string;
      include?: string[];
      exclude?: string[];
      clear?: boolean;
      scope?: "session" | "user" | "project";
    },
    ctx: ExtensionContext,
  ): Promise<string> {
    // A restriction must be settable even when the upstream checkout did not resolve.
    if (params.action === "set_filter") return setFilter(params, params.scope ?? "session", ctx);
    if (startupError) return `The pstack adapter did not start: ${startupError.message}`;
    if (!state) return "The pstack adapter has not resolved its upstream checkout yet.";

    switch (params.action) {
      case "status": {
        const current = capabilities();
        const delegation = current.find((capability) => capability.id === "delegation");
        return renderStatus({
          adapterVersion: ADAPTER_VERSION,
          config: state.config,
          source: state.source,
          upstreamVersion: state.upstreamVersion,
          generation: state.generation,
          capabilities: current,
          platform: platformSupport(platform()),
          platformName: platform(),
          modeActive,
          cacheRoot: state.cacheRoot,
          bootstrapped: state.bootstrapped,
          filter: activeFilter(sessionFilter, savedFilter),
          parentModel: parentModelOf(ctx),
          runtimeDiagnostics: [
            ...agentDiagnostics,
            // Judged now, because T3's tools can connect after the agents were registered.
            ...unregisteredAgentDiagnostics(unregisteredAgents, delegation?.backend, state.generation.agentPromptsDir),
            ...shellDiagnostics(probedShellState(ctx, pi.getActiveTools())),
          ],
        });
      }
      case "check":
        return checkSkill(params.skill ?? "", ctx);
      case "models":
        return renderModels(ctx);
      case "set_model": {
        if (params.scope === "session") return SESSION_SCOPE_ONLY_FILTER;
        return setModel(params.role, params.model, params.thinking, params.scope ?? "user", ctx);
      }
      case "set_source": {
        if (params.scope === "session") return SESSION_SCOPE_ONLY_FILTER;
        return setSource(params, params.scope ?? "user", ctx);
      }
      default:
        return `Unknown action ${params.action}.`;
    }
  }

  function capabilities(): CapabilityStatus[] {
    return detectCapabilities(pi.getAllTools() as unknown as ToolDescriptor[], state?.config.delegation);
  }

  function checkSkill(requested: string, ctx: ExtensionContext): string {
    if (!state) return "The pstack adapter has not resolved its upstream checkout yet.";
    const prefix = `${state.config.namespace}-`;
    const bare = requested.startsWith(prefix) ? requested.slice(prefix.length) : requested;
    const skill = state.generation.skills.find(
      (candidate) => candidate.generatedName === requested || candidate.generatedName === `${prefix}${bare}`,
    );
    if (!skill) {
      return `No pstack skill named ${safeEcho(requested)}. Run the adapter tool with action "status" for the full list.`;
    }
    const resolved = shellState(ctx, pi.getActiveTools());
    // An inactive bash tool or an unresolved shell is already a blocker, so do not spawn anything.
    const usable = resolved.bashToolActive && resolved.shellError === undefined;
    const executables = probeExecutables(skill.executables, usable ? () => sessionBashContext(ctx) : undefined);
    const shell: ShellState = { ...resolved, runError: executables.shellFailure };
    const shellProblems = shellDiagnostics(shell).map((diagnostic) => `${diagnostic.message} ${diagnostic.action ?? ""}`.trim());
    const current = capabilities();
    const panels = Object.hasOwn(SKILL_PANELS, skill.upstreamName) ? SKILL_PANELS[skill.upstreamName] : undefined;
    const origin = activeFilter(sessionFilter, savedFilter);
    const parentModel = parentModelOf(ctx);
    return renderCheck(
      skill,
      entryFor(skill.upstreamName, skill.generatedName.slice(prefix.length)),
      checkPrerequisites(skill.capabilities, current, skill.executables, executables.has, shellProblems),
      current.find((capability) => capability.id === "delegation"),
      panels ? renderPanels(state.config, panels, { filter: filterOf(origin), parentModel }) : undefined,
      renderModelPolicy(state.config, origin, parentModel),
    );
  }

  function renderModels(ctx: ExtensionContext): string {
    const scoped = ctx.scopedModels ?? [];
    const models = scoped.length > 0 ? scoped.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
    const ids = models.map((model) => `${model.provider}/${model.id}`).filter(isValidModelSpec).sort();
    if (ids.length === 0) return "No models are available in this Pi installation.";
    return `Available model ids.\n\n${ids.map((id) => `- \`${id}\``).join("\n")}`;
  }

  function setModel(
    role: string | undefined,
    model: string | string[] | undefined,
    thinking: string | undefined,
    scope: "user" | "project",
    ctx: ExtensionContext,
  ): string {
    if (!role) return "set_model needs a `role`.";
    if (!model || model.length === 0) return "set_model needs a `model`, or `inherit` to clear the role.";
    if (!isValidRole(role)) return invalidRoleMessage(role);
    const available = ctx.modelRegistry
      .getAvailable()
      .map((candidate) => ({ id: `${candidate.provider}/${candidate.id}`, reasoning: candidate.reasoning }));
    if (Array.isArray(model)) {
      if (isPanelRole(role)) {
        return `Panel \`${role}\` takes one string of entries separated by commas, one seat each, not a list. A list is a pool, which only ordinary roles have.`;
      }
      return setPool(role, model, thinking, available, scope, ctx);
    }
    if (isPanelRole(role)) return setPanel(role, model, thinking, available, scope, ctx);
    const plan = planModelAssignment(model, thinking, available);
    if (plan.kind === "rejected") return plan.message;
    const path = configPath(scope, ctx);
    const stored = readConfigFile(path)?.values.models;
    const models = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? { ...stored } : {};
    if (plan.kind === "inherit") delete models[role];
    else models[role] = joinModelSpec(plan.spec);
    updateConfigFile(path, { models });
    const note = refreshModels(scope, ctx);
    if (plan.kind === "inherit") return `Role \`${role}\` now inherits the parent session model and thinking. Written to ${path}.${note}`;
    return plan.spec.thinking === undefined
      ? `Role \`${role}\` now uses \`${plan.spec.model}\` at the model's default thinking. Written to ${path}.${note}`
      : `Role \`${role}\` now uses \`${plan.spec.model}\` with thinking \`${plan.spec.thinking}\`. Written to ${path}.${note}`;
  }

  /**
   * Status and `check` read roles from `state`, so a written role takes effect now. Only `models`
   * moves: the source and generation stay as they were until the next start. Returns a note for
   * the reply when the session view does not match what was written.
   */
  function refreshModels(scope: "user" | "project", ctx: ExtensionContext): string {
    const untrusted =
      scope === "project" && !ctx.isProjectTrusted()
        ? " This project is not trusted, so Pi ignores the file until you trust it, and the status report still shows the earlier value."
        : "";
    try {
      const fresh = loadConfig(ctx);
      savedFilter = fresh.modelFilter;
      configError = undefined;
      if (state) state = { ...state, config: { ...state.config, models: fresh.models, modelFilter: fresh.modelFilter } };
    } catch (error) {
      try {
        savedFilter = loadConfig(ctx, true).modelFilter;
        configError = undefined;
      } catch (filterError) {
        configError = (filterError as Error).message;
      }
      return `${untrusted} The write succeeded, but the model role view was not refreshed: ${(error as Error).message}`;
    }
    return untrusted;
  }

  function setPool(
    role: string,
    entries: readonly string[],
    thinking: string | undefined,
    available: readonly { id: string; reasoning?: boolean }[],
    scope: "user" | "project",
    ctx: ExtensionContext,
  ): string {
    const plan = planPoolAssignment(entries, thinking, available);
    if (plan.kind === "rejected") return plan.message;
    const path = configPath(scope, ctx);
    const stored = readConfigFile(path)?.values.models;
    const models = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? { ...stored } : {};
    models[role] = plan.value;
    updateConfigFile(path, { models });
    const note = refreshModels(scope, ctx);
    const listed = (typeof plan.value === "string" ? [plan.value] : plan.value).map((entry) => `\`${entry}\``).join(", ");
    return typeof plan.value === "string"
      ? `Role \`${role}\` now uses ${listed}. A pool of one is written as a plain model. Written to ${path}.${note}`
      : `Role \`${role}\` now has a pool of ${plan.value.length} models: ${listed}. A \`pstack:${role}\` delegation runs on the first one the model filter allows. Written to ${path}.${note}`;
  }

  function setFilter(
    params: { include?: string[]; exclude?: string[]; clear?: boolean },
    scope: "session" | "user" | "project",
    ctx: ExtensionContext,
  ): string {
    const setting = params.include !== undefined || params.exclude !== undefined;
    if (params.clear && setting) return "set_filter takes either `clear: true` or `include` and `exclude`, not both.";
    if (!params.clear && !setting) {
      return "set_filter needs `include`, `exclude`, or `clear: true`. Empty lists set an unrestricted filter at that scope.";
    }
    let filter: ModelFilter | undefined;
    if (setting) {
      const raw: Record<string, unknown> = {};
      if (params.include !== undefined) raw.include = params.include;
      if (params.exclude !== undefined) raw.exclude = params.exclude;
      const parsed = parseModelFilter(raw);
      if ("problem" in parsed) return parsed.problem;
      filter = parsed.filter;
    }
    if (scope === "session") {
      sessionFilter = filter;
      pi.appendEntry(FILTER_ENTRY_TYPE, filter ? { filter } : { cleared: true });
      const origin = activeFilter(sessionFilter, savedFilter);
      return `${filter ? "This session's model filter is set" : "This session's model filter is cleared"}. Filter in force: ${describeOrigin(origin)}. It applies to every \`delegate_task\` and \`subagent\` call in this session, and is not saved to a config file.`;
    }
    const path = configPath(scope, ctx);
    updateConfigFile(path, { modelFilter: filter });
    const note = refreshModels(scope, ctx);
    const origin = activeFilter(sessionFilter, savedFilter);
    const shadowed =
      sessionFilter !== undefined
        ? " This session's own filter still wins over the saved one. Clear it with `set_filter`, `clear: true`, and `scope: \"session\"` to use the saved filter here."
        : "";
    return `${filter ? "Saved model filter" : "Removed the saved model filter"} in ${path}.${note}${shadowed} Filter in force: ${describeOrigin(origin)}.`;
  }

  function setPanel(
    role: string,
    model: string,
    thinking: string | undefined,
    available: readonly { id: string; reasoning?: boolean }[],
    scope: "user" | "project",
    ctx: ExtensionContext,
  ): string {
    const plan = planPanelAssignment(model, thinking, available);
    if (plan.kind === "rejected") return plan.message;
    const path = configPath(scope, ctx);
    const stored = readConfigFile(path)?.values.models;
    const models = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? { ...stored } : {};
    if (plan.kind === "inherit") delete models[role];
    else models[role] = plan.value;
    updateConfigFile(path, { models });
    const note = refreshModels(scope, ctx);
    if (plan.kind === "inherit") return `Panel \`${role}\` is unset again, so it uses \`judgment\`, then \`general\`. Written to ${path}.${note}`;
    return `Panel \`${role}\` now runs one seat each on ${plan.value.split(" ").map((entry) => `\`${entry}\``).join(", ")}. Written to ${path}.${note}`;
  }

  async function setSource(
    params: { repo?: string; ref?: string; localPath?: string },
    scope: "user" | "project",
    ctx: ExtensionContext,
  ): Promise<string> {
    const path = configPath(scope, ctx);
    const scopeNote =
      scope === "project" && !ctx.isProjectTrusted()
        ? " This project is not trusted, so Pi will ignore the file until you trust it."
        : "";

    if (params.localPath) {
      const target = params.localPath;
      if (!(await approveSource(ctx, `Use the local pstack checkout ${target}? Every skill it contains becomes a Pi skill, unverified.`))) {
        return "Upstream source unchanged.";
      }
      updateConfigFile(path, { localPath: target, pinnedCommit: undefined });
      return `Upstream source is now the local checkout ${target}, written to ${path}.${scopeNote} Its contents are unverified. Restart Pi or run /reload to regenerate.`;
    }

    const repo = params.repo ?? state?.config.repo;
    if (!repo) return "set_source needs a `repo`, a `ref`, or a `localPath`.";
    if (!params.ref) return "set_source needs a `ref` when selecting a repository.";
    const changingRepo = normalizeRepo(repo) !== normalizeRepo(state?.config.repo ?? repo);
    const question = changingRepo
      ? `Fetch pstack from ${repo}@${params.ref}? This repository is outside the tested trust boundary, and its skills run with your full permissions.`
      : `Fetch pstack from ${repo}@${params.ref}? This revision is untested by this adapter release.`;
    if (!(await approveSource(ctx, question))) return "Upstream source unchanged.";

    const commit = await resolveRefToCommit(repo, params.ref);
    updateConfigFile(path, { repo, ref: params.ref, pinnedCommit: commit, localPath: undefined });
    return `Upstream source is now ${repo}@${params.ref}, recorded as commit ${commit} in ${path}.${scopeNote} Restart Pi or run /reload to regenerate.`;
  }

  /**
   * Changing the upstream source decides which third-party content becomes Pi skills and
   * where the adapter reaches on the network. The model may propose it; only a person may
   * approve it, because an untrusted upstream body can ask the model to propose anything.
   */
  async function approveSource(ctx: ExtensionContext, question: string): Promise<boolean> {
    if (!ctx.hasUI) return false;
    return ctx.ui.confirm("Change the pstack source?", question);
  }

  function disposeAgents(): void {
    for (const registration of registrations) {
      try {
        registration.dispose();
      } catch {
        // A provider that already tore down its registry is not an adapter problem.
      }
    }
    registrations = [];
    unregisteredAgents = [];
  }
}

/**
 * Command names are fixed at load time, before any project trust decision, so a project
 * cannot rename another project's commands. Everything else honors the project layer.
 */
function startupNamespace(): string {
  try {
    const layers: ConfigLayer[] = [];
    const global = readConfigFile(userConfigPath());
    if (global) layers.push(global);
    layers.push(environmentLayer(process.env));
    return mergeConfig(layers).namespace;
  } catch {
    // A broken config must not take the diagnostics commands down with it. session_start
    // reloads the same config inside a try/catch and reports the real error there.
    return DEFAULT_NAMESPACE;
  }
}

const SESSION_SCOPE_ONLY_FILTER =
  "Only `set_filter` takes `scope: \"session\"`. `set_model` and `set_source` write a config file, so pass `scope: \"user\"` or `scope: \"project\"`.";

function parentModelOf(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

/** A requested model as its registry `provider/id`. A bare id counts only when exactly one model has it. */
function resolveRegistryModel(ctx: ExtensionContext, model: string): string | undefined {
  const ids = ctx.modelRegistry.getAvailable().map((candidate) => ({ full: `${candidate.provider}/${candidate.id}`, id: candidate.id }));
  const exact = ids.find((candidate) => candidate.full === model);
  if (exact) return exact.full;
  if (model.includes("/")) return undefined;
  const bare = ids.filter((candidate) => candidate.id === model);
  return bare.length === 1 ? bare[0]?.full : undefined;
}

function loadConfig(ctx: ExtensionContext, filterOnly = false): AdapterConfig {
  const layers: ConfigLayer[] = [];
  const global = readConfigFile(userConfigPath());
  if (global) layers.push(global);
  if (ctx.isProjectTrusted()) {
    const project = readConfigFile(projectConfigPath(ctx.cwd));
    // Command names are bound before trust resolves, so a project cannot move the namespace
    // without desynchronizing `/<ns>-status` from the generated `<ns>-*` skills.
    if (project) layers.push({ ...project, values: { ...project.values, namespace: undefined } });
  }
  layers.push(environmentLayer(filterOnly ? { ...process.env, PISTACK_MODELS: undefined } : process.env));
  return mergeConfig(filterOnly ? layers.map((layer) => ({ ...layer, values: { modelFilter: layer.values.modelFilter } })) : layers);
}

function configPath(scope: "user" | "project", ctx: ExtensionContext): string {
  return scope === "project" ? projectConfigPath(ctx.cwd) : userConfigPath();
}

function userConfigPath(): string {
  return join(agentDir(), CONFIG_FILE_NAME);
}

function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", CONFIG_FILE_NAME);
}

async function bringUpUpstream(config: AdapterConfig, ctx: ExtensionContext): Promise<AdapterState> {
  const root = cacheRoot(config.cacheDir);
  let bootstrapped = false;
  let source: ResolvedSource;
  try {
    // Probe without permission first, so the report can tell a download apart from a reuse.
    source = await resolveSource({ config, mayBootstrap: false });
  } catch (error) {
    if (!(error instanceof BootstrapRequiredError)) throw error;
    if (config.allowBootstrap) {
      return buildState(config, await resolveSource({ config, mayBootstrap: true }), root, true);
    }
    if (!ctx.hasUI) throw error;
    const approved = await ctx.ui.confirm(
      "Download pstack?",
      `The pstack adapter needs ${config.repo} at ${config.pinnedCommit ?? config.ref}. Download it into ${root} now?`,
    );
    if (!approved) throw new Error("Bootstrap declined. No pstack skills are registered.");
    source = await resolveSource({ config, mayBootstrap: true });
    bootstrapped = true;
  }
  return buildState(config, source, root, bootstrapped);
}

function buildState(
  config: AdapterConfig,
  source: ResolvedSource,
  root: string,
  bootstrapped: boolean,
): AdapterState {
  const generation = generate({
    source,
    namespace: config.namespace,
    cacheRoot: root,
    adapterVersion: ADAPTER_VERSION,
    delegation: config.delegation,
    // A local checkout has uncommitted edits the digest cannot see, so never reuse its output.
    force: source.selection.kind === "local",
  });

  return {
    config,
    source,
    generation,
    upstreamVersion: upstreamVersion(source.pluginDir),
    cacheRoot: root,
    bootstrapped,
  };
}

function sessionBashContext(ctx: ExtensionContext) {
  return bashToolContext(ctx.cwd, agentDir(), ctx.isProjectTrusted());
}

function shellState(ctx: ExtensionContext, activeTools: readonly string[]): ShellState {
  let shellError: string | undefined;
  try {
    sessionBashContext(ctx);
  } catch (error) {
    shellError = (error as Error).message;
  }
  return { shellError, bashToolActive: activeTools.includes("bash") };
}

/** `shellState` plus one real command, for reports that can afford to start the shell. */
function probedShellState(ctx: ExtensionContext, activeTools: readonly string[]): ShellState {
  const resolved = shellState(ctx, activeTools);
  if (!resolved.bashToolActive || resolved.shellError !== undefined) return resolved;
  return { ...resolved, runError: probeExecutables([], () => sessionBashContext(ctx)).shellFailure };
}

function upstreamVersion(pluginDir: string): string {
  try {
    const raw = JSON.parse(readFileSync(join(pluginDir, ".cursor-plugin", "plugin.json"), "utf8")) as { version?: string };
    return raw.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readAdapterVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string };
    return raw.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
