#!/bin/bash
# Author: David Matura
#
# /prs's own worktree, reused, in a sparse clone: behind the pull request, holding an ignored .env the PR now tracks.
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/
WT=.claude/worktrees/pr-7
for mode in dense sparse; do
  p=$(scenario wt-env-$mode 'echo a > a.txt && git add a.txt && git commit -qm one && echo API=team > .env' 'echo .env >> .git/info/exclude' 'mkdir -p src docs && echo s > src/s.txt && echo d > docs/readme' | tail -1)
  [ $mode = sparse ] && git -C "$p" sparse-checkout set --cone src
  (cd "$p" && git worktree add -q $WT -b pr-7 origin/feature~1 && echo API=mine > $WT/.env)
  echo "=== r4-wt-env-$mode (worktree sparse: $(git -C "$p/$WT" config --get core.sparseCheckout || echo no))"
  (cd $H && bun run harness/prepare.ts "$p" 0 2>&1 | tail -1)
  echo "  .env in the worktree: $(cat "$p/$WT/.env")"
done
