# Changelog

Each version of gh-prs-monitor, newest first. Versions follow [semantic versioning](https://semver.org).

## 1.0.0 (18.10.2026)

The first public release.

- **`/prs`** opens a pane with your open pull requests and the ones waiting on your review, each with the one status
  that matters and what needs you first, and a compact view. `/prs demo` shows one of each status with example data.
- **Alerts** when one of yours can merge, gets a review, comments, a failing check or conflicts, when you are asked to
  review, when a pull request you reviewed gets new commits, when someone mentions you, and when someone else merges or
  closes one. A summary in the status line, or above the prompt in the desktop app.
- **Buttons** for Merge (stacked pull requests too), Auto-Merge, Update Branch, Re-Run CI, Ready For Review and
  Re-Request Review, each looking at the pull request as it stands on GitHub and asking before it writes.
- **Skills**: Resolve Comments, Fix CI, Resolve Conflicts, Review and Create PR, run here, in a worktree, or in a new
  session. Worktrees get their dependencies and the files `.worktreeinclude` names, and go once their pull request is
  merged or closed, when nothing in them would be lost.
- **`/prs report`** links a bug report with your versions filled in, an idea, and the issues already open.
- **Refreshes** in the background, while the pane is open, or on demand, shared between the sessions in a repository.
- Works in the terminal and the desktop app, against github.com and GitHub Enterprise Server 3.16 or later.
