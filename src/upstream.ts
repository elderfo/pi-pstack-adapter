import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { MANIFEST_RELATIVE_PATH } from "./manifest.ts";
import { cacheRoot, checkoutDir, stateFile, validateContainedPath } from "./paths.ts";
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

/**
 * Git treats some remote strings as executable transports (`ext::<shell command>`), and treats a
 * leading dash as an option. The adapter accepts a repository from model-callable configuration,
 * so both are rejected before any argv reaches git.
 */
const ALLOWED_REPO = /^(https:\/\/|ssh:\/\/|git@[^\s@]+:|\/|\.\/|\.\.\/)[^\s]*$/;
/**
 * Windows filesystem paths: a drive letter (`C:\x`, `C:/x`) or a `.\`/`..\` relative path.
 * Git reads `C:/x` as an scp-style host on POSIX, so these are accepted only on win32. UNC
 * paths (`\\host\share`) stay refused because opening one can send Windows credentials to a
 * remote SMB host.
 */
const ALLOWED_WINDOWS_REPO = /^([A-Za-z]:[\\/]|\.\\|\.\.\\)[^\s<>:"|?*]*$/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;

/**
 * Git for Windows treats a drive path as local only when Windows accepts every component.
 * Otherwise it falls back to scp-style parsing and opens an ssh connection to a host named by
 * the drive letter (`C:/x::y`, `C:/x/aux`, `C:/x./y` all do). Mirrors Git's `is_valid_win32_path`.
 */
function isValidWindowsPath(value: string): boolean {
  return value
    .split(/[\\/]/)
    .slice(1)
    .every(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".." ||
        (!/[\u0000-\u001f]/.test(part) && !/[. ]$/.test(part) && !RESERVED_WINDOWS_NAME.test(part)),
    );
}
const ALLOWED_REF = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

export function validateRepo(repo: string, platform: NodeJS.Platform = process.platform): string {
  const value = repo.trim();
  const windows = platform === "win32";
  const unc = windows && /^[\\/]{2}/.test(value);
  const windowsPath = windows && ALLOWED_WINDOWS_REPO.test(value) && isValidWindowsPath(value);
  const allowed = !unc && (ALLOWED_REPO.test(value) || windowsPath);
  if (!allowed) {
    throw new Error(
      `Refusing the upstream repository ${JSON.stringify(repo)}. Use an https, ssh, scp-style, or filesystem path. Cleartext transports and transports such as \`ext::\` are never accepted.`,
    );
  }
  if (value.startsWith("https://") && value.slice(8).split("/")[0]?.includes("@")) {
    throw new Error(
      `Refusing the upstream repository ${JSON.stringify(repo)} because it embeds credentials in the URL. Use a credential helper or an ssh remote.`,
    );
  }
  return value;
}


export function validateRef(ref: string): string {
  const value = ref.trim();
  if (!ALLOWED_REF.test(value) || value.includes("..")) {
    throw new Error(
      `Refusing the upstream ref ${JSON.stringify(ref)}. Use a branch, tag, or commit made of letters, digits, dot, underscore, slash, and hyphen.`,
    );
  }
  return value;
}

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

  const repo = validateRepo(config.repo);
  const wanted = validateRef(selection.ref);
  const pluginPath = validateContainedPath(config.pluginPath, "the upstream plugin path");
  const root = cacheRoot(config.cacheDir);
  const dir = checkoutDir(root, repo);

  // A branch or tag name does not survive `fetch FETCH_HEAD`, so reuse the commit that the
  // last successful bootstrap of this exact repo and ref resolved to. Without this a moving
  // ref would refetch on every startup and silently advance.
  const recorded = readRecordedCommit(root, repo, wanted);
  for (const candidate of [wanted, recorded]) {
    if (!candidate) continue;
    const warm = await reuseCheckout(git, dir, candidate, pluginPath);
    if (warm) {
      recordCommit(root, repo, wanted, warm.commit);
      return { selection, trust, commit: warm.commit, checkoutDir: dir, pluginDir: warm.pluginDir };
    }
  }

  if (!options.mayBootstrap) throw new BootstrapRequiredError(repo, wanted);

  await bootstrap(git, dir, repo, wanted, pluginPath);
  const pluginDir = locatePluginDir(dir, pluginPath);
  const commit = await headCommit(git, dir);
  recordCommit(root, repo, wanted, commit);
  return { selection, trust, commit, checkoutDir: dir, pluginDir };
}

