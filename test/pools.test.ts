import assert from "node:assert/strict";
import { test } from "node:test";
import { type ConfigLayer, environmentLayer, mergeConfig, planPoolAssignment } from "../src/config.ts";
import {
  FILTER_ENTRY_TYPE,
  activeFilter,
  describeOrigin,
  filterPatternProblem,
  modelAllowed,
  parseModelFilter,
  sessionFilterFromEntries,
} from "../src/filter.ts";
import { resolvePanel, resolveRole } from "../src/pools.ts";
import { panelWarning, renderModelPolicy, renderPanels } from "../src/status.ts";

const layer = (values: Record<string, unknown>, label = "global"): ConfigLayer => ({ label, values: values as never });
const available = [
  { id: "cliproxyapi/claude-opus-5-5", reasoning: true },
  { id: "cliproxyapi/gpt-6.1-sol", reasoning: true },
  { id: "cliproxyapi/kimi-k3", reasoning: true },
  { id: "plain/model", reasoning: false },
];
const POOL = ["cliproxyapi/claude-opus-5-5", "cliproxyapi/gpt-6.1-sol", "cliproxyapi/kimi-k3"];
const NO_CLAUDE = { exclude: ["claude-*"] };
const GPT_ONLY = { include: ["gpt-*"] };

test("an ordinary role takes a pool list, and a string role reads as before", () => {
  const config = mergeConfig([layer({ models: { feature: POOL, judgment: "cliproxyapi/gpt-6.1-sol:high" } })]);
  assert.deepEqual(config.models.feature, POOL);
  assert.equal(config.models.judgment, "cliproxyapi/gpt-6.1-sol:high");
});

test("a malformed pool is refused with the layer and role, and a panel keeps its string format", () => {
  assert.throws(() => mergeConfig([layer({ models: { feature: [] } })]), /global: role "feature"\. Invalid pool/);
  assert.throws(() => mergeConfig([layer({ models: { feature: ["a/b", "inherit"] } })]), /Invalid pool/);
  assert.throws(() => mergeConfig([layer({ models: { feature: ["a/b", "c/d e"] } })]), /Invalid pool/);
  assert.throws(() => mergeConfig([layer({ models: { feature: ["a/b", 5] } })]), /Invalid pool/);
  assert.throws(() => mergeConfig([layer({ models: { feature: Array(9).fill("a/b") } })]), /Invalid pool/);
  assert.throws(() => mergeConfig([layer({ models: { "arena-runners": ["a/b", "c/d"] } })]), /Invalid panel value/);
});

test("PISTACK_MODELS separates a pool with `|` and leaves panels space-separated", () => {
  const env = environmentLayer({ PISTACK_MODELS: "feature=a/x:high|b/y,arena-runners=a/x b/y" });
  assert.deepEqual(env.values.models, { feature: ["a/x:high", "b/y"], "arena-runners": "a/x b/y" });
  assert.throws(() => environmentLayer({ PISTACK_MODELS: "feature=a/x|inherit" }), /PISTACK_MODELS: Role "feature"\. Invalid pool/);
});

test("set_model validates every pool entry, keeps each entry's own level, and rejects the whole pool on one bad entry", () => {
  assert.deepEqual(planPoolAssignment(["cliproxyapi/claude-opus-5-5:max", "cliproxyapi/gpt-6.1-sol"], "high", available), {
    kind: "assign",
    value: ["cliproxyapi/claude-opus-5-5:max", "cliproxyapi/gpt-6.1-sol:high"],
  });
  assert.deepEqual(planPoolAssignment(["cliproxyapi/kimi-k3"], undefined, available), { kind: "assign", value: "cliproxyapi/kimi-k3" });
  const unknown = planPoolAssignment(["cliproxyapi/gpt-6.1-sol", "missing/model"], undefined, available);
  assert.equal(unknown.kind, "rejected");
  assert.match(unknown.kind === "rejected" ? unknown.message : "", /^Entry `missing\/model`: No model/);
  assert.equal(planPoolAssignment([], undefined, available).kind, "rejected");
  assert.equal(planPoolAssignment(["inherit", "cliproxyapi/kimi-k3"], undefined, available).kind, "rejected");
  assert.equal(planPoolAssignment(["plain/model"], "high", available).kind, "rejected");
  assert.equal(planPoolAssignment(["cliproxyapi/kimi-k3"], "turbo", available).kind, "rejected");
});

