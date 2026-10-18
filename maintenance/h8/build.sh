#!/bin/zsh
# Author: David Matura
#
# build.sh <B folder> <C folder> [variants…]: two harness copies in .work/h8, B (the version before) and C (the one
# after), each the plugin without its tests, the trace inserted into its test machine (trace-world.py, which fails when
# a handler it anchors on is gone), and one scenario file per variant (scn.tmpl). Variants default to the usual set.
here=${0:a:h}; out=$here/../.work/h8
b=${1:?B folder}; c=${2:?C folder}; shift 2
variants=($@)
(( $#variants )) || variants=(N LYMW LSPW LXAW LOW)
[[ -d $out ]] && chmod -R u+w $out
rm -rf $out && mkdir -p $out
for side in B C; do
  src=$b; [[ $side == C ]] && src=$c
  rsync -a --exclude node_modules $src/ $out/$side/ && chmod -R u+w $out/$side
  find $out/$side/hooks -name '*.test.*' -delete
  cp $here/trace.ts $out/$side/hooks/testing/trace.ts
  python3 $here/trace-world.py $out/$side || exit 1
  for v in $variants; do sed "s/__VARIANT__/$v/" $here/scn.tmpl > $out/$side/hooks/zz-scn-$v.test.tsx; done
done
echo "built B and C in $out with variants: $variants"