type CommitRecord = Record<string, string>;

function recordKey(repo: string, ref: string): string {
  return `${repo}#${ref}`;
}

function readRecordedCommit(root: string, repo: string, ref: string): string | undefined {
  if (/^[0-9a-f]{40}$/i.test(ref)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(stateFile(root), "utf8")) as CommitRecord;
    const commit = parsed[recordKey(repo, ref)];
    return typeof commit === "string" && /^[0-9a-f]{40}$/i.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

function recordCommit(root: string, repo: string, ref: string, commit: string): void {
  if (!/^[0-9a-f]{40}$/i.test(commit) || /^[0-9a-f]{40}$/i.test(ref)) return;
  let current: CommitRecord = {};
  try {
    current = JSON.parse(readFileSync(stateFile(root), "utf8")) as CommitRecord;
  } catch {
    current = {};
  }
  if (current[recordKey(repo, ref)] === commit) return;
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(stateFile(root), `${JSON.stringify({ ...current, [recordKey(repo, ref)]: commit }, null, 2)}\n`, "utf8");
  } catch {
    // A read-only cache still works; it just refetches. Never fail startup over bookkeeping.
  }
}

/**
 * A cached commit object is not a usable checkout. An interrupted bootstrap can leave the
 * object present and the worktree empty, so the manifest has to resolve before the cache counts
 * as warm. Otherwise the caller falls through to a forced re-bootstrap instead of wedging.
 */
async function reuseCheckout(
  git: GitRunner,
  dir: string,
  wanted: string,
  pluginPath: string,
): Promise<{ commit: string; pluginDir: string } | undefined> {
  if (!existsSync(join(dir, ".git"))) return undefined;
  if ((await git(["cat-file", "-e", `${wanted}^{commit}`], dir)).code !== 0) return undefined;

  // A read-only cache cannot take the setting. That is fine while its files are already LF, and
  // the line-ending check below refuses it otherwise.
  const pinError = await pinLineEndings(git, dir).then(
    () => undefined,
    (error: Error) => error,
  );

  // Skipping a no-op checkout avoids contending on .git/index.lock with a concurrent session.
  const head = await headCommit(git, dir);
  if (head.toLowerCase() !== wanted.toLowerCase() || !existsSync(join(dir, pluginPath))) {
    if ((await git(["checkout", "--quiet", "--force", wanted], dir)).code !== 0) return undefined;
  }

  const commit = await headCommit(git, dir);
  if (/^[0-9a-f]{40}$/i.test(wanted) && commit.toLowerCase() !== wanted.toLowerCase()) return undefined;
  let pluginDir: string;
  try {
    pluginDir = locatePluginDir(dir, pluginPath);
  } catch {
    return undefined;
  }
  await ensureUpstreamBytes(git, dir, pluginPath, pinError);
  return { commit, pluginDir };
}

/**
 * A cache checked out before line endings were pinned can hold CRLF copies of LF files. Git
 * skips files whose index entries look clean, even with `--force`, so the repair drops those
 * entries and checks the files out again. Each file is rewritten in place, so a concurrent
 * reader never sees the plugin tree disappear. A repair interrupted between the two steps leaves
 * the index behind HEAD, which the next start detects and finishes. When the cache cannot be
 * verified or repaired, this throws rather than serve altered upstream bytes.
 */
