#!/bin/bash
# Author: David Matura
#
# Ignored files in the way of a switch, same repository and fork, through probe-switch.sh's four probes.
. "$CASES/probe-switch.sh"
same env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env'
same vscode-same 'mkdir .vscode; echo team > .vscode/settings.json' 'echo .vscode/ >> .git/info/exclude; mkdir .vscode; echo mine > .vscode/settings.json'
same vscode-other 'mkdir .vscode; echo team > .vscode/extensions.json' 'echo .vscode/ >> .git/info/exclude; mkdir .vscode; echo mine > .vscode/settings.json'
same file-to-dir 'mkdir config; echo team > config/app.json' 'echo /config >> .git/info/exclude; echo mine > config'
same dir-to-file 'echo team > out' 'echo /out/ >> .git/info/exclude; mkdir out; echo mine > out/x'
same plain-dir-only-ignored 'echo team > gen' 'echo "*.log" >> .git/info/exclude; mkdir gen; echo mine > gen/a.log'
same file-in-ignored-dir-needs-dir 'mkdir -p cache/db; echo team > cache/db/1.json' 'echo /cache/ >> .git/info/exclude; mkdir cache; echo mine > cache/db'
same rename-to-ignored 'git mv template.env .env' 'echo .env >> .git/info/exclude; echo API=mine > .env' 'echo T > template.env'
same deleted-file 'git rm -q old.txt' 'echo .env >> .git/info/exclude; echo mine > .env' 'echo old > old.txt'
same idea-other 'mkdir -p .idea/codeStyles; echo team > .idea/codeStyles/Project.xml' 'echo .idea/ >> .git/info/exclude; mkdir .idea; echo mine > .idea/workspace.xml'
same empty-ignored-dir 'echo team > build' 'echo /build/ >> .git/info/exclude; mkdir build'
same deep-ignored-dir 'mkdir -p a/b; echo team > a/b/c' 'echo "/a/b/" >> .git/info/exclude; mkdir -p a/b; echo mine > a/b/c'
same deep-plain-dir-file 'echo team > a' 'echo "/a/b/" >> .git/info/exclude; mkdir -p a/b; echo mine > a/b/c'
same untracked-plain 'echo team > notes.txt' 'echo mine > notes.txt'
same nm-vendored 'mkdir -p node_modules/x; echo team > node_modules/x/index.js' 'echo node_modules/ >> .git/info/exclude; mkdir -p node_modules/y; echo mine > node_modules/y/i.js'
fork fork-env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env'
fork fork-plain 'echo code > menu.ts' 'echo .env >> .git/info/exclude; echo API=mine > .env'
fork fork-upstream-env 'echo API=team > .env' 'echo .env >> .git/info/exclude; echo API=mine > .env' upstream
