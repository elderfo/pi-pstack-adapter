import type { CapabilityId, CapabilityStatus } from "./types.ts";

export interface ToolDescriptor {
  readonly name: string;
  readonly parameters?: unknown;
  readonly sourceInfo?: { readonly source?: string };
}

interface CapabilityProbe {
  readonly id: CapabilityId;
  readonly toolName: string;
  /** Parameter names the tool must accept for the capability to be usable. */
  readonly requiredParameters: readonly string[];
  readonly recommendation: string;
}

const PROBES: readonly CapabilityProbe[] = [
  {
    id: "delegation",
    toolName: "subagent",
    requiredParameters: ["agent", "task", "async", "model"],
    recommendation: "Install a delegation provider that exposes named background agents with model selection, for example `pi install npm:pi-subagents`.",
  },
  {
    id: "structured-question",
    toolName: "ask_user",
    requiredParameters: ["question", "options"],
    recommendation: "Install a structured question provider, for example `pi install npm:pi-ask-user`.",
  },
];

export function detectCapabilities(tools: readonly ToolDescriptor[]): CapabilityStatus[] {
  return PROBES.map((probe) => {
    const tool = tools.find((candidate) => candidate.name === probe.toolName);
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
  });
}

function parameterNames(parameters: unknown): Set<string> {
  if (typeof parameters !== "object" || parameters === null) return new Set();
  const properties = (parameters as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
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
