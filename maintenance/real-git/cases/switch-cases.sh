#!/bin/bash
# Author: David Matura
#
# Switch cases through probe-switch.sh's four probes.
. "$CASES/probe-switch.sh"
OUTSIDE=$CASE_GIT/outside; mkdir -p $OUTSIDE/dir; echo secret > $OUTSIDE/env; echo inner > $OUTSIDE/dir/x
# nested ignored folders / a pattern ignoring a folder at depth
same nest-file-at-depth2 'mkdir -p cache/a/b/c; echo team > cache/a/b/c/d.json' 'echo /cache/ >> .git/info/exclude; mkdir -p cache/a; echo mine > cache/a/b'
same nest-file-at-depth3 'mkdir -p cache/x/y/db; echo team > cache/x/y/db/1.json' 'echo /cache/ >> .git/info/exclude; mkdir -p cache/x/y; echo mine > cache/x/y/db'
same nest-ignored-in-ignored 'mkdir -p cache/tmp; echo team > cache/tmp/secret' 'printf "/cache/\ntmp/\n" >> .git/info/exclude; mkdir -p cache/tmp; echo mine > cache/tmp/secret'
same nest-pattern-at-depth 'mkdir -p src/generated; echo team > src/generated/api.ts' 'echo generated/ >> .git/info/exclude; mkdir -p src/generated; echo mine > src/generated/api.ts' 'mkdir src; echo i > src/index.ts'
same nest-pattern-dir-to-file 'echo team > src/generated' 'echo generated/ >> .git/info/exclude; mkdir -p src/generated; echo mine > src/generated/x.ts' 'mkdir src; echo i > src/index.ts'
same nest-pattern-deep-other 'mkdir -p src/generated/v2; echo team > src/generated/v2/api.ts' 'echo generated/ >> .git/info/exclude; mkdir -p src/generated/v1; echo mine > src/generated/v1/api.ts' 'mkdir src; echo i > src/index.ts'
# a tracked folder holding an ignored file, where the branch has a file or a symlink
same tracked-dir-to-file 'git rm -rq conf; echo team > conf' 'echo "*.local" >> .git/info/exclude; echo mine > conf/x.local' 'mkdir conf; echo app > conf/app.json'
same tracked-dir-to-symlink 'git rm -rq conf; ln -s shared conf' 'echo "*.local" >> .git/info/exclude; echo mine > conf/x.local' 'mkdir conf shared; echo app > conf/app.json; echo s > shared/s'
# symlinks where the branch puts a file or a folder
same symlink-file-at-file 'echo API=team > .env' "echo .env >> .git/info/exclude; ln -s $OUTSIDE/env .env"
same symlink-dir-at-folder 'mkdir data; echo team > data/x.json' "echo /data >> .git/info/exclude; ln -s $OUTSIDE/dir data"
same symlink-in-ignored-at-folder 'mkdir -p cache/link; echo team > cache/link/x' "echo /cache/ >> .git/info/exclude; mkdir cache; ln -s $OUTSIDE/dir cache/link"
same symlink-in-ignored-at-file 'mkdir cache; echo team > cache/link' "echo /cache/ >> .git/info/exclude; mkdir cache; ln -s $OUTSIDE/dir cache/link"
same symlink-in-ignored-deep-folder 'mkdir -p cache/a/link/b; echo team > cache/a/link/b/x' "echo /cache/ >> .git/info/exclude; mkdir -p cache/a; ln -s $OUTSIDE/dir cache/a/link"
# spaces and glob characters inside an ignored folder
same glob-same-path 'mkdir -p "cache/a b"; echo team > "cache/a b/[x]?*:y.json"' 'echo /cache/ >> .git/info/exclude; mkdir -p "cache/a b"; echo mine > "cache/a b/[x]?*:y.json"'
same glob-decoy-only 'mkdir -p "cache/a b"; echo team > "cache/a b/[x]"; echo t2 > "cache/a b/*"' 'echo /cache/ >> .git/info/exclude; mkdir -p "cache/a b"; echo mine > "cache/a b/x"; echo m2 > "cache/a b/y"'
same glob-magic-name 'mkdir -p cache; echo team > "cache/:(top)x"' 'echo /cache/ >> .git/info/exclude; mkdir -p cache; echo mine > "cache/:(top)x"'
same glob-dir-in-the-way 'mkdir -p "cache/[d] ?/x"; echo team > "cache/[d] ?/x/f"' 'echo /cache/ >> .git/info/exclude; mkdir -p "cache/[d] ?"; echo mine > "cache/[d] ?/x"'
# more than 500 written paths
same many-files-last-chunk 'mkdir cache; for i in $(seq -w 1 1200); do echo t$i > cache/f$i.json; done' 'echo /cache/ >> .git/info/exclude; mkdir cache; echo mine > cache/f1150.json'
same many-files-none 'mkdir cache; for i in $(seq -w 1 1200); do echo t$i > cache/f$i.json; done' 'echo /cache/ >> .git/info/exclude; mkdir cache; echo mine > cache/other.json'
same many-dirs-above 'mkdir cache; for i in $(seq -w 1 600); do mkdir -p cache/d$i; echo t > cache/d$i/x; done' 'echo /cache/ >> .git/info/exclude; mkdir cache; echo mine > cache/d590'
# a fork's PR
fork fork-nest-depth2 'mkdir -p cache/a/b/c; echo team > cache/a/b/c/d.json' 'echo /cache/ >> .git/info/exclude; mkdir -p cache/a; echo mine > cache/a/b'
fork fork-tracked-dir-to-file 'git rm -rq seeddir; echo team > seeddir' 'echo "*.local" >> .git/info/exclude; echo mine > seeddir/x.local'
# a branch that deletes a tracked file whose name it then ignores
same delete-tracked-now-ignored-clean 'git rm -q settings.local; echo settings.local >> .gitignore' 'true' 'echo base > settings.local'
same delete-tracked-now-ignored-modified 'git rm -q settings.local; echo settings.local >> .gitignore' 'echo mine > settings.local' 'echo base > settings.local'
same delete-tracked-staged-untrack 'echo team > settings.local' 'echo settings.local >> .git/info/exclude; git rm -q --cached settings.local; echo mine > settings.local' 'echo base > settings.local'
# an ignored folder holding a nested repository where the branch has a file
same nested-repo-at-file 'mkdir vendor; echo team > vendor/lib' 'echo /vendor/ >> .git/info/exclude; mkdir -p vendor/lib; (cd vendor/lib && git init -q && echo w > work.c && git add -A && git commit -qm w && echo wip > wip.c)'