test("a filter pattern is ASCII with `*` as its only wildcard", () => {
  assert.equal(filterPatternProblem("gpt-*"), undefined);
  assert.equal(filterPatternProblem("cliproxyapi/*"), undefined);
  for (const bad of ["", "gpt?", "[ab]", "a b", "gpt\u2028", "x".repeat(129), 5]) {
    assert.notEqual(filterPatternProblem(bad), undefined, String(bad));
  }
  assert.equal("problem" in parseModelFilter({ include: ["ok"], other: [] }), true);
  assert.equal("problem" in parseModelFilter({ include: "gpt-*" }), true);
});

test("a pattern with `/` matches provider/model, one without matches the model id, and thinking is ignored", () => {
  assert.equal(modelAllowed(GPT_ONLY, "cliproxyapi/gpt-6.1-sol:high"), true);
  assert.equal(modelAllowed(GPT_ONLY, "cliproxyapi/kimi-k3"), false);
  assert.equal(modelAllowed({ include: ["cliproxyapi/*"] }, "other/gpt-6.1-sol"), false);
  assert.equal(modelAllowed({ include: ["gpt-*", "kimi-*"] }, "cliproxyapi/kimi-k3"), true);
  assert.equal(modelAllowed({ include: ["*"], exclude: ["CLAUDE-*"] }, "cliproxyapi/claude-opus-5-5"), false);
  // A bare pattern sees only the id after the provider, so a provider name cannot satisfy it.
  assert.equal(modelAllowed({ include: ["cliproxyapi*"] }, "cliproxyapi/gpt-6.1-sol"), false);
  assert.equal(modelAllowed({ include: [], exclude: [] }, "x/anything"), true);
  assert.equal(modelAllowed(undefined, "x/anything"), true);
});

test("wildcards match repeated and separated stars without regex backtracking", () => {
  const model = "cliproxyapi/claude-opus-5-5";
  assert.equal(modelAllowed({ exclude: ["*".repeat(127) + "x"] }, model), true);
  assert.equal(modelAllowed({ exclude: ["*".repeat(127) + "5"] }, model), false);
  assert.equal(modelAllowed({ include: ["*c*l*a*u*d*e*x"] }, model), false);
  assert.equal(modelAllowed({ include: ["*c*l*a*u*d*e*5"] }, model), true);
  assert.equal(modelAllowed({ exclude: ["*claude*"] }, "bedrock/us.anthropic.claude-opus-5-5"), false);
});

test("a later config layer replaces the saved filter whole, and a bad filter names its layer", () => {
  const config = mergeConfig([layer({ modelFilter: { include: ["gpt-*"], exclude: ["x"] } }, "user"), layer({ modelFilter: { exclude: ["claude-*"] } }, "project")]);
  assert.deepEqual(config.modelFilter, { filter: { exclude: ["claude-*"] }, source: "project" });
  assert.equal(mergeConfig([]).modelFilter, undefined);
  assert.throws(() => mergeConfig([layer({ modelFilter: { include: ["a b"] } }, "project")]), /^Error: project: `modelFilter.include`/);
});

