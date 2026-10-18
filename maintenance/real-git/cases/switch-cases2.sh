#!/bin/bash
# Author: David Matura
#
# Further switch cases through probe-switch.sh's four probes.
. "$CASES/probe-switch.sh"
same tracked-dir-to-file-deep 'git rm -rq src/conf; mkdir -p src; echo team > src/conf' 'echo "*.local" >> .git/info/exclude; echo mine > src/conf/x.local' 'mkdir -p src/conf; echo app > src/conf/app.json; echo i > src/index.ts'
same tracked-dir-ignored-subfolder 'git rm -rq conf; echo team > conf' 'echo "/conf/cache/" >> .git/info/exclude; mkdir -p conf/cache; echo mine > conf/cache/state' 'mkdir conf; echo app > conf/app.json'
same inside-dir-to-file 'mkdir cache; echo team > cache/db' 'echo /cache/ >> .git/info/exclude; mkdir -p cache/db; echo mine > cache/db/x.json'
same inside-empty-dir-to-file 'mkdir cache; echo team > cache/db' 'echo /cache/ >> .git/info/exclude; mkdir -p cache/db/empty; echo other > cache/keep'
