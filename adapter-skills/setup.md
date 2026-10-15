# Set up the pstack adapter

Upstream pstack ships a `setup-pstack` skill that writes `~/.cursor/rules/pstack-models.mdc`,
a Cursor-only always-applied rule full of Cursor model slugs. Pi has neither that file nor
those models, so this adapter replaces the body with the Pi equivalent.

Three things are configurable. Model roles, the upstream source, and the delegation order.

## Model roles

pstack skills name a model per role. In Pi those names mean nothing, so each role maps to a
model in your own catalogue. A role you never configure inherits the parent session model,
which is a working default, not a failure.

Roles used by pstack workflows.

| role | used by |
| --- | --- |
| `feature` | feature playbook |
| `refactoring` | refactoring playbook |
| `bug-fix` | bug-fix playbook |
| `perf-issue` | perf playbook |
| `hillclimb` | sustained metric improvement |
| `judgment` | prose, review, and judgment delegates |
| `strongest-judgment` | the hardest cross-cutting changes |

The status report lists the same roles, so read it back rather than trusting this table if the
adapter has been upgraded.

Each role also has a thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or
`max`. Upstream pstack calls this a reasoning budget and encodes it in the model slug. A role with
no thinking level passes none, so the delegation backend applies its own default. A role left on `inherit` uses the parent
session's model and thinking level, so a parent at high thinking makes every inheriting child
expensive. Set a level on the roles that do the bulk of the work.

Steps.

1. Call the adapter tool with `action: "models"` to list the provider and model ids this Pi
   installation can actually reach. Do not invent ids.
2. Ask the user which model each role should use. Offer the listed ids, and offer
   `inherit` for any role they do not care about. Use the structured question tool when it is
   available; otherwise ask in plain text. Only ids from step 1 are accepted.
3. For each answered role, call the adapter tool with `action: "set_model"`, the role, and the
   chosen `provider/model` id. Pass `scope: "project"` when the user wants the choice to apply
   only to this repository. When the user wants a thinking level, pass `thinking` as well. Ask
   for it per role, and suggest a lower level for code-writing roles than for `judgment` or
   `strongest-judgment`. The tool rejects a level on a model that has no reasoning support. A level the model does not
   offer, such as `max` on a model that stops at `high`, is accepted and clamped when it runs.
4. Read back `action: "status"` and show the user what was written.

For a scripted environment, set `PISTACK_MODELS` instead, for example
`PISTACK_MODELS=feature=anthropic/claude-sonnet-4-5:medium,bug-fix=openai/gpt-5:high`. The
optional `:level` suffix sets the thinking level. The environment wins
over both config files, so CI never needs this dialog.

## Upstream source

By default the adapter uses the pstack revision this release was tested against. Change it only
when you are deliberately testing another revision.

Call the adapter tool with `action: "set_source"` and one of these.

- `ref` with a branch, tag, or commit. A branch or tag is resolved to a commit once, here, and
  recorded. Later sessions keep that commit. The adapter never advances it on its own.
- `repo` with another repository. This is outside the tested trust boundary.
- `localPath` with a directory holding a pstack checkout. Use this when developing pstack itself.

The adapter asks the user to confirm every source change itself and refuses without an
interactive session, so a change cannot happen on your say-so alone. Explain the consequence in
plain words before you call it, and report a refusal as a refusal.

Regeneration happens on the next Pi start. Tell the user to restart Pi, or run `/reload`.

## Delegation order

Delegating workflows try T3 Code's `delegate_task` first, then pi-subagents' `subagent`. A user
who wants `subagent` first sets `"delegation": "pi-subagents"` in the adapter config file, or
`PISTACK_DELEGATION=pi-subagents`. The adapter tool has no action for this. Tell the user which
file to edit: the `config layers` row of the status report lists them. Regeneration happens on
the next Pi start.

## Finish

End by reporting, in your own words, which roles were set, which still inherit, the resolved
upstream commit, and the trust level from the status output.
