import { safeEcho } from "./echo.ts";
import { splitModelSpec } from "./config.ts";

/**
 * Which models delegation may use. A pattern with a `/` matches the whole `provider/id`; a pattern
 * without one matches the model id after the last `/`. `*` is the only wildcard. An empty or
 * missing list does not restrict anything.
 */
export interface ModelFilter {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Where the filter in force came from, for the status report. */
export type FilterOrigin =
  | { readonly kind: "none" }
  | { readonly kind: "session"; readonly filter: ModelFilter; readonly shadows?: string }
  | { readonly kind: "saved"; readonly filter: ModelFilter; readonly source: string };

export const FILTER_ENTRY_TYPE = "pistack-model-filter";

const MAX_PATTERNS = 32;
const MAX_PATTERN_LENGTH = 128;
const PATTERN = /^[A-Za-z0-9._:/@~+*-]+$/;

export function filterPatternProblem(pattern: unknown): string | undefined {
  if (typeof pattern !== "string" || pattern === "") return `Filter pattern ${safeEcho(pattern)} is not a non-empty string.`;
  if (pattern.length > MAX_PATTERN_LENGTH || !PATTERN.test(pattern)) {
    return `Filter pattern ${pattern.length > MAX_PATTERN_LENGTH ? `(${pattern.length} characters)` : safeEcho(pattern)} is invalid. Use ASCII letters, digits, and \`. _ - : / @ ~ +\`, with \`*\` as the only wildcard, at most ${MAX_PATTERN_LENGTH} characters, for example \`gpt-*\` or \`openai/*\`.`;
  }
  return undefined;
}

/** Parses an untrusted filter value from a config file or a tool call. */
export function parseModelFilter(value: unknown): { readonly filter: ModelFilter } | { readonly problem: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { problem: "`modelFilter` must be an object with optional `include` and `exclude` lists of patterns." };
  }
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => key !== "include" && key !== "exclude");
  if (unknown.length > 0) return { problem: `\`modelFilter\` takes only \`include\` and \`exclude\`, not ${unknown.map((key) => safeEcho(key)).join(", ")}.` };
  const filter: { include?: string[]; exclude?: string[] } = {};
  for (const key of ["include", "exclude"] as const) {
    const list = (value as Record<string, unknown>)[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > MAX_PATTERNS) {
      return { problem: `\`modelFilter.${key}\` must be a list of at most ${MAX_PATTERNS} patterns.` };
    }
    for (const pattern of list) {
      const problem = filterPatternProblem(pattern);
      if (problem) return { problem: `\`modelFilter.${key}\`: ${problem}` };
    }
    filter[key] = [...(list as string[])];
  }
  return { filter };
}

export function isRestricting(filter: ModelFilter | undefined): filter is ModelFilter {
  return filter !== undefined && ((filter.include?.length ?? 0) > 0 || (filter.exclude?.length ?? 0) > 0);
}

function globMatches(pattern: string, value: string): boolean {
  const glob = pattern.toLowerCase();
  const text = value.toLowerCase();
  let p = 0;
  let v = 0;
  let star = -1;
  let retry = 0;
  while (v < text.length) {
    if (glob[p] === "*") {
      star = p++;
      retry = v;
    } else if (glob[p] === text[v]) {
      p++;
      v++;
    } else if (star !== -1) {
      p = star + 1;
      v = ++retry;
    } else {
      return false;
    }
  }
  while (glob[p] === "*") p++;
  return p === glob.length;
}

function patternMatches(pattern: string, model: string): boolean {
  if (pattern.includes("/")) return globMatches(pattern, model);
  return globMatches(pattern, model.slice(model.lastIndexOf("/") + 1));
}

/** `model` is `provider/id`, optionally with a thinking suffix, which is ignored. */
export function modelAllowed(filter: ModelFilter | undefined, model: string): boolean {
  if (!isRestricting(filter)) return true;
  const bare = splitModelSpec(model).model;
  const include = filter.include ?? [];
  if (include.length > 0 && !include.some((pattern) => patternMatches(pattern, bare))) return false;
  return !(filter.exclude ?? []).some((pattern) => patternMatches(pattern, bare));
}

export function describeFilter(filter: ModelFilter): string {
  const list = (patterns: readonly string[] | undefined) =>
    patterns && patterns.length > 0 ? patterns.map((pattern) => `\`${pattern}\``).join(", ") : "none";
  return `include ${list(filter.include)}; exclude ${list(filter.exclude)}`;
}

/** The session's filter from the last entry on the active branch: a filter, or a clear. */
export function sessionFilterFromEntries(entries: readonly unknown[]): ModelFilter | undefined {
  let current: ModelFilter | undefined;
  for (const candidate of entries) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== FILTER_ENTRY_TYPE) continue;
    const data = entry.data as { cleared?: unknown; filter?: unknown } | undefined;
    if (data?.cleared === true) {
      current = undefined;
      continue;
    }
    const parsed = parseModelFilter(data?.filter);
    if ("filter" in parsed) current = parsed.filter;
  }
  return current;
}

/** The filter in force. An explicit session filter wins over the saved one, even an empty one. */
export function activeFilter(session: ModelFilter | undefined, saved: { readonly filter: ModelFilter; readonly source: string } | undefined): FilterOrigin {
  if (session !== undefined) return { kind: "session", filter: session, shadows: saved?.source };
  if (saved !== undefined) return { kind: "saved", filter: saved.filter, source: saved.source };
  return { kind: "none" };
}

export function filterOf(origin: FilterOrigin): ModelFilter | undefined {
  return origin.kind === "none" ? undefined : origin.filter;
}

export function describeOrigin(origin: FilterOrigin): string {
  switch (origin.kind) {
    case "none":
      return "none, every model is allowed";
    case "session":
      return `${isRestricting(origin.filter) ? describeFilter(origin.filter) : "unrestricted"} (this session${origin.shadows ? `, overriding the saved filter in ${origin.shadows}` : ""})`;
    case "saved":
      return `${isRestricting(origin.filter) ? describeFilter(origin.filter) : "unrestricted"} (saved in ${origin.source})`;
  }
}

/** One line for each delegation brief, so a child knows the restriction its parent works under. */
export function briefLine(filter: ModelFilter): string {
  return `Model restriction for this task: use only models allowed by ${describeFilter(filter)}. A pattern with a \`/\` matches \`provider/model\`, one without matches the model id, and \`*\` matches anything. Give every agent you start an allowed model and this line, verbatim. If no allowed model fits, stop and report it.`;
}
