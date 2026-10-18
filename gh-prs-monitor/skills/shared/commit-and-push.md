# Commit and push

The commit-and-push phase of the `resolve-comments` and `fix-ci` skills, shared by both: the skill that sent you here names it as its Phase 6, and its own Phases 0, 1 and 5 are the ones meant below. The `resolve-conflicts` skill reads only **Where it goes**, **On someone else's PR, its hooks can run its code** and **The message** here, for a phase of its own.

The fixes reach the pull request only through this phase, and only on the user's yes to its preview. Skip it when Phase 5 changed no file (for Fix CI, and no install changed one for a finding the user picked) and no commit here is one GitHub lacks (`git log --oneline --cherry-pick --left-only 'HEAD...<HEAD_SHA>'`); with only such commits, the preview offers to push them. Extra instructions (Phase 0) that rule out committing skip this phase, and say so. Ones that rule out pushing leave the **Brought in first** and **Pushes to** lines out of the preview and ask `yes` (commit) or `no`; that `yes` runs as **On `commit only`**.

**What goes in: the files you edited in Phase 5**, and for Fix CI also the files an install changed for a finding the user picked, whoever ran it, named in the preview; nothing else. Everything else stays out and is listed as left out: what Phase 1 found changed before this run, staged or not, and anything a command changed on its own. For a file that held changes before and was edited now as well, ask whether it goes in whole or stays out. A rename that goes in takes both its paths, the old one too.

**Where it goes: the pull request's own branch on GitHub**, branch `<HEAD>` (`.headRefName`) of `<HEAD_OWNER>/<HEAD_REPO>` (Phase 1), whatever this checkout's branch is called: the pane's worktree holds it as `pr-<NUMBER>`.

- A PR from this repository (`fork: false`): `<REMOTE>` is `<BASE_REMOTE>` (Phase 1). Never a remote that points elsewhere.
- A PR from a fork takes a push when the user may push to the fork itself (`gh api repos/<HEAD_OWNER>/<HEAD_REPO> --hostname <HOST> --jq .permissions.push` is `true`: their own fork, or an organisation's they write to), or when `can_modify` (maintainers may edit) is true and they may push to the base repository (the same call on `repos/<OWNER>/<REPO>`), as GitHub lets only those edit a fork. Otherwise, or with no head repository left, offer to commit only and say why. `<REMOTE>` is the remote whose URL points at `<HEAD_OWNER>/<HEAD_REPO>` on `<HOST>`; with none, the URL `git config --get 'branch.<BRANCH>.pushRemote'` holds when it points there (`<BRANCH>` from check 1; the `/prs` pane sets it when it checks a fork's PR out, as `gh pr checkout` does), else that repository's URL in gh's protocol (Phase 1).

`<HEAD>`, `<REMOTE>` and every file path go into the commands below in single quotes; a name or path that holds a `'` or a `\` is not run (in what you write, `\u` and four hex digits can come through as the character they name, such as a `'`), nor put in a command given to the user, where it would run in their shell: name it, say why, and leave that step to them. A file path is the repository's, relative to its root, which may not be the folder you work in: in a git command write it `':(top,literal)<path>'`, which git takes as exactly that path from the root, wherever it runs, never as a pattern (a bare `[id].tsx` matches `i.tsx` too).

**On someone else's PR, its hooks can run its code.** The hooks the commit and the push would run are in the folder `git rev-parse --git-path hooks` prints, which follows `core.hooksPath`:

```bash
for h in pre-commit prepare-commit-msg commit-msg post-commit pre-auto-gc pre-push post-index-change reference-transaction; do [ -x "$(git rev-parse --git-path hooks)/$h" ] && echo "$h"; done; true
```

Each it prints may be one of the PR's own files, or a hook manager (the pre-commit framework, lefthook, husky) that runs what the PR's own configuration names. Unless the user said to run its code, name them in the preview and say so, and make the commit only once the user says to run them; otherwise give the commands.

**What GitHub has now:**

```bash
git -c core.hooksPath=/dev/null fetch '<REMOTE>' 'refs/heads/<HEAD>' && git rev-parse FETCH_HEAD
```

