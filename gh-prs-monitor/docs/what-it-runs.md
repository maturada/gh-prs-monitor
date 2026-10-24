# What it runs and what it sends

In short: the plugin makes no network request of its own. It works through your own `gh` and `git`, writes nothing to
GitHub without your yes, and keeps what it remembers on your machine; the dependency installs it runs for a skill fetch
from the project's package registries, as running them yourself would. The rest of this page says exactly what it runs
and touches.

It has no server, no token of its own and no telemetry, and reads no credential to sign in with: besides your `gh` and
`git`, it uses Claude Code's own links.

- [GitHub, through `gh`](#github-through-gh)
- [git](#git)
- [Installs and files](#installs-and-files)
- [The skills and their commands](#the-skills-and-their-commands)
- [Claude Code's events](#claude-codes-events)
- [New session and `/prs report`](#new-session-and-prs-report)
- [Sound, images and notifications](#sound-images-and-notifications)
- [What it keeps](#what-it-keeps)

## GitHub, through `gh`

- **Reads.** It reads with `gh api`: one GraphQL request for the list at each check, and a few more for how pull
  requests that left the list ended, for the pull requests of your branch, for the reviewers GitHub suggests, and for
  what a press or a cleanup needs to see. With **Alerts from other repositories** on, there is one more at each check, a
  search of your open pull requests and those asking your review on the folder's GitHub server; with it off, opening the
  repository picker runs that search once. A repository you show in the pane adds a list request like the folder's at
  each check while it shows.
- **Besides.** `gh repo view`, `gh config get git_protocol` and `gh --version` run besides, and for another repository
  you show, `gh auth status --active --hostname <its server>` (for a typed folder, each of its remotes' servers in turn,
  until one is signed in) and `gh repo view <its address>`. In a folder with no GitHub repository, the search of other
  repositories first runs `gh auth status --active --hostname` for the server `gh` uses by default.
- **Writes.** It writes with `gh pr merge`, `gh pr update-branch`, `gh pr ready`, `gh run rerun` and `gh api`, each only
  after you confirm it in its dialog.

How many requests that comes to: [Cost](settings.md#cost).

## git

- **No hooks from the plugin.** Every git command the plugin runs itself carries `core.hooksPath=/dev/null`, so no hook
  a repository carries runs from it.
- **Fetching.** A pull request's branch is fetched with gh's credentials (`gh auth git-credential`) in place of your own
  credential helper, as `gh pr checkout` fetches it.
- **Reading.** Status, refs, remotes, config, the index and objects.
- **Changing.** The git commands it runs that change something are:
  - `git fetch` of a pull request's branch;
  - `git worktree add`, `remove` and `repair` for the skills' worktrees;
  - `git switch` to a pull request's branch, creating or resetting its local branch, in those worktrees or, with
    **Here, switch branch**, in your checkout, and `git checkout --detach` in a worktree after a step fails;
  - `git branch -D` in cleanup;
  - `git config` for a branch's upstream ([Settings it changes](#settings-it-changes)).
- **The skills' hooks.** The skills' commits and pushes do run the repository's hooks; on someone else's pull request,
  the skill names them in its preview and runs them only on your yes.

## Installs and files

**Installs.** In a worktree it makes for a skill, and after **Here, switch branch** for each project whose lockfile
changed, it installs the dependencies with the project's own package manager, from its lockfile: `npm ci`, `pnpm`,
`yarn`, `bun`, `flutter pub get` or `dart pub get`, `uv sync`, `poetry`, `pipenv sync`, `bundle`, `composer`,
`dotnet restore` or `pod install` (`bundle` with `BUNDLE_FROZEN=true`), on Windows tried once more through `cmd`. These
fetch from the project's package registries and run its install scripts, as running the install yourself would. A fork's
pull request gets none.

**Files.**

- A new worktree gets the ignored files the repository's `.worktreeinclude` names, copied from your checkout (`mkdir`
  and `cp`, or `robocopy` on Windows); a fork's pull request gets none.
- An install in a worktree that succeeds leaves a `.gh-prs-monitor-lock` marker in the folder it filled, such as
  `node_modules`, where git ignores it, and empties it before installing again, so the next one is skipped while the
  lockfile and the command stay the same.
- With cleanup on, once a pull request is merged or closed, the worktrees made for it and the branches they hold go, and
  so do `pr-<number>` branches that still track it, when nothing in them would be lost (`git worktree remove`,
  `git branch -D`). A new worktree whose checkout fails goes at once, and git's entry for one whose folder you deleted
  goes when that pull request's worktree is next needed.
- The plugin also reads `pubspec.yaml`, `yarn.lock` and `.yarnrc.yml` to pick an install; an Android `local.properties`
  in a worktree before removing it, to tell one the tools wrote from one holding keys of yours; its own `plugin.json`
  for `/prs report`; in VS Code the editor's `product.json` for the scheme of its links
  ([New session](#new-session-and-prs-report)); and the git config of the clones your sessions ran in, and of a folder
  whose path you type in `/prs` or the repository picker, to know which repository each is a clone of (`.git/config`, or
  a worktree's `.git` file, its `commondir` and the config of the clone it belongs to; for a folder inside a repository,
  the nearest one above it). None of what it reads is sent anywhere, besides the version and repository `/prs report`
  prints.

### Settings it changes

The only settings the plugin changes are git's. A `/.claude/worktrees/` line goes in the clone's `.git/info/exclude`
when nothing ignores that folder yet. A pull request's branch it checks out, here or in a worktree, gets its upstream in
the clone's git config where it has none, as `gh pr checkout` sets it: `branch.<name>.remote` and `merge`, `pushRemote`
where pushes go to another remote, and `rebase` where your `branch.autoSetupRebase` asks for it. A branch that cleanup
removes takes its settings with it.

## The skills and their commands

**The skills** (Resolve Comments, Fix CI, Resolve Conflicts, Review and Create PR) work in your Claude Code
conversation.

- What they read from GitHub, the diff, the comments, the CI logs, becomes part of it like anything else you show
  Claude.
- They run `gh`, `git` and the project's own commands through Claude Code's own tools, in your session, as your
  permission settings allow: the checks Create PR runs where you pick them, the failing CI commands Fix CI reproduces,
  and the tests, linter, type-check, build or generators the others check their work with. On someone else's pull
  request they ask before running its code.
- Outside the repository, they write only in the session's scratchpad folder, or in a new one `mktemp -d` makes where
  none is listed: the CI logs Fix CI reads, the replies, reviews and commit messages they post, and the temporary
  worktree Resolve Conflicts merges in and a replay rebases in, removed once done, or kept and named where a step
  stopped.
- Resolve Comments, Fix CI and Resolve Conflicts may read their own instruction files without asking.
- They commit, push, reply and post only on your yes.
- Where no pane shows, the list `/prs` prints goes into the conversation too, as does what `/prs report` prints.
- Once you set up ticket links, Review reads a pull request's ticket only through a tool for your tracker that you
  connected to Claude Code, in one read-only call, and the skills are told to post a ticket's key and link at most,
  never what the ticket says. A ticket link pasted in Create PR's preview goes through the conversation, as anything
  typed there does.

**Slash commands.** A button that starts a skill in this session runs that skill's own command, as typing it would, at
once or once the turn under way ends: `/gh-prs-monitor:resolve-comments`, `/gh-prs-monitor:fix-ci`,
`/gh-prs-monitor:resolve-conflicts`, `/gh-prs-monitor:review` or `/gh-prs-monitor:create-pr`. It runs no other command.

**Tools for the skills.** Each session gets two tools, which the plugin answers itself:

- `create_pr_choices`, which Create PR calls to read and keep your choices for a repository;
- `ticket_links`, which Create PR and Review call to find a pull request's ticket, or to keep a ticket link you paste,
  for the session's repository alone and only once you press Save in the dialog it shows.

Both read and keep only these, in the plugin's store, and neither opens a ticket's link.

## Claude Code's events

The plugin follows these, passes each on unchanged, and reads none of the conversation, only a skill command's
arguments, which name its pull request:

- a session starting, and an app attaching to it: to start its checks, and to open the pane a `/prs` asked for in the
  last ten minutes with no app to show it;
- a session ending in a `/clear` or a resume, and the `SessionStart` that follows: to load the list for the new
  conversation;
- each turn's start and end, by the turn's id and whether a subagent runs it: to hold alerts back while one runs, to let
  a branch switch waiting for it go on, and to see a skill's turn end. For half an hour after a skill starts, a turn's
  end can start a check of the list, at most every half minute; nothing of the turn goes into it;
- the skills' commands above: to mark the row a skill works on.

Besides, it answers `/prs`, printing the list too where it came over Remote Control; answers its own tools; draws its
pane and, in the desktop app, the band above the prompt; follows the pane's scrolling and focus; and keeps the pane open
when you close it while it asks a question, cancelling the question instead.

## New session and `/prs report`

**New session** opens a Claude Code session through Claude Code's own link, with `open`, `xdg-open` or `rundll32` (after
`uname`, and `reg query` on Windows, tell which). In VS Code it is the extension's link, in the scheme the editor
answers on (`vscode`, `cursor`, …): the editor's folder comes from `VSCODE_NLS_CONFIG`, and the scheme from that
folder's `product.json`, else VS Code's is tried; where the link doesn't open, the skill runs in this session. For a
repository you show, **New Session in ~/code/web** opens the new session in its clone's folder.

The plugin reads three environment variables: `VSCODE_NLS_CONFIG`, for the editor's folder, and `HOME`, or on Windows
`USERPROFILE`, for a `~` in a folder's path you type in `/prs` or the picker.

**`/prs report`** runs `uname -sr`, on macOS `sw_vers`, `gh --version` and `git --version` for the versions it fills in.

## Sound, images and notifications

- **Sound and images.** The plugin's `sounds/alert.wav` is the alert sound: with **Alert sound** on (it is off by
  default), Claude Code plays it with `afplay` on macOS, and elsewhere plays nothing. Its assets folder holds the
  README's images and the icon `plugin.json` names for the plugin's listing. Neither holds code.
- **System notifications.** With **Alerts as system notifications** on (it is off by default), the alerts about pull
  request changes also go to Claude Code's own notification channel, one notification each time they show: the first
  alert's line and how many came with it, under the repository's name; `/prs demo` sends one example. Claude Code passes
  it to your `Notification` hooks and writes it to your terminal as its own notifications go; the plugin sends it
  nowhere else. Where no app draws alerts, they show as a dim notice in the conversation instead, which the model
  doesn't see.

## What it keeps

In Claude Code's plugin store on this machine, never in a repository: the last list for each repository, what you have
seen of it, the alerts shown, the answers your sessions share, the compact view, what cleanups left in each clone,
Create PR's choices, the ticket links you set up, the folders of the clones your sessions loaded a list in (the 50
latest, for the repository picker), and which session is asking GitHub or cleaning up a clone right now (its id and the
clone's folder). For the session alone, in Claude Code's plugin state: the list the pane shows, a repository you show
and its list, and what **Alerts from other repositories** read. How long each is kept, and how to remove it all, is in
Privacy.

More in [Privacy](https://github.com/maturada/gh-prs-monitor/blob/main/PRIVACY.md) and
[Security](https://github.com/maturada/gh-prs-monitor/blob/main/SECURITY.md).
