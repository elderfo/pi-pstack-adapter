import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { CERTIFIED } from "./certified.ts";
import { safeEcho } from "./echo.ts";
import { DEFAULT_NAMESPACE, validateNamespace } from "./namespace.ts";
import { expandHome } from "./paths.ts";
import { DEFAULT_DELEGATION, DELEGATION_PROVIDERS, isDelegationProvider } from "./delegation.ts";
import type { DelegationProvider, SourceSelection, Trust } from "./types.ts";

export interface AdapterConfig {
  readonly namespace: string;
  readonly repo: string;
  readonly ref: string;
  readonly pluginPath: string;
  /** Absolute path to a local pstack checkout, replacing the git source. */
  readonly localPath?: string;
  /** Commit recorded by a previous explicit setup. Startup never advances it. */
  readonly pinnedCommit?: string;
  readonly allowBootstrap: boolean;
  readonly cacheDir?: string;
  readonly models: Readonly<Record<string, string>>;
  /** The delegation backend tried first. The other one is the fallback. */
  readonly delegation: DelegationProvider;
  readonly sources: readonly string[];
}

export interface ConfigFile {
  namespace?: string;
  repo?: string;
  ref?: string;
  pluginPath?: string;
  localPath?: string;
  pinnedCommit?: string;
  allowBootstrap?: boolean;
  cacheDir?: string;
  models?: Record<string, string>;
  delegation?: string;
}

export interface ConfigLayer {
  readonly label: string;
  readonly path?: string;
  readonly values: ConfigFile;
}

const NEGATIVE = new Set(["0", "false", "no", "off", ""]);

const ENV = {
  namespace: "PISTACK_NAMESPACE",
  repo: "PISTACK_UPSTREAM_REPO",
  ref: "PISTACK_UPSTREAM_REF",
  localPath: "PISTACK_UPSTREAM_PATH",
  pluginPath: "PISTACK_UPSTREAM_PLUGIN_PATH",
  allowBootstrap: "PISTACK_ALLOW_BOOTSTRAP",
  cacheDir: "PISTACK_CACHE_DIR",
  models: "PISTACK_MODELS",
  delegation: "PISTACK_DELEGATION",
} as const;

export function readConfigFile(path: string): ConfigLayer | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message quotes raw file text, which can reach the agent. Say only where to look.
    throw new Error(`${path} is not valid JSON. Fix the syntax in that file and restart Pi.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return { label: path, path, values: parsed as ConfigFile };
}

/** Shallow patch. A `models` value replaces the stored map, so callers control removals. */
export function updateConfigFile(path: string, patch: ConfigFile): ConfigFile {
  const current = readConfigFile(path)?.values ?? {};
  const next: ConfigFile = { ...current, ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete (next as Record<string, unknown>)[key];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Thinking levels Pi accepts as a `:level` suffix on a model id. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export interface ModelSpec {
  readonly model: string;
  readonly thinking?: ThinkingLevel;
}

/**
 * Splits `provider/model[:thinking]`. Only a known level is a suffix, so a model id that
 * itself contains a colon, such as `ollama/qwen:7b`, stays whole. Pi parses ids the same way.
 */
export function splitModelSpec(spec: string): ModelSpec {
  const separator = spec.lastIndexOf(":");
  if (separator > 0) {
    const suffix = spec.slice(separator + 1).toLowerCase();
    if (isThinkingLevel(suffix)) return { model: spec.slice(0, separator), thinking: suffix };
  }
  return { model: spec };
}

export function joinModelSpec(spec: ModelSpec): string {
  return spec.thinking === undefined ? spec.model : `${spec.model}:${spec.thinking}`;
}

export interface AvailableModel {
  readonly id: string;
  readonly reasoning?: boolean;
}

export type ModelAssignment =
  | { readonly kind: "inherit" }
  | { readonly kind: "assign"; readonly spec: ModelSpec }
  | { readonly kind: "rejected"; readonly message: string };

/** Validates a `set_model` request. `available` holds `provider/id` entries from the registry. */
export function planModelAssignment(
  model: string,
  thinking: string | undefined,
  available: readonly AvailableModel[],
): ModelAssignment {
  if (model.trim().toLowerCase() === "inherit") {
    if (thinking?.trim()) {
      return {
        kind: "rejected",
        message:
          "A role that inherits the parent session has no thinking level of its own. Pass a `provider/model` with `thinking`, or drop `thinking`.",
      };
    }
    return { kind: "inherit" };
  }
  const whole = model.trim();
  // A registry id that itself ends in a level word, such as `x/model:low`, wins over a split.
  const exact = available.some((candidate) => candidate.id === whole);
  const spec = exact ? { model: whole } : splitModelSpec(whole);
  const requested = thinking?.trim().toLowerCase() || undefined;
  if (requested !== undefined && !isThinkingLevel(requested)) {
    return {
      kind: "rejected",
      message: `Unknown thinking level \`${safeEcho(thinking).replaceAll('"', "")}\`. Use one of ${THINKING_LEVELS.map((level) => `\`${level}\``).join(", ")}.`,
    };
  }
  if (requested !== undefined && spec.thinking !== undefined && spec.thinking !== requested) {
    return {
      kind: "rejected",
      message: `\`model\` names thinking \`${spec.thinking}\` but \`thinking\` says \`${requested}\`. Pass one of them.`,
    };
  }
  const level = requested !== undefined && isThinkingLevel(requested) ? requested : spec.thinking;
  if (!isValidModelSpec(spec.model)) return { kind: "rejected", message: invalidModelMessage(spec.model) };
  if (exact && requested === undefined && splitModelSpec(whole).thinking !== undefined) {
    // Stored whole, `x/model:low` would read back as model `x/model` at thinking `low`.
    return {
      kind: "rejected",
      message: `Model \`${whole}\` ends in a thinking-level word, so a plain assignment would be misread. Pass \`thinking\` explicitly, for example \`high\`.`,
    };
  }
  const known = available.find((candidate) => candidate.id === spec.model);
  if (!known) {
    return {
      kind: "rejected",
      message: `No model \`${spec.model}\` is available in this Pi installation. Call this tool with action "models" for real ids, or pass "inherit".`,
    };
  }
  if (level !== undefined && level !== "off" && known.reasoning === false) {
    return {
      kind: "rejected",
      message: `Model \`${spec.model}\` does not support thinking. Drop \`thinking\`, or pick a reasoning model.`,
    };
  }
  const assigned: ModelSpec = { model: spec.model, thinking: level };
  if (!isValidModelSpec(joinModelSpec(assigned))) return { kind: "rejected", message: invalidModelMessage(joinModelSpec(assigned)) };
  return { kind: "assign", spec: assigned };
}

