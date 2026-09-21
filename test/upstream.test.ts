import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mergeConfig } from "../src/config.ts";
import { checkoutDir } from "../src/paths.ts";
import { BootstrapRequiredError, resolveRefToCommit, resolveSource, systemGit } from "../src/upstream.ts";
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

test("each repository gets its own cache directory", () => {
  const root = "/cache";
  assert.notEqual(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://b.test/x"));
  assert.equal(checkoutDir(root, "https://a.test/x"), checkoutDir(root, "https://a.test/x"));
});
