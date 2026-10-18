# Resolve Conflicts

**Resolve Conflicts** shows on your own pull requests that GitHub says conflict with their base, drafts included. As it
works on a local copy, it shows whatever access you have to the repository; its push goes only to the pull request's
own branch. It is the main button of a row with conflicts, except on a draft, whose main button is Ready For Review.
The press first asks GitHub how the pull request stands: one that merges cleanly now, its conflicts resolved on GitHub
or gone with a change of its base, is said so, asks nothing, and the list refreshes.

It asks where to work, with the same choices as Resolve Comments: see [Where the branch skills
work](working-on-a-branch.md). While it runs, its row says so: see [While a skill is at
work](actions.md#while-a-skill-is-at-work).

Typed, it is `/gh-prs-monitor:resolve-conflicts [<number or URL>] [-- <instructions>]`; without a number or URL it
takes the pull request of the current branch. The pane adds `--worktree "<path>"` and `--deps "<note>"` itself.

The work itself is the bundled `resolve-conflicts` skill:

- It merges the base into the pull request's branch, as GitHub's own conflict editor does: one commit added, none
  rewritten, so no force push. Only where you ask, or where the repository allows nothing but rebase merging (whose
  merge would bring a resolved conflict back), it rebases instead, and that push is a force push it asks for by name.
- The merge is made in a temporary worktree, never in your checkout, as a merge writes over files git doesn't track
  (an ignored `.env`) wherever the base has a file at that path. Your checkout stays as it is until you say yes, then
  moves onto the merge in one step that stops rather than overwrite such a file or a change of yours.
- For each conflict it reads both sides, the version they started from, and why each changed (the commits and pull
  requests behind them), then proposes a resolution: confident where both intents can be kept, or unsure where they
  disagree, for you to choose. Lockfiles are never merged by hand: the base's is taken and the package manager makes
  the pull request's dependency change to it again, only where you ask and never on a fork's pull request. Generated
  files are generated again, and migrations numbered on both sides are flagged for you.
- It looks for what a merge without a textual conflict can still break, such as a name the base renamed that the pull
  request still uses, and once your checkout holds the merge, runs the project's checks where its dependencies are
  installed. On someone else's pull request it runs nothing of theirs unless you say so.

A checkout behind GitHub's, or left behind by a rebase there, is brought up to date first, as Resolve Comments does; one
in the middle of a merge, a rebase, a cherry-pick or a revert is left alone, and the skill stops, as it does in a sparse
checkout, where git won't mark a file outside its patterns resolved. Then it shows the merge commit, its whole message,
the files it resolves and where it pushes, and on your yes commits, moves your checkout and pushes, after which GitHub
works out the conflicts again; or commits and moves your checkout only; or leaves everything as it was. Your uncommitted
changes stay out of the merge and go along with the move, or the move stops. It posts nothing.
