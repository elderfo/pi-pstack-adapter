import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { registerAgents } from "../../src/agents.ts";
import { generate } from "../../src/generate.ts";
import { writePluginFixture } from "../support/fixture.ts";

test("a Cursor model slug in an agent's frontmatter reaches neither its registration nor its prompt file", () => {
  const scratch = join(import.meta.dirname, "..", "..", ".work", "scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "agent-model-line-"));
  try {
    const slug = "claude-opus-5-5-xhigh-fast";
    const pluginDir = writePluginFixture(root, {
      skills: [{ name: "unslop", body: "b\n" }],
      agents: [
        {
          name: "poteto-agent",
          frontmatter: `name: poteto-agent\ndescription: Delegate subagent.\nis_background: true\nmodel: ${slug}`,
          body: "# Poteto subagent\n\nRead the poteto-mode skill first.\n",
        },
      ],
    });
    const commit = "0".repeat(40);
    const result = generate({
      source: {
        selection: { kind: "git", repo: "https://example.test/plugins", ref: commit },
        trust: "untested-repo", commit, checkoutDir: root, pluginDir,
      },
      namespace: "pistack", cacheRoot: join(root, "cache"), adapterVersion: "test",
    });

    const agent = result.agents.find((entry) => entry.upstreamName === "poteto-agent");
    assert.ok(agent);
    assert.doesNotMatch(agent.systemPrompt, new RegExp(slug));
    const promptFile = readFileSync(join(result.agentPromptsDir, "pistack-poteto-agent.md"), "utf8");
    assert.doesNotMatch(promptFile, new RegExp(slug));

    let definition: Record<string, unknown> | undefined;
    registerAgents(
      {
        emit(_event: string, payload: unknown) {
          const request = payload as { definition: Record<string, unknown>; result?: unknown };
          definition = request.definition;
          request.result = { ok: true, registration: { dispose() {} } };
        },
      },
      [agent],
      "pistack",
    );
    assert.deepEqual(Object.keys(definition ?? {}).sort(), ["description", "systemPrompt"]);
    assert.doesNotMatch(JSON.stringify(definition), new RegExp(slug));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
