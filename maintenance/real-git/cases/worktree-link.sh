#!/bin/bash
# Author: David Matura
#
# A .claude/worktrees the checkout tracks as a link; a folder include named by a glob.
. "$CASES/lib.sh"
O=$CASE_GIT/outside-wt; rm -rf "$O"; mkdir -p "$O"
p=$(scenario wt-link 'echo code > menu.ts && echo "name: x" > SKILL.md' 'true' "mkdir -p .claude && ln -s $O .claude/worktrees" | tail -1)
echo "=== wt-link: main tracks .claude/worktrees -> $O"
(cd "$p" && git ls-files -s .claude | cut -c1-7,49-)
(cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1)
echo "  outside-wt now holds: $(ls -A "$O" | tr '\n' ' ') / pr-7 holds: $(ls -A "$O/pr-7" 2>/dev/null | tr '\n' ' ')"
echo "  git lists: $(cd "$p" && git worktree list | sed 1d | cut -c1-200)"

echo "=== inc-glob-folder: main ignores certs/ whole; .worktreeinclude names it by a glob"
p=$(scenario inc-glob 'echo code > menu.ts' 'printf "**/certs/\n" > .worktreeinclude && printf "certs/\n.worktreeinclude\n" >> .git/info/exclude && mkdir -p certs && echo K=1 > certs/dev.pem' | tail -1)
(cd "$p" && git ls-files --others --ignored --exclude-from=.worktreeinclude -- certs/dev.pem | sed 's/^/  git matches: /')
(cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1); echo "  certs/dev.pem in the worktree: $([ -e "$p/.claude/worktrees/pr-7/certs/dev.pem" ] && echo copied || echo absent)"
