import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { registerAgents, RUNTIME_AGENT_REGISTER_EVENT } from "../src/agents.ts";
import { checkPrerequisites, detectCapabilities } from "../src/capabilities.ts";
import { generate } from "../src/generate.ts";
import { MODE_ENTRY_TYPE, modeFromEntries, modeInstruction } from "../src/mode.ts";
import { mergeConfig } from "../src/config.ts";
import { ADAPTER_OWNED, MODEL_ROLES, entryFor } from "../src/registry.ts";
import { platformSupport, renderCheck, renderStatus } from "../src/status.ts";
import type { GeneratedAgent, ResolvedSource } from "../src/types.ts";
import { makeTempDir, writePluginFixture } from "./support/fixture.ts";

const SUBAGENT_TOOL = {
  name: "subagent",
  parameters: {
    properties: { agent: {}, task: {}, async: {}, model: {}, workflowScript: {} },
  },
  sourceInfo: { source: "pi-subagents" },
};

const ASK_USER_TOOL = {
  name: "ask_user",
  parameters: { properties: { question: {}, options: {}, context: {} } },
  sourceInfo: { source: "pi-ask-user" },
};

test("both capabilities are detected from the tools that provide them", () => {
  const statuses = detectCapabilities([SUBAGENT_TOOL, ASK_USER_TOOL, { name: "read" }]);
  assert.deepEqual(
    statuses.map((status) => [status.id, status.available, status.provider]),
    [
      ["delegation", true, "pi-subagents"],
      ["structured-question", true, "pi-ask-user"],
    ],
  );
});

test("a missing provider recommends a concrete install command", () => {
  const statuses = detectCapabilities([{ name: "read" }]);
  assert.equal(statuses.every((status) => !status.available), true);
  assert.match(statuses[0]?.recommendation ?? "", /pi install npm:pi-subagents/);
  assert.match(statuses[1]?.recommendation ?? "", /pi install npm:pi-ask-user/);
});

test("a delegation tool that cannot select a model or run in the background does not satisfy the capability", () => {
  const weak = { name: "subagent", parameters: { properties: { agent: {}, task: {} } } };
  const statuses = detectCapabilities([weak]);
  assert.equal(statuses[0]?.available, false);
  assert.match(statuses[0]?.recommendation ?? "", /does not accept async, model/);
});

test("a prerequisite check names the missing capability and the missing executable", () => {
  const statuses = detectCapabilities([ASK_USER_TOOL]);
  const report = checkPrerequisites(["delegation"], statuses, ["gh"], (name) => name !== "gh");

  assert.equal(report.ok, false);
  assert.equal(report.lines.length, 2);
  assert.match(report.lines[0] ?? "", /Missing capability `delegation`/);
  assert.match(report.lines[1] ?? "", /Missing executable `gh` on PATH/);
});

test("a satisfied workflow reports nothing to fix", () => {
  const statuses = detectCapabilities([SUBAGENT_TOOL, ASK_USER_TOOL]);
  const report = checkPrerequisites(["delegation", "structured-question"], statuses, ["git"], () => true);
  assert.deepEqual(report, { ok: true, lines: [] });
});

