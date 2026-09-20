# Pi pstack adapter

## Problem statement

Cursor's pstack plugin provides skills, agents, model routing, and engineering workflows. Its implementation assumes Cursor-specific plugin discovery, commands, paths, tools, models, subagents, and automation features.

Pi users cannot use the official pstack release directly. Existing Pi versions of pstack are ports or forks. Each port copies and changes upstream files, so maintainers must repeat that work for each pstack release.

Users need a Pi package that consumes an unchanged upstream pstack checkout. The package must adapt Cursor-specific behavior at a small, explicit compatibility boundary. It must preserve the official pstack repository as the source of truth.

## Solution

Create a Pi package named `pi-pstack-adapter`.

The package downloads and caches a pinned official pstack revision. It generates Pi skill wrappers and agent definitions from that unchanged checkout. Generated wrappers add Pi-specific instructions before the exact upstream skill body. The package copies each skill's supporting files byte-for-byte into disposable generated state.

The adapter exposes pstack skills under the configurable `pistack` namespace. It maps pstack's Cursor requirements to existing Pi capabilities, including `subagent` and `ask_user`. It reports missing capabilities before an affected workflow starts.

Each adapter release records a tested pstack version and commit. Users can select another Git ref, repository, or local checkout. The adapter warns that these overrides are unverified and resolves moving refs to a recorded commit.

The first release supports Linux and macOS. Windows runs in an experimental mode with warnings.

## User stories

