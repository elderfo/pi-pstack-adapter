import { join } from "node:path";
import { T3_DELEGATE_TOOL } from "./delegation.ts";
import type { DelegationProvider, Diagnostic, GeneratedAgent } from "./types.ts";

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
  readonly unregistered: readonly GeneratedAgent[];
  readonly diagnostics: readonly Diagnostic[];
}

export function registerAgents(
  bus: EventBus,
  agents: readonly GeneratedAgent[],
  namespace: string,
): AgentRegistrationResult {
  const registrations: RuntimeRegistration[] = [];
  const unregistered: GeneratedAgent[] = [];
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
      unregistered.push(agent);
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

  return { registrations, unregistered, diagnostics };
}

export function unregisteredAgentDiagnostics(
  unregistered: readonly GeneratedAgent[],
  backend: DelegationProvider | undefined,
  promptsDir: string,
): Diagnostic[] {
  return unregistered.map((agent) => {
    const promptPath = join(promptsDir, `${agent.generatedName}.md`);
    if (backend === "t3") {
      return {
        level: "info",
        resource: `agent:${agent.upstreamName}`,
        message: `\`${agent.generatedName}\` is not a named agent here. T3 Code children run it by reading ${promptPath} as their system prompt.`,
      };
    }
    return {
      level: "warning",
      resource: `agent:${agent.upstreamName}`,
      message: `No installed delegation provider accepted \`${agent.generatedName}\` as a named agent, so pstack workflows cannot delegate to it through \`subagent\`.`,
      action: `Install a provider that owns ${RUNTIME_AGENT_REGISTER_EVENT}, for example \`pi install npm:pi-subagents\`, or run Pi inside T3 Code, whose \`${T3_DELEGATE_TOOL}\` loads the agent from ${promptPath}.`,
    };
  });
}
