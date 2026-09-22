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

## Verify the change

Run both checks before completion:

```bash
npm run check
npm test
```

Run `npm run test:isolated` when a change affects installation, package contents, bootstrap,
resource discovery, cache reuse, or startup behavior. The isolated test requires configured Pi
provider credentials.

Inspect `git diff --check` and the final diff. The task is complete when the relevant regression
test passes, the type check passes, and certification or compatibility docs match the code.
