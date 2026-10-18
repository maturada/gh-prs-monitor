#!/bin/bash
# Author: David Matura
#
# A local branch of the head's name ahead of GitHub's: taken as it is, its own commit kept.
. "$CASES/probe-switch.sh"
same b-local-ahead 'echo code > menu.ts' 'git checkout -q -b feature origin/feature && echo m > mine.txt && git add mine.txt && git commit -qm mine && git checkout -q main'
same b-local-ahead-env 'echo code > menu.ts' 'echo .env >> .git/info/exclude; git checkout -q -b feature origin/feature && echo API=old > .env && git add -f .env && git commit -qm "track env" && git checkout -q main && echo API=mine > .env'
