#!/bin/bash
# Author: David Matura
#
# The pull request's branch tracks a file `config` where the main checkout has an ignored folder config/ holding
# config/local.json, beside .env: .env is copied, and config/local.json alone said not copied.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
for side in plugin; do
  p=$(scenario mk-$side 'rm -rf config && echo tracked > config' "echo SECRET=1 > .env && mkdir -p config && echo '{}' > config/local.json && printf '.env\nconfig/local.json\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf ".env\nconfig/\n" > .gitignore' | tail -1)
  echo "=== $side"
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | cut -c1-200)
  echo "  .env copied: $([ -f "$p/$WT/.env" ] && echo yes || echo no); config is a file: $([ -f "$p/$WT/config" ] && echo yes || echo no)"
done
