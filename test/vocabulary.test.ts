import assert from "node:assert/strict";
import { test } from "node:test";
import { hostMappingDocument } from "../src/generate.ts";
import { CURSOR_TERMS, mappedCursorNames, vocabularyDiagnostics, type CursorTerm, type SkillMarkdown } from "../src/vocabulary.ts";

const file = (skill: string, text: string, path = "SKILL.md"): SkillMarkdown => ({ skill, path, text });

test("every Cursor term has a host mapping row that names it in the Cursor column, for both backend orders", () => {
  for (const delegation of ["t3", "pi-subagents"] as const) {
    const column = mappedCursorNames(hostMappingDocument("pistack", delegation));
    for (const term of CURSOR_TERMS) {
      assert.ok(column.some((cell) => cell.includes(term.key)), `${delegation}: no row names ${term.key}`);
    }
  }
  const keys = CURSOR_TERMS.map((term) => term.key);
  assert.equal(new Set(keys).size, keys.length, "term keys are unique");
});

test("every Cursor term matches the upstream wording it was ported for", () => {
  // Phrases from pstack 0.15.34 skills, plus upstream's own TERMS alternatives.
  const examples: Readonly<Record<string, readonly string[]>> = {
    "`Task` tool": ["Spawn `Task` with", "Every spawn is a Task subagent", "one Task call"],
    "`AskQuestion`": ["use AskQuestion"],
    todolist: ["Open a todolist with one entry", "opens a todo list"],
    "`subagent_type: generalPurpose`": ["`subagent_type: generalPurpose`"],
    "`poteto-agent`": ['subagent_type: "poteto-agent"'],
    "`comment-sicko`": ['subagent_type: "comment-sicko"'],
    "`readonly: true`": ["`readonly: true`", "Do not use readonly/Ask mode."],
    "`readonly: false`": ["agent mode (`readonly: false`)"],
    "`environment: \"cloud\"`": ['`environment: "cloud"`'],
    "`environment: \"local\"`": ['Use `environment: "local"` only when'],
    "`cloud_base_branch`": ["cloud_base_branch"],
    "`run_in_background: true`": ["`run_in_background: true`"],
    "`resume`": ["pass `resume` with the agent id"],
    "`file_attachments`": ["file_attachments"],
    "`claude-opus-5-5-xhigh`": ["default `claude-opus-5-5-xhigh`"],
    "`grok-4.7-xhigh-fast`": ["default `grok-4.7-xhigh-fast`"],
    "`gpt-*`": ["gpt-5.6-sol-max"],
    "`inherit-parent`": ["`auto` or `inherit-parent`"],
    "`~/.cursor/rules/pstack-models.mdc`": ["`~/.cursor/rules/pstack-models.mdc`"],
    "`.cursor/skills/`": ["under `.cursor/skills/`"],
    "`~/.cursor/plugins/`": ["`~/.cursor/plugins/`", ".cursor-plugin/plugin.json"],
    ".cursor/rules/": [".cursor/rules/team.mdc", "writes an always-applied rule"],
    "agent-transcripts": ["the `agent-transcripts/` directory", "~/.cursor/projects/<slug>/"],
    Bugbot: ["Triage every Bugbot comment"],
    "Cursor Automations": ["a Cursor Automation routine", "api2.cursor.sh/automations"],
    "Cursor cloud agents": ["each a Cursor cloud agent", "run them as cloud agents"],
    "a built-in PR tool": ["Use the run's built-in PR tool", "**Built-in PR tool.**"],
    "`Grep`, `Glob`": ["Use Read, Grep, and Glob as needed."],
    "`AskUserQuestion`": ["AskUserQuestion"],
    "`TodoWrite`": ["TodoWrite", "TaskCreate"],
    "`/visualize`": ["run `/visualize`"],
    "a skill under `plugins/cache/`": ["a skill under plugins/cache/"],
    "a Custom Mode": ["a Custom Mode"],
  };
  assert.deepEqual(Object.keys(examples).sort(), CURSOR_TERMS.map((term) => term.key).sort(), "one example list per term");
  for (const term of CURSOR_TERMS) {
    for (const example of examples[term.key] ?? []) assert.match(example, term.pattern, `${term.key}: ${example}`);
  }
  const grep = CURSOR_TERMS.find((term) => term.key === "`Grep`, `Glob`");
  assert.doesNotMatch("grep the topic first", grep?.pattern ?? /$^/, "a lowercase shell grep is not the Cursor tool");
});

test("the vocabulary scan names an unmapped term, every skill that uses it, and the next step", () => {
  const terms: readonly CursorTerm[] = [
    { key: "`Unmapped`", pattern: /Unmapped/ },
    { key: "`Mapped`", pattern: /\bMapped\b/ },
    { key: "`Unused`", pattern: /Unused/ },
  ];
  const mapping = "| pstack / Cursor | Pi equivalent |\n| --- | --- |\n| `Mapped` | done. `Unmapped` here is in the Pi column. |\n";
  const files = [
    file("zeta", "Call Unmapped."),
    file("alpha", "Call Mapped and Unmapped.", "references/prompt.md"),
    file("alpha", "Unmapped again."),
  ];
  const diagnostics = vocabularyDiagnostics(files, mapping, terms);

  assert.equal(diagnostics.length, 1, "a mapped term and an unused term report nothing");
  const [diagnostic] = diagnostics;
  assert.equal(diagnostic?.level, "warning", "a warning fails the certification probe");
  assert.equal(diagnostic?.resource, "host-mapping:`Unmapped`");
  assert.match(diagnostic?.message ?? "", /Upstream skills `alpha`, `zeta` use the Cursor term `Unmapped`, but no host mapping row names it in its Cursor column/);
  assert.match(diagnostic?.action ?? "", /add a row that names `Unmapped` to hostMappingDocument in src\/generate\.ts and rerun the probe/);
  assert.match(diagnostic?.action ?? "", /pstack\/docs\/harness\/claude-code\.md at this commit/);
});

test("the vocabulary scan reports terms in list order whatever order the files arrive in", () => {
  const terms: readonly CursorTerm[] = [
    { key: "`B`", pattern: /\bB\b/ },
    { key: "`A`", pattern: /\bA\b/ },
  ];
  const forward = vocabularyDiagnostics([file("one", "A"), file("two", "B")], "", terms);
  const backward = vocabularyDiagnostics([file("two", "B"), file("one", "A")], "", terms);
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.map((d) => d.resource), ["host-mapping:`B`", "host-mapping:`A`"]);
  assert.match(forward[0]?.message ?? "", /Upstream skill `two` uses the Cursor term/);
});

test("the host mapping's Cursor column is the first cell of each table row, header and separator aside", () => {
  const mapping = "intro | not a row\n| pstack / Cursor | Pi equivalent |\n| --- | --- |\n| `X`, `Y` | z \\| w |\r\n| `Q` | r |\n";
  assert.deepEqual(mappedCursorNames(mapping), ["pstack / Cursor", "`X`, `Y`", "`Q`"]);
});
