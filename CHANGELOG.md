# Changelog

Each version of gh-prs-monitor, newest first. Versions follow [semantic versioning](https://semver.org).

## 1.2.0 (20.10.2026)

- **Alerts as system notifications**, a setting off by default: the alerts you turned on also go out as a system
  notification, one each time they show, the way Claude Code sends its own: a banner in iTerm2, kitty or Ghostty, in
  another terminal once you choose Claude Code's notification channel for it (Warp shows them with `iterm2`), or
  through your own `Notification` hook. Pull request changes only, not the summary when a
  session starts nor a cleanup's note. It needs Claude Code 2.1.295; the toasts show either way.
- **Claude Code 2.1.292 or later**, a version earlier than before: the plugin is tested on it.
- **The docs said the desktop app keeps the plugin's store apart; it shares it** with the terminal and VS Code. So
  sessions in every app share their checks of GitHub, show each alert once, and offer the same Create PR choices. Only
  the docs change.
- **Docs that read better**: each page opens with what it does for you and goes on in the order a newcomer asks, and
  the README's "What it runs and what it sends" starts with a short summary. Nothing was dropped.

## 1.1.0 (19.10.2026)

- **VS Code, and editors built on it such as Cursor**: the Claude Code extension draws the pane, its alerts and the
  status line from its version 2.1.299, and the pane now fits it:
  - buttons a little apart and off the edges of their frames, in the pane and its questions, with no blank lines;
  - a long title wraps beside its number, in a narrow pane too;
  - Changes Requested, Review Requested and running checks in yellow, a merge in purple, from the editor's theme;
  - alerts as toasts above the prompt box, not lines left in the conversation;
  - the status line keeps the space between its counts.
- **New session from VS Code**: Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR offer a new session
  there too, a new tab of the editor with the command typed in. Where its link doesn't open, the skill runs in this
  session instead.
- **`#` in the prompt** suggests the pull requests listed, yours first: type `#` and the start of a number, or of a
  word in a title, and pick one to write its number, as `#142`. In the terminal for now: the desktop app and VS Code
  don't ask plugins for suggestions yet.
- **`/prs` from your phone or claude.ai**, over Remote Control: it prints the list in the conversation, as they draw
  no pane yet, and opens the pane on the computer too. `/prs demo` prints the example list and shows the examples on
  the computer.

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
