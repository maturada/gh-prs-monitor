#!/bin/bash
# Author: David Matura
#
# A file an install put under node_modules that a .worktreeinclude pattern matches, in a worktree whose main checkout
# holds no such file: cleanup removes the worktree.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
run() { # $1 harness dir, $2 name, $3 include pattern, $4 file under node_modules
  local H=$1 p head
  p=$(scenario "$2" 'echo code > menu.ts' "printf '%s\n' '$3' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "node_modules/\n*.pem\n.env*\n" > .gitignore' | tail -1)
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | cut -c1-80)
  mkdir -p "$p/$WT/$(dirname "$4")" && echo "from the package" > "$p/$WT/$4" && echo "lib" > "$p/$WT/node_modules/pkg/index.js"
  head=$(git -C "$p/../acme/app.git" rev-parse refs/pull/7/head)
  (cd $H && bun run harness/probe.ts remove "$p" 7 "$head" 2>&1 | tail -1)
  echo "  worktree folder: $([ -d "$p/$WT" ] && echo kept || echo gone)"
}
for side in plugin; do
  echo "=== $side: *.pem, node_modules/pkg/test/key.pem installed in the worktree only"
  run $H nm-pem-$side '*.pem' node_modules/pkg/test/key.pem
  echo "=== $side: .env*, node_modules/pkg/.env.example installed in the worktree only"
  run $H nm-env-$side '.env*' node_modules/pkg/.env.example
  echo "=== $side: control, no include file match (.env), node_modules only"
  run $H nm-ctl-$side '.env' node_modules/pkg/key.pem
done
