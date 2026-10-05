# Changelog

All notable changes to this VERSION-based module are documented here.

## [Unreleased]

## [0.2.0] - 2026-10-05

### Added

- Certify pstack `0.15.9` at commit `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a`. The adapter now registers 50 upstream skills.
- Classify the three skills new in this revision. `principle-explain-the-number` is `native`. `correct` is `dependency-gated` on `git`. `benchmark-checklist` is `dependency-gated` on `uptime` and `nproc`, because macOS has no `nproc` without GNU coreutils.
- Map the role values `auto` and `inherit-parent` in the host mapping. Both mean the subagent runs on the parent model. The model slug examples now name the current upstream defaults.

### Fixed

- Regenerate cached wrappers when the host mapping text changes. Before this fix, an edit to the mapping did not change the cache key, so a cached revision kept serving the old mapping.
- Derive the skill count in `npm run test:isolated` from the certified revision instead of a literal.

## [0.1.0] - 2026-09-24

### Added

- Run Cursor's official pstack plugin in Pi from an unmodified upstream checkout. The adapter downloads a pinned pstack revision, never edits it, and generates Pi skill wrappers and agent definitions from it. This release certifies pstack `0.15.2` at commit `6ed0f7a9504f577d7529064103cecce9be7dfc5e`.
- 47 upstream skills plus an adapter-owned status workflow, registered under the configurable `pistack` namespace as `/skill:pistack-*`.
- Both upstream pstack agents, registered with the installed delegation provider as `pistack-comment-sicko` and `pistack-poteto-agent`.
- Support tiers (`native`, `adapted`, `dependency-gated`, `experimental`, `unsupported`) published in each generated skill's frontmatter and in the status report, so no workflow claims verification it does not have.
- `/pistack-status`, `/pistack-check <skill>`, and `/pistack-mode on|off|status` commands, plus a `pstack_adapter` tool the agent can call for status, prerequisite checks, model listing, role assignment, and upstream source selection.
- Automatic activation of the `subagent` tool when a delegating pstack workflow starts. The adapter makes the same tool selection as `subagents_enable`. It does this for a `/skill:` command, for a model-initiated read of the skill's `SKILL.md`, and on each prompt while Poteto Mode is on. Delegating wrappers also tell the model to call `subagents_enable` if `subagent` is still missing.
- Capability detection for delegation and structured questions by tool shape rather than package name, with `pi-subagents` and `pi-ask-user` as the recommended providers and an actionable report when either is absent.
- Upstream source overrides by ref, repository, or local checkout, through config files or `PISTACK_*` environment variables. Untested refs warn, custom repositories warn harder, and a moving ref resolves to a recorded commit that startup reuses rather than advances.
- Offline operation after the first bootstrap. A noninteractive run with an empty cache refuses network access until `PISTACK_ALLOW_BOOTSTRAP=1` permits it.
- `pi-sandbox.sh`, which launches Pi against a throwaway config root holding only this adapter and its capability providers, optionally in a chosen project directory.
- `npm run test:isolated`, which clones, packs, and installs the package into an isolated Pi environment and asserts what Pi actually loaded.

### Security

- Reject git remote strings that name an executing transport such as `ext::`, cleartext or credential-bearing remotes, and refs git would parse as options.
- Require interactive user confirmation before `set_source` changes the upstream source or reaches the network, and refuse it outright without an interactive session. The tool is model-callable, so an untrusted upstream skill body could otherwise repoint the adapter at attacker-authored skills or use it as an outbound request channel.
- Accept only model ids the local Pi installation actually offers in `set_model`.
- Bracket every upstream skill body between explicit markers and repeat the host-precedence statement after it, so a body cannot close with an instruction to disregard the adapter notes. The body between the markers is still reproduced exactly.
- State host precedence above every upstream skill body and at the top of every converted agent's system prompt: Pi policy, host safety rules, and explicit user instructions override conflicting upstream autonomy instructions. The upstream text is preserved rather than deleted, so it stays auditable.
- Refuse upstream manifest paths and configured plugin paths that resolve outside the checkout, so a fetched repository cannot make the adapter read files elsewhere on disk.
- Ignore `__proto__`, `constructor`, and `prototype` keys when merging configuration files.
