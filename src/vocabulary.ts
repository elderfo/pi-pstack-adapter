import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Diagnostic } from "./types.ts";

/**
 * A Cursor name that an upstream body can use. `key` must appear in the Cursor column of a
 * host mapping row, so deleting the row, or adding a term without one, fails certification.
 */
export interface CursorTerm {
  readonly key: string;
  readonly pattern: RegExp;
}

/**
 * Ported from the `TERMS` list in upstream's `scripts/generate-pstack-harness-trees.mjs`, which
 * fails when a skill uses a term that `pstack/docs/harness/claude-code.md` has no row for. The
 * keys name this adapter's rows. Upstream's single "Cursor-only features" term is split into one
 * term per feature, and the terms after it cover rows upstream does not scan for.
 */
export const CURSOR_TERMS: readonly CursorTerm[] = [
  { key: "`Task` tool", pattern: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", pattern: /AskQuestion/ },
  { key: "todolist", pattern: /\btodo ?list\b/i },
  { key: "`subagent_type: generalPurpose`", pattern: /generalPurpose/ },
  { key: "`poteto-agent`", pattern: /poteto-agent/ },
  { key: "`comment-sicko`", pattern: /comment-sicko/ },
  { key: "`readonly: true`", pattern: /readonly: true|readonly\/Ask/ },
  { key: "`readonly: false`", pattern: /readonly: false/ },
  { key: "`environment: \"cloud\"`", pattern: /environment: "cloud"/ },
  { key: "`environment: \"local\"`", pattern: /environment: "local"/ },
  { key: "`cloud_base_branch`", pattern: /cloud_base_branch/ },
  { key: "`run_in_background: true`", pattern: /run_in_background/ },
  { key: "`resume`", pattern: /`resume`/ },
  { key: "`file_attachments`", pattern: /file_attachments/ },
  { key: "`claude-opus-5-5-xhigh`", pattern: /\bclaude-[a-z]+-\d/ },
  { key: "`grok-4.7-xhigh-fast`", pattern: /\bgrok-\d/ },
  { key: "`gpt-*`", pattern: /\bgpt-\d/ },
  { key: "`inherit-parent`", pattern: /inherit-parent/ },
  { key: "`~/.cursor/rules/pstack-models.mdc`", pattern: /pstack-models\.mdc/ },
  { key: "`.cursor/skills/`", pattern: /\.cursor\/skills/ },
  { key: "`~/.cursor/plugins/`", pattern: /\.cursor\/plugins|\.cursor-plugin/ },
  // pstack-models.mdc has its own row, so it does not count as a use of the general rule row.
  { key: "`.cursor/rules/*.mdc`", pattern: /\.cursor\/rules(?!\/pstack-models\.mdc)|always-applied rule/ },
  { key: "agent-transcripts", pattern: /agent-transcripts|\.cursor\/projects/ },
  { key: "Bugbot", pattern: /Bugbot/ },
  { key: "Cursor Automations", pattern: /Cursor [Aa]utomation|cursor\.(sh|com)\/automations/ },
  { key: "Cursor cloud agents", pattern: /[Cc]loud [Aa]gent/ },
  { key: "a built-in PR tool", pattern: /built-in PR tool/i },
  { key: "`Grep`, `Glob`", pattern: /\bGrep\b|\bGlob\b/ },
  { key: "`AskUserQuestion`", pattern: /AskUserQuestion/ },
  { key: "`TodoWrite`", pattern: /TodoWrite|TaskCreate|TaskUpdate/ },
  { key: "`/visualize`", pattern: /\/visualize\b/ },
  { key: "a skill under `plugins/cache/`", pattern: /plugins\/cache\// },
  { key: "a Custom Mode", pattern: /Custom Mode/ },
];

/** One upstream Markdown file, named by its skill and its path inside the skill directory. */
export interface SkillMarkdown {
  readonly skill: string;
  readonly path: string;
  readonly text: string;
}

/**
 * Every Markdown file under a skill directory, in sorted path order. Symbolic links below `dir`
 * are not followed, as generation skips them when it copies support files. `dir` itself comes
 * from discovery, which lists only real directories, not symbolic links, under the manifest's
 * skills directory.
 */
export function skillMarkdown(skill: string, dir: string): SkillMarkdown[] {
  const files: SkillMarkdown[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push({ skill, path: relative(dir, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
      }
    }
  };
  visit(dir);
  return files;
}

/** The Cursor column of every table row in a host mapping document. */
export function mappedCursorNames(mapping: string): string[] {
  return mapping
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| ") && !/^\| [-\s|]+$/.test(line))
    .map((line) => {
      const end = line.indexOf(" | ", 1);
      return end < 0 ? line.slice(2) : line.slice(2, end);
    });
}

/**
 * One warning per term that an upstream skill uses and no host mapping row names, in term order
 * with skills sorted, so a revision with new Cursor vocabulary fails certification.
 */
export function vocabularyDiagnostics(
  files: readonly SkillMarkdown[],
  mapping: string,
  terms: readonly CursorTerm[] = CURSOR_TERMS,
): Diagnostic[] {
  const cursorColumn = mappedCursorNames(mapping);
  const diagnostics: Diagnostic[] = [];
  for (const term of terms) {
    if (cursorColumn.some((cell) => cell.includes(term.key))) continue;
    const skills = [...new Set(files.filter((file) => term.pattern.test(file.text)).map((file) => file.skill))].sort();
    if (skills.length === 0) continue;
    diagnostics.push({
      level: "warning",
      resource: `host-mapping:${term.key}`,
      message: `Upstream ${skills.length === 1 ? "skill" : "skills"} ${skills.map((name) => `\`${name}\``).join(", ")} ${skills.length === 1 ? "uses" : "use"} the Cursor term ${term.key}, but no host mapping row names it in its Cursor column, so Pi would have to guess what it means.`,
      action: `Read what the term means in those skills and in upstream's pstack/docs/harness/claude-code.md at this commit, then add a row that names ${term.key} to hostMappingDocument in src/generate.ts and rerun the probe.`,
    });
  }
  return diagnostics;
}
