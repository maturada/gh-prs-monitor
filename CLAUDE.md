# CLAUDE.md

Working notes for an agent in this repository. The docs below hold the detail; read the one a task touches first.

## What is where

- `gh-prs-monitor/`: the Claude Code plugin, the only folder an install copies. Its README is also the listing in
  Anthropic's directory.
- `maintenance/`: the checks and the heavier tools, and what CI and the release do by themselves.
- `.claude-plugin/marketplace.json`: this repository as a marketplace listing the plugin.
- `.github/`: CI, the pull request check, the issue forms and the pull request template.

## Read first

- [CONTRIBUTING.md](CONTRIBUTING.md): how a change is proposed (an issue first, a `feature/` or `fix/` branch, a pull
  request that says what and why and links its issue), the checks, and how a release works.
- [gh-prs-monitor/docs/development.md](gh-prs-monitor/docs/development.md): the code's structure (every call into the
  engine lives in `hooks/register.tsx`; the other modules take hosts of plain functions), the file map, and what the
  code relies on in Claude Code.
- [maintenance/README.md](maintenance/README.md): which tool to run for which change, and the automation.

## Checks

`maintenance/check.sh` runs validation, Prettier, the suite and TypeScript; run it after every change. TypeScript needs
the engine types, which `claude --plugin-dir gh-prs-monitor` writes once from an interactive session. A fix comes with
a test that fails without it; a change to refreshing, the store, or anything that runs git gets the deeper tools in
`maintenance/README.md`.

## Rules that are easy to break

- Edit `gh-prs-monitor/README.md`, never the root `README.md`, then run `python3 maintenance/readme.py`.
- The plugin's README stays plain Markdown with Markdown images: the directory listing shows it.
- Every change to `gh-prs-monitor/` is a release: `version` in `plugin.json` raised and a CHANGELOG section added.
- Nothing in the plugin folder runs `npx` or another package launcher, and it has no `package.json`; files there
  other than images stay under 256 KiB, and every file under 5 MiB.
- `gh-prs-monitor/.claude-plugin/types/` is written by the engine and ignored by git.
- Screenshots and examples show `/prs demo` data or made-up people and repositories only.
- Commits, pull requests and docs credit no assistant or tool as an author.
