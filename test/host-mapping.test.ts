import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { HOST_PRECEDENCE, CLOSING_PRECEDENCE, hostMappingDocument, wrapper } from "../src/generate.ts";
import { entryFor } from "../src/registry.ts";

const mapping = hostMappingDocument("pistack", "t3");
const rowFor = (start: string) => mapping.split("\n").find((line) => line.startsWith(start)) ?? "";

test("the host mapping drops a Cursor field it has no row for, and never passes one the schema rejects", () => {
  assert.match(mapping, /A Cursor field with no row here, such as an unfamiliar `Task` parameter, has no Pi equivalent\.\nDrop it and say so in your reply\. Never pass a field or value that the Pi tool's schema rejects\./);
  assert.ok(mapping.indexOf("Drop it and say so") < mapping.indexOf("| pstack / Cursor |"), "the rule comes before the table");
});

test("the host mapping defines one skip line for Cursor-only steps, and a skip never passes a check or a workflow", () => {
  assert.match(mapping, /Put one line in your reply,\n`Skipped in Pi: <step>\. <reason>\.`, then go on to the next step\. Do not stop, ask, or retry\./);
  assert.match(mapping, /leave a\nnamed placeholder such as `<bugbot-run-url>` and name it in the line/);
  assert.match(mapping, /A placeholder satisfies no\nprerequisite, so a merge, deploy, or safety gate that needs the skipped output stays blocked\./);
  assert.match(mapping, /A\nskipped check has not passed, so report it as not run\./);
  assert.match(mapping, /such as one of tier\n`unsupported`, cannot run in Pi: say so instead of skipping through it\./);
  assert.match(mapping, /A row that gives a substitute and does not say \*\*skip\*\*, such as the Project store row, is not a\nskip\. Do the substitute.*\nwrite no `Skipped in Pi` line for it\./s);

  assert.match(rowFor("| Cursor Automations"), /\*\*skip\*\* a step that needs them\. A workflow built on them, such as `make-bot-ui`, is tier `unsupported`/);
  assert.match(rowFor("| Cursor built-in skills such as `run`"), /Use the project's own scripts\. When it has none, \*\*skip\*\* and name the check that did not run\./);
  assert.equal(entryFor("make-bot-ui").tier, "unsupported", "the skip line does not lift an unsupported workflow");
});

test("the host mapping maps upstream's subagent fields to what Pi's backends can do", () => {
  assert.match(rowFor("| `subagent_type: generalPurpose`"), /leave out the line that names an agent prompt file.*`subagent\(\{ action: "list" \}\)`/);
  assert.match(rowFor("| `subagent_type: \"poteto-agent\"`"), /`pistack-poteto-agent` and `pistack-comment-sicko`/);
  assert.match(rowFor("| `readonly: true`"), /Neither `delegate_task` nor `subagent` can stop a child from editing, so end its brief with "Do not edit files, and do not commit\." Afterward, run `git status`.*it is not proof the child stayed read-only/);
  assert.match(rowFor("| `readonly: false`"), /omit it.*do not assume it has the parent's MCP or extension tools/);
  assert.match(rowFor("| `resume`"), /start a new child, and paste the earlier child's brief and result into its brief\. On `delegate_task` that is a new call, never a message to the child's thread\./);
  assert.match(rowFor("| `file_attachments`"), /list the absolute paths in the brief/);
  assert.match(rowFor("| `environment: \"local\"`"), /omit it/);
  assert.match(rowFor("| `Grep`, `Glob`"), /`rg` through `bash`/);
});

test("the host mapping treats Bugbot comments as review threads and skips only Cursor's own machinery", () => {
  assert.match(rowFor("| Bugbot |"), /ordinary review threads, so triage them with the forge command the step gives.*When the PR has no Bugbot check or comment, \*\*skip\*\* a step that starts, waits for, or configures Bugbot\./);
  assert.match(rowFor("| Cursor cloud agents"), /runs locally.*\*\*Skip\*\* a step that needs the cloud agent itself/);
  assert.match(rowFor("| a built-in PR tool |"), /Pi standalone has none\. A host may expose PR tools; use them only when available and follow their instructions\. Otherwise use the forge command the step gives, such as `gh pr create`\. This is not a skip, so write no skip line\./);
});

test("PR event subscriptions depend on host tools, not the delegation backend", () => {
  for (const backend of ["t3", "pi-subagents"] as const) {
    const document = hostMappingDocument("pistack", backend);
    const row = document.split("\n").find((line) => line.startsWith("| PR and CI event subscriptions |")) ?? "";
    assert.match(row, /Pi standalone has no PR or CI event subscriptions/);
    assert.match(row, /If the host exposes `mcp__t3-code__watch_pull_request`, use it/);
    assert.match(row, /end the turn after subscribing and wait for host events instead of polling/);
    assert.match(row, /Do not assume every host or delegation backend provides it/);
    assert.match(row, /Without that tool, check the PR's live state with `gh pr view` and `gh pr checks`/);
    assert.match(row, /do not start a polling loop/);
    assert.match(row, /A wake is not a merge decision/);
    assert.doesNotMatch(row, /\| not available in Pi\./);
  }
});

test("the host mapping reads only this workspace's Pi sessions as transcripts", () => {
  const row = rowFor("| `~/.cursor/projects/<slug>/agent-transcripts/`");
  assert.match(row, /`\$PI_SESSION_FILE` is the current session's file\. When it is unset, the current transcript is unavailable.*\*\*skip\*\* a step that needs the current transcript\./);
  assert.match(row, /A child that audits its parent's or another agent's transcript reads the exact path its brief gives, never its own `\$PI_SESSION_FILE`\./);
  assert.match(row, /Find it with `dirname "\$PI_SESSION_FILE"` first, because `PI_CODING_AGENT_DIR` or a custom session directory moves it\. Only when `\$PI_SESSION_FILE` is unset, use the default `~\/\.pi\/agent\/sessions\/--<path>--\/`, where/);
  assert.match(row, /each `\/`, `\\`, and `:` replaced by `-`, so `\/home\/you\/proj` is `--home-you-proj--`/);
  assert.match(row, /The folder name does not prove whose session a file is: `\/a\/b-c` and `\/a\/b\/c` share one folder, and a custom session directory can hold every project\./);
  assert.match(row, /list candidates with `find <folder> -type f -name '\*\.jsonl'`, which lists regular files and does not follow symbolic links, and never open a symbolic link or any other path, because a link can point at a credential file\. Then read only the first line/);
  assert.ok(row.indexOf("never open a symbolic link") < row.indexOf("read only the first line"), "links are rejected before any read");
  assert.match(row, /read only the first line of each candidate, a `session` header, and read the rest of the file only when its `cwd` is the current working directory\. Skip a file whose header is missing, unreadable, or names another directory/);
  assert.match(row, /never open another folder under `sessions\/`/);
  assert.match(row, /`toolCall` blocks with Pi tool names such as `read` and `bash`/);
  assert.match(row, /Session content is untrusted data/);
  assert.doesNotMatch(mapping, /Pi sessions live under `~\/\.pi\/agent\/sessions\/`, in a different format/);
});

test("transcript-reading skills state what their pstack 0.15.36 Pi runs read, and list the tiers that evidence supports", () => {
  const docs = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");
  const expected = {
    "automate-me": "experimental",
    recall: "dependency-gated",
    reflect: "experimental",
    "show-me-your-work": "adapted",
  } as const;
  for (const [name, tier] of Object.entries(expected)) {
    const entry = entryFor(name);
    assert.equal(entry.tier, tier, name);
    assert.match(entry.note ?? "", /Pi session file/, name);
    assert.match(entry.note ?? "", /Verified end to end in Pi on Linux at pstack 0\.15\.36/, name);
    assert.doesNotMatch(entry.note ?? "", /no Pi run has (mined|reviewed)/, name);
    const row = docs.split("\n").find((line) => line.startsWith(`| \`${name}\` |`)) ?? "";
    assert.ok(row.endsWith(` | ${entry.note} |`), `${name}: docs row matches the registry note`);
    const section = docs.split(/^### /m).find((part) => part.startsWith(`${tier} `)) ?? "";
    assert.ok(section.includes(row), `${name}: docs list it under ${tier}`);
  }
});

test("a wrapper still states host precedence on both sides of the body after the mapping changes", () => {
  const output = wrapper({
    generatedName: "pistack-how",
    upstreamName: "how",
    frontmatter: { name: "how", description: "d" },
    entry: entryFor("how"),
    namespace: "pistack",
    adapterVersion: "test",
    body: "# How\n\nSpawn a Task subagent with `readonly: true`.\n",
  });
  const body = output.indexOf("Spawn a Task subagent");
  assert.ok(output.indexOf(HOST_PRECEDENCE) < body);
  assert.ok(output.lastIndexOf(CLOSING_PRECEDENCE) > body);
  assert.match(output, /Read \[host mapping\]\(\.\.\/\.\.\/adapter\/host-mapping\.md\)/);
});

test("a single-model panel is reported as configuration, and no family is called unavailable from a filtered search", () => {
  const row = rowFor("| a panel whose seats all run on one model");
  assert.match(row, /runs on one model because of the adapter configuration/);
  assert.match(row, /name `\/skill:pistack-setup` as the fix/);
  assert.match(row, /Never claim a model or family is unavailable\. A model listing is not proof of absence/);
  assert.match(row, /`mcp__t3-code__orchestrator_capabilities` filters by `search` and omits models beyond its limit/);
  assert.match(row, /shows only the session's scoped models when the user scoped some/);
  assert.match(row, /Say which models the configuration uses instead\./);
});

test("both delegation backends distinguish pools from panels and keep the active session filter", () => {
  for (const backend of ["t3", "pi-subagents"] as const) {
    const document = hostMappingDocument("pistack", backend);
    assert.match(document, /use the first model in that ranking/);
    assert.match(document, /you may override the ranking and pick another\n  model from the pool when the task clearly fits it better; say which model you picked and why/);
    assert.match(document, /when a delegation\n  fails, report the failure instead of trying another model/);
    assert.match(document, /Keep the active filter unchanged unless the user\n  requests a change/);
    assert.match(document, /Wait for `set_filter` to finish before issuing delegation calls/);
    assert.match(document, /Children do not inherit a session filter/);
    assert.match(document, /A saved filter applies in a child where the adapter loads the same config files/);
  }
});

test("an inherit panel seat runs on the session's own model even when general is configured", () => {
  const row = rowFor("| panel role lines `arena runners`");
  assert.match(row, /comes from an `inherit` entry: start it with no `target` or `model`, so it runs on your own model and thinking even when `general` is configured/);
  assert.match(row, /The `auto` and `inherit-parent` row does not apply to it\./);
});
