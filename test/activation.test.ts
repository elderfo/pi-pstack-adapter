import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activateDelegation,
  needsDelegation,
  registerDelegationActivation,
  skillFromPrompt,
  skillFromReadPath,
  type ToolLoadout,
} from "../src/activation.ts";
import type { GeneratedSkill } from "../src/types.ts";

const SKILLS_DIR = "/cache/generated/abc/skills";

function skill(generatedName: string, delegates: boolean): GeneratedSkill {
  return {
    upstreamName: generatedName.replace(/^pistack-/, ""),
    generatedName,
    tier: delegates ? "dependency-gated" : "native",
    capabilities: delegates ? ["delegation"] : [],
    executables: [],
    path: join(SKILLS_DIR, generatedName),
  };
}

const SKILLS = [skill("pistack-arena", true), skill("pistack-unslop", false)];

function loadout(registered: readonly string[], active: readonly string[]): ToolLoadout & { active: string[] } {
  const state = {
    active: [...active],
    getAllTools: () => registered.map((name) => ({ name })),
    getActiveTools: () => [...state.active],
    setActiveTools: (names: string[]) => {
      state.active = names;
    },
  };
  return state;
}

test("a slash command names the generated skill it starts, with or without arguments", () => {
  assert.equal(skillFromPrompt("/skill:pistack-arena", SKILLS)?.generatedName, "pistack-arena");
  assert.equal(skillFromPrompt("/skill:pistack-arena compare two designs", SKILLS)?.generatedName, "pistack-arena");
});

test("a newline does not end the skill name, because Pi's expansion splits on the first space", () => {
  assert.equal(skillFromPrompt("/skill:pistack-arena\nsecond line", SKILLS), undefined);
});

test("a prompt that only mentions or prefixes a skill starts nothing", () => {
  assert.equal(skillFromPrompt("please run /skill:pistack-arena", SKILLS), undefined);
  assert.equal(skillFromPrompt("/skill:pistack-arenas", SKILLS), undefined);
  assert.equal(skillFromPrompt("/skill:other-arena", SKILLS), undefined);
});

test("a read of a generated SKILL.md resolves to its skill from any path form Pi accepts", () => {
  const file = join(SKILLS_DIR, "pistack-arena", "SKILL.md");
  assert.equal(skillFromReadPath(file, "/work", SKILLS)?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath(`@${file}`, "/work", SKILLS)?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath("../cache/generated/abc/skills/pistack-arena/SKILL.md", "/work", SKILLS)?.generatedName, "pistack-arena");

  const home = [skill("pistack-arena", true)].map((entry) => ({ ...entry, path: join(homedir(), "skills", entry.generatedName) }));
  assert.equal(skillFromReadPath("~/skills/pistack-arena/SKILL.md", "/work", home)?.generatedName, "pistack-arena");
});

test("a read of a support file or an unrelated SKILL.md starts nothing", () => {
  assert.equal(skillFromReadPath(join(SKILLS_DIR, "pistack-arena", "references", "judge.md"), "/work", SKILLS), undefined);
  assert.equal(skillFromReadPath("/elsewhere/pistack-arena/SKILL.md", "/work", SKILLS), undefined);
});

test("only skills that require the delegation capability trigger activation", () => {
  assert.deepEqual(SKILLS.filter(needsDelegation).map((entry) => entry.generatedName), ["pistack-arena"]);
});

test("activation adds subagent to the active tools and keeps every other selection", () => {
  const tools = loadout(["read", "subagent", "subagents_enable"], ["read", "subagents_enable"]);
  assert.deepEqual(activateDelegation(tools), { kind: "activated" });
  assert.deepEqual(tools.active, ["read", "subagents_enable", "subagent"]);
});

test("activation is idempotent once subagent is active", () => {
  const tools = loadout(["read", "subagent"], ["read", "subagent"]);
  assert.deepEqual(activateDelegation(tools), { kind: "already-active" });
  assert.deepEqual(tools.active, ["read", "subagent"]);
});

