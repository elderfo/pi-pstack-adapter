import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { bashToolContext, executableCheck, shellExecutables, type BashToolContext } from "../src/executables.ts";
import { makeTempDir } from "./support/fixture.ts";

/** The context Pi's `bash` tool uses on this machine: Git Bash on Windows, bash elsewhere. */
function piContext(overrides: Partial<BashToolContext> = {}): BashToolContext {
  return { shell: getShellConfig(), cwd: process.cwd(), env: process.env, ...overrides };
}

const posixPath = (path: string) => path.replace(/\\/g, "/");
/** A directory as a PATH entry inside the shell: Git Bash writes `C:\x` as `/c/x`. */
const shellDir = (path: string) => posixPath(path).replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);

test("the shell probe reports which names its shell can run", () => {
  const found = shellExecutables(piContext(), ["sh", "pistack-no-such-command"]);
  assert.deepEqual([...(found ?? [])], ["sh"]);
});

test("a hostile executable name is data for the shell probe, never script text", () => {
  const marker = posixPath(join(makeTempDir("probe-injection"), "pwned"));
  const found = shellExecutables(piContext(), [`x; touch '${marker}'`, `$(touch '${marker}')`]);
  assert.deepEqual([...(found ?? [])], []);
  assert.equal(existsSync(marker), false);
});

test("a shell that reads its command from stdin, as legacy WSL bash does, still runs the probe", () => {
  const { shell } = getShellConfig();
  const found = shellExecutables(piContext({ shell: { shell, args: ["-s"], commandTransport: "stdin" } }), [
    "sh",
    "pistack-no-such-command",
  ]);
  assert.deepEqual([...(found ?? [])], ["sh"]);
});

test("Pi's shellCommandPrefix applies to the probe, so a tool it adds to PATH counts", () => {
  const bin = makeTempDir("prefix-bin");
  writeFileSync(join(bin, "pistack-prefixed-tool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const prefix = `export PATH="${shellDir(bin)}:$PATH"`;
  assert.deepEqual([...(shellExecutables(piContext(), ["pistack-prefixed-tool"]) ?? [])], []);
  assert.deepEqual([...(shellExecutables(piContext({ prefix }), ["pistack-prefixed-tool"]) ?? [])], ["pistack-prefixed-tool"]);
});

test("an untrusted project cannot choose the shell the probe spawns", () => {
  const agentDir = makeTempDir("probe-agent");
  const project = makeTempDir("probe-project");
  mkdirSync(join(project, ".pi"), { recursive: true });
  const planted = join(project, "planted-shell.exe");
  writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ shellPath: planted, shellCommandPrefix: "echo planted" }));

  const untrusted = bashToolContext(project, agentDir, false);
  assert.notEqual(untrusted.shell.shell, planted);
  assert.equal(untrusted.prefix, undefined);

  // Trusted, the project setting wins, so Pi refuses the missing executable instead of using it.
  assert.throws(() => bashToolContext(project, agentDir, true), /Custom shell path not found/);
});

test("on POSIX the check scans PATH and never starts a shell", () => {
  let started = false;
  const check = executableCheck(["node"], "linux", () => {
    started = true;
    return piContext();
  });
  assert.equal(started, false);
  assert.equal(typeof check("node"), "boolean");
});

test("on Windows the check asks Pi's bash shell, where Git Bash adds its own tools to PATH", () => {
  let started = false;
  const check = executableCheck(["sh", "pistack-no-such-command"], "win32", () => {
    started = true;
    return piContext();
  });
  assert.equal(started, true);
  assert.equal(check("sh"), true);
  assert.equal(check("pistack-no-such-command"), false);
});

test("on Windows a shell that cannot be resolved or run falls back to the PATH scan", () => {
  const unresolved = executableCheck(["pistack-no-such-command"], "win32", () => {
    throw new Error("No bash shell found.");
  });
  assert.equal(unresolved("pistack-no-such-command"), false);

  const missing = join(makeTempDir("no-shell"), "bash.exe");
  const broken = piContext({ shell: { shell: missing, args: ["-c"] } });
  assert.equal(shellExecutables(broken, ["sh"]), undefined);
  assert.equal(executableCheck(["pistack-no-such-command"], "win32", () => broken)("pistack-no-such-command"), false);
});
