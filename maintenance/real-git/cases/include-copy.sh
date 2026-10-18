#!/bin/bash
# Author: David Matura
#
# .worktreeinclude copying into a new /prs worktree (prepareWorktree, then copyIncluded).
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
run() { echo "=== $1"; (cd $H && bun run harness/probe.ts prepare "$2" "${3:-0}" 2>&1 | tail -3); }
show() { (cd "$1/$WT" 2>/dev/null && for f in "${@:2}"; do if [ -L "$f" ]; then echo "  $f -> link"; elif [ -e "$f" ]; then echo "  $f: $(cat "$f" 2>/dev/null | head -c 40)"; else echo "  $f: absent"; fi; done); }

# 1 basic: main ignores .env and config/local.json; include names both; PR tracks neither
p=$(scenario inc-basic 'echo code > menu.ts' 'printf ".env\nconfig/local.json\n" > .worktreeinclude && printf ".env\nconfig/local.json\n.worktreeinclude\n" >> .git/info/exclude && echo SECRET=1 > .env && mkdir -p config && echo "{}" > config/local.json' | tail -1)
run inc-basic "$p"; show "$p" .env config/local.json; (cd "$p/$WT" && echo "  status: $(git status --porcelain | tr '\n' ' ')")

# 2 the PR's .gitignore does not ignore .env (main's tracked .gitignore does, PR branch older): copied .env shows untracked
p=$(scenario inc-unignored 'echo code > menu.ts' 'echo .env > .gitignore && echo .env > .worktreeinclude && git add .gitignore .worktreeinclude && git commit -qm ignore && echo SECRET=1 > .env' | tail -1)
run inc-unignored "$p"; show "$p" .env; (cd "$p/$WT" && echo "  status in worktree: $(git status --porcelain | tr '\n' ' ')")

# 3 CRLF include file
p=$(scenario inc-crlf 'echo code > menu.ts' 'printf ".env\r\nlocal.properties\r\n" > .worktreeinclude && printf ".env\nlocal.properties\n.worktreeinclude\n" >> .git/info/exclude && echo SECRET=1 > .env && echo sdk=/x > local.properties' | tail -1)
run inc-crlf "$p"; show "$p" .env local.properties

# 4 the PR tracks config as a symlink to a folder outside the worktree; main has config/local.json ignored
mkdir -p $CASE_GIT/outside-4; rm -rf $CASE_GIT/outside-4/*
p=$(scenario inc-link "ln -s $CASE_GIT/outside-4 config" 'echo "config/local.json" > .worktreeinclude && printf "config/local.json\n.worktreeinclude\n" >> .git/info/exclude && mkdir -p config && echo SECRET=1 > config/local.json' | tail -1)
run inc-link "$p"; show "$p" config config/local.json; echo "  outside-4 holds: $(ls -A $CASE_GIT/outside-4 | tr '\n' ' ')"

# 5 the same with the listing cut short (TRUNC emulates the engine's cut on a large folder's listing)
mkdir -p $CASE_GIT/outside-5; rm -rf $CASE_GIT/outside-5/*
p=$(scenario inc-link-trunc "mkdir -p big && for i in \$(seq 1 300); do echo \$i > big/f\$i; done && ln -s $CASE_GIT/outside-5 big/zlink" 'echo "big/zlink/local.json" > .worktreeinclude && printf "big/zlink/local.json\n.worktreeinclude\n" >> .git/info/exclude && mkdir -p big/zlink && echo SECRET=1 > big/zlink/local.json' | tail -1)
(cd "$p" && git worktree add -q --detach .claude/worktrees/pr-8 origin/feature && git worktree add -q --detach $WT origin/feature)
echo "=== inc-link-trunc (no cut)"; (cd $H && bun run harness/probe.ts copy "$p" "$p/.claude/worktrees/pr-8" 2>&1 | tail -1)
echo "  outside-5 holds: $(ls -A $CASE_GIT/outside-5 | tr '\n' ' ')"
echo "=== inc-link-trunc (TRUNC=2000)"; (cd $H && TRUNC=2000 bun run harness/probe.ts copy "$p" "$p/$WT" 2>&1 | tail -1)
echo "  outside-5 holds: $(ls -A $CASE_GIT/outside-5 | tr '\n' ' ')"

# 6 odd names: space, quote, newline, leading dash, unicode, glob characters
p=$(scenario inc-odd 'echo code > menu.ts' 'printf "*.secret\n" > .worktreeinclude && printf "*.secret\n.worktreeinclude\n" >> .git/info/exclude && echo a > "a b.secret" && echo q > "q\"uote.secret" && printf n > "$(printf "new\nline.secret")" && echo d > -- -dash.secret 2>/dev/null; echo d > ./-dash.secret && echo u > "ünï.secret" && echo g > "[g]*.secret"' | tail -1)
run inc-odd "$p"; (cd "$p/$WT" && ls -A | grep secret | od -c | head -8)

# 7 a fork never gets a copy
p=$(scenario inc-fork 'echo code > menu.ts' 'echo .env > .worktreeinclude && printf ".env\n.worktreeinclude\n" >> .git/info/exclude && echo SECRET=1 > .env' | tail -1)
run inc-fork "$p" 1; show "$p" .env

# 8 the PR tracks .env itself: not copied over it
p=$(scenario inc-tracked 'echo PR=1 > .env && git add -f .env' 'echo .env > .worktreeinclude && printf ".env\n.worktreeinclude\n" >> .git/info/exclude && echo SECRET=1 > .env' | tail -1)
run inc-tracked "$p"; show "$p" .env

# 9 include names a file inside a folder git ignores whole, with a pattern that matches at any depth
p=$(scenario inc-deep 'echo code > menu.ts' 'echo ".env" > .worktreeinclude && printf "secrets/\n.worktreeinclude\n.env\n" >> .git/info/exclude && mkdir -p secrets app && echo S=1 > secrets/.env && echo A=1 > app/.env' | tail -1)
run inc-deep "$p"; show "$p" secrets/.env app/.env
