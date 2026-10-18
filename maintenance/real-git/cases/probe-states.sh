#!/bin/bash
# Author: David Matura
#
# Each case through the plugin's switchHere, git's own --no-overwrite-ignore, and gh 2.97's own git steps
# (pkg/cmd/pr/checkout), each on its own copy of the person's clone. Only touches folders under $CASE_GIT.
. "$CASES/probe-switch.sh"
# Never reach GitHub: its addresses go to a folder that does not exist, unless a case maps one more closely.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/

# gh 2.97's git steps for PR 7 (head "feature"), as checkoutRun would queue them; $2 fork 0|1; CAN_MODIFY env.
ghsteps() {
  local p=$1 fork=$2 hn=${HEAD_NAME:-feature}
  local base; base=$(cd "$p" && git remote -v | awk '/\/acme\/app(\.git)? \(fetch\)( \[[^]]*\])?$/{print $1; exit}')
  local forkr=""; [ "$fork" = 1 ] && forkr=$(cd "$p" && git remote -v | awk '/\/bob\/app(\.git)? \(fetch\)( \[[^]]*\])?$/{print $1; exit}')
  local head=$base; [ "$fork" = 1 ] && head=$forkr
  local out
  if [ -n "$head" ]; then
    out=$(cd "$p" && git fetch -q "$head" "+refs/heads/$hn:refs/remotes/$head/$hn" --no-tags 2>&1) || { echo "fetch failed: $out"; return; }
    if git -C "$p" show-ref --verify -q refs/heads/$hn; then
      out=$(cd "$p" && git checkout -q "$hn" 2>&1) || { echo "checkout failed: $(echo "$out" | head -1)"; return; }
      out=$(cd "$p" && git merge -q --ff-only "refs/remotes/$head/$hn" 2>&1) || { echo "merge --ff-only failed (left on $(git -C "$p" branch --show-current)): $(echo "$out" | grep -E '^(fatal|error)' | head -1)"; return; }
    else
      out=$(cd "$p" && git checkout -q -b "$hn" --track "$head/$hn" 2>&1) || { echo "checkout -b failed: $(echo "$out" | head -1)"; return; }
    fi
  else
    local from=${base:-https://github.com/acme/app.git}
    local cur; cur=$(git -C "$p" branch --show-current)
    if [ "$cur" = "$hn" ]; then
      out=$(cd "$p" && git fetch -q "$from" refs/pull/7/head --no-tags 2>&1 && git merge -q --ff-only FETCH_HEAD 2>&1) || { echo "fetch/merge failed: $(echo "$out" | head -1)"; return; }
    else
      out=$(cd "$p" && git fetch -q "$from" refs/pull/7/head:$hn --no-tags 2>&1) || { echo "fetch failed: $(echo "$out" | head -1)"; return; }
      out=$(cd "$p" && git checkout -q "$hn" 2>&1) || { echo "checkout failed: $(echo "$out" | head -1)"; return; }
    fi
    local remote=$from merge=refs/pull/7/head
    [ "$CAN_MODIFY" = 1 ] && remote=https://github.com/bob/app.git && merge=refs/heads/$hn
    if [ -z "$(git -C "$p" config --get branch.$hn.merge)" ]; then
      git -C "$p" config branch.$hn.remote "$remote"; git -C "$p" config branch.$hn.pushRemote "$remote"; git -C "$p" config branch.$hn.merge "$merge"
    fi
  fi
  local b; b=$(git -C "$p" rev-parse --abbrev-ref HEAD)
  echo "ok (on $b; remote $(git -C "$p" config --get branch.$b.remote || echo -) merge $(git -C "$p" config --get branch.$b.merge || echo -) pushRemote $(git -C "$p" config --get branch.$b.pushRemote || echo -))"
}

probe4() {
  local name=$1 fork=$2 p=$3
  local base; base=$(cd "$p" && git remote -v | awk '/\/acme\/app(\.git)? \(fetch\)( \[[^]]*\])?$/{print $1; exit}')
  local k; for k in plugin noi gh; do rm -rf "$p.$k"; cp -R "$p" "$p.$k"; done
  local start; start=$(usnap "$p")
  local plug; plug=$(cd $H && env $PLUGIN_ENV bun run harness/switch.ts "$p.plugin" "$fork" 2>&1 | tail -${TAIL:-1})
  local plost; plost=$(echo "$start" | lost "$p.plugin")
  local noi noiexit nlost
  if [ -n "$base" ]; then
    git -C "$p.noi" fetch -q --no-tags "$base" refs/pull/7/head
    noi=$(git -C "$p.noi" checkout -q --no-overwrite-ignore -b probe FETCH_HEAD 2>&1 | grep -E '^(error|fatal)' | head -1)
    git -C "$p.noi" rev-parse --verify -q probe >/dev/null && noiexit=0 || noiexit=1
    nlost=$(echo "$start" | lost "$p.noi")
  fi
  local gh; gh=$( ( [ -n "$PLUGIN_ENV" ] && export $PLUGIN_ENV; ghsteps "$p.gh" $fork ) 2>&1 | tail -1)
  local glost; glost=$(echo "$start" | lost "$p.gh")
  echo "=== $name"
  echo "  plugin: $plug | lost: ${plost:-none}"
  if [ -z "$base" ]; then echo "  noi:    (no remote to fetch from)"; elif [ "$noiexit" = 0 ]; then echo "  noi:    switched | lost: ${nlost:-none}"; else echo "  noi:    refused: $noi | lost: ${nlost:-none}"; fi
  echo "  gh:     $gh | lost: ${glost:-none}"
  if [ -n "$POST" ]; then echo "  post plugin: $(cd "$p.plugin" && sh -c "$POST" 2>&1 | tr '\n' ' ')"; echo "  post gh:     $(cd "$p.gh" && sh -c "$POST" 2>&1 | tr '\n' ' ')"; fi
}
same4() { [ -n "$ONLY" ] && [ "$ONLY" != "$1" ] && return; local p; p=$(scenario "$@" | tail -1) || return; probe4 "$1" 0 "$p"; }
