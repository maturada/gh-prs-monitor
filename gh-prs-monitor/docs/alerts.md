# Alerts and the status line

You don't need to keep the pane open to know what your pull requests are doing. By default, gh-prs-monitor checks them
in the background while you work and tells you when something changes: a review came in, CI failed, someone asked for
your review. Whether it checks by itself, and how often, are the **Refresh** settings ([Settings](settings.md)).

## What an alert looks like

Each check is compared with the one before. Every pull request that changed gets one line, shown as a toast: the
symbol of its first change, the pull request, and what happened, every change in turn.

```
✓ #146 Offline downloads — ready to merge, approved by ann
✓ #145 Fix the mobile menu labels — approved by ann, 2 new comments, the latest from ann
± #144 Track video engagement — changes requested by bob
✗ #142 Resize images on the CDN — CI failed, merge conflicts
⌕ #150 Add the chart legend (ann) — review requested
↻ #143 Move the settings page to the new… — new commits since your review
✓ #141 Show the map on the article page — merged by bob
@ #151 Cache the map tiles offline (ann) — you were mentioned
```

Toasts are for the checks nobody asked for: the regular ones, and those that follow a skill's work. When you look for
yourself, by opening `/prs` or pressing **Refresh**, what changed shows in the list instead, where you are already
looking: in the pane at the foot of each pull request, or, where the pane can't show, at the head of the list `/prs`
prints.

## What you are alerted about

You choose the kinds in `/config`, one **Alert** setting each. A kind you turn off also leaves its part out of a line:
with **Alert: comments** off, the second line above reads only `approved by ann`, and a pull request with nothing left
raises no alert.

| Kind | Alerts | Setting |
|---|---|---|
| Ready to merge | ✓ one of yours can merge now: approved, required checks green, nothing blocking | Alert: ready to merge |
| Comments | ✎ new comments in a pull request's conversation since your own last reply there, counted and the latest commenter named; comments on the diff come with their review, under Reviews | Alert: comments |
| Reviews | ✓ approved, ± changes requested, ✎ reviewed, by a person | Alert: reviews |
| CI | ✗ checks failed, ✓ checks passed after running or failing | Alert: CI |
| Conflicts | ⚠ new merge conflicts, also when GitHub was rechecking in between, as after a push to the base | Alert: conflicts |
| Review requests | ⌕ you are asked to review, or asked again | Alert: review requests |
| New commits | ↻ new commits on a pull request you reviewed without approving it (an approval takes it off your review list) | Alert: new commits |
| Mentions | @ someone else's open pull request mentions you, by your login, for the first time | Alert: mentions |
| Merged and closed | ✓ merged, ✕ closed, by someone else, or merged by an auto-merge you turned on or from the merge queue: yours, and the ones on your review list. A merged one in a stack names the next one up when that one is in your lists (`#1242 is next in stack #30`). | Alert: merged and closed |

Ready to merge, comments, reviews, CI and conflicts are about your own pull requests; review requests and new commits
about the ones waiting on your review; mentions about anyone else's open pull request in the repository.

## When alerts show

By default, alerts don't cut into Claude's work. While a turn runs, they wait and show together when it finishes, so
they don't cover what you are reading; a long turn shows what it held each quarter of an hour, then holds again. A
reload of the plugin during the turn keeps holding them for it, and **Hold alerts while working** turns the waiting off.

Coming back is quiet too. A session's first check compares with your last look and sums up everything in one toast,
`Since yesterday 17:40, 3 pull requests changed — see /prs`, and marks the changes in the pane; so does the first
check after the desktop app's window opens again. With the pane already open and in front, the marks are enough, and
no toast shows.

A check never shows more than three toasts: with more pull requests changed, you get two of them and a count of the
rest. Each stays up for the **Alert duration**; hovering keeps it, and a click dismisses it.

If you work in several sessions in one repository, worktrees side by side say, each change still shows once. The first
session to show it notes it in the plugin's store, and the others leave it out for a while. The sessions share
GitHub's answers too ([cost](settings.md#cost)), so a change one of them saw usually reaches the others' lists and
status lines within 20 seconds, its alert still shown once. This holds in the terminal, VS Code and the desktop app
alike.

## Sound and system notifications

**Alert sound** plays a short chime with the toasts. It's off by default and macOS only, as Linux and Windows terminals
have no player.

**Alerts as system notifications** reaches you when Claude Code isn't in front. It sends the alerts of the kinds you
turned on as a system notification too, one each time they show, with the first alert's line and how many came with it,
under the repository's name. Only pull request changes go out, not the summary when a session starts or a cleanup's
note. They go the way Claude Code's own notifications go, through its `preferredNotifChannel` setting: a banner in
iTerm2, kitty or Ghostty, and your own `Notification` hooks wherever they run. Another terminal shows them once you
choose a channel there: Warp, for one, shows them with the channel set to `iterm2`, while `terminal_bell` rings the bell
without the text. Left to choose by itself in such a terminal, Claude Code sends nothing, for its own notifications too.
The desktop app and VS Code show nothing more unless a `Notification` hook does. A notification goes out whether or not
Claude Code is in front, and the terminal decides whether a banner shows over itself; macOS shows one only for a
terminal its Notifications settings allow. It's off by default, needs Claude Code 2.1.295, and the toasts show either
way.

## What doesn't alert

- Bots' comments and reviews (issue trackers, code assistants, dependency updaters), and your own comments, merges and
  closes. A review request or a mention on a bot's pull request still does, as someone asked for you.
- A pull request closed and reopened, for a review request or a mention you were already told of, provided that,
  within 10 seconds of the check that saw it leave the lists, GitHub answered that it was closed (a slower answer, or
  none, means it alerts again). One that left your review list while still open, as your approval takes it off, alerts
  again when it asks for your review.
- While the search for review requests, or for mentions, came back full (30, the most it lists), a pull request new to
  it can't be told from one coming back into its first 30: a review request on one new to the list, and any mention,
  alert nothing then.
- After the plugin reloads, its first check shows no toasts, except with **Refresh** set to while-open and the pane
  open, where the next check is the timer's, which alerts as usual.

## The status line

With background refresh, the status line under the prompt (a band above it in the desktop app) keeps count of what is
ready to merge, what needs you, and what waits on your review, and clears when there is nothing to report:

```
PRs ✅ 1 Ready  ❗ 2 Need You  🔍 1 To Review  (/prs)
```

The band, the pane's header and the list `/prs` prints draw each number in bold; a status line is plain text, so there
it stays as it is.
