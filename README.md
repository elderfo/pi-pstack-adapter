# pi-pstack-adapter

Run Cursor's official [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin inside
[Pi](https://pi.dev), from an unmodified upstream checkout.

This is not a port. The adapter downloads a pinned pstack revision, leaves it untouched, and
generates Pi skill wrappers and agent definitions from it at startup. Upstream stays the source
of truth, so a new pstack release needs a new certified commit, not a re-port.

## Install

```bash
pi install git:github.com/cgetsfred/pi-pstack-adapter
```

The first interactive session asks before downloading pstack into
`~/.pi/agent/cache/pi-pstack-adapter/`. Later sessions reuse that cache and need no network.
A noninteractive run with an empty cache refuses to reach the network until you set
`PISTACK_ALLOW_BOOTSTRAP=1`.

## Use

Every pstack skill is registered under the `pistack` namespace.

```
/skill:pistack-how
/skill:pistack-unslop
/skill:pistack-poteto-mode
```

Adapter commands.

| command | does |
| --- | --- |
| `/pistack-status` | full report: versions, commit, trust, tiers, capabilities, diagnostics |
| `/pistack-check <skill>` | prerequisites for one workflow, before it starts |
| `/pistack-mode on\|off\|status` | Poteto Mode for the current session |
| `/skill:pistack-setup` | assign a Pi model to each pstack role |
| `/skill:pistack-status` | the same report, through the agent |

The model can also call the `pstack_adapter` tool directly with `status`, `check`, `models`,
`set_model`, or `set_source`.

## Support tiers

Each generated skill publishes a tier in its frontmatter and in the status report.

| tier | meaning |
| --- | --- |
| `native` | adapter-owned content, written for Pi |
| `adapted` | upstream body works once you apply the host mapping |
| `dependency-gated` | needs a capability or executable that may be absent |
| `experimental` | depends on host behavior with no clean Pi equivalent |
| `unsupported` | needs something Pi cannot provide |

Run `pstack_adapter` with `action: "check"` before starting a workflow. It reports the
capabilities and executables that workflow needs, and whether this environment has them, before
the workflow does any work.

See [docs/compatibility.md](docs/compatibility.md) for the tier of every skill and for how a
tier changes.

## Capabilities

The adapter detects capabilities, not package names.

| capability | what it needs | recommended provider |
| --- | --- | --- |
| `delegation` | a `subagent` tool taking `agent`, `task`, `async`, and `model` | [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) |
| `structured-question` | an `ask_user` tool taking `question` and `options` | [`pi-ask-user`](https://www.npmjs.com/package/pi-ask-user) |

pstack's two agents, `comment-sicko` and `poteto-agent`, register at session start with whichever
installed extension owns the pi-subagents runtime registration contract. They appear as
`pistack-comment-sicko` and `pistack-poteto-agent`. The adapter installs nothing on your behalf.

## Selecting another upstream revision

Each release certifies one pstack version and commit. You can select another, at your own risk.

```jsonc
// ~/.pi/agent/pi-pstack-adapter.json, or .pi/pi-pstack-adapter.json for one project
{
  "ref": "main",
  "pinnedCommit": "6ed0f7a9504f577d7529064103cecce9be7dfc5e",
  "models": { "feature": "anthropic/claude-sonnet-4-5" }
}
```

A branch or tag is resolved to a commit once and recorded, either by explicit setup or by the
first bootstrap that used it. Startup reuses the recorded commit and never checks upstream for
updates, so a moving ref does not advance underneath you.

Changing the upstream source is a decision only you can make. The `set_source` action asks for
confirmation and refuses outright without an interactive session, because an untrusted upstream
skill body could otherwise talk the agent into repointing the adapter or reaching a chosen host. Naming a `ref` or another
`repo` without a `pinnedCommit` drops the certified pin, so you get what you asked for and a
warning that it is untested. A custom repository warns harder, because its skills run with your
full permissions. A repository string is rejected unless it is an https, ssh, git, scp-style, or
filesystem source, so git transports that execute shell commands never reach git.

Environment overrides win over both config files.

| variable | effect |
| --- | --- |
| `PISTACK_NAMESPACE` | replace `pistack` in every generated identifier |
| `PISTACK_UPSTREAM_REPO` | select another repository |
| `PISTACK_UPSTREAM_REF` | select a branch, tag, or commit |
| `PISTACK_UPSTREAM_PATH` | use a local pstack checkout |
| `PISTACK_ALLOW_BOOTSTRAP` | permit a noninteractive download |
| `PISTACK_CACHE_DIR` | relocate the cache |
| `PISTACK_MODELS` | `role=provider/model,role2=provider/model2` |

## Host precedence

Every generated wrapper states, both above and below the upstream body, that Pi policy, the
host's safety rules, and your explicit instructions override any conflicting autonomy or
permission instruction in it. The body sits between two markers and is reproduced exactly, so
you can audit adapter instructions separately from upstream instructions, and a body cannot get
the last word by ending with an override. Converted agents carry the same statement at the top
of their system prompt.

## Platforms

Linux and macOS are supported. Windows loads in experimental mode with a warning. Adapter-owned
code uses portable Node APIs and never creates symbolic links, but upstream pstack skills call
POSIX shell tools that Windows may not provide.

## Development

```bash
npm install
npm run check          # tsc --noEmit
npm test               # module behavior, fixture upstreams, real local git repos
npm run test:isolated  # clone, pack, install into a throwaway Pi config, assert what loaded
```

`test:isolated` is the end-to-end check. It clones the current commit, packs it, installs only
what the tarball ships with `npm install --omit=dev`, installs that into a throwaway
`PI_CODING_AGENT_DIR` with no packages and no skills, and asserts what Pi actually loaded: zero
skills when bootstrap is refused, 48 skills after explicit permission, and the same 48 from a
warm cache with bootstrap permission withdrawn. Both capabilities are correctly reported
absent. It copies only `auth.json` from your real config directory, so a provider credential is
required and nothing else leaks in. The offline claim is proven separately by the unit tests,
which inject a git runner that fails every network command.

Point the adapter at a working copy of pstack with `PISTACK_UPSTREAM_PATH=/path/to/checkout`.

For hands-on testing, `./pi-sandbox.sh [dir]` launches Pi against a throwaway
`PI_CODING_AGENT_DIR` holding only this adapter, `pi-subagents`, and `pi-ask-user`. Pass a
project directory to try pstack workflows on real code; add `--project-skills` to keep that
project's own skills. It hides `~/.agents/skills`, which `PI_CODING_AGENT_DIR` does not cover,
so an unprefixed pstack copy on your machine cannot mask a missing wrapper. Use `--cold` to
retest the first-run download dialog and `--reset` to rebuild the sandbox.

The sandbox isolates configuration, not the working tree. Pi has the same write access in that
project it always has, so point it at a branch you can throw away.

## License

MIT. Upstream pstack is MIT, copyright its authors, and is neither vendored nor modified by this
package.
