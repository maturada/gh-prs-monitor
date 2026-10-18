#!/bin/bash
# Author: David Matura
#
# The plugin's switch run from a linked worktree (the session's folder is not the main checkout).
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/
p=$(scenario r4-linked-wt "echo API=team > .env" "echo .env >> .git/info/exclude; git worktree add -q ../person-wt -b work; echo API=mine > ../person-wt/.env" | tail -1)
echo "=== r4-linked-wt-env (session in a linked worktree, ignored .env there)"; (cd $H && bun run harness/switch.ts "$p/../person-wt" 0 2>&1 | tail -1); echo "  .env there: $(cat "$p/../person-wt/.env")"
mv "$p/../person-wt/.env" "$p/../env-aside"; echo "=== r4-linked-wt (same, .env moved aside)"; (cd $H && bun run harness/switch.ts "$p/../person-wt" 0 2>&1 | tail -1); echo "  main checkout on: $(git -C "$p" branch --show-current)"
p=$(scenario r4-linked-wt-held "echo code > menu.ts" "git checkout -q -b feature origin/feature; git worktree add -q ../person-wt -b work origin/main" | tail -1)
echo "=== r4-linked-wt-head-held-by-main"; (cd $H && bun run harness/switch.ts "$p/../person-wt" 0 2>&1 | tail -1)
