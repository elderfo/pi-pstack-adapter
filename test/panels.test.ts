import assert from "node:assert/strict";
import { test } from "node:test";
import { environmentLayer, mergeConfig, planPanelAssignment, type ConfigLayer } from "../src/config.ts";
import { PANEL_ROLES } from "../src/registry.ts";
import { panelWarning, renderPanels, renderStatus, resolvePanel } from "../src/status.ts";
import type { AdapterConfig } from "../src/config.ts";

const layer = (models: Record<string, unknown>): ConfigLayer => ({ label: "global", values: { models } as never });
const available = [
  { id: "anthropic/opus", reasoning: true },
  { id: "openai/gpt", reasoning: true },
  { id: "plain/model", reasoning: false },
];

test("a panel role holds a space-separated list in the config file and in PISTACK_MODELS", () => {
  const fromFile = mergeConfig([layer({ "arena-runners": "anthropic/opus:high openai/gpt:high inherit" })]);
  assert.equal(fromFile.models["arena-runners"], "anthropic/opus:high openai/gpt:high inherit");

  const fromEnv = environmentLayer({ PISTACK_MODELS: "judgment=anthropic/opus,interrogate-reviewers=anthropic/opus:high openai/gpt" });
  assert.deepEqual(fromEnv.values.models, { judgment: "anthropic/opus", "interrogate-reviewers": "anthropic/opus:high openai/gpt" });
});

test("a malformed panel value names the layer and the role", () => {
  assert.throws(() => mergeConfig([layer({ "arena-runners": "a/b `c`" })]), /global: role "arena-runners"\. Invalid panel value/);
  assert.throws(() => mergeConfig([layer({ "arena-runners": ["a/b"] })]), /Invalid panel value/);
  assert.throws(() => mergeConfig([layer({ "arena-runners": Array(9).fill("a/b").join(" ") })]), /1 to 8 entries/);
  // A list on an ordinary role stays an invalid model id, so lists cannot leak into single roles.
  assert.throws(() => mergeConfig([layer({ judgment: "a/b c/d" })]), /Invalid model value/);
  // Only ASCII spaces separate entries, and the whole value stays within what set_model can write.
  assert.throws(() => mergeConfig([layer({ "arena-runners": "a/b\nc/d" })]), /Invalid panel value/);
  assert.throws(() => mergeConfig([layer({ "arena-runners": "a/b\u2028c/d" })]), /Invalid panel value/);
  assert.throws(() => mergeConfig([layer({ "arena-runners": `a/b${" ".repeat(2000)}c/d` })]), /Invalid panel value/);
  assert.throws(() => environmentLayer({ PISTACK_MODELS: "arena-runners=a/b <x>" }), /PISTACK_MODELS: Role "arena-runners"\. Invalid panel value/);
});

test("set_model for a panel validates each entry and applies thinking to entries without their own level", () => {
  assert.deepEqual(planPanelAssignment("anthropic/opus, openai/gpt:low", "high", available), {
    kind: "assign",
    value: "anthropic/opus:high openai/gpt:low",
  });
  assert.deepEqual(planPanelAssignment("inherit openai/gpt", "high", available), { kind: "assign", value: "inherit openai/gpt:high" });
  assert.deepEqual(planPanelAssignment("inherit", undefined, available), { kind: "inherit" });
  assert.equal(planPanelAssignment("inherit", "high", available).kind, "rejected");
  assert.equal(planPanelAssignment("inherit openai/gpt:low", "turbo", available).kind, "rejected");
  const unknown = planPanelAssignment("anthropic/opus missing/model", undefined, available);
  assert.equal(unknown.kind, "rejected");
  assert.match(unknown.kind === "rejected" ? unknown.message : "", /^Entry `missing\/model`: No model `missing\/model` is available/);
  assert.equal(planPanelAssignment("anthropic/opus plain/model", "high", available).kind, "rejected");
  assert.equal(planPanelAssignment(Array(9).fill("anthropic/opus").join(","), undefined, available).kind, "rejected");
});

test("an unset panel follows judgment, then general, the way delegation resolves those roles", () => {
  const config = mergeConfig([layer({ general: "openai/gpt:medium" })]);
  const panel = resolvePanel(config, "architect-runners");
  assert.equal(panel.configured, false);
  assert.deepEqual(panel.seats, [
    { kind: "model", spec: { model: "openai/gpt", thinking: "medium" }, from: "general" },
    { kind: "model", spec: { model: "openai/gpt", thinking: "medium" }, from: "general" },
  ]);
  assert.deepEqual(resolvePanel(mergeConfig([]), "arena-runners").seats, [
    { kind: "parent", from: "judgment" },
    { kind: "parent", from: "general" },
  ]);
});

const warn = (config: AdapterConfig, role: string): string | undefined => panelWarning(resolvePanel(config, role), config);

