import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { DEFAULT_NAMESPACE } from "./src/namespace.ts";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDelegationActivation } from "./src/activation.ts";
import { registerAgents, type RuntimeRegistration } from "./src/agents.ts";
import { checkPrerequisites, detectCapabilities, type ToolDescriptor } from "./src/capabilities.ts";
import {
  type AdapterConfig,
  type ConfigFile,
  type ConfigLayer,
  environmentLayer,
  mergeConfig,
  readConfigFile,
  trustWarning,
  updateConfigFile,
} from "./src/config.ts";
import { generate } from "./src/generate.ts";
import { MODE_ENTRY_TYPE, modeFromEntries, modeInstruction } from "./src/mode.ts";
import { CONFIG_FILE_NAME, agentDir, cacheRoot } from "./src/paths.ts";
import { entryFor } from "./src/registry.ts";
import { platformSupport, renderCheck, renderStatus } from "./src/status.ts";
import { BootstrapRequiredError, resolveRefToCommit, resolveSource } from "./src/upstream.ts";
import { normalizeRepo } from "./src/config.ts";
import type { CapabilityStatus, Diagnostic, GenerationResult, ResolvedSource } from "./src/types.ts";

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
  let modeActive = false;
  const commandNamespace = startupNamespace();

  pi.on("session_start", async (_event, ctx) => {
    disposeAgents();
    state = undefined;
    startupError = undefined;
    modeActive = modeFromEntries(ctx.sessionManager.getBranch() as never[]);

    const config = loadConfig(ctx);
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

    const result = registerAgents(pi.events, state.generation.agents, state.config.namespace);
    registrations = result.registrations;
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

  pi.on("resources_discover", async () => {
    if (!state) return {};
    return { skillPaths: [state.generation.skillsDir] };
  });

  registerDelegationActivation(pi, {
    skills: () => state?.generation.skills ?? [],
    modeActive: () => modeActive && state !== undefined,
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
      "Inspect and configure the pstack adapter. Use `status` for the full report, `check` before starting a pstack workflow, `models` to list real Pi model ids, `set_model` to assign a pstack role, and `set_source` to select another upstream revision.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("status"),
          Type.Literal("check"),
          Type.Literal("models"),
          Type.Literal("set_model"),
          Type.Literal("set_source"),
        ],
        { description: "Operation to run" },
      ),
      skill: Type.Optional(Type.String({ description: "Skill name for `check`, with or without the namespace prefix" })),
      role: Type.Optional(Type.String({ description: "pstack model role for `set_model`" })),
      model: Type.Optional(Type.String({ description: "`provider/model` id, or `inherit` to clear the role" })),
      repo: Type.Optional(Type.String({ description: "Upstream repository URL for `set_source`" })),
      ref: Type.Optional(Type.String({ description: "Branch, tag, or commit for `set_source`" })),
      localPath: Type.Optional(Type.String({ description: "Local pstack checkout for `set_source`" })),
      scope: Type.Optional(
        Type.Union([Type.Literal("user"), Type.Literal("project")], {
          description: "Config file to write. Defaults to user.",
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
        pi.sendMessage({ customType: "pistack-check", content: checkSkill(args.trim()), display: true });
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
      model?: string;
      repo?: string;
      ref?: string;
      localPath?: string;
      scope?: "user" | "project";
    },
    ctx: ExtensionContext,
  ): Promise<string> {
    if (startupError) return `The pstack adapter did not start: ${startupError.message}`;
    if (!state) return "The pstack adapter has not resolved its upstream checkout yet.";

    switch (params.action) {
      case "status":
        return renderStatus({
          adapterVersion: ADAPTER_VERSION,
          config: state.config,
          source: state.source,
          upstreamVersion: state.upstreamVersion,
          generation: state.generation,
          capabilities: capabilities(),
          platform: platformSupport(platform()),
          platformName: platform(),
          modeActive,
          cacheRoot: state.cacheRoot,
          bootstrapped: state.bootstrapped,
          runtimeDiagnostics: agentDiagnostics,
        });
      case "check":
        return checkSkill(params.skill ?? "");
      case "models":
        return renderModels(ctx);
      case "set_model":
        return setModel(params.role, params.model, params.scope ?? "user", ctx);
      case "set_source":
        return setSource(params, params.scope ?? "user", ctx);
      default:
        return `Unknown action ${params.action}.`;
    }
  }

  function capabilities(): CapabilityStatus[] {
    return detectCapabilities(pi.getAllTools() as unknown as ToolDescriptor[]);
  }

  function checkSkill(requested: string): string {
    if (!state) return "The pstack adapter has not resolved its upstream checkout yet.";
    const prefix = `${state.config.namespace}-`;
    const bare = requested.startsWith(prefix) ? requested.slice(prefix.length) : requested;
    const skill = state.generation.skills.find(
      (candidate) => candidate.generatedName === requested || candidate.generatedName === `${prefix}${bare}`,
    );
    if (!skill) {
      return `No pstack skill named ${JSON.stringify(requested)}. Run the adapter tool with action "status" for the full list.`;
    }
    return renderCheck(
      skill,
      entryFor(skill.upstreamName, skill.generatedName.slice(prefix.length)),
      checkPrerequisites(skill.capabilities, capabilities(), skill.executables, onPath),
    );
  }

  function renderModels(ctx: ExtensionContext): string {
    const scoped = ctx.scopedModels ?? [];
    const models = scoped.length > 0 ? scoped.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
    const ids = models.map((model) => `${model.provider}/${model.id}`).sort();
    if (ids.length === 0) return "No models are available in this Pi installation.";
    return `Available model ids.\n\n${ids.map((id) => `- \`${id}\``).join("\n")}`;
  }

  function setModel(role: string | undefined, model: string | undefined, scope: "user" | "project", ctx: ExtensionContext): string {
    if (!role) return "set_model needs a `role`.";
    if (!model) return "set_model needs a `model`, or `inherit` to clear the role.";
    const clearing = model.trim().toLowerCase() === "inherit";
    if (!clearing && !ctx.modelRegistry.getAvailable().some((candidate) => `${candidate.provider}/${candidate.id}` === model)) {
      return `No model \`${model}\` is available in this Pi installation. Call this tool with action "models" for real ids, or pass "inherit".`;
    }
    const path = configPath(scope, ctx);
    const current = readConfigFile(path)?.values.models ?? {};
    const models = { ...current };
    if (clearing) delete models[role];
    else models[role] = model;
    updateConfigFile(path, { models });
    return clearing
      ? `Role \`${role}\` now inherits the parent session model. Written to ${path}.`
      : `Role \`${role}\` now uses \`${model}\`. Written to ${path}.`;
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

function loadConfig(ctx: ExtensionContext): AdapterConfig {
  const layers: ConfigLayer[] = [];
  const global = readConfigFile(userConfigPath());
  if (global) layers.push(global);
  if (ctx.isProjectTrusted()) {
    const project = readConfigFile(projectConfigPath(ctx.cwd));
    // Command names are bound before trust resolves, so a project cannot move the namespace
    // without desynchronizing `/<ns>-status` from the generated `<ns>-*` skills.
    if (project) layers.push({ ...project, values: { ...project.values, namespace: undefined } });
  }
  layers.push(environmentLayer(process.env));
  return mergeConfig(layers);
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

export function onPath(command: string): boolean {
  const paths = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");
  const extensions = platform() === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of paths) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (!existsSync(candidate)) continue;
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // Not executable by this user. Keep looking.
      }
    }
  }
  return false;
}