1. As a Pi user, I want to install `pi-pstack-adapter` from Git, so that I can use pstack workflows in Pi.
2. As a Pi user, I want the adapter to consume the official pstack repository, so that I do not depend on a separately maintained fork.
3. As a Pi user, I want the adapter to pin a tested pstack commit, so that my installation remains reproducible.
4. As a Pi user, I want the first interactive use to download pstack automatically, so that setup requires no manual repository commands.
5. As a Pi user, I want the adapter to reuse its cached checkout, so that later Pi sessions work offline.
6. As a CI operator, I want noninteractive runs to avoid unexpected network access, so that builds remain deterministic.
7. As a CI operator, I want an explicit option to permit bootstrap, so that I can prepare a new environment when required.
8. As a Pi user, I want normal startup to avoid upstream update checks, so that startup does not depend on GitHub.
9. As a Pi user, I want an explicit status workflow, so that I can inspect the adapter version, upstream version, resolved commit, cache state, and compatibility state.
10. As a pstack tester, I want to select any Git ref, so that I can test a branch, tag, or commit before the adapter certifies it.
11. As a pstack tester, I want the adapter to resolve a moving ref to a commit, so that repeated sessions use the same source.
12. As a project maintainer, I want a project-specific upstream override, so that one project can test a pstack revision without changing my global default.
13. As an adapter developer, I want to use a local pstack checkout, so that I can test changes without publishing or fetching a remote ref.
14. As an advanced user, I want to select a custom repository, so that I can test a pstack fork.
15. As an advanced user, I want a strong warning before using a custom repository, so that I understand that the source is outside the tested trust boundary.
16. As a Pi user, I want all registered pstack skills represented in Pi, so that the adapter does not silently omit upstream workflows.
17. As a Pi user, I want pstack skills named `/skill:pistack-*`, so that they do not collide with native Pi skills or other packages.
18. As an adapter maintainer, I want the namespace defined once, so that changing `pistack` does not require edits throughout the codebase.
19. As a Pi user, I want `/skill:pistack-setup` to configure the adapter, so that I do not run Cursor-specific setup instructions.
20. As a Pi user, I want setup to discover my available Pi models, so that I can assign real provider and model identifiers to pstack roles.
21. As a Pi user, I want sensible model-role defaults, so that pstack works before I customize every role.
22. As a Pi user, I want an unconfigured role to inherit the parent model, so that missing role configuration does not block a workflow.
23. As an automation operator, I want model configuration to support noninteractive overrides, so that scripted environments do not require a setup dialog.
24. As a Pi user, I want Poteto Mode to remain active for the current session, so that I do not need to invoke it for every request.
25. As a Pi user, I want to disable Poteto Mode explicitly, so that I can return to normal Pi behavior in the same session.
26. As a Pi user, I want to inspect whether Poteto Mode is active, so that session behavior is not hidden.
27. As a Pi user, I want pstack's two agents available through my Pi subagent provider, so that delegated workflows retain their intended roles.
28. As a Pi user, I want namespaced agent identifiers, so that pstack agents do not collide with agents from other packages.
29. As a pstack user, I want familiar agent display names, so that upstream documentation remains understandable.
30. As a Pi user, I want the adapter to detect subagent capability rather than one package name, so that compatible providers can satisfy the requirement.
31. As a Pi user, I want the adapter to recommend `pi-subagents` when no compatible provider exists, so that I have a known installation path.
32. As a Pi user, I want the adapter to detect structured question capability, so that workflows can use a Pi equivalent of Cursor's `AskQuestion`.
33. As a Pi user, I want the adapter to recommend `pi-ask-user` when structured question capability is absent, so that I can enable the expected interaction.
34. As a Pi user, I want prerequisite checks to run before an affected workflow, so that a missing tool does not cause a failure halfway through the task.
35. As a Pi user, I want prerequisite errors to name the missing capability and a corrective action, so that I can fix the environment.
36. As a Pi user, I want each skill to publish its compatibility tier, so that I know what the adapter has verified.
37. As a Pi user, I want compatibility tiers to distinguish native, adapted, dependency-gated, experimental, and unsupported workflows, so that one success claim does not hide important differences.
38. As a pstack tester, I want newly discovered upstream skills exposed as experimental wrappers, so that I can try them before formal adapter support exists.
39. As a pstack tester, I want malformed or removed upstream resources reported, so that changes do not disappear silently.
40. As an adapter maintainer, I want wrapper generation to be deterministic, so that the same source commit and compatibility registry produce the same generated resources.
41. As an adapter maintainer, I want generated resources stored outside the maintained source, so that generated pstack files do not become a hand-maintained port.
42. As an adapter reviewer, I want the generated wrapper to preserve the upstream body exactly, so that I can audit adapter instructions separately from upstream instructions.
43. As an adapter reviewer, I want supporting files preserved byte-for-byte, so that the adapter does not hide changes to scripts, references, or other skill assets.
44. As an adapter maintainer, I want generation to avoid symbolic links, so that the design does not block later Windows support.
45. As a Pi user, I want Pi policy and my explicit instructions to override pstack autonomy instructions, so that imported workflows follow the host's safety rules.
46. As a Pi user, I want the adapter to preserve upstream text instead of deleting autonomy sections, so that the source remains auditable.
47. As an adapter maintainer, I want adapter versions independent from pstack versions, so that I can release adapter fixes without implying an upstream release.
48. As a Pi user, I want diagnostics to show both versions and the tested commit, so that I can identify the exact combination in use.
49. As a Linux user, I want installation and supported workflows tested on Linux, so that the first release has evidence for my platform.
50. As a macOS user, I want installation and supported workflows tested on macOS, so that the first release has evidence for my platform.
51. As a Windows user, I want the adapter to load in an experimental mode with clear warnings, so that I can test progress without receiving a false support claim.
52. As an adapter maintainer, I want Windows portability preserved in adapter-owned code, so that later Windows support does not require an adapter rewrite.
53. As an adapter maintainer, I want to reuse licensed compatibility mappings and tests from existing ports, so that prior work informs the adapter.
54. As an adapter reviewer, I want reused work to record its source and license, so that provenance remains clear.
55. As a package maintainer, I want to prove Git installation before publishing to npm, so that the npm release does not precede a working package.

## Implementation decisions

