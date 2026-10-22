import type { CapabilityId, RegistryEntry, SupportTier } from "./types.ts";

/**
 * Support tiers for the certified upstream revision. Classification came from reading
 * every upstream SKILL.md; see `docs/compatibility.md` for how a tier changes.
 * Skills absent from this table are generated as `experimental`.
 */
export const SKILL_REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  "architect": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Phase B delegates to arena runners, so it cannot run without parallel subagents." },
  "arena": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "The whole skill is spawning N candidate subagents plus a judge." },
  "automate-me": { tier: "experimental", capabilities: ["delegation", "structured-question"], executables: ["git", "gh"], note: "Mining step depends on Cursor transcript files and the built-in create-skill skill, with no Pi equivalent." },
  "benchmark-checklist": { tier: "dependency-gated", capabilities: [], executables: ["uptime", "nproc"], note: "Its setup step checks load with `uptime` and cores with `nproc`. macOS has no `nproc` without GNU coreutils, and Git Bash on Windows has no `uptime`." },
  "blast-radius": { tier: "dependency-gated", capabilities: [], executables: ["git", "gh"], note: "Needs git and gh to read the diff, commits, and PR before any analysis." },
  "bro": { tier: "native", capabilities: [], executables: [] },
  "correct": { tier: "dependency-gated", capabilities: [], executables: ["git"], note: "Mines commit history, then commits fixes and edits lint, CI, and agent instruction files. Run it on a branch you will review." },
  "create-formal-verification-skill": { tier: "adapted", capabilities: [], executables: [], note: "Manual invocation only; no delegation. It installs or runs the verification tool it chooses and temporarily breaks product code to prove the check. Generated skills belong under `.pi/skills/` in Pi. Verified on a Windows Node finite-state fixture; other toolchains need their own prerequisites." },
  "create-verification-skill": { tier: "adapted", capabilities: [], executables: [], note: "Only the generated skill's output path needs remapping to Pi's skill directory." },
  "figure-it-out": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Phase B fan-out and the architect/arena routing require parallel subagents." },
  "how": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Every path spawns explorer or explainer subagents; nothing runs inline." },
  "in-your-own-words": { tier: "native", capabilities: [], executables: [] },
  "interrogate": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "Multi-model adversarial review is entirely one subagent per configured model." },
  "ketchup": { tier: "adapted", capabilities: [], executables: [], note: "Read-only. Pi has no `/visualize` skill or image generation, so its visuals are Mermaid diagrams and screenshots that already exist. It checks PR and CI state only for work the chat touched." },
  "maintain-formal-verification-skill": { tier: "dependency-gated", capabilities: [], executables: ["git"], note: "Verified end to end on a Windows Node finite-state fixture at pstack 0.15.28. Manual invocation only; no delegation. It diffs the covered code with git from the verify skill's sync commit, edits only the verification and the verify skill, and temporarily breaks product code to prove an updated check can still fail. In Pi, look for the verify skill under `.pi/skills/`; the verification tool needs its own prerequisites." },
  "maintain-verification-skill": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "Source wave launches one read-only subagent per feature file." },
  "make-bot-ui": { tier: "unsupported", capabilities: [], executables: ["curl", "tailscale", "sudo"], note: "Built entirely on Cursor Automations webhook routines and the secret-request card." },
  "no-comments": { tier: "dependency-gated", capabilities: ["delegation"], executables: ["git"], note: "Step 1 must spawn the comment-sicko agent; the skill only triages its report." },
  "poteto-help": { tier: "experimental", capabilities: [], executables: [], note: "Its answers describe Cursor setup, the slash menu, and Custom Modes. A request for work runs poteto-mode, which is experimental. It asks a multiple-choice question only when the need is unclear. Its README and guide links resolve under the status report's plugin directory." },
  "poteto-mode": { tier: "experimental", capabilities: ["delegation", "structured-question"], executables: ["git", "gh"], note: "Sticky-mode hosting plus references to Cursor built-in and plugin skills only partially map to Pi." },
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
  "reflect": { tier: "experimental", capabilities: ["delegation"], executables: [], note: "Transcript mining and create-skill routing are Cursor-specific, though the digest fallback partly works." },
  "setup-pstack": { tier: "native", capabilities: [], executables: [], rename: "setup", replacement: "setup.md", note: "The upstream body only writes a Cursor .mdc rule, so the adapter replaces it with a Pi setup workflow." },
  "sharpen": { tier: "experimental", capabilities: [], executables: [], note: "New in pstack 0.15.25 and not yet run end to end in Pi. Since pstack 0.15.29 it hands back a rewritten prompt and does not do the task. Its body is prompt-only, with no tool, delegation, or executable, and it runs only when you type it." },
  "show-me-your-work": { tier: "dependency-gated", capabilities: ["delegation"], executables: [], note: "The mandatory cross-model review of the trail requires spawning a different-family subagent." },
  "statechart": { tier: "dependency-gated", capabilities: [], executables: ["node", "java", "npx"], note: "Verified end to end on a Windows checkout fixture at pstack 0.15.30. Manual invocation only; no delegation or structured question. Its scripts run under `node` and run TLC with `java`, or the binary in `JAVA`, and need `TLA2TOOLS` set to a downloaded `tla2tools.jar`. The prerequisite check looks for `java` on PATH even when `JAVA` is set. `--png`, which its chart and hand-off steps use, runs `npx -y @mermaid-js/mermaid-cli`, which downloads and runs that package. It imports the `.map.mjs` mapping file as JavaScript with full process permissions, so review an existing mapping before you run it. Each run replaces its whole output folder and deletes the previous contents, so run it in a scratch folder outside the repository with a dedicated output folder. Git for Windows bundles none of these executables. On native Windows, `--png` cannot start `npx` (`spawnSync npx ENOENT`), so render each `.mmd` with `npx -y @mermaid-js/mermaid-cli -i <chart>.mmd -o <chart>.png` yourself. A rerun into an existing output folder also fails with `EPERM` and leaves the old folder in place, so give each rerun a fresh `--out` folder. Delete an old output folder only after you check its path and confirm every file in it is disposable, because a manual delete skips the script's check for files it did not write." },
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
