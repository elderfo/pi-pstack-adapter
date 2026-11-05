import {
  type AdapterConfig,
  type ModelSpec,
  type ThinkingLevel,
  THINKING_LEVELS,
  isThinkingLevel,
  isValidModelSpec,
  isValidRole,
  joinModelSpec,
  splitModelSpec,
} from "./config.ts";
import { SUBAGENT_TOOL, T3_DELEGATE_TOOL } from "./delegation.ts";
import { safeEcho } from "./echo.ts";
import type { ModelFilter } from "./filter.ts";
import { resolveRole } from "./pools.ts";
import { MODEL_ROLES, PANEL_DEFAULT_ROLES, isPanelRole } from "./registry.ts";

/** A model string with this prefix names a pstack role, and the adapter picks the model. */
export const ROLE_REFERENCE_PREFIX = "pstack:";

/**
 * A delegation's model string. `pstack:<role>` picks by the role's ranking, `pstack:<role>@<model>`
 * overrides it, and either may end in `:<level>` to lower the thinking level. Any other string is a
 * concrete model, which only the model filter checks.
 */
export type ModelRequest =
  | { readonly kind: "concrete" }
  | { readonly kind: "role"; readonly text: string; readonly role: string; readonly override?: string; readonly thinking?: ThinkingLevel }
  | { readonly kind: "invalid"; readonly text: string; readonly problem: string };

export type RoleReference = Extract<ModelRequest, { kind: "role" }>;

export function parseModelRequest(value: unknown): ModelRequest {
  if (typeof value !== "string") return { kind: "concrete" };
  const text = value.trim();
  if (!text.startsWith(ROLE_REFERENCE_PREFIX)) return { kind: "concrete" };
  const { model: body, thinking } = splitModelSpec(text);
  const rest = body.slice(ROLE_REFERENCE_PREFIX.length);
  const at = rest.indexOf("@");
  const role = at < 0 ? rest : rest.slice(0, at);
  const override = at < 0 ? undefined : rest.slice(at + 1);
  const shape = "Write `pstack:<role>`, optionally followed by `@<provider/model>` and then `:<level>`, for example `pstack:feature` or `pstack:feature@provider/model:high`.";
  if (!isValidRole(role)) return { kind: "invalid", text, problem: `it names no valid role. ${shape}` };
  if (override !== undefined && (override === "" || !isValidModelSpec(override) || splitModelSpec(override).thinking !== undefined)) {
    return { kind: "invalid", text, problem: `its override after \`@\` is not one \`provider/model\` id. ${shape}` };
  }
  return { kind: "role", text, role, ...(override !== undefined ? { override } : {}), ...(thinking !== undefined ? { thinking } : {}) };
}

/**
 * What a pick strategy sees. `choices` holds only the models the filter allows, in ranked order,
 * and `task` is the text the child receives.
 */
export interface PickRequest {
  readonly role: string;
  readonly choices: readonly ModelSpec[];
  readonly task: string;
}

/**
 * The seam for choosing a pool model. It returns an index into `request.choices`; ranked takes the
 * first. It may return a promise, so a strategy that asks a service can replace it.
 */
export function pickModel(_request: PickRequest): number | Promise<number> {
  return 0;
}

/** The choice a pick returned, or undefined when the index is not one of the choices. */
export function validatePick(index: number, choices: readonly ModelSpec[]): ModelSpec | undefined {
  return Number.isInteger(index) && index >= 0 && index < choices.length ? choices[index] : undefined;
}

/**
 * The thinking level a child runs at. A requested level can only lower the configured one, and an
 * entry with no configured level keeps the backend default whatever was requested.
 */
export function effectiveThinking(requested: ThinkingLevel | undefined, configured: ThinkingLevel | undefined): ThinkingLevel | undefined {
  if (configured === undefined) return undefined;
  if (requested === undefined) return configured;
  return lowest(requested, configured);
}

function lowest(a: ThinkingLevel | undefined, b: ThinkingLevel | undefined): ThinkingLevel | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return THINKING_LEVELS.indexOf(a) <= THINKING_LEVELS.indexOf(b) ? a : b;
}

