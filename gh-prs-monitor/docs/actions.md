# Acting on GitHub

The buttons on your pull requests do the next thing for you: merge what is ready, update a branch that fell behind,
re-run a flaky check, ask someone to review. A button shows when the pull request's state calls for it and your access
allows it.

Every button that writes to GitHub asks first, in [the plugin's dialog](#the-dialog), and says what it will do. Cancel
or Escape writes nothing.

Resolve Comments, Fix CI, Resolve Conflicts and Review start a skill (a guided workflow Claude runs for you) and have
pages of their own: [Resolve Comments](resolve-comments.md), [Fix CI](fix-ci.md),
[Resolve Conflicts](resolve-conflicts.md), [Review](review.md).

## The buttons

| Button | What it does | When it shows |
|---|---|---|
| **Merge** | Merges with the method you pick. | The pull request can merge. |
| **Auto-Merge** | Turns on auto-merge, so GitHub merges once nothing holds it back. | Approved but held back. |
| **Update Branch** | Merges the base branch in, or rebases onto it, as you pick. | The branch is behind its base. |
| **Re-Run CI** | Re-runs the failed jobs of the failed GitHub Actions runs it names. | CI is failing. |
| **Ready For Review** | Marks the draft ready for review. | The pull request is a draft (its main button). |
| **Request Review** | Asks the people you pick among GitHub's suggestions, as GitHub's request for reviewers does. | No person is asked to review it, and GitHub suggests someone. |
| **Re-Request Review** | Asks those who requested changes to review again, as GitHub's re-request does. | Commits came after a requested change. |

### When each one shows

- **Merge**: the pull request is ready to merge, or waiting for review where the base requires none and GitHub says it
  can merge (checks green, no comments open). You can push to the repository, which allows a merge method, and
  auto-merge isn't on.
- **Auto-Merge**: the pull request is approved but held back, by running checks or a requirement such as a second
  approval. GitHub lets you turn on auto-merge, and it isn't on yet.
- **Update Branch**: the branch is behind its base, and the base must be up to date to merge or the repository always
  suggests updating branches. GitHub lets you update the branch. It shows at any stage but draft, conflicts and in the
  merge queue.
- **Re-Run CI**: CI is failing, the pull request is not a draft, and you can push to the repository.
- **Request Review**: either no person is asked to review it (a bot such as Copilot aside) and nobody has reviewed it
  yet, so its row reads "no reviewer requested" or "requested:" names only the bot; or it needs more approvals and no
  person is asked. GitHub suggests someone. It does not show on a draft or in the merge queue, and you need triage
  access to the repository. It is the main button while the pull request waits for review or for more approvals.
- **Re-Request Review**: someone requested changes, commits came after their latest review, and they aren't asked again
  yet. It does not show on a draft, and you need triage access to the repository. It is the main button while changes
  requested is the status. Once everyone holding the pull request back is asked, the row waits on them. It asks only
  those who requested changes.

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
| **Request Review** | was turned back into a draft |
| **Re-Request Review** | had its review re-requested already, or was turned back into a draft |

Where GitHub's answer can't be read, the question is asked all the same, as GitHub turns down a write that no longer
fits; a `gh` that needs setting up stops it.

## Request Review

**Request Review** offers the people GitHub suggests, those who earlier changed or reviewed the code a pull request
touches, and asks the ones you pick, as GitHub's request for reviewers does. It shows on your pull requests that no
person is asked to review (a bot such as Copilot aside), or that need more approvals with no person asked.

The button comes a moment after the list: after each refresh, the plugin asks GitHub for its suggestions in one small
request. It offers at most four people, leaving out the author, anyone asked already and anyone who approved. It asks
GitHub again when the pull request gets new commits or a review, after someone was asked from the pane, or after that
request failed.

Its dialog shows each person as a button that picks them (✓), with **Select All** beside two or more, which reads
**Clear** once everyone is picked. **Request Review** stays dim until someone is picked; Cancel or Escape asks nobody.
Where the pane doesn't show, Claude Code's own dialog asks instead, and you tick the names there.

Before asking, it looks at GitHub once more, as the dialog may have been open for minutes. Anyone asked meanwhile is
left out; if everyone you picked was, it says so and asks nobody. If the pull request was merged, closed or turned back
into a draft meanwhile, or gh is signed out, it asks nobody and says so. GitHub asks everyone you picked or nobody: if
it turns one down, someone without access to the repository say, it turns down the whole request, and the alert says
nobody was asked.

## Your repository's rules

Everything follows the repository's own settings on GitHub, so it works the same in any repository, on github.com and
GitHub Enterprise. What you may do is GitHub's answer, not a guess: your permission on the repository, and whether you
may turn on auto-merge or update the branch. The merge and CI buttons are for your own pull requests; those waiting on
your review offer **Review**. Branch protection (required reviews, required checks, an up-to-date branch) is GitHub's to
enforce, and the [statuses](pane.md#your-pull-requests) come from GitHub's own verdict.

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

## Other repositories

On the rows of a repository you show in the pane, the buttons work as here, except that Resolve Comments, Fix CI and
Resolve Conflicts offer to open a new session in that repository's clone:
[Buttons on its rows](other-repositories.md#buttons-on-its-rows).

## The dialog

A pull request's buttons ask first. Two don't: Review, where it can only run here, and Re-Run CI, when there is nothing
it could re-run ([Re-running CI](#re-running-ci)).

The question takes the list's place in the pane where the button was pressed, framed:

- what kind of question it is, and the pull request's number and title;
- the question, with what each answer does or costs dimmed under it;
- for Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR, a field for instructions (not where the pane is
  drawn somewhere that can't open a new session); they go with the answer you then press, or Enter sends them alone;
- a button for each answer; on a confirmation, the one that does what you pressed for is drawn as the main one.

### Answering

Where the pane holds the keyboard, as after a press in the terminal, it moves onto the first answer, with the field one
step back. Use the arrow keys or Tab, then Enter.

Escape cancels, as the pane's close mark does then, and leaves the pane open with the keyboard back at the prompt.
Should the question still show after that, as when Claude Code never answers the plugin's call to put it away, the next
Escape or close closes the pane, and it opens again on the list. An answer given goes ahead all the same.

Once answered, the list comes back scrolled as you left it (in VS Code, to the button you pressed), with the keyboard
back on the button where the pane holds it.

### Good to know

- The question is never part of the conversation or a turn, so it never interrupts Claude, and one asked while you work
  with Claude stays out of the chat.
- One question at a time: a button pressed while one is open says so and leaves its row as it was.
- A question taller than the pane scrolls with it.
- Where the pane doesn't show when the question comes, because it closed since the press or is behind another pane,
  Claude Code's own question dialog asks instead, with instructions typed under **Other**. One that only tells you
  something, with OK alone, comes as a toast there.
- `/prs demo`, `/prs tickets` or `/prs` with a repository cancels a question the pane is asking, as the pane then shows
  that instead.

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

## Where to go next

- [The pane](pane.md): the rows, their statuses and which button is the main one.
- [Settings](settings.md): what the buttons and the checks cost, and the **Refresh** setting.
- [Other repositories](other-repositories.md): the same buttons on another repository's rows.
