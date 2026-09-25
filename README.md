# Pi pstack adapter

Use Cursor's official [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin in
[Pi](https://pi.dev) without modifying the upstream checkout.

The adapter downloads a tested pstack commit and makes its skills and agents available in Pi
under the `pistack` namespace.

## Requirements

Install Pi and Git on Linux or macOS. Windows support is experimental because pstack skills use
POSIX shell tools.

### Optional workflow providers

Some workflows need delegation or structured questions. Install these providers to use those
workflows:

```bash
pi install npm:pi-subagents
pi install npm:pi-ask-user
```

With `pi-subagents` installed, the upstream agents register as `pistack-comment-sicko` and
`pistack-poteto-agent`. `pi-subagents` hides its `subagent` tool until something enables it.
The adapter enables that tool when a delegating workflow starts. This happens when you run its
`/skill:` command, when the agent opens the skill on its own, and on every prompt while Poteto
Mode is on.

Run `/pistack-check <skill>` to find missing providers and executables before a workflow starts.

## Install the adapter

```bash
pi install git:github.com/elderfo/pi-pstack-adapter
```

On the first interactive start, the adapter asks before it downloads pstack into
`~/.pi/agent/cache/pi-pstack-adapter/`. Later sessions reuse the cached commit without network
access.

A noninteractive session cannot download pstack unless you set `PISTACK_ALLOW_BOOTSTRAP=1`:

```bash
PISTACK_ALLOW_BOOTSTRAP=1 pi
```

## Run a pstack skill

Pi exposes generated skills as `/skill:pistack-*` commands:

```text
/skill:pistack-how
/skill:pistack-unslop
/skill:pistack-poteto-mode
```

Check a workflow before you run it:

```text
/pistack-check how
```

The check reports the workflow's support tier, required Pi capabilities, and required
executables.

The adapter also adds these commands:

| Command | Result |
| --- | --- |
| `/pistack-status` | Shows versions, the resolved commit, trust, capabilities, support tiers, and diagnostics. |
| `/pistack-check <skill>` | Checks one workflow's requirements. |
| `/pistack-mode on\|off\|status` | Controls Poteto Mode for the current session. |
| `/skill:pistack-setup` | Assigns Pi models to pstack roles or changes the upstream source. |
| `/skill:pistack-status` | Requests the status report through the agent. |

## Read the support tiers

`/pistack-status` reports a support tier for each skill:

| Tier | Meaning |
| --- | --- |
| `native` | The skill needs no Pi-specific changes, or the adapter supplies a Pi version. |
| `adapted` | The upstream body works with the host mappings in its wrapper. |
| `dependency-gated` | The workflow needs a capability or executable that may be missing. |
| `experimental` | Part of the workflow has no direct Pi equivalent. |
| `unsupported` | Pi cannot provide a required host feature. |

See [the compatibility registry](docs/compatibility.md) for the tier and requirements of every
skill.

## Configure model roles

pstack names model roles such as `feature`, `bug-fix`, and `judgment`. An unset role uses the
current Pi session model.

Run the setup skill to list the models available in your Pi installation and assign them to
roles:

```text
/skill:pistack-setup
```

For a noninteractive session, set role assignments with `PISTACK_MODELS`:

```bash
PISTACK_MODELS='feature=provider/model,bug-fix=provider/other-model' pi
```

## Select another pstack source

Each adapter release certifies one pstack version and commit. `/pistack-status` shows both the
certified commit and the commit in use.

Use `/skill:pistack-setup` to select a branch, tag, commit, repository, or local checkout. The
adapter asks for confirmation before it changes the source. Restart Pi or run `/reload` after
the change.

A branch or tag resolves to one commit. The adapter records that commit and does not advance it
on later starts. `/pistack-status` marks a custom repository or an untested revision with a
warning.

The setup skill writes user settings to `~/.pi/agent/pi-pstack-adapter.json` or project settings
to `.pi/pi-pstack-adapter.json`. Environment variables override both files:

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

## Trust upstream sources

Pi skills run with your user permissions. The adapter asks for confirmation before it downloads
or changes the pstack source. Review a custom repository before you select it.

The adapter preserves each upstream skill body for inspection. Pi policy, host safety rules, and
your instructions take precedence over conflicting text in a pstack skill.

## License

This adapter is available under the [MIT License](LICENSE). Upstream pstack is also MIT-licensed
and remains copyright its authors.
