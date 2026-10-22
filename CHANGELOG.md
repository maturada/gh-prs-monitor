# Changelog

Each version of gh-prs-monitor, newest first. Versions follow [semantic versioning](https://semver.org).

## 1.4.0 (22.10.2026)

- **Request Review**: on your own pull requests nobody was asked to review, or that need more approvals, the pane offers
  the people GitHub suggests, those who last changed the code they touch, a moment after the list loads, from one small
  request to GitHub after each refresh, once per pull request and commit. Pick them in its dialog, each a button, with
  Select All and Clear, and Request Review asks them on GitHub after one more look at the pull request as it stands now.
  It is the row's main button while the pull request waits for review or for more approvals.
  [Request Review](gh-prs-monitor/docs/actions.md#request-review)
- **Create PR** asks, when nobody is named as a reviewer, whether to request a review from up to three people who last
  changed the files, or someone else.
- **`/prs demo`** shows Request Review on #1239, a pull request just opened that nobody was asked to review.
- **Create PR on a branch behind its base** summed up what the base changed since as if the pull request changed it
  (594 files where the branch changed 16, three commits behind); it now reads the branch's own changes, from where it
  left its base.

## 1.3.0 (21.10.2026)

- **Ticket links**: paste a link to any ticket with `/prs tickets`, once per repository, and each pull request whose
  branch or title names its key shows its ticket first in its details, as `WEB-5785 ⧉`, linked to Linear, Jira,
  YouTrack, Shortcut, Azure Boards or whichever tracker you use. The link is read on your machine; nothing is sent
  anywhere. **Ticket links on rows** in `/config` takes them off the rows.
  [Ticket links](gh-prs-monitor/docs/tickets.md)
- **Create PR** writes the ticket where your repository writes one: the key in the title only where its titles carry
  keys, `Ticket: WEB-5785` with its link in the body, the key alone where the repository isn't private, and never a
  word that would close the ticket at merge. Where ticket links aren't set up and the branch names a key, the preview
  asks once, and a link pasted there is kept only once you save it in a dialog that shows what it would link.
- **Review** names the ticket in its overview and, with a tool for your tracker already connected to Claude Code,
  reads it once to tell you, for you alone, where the change seems to miss or go beyond it. The skills are told to
  post a ticket's key and link at most, never what it says.
- **`/prs demo`** shows example tickets, and its #1235 says how to set them up.
- **The dialog** puts the keyboard in its field where a question asks for a link, names what its Enter does beside it
  (`↵Check`, as the Check the link button does), and in the mobile app, which draws no field, says to answer on the
  computer.
- **The Alerts as system notifications setting** says what it does in fewer words.
- **`/prs` as a session's first prompt with nothing attached** (a `claude -p` run, or the desktop app before its window
  joins) printed "No pull requests loaded yet." while the session's first list was still loading; it now waits for that
  list and prints it.

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
