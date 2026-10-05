import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mergeConfig } from "../src/config.ts";
import { checkoutDir } from "../src/paths.ts";
import {
  BootstrapRequiredError,
  resolveRefToCommit,
  resolveSource,
  systemGit,
  validateRef,
  validateRepo,
} from "../src/upstream.ts";
import { validateContainedPath } from "../src/paths.ts";
import { makeTempDir, writePluginFixture } from "./support/fixture.ts";

function layer(values: Record<string, unknown>) {
  return { label: "test", values } as never;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

function makeUpstreamRepo(prefix: string): { path: string; commit: string; secondCommit: string } {
  const root = makeTempDir(prefix);
  writePluginFixture(root, { skills: [{ name: "unslop", body: "one\n" }], version: "1.0.0" });
  git(["init", "--quiet", "--initial-branch", "trunk", "."], root);
  git(["add", "-A"], root);
  git(["commit", "--quiet", "-m", "first"], root);
  const commit = git(["rev-parse", "HEAD"], root).trim();

  writeFileSync(join(root, "pstack", "skills", "unslop", "SKILL.md"), "---\nname: unslop\ndescription: Second.\n---\ntwo\n", "utf8");
  git(["add", "-A"], root);
  git(["commit", "--quiet", "-m", "second"], root);
  const secondCommit = git(["rev-parse", "HEAD"], root).trim();

  git(["tag", "v1", commit], root);
  return { path: root, commit, secondCommit };
}

test("a noninteractive run with an empty cache refuses to reach the network", async () => {
  const repo = makeUpstreamRepo("refuse");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir: makeTempDir("cache") })]);

  await assert.rejects(
    () => resolveSource({ config, mayBootstrap: false }),
    (error: Error) => {
      assert.ok(error instanceof BootstrapRequiredError);
      assert.match(error.message, /PISTACK_ALLOW_BOOTSTRAP=1/);
      return true;
    },
  );
});

test("explicit permission bootstraps the pinned commit and a later run reuses it offline", async () => {
  const repo = makeUpstreamRepo("bootstrap");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir })]);

  const first = await resolveSource({ config, mayBootstrap: true });
  assert.equal(first.commit, repo.commit);
  assert.equal(existsSync(join(first.pluginDir, ".cursor-plugin", "plugin.json")), true);

  let networkAttempts = 0;
  const offlineGit = async (args: readonly string[], cwd?: string) => {
    if (args[0] === "fetch" || args[0] === "ls-remote" || args[0] === "clone") {
      networkAttempts += 1;
      return { code: 1, stdout: "", stderr: "network disabled in this test" };
    }
    return systemGit(args, cwd);
  };

  const second = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
  assert.equal(second.commit, repo.commit);
  assert.equal(networkAttempts, 0, "a cached commit must not trigger any network command");
});

test("the checkout only materializes the configured plugin path", async () => {
  const repo = makeUpstreamRepo("sparse");
  const cacheDir = makeTempDir("cache");
  writeFileSync(join(repo.path, "unrelated.txt"), "noise\n", "utf8");
  git(["add", "-A"], repo.path);
  git(["commit", "--quiet", "-m", "noise"], repo.path);
  const head = git(["rev-parse", "HEAD"], repo.path).trim();

  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: head, cacheDir })]);
  const resolved = await resolveSource({ config, mayBootstrap: true });

  assert.equal(existsSync(join(resolved.checkoutDir, "pstack", ".cursor-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(resolved.checkoutDir, "unrelated.txt")), false);
});

test("a recorded commit does not advance when the branch moves", async () => {
  const repo = makeUpstreamRepo("pinned");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, ref: "trunk", pinnedCommit: repo.commit, cacheDir })]);

  const first = await resolveSource({ config, mayBootstrap: true });
  assert.equal(first.commit, repo.commit);

  const again = await resolveSource({ config, mayBootstrap: true });
  assert.equal(again.commit, repo.commit);
  assert.notEqual(again.commit, repo.secondCommit);
});

