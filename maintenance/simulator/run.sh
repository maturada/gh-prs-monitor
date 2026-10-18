#!/bin/zsh
# Author: David Matura
#
# run.sh <plugin folder> <name> [worlds…]: every world (or those named), sharing on and off, 100 seeds each, one after
# another at low priority, against a copy of that plugin folder. Results land in .work/sim/<name>/results, one file per
# world and mode; compare two names with compare.py. The simulator imports the plugin's own refresh, store and session
# code, so the copy sits where sim/world.ts imports it from (../C).
here=${0:a:h}
dir=${1:?plugin folder}; name=${2:?name for this run}; shift 2
worlds=($@)
(( $#worlds )) || worlds=(random aligned near people wake slow looks slowstore flavors dups life exact closed dups-mid leave life2 slowclosed throws holds skew)
out=$here/../.work/sim/$name
[[ -d $out ]] && chmod -R u+w $out
rm -rf $out && mkdir -p $out/results $out/sim
# A read-only source would make a copy the next run can't clear.
rsync -a --delete --exclude node_modules $dir/ $out/C/ && chmod -R u+w $out/C
cp $here/sim/*.ts $out/sim/
cd $out/sim
for world in $worlds; do
  for mode in on off; do
    nice -n 10 bun batch.ts $world 100 $mode > ../results/$world-$mode.txt 2>&1
    echo "$world $mode: $(grep -c '^{' ../results/$world-$mode.txt) rows"
  done
done