export interface RouteContext {
  /** Undefined when the adapter did not start, so no role can be resolved. */
  readonly config: AdapterConfig | undefined;
  readonly filter?: ModelFilter;
  /** `provider/id` of the session's model. */
  readonly parentModel?: string;
  /** The session's thinking level, which an inheriting `subagent` child keeps. */
  readonly parentThinking?: ThinkingLevel;
  /** Maps a model to its registry `provider/id`, or undefined when Pi does not know it. */
  readonly resolveModel: (model: string) => string | undefined;
}

export type RouteDecision =
  | { readonly kind: "unchanged" }
  | { readonly kind: "rewrite"; readonly input: Record<string, unknown> }
  | { readonly kind: "block"; readonly reason: string };

type ChildRoute =
  | { readonly kind: "model"; readonly spec: ModelSpec }
  | { readonly kind: "inherit" }
  | { readonly kind: "block"; readonly reason: string };

const UNCHANGED: RouteDecision = { kind: "unchanged" };

/**
 * Replaces each role reference in a `delegate_task` or `subagent` call with the model and thinking
 * the adapter picks. The result is a rewritten copy; concrete models and other tools are unchanged.
 */
export async function routeDelegation(toolName: string, input: unknown, context: RouteContext): Promise<RouteDecision> {
  if (!isRecord(input)) return UNCHANGED;
  if (toolName === T3_DELEGATE_TOOL) return routeT3(input, context);
  if (toolName === SUBAGENT_TOOL) return routeSubagent(input, context);
  return UNCHANGED;
}

/** Makes `target` hold exactly the keys of `source`, because Pi runs the tool on the object it passed. */
export function applyRewrite(target: Record<string, unknown>, source: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  Object.assign(target, source);
}

function blockReason(where: string, text: string, problem: string): string {
  return `Blocked by the pstack adapter: ${where} asks for ${text}, but ${problem} This call was not retried.`;
}

/** A parsed reference holds only role and model-id characters; anything else is echoed safely. */
function quoted(request: Exclude<ModelRequest, { kind: "concrete" }>): string {
  return request.kind === "role" ? `\`${request.text}\`` : safeEcho(request.text);
}

async function routeReference(reference: RoleReference, where: string, requested: ThinkingLevel | undefined, task: string, context: RouteContext): Promise<ChildRoute> {
  const { role } = reference;
  const block = (problem: string): ChildRoute => ({ kind: "block", reason: blockReason(where, quoted(reference), problem) });
  if (context.config === undefined) {
    return block(`the adapter did not start, so it cannot resolve role \`${role}\`. Run \`pstack_adapter\` with \`action: "status"\` to see why, fix the problem, and reload.`);
  }
  if (isPanelRole(role)) {
    return block(
      `\`${role}\` is a panel role, which holds one seat per entry rather than one model. Start one child per seat as the \`panel roles\` table shows: an unset panel's seats are ${PANEL_DEFAULT_ROLES.map((seat) => `\`pstack:${seat}\``).join(" and ")}, and a configured seat names its own model.`,
    );
  }
  if (!MODEL_ROLES.includes(role) && !Object.hasOwn(context.config.models, role)) {
    return block(`\`${role}\` is not a pstack role. Use a role from the \`model roles\` table of the \`pstack_adapter\` status report, or \`pstack:general\` when no other role fits.`);
  }
  const resolution = resolveRole(context.config, role, { filter: context.filter, parentModel: context.parentModel });
  switch (resolution.kind) {
    case "blocked":
      return block(`role \`${role}\` is blocked: ${resolution.reason}. Do not delegate this role's work, and do not move it to \`general\` or your own model. Tell the user which role is blocked and why.`);
    case "inherit":
      if (reference.override !== undefined) {
        return block(`role \`${role}\` has no pool to override, because it inherits the parent's model. Pass \`pstack:${role}\` without \`@\`.`);
      }
      return { kind: "inherit" };
    case "pool": {
      const choices = resolution.choices.filter((choice) => choice.eligible).map((choice) => choice.spec);
      let chosen: ModelSpec | undefined;
      if (reference.override !== undefined) {
        const allowed = `Its allowed entries are ${choices.map((choice) => `\`${choice.model}\``).join(", ")}. Override with one of them, or pass \`pstack:${role}\` for the ranked pick.`;
        const wanted = context.resolveModel(reference.override);
        if (wanted === undefined) return block(`this Pi installation does not know \`${reference.override}\`. ${allowed}`);
        chosen = choices.find((choice) => (context.resolveModel(choice.model) ?? choice.model) === wanted);
        if (chosen === undefined) return block(`\`${wanted}\` is not an entry of role \`${role}\`'s pool that the model filter allows. ${allowed}`);
      } else {
        const index = await pickModel({ role, choices, task });
        chosen = validatePick(index, choices);
        if (chosen === undefined) {
          return block(`the adapter's model pick for role \`${role}\` returned index ${index}, which is not one of its ${choices.length} allowed models. This is an adapter bug; report it to the user.`);
        }
      }
      const thinking = effectiveThinking(requested, chosen.thinking);
      return { kind: "model", spec: { model: chosen.model, ...(thinking !== undefined ? { thinking } : {}) } };
    }
  }
}

