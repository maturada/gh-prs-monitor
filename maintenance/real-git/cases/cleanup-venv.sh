#!/bin/bash
# Author: David Matura
#
# certifi's cacert.pem in a worktree's .venv (a uv or Poetry install) with `*.pem` in .worktreeinclude: removed.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
for side in plugin; do
  echo "=== $side: *.pem, .venv/lib/python3.12/site-packages/certifi/cacert.pem"
  p=$(scenario venv-$side 'echo code > app.py' "printf '*.pem\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf ".venv\n*.pem\n" > .gitignore' | tail -1)
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | cut -c1-60)
  f="$p/$WT/.venv/lib/python3.12/site-packages/certifi/cacert.pem"; mkdir -p "$(dirname "$f")" && echo "-----BEGIN CERTIFICATE-----" > "$f"
  head=$(git -C "$p/../acme/app.git" rev-parse refs/pull/7/head)
  (cd $H && bun run harness/probe.ts remove "$p" 7 "$head" 2>&1 | tail -1)
done
