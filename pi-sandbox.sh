#!/usr/bin/env bash
# Launch Pi against a throwaway config root with only this adapter and its capability
# providers installed, so hands-on testing sees nothing from your real ~/.pi/agent.
#
# Usage:
#   ./pi-sandbox.sh                 launch the sandbox, creating it if needed
#   ./pi-sandbox.sh --reset         delete the sandbox config first, then launch
#   ./pi-sandbox.sh --cold          also clear the pstack cache, to retest first-run download
#   ./pi-sandbox.sh --global-skills keep ~/.agents/skills, which the sandbox hides by default
#   ./pi-sandbox.sh -- <pi args>    pass the rest through to pi, e.g. -- -p "hi"
#
# Copies only auth.json and the default model from your real config. Delete
# ~/.pistack-sandbox and ~/.pistack-sandbox-work to revert everything.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_CONFIG="${REAL_PI_CONFIG:-$HOME/.pi/agent}"
SANDBOX="$HOME/.pistack-sandbox"
WORK="$HOME/.pistack-sandbox-work"

reset=0
cold=0
# PI_CODING_AGENT_DIR does not cover ~/.agents/skills, so without this the sandbox still sees
# every global skill, including an unprefixed pstack copy that would mask a missing wrapper.
skill_args=(--no-skills)
while [ $# -gt 0 ]; do
  case "$1" in
    --reset) reset=1; shift ;;
    --cold) cold=1; shift ;;
    --global-skills) skill_args=(); shift ;;
    --) shift; break ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) break ;;
  esac
done

if [ ! -f "$REAL_CONFIG/auth.json" ]; then
  echo "No credentials at $REAL_CONFIG/auth.json. Set REAL_PI_CONFIG or run 'pi auth' first." >&2
  exit 1
fi

[ "$reset" -eq 1 ] && rm -rf "$SANDBOX"
[ "$cold" -eq 1 ] && rm -rf "${PISTACK_CACHE_DIR:-$HOME/.pi/agent/cache/pi-pstack-adapter}"

export PI_CODING_AGENT_DIR="$SANDBOX"
mkdir -p "$SANDBOX" "$WORK"
cp "$REAL_CONFIG/auth.json" "$SANDBOX/auth.json"

# Only seed settings on a fresh sandbox. Rewriting it would drop packages that `pi install`
# recorded and any `pi config` choice made by hand.
if [ ! -f "$SANDBOX/settings.json" ]; then
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const real = JSON.parse(readFileSync(process.argv[1], "utf8"));
    writeFileSync(process.argv[2], JSON.stringify({
      defaultProvider: real.defaultProvider,
      defaultModel: real.defaultModel,
      packages: [],
      skills: [],
      extensions: [],
    }, null, 2) + "\n");
  ' "$REAL_CONFIG/settings.json" "$SANDBOX/settings.json"

  cd "$WORK"
  pi install npm:pi-subagents
  pi install npm:pi-ask-user
  pi install "$REPO"
fi

cd "$WORK"
exec pi "${skill_args[@]}" "$@"
