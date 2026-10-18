import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
for (const state of ["empty", "incomplete-metadata", "foreign-gitfile", "foreign-worktree", "foreign-common-dir", "short-path"] as const) {
  test(`a nested ${state} cache cannot change its enclosing repository`, {
    skip: state === "short-path" && process.platform !== "win32" && "8.3 path aliases are Windows-specific",
  }, async (context) => {
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
      let cacheOwner = owner;
      if (state === "short-path") {
        const short = spawnSync("cmd.exe", ["/d", "/s", "/c", `for %I in ("${owner}") do @echo %~sI`], {
          encoding: "utf8", windowsVerbatimArguments: true,
        });
        assert.equal(short.status, 0, short.stderr);
        cacheOwner = short.stdout.trim();
        if (relative(cacheOwner, owner) === "") {
          context.skip("this Windows filesystem has no 8.3 alias for the fixture");
          return;
        }
      }
      const cacheDir = join(cacheOwner, "cache");
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
        // Keep ownership probes usable on Git versions before 2.31.
        if (args.includes("--path-format=absolute")) {
          return { code: 129, stdout: "", stderr: "unsupported --path-format (pre-2.31 Git)" };
        }
        const safeDiscovery = ["rev-parse", "cat-file", "init"].includes(args[0] ?? "");
        if (!safeDiscovery && cwd) {
          const top = await systemGit(["rev-parse", "--show-toplevel"], cwd);
          if (top.code === 0 && relative(realpathSync.native(cwd), realpathSync.native(top.stdout.trim())) !== "") {
            throw new Error(`would mutate enclosing repository: git ${args.join(" ")}`);
          }
          const common = await systemGit(["rev-parse", "--git-common-dir"], cwd);
          if (common.code === 0 && relative(realpathSync.native(join(cwd, ".git")), realpathSync.native(resolve(cwd, common.stdout.trim()))) !== "") {
            throw new Error(`would mutate foreign Git metadata: git ${args.join(" ")}`);
          }
        }
        return systemGit(args, cwd);
      };
      const config = mergeConfig([{ label: "test", values: { repo: upstream, pinnedCommit: commit, cacheDir } }]);
      try {
        const first = await resolveSource({ config, mayBootstrap: true, git: guardedGit });
        assert.equal(first.commit, commit);
        assert.equal(relative(realpathSync.native(dir), realpathSync.native(git(["rev-parse", "--show-toplevel"], dir))), "");
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
