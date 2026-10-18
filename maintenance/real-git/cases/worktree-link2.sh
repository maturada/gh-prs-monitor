#!/bin/bash
# Author: David Matura
#
# A repository that tracks .claude as a link to a folder of its own (benign): first and second use.
. "$CASES/lib.sh"
p=$(scenario claude-link 'echo code > menu.ts' 'true' 'mkdir -p tools/claude && echo "{}" > tools/claude/settings.json && ln -s tools/claude .claude' | tail -1)
echo "=== claude-link: main tracks .claude -> tools/claude"
echo "  first:  $(cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1)"
echo "  git lists: $(cd "$p" && git worktree list | sed 1d | cut -c1-160)"
echo "  main's status: $(cd "$p" && git status --porcelain | tr '\n' ' ')"
(cd "$p/../teammate" && git checkout -q feature && echo more > more.ts && git add more.ts && git commit -qm more && git push -q origin feature && cd ../acme/app.git && git update-ref refs/pull/7/head refs/heads/feature)
echo "  second: $(cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1)"
echo "  cleanup sees: $(cd $H && bun run harness/probe.ts remove "$p" 7 - 2>&1 | tail -1)"
