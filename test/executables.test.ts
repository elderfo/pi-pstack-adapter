import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { bashToolContext, probeExecutables, shellExecutables, type BashToolContext, type ShellProbe } from "../src/executables.ts";
import { makeTempDir } from "./support/fixture.ts";

/** The context Pi's `bash` tool uses on this machine: Git Bash on Windows, bash elsewhere. */
function piContext(overrides: Partial<BashToolContext> = {}): BashToolContext {
  return { shell: getShellConfig(), cwd: process.cwd(), env: process.env, ...overrides };
}

/** The names a probe found, or a failure marker so a broken probe cannot look like "none found". */
const found = (probe: ShellProbe) => (probe.kind === "ran" ? [...probe.found] : [`failed: ${probe.reason}`]);

const posixPath = (path: string) => path.replace(/\\/g, "/");
/** A directory as a PATH entry inside the shell: Git Bash writes `C:\x` as `/c/x`. */
const shellDir = (path: string) => posixPath(path).replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);

test("the shell probe reports which names its shell can run", () => {
  assert.deepEqual(found(shellExecutables(piContext(), ["sh", "pistack-no-such-command"])), ["sh"]);
});

test("a hostile executable name is data for the shell probe, never script text", () => {
  const marker = posixPath(join(makeTempDir("probe-injection"), "pwned"));
  assert.deepEqual(found(shellExecutables(piContext(), [`x; touch '${marker}'`, `$(touch '${marker}')`])), []);
  assert.equal(existsSync(marker), false);
});

test("a shell that reads its command from stdin, as legacy WSL bash does, still runs the probe", () => {
  const { shell } = getShellConfig();
  const stdin = piContext({ shell: { shell, args: ["-s"], commandTransport: "stdin" } });
  assert.deepEqual(found(shellExecutables(stdin, ["sh", "pistack-no-such-command", "-c"])), ["sh"]);
});

test("Pi's shellCommandPrefix applies to the probe, so a tool it adds to PATH counts", () => {
  const bin = makeTempDir("prefix-bin");
  writeFileSync(join(bin, "pistack-prefixed-tool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const prefix = `export PATH="${shellDir(bin)}:$PATH"`;
  assert.deepEqual(found(shellExecutables(piContext(), ["pistack-prefixed-tool"])), []);
  assert.deepEqual(found(shellExecutables(piContext({ prefix }), ["pistack-prefixed-tool"])), ["pistack-prefixed-tool"]);
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

test("every platform looks executables up in Pi's bash context, including its prefix", () => {
  const bin = makeTempDir("prefix-bin-all");
  writeFileSync(join(bin, "pistack-prefixed-tool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const report = probeExecutables(["pistack-prefixed-tool", "pistack-no-such-command"], () =>
    piContext({ prefix: `export PATH="${shellDir(bin)}:$PATH"` }),
  );
  assert.equal(report.shellFailure, undefined);
  assert.equal(report.has("pistack-prefixed-tool"), true);
  assert.equal(report.has("pistack-no-such-command"), false);
});

test("a shell that resolves but cannot run a command is reported, even when a skill needs no executables", () => {
  // A real executable that is not a shell: it cannot run the probe script.
  const broken = piContext({ shell: { shell: process.execPath, args: ["-c"] } });
  for (const names of [[], ["sh"]]) {
    const report = probeExecutables(names, () => broken);
    assert.match(report.shellFailure ?? "", /could not run a command, so pstack skills cannot run here/, JSON.stringify(names));
  }
  const missing = piContext({ shell: { shell: join(makeTempDir("no-shell"), "bash.exe"), args: ["-c"] } });
  assert.match(probeExecutables([], () => missing).shellFailure ?? "", /could not run a command/);
});

test("without a usable bash context the check falls back to a PATH scan and spawns nothing", () => {
  assert.equal(probeExecutables(["pistack-no-such-command"], undefined).has("pistack-no-such-command"), false);
  const unresolved = probeExecutables(["pistack-no-such-command"], () => {
    throw new Error("No bash shell found.");
  });
  assert.equal(unresolved.shellFailure, undefined, "an unresolved shell is reported by the shell diagnostics instead");
  assert.equal(unresolved.has("pistack-no-such-command"), false);
});
