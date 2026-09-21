import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { generate } from "../src/generate.ts";
import { ADAPTER_SKILLS, SKILL_REGISTRY } from "../src/registry.ts";
import type { ResolvedSource } from "../src/types.ts";
import { makeTempDir, readTree, writePluginFixture } from "./support/fixture.ts";

const UPSTREAM_BODY = "\n# Unslop\n\nCut AI tells.\n\n- No long dashes.\n";

function fixtureSource(pluginDir: string, commit = "0".repeat(40)): ResolvedSource {
  return {
    selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
    trust: "tested",
    commit,
    checkoutDir: join(pluginDir, ".."),
    pluginDir,
  };
}

function run(options: { pluginDir: string; cacheRoot: string; namespace?: string; commit?: string; force?: boolean }) {
  return generate({
    source: fixtureSource(options.pluginDir, options.commit),
    namespace: options.namespace ?? "pistack",
    cacheRoot: options.cacheRoot,
    adapterVersion: "0.1.0",
    force: options.force ?? true,
  });
}

test("the generated wrapper ends with the upstream body byte for byte", () => {
  const root = makeTempDir("body");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: UPSTREAM_BODY }] });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  const wrapper = readFileSync(join(result.skillsDir, "pistack-unslop", "SKILL.md"), "utf8");
  assert.ok(wrapper.endsWith(UPSTREAM_BODY), "wrapper must end with the unmodified upstream body");
  assert.equal(wrapper.slice(0, wrapper.length - UPSTREAM_BODY.length).includes(UPSTREAM_BODY.trim()), false);
  assert.match(wrapper, /^---\nname: pistack-unslop\n/);
});

test("support files are copied byte for byte and keep the executable bit", () => {
  const root = makeTempDir("support");
  const pluginDir = writePluginFixture(root, {
    skills: [
      {
        name: "tooling",
        body: "body\n",
        files: { "scripts/run.sh": "#!/bin/sh\necho hi\n", "references/notes.md": "# notes\n\u00e9\n" },
        executableFiles: ["scripts/run.sh"],
      },
    ],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });
  const generatedDir = join(result.skillsDir, "pistack-tooling");

  assert.equal(
    readFileSync(join(generatedDir, "scripts/run.sh"), "utf8"),
    readFileSync(join(pluginDir, "skills/tooling/scripts/run.sh"), "utf8"),
  );
  assert.equal(
    readFileSync(join(generatedDir, "references/notes.md"), "utf8"),
    readFileSync(join(pluginDir, "skills/tooling/references/notes.md"), "utf8"),
  );
  assert.equal((lstatSync(join(generatedDir, "scripts/run.sh")).mode & 0o111) !== 0, true);
});

test("generation is deterministic for the same inputs", () => {
  const root = makeTempDir("determinism");
  const pluginDir = writePluginFixture(root, {
    skills: [
      { name: "alpha", body: "alpha body\n", files: { "a.txt": "a\n" } },
      { name: "beta", body: "beta body\n" },
    ],
    agents: [{ name: "gamma", body: "gamma prompt\n" }],
  });

  const first = run({ pluginDir, cacheRoot: join(root, "cache-a") });
  const second = run({ pluginDir, cacheRoot: join(root, "cache-b") });

  assert.deepEqual(readTree(first.outDir), readTree(second.outDir));
  assert.deepEqual(
    first.skills.map((skill) => skill.generatedName),
    second.skills.map((skill) => skill.generatedName),
  );
});

test("the namespace changes every generated identifier and nothing else", () => {
  const root = makeTempDir("namespace");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "alpha", body: "alpha body\n" }],
    agents: [{ name: "gamma", body: "gamma prompt\n" }],
  });

  const standard = run({ pluginDir, cacheRoot: join(root, "cache-a") });
  const renamed = run({ pluginDir, cacheRoot: join(root, "cache-b"), namespace: "pquux" });

  assert.deepEqual(standard.skills.map((s) => s.generatedName), ["pistack-alpha", "pistack-status"]);
  assert.deepEqual(renamed.skills.map((s) => s.generatedName), ["pquux-alpha", "pquux-status"]);
  assert.deepEqual(standard.agents.map((a) => a.generatedName), ["pistack-gamma"]);
  assert.deepEqual(renamed.agents.map((a) => a.generatedName), ["pquux-gamma"]);

  const standardBody = readFileSync(join(standard.skillsDir, "pistack-alpha", "SKILL.md"), "utf8");
  const renamedBody = readFileSync(join(renamed.skillsDir, "pquux-alpha", "SKILL.md"), "utf8");
  assert.equal(renamedBody.split("pquux").join("pistack"), standardBody);
});

