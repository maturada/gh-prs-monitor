#!/bin/zsh
# Author: David Matura
#
# test-names.sh <before folder> <after folder>: every test the before tree passes must pass, by its full name, after.
# Prints the names only the after tree has (a change's new tests) and any the before tree had that are missing.
here=${0:a:h}
work=$here/../.work/test-names; mkdir -p $work
for side in before after; do
  dir=$1; [[ $side == after ]] && dir=$2
  bash $here/../test-one.sh $dir 2>&1 | grep '^(pass)' | sed 's/ \[[0-9.]*ms\]$//' | sort > $work/$side.txt
done
echo "before $(wc -l < $work/before.txt) pass; after $(wc -l < $work/after.txt) pass"
echo "missing after:"; comm -23 $work/before.txt $work/after.txt
echo "new after:"; comm -13 $work/before.txt $work/after.txt
