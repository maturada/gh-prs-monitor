#!/bin/bash
# Author: David Matura
#
# A submodule entry over an ignored folder.
. "$CASES/probe-switch.sh"
same submodule-over-ignored-dir 'mkdir -p lib/sub; git update-index --add --cacheinfo 160000,1111111111111111111111111111111111111111,lib/sub' 'echo /lib/ >> .git/info/exclude; mkdir -p lib/sub; echo mine > lib/sub/local.txt'
