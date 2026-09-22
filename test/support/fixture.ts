import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface FixtureSkill {
  readonly name: string;
  readonly frontmatter?: string;
  readonly body: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly executableFiles?: readonly string[];
}

export interface FixtureOptions {
  readonly skills: readonly FixtureSkill[];
  readonly agents?: readonly FixtureSkill[];
  readonly manifest?: string;
  readonly version?: string;
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `pistack-${prefix}-`));
}

export function writePluginFixture(root: string, options: FixtureOptions): string {
  const pluginDir = join(root, "pstack");
  mkdirSync(join(pluginDir, ".cursor-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".cursor-plugin", "plugin.json"),
    options.manifest ??
      JSON.stringify({
        name: "pstack",
        version: options.version ?? "0.0.1-fixture",
        skills: "./skills/",
        agents: "./agents/",
      }),
    "utf8",
  );

  mkdirSync(join(pluginDir, "skills"), { recursive: true });
  for (const skill of options.skills) {
    const dir = join(pluginDir, "skills", skill.name);
    mkdirSync(dir, { recursive: true });
    const frontmatter = skill.frontmatter ?? `name: ${skill.name}\ndescription: Fixture skill ${skill.name}.`;
    writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${skill.body}`, "utf8");
    for (const [path, content] of Object.entries(skill.files ?? {})) {
      const target = join(dir, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
    for (const path of skill.executableFiles ?? []) {
      chmodSync(join(dir, path), 0o755);
    }
  }

  mkdirSync(join(pluginDir, "agents"), { recursive: true });
  for (const agent of options.agents ?? []) {
    const frontmatter = agent.frontmatter ?? `name: ${agent.name}\ndescription: Fixture agent ${agent.name}.`;
    writeFileSync(join(pluginDir, "agents", `${agent.name}.md`), `---\n${frontmatter}\n---\n${agent.body}`, "utf8");
  }

  return pluginDir;
}

export interface TreeEntry {
  readonly path: string;
  readonly content: string;
  readonly executable: boolean;
}

export function readTree(root: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      entries.push({
        path: relative(root, full).split("\\").join("/"),
        content: readFileSync(full, "utf8"),
        executable: (statSync(full).mode & 0o111) !== 0,
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
