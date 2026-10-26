# A day with it

What a working day with gh-prs-monitor looks like, from the first session to the next branch: what you see, what you
press, and what the plugin does for you in between. Each step links to the page that tells more.

1. **You start Claude Code in the repository.** The status line reads
   `PRs ✅ 1 Ready  ❗ 2 Need You  🔍 1 To Review  (/prs)` (in the desktop app, a band above the prompt), and one alert
   sums up what happened while you were away: `Since yesterday 17:40, 3 pull requests changed — see /prs`.
   [Alerts and the status line](alerts.md)
2. **`/prs`.** The pane opens with what needs you at the top. Each row shows its ticket, `WEB-5785 ⧉`, once
   [ticket links](tickets.md) are set up. Under each pull request that changed, a note says what changed; its ✕ marks it
   seen, or it goes by itself after half an hour. [The pane](pane.md)
3. **CI failed on one of yours.** **Re-Run CI** re-runs its failed jobs, after one confirmation. If it fails again,
   **Fix CI** reads the logs, tells a flaky failure from a real one, and fixes the ones you pick. It asks where to
   work. In a [worktree](working-on-a-branch.md) (a second folder of the same repository, on a branch of its own) your
   own checkout stays as it is. It shows you the commit, and pushes on your yes. [Fix CI](fix-ci.md)
4. **Someone asks for your review.** **Review**, then **New session**: a new Claude Code session opens with the review
   typed in, for you to send, and this conversation goes on. The review starts with an overview, checks each finding
   before it shows it, and posts nothing until you approve the wording; then it offers to approve the pull request.
   When the author asks again after your review, the row reads Updated Since Your Review or Re-Review Requested, and
   **Review** can cover only what changed since. [Review](review.md)
5. **A review asked of you in another repository.** A toast names it, and the header counts `+3 elsewhere`, when
   **Alerts from other repositories** is on. To look, press **Repositories** in the header and pick the repository, or
   type `/prs acme/web`. Its pull requests show in the same pane, with their buttons, and **←** (Back) returns to this
   folder's list. [Other repositories](other-repositories.md)
6. **Comments came in on yours.** **Resolve Comments** sorts each unresolved comment as needs fix, debatable or already
   fixed, changes only what you approve, and commits and pushes on your yes. Each reply and each resolved thread on
   GitHub takes its own yes, and so does asking the reviewers to look again. [Resolve Comments](resolve-comments.md)
7. **One has conflicts with its base.** **Resolve Conflicts** merges the base in apart from your checkout, proposes a
   resolution for each conflict, and moves nothing until you say yes. [Resolve Conflicts](resolve-conflicts.md)
8. **Nobody is asked to review one of yours.** **Request Review** offers the people GitHub suggests, and asks the ones
   you pick, after your confirmation. [Acting on GitHub](actions.md#the-buttons)
9. **One is approved, its checks green.** **Merge** asks which method, offering only those the repository allows, and
   merges the commit the pane showed. The row reads ✓ Merged until GitHub's search catches up.
   [Acting on GitHub](actions.md)
10. **Cleanup.** Once the pull request is merged or closed, the worktree a skill used goes with its branch, when nothing
    in it would be lost. [Cleanup](working-on-a-branch.md#cleanup) Where this checkout is on the merged branch,
    **Switch to main** takes it back to the base. [A branch that merged](pane.md#a-branch-that-merged)
11. **A new branch.** On a branch with no pull request yet, **Create PR** shows in the title line of Your Pull Requests.
    It runs the checks you pick, drafts the title and body, and commits, pushes and opens the pull request on your yes
    to one preview. [Create PR](create-pr.md)

Where next: [the pane](pane.md) for every status, [Settings](settings.md) to tune the checks, alerts and cost, and
[When something is wrong](troubleshooting.md). Back to the [README](../README.md).