test("a panel collapsed onto one model is reported as configuration, with the setup fix", () => {
  // The case that misled an agent: judgment and general on one model, other roles on other families.
  const collapsed = mergeConfig([
    layer({ judgment: "anthropic/opus:medium", general: "anthropic/opus:medium", "perf-issue": "openai/gpt:high" }),
  ]);
  for (const role of PANEL_ROLES) {
    const warning = warn(collapsed, role) ?? "";
    assert.match(warning, new RegExp(`Every seat of \`${role}\` runs on \`anthropic/opus\``));
    assert.match(warning, /it is unset, and `judgment` and `general` both resolve to `anthropic\/opus`/);
    assert.match(warning, /comes from the adapter configuration, not from which models are available/);
    assert.match(warning, /Run `\/skill:pistack-setup`/);
  }
  assert.match(warn(collapsed, "arena-cross-judge-pool") ?? "", /a session on the family of `anthropic\/opus` gets no judge from the pool, and arena skips the judge\./);

  const configured = mergeConfig([layer({ "interrogate-reviewers": "openai/gpt:high openai/gpt:low" })]);
  assert.match(warn(configured, "interrogate-reviewers") ?? "", /its configured entries all name `openai\/gpt`/);

  assert.match(warn(mergeConfig([]), "arena-runners") ?? "", /runs on the model of the agent that starts the panel/);
});

test("a one-model judge pool names the default pool arena falls back to, and an inherit-only pool never judges", () => {
  const config = mergeConfig([layer({ judgment: "anthropic/opus", general: "openai/gpt", "arena-cross-judge-pool": "anthropic/opus" })]);
  assert.match(
    warn(config, "arena-cross-judge-pool") ?? "",
    /arena tries its default pool, anthropic\/opus at backend default \(judgment\); openai\/gpt at backend default \(general\), before it skips the judge/,
  );
  const inherit = mergeConfig([layer({ "arena-cross-judge-pool": "inherit" })]);
  assert.match(warn(inherit, "arena-cross-judge-pool") ?? "", /an `inherit` entry never judges, so arena skips the judge\./);
  assert.doesNotMatch(warn(inherit, "arena-cross-judge-pool") ?? "", /another family/);
});

test("a panel on two models, or one deliberate runner, gets no warning; a one-model judge pool still does", () => {
  const split = mergeConfig([layer({ judgment: "anthropic/opus", general: "openai/gpt" })]);
  for (const role of PANEL_ROLES) assert.equal(warn(split, role), undefined, role);

  // Upstream lets a panel line hold one entry on purpose.
  const single = mergeConfig([layer({ "arena-runners": "openai/gpt", "arena-cross-judge-pool": "openai/gpt" })]);
  assert.equal(warn(single, "arena-runners"), undefined);
  assert.match(warn(single, "arena-cross-judge-pool") ?? "", /gets no judge from the pool/);
});

test("the status report lists each panel apart from the model roles, and warns when one collapses", () => {
  const config = mergeConfig([
    layer({ judgment: "anthropic/one:medium", general: "anthropic/one:medium", "arena-runners": "anthropic/one:high openai/two:high" }),
  ]);
  const report = renderStatus({
    adapterVersion: "0.1.0",
    config,
    source: { selection: { kind: "local", path: "/x" }, trust: "local", commit: "", checkoutDir: "/x", pluginDir: "/x" },
    upstreamVersion: "0.15.2",
    generation: { outDir: "/o", skillsDir: "/o/s", skills: [], agents: [], agentPromptsDir: "/o/a", diagnostics: [] },
    capabilities: [],
    platform: "supported",
    platformName: "linux",
    modeActive: false,
    cacheRoot: "/c",
    bootstrapped: false,
  });
  assert.doesNotMatch(report, /\| arena-runners \| anthropic\/one(:high)? \|/);
  assert.match(report, /\| arena-runners \| anthropic\/one at high; openai\/two at high \| configured \|/);
  assert.match(report, /\| architect-runners \| anthropic\/one at medium \(judgment\); anthropic\/one at medium \(general\) \| unset, so judgment, general \|/);
  assert.doesNotMatch(report, /Every seat of `arena-runners`/);
  for (const panel of ["arena-cross-judge-pool", "architect-runners", "interrogate-reviewers"]) {
    assert.match(report, new RegExp(`> Warning\\. Every seat of \`${panel}\` runs on \`anthropic/one\``));
  }
});

test("check lists a workflow's panels with their seats and any warning", () => {
  const config = mergeConfig([
    layer({ judgment: "anthropic/opus:medium", general: "anthropic/opus:medium", "architect-runners": "anthropic/opus:high openai/gpt:high" }),
  ]);
  const text = renderPanels(config, ["architect-runners", "arena-cross-judge-pool"]);
  assert.match(text, /- `architect-runners` \(configured\): anthropic\/opus at high; openai\/gpt at high\.$/m);
  assert.match(
    text,
    /- `arena-cross-judge-pool` \(unset, so judgment, general\): anthropic\/opus at medium \(judgment\); anthropic\/opus at medium \(general\)\. Warning\. Every seat/,
  );
});
