# Intent: Code picks a pool's ranked model

Author: Chris Freddy Getsfred
Status: draft

## Problem

When a role has a pool of models, the agent that delegates picks one "by fit". No code makes or
checks that pick, so it isn't predictable and can't be enforced. The pool's order is documented
as a ranking, but only as an instruction the agent can ignore.

## Proposed outcome

- By default, a delegation for a pooled role runs on the first model in the pool that the model
  filter allows, picked by the adapter's code rather than by the agent.
- The supervisor agent can still override the ranking for a task, and the override is visible.
- The way the code picks leaves room for other ways of picking later
  (0004-model-pick-strategies).

## Affected users and systems

- Users who configure pools.
- Agents running pstack workflows, which delegate through T3 Code or pi-subagents.
- The adapter's delegation check, its status and check reports, and the generated instructions.

## Constraints

- Ranked is the default.
- An explicit override from the supervisor agent wins over the ranked pick.
- The model filter still applies. The code never picks a model the filter excludes.
- Nothing in this change may prevent 0004-model-pick-strategies.

## Open questions

- While a pstack workflow runs, should a delegation that names a model directly be blocked, so
  that every pooled delegation goes through the code's pick? (originator)
- Should the two default seats of an unset panel also take the code's ranked pick? (originator)
- What should happen when a child session that doesn't load the adapter is asked to delegate by
  role? (maintainer)
