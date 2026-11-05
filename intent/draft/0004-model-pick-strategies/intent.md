# Intent: Choose how a pool picks its model

Author: Chris Freddy Getsfred
Status: draft

## Problem

A pool picks its model only one way: the ranked default from 0003-code-ranked-pick. The originator
wants other ways to pick, such as round robin or random, and custom ones. An example is a strategy
that uses Jev to choose a model based on the prompt the child will get. Every way of picking must
stay deterministic.

## Proposed outcome

- A user can choose how pools pick a model: ranked (the default), round robin, random, or a
  custom strategy.
- The same inputs give the same pick.
- A custom strategy can base its pick on the task prompt, as a Jev-based one would.
- When a strategy fails, times out, or returns a model outside the pool, the delegation runs on
  the ranked pick and the failure is reported.

## Affected users and systems

- Users who configure pools.
- Authors of custom strategies, such as a Jev integration.
- The adapter's pick code, its config, and the status report.

## Constraints

- Ranked is the default.
- Every strategy is deterministic.
- One strategy applies to all pools, not one per role.
- An explicit override from the supervisor agent always wins over any strategy.
- A failed strategy falls back to ranked and the failure is reported.
- Builds on 0003-code-ranked-pick.

## Open questions

- For a strategy whose answer can vary, like Jev, what counts as deterministic: the same pick for
  the same task across sessions, or only within a session and its replays? (originator)
- How is a custom strategy supplied: registered by another Pi extension and named in config, or
  loaded from a module path in config? (originator, with a security review)
- Do the default seats of an unset panel use the strategy too? (originator)