1. The package name is `pi-pstack-adapter`.
2. The first distribution method is installation from a Git repository. npm publication follows after the Git package meets the release criteria.
3. The official Cursor plugins repository is the default upstream source.
4. Each adapter release defines one tested pstack version and immutable commit.
5. Adapter semantic versions remain independent from pstack versions.
6. The adapter records and displays both identities.
7. The adapter stores the default checkout in a user-global cache.
8. A project can override the global source selection.
9. An override can name a branch, tag, commit, custom repository, or local checkout.
10. The adapter resolves remote branches and tags to commits during explicit setup. Startup does not advance a recorded commit.
11. The adapter warns for every untested ref. It gives custom repositories a stronger trust warning.
12. Interactive first use bootstraps a missing cache automatically.
13. Noninteractive modes require either an existing cache or explicit permission to bootstrap.
14. Startup performs no periodic update check.
15. A status workflow provides explicit source and compatibility information.
16. Generated resources live in adapter-owned disposable cache state.
17. The generator treats the upstream checkout and the adapter compatibility registry as its inputs.
18. The generator produces the same output for the same inputs.
19. Each generated skill uses adapter-owned frontmatter and an adapter header.
20. The wrapper places the exact upstream skill body after the adapter header.
21. The generator copies supporting files byte-for-byte.
22. The generator does not use symbolic links.
23. The adapter validates the upstream manifest and discovers registered resources from that manifest. It does not parse the README skill table.
24. The initial package represents all 47 skills registered by the inspected pstack release.
25. The package converts both registered pstack agents into definitions accepted by the configured Pi subagent provider.
26. The adapter uses a single namespace constant. Its initial value is `pistack`.
27. Generated skill names use the `/skill:pistack-*` form. The package does not register unprefixed aliases.
28. Agent identifiers use the same namespace. Display names can preserve upstream names.
29. The adapter replaces the Cursor-specific setup workflow with `/skill:pistack-setup`.
30. Setup discovers available Pi models and stores role assignments in adapter configuration.
31. Role configuration supports defaults, interactive changes, project overrides, and noninteractive overrides.
32. A role without a configured model inherits the parent model.
33. Poteto Mode stores session-scoped state. The adapter provides enable, disable, and status operations.
34. The adapter detects capabilities rather than installed package names.
35. The required delegation capability must provide named agents, parallel execution, background execution, model selection, and tool restrictions.
36. `pi-subagents` is the recommended delegation provider.
37. Structured question support is capability-gated. `pi-ask-user` is the recommended provider.
38. Each workflow declares the capabilities and executable dependencies that it needs.
39. Invocation-time checks report missing capabilities before the workflow starts its main work.
40. Dependency diagnostics name the failed check and give a corrective action.
41. The compatibility registry assigns each skill one support tier: `native`, `adapted`, `dependency-gated`, `experimental`, or `unsupported`.
42. Unknown skills from an override receive experimental wrappers.
43. Removed, malformed, or undiscoverable resources appear in diagnostics.
44. Untested overrides continue after a warning. The adapter does not claim support for their behavior.
45. The adapter header states that Pi policy and explicit user instructions override conflicting upstream autonomy instructions.
46. The first version relies on Pi and installed extensions for action controls. It does not add a general confirmation system.
47. Linux and macOS are supported platforms for the first release.
48. Windows uses experimental mode. Adapter-owned code uses portable Node APIs and avoids design choices that would prevent later support.
49. The implementation may reuse mappings and tests from existing projects only after license and provenance review.
50. The adapter does not implement a generic Cursor plugin compatibility runtime. The compatibility registry remains specific to pstack.

## Testing decisions

The main test seam is the installed Pi package. Tests install the package into an isolated Pi environment, bootstrap a fixture upstream revision, invoke public skills, and observe commands, diagnostics, generated resources, and session behavior. This is the highest seam that verifies the user experience.

Tests assert external behavior. They do not assert private helper calls, internal module layout, or incidental cache implementation details.

The package needs these test groups:

