# Where the branch skills work

[Resolve Comments](resolve-comments.md), [Fix CI](fix-ci.md) and [Resolve Conflicts](resolve-conflicts.md) work on the
pull request's branch, and ask where to, also when this folder is on that branch already, as another session may be
working in it.

## The choices

- **Here, on this branch** — when this folder is on the pull request's branch already: the skill works in it as it
  is, with any changes you have in it.
- **Here, switch branch** — when this folder is not on the pull request's branch: checks it out here, for this session,
  as a new one would share the folder with the conversation you are in. The question says what it costs: uncommitted
  changes go along to the pull request's branch; from no branch, commits made there are left behind, found again only
  through `git reflog`. [How the switch works](#here-switch-branch-in-detail).
- **Worktree, this session** — a git worktree at `<repository>/.claude/worktrees/pr-<number>`, with the pull request
  checked out on a branch of its own, `pr-<number>`, fetched and set up as `gh pr checkout` does, forks included, by the
  same checkout as above. A branch of the head's name stays free for you to switch to in any folder. Your current
  branch and changes are not touched, and no folder you work in is used. [More on the worktree](#the-worktree).
- **Worktree, new session** — the worktree above, prepared here, and a new Claude Code session opened for it with
  the skill's command and the pull request's URL typed in, for you to send, the way [Review](review.md) opens one; this
  conversation goes on undisturbed. Offered from the terminal and the desktop app. The terminal opens the session in
  the worktree. The desktop app takes a worktree's folder for its repository and then starts a session in a scratch
  folder of its own, so there the session opens at the repository's root, the command carries `--worktree`, and the
  skill moves into the worktree itself.
- **Cancel**.

### Here, switch branch, in detail

- **One refusing switch.** The pull request's head is fetched as `gh pr checkout` fetches it, then the switch is one
  `git switch --no-overwrite-ignore`, which checks every file before it writes any. A fetch that fails stops it.
- **When git refuses, nothing changes.** git refuses where the pull request's branch has a file this folder holds
  outside git, such as a `.env` or editor settings you keep ignored, or where it would overwrite a change you haven't
  committed. The flow names the files, to move aside (or commit or stash), or to work in a worktree instead. A plain
  `git checkout`, as gh runs it, writes over such a file without a word, and switching back deletes it. git refuses as
  well in a folder in the middle of a merge, a rebase, a cherry-pick or a revert. In a sparse checkout, where git writes
  over files it doesn't track without refusing, the flow checks for them itself first.
- **A file you deleted without `git rm`** that the pull request changes comes back: git counts such a deletion as no
  change.
- **No git hooks run** during the switch, as a repository that keeps its hooks among its files (husky, or a hooks
  folder) would run the pull request's own code.
- **What the branch follows.** A branch it makes pulls and pushes as one `gh pr checkout` makes, with one difference: a
  branch of this repository fetched by its address follows its branch there, where gh would have it follow GitHub's
  copy of the pull request, which takes no push. A branch you have keeps what it follows, and one that follows nothing
  is set up as a new one.
- **Dependencies** are reinstalled for a project when the branch's lockfile for it differs.
- **When `pr-<number>` stands in the way.** If it is checked out in the pull request's own worktree, the flow says to
  choose **Worktree, this session** instead; if it has gone its own way from the pull request, the flow says so.
- **While Claude is working** in this session, the switch waits for that turn to end (the row says so). It does not
  happen if this checkout changed since you were asked (another branch, a commit, a changed file), by that turn or
  otherwise, as the question no longer told what goes along. One switch of this folder runs at a time, and other work
  asked for here meanwhile says so.
- **Before it starts**, the skill lists any changes you brought along and asks.

### The worktree

- **A folder in the way.** A `pr-<number>` folder holding some other branch is left alone, and the flow says so; so is
  one on no branch, at commits no branch holds and GitHub lacks.
- **Reused next time.** The worktree is reused and updated next time, relinked first when the repository's folder has
  moved. After a rebase on GitHub, one with nothing changed in it and nothing GitHub lacks is brought to GitHub's
  version, a fork's never. Otherwise, or where a file git doesn't track is in the way, it is used as it is, with an
  alert that it may be behind, and the skill asks before it starts.
- **Kept out of `git status`.** `.claude/worktrees/` is added to the clone's own `.git/info/exclude` when nothing
  ignores it yet.
- **Never through a link.** Where the repository holds `.claude` or `.claude/worktrees` as a link, no worktree is made,
  as the link could lead anywhere; Claude Code refuses those for its own worktrees as well.

### Files copied from .worktreeinclude

A new worktree gets the files git ignores that the repository's `.worktreeinclude` names, copied from the main checkout
as Claude Code's own worktrees get them: a `.env`, Android's `local.properties`, an app's secrets config.

- Patterns match as git matches `.gitignore`: a pattern without a slash, as `.env`, at any depth.
- What tools make again ([Cleanup](#cleanup) lists it) is not copied, even from a folder a pattern names (a `.pyc`, a
  `.DS_Store`, a package's files), unless a pattern names its path, as `vendor/creds.json`.
- In a folder tools make again, only the patterns that name it count, with any `!` line in its place: a path in it, as
  `vendor/creds.json`, or its name, as `**/vendor/` or `**/vendor/creds.json`. So `*.pem` or `config.json` takes
  nothing there, also from a `build` folder where git tracks a file, and a wildcard folder, as in `*/creds.json`, names
  none.
- A file is copied only where the pull request's branch ignores it too, so none shows there as a change of yours or
  goes into a commit; never over a file there, and never through a link on the way.
- Nothing is copied for a fork's pull request, whose code could read the files.
- An alert names the first file it could not copy and how many more; where git can't list them whole, none is copied,
  and the alert says so.

## Instructions

Instructions typed in the dialog's field, for example "only the naming comments", go to the skill wherever the answer
you then press has it work, or Enter sends them alone to a worktree in this session. Sent alone, a "cancel", "no
thanks" or "never mind" cancels, while an instruction that merely starts with "no" is passed on.

## Cleanup

Once the pull request is merged or closed, its worktree goes, with its local branch, when nothing in it would be lost:

- no files changed or added;
- no files that git ignores, except what tools make again (installed dependencies, build output and caches, in the
  usual folders of the common languages: `node_modules`, `.venv`, `vendor`, `Pods`, `target`, `dist`, `__pycache__`
  and the like, Flutter's `.symlinks` and `ephemeral`, Yarn's Plug'n'Play files, an Android `local.properties` holding
  only the SDK's and Flutter's own settings) and files the main checkout holds the same, as a copy `.worktreeinclude`
  made (one changed in the worktree keeps it, even among what tools make again where the file names it);
- its commit on GitHub.

What goes and what stays:

- Only a worktree holding the pull request's branch is removed. A worktree Claude Code itself made in the same folder,
  or one on a branch another open pull request comes from, is left alone.
- One that holds work is kept, and said so once: not again in later sessions in the same clone until why it stays
  changes.
- The one your session is working in stays until you leave it. A worktree another session works in can still go (only
  when nothing in it would be lost); that session then loses its folder.
- A `pr-<number>` branch that **Here, switch branch** left in your folder goes the same way, once no folder has it
  checked out, it still tracks that pull request, and its commit is on GitHub. One with commits GitHub lacks is kept,
  and said so once, as a worktree is.
- A branch of that name that tracks the pull request is taken for /prs's, even one you made yourself. One that tracks
  something else, or nothing, or that an open pull request comes from, is never touched, and no other branch of yours
  is ever deleted.

This is checked when a session starts and whenever a pull request leaves the lists, unless the **Clean up worktrees and
branches** setting is off. One session of a clone checks at a time: one that finds another cleaning up leaves it to
that one and looks again next time.

## Your branches stay yours

The pane never resets or rewrites a branch you work in.

- The worktree's `pr-<number>` is made from GitHub's version. One left from an earlier run is brought to GitHub's
  version only when nothing in it would be lost.
- Switching here takes the branch of the head's name when you have none, or when yours is at, behind or ahead of
  GitHub's, and then only moves it forward.
- Otherwise it goes on `pr-<number>` too:
  - always for a fork's pull request, whose head may share its name with a branch of yours;
  - when your branch of that name is checked out in another folder, or has gone its own way from the pull request, as
    after a rebase on GitHub;
  - when a branch of yours differs from the head's name only in case (on a file system that ignores case, as macOS's
    and Windows' do by default, git would take yours for it).

The skills rebase it only on your yes: before they start, to bring the checkout up to date (in /prs's worktree; in your
own folder they give you the command), and before a push, to bring in what GitHub has. The preview says so, and your
unpushed commits then go out with new SHAs.

A rebase runs in a temporary worktree, and the folder then moves once by the same refusing switch, as git's rebase
writes over a file it doesn't track without a word: a conflict leaves the folder as it was. Resolve Conflicts makes its
merge apart the same way, and moves the folder onto it once, on your yes.

They push to the pull request's own branch, whatever the local one is called. For a fork, only when you may push to the
fork (yours, or an organisation's you write to), or when it lets maintainers edit and you may push to the repository;
otherwise they offer to commit only.

## Dependencies

A new worktree gets its own dependencies, installed from each project's lockfile so they match the pull request exactly:
the repository root's projects first, then those in folders up to three down (`ios`, `apps/web`, `apps/mobile/ios`),
leaving out installed or vendored code, examples and test data; six installs at most each time (a project installed
already takes none of them), the rest named for the skill. Each install is the tool's frozen one, which takes what the
lockfile pins and fails rather than change it:

| Lockfile | Install |
|---|---|
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `bun.lock`, `bun.lockb` | `bun install --frozen-lockfile` |
| `yarn.lock` | `yarn install --immutable` for Yarn 2+, whose lockfile has a `__metadata` entry; `--frozen-lockfile` for Yarn 1 |
| `package-lock.json`, `npm-shrinkwrap.json` | `npm ci` |
| `pubspec.lock` | `flutter pub get --enforce-lockfile` for a Flutter app, `dart pub get --enforce-lockfile` otherwise |
| `Podfile.lock` (with its `Podfile`) | `pod install --deployment` |
| `uv.lock` | `uv sync --frozen` |
| `poetry.lock` | `poetry install --no-interaction` |
| `Pipfile.lock` | `pipenv sync` |
| `Gemfile.lock` | `bundle install`, frozen (`BUNDLE_FROZEN=true`) |
| `composer.lock` | `composer install --no-interaction` |
| `packages.lock.json` | `dotnet restore --locked-mode` |

A JavaScript project installs before the others in its folder, and the root before its folders, as a React Native or
Flutter app's pods build on what those put in place. Go, Cargo, Gradle (Android), Maven and Swift Package Manager fetch
a project's dependencies as it builds, into caches of their own, so nothing is installed for them, and the skill is
told its commands can run. `requirements.txt` is no lockfile, and gets nothing.

- **A reused worktree** installs again only when a lockfile changed, where the folder an install fills is one git
  ignores (`node_modules`, `.yarn` for Yarn's Plug'n'Play, `.venv`, `vendor`, `.dart_tool`, `Pods`), or one the
  install makes ignored itself, as uv does `.venv`. Otherwise, and for the tools that install elsewhere (Poetry,
  Pipenv, Bundler, .NET), the install runs each time, which is quick when nothing changed.
- **Switching this folder** installs only the projects whose lockfile or package manager the switch changed.
- **A fork's pull request** gets none: installing would run the fork's install scripts with your access, so that is
  left to you.
- **The skill is told** how each project's dependencies stand: in a worktree always, so it knows which checks can run;
  after a switch here, when an install ran, failed, or was left to you.
- **An install still running after 10 minutes** is stopped, and the skill is told that what it filled may be
  incomplete.
- **On Windows**, a package manager Claude Code can't start is tried once more through `cmd`.
