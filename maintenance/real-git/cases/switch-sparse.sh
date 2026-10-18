#!/bin/bash
# Author: David Matura
#
# A sparse checkout: git's --no-overwrite-ignore (checkout, switch, ff merge) writes over an ignored file inside the cone.
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/ LC_ALL=C
mk() { local d=$CASE_GIT/sparse-facts/$1; rm -rf "$d"; mkdir -p "$d"; cd "$d"; git init -q -b main; mkdir -p src docs; echo s>src/s.txt; echo d>docs/readme; git add -A; git commit -qm base; git checkout -q -b feature; echo team > .env; git add -f .env; git commit -qm env; git checkout -q main; [ "$2" = dense ] || git sparse-checkout set --cone src; echo .env >> .git/info/exclude; echo mine > .env; }
for how in "checkout --no-overwrite-ignore feature" "checkout --no-overwrite-ignore -b pr-7 feature" "switch --no-overwrite-ignore feature" "merge --ff-only --no-overwrite-ignore feature"; do
  for mode in dense sparse; do mk x $mode; out=$(git $how 2>&1 | head -1); echo "$mode: git $how -> exit-msg: ${out:0:70} | .env=$(cat .env)"; done
done
p=$(scenario r4-sparse-fresh "echo API=team > .env" "git sparse-checkout set --cone src >/dev/null 2>&1; echo .env >> .git/info/exclude; echo API=mine > .env" "mkdir -p src docs && echo s > src/s.txt && echo d > docs/readme" | tail -1)
echo "=== r4-sparse-fresh (plugin's switchHere, no copy)"; (cd $H && bun run harness/switch.ts "$p" 0 2>&1 | tail -1); echo "  .env: $(cat "$p/.env")"; git -C "$p" checkout -q main; echo "  back on main: .env $( [ -f "$p/.env" ] && cat "$p/.env" || echo MISSING)"
