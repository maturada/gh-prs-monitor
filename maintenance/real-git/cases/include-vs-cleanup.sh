#!/bin/bash
# Author: David Matura
#
# What the copy takes against what cleanup compares: copies edited in the worktree, tool-made files beside them.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
J=$H
prep() { (cd $1 && bun run harness/probe.ts prepare "$2" 0 2>&1 | tail -1 | sed "s#$J/##g" | cut -c1-220); }
rem() { local head; head=$(git -C "$2/../acme/app.git" rev-parse refs/pull/7/head); (cd $1 && bun run harness/probe.ts remove "$2" 7 "$head" 2>&1 | tail -1 | cut -c1-200); echo "  worktree folder: $([ -d "$2/$WT" ] && echo kept || echo gone)"; }

for side in plugin; do
  # build/ is a folder tools make again: named at any depth, as `config.json`, nothing in it is copied; named by its
  # path, the copy is, and edited in the worktree keeps it.
  for pattern in config.json build/config.json; do
    echo "=== $side A [$pattern]: build/* ignored; a copy edited in the worktree"
    p=$(scenario "jA-$side-${pattern//\//-}" 'echo code > a.ts' "mkdir -p build/x && echo '{\"api\":\"main\"}' > build/config.json && echo '{}' > build/x/config.json && printf '$pattern\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "build/*\n" > .gitignore' | tail -1)
    prep $H "$p"
    echo "  copied: $(cd $p/$WT 2>/dev/null && find build -type f 2>/dev/null | sort | tr '\n' ' ')"
    [ -f "$p/$WT/build/config.json" ] && echo '{"api":"edited in the worktree"}' > "$p/$WT/build/config.json"
    rem $H "$p"
  done

  echo "=== $side B: settings_local/ named; python imports it in the worktree (main never did)"
  p=$(scenario jB-$side 'echo code > app.py' "mkdir -p settings_local && echo > settings_local/__init__.py && echo 'KEY=1' > settings_local/config.py && printf 'settings_local/\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "settings_local/\n__pycache__/\n" > .gitignore' | tail -1)
  prep $H "$p"
  (cd "$p/$WT" && python3 -c 'import settings_local.config' && echo "  made: $(find settings_local -name '*.pyc' | tr '\n' ' ')")
  rem $H "$p"

  echo "=== $side C: tools/ ignored whole, *.pem; a package in tools/node_modules holds a key in the worktree only"
  p=$(scenario jC-$side 'echo code > a.ts' "mkdir -p tools && echo k > tools/dev.pem && printf '*.pem\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "tools/\n" > .gitignore' | tail -1)
  prep $H "$p"
  mkdir -p "$p/$WT/tools/node_modules/pkg/test" && echo "from the package" > "$p/$WT/tools/node_modules/pkg/test/key.pem" && echo lib > "$p/$WT/tools/node_modules/pkg/index.js"
  rem $H "$p"

  echo "=== $side D: certs/ named; Finder writes certs/.DS_Store in the worktree"
  p=$(scenario jD-$side 'echo code > a.ts' "mkdir -p certs && echo k > certs/dev.pem && printf 'certs/\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf "certs/\n.DS_Store\n" > .gitignore' | tail -1)
  prep $H "$p"
  printf 'Bud1finder' > "$p/$WT/certs/.DS_Store"
  rem $H "$p"
done
