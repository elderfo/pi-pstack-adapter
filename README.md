# pi-pstack-adapter

[![npm](https://img.shields.io/npm/v/pi-pstack-adapter)](https://www.npmjs.com/package/pi-pstack-adapter)
[![CI](https://github.com/elderfo/pi-pstack-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/elderfo/pi-pstack-adapter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Use Cursor's [pstack](https://github.com/cursor/plugins/tree/main/pstack) skills and agents in
[Pi](https://pi.dev).

pstack is Cursor's collection of engineering workflows: design reviews (`how`), prose cleanup
(`unslop`), test-driven development (`tdd`), parallel fan-out (`swarm`), and the full Poteto Mode
working style. This package downloads a tested pstack release and exposes every workflow as a
Pi skill named `pistack-*`. The upstream files stay unmodified, so you can audit exactly what
the agent reads.

## Quick start

1. Install the package:

   ```bash
   pi install npm:pi-pstack-adapter
   ```

2. Start Pi. On the first interactive start, the adapter asks before it downloads pstack. Answer
   yes.

3. Run a workflow. `unslop` needs no other packages:

   ```text
   /skill:pistack-unslop
   ```

To see everything the adapter loaded, run `/pistack-status`.

## Requirements

- [Pi](https://pi.dev)
- Git on your `PATH`
- Linux, macOS, or Windows

On native Windows, install [Git for Windows](https://git-scm.com/download/win). It provides both
Git and the Git Bash shell that Pi's `bash` tool uses. pstack skills are written as Bash
commands, so keep the `bash` tool active rather than switching to Pi's `powershell` tool.
`/pistack-status` warns when Bash is missing or the `bash` tool is inactive. Pi inside WSL
counts as Linux.

### Add optional providers for delegating workflows

Some workflows hand work to subagents or ask you multiple-choice questions. Two providers can run
the subagents:

- **T3 Code.** When Pi runs inside [T3 Code](https://github.com/pingdotgg/t3code), workflows
  delegate through T3's `delegate_task` tool. Each child appears in T3, can run on any provider
  and model T3 offers, and can work in its own worktree. You install nothing extra.
- **pi-subagents.** Outside T3 Code, install `pi-subagents`. The upstream agents register as
  `pistack-comment-sicko` and `pistack-poteto-agent`.

For multiple-choice questions, install `pi-ask-user`:

```bash
pi install npm:pi-subagents
pi install npm:pi-ask-user
```

The adapter uses T3 Code first and falls back to `pi-subagents`. To reverse that order, set
`"delegation": "pi-subagents"` in the adapter config, or set `PISTACK_DELEGATION=pi-subagents`.
Restart Pi or run `/reload` after changing it. `/pistack-status` shows the order and the
provider the session resolved.

The adapter counts T3's tools, including `task_status` and `orchestrator_capabilities`, only
when T3 Code's own bridge registered them. A tool that another extension or MCP server registers
under the same name is ignored, and `/pistack-check <skill>` names the one tool to delegate with.

When a delegating workflow starts, the adapter turns on that provider's tool, even if you turned
it off in the tool selector. This happens
whether you run the workflow's `/skill:` command or the agent opens the skill itself. While Poteto
Mode is on, the adapter turns it on for every prompt.

To find missing providers or executables before you start a workflow, run
`/pistack-check <skill>`.

## Install from Git instead of npm

To track the repository directly, install from GitHub:

```bash
pi install git:github.com/elderfo/pi-pstack-adapter
```

To pin a release, add its tag, for example `git:github.com/elderfo/pi-pstack-adapter@v0.3.0`.
For a pinned npm release, use `npm:pi-pstack-adapter@0.3.0`.

## Run pstack workflows

Each pstack skill appears as a `/skill:pistack-*` command:

```text
/skill:pistack-how
/skill:pistack-unslop
/skill:pistack-poteto-mode
```

Before you run a workflow, check what it needs:

```text
/pistack-check how
```

The check reports the workflow's support tier and any missing capabilities or executables.

The adapter also adds these commands:

| Command | What it does |
| --- | --- |
| `/pistack-status` | Shows versions, the resolved commit, trust, capabilities, support tiers, and diagnostics. |
| `/pistack-check <skill>` | Checks one workflow's requirements. |
| `/pistack-mode on\|off\|status` | Turns Poteto Mode on or off for the current session. |
| `/skill:pistack-setup` | Assigns Pi models to pstack roles or changes the upstream source. |
| `/skill:pistack-status` | Asks the agent to produce the status report. |

## Check how well a workflow is supported

`/pistack-status` lists a support tier for each skill:

| Tier | Meaning |
| --- | --- |
| `native` | The skill needs no Pi-specific changes, or the adapter supplies a Pi version. |
| `adapted` | The upstream body works with the host mappings in its wrapper. |
| `dependency-gated` | The workflow needs a capability or executable that may be missing. |
| `experimental` | Part of the workflow has no direct Pi equivalent. |
| `unsupported` | Pi cannot provide a required host feature. |

The [compatibility registry](docs/compatibility.md) lists the tier and requirements of every
skill.

## Choose models for pstack roles

pstack assigns work to named model roles such as `feature`, `bug-fix`, and `judgment`. The
`general` role covers every other delegate, such as explorers, swarm workers, and ad-hoc helpers.
A role you leave unset uses `general`, and uses the model of the agent that starts it only when
`general` is unset too.

To list the models in your Pi installation and assign them to roles, run the setup skill:

```text
/skill:pistack-setup
```

In a noninteractive session, set roles with `PISTACK_MODELS`:

```bash
PISTACK_MODELS='feature=provider/model,bug-fix=provider/other-model' pi
```

Add a thinking level to a role with a `:level` suffix. The levels are `off`, `minimal`, `low`,
`medium`, `high`, `xhigh`, and `max`:

```bash
PISTACK_MODELS='feature=provider/model:medium,judgment=provider/other-model:high' pi
```

Panels such as `arena`'s runners and judge, `architect`'s runners, and `interrogate`'s adversaries
use the panel roles `arena-runners`, `arena-cross-judge-pool`, `architect-runners`, and
`interrogate-reviewers`. A panel holds a list of models, one seat each, separated by spaces.
An `inherit` entry uses the model and thinking of the agent that starts the panel, which is
your session unless a delegate runs the workflow:

```bash
PISTACK_MODELS='arena-runners=provider/model:high other-provider/other-model:high' pi
```

Upstream pstack defaults each panel to two model families. A panel you leave unset uses
`judgment`, then `general`, so it covers two families only when those roles do. The status
report warns when a panel's seats all run on one model.

### Give a role a pool of models

An ordinary role can list several models instead of one. Each delegation for that role picks one
model from the list. A pool is not a panel: a panel runs one seat per entry, but a pool starts one
child per task. A pool is not a retry list either: when a delegation fails, the agent reports the
failure and does not try the next model. In a config file a pool is a JSON list:

```json
{ "models": { "feature": ["provider/model-a:high", "provider/model-b:high", "provider/model-c"] } }
```

The `set_model` action takes the same list in `model`, and its `thinking` applies to each entry
without its own `:level`. Every entry must be a model in your Pi installation, or nothing is
written. In `PISTACK_MODELS`, separate a pool's entries with `|`:

```bash
PISTACK_MODELS='feature=provider/model-a:high|provider/model-b' pi
```

A panel keeps its string of seats. An unset panel's two default seats each pick one model from the
`judgment` and `general` pools.

### Restrict which models delegation uses

A model filter limits delegation to some models without changing the role assignments, for
example to run an experiment on one model family only. Ask the agent, or call the
`pstack_adapter` tool's `set_filter` action:

- `include: ["gpt-*"]` allows only models whose id starts with `gpt-`.
- `exclude: ["*claude*"]` excludes model ids containing `claude`, including Bedrock-style ids.
- `clear: true` removes the filter at that scope.

A pattern with a `/` matches `provider/model`, and one without matches the model id after the
provider. `*` is the only wildcard, and matching ignores case. A model must match an `include`
pattern when there are any, and must match no `exclude` pattern.

A filter applies to the current session by default and is not saved. Pass `scope: "user"` or
`scope: "project"` to save it as `modelFilter` in that config file. A saved filter takes effect
at once, and a filter set for the session wins over a saved one until you clear it. The
`model filter` row of `/pistack-status` shows the filter in force and where it came from.
A trusted project's filter replaces the user filter as a whole, including an empty filter.
Empty lists set an unrestricted override; clearing the session filter restores the saved filter.
Wait for `set_filter` to finish before starting delegations, rather than issuing them together.

Under a filter, the status report and `/pistack-check` mark each pool entry as allowed or
excluded. A role with no allowed entry is blocked: its work is not moved to `general` or to the
session's model. A role that inherits is blocked when the filter excludes the session's model.
A panel seat on an excluded model is blocked, and the other seats still run.

The adapter also checks every `delegate_task` and `subagent` call in the session, including
calls that no pstack workflow made, and blocks one whose model the filter excludes or that it
cannot check. That includes a call with no model while the session's model is excluded, a model
Pi does not know, a T3 provider other than Pi, a `subagent` child without a model, a `subagent`
workflow script, and a `subagent` action that restarts, refines, steers, or schedules a child,
opens a project session, or configures a watchdog. A T3 target with a named environment is also
blocked because its registry may differ. A blocked call is not retried. These limits apply:

- A child does not inherit a session filter, so the agent puts it into each brief as an
  instruction. A saved filter applies in a child where the adapter loads the same config files.
- Other tools that start agents or processes, such as T3 Code's thread tools or a shell command,
  are not checked. The filter does not block a provider or a model inside Pi.
- Changing models with `/model` is not affected.
- The filter is a model-selection guard, not an access-control boundary. The agent can change it
  through `set_filter`, but is instructed to keep it unchanged unless the user requests a change.

Role names are lowercase letters, digits, and hyphens. A model value is printable ASCII with no spaces or markup characters, at most 128 characters. A config entry that breaks these rules stops the adapter at startup with an error that names the file, so fix the key there and restart Pi.

A role without a level passes none, so the delegation backend applies its own default. A role's
level is a ceiling: a delegate may lower it for routine work but never raises it. A role you leave
unset, with `general` unset too, inherits the model and thinking level of the agent that starts
it. A `strongest-judgment` delegate at `xhigh` would then start every helper at `xhigh`, so set
`general` to keep helpers at a cheaper level. The `pstack_adapter` tool's `set_model` action takes the same
level in its `thinking` parameter. A level the model does not offer is clamped by Pi at run time.

## Run Pi noninteractively

A noninteractive session, such as `pi --print`, cannot answer the download question. To allow
the first download, set `PISTACK_ALLOW_BOOTSTRAP=1`:

```bash
PISTACK_ALLOW_BOOTSTRAP=1 pi --print "Summarize this repository"
```

The adapter caches pstack in `~/.pi/agent/cache/pi-pstack-adapter/`. Later sessions reuse the
cached commit without network access.

## Use a different pstack version

Each adapter release certifies one pstack version and commit. `/pistack-status` shows both the
certified commit and the commit in use.

To select a branch, tag, commit, repository, or local checkout, run `/skill:pistack-setup`. The
adapter asks you to confirm before it changes the source. Restart Pi or run `/reload` afterward.

A branch or tag resolves to one commit when you select it. The adapter records that commit and
does not move it on later starts. `/pistack-status` warns when you use a custom repository or a
revision the adapter has not certified.

## Configuration reference

The setup skill writes user settings to `~/.pi/agent/pi-pstack-adapter.json` and project
settings to `.pi/pi-pstack-adapter.json`. Environment variables override both files:

| Variable | Effect |
| --- | --- |
| `PISTACK_NAMESPACE` | Replaces `pistack` in generated skill and command names. |
| `PISTACK_UPSTREAM_REPO` | Selects another Git repository. |
| `PISTACK_UPSTREAM_REF` | Selects a branch, tag, or commit. |
| `PISTACK_UPSTREAM_PATH` | Uses a local pstack checkout. |
| `PISTACK_UPSTREAM_PLUGIN_PATH` | Selects the plugin directory inside the checkout. |
| `PISTACK_ALLOW_BOOTSTRAP` | Allows a noninteractive first download. |
| `PISTACK_CACHE_DIR` | Changes the cache directory. |
| `PISTACK_MODELS` | Assigns models as comma-separated `role=provider/model[:thinking]` pairs. A pool separates its entries with `\|`. A panel role takes its entries separated by spaces. |
| `PISTACK_DELEGATION` | Sets the delegation provider to try first: `t3` (default) or `pi-subagents`. The config file key is `delegation`. |

## Security and trust

Pi skills run with your user permissions, and a skill can tell the agent to run programs. The
adapter asks before it downloads pstack or changes the source. Review a custom repository before
you select it.

The adapter keeps each upstream skill body byte-for-byte so you can inspect it. Every generated
wrapper states that Pi policy, host safety rules, and your instructions override conflicting text
in a pstack skill.

## Uninstall

```bash
pi remove npm:pi-pstack-adapter
```

To reclaim disk space, delete `~/.pi/agent/cache/pi-pstack-adapter/` and, if you created it,
`~/.pi/agent/pi-pstack-adapter.json`.

## License

This adapter is available under the [MIT License](LICENSE). Upstream pstack is also MIT-licensed
and remains copyright its authors.
