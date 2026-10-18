#!/bin/bash
# Author: David Matura
#
# One walked folder's listing cut short (TRUNC stands for the engine's 4 MiB cut): what is copied.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
J=$H
for side in plugin; do
  echo "=== $side F: .env and data/creds.json named; data/ holds 200 ignored files (its listing cut, the root's not)"
  p=$(scenario jF-$side 'echo code > a.py' "echo SECRET=1 > .env && mkdir -p data && for i in \$(seq 1 200); do echo x > data/sample_\$i.csv; done && echo '{}' > data/creds.json && printf '.env\ndata/creds.json\n' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'printf ".env\ndata/\n" > .gitignore' | tail -1)
  echo "  root listing bytes: $(git -C $p ls-files -z -o -i --exclude-standard --directory | wc -c | tr -d ' '); data/ listing bytes: $(git -C $p ls-files -z -o -i --exclude-standard -- data/ | wc -c | tr -d ' ')"
  (cd $H && TRUNC=1000 bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | sed "s#$J/##g" | cut -c1-220)
  echo "  in the worktree: $(cd $p/$WT && ls -A .env data/creds.json 2>&1 | tr '\n' ' ')"
done
