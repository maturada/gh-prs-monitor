#!/bin/bash
# Author: David Matura
#
# Every switch case through four probes, each on its own copy of the person's clone:
#   plugin  = the plugin's switchHere (harness/switch.ts), then what it lost
#   noi     = git checkout --no-overwrite-ignore to the pull request's head
#   merge   = the skills' "behind" update (git merge --ff-only --no-overwrite-ignore)
#   plain   = a plain checkout to the head (gh's checkout), what it lost, and what switching back lost
# Only touches folders under $CASE_GIT.
. "$CASES/lib.sh"

# untracked files (ignored included) at a folder: path TAB hash (L:target for a symlink, D for a nested repo)
usnap() { (cd "$1" && git ls-files -o -z | while IFS= read -r -d '' f; do f=${f%/}; if [ -L "$f" ]; then h="L:$(readlink "$f")"; elif [ -d "$f" ]; then h=D; else h=$(shasum < "$f" | cut -c1-8); fi; printf '%s\t%s\n' "$f" "$h"; done | sort); }
# of a snapshot on stdin, the paths missing or changed under folder $1
lost() { local f h h2; while IFS=$'\t' read -r f h; do [ -z "$f" ] && continue; if [ -L "$1/$f" ]; then h2="L:$(readlink "$1/$f")"; elif [ -d "$1/$f" ]; then h2=D; elif [ -f "$1/$f" ]; then h2=$(shasum < "$1/$f" | cut -c1-8); else h2=MISSING; fi; [ "$h" = "$h2" ] || printf '%s ' "$f"; done; }

probe() {
  local name=$1 fork=$2 p=$3
  local base; base=$(cd "$p" && git remote -v | awk '/\/acme\/app(\.git)? \(fetch\)$/{print $1; exit}')
  local k; for k in plugin noi plain merge; do rm -rf "$p.$k"; cp -R "$p" "$p.$k"; done
  local start; start=$(usnap "$p")
  local was; was=$(git -C "$p" rev-parse --abbrev-ref HEAD)
  # plugin
  local plug; plug=$(cd $H && env $PLUGIN_ENV bun run harness/switch.ts "$p.plugin" "$fork" 2>&1 | tail -1)
  local plost; plost=$(echo "$start" | lost "$p.plugin")
  # git's own refusal
  git -C "$p.noi" fetch -q --no-tags "$base" refs/pull/7/head
  local noi; noi=$(git -C "$p.noi" checkout -q --no-overwrite-ignore -b probe FETCH_HEAD 2>&1 | head -1); local noiexit=${PIPESTATUS[0]}
  git -C "$p.noi" rev-parse --verify -q probe >/dev/null && noiexit=0 || noiexit=1
  local nlost; nlost=$(echo "$start" | lost "$p.noi")
  # the skills' "behind" update, verbatim but for <HEAD_SHA>
  git -C "$p.merge" fetch -q --no-tags "$base" refs/pull/7/head
  local msha; msha=$(git -C "$p.merge" rev-parse FETCH_HEAD)
  local merge; merge=$(git -C "$p.merge" merge --ff-only --no-autostash --no-overwrite-ignore "$msha" 2>&1 | grep -E "^(error|fatal)" | head -1)
  local mok=no; [ "$(git -C "$p.merge" rev-parse HEAD)" = "$msha" ] && mok=yes
  local mlost; mlost=$(echo "$start" | lost "$p.merge")
  # plain switch, then back
  git -C "$p.plain" fetch -q --no-tags "$base" refs/pull/7/head
  local plain; plain=$(git -C "$p.plain" checkout -q -b probe FETCH_HEAD 2>&1 | head -1)
  local switched=no; git -C "$p.plain" rev-parse --verify -q probe >/dev/null && [ "$(git -C "$p.plain" rev-parse --abbrev-ref HEAD)" = probe ] && switched=yes
  local alost; alost=$(echo "$start" | lost "$p.plain")
  local blost=""
  if [ $switched = yes ]; then git -C "$p.plain" checkout -q "$was" 2>/dev/null; blost=$(echo "$start" | lost "$p.plain"); fi
  echo "=== $name"
  echo "  plugin: $plug | lost: ${plost:-none}"
  if [ $noiexit = 0 ]; then echo "  noi:    switched | lost: ${nlost:-none}"; else echo "  noi:    refused: $noi"; fi
  if [ $mok = yes ]; then echo "  merge:  updated | lost: ${mlost:-none}"; else echo "  merge:  refused: $merge | lost: ${mlost:-none}"; fi
  if [ $switched = yes ]; then echo "  plain:  switched | lost: ${alost:-none} | after back: ${blost:-none}"; else echo "  plain:  refused: $plain"; fi
}

# a same-repository case: name, teammate change, person prepare, [base]
same() { [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return; local p; p=$(scenario "$@" | tail -1) || return; probe "$1" 0 "$p"; }

# a fork's case: name, change, prepare, [upstream]
fork() {
  [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return
  local name=$1 change=$2 prepare=$3 remotes=$4
  local root=$CASE_GIT/$name
  rm -rf "$root"; mkdir -p "$root"; cd "$root" || return 1
  git init -q --bare -b main acme/app.git
  git clone -q acme/app.git seed 2>/dev/null
  (cd seed && echo seed > seed.txt && mkdir seeddir && echo app > seeddir/app.json && git add -A && git commit -q -m init && git push -q origin main)
  git clone -q --bare acme/app.git bob/app.git
  git clone -q bob/app.git bob-clone 2>/dev/null
  (cd bob-clone && git checkout -q -b feature && sh -c "$change" && git add -A && git commit -q -m change && git push -q origin feature)
  (cd acme/app.git && git fetch -q ../../bob/app.git feature:refs/pull/7/head)
  if [ "$remotes" = "upstream" ]; then
    git clone -q bob/app.git person 2>/dev/null; (cd person && git remote add upstream "$root/acme/app.git" && git fetch -q upstream)
  else
    git clone -q acme/app.git person 2>/dev/null
  fi
  (cd person && git checkout -q main 2>/dev/null; sh -c "$prepare")
  probe "$name" 1 "$root/person"
}