test("a branch and a tag resolve to concrete commits for explicit setup", async () => {
  const repo = makeUpstreamRepo("resolve");
  assert.equal(await resolveRefToCommit(repo.path, "trunk"), repo.secondCommit);
  assert.equal(await resolveRefToCommit(repo.path, "v1"), repo.commit);
  assert.equal(await resolveRefToCommit(repo.path, repo.commit.toUpperCase()), repo.commit);
});

test("an unknown ref is reported by name", async () => {
  const repo = makeUpstreamRepo("unknown-ref");
  await assert.rejects(() => resolveRefToCommit(repo.path, "no-such-branch"), /has no ref named no-such-branch/);
});

test("a local checkout is used directly and reports its own head", async () => {
  const repo = makeUpstreamRepo("local");
  const config = mergeConfig([layer({ localPath: repo.path })]);
  const resolved = await resolveSource({ config, mayBootstrap: false });

  assert.equal(resolved.selection.kind, "local");
  assert.equal(resolved.trust, "local");
  assert.equal(resolved.commit, repo.secondCommit);
  assert.equal(resolved.pluginDir, join(repo.path, "pstack"));
});

test("a local checkout whose root is the plugin itself is accepted", async () => {
  const root = makeTempDir("plugin-root");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const config = mergeConfig([layer({ localPath: pluginDir })]);
  const resolved = await resolveSource({ config, mayBootstrap: false });
  assert.equal(resolved.pluginDir, pluginDir);
});

test("a local path without a pstack manifest names what it looked for", async () => {
  const config = mergeConfig([layer({ localPath: makeTempDir("empty") })]);
  await assert.rejects(() => resolveSource({ config, mayBootstrap: false }), /No pstack manifest under/);
});

test("a git transport that executes a shell command is refused before git sees it", async () => {
  for (const hostile of [
    "ext::sh -c 'touch /tmp/pistack-pwned'",
    "--upload-pack=touch /tmp/pistack-pwned",
    "-u./payload",
    "file:///etc && touch /tmp/x",
  ]) {
    assert.throws(() => validateRepo(hostile), /Refusing the upstream repository/, hostile);
  }
  assert.equal(validateRepo("https://github.com/cursor/plugins"), "https://github.com/cursor/plugins");
  assert.equal(validateRepo("git@github.com:cursor/plugins"), "git@github.com:cursor/plugins");
  assert.equal(validateRepo("/tmp/local-clone"), "/tmp/local-clone");

  await assert.rejects(
    () => resolveRefToCommit("ext::sh -c 'echo pwned'", "main"),
    /Refusing the upstream repository/,
  );
});

test("a ref that git would read as an option is refused", async () => {
  for (const hostile of ["--upload-pack=sh", "-x", "main;rm -rf /", "a..b", "main branch"]) {
    assert.throws(() => validateRef(hostile), /Refusing the upstream ref/, hostile);
  }
  assert.equal(validateRef("release/1.2"), "release/1.2");
  assert.equal(validateRef("v1.0.0"), "v1.0.0");

  const config = mergeConfig([layer({ repo: "https://example.test/x", pinnedCommit: undefined, ref: "--upload-pack=sh" })]);
  await assert.rejects(() => resolveSource({ config, mayBootstrap: true }), /Refusing the upstream ref/);
});

test("an interrupted bootstrap repairs its worktree offline instead of wedging the cache", async () => {
  const repo = makeUpstreamRepo("wedged");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir })]);

  const first = await resolveSource({ config, mayBootstrap: true });
  rmSync(join(first.checkoutDir, "pstack"), { recursive: true, force: true });

  let networkAttempts = 0;
  const offlineGit = async (args: readonly string[], cwd?: string) => {
    if (args[0] === "fetch" || args[0] === "ls-remote" || args[0] === "clone") {
      networkAttempts += 1;
      return { code: 1, stdout: "", stderr: "network disabled in this test" };
    }
    return systemGit(args, cwd);
  };

  const repaired = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
  assert.equal(repaired.commit, repo.commit);
  assert.equal(existsSync(join(repaired.pluginDir, ".cursor-plugin", "plugin.json")), true);
  assert.equal(networkAttempts, 0);
});

