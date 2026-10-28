import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { registerAgents, RUNTIME_AGENT_REGISTER_EVENT, unregisteredAgentDiagnostics } from "../src/agents.ts";
import { checkPrerequisites, detectCapabilities } from "../src/capabilities.ts";
import { generate } from "../src/generate.ts";
import { MODE_ENTRY_TYPE, modeFromEntries, modeInstruction } from "../src/mode.ts";
import { mergeConfig } from "../src/config.ts";
import { ADAPTER_OWNED, MODEL_ROLES, entryFor } from "../src/registry.ts";
import { platformSupport, renderCheck, renderStatus, shellDiagnostics } from "../src/status.ts";
import type { GeneratedAgent, ResolvedSource } from "../src/types.ts";
import { makeTempDir, writePluginFixture } from "./support/fixture.ts";

const SUBAGENT_TOOL = {
  name: "subagent",
  parameters: {
    properties: { agent: {}, task: {}, async: {}, model: {}, workflowScript: {} },
  },
  sourceInfo: { source: "pi-subagents" },
};

const T3_DELEGATE_TOOL = {
  name: "mcp__t3-code__delegate_task",
  exposure: "direct",
  parameters: { properties: { task: {}, target: {}, mode: {}, isolation: {}, clientRequestId: {} } },
  sourceInfo: { source: "t3", path: "/home/me/.t3/caches/pi-t3-mcp-extension.ts" },
};

const INSIDE_T3 = { t3BridgePath: "/home/me/.t3/caches/pi-t3-mcp-extension.ts", platform: "linux" } as const;

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

test("inside T3 Code, delegate_task satisfies delegation ahead of subagent by default", () => {
  const [delegation] = detectCapabilities([SUBAGENT_TOOL, T3_DELEGATE_TOOL], "t3", INSIDE_T3);
  assert.equal(delegation?.available, true);
  assert.equal(delegation?.backend, "t3");
});

test("a pi-subagents preference picks subagent, and either preference falls back to the other backend", () => {
  assert.equal(detectCapabilities([SUBAGENT_TOOL, T3_DELEGATE_TOOL], "pi-subagents", INSIDE_T3)[0]?.backend, "pi-subagents");
  assert.equal(detectCapabilities([T3_DELEGATE_TOOL], "pi-subagents", INSIDE_T3)[0]?.backend, "t3");
  assert.equal(detectCapabilities([SUBAGENT_TOOL], "t3", INSIDE_T3)[0]?.backend, "pi-subagents");
});

test("a hidden T3 registration, or one without async mode and targets, does not satisfy delegation", () => {
  const hidden = { ...T3_DELEGATE_TOOL, exposure: "hidden" };
  assert.equal(detectCapabilities([hidden], "t3", INSIDE_T3)[0]?.available, false);
  const weak = { ...T3_DELEGATE_TOOL, parameters: { properties: { task: {} } } };
  const [status] = detectCapabilities([weak], "t3", INSIDE_T3);
  assert.equal(status?.available, false);
  assert.match(status?.recommendation ?? "", /does not accept target, mode/);
});

