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

test("the formal verification maintenance wrapper preserves manual invocation and gates on git", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "formal-maintain-wrapper-"));
  try {
    const body = "# Maintain formal verification\n\nRerun each check against the current code.\n";
    const pluginDir = writePluginFixture(root, { skills: [{
      name: "maintain-formal-verification-skill",
      frontmatter: "name: maintain-formal-verification-skill\ndescription: Fixture.\ndisable-model-invocation: true",
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
    const wrapper = readFileSync(join(result.skillsDir, "pistack-maintain-formal-verification-skill", "SKILL.md"), "utf8");
    assert.match(wrapper, /^name: pistack-maintain-formal-verification-skill$/m);
    assert.match(wrapper, /^disable-model-invocation: true$/m);
    assert.match(wrapper, /^  pistack-support-tier: dependency-gated$/m);
    assert.match(wrapper, /Requires these executables on PATH: `git`\./);
    assert.equal(extractUpstreamBody(wrapper), body);
    assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.resource === "skill:maintain-formal-verification-skill"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the statechart wrapper preserves manual invocation and gates on node and npm", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "statechart-wrapper-"));
  try {
    const body = "# Statechart\n\nDraw what the user sees from a TLA+ model.\n";
    // Inert stand-ins for the nested scripts the body runs from `<skill dir>/scripts`; never executed.
    const supportFiles = {
      "scripts/statechart.mjs": "// fixture\nexport {};\n",
      "scripts/model/Example.cfg": "SPECIFICATION Spec\n",
    };
    const pluginDir = writePluginFixture(root, { skills: [{
      name: "statechart",
      frontmatter: "name: statechart\ndescription: Fixture.\ndisable-model-invocation: true",
      body,
      files: supportFiles,
    }] });
    const commit = "0".repeat(40);
    const result = generate({
      source: {
        selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
        trust: "untested-repo", commit, checkoutDir: root, pluginDir,
      },
      namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "test",
    });
    const wrapper = readFileSync(join(result.skillsDir, "pistack-statechart", "SKILL.md"), "utf8");
    assert.match(wrapper, /^name: pistack-statechart$/m);
    assert.match(wrapper, /^disable-model-invocation: true$/m);
    assert.match(wrapper, /^  pistack-support-tier: dependency-gated$/m);
    assert.match(wrapper, /Requires these executables on PATH: `node`, `npm`\./);
    assert.equal(extractUpstreamBody(wrapper), body);
    for (const [path, content] of Object.entries(supportFiles)) {
      assert.equal(readFileSync(join(result.skillsDir, "pistack-statechart", path), "utf8"), content, path);
    }
    assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.resource === "skill:statechart"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the host mapping forbids editing a skill in the plugin cache, new in pstack 0.15.32", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "host-mapping-01532-"));
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
    const row = mapping.split("\n").find((line) => line.startsWith("| a skill under `plugins/cache/`"));
    assert.ok(row, "the host mapping needs a row for reflect's plugins/cache/ rule");
    assert.match(row, /`plugin directory` or `generated skills` row/);
    assert.match(row, /Never edit a file there/);
    assert.match(row, /copy the upstream skill folder from the plugin directory/);
    assert.match(row, /Do not copy a generated wrapper/);
    assert.match(row, /copy each skill it links to as well, or point the link at that skill's file in the plugin directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
