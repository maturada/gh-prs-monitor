#!/bin/bash
# Author: David Matura
#
# A tool-made folder and an anchored pattern: '/vendor/' never names app/vendor/.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
J=$H
for side in plugin; do
  echo "=== $side E2: '/vendor/' and '*.pem'; app/vendor/ gets a package's test key from the worktree's install"
  p=$(scenario jE2-$side 'echo code > app/b.php' "printf '/vendor/\n*.pem\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'mkdir -p app && echo a > app/a.php && printf "vendor/\n" > .gitignore' | tail -1)
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | sed "s#$J/##g" | cut -c1-200)
  mkdir -p "$p/$WT/app/vendor/pkg/tests" && echo "from the package" > "$p/$WT/app/vendor/pkg/tests/key.pem"
  head=$(git -C "$p/../acme/app.git" rev-parse refs/pull/7/head)
  (cd $H && bun run harness/probe.ts remove "$p" 7 "$head" 2>&1 | tail -1 | cut -c1-200)
done
