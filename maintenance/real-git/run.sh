#!/bin/zsh
# Author: David Matura
#
# run.sh <plugin folder> <name> [case sets…]: the case sets (cases/*.sh, all but deps-yarn-pnp unless named) against
# a copy of that plugin, one after another at low priority. Every run works in .work/real-git/run (the plugin in
# plugin/, the harness in harness/, every throwaway repository under git/), so two runs print the same paths; each
# set's output is kept in .work/real-git/<name>/<set>.txt. Compare two names with compare.py.
here=${0:a:h}
dir=${1:?plugin folder}; name=${2:?name for this run}; shift 2
all=($here/cases/*.sh(N:t:r))
sets=($@)
(( $#sets )) || sets=(${all:#(lib|probe-*|deps-yarn-pnp)})
export H=${here:h}/.work/real-git/run CASES=$here/cases
out=${here:h}/.work/real-git/$name
[[ -d $H ]] && chmod -R u+w $H
rm -rf $H $out && mkdir -p $H/git $out
# A read-only source would make a copy the next run can't clear.
rsync -a --delete --exclude node_modules --exclude '*.test.ts' --exclude '*.test.tsx' $dir/ $H/plugin/ && chmod -R u+w $H/plugin
cp -R $here/harness $H/harness
for set in $sets; do
  nice -n 10 bash $CASES/$set.sh > $out/$set.txt 2>&1
  echo "$set: $(grep -c '^===' $out/$set.txt) cases"
done
