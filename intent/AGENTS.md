# Intents

This folder holds intents: one-page proto-specs that start a change by
recording the problem, proposed outcome, affected users and systems,
constraints, and open questions in the originator's terms. Specs and plans
are written elsewhere, later.

## Layout

Each intent is a `<NNNN>-<slug>/` folder holding `intent.md` and optional
companion docs such as `technical-notes.md`. The folder sits under the status
folder that matches its `Status:` line: `draft/`, `approved/`,
`in-progress/` or `implemented/`. Numbers are unique across all four; never
renumber or reuse one.

## Rules

- Refer to an intent by its folder name alone, such as
  `0012-water-shoreline` or `0012-water-shoreline/technical-notes.md`. Never
  write a path or link through `intent/<status>/`.
- To find an intent, run `find intent -mindepth 2 -maxdepth 2 -name '<name>'`.
- When an intent's status changes, update its `Status:` line and `git mv` its
  folder to the matching status folder in the same commit.
- Only the product owner sets `approved`. `in-progress` and `implemented`
  follow evidence such as merged pull requests; cite it on the `Status:`
  line.
- Open questions stay open until the originator settles them.
- Use the `intent-md` skill, when installed, to draft, critique, revise, or
  change the status of an intent.
