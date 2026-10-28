import type { CapabilityId, RegistryEntry, SupportTier } from "./types.ts";

/**
 * Support tiers for the certified upstream revision. Classification came from reading
 * every upstream SKILL.md; see `docs/compatibility.md` for how a tier changes.
 * Skills absent from this table are generated as `experimental`.
 */
export const SKILL_REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  "architect": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Phase B delegates to arena runners, so it cannot run without parallel subagents." },
  "arena": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "The whole skill is spawning N candidate subagents plus a judge. Since pstack 0.15.36 the judge must come from a model family other than the parent's. The adapter maps the cross-judge pool to the `judgment` and `general` roles, so when the parent knows its model, the judge runs only when one of those roles is on another family. Otherwise arena skips the judge, picks the base alone, and says so. When the parent does not know its model, arena tries the pool in order anyway and says the family check did not run." },
  "automate-me": { tier: "experimental", capabilities: ["delegation", "structured-question"], executables: ["git", "gh"], note: "Mining step depends on Cursor transcript files and the built-in create-skill skill, with no Pi equivalent." },
  "benchmark-checklist": { tier: "dependency-gated", capabilities: [], executables: ["uptime", "nproc"], note: "Its setup step checks load with `uptime` and cores with `nproc`. macOS has no `nproc` without GNU coreutils, and Git Bash on Windows has no `uptime`." },
  "blast-radius": { tier: "dependency-gated", capabilities: [], executables: ["git", "gh"], note: "Needs git and gh to read the diff, commits, and PR before any analysis." },
  "bro": { tier: "native", capabilities: [], executables: [] },
  "correct": { tier: "dependency-gated", capabilities: [], executables: ["git"], note: "Mines commit history, then commits fixes and edits lint, CI, and agent instruction files. Run it on a branch you will review." },
  "create-formal-verification-skill": { tier: "adapted", capabilities: [], executables: [], note: "Manual invocation only; no delegation. It installs or runs the verification tool it chooses and temporarily breaks product code to prove the check. Generated skills belong under `.pi/skills/` in Pi. Verified on a Windows Node finite-state fixture; other toolchains need their own prerequisites. Since pstack 0.15.32, a generated TLA+ check tells the next agent to read its results with statechart, which has its own prerequisites." },
  "create-verification-skill": { tier: "adapted", capabilities: [], executables: [], note: "Only the generated skill's output path needs remapping to Pi's skill directory." },
  "figure-it-out": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Phase B fan-out and the architect/arena routing require parallel subagents." },
  "how": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Every path spawns explorer or explainer subagents; nothing runs inline." },
  "in-your-own-words": { tier: "native", capabilities: [], executables: [] },
  "interrogate": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "Multi-model adversarial review is entirely one subagent per configured model. Since pstack 0.15.36 it picks adversaries the way arena picks runners, from the `interrogate reviewers` line, and gives each one its own worktree with the scope's uncommitted changes. Each adversary must prove a finding with a run, and the skill keeps only findings whose command it reruns and sees fail. It reports findings and applies no fixes, but adversaries write and run repro commands, and the skill reruns them, all with your permissions. A worktree is not a sandbox, so read each repro before it reruns, especially on code you do not trust. The rubric, the lead's judgment, and the code-quality lens are gone." },
  "ketchup": { tier: "adapted", capabilities: [], executables: [], note: "Read-only. Pi has no `/visualize` skill or image generation, so its visuals are Mermaid diagrams and screenshots that already exist. It checks PR and CI state only for work the chat touched." },
  "ketchup-video": { tier: "experimental", capabilities: [], executables: [], note: "New in pstack 0.15.32. One end-to-end Pi run on native Windows drew its slides and rendered an mp4 with `ffmpeg` alone, before pstack 0.15.36 added subtitles. The subtitled video has not run in Pi. Manual invocation only; no delegation or structured question. It follows ketchup, read-only, but shows what happened as a short slide video with no audio, rendered outside the repository, with the waiting calls as text under it. Since pstack 0.15.36 it burns a one-line subtitle into each slide's frames, in a strip below the slide, and measures each slide's hold by matching the rendered frames to the slide. Its body names no renderer, so it needs whatever video tool the session has, such as `ffmpeg`, and Pi has no image generation. Its reply embedded the video as an HTML `video` tag with the file path, and whether a Pi client plays it inline is unverified. When the render fails, it says so in one line and gives only the calls." },
  "maintain-formal-verification-skill": { tier: "dependency-gated", capabilities: [], executables: ["git"], note: "Verified end to end on a Windows Node finite-state fixture at pstack 0.15.28. Manual invocation only; no delegation. It diffs the covered code with git from the verify skill's sync commit, edits only the verification and the verify skill, and temporarily breaks product code to prove an updated check can still fail. In Pi, look for the verify skill under `.pi/skills/`; the verification tool needs its own prerequisites." },
  "maintain-verification-skill": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Source wave launches one read-only subagent per feature file." },
  "make-bot-ui": { tier: "unsupported", capabilities: [], executables: ["curl", "tailscale", "sudo"], note: "Built entirely on Cursor Automations webhook routines and the secret-request card." },
  "no-comments": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "Step 1 must spawn the comment-sicko agent; the skill only triages its report." },
  "poteto-help": { tier: "experimental", capabilities: [], executables: [], note: "Its answers describe Cursor setup, the slash menu, and Custom Modes. A request for work runs poteto-mode, which is experimental. It asks a multiple-choice question only when the need is unclear. Its README and guide links resolve under the status report's plugin directory." },
  "poteto-mode": { tier: "experimental", capabilities: ["delegation", "structured-question"], executables: ["git", "gh"], note: "Sticky-mode hosting plus references to Cursor built-in and plugin skills only partially map to Pi. Since pstack 0.15.36 the Orchestrate playbook calls no scripts, because the `orch` helpers are gone, and watches PRs through event subscriptions only when the harness has them. Pi has none. Its Project tracker and Project store, and forking a worker with its built state, have no Pi equivalent; the host mapping says what to do instead." },
  "principle-attack-the-premise": { tier: "native", capabilities: [], executables: [] },
  "principle-boundary-discipline": { tier: "native", capabilities: [], executables: [] },
  "principle-build-the-lever": { tier: "native", capabilities: [], executables: [] },
  "principle-encode-lessons-in-structure": { tier: "native", capabilities: [], executables: [] },
  "principle-exhaust-the-design-space": { tier: "native", capabilities: [], executables: [] },
  "principle-experience-first": { tier: "native", capabilities: [], executables: [] },
  "principle-explain-the-number": { tier: "native", capabilities: [], executables: [], note: "For a performance number it hands off to benchmark-checklist, which needs uptime and nproc. Check that skill first." },
  "principle-fix-root-causes": { tier: "native", capabilities: [], executables: [] },
  "principle-foundational-thinking": { tier: "native", capabilities: [], executables: [] },
  "principle-guard-the-context-window": { tier: "native", capabilities: [], executables: [] },
  "principle-laziness-protocol": { tier: "native", capabilities: [], executables: [] },
  "principle-make-operations-idempotent": { tier: "native", capabilities: [], executables: [] },
  "principle-migrate-callers-then-delete-legacy-apis": { tier: "native", capabilities: [], executables: [] },
  "principle-minimize-reader-load": { tier: "native", capabilities: [], executables: [] },
  "principle-model-the-domain": { tier: "native", capabilities: [], executables: [] },
  "principle-never-block-on-the-human": { tier: "native", capabilities: [], executables: [] },
  "principle-outcome-oriented-execution": { tier: "native", capabilities: [], executables: [] },
  "principle-prove-it-works": { tier: "native", capabilities: [], executables: [] },
  "principle-redesign-from-first-principles": { tier: "native", capabilities: [], executables: [] },
  "principle-separate-before-serializing-shared-state": { tier: "native", capabilities: [], executables: [] },
  "principle-sequence-verifiable-units": { tier: "native", capabilities: [], executables: [] },
  "principle-subtract-before-you-add": { tier: "native", capabilities: [], executables: [] },
  "principle-test-behavior-not-implementation": { tier: "native", capabilities: [], executables: [] },
  "principle-type-system-discipline": { tier: "native", capabilities: [], executables: [] },
  "recall": { tier: "experimental", capabilities: ["delegation"], executables: ["git", "gh"], note: "Core corpus is Cursor's on-disk transcript JSONL, so only the git/gh and shared-record half survives." },
  "reflect": { tier: "experimental", capabilities: ["delegation"], executables: [], note: "Transcript mining and create-skill routing are Cursor-specific, though the digest fallback partly works. Since pstack 0.15.32 it copies a skill out of the plugin cache to a skill location before editing it, and never opens a PR or pushes." },
  "setup-pstack": { tier: "native", capabilities: [], executables: [], rename: "setup", replacement: "setup.md", note: "The upstream body only writes a Cursor .mdc rule, so the adapter replaces it with a Pi setup workflow." },
  "sharpen": { tier: "experimental", capabilities: [], executables: [], note: "New in pstack 0.15.25 and not yet run end to end in Pi. Since pstack 0.15.29 it hands back a rewritten prompt and does not do the task. Its body is prompt-only, with no tool, delegation, or executable, and it runs only when you type it." },
  "show-me-your-work": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "The mandatory cross-model review of the trail requires spawning a different-family subagent." },
  "statechart": { tier: "experimental", capabilities: [], executables: ["node", "sh", "dirname", "sed"], note: "Lowered from dependency-gated at pstack 0.15.34, because its new scripts crash on native Windows, a certified platform. There, the launcher starts `/bin/sh` by that path to stop TLC's process group, Node cannot start it even when `sh` is on PATH, and with no error handler the run exits 1 with `spawn /bin/sh ENOENT`. It writes no output and leaves an empty hidden staging folder beside the output folder and an empty `statechart-` folder in the temporary folder, so delete those by hand. `/pistack-check` still clears it there, because the gates are found. Use it from Linux, macOS, or WSL. Verified end to end on a Linux checkout fixture at pstack 0.15.34. The Windows end-to-end evidence from pstack 0.15.32 and 0.15.30 describes the scripts it replaced. Manual invocation only; no delegation or structured question. `scripts/statechart` is a POSIX `sh` launcher for TypeScript scripts, and it runs `dirname` and `sed` on every start. It runs the scripts under Node 22.18 to 22.x or Node 23.6 or later, then Bun 1.1.5 or later, then Deno 2.0 or later, and exits with code 127 when none is found. The prerequisite check gates on `node` but cannot check its version. The command checks a TLA+ spec with TLC and writes `report.md` and TLC output to a new or empty `--out` folder, `SPEC-chart` beside the spec by default, and refuses a folder that is not empty. It also writes `chart.mmd`, except when TLC finds more than 500 states and no rule breaks. It stages its work in a hidden folder beside the output folder and in the system temporary folder, and deletes both. TLC runs from `TLA2TOOLS`, the path to a downloaded `tla2tools.jar`, with the binary in `JAVA` or `java` from PATH. Without `TLA2TOOLS`, it uses TLC 1.7.4 and Java temurin-25 from `mise`, and installs whichever is missing with `mise`, which needs the network. `JAVA` then changes only the binary that runs TLC, and does not skip the `mise` lookup or install of Java. Either `mise` or `TLA2TOOLS` with Java works, so neither is gated, and the script names what is missing when neither is set up. It imports the `--view` module as JavaScript with full process permissions, so review an existing view before you run it. Since pstack 0.15.34 the scripts render no images and do not run `npm`. For an image, the body has the agent install `pele@1.9.0` with `npm` once, outside the repository, which needs `npm` and the network, and render SVG with it. The body does not ask for `--ignore-scripts`, so pass it, and rendering still imports Pele with full process permissions. Run it in a scratch folder outside the repository. Git for Windows bundles `sh`, `dirname`, and `sed`, but not `node`, `mise`, or Java." },
  "swarm": { tier: "experimental", capabilities: ["delegation"], executables: [], note: "Cloud background workers and cloud_base_branch have no Pi mapping; only local fan-out approximates it." },
  "tdd": { tier: "native", capabilities: [], executables: [] },
  "teach": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "It runs the how and why skills, both of which need subagents." },
  "technical-writing": { tier: "native", capabilities: [], executables: [] },
  "typescript-best-practices": { tier: "native", capabilities: [], executables: [] },
  "unslop": { tier: "native", capabilities: [], executables: [] },
  "why": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git", "gh"], note: "Default posture spawns one investigator subagent per evidence category plus a synthesizer." },
};

