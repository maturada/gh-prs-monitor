#!/bin/bash
# Author: David Matura
#
# Throwaway-repository helpers for the cases. Only ever touches folders under $CASE_GIT (the run's git/ folder).
export GIT_AUTHOR_NAME=n GIT_AUTHOR_EMAIL=a@b GIT_COMMITTER_NAME=n GIT_COMMITTER_EMAIL=a@b
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
CASE_GIT=$H/git
# scenario NAME 'teammate change on feature (from main)' 'person prepare (on main)' ['base change on main before branching']
scenario() {
  local name=$1 change=$2 prepare=$3 base=${4:-true}
  local root=$CASE_GIT/$name
  rm -rf "$root"; mkdir -p "$root"; cd "$root" || return 1
  git init -q --bare -b main acme/app.git
  git clone -q acme/app.git teammate 2>/dev/null
  (cd teammate && echo seed > seed.txt && sh -c "$base" && git add -A && git commit -q -m init && git push -q origin main \
    && git checkout -q -b feature && sh -c "$change" && git add -A && git commit -q -m change && git push -q origin feature) || { echo "teammate setup failed"; return 1; }
  (cd acme/app.git && git update-ref refs/pull/7/head refs/heads/feature)
  git clone -q acme/app.git person 2>/dev/null
  (cd person && sh -c "$prepare") || { echo "person setup failed"; return 1; }
  echo "$root/person"
}
# snapshot of every file under a folder except .git: path and content hash
snap() { (cd "$1" && find . -path ./.git -prune -o \( -type f -o -type l \) -print | sort | while read -r f; do printf '%s %s\n' "$f" "$(cat "$f" 2>/dev/null | shasum | cut -c1-8)"; done); }
