import { posix, win32 } from "node:path";
import type { DelegationProvider } from "./types.ts";

/** T3 Code sets this to the path of the Pi extension that owns the `mcp__t3-code__` tools. */
export const T3_BRIDGE_ENV = "T3_PI_MCP_EXTENSION_PATH";

/** The pi-subagents tool a delegation skill calls. */
export const SUBAGENT_TOOL = "subagent";
/** The pi-subagents loader that exposes a registered but inactive `subagent` tool. */
export const SUBAGENT_LOADER = "subagents_enable";

/**
 * T3 Code's Pi bridge registers its MCP tools under this public prefix. It also registers a
 * `mcp__t3_code__` copy with hidden exposure to reserve the name, which the model cannot call.
 */
export const T3_TOOL_PREFIX = "mcp__t3-code__";
export const T3_DELEGATE_TOOL = `${T3_TOOL_PREFIX}delegate_task`;
export const T3_STATUS_TOOL = `${T3_TOOL_PREFIX}task_status`;
export const T3_CAPABILITIES_TOOL = `${T3_TOOL_PREFIX}orchestrator_capabilities`;

export interface DelegationBackend {
  readonly id: DelegationProvider;
  readonly label: string;
  /** The tool that starts a child. Its presence decides whether the backend exists. */
  readonly tool: string;
  /** Tools a delegating workflow also needs, activated alongside `tool` when registered. */
  readonly companions: readonly string[];
  /** Parameter names `tool` must accept for the backend to be usable. */
  readonly requiredParameters: readonly string[];
}

export const DELEGATION_BACKENDS: Readonly<Record<DelegationProvider, DelegationBackend>> = {
  "t3": {
    id: "t3",
    label: "T3 Code",
    tool: T3_DELEGATE_TOOL,
    companions: [T3_CAPABILITIES_TOOL, T3_STATUS_TOOL],
    requiredParameters: ["task", "target", "mode"],
  },
  "pi-subagents": {
    id: "pi-subagents",
    label: "pi-subagents",
    tool: SUBAGENT_TOOL,
    companions: [],
    requiredParameters: ["agent", "task", "async", "model"],
  },
};

export const DELEGATION_PROVIDERS: readonly DelegationProvider[] = ["t3", "pi-subagents"];
export const DEFAULT_DELEGATION: DelegationProvider = "t3";

export function isDelegationProvider(value: unknown): value is DelegationProvider {
  return typeof value === "string" && (DELEGATION_PROVIDERS as readonly string[]).includes(value);
}

/** The preferred backend first, then the fallback. */
export function delegationOrder(preferred: DelegationProvider): readonly DelegationBackend[] {
  return [preferred, ...DELEGATION_PROVIDERS.filter((id) => id !== preferred)].map((id) => DELEGATION_BACKENDS[id]);
}

export interface ToolPresence {
  readonly name: string;
  readonly exposure?: string;
  readonly parameters?: unknown;
  readonly sourceInfo?: { readonly source?: string; readonly path?: string };
}

/** A hidden registration only reserves a name, so it does not count as a callable tool. */
export function callableTool<T extends ToolPresence>(tools: readonly T[], name: string): T | undefined {
  return tools.find((tool) => tool.name === name && tool.exposure !== "hidden");
}

export interface DelegationHost {
  /** `T3_PI_MCP_EXTENSION_PATH`, set only when T3 Code launched this Pi process. */
  readonly t3BridgePath?: string;
  readonly platform?: NodeJS.Platform;
}

export function delegationHost(env: NodeJS.ProcessEnv = process.env): DelegationHost {
  return { t3BridgePath: env[T3_BRIDGE_ENV] || undefined, platform: process.platform };
}

export type DelegationResolution =
  | {
      readonly kind: "resolved";
      readonly backend: DelegationBackend;
      readonly tool: ToolPresence;
      /** Companion tools that pass the same ownership check as `tool`. */
      readonly companions: readonly string[];
    }
  | { readonly kind: "unavailable"; readonly problems: readonly string[] };

/**
 * The first usable backend in preference order. Detection and activation both use this, so the
 * status report always names the backend a workflow actually gets. A T3 tool counts only when
 * T3 Code's own bridge registered it, because any extension or MCP server can claim the name.
 */
export function resolveDelegation(
  tools: readonly ToolPresence[],
  preferred: DelegationProvider,
  host: DelegationHost,
): DelegationResolution {
  const problems: string[] = [];
  for (const backend of delegationOrder(preferred)) {
    const tool = callableTool(tools, backend.tool);
    if (!tool) continue;
    if (backend.id === "t3" && !fromT3Bridge(tool, host)) {
      problems.push(
        `The \`${backend.tool}\` tool was not registered by T3 Code's bridge, so the adapter ignores it. T3 Code sets ${T3_BRIDGE_ENV} to the bridge it launches.`,
      );
      continue;
    }
    const properties = parameterNames(tool.parameters);
    const missing = backend.requiredParameters.filter((name) => !properties.has(name));
    if (missing.length > 0) {
      problems.push(`The \`${backend.tool}\` tool is present but does not accept ${missing.join(", ")}.`);
      continue;
    }
    const companions = backend.companions.filter((name) => {
      const companion = callableTool(tools, name);
      return companion !== undefined && (backend.id !== "t3" || fromT3Bridge(companion, host));
    });
    return { kind: "resolved", backend, tool, companions };
  }
  return { kind: "unavailable", problems };
}

function fromT3Bridge(tool: ToolPresence, host: DelegationHost): boolean {
  const owner = tool.sourceInfo?.path;
  if (!host.t3BridgePath || !owner) return false;
  const platform = host.platform ?? process.platform;
  const paths = platform === "win32" ? win32 : posix;
  // Windows paths are case-insensitive, so compare them after resolving both sides.
  const key = (value: string) => (platform === "win32" ? paths.resolve(value).toLowerCase() : paths.resolve(value));
  return key(owner) === key(host.t3BridgePath);
}

export function parameterNames(parameters: unknown): Set<string> {
  if (typeof parameters !== "object" || parameters === null) return new Set();
  const properties = (parameters as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}
