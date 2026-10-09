// Generates wrappers from an exported pstack tree with this checkout's adapter, then checks
// that every upstream body that is not replaced survived byte for byte.
//
// Usage: node --experimental-strip-types --no-warnings probe.ts <pluginDir> <commit> <cacheRoot>
//   pluginDir  the exported `pstack/` directory
//   commit     the full upstream commit the tree was exported from
//   cacheRoot  a scratch directory; use a fresh one for each adapter state you compare
// Exits 0 only when no body mismatches and generation reports no warning or error.
// test/certify-probe.test.ts covers this script.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CERTIFIED } from "../../../../src/certified.ts";
import { extractUpstreamBody, generate } from "../../../../src/generate.ts";
import { discover, isDiagnostic, parseResource, readManifest } from "../../../../src/manifest.ts";
import { entryFor } from "../../../../src/registry.ts";
import type { Diagnostic, ResolvedSource } from "../../../../src/types.ts";

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

export function probe(pluginDir: string, commit: string, cacheRoot: string): ProbeReport {
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
  const resources = discover(pluginDir, readManifest(pluginDir)).resources.filter((r) => r.kind === "skill");
  for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entryFor(resource.name).replacement) {
      replaced.push(resource.name);
      continue;
    }
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

  const blocking = result.diagnostics.some((d) => d.level !== "info");
  return {
    ok: mismatched.length === 0 && !blocking,
    outDir: result.outDir,
    skills: result.skills.length,
    agents: result.agents.length,
    diagnostics: result.diagnostics,
    byteIdentical,
    replaced,
    mismatched,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [pluginDir, commit, cacheRoot] = process.argv.slice(2);
  if (!pluginDir || !commit || !cacheRoot) {
    console.error("usage: probe.ts <pluginDir> <commit> <cacheRoot>");
    process.exit(2);
  }
  const report = probe(resolve(pluginDir), commit, resolve(cacheRoot));
  console.log(JSON.stringify(report, null, 1));
  process.exitCode = report.ok ? 0 : 1;
}
