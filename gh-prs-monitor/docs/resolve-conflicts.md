# Resolve Conflicts

Your pull request conflicts with its base? **Resolve Conflicts** merges the base in apart from your checkout, reads
why each side changed, and proposes a resolution for each conflict, for you to approve. Nothing moves in your checkout,
and nothing is pushed, until you say yes.

It shows on your own pull requests that GitHub says conflict with their base, drafts included. The button shows whatever
your access to the repository, even where you can't push, as the skill works on a local copy; its push goes only to the
pull request's own branch, and only where you may push. It is the main button of a row with conflicts, except on a
draft, whose main button is Ready For Review. While it runs, its row says so: see
[While a skill is at work](actions.md#while-a-skill-is-at-work).

The press first asks GitHub how the pull request stands. If it merges cleanly by now, its conflicts resolved on GitHub
or gone with a change of its base, the press says so, asks nothing, and refreshes the list.

## Where it works

It asks where to work, with the same choices as Resolve Comments: see
[Where the branch skills work](working-on-a-branch.md). On a pull request of
[another repository](other-repositories.md) it offers to open a new session in a clone of that repository instead:
see [Buttons on its rows](other-repositories.md#buttons-on-its-rows).

## Typed

Type it as `/gh-prs-monitor:resolve-conflicts [<number or URL>] [-- <instructions>]`; without a number or URL it takes
the pull request of the current branch. The pane adds `--worktree "<path>"` and `--deps "<note>"` itself.

## What it does

The work itself is the bundled `resolve-conflicts` skill:

- It merges the base into the pull request's branch, as GitHub's own conflict editor does: one commit added, none
  rewritten, so no force push. It rebases instead only where you ask; where the repository allows nothing but rebase
  merging (whose merge would bring a resolved conflict back), it says so and asks whether to rebase or stop. A rebase's
  push is a force push it asks for by name.
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

### Before it starts

A checkout behind GitHub's, or left behind by a rebase there, is brought up to date first, as Resolve Comments does
([details](working-on-a-branch.md#a-checkout-behind-githubs)).

The skill stops, and leaves the checkout alone, in the middle of a merge, a rebase, a cherry-pick or a revert. It stops
in a sparse checkout too, where git won't mark a file outside its patterns resolved.

### Your yes

It shows the merge commit, its whole message, the files it resolves and where it pushes. You then choose:

- yes: it commits, moves your checkout and pushes, after which GitHub works out the conflicts again;
- or it commits and moves your checkout only;
- or it leaves everything as it was.

Your uncommitted changes stay out of the merge and go along with the move, or the move stops. It posts nothing.

## Where to go next

- [When something is wrong](troubleshooting.md#problems-without-a-message): what to do where Resolve Conflicts stops
  before it merges.
- [Where the branch skills work](working-on-a-branch.md): the worktree, dependencies and cleanup.
- [Resolve Comments](resolve-comments.md) and [Fix CI](fix-ci.md): the other two branch skills.
- [Acting on GitHub](actions.md): **Merge** and the other buttons.
