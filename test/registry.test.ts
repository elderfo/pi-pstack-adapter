import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { entryFor } from "../src/registry.ts";

test("the Windows-verified formal verification workflow is adapted without unconditional prerequisites", () => {
  const entry = entryFor("create-formal-verification-skill");
  assert.equal(entry.tier, "adapted");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, []);
  assert.match(entry.note ?? "", /Manual invocation only; no delegation/);
  assert.match(entry.note ?? "", /temporarily breaks product code/);
  assert.match(entry.note ?? "", /`\.pi\/skills\/` in Pi/);
  assert.match(entry.note ?? "", /other toolchains need their own prerequisites/);
});

test("the Windows-verified formal verification maintenance workflow is dependency-gated on git", () => {
  const entry = entryFor("maintain-formal-verification-skill");
  assert.equal(entry.tier, "dependency-gated");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, ["git"]);
  assert.match(entry.note ?? "", /Verified end to end on a Windows Node finite-state fixture/);
  assert.match(entry.note ?? "", /temporarily breaks product code/);
  assert.match(entry.note ?? "", /`\.pi\/skills\/`/);
});

test("sharpen stays experimental and states it returns a rewritten prompt since pstack 0.15.29", () => {
  const entry = entryFor("sharpen");
  assert.equal(entry.tier, "experimental");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, []);
  assert.match(entry.note ?? "", /not yet run end to end in Pi/);
  assert.match(entry.note ?? "", /hands back a rewritten prompt and does not do the task/);
});

test("statechart is dependency-gated on node, java, and npx and names its Windows workarounds", () => {
  const entry = entryFor("statechart");
  assert.equal(entry.tier, "dependency-gated");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, ["node", "java", "npx"]);
  assert.match(entry.note ?? "", /Verified end to end on a Windows checkout fixture at pstack 0\.15\.30/);
  assert.match(entry.note ?? "", /`spawnSync npx ENOENT`/);
  assert.match(entry.note ?? "", /`EPERM`.*give each rerun a fresh `--out` folder/);
  assert.match(entry.note ?? "", /npx -y @mermaid-js\/mermaid-cli -i <chart>\.mmd -o <chart>\.png/);
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  const row = docs.split("\n").find((line) => line.startsWith("| `statechart` |"));
  assert.equal(row, `| \`statechart\` | \`/skill:pistack-statechart\` | - | \`node\`, \`java\`, \`npx\` | ${entry.note} |`);
  const tables = docs.split(/^### /m);
  assert.ok(tables.find((section) => section.startsWith("dependency-gated"))?.includes(row ?? ""));
  assert.match(entry.note ?? "", /`TLA2TOOLS`/);
  assert.match(entry.note ?? "", /npx -y @mermaid-js\/mermaid-cli/);
  assert.match(entry.note ?? "", /scratch folder outside the repository/);
  assert.match(entry.note ?? "", /full process permissions/);
});
