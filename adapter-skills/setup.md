# Set up the pstack adapter

Upstream pstack ships a `setup-pstack` skill that writes `~/.cursor/rules/pstack-models.mdc`,
a Cursor-only always-applied rule full of Cursor model slugs. Pi has neither that file nor
those models, so this adapter replaces the body with the Pi equivalent.

You can configure four things: model roles, the model filter, the upstream source, and the
delegation order.

## Model roles

pstack skills name a model per role. Pi has no such models, so each role maps to a
model in your Pi installation. A role you never configure uses the `general` role. When `general` is
unconfigured too, the role inherits the model of whichever agent starts it, which is a working
default, not a failure.

pstack workflows use these roles.

| role | used by |
| --- | --- |
| `feature` | feature playbook |
| `refactoring` | refactoring playbook |
| `bug-fix` | bug-fix playbook |
| `perf-issue` | perf playbook |
| `hillclimb` | sustained metric improvement |
| `judgment` | prose, review, and judgment delegates |
| `strongest-judgment` | the hardest cross-cutting changes |
| `general` | every other delegate: explorers, investigators, swarm and verification workers, ad-hoc helpers, and any unconfigured role |

Upstream also has panel lines, which hold a list of models with one seat per entry. The adapter
keeps them as panel roles.

| panel role | used by |
| --- | --- |
| `arena-runners` | `arena`'s candidates |
| `arena-cross-judge-pool` | `arena`'s one judge, which `architect` uses too |
| `architect-runners` | no workflow since pstack 0.15.43. `architect` now runs `arena` for a large design, which uses `arena-runners`. The role stays so existing settings still load. |
| `interrogate-reviewers` | `interrogate`'s adversaries |

Upstream defaults the runner and reviewer panels to one Claude Fable, one Claude Opus, and one
Gemini model, and the judge pool to one Claude Opus and one Gemini model. A panel
left unset uses `judgment`, then `general`, so it spans two families only when those roles do.
`arena` takes its judge from the pool only when the model is from a vendor other than the
session model's, and it counts Fable and the other Claude models as one vendor. When no pool entry
qualifies, it tries `judgment`, then `general`, and skips the judge only when neither does. The
status report warns when
a panel's seats all use one model.

A panel value lists entries in order. An entry is a model id, optionally with a thinking level,
or `inherit` for the model and thinking of the agent that starts the panel, which is the
session unless a delegate runs the workflow. An `inherit` entry never judges.

The status report lists the same roles, so read it back rather than trusting this table if the
adapter has been upgraded.

Each role also has a thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or
`max`. Upstream pstack calls this a reasoning budget and encodes it in the model slug. A role with
no thinking level passes none, so the delegation backend applies its own default. A role left on
`inherit` with `general` also on `inherit` uses the model and thinking level of the agent that
starts it. A `strongest-judgment` delegate at `xhigh` would then start every helper at `xhigh`, so
configure `general` to stop that. A role's level is a ceiling: delegates may lower it for routine
work, but never raise it. Model choice often affects cost more than thinking level does, so
consider a cheaper model for the bulk roles as well.

Follow these steps.

1. Call the adapter tool with `action: "models"` to list the provider and model ids this Pi
   installation can reach. Do not invent ids.
2. Ask the user which model each role should use. Offer the listed ids, and offer
   `inherit` for any role they do not care about. Use the structured question tool when it is
   available; otherwise ask in plain text. The tool accepts only ids from step 1. For a user who
   wants alternatives for a role, offer a pool, which is a ranked list of models. Ask for the
   ranking. The adapter normally picks the first model the filter allows. The delegating agent
   may pick another allowed entry for a particular task.
   A pool is a set of choices, not a retry list and not a panel, so say that when you offer it.
