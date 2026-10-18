# Arguments and checkout

The first two phases of the `resolve-comments`, `fix-ci` and `resolve-conflicts` skills, shared by all three: the skill that sent you here names them as its Phases 0 and 1, and adds what differs for it under those headings, each at the step it names. Its later phases are the ones meant below.

## Phase 0: Read the arguments

The arguments are the ones the skill shows for this run, in the shape its Phase 0 gives. The `/prs` pane builds them; someone typing the command may give only a PR number, or nothing. The `--worktree` and `--deps` values arrive in double quotes; strip them before use. Split the arguments in this order:

1. **Extra instructions** — everything after the first standalone `--`: two dashes at the start or after whitespace, followed by whitespace or the end, outside the quoted values. Take it verbatim and never parse options out of it.
2. **`--worktree "<path>"`** — an absolute path to the plugin's own git worktree for this PR, `.claude/worktrees/pr-<NUMBER>`, on `pr-<NUMBER>` (one an older version of the plugin made may be on the PR's branch): either just made, or kept from an earlier run, which may hold earlier work (Phase 1 checks). Inside the quotes, `\"` is a quote and `\\` a backslash of the path.
3. **`--deps "<note>"`** — what happened when the plugin installed dependencies there, e.g. `installed with npm ci` or `npm ci failed (exit 1): <reason>; ios: installed with pod install --deployment`. It never holds a `"`, and `\\` in it is a backslash.
4. **The skill's own options**, when its Phase 0 lists any, each as it says there.
5. **The PR** — the first remaining token, a number or a URL. If there is none, Phase 1 detects it from the current branch. A number is one or more ASCII digits, once a `#` before it, if any, is dropped. A URL is `https://<HOST>/<OWNER>/<REPO>/pull/<NUMBER>`, once what follows the number after a `/`, `?` or `#` is dropped: its HOST, OWNER and REPO hold only ASCII letters, digits, `.`, `-` and `_`, OWNER and REPO are neither `.` nor `..`, and NUMBER is one or more ASCII digits. Anything else is not a pull request's: stop and say so, running nothing with it. A HOST other than `github.com` must be one that `gh auth status` shows as logged in (host names compare ignoring case, and the command can exit 1 over another host), as gh can send a sign-in token to any host it is given: with any other, stop and say so. From here on the PR is that number, or the URL made of just those parts, never the text as typed.

**With `--worktree`, enter it before anything else.** The flag means the user chose a worktree in the `/prs` pane — "Worktree, this session", or "Worktree, new session" in the desktop app, which opens the new session at the repository's root — and is an explicit instruction to do this run in that worktree. Call the `EnterWorktree` tool with `path` set to that path (if the tool is listed only by name, load its schema first). The whole run then happens in the worktree: every Read, every Edit, every git command and every command you run. Note the path as `<WORKTREE>`, and resolve paths against it, those from GitHub included, as they are relative to the repository's root — never against the folder the session started in, which holds the same files on a different branch.

If `EnterWorktree` fails, stop: report its error together with the path, so the user can open that folder themselves. Do not fall back to working in the original checkout.

**`--deps` says whether the project's commands can run where you work**: the ones the skill's Phase 0 names. The pane sends it with `--worktree`, and alone in two cases: after "Here, switch branch" changed a lockfile, and when it opened this session in a worktree it prepared ("Worktree, new session" in the terminal). Alone, there is nothing to enter: work in the session's own folder. Opened for "Worktree, new session", that folder is the pane's worktree (`git rev-parse --show-toplevel` prints a path ending in `/.claude/worktrees/pr-<NUMBER>`, on `pr-<NUMBER>`): note it as `<WORKTREE>`, and the run goes as in a worktree entered here, with nothing to leave at its end. The note has a part per project, the parts separated by `; `; a part about a project in a subfolder starts with that folder and a colon (`ios: …`), one without a folder is the root's. Read each part for the commands of its own project, the ones run in or for that folder:

