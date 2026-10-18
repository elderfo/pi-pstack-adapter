import assert from "node:assert/strict";
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
