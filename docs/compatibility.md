# Compatibility

The compatibility registry in `src/registry.ts` assigns one support tier to every skill in the
certified pstack revision. Generation reads it, the wrapper frontmatter publishes it, and
`/pistack-status` reports it.

Certified revision: pstack `0.15.25` at `101b274dd991f694e1f7024be2157e5f3adf07de` in
`https://github.com/cursor/plugins`.

## Platforms

| platform | status | shell the skills run in |
| --- | --- | --- |
| Linux, including Pi inside WSL | supported | Bash |
| macOS | supported | Bash |
| Windows, native | supported | Git Bash, Pi's default `bash` tool shell |
| anything else | experimental | whatever Pi resolves |

The tiers below apply on every supported platform. `/pistack-check` looks for per-skill
executables in the shell the skills run in, with Pi's `shellCommandPrefix` applied. On Windows
that matters most, because Git Bash adds `/usr/bin` and `/mingw64/bin` to the `PATH` Pi
started with. A shell that is missing, inactive, or cannot run a command blocks every workflow.

Windows evidence was last gathered at pstack `0.15.23`, on Windows 11 with Git for Windows 2.53,
Node 22, Bun 1.3, and Pi 1.2.0. CI runs the unit suite on Windows at `0.15.25`; the rest of this
list has not been rerun there:

- The unit suite and the type check pass. `npm run test:isolated` passes from Git Bash: Pi
  registers all 54 skills, and a later run reuses the cache without the network. CI runs the
  unit suite on Windows for every change.
- The certification probe passes on an LF export of the tree: no diagnostics, 52 bodies
  byte-identical, and none mismatched. The adapter's cache checkout matches that export byte for
  byte.
- `in-your-own-words`, `ketchup`, and `poteto-help` ran end to end in the isolated install, with
  no `subagent` or `ask_user` tool. `ketchup` reported a commit and a pending decision with
  Mermaid diagrams and changed nothing. `poteto-help` answered with `/pistack-mode on` and read
  the guide from the `plugin directory` row, whose Windows path it resolved.
- The status report's `plugin directory` and `generated skills` rows give native Windows paths.
  `/pistack-check` clears `ketchup`, and still reports `uptime` missing for `benchmark-checklist`.
- The helpers changed in `0.15.23` ran in Git Bash. `worktree-audit.sh` handled `-b <ref>`,
  `--help`, an unknown base, and the `origin/HEAD` fallback, and classified a linked worktree.
  `check-plan.mjs` ran on Node. Upstream's helper suite passed 61 of 63 tests under Bun. The two
  failures fake the Graphite `gt` CLI with a shell script, which Bun cannot spawn on Windows.
  Both fail at `0.15.9` too, and the adapter does not gate on `gt`.
- At `0.15.25`, `orch.ts` resolves the stack frontier through `gh`, or `origin` with
  `--forge origin`, instead of `gt`. `poteto-mode` already requires `gh`. `worktree-audit.sh`
  reads PR state through `origin` when it is installed, otherwise `gh`, and reports no PR state
  when neither works. Neither helper has run on Windows at `0.15.25`.
- At pstack `0.15.9`, `show-me-your-work/scripts/log.sh`, `watch-pr`, and `orch.ts` also ran
  in Git Bash. None of them changed in a way that adds an executable or a path assumption.
- Git for Windows bundles `git`, `curl`, `nproc`, and the POSIX tools the skill bodies call,
  but not `uptime`, so `benchmark-checklist` reports it missing. `gh`, `tailscale`, and `sudo`
  are separate installs on Windows, as on the other platforms.
- The adapter checks out upstream with `core.autocrlf=false`. Git for Windows enables
  `autocrlf` system-wide, which would otherwise rewrite every upstream file to CRLF. A cache
  written before that setting existed is repaired on the next start, or refused with a recovery
  step when it cannot be written. `git archive` follows the same setting, so a certification
  export on Windows needs `-c core.autocrlf=false`. Without it, 155 upstream text files at
  `0.15.23` come out as CRLF and no longer match what Pi loads.

