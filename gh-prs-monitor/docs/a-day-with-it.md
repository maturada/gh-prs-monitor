# A day with it

What a working day with gh-prs-monitor looks like, from the first session to the cleanup. Each step links to the page
that tells more.

1. **You start Claude Code in the repository.** The status line reads
   `PRs ✅ 1 Ready  ❗ 2 Need You  🔍 1 To Review  (/prs)` (in the desktop app, a band above the prompt), and one alert
   sums up what happened while you were away: `Since yesterday 17:40, 3 pull requests changed — see /prs`.
   [Alerts and the status line](alerts.md)
2. **`/prs`.** The pane opens with what needs you at the top. Under each pull request that changed, a note says what
   changed; its ✕ marks it seen, or it goes by itself after half an hour. [The pane](pane.md)
3. **CI failed on one of yours.** **Re-Run CI** re-runs its failed jobs, after one confirmation. If it fails again,
   **Fix CI** reads the logs, tells a flaky failure from a real one, and fixes the ones you pick, in a worktree if you
   like, while your checkout stays as it is. It shows you the commit, and pushes on your yes. [Fix CI](fix-ci.md)
4. **Someone asks for your review.** **Review**, then **New session**: a new Claude Code session opens with the review
   typed in, for you to send, and this conversation goes on. The review starts with an overview, checks each finding
   before it shows it, and posts nothing until you approve the wording; then it offers to approve the pull request.
   [Review](review.md)
5. **Comments came in on yours.** **Resolve Comments** sorts each unresolved comment as needs fix, debatable or already
   fixed, changes only what you approve, and commits and pushes on your yes. Each reply and each resolved thread on
   GitHub takes its own yes, and so does asking the reviewers to look again. [Resolve Comments](resolve-comments.md)
6. **One is approved, its checks green.** **Merge** asks which method, offering only those the repository allows, and
   merges the commit the pane showed. The row reads ✓ Merged until GitHub's search catches up.
   [Acting on GitHub](actions.md)
7. **Cleanup.** Once the pull request is merged or closed, the worktree a skill used goes with its branch, when nothing
   in it would be lost. [Cleanup](working-on-a-branch.md#cleanup)
8. **A new branch.** On a branch with no pull request yet, **Create PR** shows in the title line of Your Pull Requests.
   It runs the checks you pick, drafts the title and body, and commits, pushes and opens the pull request on your yes
   to one preview. [Create PR](create-pr.md)

Back to the [README](../README.md).
