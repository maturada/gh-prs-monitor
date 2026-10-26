# The pane

`/prs` opens the pane: the pull requests you opened and the ones waiting on your review, sorted so that what needs you
comes first, each with the one status that matters and the buttons that move it on. Use it to see what to deal with
next, and to deal with it in one press. Esc closes it.

## Two lists, what needs you first

The pane shows two panels, **Your Pull Requests** and **Waiting On Your Review**. At 120 columns or more, as when the
pane opens inline at full width, they sit side by side; narrower, as when it is docked beside the conversation, one sits
above the other. A list with nothing in it takes one line and leaves the full width to the other. A long list scrolls
inside the pane.

Each lists what needs you first: failing and conflicting, then waiting on you, then ready to merge, then waiting on
others, drafts last. With **Hide my drafts** on ([Settings](settings.md)), your own drafts leave the list and the
counts, and a line under the list says how many are hidden. Drafts you are asked to review still show.

Each search returns the 30 most recently updated pull requests. When GitHub has more, the panel says so and links to a
list on GitHub: your open pull requests, or, for the review panel, every open pull request of others that involves you,
including those that only mention you.

With nothing open and nothing waiting, the pane says just that, centred under the header. Before the first list, the
line there says it is checking GitHub, or, where nothing will check by itself, to press ↻ (Refresh).