A session that replaces the `bash` tool with `powershell` cannot run the skills.
`/pistack-status` reports it, and `/pistack-check` refuses to clear any workflow.

## Tiers

| tier | meaning |
| --- | --- |
| `native` | adapter-owned content, or a body with no host-specific machinery at all |
| `adapted` | works once the reader applies the host mapping the wrapper links to |
| `dependency-gated` | needs a host capability or an executable that may be absent |
| `experimental` | depends on host behavior with no clean Pi equivalent, may partly work |
| `unsupported` | needs something Pi cannot provide, so the workflow cannot reach its purpose |

## Changing a tier

A tier is a claim about what was verified, so raising one needs evidence, not optimism.

1. Run the workflow end to end in Pi against the certified revision.
2. Record what the workflow produced, not that it started. A `dependency-gated` skill rises to
   `adapted` only when its delegation or question steps completed against a real provider.
3. An `experimental` skill rises only when every Cursor-specific step has a Pi equivalent that
   was exercised, not merely described in the host mapping.
4. An `unsupported` skill rises only when the missing host feature exists in Pi.
5. Add or update a test that fails if the claim regresses.

Lowering a tier needs one reproduction of the failure and a note saying what broke.

## Registry

### native (31)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `bro` | `/skill:pistack-bro` | - | - | - |
| `in-your-own-words` | `/skill:pistack-in-your-own-words` | - | - | - |
| `principle-attack-the-premise` | `/skill:pistack-principle-attack-the-premise` | - | - | - |
| `principle-boundary-discipline` | `/skill:pistack-principle-boundary-discipline` | - | - | - |
| `principle-build-the-lever` | `/skill:pistack-principle-build-the-lever` | - | - | - |
| `principle-encode-lessons-in-structure` | `/skill:pistack-principle-encode-lessons-in-structure` | - | - | - |
| `principle-exhaust-the-design-space` | `/skill:pistack-principle-exhaust-the-design-space` | - | - | - |
| `principle-experience-first` | `/skill:pistack-principle-experience-first` | - | - | - |
| `principle-explain-the-number` | `/skill:pistack-principle-explain-the-number` | - | - | For a performance number it hands off to benchmark-checklist, which needs uptime and nproc. Check that skill first. |
| `principle-fix-root-causes` | `/skill:pistack-principle-fix-root-causes` | - | - | - |
| `principle-foundational-thinking` | `/skill:pistack-principle-foundational-thinking` | - | - | - |
| `principle-guard-the-context-window` | `/skill:pistack-principle-guard-the-context-window` | - | - | - |
| `principle-laziness-protocol` | `/skill:pistack-principle-laziness-protocol` | - | - | - |
| `principle-make-operations-idempotent` | `/skill:pistack-principle-make-operations-idempotent` | - | - | - |
| `principle-migrate-callers-then-delete-legacy-apis` | `/skill:pistack-principle-migrate-callers-then-delete-legacy-apis` | - | - | - |
| `principle-minimize-reader-load` | `/skill:pistack-principle-minimize-reader-load` | - | - | - |
| `principle-model-the-domain` | `/skill:pistack-principle-model-the-domain` | - | - | - |
| `principle-never-block-on-the-human` | `/skill:pistack-principle-never-block-on-the-human` | - | - | - |
| `principle-outcome-oriented-execution` | `/skill:pistack-principle-outcome-oriented-execution` | - | - | - |
| `principle-prove-it-works` | `/skill:pistack-principle-prove-it-works` | - | - | - |
| `principle-redesign-from-first-principles` | `/skill:pistack-principle-redesign-from-first-principles` | - | - | - |
| `principle-separate-before-serializing-shared-state` | `/skill:pistack-principle-separate-before-serializing-shared-state` | - | - | - |
| `principle-sequence-verifiable-units` | `/skill:pistack-principle-sequence-verifiable-units` | - | - | - |
| `principle-subtract-before-you-add` | `/skill:pistack-principle-subtract-before-you-add` | - | - | - |
| `principle-test-behavior-not-implementation` | `/skill:pistack-principle-test-behavior-not-implementation` | - | - | - |
| `principle-type-system-discipline` | `/skill:pistack-principle-type-system-discipline` | - | - | - |
| `setup-pstack` | `/skill:pistack-setup` | - | - | The upstream body only writes a Cursor .mdc rule, so the adapter replaces it with a Pi setup workflow. |
| `tdd` | `/skill:pistack-tdd` | - | - | - |
| `technical-writing` | `/skill:pistack-technical-writing` | - | - | - |
| `typescript-best-practices` | `/skill:pistack-typescript-best-practices` | - | - | - |
| `unslop` | `/skill:pistack-unslop` | - | - | - |

