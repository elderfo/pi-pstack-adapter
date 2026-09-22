#!/usr/bin/env bash
# Launch Pi against a throwaway config root with only this adapter and its capability
# providers installed, so hands-on testing sees nothing from your real ~/.pi/agent.
#
# Usage:
#   ./pi-sandbox.sh                    launch in the default scratch directory
#   ./pi-sandbox.sh ~/code/myapp       launch in a real project, which Pi may edit
#   ./pi-sandbox.sh --reset            delete the sandbox config first, then launch
#   ./pi-sandbox.sh --cold             also clear the pstack cache, to retest first-run download
#   ./pi-sandbox.sh --project-skills   also load the project's own .agents/skills and .pi/skills
#   ./pi-sandbox.sh --global-skills    also load ~/.agents/skills, hidden by default
#   ./pi-sandbox.sh <dir> -- <pi args> pass the rest through to pi, e.g. -- -p "hi"
#
# The sandbox isolates configuration, not the working tree. Pointing it at a real project
# gives Pi the same write access it normally has there, so use a branch you can throw away.
# PISTACK_SANDBOX_WORK sets the default directory. Copies only auth.json and the default
# model from your real config. Delete ~/.pistack-sandbox to revert the sandbox itself.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_CONFIG="${REAL_PI_CONFIG:-$HOME/.pi/agent}"
SANDBOX="$HOME/.pistack-sandbox"
DEFAULT_WORK="${PISTACK_SANDBOX_WORK:-$HOME/.pistack-sandbox-work}"
WORK="$DEFAULT_WORK"

reset=0
cold=0
skills=hidden

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --reset) reset=1; shift ;;
    --cold) cold=1; shift ;;
    --global-skills) skills=global; shift ;;
    --project-skills) skills=project; shift ;;
    --work) WORK="${2:?--work needs a directory}"; shift 2 ;;
    --) shift; break ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) WORK="$1"; shift ;;
  esac
done

if [ ! -d "$WORK" ]; then
  if [ "$WORK" = "$DEFAULT_WORK" ]; then
    mkdir -p "$WORK"
  else
    echo "No such directory: $WORK" >&2
    exit 1
  fi
fi
WORK="$(cd "$WORK" && pwd)"

# PI_CODING_AGENT_DIR does not cover ~/.agents/skills or a project's own skill directories,
# so without --no-skills the sandbox still sees every global skill, including an unprefixed
# pstack copy that would mask a missing wrapper. Explicit --skill paths survive --no-skills.
skill_args=()
case "$skills" in
  hidden) skill_args=(--no-skills) ;;
  global) skill_args=() ;;
  project)
    skill_args=(--no-skills)
    for dir in "$WORK/.agents/skills" "$WORK/.pi/skills"; do
      [ -d "$dir" ] && skill_args+=(--skill "$dir")
    done
    ;;
esac

if [ ! -f "$REAL_CONFIG/auth.json" ]; then
  echo "No credentials at $REAL_CONFIG/auth.json. Set REAL_PI_CONFIG or run 'pi auth' first." >&2
  exit 1
fi

[ "$reset" -eq 1 ] && rm -rf "$SANDBOX"
[ "$cold" -eq 1 ] && rm -rf "${PISTACK_CACHE_DIR:-$SANDBOX/cache/pi-pstack-adapter}"

export PI_CODING_AGENT_DIR="$SANDBOX"
mkdir -p "$SANDBOX"
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

  cd "$SANDBOX"
  pi install npm:pi-subagents
  pi install npm:pi-ask-user
  pi install "$REPO"
fi

if [ "$WORK" != "$DEFAULT_WORK" ] && [ -d "$WORK/.git" ]; then
  echo "Sandbox config: $SANDBOX"
  echo "Working tree:   $WORK ($(git -C "$WORK" rev-parse --abbrev-ref HEAD), $(git -C "$WORK" status --porcelain | wc -l) uncommitted)"
  echo "Pi can write here. The sandbox isolates configuration, not your files."
fi

cd "$WORK"
exec pi "${skill_args[@]}" "$@"
