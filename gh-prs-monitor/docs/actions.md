# Acting on GitHub

Your own pull requests get a button when their state calls for one and your access allows it: merge what is ready,
update a branch that fell behind, re-run a flaky check. Every button asks first, in the plugin's dialog (below), saying
exactly what will happen; Cancel or Escape writes nothing. Resolve Comments, Fix CI, Resolve Conflicts and Review have
pages of their own: [Resolve Comments](resolve-comments.md), [Fix CI](fix-ci.md),
[Resolve Conflicts](resolve-conflicts.md), [Review](review.md).

## The buttons

| Button | When | What it does |
|---|---|---|
| **Merge** | ready to merge, or waiting for review where the base requires none and GitHub says it can merge (checks green, no comments open); you can push to the repository, which allows a merge method; and auto-merge isn't on | Merges with the method you pick. |
| **Auto-Merge** | approved but held back (checks running, or a requirement such as a second approval), GitHub lets you turn on auto-merge, and it isn't on yet | Turns on auto-merge, so GitHub merges once nothing holds it back. |
| **Update Branch** | behind its base, where the base must be up to date to merge or the repository always suggests updating branches, and GitHub lets you update the branch; at any stage but draft, conflicts and in the merge queue | Merges the base branch in, or rebases onto it, as you pick. |
| **Re-Run CI** | CI failing, not a draft, and you can push to the repository | Re-runs the failed jobs of the failed GitHub Actions runs it names. |
| **Ready For Review** | a draft, as its main button | Marks it ready for review. |
| **Re-Request Review** | someone requested changes, commits came after their latest review, and they aren't asked again yet; not on a draft, and you need triage access to the repository; the main button while changes requested is the status | Asks them to review again, as GitHub's re-request does (only those who requested changes). Once everyone holding it back is asked, the row waits on them. |

## Each press checks GitHub first

The list can be minutes old, so each button first asks GitHub how the pull request stands now. Where that no longer fits
the button, the press says so, asks nothing, and the list refreshes:

| Button | Stops when the pull request |
|---|---|
| any | was merged meanwhile (it shows as ✓ Merged), or closed |
| **Merge**, **Auto-Merge** | has new commits, or GitHub moved it into another branch |
| **Auto-Merge** | has auto-merge on already |
| **Update Branch** | GitHub moved it into another branch, is up to date with its base already, or conflicts with it now |
| **Resolve Conflicts** | merges cleanly now |
| **Ready For Review** | is out of draft already |
| **Re-Request Review** | had its review re-requested already, or was turned back into a draft |

Where GitHub's answer can't be read, the question is asked all the same, as GitHub turns down a write that no longer
fits; a `gh` that needs setting up stops it.

## Your repository's rules

