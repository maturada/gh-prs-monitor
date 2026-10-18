# Security

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**
(https://github.com/maturada/gh-prs-monitor/security/advisories/new). Please don't open a public issue for it.

You'll get an answer within a week. A fix goes out as a new version, listed in [CHANGELOG.md](CHANGELOG.md), and the
advisory is published once it is out. Only the latest version gets fixes.

## What the plugin can do with your access

The plugin works through your own `gh` and `git`, so it could do whatever your GitHub account can. It is built to do as
little as it needs:

- **Reads** pull requests, reviews and checks through `gh api`, for the repository of the folder Claude Code runs in.
- **Writes to GitHub** only when you press a button and confirm it: merge, auto-merge, update the branch, ready for
  review, re-request review, re-run the failed jobs. The skills commit, push, reply to comments, resolve threads and
  post reviews only on your yes.
- **Runs its own git commands** with `core.hooksPath=/dev/null`, so no hook a repository carries runs from them, and
  fetches a pull request's branch with gh's credentials in place of your credential helper. The skills' commits and
  pushes run the repository's hooks; on someone else's pull request, the skill names them first and runs them only on
  your yes.
- **Installs dependencies** in a worktree it made for a skill, and after **Here, switch branch** for a project whose
  lockfile changed, with the project's own package manager and lockfile. That fetches from the project's package
  registries and runs its install scripts, as running the install yourself would. For a fork's pull request it
  installs nothing and copies none of your ignored files, such as a `.env`, into the worktree.
- **Makes no worktree through a link**: where the repository holds `.claude` or `.claude/worktrees` as a symbolic link,
  it stops.
- **Talks to nothing else**: no server of its own, no telemetry; see [PRIVACY.md](PRIVACY.md).

Anything that makes the plugin do more than this is a vulnerability: a write without your confirmation, data sent
anywhere but GitHub or an install's package registries, code run that you didn't ask for, or files read or written
outside the repository and the worktrees it makes.