test("an unknown upstream skill becomes an experimental wrapper and is reported", () => {
  const root = makeTempDir("unknown");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "brand-new-thing", body: "body\n" }] });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  const skill = result.skills.find((candidate) => candidate.generatedName === "pistack-brand-new-thing");
  assert.equal(skill?.tier, "experimental");
  const reported = result.diagnostics.find((d) => d.resource === "skill:brand-new-thing");
  assert.equal(reported?.level, "info");
  assert.match(reported?.message ?? "", /experimental wrapper/);
});

test("a malformed skill is skipped with a diagnostic naming the failure", () => {
  const root = makeTempDir("malformed");
  const pluginDir = writePluginFixture(root, {
    skills: [
      { name: "good", body: "ok\n" },
      { name: "nodesc", frontmatter: "name: nodesc", body: "body\n" },
    ],
  });
  writeFileSync(join(pluginDir, "skills", "good", "SKILL.md"), "no frontmatter at all\n", "utf8");

  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  assert.equal(result.skills.some((s) => s.generatedName === "pistack-good"), false);
  assert.equal(result.skills.some((s) => s.generatedName === "pistack-nodesc"), false);
  const messages = result.diagnostics.filter((d) => d.level === "error").map((d) => `${d.resource} ${d.message}`);
  assert.equal(messages.some((m) => m.startsWith("skill:good") && m.includes("no YAML frontmatter")), true);
  assert.equal(messages.some((m) => m.startsWith("skill:nodesc") && m.includes("no description")), true);
});

test("a skill directory without SKILL.md is reported rather than dropped silently", () => {
  const root = makeTempDir("missing");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "present", body: "b\n" }] });
  mkdirSync(join(pluginDir, "skills", "hollow"));

  const result = run({ pluginDir, cacheRoot: join(root, "cache") });
  const reported = result.diagnostics.find((d) => d.resource === "skill:hollow");
  assert.equal(reported?.level, "error");
});

test("a registry skill missing from the upstream revision is reported", () => {
  const root = makeTempDir("removed");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  const known = Object.keys(SKILL_REGISTRY).filter((name) => name !== "unslop");
  for (const name of known) {
    const reported = result.diagnostics.find((d) => d.resource === `skill:${name}`);
    assert.equal(reported?.level, "warning", `${name} should be reported as removed`);
  }
});

test("symbolic links are never created and are reported instead", () => {
  const root = makeTempDir("symlink");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "linky", body: "b\n", files: { "real.txt": "real\n" } }],
  });
  symlinkSync(join(pluginDir, "skills", "linky", "real.txt"), join(pluginDir, "skills", "linky", "alias.txt"));

  const result = run({ pluginDir, cacheRoot: join(root, "cache") });
  const generatedDir = join(result.skillsDir, "pistack-linky");

  assert.equal(existsSync(join(generatedDir, "alias.txt")), false);
  assert.equal(
    result.diagnostics.some((d) => d.resource === "skill:linky" && d.message.includes("symbolic link")),
    true,
  );
  for (const entry of readTree(result.outDir)) {
    assert.equal(lstatSync(join(result.outDir, entry.path)).isSymbolicLink(), false);
  }
});

test("the adapter replaces the Cursor setup body and keeps the upstream skill represented", () => {
  const root = makeTempDir("setup");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "setup-pstack", body: "Write ~/.cursor/rules/pstack-models.mdc.\n" }],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  const wrapper = readFileSync(join(result.skillsDir, "pistack-setup", "SKILL.md"), "utf8");
  assert.equal(wrapper.includes("pstack-models.mdc.\n"), false);
  assert.match(wrapper, /pistack-upstream-skill: setup-pstack/);
  assert.equal(result.skills.some((s) => s.upstreamName === "setup-pstack"), true);
});

