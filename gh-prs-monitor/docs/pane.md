# The pane

| Command | What it does |
|---|---|
| `/prs` | Opens the pane. Esc closes it. **Refresh**, or `r` while the pane has the keyboard, reloads it. Works while a turn is running. Typed in the desktop app before its window has joined the session, as in the first moments of a new one, it prints the list, and the pane opens as the window joins, within 10 minutes. |
| `/prs close` | Closes the pane, as its close mark does, and takes down a question it asks. For when a click does nothing. |
| `/prs demo` | Shows example pull requests, one of each status, one just merged from the pane and one merged by someone else, in the pane, the status line and the desktop app's band, while their alerts show one after another (with the alert sound when it is on). The examples' buttons ask what the real ones ask, and send nothing to GitHub. They stay until you close the pane; **Refresh** or `/prs` brings your own list back in it. In VS Code, or an app that places no panes, it prints the example list. |
| `/prs report` | Prints links to report a bug, with the versions of the plugin, Claude Code, the system, `gh` and git filled in, to suggest an idea, and to the issues already open; and the `gh issue create` command for the plugin's repository. Nothing else of yours goes in the link. The conversation sees the text too, so you can ask for help writing the report. |

Any other word after `/prs` does nothing but say what it takes.

The pane shows two panels, **Your Pull Requests** and **Waiting On Your Review**. At 120 columns or more, as when the
pane opens inline at full width, they sit side by side; narrower, as when it is docked beside the conversation, one sits
above the other. A list with nothing in it takes one line and leaves the full width to the other. Each lists what needs
you first: failing and conflicting, then waiting on you, then ready to merge, then waiting on others, drafts last. A
long list scrolls inside the pane.

Each search returns the 30 most recently updated pull requests. When GitHub has more, the panel says so and links to a
list on GitHub: your open pull requests, or, for the review panel, every open pull request of others that involves you,
including those that only mention you.

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
  stays plain.
- **The main button** is the one that moves the row on (table below), drawn apart from the others.
- **A draft's title** is dimmed, and the pointer on a row lights its title. In a narrow pane a long title wraps in its
  own column, never cut short, as the details do, while the status keeps a line of its own.
- **A bold green `●`** in front of the number (not the yellow `●` of running checks) marks the pull request whose
  branch, or `pr-<number>`, this session is on. After you switch branches, the mark follows on the next refresh. Only a
  panel holding that pull request makes room for it.

| Status | Main button, where the row offers it |
|---|---|
| Ready To Merge | **Merge** |
| Conflicts | **Resolve Conflicts** |
| CI Failing | **Re-Run CI**, or **Fix CI** where you can't re-run it |
| Changes Requested | **Re-Request Review** once commits came after the change request, else **Resolve Comments** |
| Comments To Address | **Resolve Comments** |
| Approved (checks running), Approved · More Approvals Needed | **Auto-Merge** |
| Approved · Merge Blocked | **Resolve Comments** where it has open comments, else **Auto-Merge** |
| Approved · Behind Base | **Update Branch** |
| Draft | **Ready For Review** |
| Review Requested, Re-Review Requested, Updated Since Your Review, Your Review Was Dismissed | **Review** |

