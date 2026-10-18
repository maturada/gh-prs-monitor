#!/bin/bash
# Author: David Matura
#
# A tool-made folder taken in because a pattern names one path in it, beside a pattern at any depth.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
J=$H
prep() { (cd $1 && bun run harness/probe.ts prepare "$2" 0 2>&1 | tail -1 | sed "s#$J/##g" | cut -c1-220); }
rem() { local head; head=$(git -C "$2/../acme/app.git" rev-parse refs/pull/7/head); (cd $1 && bun run harness/probe.ts remove "$2" 7 "$head" 2>&1 | tail -1 | cut -c1-200); echo "  worktree folder: $([ -d "$2/$WT" ] && echo kept || echo gone)"; }
for side in plugin; do
  echo "=== $side E: vendor/ ignored, .worktreeinclude 'vendor/auth.json' and '*.pem'; the worktree's install adds a package's test key"
  p=$(scenario jE-$side 'echo code > a.php' "mkdir -p vendor/acme/lib && echo '{}' > vendor/auth.json && echo lib > vendor/acme/lib/a.php && echo k > dev.pem && printf 'vendor/auth.json\n*.pem\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "vendor/\n*.pem\n" > .gitignore' | tail -1)
  prep $H "$p"
  echo "  copied: $(cd $p/$WT && find vendor dev.pem -type f 2>/dev/null | sort | tr '\n' ' ')"
  mkdir -p "$p/$WT/vendor/other/pkg/tests" && echo "from the package" > "$p/$WT/vendor/other/pkg/tests/key.pem"
  rem $H "$p"
done
