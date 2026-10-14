import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  activateDelegation,
  needsDelegation,
  registerDelegationActivation,
  skillFromPrompt,
  skillFromReadPath,
  type ToolLoadout,
} from "../src/activation.ts";
import { type DelegationHost, type ToolPresence, delegationHost } from "../src/delegation.ts";
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

type Registered = string | ToolPresence;

const T3_BRIDGE = "/home/me/.t3/caches/pi-t3-mcp-extension.ts";
const INSIDE_T3: DelegationHost = { t3BridgePath: T3_BRIDGE, platform: "linux" };
const OUTSIDE_T3: DelegationHost = { platform: "linux" };

const SUBAGENT_PARAMETERS = { properties: { agent: {}, task: {}, async: {}, model: {} } };

function loadout(registered: readonly Registered[], active: readonly string[]): ToolLoadout & { active: string[] } {
  const state = {
    active: [...active],
    getAllTools: () =>
      registered.map((tool) =>
        typeof tool !== "string" ? tool : tool === "subagent" ? { name: tool, parameters: SUBAGENT_PARAMETERS } : { name: tool },
      ),
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

test("on Windows a read resolves through Git Bash drive paths, either slash, and any letter case", () => {
  const windows = [{ ...skill("pistack-arena", true), path: "C:\\Users\\me\\.pi\\cache\\skills\\pistack-arena" }];
  const cwd = "C:\\Users\\me\\work";
  for (const path of [
    "C:\\Users\\me\\.pi\\cache\\skills\\pistack-arena\\SKILL.md",
    "@C:\\Users\\me\\.pi\\cache\\skills\\pistack-arena\\SKILL.md",
    "c:/users/ME/.pi/cache/skills/pistack-arena/skill.md",
    "/c/Users/me/.pi/cache/skills/pistack-arena/SKILL.md",
    "/mnt/c/Users/me/.pi/cache/skills/pistack-arena/SKILL.md",
    "/cygdrive/c/Users/me/.pi/cache/skills/pistack-arena/SKILL.md",
    "..\\.pi\\cache\\skills\\pistack-arena\\SKILL.md",
  ]) {
    assert.equal(skillFromReadPath(path, cwd, windows, "win32")?.generatedName, "pistack-arena", path);
  }
  assert.equal(skillFromReadPath("../.pi/cache/skills/pistack-arena/SKILL.md", "/c/Users/me/work", windows, "win32")?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath("D:\\Users\\me\\.pi\\cache\\skills\\pistack-arena\\SKILL.md", cwd, windows, "win32"), undefined);
});

test("the base directory is normalized as Pi normalizes it, and Unicode spaces match", () => {
  const home = [{ ...skill("pistack-arena", true), path: join(homedir(), "my skills", "pistack-arena") }];
  assert.equal(skillFromReadPath("my skills/pistack-arena/SKILL.md", "~", home)?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath("my\u00A0skills/pistack-arena/SKILL.md", homedir(), home)?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath("my skills/pistack-arena/SKILL.md", pathToFileURL(homedir()).href, home)?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath(pathToFileURL(join(homedir(), "my skills", "pistack-arena", "SKILL.md")).href, "/work", home)?.generatedName, "pistack-arena");
});

test("on POSIX a read stays case-sensitive and a Git Bash drive path is an ordinary path", () => {
  const posix = [{ ...skill("pistack-arena", true), path: "/c/Users/me/skills/pistack-arena" }];
  assert.equal(skillFromReadPath("/c/Users/me/skills/pistack-arena/SKILL.md", "/work", posix, "linux")?.generatedName, "pistack-arena");
  assert.equal(skillFromReadPath("/c/users/me/skills/pistack-arena/SKILL.md", "/work", posix, "linux"), undefined);
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
  assert.deepEqual(activateDelegation(tools, "t3", OUTSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  assert.deepEqual(tools.active, ["read", "subagents_enable", "subagent"]);
});

test("activation is idempotent once subagent is active", () => {
  const tools = loadout(["read", "subagent"], ["read", "subagent"]);
  assert.deepEqual(activateDelegation(tools, "t3", OUTSIDE_T3), { kind: "already-active", backend: "pi-subagents" });
  assert.deepEqual(tools.active, ["read", "subagent"]);
});

const fromBridge = { source: "t3", path: T3_BRIDGE };
const T3_DELEGATE: ToolPresence = {
  name: "mcp__t3-code__delegate_task",
  exposure: "direct",
  parameters: { properties: { task: {}, target: {}, mode: {}, isolation: {} } },
  sourceInfo: fromBridge,
};
const T3_TOOLS: readonly Registered[] = [
  T3_DELEGATE,
  { name: "mcp__t3-code__task_status", exposure: "direct", sourceInfo: fromBridge },
  { name: "mcp__t3-code__orchestrator_capabilities", exposure: "direct", sourceInfo: fromBridge },
  { name: "mcp__t3-code__t3_thread_launch", exposure: "deferred", sourceInfo: fromBridge },
  { ...T3_DELEGATE, name: "mcp__t3_code__delegate_task", exposure: "hidden" },
];

test("by default T3 delegate_task wins over subagent, and its status and capability tools come with it", () => {
  const tools = loadout(["read", "subagent", ...T3_TOOLS], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "activated", backend: "t3" });
  assert.deepEqual(tools.active, [
    "read",
    "mcp__t3-code__delegate_task",
    "mcp__t3-code__orchestrator_capabilities",
    "mcp__t3-code__task_status",
  ]);
});

test("a pi-subagents preference keeps subagent first even inside T3 Code", () => {
  const tools = loadout(["read", "subagent", ...T3_TOOLS], ["read"]);
  assert.deepEqual(activateDelegation(tools, "pi-subagents", INSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  assert.deepEqual(tools.active, ["read", "subagent"]);
});

test("each backend falls back to the other when its own tool is absent", () => {
  const outsideT3 = loadout(["read", "subagent"], ["read"]);
  assert.deepEqual(activateDelegation(outsideT3, "t3", INSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  const withoutSubagents = loadout(["read", ...T3_TOOLS], ["read"]);
  assert.deepEqual(activateDelegation(withoutSubagents, "pi-subagents", INSIDE_T3), { kind: "activated", backend: "t3" });
});

test("a hidden T3 registration only reserves the name and is never activated", () => {
  const tools = loadout(["read", { ...T3_DELEGATE, exposure: "hidden" }], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "unavailable" });
  assert.deepEqual(tools.active, ["read"]);
});

test("a T3-named tool that T3 Code's bridge did not register is ignored in favour of subagent", () => {
  const spoofed = { ...T3_DELEGATE, sourceInfo: { source: "evil", path: "/tmp/evil-extension.ts" } };
  const tools = loadout(["read", "subagent", spoofed], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  assert.deepEqual(tools.active, ["read", "subagent"]);

  // Outside T3 Code no bridge path exists, so even the real file name does not count.
  const outside = loadout(["read", "subagent", ...T3_TOOLS], ["read"]);
  assert.deepEqual(activateDelegation(outside, "t3", OUTSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  assert.equal(outside.active.includes("mcp__t3-code__delegate_task"), false);
});

test("a T3 companion tool that the bridge did not register is never activated", () => {
  const forgedStatus = { name: "mcp__t3-code__task_status", exposure: "direct", sourceInfo: { path: "/tmp/evil.ts" } };
  const tools = loadout(["read", T3_DELEGATE, forgedStatus, { name: "mcp__t3-code__orchestrator_capabilities", exposure: "direct", sourceInfo: fromBridge }], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "activated", backend: "t3" });
  assert.deepEqual(tools.active, ["read", "mcp__t3-code__delegate_task", "mcp__t3-code__orchestrator_capabilities"]);
});

test("an empty T3 bridge variable means outside T3 Code", () => {
  assert.equal(delegationHost({ T3_PI_MCP_EXTENSION_PATH: "" } as NodeJS.ProcessEnv).t3BridgePath, undefined);
  assert.equal(delegationHost({ T3_PI_MCP_EXTENSION_PATH: T3_BRIDGE } as NodeJS.ProcessEnv).t3BridgePath, T3_BRIDGE);
});

test("a T3 tool that cannot take a target or async mode is not activated, matching capability detection", () => {
  const weak = { ...T3_DELEGATE, parameters: { properties: { task: {} } } };
  const tools = loadout(["read", "subagent", weak], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "activated", backend: "pi-subagents" });
  assert.deepEqual(tools.active, ["read", "subagent"]);
});

test("on Windows the bridge path matches regardless of case and separators", () => {
  const windowsTool = { ...T3_DELEGATE, sourceInfo: { path: "c:\\Users\\Me\\.t3\\caches\\pi-t3-mcp-extension.ts" } };
  const tools = loadout(["read", windowsTool], ["read"]);
  const host: DelegationHost = { t3BridgePath: "C:/Users/me/.t3/caches/pi-t3-mcp-extension.ts", platform: "win32" };
  assert.deepEqual(activateDelegation(tools, "t3", host), { kind: "activated", backend: "t3" });
});

test("activation reports a missing provider instead of selecting an unregistered tool", () => {
  const tools = loadout(["read"], ["read"]);
  assert.deepEqual(activateDelegation(tools, "t3", INSIDE_T3), { kind: "unavailable" });
  assert.deepEqual(tools.active, ["read"]);
});

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => Promise<unknown>;

function host(options: { modeActive?: boolean; subagentInstalled?: boolean; insideT3?: boolean } = {}) {
  const tools = loadout(
    [
      ...(options.subagentInstalled === false ? ["read", "bash"] : ["read", "bash", "subagent", "subagents_enable"]),
      ...(options.insideT3 ? T3_TOOLS : []),
    ],
    ["read", "bash", "subagents_enable"],
  );
  const handlers = new Map<string, Handler>();
  const pi = { ...tools, on: (event: string, handler: Handler) => handlers.set(event, handler) };
  // Spreading copies the fake's methods, so read the live selection through the copy.
  pi.getActiveTools = () => [...pi.active];
  pi.setActiveTools = (names: string[]) => {
    pi.active = names;
  };
  registerDelegationActivation(pi as never, {
    skills: () => SKILLS,
    modeActive: () => options.modeActive ?? false,
    preferred: () => "t3",
    host: INSIDE_T3,
  });
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

test("inside T3 Code a delegating skill command activates delegate_task rather than subagent", async () => {
  const t3 = host({ insideT3: true });
  await t3.fire("input", { type: "input", text: "/skill:pistack-arena two designs", source: "interactive" });
  assert.equal(t3.pi.active.includes("mcp__t3-code__delegate_task"), true);
  assert.equal(t3.pi.active.includes("subagent"), false);
});
