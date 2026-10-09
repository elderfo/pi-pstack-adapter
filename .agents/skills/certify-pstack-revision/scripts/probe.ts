// Generates wrappers from an exported pstack tree with this checkout's adapter, then checks
// that every upstream body survived byte for byte.
//
// Usage: node --experimental-strip-types --no-warnings probe.ts <pluginDir> <commit> <cacheRoot>
//   pluginDir  the exported `pstack/` directory, e.g. /tmp/pstack-new/pstack
//   commit     the full upstream commit the tree was exported from
//   cacheRoot  a scratch directory; use a new one for each adapter state you compare
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { extractUpstreamBody, generate } from "../../../../src/generate.ts";
import { CERTIFIED } from "../../../../src/certified.ts";
import type { ResolvedSource } from "../../../../src/types.ts";

const [pluginArg, commit, cacheArg] = process.argv.slice(2);
if (!pluginArg || !commit || !cacheArg) {
  console.error("usage: probe.ts <pluginDir> <commit> <cacheRoot>");
  process.exit(2);
}
const pluginDir = resolve(pluginArg);

// `setup-pstack` is replaced by the adapter's own setup skill on purpose.
const REPLACED = new Set(["setup-pstack"]);

const source: ResolvedSource = {
  selection: { kind: "git", repo: CERTIFIED.repo, ref: commit },
  trust: "untested-ref",
  commit,
  checkoutDir: dirname(pluginDir),
  pluginDir,
};
const result = generate({ source, namespace: "pistack", cacheRoot: resolve(cacheArg), adapterVersion: "probe", force: true });

const identical: string[] = [];
const mismatched: string[] = [];
for (const name of readdirSync(join(pluginDir, "skills")).sort()) {
  if (REPLACED.has(name)) continue;
  const upstream = readFileSync(join(pluginDir, "skills", name, "SKILL.md"), "utf8");
  const body = upstream.replace(/^---\n[\s\S]*?\n---\n/, "");
  const wrapperPath = join(result.skillsDir, `pistack-${name}`, "SKILL.md");
  if (!existsSync(wrapperPath)) {
    mismatched.push(`${name} (no wrapper)`);
    continue;
  }
  (extractUpstreamBody(readFileSync(wrapperPath, "utf8")) === body ? identical : mismatched).push(name);
}

console.log(JSON.stringify({
  outDir: result.outDir,
  skills: result.skills.length,
  agents: result.agents.length,
  diagnostics: result.diagnostics,
  byteIdentical: identical.length,
  replaced: [...REPLACED],
  mismatched,
}, null, 1));
process.exitCode = mismatched.length > 0 ? 1 : 0;