/** Role names reach generated markdown and status tables, so they stay plain kebab-case. */
const ROLE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/**
 * A model spec is also rendered into markdown the agent reads, so it is printable ASCII with the
 * markup characters removed. An allow-list of ASCII keeps invisible text (tag characters, zero-width
 * and bidi controls) out; catalogue ids such as OpenRouter's `~anthropic/...` aliases are ASCII.
 * A trailing colon is never a valid id or level.
 */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MARKUP_CHARACTERS = /[`|<>[\]()\\*]/;

const MAX_MODEL_SPEC_LENGTH = 128;

export function isValidModelSpec(model: string): boolean {
  const plain = (value: string) => PRINTABLE_ASCII.test(value) && !MARKUP_CHARACTERS.test(value) && !value.endsWith(":");
  if (model.length > MAX_MODEL_SPEC_LENGTH || !plain(model)) return false;
  // `x/model::high` splits to `x/model:`, which is no model id.
  return plain(splitModelSpec(model).model);
}

export function isValidRole(role: string): boolean {
  return ROLE_PATTERN.test(role);
}

export function invalidRoleMessage(role: string): string {
  return `Invalid role name ${safeEcho(role)}. Use lowercase letters, digits, and hyphens, starting with a letter, for example "bug-fix".`;
}

function invalidModelMessage(model: unknown): string {
  return `Invalid model value ${typeof model === "string" ? `(${model.length} characters)` : safeEcho(model)}. Use provider/model or provider/model:thinking with no spaces or markup characters, at most 128 characters.`;
}

/** `role=provider/model[:thinking],role2=provider/model2` */
export function parseModelRoles(value: string): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid model role assignment ${safeEcho(trimmed)}. Use role=provider/model or role=provider/model:thinking.`);
    }
    const role = trimmed.slice(0, separator).trim();
    const model = trimmed.slice(separator + 1).trim();
    if (!isValidRole(role)) throw new Error(invalidRoleMessage(role));
    // An empty value is an unset variable that expanded to nothing, not a model.
    if (model === "") continue;
    if (!isValidModelSpec(model)) throw new Error(invalidModelMessage(model));
    roles[role] = model;
  }
  return roles;
}

export function environmentLayer(env: NodeJS.ProcessEnv): ConfigLayer {
  const values: ConfigFile = {};
  if (env[ENV.namespace]) values.namespace = env[ENV.namespace];
  if (env[ENV.repo]) values.repo = env[ENV.repo];
  if (env[ENV.ref]) values.ref = env[ENV.ref];
  if (env[ENV.localPath]) values.localPath = env[ENV.localPath];
  if (env[ENV.pluginPath]) values.pluginPath = env[ENV.pluginPath];
  if (env[ENV.cacheDir]) values.cacheDir = env[ENV.cacheDir];
  if (env[ENV.allowBootstrap]) values.allowBootstrap = !NEGATIVE.has((env[ENV.allowBootstrap] as string).trim().toLowerCase());
  if (env[ENV.models]) {
    try {
      values.models = parseModelRoles(env[ENV.models] as string);
    } catch (error) {
      throw new Error(`${ENV.models}: ${(error as Error).message}`);
    }
  }
  if (env[ENV.delegation]) values.delegation = (env[ENV.delegation] as string).trim().toLowerCase();
  return { label: "environment", values };
}

