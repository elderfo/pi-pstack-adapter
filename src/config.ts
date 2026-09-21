import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { CERTIFIED } from "./certified.ts";
import { DEFAULT_NAMESPACE, validateNamespace } from "./namespace.ts";
import { expandHome } from "./paths.ts";
import type { SourceSelection, Trust } from "./types.ts";

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
}

export interface ConfigLayer {
  readonly label: string;
  readonly path?: string;
  readonly values: ConfigFile;
}

const ENV = {
  namespace: "PISTACK_NAMESPACE",
  repo: "PISTACK_UPSTREAM_REPO",
  ref: "PISTACK_UPSTREAM_REF",
  localPath: "PISTACK_UPSTREAM_PATH",
  pluginPath: "PISTACK_UPSTREAM_PLUGIN_PATH",
  allowBootstrap: "PISTACK_ALLOW_BOOTSTRAP",
  cacheDir: "PISTACK_CACHE_DIR",
  models: "PISTACK_MODELS",
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
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
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

/** `role=provider/model,role2=provider/model2` */
export function parseModelRoles(value: string): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid model role assignment ${JSON.stringify(trimmed)}. Use role=provider/model.`);
    }
    roles[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
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
  if (env[ENV.allowBootstrap]) values.allowBootstrap = env[ENV.allowBootstrap] !== "0";
  if (env[ENV.models]) values.models = parseModelRoles(env[ENV.models] as string);
  return { label: "environment", values };
}

export function mergeConfig(layers: readonly ConfigLayer[]): AdapterConfig {
  const merged: ConfigFile = {};
  const sources: string[] = [];
  for (const layer of layers) {
    let contributed = false;
    for (const [key, value] of Object.entries(layer.values)) {
      if (value === undefined) continue;
      if (key === "models") {
        merged.models = { ...merged.models, ...(value as Record<string, string>) };
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
    pinnedCommit: merged.localPath ? undefined : (merged.pinnedCommit ?? CERTIFIED.commit),
    allowBootstrap: merged.allowBootstrap ?? false,
    cacheDir: merged.cacheDir,
    models: merged.models ?? {},
    sources,
  };
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
