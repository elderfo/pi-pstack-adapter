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

Some workflows hand work to subagents or ask you multiple-choice questions. Install these two
packages to enable them:

```bash
pi install npm:pi-subagents
pi install npm:pi-ask-user
```

With `pi-subagents` installed, the upstream agents register as `pistack-comment-sicko` and
`pistack-poteto-agent`. The adapter turns on the `subagent` tool when a delegating workflow
starts, whether you run its `/skill:` command or the agent opens the skill itself. While Poteto
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

pstack assigns work to named model roles such as `feature`, `bug-fix`, and `judgment`. A role you
leave unset uses the current Pi session model.

To list the models in your Pi installation and assign them to roles, run the setup skill:

```text
/skill:pistack-setup
```

In a noninteractive session, set roles with `PISTACK_MODELS`:

```bash
PISTACK_MODELS='feature=provider/model,bug-fix=provider/other-model' pi
```

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
| `PISTACK_MODELS` | Assigns models as comma-separated `role=provider/model` pairs. |

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
