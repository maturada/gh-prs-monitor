#!/bin/bash
# Author: David Matura
#
# /prs's own worktree: made fresh, updated, refused, reset when that loses nothing.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
run() { echo "=== $1"; (cd $H && bun run harness/prepare.ts "$2" "${3:-0}" 2>&1 | tail -1); }
# fresh
p=$(scenario wt-fresh 'echo code > menu.ts' 'true' | tail -1); run wt-fresh "$p"
# own worktree on pr-7, behind, holding an ignored .env where the PR now tracks one
p=$(scenario wt-env 'echo a > a.txt && git add a.txt && git commit -qm one && echo API=team > .env' 'echo .env >> .git/info/exclude' | tail -1)
(cd "$p" && git worktree add -q $WT -b pr-7 origin/feature~1 && echo API=mine > $WT/.env)
run wt-env "$p"; echo "  .env in the worktree: $(cat "$p/$WT/.env")"
# own worktree on pr-7 that went its own way, its commit on GitHub (rebased there), nothing changed: reset
p=$(scenario wt-rebased 'echo a > a.txt && git add a.txt && git commit -qm one && echo code > menu.ts' 'true' | tail -1)
(cd "$p/../teammate" && OLD=$(git rev-parse HEAD) && git reset -q --hard HEAD~1 && echo b > b.txt && git add b.txt && git commit -qm two && git push -q -f origin feature && cd ../acme/app.git && git update-ref refs/pull/7/head refs/heads/feature && git update-ref refs/keep/old $OLD)
(cd "$p" && git worktree add -q $WT -b pr-7 $(git -C ../acme/app.git rev-parse refs/keep/old) 2>/dev/null || (git fetch -q origin refs/keep/old && git worktree add -q $WT -b pr-7 FETCH_HEAD))
run wt-rebased "$p"
# the same with an ignored .env in the worktree where GitHub's version tracks one: git refuses even the reset
p=$(scenario wt-rebased-env 'echo a > a.txt && git add a.txt && git commit -qm one && echo code > menu.ts' 'echo .env >> .git/info/exclude' | tail -1)
(cd "$p/../teammate" && OLD=$(git rev-parse HEAD) && git reset -q --hard HEAD~1 && echo API=team > .env && git add -f .env && git commit -qm two && git push -q -f origin feature && cd ../acme/app.git && git update-ref refs/pull/7/head refs/heads/feature && git update-ref refs/keep/old $OLD)
(cd "$p" && git fetch -q origin refs/keep/old && git worktree add -q $WT -b pr-7 FETCH_HEAD && echo API=mine > $WT/.env)
run wt-rebased-env "$p"; echo "  .env in the worktree: $(cat "$p/$WT/.env")"
