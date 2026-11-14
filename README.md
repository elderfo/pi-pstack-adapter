# pi-pstack-adapter

[![npm](https://img.shields.io/npm/v/pi-pstack-adapter)](https://www.npmjs.com/package/pi-pstack-adapter)
[![CI](https://github.com/elderfo/pi-pstack-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/elderfo/pi-pstack-adapter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Use Cursor's [pstack](https://github.com/cursor/plugins/tree/main/pstack) skills and agents in
[Pi](https://pi.dev).

pstack is Cursor's collection of engineering workflows: design reviews (`how`), prose cleanup
(`unslop`), test-driven development (`tdd`), parallel fan-out (`swarm`), and the full Poteto Mode
working style. This package downloads a tested pstack release and gives you every workflow as a
Pi skill named `pistack-*`. The upstream files stay unmodified, so you can audit what the agent
reads.

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

### Install from Git instead of npm

To track the repository directly, install from GitHub:

```bash
pi install git:github.com/elderfo/pi-pstack-adapter
```

To pin a release, add a tag from the
[releases page](https://github.com/elderfo/pi-pstack-adapter/releases), as in
`git:github.com/elderfo/pi-pstack-adapter@v<version>`. For a pinned npm release, use
`npm:pi-pstack-adapter@<version>`.

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

The check reports the workflow's support tier and any providers or executables you still need
to install.

The adapter also adds these commands:

| Command | What it does |
| --- | --- |
| `/pistack-status` | Shows versions, the pstack commit in use, trust, capabilities, support tiers, and diagnostics. |
| `/pistack-check <skill>` | Checks one workflow's requirements. |
| `/pistack-mode on\|off\|status` | Turns Poteto Mode on or off for every prompt in the current session. |
| `/skill:pistack-setup` | Assigns Pi models to pstack roles, sets a model filter, or changes the pstack source. |
| `/skill:pistack-status` | Asks the agent to produce the status report and explain it. |

### Check how well a workflow is supported

`/pistack-status` lists a support tier for each skill:

| Tier | Meaning |
| --- | --- |
| `native` | The skill needs no Pi-specific changes, or the adapter supplies a Pi version. |
| `adapted` | The skill works in Pi with the instructions the adapter adds to it. |
| `dependency-gated` | The workflow needs a provider or executable that may be missing. |
| `experimental` | Part of the workflow has no direct Pi equivalent. |
| `unsupported` | Pi cannot provide a feature the workflow requires. |

The [compatibility registry](docs/compatibility.md) lists the tier and requirements of every
skill.

## Set up workflows that delegate or ask questions

Some workflows hand work to subagents or ask you multiple-choice questions. Two providers can run
the subagents:

- **T3 Code.** When Pi runs inside [T3 Code](https://github.com/pingdotgg/t3code), workflows
  delegate through T3's `delegate_task` tool. Each child appears in T3, can run on any provider
  and model T3 offers, and can work in its own worktree. You install nothing extra.
- **pi-subagents.** Outside T3 Code, install `pi-subagents`. The pstack agents appear as
  `pistack-comment-sicko` and `pistack-poteto-agent`.

For multiple-choice questions, install `pi-ask-user`:

```bash
pi install npm:pi-subagents
pi install npm:pi-ask-user
```

When both providers are available, the adapter uses T3 Code. To prefer `pi-subagents`, set
`"delegation": "pi-subagents"` in the adapter config, or set `PISTACK_DELEGATION=pi-subagents`.
Restart Pi or run `/reload` after changing it. `/pistack-status` shows the order and the
provider the session uses.

When a delegating workflow starts, the adapter turns on that provider's tool, even if you turned
it off in the tool selector. While Poteto Mode is on, it turns the tool on for every prompt.

The adapter uses T3's tools only when T3 Code itself provides them. It ignores a tool with the
same name from another extension or MCP server.

## Choose models for pstack roles

pstack assigns work to named model roles such as `feature`, `bug-fix`, and `judgment`. The
`general` role covers every other delegate, such as explorers, swarm workers, and ad-hoc helpers.
A role you leave unset uses `general`. When `general` is unset too, the role uses the model of the
agent that starts it.

To see the models in your Pi installation and assign them to roles, run the setup skill:

```text
/skill:pistack-setup
```

The setup skill saves your choices in a config file. To set roles in a file or an environment
variable yourself, see [Set roles without the setup skill](#set-roles-without-the-setup-skill).

### Thinking levels

Each role can also have a thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or
`max`. The level is a ceiling. A delegate may lower it for routine work but never raises it. A
role without a level passes none, so the provider uses its own default. If the model does not
offer the level, Pi limits it to what the model supports. Under T3 Code, T3 may reject the level
instead. The agent then lowers the level to one the model offers and tells you.

A role you leave unset, with `general` unset too, inherits the model and thinking level of the
agent that starts it. A `strongest-judgment` delegate at `xhigh` would then start every helper at
`xhigh`. Set `general` to keep helpers at a cheaper level.

### Panels

Some workflows run several models side by side: `arena`'s runners, `architect`'s runners, and
`interrogate`'s adversaries. Their panel roles are `arena-runners`, `architect-runners`, and
`interrogate-reviewers`. A panel lists up to eight models, and each one gets a seat. An `inherit`
seat uses the model and thinking level of the agent that starts the panel, which is your session
unless a delegate runs the workflow.

The `arena-cross-judge-pool` role works differently. `arena`, and `architect` through it, pick
one judge from this list, the first model from a family other than your session's. When no entry
qualifies, `arena` tries `judgment`, then `general`. If neither qualifies, it skips the judge and
says so. An `inherit` entry never judges.

Upstream pstack gives each panel models from two model families. A panel you
leave unset uses `judgment`, then `general`, so it covers two families only when those roles do.
The status report warns when a panel's seats all run on one model.

### Pools

A role can list up to eight models in order of preference. Each delegation for that role runs on
the first model that the [model filter](#restrict-which-models-delegation-uses) allows. When a
task clearly suits another model in the pool, the agent may pick that one instead, and it tells
you which model it picked and why. It cannot pick a model outside the pool.

A pool runs one model per task, and a runner panel runs every seat. A pool is also not a retry list.
When a delegation fails, the agent reports the failure and does not move on to the next model.

### Set roles without the setup skill

In a config file, a role takes one model, a pool takes a list, and a panel takes a string of
seats separated by spaces. Add a thinking level to any model with a `:level` suffix:

```json
{
  "models": {
    "general": "provider/cheap-model:low",
    "judgment": "provider/strong-model:high",
    "feature": ["provider/model-a:high", "provider/model-b:high", "provider/model-c"],
    "arena-runners": "provider/model-a:high other-provider/model-d:high"
  }
}
```

For a noninteractive session, set the same values in `PISTACK_MODELS`. Separate roles with
commas and a pool's entries with `|`:

```bash
PISTACK_MODELS='general=provider/cheap-model:low,feature=provider/model-a:high|provider/model-b' pi
PISTACK_MODELS='arena-runners=provider/model-a:high other-provider/model-d:high' pi
```

Role names use lowercase letters, digits, and hyphens. A model value is printable ASCII with no
spaces or markup characters, at most 128 characters. If an entry breaks these rules, the adapter
stops at startup with an error that names the file. Fix the entry and restart Pi.

## Restrict which models delegation uses

A model filter limits delegation to some models without changing your role assignments, for
example to run an experiment on one model family. Ask the agent, for example "only delegate to
GPT models", or run `/skill:pistack-setup`. A filter has two lists of patterns:

- `include` lists the models delegation may use. `["gpt-*"]` allows only model ids that start
  with `gpt-`.
- `exclude` lists the models delegation may not use. `["*claude*"]` blocks every model id that
  contains `claude`, including Bedrock-style ids.

A pattern with a `/` matches `provider/model`, and one without matches the part of the id after
the last `/`. `*` is the only wildcard, and matching ignores case. A model must match an `include`
pattern when the list has any, and must match no `exclude` pattern.

A filter lasts for the current session unless you ask the agent to save it. A saved filter goes
in your user or project config file as `modelFilter`, for example
`{ "modelFilter": { "include": ["gpt-*"] } }`, and takes effect at once. A session filter
overrides a saved one until you clear it. A project's saved filter replaces your user filter
entirely. The `model filter` row of `/pistack-status` shows the filter in force and where it came
from.

### What the filter blocks

The status report and `/pistack-check` mark each pool entry as allowed or excluded. The adapter
blocks a role with no allowed entry, and does not move its work to `general` or to your session's
model. It blocks a role that inherits when the filter excludes your session's model. It blocks a
panel seat on an excluded model, and the other seats still run.

The adapter checks every `delegate_task` and `subagent` call in the session, not only the calls
pstack workflows make. It blocks a call that would run on an excluded model, and a call it
cannot check, such as:

- a call with no model while the filter excludes your session's model
- a model Pi does not know
- a T3 provider other than Pi, or a T3 target that names an environment
- a `subagent` child without a model, or a `subagent` workflow script
- a `subagent` action that restarts, refines, steers, or schedules a child, opens a project
  session, or configures a watchdog

The agent does not retry a blocked call.

### What the filter does not cover

- A child agent does not inherit a session filter. The agent includes the filter in each child's
  instructions instead. A saved filter applies in a child that loads the same config files.
- The adapter does not check other tools that start agents or processes, such as T3 Code's
  thread tools or a shell command.
- The filter does not block a provider or a model inside Pi, and it does not affect switching
  models with `/model`.
- The filter guards model choice. It is not a security boundary. The agent can change it, but its
  instructions say to keep it unless you ask for a change.

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
does not move it on later starts. The `trust` row of `/pistack-status` tells you how far to trust
the source:

| Trust | Meaning |
| --- | --- |
| `tested` | The certified commit from the official repository. |
| `untested-ref` | A source from the official repository without this release's certified pin. This release has not verified it. |
| `untested-repo` | A custom repository. Its code runs with your permissions, so review it first. |
| `local` | A local checkout. Its contents are unverified and can differ between machines. |

## Configuration reference

The adapter reads settings from these places. A later one overrides an earlier one:

1. Your user config, `~/.pi/agent/pi-pstack-adapter.json`.
2. The project config, `.pi/pi-pstack-adapter.json` in the working directory. Pi reads it only
   after you trust the project, and a project cannot change `namespace`.
3. Environment variables.

The setup skill writes both files. The keys you are most likely to edit are `models`,
`modelFilter`, and `delegation`. The setup skill also records the pstack source there, so change
the source through it.

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
