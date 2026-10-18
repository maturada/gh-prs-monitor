#!/bin/bash
# Author: David Matura
#
# More folder states, clone kinds, names, remotes, uncommitted changes, hooks, each through probe-states.sh.
. "$CASES/probe-states.sh"
TWO='echo a > a.txt && git add a.txt && git commit -qm one && echo code > menu.ts'

fork4() {
  [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return
  local name=$1 change=$2 prepare=$3 remotes=$4
  local root=$CASE_GIT/$name
  rm -rf "$root"; mkdir -p "$root"; cd "$root" || return 1
  git init -q --bare -b main acme/app.git
  git clone -q acme/app.git seed 2>/dev/null
  (cd seed && echo seed > seed.txt && mkdir seeddir && echo app > seeddir/app.json && git add -A && git commit -q -m init && git push -q origin main)
  git clone -q --bare acme/app.git bob/app.git
  git clone -q bob/app.git bob-clone 2>/dev/null
  (cd bob-clone && git checkout -q -b "${HEAD_NAME:-feature}" && sh -c "$change" && git add -A && git commit -q -m change && git push -q origin "${HEAD_NAME:-feature}")
  (cd acme/app.git && git fetch -q ../../bob/app.git "${HEAD_NAME:-feature}:refs/pull/7/head")
  if [ "$remotes" = "upstream" ]; then
    git clone -q bob/app.git person 2>/dev/null; (cd person && git remote add upstream "$root/acme/app.git" && git fetch -q upstream)
  else
    git clone -q acme/app.git person 2>/dev/null
  fi
  (cd person && git checkout -q main 2>/dev/null; sh -c "$prepare")
  probe4 "$name" 1 "$root/person"
}

# A same-repository case whose head is named $HEAD_NAME (scenario() always pushes "feature").
named4() {
  [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return
  local name=$1 change=$2 prepare=$3
  local root=$CASE_GIT/$name
  rm -rf "$root"; mkdir -p "$root"; cd "$root" || return 1
  git init -q --bare -b main acme/app.git
  git clone -q acme/app.git teammate 2>/dev/null
  (cd teammate && echo seed > seed.txt && git add -A && git commit -q -m init && git push -q origin main \
    && git checkout -q -b "$HEAD_NAME" && sh -c "$change" && git add -A && git commit -q -m change && git push -q origin "$HEAD_NAME")
  (cd acme/app.git && git update-ref refs/pull/7/head "refs/heads/$HEAD_NAME")
  git clone -q acme/app.git person 2>/dev/null
  (cd person && sh -c "$prepare")
  probe4 "$name" 0 "$root/person"
}

PART='git -C ../acme/app.git config uploadpack.allowFilter true; cd .. && rm -rf person && git clone -q --filter=blob:none "file://$PWD/acme/app.git" person && cd person && git config "url.$(cd .. && pwd)/acme/app.git.insteadOf" https://github.com/acme/app.git'
same4 r4-partial-env 'echo API=team > .env' "$PART"' && echo .env >> .git/info/exclude && echo API=mine > .env'
POST='git rev-parse --abbrev-ref HEAD; git config --get-regexp "^branch\.feature\." | tr "\n" ";"; git rev-parse -q --verify refs/remotes/origin/feature || echo no-origin/feature' \
same4 r4-partial-plain 'echo code > menu.ts' "$PART"
POST='git rev-parse --abbrev-ref HEAD; git config --get-regexp "^branch\.pr-7\." | tr "\n" ";"' \
fork4 r4-partial-fork-own-remote 'echo code > menu.ts' 'git -C ../bob/app.git config uploadpack.allowFilter true; git -C ../acme/app.git config uploadpack.allowFilter true; cd .. && rm -rf person && git clone -q --filter=blob:none "file://$PWD/bob/app.git" person && cd person && git remote add upstream "file://$(cd .. && pwd)/acme/app.git" && git config remote.upstream.promisor true && git config remote.upstream.partialclonefilter blob:none && git fetch -q upstream && git checkout -q -b main upstream/main 2>/dev/null; git config "url.$(cd .. && pwd)/acme/app.git.insteadOf" https://github.com/acme/app.git; true'
same4 r4-sparse-outside-env 'mkdir -p docs && echo team > docs/.env' 'git sparse-checkout set --cone src >/dev/null 2>&1; echo /docs/.env >> .git/info/exclude; mkdir -p docs; echo mine > docs/.env' 'mkdir -p src docs && echo s > src/s.txt && echo d > docs/readme'
same4 r4-sparse-inside-env 'mkdir -p src && echo team > src/.env' 'git sparse-checkout set --cone src >/dev/null 2>&1; echo .env >> .git/info/exclude; echo mine > src/.env' 'mkdir -p src docs && echo s > src/s.txt && echo d > docs/readme'

## Names
HEAD_NAME='release/1.2.x' named4 r4-name-dots-slashes 'echo code > menu.ts' 'true'
HEAD_NAME='fix/ünïcødé' named4 r4-name-unicode 'echo code > menu.ts' 'true'
HEAD_NAME='fix/ünïcødé' named4 r4-name-unicode-env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env'
same4 r4-name-tag-too 'echo code > menu.ts' 'git tag feature main && git checkout -q -b feature origin/feature && echo m > m.txt && git add m.txt && git commit -qm mine && git checkout -q main'
same4 r4-name-file-too 'echo code > menu.ts' 'git checkout -q -b feature origin/feature && echo m > m.txt && git add m.txt && git commit -qm mine && git checkout -q main' 'echo f > feature'

## Remotes
same4 r4-base-remote-upstream 'echo code > menu.ts' 'git remote rename origin upstream && git init -q --bare ../other.git && git remote add origin ../other.git'
same4 r4-insteadof 'echo code > menu.ts' 'git config "url.$(cd .. && pwd)/acme/app.git.insteadOf" gh:acme/app && git remote set-url origin gh:acme/app'

## Uncommitted changes
same4 r4-staged-new-in-way 'echo code > menu.ts' 'echo mine > menu.ts && git add menu.ts'
same4 r4-deleted-tracked-changed 'echo team > s2.txt' 'rm s2.txt' 'echo base > s2.txt'
same4 r4-deleted-tracked-same 'echo code > menu.ts' 'rm s2.txt' 'echo base > s2.txt'
same4 r4-untracked-dir-in-way 'echo team > notes' 'mkdir notes && echo mine > notes/a.txt'

## Branch states
POST='git config --get-regexp "^branch\.feature\." | tr "\n" ";"' \
same4 r4-local-no-upstream-behind "$TWO" 'git branch -q --no-track feature origin/feature~1'
same4 r4-held-mid-rebase "$TWO" 'git worktree add -q ../wt-mid -b feature origin/feature~1 && cd ../wt-mid && git checkout -q -b onto origin/main && echo z > a.txt && git add a.txt && git commit -qm z && git checkout -q feature && (git rebase -q onto >/dev/null 2>&1; true)'
PLUGIN_ENV= fork4 r4-fork-pr7-ahead "$TWO" 'git fetch -q origin refs/pull/7/head && git checkout -q -b pr-7 FETCH_HEAD && echo m > m.txt && git add m.txt && git commit -qm m && git checkout -q main'

## Hooks: a relative core.hooksPath, so the hooks are the pull request's own files once checked out
POST='test -f pwned.txt && echo "post-checkout RAN: $(cat pwned.txt)" || echo "no hook ran"' \
fork4 r4-fork-hook-runs 'mkdir -p hooks && printf "#!/bin/sh\necho fork-code-ran > pwned.txt\n" > hooks/post-checkout && chmod +x hooks/post-checkout' 'git config core.hooksPath hooks'