test("agents register with the installed delegation provider under the namespace", () => {
  const registered: string[] = [];
  const bus = {
    emit(event: string, payload: unknown) {
      assert.equal(event, RUNTIME_AGENT_REGISTER_EVENT);
      const request = payload as { name: string; definition: { description: string; systemPrompt: string }; result?: unknown };
      registered.push(request.name);
      (request as { result: unknown }).result = { ok: true, registration: { dispose() {} } };
    },
  };
  const agents: GeneratedAgent[] = [
    {
      upstreamName: "poteto-agent",
      generatedName: "pistack-poteto-agent",
      displayName: "poteto-agent",
      description: "Routing target for poteto mode.",
      systemPrompt: "You are poteto.",
    },
  ];

  const result = registerAgents(bus, agents, "pistack");
  assert.deepEqual(registered, ["pistack-poteto-agent"]);
  assert.equal(result.registrations.length, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("agent conversion keeps the upstream display name in the description", () => {
  let seen: { description: string; systemPrompt: string } | undefined;
  const bus = {
    emit(_event: string, payload: unknown) {
      const request = payload as { definition: { description: string; systemPrompt: string }; result?: unknown };
      seen = request.definition;
      (request as { result: unknown }).result = { ok: true, registration: { dispose() {} } };
    },
  };
  registerAgents(
    bus,
    [
      {
        upstreamName: "comment-sicko",
        generatedName: "pistack-comment-sicko",
        displayName: "Comment Sicko",
        description: "A deranged comment-hater.",
        systemPrompt: "I hate comments.",
      },
    ],
    "pistack",
  );
  assert.equal(seen?.description, "Comment Sicko. A deranged comment-hater.");
  assert.equal(seen?.systemPrompt, "I hate comments.");
});

test("no delegation provider produces an actionable diagnostic instead of a silent drop", () => {
  const bus = { emit() {} };
  const result = registerAgents(
    bus,
    [
      {
        upstreamName: "poteto-agent",
        generatedName: "pistack-poteto-agent",
        displayName: "poteto-agent",
        description: "d",
        systemPrompt: "p",
      },
    ],
    "pistack",
  );
  assert.equal(result.registrations.length, 0);
  assert.equal(result.diagnostics[0]?.level, "warning");
  assert.match(result.diagnostics[0]?.action ?? "", /pi install npm:pi-subagents/);
});

test("Poteto Mode follows the last toggle recorded on the branch", () => {
  assert.equal(modeFromEntries([]), false);
  assert.equal(modeFromEntries([{ type: "custom", customType: MODE_ENTRY_TYPE, data: { active: true } }]), true);
  assert.equal(
    modeFromEntries([
      { type: "custom", customType: MODE_ENTRY_TYPE, data: { active: true } },
      { type: "custom", customType: MODE_ENTRY_TYPE, data: { active: false } },
    ]),
    false,
  );
});

test("unrelated session entries never change the mode", () => {
  assert.equal(
    modeFromEntries([
      { type: "message", customType: "other", data: { active: true } },
      { type: "custom", customType: "someone-else", data: { active: true } },
      null,
      "junk",
    ]),
    false,
  );
});

test("the mode instruction points at the generated skill and keeps host precedence", () => {
  const instruction = modeInstruction("pistack", "/cache/skills/pistack-poteto-mode/SKILL.md");
  assert.match(instruction, /<pistack-poteto-mode>/);
  assert.match(instruction, /\/cache\/skills\/pistack-poteto-mode\/SKILL\.md/);
  assert.match(instruction, /Pi policy and the user's explicit instructions still override/);
  assert.match(instruction, /\/pistack-mode off/);
});

test("an adapter-owned skill reports its own registry entry, not the unknown fallback", () => {
  const output = renderCheck(
    {
      upstreamName: ADAPTER_OWNED,
      generatedName: "pistack-status",
      tier: "native",
      capabilities: [],
      executables: [],
      path: "/cache/skills/pistack-status",
    },
    entryFor(ADAPTER_OWNED, "status"),
    { ok: true, lines: [] },
  );
  assert.equal(output.includes("not in the adapter compatibility registry"), false);
  assert.match(output, /Prerequisites satisfied/);
});

test("an unsupported workflow never gets a start-the-workflow verdict", () => {
  const output = renderCheck(
    {
      upstreamName: "make-bot-ui",
      generatedName: "pistack-make-bot-ui",
      tier: "unsupported",
      capabilities: [],
      executables: ["curl"],
      path: "/cache/skills/pistack-make-bot-ui",
    },
    { tier: "unsupported", capabilities: [], executables: ["curl"], note: "Built on Cursor Automations." },
    { ok: true, lines: [] },
  );

  assert.equal(output.includes("Start the workflow"), false);
  assert.match(output, /cannot reach its purpose here/);
  assert.match(output, /Built on Cursor Automations\./);
});

test("a blocked workflow lists every unmet prerequisite and is not cleared", () => {
  const output = renderCheck(
    {
      upstreamName: "arena",
      generatedName: "pistack-arena",
      tier: "dependency-gated",
      capabilities: ["delegation"],
      executables: ["git"],
      path: "/cache/skills/pistack-arena",
    },
    { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"] },
    { ok: false, lines: ["Missing capability `delegation`.", "Missing executable `git` on PATH."] },
  );

  assert.match(output, /Do not start this workflow yet\./);
  assert.match(output, /- Missing capability `delegation`\./);
  assert.match(output, /- Missing executable `git` on PATH\./);
  assert.equal(output.includes("Prerequisites satisfied"), false);
});

test("a satisfied dependency-gated workflow is cleared to start", () => {
  const output = renderCheck(
    {
      upstreamName: "arena",
      generatedName: "pistack-arena",
      tier: "dependency-gated",
      capabilities: ["delegation"],
      executables: ["git"],
      path: "/cache/skills/pistack-arena",
    },
    { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"] },
    { ok: true, lines: [] },
  );
  assert.match(output, /Prerequisites satisfied\. Start the workflow\./);
});

test("Linux and macOS are supported, everything else is experimental", () => {
  assert.equal(platformSupport("linux"), "supported");
  assert.equal(platformSupport("darwin"), "supported");
  assert.equal(platformSupport("win32"), "experimental");
});

test("the status report names both versions, the resolved commit, the tiers, and the capabilities", () => {
  const root = makeTempDir("status");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "unslop", body: "b\n" }, { name: "arena", body: "b\n" }],
    version: "0.15.2",
  });
  const commit = "d".repeat(40);
  const source: ResolvedSource = {
    selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
    trust: "untested-repo",
    commit,
    checkoutDir: root,
    pluginDir,
  };
  const generation = generate({
    source,
    namespace: "pistack",
    cacheRoot: join(root, "cache"),
    adapterVersion: "0.1.0",
    force: true,
  });

  const report = renderStatus({
    adapterVersion: "0.1.0",
    config: mergeConfig([{ label: "global", values: { repo: "https://example.test/plugins", pinnedCommit: commit } } as never]),
    source,
    upstreamVersion: "0.15.2",
    generation,
    capabilities: detectCapabilities([ASK_USER_TOOL]),
    platform: "supported",
    platformName: "linux",
    modeActive: true,
    cacheRoot: join(root, "cache"),
    bootstrapped: false,
  });

  assert.match(report, /\| adapter version \| 0\.1\.0 \|/);
  assert.match(report, /\| upstream pstack version \| 0\.15\.2 \|/);
  assert.match(report, new RegExp(`\\| resolved commit \\| ${commit} \\|`));
  assert.match(report, /\| certified commit \| 6ed0f7a9504f577d7529064103cecce9be7dfc5e \|/);
  assert.match(report, /\| Poteto Mode \| active \|/);
  assert.match(report, /\| cache state \| reused, no network needed \|/);
  assert.match(report, /outside the tested trust boundary/);
  assert.match(report, /\| delegation \| missing \|/);
  assert.match(report, /\| structured-question \| available \|/);
  assert.match(report, /\| dependency-gated \| 1 \| pistack-arena \|/);
  assert.match(report, /\| native \| 2 \| pistack-status, pistack-unslop \|/);
});

test("the status report shows every model role, configured or inherited", () => {
  const root = makeTempDir("roles");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const source: ResolvedSource = {
    selection: { kind: "local", path: root },
    trust: "local",
    commit: "",
    checkoutDir: root,
    pluginDir,
  };
  const report = renderStatus({
    adapterVersion: "0.1.0",
    config: mergeConfig([
      { label: "global", values: { localPath: root, models: { feature: "anthropic/one", custom: "openai/two" } } } as never,
    ]),
    source,
    upstreamVersion: "0.15.2",
    generation: generate({ source, namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "0.1.0", force: true }),
    capabilities: detectCapabilities([]),
    platform: "supported",
    platformName: "linux",
    modeActive: false,
    cacheRoot: join(root, "cache"),
    bootstrapped: false,
  });

  assert.match(report, /\| feature \| anthropic\/one \|/);
  assert.match(report, /\| custom \| openai\/two \|/);
  for (const role of MODEL_ROLES.filter((name) => name !== "feature")) {
    assert.match(report, new RegExp(`\\| ${role} \\| inherit \\(parent session model\\) \\|`));
  }
});

test("an experimental platform is warned about rather than claimed as supported", () => {
  const root = makeTempDir("winstatus");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const source: ResolvedSource = {
    selection: { kind: "local", path: root },
    trust: "local",
    commit: "",
    checkoutDir: root,
    pluginDir,
  };
  const report = renderStatus({
    adapterVersion: "0.1.0",
    config: mergeConfig([{ label: "global", values: { localPath: root } } as never]),
    source,
    upstreamVersion: "0.15.2",
    generation: generate({ source, namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "0.1.0", force: true }),
    capabilities: detectCapabilities([]),
    platform: "experimental",
    platformName: "win32",
    modeActive: false,
    cacheRoot: join(root, "cache"),
    bootstrapped: true,
  });

  assert.match(report, /win32 is experimental for this release/);
  assert.match(report, /Nothing here claims Windows support/);
  assert.match(report, /\| resolved commit \| \(not a git checkout\) \|/);
  assert.match(report, /\| cache state \| downloaded this session \|/);
});
