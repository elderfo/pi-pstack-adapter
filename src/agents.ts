import type { Diagnostic, GeneratedAgent } from "./types.ts";

export const RUNTIME_AGENT_REGISTER_EVENT = "pi-subagents:runtime-agent-register:v1";

export interface RuntimeRegistration {
  dispose(): void;
}

interface RegisterRequest {
  version: 1;
  name: string;
  definition: { description: string; systemPrompt: string; tools?: readonly string[] };
  result?: { ok: true; registration: RuntimeRegistration } | { ok: false; error: Error };
}

export interface EventBus {
  emit(event: string, payload: unknown): void;
}

export interface AgentRegistrationResult {
  readonly registrations: readonly RuntimeRegistration[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Hands the converted upstream agents to whichever installed extension owns the
 * pi-subagents runtime registration contract. No owner means no delegation provider.
 */
export function registerAgents(
  bus: EventBus,
  agents: readonly GeneratedAgent[],
  namespace: string,
): AgentRegistrationResult {
  const registrations: RuntimeRegistration[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const agent of agents) {
    const request: RegisterRequest = {
      version: 1,
      name: agent.generatedName,
      definition: {
        description: `${agent.displayName}. ${agent.description}`,
        systemPrompt: agent.systemPrompt,
      },
    };
    bus.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
    if (!request.result) {
      diagnostics.push({
        level: "warning",
        resource: `agent:${agent.upstreamName}`,
        message: `No installed delegation provider accepted \`${agent.generatedName}\`, so pstack workflows cannot delegate to it.`,
        action: `Install a provider that owns ${RUNTIME_AGENT_REGISTER_EVENT}, for example \`pi install npm:pi-subagents\`.`,
      });
      continue;
    }
    if (!request.result.ok) {
      diagnostics.push({
        level: "error",
        resource: `agent:${agent.upstreamName}`,
        message: `Registering \`${agent.generatedName}\` failed: ${request.result.error.message}`,
        action: `Check for an agent name collision under the \`${namespace}\` namespace.`,
      });
      continue;
    }
    registrations.push(request.result.registration);
  }

  return { registrations, diagnostics };
}
