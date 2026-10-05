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

/**
 * Returns the names `command -v` finds in the bash tool's context, or undefined when the shell
 * cannot run. Names travel as positional arguments, never inside the script text.
 */
export function shellExecutables(context: BashToolContext, names: readonly string[]): Set<string> | undefined {
  if (names.length === 0) return new Set();
  const script = context.prefix ? `${context.prefix}\n${PROBE_SCRIPT}` : PROBE_SCRIPT;
  // With `-c` the word after the script is `$0`; with `-s` the script arrives on stdin.
  const stdin = context.shell.commandTransport === "stdin";
  const args = stdin ? [...context.shell.args, ...names] : [...context.shell.args, script, "pistack-probe", ...names];
  const result = spawnSync(context.shell.shell, args, {
    cwd: context.cwd,
    env: context.env,
    input: stdin ? script : undefined,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return new Set(result.stdout.split(/\r?\n/).filter((line) => names.includes(line)));
}

/**
 * Skill bodies run their commands through Pi's `bash` tool. On native Windows that is Git Bash,
 * whose PATH adds `/usr/bin` and `/mingw64/bin` and differs from the PATH Pi itself started with,
 * so a probe of Pi's PATH would disagree with what the model can run. There the check asks the
 * shell itself. Elsewhere the shell inherits Pi's PATH, so the cheaper PATH scan answers the same.
 * When the shell cannot be resolved or run, the PATH scan is the fallback, and the shell
 * diagnostics report the shell problem separately.
 */
export function executableCheck(
  names: readonly string[],
  platform: NodeJS.Platform,
  resolveContext: () => BashToolContext,
): ExecutableCheck {
  if (platform !== "win32") return (name) => onPath(name, platform);
  let found: Set<string> | undefined;
  try {
    found = shellExecutables(resolveContext(), names);
  } catch {
    found = undefined;
  }
  if (!found) return (name) => onPath(name, platform);
  const present = found;
  return (name) => present.has(name);
}