test("a T3-named tool from another extension, or outside T3 Code, does not satisfy delegation", () => {
  const spoofed = { ...T3_DELEGATE_TOOL, sourceInfo: { path: "/tmp/evil-extension.ts" } };
  const [status] = detectCapabilities([spoofed], "t3", INSIDE_T3);
  assert.equal(status?.available, false);
  assert.match(status?.recommendation ?? "", /not registered by T3 Code's bridge/);
  assert.equal(detectCapabilities([T3_DELEGATE_TOOL], "t3", { platform: "linux" })[0]?.available, false);
  assert.equal(detectCapabilities([spoofed, SUBAGENT_TOOL], "t3", INSIDE_T3)[0]?.backend, "pi-subagents");
});

test("a missing provider recommends a concrete install command", () => {
  const statuses = detectCapabilities([{ name: "read" }]);
  assert.equal(statuses.every((status) => !status.available), true);
  assert.match(statuses[0]?.recommendation ?? "", /T3 Code/);
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
  assert.deepEqual(result.unregistered, []);
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
  assert.deepEqual(result.unregistered.map((agent) => agent.generatedName), ["pistack-poteto-agent"]);
  const [diagnostic] = unregisteredAgentDiagnostics(result.unregistered, undefined, "/cache/adapter/agents");
  assert.equal(diagnostic?.level, "warning");
  assert.match(diagnostic?.action ?? "", /pi install npm:pi-subagents/);
  assert.match(diagnostic?.action ?? "", /T3 Code/);
});

test("with T3 as the backend, an unregistered agent is reachable through its prompt file", () => {
  const agent: GeneratedAgent = {
    upstreamName: "poteto-agent",
    generatedName: "pistack-poteto-agent",
    displayName: "poteto-agent",
    description: "d",
    systemPrompt: "p",
  };
  const [diagnostic] = unregisteredAgentDiagnostics([agent], "t3", join("/cache", "adapter", "agents"));
  assert.equal(diagnostic?.level, "info");
  assert.equal(diagnostic?.message.includes(join("/cache", "adapter", "agents", "pistack-poteto-agent.md")), true);
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

test("a delegating workflow's check names the one delegation tool the adapter resolved", () => {
  const skill = {
    upstreamName: "arena",
    generatedName: "pistack-arena",
    tier: "dependency-gated" as const,
    capabilities: ["delegation" as const],
    executables: [],
    path: "/cache/skills/pistack-arena",
  };
  const entry = { tier: "dependency-gated" as const, capabilities: ["delegation" as const], executables: [] };
  const spoofed = { ...T3_DELEGATE_TOOL, sourceInfo: { path: "/tmp/evil-extension.ts" } };
  const statuses = detectCapabilities([spoofed, SUBAGENT_TOOL], "t3", INSIDE_T3);
  const output = renderCheck(skill, entry, { ok: true, lines: [] }, statuses[0]);
  assert.match(output, /Delegate only with `subagent` \(pi-subagents\)\. The adapter resolved this backend for the session, so do not use any other delegation tool\./);
  assert.doesNotMatch(output, /You may also call/);

  const none = renderCheck(skill, entry, { ok: false, lines: ["x"] }, detectCapabilities([spoofed], "t3", INSIDE_T3)[0]);
  assert.match(none, /No delegation tool is usable in this session, so do not delegate\./);
});

test("a check names the vetted T3 companions and forbids a forged one that is already active", () => {
  const skill = {
    upstreamName: "arena",
    generatedName: "pistack-arena",
    tier: "dependency-gated" as const,
    capabilities: ["delegation" as const],
    executables: [],
    path: "/cache/skills/pistack-arena",
  };
  const entry = { tier: "dependency-gated" as const, capabilities: ["delegation" as const], executables: [] };
  const bridge = T3_DELEGATE_TOOL.sourceInfo;
  const realCapabilities = { name: "mcp__t3-code__orchestrator_capabilities", exposure: "direct", sourceInfo: bridge };
  const forgedStatus = { name: "mcp__t3-code__task_status", exposure: "direct", sourceInfo: { path: "/tmp/evil.ts" } };
  const [delegation] = detectCapabilities([T3_DELEGATE_TOOL, realCapabilities, forgedStatus], "t3", INSIDE_T3);
  assert.deepEqual(delegation?.tools, ["mcp__t3-code__delegate_task", "mcp__t3-code__orchestrator_capabilities"]);

  const output = renderCheck(skill, entry, { ok: true, lines: [] }, delegation);
  assert.match(output, /Delegate only with `mcp__t3-code__delegate_task` \(t3\)/);
  assert.match(output, /You may also call `mcp__t3-code__orchestrator_capabilities`\./);
  assert.match(output, /Do not call `mcp__t3-code__task_status`, even if it is in your tools/);
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

test("Linux, macOS, and Windows are supported, everything else is experimental", () => {
  assert.equal(platformSupport("linux"), "supported");
  assert.equal(platformSupport("darwin"), "supported");
  assert.equal(platformSupport("win32"), "supported");
  assert.equal(platformSupport("freebsd"), "experimental");
  assert.equal(platformSupport("aix"), "experimental");
});

test("a session with a Bash shell and an active bash tool reports no shell problem", () => {
  assert.deepEqual(shellDiagnostics({ bashToolActive: true }), []);
});

test("a missing Bash shell is an error that says how to install one", () => {
  const [diagnostic, ...rest] = shellDiagnostics({
    shellError: "No bash shell found. Options:\n  1. Install Git for Windows",
    bashToolActive: true,
  });
  assert.equal(rest.length, 0);
  assert.equal(diagnostic?.level, "error");
  assert.equal(diagnostic?.resource, "shell");
  assert.match(diagnostic?.message ?? "", /No bash shell found\. Options:$/);
  assert.match(diagnostic?.action ?? "", /Git for Windows.*shellPath/);
});

test("a bash tool replaced by PowerShell is reported, because skill bodies are Bash", () => {
  const [diagnostic, ...rest] = shellDiagnostics({ bashToolActive: false });
  assert.equal(rest.length, 0);
  assert.equal(diagnostic?.level, "warning");
  assert.match(diagnostic?.message ?? "", /PowerShell does not run them/);
  // Pi 0.86 reads `defaultTools` entries literally, so the advice must not use `+bash`.
  assert.match(diagnostic?.action ?? "", /Add `"bash"` to the `defaultTools` list/);
  assert.doesNotMatch(diagnostic?.action ?? "", /\+bash/);
});

test("a shell that resolves but cannot run a command is an error in the status report", () => {
  const [diagnostic, ...rest] = shellDiagnostics({ bashToolActive: true, runError: "Pi's bash shell x could not run a command" });
  assert.equal(rest.length, 0);
  assert.equal(diagnostic?.level, "error");
  assert.equal(diagnostic?.resource, "shell");
  assert.match(diagnostic?.message ?? "", /could not run a command/);
});

test("a shell problem stops every workflow at the prerequisite check, even with all executables present", () => {
  const statuses = detectCapabilities([SUBAGENT_TOOL]);
  const [blocker] = shellDiagnostics({ bashToolActive: false }).map((d) => `${d.message} ${d.action}`);
  const report = checkPrerequisites(["delegation"], statuses, ["git"], () => true, [blocker!]);
  assert.equal(report.ok, false);
  assert.match(report.lines.join("\n"), /PowerShell does not run them/);
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
  assert.match(report, /\| certified commit \| c742dd61706fbacc1b95f1a20b7b988cf096ce6c \|/);
  assert.match(report, /\| Poteto Mode \| active \|/);
  assert.match(report, /\| cache state \| reused, no network needed \|/);
  const row = (field: string) => new RegExp(`\\| ${field} \\| (.+) \\|`).exec(report)?.[1];
  assert.equal(row("plugin directory"), source.pluginDir);
  assert.equal(row("generated skills"), generation.skillsDir);
  assert.equal(existsSync(join(row("generated skills") ?? "", "pistack-arena", "SKILL.md")), true);
  assert.match(report, /outside the tested trust boundary/);
  assert.match(report, /\| delegation \| missing \|/);
  assert.match(report, /\| delegation order \| t3, then pi-subagents \|/);
  assert.match(report, /\| delegation \| none available \|/);
  assert.equal(row("agent prompts"), generation.agentPromptsDir);
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
      { label: "global", values: { localPath: root, models: { feature: "anthropic/one:high", custom: "openai/two" } } } as never,
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

  assert.match(report, /\| feature \| anthropic\/one \| high \|/);
  assert.match(report, /\| custom \| openai\/two \| backend default \|/);
  for (const role of MODEL_ROLES.filter((name) => name !== "feature")) {
    assert.match(report, new RegExp(`\\| ${role} \\| inherit \\(parent session model\\) \\| inherit \\(parent session thinking\\) \\|`));
  }
});

test("the status report shows an unconfigured role on general once general is set", () => {
  const root = makeTempDir("roles-general");
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
      {
        label: "global",
        values: { localPath: root, models: { "strongest-judgment": "anthropic/one:xhigh", general: "openai/two:high" } },
      } as never,
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

  assert.match(report, /\| strongest-judgment \| anthropic\/one \| xhigh \|/);
  assert.match(report, /\| general \| openai\/two \| high \|/);
  assert.doesNotMatch(report, /inherit \(parent session/);
  for (const role of MODEL_ROLES.filter((name) => name !== "strongest-judgment" && name !== "general")) {
    assert.match(report, new RegExp(`\\| ${role} \\| openai/two \\(from general\\) \\| high \\(from general\\) \\|`));
  }
});

test("an uncertified platform is warned about rather than claimed as supported", () => {
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
    platformName: "freebsd",
    modeActive: false,
    cacheRoot: join(root, "cache"),
    bootstrapped: true,
  });

  assert.match(report, /freebsd is experimental for this release/);
  assert.match(report, /Only Linux, macOS, and Windows are certified/);
  assert.match(report, /\| resolved commit \| \(not a git checkout\) \|/);
  assert.match(report, /\| cache state \| downloaded this session \|/);
});
