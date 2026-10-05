#!/usr/bin/env bash
# Installs this package into a throwaway Pi config directory from a fresh git clone and
# asserts what Pi actually loaded. Nothing here reads the caller's settings, packages, or
# skills, so a capability the developer happens to have installed cannot mask a gap.
#
# Usage: test/isolated-install.sh [--keep]
# Requires: git, node, npm, pi on PATH. Copies only auth.json from the real config dir.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="$(git -C "$REPO" rev-parse HEAD)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pistack-isolated-XXXXXX")"
REAL_CONFIG="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
KEEP="${1:-}"

cleanup() {
  if [ "$KEEP" = "--keep" ]; then
    echo "kept: $ROOT"
  else
    rm -rf "$ROOT"
  fi
}
trap cleanup EXIT

export PI_CODING_AGENT_DIR="$ROOT/pi"
export PISTACK_CACHE_DIR="$ROOT/cache"
mkdir -p "$PI_CODING_AGENT_DIR" "$ROOT/work"
cp "$REAL_CONFIG/auth.json" "$PI_CODING_AGENT_DIR/auth.json"
node -e '
const { writeFileSync, readFileSync } = require("node:fs");
const real = JSON.parse(readFileSync(process.argv[1], "utf8"));
writeFileSync(process.argv[2], JSON.stringify({
  defaultProvider: real.defaultProvider,
  defaultModel: real.defaultModel,
  packages: [],
  skills: [],
  extensions: [],
}, null, 2));
' "$REAL_CONFIG/settings.json" "$PI_CODING_AGENT_DIR/settings.json"

echo "== cloning $REF"
git clone --quiet --no-local "$REPO" "$ROOT/pkg"
git -C "$ROOT/pkg" checkout --quiet "$REF"
test ! -e "$ROOT/pkg/node_modules" || { echo "FAIL: node_modules was committed"; exit 1; }

echo "== pack, then install only what the tarball ships"
TARBALL="$( cd "$ROOT/pkg" && npm pack --silent --pack-destination "$ROOT" )"
mkdir -p "$ROOT/packed"
tar -xzf "$ROOT/$TARBALL" -C "$ROOT/packed" --strip-components=1
rm -rf "$ROOT/pkg"
mv "$ROOT/packed" "$ROOT/pkg"

echo "== production install (no devDependencies)"
( cd "$ROOT/pkg" && npm install --omit=dev --silent )
test ! -d "$ROOT/pkg/node_modules/typescript" || { echo "FAIL: devDependency present after --omit=dev"; exit 1; }
test -d "$ROOT/pkg/node_modules/yaml" || { echo "FAIL: runtime dependency yaml missing"; exit 1; }

echo "== pi install"
( cd "$ROOT/work" && pi install "$ROOT/pkg" >/dev/null )
node -e '
const { readFileSync, realpathSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const [settingsPath, expected] = process.argv.slice(1);
const entries = JSON.parse(readFileSync(settingsPath, "utf8")).packages ?? [];
const paths = entries.map((entry) => resolve(dirname(settingsPath), typeof entry === "string" ? entry : entry.source));
if (!paths.some((path) => realpathSync(path) === realpathSync(expected))) {
  console.error(`FAIL: package not recorded in settings. Recorded: ${JSON.stringify(entries)}`);
  process.exit(1);
}
' "$PI_CODING_AGENT_DIR/settings.json" "$ROOT/pkg"

cat > "$ROOT/probe.ts" <<'PROBE'
import { writeFileSync } from "node:fs";
export default function (pi: any) {
  pi.on("before_agent_start", async (event: any) => {
    writeFileSync(process.env.PISTACK_PROBE_OUT as string, JSON.stringify({
      skills: (event.systemPromptOptions?.skills ?? []).map((s: any) => s?.name ?? s).filter((n: string) => String(n).startsWith("pistack")),
      commands: pi.getCommands().filter((c: any) => c.source === "extension" && c.name.includes("pistack")).map((c: any) => c.name),
      tools: pi.getAllTools().map((t: any) => t.name),
    }, null, 2));
  });
}
PROBE

run_probe() {
  export PISTACK_PROBE_OUT="$ROOT/$1.json"
  ( cd "$ROOT/work" && pi -e "$ROOT/probe.ts" -nbt -p "reply with the single word ok" >/dev/null 2>&1 )
}

echo "== cold cache, no bootstrap permission"
run_probe cold
echo "== warm cache after explicit permission"
PISTACK_ALLOW_BOOTSTRAP=1 run_probe warm
echo "== reuse without permission"
run_probe reuse

EXPECTED_SKILLS="$(REPO="$REPO" node --experimental-strip-types --no-warnings --input-type=module -e '
const { CERTIFIED } = await import(`${process.env.REPO}/src/certified.ts`);
const { ADAPTER_SKILLS } = await import(`${process.env.REPO}/src/registry.ts`);
console.log(CERTIFIED.skillCount + Object.keys(ADAPTER_SKILLS).length);
')"

node -e '
const { readFileSync } = require("node:fs");
const expectedSkills = Number(process.argv[2]);
const read = (name) => JSON.parse(readFileSync(`${process.argv[1]}/${name}.json`, "utf8"));
const fail = [];
const check = (ok, message) => { if (!ok) fail.push(message); };

const cold = read("cold");
check(cold.skills.length === 0, `cold run registered ${cold.skills.length} skills without bootstrap permission`);
check(cold.commands.includes("pistack-status"), "adapter commands must exist even when bootstrap is refused");
check(!cold.tools.includes("subagent"), "isolated config must not provide a delegation tool");
check(!cold.tools.includes("ask_user"), "isolated config must not provide a structured question tool");
check(cold.tools.includes("pstack_adapter"), "the adapter tool must be registered");

const warm = read("warm");
check(warm.skills.length === expectedSkills, `warm run registered ${warm.skills.length} skills, expected ${expectedSkills}`);
check(warm.skills.includes("pistack-setup"), "pistack-setup must replace the Cursor setup skill");
check(warm.skills.includes("pistack-status"), "pistack-status must be generated");
check(!warm.skills.includes("pistack-setup-pstack"), "the Cursor setup skill must not be exposed verbatim");
check(
  warm.commands.slice().sort().join(",") === "pistack-check,pistack-mode,pistack-status",
  `unexpected commands: ${warm.commands.join(",")}`,
);

const reuse = read("reuse");
check(
  reuse.skills.length === warm.skills.length,
  `cached run registered ${reuse.skills.length} skills, expected ${warm.skills.length} without network`,
);

if (fail.length > 0) {
  console.error(`FAIL\n- ${fail.join("\n- ")}`);
  process.exit(1);
}
console.log(`PASS: ${warm.skills.length} skills, commands ${warm.commands.join(" ")}, delegation and structured-question correctly absent`);
' "$ROOT" "$EXPECTED_SKILLS"
