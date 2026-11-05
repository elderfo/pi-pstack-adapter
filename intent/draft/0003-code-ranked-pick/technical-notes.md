# Technical notes: Code picks a pool's ranked model

Companion to `intent.md` in this folder. These notes record how pool picks work today, the
mechanism discussed for moving the pick into code, and the seams that keep
0004-model-pick-strategies possible. The intent's open questions stay open.

## How a pool resolves today

- `resolveRole` in `src/pools.ts` returns every pool entry in config order, each marked allowed
  or excluded by the model filter, or a `blocked` or `inherit` result. It does not pick one.
- Its only callers build report text: the `model roles` table (`src/status.ts`, `renderStatus`),
  the `check` report's model policy (`renderModelPolicy` in `src/status.ts`), and an unset
  panel's default seats (`defaultSeats` in `src/pools.ts`).
- The pick itself is made by the delegating agent, from instruction text in
  `MODEL_POLICY_SECTION` (`src/generate.ts`) and `renderModelPolicy`. As of this intent, that text
  says to use the first allowed model and lets the delegating agent override it with a stated
  reason. No code enforces either.
- It is a plain exported function. No config setting, callback, or tool action replaces it.

## Why code cannot pick today

- `gateDelegation` in `src/gate.ts`, called from the `tool_call` handler in `index.ts`, sees a
  `delegate_task` or `subagent` call and its model, or no model. The call names no pstack role, so
  the gate cannot find the pool it belongs to. Today it only applies the model filter.

## Pi lets the adapter rewrite a call

- Pi's `docs/extensions.md`, section `tool_call`: "`event.input` is mutable. Mutate it in place to
  patch tool arguments before execution." Mutations affect the actual execution, later handlers
  see them, and no re-validation runs after the mutation.

## Mechanism discussed

Option, not a decision:

- The delegating agent names a role instead of a model: `target.model: "pstack:<role>"` for T3
  `delegate_task` with `providerInstanceId: "pi"`, or `model: "pstack:<role>"` for `subagent`,
  including per-step models in task lists and chains.
- The gate resolves the role through `resolveRole`, takes the first allowed entry, and rewrites the
  call to that model and its thinking (`target.options.thinking` on T3, `provider/model:level` on
  pi-subagents).
- An override is written `pstack:<role>@<provider/model>`. The gate accepts it only when the model
  is in that role's pool and the filter allows it.
- A blocked role is blocked in code. An inheriting role drops the model so the child runs on the
  parent's model.
- Generated instructions would tell the agent to always pass `pstack:<role>`, replacing the
  instructions to read the model and thinking columns.

Costs and limits:

- A direct `provider/model` still passes, under the filter only, because the gate cannot tell it is
  a pstack delegation. A strict mode that blocks direct models during a pstack workflow is the
  first open question; it would also catch delegations unrelated to pstack.
- A child session understands `pstack:<role>` only when it loads the adapter. Otherwise the name is
  an unknown model and the call fails visibly.
- The code can require that an override names a pool model. It cannot judge whether the override
  was justified.

## Seams that keep 0004-model-pick-strategies possible

- Make the pick in one function, so a strategy can replace the ranked pick in one place.
- Give it the role, the allowed models in rank order, the task text the child receives, the session
  id, and a per-role delegation sequence number, even though ranked uses only the first.
- Have it return an index into the allowed models, and check that index before rewriting the call,
  so a strategy can never pick an excluded model.
- Apply an explicit override before the pick function runs.
- Do not name it `resolveModel`: `GateContext.resolveModel` in `src/gate.ts` already maps a model id
  to its Pi registry entry. `pickModel` was suggested.
