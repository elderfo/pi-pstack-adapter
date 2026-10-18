import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { extractUpstreamBody, generate } from "../../src/generate.ts";
import { writePluginFixture } from "../support/fixture.ts";

test("the formal verification wrapper preserves manual invocation and publishes its verified tier", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "formal-wrapper-"));
  try {
    const body = "# Formal verification\n\nProve the check catches a broken product variant.\n";
    const pluginDir = writePluginFixture(root, { skills: [{
      name: "create-formal-verification-skill",
      frontmatter: "name: create-formal-verification-skill\ndescription: Fixture.\ndisable-model-invocation: true",
      body,
    }] });
    const commit = "0".repeat(40);
    const result = generate({
      source: {
        selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
        trust: "untested-repo", commit, checkoutDir: root, pluginDir,
      },
      namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "test",
    });
    const wrapper = readFileSync(join(result.skillsDir, "pistack-create-formal-verification-skill", "SKILL.md"), "utf8");
    assert.match(wrapper, /^name: pistack-create-formal-verification-skill$/m);
    assert.match(wrapper, /^disable-model-invocation: true$/m);
    assert.match(wrapper, /^  pistack-support-tier: adapted$/m);
    assert.match(wrapper, /`\.pi\/skills\/` in Pi/);
    assert.match(wrapper, /temporarily breaks product code/);
    assert.equal(extractUpstreamBody(wrapper), body);
    assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.resource === "skill:create-formal-verification-skill"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