Every status, and the main button each one gets, is listed under [Your Pull Requests](#your-pull-requests) and
[Waiting On Your Review](#waiting-on-your-review) below.

## Reading a row

Each pull request reads like a row of a table: its number and title, then under them its status, its details and its
buttons, every line starting past the panel's widest number. A rule parts the rows; the desktop app, which draws no such
rule, shows each as a card of its own.

- **The status** is bold in its colour and marked the way the status line counts it, so the list reads at a glance: ✅
  ready to merge (green), ❗ needs you (yellow, or red when failing or conflicting), 🔍 waiting on your review. One that
  waits on someone else is dimmed, so it doesn't read as a second title. Green in the status stays for what can merge
  now.
- **The details**, parted by dots, stay dim, except for a CI result's mark (✓ green, ● yellow while checks run, ✗ red)
  and good news in green: an approval, auto-merge on. They link to where each is dealt with: the CI result to the
  checks, unresolved comments to the changed files, conflicts to GitHub's page for resolving them; a green CI result
  stays plain. With [ticket links](tickets.md), the pull request's ticket comes first, `WEB-5785 ⧉`, linked to the
  ticket; the ⧉ marks the one link that leaves GitHub.
- **The main button** is the one that moves the row on, drawn apart from the others. [Which one](#main-buttons)
- **A draft's title** is dimmed, and the pointer on a row lights its title. In a narrow pane a long title wraps in its
  own column, never cut short, as the details do, while the status keeps a line of its own.
- **A bold green `●`** in front of the number (not the yellow `●` of running checks) marks the pull request whose
  branch, or `pr-<number>`, this session is on. After you switch branches, the mark follows on the next refresh. Only a
  panel holding that pull request makes room for it.

## The header

The header names the repository, as a link to its pull requests on GitHub, with the same counts as the status line and
when the list was read (`updated 09:12`, or `updated yesterday 17:40` where it isn't today). **Repositories**,
**Compact** and **↻** (Refresh) sit beside it, or on a line of their own in a narrow pane.

**Repositories** opens the picker for [another repository's](other-repositories.md) pull requests. With **Alerts from
other repositories** on, a dim `+3 elsewhere` beside the name counts what waits for you there
([what counts](other-repositories.md#3-elsewhere-in-the-header)).

While the pane shows another repository, its header says "Not this session's folder" and offers **←** (Back) to this
folder's list ([Other repositories](other-repositories.md#showing-another-repository)).

While the pane has the keyboard, a key presses each of the header's buttons: `r` **↻**, `c` **Compact** or **Full**,
`p` **Repositories**, and `b` **←** on a visit; not while a question takes the pane's place, nor in the VS Code
extension, which has no keys for buttons. The desktop app shows each key on its button.

A problem reaching GitHub shows in a box above the list ([When something is wrong](troubleshooting.md)).

## Compact view

**Compact** shows each pull request on one line: its number and title on the left, its status on the right. Where a
panel is too narrow for both, the status goes on a second line under the title, and a long title wraps under itself.

```
  #142 Resize images on the CDN •                 ❗ Conflicts
● #145 Fix the mobile menu labels            ✅ Ready To Merge
```

- A stacked one shows its stack and place (`stack #30 2/4`) right before the status.
- A blue • after the title marks one that changed since you last looked.
- What is under way (`Merging…`) shows in place of its status.

**Full** brings back the details, the buttons and what changed. The pane keeps the view you chose for later sessions.

![The compact pane, in a terminal and in the desktop app](../assets/screenshots/compact.png)

## What changed

What changed lately shows as a note at the foot of its pull request, under the buttons and a line of space: in blue
italics, the changes parted by dots, how long ago, and a ✕ that marks them seen. A change that came again since, as
a reviewer posting single comments one after another, shows once with how many times it came: `reviewed by ann ×3`.

```
#142 Resize images on the CDN
     ❗ Conflicts
     CI ✗ · requested: ann
     [ Resolve Conflicts ] [ Re-Run CI ] [ Fix CI ]

     ✗ CI failed · merge conflicts  2m ago  ✕
```

A note stays until the first of these: half an hour has passed since a refresh noticed the change (**Change notes last
(minutes)** in [Settings](settings.md)); you press its ✕ or one of that pull request's buttons; you close the pane. So a
toast you missed is still there when you look, and a pane left open all day shows only what changed lately.

A pull request merged or closed by someone else has no row left, so its note shows under the lists instead: a line each
under "Merged or closed since" and the time, with its ✕. These go as the other notes do.

Changes from while you were away show too, saying `in the last 15h`. The first refresh of a session compares with
[your last look](#your-last-look). The first after the desktop app's window opens again compares with the last check
before it closed. Instead of an alert per change, one toast then tells how many pull requests changed. The alert
settings pick which changes are marked.

## A branch that merged

When the branch your checkout is on has merged, at the commit you have, a note above the lists says so: `You're on
feature/x, merged into main as #1242`, with **Switch to main** (to whichever branch it merged into, a stack's lower
branch too) and a ✕ that puts it away for this branch at this commit. Only pull requests from this repository's own
branches count, not a fork's. None shows where an open pull request in your lists merges into the branch, as a
long-lived `develop`, or is open from it again; where another worktree has the base checked out; nor on `/prs`'s own
`pr-<number>` branch, on a visit, in the examples, or in a folder with no list.

**Switch to main** waits for a turn under way to end, fetches the base and switches this checkout to it: it makes your
local base, or brings it up to GitHub's (one with commits of yours ahead is taken as it is), installs what a changed
lockfile needs, and deletes the merged branch where it is still at the merged commit and no pull request is open from
it; its work stays in the merged pull request on GitHub. It changes nothing, and says why, where:

- you have uncommitted changes to files git tracks, or the checkout moved since the note showed;
- your base has commits GitHub's doesn't, while GitHub's has others;
- another worktree has the base checked out, or a file git doesn't track here is in the base's way;
- a merge, rebase or other git operation is under way;
- the base can't be fetched, as when it was deleted on GitHub;
- a skill is starting here.

## Your last look

Your last look is the list as you last saw it, in any session: the pane while open (and as you closed it), or a `/prs`
printed where no pane shows. A toast you may not have seen doesn't count. It is kept for each repository across
sessions, in the terminal, VS Code and the desktop app alike, for the 20 repositories you looked at last.

Where no pane shows, `/prs` prints the list with what changed since that look, and runs no background checks, since
nothing would show what they find:

- the alert settings pick which changes are listed (none with **Change alerts** off);
- the first `/prs` in a repository prints the list alone;
- with nothing changed, the line reads `Nothing new since 17:40`;
- `/prs demo` prints the example list.

This gives the same list with what changed wherever the pane can't show, whatever toasts told you meanwhile. An
extension updated to one that draws gets the pane, alerts and summary by itself.

## `#` in the prompt

`#` in the prompt offers no pull requests in this version; its suggestions come back in a later one.

## Commands

- **`/prs`** opens the pane, and Esc closes it. **↻** reloads it. It works while a turn is running. Typed in the desktop
  app before its window has joined the session, as in the first moments of a new one, it prints the list, and the pane
  opens as the window joins, within 10 minutes.
- **`/prs close`** closes the pane, as its close mark does, and takes down a question it asks: for when a click does
  nothing.
- **`/prs demo`** shows example pull requests, one of each status, one just merged from the pane and one merged by
  someone else, in the pane, the status line and the desktop app's band, while their alerts show one after another (with
  the alert sound when it is on). The examples' buttons ask what the real ones ask, and send nothing to GitHub. They
  stay until you close the pane; **↻** or `/prs` brings your own list back in it. Its **Repositories** picker offers
  four made-up repositories, one of them cloned; **Open** visits them, and their buttons ask as a real visit's do. With
  **Alerts from other repositories** on, the header shows `+6 elsewhere` and one more alert follows, from another
  repository. Nothing is read or written. Where no pane shows, as with nothing attached or in an app that places no
  panes, it prints the example list.
- **`/prs acme/web`** (or an address, or a folder's path) shows that repository's pull requests:
  [Other repositories](other-repositories.md).
- `/prs demo`, `/prs acme/web` and `/prs tickets` take the place of a question the pane is asking, which is cancelled;
  a question in Claude Code's own dialog stays.
- **`/prs report`** prints links to report a bug, with the versions of the plugin, Claude Code, the system, `gh` and
  git filled in, to suggest an idea, and to the issues already open; and the `gh issue create` command for the
  plugin's repository. Nothing else of yours goes in the link. The conversation sees the text too, so you can ask for
  help writing the report.
- **`/prs tickets`** sets up [ticket links](tickets.md) for the repository, from a link to any ticket you paste in the
  pane, and once they are set up shows them and what they find in your list, with **Add a link**, **Remove** and
  **Done**. Where no pane shows, as over Remote Control, it prints what is set up.

Anything else after `/prs` does nothing but say what it takes.

## Other repositories

The header's **Repositories** button, or `/prs acme/web`, `/prs ~/code/web` or a pull request's address, shows another
repository's pull requests in the pane, with **←** (Back) to this folder's list.
[Other repositories](other-repositories.md)

## Main buttons

The status of a row picks its main button:

| Status | Main button, where the row offers it |
|---|---|
| Ready To Merge | **Merge** |
| Conflicts | **Resolve Conflicts** |
| CI Failing | **Re-Run CI**, or **Fix CI** where you can't re-run it |
| Changes Requested | **Re-Request Review** once commits came after the change request, else **Resolve Comments** |
| Comments To Address | **Resolve Comments** |
| Waiting For Review, nobody asked and no review yet (a bot aside) | **Request Review**, once GitHub suggests someone |
| Approved · More Approvals Needed | **Request Review** where no person is asked and GitHub suggests someone, else **Auto-Merge** |
| Approved (checks running) | **Auto-Merge** |
| Approved · Merge Blocked | **Resolve Comments** where it has open comments, else **Auto-Merge** |
| Approved · Behind Base | **Update Branch** |
| Draft | **Ready For Review** |
| Review Requested, Re-Review Requested, Updated Since Your Review, Your Review Was Dismissed | **Review** |

## Your Pull Requests

Each gets the one status that matters most, in this order:

| Status | When |
|---|---|
| Draft | The pull request is a draft. |
| In Merge Queue | It is in its base branch's merge queue, which merges it once the queue's checks pass. |
| Conflicts | It has merge conflicts with its base. |
| CI Failing | A check failed or errored, unless only checks the base doesn't require failed on an approved one. |
| Changes Requested | A reviewer's latest verdict asks for changes. Verdicts count as on GitHub, only from people who can push to the repository. |
| Waiting For Re-Review | Changes were requested, and you asked each reviewer who requested them to look again. |
| Approved · More Approvals Needed | Approved, but by fewer people than the base requires, or not yet by a code owner. |
| Approved | Approved; checks still running, shown as `CI ●` under it. |
| Approved · Behind Base | Approved, but the branch must be updated with its base. |
| Approved · Merge Blocked | Approved, but branch protection still blocks the merge (conversations to resolve or a missing required check, say). |
| Approved · Checking Mergeability | Approved; GitHub is still working out whether it can merge, as after a push to the base. The next refresh tells. |
| Ready To Merge | Approved, the checks the base requires green, and GitHub says it can merge. Others failing show as `CI ✗` under it, with **Re-Run CI** and **Fix CI**. |
| Comments To Address | Not approved yet, and a reviewer left comments nobody has resolved. A comment you answered counts until its thread is resolved, as **Resolve Comments** does; a bot's comments alone don't count. |
| Waiting For Review | Not approved yet; checks still running show as `CI ●` under it. Where the base requires no review, it offers **Merge** once GitHub says it can merge, its checks green and no comments open. |

Under the status, as they apply:

- the CI result, left out where the status already says CI is failing;
- the stack it is in (GitHub's stacked pull requests) and its place from the bottom, `stack #30 2/4`, counting those
  merged or closed below it, as GitHub does;
- who approved, asked for changes or only commented in a review, with how long ago the latest of each came
  (`approved: ann 2h ago`);
- while it waits on reviewers, who is requested, people, bots and teams alike; or "no reviewer requested", and "no
  re-review requested" once someone left feedback, as GitHub takes a reviewer off the requested ones when they review;
- the count of unresolved review comments, of the latest hundred review threads; comments on code that has since
  changed (outdated) are left out unless the **Count outdated comments** setting is on;
- "behind main" (the base's name) when **Update Branch** is offered and the status doesn't already say so;
- "auto-merge on" once you turned it on.

**Resolve Comments** appears when there are unresolved comments or changes were requested, and the buttons in
[Acting on GitHub](actions.md) when their state calls for them. **Create PR** shows in the panel's title line when
this session's branch has no pull request yet. [Create PR](create-pr.md)

## Waiting On Your Review

Pull requests you are asked to review, or have commented on or reviewed. One stays here until your own latest verdict is
an approval, and a new review request brings it back. A comment after approving doesn't bring it back where you can push
to the repository. For a reviewer who can't, GitHub names only their latest review, so a comment after their approval
keeps it here. A request to a team of yours counts until you review; after that the pull request shows where your own
review left it.

| Status | When |
|---|---|
| Review Requested | You are asked to review, and haven't yet. |
| Re-Review Requested | You are asked again after reviewing. |
| Updated Since Your Review | New commits since the commit you reviewed. |
| Your Review Was Dismissed | Your review was dismissed. |
| Waiting On Author | You asked for changes and nothing was pushed since. |
| You Commented | You took part; nothing new since. |

Under it: the author, how much the pull request changes (`+120 −30, 8 files`, to pick what to review first), "draft" for
a draft, the CI result, the stack it is in (`stack #30 2/4`), who approved, and the count of unresolved review comments.

**Review** runs the bundled review skill for that pull request, here or in a new session: see [Review](review.md). On
Re-Review Requested and Updated Since Your Review, it also asks whether to review only what changed since your review
or the whole pull request again: see [Since your review](review.md#since-your-review).

## Where each part shows

| | Terminal | Desktop app | VS Code extension |
|---|---|---|---|
| The list | the pane | the pane | the pane |
| Alerts | toasts | toasts | toasts, above the prompt box |
| Summary | the status line | a band above the prompt, with an **Open** button (the app cuts a status line short) | the status line, above the prompt box |

![The Claude desktop app: the conversation, the summary band above the prompt, and the /prs pane beside them](../assets/screenshots/desktop.png)

Over Remote Control, the Claude app on your phone and claude.ai draw none of it yet. A `/prs` sent from there prints
the list in the conversation and opens the pane on the computer too; `/prs demo` prints the example list and shows the
examples on the computer. Once they draw the pane, `/prs` opens it there instead, with no update of the plugin.

The VS Code extension, in VS Code or an editor built on it, draws what plugins add from its version 2.1.299, in a
session that [fetches feature flags](https://code.claude.com/docs/en/env-vars#features-that-need-feature-flag-fetching).
It lays the pane out in rows of text as the terminal does, with the desktop app's buttons and cards, and opens a new
session as a tab of the editor (**New session**, see [Review](review.md)).

![The /prs pane in an editor built on VS Code, beside the Claude Code chat with the count above its prompt, and Fix CI's question in place of the list](../assets/screenshots/vscode.png)

Where nothing draws what plugins add, as in an older extension or a `claude -p` run, only a command's own output shows,
rendered as markdown. So `/prs` prints the list there as tables under a heading with the pane header's counts and time,
led by what changed since you last looked. Each number links to its pull request, and statuses and details link where
they are dealt with, as in the pane: CI to the checks (a green one too), unresolved comments to the changed files,
conflicts to GitHub's page for resolving them. As in the pane, a `●` in front of the number marks the pull request whose
branch the session is on, details are parted by dots, an empty list is one line, and with nothing in either list a
single line says so. The list there is already one row per pull request, with the details in a column of their own, so
the pane's compact view has nothing to change in it. For example:

> **[acme/app](#)** · ✅ **1** · ❗ **1** · updated 09:12
>
> **Since You Last Looked** (yesterday 17:40)
>
> | Pull request | What changed |
> | --- | --- |
> | [#142](#) Resize images on the CDN | ⚠ merge conflicts |
> | [#145](#) Fix the mobile menu labels | ✓ ready to merge · approved by ann · new comment from ann |
>
> **Your Pull Requests** (2)
>
> | Pull request | Status | Details |
> | --- | --- | --- |
> | ● [#142](#) Resize images on the CDN | ❗ [Conflicts](#) | [CI ✓](#) · requested: ann · [2 unresolved comments](#) |
> | [#145](#) Fix the mobile menu labels | ✅ Ready To Merge | [CI ✓](#) · approved: ann 2h ago |
>
> **Waiting On Your Review** (0) — _Nothing waits on your review._