/** A T3 target names a Pi model, so a role reference only works with the `pi` provider. */
async function routeT3(args: Record<string, unknown>, context: RouteContext): Promise<RouteDecision> {
  const target = args.target;
  if (!isRecord(target)) return UNCHANGED;
  const request = parseModelRequest(target.model);
  if (request.kind === "concrete") return UNCHANGED;
  const where = "`delegate_task` `target.model`";
  if (request.kind === "invalid") return { kind: "block", reason: blockReason(where, quoted(request), request.problem) };
  const provider = [target.providerInstanceId, target.driverKind].find((value) => value !== undefined && value !== "pi");
  if (provider !== undefined) {
    return {
      kind: "block",
      reason: blockReason(where, quoted(request), `the target names T3 provider ${safeEcho(provider)}, and a role reference names a Pi model. Use \`providerInstanceId: "pi"\`, or omit it.`),
    };
  }
  const optionLevel = readThinkingOption(target.options);
  if (optionLevel === "invalid") {
    return {
      kind: "block",
      reason: blockReason(where, quoted(request), `\`target.options.thinking\` is not one of ${THINKING_LEVELS.map((level) => `\`${level}\``).join(", ")}. Lower the level with a \`:<level>\` suffix on the role reference instead.`),
    };
  }
  const task = typeof args.task === "string" ? args.task : "";
  const requested = lowest(request.thinking, optionLevel);
  const route = await routeReference(request, where, requested, task, context);
  if (route.kind === "block") return route;
  const next = structuredClone(args);
  const nextTarget = next.target as Record<string, unknown>;
  if (route.kind === "inherit") {
    // The provider selector goes too, because it would pick that instance's model instead of the
    // parent's. Other fields stay for the filter gate to check. Omitted options inherit the parent's.
    delete nextTarget.model;
    delete nextTarget.providerInstanceId;
    delete nextTarget.driverKind;
    const lowered = requested !== undefined && context.parentThinking !== undefined ? lowest(requested, context.parentThinking) : undefined;
    const options = writeThinkingOption(nextTarget.options, lowered);
    if (options === undefined) delete nextTarget.options;
    else nextTarget.options = options;
    if (Object.keys(nextTarget).length === 0) delete next.target;
    return { kind: "rewrite", input: next };
  }
  nextTarget.model = route.spec.model;
  if (nextTarget.providerInstanceId === undefined) nextTarget.providerInstanceId = "pi";
  // T3 merges given options over the inherited ones and reads empty options as clearing them, so a
  // backend-default entry sends them empty rather than let the parent's thinking through.
  nextTarget.options =
    route.spec.thinking === undefined ? (Array.isArray(nextTarget.options) ? [] : {}) : writeThinkingOption(nextTarget.options, route.spec.thinking);
  return { kind: "rewrite", input: next };
}

