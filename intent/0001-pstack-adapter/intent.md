# Intent: Use upstream pstack in Pi

Author: Chris Freddy Getsfred
Status: draft

## Problem

Pstack was written for Cursor rather than other agent harnesses. Existing Pi versions are ports, so their maintainers must repeat the port whenever Cursor publishes a new pstack release.

I do not want another pstack port. I want Pi users to consume the official Cursor version through an adapter. The adapter can break when upstream changes, removes, or adds behavior. Preventing all such breakage is outside this effort.

## Proposed outcome

- Pi users can install a Pi package and use the skills and agents registered by official pstack.
- The official pstack checkout remains unchanged and authoritative.
- Adapter releases identify a tested upstream version and commit.
- Pi users can try another upstream ref, repository, or local checkout with clear warnings.
- A cached tested revision continues to work without network access.
- Users can see which workflows are native, adapted, dependency-gated, experimental, or unsupported.
- Linux and macOS have supported installation and invocation paths.
- The design leaves room for later Windows support.

## Affected users and systems

- Pi users who want pstack workflows without adopting Cursor.
- Pstack users who want the same upstream workflow content in Pi.
- Adapter maintainers who certify new pstack releases and maintain compatibility mappings.
- The Pi package loader, skill discovery, extension runtime, model configuration, and subagent providers.
- The official Cursor plugins repository and its pstack package.

## Constraints

- Do not maintain a hand-ported pstack tree.
- Do not modify the cached upstream checkout.
- Keep Pi-specific behavior in a small, explicit adapter layer.
- Use Pi-native commands, models, safety rules, and capability providers.
- Namespace imported skills and agents with `pistack` through one configurable value.
- Do not contact upstream during normal startup after bootstrap.
- Do not install other Pi packages without the user's action.
- Treat untested overrides as use-at-your-own-risk.
- Keep adapter versions independent from pstack versions.
- Exclude Benny automation and full Windows support from the first release.

## Open questions

- Which exact pstack commit will the first adapter release certify?
- Which mappings and tests from existing ports can the adapter reuse after license and provenance review?
- What observable evidence must each workflow provide before its support tier changes?
- Which upstream scripts or external tools prevent full Windows support?
- Which compatible capability providers, beyond `pi-subagents` and `pi-ask-user`, should the adapter recognize?