test("a cache whose objects are gone falls back to bootstrap rather than failing forever", async () => {
  const repo = makeUpstreamRepo("lost-objects");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir })]);

  const first = await resolveSource({ config, mayBootstrap: true });
  rmSync(join(first.checkoutDir, ".git", "objects"), { recursive: true, force: true });

  await assert.rejects(() => resolveSource({ config, mayBootstrap: false }), BootstrapRequiredError);

  const repaired = await resolveSource({ config, mayBootstrap: true });
  assert.equal(repaired.commit, repo.commit);
  assert.equal(existsSync(join(repaired.pluginDir, ".cursor-plugin", "plugin.json")), true);
});

test("a branch reuses its recorded commit offline and does not advance when the branch moves", async () => {
  const repo = makeUpstreamRepo("recorded");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, ref: "trunk", cacheDir })]);

  const first = await resolveSource({ config, mayBootstrap: true });
  assert.equal(first.commit, repo.secondCommit);

  git(["commit", "--quiet", "--allow-empty", "-m", "third"], repo.path);
  const moved = git(["rev-parse", "HEAD"], repo.path).trim();
  assert.notEqual(moved, repo.secondCommit);

  let networkAttempts = 0;
  const offlineGit = async (args: readonly string[], cwd?: string) => {
    if (args[0] === "fetch" || args[0] === "ls-remote" || args[0] === "clone") {
      networkAttempts += 1;
      return { code: 1, stdout: "", stderr: "network disabled in this test" };
    }
    return systemGit(args, cwd);
  };

  const again = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
  assert.equal(again.commit, repo.secondCommit, "a recorded branch commit must not advance");
  assert.equal(networkAttempts, 0, "a recorded branch commit must not require the network");
});

test("a cleartext or credential-bearing remote is refused", () => {
  for (const hostile of [
    "http://example.test/plugins",
    "git://example.test/plugins",
    "https://user:token@example.test/plugins",
  ]) {
    assert.throws(() => validateRepo(hostile), /Refusing the upstream repository/, hostile);
  }
  assert.equal(validateRepo("https://example.test/plugins"), "https://example.test/plugins");
  assert.equal(validateRepo("https://example.test/a@b/plugins"), "https://example.test/a@b/plugins");
});

