#!/bin/bash
# Author: David Matura
#
# Switch to the base after a merge (switchToBase): the teammate's feature squash-merged into main and its branch
# deleted on GitHub; the person's clone on feature at the merged head. Nothing of the person's may be lost.
. "$CASES/lib.sh"
# merged NAME 'person setup, on feature at the merged head' ['how the person made feature'] ['main after the merge']
# env: MERGE (squash, or commit for a merge commit), INTO (the base, main), SEED (made on main before feature)
merged() {
  local name=$1 prepare=$2 made=${3:-'git checkout -q -b feature origin/feature'} after=${4:-true}
  local into=${INTO:-main} how='git merge -q --squash feature && git commit -qm "Squash #7"'
  [[ ${MERGE:-squash} == commit ]] && how='git merge -q --no-ff feature -m "Merge #7"'
  local p; p=$(scenario "$name" 'echo code > menu.ts' "$made" "${SEED:-true}" | tail -1) || return 1
  local root; root=$(dirname "$p")
  (cd "$root/teammate" && git checkout -q main && { [[ $into == main ]] || git checkout -q -b "$into"; } && sh -c "$how" \
    && sh -c "$after" && git push -q origin "$into" && git push -q origin --delete feature) >/dev/null 2>&1 || { echo "merge failed"; return 1; }
  (cd "$p" && git fetch -q --prune && sh -c "$prepare") >/dev/null 2>&1 || { echo "person setup failed"; return 1; }
  echo "$p"
}
# run TITLE PERSON [SESSION] [BASE] [OFFER_HEAD]
run() { echo "=== $1"; (cd "$H" && BASE=${4:-main} OFFER_HEAD=${5:-} bun run harness/switch-base.ts "$2" feature "${3:-$2}" 2>&1 | tail -1); }
p=$(merged sb-squash 'true' | tail -1); run "sb-squash: switched, feature deleted" "$p"
p=$(merged sb-no-upstream 'true' 'git checkout -q --no-track -b feature origin/feature' | tail -1); run "sb-no-upstream: pushed without -u, deleted" "$p"
p=$(merged sb-no-local-main 'git branch -q -D main' | tail -1); run "sb-no-local-main: switched, main made tracking origin" "$p"
p=$(merged sb-main-ahead 'git checkout -q main && git merge -q --ff-only origin/main && echo m > mine.txt && git add mine.txt && git commit -qm mine && git checkout -q feature' | tail -1); run "sb-main-ahead: on main as it is, its commit kept" "$p"
p=$(merged sb-main-diverged 'git checkout -q main && echo m > mine.txt && git add mine.txt && git commit -qm mine && git checkout -q feature' | tail -1); run "sb-main-diverged: stopped, nothing moved" "$p"
p=$(merged sb-main-held 'git worktree add -q ../person-main main' | tail -1); run "sb-main-held: stopped, naming the worktree" "$p"
p=$(merged sb-uncommitted 'echo mine >> menu.ts' | tail -1); run "sb-uncommitted: stopped, the change kept" "$p"
p=$(merged sb-untracked 'echo note > notes.txt' | tail -1); run "sb-untracked: switched, the untracked file kept" "$p"
p=$(merged sb-ignored-env 'echo .env >> .git/info/exclude && echo API=mine > .env' | tail -1); run "sb-ignored-env: switched, .env kept" "$p"
p=$(merged sb-env-tracked-on-main 'echo .env >> .git/info/exclude && echo API=mine > .env' 'git checkout -q -b feature origin/feature' 'echo API=team > .env && git add -f .env && git commit -qm "track env"' | tail -1)
run "sb-env-tracked-on-main: stopped, the ignored .env not overwritten" "$p"
# The person works from a fork: origin is bob/app, acme/app is upstream, and main follows the fork's.
p=$(merged sb-fork-remote 'mkdir -p ../bob && git clone -q --bare ../acme/app.git ../bob/app.git && git remote rename origin upstream && git remote add origin "$(cd ../bob/app.git && pwd)" && git fetch -q origin && git branch -q -u origin/main main' | tail -1)
run "sb-fork-remote: main brought up to acme's, still following the fork" "$p"
p=$(MERGE=commit merged sb-merge-commit 'true' | tail -1); run "sb-merge-commit: switched, feature deleted" "$p"
p=$(INTO=release/2.0 merged sb-base-slash 'true' | tail -1); run "sb-base-slash: on release/2.0, made tracking origin" "$p" "$p" release/2.0
p=$(SEED='mkdir -p sub && echo s > sub/s.txt' merged sb-subfolder 'true' | tail -1); run "sb-subfolder: the session in a subfolder, switched" "$p" "$p/sub"
p=$(merged sb-linked-worktree 'git checkout -q main && git worktree add -q .claude/worktrees/x feature' 'git branch -q feature origin/feature' | tail -1)
run "sb-linked-worktree: the session in a worktree, main held by the main checkout: stopped" "$p" "$p/.claude/worktrees/x"
p=$(SEED='mkdir -p docs && echo d > docs/d.txt' merged sb-sparse 'git sparse-checkout set --no-cone /seed.txt /menu.ts' | tail -1); run "sb-sparse: switched" "$p"
p=$(merged sb-local-commit-after 'echo more >> menu.ts && git commit -qam more' | tail -1)
run "sb-local-commit-after: committed to since the note: stopped, the commit kept" "$p" "$p" main "$(git -C "$(dirname "$p")/acme/app.git" rev-parse refs/pull/7/head)"
