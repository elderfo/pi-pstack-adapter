import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve, win32 } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILE_NAME = "pi-pstack-adapter.json";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith(`~\\`)) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function agentDir(): string {
  return resolve(getAgentDir());
}

export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const left = paths.resolve(a);
  const right = paths.resolve(b);
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
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

export function validateContainedPath(value: string, label: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const escapes =
    normalized === "" ||
    isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..");
  if (escapes) {
    throw new Error(
      `Refusing ${label} ${JSON.stringify(value)}. It must name a location inside the checkout, not an absolute or parent path.`,
    );
  }
  return normalized;
}
