import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { mergeConfig } from "../../src/config.ts";
import { checkoutDir } from "../../src/paths.ts";
import { resolveSource, systemGit, type GitRunner } from "../../src/upstream.ts";
import { writePluginFixture } from "../support/fixture.ts";

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

// Run only on the scheduled integration lane: these tests spawn Git and write fixtures.
for (const state of ["empty", "incomplete-metadata", "foreign-gitfile", "foreign-worktree", "foreign-common-dir"] as const) {
  test(`a nested ${state} cache cannot change its enclosing repository`, async () => {
    const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, "containment-"));
    try {
      const upstream = join(root, "upstream");
      writePluginFixture(upstream, { skills: [{ name: "unslop", body: "upstream\n" }] });
      git(["init", "--quiet", "."], upstream);
      git(["add", "-A"], upstream);
      git(["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "upstream"], upstream);
      const commit = git(["rev-parse", "HEAD"], upstream);

      const owner = join(root, "owner");
      mkdirSync(owner);
      git(["init", "--quiet", "."], owner);
      git(["remote", "add", "origin", "https://example.test/user-owned"], owner);
      writeFileSync(join(owner, "original.txt"), "user-owned bytes\n");
      writeFileSync(join(owner, ".git", "info", "exclude"), "/cache/\n");
      git(["add", "original.txt"], owner);
      git(["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "owner"], owner);
      // Also exercise reuse when ancestor discovery can find the requested object.
      git(["fetch", "--quiet", upstream, commit], owner);
      const before = {
        head: git(["rev-parse", "HEAD"], owner),
        config: readFileSync(join(owner, ".git", "config")),
        index: readFileSync(join(owner, ".git", "index")),
        file: readFileSync(join(owner, "original.txt")),
      };
      const cacheDir = join(owner, "cache");
      const dir = checkoutDir(cacheDir, upstream);
      mkdirSync(dir, { recursive: true });
      if (state === "incomplete-metadata") mkdirSync(join(dir, ".git", "info"), { recursive: true });
      if (state === "foreign-gitfile") writeFileSync(join(dir, ".git"), `gitdir: ${join(owner, ".git")}\n`);
      if (state === "foreign-worktree" || state === "foreign-common-dir") {
        git(["init", "--quiet", "."], dir);
        if (state === "foreign-worktree") git(["config", "core.worktree", owner], dir);
        else writeFileSync(join(dir, ".git", "commondir"), `${join(owner, ".git")}\n`);
      }

      // Keep the red run safe: observe real Git discovery, but stop BEFORE a buggy
      // implementation could mutate the ancestor's origin, config, index, or HEAD.
      const guardedGit: GitRunner = async (args, cwd) => {
        const safeDiscovery = ["rev-parse", "cat-file", "init"].includes(args[0] ?? "");
        if (!safeDiscovery && cwd) {
          const top = await systemGit(["rev-parse", "--show-toplevel"], cwd);
          if (top.code === 0 && relative(cwd, top.stdout.trim()) !== "") {
            throw new Error(`would mutate enclosing repository: git ${args.join(" ")}`);
          }
          const common = await systemGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
          if (common.code === 0 && relative(join(cwd, ".git"), common.stdout.trim()) !== "") {
            throw new Error(`would mutate foreign Git metadata: git ${args.join(" ")}`);
          }
        }
        return systemGit(args, cwd);
      };
      const config = mergeConfig([{ label: "test", values: { repo: upstream, pinnedCommit: commit, cacheDir } }]);
      try {
        const first = await resolveSource({ config, mayBootstrap: true, git: guardedGit });
        assert.equal(first.commit, commit);
        assert.equal(relative(dir, git(["rev-parse", "--show-toplevel"], dir)), "");
        assert.equal(readFileSync(join(first.pluginDir, "skills", "unslop", "SKILL.md"), "utf8").endsWith("upstream\n"), true);
        const offlineGit: GitRunner = async (args, cwd) => {
          assert.notEqual(args[0], "fetch", "warm cache must not reach the network");
          return guardedGit(args, cwd);
        };
        const warm = await resolveSource({ config, mayBootstrap: false, git: offlineGit });
        assert.equal(warm.commit, commit);
      } finally {
        assert.equal(git(["rev-parse", "HEAD"], owner), before.head);
        assert.deepEqual(readFileSync(join(owner, ".git", "config")), before.config);
        assert.deepEqual(readFileSync(join(owner, ".git", "index")), before.index);
        assert.deepEqual(readFileSync(join(owner, "original.txt")), before.file);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