1. Installation tests install the Git package in an isolated Pi package directory and verify that Pi loads the adapter.
2. Bootstrap tests start with an empty cache and verify interactive bootstrap. They verify that noninteractive startup refuses network access without explicit permission.
3. Offline tests bootstrap once, disable network access, and verify that Pi discovers the same resources.
4. Source resolution tests resolve a branch or tag to a commit and verify that later startup keeps the recorded commit.
5. Override tests exercise the global default, a project override, a custom repository, and a local checkout.
6. Generation tests generate wrappers twice from the same inputs and compare the complete outputs.
7. Upstream preservation tests verify that each generated wrapper contains the exact upstream body and that support files remain byte-identical.
8. Discovery tests compare the registered upstream skills and agents with generated Pi resources. The test fails on silent omissions.
9. Unknown resource tests add a fixture skill that the compatibility registry does not know. They verify that Pi exposes it as experimental and reports it.
10. Malformed resource tests add invalid manifest and skill fixtures. They verify that diagnostics identify the resource and the validation failure.
11. Namespace tests verify that every generated skill and agent uses the configured namespace. They change the namespace once and verify that generated identifiers change without other source edits.
12. Setup tests provide a fixture model catalogue and verify role defaults, explicit assignments, project overrides, and parent-model fallback.
13. Mode tests enable Poteto Mode, send another request, and verify that the mode remains active. They disable it and verify that the next request does not use it.
14. Capability tests run with and without compatible `subagent` and `ask_user` tools. They verify that affected workflows either start or return an actionable prerequisite report.
15. Agent tests invoke both converted agents through the supported subagent provider and verify their names, prompts, tool restrictions, and model routing.
16. Safety precedence tests use an upstream fixture that requests an action contrary to host policy. They verify that the adapter instructions preserve host precedence.
17. Compatibility report tests verify every support tier and dependency result in the user-visible report.
18. Version tests verify that diagnostics report the adapter version, upstream version, configured ref, resolved commit, and tested commit.
19. Platform tests run supported installation and invocation tests on Linux and macOS.
20. Windows tests verify that Windows enters experimental mode and reports unsupported upstream dependencies instead of claiming full support.
21. Package tests pack the Git package and install it from the produced artifact. They verify that runtime dependencies are declared and development-only files are not required.

The repository has no existing test suite or source files. Similar external projects include `just-joshn/pi-pstack`, which reports parity, differential, compatibility, RPC, TUI, and acceptance checks. `pi-claude-marketplace` provides prior art for source acquisition, generated resources, and namespacing. These projects are references only. Their tests or mappings require license review before reuse.

## Out of scope

The first release does not include:

- A generic Cursor plugin marketplace or compatibility runtime.
- Transparent support for arbitrary Cursor plugins.
- Cursor's `/add-plugin` behavior.
- Full emulation of Cursor paths, tools, model names, or built-in commands.
- Benny automation support.
- Cursor Automations, Slack triggers, or webhook setup.
- Automatic periodic update checks.
- Automatic movement of a branch override after setup resolves it.
- Automatic installation of other Pi packages.
- A package-owned confirmation system for Git, GitHub, messaging, or destructive actions.
- Full Windows support.
- npm publication before the Git package proves the design.
- A guarantee that untested refs or custom repositories work.
- Silent substitution for missing external integrations.
- Changes to upstream pstack files.

## Further notes

The inspected pstack release declares 47 skills and two agents. It also includes scripts, references, playbooks, and the separate Benny automation pack.

Pstack depends on Cursor-specific concepts beyond plugin discovery. These include `Task`, `AskQuestion`, sticky modes, Cursor model identifiers, Cursor paths, built-in skills, MCP behavior, todo behavior, and automation features. A manifest converter alone cannot provide equivalent behavior.

No general Pi package was found that runs Cursor plugins unchanged. Existing Claude plugin loaders provide useful acquisition patterns but do not implement Cursor behavior.

`just-joshn/pi-pstack` is the closest known source of declarative pstack translation mappings and parity checks. It remains a port because it materializes a translated tree. This adapter may reuse reviewed mappings and tests, but its maintained source remains the unchanged upstream checkout plus an adapter compatibility registry.

The repository was empty and was not initialized as a Git repository when this spec was written. No domain glossary, architecture decision record, project test conventions, or issue tracker configuration was available.
