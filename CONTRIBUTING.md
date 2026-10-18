# Contributing

Thanks for helping make gh-prs-monitor better. This page covers reporting a problem, proposing a change, and working on
the code.

## Report a bug or suggest an idea

Open an [issue](https://github.com/maturada/gh-prs-monitor/issues/new/choose) with the bug report or the idea form. In
Claude Code, `/prs report` opens one with your versions filled in. A security problem goes privately, as
[SECURITY.md](SECURITY.md) says, never in a public issue.

## Propose a change

1. **Start with an issue** for anything beyond a small fix such as a typo, a broken link or a one-line bug fix. Say
   what you'd change and why, and wait for the maintainer's go before you build it, so your time goes into a change
   that will land.
2. **Fork, and work on a branch named `feature/<what>` or `fix/<what>`**, lowercase with hyphens, such as
   `fix/cache-key-per-host`. One change per branch.
3. **Open a pull request** against `main`, with **Allow edits by maintainers** left on. Its description says what
   changes and why, and links its issue on a line of its own: `Closes #12` (or `Fixes`, `Resolves`) when it resolves
   it, `Refs #12` when it is part of it, or `No issue:` and why for a small fix. The template lists what to check, and
   the `conventions` check confirms the branch name and the description.
4. **CI runs** once the maintainer approves the run, as GitHub holds every run from an outside contributor until
   then. `check` and `conventions` must pass.
5. **The maintainer reviews and merges.** They may push small fixes to your branch, raise the version and add the
   CHANGELOG line, bring the branch up to date with `main`, then squash-merge once every check passes. Only the
   maintainer merges.

Leave `version` and CHANGELOG.md to the maintainer: the `version` check on your pull request shows what they still have
to add.

## Work on it

Clone your fork, and start Claude Code from its root with the plugin folder loaded:

```
claude --plugin-dir gh-prs-monitor
```

That session runs your copy in place of an installed one; `/reload-plugins` reads an edit, and `/prs demo` shows every
status without a GitHub repository. You need Claude Code, `gh`, git and Node (for `npx`); the deeper checks also need
Python 3, zsh, rsync and [Bun](https://bun.sh).

[`gh-prs-monitor/docs/development.md`](gh-prs-monitor/docs/development.md) explains the code: the file map, how the
hooks module and the other modules share the work, and what the code relies on in Claude Code.

```
.claude-plugin/marketplace.json   this repository as a marketplace, listing the plugin
gh-prs-monitor/                   the plugin: the folder an install copies into Claude Code's plugin cache
maintenance/                      the checks, and the heavier tools for a change before a release
.github/                          CI, the release, and the issue and pull request templates
```

## Checks every change passes

`maintenance/check.sh` runs them: `claude plugin validate`, Prettier, the test suite (`claude plugin test`) and
TypeScript. TypeScript reads the engine's types, which only an interactive session writes, so start
`claude --plugin-dir gh-prs-monitor` once first. CI runs the same, but TypeScript, and checks that the README copy is
current.

## Deeper checks, for the changes that need them

The suite answers git and GitHub with stand-ins. These tools run the plugin's own code further, and
[maintenance/README.md](maintenance/README.md) has their commands:

| A change to | Run |
|---|---|
| Any fix | a test that fails without it, and `mutate.py`: each mutant of the fixed lines must be caught |
| Refreshing, sharing between sessions, or the store | the simulator: many sessions over one store and one GitHub, for hours of simulated time |
| Anything that runs git: checkouts, worktrees, copies, cleanup, the skills' git commands | the real-git cases, on throwaway repositories |
| A refactor, or behaviour you mean to change | H8: the version before and yours, event by event, over 1,125 random sessions |
| Anything, before a release | `test-engines.sh`: the suite on every Claude Code version installed |

Say in the pull request which you ran and what they showed.

## Code and docs

- Prettier, as `gh-prs-monitor/.prettierrc.json` sets it: 120 columns, no semicolons, double quotes, no trailing
  commas. `npx --yes prettier@3.8.3 --write .` in `gh-prs-monitor/` formats.
- Tests sit next to the code they test (`hooks/*.test.ts`, `hooks/*.test.tsx`), and assert the whole result.
- Comments say why, where the code can't; they don't narrate a change.
- A new file starts with its author: `// Author: <your name>`, or `# Author: <your name>` in Python and shell.
- `gh-prs-monitor/README.md` and `gh-prs-monitor/docs/` are what people read, and change with the code. The README at
  the repository's root is made from the plugin's by `python3 maintenance/readme.py`: edit the plugin's, then run it.

## Releases

`main` is what people install: the marketplace serves the plugin folder as it is on `main`, and Claude Code updates an
install when `version` in `gh-prs-monitor/.claude-plugin/plugin.json` changes. So every change to the plugin folder is
a release, and before merging one the maintainer:

1. raises `version`, following [semantic versioning](https://semver.org), and adds the version's section to
   [CHANGELOG.md](CHANGELOG.md), which the `version` check confirms;
2. merges it; once CI passes on `main`, the release job tags `v<version>` and publishes a GitHub release with that
   section as its notes.

A change outside the plugin folder (the maintenance tools, CI, the files at the root) needs no new version.

What CI, the release job, the repository's rules and Anthropic's directory do by themselves:
[maintenance/README.md](maintenance/README.md#what-runs-by-itself).
