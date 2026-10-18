# Resolve Comments

**Resolve Comments** shows on your own pull requests with unresolved review comments, or where changes were requested.
It asks where to work first: see [Where the branch skills work](working-on-a-branch.md). While it runs, its row says so:
see [While a skill is at work](actions.md#while-a-skill-is-at-work).

Typed, it is `/gh-prs-monitor:resolve-comments [<number or URL>] [-- <instructions>]`; without a number or URL it
takes the pull request of the current branch. The pane adds `--worktree "<path>"`, `--deps "<note>"` and
`--include-outdated` itself.

The work itself is the bundled `resolve-comments` skill:

1. It checks the checkout is on the pull request's commit and has no unexpected changes. A checkout behind GitHub's,
   or left behind by a rebase there, can be brought up to date first: in /prs's worktree on your yes, in your own
   folder with a command it gives you.
2. It lists each unresolved comment, the requests a review made in its own text, and conversation comments you haven't
   answered, as needs fix, debatable or already fixed.
3. It edits only what you approve, then runs the project's quick checks on what it changed, where it can.
4. It shows the commit, its whole message, its files and where it pushes. On your yes it commits and pushes (or commits
   only, or leaves the changes unstaged), never by force unless you ask.
   - Only the files it changed go in: changes you had before, staged or not, stay out, and a file holding both is
     asked about.
   - Commits GitHub already has in their rebased form are dropped, never pushed back over it.
   - Anything pushed to the branch meanwhile is brought in before the push.
5. Replies and resolving threads on GitHub each need their own yes, and come after the push, so a reply can name the
   commit.
6. Last, on your own pull request, unless it is a draft, once it pushed, it offers to ask those who requested changes
   to review again, as **Re-Request Review** in the pane does; that too needs its own yes.