/** Adapter-owned skills with no upstream counterpart. Keyed by unprefixed generated name. */
export const ADAPTER_SKILLS: Readonly<Record<string, RegistryEntry>> = {
  status: { tier: "native", capabilities: [], executables: [], replacement: "status.md" },
};

export const UNKNOWN_SKILL_ENTRY: RegistryEntry = {
  tier: "experimental",
  capabilities: [],
  executables: [],
  note: "This skill is not in the adapter compatibility registry for the certified revision.",
};

export const TIER_ORDER: readonly SupportTier[] = [
  "native",
  "adapted",
  "dependency-gated",
  "experimental",
  "unsupported",
];

export const CAPABILITY_LABELS: Readonly<Record<CapabilityId, string>> = {
  delegation: "parallel background child agents with model selection, through T3 Code's delegate_task or pi-subagents",
  "structured-question": "structured multiple-choice questions to the user",
};

export const ADAPTER_OWNED = "(adapter-owned)";

/**
 * Model roles pstack workflows name. `general` covers every delegate no other role names. A role
 * with no configured model falls back to `general`, and inherits the parent only when `general`
 * is unconfigured too.
 */
export const GENERAL_ROLE = "general";

export const MODEL_ROLES: readonly string[] = [
  "feature",
  "refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment",
  "strongest-judgment",
  GENERAL_ROLE,
];

export function entryFor(upstreamName: string, generatedBareName?: string): RegistryEntry {
  if (upstreamName === ADAPTER_OWNED && generatedBareName) {
    return ADAPTER_SKILLS[generatedBareName] ?? UNKNOWN_SKILL_ENTRY;
  }
  return SKILL_REGISTRY[upstreamName] ?? UNKNOWN_SKILL_ENTRY;
}
