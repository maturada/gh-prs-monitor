#!/bin/zsh
# Author: David Matura
#
# test-engines.sh <plugin folder>: the plugin's suite on every Claude Code engine installed here, one after another
# through test-one.sh, each labelled with the version it reports. Looks for `claude` on the PATH, the versions the
# installer keeps (~/.local/share/claude/versions) and, on macOS, the engines the desktop app bundles.
here=${0:a:h}
dir=${1:?plugin folder}
desktop="$HOME/Library/Application Support/Claude/claude-code"
engines=(${commands[claude]} $HOME/.local/share/claude/versions/*(N) "$desktop"/*/*/claude.app/Contents/MacOS/claude(N))
out=$here/.work/engines/$(date +%Y%m%d-%H%M%S)
mkdir -p $out
typeset -A seen
for engine in $engines; do
  version=$($engine --version 2>/dev/null | head -1 | cut -d' ' -f1)
  [[ -z $version || -n ${seen[$version]} ]] && continue
  seen[$version]=1
  bash $here/test-one.sh "$dir" "$engine" > "$out/$version.txt" 2>&1
  echo "== $version [$engine]: $(grep -E '^ *[0-9]+ (pass|fail)' "$out/$version.txt" | tr '\n' ' ')"
  grep -E "\(fail\)" "$out/$version.txt" | head -20
done
echo "(logs in $out)"
