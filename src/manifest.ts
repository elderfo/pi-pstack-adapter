import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateContainedPath } from "./paths.ts";
import type { Diagnostic, ParsedResource, UpstreamManifest, UpstreamResource } from "./types.ts";

export const MANIFEST_RELATIVE_PATH = join(".cursor-plugin", "plugin.json");

export interface DiscoveryResult {
  readonly manifest: UpstreamManifest;
  readonly resources: readonly UpstreamResource[];
  readonly diagnostics: readonly Diagnostic[];
}

export function readManifest(pluginDir: string): UpstreamManifest {
  const path = join(pluginDir, MANIFEST_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`No pstack manifest at ${path}. The upstream checkout is missing or points at the wrong directory.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  const record = parsed as Record<string, unknown>;
  const name = requireString(record, "name", path);
  // The upstream repository owns its own manifest, so these must stay inside the plugin.
  const skillsDir = validateContainedPath(requireString(record, "skills", path), `the "skills" path in ${path}`);
  const agentsDir = validateContainedPath(requireString(record, "agents", path), `the "agents" path in ${path}`);
  const version = typeof record.version === "string" ? record.version : "unknown";
  return { name, version, skillsDir, agentsDir };
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} is missing a string "${key}" field.`);
  }
  return value;
}

export function discover(pluginDir: string, manifest: UpstreamManifest): DiscoveryResult {
  const diagnostics: Diagnostic[] = [];
  const resources: UpstreamResource[] = [];

  const skillsRoot = join(pluginDir, manifest.skillsDir);
  for (const name of listDirectories(skillsRoot, diagnostics, "skills")) {
    const dir = join(skillsRoot, name);
    const entryPath = join(dir, "SKILL.md");
    if (!isFile(entryPath)) {
      diagnostics.push({
        level: "error",
        resource: `skill:${name}`,
        message: `${entryPath} is missing, so the skill cannot be adapted.`,
        action: "Report this against the upstream revision, or pin a revision that still contains the skill.",
      });
      continue;
    }
    resources.push({ name, kind: "skill", dir, entryPath });
  }

  const agentsRoot = join(pluginDir, manifest.agentsDir);
  for (const file of listFiles(agentsRoot, diagnostics, "agents")) {
    if (!file.endsWith(".md")) continue;
    resources.push({
      name: file.slice(0, -3),
      kind: "agent",
      dir: agentsRoot,
      entryPath: join(agentsRoot, file),
    });
  }

  resources.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
  return { manifest, resources, diagnostics };
}

function listDirectories(root: string, diagnostics: Diagnostic[], label: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    diagnostics.push({
      level: "error",
      resource: label,
      message: `The manifest declares ${root}, but that directory does not exist.`,
      action: "Pin an upstream revision whose manifest matches its tree.",
    });
    return [];
  }
}

function listFiles(root: string, diagnostics: Diagnostic[], label: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    diagnostics.push({
      level: "error",
      resource: label,
      message: `The manifest declares ${root}, but that directory does not exist.`,
      action: "Pin an upstream revision whose manifest matches its tree.",
    });
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseResource(resource: UpstreamResource): ParsedResource | Diagnostic {
  let raw: string;
  try {
    raw = readFileSync(resource.entryPath, "utf8");
  } catch (error) {
    return unreadable(resource, (error as Error).message);
  }
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    return {
      level: "error",
      resource: `${resource.kind}:${resource.name}`,
      message: `${resource.entryPath} has no YAML frontmatter block.`,
      action: "Skipped. Pin a revision where this resource is well formed.",
    };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] as string);
  } catch (error) {
    return {
      level: "error",
      resource: `${resource.kind}:${resource.name}`,
      message: `${resource.entryPath} has invalid YAML frontmatter: ${(error as Error).message}`,
      action: "Skipped. Pin a revision where this resource is well formed.",
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      level: "error",
      resource: `${resource.kind}:${resource.name}`,
      message: `${resource.entryPath} frontmatter is not a mapping.`,
      action: "Skipped. Pin a revision where this resource is well formed.",
    };
  }
  const frontmatter: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    frontmatter[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    return {
      level: "error",
      resource: `${resource.kind}:${resource.name}`,
      message: `${resource.entryPath} frontmatter has no description, which Pi requires.`,
      action: "Skipped. Pin a revision where this resource is well formed.",
    };
  }
  return { resource, frontmatter, body: raw.slice(match[0].length) };
}

function unreadable(resource: UpstreamResource, reason: string): Diagnostic {
  return {
    level: "error",
    resource: `${resource.kind}:${resource.name}`,
    message: `${resource.entryPath} could not be read: ${reason}`,
    action: "Skipped. Check cache permissions or re-bootstrap the checkout.",
  };
}

export function isDiagnostic(value: ParsedResource | Diagnostic): value is Diagnostic {
  return "level" in value;
}
