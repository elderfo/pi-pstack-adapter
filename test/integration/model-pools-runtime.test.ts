import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeTempDir, writePluginFixture } from "../support/fixture.ts";

/**
 * Drives the real extension entry point through a minimal stand-in for Pi's extension API: config
 * files on disk, the session entries Pi would keep, and the `tool_call` hook Pi runs before a tool.
 */
const root = makeTempDir("model-pools");
const checkout = join(root, "checkout");
mkdirSync(checkout, { recursive: true });
writePluginFixture(checkout, { skills: [{ name: "arena", body: "Run candidates.\n" }] });
const agentDir = join(root, "agent");
const projectDir = join(root, "project");
mkdirSync(projectDir, { recursive: true });

const saved = { ...process.env };
after(() => {
  process.env = saved;
});
for (const key of Object.keys(process.env)) if (key.startsWith("PISTACK_")) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PISTACK_UPSTREAM_PATH = checkout;
process.env.PISTACK_CACHE_DIR = join(root, "cache");

type Handler = (event: unknown, ctx: unknown) => unknown;
interface Tool {
  execute(id: string, params: unknown, signal: undefined, update: undefined, ctx: unknown): Promise<{ content: { text: string }[] }>;
}

const MODELS = ["claude-opus-5-5", "gpt-6.1-sol", "kimi-k3"].map((id) => ({ provider: "cliproxyapi", id, reasoning: true }));

async function host() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, Tool>();
  const branch: unknown[] = [];
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
    registerCommand: () => {},
    sendMessage: () => {},
    appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: () => {},
    events: { emit: () => {}, on: () => {} },
  };
  const ctx = {
    cwd: projectDir,
    hasUI: false,
    ui: { notify: () => {} },
    isProjectTrusted: () => true,
    model: { provider: "cliproxyapi", id: "claude-opus-5-5" },
    modelRegistry: { getAvailable: () => MODELS },
    scopedModels: [],
    sessionManager: { getBranch: () => branch },
  };
  const { default: extension } = await import("../../index.ts");
  extension(pi as never);
  const emit = async (event: string, payload: unknown = {}) => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = (await handler(payload, ctx)) ?? result;
    return result;
  };
  const call = async (params: Record<string, unknown>) =>
    (await (tools.get("pstack_adapter") as Tool).execute("id", params, undefined, undefined, ctx)).content[0]?.text ?? "";
  const delegate = (toolName: string, input: unknown) => emit("tool_call", { toolName, input });
  return { branch, ctx, emit, call, delegate };
}

const T3 = "mcp__t3-code__delegate_task";
const userConfig = () => JSON.parse(readFileSync(join(agentDir, "pi-pstack-adapter.json"), "utf8"));