test("activation reports a missing provider instead of selecting an unregistered tool", () => {
  const tools = loadout(["read"], ["read"]);
  assert.deepEqual(activateDelegation(tools), { kind: "unavailable" });
  assert.deepEqual(tools.active, ["read"]);
});

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => Promise<unknown>;

function host(options: { modeActive?: boolean; subagentInstalled?: boolean } = {}) {
  const tools = loadout(
    options.subagentInstalled === false ? ["read", "bash"] : ["read", "bash", "subagent", "subagents_enable"],
    ["read", "bash", "subagents_enable"],
  );
  const handlers = new Map<string, Handler>();
  const pi = { ...tools, on: (event: string, handler: Handler) => handlers.set(event, handler) };
  // Spreading copies the fake's methods, so read the live selection through the copy.
  pi.getActiveTools = () => [...pi.active];
  pi.setActiveTools = (names: string[]) => {
    pi.active = names;
  };
  registerDelegationActivation(pi as never, { skills: () => SKILLS, modeActive: () => options.modeActive ?? false });
  const fire = (event: string, payload: Record<string, unknown>) =>
    (handlers.get(event) as Handler)(payload, { cwd: "/work" });
  return { pi, fire };
}

const ARENA_SKILL_FILE = join(SKILLS_DIR, "pistack-arena", "SKILL.md");
const UNSLOP_SKILL_FILE = join(SKILLS_DIR, "pistack-unslop", "SKILL.md");

test("typing a delegating skill command activates subagent, and a non-delegating one does not", async () => {
  const delegating = host();
  await delegating.fire("input", { type: "input", text: "/skill:pistack-arena two designs", source: "interactive" });
  assert.equal(delegating.pi.active.includes("subagent"), true);

  const inline = host();
  await inline.fire("input", { type: "input", text: "/skill:pistack-unslop", source: "interactive" });
  assert.equal(inline.pi.active.includes("subagent"), false);
});

test("the model reading a delegating SKILL.md activates subagent, and other tools on that path do not", async () => {
  const read = host();
  await read.fire("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: ARENA_SKILL_FILE } });
  assert.equal(read.pi.active.includes("subagent"), true);

  const bash = host();
  await bash.fire("tool_call", { type: "tool_call", toolCallId: "2", toolName: "bash", input: { command: `cat ${ARENA_SKILL_FILE}` } });
  assert.equal(bash.pi.active.includes("subagent"), false);

  const inline = host();
  await inline.fire("tool_call", { type: "tool_call", toolCallId: "3", toolName: "read", input: { path: UNSLOP_SKILL_FILE } });
  assert.equal(inline.pi.active.includes("subagent"), false);
});

test("Poteto Mode activates subagent on input, before Pi copies the tool list for the prompt", async () => {
  const mode = host({ modeActive: true });
  await mode.fire("input", { type: "input", text: "refactor this", source: "interactive" });
  assert.equal(mode.pi.active.includes("subagent"), true);

  const off = host();
  await off.fire("input", { type: "input", text: "refactor this", source: "interactive" });
  await off.fire("before_agent_start", { type: "before_agent_start", prompt: "refactor this" });
  assert.equal(off.pi.active.includes("subagent"), false);
});

test("Poteto Mode also activates subagent at agent start for prompts that skip the input event", async () => {
  const mode = host({ modeActive: true });
  await mode.fire("before_agent_start", { type: "before_agent_start", prompt: "refactor this" });
  assert.equal(mode.pi.active.includes("subagent"), true);
});

test("a delegating skill without an installed provider leaves the selection untouched", async () => {
  const bare = host({ subagentInstalled: false });
  await bare.fire("input", { type: "input", text: "/skill:pistack-arena", source: "interactive" });
  assert.deepEqual(bare.pi.active, ["read", "bash", "subagents_enable"]);
});
