# Pi pstack adapter

Use Cursor's official [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin in
[Pi](https://pi.dev) without modifying the upstream checkout.

The adapter downloads a certified pstack commit and generates Pi skill wrappers and agent
definitions. It registers them under the `pistack` namespace. Upstream pstack remains the source
of truth.

> Review this adapter and the upstream pstack source before you install them. Pi extensions run
> with your user permissions. Skills can direct the agent to run commands or edit files.

## Requirements

- Pi
- Git
- Linux or macOS

Windows support is experimental because upstream pstack skills use POSIX shell tools.

Some workflows need delegation or structured questions. Install the recommended providers to
use those workflows:

```bash
pi install npm:pi-subagents
pi install npm:pi-ask-user
```

With `pi-subagents` installed, the upstream agents register as `pistack-comment-sicko` and
`pistack-poteto-agent`.

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

The model can call the `pstack_adapter` tool with the `status`, `check`, `models`, `set_model`,
or `set_source` action.

## Read the support tiers

Each generated skill includes a support tier in its frontmatter. `/pistack-status` reports the
same tier.

| Tier | Meaning |
| --- | --- |
| `native` | The skill needs no Pi-specific changes, or the adapter supplies a Pi version. |
| `adapted` | The upstream body works with the host mappings in its wrapper. |
| `dependency-gated` | The workflow needs a capability or executable that may be missing. |
| `experimental` | Part of the workflow has no direct Pi equivalent. |
| `unsupported` | Pi cannot provide a required host feature. |

See [the compatibility registry](docs/compatibility.md) for every certified skill and the
evidence required to change a tier.

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
`set_source` action asks for confirmation before it changes the source. Restart Pi or run
`/reload` after the change.

You can write a user config at `~/.pi/agent/pi-pstack-adapter.json` or a project config at
`.pi/pi-pstack-adapter.json`:

```json
{
  "ref": "main",
  "pinnedCommit": "6ed0f7a9504f577d7529064103cecce9be7dfc5e",
  "models": {
    "feature": "provider/model"
  }
}
```

A branch or tag resolves to a commit when you select it through the adapter. The adapter records
that commit and does not advance it on later starts. The status report marks a custom repository
or an unpinned ref as untested. Skills from a custom repository run with your user permissions.

Environment variables override both config files:

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

## How the adapter handles upstream instructions

The adapter copies each upstream skill body without edits. It places Pi-specific instructions
before and after the body. Pi policy, host safety rules, and your instructions take precedence
over conflicting text in an upstream skill. Converted agent prompts include the same rule.

The adapter replaces the upstream `setup-pstack` body because that skill only writes Cursor
configuration. All other source bodies remain available for comparison with the upstream
checkout.

## Develop and test

Install dependencies and run the checks:

```bash
npm install
npm run check
npm test
npm run test:isolated
```

`npm run test:isolated` packs the current commit and installs it into a temporary Pi
configuration. The test verifies a refused bootstrap, an allowed bootstrap, and reuse of a warm
cache.

To use a local pstack checkout during development, set `PISTACK_UPSTREAM_PATH`:

```bash
PISTACK_UPSTREAM_PATH=/path/to/checkout pi
```

To test the adapter with an isolated Pi configuration, run:

```bash
./pi-sandbox.sh
```

Pass a project directory to test workflows against that project. Add `--project-skills` to load
its `.agents/skills` and `.pi/skills` directories. Use `--cold` to test the download prompt. Use
`--reset` to rebuild the sandbox.

```bash
./pi-sandbox.sh /path/to/project --project-skills
```

The sandbox isolates Pi configuration, not the working tree. Pi can still edit the project, so
use a disposable branch.

## License

This adapter is available under the [MIT License](LICENSE). Upstream pstack is also MIT-licensed
and remains copyright its authors.
