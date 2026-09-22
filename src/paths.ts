import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CONFIG_FILE_NAME = "pi-pstack-adapter.json";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith(`~\\`)) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * Mirrors Pi's own `getAgentDir()`, so a sandboxed `PI_CODING_AGENT_DIR` keeps its cache
 * beside its own config instead of writing into the real one.
 */
export function agentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  return override ? resolve(expandHome(override)) : join(homedir(), ".pi", "agent");
}

export function cacheRoot(override?: string): string {
  if (override) return resolve(expandHome(override));
  return join(agentDir(), "cache", "pi-pstack-adapter");
}

export function digest(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 16);
}

export function checkoutDir(root: string, repo: string): string {
  return join(root, "checkouts", digest(repo));
}

export function generatedDir(root: string, inputsDigest: string): string {
  return join(root, "generated", inputsDigest);
}

export function stateFile(root: string): string {
  return join(root, "state.json");
}