3. Ask for a thinking level. Do not assume the user wants none. Skip this step only when every
   role is on `inherit`. It applies to every role that got a model in step 2. A role on
   `inherit` cannot have a level, so tell the user that and say that those roles follow the
   parent session's level. Ask one single-select question first. Put the whole choice in each option
   title so the user can pick without opening anything else, for example "Balanced: code and general roles
   medium, judgment high, strongest-judgment xhigh (suggested)".

   | choice | code and general roles (`feature`, `refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `general`) | `judgment` | `strongest-judgment` |
   | --- | --- | --- | --- |
   | Balanced (suggest this first) | `medium` | `high` | `xhigh` |
   | Low cost | `low` | `medium` | `high` |
   | Maximum quality | `high` | `xhigh` | `max` |
   | Backend default | none | none | none |
   | Custom | ask once per column, as a single-select of level names | | |

   These are starting points, not measurements. They keep the heaviest reasoning on the roles
   that make the hardest calls. Offer Custom for a user who wants different levels. Ask once for
   the code and general roles, once for `judgment`, and once for `strongest-judgment`. Ask a role on its own
   only when the user says it should differ from its group. Backend default passes no level and
   leaves the choice to the delegation backend. A Custom user who wants thinking disabled picks
   `off`.
   A model may not offer every level. Pi clamps a level it lacks when the role runs. Under T3 Code,
   T3 may reject the level instead, and the delegating agent then lowers it and tells the user.
   Say that instead of asking again. The tool rejects any level other than `off` on a model that has no reasoning support.
   When it does, set that role with no level and tell the user which role has none.
4. For each role, call the adapter tool with `action: "set_model"`, the role, the chosen
   `provider/model` id, and `thinking` when step 3 picked a level. For a pool, pass `model` as a
   list of ids, for example `model: ["provider/model-a", "provider/model-b"]`. `thinking`
   applies to each entry without its own `:level`, and one unknown entry rejects the whole pool.
   Pass `scope: "project"` when the user wants the choice to apply only to this repository.
   Calling `set_model` for a role again without `thinking` clears a level set earlier, so always
   pass it again.
5. Set the panels. Read the `panel roles` table of `action: "status"` and show the user each
   panel's seats. When a panel's seats share one model, or one family, say so and suggest two
   families from step 1, as upstream's defaults do. For `arena-cross-judge-pool`, suggest models
   from two vendors, because a Fable and an Opus model are one vendor, so that pool has no eligible
   judge for a Claude session, and arena falls back to `judgment`, then `general`. Never say a family is missing unless the
   step 1 list shows it. Skip `architect-runners` when the status report's `upstream pstack version` is 0.15.43 or
   later, because no workflow reads it there. For an older revision, `architect` still reads it, so
   offer it like the others. Ask whether to keep each panel or set it. For each panel the user sets,
   call `set_model` with the panel role and its entries in `model`, separated by commas, for
   example `model: "provider/model-a, provider/model-b"`. Pass `thinking` for the level of the
   `judgment` column in step 3, unless the user picked another. An entry with its own `:level`
   keeps it. Pass `model: "inherit"` to unset a panel.
6. Read back `action: "status"` and show the user what was written, including the thinking
   column and the panel roles.

For a scripted environment, set `PISTACK_MODELS` instead, for example
`PISTACK_MODELS=feature=anthropic/claude-sonnet-4-5:medium,bug-fix=openai/gpt-5:high`. The
optional `:level` suffix sets the thinking level. A pool's entries are separated by `|`, as in
`feature=anthropic/claude-sonnet-4-5:high|openai/gpt-5:high`. A panel's entries are separated by spaces, as
in `PISTACK_MODELS='arena-runners=anthropic/claude-sonnet-4-5:high openai/gpt-5:high'`. `PISTACK_MODELS` overrides
both config files, so CI does not need this dialog.

## Model filter

A model filter restricts delegation to some models, such as one family for an experiment,
without rewriting the roles. Call the adapter tool with `action: "set_filter"` and:

- `include`, a list of patterns a model must match, such as `["gpt-*"]` for GPT only.
- `exclude`, a list of patterns no model may match, such as `["*claude*"]` for no Claude, including Bedrock-style ids.
- `clear: true` to remove the filter at that scope.

A pattern with `/` matches `provider/model`; one without matches the model id. `*` is the only
wildcard. The filter applies to this session only. When the user asks to save it, pass
`scope: "user"` or `scope: "project"`. A session filter wins over a saved one until you clear it.
A trusted project's filter replaces the user filter as a whole. Empty `include` and `exclude`
lists set an override that allows every model. Clearing the session filter restores the saved
filter. Wait for `set_filter` to finish
before issuing delegation calls. Keep the active filter unchanged unless the user requests a change.

Read back `action: "status"`. Report the `model filter` row, and any role or panel seat the
`model roles` or `panel roles` table marks BLOCKED, because a blocked role does not delegate.
Tell the user the limits: the adapter blocks `delegate_task` and `subagent` calls in this session
that the filter does not allow. A child does not inherit a session filter and follows it only as
an instruction in its brief. A saved filter applies in a child where the adapter loads the same
config files. The adapter does not check other tools that start agents. This is a model-selection guard,
not an access-control boundary.

## Upstream source

By default the adapter uses the pstack revision this release was tested against. Change it only
to test another revision.

Call the adapter tool with `action: "set_source"` and one of these.

- `ref` with a branch, tag, or commit. The adapter resolves a branch or tag to a commit once, during
  this call, and records it. Later sessions keep that commit. The adapter never advances it on its own.
- `repo` with another repository. This is outside the tested trust boundary.
- `localPath` with a directory holding a pstack checkout. Use this when developing pstack itself.

The adapter asks the user to confirm every source change itself and refuses without an
interactive session, so you cannot change the source without the user's confirmation. Explain the consequence in
plain words before you call it, and report a refusal as a refusal.

The adapter regenerates its wrappers on the next Pi start. Tell the user to restart Pi, or run
`/reload`.

## Delegation order

Delegating workflows try T3 Code's `delegate_task` first, then pi-subagents' `subagent`. A user
who wants `subagent` first sets `"delegation": "pi-subagents"` in the adapter config file, or
`PISTACK_DELEGATION=pi-subagents`. The adapter tool has no action for this. Tell the user which
file to edit: the `config layers` row of the status report lists them. The change takes effect
on the next Pi start.

## Finish

End by reporting, in your own words, which roles were set, which still inherit, which have
pools, the model filter in force, the resolved upstream commit, and the trust level from the
status output.
