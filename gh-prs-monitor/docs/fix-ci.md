# Fix CI

A red check on your pull request? **Fix CI** reads the failing checks' logs, tells a flaky failure from a real one,
and fixes the ones you pick. It commits and pushes on your yes, which starts the checks again.

It shows on your own pull requests whose CI fails, drafts included. The button shows whatever your access to the
repository, even where you can't push, as the skill works on a local copy; its push goes only to the pull request's own
branch, and only where you may push. While it runs, its row says so: see
[While a skill is at work](actions.md#while-a-skill-is-at-work).

## Fix CI or Re-Run CI

Where **Re-Run CI** shows too, that is the main button, as a re-run is the first thing to try on a check that failed
for no reason in the code ([Re-running CI](actions.md#re-running-ci)). Elsewhere Fix CI is. A draft's main button is
Ready For Review, and a row with conflicts has Resolve Conflicts.

## Where it works

It asks where to work, with the same choices as Resolve Comments: see
[Where the branch skills work](working-on-a-branch.md). On a pull request of
[another repository](other-repositories.md) it offers to open a new session in a clone of that repository instead:
see [Buttons on its rows](other-repositories.md#buttons-on-its-rows).

## Typed

Type it as `/gh-prs-monitor:fix-ci [<number or URL>] [-- <instructions>]`; without a number or URL it takes the pull
request of the current branch. The pane adds `--worktree "<path>"` and `--deps "<note>"` itself.

## What it does

The work itself is the bundled `fix-ci` skill:

- It reads each failing check: a GitHub Actions job's log, from the step that failed, or what another service's check
  says of itself. It finds the first error and the command that ran it, and compares them with what the pull request
  changes.
- It sorts each failure: needs a fix in the code; flaky, only on evidence (an infrastructure error, or an earlier
  attempt that ran the same code and passed); the same failure on the base branch; not the code (a secret, a
  permission or an approval the run lacked); already fixed by your local work; or can't tell. One cause behind
  several checks is one finding.
- It runs the failing command locally where it safely can, taken from the workflow file, with only the values CI filled
  in (a matrix entry, an environment variable) read from the log, and writes no tracked file before your yes. It says
  when that is not what CI ran: your changes on top, or a base CI merged in that your checkout lacks. On someone else's
  pull request it runs nothing of theirs unless you say so.
- It fixes only the findings you pick, at their cause: no skipped tests or silenced checks unless you ask.

### Committing and pushing

A checkout behind GitHub's is handled as Resolve Comments does
([details](working-on-a-branch.md#a-checkout-behind-githubs)). Then it shows the commit, its whole message, its files
and where it pushes. On your yes it commits and pushes, which starts the checks again; or commits only, or leaves the
changes unstaged. It pushes by force only if you ask.

Only the files it changed go in: changes you had before, staged or not, stay out, and a file holding both is asked
about.

It re-runs no check itself and posts nothing: a flaky check's re-run is yours, with **Re-Run CI** or the command it
gives.

## Where to go next

- [Acting on GitHub](actions.md): **Re-Run CI** and the other buttons.
- [Where the branch skills work](working-on-a-branch.md): the worktree, dependencies and cleanup.
- [Resolve Comments](resolve-comments.md) and [Resolve Conflicts](resolve-conflicts.md): the other two branch skills.
- [When something is wrong](troubleshooting.md).

