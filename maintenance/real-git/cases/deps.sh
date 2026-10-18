#!/bin/bash
# Author: David Matura
#
# The projects and installs ensureDependencies finds in a monorepo worktree (installs faked with FAKE=1).
. "$CASES/lib.sh"
D=$CASE_GIT/mono; rm -rf $D; mkdir -p $D; cd $D; git init -q -b main
mk() { mkdir -p "$(dirname "$1")"; echo "${2:-x}" > "$1"; }
mk package.json '{}'; mk pnpm-lock.yaml; mk .gitignore "node_modules/
.venv/
.dart_tool/
Pods/
vendor/"
mk apps/web/package-lock.json; mk apps/web/package.json '{}'
mk apps/mobile/pubspec.yaml "dependencies:
  flutter:
    sdk: flutter"; mk apps/mobile/pubspec.lock
mk apps/mobile/ios/Podfile; mk apps/mobile/ios/Podfile.lock
mk apps/mobile/android/gradlew; mk apps/mobile/android/settings.gradle
mk services/api/uv.lock; mk services/api/pyproject.toml
mk services/rb/Gemfile.lock; mk services/php/composer.lock; mk services/go/go.mod
mk services/cs/packages.lock.json; mk tools/x/y/z/package-lock.json
mk examples/demo/package-lock.json; mk node_modules/foo/package-lock.json
mk docs/site/yarn.lock; mk apps/desk/yarn.lock; mk apps/desk/.yarnrc.yml
git add -A; git add -f node_modules/foo/package-lock.json; git commit -qm init
echo "=== projects"; (cd $H && bun run harness/probe.ts projects $D | tr -d '\n' | sed 's/  */ /g'; echo)
echo "=== deps (first)"; (cd $H && FAKE=1 bun run harness/probe.ts deps $D)
echo "=== markers written: $(cd $D && find . -name .gh-prs-monitor-lock | sort | tr '\n' ' ')"
echo "=== deps (again)"; (cd $H && FAKE=1 bun run harness/probe.ts deps $D | sed -n 1,3p)
