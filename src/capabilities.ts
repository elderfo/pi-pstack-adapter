import {
  DEFAULT_DELEGATION,
  type DelegationHost,
  callableTool,
  delegationHost,
  parameterNames,
  resolveDelegation,
} from "./delegation.ts";
import type { CapabilityId, CapabilityStatus, DelegationProvider } from "./types.ts";

export interface ToolDescriptor {
  readonly name: string;
  readonly exposure?: string;
  readonly parameters?: unknown;
  readonly sourceInfo?: { readonly source?: string; readonly path?: string };
}

interface CapabilityProbe {
  readonly id: CapabilityId;
  readonly toolName: string;
  /** Parameter names the tool must accept for the capability to be usable. */
  readonly requiredParameters: readonly string[];
  readonly recommendation: string;
}

const DELEGATION_RECOMMENDATION =
  "Run Pi inside T3 Code, whose `delegate_task` tool starts child agents, or install a delegation provider with named background agents and model selection, for example `pi install npm:pi-subagents`.";

const PROBES: readonly CapabilityProbe[] = [
  {
    id: "structured-question",
    toolName: "ask_user",
    requiredParameters: ["question", "options"],
    recommendation: "Install a structured question provider, for example `pi install npm:pi-ask-user`.",
  },
];

export function detectCapabilities(
  tools: readonly ToolDescriptor[],
  preferred: DelegationProvider = DEFAULT_DELEGATION,
  host: DelegationHost = delegationHost(),
): CapabilityStatus[] {
  return [detectDelegation(tools, preferred, host), ...PROBES.map((probe) => detectTool(tools, probe))];
}

/** The first usable backend in preference order satisfies `delegation`. */
function detectDelegation(
  tools: readonly ToolDescriptor[],
  preferred: DelegationProvider,
  host: DelegationHost,
): CapabilityStatus {
  const resolution = resolveDelegation(tools, preferred, host);
  if (resolution.kind === "unavailable") {
    return { id: "delegation", available: false, recommendation: [...resolution.problems, DELEGATION_RECOMMENDATION].join(" ") };
  }
  return {
    id: "delegation",
    available: true,
    provider: resolution.backend.id === "t3" ? resolution.backend.label : resolution.tool.sourceInfo?.source ?? resolution.backend.label,
    backend: resolution.backend.id,
    tools: [resolution.backend.tool, ...resolution.companions],
    recommendation: DELEGATION_RECOMMENDATION,
  };
}

function detectTool(tools: readonly ToolDescriptor[], probe: CapabilityProbe): CapabilityStatus {
  const tool = callableTool(tools, probe.toolName);
  if (!tool) {
    return { id: probe.id, available: false, recommendation: probe.recommendation };
  }
  const properties = parameterNames(tool.parameters);
  const missing = probe.requiredParameters.filter((name) => !properties.has(name));
  if (missing.length > 0) {
    return {
      id: probe.id,
      available: false,
      provider: tool.sourceInfo?.source,
      recommendation: `The \`${probe.toolName}\` tool is present but does not accept ${missing.join(", ")}. ${probe.recommendation}`,
    };
  }
  return { id: probe.id, available: true, provider: tool.sourceInfo?.source, recommendation: probe.recommendation };
}

export interface PrerequisiteReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export function checkPrerequisites(
  required: readonly CapabilityId[],
  statuses: readonly CapabilityStatus[],
  executables: readonly string[],
  hasExecutable: (name: string) => boolean,
  /** Session problems that stop every workflow, such as a missing Bash shell. */
  blockers: readonly string[] = [],
): PrerequisiteReport {
  const lines: string[] = [...blockers];
  for (const id of required) {
    const status = statuses.find((candidate) => candidate.id === id);
    if (!status || !status.available) {
      lines.push(`Missing capability \`${id}\`. ${status?.recommendation ?? ""}`.trim());
    }
  }
  for (const executable of executables) {
    if (!hasExecutable(executable)) {
      lines.push(`Missing executable \`${executable}\` on PATH. Install it before starting this workflow.`);
    }
  }
  return { ok: lines.length === 0, lines };
}
