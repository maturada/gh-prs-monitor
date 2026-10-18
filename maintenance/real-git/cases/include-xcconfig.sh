#!/bin/bash
# Author: David Matura
#
# Flutter's Generated.xcconfig in the main checkout, ignored, and `*.xcconfig` (or its path) in .worktreeinclude beside
# an ignored Secrets.xcconfig: what the copy takes, and whether cleanup removes the worktree once `flutter pub get` has
# rewritten Generated.xcconfig there with the worktree's own path.
. "$CASES/lib.sh"
WT=.claude/worktrees/pr-7
run() { # $1 harness dir, $2 name, $3 include pattern
  local H=$1 p head
  p=$(scenario "$2" 'echo code > lib.dart' "mkdir -p ios/Flutter && echo FLUTTER_APPLICATION_PATH=/main > ios/Flutter/Generated.xcconfig && echo KEY=1 > ios/Flutter/Secrets.xcconfig && printf '%s\n' '$3' > .worktreeinclude && echo .worktreeinclude >> .git/info/exclude" 'mkdir -p ios/Flutter && echo x > ios/Flutter/Debug.xcconfig && printf "ios/Flutter/Generated.xcconfig\nios/Flutter/Secrets.xcconfig\n" > .gitignore' | tail -1)
  (cd $H && bun run harness/probe.ts prepare "$p" 0 2>&1 | tail -1 | cut -c1-120)
  echo "  copied Generated.xcconfig: $([ -f "$p/$WT/ios/Flutter/Generated.xcconfig" ] && echo yes || echo no); Secrets.xcconfig: $([ -f "$p/$WT/ios/Flutter/Secrets.xcconfig" ] && echo yes || echo no)"
  echo "FLUTTER_APPLICATION_PATH=/worktree" > "$p/$WT/ios/Flutter/Generated.xcconfig"
  head=$(git -C "$p/../acme/app.git" rev-parse refs/pull/7/head)
  (cd $H && bun run harness/probe.ts remove "$p" 7 "$head" 2>&1 | tail -1 | cut -c1-160)
  echo "  worktree folder: $([ -d "$p/$WT" ] && echo kept || echo gone)"
}
for side in plugin; do
  echo "=== $side: *.xcconfig"
  run $H gx-any-$side '*.xcconfig'
  echo "=== $side: its path named"
  run $H gx-named-$side 'ios/Flutter/Generated.xcconfig'
done