### adapted (2)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `create-verification-skill` | `/skill:pistack-create-verification-skill` | - | - | Only the generated skill's output path needs remapping to Pi's skill directory. |
| `ketchup` | `/skill:pistack-ketchup` | - | - | Read-only. Pi has no `/visualize` skill or image generation, so its visuals are Mermaid diagrams and screenshots that already exist. It checks PR and CI state only for work the chat touched. |

### dependency-gated (13)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `architect` | `/skill:pistack-architect` | `delegation` | - | Phase B delegates to arena runners, so it cannot run without parallel subagents. |
| `arena` | `/skill:pistack-arena` | `delegation` | `git` | The whole skill is spawning N candidate subagents plus a judge. |
| `benchmark-checklist` | `/skill:pistack-benchmark-checklist` | - | `uptime`, `nproc` | Its setup step checks load with `uptime` and cores with `nproc`. macOS has no `nproc` without GNU coreutils, and Git Bash on Windows has no `uptime`. |
| `blast-radius` | `/skill:pistack-blast-radius` | - | `git`, `gh` | Needs git and gh to read the diff, commits, and PR before any analysis. |
| `correct` | `/skill:pistack-correct` | - | `git` | Mines commit history, then commits fixes and edits lint, CI, and agent instruction files. Run it on a branch you will review. |
| `figure-it-out` | `/skill:pistack-figure-it-out` | `delegation` | - | Phase B fan-out and the architect/arena routing require parallel subagents. |
| `how` | `/skill:pistack-how` | `delegation` | - | Every path spawns explorer or explainer subagents; nothing runs inline. |
| `interrogate` | `/skill:pistack-interrogate` | `delegation` | `git` | Multi-model adversarial review is entirely one subagent per configured model. |
| `maintain-verification-skill` | `/skill:pistack-maintain-verification-skill` | `delegation` | - | Source wave launches one read-only subagent per feature file. |
| `no-comments` | `/skill:pistack-no-comments` | `delegation` | `git` | Step 1 must spawn the comment-sicko agent; the skill only triages its report. |
| `show-me-your-work` | `/skill:pistack-show-me-your-work` | `delegation` | - | The mandatory cross-model review of the trail requires spawning a different-family subagent. |
| `teach` | `/skill:pistack-teach` | `delegation` | - | It runs the how and why skills, both of which need subagents. |
| `why` | `/skill:pistack-why` | `delegation` | `git`, `gh` | Default posture spawns one investigator subagent per evidence category plus a synthesizer. |

