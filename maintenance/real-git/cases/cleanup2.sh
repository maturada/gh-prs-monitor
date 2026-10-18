#!/bin/bash
# Author: David Matura
#
# Cleanup of a /prs worktree: more ignored-file cases.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
prep() { (cd $H && bun run harness/probe.ts prepare "$1" 0 2>&1 | tail -1 | cut -c1-12); }
rm7() { local head; head=$(git -C "$1/../acme/app.git" rev-parse refs/pull/7/head); (cd $H && bun run harness/probe.ts remove "$1" 7 "$head" 2>&1 | tail -1); echo "  worktree folder: $([ -d "$1/$WT" ] && echo kept || echo gone)"; }
INC='echo config/ > .worktreeinclude && printf "config/\n.worktreeinclude\n" >> .git/info/exclude && mkdir -p config/sub && echo A > config/a.json && echo B > "config/sub/b c.json"'
echo "=== c8 an ignored folder copied whole, the same as main's: removed"
p=$(scenario c8 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; ls -R "$p/$WT/config" | tr '\n' ' '; echo; rm7 "$p"
echo "=== c9 the same with one more file in the worktree's copy: kept"
p=$(scenario c9 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; echo new > "$p/$WT/config/sub/new.json"; rm7 "$p"