Everything follows the repository's own settings on GitHub, so it works the same in any repository, on github.com and
GitHub Enterprise. What you may do is GitHub's answer, not a guess: your permission on the repository, and whether you
may turn on auto-merge or update the branch. A contributor's pull request from a fork gets no **Merge** or
**Re-Run CI**. Branch protection (required reviews, required checks, an up-to-date branch) is GitHub's to enforce, and
the [statuses](pane.md#your-pull-requests) come from GitHub's own verdict.

- The merge dialog offers only the methods the repository allows (squash, merge commit, rebase), your usual one first.
- **Auto-Merge** shows only where the repository allows auto-merge.
- **Update Branch** shows where GitHub's own page would offer it: the base requires an up-to-date branch, or the
  repository has "Always suggest updating pull request branches" on. A branch merely behind, in a repository that
  needs neither, gets no button.
- The branch is deleted after a merge only if the repository deletes head branches automatically.

## Merging and updating

A merge is pinned to the commit the pane showed. A push since the list was read is caught at the press, before anything
is asked; one while the question is open makes GitHub refuse the merge, and the alert says so. A pull request you
merged stays where it was for a moment, as ✓ Merged (in the theme's merge colour) with no buttons, until GitHub's
search has caught up and stops listing it as open, about 15 seconds. The status line no longer counts it.

Where the base branch requires a merge queue, **Merge** puts the pull request in the queue. The alert says what came of
it as GitHub reports it afterwards: merged, in the merge queue, or merging once nothing holds it back; where GitHub's
report can't be read, that the merge was sent to GitHub.

A pull request in a stack (GitHub's stacked pull requests) merges the only way GitHub allows: in the background, through
its asynchronous merge, into the stack's base, together with every open pull request below it. The dialog says where it
sits in the stack and names those, and the alert says when it is merged, queued or failed; a merge still under way after
a minute is left to GitHub, and a later refresh shows how it ended. **Auto-Merge** is not offered, as GitHub doesn't
merge a stacked pull request automatically. Pressing **Merge** again while GitHub is still merging it follows that merge
rather than starting another.

**Update Branch** says so when the branch was already up to date, also when it became so between the press and the
update. Rebasing rewrites the branch's commits on GitHub, so a copy of it in this folder needs checking out again (the
dialog says so); the worktree /prs made for it ([Where the branch skills work](working-on-a-branch.md)) is brought up to
date next time, when nothing in it would be lost.

## Re-running CI

A re-run first checks that the pull request's latest commit is the one the pane showed; if new commits arrived, nothing
is re-run and the list refreshes, as where none of its GitHub Actions runs is failing any more (re-run already). Of a
workflow that ran more than once on that commit, only its latest run counts, so a run a newer one cancelled is left
alone. Checks from a service other than GitHub Actions can't be re-run from here; the alert says so and nothing is
asked.

## The dialog

A pull request's buttons ask first. Review does not where it can only run here, nor does Re-Run CI when there is nothing
it could re-run (above). The question takes the list's place in the pane where the button was pressed, framed:

- what kind of question it is, and the pull request's number and title;
- the question, with what each answer does or costs dimmed under it;
- for Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR, a field for instructions (not in the phone
  app); they go with the answer you then press, or Enter sends them alone;
- a button for each answer; on a confirmation, the one that does what you pressed for is drawn as the main one.

Where the pane holds the keyboard, as after a press in the terminal, it moves onto the first answer, with the field one
step back: arrow keys or Tab, then Enter. Escape cancels, as the pane's close mark does then, and leaves the pane open
with the keyboard back at the prompt. Should the question still show after that, as when Claude Code never answers the
plugin's call to put it away, the next Escape or close closes the pane, and it opens again on the list; an answer given
goes ahead all the same. Once answered, the list comes back scrolled as you left it (in VS Code, to the button you
pressed), with the keyboard back on the button where the pane holds it.

The question is never part of the conversation or a turn, so it never interrupts Claude, and one asked while you work
with Claude stays out of the chat. One question at a time: a button pressed while one is open says so and leaves its row
as it was. A question taller than the pane scrolls with it. Where the pane doesn't show when the question comes,
because it closed since the press or is behind another pane, Claude Code's own question dialog asks instead, with
instructions typed under **Other**.

## While a skill is at work

While the turn a skill starts with runs (reading the pull request, drafting, triaging), its row says **Reviewing…**,
**Resolving Comments…**, **Fixing CI…** or **Resolving Conflicts…** in place of its buttons (Create PR's button,
**Creating PR…**), so it can't be started twice; pressed while another turn runs, it first says it starts when that turn
ends. As that turn ends, answered or interrupted with Esc, the buttons come back: the skill then waits for you in the
conversation, or is done. A review, Resolve Comments, Fix CI, Resolve Conflicts or Create PR typed in a session is shown
the same way, so a session a button opened shows it on its own pane.

While a bundled skill is at work, started by a pane button or typed, the list refreshes after each of its turns, at most
every half minute and for half an hour, so replies, resolved threads and pushes show without waiting for the next check,
and what they find is alerted like a regular check. It follows the **Refresh** setting: always in background mode, while
the pane is open with **Refresh** set to while-open ([Settings](settings.md)), never on demand.