/** Runs `body` with a global git config that converts LF to CRLF on checkout, as Git for Windows ships. */
async function withGlobalAutocrlf(body: () => Promise<void>): Promise<void> {
  const original = process.env.GIT_CONFIG_GLOBAL;
  const config = join(makeTempDir("crlf-config"), "gitconfig");
  writeFileSync(config, "[core]\n\tautocrlf = true\n", "utf8");
  process.env.GIT_CONFIG_GLOBAL = config;
  try {
    await body();
  } finally {
    if (original === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = original;
  }
}

function upstreamSkillFile(pluginDir: string): string {
  return readFileSync(join(pluginDir, "skills", "unslop", "SKILL.md"), "utf8");
}

/**
 * Recreates what an earlier adapter left under Git for Windows: no local line-ending override,
 * and CRLF copies checked out by Git itself, so their index entries are stat-clean. A file
 * rewritten by hand would be stat-dirty, which hides the case where `checkout --force` does nothing.
 */
function makeLegacyCrlfCache(checkoutDir: string): void {
  git(["config", "--local", "--unset", "core.autocrlf"], checkoutDir);
  git(["config", "--local", "--unset", "core.eol"], checkoutDir);
  git(["-c", "core.autocrlf=true", "rm", "-r", "--cached", "--quiet", "--", "pstack"], checkoutDir);
  rmSync(join(checkoutDir, "pstack"), { recursive: true, force: true });
  git(["-c", "core.autocrlf=true", "checkout", "--quiet", "HEAD", "--", "pstack"], checkoutDir);
  // Age the files so the index records them as clean rather than racily clean.
  const past = new Date(Date.now() - 60_000);
  for (const file of git(["ls-files", "-z", "--", "pstack"], checkoutDir).split("\0").filter(Boolean)) {
    utimesSync(join(checkoutDir, file), past, past);
  }
  git(["-c", "core.autocrlf=true", "update-index", "--refresh", "-q"], checkoutDir);
  assert.match(git(["ls-files", "--eol", "--", "pstack/skills/unslop/SKILL.md"], checkoutDir), /i\/lf\s+w\/crlf/);
}

const offlineGit = async (args: readonly string[], cwd?: string) =>
  args[0] === "fetch" || args[0] === "ls-remote" || args[0] === "clone"
    ? { code: 1, stdout: "", stderr: "network disabled in this test" }
    : systemGit(args, cwd);

test("a global core.autocrlf does not rewrite upstream files in the cache checkout", async () => {
  const repo = makeUpstreamRepo("crlf");
  await withGlobalAutocrlf(async () => {
    const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir: makeTempDir("cache") })]);
    const resolved = await resolveSource({ config, mayBootstrap: true });
    assert.equal(upstreamSkillFile(resolved.pluginDir).includes("\r"), false);
  });
});

test("a cache checked out with CRLF before line endings were pinned is repaired offline", async () => {
  const repo = makeUpstreamRepo("crlf-repair");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir })]);
  const first = await resolveSource({ config, mayBootstrap: true });
  makeLegacyCrlfCache(first.checkoutDir);

  await withGlobalAutocrlf(async () => {
    const repaired = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
    assert.equal(repaired.commit, repo.commit);
    assert.equal(upstreamSkillFile(repaired.pluginDir).includes("\r"), false);
    assert.equal(git(["status", "--porcelain"], repaired.checkoutDir), "", "the repaired cache must match HEAD");
  });
});

test("a repair interrupted after dropping index entries is finished on the next start", async () => {
  const repo = makeUpstreamRepo("crlf-interrupted");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir: makeTempDir("cache") })]);
  const first = await resolveSource({ config, mayBootstrap: true });
  makeLegacyCrlfCache(first.checkoutDir);

  // The first start drops the stale entries, then dies before checking the files out again.
  const dyingGit = async (args: readonly string[], cwd?: string) =>
    args.includes("checkout") && args.includes("HEAD")
      ? { code: 1, stdout: "", stderr: "killed" }
      : offlineGit(args, cwd);
  await assert.rejects(() => resolveSource({ config, mayBootstrap: false, git: dyingGit }), /could not repair them: killed/);

  const repaired = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
  assert.equal(upstreamSkillFile(repaired.pluginDir).includes("\r"), false);
  assert.equal(git(["status", "--porcelain"], repaired.checkoutDir), "");
});

test("a cache whose line endings cannot be checked is refused rather than trusted", async () => {
  const repo = makeUpstreamRepo("crlf-unverifiable");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir: makeTempDir("cache") })]);
  await resolveSource({ config, mayBootstrap: true });
  const lockedGit = async (args: readonly string[], cwd?: string) =>
    args.includes("ls-files") ? { code: 128, stdout: "", stderr: "index.lock exists" } : offlineGit(args, cwd);
  await assert.rejects(
    () => resolveSource({ config, mayBootstrap: false, git: lockedGit }),
    /could not verify the line endings of its cache .*index\.lock exists/,
  );
});

