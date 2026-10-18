#!/bin/bash
# Author: David Matura
#
# Cleanup of a /prs worktree holding ignored files (removePullWorktree, then firstNotInMain).
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
prep() { (cd $H && bun run harness/probe.ts prepare "$1" 0 2>&1 | tail -1 | cut -c1-12); }
rm7() { local head; head=$(git -C "$1/../acme/app.git" rev-parse refs/pull/7/head); (cd $H && bun run harness/probe.ts remove "$1" 7 "$head" 2>&1 | tail -1); echo "  worktree folder: $([ -d "$1/$WT" ] && echo kept || echo gone); .env there: $(cat "$1/$WT/.env" 2>/dev/null || echo -)"; }
INC='echo .env > .worktreeinclude && printf ".env\n.worktreeinclude\n" >> .git/info/exclude && echo SECRET=1 > .env'

echo "=== c1 copied .env the same as main's: removed"
p=$(scenario c1 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; rm7 "$p"

echo "=== c2 copied .env changed in the worktree: kept"
p=$(scenario c2 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; echo SECRET=2 > "$p/$WT/.env"; rm7 "$p"

echo "=== c3 main's .env removed since: kept"
p=$(scenario c3 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; rm "$p/.env"; rm7 "$p"

echo "=== c4 main's .env now a link to the worktree's: kept"
p=$(scenario c4 'echo code > menu.ts' "$INC" | tail -1); prep "$p"; rm "$p/.env"; ln -s "$p/$WT/.env" "$p/.env"; rm7 "$p"

echo "=== c5 main's config folder a link into the worktree's (each file then compares with itself)"
p=$(scenario c5 'echo code > menu.ts' 'echo config/local.json > .worktreeinclude && printf "config/\n.worktreeinclude\n" >> .git/info/exclude && mkdir config && echo S=1 > config/local.json' | tail -1); prep "$p"
echo S=mine-only > "$p/$WT/config/local.json"; rm -rf "$p/config"; ln -s "$p/$WT/config" "$p/config"; rm7 "$p"

echo "=== c6 the PR's .gitignore lacks .env (main's tracked one has it): copied .env shows untracked"
p=$(scenario c6 'echo code > menu.ts' 'echo .env > .gitignore && echo .env > .worktreeinclude && git add .gitignore .worktreeinclude && git commit -qm ignore && echo SECRET=1 > .env' | tail -1); prep "$p"; rm7 "$p"

echo "=== c7 a Flutter iOS app's ignored .symlinks/plugins links (pod install makes them): kept?"
p=$(scenario c7 'echo code > menu.ts' 'true' 'mkdir -p ios && printf "**/Pods/\n**/.symlinks/\n" > ios/.gitignore && echo code > ios/Podfile' | tail -1); prep "$p"
mkdir -p "$p/$WT/ios/.symlinks/plugins" "$p/$WT/ios/Pods" "$CASE_GIT/pubcache/path_provider_foundation-2.4.0/ios"; ln -s "$CASE_GIT/pubcache/path_provider_foundation-2.4.0" "$p/$WT/ios/.symlinks/plugins/path_provider_foundation"; echo x > "$p/$WT/ios/Pods/Manifest.lock"
mkdir -p "$p/ios/.symlinks/plugins"; ln -s "$CASE_GIT/pubcache/path_provider_foundation-2.4.0" "$p/ios/.symlinks/plugins/path_provider_foundation"
(cd "$p/$WT" && echo "  status: $(git status --porcelain --ignored | tr '\n' ' ')"); rm7 "$p"