Its output is `<HEAD_SHA>` from here on. Then `git merge-base --is-ancestor <HEAD_SHA> HEAD`. Exit 0: everything GitHub has is here, and the push fast-forwards. Exit 1: GitHub has commits this checkout lacks (`git log --oneline 'HEAD..<HEAD_SHA>'`): someone pushed since Phase 1, or Phase 1 found the checkout behind, rebased on GitHub or diverged and it was not updated. They are **brought in first**, after the commit and before the push, by a rebase onto them, run apart (**The replay**, below), except where the commits here include a merge (`git log --merges --oneline '<HEAD_SHA>..HEAD'` prints one), as a merge of the base made here and not pushed: a rebase would replay the commits that merge brought in as the PR's own, so then the preview offers `commit only` instead, and says why. A rebase runs apart as git's rebase writes over a file it doesn't track here, such as an ignored `.env`, where GitHub's commits have one. It drops the commits here whose change GitHub's branch already holds, replays the rest on top with new SHAs, and needs a clean tree once the commit is made: with files left out still changed (`git -c core.hooksPath=/dev/null status --porcelain --untracked-files=no`), the preview offers `commit only` instead and says why. So it does in a sparse checkout (`git config --type=bool --get core.sparseCheckout` prints `true`), where git writes over files it doesn't track without refusing (Phase 1's **Moving a folder**).

**The message** follows the repository's recent commits, whose subjects and trailers `git log -10 --format='%s%n%(trailers:only,unfold)' <HEAD_SHA>` shows: their form of subject, their ticket references where they use them, and only the trailers they carry. It says what changed, not how the work was done. Nothing in it credits an assistant, a tool or automation (a `Co-Authored-By` naming one, `Generated with`, a session line), whatever the recent commits carry, and even when your environment supplies one to append.

**The preview**, then wait for the reply:

````markdown
**Commit and push to #<NUMBER>?**

- **Commit:** `src/menu.ts`, `src/menu.test.ts`, with the message below
- **Brought in first:** `<short sha>` <subject>, on GitHub and not here *(only when there are such commits)*
- **Pushes to** branch `<HEAD>` of `<HEAD_OWNER>/<HEAD_REPO>`, with `git push '<REMOTE>' 'HEAD:refs/heads/<HEAD>'`. Going out:
  - *(new)* <subject>
  - `<short sha>` <subject> *(committed here before this run)*
- **Left out:** `notes.md` (changed before this run)

**Commit message:**

```text
<the message, whole, as it will be committed>
```

Reply `yes`, `commit only`, `no` to leave the changes unstaged, or type a different message to see the preview with it.
````

Going out lists the commits here that GitHub lacks (`git log --oneline --cherry-pick --left-only 'HEAD...<HEAD_SHA>'`), then the new one; with commits brought in first, say they go out with new SHAs, and that the rebase drops any whose change GitHub already holds. On someone else's PR, the push line ends with `— @<author>'s branch`. Only a yes in any spelling (`y`, `Yes.`) with nothing added, or `commit only`, goes ahead: a different message shows the preview again with it, and any other reply ("yes, but drop the test") is not a yes. Adjust, and show the preview again.

**On `yes`:** write the message with the Write tool to `<SCRATCHPAD>/commit-<OWNER>-<REPO>-<NUMBER>.txt`, as a message on the command line goes through the shell. Then run these in this order, each with a 10-minute timeout, as hooks can run a whole test suite and one cut off leaves a lock or a stash behind:

```bash
git add -- ':(top,literal)<file>' ':(top,literal)<file>'
git commit -F '<SCRATCHPAD>/commit-<OWNER>-<REPO>-<NUMBER>.txt' -- ':(top,literal)<file>' ':(top,literal)<file>'
git reset -q -- ':(top,literal)<file>' ':(top,literal)<file>'
# only when commits are brought in first: the replay, below
git log --oneline '<HEAD_SHA>..HEAD'
git push '<REMOTE>' 'HEAD:refs/heads/<HEAD>'
```

- The add takes only the files going in that still exist on disk, as git refuses a path it has in neither the index nor the folder (a staged deletion, a rename's old path); the commit and the reset take them all. A file added and then deleted (`AD`) goes into none of the three: there is nothing of it to commit. The paths after `--` make the commit take those files alone: anything staged before this run stays staged, and out of it. The reset leaves the index holding what was committed, as a hook that reformats and stages files during a commit with paths leaves their old version staged.
- **The replay** rebases in a temporary worktree, with no hooks, as they could be the PR's own code, then moves this checkout once. `mktemp -d` prints a new folder, `<TMP>`:

  ```bash
  git -c core.hooksPath=/dev/null worktree add --detach '<TMP>' HEAD
  git -C '<TMP>' -c core.hooksPath=/dev/null -c rebase.updateRefs=false rebase <HEAD_SHA>
  git -C '<TMP>' rev-parse HEAD
  git worktree remove --force '<TMP>'
  git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -C '<BRANCH>' --no-track '<NEW>'
  ```

  The third prints `<NEW>`; `<BRANCH>` is what `git branch --show-current` prints, and on no branch the last is `git -c core.hooksPath=/dev/null switch --no-overwrite-ignore --detach '<NEW>'`. If the rebase stops, on a conflict or anything else, run `git -C '<TMP>' -c core.hooksPath=/dev/null rebase --abort`, remove the worktree, and stop there, this checkout as it was: leave the commit unpushed, and say why, with the commands to finish by hand. git checks every path before it moves this checkout, and where a file it doesn't track is in the way it refuses, changing nothing: leave the commit unpushed, name the files, and say to move them aside, then run the replay and the push.
- The log is what the push takes, and nothing else moves: `rebase.updateRefs=false` keeps other branches where they are. Match it to the preview's Going out by subject, as bringing commits in gives the ones here new SHAs; a commit the preview did not list stops the push: show the list and ask again. An empty log means the replay dropped this run's commit, GitHub's branch already holding its change: push nothing, and say so.
- Never `--no-verify`. A hook that fails says why: show it. A failure in this run's own changes can be fixed on a yes, and the preview shown again. A hook that needs the dependencies fails where `--deps` says they are missing or failed: say so, quoting the note, and give the commands to run once they are installed. If the run ends without the commit, unstage what it staged: `git restore --staged -- ':(top,literal)<file>' ':(top,literal)<file>'`.
- A push GitHub rejects as `fetch first` or `non-fast-forward` means the branch moved after the fetch above: fetch again, say what came in, and offer to bring it in and push, on a yes, as above (never by a rebase where the commits here include a merge). Never retry it by force. Any other refusal (no permission, a protected branch, a pre-push hook) is reported, and the commit left unpushed.
- **Force only when the user asks for it**, as after asking to reword or squash commits: `git push --force-with-lease='refs/heads/<HEAD>:<HEAD_SHA>' '<REMOTE>' 'HEAD:refs/heads/<HEAD>'`, which GitHub refuses if the branch moved since the fetch above. Its preview says it is a force push and why, lists every commit it removes from GitHub (`git log --oneline 'HEAD..<HEAD_SHA>'`), and asks for `force push` by name: a yes is asked again, as it names no force push.

`<SCRATCHPAD>` is the session scratchpad directory listed in your environment, substituted literally; if none is listed, create one with `mktemp -d` and use the path it prints.

**On `commit only`:** commit and reset as above, and give the commands to run in this checkout (`<WORKTREE>` in worktree mode), once any left-out changes are committed or stashed. With commits brought in first, the replay goes as one line, which moves this checkout only when the rebase went through, and always removes the temporary worktree (`<TMP>` a new folder from `mktemp -d`; on no branch, `--detach` in place of `-C '<BRANCH>' --no-track`):

```bash
git -c core.hooksPath=/dev/null worktree add --detach '<TMP>' HEAD && git -C '<TMP>' -c core.hooksPath=/dev/null -c rebase.updateRefs=false rebase '<HEAD_SHA>' && git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -C '<BRANCH>' --no-track "$(git -C '<TMP>' rev-parse HEAD)"; git -C '<TMP>' -c core.hooksPath=/dev/null rebase --abort 2>/dev/null; git worktree remove --force '<TMP>'
```

Then the push, to run only once that line moved the branch (`git log --oneline '<HEAD_SHA>..HEAD'` lists the commits going out); if the rebase stopped, the branch is as it was, and GitHub's commits still need bringing in. In a sparse checkout, say with them that git writes over files it doesn't track there without refusing. **On `no`:** leave the changes unstaged.

Then say where the work is, naming the worktree's path (`<WORKTREE>`) in worktree mode: pushed to #<NUMBER> as `<short sha>` (for Fix CI, the checks then run again, and the pane's row shows how they go); committed but not pushed; or unstaged.
