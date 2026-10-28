import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { probe } from "../../.agents/skills/certify-pstack-revision/scripts/probe.ts";
import { SKILL_REGISTRY } from "../../src/registry.ts";
import { CURSOR_TERMS, skillMarkdown } from "../../src/vocabulary.ts";
import { writePluginFixture } from "../support/fixture.ts";

const COMMIT = "0".repeat(40);
const scratchRoot = (prefix: string) => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  return mkdtempSync(join(scratch, `${prefix}-`));
};
const registrySkills = () => Object.keys(SKILL_REGISTRY).map((name) => ({ name, body: `\n# ${name}\n` }));

test("the vocabulary scan reads every Markdown file in a skill, nested ones included, in path order", () => {
  const root = scratchRoot("vocabulary-walk");
  try {
    const pluginDir = writePluginFixture(root, {
      skills: [
        {
          name: "how",
          body: "\n# How\n",
          files: { "references/z.md": "z\n", "references/a/deep.md": "deep\n", "scripts/run.sh": "Bugbot\n" },
        },
      ],
    });
    const dir = join(pluginDir, "skills", "how");
    const files = skillMarkdown("how", dir, join(dir, "SKILL.md"));
    assert.deepEqual(files.map((f) => f.path), ["SKILL.md", "references/a/deep.md", "references/z.md"]);
    assert.ok(files.every((f) => f.skill === "how"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Windows needs privileges or Developer Mode for symbolic links, so this case runs on POSIX only.
const symlinkSkip = process.platform === "win32" && "creating a symbolic link needs Developer Mode or an administrator on Windows";
test("the vocabulary scan does not follow a symbolic link out of the skill", { skip: symlinkSkip }, () => {
  const root = scratchRoot("vocabulary-link");
  try {
    const pluginDir = writePluginFixture(root, { skills: [{ name: "how", body: "\n# How\n" }] });
    mkdirSync(join(root, "outside"));
    writeFileSync(join(root, "outside", "secret.md"), "Bugbot\n");
    symlinkSync(join(root, "outside", "secret.md"), join(pluginDir, "skills", "how", "linked.md"));
    symlinkSync(join(root, "outside"), join(pluginDir, "skills", "how", "linked-dir"));
    const dir = join(pluginDir, "skills", "how");
    assert.deepEqual(skillMarkdown("how", dir, join(dir, "SKILL.md")).map((f) => f.path), ["SKILL.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the certification probe scans a symbolic-link SKILL.md, because generation reads its target", { skip: symlinkSkip }, () => {
  const root = scratchRoot("vocabulary-entry-link");
  try {
    const pluginDir = writePluginFixture(root, { skills: registrySkills() });
    writeFileSync(join(root, "outside.md"), "---\nname: how\ndescription: Linked entry.\n---\n\n# how\n\nUse FakeCursorTool.\n");
    const entry = join(pluginDir, "skills", "how", "SKILL.md");
    rmSync(entry);
    symlinkSync(join(root, "outside.md"), entry);
    const terms = [...CURSOR_TERMS, { key: "`FakeCursorTool`", pattern: /FakeCursorTool/ }];
    const report = probe(pluginDir, COMMIT, join(root, "cache"), terms);
    assert.equal(report.ok, false);
    assert.deepEqual(report.diagnostics.filter((d) => d.resource.startsWith("host-mapping:")).map((d) => d.message.match(/skills? (`[^`]+`)/)?.[1]), ["`how`"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the certification probe fails on a Cursor term with no host mapping row, and ignores replaced skills", () => {
  const root = scratchRoot("vocabulary-probe");
  try {
    const skills = registrySkills().map((skill) => {
      if (skill.name === "how") return { ...skill, files: { "references/explainer.md": "Use FakeCursorTool.\n" } };
      if (skill.name === "setup-pstack") return { ...skill, body: "\n# setup\n\nFakeCursorTool and Bugbot.\n" };
      if (skill.name === "swarm") return { ...skill, body: '\n# swarm\n\nUse `environment: "local"` and Bugbot.\n' };
      return skill;
    });
    const pluginDir = writePluginFixture(root, { skills });

    const mapped = probe(pluginDir, COMMIT, join(root, "cache-mapped"));
    assert.equal(mapped.ok, true, JSON.stringify(mapped.diagnostics));
    assert.deepEqual(mapped.diagnostics, [], "every certified term has a row");

    const terms = [...CURSOR_TERMS, { key: "`FakeCursorTool`", pattern: /FakeCursorTool/ }];
    const report = probe(pluginDir, COMMIT, join(root, "cache-unmapped"), terms);
    assert.equal(report.ok, false);
    assert.deepEqual(report.diagnostics.map((d) => d.resource), ["host-mapping:`FakeCursorTool`"]);
    assert.match(report.diagnostics[0]?.message ?? "", /Upstream skill `how` uses the Cursor term `FakeCursorTool`/);
    assert.doesNotMatch(report.diagnostics[0]?.message ?? "", /setup-pstack/, "Pi never sees a replaced body");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
