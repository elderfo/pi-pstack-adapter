import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { extractUpstreamBody, generate } from "../../src/generate.ts";
import { writePluginFixture } from "../support/fixture.ts";

test("the reframe wrapper, new in pstack 0.15.48, preserves manual invocation and publishes experimental with no new-skill diagnostic", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "reframe-wrapper-"));
  try {
    const body = "Teach the operator the expert words for what they are building.\n\nOpen every link and confirm it uses the term that way. Cut any citation you can't confirm.\n";
    const pluginDir = writePluginFixture(root, { skills: [{
      name: "reframe",
      frontmatter: "name: reframe\ndescription: Fixture.\ndisable-model-invocation: true",
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
    const wrapper = readFileSync(join(result.skillsDir, "pistack-reframe", "SKILL.md"), "utf8");
    assert.match(wrapper, /^name: pistack-reframe$/m);
    assert.match(wrapper, /^disable-model-invocation: true$/m);
    assert.match(wrapper, /^  pistack-support-tier: experimental$/m);
    assert.match(wrapper, /Stock Pi has no web tool/);
    assert.doesNotMatch(wrapper, /Requires these executables on PATH/);
    assert.equal(extractUpstreamBody(wrapper), body);
    assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.resource === "skill:reframe"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
