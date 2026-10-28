import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { entryFor } from "../src/registry.ts";

test("the Windows-verified formal verification workflow is adapted without unconditional prerequisites", () => {
  const entry = entryFor("create-formal-verification-skill");
  assert.equal(entry.tier, "adapted");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, []);
  assert.match(entry.note ?? "", /Manual invocation only; no delegation/);
  assert.match(entry.note ?? "", /temporarily breaks product code/);
  assert.match(entry.note ?? "", /`\.pi\/skills\/` in Pi/);
  assert.match(entry.note ?? "", /other toolchains need their own prerequisites/);
});

test("the Windows-verified formal verification maintenance workflow is dependency-gated on git", () => {
  const entry = entryFor("maintain-formal-verification-skill");
  assert.equal(entry.tier, "dependency-gated");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, ["git"]);
  assert.match(entry.note ?? "", /Verified end to end on a Windows Node finite-state fixture/);
  assert.match(entry.note ?? "", /temporarily breaks product code/);
  assert.match(entry.note ?? "", /`\.pi\/skills\/`/);
});

test("sharpen is native after its pstack 0.15.36 end-to-end run returned a rewritten prompt", () => {
  const entry = entryFor("sharpen");
  assert.equal(entry.tier, "native");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, []);
  assert.match(entry.note ?? "", /^Verified end to end in Pi on Linux at pstack 0\.15\.36: .*did not start the task\./);
  assert.doesNotMatch(entry.note ?? "", /not yet run end to end/);
  assert.match(entry.note ?? "", /hands back a rewritten prompt and does not do the task/);
  assert.equal(docsRow("sharpen"), `| \`sharpen\` | \`/skill:pistack-sharpen\` | - | - | ${entry.note} |`);
  assert.ok(docsSection("native")?.includes(docsRow("sharpen") ?? "\0"));
});

test("statechart is experimental at pstack 0.15.34 after its native Windows crash, and names its gates and TLC sources", () => {
  const entry = entryFor("statechart");
  assert.equal(entry.tier, "experimental");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, ["node", "sh", "dirname", "sed"]);
  assert.match(entry.note ?? "", /^Lowered from dependency-gated at pstack 0\.15\.34, because its new scripts crash on native Windows/);
  assert.match(entry.note ?? "", /`spawn \/bin\/sh ENOENT`/);
  assert.match(entry.note ?? "", /Verified end to end on a Linux checkout fixture at pstack 0\.15\.34, and again at pstack 0\.15\.36/);
  assert.match(entry.note ?? "", /The launcher does: with only an older Node on PATH, it names the versions it needs and exits 127\./);
  assert.doesNotMatch(entry.note ?? "", /no Pi run has exercised/);
  assert.match(entry.note ?? "", /Node 22\.18 to 22\.x or Node 23\.6 or later, then Bun 1\.1\.5 or later, then Deno 2\.0 or later/);
  assert.match(entry.note ?? "", /`TLA2TOOLS`/);
  assert.match(entry.note ?? "", /TLC 1\.7\.4 and Java temurin-25 from `mise`/);
  assert.match(entry.note ?? "", /`pele@1\.9\.0` with `npm`/);
  assert.match(entry.note ?? "", /new or empty `--out` folder/);
  assert.doesNotMatch(entry.note ?? "", /\.map\.mjs|resvg|mermaid-cli/);
  assert.match(entry.note ?? "", /`--view` module as JavaScript with full process permissions/);
  assert.match(entry.note ?? "", /scratch folder outside the repository/);
  assert.doesNotMatch(entry.note ?? "", /expected to fail/);
  assert.match(entry.note ?? "", /`--ignore-scripts`/);
  assert.match(entry.note ?? "", /does not skip the `mise` lookup or install of Java/);
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  const row = docs.split("\n").find((line) => line.startsWith("| `statechart` |"));
  assert.equal(row, `| \`statechart\` | \`/skill:pistack-statechart\` | - | \`node\`, \`sh\`, \`dirname\`, \`sed\` | ${entry.note} |`);
  const tables = docs.split(/^### /m);
  assert.ok(tables.find((section) => section.startsWith("experimental"))?.includes(row ?? ""));
});

