import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { getShellConfig, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  /** Legacy WSL `bash.exe` reads the command from stdin (`-s`) instead of `-c`. */
  readonly commandTransport?: "argv" | "stdin";
}

export interface BashToolContext {
  readonly shell: ShellConfig;
  readonly prefix?: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export type ExecutableCheck = (name: string) => boolean;

export function bashToolContext(cwd: string, agentDir: string, projectTrusted: boolean): BashToolContext {
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
  return {
    shell: getShellConfig(settings.getShellPath()),
    prefix: settings.getShellCommandPrefix(),
    cwd,
    env: piShellEnv(agentDir),
  };
}

/** Pi's `getShellEnv`, which is not exported: its own `bin` directory goes first on PATH. */
function piShellEnv(agentDir: string): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const current = process.env[pathKey] ?? "";
  const binDir = join(agentDir, "bin");
  const entries = current.split(delimiter).filter(Boolean);
  return { ...process.env, [pathKey]: entries.includes(binDir) ? current : [binDir, current].filter(Boolean).join(delimiter) };
}

export function onPath(command: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");
  const extensions = platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of paths) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (!existsSync(candidate)) continue;
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}

const PROBE_SCRIPT =
  'nonce=$1; shift; for name in "$@"; do command -v -- "$name" >/dev/null 2>&1 && printf "%s found %s\\n" "$nonce" "$name"; done; printf "%s done\\n" "$nonce"; exit 0';

export type ShellProbe =
  | { readonly kind: "ran"; readonly found: ReadonlySet<string> }
  | { readonly kind: "failed"; readonly reason: string };

export function shellExecutables(context: BashToolContext, names: readonly string[]): ShellProbe {
  const script = context.prefix ? `${context.prefix}\n${PROBE_SCRIPT}` : PROBE_SCRIPT;
  // With `-c` the word after the script is `$0`; with `-s` the script arrives on stdin, and `--`
  // stops bash from reading a name as an option.
  const stdin = context.shell.commandTransport === "stdin";
  const nonce = `pistack-probe-${randomBytes(12).toString("hex")}`;
  const args = stdin
    ? [...context.shell.args, "--", nonce, ...names]
    : [...context.shell.args, script, "pistack-probe", nonce, ...names];
  const result = spawnSync(context.shell.shell, args, {
    cwd: context.cwd,
    env: context.env,
    input: stdin ? script : undefined,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) return { kind: "failed", reason: result.error.message };
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim().split(/\r?\n/)[0];
    return { kind: "failed", reason: `it exited ${result.status ?? result.signal}${detail ? `: ${detail}` : ""}` };
  }
  const probe = parseProbeOutput(result.stdout, nonce);
  if (probe.kind === "failed") return probe;
  return { kind: "ran", found: new Set([...probe.found].filter((name) => names.includes(name))) };
}

function parseProbeOutput(stdout: string, nonce: string): ShellProbe {
  const doneLine = `${nonce} done`;
  const foundPrefix = `${nonce} found `;
  const lines = stdout.split(/\r?\n/);
  if (!lines.includes(doneLine)) {
    return { kind: "failed", reason: "it exited without running the probe command" };
  }
  const found = lines.filter((line) => line.startsWith(foundPrefix)).map((line) => line.slice(foundPrefix.length));
  return { kind: "ran", found: new Set(found) };
}

export interface ExecutableReport {
  readonly has: ExecutableCheck;
  readonly shellFailure?: string;
}

export function probeExecutables(
  names: readonly string[],
  resolveContext: (() => BashToolContext) | undefined,
  platform: NodeJS.Platform = process.platform,
): ExecutableReport {
  const scan: ExecutableCheck = (name) => onPath(name, platform);
  if (!resolveContext) return { has: scan };
  let context: BashToolContext;
  try {
    context = resolveContext();
  } catch {
    return { has: scan };
  }
  const probe = shellExecutables(context, names);
  if (probe.kind === "failed") {
    return {
      has: scan,
      shellFailure: `Pi's bash shell ${context.shell.shell} could not run a command, so pstack skills cannot run here: ${probe.reason}. Fix the shell or \`shellCommandPrefix\` in Pi settings, or set \`shellPath\` to a working Bash executable, then restart Pi.`,
    };
  }
  return { has: (name) => probe.found.has(name) };
}
