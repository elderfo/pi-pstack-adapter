import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { probe } from "../.agents/skills/certify-pstack-revision/scripts/probe.ts";
import { SKILL_REGISTRY } from "../src/registry.ts";
import { makeTempDir, writePluginFixture } from "./support/fixture.ts";

const COMMIT = "0".repeat(40);
const registrySkills = () => Object.keys(SKILL_REGISTRY).map((name) => ({ name, body: `\n# ${name}\n` }));

test("the certification probe passes a tree that matches the registry", () => {
  const root = makeTempDir("probe-ok");
  const pluginDir = writePluginFixture(root, { skills: registrySkills() });
  const report = probe(pluginDir, COMMIT, join(root, "cache"));

  assert.equal(report.ok, true, JSON.stringify(report.diagnostics));
  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.replaced, ["setup-pstack"], "a replaced body is reported, not compared");
  assert.equal(report.byteIdentical, Object.keys(SKILL_REGISTRY).length - 1);
});

test("the certification probe compares CRLF upstream bodies the way generation parses them", () => {
  const root = makeTempDir("probe-crlf");
  const pluginDir = writePluginFixture(root, { skills: registrySkills() });
  writeFileSync(
    join(pluginDir, "skills", "bro", "SKILL.md"),
    "---\r\nname: bro\r\ndescription: Fixture skill bro.\r\n---\r\n\r\n# bro\r\n",
    "utf8",
  );
  const report = probe(pluginDir, COMMIT, join(root, "cache"));

  assert.deepEqual(report.mismatched, []);
  assert.equal(report.ok, true);
});

test("the certification probe fails when a registry skill is missing upstream", () => {
  const root = makeTempDir("probe-removed");
  const pluginDir = writePluginFixture(root, { skills: registrySkills().filter((s) => s.name !== "bro") });
  const report = probe(pluginDir, COMMIT, join(root, "cache"));

  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some((d) => d.level === "warning" && d.resource === "skill:bro"));
});
