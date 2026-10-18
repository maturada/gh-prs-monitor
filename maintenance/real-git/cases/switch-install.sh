#!/bin/bash
# Author: David Matura
#
# The install after a switch: only when the switch changed the lockfile; a fork's never.
. "$CASES/lib.sh"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$CASE_GIT/no-network/.insteadOf" GIT_CONFIG_VALUE_0=https://github.com/
export NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_OFFLINE=true NPM_CONFIG_UPDATE_NOTIFIER=false
PKG='printf "{\"name\":\"app\",\"version\":\"1.0.0\"}\n" > package.json && printf "{\"name\":\"app\",\"version\":\"1.0.0\",\"lockfileVersion\":3,\"requires\":true,\"packages\":{\"\":{\"name\":\"app\",\"version\":\"1.0.0\"}}}\n" > package-lock.json'
p=$(scenario r4-lock-same 'echo code > menu.ts' 'true' "$PKG" | tail -1)
echo "=== r4-lock-same"; (cd $H && SHOWLOG=1 bun run harness/switch.ts "$p" 0 2>&1 | grep -E "SWITCHED|STOPPED|npm" | head -3)
p=$(scenario r4-lock-changed 'printf "{\"name\":\"app\",\"version\":\"1.0.1\"}\n" > package.json && printf "{\"name\":\"app\",\"version\":\"1.0.1\",\"lockfileVersion\":3,\"requires\":true,\"packages\":{\"\":{\"name\":\"app\",\"version\":\"1.0.1\"}}}\n" > package-lock.json' 'true' "$PKG" | tail -1)
echo "=== r4-lock-changed"; (cd $H && SHOWLOG=1 bun run harness/switch.ts "$p" 0 2>&1 | grep -E "SWITCHED|STOPPED|npm" | head -3)
