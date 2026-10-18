#!/bin/bash
# Author: David Matura
#
# test-one.sh <plugin folder> [engine]: `claude plugin test` in that folder at low priority, one run at a time on this
# machine. The test kit gives each test 5 s, which two suites running at once can exceed. The lock is a folder; one
# older than 20 minutes is a run that died, and is taken over.
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HERE/.work"
LOCK=$HERE/.work/test-lock
until mkdir "$LOCK" 2>/dev/null; do
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi
  sleep 5
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
cd "${1:?plugin folder}" || exit 2
nice -n 10 perl -e 'alarm 900; exec @ARGV' "${2:-claude}" plugin test .
