#!/bin/zsh
# Author: David Matura
#
# run.sh: runs the B side, then the C side, built by build.sh, each through test-one.sh; the traces land in
# .work/h8/B.txt and C.txt. About four minutes a side for the usual five variants.
here=${0:a:h}; out=$here/../.work/h8
for side in B C; do
  bash $here/../test-one.sh $out/$side > $out/$side.txt 2>&1
  echo "$side: $(grep -c '^TRACE' $out/$side.txt) events; $(grep -E '^ *[0-9]+ (pass|fail)' $out/$side.txt | tr '\n' ' ')"
done