test("ketchup-video, new in pstack 0.15.32, stays experimental with no gates", () => {
  const entry = entryFor("ketchup-video");
  assert.equal(entry.tier, "experimental");
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.executables, []);
  assert.match(entry.note ?? "", /One end-to-end Pi run on native Windows/);
  assert.match(entry.note ?? "", /names no renderer/);
  assert.match(entry.note ?? "", /whether a Pi client plays it inline is unverified/);
  assert.match(entry.note ?? "", /before pstack 0\.15\.36 added subtitles\. Verified end to end in Pi on Linux at pstack 0\.15\.36: .*each subtitle burned into a strip below its slide/);
  assert.doesNotMatch(entry.note ?? "", /The subtitled video has not run in Pi/);
  assert.match(entry.note ?? "", /burns a one-line subtitle into each slide's frames/);
  assert.doesNotMatch(entry.note ?? "", /silent/);
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  const row = docs.split("\n").find((line) => line.startsWith("| `ketchup-video` |"));
  assert.equal(row, `| \`ketchup-video\` | \`/skill:pistack-ketchup-video\` | - | - | ${entry.note} |`);
  const tables = docs.split(/^### /m);
  assert.ok(tables.find((section) => section.startsWith("experimental"))?.includes(row ?? ""));
});

function docsRow(name: string): string | undefined {
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  return docs.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
}

function docsSection(tier: string): string | undefined {
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  return docs.split(/^### /m).find((section) => section.startsWith(`${tier} (`));
}

test("arena is adapted after a pstack 0.15.36 run with a cross-family judge, and states the judge rule in adapter roles", () => {
  const entry = entryFor("arena");
  assert.equal(entry.tier, "adapted");
  assert.match(entry.note ?? "", /Verified end to end in Pi on Linux at pstack 0\.15\.36 with pi-subagents: .*a judge from the family other than the parent's/);
  assert.ok(docsSection("adapted")?.includes(docsRow("arena") ?? "\0"));
  assert.deepEqual(entry.capabilities, ["delegation"]);
  assert.deepEqual(entry.executables, ["git"]);
  assert.match(entry.note ?? "", /judge must come from a model family other than the parent's/);
  assert.match(entry.note ?? "", /`judgment` and `general` roles/);
  assert.match(entry.note ?? "", /skips the judge, picks the base alone/);
  assert.match(entry.note ?? "", /When the parent does not know its model, arena tries the pool in order anyway and says the family check did not run\./);
  assert.equal(docsRow("arena"), `| \`arena\` | \`/skill:pistack-arena\` | \`delegation\` | \`git\` | ${entry.note} |`);
});

test("interrogate is adapted after a pstack 0.15.36 run whose adversaries proved findings on two model families", () => {
  const entry = entryFor("interrogate");
  assert.equal(entry.tier, "adapted");
  assert.match(entry.note ?? "", /Verified end to end in Pi on Linux at pstack 0\.15\.36 with pi-subagents: two adversaries .* from two model families, each in its own worktree/);
  assert.ok(docsSection("adapted")?.includes(docsRow("interrogate") ?? "\0"));
  assert.deepEqual(entry.capabilities, ["delegation"]);
  assert.deepEqual(entry.executables, ["git"]);
  assert.match(entry.note ?? "", /`interrogate reviewers` line/);
  assert.match(entry.note ?? "", /keeps only findings whose command it reruns and sees fail/);
  assert.match(entry.note ?? "", /applies no fixes/);
  assert.match(entry.note ?? "", /A worktree is not a sandbox, so read each repro before it reruns/);
  assert.equal(docsRow("interrogate"), `| \`interrogate\` | \`/skill:pistack-interrogate\` | \`delegation\` | \`git\` | ${entry.note} |`);
});

test("poteto-mode stays experimental and states that Orchestrate has no scripts since pstack 0.15.36", () => {
  const entry = entryFor("poteto-mode");
  assert.equal(entry.tier, "experimental");
  assert.deepEqual(entry.capabilities, ["delegation", "structured-question"]);
  assert.deepEqual(entry.executables, ["git", "gh"]);
  assert.match(entry.note ?? "", /the `orch` helpers are gone/);
  assert.match(entry.note ?? "", /event subscriptions only when the harness has them\. Pi has none\./);
  assert.match(entry.note ?? "", /Project tracker and Project store, and forking a worker with its built state, have no Pi equivalent/);
  assert.match(entry.note ?? "", /Orchestrate ran a two-unit program in a linked worktree.*Its other playbooks and sticky mode were not rerun\./);
  assert.equal(docsRow("poteto-mode"), `| \`poteto-mode\` | \`/skill:pistack-poteto-mode\` | \`delegation\`, \`structured-question\` | \`git\`, \`gh\` | ${entry.note} |`);
});

test("show-me-your-work is adapted after a pstack 0.15.36 run whose cross-family reviewer read the Pi session file", () => {
  const entry = entryFor("show-me-your-work");
  assert.equal(entry.tier, "adapted");
  assert.deepEqual(entry.capabilities, ["delegation"]);
  assert.match(entry.note ?? "", /its reviewer on another model family read the parent's Pi session file/);
  assert.doesNotMatch(entry.note ?? "", /has not run end to end/);
  assert.equal(docsRow("show-me-your-work"), `| \`show-me-your-work\` | \`/skill:pistack-show-me-your-work\` | \`delegation\` | - | ${entry.note} |`);
  assert.ok(docsSection("adapted")?.includes(docsRow("show-me-your-work") ?? "\0"));
});

test("recall is dependency-gated after a pstack 0.15.36 run read Pi session files, and names the fan-out that did not run", () => {
  const entry = entryFor("recall");
  assert.equal(entry.tier, "dependency-gated");
  assert.deepEqual(entry.capabilities, ["delegation"]);
  assert.match(entry.note ?? "", /in a fresh session it found the two earlier chats in the folder that holds `\$PI_SESSION_FILE`, read their user messages/);
  assert.match(entry.note ?? "", /it did not fan out to subagents, and that step has not run in Pi\./);
  assert.ok(docsSection("dependency-gated")?.includes(docsRow("recall") ?? "\0"));
});

test("reflect and automate-me stay experimental, because their create-skill steps have not run in Pi", () => {
  const reflect = entryFor("reflect");
  assert.equal(reflect.tier, "experimental");
  assert.match(reflect.note ?? "", /copied the upstream skill from the plugin directory to a Pi skill location under a new name and edited only the copy/);
  assert.match(reflect.note ?? "", /create-skill routing for a new skill is Cursor-specific and has not run in Pi/);
  const automate = entryFor("automate-me");
  assert.equal(automate.tier, "experimental");
  assert.match(automate.note ?? "", /it read only this workspace's sessions/);
  assert.match(automate.note ?? "", /create-skill skill it drafts with has no Pi equivalent, and that step has not run in Pi/);
  for (const name of ["reflect", "automate-me"]) {
    assert.equal(docsRow(name)?.endsWith(` | ${entryFor(name).note} |`), true, name);
    assert.ok(docsSection("experimental")?.includes(docsRow(name) ?? "\0"), name);
  }
});

test("every tier heading in the docs counts the registry's skills in that tier", async () => {
  const { SKILL_REGISTRY } = await import("../src/registry.ts");
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  for (const tier of ["native", "adapted", "dependency-gated", "experimental", "unsupported"]) {
    const count = Object.values(SKILL_REGISTRY).filter((entry) => entry.tier === tier).length;
    assert.match(docs, new RegExp(`^### ${tier} \\(${count}\\)$`, "m"), tier);
  }
});
