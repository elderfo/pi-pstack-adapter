# Compatibility

The compatibility registry in `src/registry.ts` assigns one support tier to every skill in the
certified pstack revision. Generation reads it, the wrapper frontmatter publishes it, and
`/pistack-status` reports it.

Certified revision: pstack `0.15.30` at `eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10` in
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

Windows evidence was last gathered at pstack `0.15.30`, on Windows 11 Pro with Git for Windows
2.53.0, Node 22.23.2, Bun 1.3.14, Pi 1.3.0, and a portable Temurin JDK 21.0.12 with the latest
`tla2tools.jar`:

- The type check and unit suite pass: 187 tests, 183 passed, none failed, and the four symlink
  tests skipped. All nine integration tests pass with no skips, including the Windows 8.3
  short-path case and the statechart wrapper regression with its nested support files.
- The isolated install passes from Git Bash with the CLIProxyAPI scratch copy described below:
  58 skills, no `subagent` or `ask_user` with the provider extension loaded, and cache reuse
  without bootstrap permission. The installed checkout's 184 files match an LF export of the
  pinned tree byte for byte. The probe reports 58 skills, two agents, no diagnostics, 56 bodies
  byte-identical, `setup-pstack` replaced, and none mismatched. The 11 statechart support files
  sit beside the generated wrapper and match upstream.
- The installed status report shows `tested` trust at the certified commit. `/pistack-check`
  ran for all 58 skills. Each delegating skill names the missing `delegation` capability,
  `benchmark-checklist` still names `uptime`, and every other skill clears.
  `/pistack-check pistack-statechart` names `java` until a JDK is on PATH, then clears.
  Git Bash rewrites a leading `/` in a `pi -p` argument into a Windows path, so pass
  `MSYS2_ARG_CONV_EXCL='/pistack;/skill'` when scripting these commands.
- `statechart` ran in the isolated install against a checkout fixture whose 5-second timeout
  shows "Try again" while the first charge is still in flight. From the code, it wrote a TLA+
  model and a mapping, and TLC found the rule "A customer is never charged twice for one cart"
  broken (20 model states, 9 chart states). It rendered both charts to PNG, and the numbered
  five-step bug path read correctly. A replay script drove the real module with a fake gateway
  and clock and reproduced two charges. The fixture repository stayed clean. Two upstream
  defects needed workarounds. `--png` calls `spawnSync("npx")`, which cannot start `npx.cmd`
  on Windows, so the PNGs were rendered by running `npx` directly. Renaming a directory onto an
  existing one fails with `EPERM` on Windows, not `ENOTEMPTY` or `EEXIST`, so every rerun
  into an existing output folder fails and leaves it unchanged until the folder is deleted.
  This supports `dependency-gated` with those workarounds in its note.