test("the session filter is the last one recorded on the branch, and a clear returns to the saved one", () => {
  const entry = (data: unknown) => ({ type: "custom", customType: FILTER_ENTRY_TYPE, data });
  assert.deepEqual(sessionFilterFromEntries([entry({ filter: NO_CLAUDE }), entry({ filter: GPT_ONLY })]), GPT_ONLY);
  assert.equal(sessionFilterFromEntries([entry({ filter: GPT_ONLY }), entry({ cleared: true })]), undefined);
  assert.equal(sessionFilterFromEntries([entry({ filter: { include: ["a b"] } }), { type: "custom", customType: "other", data: { filter: GPT_ONLY } }]), undefined);

  const saved = { filter: GPT_ONLY, source: "/u/pi-pstack-adapter.json" };
  assert.match(describeOrigin(activeFilter(NO_CLAUDE, saved)), /^include none; exclude `claude-\*` \(this session, overriding the saved filter in \/u\/pi-pstack-adapter\.json\)$/);
  assert.match(describeOrigin(activeFilter({}, saved)), /^unrestricted \(this session/);
  assert.match(describeOrigin(activeFilter(undefined, saved)), /saved in \/u\/pi-pstack-adapter\.json/);
  assert.match(describeOrigin(activeFilter(undefined, undefined)), /^none/);
});

test("a role resolves to its pool, general, or the parent, and a filtered-out pool is blocked instead of falling back", () => {
  const config = mergeConfig([layer({ models: { feature: POOL, general: "cliproxyapi/claude-opus-5-5:high" } })]);
  const feature = resolveRole(config, "feature", { filter: GPT_ONLY, parentModel: "cliproxyapi/gpt-6.1-sol" });
  assert.equal(feature.kind, "pool");
  assert.deepEqual(feature.choices.map((choice) => choice.eligible), [false, true, false]);

  // `bug-fix` is unset, so it uses `general`, whose only model is excluded. It must not reach the parent.
  const bugFix = resolveRole(config, "bug-fix", { filter: NO_CLAUDE, parentModel: "cliproxyapi/gpt-6.1-sol" });
  assert.equal(bugFix.kind, "blocked");
  assert.equal(bugFix.from, "general");

  const allExcluded = resolveRole(config, "feature", { filter: { include: ["grok-*"] }, parentModel: "cliproxyapi/gpt-6.1-sol" });
  assert.equal(allExcluded.kind, "blocked");

  const bare = mergeConfig([]);
  assert.equal(resolveRole(bare, "judgment", {}).kind, "inherit");
  assert.equal(resolveRole(bare, "judgment", { filter: GPT_ONLY, parentModel: "cliproxyapi/gpt-6.1-sol" }).kind, "inherit");
  assert.equal(resolveRole(bare, "judgment", { filter: GPT_ONLY, parentModel: "cliproxyapi/claude-opus-5-5" }).kind, "blocked");
  const unknownParent = resolveRole(bare, "judgment", { filter: GPT_ONLY });
  assert.equal(unknownParent.kind, "blocked");
  assert.match(unknownParent.kind === "blocked" ? unknownParent.reason : "", /parent session's model is unknown/);
});

test("panel seats keep their meaning: an excluded seat is blocked, and a default seat draws one choice from its role's pool", () => {
  const config = mergeConfig([
    layer({ models: { judgment: POOL, general: "cliproxyapi/kimi-k3", "arena-runners": "cliproxyapi/claude-opus-5-5:high cliproxyapi/gpt-6.1-sol inherit" } }),
  ]);
  const context = { filter: NO_CLAUDE, parentModel: "cliproxyapi/claude-opus-5-5" };
  const runners = resolvePanel(config, "arena-runners", context);
  assert.deepEqual(runners.seats.map((seat) => seat.kind), ["blocked", "model", "blocked"]);

  const defaults = resolvePanel(config, "architect-runners", context);
  assert.equal(defaults.seats.length, 2);
  assert.deepEqual(defaults.seats[0], {
    kind: "choice",
    choices: [{ model: "cliproxyapi/gpt-6.1-sol" }, { model: "cliproxyapi/kimi-k3" }],
    from: "judgment",
  });
  assert.deepEqual(defaults.seats[1], { kind: "model", spec: { model: "cliproxyapi/kimi-k3" }, from: "general" });
  const text = renderPanels(config, ["arena-runners", "architect-runners"], context);
  assert.match(text, /BLOCKED, `cliproxyapi\/claude-opus-5-5` is excluded by the model filter/);
  assert.match(text, /ranked cliproxyapi\/gpt-6\.1-sol at backend default, then cliproxyapi\/kimi-k3 at backend default; as `pstack:judgment` it runs once on the first, unless the delegating agent overrides the ranking \(judgment\)/);
  // A seat that may pick another model does not make the panel one-model.
  assert.equal(panelWarning(defaults, config, context), undefined);
});

test("the check report adds nothing without pools, a filter, or blocked roles, and names all three when present", () => {
  const plain = mergeConfig([layer({ models: { feature: "cliproxyapi/kimi-k3" } })]);
  assert.equal(renderModelPolicy(plain, { kind: "none" }, "cliproxyapi/claude-opus-5-5"), undefined);

  const config = mergeConfig([layer({ models: { feature: POOL, judgment: "cliproxyapi/claude-opus-5-5" } })]);
  const policy = renderModelPolicy(config, { kind: "session", filter: NO_CLAUDE }, "cliproxyapi/gpt-6.1-sol") ?? "";
  assert.match(policy, /Model filter: include none; exclude `claude-\*` \(this session\)/);
  assert.match(policy, /Put this line in each brief, verbatim: "Model restriction for this task: use only models allowed by include none; exclude `claude-\*`/);
  assert.match(policy, /`feature` is ranked cliproxyapi\/gpt-6\.1-sol at backend default, then cliproxyapi\/kimi-k3 at backend default; excluded by the model filter: cliproxyapi\/claude-opus-5-5/);
  assert.match(policy, /Delegate a role as `pstack:<role>`, and the adapter runs it on the first eligible model in the role's ranking\. As the delegating agent, you may override the ranking with `pstack:<role>@<provider\/model>`/);
  assert.match(policy, /say which model you picked and why\. A pool is not a retry list and not a panel/);
  assert.match(policy, /Blocked roles: `judgment` \(every model it lists is excluded by the model filter\)/);
  assert.match(policy, /do not move it to `general` or your own model/);
});