async function ensureUpstreamBytes(
  git: GitRunner,
  dir: string,
  pluginPath: string,
  pinError: Error | undefined,
): Promise<void> {
  const damaged = await filesNeedingRepair(git, dir, pluginPath);
  if (damaged.length === 0) return;
  let repairError = pinError?.message;
  if (!pinError) {
    const untracked = await git(["--literal-pathspecs", "rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...damaged], dir);
    const restored = untracked.code === 0
      ? await git(["--literal-pathspecs", "checkout", "--quiet", "--force", "HEAD", "--", ...damaged], dir)
      : untracked;
    if (restored.code !== 0) repairError = restored.stderr.trim() || `git exited ${restored.code}`;
  }
  const remaining = await filesNeedingRepair(git, dir, pluginPath);
  if (remaining.length === 0) return;
  throw new Error(
    `The pstack adapter cache at ${dir} holds upstream files with converted line endings, such as ${remaining[0]}, and could not repair them` +
      `${repairError ? `: ${repairError}` : "."} Make the cache writable, or delete ${dir} and start Pi again to download a fresh copy.`,
  );
}

/**
 * Plugin files that are not upstream's bytes: a CRLF working copy of an LF blob that upstream
 * did not mark `eol=crlf`, or an index entry that differs from HEAD after an interrupted repair.
 */
async function filesNeedingRepair(git: GitRunner, dir: string, pluginPath: string): Promise<string[]> {
  const listing = await scan(git, dir, ["--literal-pathspecs", "ls-files", "-z", "--eol", "--", pluginPath]);
  const converted = listing
    .map((entry) => entry.match(/^i\/(\S*)\s+w\/(\S*)\s+attr\/([^\t]*)\t(.+)$/s))
    .filter((match): match is RegExpMatchArray => match !== null)
    .filter(([, index, worktree, attr]) => index === "lf" && worktree !== "lf" && worktree !== "" && !/eol=crlf/.test(attr ?? ""))
    .map(([, , , , file]) => file!);
  const unstaged = await scan(git, dir, ["--literal-pathspecs", "diff", "--cached", "--name-only", "-z", "HEAD", "--", pluginPath]);
  return [...new Set([...converted, ...unstaged])].sort();
}

async function scan(git: GitRunner, dir: string, args: readonly string[]): Promise<string[]> {
  const result = await git(args, dir);
  if (result.code !== 0) {
    throw new Error(
      `The pstack adapter could not verify the line endings of its cache at ${dir}: ${result.stderr.trim() || `git exited ${result.code}`}. ` +
        `Close other Pi sessions and start Pi again, or delete ${dir} to download a fresh copy.`,
    );
  }
  return result.stdout.split("\0").filter((entry) => entry !== "");
}

/**
 * Upstream files must reach generation byte for byte. Git for Windows installs with a system-wide
 * `core.autocrlf=true`, which would rewrite every text file to CRLF, so the cache repository
 * overrides it locally. An upstream `.gitattributes` `eol` setting still applies, because that
 * is upstream's own choice.
 */
async function pinLineEndings(git: GitRunner, dir: string): Promise<void> {
  for (const [key, value] of [["core.autocrlf", "false"], ["core.eol", "lf"]] as const) {
    const current = await git(["config", "--local", "--get", key], dir);
    if (current.code === 0 && current.stdout.trim() === value) continue;
    await expect(git(["config", "--local", key, value], dir), `set ${key} in the adapter cache checkout`);
  }
}

async function headCommit(git: GitRunner, dir: string): Promise<string> {
  const result = await git(["rev-parse", "HEAD"], dir);
  return result.code === 0 ? result.stdout.trim() : "";
}

async function bootstrap(git: GitRunner, dir: string, repo: string, ref: string, pluginPath: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  if ((await git(["rev-parse", "--git-dir"], dir)).code === 0) {
    await git(["remote", "set-url", "origin", repo], dir);
  } else {
    // A half-created or damaged cache is disposable. Start it over rather than repairing it.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await expect(git(["init", "--quiet", "."], dir), "initialize the adapter cache checkout");
    await expect(git(["remote", "add", "origin", repo], dir), `add ${repo} as the cache remote`);
  }
  await pinLineEndings(git, dir);
  await expect(git(["config", "core.sparseCheckout", "true"], dir), "enable sparse checkout");
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".git", "info", "sparse-checkout"), `/${pluginPath}/\n`, "utf8");
  await expect(
    git(["fetch", "--depth", "1", "--filter=blob:none", "origin", "--end-of-options", ref], dir),
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
  const safeRepo = validateRepo(repo);
  const safeRef = validateRef(ref);
  if (/^[0-9a-f]{40}$/i.test(safeRef)) return safeRef.toLowerCase();
  const result = await git(["ls-remote", "--end-of-options", safeRepo, safeRef]);
  if (result.code !== 0) {
    throw new Error(`Could not reach ${safeRepo} to resolve ${safeRef}: ${result.stderr.trim()}`);
  }
  const line = result.stdout.split("\n").find((entry) => entry.trim() !== "");
  const commit = line?.split(/\s+/)[0];
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`${safeRepo} has no ref named ${safeRef}.`);
  }
  return commit.toLowerCase();
}
