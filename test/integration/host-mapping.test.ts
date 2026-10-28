import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { generate } from "../../src/generate.ts";
import { writePluginFixture } from "../support/fixture.ts";

test("the host mapping covers Orchestrate vocabulary new in pstack 0.15.36", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "host-mapping-01536-"));
  try {
    const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
    const commit = "0".repeat(40);
    const result = generate({
      source: {
        selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
        trust: "untested-repo", commit, checkoutDir: root, pluginDir,
      },
      namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "test",
    });
    const mapping = readFileSync(join(result.outDir, "adapter", "host-mapping.md"), "utf8");
    const rowFor = (start: string) => mapping.split("\n").find((line) => line.startsWith(start)) ?? "";

    assert.match(rowFor("| the agent's store"), /the Project store, the Project tracker \(`notes\.md`\) \| no Pi equivalent.*a folder Git ignores, such as `\.work\/<project>\/` after adding `\.work\/` to the working repository's `\.git\/info\/exclude`, or outside the repository\. Give its absolute path to each child/);
    assert.match(rowFor("| PR and CI event subscriptions"), /not available in Pi\. Check the PR's live state with `gh pr view` and `gh pr checks`.*do not start a polling loop/);
    assert.match(rowFor("| forking a worker"), /no Pi equivalent.*Start a new child, as the `resume` row says, and give it the earlier worker's brief and result, the absolute path of the worktree that holds the state/);
    assert.doesNotMatch(rowFor("| forking a worker"), /worker that holds the state/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
