# Maintenance: the tools that check gh-prs-monitor

`check.sh` runs the checks every change to the plugin passes: `claude plugin validate`, Prettier, the test suite and
TypeScript. The rest of this folder holds the heavier tools used before a release, to show that a change does what
it means and nothing else. None of it is part of the plugin, and the plugin's install never copies it.

Run everything from the repository root. The tools work in `maintenance/.work/` (ignored by git). H8, the simulator
and real-git copy the plugin folder they are given before they run it; the test runners run the suite in place, and
`mutate.py` takes a copy you make (below).

| Tool | What it shows | When |
|---|---|---|
| `test-one.sh <plugin>` | the suite, at low priority, one run at a time on this machine | instead of a bare `claude plugin test` while other tools run |
| `test-engines.sh <plugin>` | the suite on every Claude Code version installed here | before a release |
| `mutate.py` | that the tests catch a change to the lines that matter | after a fix: each mutant must be CAUGHT |
| `checks/` | import cycles, names engines before 2.1.292 refuse, the engine's view of the plugin, test names kept | after a refactor |
| [`h8/`](h8/README.md) | two versions' behaviour, event by event, over 1,125 random sessions | a refactor must show none; a fix only its own |
| [`simulator/`](simulator/README.md) | many sessions over one store and one GitHub, for hours: races, duplicate alerts, stale lists | after changing refresh, sharing or the store |
| [`real-git/`](real-git/README.md) | checkouts, worktrees, copies, cleanup and the skills' git commands on real repositories | after changing anything that runs git |
| `check.sh` | validation, Prettier, the suite and TypeScript | every change |
| `readme.py [--check]` | the README at the repository's root, made from the plugin's | after editing `gh-prs-monitor/README.md`; CI checks it |
| `version-check.py <base>` | that a change to the plugin raises its version and gives it a CHANGELOG section | CI, on pull requests |
| `pr-check.py` | a pull request's branch name and description | CI, on pull requests |
| `release-notes.py <version>` | a version's CHANGELOG section, the notes of its GitHub release | the release job |
| [`screenshots/`](screenshots/README.md) | the README's pictures: how to shoot and cut a screenshot, and the card that holds it | when the UI changes |

Needs Claude Code, git, Python 3, zsh, rsync and perl (macOS has the last three), and for the simulator and
real-git [Bun](https://bun.sh).

## Mutations

```
rsync -a gh-prs-monitor/ maintenance/.work/mutants/
MUTATE_DIR=maintenance/.work/mutants python3 maintenance/mutate.py mutants.json
```

`mutants.json` lists `[file in the plugin, text, replacement]` entries: the condition just fixed turned back, a check
removed, a boundary moved. The text must occur once. `mutate.py` refuses to run without `MUTATE_DIR`, or with it
pointing at the plugin itself or at an installed copy, as a run cut short leaves its last mutant in place.

## The checks

```
python3 maintenance/checks/cycles.py gh-prs-monitor/hooks
python3 maintenance/checks/dollar-names.py gh-prs-monitor/hooks/register.tsx
python3 maintenance/checks/engine-view.py <before> <after>     # claude plugin validate --json, compared
zsh maintenance/checks/test-names.sh <before> <after>          # every test that passed before still passes
```

Clean is: `no cycles`; `no name declared again`; `engine's view: identical` (for a refactor); nothing under
`missing after:`.

## Before a release

1. `maintenance/check.sh`, and `zsh maintenance/test-engines.sh gh-prs-monitor`.
2. For each fix: a test that fails without it, and its mutants caught.
3. H8 between the last release and now: every difference explained by a change meant.
4. The simulator and real-git, between the last release and now, when the change touches what they run.
5. `version` raised in `gh-prs-monitor/.claude-plugin/plugin.json` and its section in `CHANGELOG.md`, in the pull
   request; once it is merged, CI tags and publishes the release (see `CONTRIBUTING.md`).

Each release is a tag, so `git worktree add maintenance/.work/before v<version>` gives H8, the simulator and real-git
the version before, in `maintenance/.work/before/gh-prs-monitor`.

## What runs by itself

### GitHub Actions

| Workflow, job | Runs on | What it does |
|---|---|---|
| `ci.yml`, `check` | every push to `main`, every pull request | `claude plugin validate --strict` on the marketplace and the plugin, Prettier, the suite (`claude plugin test`), and `readme.py --check`. TypeScript stays with `check.sh`, as only an interactive session writes the engine types it reads |
| `ci.yml`, `version` | pull requests | `version-check.py`: a change to the plugin folder raises `version` to a higher semantic version and gives it a CHANGELOG section. Its own job, so a contributor's `check` passes while the maintainer still has the version to set |
| `ci.yml`, `release` | a push to `main`, after `check` passes | Tags `v<version>` and publishes a GitHub release with that version's CHANGELOG section, once per version, one run at a time. Fails when the plugin folder changed since a version already out, as installs would never get that change |
| `pull-request.yml`, `conventions` | a pull request opened, edited or updated | `pr-check.py`: a `feature/` or `fix/` branch, a description that says what and why, and its issue linked (`Closes #12`, `Fixes #12`, `Resolves #12`, `Refs #12`, or the issue's URL after one of those words) or `No issue:` and why. Dependabot's pull requests, told by their author, are left to it |
| Dependabot | monthly | A pull request raising the GitHub Actions the workflows pin by commit |

The workflows hold `contents: read` but the release job, which writes the tag and the release. The Claude Code CLI is
pinned in `ci.yml`; raise it with the versions the README says the plugin is tested on.

A pull request runs its own copy of the workflows and of `maintenance/`, so one that changes `.github/` or
`maintenance/` can change its own checks: such a change is proved by reading it, not by its checks passing.

### The repository's rules

- Only the maintainer has write access, so only they merge. GitHub asks them to review each pull request, as the code
  owner (`.github/CODEOWNERS`); merging is their approval.
- `main` takes changes through pull requests alone, for everyone, the maintainer too (a ruleset with no bypass):
  `check`, `version` and `conventions` must pass on the branch brought up to date with `main` (**Update branch** when
  `main` has moved, so what merges is what was tested), conversations must be resolved, merges are squashed, and
  `main` can't be deleted or force-pushed. The ruleset itself is the maintainer's to change, in the repository's
  settings.
- Anyone can open an issue, through the forms in `.github/ISSUE_TEMPLATE/`, and a pull request from a fork. GitHub holds
  every workflow run from an outside contributor until the maintainer approves it.
- Private vulnerability reporting is on (`SECURITY.md`).

### Anthropic's directory

The directory follows `main` of this repository, with the plugin path `gh-prs-monitor`. A GitHub push webhook, set up
from the developer portal (claude.ai/directory/manage), tells it of each push, and it also checks on a schedule; each
new commit is validated and scanned as a new version, with nothing submitted again by hand. A version a reviewer has
cleared goes live by itself with **Auto-publish passing versions** on, once Anthropic allows it for the plugin, or when
the maintainer presses **Publish** in the portal. Two things here are held for a reviewer by the directory's rules,
version after version: the alert sound, `sounds/alert.wav` (a file that is neither text nor an image), and the hooks
module that runs from a plugin folder below the repository's root. So expect each version to wait for a person before it
goes live.
