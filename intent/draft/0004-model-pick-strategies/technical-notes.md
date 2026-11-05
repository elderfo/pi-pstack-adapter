# Technical notes: Choose how a pool picks its model

Companion to `intent.md` in this folder. These notes record the interface sketched for pluggable
strategies, how each could stay deterministic, how a Jev strategy could be shaped, and the options
for loading custom strategies. The intent's open questions stay open. The pick function these
build on is described in 0003-code-ranked-pick/technical-notes.md.

## Interface sketch

Option, not a decision:

```ts
interface PickRequest {
  readonly role: string;
  readonly choices: readonly ModelSpec[]; // allowed models only, in ranked order
  readonly task: string;                  // the brief the child will get
  readonly sessionId: string;
  readonly sequence: number;              // nth delegation for this role in this session
}

interface ModelStrategy {
  readonly id: string;      // "ranked", "roundRobin", "random", or a custom id
  readonly version: string; // part of any cache key, so a changed strategy stops reusing old picks
  pickModel(request: PickRequest, signal: AbortSignal): number | Promise<number>; // index into choices
}
```

- `ModelSpec` is the existing type in `src/config.ts`.
- The adapter checks the returned index. An index outside `choices`, a thrown error, or a timeout
  falls back to the ranked pick and is reported, per the intent's constraint.
- Precedence, highest first: an explicit override in the call, the configured strategy, then
  ranked.
- The name `resolveModel` is taken by `GateContext.resolveModel` in `src/gate.ts`.

## Determinism per strategy

| strategy | how it could stay deterministic |
| --- | --- |
| `ranked` | Always the first allowed model. |
| `random` | Seed a generator from a hash of `sessionId`, `role`, and `sequence`. Picks look random across calls but replay the same way. |
| `roundRobin` | A counter per role, recorded in the session the way the session filter is. `sessionFilterFromEntries` in `index.ts` rebuilds that filter from the active branch on `session_start` and `session_tree`, so `/tree` would rewind the counter too. |
| custom, such as Jev | The answer can vary between calls, so cache each pick keyed by a hash of strategy id, version, task, and choices, and record it in the session so a replay reuses it. Whether the cache spans sessions is the intent's first open question. |

## Shaping a Jev strategy

From the `typesafe-ai` skill (`~/.claude/skills/typesafe-ai/SKILL.md`, "Judgments from Jev,
decisions in code"): ask Jev for judgments and keep the decision in code.

- Avoid asking Jev "which model should run this task?".
- Ask about the task instead, for example a Choice for the kind of work (UI, refactor, debugging,
  docs) and a Score for difficulty, then map those answers to a pool entry in a table in code.
- This keeps the routing visible and testable, and lets Jev's answers be cached separately from
  the routing. The same skill notes that the top answer of a Choice is a good default.

## Loading a custom strategy

Options for the intent's second open question:

- Registered by another Pi extension through an event, as `src/agents.ts` registers agents through
  `pi-subagents:runtime-agent-register:v1`, and named in config by id, for example
  `"modelStrategy": "jev-task-router"`. Config never names code, so a project config in a cloned
  repository cannot run code through this setting. An id nobody registered could fall back to
  ranked with a status warning.
- A module path in config. Simpler for one user, but a project config could then run code. Pi
  reads a project config only after the user trusts the project (`ctx.isProjectTrusted()`, checked
  in `index.ts`), so trusting a repository would also mean trusting code it names. The
  repository's `AGENTS.md` lists the security properties a source or loading change must keep.
