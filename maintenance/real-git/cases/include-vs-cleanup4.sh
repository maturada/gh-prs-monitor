#!/bin/bash
# Author: David Matura
#
# What the copy takes from a folder it walks that holds tool-made files.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
J=$H
for side in plugin; do
  echo "=== $side G: tools/ ignored whole holding node_modules; *.pem"
  p=$(scenario jG-$side 'echo code > a.ts' "mkdir -p tools/node_modules/pkg/test && echo k > tools/dev.pem && echo t > tools/node_modules/pkg/test/key.pem && printf '*.pem\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "tools/\n" > .gitignore' | tail -1)
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | sed "s#$J/##g" | cut -c1-200)
  echo "  copied: $(cd $p/$WT && find tools -type f 2>/dev/null | sort | tr '\n' ' ')"
done