- `installed with …` or `dependencies already installed (…)`: they match the lockfile, and that project's commands can run.
- `<tool> fetches its dependencies on the first build` (Go, Cargo, Gradle, Maven, Swift Package Manager): nothing was installed, and none is needed; that project's commands can run, the first one fetching what it needs.
- `… failed …`, `… could not run …`, `… did not finish …`, `not installed: …` or `not installed, as …`: don't plan on running that project's commands. The skill's Phase 0 says what to do instead.
- Missing, a note that leaves it open (no lockfile the plugin installs from), or a project no part names: before running one of its commands, check that its dependencies are present and match the lockfile, with the package manager's own check (`npm ls`, `bundle check`, say). If they don't, treat it as not installed: dependencies older than the lockfile prove nothing.

## Phase 1: Resolve PR identity

`gh pr view` takes the number, or the URL, as Phase 0 left it. **If nothing was provided**, drop the argument and the same command auto-detects from the current branch:

```bash
gh pr view '<NUMBER or URL>' --json number,url,author,baseRefName,headRefName,headRefOid,isCrossRepository,headRepository,headRepositoryOwner,maintainerCanModify \
  --jq '{number: .number, url: .url, author: .author.login, base: .baseRefName, head: .headRefName, head_sha: .headRefOid, fork: .isCrossRepository, head_owner: .headRepositoryOwner.login, head_repo: .headRepository.name, can_modify: .maintainerCanModify}'
```

There is no `baseRepository` in `gh pr view --json` — that field exists only in GraphQL, and asking for it fails with `Unknown JSON field`. Take HOST, OWNER and REPO from `.url` instead (`https://<HOST>/<OWNER>/<REPO>/pull/<NUMBER>`), which is always the **base** repo even when the head is a fork. HOST is `github.com`, or a GitHub Enterprise server's name: `gh api` sends to github.com unless told otherwise, so every `gh api` call in this run carries `--hostname <HOST>`, and `--repo` takes `<HOST>/<OWNER>/<REPO>`.

If this fails (no PR found), stop and tell the user: "No PR found for the current branch. Please provide a PR number or URL."

Note:

- `HOST`, `OWNER`, `REPO`, `NUMBER`, `BASE_REF` (`base`) and `HEAD_SHA` (`head_sha`). `OWNER` and `REPO` are always the **base** repository's, never the fork's: the pull request's review threads, checks and runs live there.
- `HEAD_OWNER` and `HEAD_REPO`, the repository the PR's branch lives in (`OWNER` and `REPO` but for a fork), and `can_modify`, whether the fork lets maintainers push to it: Phase 6 pushes there.
- `BASE_REMOTE`, what you fetch from: the remote of this checkout whose URL points at `<OWNER>/<REPO>` on `<HOST>` (`git remote -v`). A fork's clone usually calls it `upstream` and its own fork `origin`; when no remote points there, it is the repository's URL in the protocol gh uses: `git@<HOST>:<OWNER>/<REPO>.git` when `gh config get git_protocol --host <HOST>` says `ssh`, else `https://<HOST>/<OWNER>/<REPO>.git` (Phase 6 never pushes to a remote that points elsewhere).

**Someone else's PR.** Phase 6 would push onto their branch, and running the PR's code runs it on the user's machine; the skill's Phase 1 adds what else is at stake for it, and what its code is. If `.author` is not the account running this (`gh api user --hostname <HOST> --jq .login`, noted as `ME`), say so, and why, before Phase 2, and ask whether to go on; on anything but a yes, stop. If that call fails, the account is unknown: take the PR as someone else's. Even on a yes, run none of its code unless the user says so as well.

`<OWNER>`, `<REPO>`, `<NUMBER>` and the other angle-bracket names, here and in the skill, are **placeholders you substitute literally** into each command — not shell variables. Each Bash call runs in a fresh shell, so an assignment made in one block is gone by the next; a command left holding `$OWNER` resolves to the empty string and silently requests `repos///…`. A branch name, a file path or a remote goes in single quotes, and one that holds a `'` or a `\` is not used (in what you write, `\u` and four hex digits can come through as the character they name, such as a `'`), nor put in a command given to the user: a branch or a file can be named by the PR's author, and inside double quotes, or none, the shell runs what a name holds. A file path from GitHub, a log or `git status` is relative to the repository's root, `<ROOT>` (what `git rev-parse --show-toplevel` prints), which may not be the folder you work in: in a git pathspec write it `':(top,literal)<PATH>'`, which git takes as exactly that path from the root, wherever it runs, never as a pattern (a bare `[id].tsx` matches `i.tsx` too); for Read and Edit, join it to `<ROOT>`.

