# Privacy

gh-prs-monitor is a Claude Code plugin that runs on your machine. It has no server of its own and collects nothing.

## What it talks to

- **GitHub**: github.com, or your GitHub Enterprise Server, through the GitHub CLI (`gh`) and `git` installed and signed
  in on your machine. Its requests go from your machine to GitHub under your account, as your own `gh` commands would.
  The plugin has no token of its own and reads none from your environment.
- **Your projects' package registries**, when it installs a project's dependencies in a worktree it made for a skill,
  or after **Here, switch branch** changed a lockfile: the project's own package manager fetches them (npm, PyPI,
  CocoaPods and the like), as an install you ran would.
- **Nobody else**: no telemetry, no analytics, no crash reports, nothing sent to the plugin's author.

## What it keeps

In Claude Code's plugin store, on your machine: the last list of pull requests read for each repository, what you have
seen of it, the alerts already shown, the answers your sessions in a repository share, whether the pane is compact,
what a cleanup found in each clone, and the choices Create PR remembers for each repository.

In your repositories it writes what you approve, commits and pushes, and what its own work needs: the worktrees the
skills work in, with the dependencies and ignored files installed or copied into them and a `.gh-prs-monitor-lock`
marker where an install there succeeded; the dependencies **Here, switch branch** installs in your checkout when it
changes a lockfile; the branch it checks out for a pull request, under that pull request's branch name or as
`pr-<number>`, with its upstream in the clone's git config where it has none; and a line for `/.claude/worktrees/` in
the clone's `.git/info/exclude`. With cleanup on (the default), once a pull request is merged or closed, the worktrees
made for it and the branches they hold are removed, and so are `pr-<number>` branches that still track it, when nothing
in them would be lost.

## What reaches the conversation

Resolve Comments, Fix CI, Resolve Conflicts, Review and Create PR run in your Claude Code conversation when you start
them. What they read from GitHub (diffs, comments, CI logs) becomes part of that conversation, and is handled under the
terms of the account or provider you use Claude Code with. So does what `/prs` prints where no pane shows, and what
`/prs report` prints. The pane, the alerts and the status line send nothing to a model.

## Questions

Open an issue: https://github.com/maturada/gh-prs-monitor/issues

Last updated 18.10.2026.
