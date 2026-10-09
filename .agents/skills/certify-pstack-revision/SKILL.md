---
name: certify-pstack-revision
description: Certify a new upstream pstack revision in pi-pstack-adapter. Use when pstack has updated, upstream added or removed skills, or the certified commit in src/certified.ts must move.
---

# Certify a new pstack revision

Certification is a verification claim: every upstream skill at the new commit has a reviewed support tier, and each tier rests on evidence. `AGENTS.md` and `docs/compatibility.md` own the contract and the tier rules; this skill is the procedure that satisfies them. The pstack 0.15.2 → 0.15.9 bump (PR #3) is the worked example.

## Files that move together

| file | change |
| --- | --- |
| `src/certified.ts` | `commit`, `pstackVersion`, `skillCount`, `agentCount` |
| `src/registry.ts` | one `SKILL_REGISTRY` entry per upstream skill: `tier`, `capabilities`, `executables`, `note` |
| `docs/compatibility.md` | certified-revision line, per-tier tables and their counts, Windows evidence |
| `test/host.test.ts` | literal certified commit in the status-report test |
| `test/generate.test.ts` | a tier test for the skills new in this revision |
| `src/generate.ts` | `hostMappingDocument`, only when upstream introduces new Cursor vocabulary |

release-please owns `CHANGELOG.md`, `VERSION`, and the version fields. Leave them alone; the PR title `feat(pstack): certify pstack <version> ...` produces the release.

## Steps

1. **Inventory upstream.** `C=$(ls -d ~/.pi/agent/cache/pi-pstack-adapter/checkouts/*/)`, then `git -C $C fetch origin main`. Read the new version from `git -C $C show origin/main:pstack/.cursor-plugin/plugin.json`, and list changes with `git -C $C diff --name-status <old> <new> -- pstack`. Count `pstack/skills/` and `pstack/agents/` at the new commit. Done when you can name every added, removed, and changed skill and agent.

2. **Export the tree.** The cache checkout is a partial clone, so `git clone` from it fails with `fetch-pack: invalid index-pack output`. Use `git -C $C archive <new> pstack | tar -x -C /tmp/pstack-new`.

3. **Baseline.** Run `npm ci` if `node_modules` is missing, then `npm run check` and `npm test`; both green before any edit. Probe the new tree with the unchanged adapter:
   ```bash
   node --experimental-strip-types --no-warnings .agents/skills/certify-pstack-revision/scripts/probe.ts /tmp/pstack-new/pstack <new> /tmp/probe-before
   ```
   New skills show as `info` diagnostics, removed ones as `warning`.

4. **Read upstream.** Read every new skill body in full, including its scripts. Read the diff of every changed skill and agent (`git -C $C diff <old> <new> -- pstack/agents 'pstack/skills/*/SKILL.md'`). Hunt for new host machinery: Cursor tools, delegation, transcripts, structured questions, new executables, model slugs, role values. Done when every changed file has a verdict: tier unchanged, tier changed, or mapping change needed.

5. **Classify.** Assign each new skill a tier by the definitions in `docs/compatibility.md`; unknown skills start `experimental` until a Pi run supports more.
   - Any executable a body runs unconditionally is a requirement in `executables`, even when it looks incidental. `benchmark-checklist` was first marked `native` and review caught that its setup runs `uptime` and `nproc` (absent on stock macOS, `uptime` absent in Git for Windows), so it is `dependency-gated`.
   - A prerequisite reached only through a hand-off to another skill goes in that skill's `note`, naming the other skill's check. `principle-explain-the-number` points at `benchmark-checklist`'s prerequisites this way.
   - State a write footprint in the `note` when a skill commits (`correct` lands one commit per mistake class).
   - Gate only on installed executables and capabilities. Prerequisite checks cannot test write access, so a committing skill needs no extra gate.

6. **Map new vocabulary.** When upstream adds role values or role-line names, extend `hostMappingDocument`. 0.15.9 added `auto` and `inherit-parent` (omit `model`, use the parent) and role lines mapped to adapter roles: `hardest tasks` → `strongest-judgment`, `judgment and prose` → `judgment`. Map named roles explicitly; an unmapped role line silently inherits the parent model. The mapping text is part of the generation cache digest, so edits regenerate wrappers.

7. **Edit together.** Update every file in the table above in one change. Keep docs table counts equal to the registry.

8. **Verify.** All of these, at the final head:
   - `npm run check` and `npm test` pass. The test `the registry classifies every skill in the certified revision` fails if `CERTIFIED.skillCount` and the registry disagree.
   - Re-run `probe.ts` into a fresh cache root: no diagnostics, skill count = upstream skills + adapter skills, every non-replaced upstream body byte-identical, `mismatched` empty.
   - `npm run test:isolated` prints `PASS: <n> skills`. It derives `<n>` from the packed package, so a missing file in the tarball fails it.
   - **End-to-end run per new skill.** Keep the sandbox with `bash test/isolated-install.sh --keep` and set `R` to the path it prints after `kept:`. Build a small fixture repo that gives the skill something real to find, then run:
     ```bash
     cd <fixture> && PI_CODING_AGENT_DIR=$R/pi PISTACK_CACHE_DIR=$R/cache timeout 900 pi -p '/skill:pistack-<name> <task>'
     ```
     Record what the workflow produced, not that it started. Pass only real `pi` flags; an unknown flag kills the run at once. Prior fixtures live in `/tmp/pstack-e2e` when still present.
   - Confirm a new gate in the installed package: `/pistack-check pistack-<name>` names the missing executable.
   - Windows is certified. When a new skill needs an executable, state in `docs/compatibility.md` whether Git for Windows bundles it.

9. **Review, then PR.** Before pushing, run two fresh reviews in parallel through subagents on a model family other than yours: an adversarial code review (correctness, acceptance against this procedure, gaps) and a security review against the five properties in `AGENTS.md`. Hand reviewers the diff range, the exported tree path, and the upstream diff command; keep them read-only. The security question that matters for a bump: users on the default source move to new content trusted as `tested`, and the old pinned commit must now report `untested-ref`. Then follow `create-pr`; this repo triggers CodeRabbit with the `coderabbit-review` label, and its first review takes 20+ minutes.

## Known gaps to carry forward

Re-check these on each bump and say whether they changed:

- Delegating skills have no end-to-end run, because the isolated install has no subagent provider. Report that no tier for them changed, or run them in a session with a provider.
- `show-me-your-work`'s transcript audit has no Pi equivalent.
- The host mapping has no row for Cursor `/loop` or `/goal`.

## Report

Lead with the new version and commit, then: new, removed, and changed skills with tiers and reasons; mapping changes; the verification results with counts; what each end-to-end run found; and the open gaps. Name anything not run.