test("a cache that cannot be repaired refuses to serve converted bytes and says how to recover", async () => {
  const repo = makeUpstreamRepo("crlf-readonly");
  const cacheDir = makeTempDir("cache");
  const config = mergeConfig([layer({ repo: repo.path, pinnedCommit: repo.commit, cacheDir })]);
  const first = await resolveSource({ config, mayBootstrap: true });
  makeLegacyCrlfCache(first.checkoutDir);

  // A cache whose config cannot be written and whose files cannot be rewritten.
  const readOnlyGit = async (args: readonly string[], cwd?: string) =>
    (args[0] === "config" && !args.includes("--get")) || args.includes("checkout") || args.includes("rm") || args[0] === "fetch"
      ? { code: 1, stdout: "", stderr: "read-only file system" }
      : systemGit(args, cwd);
  await assert.rejects(
    () => resolveSource({ config, mayBootstrap: false, git: readOnlyGit }),
    (error: Error) => {
      assert.match(error.message, /converted line endings, such as pstack\/skills\/unslop\/SKILL\.md/);
      assert.match(error.message, /read-only file system/);
      assert.match(error.message, /delete .* and start Pi again/);
      return true;
    },
  );
});

test("files upstream itself marks eol=crlf are upstream's bytes and are kept", async () => {
  const root = makeTempDir("crlf-upstream");
  writePluginFixture(root, { skills: [{ name: "unslop", body: "one\n", files: { "run.bat": "echo hi\n" } }], version: "1.0.0" });
  writeFileSync(join(root, ".gitattributes"), "*.bat text eol=crlf\n", "utf8");
  git(["init", "--quiet", "--initial-branch", "trunk", "."], root);
  git(["add", "-A"], root);
  git(["commit", "--quiet", "-m", "first"], root);
  const commit = git(["rev-parse", "HEAD"], root).trim();

  const config = mergeConfig([layer({ repo: root, pinnedCommit: commit, cacheDir: makeTempDir("cache") })]);
  const first = await resolveSource({ config, mayBootstrap: true });
  const again = await resolveSource({ config, mayBootstrap: false });
  assert.equal(again.commit, commit);
  assert.equal(readFileSync(join(first.pluginDir, "skills", "unslop", "run.bat"), "utf8"), "echo hi\r\n");
});

test("a Windows drive or relative path is a filesystem repository only on win32", () => {
  for (const path of ["C:\\Users\\me\\plugins", "c:/src/plugins", ".\\plugins", "..\\plugins"]) {
    assert.equal(validateRepo(path, "win32"), path);
    assert.throws(() => validateRepo(path, "linux"), /Refusing the upstream repository/, path);
  }
  for (const hostile of [
    "\\\\attacker\\share\\plugins",
    "//attacker/share/plugins",
    "C:",
    "ext::cmd /c calc",
    "-uC:\\payload",
    "C:/dev/plugins::x",
    "C:/dev/aux",
    "C:/dev/con.txt/plugins",
    "C:\\dev\\LPT1",
    "C:/dev/x./plugins",
    "C:/dev/x /plugins",
    "C:/dev/x\u0001/plugins",
    "C:\\dev\\plu|gins",
    "\\\\?\\C:\\plugins",
    "\\\\.\\pipe\\plugins",
  ]) {
    assert.throws(() => validateRepo(hostile, "win32"), /Refusing the upstream repository/, hostile);
  }
});

test("a plugin path that escapes the checkout is refused", async () => {
  for (const hostile of ["../../etc", "/etc", "a/../../b", ""]) {
    assert.throws(() => validateContainedPath(hostile, "the upstream plugin path"), /Refusing/, hostile);
  }
  assert.equal(validateContainedPath("./pstack/", "x"), "pstack");

  const config = mergeConfig([layer({ repo: "https://example.test/x", pluginPath: "../../escape" })]);
  await assert.rejects(() => resolveSource({ config, mayBootstrap: true }), /Refusing the upstream plugin path/);
});

test("each repository gets its own cache directory", () => {
  const root = "/cache";
  assert.notEqual(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://b.test/x"));
  assert.equal(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://a.test/x"));
});
