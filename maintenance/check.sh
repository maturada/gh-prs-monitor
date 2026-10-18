#!/bin/sh
# Author: David Matura
#
# The checks a change to the plugin passes before it ships, run from anywhere. TypeScript and Prettier come through npx
# at the versions pinned here, from outside the plugin folder: a package.json in it would have Claude Code install them
# with the plugin, and Anthropic's directory scans what the folder runs.
set -e
cd "$(dirname "$0")/../gh-prs-monitor"

TYPESCRIPT=typescript@5.9.3
PRETTIER=prettier@3.8.3

# Strict, as CI runs it: the marketplace at the repository's root, then the plugin.
claude plugin validate --strict ..
claude plugin validate --strict .
npx --yes "$PRETTIER" --check .
claude plugin test .

# Last, as only an interactive session writes the engine types it reads; the checks above run without them.
if [ ! -f .claude-plugin/types/tsconfig.json ]; then
  echo "Type check not run: no engine types in gh-prs-monitor/.claude-plugin/types/ yet. Start \`claude --plugin-dir gh-prs-monitor\` from the repository's root once, then run this again." >&2
  exit 1
fi
npx --yes -p "$TYPESCRIPT" tsc -p .