**Hooks.** A fetch, `git status` and a `git diff` against the folder's files run hooks too (`reference-transaction`, `post-index-change`), and in a folder on the PR's branch, in a repository that keeps its hooks among its files (husky, or a hooks folder `core.hooksPath` names), those hooks are the PR's own code. So each git command here and in the skill that can run one (a fetch, `git status`, such a `git diff`, a move) is written as `git -c core.hooksPath=/dev/null …`: run it as written. Only a commit and a push run the hooks, where the skill's commit phase says.

**Then check the checkout against the PR**, in every mode: a worktree from Phase 0, a checkout the `/prs` pane switched to the PR's branch, or the branch you were already on. Phase 3 judges against this checkout and Phase 5 edits it, so all three checks run before Phase 2.

**1. Branch:**

```bash
git branch --show-current
```

Nothing printed means no branch is checked out. It matches when it is `.headRefName` or `pr-<NUMBER>`, and for a PR from a fork (`fork: true`) only `pr-<NUMBER>`, as a fork's head may share its name with a branch of this repository that is not the PR's. The pane's worktree is always on `pr-<NUMBER>`. Otherwise compare `git rev-parse HEAD` with `<HEAD_SHA>`: a matching commit passes, as `gh pr checkout` run by hand can name the branch otherwise. If neither matches, stop and say so. In a worktree, report that `<WORKTREE>` does not hold the PR's branch and check nothing out in it. Elsewhere offer to switch this folder to the PR, on `pr-<NUMBER>`, or suggest the `/prs` pane's worktree, saying that the switch takes uncommitted changes along. Switch only on a yes, to `<HEAD_SHA>` (fetched as check 2 does) on `pr-<NUMBER>`, as **Moving a folder** below says; on anything else, stop.

**2. Commit.** If `git rev-parse HEAD` differs from `<HEAD_SHA>`, find out how:

```bash
git cat-file -e '<HEAD_SHA>' 2>/dev/null || git -c core.hooksPath=/dev/null fetch '<BASE_REMOTE>' '<HEAD_SHA>'
git rev-list --left-right --count 'HEAD...<HEAD_SHA>'
```

If fetching the commit fails, `git -c core.hooksPath=/dev/null fetch '<BASE_REMOTE>' 'pull/<NUMBER>/head'` brings it in, fork PRs included. The two counts are commits only in this checkout, then commits only on the PR: `N 0` is **ahead** (local commits not on the PR yet), `0 N` is **behind** (the PR has commits this checkout lacks, so Phase 3 would read old code). Two non-zero counts need one more look:

```bash
git rev-list --left-only --cherry-pick --count 'HEAD...<HEAD_SHA>'
```

`0` is **rebased on GitHub**: the branch was rebased there, and every commit here is on it in its new form, so nothing of the user's would be lost. Any other count is **diverged**: commits here whose change GitHub's branch lacks in that form, the user's or GitHub's own from before a rebase that changed them.

**3. Working tree:**

```bash
git -c core.hooksPath=/dev/null -c core.quotePath=false status --porcelain
```

This lists modified, staged and untracked files: note the list, untracked files included, as Phases 3 and 6 need it. A path printed in double quotes holds a space or a character such as `"`, `\` or a tab: it is the text inside, with `\"` a quote, `\\` a backslash and `\t` a tab. A reused worktree can hold a previous run's unstaged fixes, and any checkout can hold the user's own work in progress.

**If check 2 or 3 found anything, report it before Phase 2**: ahead, behind, rebased on GitHub or diverged with the counts, and the changed files. What each means for this run is in the skill's Phase 1. Then ask, and go on only on the answer: `update`, `continue` as it is, or `stop` when the checkout lacks commits GitHub has (behind, rebased on GitHub or diverged); otherwise `continue` or `stop`.