The header names the repository, as a link to its pull requests on GitHub, with the same counts as the status line and
when the list was read (`updated 09:12`, or `updated yesterday 17:40` where it isn't today). **Compact** and **Refresh**
sit beside it, or on a line of their own in a narrow pane. A problem reaching GitHub shows in a box above the list
([When something is wrong](troubleshooting.md)).

**Compact** shows each pull request on one line: its number and title on the left, its status on the right. Where a
panel is too narrow for both, the status goes on a second line under the title, and a long title wraps under itself.

- A stacked one shows its stack and place (`stack #30 2/4`) right before the status.
- A blue • after the title marks one that changed since you last looked.
- What is under way (`Merging…`) shows in place of its status.

**Full** brings back the details, the buttons and what changed. The pane keeps the view you chose for later sessions.

With nothing open and nothing waiting, the pane says just that, centred under the header. Before the first list, the
line there says it is checking GitHub, or, where nothing will check by itself, to press Refresh.

```
  #142 Resize images on the CDN •                 ❗ Conflicts
● #145 Fix the mobile menu labels            ✅ Ready To Merge
```

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

A note stays until the first of these: half an hour has passed since a refresh noticed the change (the **Recent
changes expire after** setting); you press its ✕ or one of that pull request's buttons; you close the pane. So a toast
you missed is still there when you look, and a pane left open all day shows only what changed lately.

Changes from while you were away show too, saying `in the last 15h`. The first refresh of a session compares with your
last look, the list as you last saw it in any session ([more](#your-last-look)). The first after the desktop app's
window opens again compares with the last check before it closed. Instead of an alert per change, one toast then tells
how many pull requests changed. The alert settings pick which changes are marked.

A pull request merged or closed by someone else has no row left, so its note shows under the lists instead: a line each
under "Merged or closed since" and the time, with its ✕. These go as the other notes do.

## Where each part shows

| | Terminal | Desktop app | VS Code extension |
|---|---|---|---|
| The list | the pane | the pane | the pane |
| Alerts | toasts | toasts | toasts, above the prompt box |
| Summary | the status line | a band above the prompt, with an **Open** button (the app cuts a status line short) | the status line, above the prompt box |
| `#` in the prompt | the prompt's suggestions | not yet | not yet |

Over Remote Control, the Claude app on your phone and claude.ai draw none of it yet. A `/prs` sent from there prints
the list in the conversation and opens the pane on the computer too; `/prs demo` prints the example list and shows the
examples on the computer. Once they draw the pane, `/prs` opens it there instead, with no update of the plugin.

The VS Code extension, in VS Code or an editor built on it such as Cursor, draws what plugins add from its version
2.1.299, in a session that
[fetches feature flags](https://code.claude.com/docs/en/env-vars#features-that-need-feature-flag-fetching). It lays the
pane out in rows of text as the terminal does, with the desktop app's buttons and cards, and opens a new session as a
tab of the editor (**New session**, see [Review](review.md)).

Where nothing draws what plugins add, as in an older extension or a `claude -p` run, only a command's own output shows,
rendered as markdown. So `/prs` prints the list there as tables under a heading with the pane header's counts and time,
led by what changed since you last looked. Each number links to its pull request, and statuses and details link where
they are dealt with, as in the pane: CI to the checks (a green one too), unresolved comments to the changed files,
conflicts to GitHub's page for resolving them. As in the pane, a `●` in front of the number marks the pull request whose
branch the session is on, details are parted by dots, an empty list is one line, and with nothing in either list a
single line says so. The list there is already one row per pull request, with the details in a column of their own, so
the pane's compact view has nothing to change in it.

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

### Your last look

Your last look is the list as you last saw it, in any session: the pane while open (and as you closed it), or a `/prs`
printed where no pane shows. A toast you may not have seen doesn't count. It is kept for each repository across
sessions, for the 20 repositories you looked at last. The terminal's and VS Code's sessions keep one last look, and
the desktop app's another, as Claude Code keeps the plugin's store apart for the desktop app.

In the list `/prs` prints:

- the alert settings pick which changes are listed (none with **Change alerts** off);
- the first `/prs` in a repository prints the list alone;
- with nothing changed, the line reads `Nothing new since 17:40`;
- `/prs demo` prints the example list.

No background checks run there, since nothing would show what they find. The same list with what changed comes from
`/prs` wherever the pane can't show, whatever toasts told you meanwhile. An extension updated to one that draws gets
the pane, alerts and summary by itself.

### `#` in the prompt

Type `#` and the start of a pull request's number, or two letters or more of a word in its title, and the prompt's
suggestions offer the pull requests of the last list, yours first, then those waiting on your review, eight at most,
each with its status. Picking one writes its number, `#142`. A bare `#` offers none, and nothing shows before a list
has loaded, nor from the demo's examples. The terminal asks for these; the desktop app and VS Code don't ask plugins
for suggestions yet, and get them once they do, with no update of the plugin.

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

**Review** runs the bundled review skill for that pull request, here or in a new session: see [Review](review.md).