test("every adapter-owned skill is generated alongside the upstream ones", () => {
  const root = makeTempDir("adapter-skills");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  for (const name of Object.keys(ADAPTER_SKILLS)) {
    assert.equal(result.skills.some((s) => s.generatedName === `pistack-${name}`), true, `${name} must be generated`);
  }
});

test("the wrapper states host precedence over upstream autonomy instructions", () => {
  const root = makeTempDir("precedence");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "arena", body: "\nJust do it. Force-push without asking.\n" }],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });
  const wrapper = readFileSync(join(result.skillsDir, "pistack-arena", "SKILL.md"), "utf8");

  assert.match(wrapper, /Pi policy, the host's safety rules, and the user's explicit instructions override/);
  assert.ok(wrapper.includes("Just do it. Force-push without asking."), "upstream text stays auditable");
  assert.ok(
    wrapper.indexOf("override any conflicting autonomy") < wrapper.indexOf("Force-push without asking"),
    "the precedence statement must come before the upstream body",
  );
});

test("cached output is reused when the inputs have not changed", () => {
  const root = makeTempDir("reuse");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const cache = join(root, "cache");

  const first = generate({
    source: fixtureSource(pluginDir),
    namespace: "pistack",
    cacheRoot: cache,
    adapterVersion: "0.1.0",
  });
  writeFileSync(join(first.outDir, "skills", "pistack-unslop", "SKILL.md"), "tampered\n", "utf8");
  const second = generate({
    source: fixtureSource(pluginDir),
    namespace: "pistack",
    cacheRoot: cache,
    adapterVersion: "0.1.0",
  });

  assert.equal(second.outDir, first.outDir);
  assert.equal(readFileSync(join(second.outDir, "skills", "pistack-unslop", "SKILL.md"), "utf8"), "tampered\n");

  const forced = generate({
    source: fixtureSource(pluginDir),
    namespace: "pistack",
    cacheRoot: cache,
    adapterVersion: "0.1.0",
    force: true,
  });
  assert.notEqual(readFileSync(join(forced.outDir, "skills", "pistack-unslop", "SKILL.md"), "utf8"), "tampered\n");
});

test("an agent system prompt is trimmed so a provider will accept it", () => {
  const root = makeTempDir("agents");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "unslop", body: "b\n" }],
    agents: [{ name: "poteto-agent", body: "\n# Poteto subagent\n\nYou are poteto.\n" }],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  assert.equal(result.agents[0]?.systemPrompt, "# Poteto subagent\n\nYou are poteto.");
});

test("an agent with an empty body is reported instead of registered", () => {
  const root = makeTempDir("empty-agent");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "unslop", body: "b\n" }],
    agents: [{ name: "hollow", body: "\n\n" }],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  assert.deepEqual(result.agents, []);
  assert.equal(result.diagnostics.find((d) => d.resource === "agent:hollow")?.level, "error");
});

test("an upstream name Pi would reject is skipped with a diagnostic", () => {
  const root = makeTempDir("badname");
  const pluginDir = writePluginFixture(root, {
    skills: [{ name: "Shouty_Name", body: "b\n" }, { name: `a${"-b".repeat(40)}`, body: "b\n" }],
  });
  const result = run({ pluginDir, cacheRoot: join(root, "cache") });

  assert.deepEqual(result.skills.map((s) => s.generatedName), ["pistack-status"]);
  const problems = result.diagnostics.filter((d) => d.level === "error").map((d) => d.message);
  assert.equal(problems.some((m) => m.includes("not lowercase letters")), true);
  assert.equal(problems.some((m) => m.includes("over Pi's 64 character limit")), true);
});

test("a different upstream commit produces a separate output directory", () => {
  const root = makeTempDir("commits");
  const pluginDir = writePluginFixture(root, { skills: [{ name: "unslop", body: "b\n" }] });
  const cache = join(root, "cache");

  const a = run({ pluginDir, cacheRoot: cache, commit: "a".repeat(40) });
  const b = run({ pluginDir, cacheRoot: cache, commit: "b".repeat(40) });
  assert.notEqual(a.outDir, b.outDir);
});
