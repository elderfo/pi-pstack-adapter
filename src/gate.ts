import { splitModelSpec } from "./config.ts";
import { SUBAGENT_TOOL, T3_DELEGATE_TOOL } from "./delegation.ts";
import { safeEcho } from "./echo.ts";
import { type ModelFilter, describeFilter, isRestricting, modelAllowed } from "./filter.ts";

export type GateDecision = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };

export interface GateContext {
  /** The filter in force. Undefined or empty lets every call through. */
  readonly filter?: ModelFilter;
  /** `provider/id` of the session's model, which a child with no model runs on. */
  readonly parentModel?: string;
  /** Maps a requested model to its registry `provider/id`, or undefined when Pi does not know it. */
  readonly resolveModel: (model: string) => string | undefined;
}

const ALLOW: GateDecision = { kind: "allow" };

/**
 * pi-subagents actions that start or restart a child, or schedule one, outside the `model` the
 * call names. The gate cannot see which model they run on, so it blocks them under a filter.
 * Steering can also revive a child. Status, listing, and stopping do not launch children.
 */
const LAUNCHING_ACTIONS = new Set([
  "resume", "append-step", "debug.run", "refine", "project.open", "watchdog.configure", "steer",
  "schedule.create", "schedule.run", "schedule.run-due", "schedule.resume",
]);

/**
 * Checks one delegation tool call against the session's model filter. Only `delegate_task` and
 * `subagent` are checked, whoever starts the delegation. Every other tool passes.
 */
export function gateDelegation(toolName: string, input: unknown, context: GateContext): GateDecision {
  if (!isRestricting(context.filter)) return ALLOW;
  const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  if (toolName === T3_DELEGATE_TOOL) return gateT3(args, context);
  if (toolName === SUBAGENT_TOOL) return gateSubagent(args, context);
  return ALLOW;
}

function block(reason: string, filter: ModelFilter): GateDecision {
  return {
    kind: "block",
    reason: `Blocked by the pstack adapter's model filter (${describeFilter(filter)}). ${reason} Report this failed call to the user. Keep the active filter unchanged unless the user requests a change. This call was not retried.`,
  };
}

function checkModel(requested: unknown, where: string, context: GateContext & { filter: ModelFilter }): GateDecision {
  if (typeof requested !== "string" || requested.trim() === "") {
    return block(`${where} gives a model that is not a non-empty string.`, context.filter);
  }
  const resolved = context.resolveModel(splitModelSpec(requested.trim()).model);
  if (resolved === undefined) {
    return block(`${where} asks for ${safeEcho(requested.trim())}, which this Pi installation does not know, so the filter cannot allow it.`, context.filter);
  }
  if (!modelAllowed(context.filter, resolved)) return block(`${where} asks for \`${resolved}\`, which the filter excludes.`, context.filter);
  return ALLOW;
}

function checkParent(where: string, context: GateContext & { filter: ModelFilter }): GateDecision {
  if (context.parentModel === undefined) {
    return block(`${where} names no model, so it runs on the parent session's model, which Pi does not report. Name an allowed model.`, context.filter);
  }
  if (!modelAllowed(context.filter, context.parentModel)) {
    return block(`${where} names no model, so it runs on the parent session's model \`${context.parentModel}\`, which the filter excludes. Name an allowed model.`, context.filter);
  }
  return ALLOW;
}

/**
 * T3's `delegate_task` starts one child per call. No `target`, or a target without a model, runs on
 * the parent's model. A provider other than Pi names models outside Pi's registry, so the filter
 * cannot match them.
 */
function gateT3(args: Record<string, unknown>, context: GateContext): GateDecision {
  const filter = context.filter as ModelFilter;
  const scoped = { ...context, filter };
  const target = args.target;
  if (target === undefined || target === null) return checkParent("`delegate_task`", scoped);
  if (typeof target !== "object" || Array.isArray(target)) return block("`delegate_task` has a `target` that is not an object.", filter);
  const { model, providerInstanceId, driverKind, environmentId } = target as Record<string, unknown>;
  if (environmentId !== undefined) {
    return block("`delegate_task` targets a named environment, whose models this session cannot check. Omit `environmentId` to use the current environment.", filter);
  }
  const provider = [providerInstanceId, driverKind].find((value) => value !== undefined && value !== "pi");
  if (provider !== undefined) {
    return block(`\`delegate_task\` targets T3 provider ${safeEcho(provider)}, whose models are not Pi registry ids, so the filter cannot check them. Use \`providerInstanceId: "pi"\`.`, filter);
  }
  if (model === undefined) return checkParent("`delegate_task`", scoped);
  return checkModel(model, "`delegate_task`", scoped);
}

/**
 * pi-subagents starts one child from `agent`, several from `tasks` or `chain`, or any number from a
 * workflow script. An agent can carry its own default model, and an external runner or another
 * machine picks its own, so under a filter every child must name an allowed model.
 */
function gateSubagent(args: Record<string, unknown>, context: GateContext): GateDecision {
  const filter = context.filter as ModelFilter;
  const scoped = { ...context, filter };
  const options = typeof args.options === "object" && args.options !== null ? (args.options as Record<string, unknown>) : {};
  const action = args.action;
  if (typeof action === "string" && action.trim() !== "") {
    if (LAUNCHING_ACTIONS.has(action.trim())) {
      return block(`\`subagent\` action \`${action.trim()}\` can start a child on a model the adapter cannot see.`, filter);
    }
    return ALLOW;
  }
  if (args.workflow !== undefined || options.script !== undefined || args.workflowScript !== undefined) {
    return block("A `subagent` workflow picks its children's models inside the script, where the adapter cannot check them. Start each child with `agent` and an allowed `model` instead.", filter);
  }
  const machine = args.machine ?? options.machine;
  if (machine !== undefined && machine !== "local") {
    return block("A `subagent` child on another machine picks its own model, which the adapter cannot check.", filter);
  }
  const children: Array<{ readonly where: string; readonly model: unknown }> = [];
  if (args.agent !== undefined) children.push({ where: "`subagent`", model: args.model ?? options.model });
  if (Array.isArray(args.tasks)) {
    args.tasks.forEach((task, index) => children.push({ where: `\`subagent\` tasks[${index}]`, model: (task as { model?: unknown } | null)?.model }));
  }
  if (Array.isArray(args.chain)) {
    args.chain.forEach((step, index) => {
      const entry = (step ?? {}) as { model?: unknown; parallel?: unknown; agent?: unknown };
      if (Array.isArray(entry.parallel)) {
        entry.parallel.forEach((task, inner) =>
          children.push({ where: `\`subagent\` chain[${index}].parallel[${inner}]`, model: (task as { model?: unknown } | null)?.model }),
        );
      }
      if (entry.agent !== undefined || !Array.isArray(entry.parallel)) children.push({ where: `\`subagent\` chain[${index}]`, model: entry.model });
    });
  }
  for (const child of children) {
    if (child.model === undefined) {
      return block(`${child.where} names no model, so it would run on its agent's default model or the parent's, which the adapter cannot check. Pass an allowed \`model\`.`, filter);
    }
    const decision = checkModel(child.model, child.where, scoped);
    if (decision.kind === "block") return decision;
  }
  return ALLOW;
}