export function mergeConfig(layers: readonly ConfigLayer[]): AdapterConfig {
  const merged: ConfigFile = {};
  const sources: string[] = [];
  for (const layer of layers) {
    let contributed = false;
    for (const [key, value] of Object.entries(layer.values)) {
      if (value === undefined) continue;
      // `JSON.parse` yields `__proto__` as an own key, and a plain assignment would invoke the
      // prototype setter, letting a config file reach fields the caller deliberately removed.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      // Source selection follows layer precedence: a later layer naming a git source retires an
      // earlier local checkout, and vice versa.
      if (key === "repo" || key === "ref") merged.localPath = undefined;
      if (key === "localPath") {
        merged.repo = undefined;
        merged.ref = undefined;
      }
      if (key === "models") {
        merged.models = { ...merged.models, ...validatedModels(value, layer.label) };
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
      contributed = true;
    }
    if (contributed) sources.push(layer.label);
  }

  const localPath = merged.localPath
    ? resolveLayerPath(merged.localPath, layers)
    : undefined;

  return {
    namespace: validateNamespace(merged.namespace ?? DEFAULT_NAMESPACE),
    repo: merged.repo ?? CERTIFIED.repo,
    ref: merged.ref ?? CERTIFIED.ref,
    pluginPath: merged.pluginPath ?? CERTIFIED.pluginPath,
    localPath,
    pinnedCommit: merged.localPath ? undefined : resolvePin(merged),
    allowBootstrap: merged.allowBootstrap ?? false,
    cacheDir: merged.cacheDir,
    models: merged.models ?? {},
    delegation: validateDelegation(merged.delegation, layers),
    sources,
  };
}

/** A bad `models` entry fails with the layer that holds it, so status can still be reached after a fix. */
function validatedModels(value: unknown, label: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} sets \`models\` to something other than an object of role to provider/model.`);
  }
  const models: Record<string, string> = {};
  for (const [role, model] of Object.entries(value)) {
    if (!isValidRole(role)) {
      throw new Error(`${label}: ${invalidRoleMessage(role)} Edit that key in \`models\` in the named file, then restart Pi.`);
    }
    if (model === "") continue;
    if (typeof model !== "string" || !isValidModelSpec(model)) {
      throw new Error(`${label}: role ${safeEcho(role)}. ${invalidModelMessage(model)}`);
    }
    Object.defineProperty(models, role, { value: model, enumerable: true, writable: true, configurable: true });
  }
  return models;
}

/**
 * The certified commit is the default, not a floor. Naming a ref or a repository without a
 * commit means the user asked for that ref, so the pin must get out of the way and trust
 * must fall to `untested-*`.
 */
function resolvePin(merged: ConfigFile): string | undefined {
  if (merged.pinnedCommit) return merged.pinnedCommit;
  if (merged.ref) return undefined;
  if (merged.repo && normalizeRepo(merged.repo) !== normalizeRepo(CERTIFIED.repo)) return undefined;
  return CERTIFIED.commit;
}

function validateDelegation(value: string | undefined, layers: readonly ConfigLayer[]): DelegationProvider {
  if (value === undefined) return DEFAULT_DELEGATION;
  if (isDelegationProvider(value)) return value;
  const owner = [...layers].reverse().find((layer) => layer.values.delegation === value);
  throw new Error(
    `${owner?.label ?? "config"} sets \`delegation\` to ${safeEcho(value)}. Use one of ${DELEGATION_PROVIDERS.map((id) => `"${id}"`).join(", ")}, or remove it to prefer "${DEFAULT_DELEGATION}".`,
  );
}

function resolveLayerPath(value: string, layers: readonly ConfigLayer[]): string {
  const expanded = expandHome(value);
  if (isAbsolute(expanded)) return expanded;
  const owner = [...layers].reverse().find((layer) => layer.values.localPath === value && layer.path);
  return resolve(owner?.path ? dirname(owner.path) : process.cwd(), expanded);
}

export function selectionOf(config: AdapterConfig): SourceSelection {
  if (config.localPath) return { kind: "local", path: config.localPath };
  return { kind: "git", repo: config.repo, ref: config.pinnedCommit ?? config.ref };
}

export function trustOf(config: AdapterConfig): Trust {
  if (config.localPath) return "local";
  if (normalizeRepo(config.repo) !== normalizeRepo(CERTIFIED.repo)) return "untested-repo";
  if (config.pinnedCommit === CERTIFIED.commit) return "tested";
  return "untested-ref";
}

export function normalizeRepo(repo: string): string {
  return repo
    .trim()
    .replace(/^git\+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function trustWarning(trust: Trust, config: AdapterConfig): string | undefined {
  switch (trust) {
    case "tested":
      return undefined;
    case "untested-ref":
      return `pstack adapter is using an untested upstream ref (${config.pinnedCommit ?? config.ref}). This release certified ${CERTIFIED.commit}. Behavior is not verified.`;
    case "untested-repo":
      return `pstack adapter is using a custom repository (${config.repo}). Code from this source is outside the tested trust boundary and runs with your full permissions. Only continue if you trust it.`;
    case "local":
      return `pstack adapter is using a local checkout (${config.localPath}). Contents are unverified and not reproducible across machines.`;
  }
}
