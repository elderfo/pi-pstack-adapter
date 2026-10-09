# Project instructions

## Preserve the adapter contract

This package runs an unmodified pstack checkout in Pi. Keep upstream files byte-for-byte intact.
Make Pi-specific changes in generated wrappers, `adapter-skills/`, or the adapter runtime. Generated
output belongs in the cache outside the repository.

Keep these security properties when changing source resolution or wrapper generation:

- A source change requires interactive confirmation through `set_source`.
- A noninteractive first download requires `PISTACK_ALLOW_BOOTSTRAP=1`.
- Repository URLs, Git refs, and paths are validated before Git or the filesystem uses them.
- Every wrapper states host precedence before and after the upstream body.
- Custom repositories and unpinned revisions report reduced trust.

Add a regression test for any change that touches one of these properties.

## Find the owning code

Read the files for the branch you are changing:

- Pi lifecycle, commands, and tools: `index.ts`
- Config precedence and trust: `src/config.ts`
- Git resolution, cache repair, and network rules: `src/upstream.ts`
- Manifest parsing and path containment: `src/manifest.ts`
- Wrapper and agent generation: `src/generate.ts`
- Skill tiers and requirements: `src/registry.ts`
- Capability probes: `src/capabilities.ts`
- Status and prerequisite reports: `src/status.ts`
- Adapter-owned skill bodies: `adapter-skills/`

Use the matching test file under `test/` as the behavior reference. Tests create fixture plugins
and local Git repositories so the unit suite does not need network access.

## Keep certification claims in sync

`src/certified.ts` defines the certified pstack version, commit, and resource counts. When that
revision changes, inspect every upstream skill and agent before updating the certification.
Update `src/registry.ts`, `docs/compatibility.md`, and the tests in the same change.
Follow `.agents/skills/certify-pstack-revision/SKILL.md` for the full procedure.

A support tier is a verification claim. Follow the evidence rules in `docs/compatibility.md`.
Unknown upstream skills remain `experimental` until an end-to-end Pi run supports a stronger
claim.

## Keep documentation audiences separate

Keep `README.md` focused on installation, use, configuration, and user-facing trust decisions.
Keep contributor workflow, architecture, and verification instructions in this file.

## Write TypeScript for this repository

Use Node ESM imports with explicit `.ts` suffixes. Keep the strict compiler settings in
`tsconfig.json`, including unchecked index access. Prefer readonly inputs and discriminated
unions for source, trust, tier, and diagnostic states.

Keep diagnostics actionable. Name the failed resource, explain the failure, and give the next
step when one exists. Preserve deterministic ordering in generated files and reports.

## Release through release-please

release-please owns `CHANGELOG.md`, `VERSION`, and the `version` fields in `package.json` and
`package-lock.json`. Do not edit them by hand.

PRs merge by squash. The repository squashes with the PR title as the subject and the PR body as
the message, so the PR title is the commit on `main` that release-please reads. Write the title as a
Conventional Commit. A `BREAKING CHANGE:` footer in the PR body also counts. A `feat` title produces a minor release, a `fix` title
produces a patch release, and `chore`, `ci`, `docs`, `refactor`, and `test` titles produce no release.
While the version is below 1.0.0, a breaking change (`feat!` or a `BREAKING CHANGE:` footer)
produces a minor release.

The `release-please` workflow runs on each push to `main`. When releasable commits exist since the
last release, it opens or updates a release PR. The workflow uses `GITHUB_TOKEN`, so the repository
must allow GitHub Actions to create pull requests. Merging
that PR tags `vX.Y.Z` and publishes the GitHub release. The configuration lives in
`release-please-config.json` and `.release-please-manifest.json`.

When a release is created, the `publish-npm` job in the same workflow checks out the tag, runs
the check and the unit suite, and runs `npm publish`. It authenticates through npm trusted
publishing (OIDC), so the repository stores no npm token. The npm package settings must list
`elderfo/pi-pstack-adapter` with workflow file `release-please.yml` as a trusted publisher. OIDC
cannot create a package, so the first version on npm must be published by hand with
`npm publish` before the trusted publisher can be configured.

The `pi-package` keyword in `package.json` lists the package in the
[Pi package gallery](https://pi.dev/packages), which indexes npm. Keep that keyword, the `pi`
manifest, and the `files` list in sync with the resources the extension loads.

## Verify the change

Run both checks before completion:

```bash
npm run check
npm test
```

Run `npm run test:isolated` when a change affects installation, package contents, bootstrap,
resource discovery, cache reuse, or startup behavior. The isolated test requires configured Pi
provider credentials.

## Keep every certified platform working

Linux, macOS, and native Windows are certified. CI in `.github/workflows/ci.yml` runs the check
and the unit suite on all three. Do not drop a platform from that matrix without also dropping
its claim in `src/status.ts`, `README.md`, and `docs/compatibility.md`.

Windows needs the most care in adapter-owned code:

- Build paths with `node:path`. Never compare a path as a string before resolving both sides.
  Windows paths are case-insensitive, and Pi's tools also accept Git Bash forms such as `/c/x`.
- A test that needs a POSIX-only feature, such as the executable bit or unprivileged symbolic
  links, must state why it narrows on Windows rather than fail there.
- Upstream bytes must not depend on the user's Git line-ending settings.

Run `npm run test:isolated` from Git Bash on Windows. If Pi gets its provider from an extension
rather than `auth.json`, the isolated config cannot reach a model. Copy that provider's config
into the sandbox and pass its extension with `-e` in a local copy of the script.

Inspect `git diff --check` and the final diff. The task is complete when the relevant regression
test passes, the type check passes, and certification or compatibility docs match the code.