test("a pool and a session filter work end to end, and saved filters persist without overriding the session", async () => {
  const session = await host();
  await session.emit("session_start", { reason: "startup" });

  const pool = await session.call({
    action: "set_model",
    role: "feature",
    model: ["cliproxyapi/claude-opus-5-5", "cliproxyapi/gpt-6.1-sol:max", "cliproxyapi/kimi-k3"],
    thinking: "high",
  });
  assert.match(pool, /Role `feature` now has a pool of 3 models/);
  assert.deepEqual(userConfig().models.feature, ["cliproxyapi/claude-opus-5-5:high", "cliproxyapi/gpt-6.1-sol:max", "cliproxyapi/kimi-k3:high"]);

  const rejected = await session.call({ action: "set_model", role: "feature", model: ["cliproxyapi/kimi-k3", "missing/model"] });
  assert.match(rejected, /^Entry `missing\/model`/);
  assert.equal(userConfig().models.feature.length, 3, "a rejected pool writes nothing");
  assert.match(await session.call({ action: "set_model", role: "general", model: "cliproxyapi/kimi-k3", scope: "session" }), /Only `set_filter` takes `scope: "session"`/);
  assert.match(await session.call({ action: "set_model", role: "arena-runners", model: ["cliproxyapi/kimi-k3"] }), /takes one string of entries/);

  // Before any filter, omitted models and a status report behave as before.
  assert.equal(await session.delegate(T3, { task: "x" }), undefined);
  const before = await session.call({ action: "status" });
  assert.match(before, /\| model filter \| none, every model is allowed \|/);
  assert.match(before, /\| judgment \| inherit \(parent session model\) \| inherit \(parent session thinking\) \|/);

  assert.match(await session.call({ action: "set_filter", exclude: ["claude-*"] }), /This session's model filter is set/);
  const status = await session.call({ action: "status" });
  assert.match(status, /\| model filter \| include none; exclude `claude-\*` \(this session\) \|/);
  assert.match(status, /\| feature \| pool, pick one of cliproxyapi\/gpt-6\.1-sol at max, cliproxyapi\/kimi-k3 at high; excluded by the model filter: cliproxyapi\/claude-opus-5-5 at high \| per choice \|/);
  // The session runs on Claude, so a role that would inherit it is blocked instead of running there.
  assert.match(status, /\| judgment \| BLOCKED, it inherits, and the parent session's model `cliproxyapi\/claude-opus-5-5` is excluded by the model filter\. Do not delegate this role \| - \|/);

  const check = await session.call({ action: "check", skill: "pistack-arena" });
  assert.match(check, /Put this line in each brief, verbatim/);
  assert.match(check, /Blocked roles: .*`judgment` \(it inherits/);
  assert.match(check, /`arena-runners` \(unset, so judgment, general\): BLOCKED, it inherits/);

  assert.deepEqual(await session.delegate(T3, { task: "x", target: { providerInstanceId: "pi", model: "cliproxyapi/gpt-6.1-sol" } }), undefined);
  const blocked = (await session.delegate(T3, { task: "x", target: { providerInstanceId: "pi", model: "cliproxyapi/claude-opus-5-5" } })) as { block?: boolean; reason?: string };
  assert.equal(blocked.block, true);
  assert.match(blocked.reason ?? "", /which the filter excludes/);
  assert.equal(((await session.delegate(T3, { task: "x" })) as { block?: boolean }).block, true, "an omitted model is the excluded parent model");
  assert.equal(((await session.delegate("subagent", { agent: "delegate", task: "x" })) as { block?: boolean }).block, true);
  assert.equal(await session.delegate("subagent", { action: "status", id: "r1" }), undefined);

  const savedReply = await session.call({ action: "set_filter", include: ["gpt-*"], scope: "user" });
  assert.match(savedReply, /This session's own filter still wins over the saved one/);
  assert.deepEqual(userConfig().modelFilter, { include: ["gpt-*"] });
  assert.deepEqual(await session.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } }), undefined, "the session filter still applies");

  // A fork keeps the branch's session filter; a new session starts with only the saved one.
  const fork = await host();
  fork.branch.push(...session.branch);
  await fork.emit("session_start", { reason: "fork" });
  assert.deepEqual(await fork.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } }), undefined);

  const fresh = await host();
  await fresh.emit("session_start", { reason: "new" });
  assert.match(await fresh.call({ action: "status" }), /\| model filter \| include `gpt-\*`; exclude none \(saved in .*pi-pstack-adapter\.json\) \|/);
  assert.equal(((await fresh.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } })) as { block?: boolean }).block, true);

  // `/tree` back to a point before the session filter, then to a branch that cleared it.
  fresh.branch.push({ type: "custom", customType: "pistack-model-filter", data: { filter: { include: [], exclude: [] } } });
  await fresh.emit("session_tree", {});
  assert.deepEqual(await fresh.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } }), undefined, "an empty session filter is an explicit unrestricted override");
  assert.match(await fresh.call({ action: "set_filter", clear: true }), /cleared/);
  assert.equal(((await fresh.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } })) as { block?: boolean }).block, true);

  assert.match(await fresh.call({ action: "set_filter", clear: true, scope: "user" }), /Removed the saved model filter/);
  assert.equal(userConfig().modelFilter, undefined);
  assert.equal(await fresh.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } }), undefined);
});

test("invalid role assignments do not block unrelated delegation, but a saved filter still applies", async () => {
  const { writeFileSync } = await import("node:fs");
  const path = join(agentDir, "pi-pstack-adapter.json");
  const before = readFileSync(path, "utf8");
  try {
    writeFileSync(path, JSON.stringify({ models: { feature: "not valid" } }), "utf8");
    const unrestricted = await host();
    await unrestricted.emit("session_start", { reason: "startup" });
    assert.equal(await unrestricted.delegate(T3, { task: "x" }), undefined);
    assert.match(await unrestricted.call({ action: "status" }), /did not start/);

    writeFileSync(path, JSON.stringify({ models: { feature: "not valid" }, modelFilter: { include: ["gpt-*"] } }), "utf8");
    const restricted = await host();
    await restricted.emit("session_start", { reason: "startup" });
    assert.equal(await restricted.delegate(T3, { task: "x", target: { model: "cliproxyapi/gpt-6.1-sol" } }), undefined);
    assert.equal(((await restricted.delegate(T3, { task: "x" })) as { block?: boolean }).block, true);
  } finally {
    writeFileSync(path, before, "utf8");
  }
});

test("a config file the adapter cannot read blocks delegation until a session filter decides", async () => {
  const { writeFileSync } = await import("node:fs");
  const path = join(agentDir, "pi-pstack-adapter.json");
  const before = readFileSync(path, "utf8");
  writeFileSync(path, "{ not json", "utf8");
  try {
    const session = await host();
    await session.emit("session_start", { reason: "startup" });
    const blocked = (await session.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } })) as { block?: boolean; reason?: string };
    assert.equal(blocked.block, true);
    assert.match(blocked.reason ?? "", /config could not be read/);
    assert.equal(await session.delegate("read", { path: "x" }), undefined);
    assert.match(await session.call({ action: "set_filter", exclude: ["claude-*"] }), /session's model filter is set/);
    assert.equal(await session.delegate(T3, { task: "x", target: { model: "cliproxyapi/kimi-k3" } }), undefined);
  } finally {
    writeFileSync(path, before, "utf8");
  }
});
