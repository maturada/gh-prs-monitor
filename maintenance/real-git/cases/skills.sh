#!/bin/bash
# Author: David Matura
#
# The skills' moves, each command taken from the skill text itself, placeholders substituted. Only touches folders
# under $H/git.
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/
SK=$H/plugin/skills
T=$CASE_GIT/templates; mkdir -p "$T"
python3 - "$SK" "$T" <<'PY'
import re, sys, pathlib
sk, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
co = (sk / "shared/checkout.md").read_text()
cp = (sk / "shared/commit-and-push.md").read_text()
pr = (sk / "create-pr/SKILL.md").read_text()
def one(pattern, text, name):
    m = re.findall(pattern, text, re.S)
    assert len(m) == 1, (name, len(m))
    (out / name).write_text(m[0])
one(r"give it as `(\[ \"\$\(git rev-parse HEAD\)\" = '<OLD>' \] && )<the move>`", co, "guard")
one(r"Otherwise the folder then moves: `([^`]+)`", co, "replay-move")
one(r"prints nothing, `([^`]+)`", co, "new-branch")
one(r"exits 0 \(behind\), `([^`]+)`", co, "behind-branch")
one(r"\(commits beyond the PR's, kept\), `([^`]+)`", co, "ahead-branch")
one(r"behind, `(git -c core.hooksPath=/dev/null merge [^`]+)`", co, "ff-merge")
one(r"`(git -c core.hooksPath=/dev/null worktree add --detach '<TMP>' HEAD && .+?worktree remove --force '<TMP>')`", pr, "createpr-line")
one(r"\*\*On `commit only`:\*\*.*?```bash\n(.+?)\n```", cp, "commit-only-line")
one(r"First, when `([^`]+)` prints `true`", co, "sparse-check")
PY
sub() { local t; t=$(cat "$T/$1"); shift; while [ $# -gt 1 ]; do t=${t//$1/$2}; shift 2; done; printf '%s' "$t"; }
log() { git log --format=%s "$@" | tr '\n' ',' ; }

# 1. checkout.md `update`, diverged, in a folder of the user's: the replay in TMP, the user given the guarded move;
#    refused over an uncommitted change, committed as told, the same guarded move again: it moves nothing.
p=$(scenario replay-retry-after-commit 'echo a > a.txt' 'git checkout -q -b feature origin/feature && echo m > m.txt && git add m.txt && git commit -qm mine && echo wip > seed.txt' | tail -1)
(cd "$p/../teammate" && echo theirs > seed.txt && git commit -qam theirs && git push -q origin feature)
cd "$p"; git fetch -q origin refs/heads/feature; SHA=$(git rev-parse FETCH_HEAD); OLD=$(git rev-parse HEAD)
TMP=$(mktemp -d "$CASE_GIT/tmp.XXXXXX")
git -c core.hooksPath=/dev/null worktree add -q --detach "$TMP" HEAD
git -C "$TMP" -c core.hooksPath=/dev/null -c rebase.updateRefs=false rebase -q "$SHA"; rc=$?
NEW=$(git -C "$TMP" rev-parse HEAD); git worktree remove --force "$TMP"
MOVE="$(sub guard "<OLD>" "$OLD")$(sub replay-move "<BRANCH>" feature "<NEW>" "$NEW")"
echo "=== replay-retry-after-commit (rebase exit $rc)"
echo "  given: $MOVE"
echo "  move 1: $(bash -c "$MOVE" 2>&1 | head -1) | feature = $(log -3 feature)"
git commit -qam "my wip, committed as told"
echo "  move 2: exit $(bash -c "$MOVE" >/dev/null 2>&1; echo $?) | feature = $(log -4 feature); seed.txt = $(cat seed.txt)"

# 2. create-pr's line, the rebase stopping on a conflict: the branch as it was, TMP gone. 3. the same, going through.
for kind in conflict clean; do
  p=$(scenario createpr-$kind 'echo a > a.txt' 'git checkout -q -b feature origin/feature && echo one > seed.txt && git commit -qam one && echo two > two.txt && git add two.txt && git commit -qm two && echo three > three.txt && git add three.txt && git commit -qm three' | tail -1)
  cd "$p"; git -C ../teammate checkout -q main
  if [ $kind = conflict ]; then (cd ../teammate && echo base-change > seed.txt && git commit -qam base-change && git push -q origin main)
  else (cd ../teammate && echo b > b.txt && git add b.txt && git commit -qm base-change && git push -q origin main); fi
  git fetch -q origin; BASE_SHA=$(git rev-parse origin/main); M=$(git rev-parse HEAD~3); TMP=$(mktemp -d)
  before=$(log -5 feature)
  bash -c "$(sub createpr-line "<TMP>" "$TMP" "<BASE_SHA>" "$BASE_SHA" "<M>" "$M" "<BRANCH>" feature)" >/dev/null 2>&1
  echo "=== createpr-$kind (before: $before)"
  echo "  after: feature = $(log -5 feature); on $(git branch --show-current); worktrees: $(git worktree list | wc -l | tr -d ' '); TMP left: $([ -e "$TMP/.git" ] && echo yes || echo no); status: '$(git status --porcelain)'"
done

# 4. commit-and-push's commit-only line, GitHub's commits brought in: through, and stopped on a conflict.
for kind in clean conflict; do
  p=$(scenario commit-only-$kind 'echo a > a.txt' 'git checkout -q -b feature origin/feature && echo mine > m.txt && git add m.txt && git commit -qm mine' | tail -1)
  if [ $kind = conflict ]; then (cd "$p/../teammate" && echo theirs > m.txt && git add m.txt && git commit -qm theirs && git push -q origin feature)
  else (cd "$p/../teammate" && echo t > t.txt && git add t.txt && git commit -qm theirs && git push -q origin feature); fi
  cd "$p"; git fetch -q origin refs/heads/feature; SHA=$(git rev-parse FETCH_HEAD); TMP=$(mktemp -d)
  bash -c "$(sub commit-only-line "<TMP>" "$TMP" "<HEAD_SHA>" "$SHA" "<BRANCH>" feature)" >/dev/null 2>&1
  echo "=== commit-only-$kind"
  echo "  after: feature = $(log -4 feature); worktrees: $(git worktree list | wc -l | tr -d ' '); TMP left: $([ -e "$TMP/.git" ] && echo yes || echo no)"
done

# 5. "A branch at a commit": a new pr-7 over an ignored .env the PR tracks (refused), behind (moved), ahead (kept),
#    mid-rebase (refused), and the ff merge over .env (refused).
p=$(scenario new-env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env' | tail -1)
cd "$p"; git fetch -q origin refs/pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
echo "=== new-env: $(bash -c "$(sub new-branch "<BRANCH>" pr-7 "<TARGET>" "$SHA")" 2>&1 | head -1) | on $(git branch --show-current), .env=$(cat .env)"
p=$(scenario behind 'echo a > a.txt && git add a.txt && git commit -qm one && echo b > b.txt' 'git branch -q pr-7 origin/feature~1' | tail -1)
cd "$p"; git fetch -q origin refs/pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
bash -c "$(sub behind-branch "<BRANCH>" pr-7 "<TARGET>" "$SHA")" >/dev/null 2>&1
echo "=== behind: on $(git branch --show-current) at $( [ "$(git rev-parse HEAD)" = "$SHA" ] && echo the PR head || echo elsewhere)"
p=$(scenario ahead 'echo a > a.txt' 'git checkout -q -b pr-7 origin/feature && echo m > m.txt && git add m.txt && git commit -qm mine && git checkout -q main' | tail -1)
cd "$p"; git fetch -q origin refs/pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
bash -c "$(sub ahead-branch "<BRANCH>" pr-7)" >/dev/null 2>&1
echo "=== ahead: on $(git branch --show-current), pr-7 = $(log -2 pr-7)"
p=$(scenario midrebase 'echo a > a.txt' 'echo 1 > m1 && git add m1 && git commit -qm m1 && echo 2 > m2 && git add m2 && git commit -qm m2' | tail -1)
cd "$p"; GIT_SEQUENCE_EDITOR="sed -i '' 's/^pick/edit/'" git rebase -q -i HEAD~2 >/dev/null 2>&1; git fetch -q origin refs/pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
echo "=== midrebase: $(bash -c "$(sub new-branch "<BRANCH>" pr-7 "<TARGET>" "$SHA")" 2>&1 | head -1)"
p=$(scenario ff-env 'echo a > a.txt && git add a.txt && git commit -qm one && echo API=team > .env' 'echo .env >> .git/info/exclude; git checkout -q -b feature origin/feature~1; echo API=mine > .env' | tail -1)
cd "$p"; git fetch -q origin refs/heads/feature; SHA=$(git rev-parse FETCH_HEAD)
echo "=== ff-env: $(bash -c "$(sub ff-merge "<HEAD_SHA>" "$SHA")" 2>&1 | grep -E '^(error|fatal)' | head -1) | .env=$(cat .env)"

# 6. a repository whose hooks are its own files: the PR's post-checkout, brought in by the switch, does not run.
p=$(scenario hooks 'mkdir -p .githooks && printf "#!/bin/sh\ntouch HOOK-RAN\n" > .githooks/post-checkout && chmod +x .githooks/post-checkout' 'git config core.hooksPath .githooks' | tail -1)
cd "$p"; git fetch -q origin refs/pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
bash -c "$(sub new-branch "<BRANCH>" pr-7 "<TARGET>" "$SHA")" >/dev/null 2>&1
echo "=== hooks: on $(git branch --show-current); the PR's hook ran: $([ -e HOOK-RAN ] && echo yes || echo no)"
git checkout -q main; git checkout -q pr-7; echo "  (a plain checkout back and forth runs it: $([ -e HOOK-RAN ] && echo yes || echo no))"; cat .githooks/post-checkout | tr '\n' ' ' 

# 7. the sparse check, as written
p=$(scenario sparse 'echo a > a.txt' 'git sparse-checkout set --cone src' | tail -1)
cd "$p"; echo "=== sparse: '$(bash -c "$(cat $T/sparse-check)")' (dense clone: '$(cd ../teammate && bash -c "$(cat $T/sparse-check)")')"