- Upstream's own `scripts/test/statechart.test.mjs` does not pass on Windows: of 58 tests, 41
  pass, 2 skip, 12 fail, and 3 hang. The two defects above cause eight failures. Three expect
  `/` in paths that Windows prints with `\`, and one of those also sets `TMPDIR`, which Node
  ignores on Windows. One runs a fake `java` shell script, which Windows cannot start. The three
  hangs signal POSIX process groups.
- `poteto-help` routed a request to show a PM a double-charge path to
  `/skill:pistack-statechart`. It named the `pistack-` prefix and listed the missing `java` and
  `TLA2TOOLS` prerequisites.

Earlier Windows evidence, gathered at pstack `0.15.28` with the same toolchain:

- The type check and unit suite pass: 183 tests, 179 passed, none failed, and the four symlink
  tests skipped. All eight integration tests pass with no skips, including the Windows 8.3
  short-path case and both formal-verification wrapper regressions.
- The isolated install passes from Git Bash with the same CLIProxyAPI scratch copy as below: 57
  skills, no `subagent` or `ask_user` with the provider extension loaded, and cache reuse without
  bootstrap permission. The installed checkout's 172 files match an LF export of the pinned tree
  byte for byte. The probe reports 57 skills, two agents, no diagnostics, 55 bodies
  byte-identical, `setup-pstack` replaced, and none mismatched.
- The installed status report shows `tested` trust at the certified commit, and
  `/pistack-check pistack-maintain-formal-verification-skill` clears the workflow. `git` is
  its only executable, and Git for Windows bundles it.
- `maintain-formal-verification-skill` ran in the isolated install against a fixture whose
  `.pi/skills/` verify skill recorded a sync commit, followed by a rename of a covered function
  and a new batch function that wrote the guarded state without its duplicate-ID guard. It
  found the skill, ran the stale check (it crashed on the rename), read all three commits since
  the sync commit, renamed the call, extended the harness to the new function, and reported the
  bug with the commit that introduced it and a two-step counterexample. It proved the updated
  check could pass and fail by temporarily fixing and then breaking the product file, restored
  it, moved the sync commit, and committed only the verification and verify-skill changes.
  This supports `dependency-gated` on `git`.
- The changed `create-formal-verification-skill` reran in the isolated install. It generated
  `.pi/skills/verify-inventory-ledger/SKILL.md` with the coverage record and sync commit new in
  `0.15.28`, plus a dependency-free Node verifier over the real functions (28 states, 168 calls).
  The check caught six deliberate breaks, and the product file's content was unchanged after
  each restore. `adapted` still holds.

Earlier Windows evidence, gathered at pstack `0.15.26` with the same toolchain:

- The type check and unit suite pass: 173 tests passed, none failed, and four symlink tests
  skipped because Windows requires Developer Mode or administrator rights. The seven scheduled
  integration tests pass with no skips: six cache-containment cases, including a Windows 8.3
  short-path case, and a formal-verification wrapper regression.
  Run these separately with `npm run test:integration`; their CI lane is daily and manually
  dispatchable, not per PR. The existing unit-suite CI matrix still covers all three platforms.
- The isolated install passes from Git Bash: the cold run registers no skills without bootstrap
  permission, the permitted run registers all 56 skills, and a later run reuses the cache
  without bootstrap permission. The local CLIProxyAPI provider requires its extension, config,
  and model catalog in the sandbox; a scratch copy of the install script supplies them. Its
  tool probe still reports no `subagent` or `ask_user`. Sandbox credentials are removed on exit.
- The certification probe passes on an LF export of the pinned tree: 56 skills, two agents,
  no diagnostics, 54 bodies byte-identical, `setup-pstack` replaced, and none mismatched.
  All 171 files in the isolated installed cache match the LF export byte for byte.
- `create-formal-verification-skill` completed in the isolated install without `subagent` or
  `ask_user`. It generated `.pi/skills/verify-inventory-reservations/SKILL.md` and a dependency-free
  Node 22 explicit-state verifier that imports the fixture's actual reserve/release functions.
  It checked 49 reachable states and 490 transitions for stock 0–3 and five request IDs, caught
  six mutant copies, then caught a removed retry guard in the actual product file. Restoring
  that file restored the passing result and its original hash. This supports `adapted`: the
  generated skill path is mapped to Pi. It does not certify TLA+, proof assistants, installation
  of other verifiers, unbounded inputs, or real database/async concurrency.
- The revised `ketchup` ran read-only in a separate fixture. It listed both supplied product
  choices (CSV versus JSON and seven versus thirty days of history), drew a Mermaid sequence
  diagram for a late-retry edge case it reproduced, and left the fixture unchanged. It did not
  contact GitHub for this fixture-only task.
- Installed status reports show native Windows plugin and generated-skill paths and `tested`
  trust at the certified commit. `/pistack-check` clears the formal-verification workflow and
  `ketchup`, but still names `uptime` as missing for `benchmark-checklist`. Delegation and
  structured questions remain unavailable in the isolated install; no delegating tier changed.
- A cache inside a Git worktree must own its worktree, Git directory, and common directory before
  bootstrap or reuse can change Git state. The Windows run exposed ancestor discovery from an
  empty nested cache; this is fixed. Regressions also cover incomplete metadata, a foreign Git
  file, foreign worktree/common directory settings, and short paths, while checking that the
  enclosing repository's HEAD, config, index, and tracked bytes stay unchanged.

Historical coverage below has not been rerun at `0.15.26` unless stated otherwise:

- At `0.15.23`, `in-your-own-words`, `ketchup`, and `poteto-help` ran end to end in the isolated install, with
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

### adapted (3)

| upstream skill | Pi skill | capabilities | executables | why |
| --- | --- | --- | --- | --- |
| `create-formal-verification-skill` | `/skill:pistack-create-formal-verification-skill` | - | - | Manual invocation only; no delegation. It installs or runs the verification tool it chooses and temporarily breaks product code to prove the check. Generated skills belong under `.pi/skills/` in Pi. Verified on a Windows Node finite-state fixture; other toolchains need their own prerequisites. |
| `create-verification-skill` | `/skill:pistack-create-verification-skill` | - | - | Only the generated skill's output path needs remapping to Pi's skill directory. |
| `ketchup` | `/skill:pistack-ketchup` | - | - | Read-only. Pi has no `/visualize` skill or image generation, so its visuals are Mermaid diagrams and screenshots that already exist. It checks PR and CI state only for work the chat touched. |

### dependency-gated (15)

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
| `maintain-formal-verification-skill` | `/skill:pistack-maintain-formal-verification-skill` | - | `git` | Verified end to end on a Windows Node finite-state fixture at pstack 0.15.28. Manual invocation only; no delegation. It diffs the covered code with git from the verify skill's sync commit, edits only the verification and the verify skill, and temporarily breaks product code to prove an updated check can still fail. In Pi, look for the verify skill under `.pi/skills/`; the verification tool needs its own prerequisites. |
| `maintain-verification-skill` | `/skill:pistack-maintain-verification-skill` | `delegation` | - | Source wave launches one read-only subagent per feature file. |
| `no-comments` | `/skill:pistack-no-comments` | `delegation` | `git` | Step 1 must spawn the comment-sicko agent; the skill only triages its report. |
| `show-me-your-work` | `/skill:pistack-show-me-your-work` | `delegation` | - | The mandatory cross-model review of the trail requires spawning a different-family subagent. |
| `statechart` | `/skill:pistack-statechart` | - | `node`, `java`, `npx` | Verified end to end on a Windows checkout fixture at pstack 0.15.30. Manual invocation only; no delegation or structured question. Its scripts run under `node` and run TLC with `java`, or the binary in `JAVA`, and need `TLA2TOOLS` set to a downloaded `tla2tools.jar`. The prerequisite check looks for `java` on PATH even when `JAVA` is set. `--png`, which its chart and hand-off steps use, runs `npx -y @mermaid-js/mermaid-cli`, which downloads and runs that package. It imports the `.map.mjs` mapping file as JavaScript with full process permissions, so review an existing mapping before you run it. Each run replaces its whole output folder and deletes the previous contents, so run it in a scratch folder outside the repository with a dedicated output folder. Git for Windows bundles none of these executables. On native Windows, `--png` cannot start `npx` (`spawnSync npx ENOENT`), so render each `.mmd` with `npx -y @mermaid-js/mermaid-cli -i <chart>.mmd -o <chart>.png` yourself. A rerun into an existing output folder also fails with `EPERM` and leaves the old folder in place, so delete the output folder before each rerun. |
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
| `sharpen` | `/skill:pistack-sharpen` | - | - | New in pstack 0.15.25 and not yet run end to end in Pi. Since pstack 0.15.29 it hands back a rewritten prompt and does not do the task. Its body is prompt-only, with no tool, delegation, or executable, and it runs only when you type it. |
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

`setup-pstack` writes a Cursor `.mdc` rule, so the adapter substitutes its own body and
publishes it as `/skill:pistack-setup`. Upstream's optional closing offers to run
`create-verification-skill` and `create-formal-verification-skill` are left out of the Pi body;
both skills stay available by name. The upstream skill stays represented, and the
wrapper frontmatter records `pistack-upstream-skill: setup-pstack`.

## Unknown skills

A skill present upstream but absent from the registry is generated as `experimental` and reported
in diagnostics. A skill in the registry but absent upstream is reported as removed. Neither case
is silent.
