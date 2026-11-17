import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CERTIFIED } from "../../../../src/certified.ts";
import { DEFAULT_DELEGATION } from "../../../../src/delegation.ts";
import { extractUpstreamBody, generate, hostMappingDocument } from "../../../../src/generate.ts";
import { discover, isDiagnostic, parseResource, readManifest } from "../../../../src/manifest.ts";
import { samePath } from "../../../../src/paths.ts";
import { entryFor } from "../../../../src/registry.ts";
import type { Diagnostic, ResolvedSource } from "../../../../src/types.ts";
import { CURSOR_TERMS, type CursorTerm, type SkillMarkdown, skillMarkdown, vocabularyDiagnostics } from "../../../../src/vocabulary.ts";

export interface ProbeReport {
  readonly ok: boolean;
  readonly outDir: string;
  readonly skills: number;
  readonly agents: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly byteIdentical: number;
  readonly replaced: readonly string[];
  readonly mismatched: readonly string[];
}

export function probe(
  pluginDir: string,
  commit: string,
  cacheRoot: string,
  terms: readonly CursorTerm[] = CURSOR_TERMS,
): ProbeReport {
  const source: ResolvedSource = {
    selection: { kind: "git", repo: CERTIFIED.repo, ref: commit },
    trust: "untested-ref",
    commit,
    checkoutDir: dirname(pluginDir),
    pluginDir,
  };
  const result = generate({ source, namespace: "pistack", cacheRoot, adapterVersion: "probe", force: true });
  const wrapperPaths = new Map(result.skills.map((skill) => [skill.upstreamName, skill.path]));

  let byteIdentical = 0;
  const replaced: string[] = [];
  const mismatched: string[] = [];
  const markdown: SkillMarkdown[] = [];
  const resources = discover(pluginDir, readManifest(pluginDir)).resources.filter((r) => r.kind === "skill");
  for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entryFor(resource.name).replacement) {
      replaced.push(resource.name);
      continue;
    }
    markdown.push(...skillMarkdown(resource.name, dirname(resource.entryPath), resource.entryPath));
    const parsed = parseResource(resource);
    const wrapperPath = wrapperPaths.get(resource.name);
    if (isDiagnostic(parsed) || !wrapperPath) {
      mismatched.push(`${resource.name} (not generated)`);
      continue;
    }
    const wrapper = readFileSync(join(wrapperPath, "SKILL.md"), "utf8");
    if (extractUpstreamBody(wrapper) === parsed.body) byteIdentical++;
    else mismatched.push(resource.name);
  }

  const diagnostics = [
    ...result.diagnostics,
    ...vocabularyDiagnostics(markdown, hostMappingDocument("pistack", DEFAULT_DELEGATION), terms),
  ];
  const blocking = diagnostics.some((d) => d.level !== "info");
  return {
    ok: mismatched.length === 0 && !blocking,
    outDir: result.outDir,
    skills: result.skills.length,
    agents: result.agents.length,
    diagnostics,
    byteIdentical,
    replaced,
    mismatched,
  };
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const comparablePath = (path: string) => realpathSync.native(path);
  try {
    return samePath(comparablePath(fileURLToPath(import.meta.url)), comparablePath(resolve(entry)), process.platform);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const [pluginDir, commit, cacheRoot] = process.argv.slice(2);
  if (!pluginDir || !commit || !cacheRoot) {
    console.error(
      [
        "usage: probe.ts <pluginDir> <commit> <cacheRoot>",
        "  pluginDir  the exported `pstack/` directory",
        "  commit     the full upstream commit the tree was exported from",
        "  cacheRoot  a fresh scratch directory for each adapter state you compare",
        "Exits 0 only when no body mismatches, and neither generation nor the scan reports a warning or error.",
      ].join("\n"),
    );
    process.exit(2);
  }
  try {
    const report = probe(resolve(pluginDir), commit, resolve(cacheRoot));
    console.log(JSON.stringify(report, null, 1));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`probe failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