`update` brings GitHub's commits in, as **Moving a folder** below says: behind, `git -c core.hooksPath=/dev/null merge --ff-only --no-autostash --no-overwrite-ignore '<HEAD_SHA>'`; rebased on GitHub or diverged, a replay onto `<HEAD_SHA>`, which drops the commits here whose change GitHub's branch already holds and replays the user's on top. Where the commits here include a merge (`git log --merges --oneline '<HEAD_SHA>..HEAD'` prints one), as a merge of the base made here and not pushed, there is no replay: it would turn the commits that merge brought in into the PR's own. Say so, and offer `continue` as it is or `stop` only. In the pane's worktree, run it; in a folder of the user's, give the command that moves it and wait for them. For a replay there, note `<OLD>`, what `git rev-parse HEAD` prints, and run its steps in the temporary worktree first, which leave their folder as it is; the command is then the move alone, which must not run once the user has committed since: give it as `[ "$(git rev-parse HEAD)" = '<OLD>' ] && <the move>`. Then run checks 2 and 3 again; if HEAD is no longer `<OLD>`, a replay starts again from the beginning, never with the old `<NEW>`, which would drop that commit.

**Moving a folder.** git writes over a file it doesn't track without a word, as an ignored `.env` or editor settings kept out of git, when a switch, a rebase or a merge brings in a commit that has a file at that path, and deletes such files in a folder where the commit has a file; switching back deletes what it wrote. Only `git switch --no-overwrite-ignore` and a fast-forward `git merge --ff-only --no-overwrite-ignore` refuse instead: git checks every path before it writes any, and a refusal changes nothing; `git switch` also refuses in a folder in the middle of a merge, a rebase, a cherry-pick, a revert or `git am`, whose next step would land on the new branch. So a folder moves to another commit by those alone, never by `gh pr checkout`, `git checkout`, a `git rebase` in it, `git reset --hard`, or a merge that is not a fast-forward. Each runs as `git -c core.hooksPath=/dev/null …`, as written below: a repository that keeps its hooks among its files (husky, or a hooks folder `core.hooksPath` names) would run the PR's own code once the folder holds it.

First, when `git config --type=bool --get core.sparseCheckout` prints `true`, the folder is a sparse checkout, where git writes over files it doesn't track without refusing: move nothing there, and say so, and that the user can move it themselves once nothing untracked is in the way, or, from a folder of theirs, use the `/prs` pane's worktree.

- **A branch at a commit**, `<BRANCH>` at `<TARGET>`: when `git rev-parse --verify --quiet 'refs/heads/<BRANCH>'` prints nothing, `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -c '<BRANCH>' '<TARGET>'`; when it prints a commit `<TIP>` and `git merge-base --is-ancestor '<TIP>' '<TARGET>'` exits 0 (behind), `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -C '<BRANCH>' --no-track '<TARGET>'`; when instead `git merge-base --is-ancestor '<TARGET>' '<TIP>'` exits 0 (commits beyond the PR's, kept), `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore '<BRANCH>'`. Otherwise that branch went its own way from the PR: change nothing, and say so.
- **A replay onto `<ONTO>`**, in place of `git rebase <ONTO>`: the rebase runs in a temporary worktree, with no hooks, as they could be the PR's own code, and the folder then moves once. `mktemp -d` prints a new folder, `<TMP>`:

  ```bash
  git -c core.hooksPath=/dev/null worktree add --detach '<TMP>' HEAD
  git -C '<TMP>' -c core.hooksPath=/dev/null -c rebase.updateRefs=false rebase '<ONTO>'
  git -C '<TMP>' rev-parse HEAD
  git worktree remove --force '<TMP>'
  ```

  The third prints `<NEW>`. If the rebase stops, on a conflict or anything else, run `git -C '<TMP>' -c core.hooksPath=/dev/null rebase --abort`, remove the worktree, and say why: the folder is as it was. Otherwise the folder then moves: `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -C '<BRANCH>' --no-track '<NEW>'`, `<BRANCH>` what `git branch --show-current` prints; on no branch, `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore --detach '<NEW>'`.

When git refuses, nothing changed. It names the files in the way (`untracked working tree files would be overwritten` or `removed`, `directories would lose untracked files`), or the uncommitted changes it would overwrite (`Your local changes`), or says it `cannot switch branch while` a merge, a rebase, a cherry-pick or a revert is under way: name them, and say to move them aside, to commit or stash those changes, or to finish or abort what is under way, first, or to use the `/prs` pane's worktree, which leaves this folder as it is. A commit made since moves HEAD: a replay then starts again from the beginning.
