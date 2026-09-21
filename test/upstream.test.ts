import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
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

test("each repository gets its own cache directory", () => {
  const root = "/cache";
  assert.notEqual(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://b.test/x"));
  assert.equal(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://a.test/x"));
});
