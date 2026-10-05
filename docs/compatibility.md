# Compatibility

The compatibility registry in `src/registry.ts` assigns one support tier to every skill in the
certified pstack revision. Generation reads it, the wrapper frontmatter publishes it, and
`/pistack-status` reports it.

Certified revision: pstack `0.15.9` at `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a` in
`https://github.com/cursor/plugins`.

## Platforms

| platform | status | shell the skills run in |
| --- | --- | --- |
| Linux, including Pi inside WSL | supported | Bash |
| macOS | supported | Bash |
| Windows, native | supported | Git Bash, Pi's default `bash` tool shell |
| anything else | experimental | whatever Pi resolves |

The tiers below apply on every supported platform. Per-skill executables are checked in the
shell the skills run in. On Windows, `/pistack-check` asks Git Bash, with Pi's
`shellCommandPrefix` applied, because its `PATH` adds `/usr/bin` and `/mingw64/bin` to the
`PATH` Pi started with.

Windows evidence at the certified revision, on Windows 11 with Git for Windows 2.53, Node 22,
and Pi 1.0.2:

- The unit suite passes, and `npm run test:isolated` passes against the adapter commit that
  introduced Windows support. Pi registers all 51 skills, and a later run reuses the cache
  without the network. CI runs the unit suite on Windows for every change.
- Every upstream helper script ran in Git Bash: `show-me-your-work/scripts/log.sh`,
  `poteto-mode/scripts/check-plan.mjs`, `worktree-audit.sh`, `watch-pr`, and `orch.ts`.
- Git for Windows bundles `git`, `curl`, `nproc`, and the POSIX tools the skill bodies call,
  but not `uptime`, so `benchmark-checklist` reports it missing. `gh`, `tailscale`, and `sudo`
  are separate installs on Windows, as on the other platforms.
- The adapter checks out upstream with `core.autocrlf=false`. Git for Windows enables
  `autocrlf` system-wide, which would otherwise rewrite every upstream file to CRLF. A cache
  written before that setting existed is repaired on the next start, or refused with a recovery
  step when it cannot be written.

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

### native (30)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `bro` | `/skill:pistack-bro` | - | - | - |
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

### adapted (1)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `create-verification-skill` | `/skill:pistack-create-verification-skill` | - | - | Only the generated skill's output path needs remapping to Pi's skill directory. |

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
| `no-comments` | `/skill:pistack-no-comments` | `delegation` | `git` | Step 1 must spawn the named Comment Sicko agent; the skill only triages its report. |
| `show-me-your-work` | `/skill:pistack-show-me-your-work` | `delegation` | - | The mandatory cross-model review of the trail requires spawning a different-family subagent. |
| `teach` | `/skill:pistack-teach` | `delegation` | - | It runs the how and why skills, both of which need subagents. |
| `why` | `/skill:pistack-why` | `delegation` | `git`, `gh` | Default posture spawns one investigator subagent per evidence category plus a synthesizer. |

### experimental (5)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `automate-me` | `/skill:pistack-automate-me` | `delegation`, `structured-question` | `git`, `gh` | Mining step depends on Cursor transcript files and the built-in create-skill skill, with no Pi equivalent. |
| `poteto-mode` | `/skill:pistack-poteto-mode` | `delegation`, `structured-question` | `git`, `gh` | Sticky-mode hosting plus references to Cursor built-in and plugin skills only partially map to Pi. |
| `recall` | `/skill:pistack-recall` | `delegation` | `git`, `gh` | Core corpus is Cursor's on-disk transcript JSONL, so only the git/gh and shared-record half survives. |
| `reflect` | `/skill:pistack-reflect` | `delegation` | - | Transcript mining and create-skill routing are Cursor-specific, though the digest fallback partly works. |
| `swarm` | `/skill:pistack-swarm` | `delegation` | - | Cloud background workers and cloud_base_branch have no Pi mapping; only local fan-out approximates it. |

### unsupported (1)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `make-bot-ui` | `/skill:pistack-make-bot-ui` | - | `curl`, `tailscale`, `sudo` | Built entirely on Cursor Automations webhook routines and the secret-request card. |

## Agents

| upstream agent | Pi agent | notes |
| --- | --- | --- |
| `comment-sicko` | `pistack-comment-sicko` | Display name `Comment Sicko` is preserved in the description. Needs `git` to scope a diff. |
| `poteto-agent` | `pistack-poteto-agent` | Upstream `is_background: true` has no runtime equivalent; the caller chooses `async` on the `subagent` call. |

Both register through the `pi-subagents:runtime-agent-register:v1` contract. Without an owner for
that event, the status report says so rather than dropping them silently.

## Skills the adapter replaces

`setup-pstack` writes a Cursor `.mdc` rule and nothing else, so the adapter substitutes its own
body and publishes it as `/skill:pistack-setup`. The upstream skill stays represented, and the
wrapper frontmatter records `pistack-upstream-skill: setup-pstack`.

## Unknown skills

A skill present upstream but absent from the registry is generated as `experimental` and reported
in diagnostics. A skill in the registry but absent upstream is reported as removed. Neither case
is silent.
