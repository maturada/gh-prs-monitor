#!/bin/bash
# Author: David Matura
#
# Resolve Conflicts' git commands, each taken from the skill text itself (SKILL.md), placeholders substituted, run on
# throwaway repositories. Only touches folders under $H/git/rc-*.
export GIT_AUTHOR_NAME=n GIT_AUTHOR_EMAIL=a@b GIT_COMMITTER_NAME=n GIT_COMMITTER_EMAIL=a@b
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
G=$H/git
SK=${SK:-$H/plugin/skills/resolve-conflicts/SKILL.md}
T=$G/rc-templates; rm -rf "$T"; mkdir -p "$T"
python3 -I - "$SK" "$T" <<'PY'
import re, sys, pathlib
text, out = pathlib.Path(sys.argv[1]).read_text(), pathlib.Path(sys.argv[2])
def block(anchor, name):
    i = text.index(anchor)
    m = re.compile(r"```bash\n(.*?)\n\s*```", re.S).search(text, i)
    body = "\n".join(line.strip() for line in m.group(1).split("\n"))
    (out / name).write_text(body)
def inline(pattern, name):
    m = re.findall(pattern, text, re.S)
    assert len(m) == 1, (name, len(m))
    (out / name).write_text(m[0])
block("**Work under way in this checkout.**", "under-way")
block("**The base:**", "base")
block("**The temporary worktree.**", "worktree-merge")
block("**The rebase path**", "rebase")
block("**Stopping.**", "stopping")
block("Once every one is applied, check that nothing is left:", "checks")
block("1. **Commit in `<TMP>`.**", "commit")
block("2. **Move this checkout onto it**", "move")
block("4. **Push** (not on `commit only`)", "push")
inline(r"Once it is resolved, `([^`]+)` goes on to the next", "continue")
inline(r"\*\*Both sides at once\*\*: `([^`]+)`", "diff3")
inline(r"the push is `(git push --force-with-lease[^`]+)`", "force-push")
inline(r"on a yes run `([^`]+)`, `<LAST>`", "back")
inline(r"\*\*Mark it resolved\*\*: `([^`]+)`", "add")
PY
sub() { local t; t=$(cat "$T/$1"); shift; while [ $# -gt 1 ]; do t=${t//$1/$2}; shift 2; done; printf '%s' "$t"; }
ok() { if [ "$1" = "$2" ]; then echo "  ok   $3"; else echo "  FAIL $3: got [$1] want [$2]"; fi; }
# mk NAME: main has a.txt; feature changes its line two; main then changes the same line; the person's clone is on
# feature. Extra shell for the teammate's base side ($2) and the person's clone ($3).
mk() {
  local root=$G/rc-$1; rm -rf "$root"; mkdir -p "$root"; cd "$root" || exit 1
  git init -q --bare -b main origin.git; git clone -q origin.git mate 2>/dev/null
  (cd mate && printf 'one\ntwo\nthree\n' > a.txt && echo keep > b.txt && git add -A && git commit -qm init && git push -q origin main \
    && git checkout -q -b feature && printf 'one\ntwo-pr\nthree\n' > a.txt && git commit -qam pr-change && git push -q origin feature \
    && git checkout -q main && printf 'one\ntwo-base\nthree\n' > a.txt && sh -c "${2:-true}" && git add -A && git commit -qm base-change && git push -q origin main)
  git clone -q origin.git person 2>/dev/null; cd person && git checkout -q feature && sh -c "${3:-true}"
  OLD=$(git rev-parse HEAD); HEAD_SHA=$OLD; TMP=$(mktemp -d "$root/tmp.XXXX"); rmdir "$TMP"
  BASE_SHA=$(bash -c "$(sub base '<BASE_REMOTE>' origin '<BASE_REF>' main)" | head -1)
}
# The resolution written as Phase 5's Edit would, then marked resolved with the skill's own add command.
resolve_a() { printf 'one\ntwo-pr\ntwo-base\nthree\n' > "$TMP/a.txt"; bash -c "$(sub add '<TMP>' "$TMP" '<PATH>' a.txt)"; }
MSG=$G/rc-msg.txt; printf "Merge branch 'main' into feature\n" > "$MSG"
commit_line() { sub commit '<TMP>' "$TMP" '<SCRATCHPAD>/merge-<OWNER>-<REPO>-<NUMBER>.txt' "$MSG"; }
move_line() { sub move '<OLD>' "$OLD" '<BRANCH>' feature '<NEW>' "$1"; }

echo "=== 1. a text conflict, resolved, committed in TMP, the checkout moved, pushed"
mk text
out=$(bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" 2>&1); echo "$out" | sed 's/^/    /'
ok "$(git -C "$TMP" diff --name-only --diff-filter=U)" "a.txt" "the conflict listed"
ok "$(git -C "$TMP" show ':1:a.txt' | sed -n 2p),$(git -C "$TMP" show ':2:a.txt' | sed -n 2p),$(git -C "$TMP" show ':3:a.txt' | sed -n 2p)" "two,two-pr,two-base" "stages 1 2 3: merge base, PR, base"
bash -c "$(sub diff3 '<TMP>' "$TMP" '<PATH>' a.txt)"; ok "$(grep -c '^|||||||' "$TMP/a.txt")" "1" "diff3 view shows the merge base's lines"
ok "$(cat a.txt | sed -n 2p)" "two-pr" "the checkout untouched while TMP merges"
resolve_a
checks=$(bash -c "$(sub checks '<TMP>' "$TMP" "':(top,literal)<PATH>' ':(top,literal)<PATH>'" "':(top,literal)a.txt'")" 2>&1); ok "$checks" "" "checks print nothing once resolved"
NEW=$(bash -c "$(commit_line)" | tail -1); ok "$(git -C "$TMP" rev-list --parents -n1 HEAD | wc -w | tr -d ' ')" "3" "a merge commit, two parents"
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; ok "$(git rev-parse HEAD)" "$NEW" "the checkout moved onto the merge"
git worktree remove --force "$TMP"; ok "$(git worktree list | wc -l | tr -d ' ')" "1" "TMP removed"
ok "$(git log --format=%s --first-parent "$HEAD_SHA..HEAD")" "Merge branch 'main' into feature" "first-parent log: the merge alone"
bash -c "$(sub push '<HEAD_SHA>' "$HEAD_SHA" '<REMOTE>' origin '<HEAD>' feature)" >/dev/null 2>&1; ok "$(git -C ../origin.git rev-parse feature)" "$NEW" "pushed as a fast-forward"

echo "=== 2. an ignored .env here, which the base starts tracking: TMP merges, the move refuses, .env kept"
mk env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env'
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a
NEW=$(bash -c "$(commit_line)" | tail -1)
out=$(bash -c "$(move_line "$NEW")" 2>&1); echo "$out" | grep -E '^(error|fatal)' | head -1 | sed 's/^/    /'
ok "$(git rev-parse HEAD),$(cat .env)" "$OLD,API=mine" "not moved, .env intact"
ok "$(git -C "$TMP" rev-parse HEAD)" "$NEW" "TMP left holding the merge"
mv .env ../env.aside; bash -c "$(move_line "$NEW")" >/dev/null 2>&1; ok "$(git rev-parse HEAD)" "$NEW" "the same line moves it once .env is aside"

echo "=== 3. uncommitted changes: one the merge doesn't touch goes along; one it does stops the move"
mk dirty '' 'echo mine >> b.txt'
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; NEW=$(bash -c "$(commit_line)" | tail -1)
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; ok "$(git rev-parse HEAD),$(tail -1 b.txt)" "$NEW,mine" "moved, the change carried"
mk dirty2 '' 'echo mine > a.txt'
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; NEW=$(bash -c "$(commit_line)" | tail -1)
out=$(bash -c "$(move_line "$NEW")" 2>&1); ok "$(git rev-parse HEAD),$(cat a.txt)" "$OLD,mine" "not moved over a change of a file the merge changes"
echo "$out" | grep -E '^error' | head -1 | sed 's/^/    /'

echo "=== 4. a commit made here since: the guard moves nothing"
mk guard
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; NEW=$(bash -c "$(commit_line)" | tail -1)
echo x > c.txt; git add c.txt; git commit -qm later; LATER=$(git rev-parse HEAD)
bash -c "$(move_line "$NEW")"; ok "$?,$(git rev-parse HEAD)" "1,$LATER" "exit 1, HEAD where the commit left it"

echo "=== 5. work under way: each operation named; none, nothing printed"
mk underway
ok "$(bash -c "$(cat $T/under-way)")" "" "nothing under way"
git merge -q origin/main >/dev/null 2>&1; ok "$(bash -c "$(cat $T/under-way)")" "MERGE_HEAD" "a merge"
git merge --abort
printf 'x\n' > d.txt && git add d.txt && git commit -qm d1 && printf 'y\n' > d.txt && git commit -qam d2
GIT_SEQUENCE_EDITOR="sed -i '' 's/^pick/edit/'" git rebase -q -i HEAD~2 >/dev/null 2>&1; ok "$(bash -c "$(cat $T/under-way)")" "rebase-merge" "a rebase"
git rebase --abort
git checkout -q -b other main~0 2>/dev/null; git cherry-pick origin/main >/dev/null 2>&1; ok "$(bash -c "$(cat $T/under-way)")" "CHERRY_PICK_HEAD" "a cherry-pick"
git cherry-pick --abort; git checkout -q feature
( cd ../ && true )
WT=$(mktemp -d "$G/rc-underway/wt.XXXX"); rmdir "$WT"; git worktree add -q "$WT" HEAD~1 2>/dev/null
(cd "$WT" && git merge -q origin/main >/dev/null 2>&1; ok "$(bash -c "$(cat $T/under-way)")" "MERGE_HEAD" "a merge in a linked worktree, found by --git-path")

echo "=== 6. stopping: aborted and removed, the checkout as it was"
mk stop '' 'echo mine >> b.txt'
before=$(git status --porcelain; git rev-parse HEAD)
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1
bash -c "$(sub stopping '<TMP>' "$TMP")" >/dev/null 2>&1
ok "$(git worktree list | wc -l | tr -d ' '),$([ -e "$TMP" ] && echo left || echo gone)" "1,gone" "TMP gone"
ok "$(git status --porcelain; git rev-parse HEAD)" "$before" "the checkout as it was"

echo "=== 7. conflict kinds: the status letters the skill names"
mk kinds 'git rm -q b.txt; mkdir n && echo base > n/new.txt' 'true'
(cd ../mate && git checkout -q feature && echo pr-edit >> b.txt && mkdir -p n && echo pr > n/new.txt && git add -A && git commit -qm more && git push -q origin feature)
git pull -q --no-rebase origin feature 2>/dev/null; OLD=$(git rev-parse HEAD)
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1
ok "$(git -C "$TMP" status --porcelain | grep -E '^(UU|AA|UD|DU)' | sort | tr '\n' ',')" "AA n/new.txt,UD b.txt,UU a.txt," "UU both changed, UD changed here deleted on the base, AA both added"
bash -c "$(sub stopping '<TMP>' "$TMP")" >/dev/null 2>&1

echo "=== 8. a clean merge exits 0"
mk clean 'git checkout -q HEAD~0 -- a.txt; printf "one\ntwo\nthree\n" > a.txt; echo more > c.txt'
out=$(bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" 2>&1; echo "exit=$?"); ok "$(echo "$out" | tail -1)" "exit=0" "clean"
bash -c "$(sub stopping '<TMP>' "$TMP")" >/dev/null 2>&1

echo "=== 9. hooks the repository keeps in its tracked files (the PR's own) never run"
mk hooks
(cd ../mate && git checkout -q feature && mkdir -p .githooks && for h in post-checkout pre-commit commit-msg post-merge pre-merge-commit post-commit reference-transaction post-index-change; do printf '#!/bin/sh\necho "$0" >> %s/HOOKS-RAN\n' "$G/rc-hooks" > .githooks/$h; chmod +x .githooks/$h; done && git add .githooks && git commit -qm hooks && git push -q origin feature)
git -c core.hooksPath=/dev/null pull -q --ff-only origin feature 2>/dev/null; OLD=$(git rev-parse HEAD); HEAD_SHA=$OLD; git config core.hooksPath .githooks
(cd ../mate && git checkout -q main && echo later > later.txt && git add later.txt && git commit -qm later && git push -q origin main)
BASE_SHA=$(bash -c "$(sub base '<BASE_REMOTE>' origin '<BASE_REF>' main)" 2>/dev/null | head -1)
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a
bash -c "$(sub diff3 '<TMP>' "$TMP" '<PATH>' b.txt)" >/dev/null 2>&1
NEW=$(bash -c "$(commit_line)" | tail -1)
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; git worktree remove --force "$TMP"
ok "$([ -e "$G/rc-hooks/HOOKS-RAN" ] && cat "$G/rc-hooks/HOOKS-RAN" | tr '\n' ' ' || echo none),$(git rev-parse HEAD)" "none,$NEW" "no hook ran (fetch, worktree add, merge, status, checkout, add, commit, switch); moved"

echo "=== 10. the push refused where GitHub's branch moved after the fetch, and the way back"
mk moved
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; NEW=$(bash -c "$(commit_line)" | tail -1)
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; git worktree remove --force "$TMP"
(cd ../mate && git checkout -q feature && echo late > late.txt && git add late.txt && git commit -qm late && git push -q origin feature)
out=$(bash -c "$(sub push '<HEAD_SHA>' "$HEAD_SHA" '<REMOTE>' origin '<HEAD>' feature)" 2>&1); echo "$out" | grep -E 'rejected|fetch first|non-fast-forward' | head -1 | sed 's/^/    /'
ok "$(git -C ../origin.git log --format=%s -1 feature)" "late" "GitHub's branch kept"
LAST=$NEW; bash -c "$(sub back '<BRANCH>' feature '<OLD>' "$OLD" '<LAST>' "$LAST")" >/dev/null 2>&1; ok "$(git rev-parse HEAD)" "$OLD" "back where it was"

echo "=== 11. the rebase path: stops, resolved, continued, moved, force-pushed with the lease"
mk rebase
bash -c "$(sub rebase '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1
ok "$(git -C "$TMP" diff --name-only --diff-filter=U)" "a.txt" "stopped on the conflict"
ok "$(git -C "$TMP" show ':2:a.txt' | sed -n 2p),$(git -C "$TMP" show ':3:a.txt' | sed -n 2p)" "two-base,two-pr" "in a rebase stage 2 is the base, 3 the PR's commit"
resolve_a; bash -c "$(sub continue '<TMP>' "$TMP")" >/dev/null 2>&1; NEW=$(git -C "$TMP" rev-parse HEAD)
ok "$(git -C "$TMP" log --format=%s -2 | tr '\n' ',')" "pr-change,base-change," "replayed onto the base"
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; ok "$(git rev-parse HEAD)" "$NEW" "moved (not a descendant, -C takes it)"
git worktree remove --force "$TMP"
bash -c "$(sub force-push '<HEAD>' feature '<HEAD_SHA>' "$HEAD_SHA" '<REMOTE>' origin)" >/dev/null 2>&1; ok "$(git -C ../origin.git rev-parse feature)" "$NEW" "the lease's push went through"
mk rebase2
bash -c "$(sub rebase '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; bash -c "$(sub continue '<TMP>' "$TMP")" >/dev/null 2>&1; NEW=$(git -C "$TMP" rev-parse HEAD)
bash -c "$(move_line "$NEW")" >/dev/null 2>&1; git worktree remove --force "$TMP"
(cd ../mate && git checkout -q feature && echo late > late.txt && git add late.txt && git commit -qm late && git push -q origin feature)
git fetch -q origin
out=$(bash -c "$(sub force-push '<HEAD>' feature '<HEAD_SHA>' "$HEAD_SHA" '<REMOTE>' origin)" 2>&1); echo "$out" | grep -E 'rejected|stale' | head -1 | sed 's/^/    /'
ok "$(git -C ../origin.git log --format=%s -1 feature)" "late" "the lease refused a moved branch"

echo "=== 12. on no branch: --detach in place of -C"
mk detached '' 'git checkout -q --detach'
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; NEW=$(bash -c "$(commit_line)" | tail -1)
line=$(cat $T/move); line=${line//"-C '<BRANCH>' --no-track '<NEW>'"/"--detach '<NEW>'"}; line=${line//<OLD>/$OLD}; line=${line//<NEW>/$NEW}
bash -c "$line" >/dev/null 2>&1; ok "$(git rev-parse HEAD),$(git branch --show-current)" "$NEW," "moved, still on no branch"

echo "=== 13. the base command and the count"
mk base
ok "$(git merge-base HEAD "$BASE_SHA")" "$(git -C ../mate rev-parse main~1)" "merge base is the init commit"
ok "$(git rev-list --count "HEAD..$BASE_SHA")" "1" "one commit comes in"

echo "=== 14. rerere replays a recorded resolution and says so"
mk rerere '' 'git config rerere.enabled true'
bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" >/dev/null 2>&1; resolve_a; git -C "$TMP" -c core.hooksPath=/dev/null rerere >/dev/null 2>&1
bash -c "$(sub stopping '<TMP>' "$TMP")" >/dev/null 2>&1
out=$(bash -c "$(sub worktree-merge '<TMP>' "$TMP" '<BASE_SHA>' "$BASE_SHA")" 2>&1)
ok "$(echo "$out" | grep -c "Resolved 'a.txt' using previous resolution.")" "1" "git says it replayed one"
ok "$(git -C "$TMP" diff --name-only --diff-filter=U),$(sed -n 3p "$TMP/a.txt")" "a.txt,two-base" "still unmerged in the index, the file resolved"
bash -c "$(sub stopping '<TMP>' "$TMP")" >/dev/null 2>&1
