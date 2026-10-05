# Intent: Certify Windows support

Author: Christopher Getsfred
Status: approved

## Problem

Windows support is experimental. The adapter warns Windows users and claims nothing, so a Windows user can't tell whether a pstack workflow will work. Running the checks on Windows turned up real failures, not just missing claims. Local upstream checkouts were refused, delegating skills didn't enable their helper agents, and downloaded upstream files were changed from the originals.

## Proposed outcome

- Windows is a certified platform alongside Linux and macOS, and the adapter no longer warns that it is experimental.
- A Windows user can install the adapter and run the same pstack workflows, with the same support tiers, as on Linux and macOS.
- When a workflow can't run on Windows, the adapter says what is missing, for example a missing tool or shell.
- Upstream files stay byte-for-byte unchanged on Windows.
- The Windows claim is checked automatically on every change, so it can't silently regress.

## Affected users and systems

- Pi users on native Windows who want pstack workflows.
- Adapter maintainers, who must keep Windows working with every change and certification.
- The adapter's startup, upstream download and cache, skill activation, status and prerequisite checks, docs, and tests.
- Pi's Git Bash shell on Windows, which is where pstack commands run.

## Constraints

- Upstream pstack stays unmodified. Windows fixes live in the adapter.
- Keep the existing security properties, including refusing untrusted repository forms.
- A support claim needs evidence from a real Windows run, per the compatibility rules.
- Pstack skills are written as Bash commands, so Windows support depends on Pi's Bash tool.

## Open questions

- Should a Pi setup that swaps the Bash tool for PowerShell ever be supported, or only reported?
- Does "Windows" include other Bash setups (Cygwin, MSYS2) and Windows on ARM, or only Git for Windows on x64?
- Must the Windows CI run pass before a release can claim support, and who signs off on that?
- Decided: the adapter's own files are kept LF when installed on Windows, through `.gitattributes`.
- How should the isolated install test reach a model when the provider comes from a Pi extension?
