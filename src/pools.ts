import { type AdapterConfig, type ModelSpec, panelEntries, poolEntries, splitModelSpec } from "./config.ts";
import { type ModelFilter, isRestricting, modelAllowed } from "./filter.ts";
import { GENERAL_ROLE, PANEL_DEFAULT_ROLES } from "./registry.ts";

export interface ResolutionContext {
  readonly filter?: ModelFilter;
  readonly parentModel?: string;
}

export interface PoolChoice {
  readonly spec: ModelSpec;
  readonly eligible: boolean;
}

export type RoleResolution =
  | { readonly kind: "inherit"; readonly from: string }
  | { readonly kind: "pool"; readonly from: string; readonly choices: readonly PoolChoice[] }
  | { readonly kind: "blocked"; readonly from: string; readonly reason: string; readonly choices: readonly PoolChoice[] };

export function parentProblem(context: ResolutionContext): string | undefined {
  if (!isRestricting(context.filter)) return undefined;
  if (context.parentModel === undefined) return "the parent session's model is unknown, so the model filter cannot allow it";
  if (!modelAllowed(context.filter, context.parentModel)) return `the parent session's model \`${context.parentModel}\` is excluded by the model filter`;
  return undefined;
}

export function resolveRole(config: AdapterConfig, role: string, context: ResolutionContext): RoleResolution {
  const own = Object.hasOwn(config.models, role) ? config.models[role] : undefined;
  const from = own !== undefined ? role : Object.hasOwn(config.models, GENERAL_ROLE) ? GENERAL_ROLE : undefined;
  if (from === undefined) {
    const problem = parentProblem(context);
    return problem ? { kind: "blocked", from: role, reason: `it inherits, and ${problem}`, choices: [] } : { kind: "inherit", from: role };
  }
  const value = config.models[from] ?? "";
  const choices = poolEntries(value).map((entry) => {
    const spec = splitModelSpec(entry);
    return { spec, eligible: modelAllowed(context.filter, spec.model) };
  });
  if (choices.some((choice) => choice.eligible)) return { kind: "pool", from, choices };
  return {
    kind: "blocked",
    from,
    reason: `every model ${from === role ? "it lists" : `\`${from}\` lists`} is excluded by the model filter`,
    choices,
  };
}

export type PanelSeat =
  | { readonly kind: "model"; readonly spec: ModelSpec; readonly from?: string }
  | { readonly kind: "parent"; readonly from?: string }
  | { readonly kind: "choice"; readonly choices: readonly ModelSpec[]; readonly from: string }
  | { readonly kind: "blocked"; readonly reason: string; readonly from?: string };

export interface ResolvedPanel {
  readonly role: string;
  readonly configured: boolean;
  readonly seats: readonly PanelSeat[];
}

export function resolvePanel(config: AdapterConfig, role: string, context: ResolutionContext = {}): ResolvedPanel {
  const configured = config.models[role];
  if (typeof configured === "string") {
    return {
      role,
      configured: true,
      seats: panelEntries(configured).map((entry): PanelSeat => {
        if (entry.kind === "inherit") {
          const problem = parentProblem(context);
          return problem ? { kind: "blocked", reason: `this \`inherit\` seat is blocked, because ${problem}` } : { kind: "parent" };
        }
        return modelAllowed(context.filter, entry.spec.model)
          ? { kind: "model", spec: entry.spec }
          : { kind: "blocked", reason: `\`${entry.spec.model}\` is excluded by the model filter` };
      }),
    };
  }
  return { role, configured: false, seats: defaultSeats(config, context) };
}

export function defaultSeats(config: AdapterConfig, context: ResolutionContext = {}): PanelSeat[] {
  return PANEL_DEFAULT_ROLES.map((name): PanelSeat => {
    const resolved = resolveRole(config, name, context);
    switch (resolved.kind) {
      case "inherit":
        return { kind: "parent", from: name };
      case "blocked":
        return { kind: "blocked", reason: resolved.reason, from: resolved.from };
      case "pool": {
        const eligible = resolved.choices.filter((choice) => choice.eligible).map((choice) => choice.spec);
        return eligible.length === 1 ? { kind: "model", spec: eligible[0] as ModelSpec, from: resolved.from } : { kind: "choice", choices: eligible, from: resolved.from };
      }
    }
  });
}
