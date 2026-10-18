#!/bin/bash
# Author: David Matura
#
# A folder stopped mid-rebase on an `edit` (clean tree): the plugin's switch, then the person's `git rebase --continue`.
. "$CASES/lib.sh"
p=$(scenario r4-mid-rebase-edit 'echo code > menu.ts' 'git checkout -q -b mine && echo m1 > m1.txt && git add m1.txt && git commit -qm m1 && echo m2 > m2.txt && git add m2.txt && git commit -qm m2 && GIT_SEQUENCE_EDITOR="sed -i.bak s/^pick/edit/" git rebase -q -i main >/dev/null 2>&1; true' | tail -1)
cd "$p"; echo "before: $(git status | head -2 | tr '\n' ' ') mine=$(git log --format=%s mine | tr '\n' ',')"
cp -R "$p" "$p.switch"
echo "git switch: $(git -C "$p.switch" switch --no-overwrite-ignore -c probe origin/feature 2>&1 | head -1)"
(cd $H && bun run harness/switch.ts "$p" 0 2>&1 | tail -1)
echo "after switch: $(git status 2>&1| head -2 | tr '\n' ' ')"
git rebase --continue >/dev/null 2>&1; echo "rebase --continue exit $?"
git rebase --continue >/dev/null 2>&1; git rebase --continue >/dev/null 2>&1
echo "after continue: HEAD on $(git rev-parse --abbrev-ref HEAD); mine=$(git log --format=%s mine | tr '\n' ','); feature=$(git log --format=%s feature | tr '\n' ',')"
