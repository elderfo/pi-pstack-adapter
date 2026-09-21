import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { MANIFEST_RELATIVE_PATH } from "./manifest.ts";
import { cacheRoot, checkoutDir } from "./paths.ts";
import type { AdapterConfig } from "./config.ts";
import { selectionOf, trustOf } from "./config.ts";
import type { ResolvedSource } from "./types.ts";

const run = promisify(execFile);

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: readonly string[], cwd?: string) => Promise<GitResult>;

export const systemGit: GitRunner = async (args, cwd) => {
  try {
    const { stdout, stderr } = await run("git", [...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message };
  }
};

export class BootstrapRequiredError extends Error {
  readonly repo: string;
  readonly ref: string;

  constructor(repo: string, ref: string) {
    super(
      `The pstack adapter has no cached checkout of ${repo}@${ref} and this run may not reach the network. ` +
        `Set PISTACK_ALLOW_BOOTSTRAP=1, or run an interactive Pi session once to populate the cache.`,
    );
    this.name = "BootstrapRequiredError";
    this.repo = repo;
    this.ref = ref;
  }
}

export interface ResolveOptions {
  readonly config: AdapterConfig;
  readonly git?: GitRunner;
  /** True when the adapter may reach the network without further permission. */
  readonly mayBootstrap: boolean;
}

export async function resolveSource(options: ResolveOptions): Promise<ResolvedSource> {
  const { config } = options;
  const git = options.git ?? systemGit;
  const selection = selectionOf(config);
  const trust = trustOf(config);

  if (selection.kind === "local") {
    const checkout = resolve(selection.path);
    const pluginDir = locatePluginDir(checkout, config.pluginPath);
    const head = await git(["rev-parse", "HEAD"], checkout);
    return { selection, trust, commit: head.code === 0 ? head.stdout.trim() : "", checkoutDir: checkout, pluginDir };
  }

  const root = cacheRoot(config.cacheDir);
  const dir = checkoutDir(root, config.repo);
  const wanted = selection.ref;

  if (await hasCommit(git, dir, wanted)) {
    await git(["checkout", "--quiet", wanted], dir);
    const pluginDir = locatePluginDir(dir, config.pluginPath);
    return { selection, trust, commit: await headCommit(git, dir), checkoutDir: dir, pluginDir };
  }

  if (!options.mayBootstrap) throw new BootstrapRequiredError(config.repo, wanted);

  await bootstrap(git, dir, config.repo, wanted, config.pluginPath);
  const pluginDir = locatePluginDir(dir, config.pluginPath);
  return { selection, trust, commit: await headCommit(git, dir), checkoutDir: dir, pluginDir };
}

async function hasCommit(git: GitRunner, dir: string, ref: string): Promise<boolean> {
  if (!existsSync(join(dir, ".git"))) return false;
  const result = await git(["cat-file", "-e", `${ref}^{commit}`], dir);
  return result.code === 0;
}

async function headCommit(git: GitRunner, dir: string): Promise<string> {
  const result = await git(["rev-parse", "HEAD"], dir);
  return result.code === 0 ? result.stdout.trim() : "";
}

async function bootstrap(git: GitRunner, dir: string, repo: string, ref: string, pluginPath: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) {
    await expect(git(["init", "--quiet", "."], dir), "initialize the adapter cache checkout");
    await expect(git(["remote", "add", "origin", repo], dir), `add ${repo} as the cache remote`);
  } else {
    await git(["remote", "set-url", "origin", repo], dir);
  }
  await expect(git(["config", "core.sparseCheckout", "true"], dir), "enable sparse checkout");
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".git", "info", "sparse-checkout"), `/${pluginPath}/\n`, "utf8");
  await expect(
    git(["fetch", "--depth", "1", "--filter=blob:none", "origin", ref], dir),
    `fetch ${repo}@${ref}`,
  );
  await expect(git(["checkout", "--quiet", "--force", "FETCH_HEAD"], dir), `check out ${ref}`);
}

async function expect(result: Promise<GitResult>, what: string): Promise<GitResult> {
  const settled = await result;
  if (settled.code !== 0) {
    throw new Error(`The pstack adapter could not ${what}: ${settled.stderr.trim() || `git exited ${settled.code}`}`);
  }
  return settled;
}

function locatePluginDir(checkout: string, pluginPath: string): string {
  const nested = join(checkout, pluginPath);
  if (existsSync(join(nested, MANIFEST_RELATIVE_PATH))) return nested;
  if (existsSync(join(checkout, MANIFEST_RELATIVE_PATH))) return checkout;
  throw new Error(
    `No pstack manifest under ${checkout}. Expected ${join(pluginPath, MANIFEST_RELATIVE_PATH)} or ${MANIFEST_RELATIVE_PATH}.`,
  );
}

/** Resolve a branch or tag to the commit it currently points at. Used only by explicit setup. */
export async function resolveRefToCommit(repo: string, ref: string, git: GitRunner = systemGit): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  const result = await git(["ls-remote", repo, ref]);
  if (result.code !== 0) {
    throw new Error(`Could not reach ${repo} to resolve ${ref}: ${result.stderr.trim()}`);
  }
  const line = result.stdout.split("\n").find((entry) => entry.trim() !== "");
  const commit = line?.split(/\s+/)[0];
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`${repo} has no ref named ${ref}.`);
  }
  return commit.toLowerCase();
}
