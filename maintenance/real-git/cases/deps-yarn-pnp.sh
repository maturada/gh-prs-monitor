#!/bin/bash
# Author: David Matura
#
# Yarn 4 Plug'n'Play end to end in a /prs worktree: install, resolve, reinstall, cleanup. Needs Node with corepack and
# the network the first time (Yarn and its cache land in the run's folder).
. "$CASES/lib.sh"
F=$H
export COREPACK_HOME=$F/corepack COREPACK_INTEGRITY_KEYS=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export YARN_ENABLE_GLOBAL_CACHE=0 YARN_GLOBAL_FOLDER=$F/yarn-global
C=$H
WT=.claude/worktrees/pr-7
YIGN='.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/sdks\n!.yarn/versions\n.pnp.*\nnode_modules\n'
base="printf '$YIGN' > .gitignore; echo '{\"name\":\"p\",\"version\":\"1.0.0\",\"packageManager\":\"yarn@4.5.3\",\"dependencies\":{\"is-odd\":\"3.0.1\"}}' > package.json; yarn install >/dev/null 2>&1"
p=$(scenario pnp-fix5 'echo code > menu.ts' 'true' "$base" | tail -1)
echo "person: $p; lockfile head: $(grep -m1 '__metadata' $p/yarn.lock)"
(cd $C && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | cut -c1-60)
(cd $C && nice -n 10 bun run harness/probe.ts deps "$p/$WT" 2>&1 | tail -3)
cd "$p/$WT"; echo "-- status ignored:"; git status --short --ignored; echo "-- node resolves via pnp: $(yarn node -e 'console.log(require("is-odd")(3))' 2>&1 | tail -1)"; ls -A . .yarn | tr '\n' ' '; echo
echo "-- second deps run:"; (cd $C && bun run harness/probe.ts deps "$p/$WT" 2>&1 | head -1)
head=$(git -C "$p/../acme/app.git" rev-parse refs/pull/7/head)
echo "-- remove:"; (cd $C && bun run harness/probe.ts remove "$p" 7 "$head" 2>&1 | tail -1); [ -d "$p/$WT" ] && echo kept || echo gone
