# Privacy

gh-prs-monitor is a Claude Code plugin that runs on your machine. It has no server of its own and collects nothing.

## What it talks to

- **GitHub**: github.com, or your GitHub Enterprise Server, through the GitHub CLI (`gh`) and `git` installed and signed
  in on your machine. Its requests go from your machine to GitHub under your account, as your own `gh` commands would.
  It reads the repository of the folder you run Claude Code in, and any other you ask the pane to show; with
  **Alerts from other repositories** on, or as the repository picker opens, it also searches that GitHub server for
  your open pull requests and those asking your review. The plugin has no token of its own and reads none from your
  environment.
- **Your projects' package registries**, when it installs a project's dependencies in a worktree it made for a skill,
  or after **Here, switch branch** or **Switch to main** changed a lockfile: the project's own package manager fetches
  them (npm, PyPI, CocoaPods and the like), as an install you ran would.
- **Nobody else**: no telemetry, no analytics, no crash reports, nothing sent to the plugin's author. Not your ticket
  tracker either: the ticket links you set up are read on your machine, and the plugin never opens one.

## What it keeps

In Claude Code's plugin store: one file for each install, on your machine, in Claude Code's folder
(`~/.claude/plugins/store/` unless `CLAUDE_CONFIG_DIR` moves it), named after the plugin and where it was installed
from. It holds:

- the last list of pull requests read and what you have seen of it, for the 20 repositories you looked at last, to tell
  you what changed since;
- the answers your sessions in a repository share, so they ask GitHub once between them, dropped once a day old or
  past the latest that fit, when a session next shares one;
- the alerts already shown, each change on a pull request once, so another session doesn't show it again, dropped after
  twice the refresh interval (at least ten minutes) plus the 5 minutes an alert can wait for Claude's turn to end, at
  least 15 minutes in all, when a session next shows one;
- the folder of each clone a session loaded its list in (for a session in a worktree, the clone it belongs to), that
  repository's name (and its remote as the clone's git config writes it, where that reads otherwise: an old name, or an
  SSH alias) and when it was noted, the 50 latest, read back only for the repository picker and for Resolve Comments,
  Fix CI and Resolve Conflicts on a repository you show;
- which session is asking GitHub, or cleaning up a clone, right now (its session id, and the clone's folder), while
  it does;
- whether the pane is compact, the choices Create PR remembers and the ticket links you set up for each repository,
  until you change them; and what a cleanup left in each clone, until a later one finds nothing left.

Not in the store but in Claude Code's plugin state for the session, as long as the session lasts:

- what the pane and the alerts need from moment to moment, such as the list the pane shows and the alerts waiting for
  Claude's turn to end;
- a repository you show there and its list, until you leave it;
- what the search of other repositories read, with **Alerts from other repositories** on or once the picker ran it
  with the setting off: each pull request's repository, number, title, address, author, CI and reviews, while the
  search finds it and a day at most after, 200 at most; forgotten when you turn the setting off or a session starts
  with it off;
- for a branch that merged, the folder of another worktree that has its base checked out, and the repository, branch
  and commit whose note you put away with its ✕.

The plugin sends none of it anywhere itself. Its two tools hand Create PR your saved choices, and Create PR and Review
a pull request's ticket key and link, which then join the conversation. Removing that file with Claude Code closed
clears all of it; the plugin starts again from nothing.

In your repositories it writes what you approve, commits and pushes, and what its own work needs: the worktrees the
skills work in, with the dependencies and ignored files installed or copied into them and a `.gh-prs-monitor-lock`
marker where an install there succeeded; the dependencies **Here, switch branch** and **Switch to main** install in your
checkout when their switch changes a lockfile; the base **Switch to main** switches your checkout to once your branch
merged, made or brought up to GitHub's, following the remote that names the repository where it followed none; the
branch it checks out for a pull request, under that pull request's branch name or as `pr-<number>`, with its upstream in
the clone's git config where it has none; and a line for `/.claude/worktrees/` in the clone's `.git/info/exclude`. With
cleanup on (the default), once a pull request is merged or closed, the worktrees made for it and the branches they hold
are removed, and so are `pr-<number>` branches that still track it, when nothing in them would be lost. **Switch to
main** deletes the merged branch it switched you from where it is still at the merged commit and no pull request is open
from it; its work stays in the merged pull request on GitHub.

Besides the repository you run Claude Code in, it reads the git config of the clones it notes (above), and of a folder
whose path you type in `/prs` or the repository picker, to know which repository each is a clone of: a folder's
`.git/config`, or for a worktree its `.git` file and the config of the clone it belongs to; for a folder inside a
repository, the nearest one above it.

## What reaches the conversation

Resolve Comments, Fix CI, Resolve Conflicts, Review and Create PR run in your Claude Code conversation when you start
them. What they read from GitHub (diffs, comments, CI logs) becomes part of that conversation, and is handled under the
terms of the account or provider you use Claude Code with. So does what `/prs` prints where no pane shows, and what
`/prs report` prints, and the choices and ticket links the plugin's tools hand the skills. Once you set up ticket links,
Review may read a pull request's ticket through a tool for your tracker that you connected to Claude Code yourself,
read-only, and what it reads joins the conversation too, as does a ticket link you paste in Create PR's preview; the
skills are told to post a ticket's key and link at most, and post only on your yes. The pane, the alerts and the
status line send nothing to a model.

## Questions

Open an issue: https://github.com/maturada/gh-prs-monitor/issues

Last updated 26.10.2026.
