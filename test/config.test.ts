import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CERTIFIED } from "../src/certified.ts";
import {
  environmentLayer,
  mergeConfig,
  parseModelRoles,
  readConfigFile,
  selectionOf,
  trustOf,
  trustWarning,
  updateConfigFile,
} from "../src/config.ts";
import { makeTempDir } from "./support/fixture.ts";

function layer(label: string, values: Record<string, unknown>) {
  return { label, values } as never;
}

test("defaults pin the certified upstream revision", () => {
  const config = mergeConfig([]);
  assert.equal(config.repo, CERTIFIED.repo);
  assert.equal(config.pinnedCommit, CERTIFIED.commit);
  assert.equal(config.namespace, "pistack");
  assert.equal(config.allowBootstrap, false);
  assert.equal(trustOf(config), "tested");
  assert.equal(trustWarning(trustOf(config), config), undefined);
});

test("a project layer overrides the global layer and the environment overrides both", () => {
  const config = mergeConfig([
    layer("global", { ref: "v1", pinnedCommit: "a".repeat(40) }),
    layer("project", { ref: "v2", pinnedCommit: "b".repeat(40) }),
    layer("environment", { ref: "v3" }),
  ]);
  assert.equal(config.ref, "v3");
  assert.equal(config.pinnedCommit, "b".repeat(40));
  assert.deepEqual(config.sources, ["global", "project", "environment"]);
});

test("model roles merge across layers instead of replacing each other", () => {
  const config = mergeConfig([
    layer("global", { models: { feature: "anthropic/one", "bug-fix": "anthropic/two" } }),
    layer("project", { models: { feature: "openai/three" } }),
  ]);
  assert.deepEqual(config.models, { feature: "openai/three", "bug-fix": "anthropic/two" });
});

test("an unconfigured role has no entry, so the caller inherits the parent model", () => {
  const config = mergeConfig([layer("global", { models: { feature: "anthropic/one" } })]);
  assert.equal(config.models["judgment"], undefined);
});

test("an untested ref and a custom repository get different warnings", () => {
  const untestedRef = mergeConfig([layer("global", { pinnedCommit: "c".repeat(40) })]);
  assert.equal(trustOf(untestedRef), "untested-ref");
  assert.match(trustWarning("untested-ref", untestedRef) ?? "", /untested upstream ref/);

  const customRepo = mergeConfig([layer("global", { repo: "https://example.test/fork" })]);
  assert.equal(trustOf(customRepo), "untested-repo");
  assert.match(trustWarning("untested-repo", customRepo) ?? "", /outside the tested trust boundary/);
});

test("repository identity ignores a .git suffix and trailing slash", () => {
  const config = mergeConfig([layer("global", { repo: `${CERTIFIED.repo}.git/` })]);
  assert.equal(trustOf(config), "tested");
});

test("a local checkout drops the pinned commit and selects the path", () => {
  const config = mergeConfig([layer("global", { localPath: "/tmp/pstack-dev" })]);
  assert.equal(config.pinnedCommit, undefined);
  assert.deepEqual(selectionOf(config), { kind: "local", path: "/tmp/pstack-dev" });
  assert.equal(trustOf(config), "local");
});

test("a relative local path resolves against the config file that declared it", () => {
  const root = makeTempDir("relative");
  mkdirSync(join(root, "nested", ".pi"), { recursive: true });
  const path = join(root, "nested", ".pi", "pi-pstack-adapter.json");
  writeFileSync(path, JSON.stringify({ localPath: "../vendor/pstack" }), "utf8");

  const config = mergeConfig([readConfigFile(path) as never]);
  assert.equal(config.localPath, join(root, "nested", "vendor", "pstack"));
});

test("environment variables map onto config fields", () => {
  const config = mergeConfig([
    environmentLayer({
      PISTACK_NAMESPACE: "pquux",
      PISTACK_UPSTREAM_REPO: "https://example.test/fork",
      PISTACK_UPSTREAM_REF: "topic",
      PISTACK_ALLOW_BOOTSTRAP: "1",
      PISTACK_MODELS: "feature=anthropic/one, bug-fix=openai/two",
    } as NodeJS.ProcessEnv),
  ]);
  assert.equal(config.namespace, "pquux");
  assert.equal(config.repo, "https://example.test/fork");
  assert.equal(config.ref, "topic");
  assert.equal(config.allowBootstrap, true);
  assert.deepEqual(config.models, { feature: "anthropic/one", "bug-fix": "openai/two" });
});

test("PISTACK_ALLOW_BOOTSTRAP=0 means no", () => {
  const config = mergeConfig([environmentLayer({ PISTACK_ALLOW_BOOTSTRAP: "0" } as NodeJS.ProcessEnv)]);
  assert.equal(config.allowBootstrap, false);
});

test("an invalid namespace is rejected instead of producing broken skill names", () => {
  assert.throws(() => mergeConfig([layer("global", { namespace: "Pi Stack" })]), /Invalid pstack adapter namespace/);
});

test("a malformed model assignment names the expected form", () => {
  assert.throws(() => parseModelRoles("feature"), /role=provider\/model/);
});

test("writing config preserves unrelated keys and replaces the model map", () => {
  const root = makeTempDir("write");
  const path = join(root, "pi-pstack-adapter.json");
  updateConfigFile(path, { ref: "v1", models: { feature: "a/b", "bug-fix": "c/d" } });
  const next = updateConfigFile(path, { models: { feature: "a/b" } });

  assert.equal(next.ref, "v1");
  assert.deepEqual(next.models, { feature: "a/b" });
  assert.deepEqual(readConfigFile(path)?.values.models, { feature: "a/b" });
});

test("a config file that is not JSON fails loudly with its path", () => {
  const root = makeTempDir("badjson");
  const path = join(root, "pi-pstack-adapter.json");
  writeFileSync(path, "{ nope", "utf8");
  assert.throws(() => readConfigFile(path), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a missing config file is simply absent", () => {
  assert.equal(readConfigFile(join(makeTempDir("absent"), "nothing.json")), undefined);
});
