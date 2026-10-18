#!/bin/bash
# Author: David Matura
#
# A fork's pull request carrying a post-checkout hook, where the person's repository runs hooks from the working tree.
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/
forkrepo() {
  local name=$1 change=$2 prepare=$3 base=${4:-true}
  local root=$CASE_GIT/$name
  rm -rf "$root"; mkdir -p "$root"; cd "$root" || return 1
  git init -q --bare -b main acme/app.git
  git clone -q acme/app.git seed 2>/dev/null
  (cd seed && echo seed > seed.txt && sh -c "$base" && git add -A && git commit -q -m init && git push -q origin main)
  git clone -q --bare acme/app.git bob/app.git
  git clone -q bob/app.git bob-clone 2>/dev/null
  (cd bob-clone && git checkout -q -b feature && sh -c "$change" && git add -A && git commit -q -m change && git push -q origin feature)
  (cd acme/app.git && git fetch -q ../../bob/app.git feature:refs/pull/7/head)
  git clone -q acme/app.git person 2>/dev/null
  (cd person && sh -c "$prepare")
  echo "$root/person"
}
# 1. husky v9's layout: core.hooksPath=.husky/_ (ignored, made by `husky` on install), whose stubs run .husky/<hook>
STUB='mkdir -p .husky/_ && printf "*\n" > .husky/_/.gitignore && printf "#!/bin/sh\n[ -f .husky/post-checkout ] && sh .husky/post-checkout\nexit 0\n" > .husky/_/post-checkout && chmod +x .husky/_/post-checkout && git config core.hooksPath .husky/_'
p=$(forkrepo hook-husky 'mkdir -p .husky && printf "echo fork-code-ran > \"\$(git rev-parse --show-toplevel)/../PWNED-husky\"\n" > .husky/post-checkout' "$STUB" | tail -1)
(cd $H && bun run harness/switch.ts "$p" 1 2>&1 | tail -1)
echo "  husky, here: $( [ -f "$p/../PWNED-husky" ] && echo "fork's .husky/post-checkout RAN" || echo "no hook ran")"
# 2. a tracked hooks folder (core.hooksPath=.githooks), through /prs's own worktree
p=$(forkrepo hook-wt 'mkdir -p .githooks && printf "#!/bin/sh\necho fork-code-ran > \"\$(git rev-parse --show-toplevel)/../../../../PWNED-wt\"\n" > .githooks/post-checkout && chmod +x .githooks/post-checkout' 'git config core.hooksPath .githooks' | tail -1)
(cd $H && bun run harness/prepare.ts "$p" 1 2>&1 | tail -1)
echo "  .githooks, /prs worktree: $( [ -f "$p/../PWNED-wt" ] && echo "fork's .githooks/post-checkout RAN" || echo "no hook ran") $(ls "$p/.." | tr '\n' ' ')"
# 3. the skills' check-1 switch, verbatim but for the placeholders, in the husky layout
p=$(forkrepo hook-skill 'mkdir -p .husky && printf "echo fork-code-ran > \"\$(git rev-parse --show-toplevel)/../PWNED-skill\"\n" > .husky/post-checkout' "$STUB" | tail -1)
cd "$p"; git fetch -q origin pull/7/head; SHA=$(git rev-parse FETCH_HEAD)
[ -z "$(git rev-parse --verify --quiet 'refs/heads/pr-7')" ] && git checkout -q --no-overwrite-ignore -b 'pr-7' "$SHA"
echo "  husky, the skill's switch: $( [ -f "$p/../PWNED-skill" ] && echo "fork's .husky/post-checkout RAN" || echo "no hook ran")"
