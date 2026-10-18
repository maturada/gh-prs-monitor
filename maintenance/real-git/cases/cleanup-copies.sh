#!/bin/bash
# Author: David Matura
#
# Cleanup of a worktree holding copies: under a folder tools make again, 250 copies, and Android's local.properties
# as Flutter writes it or with a key of the person's.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
prep() { (cd $H && bun run harness/probe.ts prepare "$1" 0 2>&1 | tail -1 | cut -c1-60); }
rm7() { local head; head=$(git -C "$1/../acme/app.git" rev-parse refs/pull/7/head); (cd $H && bun run harness/probe.ts remove "$1" 7 "$head" 2>&1 | tail -1); echo "  worktree folder: $([ -d "$1/$WT" ] && echo kept || echo gone)"; }

echo "=== h4a vendor/creds.json copied, the same as main's: removed"
VB='printf "vendor/\n" > .gitignore'
VEN='echo vendor/creds.json > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude && mkdir vendor && echo K=1 > vendor/creds.json'
p=$(scenario h4a 'echo code > menu.ts' "$VEN" "$VB" | tail -1); prep "$p"; ls "$p/$WT/vendor" 2>/dev/null | tr '\n' ' '; echo; rm7 "$p"
echo "=== h4b vendor/creds.json copied, then edited in the worktree: kept"
p=$(scenario h4b 'echo code > menu.ts' "$VEN" "$VB" | tail -1); prep "$p"; echo K=mine > "$p/$WT/vendor/creds.json"; rm7 "$p"
echo "=== h4c vendor/ installed by hand in the worktree, no include: removed as remade"
p=$(scenario h4c 'echo code > menu.ts' 'true' "$VB" | tail -1); prep "$p"; mkdir -p "$p/$WT/vendor" && echo x > "$p/$WT/vendor/lib.php"; rm7 "$p"
echo "=== h1 250 files copied from an ignored data/, all the same: removed"
DB='printf "data/\n" > .gitignore'
DATA='echo data/ > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude && mkdir data && for i in $(seq 1 250); do echo $i > data/f$i; done'
p=$(scenario h1 'echo code > menu.ts' "$DATA" "$DB" | tail -1); prep "$p"; echo "  copied: $(ls "$p/$WT/data" | wc -l | tr -d ' ')"; rm7 "$p"
echo "=== h1b the same, one edited in the worktree: kept"
p=$(scenario h1b 'echo code > menu.ts' "$DATA" "$DB" | tail -1); prep "$p"; echo edited > "$p/$WT/data/f240"; rm7 "$p"
echo "=== h5a android/local.properties as Flutter writes it, only in the worktree: removed"
LP='mkdir -p android && printf "local.properties\n" > android/.gitignore'
p=$(scenario h5a 'echo code > menu.ts' 'true' "$LP" | tail -1); prep "$p"; printf "sdk.dir=/x/sdk\nflutter.sdk=/opt/flutter\nflutter.buildMode=debug\n" > "$p/$WT/android/local.properties"; rm7 "$p"
echo "=== h5b the same with a key of the person's: kept"
p=$(scenario h5b 'echo code > menu.ts' 'true' "$LP" | tail -1); prep "$p"; printf "sdk.dir=/x/sdk\nMAPS_KEY=abc\n" > "$p/$WT/android/local.properties"; rm7 "$p"
