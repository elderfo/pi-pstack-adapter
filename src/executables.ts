import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { getShellConfig, SettingsManager } from "@earendil-works/pi-coding-agent";

/** The shell Pi's `bash` tool runs commands with, as `getShellConfig()` reports it. */
export interface ShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  /** Legacy WSL `bash.exe` reads the command from stdin (`-s`) instead of `-c`. */
  readonly commandTransport?: "argv" | "stdin";
}

/** Everything that decides what a command run by Pi's `bash` tool can find. */
export interface BashToolContext {
  readonly shell: ShellConfig;
  /** Pi's `shellCommandPrefix`, which runs before every command. */
  readonly prefix?: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export type ExecutableCheck = (name: string) => boolean;

/**
 * The context Pi's `bash` tool would run in for this session. Project settings count only in a
 * trusted project, as in Pi itself, so an untrusted checkout cannot choose the executable or the
 * prefix this spawns. Throws when Pi cannot resolve a Bash shell.
 */
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

/** True when `command` is an executable file on this process's PATH. */
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
        // Not executable by this user. Keep looking.
      }
    }
  }
  return false;
}

// The trailing `exit 0` keeps a missing last name from looking like a shell that failed to run.
const PROBE_SCRIPT = 'for name in "$@"; do command -v -- "$name" >/dev/null 2>&1 && printf "%s\\n" "$name"; done; exit 0';

export type ShellProbe =
  | { readonly kind: "ran"; readonly found: ReadonlySet<string> }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Runs `command -v` for each name in the bash tool's context, with Pi's `shellCommandPrefix`
 * first, exactly as the tool would run a command. It runs even with no names, because a shell
 * that cannot run a command blocks every workflow. Names travel as positional arguments, never
 * inside the script text.
 */
export function shellExecutables(context: BashToolContext, names: readonly string[]): ShellProbe {
  const script = context.prefix ? `${context.prefix}\n${PROBE_SCRIPT}` : PROBE_SCRIPT;
  // With `-c` the word after the script is `$0`; with `-s` the script arrives on stdin, and `--`
  // stops bash from reading a name as an option.
  const stdin = context.shell.commandTransport === "stdin";
  const args = stdin
    ? [...context.shell.args, "--", ...names]
    : [...context.shell.args, script, "pistack-probe", ...names];
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
  return { kind: "ran", found: new Set(result.stdout.split(/\r?\n/).filter((line) => names.includes(line))) };
}

export interface ExecutableReport {
  readonly has: ExecutableCheck;
  /** Set when Pi's bash shell resolved but could not run a command. */
  readonly shellFailure?: string;
}

/**
 * Skill bodies run their commands through Pi's `bash` tool, so executables are looked up there:
 * with Pi's `shellCommandPrefix` and its `bin` directory on every platform, and on native Windows
 * inside Git Bash, whose PATH adds `/usr/bin` and `/mingw64/bin` to the PATH Pi started with.
 * Pass no context when the tool is inactive or its shell cannot be resolved; the shell
 * diagnostics report that, and the PATH scan answers for the executables.
 */
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
