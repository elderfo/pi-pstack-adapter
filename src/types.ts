export type SourceSelection =
  | { readonly kind: "git"; readonly repo: string; readonly ref: string }
  | { readonly kind: "local"; readonly path: string };

export type Trust = "tested" | "untested-ref" | "untested-repo" | "local";

export interface ResolvedSource {
  readonly selection: SourceSelection;
  readonly trust: Trust;
  readonly commit?: string;
  readonly checkoutDir: string;
  readonly pluginDir: string;
}

export type SupportTier =
  | "native"
  | "adapted"
  | "dependency-gated"
  | "experimental"
  | "unsupported";

export type CapabilityId = "delegation" | "structured-question";

export type DelegationProvider = "t3" | "pi-subagents";

export interface RegistryEntry {
  readonly tier: SupportTier;
  readonly capabilities: readonly CapabilityId[];
  readonly executables: readonly string[];
  readonly note?: string;
  readonly replacement?: string;
  readonly rename?: string;
}

export interface UpstreamManifest {
  readonly name: string;
  readonly version: string;
  readonly skillsDir: string;
  readonly agentsDir: string;
}

export interface UpstreamResource {
  readonly name: string;
  readonly kind: "skill" | "agent";
  readonly entryPath: string;
}

export interface ParsedResource {
  readonly resource: UpstreamResource;
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly body: string;
}

export type DiagnosticLevel = "error" | "warning" | "info";

export interface Diagnostic {
  readonly level: DiagnosticLevel;
  readonly resource: string;
  readonly message: string;
  readonly action?: string;
}

export interface GeneratedSkill {
  readonly upstreamName: string;
  readonly generatedName: string;
  readonly tier: SupportTier;
  readonly capabilities: readonly CapabilityId[];
  readonly executables: readonly string[];
  readonly path: string;
}

export interface GeneratedAgent {
  readonly upstreamName: string;
  readonly generatedName: string;
  readonly displayName: string;
  readonly description: string;
  readonly systemPrompt: string;
}

export interface GenerationResult {
  readonly outDir: string;
  readonly skillsDir: string;
  readonly skills: readonly GeneratedSkill[];
  readonly agents: readonly GeneratedAgent[];
  readonly agentPromptsDir: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CapabilityStatus {
  readonly id: CapabilityId;
  readonly available: boolean;
  readonly provider?: string;
  readonly backend?: DelegationProvider;
  readonly tools?: readonly string[];
  readonly recommendation: string;
}

export type PlatformSupport = "supported" | "experimental";
