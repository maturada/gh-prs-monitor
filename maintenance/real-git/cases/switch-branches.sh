#!/bin/bash
# Author: David Matura
#
# Local branches gh would take, tracked changes, forks' upstreams, no remote.
. "$CASES/probe-switch.sh"
TWO_ENV='echo API=old > .env && git add -f .env && git commit -qm one && git rm -q --cached .env && rm .env && echo code > menu.ts'
TWO='echo a > a.txt && git add a.txt && git commit -qm one && echo code > menu.ts'
# an older local branch of the head's name whose commit tracked .env, which the person keeps ignored
same b-older-local-tracks-env "$TWO_ENV" 'echo .env >> .git/info/exclude; git branch -q feature origin/feature~1; echo API=mine > .env'
# the local branch of the head's name went its own way: pr-7, the branch untouched
same b-local-diverged "$TWO" 'git checkout -q -b feature origin/feature~1 && echo m > mine.txt && git add mine.txt && git commit -qm mine && git checkout -q main'
# the head's name held by another worktree: pr-7
same b-held "$TWO" 'git worktree add -q ../wt-held -b feature origin/feature~1'
# an uncommitted change to a file the PR changes: git refuses; one to a file it doesn't: carried
same b-change-in-the-way 'echo team > s2.txt' 'echo mine > s2.txt' 'echo base > s2.txt'
same b-change-carried 'echo code > menu.ts' 'echo mine > s2.txt' 'echo base > s2.txt'
# already on the head's name, behind; and one with an upstream of its own, kept
same b-on-feature-behind "$TWO" 'git checkout -q -b feature origin/feature~1'
same b-custom-upstream "$TWO" 'git branch -q feature origin/feature~1 && git config branch.feature.remote origin && git config branch.feature.merge refs/heads/custom'
# no remote names the repository (renamed): gh's address, rewritten here to the local origin
same b-no-remote 'echo code > menu.ts' 'git remote rename origin old && git remote set-url old /nonexistent/acme/old.git && git config "url.$(cd .. && pwd)/acme/app.git.insteadOf" https://github.com/acme/app.git'
# a case-only name: the branch adds Config.json where the person keeps config.json ignored (APFS folds case)
same b-case-only 'echo team > Config.json' 'echo config.json >> .git/info/exclude; echo mine > config.json'
# forks: pr-7 behind, pr-7 gone its own way, the fork's upstream with and without maintainers' pushes, fork gone
fork b-fork-pr-behind "$TWO" 'git fetch -q origin refs/pull/7/head && git branch -q pr-7 FETCH_HEAD~1'
fork b-fork-pr-diverged "$TWO" 'git fetch -q origin refs/pull/7/head && git checkout -q -b pr-7 FETCH_HEAD~1 && echo m > m.txt && git add m.txt && git commit -qm m && git checkout -q main'
PLUGIN_ENV=CAN_MODIFY=1 fork b-fork-can-modify 'echo code > menu.ts' 'true'
fork b-fork-cannot-modify 'echo code > menu.ts' 'true'
PLUGIN_ENV=FORK_GONE=1 fork b-fork-gone 'echo code > menu.ts' 'true'
fork b-fork-own-remote 'echo code > menu.ts' 'true' upstream
