# Changelog

Each version of gh-prs-monitor, newest first. Versions follow [semantic versioning](https://semver.org).

## 1.0.1 (18.10.2026)

- The README says more of what the plugin does on your machine: the slash commands its buttons run, the Claude Code
  events it follows, the files it reads, writes and removes, the settings it changes, that it reads no credential to
  sign in with, and what its sound and images are for.
- `compact.png` is compressed again, the same to the pixel: by chance its bytes spelled what a check reads as a
  download-and-run command. So are the icon and the README's top screenshot, whose bytes spelled command names.

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
