#!/bin/bash
# Author: David Matura
#
# The folders a repository is cloned in: what a session notes (its main checkout, from a worktree too) and what a visit
# offers, a folder whose own git config names the repository, read as a file: deleted, moved, pointed elsewhere, an SSH
# alias, a fork set to its upstream, a worktree, no repository. Only touches folders under $CASE_GIT.
. "$CASES/lib.sh"
p=$(scenario clones 'echo f > f.txt' 'git remote set-url origin https://github.com/acme/app.git' | tail -1)
root=${p%/person}
note() { (cd $H && bun run harness/clones.ts note "$1" 2>&1 | tail -1 | sed "s|$root/||g"); }
check() { (cd $H && bun run harness/clones.ts check "$1" "${2:-acme/app}" 2>&1 | tail -1 | sed "s|$root/||g"); }
git -C "$p" worktree add -q .claude/worktrees/pr-7 -b pr-7 2>/dev/null

echo "=== a session in the clone notes it: person"
note "$p"
echo "=== a session in its worktree notes the main checkout: person"
note "$p/.claude/worktrees/pr-7"
echo "=== the clone, its origin on GitHub: offered"
check "$p"
echo "=== asked for another repository: not offered"
check "$p" acme/other
echo "=== a worktree's folder, whose .git is a file: not offered"
check "$p/.claude/worktrees/pr-7"
typed() { (cd $H && bun run harness/clones.ts folder "$1" 2>&1 | tail -1 | sed "s|$root/||g"); }
echo "=== typed: the clone's folder: acme/app"
typed "$p"
echo "=== typed: its worktree: acme/app, from the main checkout's config"
typed "$p/.claude/worktrees/pr-7"
mkdir -p "$p/src/app"
echo "=== typed: a folder inside it: acme/app"
typed "$p/src/app"
echo "=== typed: with a trailing slash: acme/app"
typed "$p/"

cp -R "$p" "$root/moved"
echo "=== moved: offered where it is now"
check "$root/moved"
rm -rf "$root/moved"
echo "=== deleted: not offered"
check "$root/moved"

git -C "$p" remote set-url origin https://github.com/acme/other.git
echo "=== its origin pointed at another repository: not offered"
check "$p"

git -C "$p" remote set-url origin git@github-work:acme/app.git
echo "=== an SSH alias remote: offered"
check "$p"

git -C "$p" remote set-url origin https://github.com/bob/app.git
git -C "$p" remote add upstream git@github.com:acme/app.git
git -C "$p" config remote.upstream.gh-resolved base
echo "=== a fork, its upstream set as gh's default: offered"
check "$p"
echo "=== typed: a fork: gh's default first: acme/app, then bob/app"
typed "$p"
git -C "$p" config --unset remote.upstream.gh-resolved
echo "=== typed: a fork with no default: upstream first, as gh picks: acme/app, then bob/app"
typed "$p"
git -C "$p" config remote.origin.gh-resolved base
echo "=== typed: its origin set as gh's default: bob/app, then acme/app"
typed "$p"

mkdir -p "$root/plain" && echo x > "$root/plain/file"
echo "=== a folder that is no repository: not offered"
check "$root/plain"