### experimental (7)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `automate-me` | `/skill:pistack-automate-me` | `delegation`, `structured-question` | `git`, `gh` | Mining step depends on Cursor transcript files and the built-in create-skill skill, with no Pi equivalent. |
| `poteto-help` | `/skill:pistack-poteto-help` | - | - | Its answers describe Cursor setup, the slash menu, and Custom Modes. A request for work runs poteto-mode, which is experimental. It asks a multiple-choice question only when the need is unclear. Its README and guide links resolve under the status report's plugin directory. |
| `poteto-mode` | `/skill:pistack-poteto-mode` | `delegation`, `structured-question` | `git`, `gh` | Sticky-mode hosting plus references to Cursor built-in and plugin skills only partially map to Pi. |
| `recall` | `/skill:pistack-recall` | `delegation` | `git`, `gh` | Core corpus is Cursor's on-disk transcript JSONL, so only the git/gh and shared-record half survives. |
| `reflect` | `/skill:pistack-reflect` | `delegation` | - | Transcript mining and create-skill routing are Cursor-specific, though the digest fallback partly works. |
| `sharpen` | `/skill:pistack-sharpen` | - | - | New in pstack 0.15.25 and not yet run end to end in Pi. Its body is prompt-only, with no tool, delegation, or executable, and it runs only when you type it. |
| `swarm` | `/skill:pistack-swarm` | `delegation` | - | Cloud background workers and cloud_base_branch have no Pi mapping; only local fan-out approximates it. |

### unsupported (1)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `make-bot-ui` | `/skill:pistack-make-bot-ui` | - | `curl`, `tailscale`, `sudo` | Built entirely on Cursor Automations webhook routines and the secret-request card. |

## Agents

| upstream agent | Pi agent | notes |
| --- | --- | --- |
| `comment-sicko` | `pistack-comment-sicko` | Upstream names it `comment-sicko` since pstack 0.15.23, so the registered description starts with that name. Needs `git` to scope a diff. |
| `poteto-agent` | `pistack-poteto-agent` | Upstream `is_background: true` has no runtime equivalent; the caller chooses `async: true` on `subagent`, or `mode: "async"` on `delegate_task`. Upstream tells it to search `~/.cursor/plugins/` when its parent gives no path. The adapter puts the generated `pistack-poteto-mode/SKILL.md` path in every agent prompt and forbids that search, which would load content outside the certified revision. |

T3 Code's `delegate_task` has no named agents. Generation writes each agent's prompt to
`adapter/agents/<pi-name>.md`, with skill paths relative to that file. The parent begins the
child's task by telling it to read that file as its system prompt.

Both agents also register through the `pi-subagents:runtime-agent-register:v1` contract. Without an owner for
that event, the status report says so rather than dropping them silently.

## Delegation providers

The `delegation` capability is satisfied by T3 Code's `mcp__t3-code__delegate_task` or by
`pi-subagents`' `subagent`, in the order the `delegation` setting gives, T3 first by default.
A hidden registration does not count. A T3 tool counts only when the extension at
`T3_PI_MCP_EXTENSION_PATH`, the bridge T3 Code launches, registered it, and only when it accepts
`task`, `target`, and `mode`. Status and activation share that resolution, so the report always
names the backend a workflow gets. The adapter activates only that backend. For T3 it also
activates `task_status` and `orchestrator_capabilities` when the bridge registered them.
A delegating wrapper tells the model to read the tool from `/pistack-check` and to use no other,
so a rejected tool that is still in the session is not used. The check also names the companion
tools the model may call, and forbids any companion it could not trace to T3 Code.

An agent prompt file wraps the upstream body in the same markers as a skill wrapper, with host
precedence before and after it. The closing note says that everything after the opening notes is
upstream content, even text that imitates a marker. An upstream skill or agent body that contains
marker text is reported as a warning, with its bytes unchanged. An agent whose Pi name breaks the
skill name rules is skipped with an error, before its name reaches a file name or any generated
text.

Unit tests cover detection, activation order, and the generated instructions for both providers.
No tier changed when T3 support arrived, because no delegating workflow has yet run end to end
through `delegate_task`. That run is the evidence the tier rules above require.

## Skills the adapter replaces

`setup-pstack` writes a Cursor `.mdc` rule and nothing else, so the adapter substitutes its own
body and publishes it as `/skill:pistack-setup`. The upstream skill stays represented, and the
wrapper frontmatter records `pistack-upstream-skill: setup-pstack`.

## Unknown skills

A skill present upstream but absent from the registry is generated as `experimental` and reported
in diagnostics. A skill in the registry but absent upstream is reported as removed. Neither case
is silent.