type OptionEntry = { readonly id?: unknown; readonly value?: unknown };

/** T3 options are an object keyed by option id, or a list of `{ id, value }`. */
function readThinkingOption(options: unknown): ThinkingLevel | undefined | "invalid" {
  const value = Array.isArray(options)
    ? (options as OptionEntry[]).find((entry) => isRecord(entry) && entry.id === "thinking")?.value
    : isRecord(options)
      ? options.thinking
      : undefined;
  if (value === undefined) return undefined;
  return typeof value === "string" && isThinkingLevel(value) ? value : "invalid";
}

function writeThinkingOption(options: unknown, thinking: ThinkingLevel | undefined): unknown {
  if (Array.isArray(options)) {
    const rest = (options as OptionEntry[]).filter((entry) => !(isRecord(entry) && entry.id === "thinking"));
    const next = thinking === undefined ? rest : [...rest, { id: "thinking", value: thinking }];
    return next.length > 0 ? next : undefined;
  }
  const next: Record<string, unknown> = isRecord(options) ? { ...options } : {};
  if (thinking === undefined) delete next.thinking;
  else next.thinking = thinking;
  return Object.keys(next).length > 0 ? next : undefined;
}

interface ModelSlot {
  readonly where: string;
  readonly holder: Record<string, unknown>;
  readonly task: string;
}

/** Every place a `subagent` call names a child's model: one agent, a task list, or a chain. */
function subagentSlots(args: Record<string, unknown>): ModelSlot[] {
  const topTask = typeof args.task === "string" ? args.task : "";
  const taskOf = (holder: Record<string, unknown>, fallback: string) => (typeof holder.task === "string" ? holder.task : fallback);
  const slots: ModelSlot[] = [];
  if (args.agent !== undefined) {
    if (args.model !== undefined && args.model !== null) slots.push({ where: "`subagent` `model`", holder: args, task: topTask });
    else if (isRecord(args.options) && args.options.model !== undefined) slots.push({ where: "`subagent` `options.model`", holder: args.options, task: topTask });
  }
  if (Array.isArray(args.tasks)) {
    args.tasks.forEach((task, index) => {
      if (isRecord(task)) slots.push({ where: `\`subagent\` tasks[${index}]`, holder: task, task: taskOf(task, topTask) });
    });
  }
  if (Array.isArray(args.chain)) {
    args.chain.forEach((step, index) => {
      if (!isRecord(step)) return;
      const stepTask = taskOf(step, topTask);
      slots.push({ where: `\`subagent\` chain[${index}]`, holder: step, task: stepTask });
      if (Array.isArray(step.parallel)) {
        step.parallel.forEach((task, inner) => {
          if (isRecord(task)) slots.push({ where: `\`subagent\` chain[${index}].parallel[${inner}]`, holder: task, task: taskOf(task, stepTask) });
        });
      }
    });
  }
  return slots;
}

/** pi-subagents takes `provider/model:level` in each child's `model`. Other actions launch nothing named here. */
async function routeSubagent(args: Record<string, unknown>, context: RouteContext): Promise<RouteDecision> {
  if (typeof args.action === "string" && args.action.trim() !== "") return UNCHANGED;
  const next = structuredClone(args);
  let changed = false;
  for (const slot of subagentSlots(next)) {
    const request = parseModelRequest(slot.holder.model);
    if (request.kind === "concrete") continue;
    if (request.kind === "invalid") return { kind: "block", reason: blockReason(slot.where, quoted(request), request.problem) };
    const route = await routeReference(request, slot.where, request.thinking, slot.task, context);
    if (route.kind === "block") return route;
    if (route.kind === "model") slot.holder.model = joinModelSpec(route.spec);
    else if (context.parentModel !== undefined) {
      const thinking = context.parentThinking === undefined ? undefined : lowest(request.thinking, context.parentThinking);
      slot.holder.model = joinModelSpec({ model: context.parentModel, ...(thinking !== undefined ? { thinking } : {}) });
    }
    else delete slot.holder.model;
    changed = true;
  }
  return changed ? { kind: "rewrite", input: next } : UNCHANGED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
