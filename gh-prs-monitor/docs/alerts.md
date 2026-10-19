# Alerts and the status line

While refreshes run (see **Refresh** in [Settings](settings.md)), each one is compared with the last. What changed
shows in one of two ways:

- **As an alert** (a toast), for the refreshes nobody asked for: the regular checks, and the refreshes that follow a
  skill. Each pull request that changed raises one alert: the symbol of its first change, the pull request, and what
  happened, every change in turn.
- **In the list**, when you open `/prs` or press **Refresh**, as you are looking at it then: in the pane at the foot of
  each pull request, or, where the pane can't show, at the head of the list `/prs` prints.

A session's first refresh, which compares with your last look, raises one toast for all of it: `Since yesterday 17:40, 3
pull requests changed — see /prs`. So does the first after the desktop app's window opens again.

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

The alert settings decide what is in a line: with **Alert: comments** off, the second line reads only
`approved by ann`, and a pull request with nothing left raises no alert.

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
about the review list; mentions about anyone else's open pull request in the repository.

**What doesn't alert**

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

**How many, and for how long**

- The first check after a session starts shows one toast, saying how many pull requests changed while you were away
  (none when the pane is already open and in front), and marks the changes in the pane.
- A refresh shows at most three toasts: with more pull requests changed, two of them and a count of the rest.
- Each stays up for the **Alert duration**; hovering keeps it, a click dismisses it.

- **While a turn runs**, alerts wait and show together when it finishes, so they don't cover what you are reading (a
  long turn shows what it held each quarter of an hour, and holds again; **Hold alerts while working** turns this
  off). A reload of the plugin during the turn keeps holding them for it.
- **Several sessions in one repository** (worktrees side by side, say) show each change once: the first session to show
  it notes it in the plugin's store, and the others leave it out for a while. They share GitHub's answers too
  ([cost](settings.md#cost)), so a change one of them saw usually shows in the others' lists and status lines within 20
  seconds, its alert still shown once. The terminal's and VS Code's sessions do this among themselves, and the desktop
  app's among themselves: Claude Code keeps the plugin's store apart for the desktop app.
- **Alert sound** plays a short chime with the toasts. It's off by default and macOS only: Linux and Windows
  terminals have no player.

With background refresh, the status line under the prompt (a band above it in the desktop app) counts what is
ready to merge, what needs you, and what waits on your review, and clears when there is nothing to report:

```
PRs ✅ 1 Ready  ❗ 2 Need You  🔍 1 To Review  (/prs)
```

The band, the pane's header and the list `/prs` prints draw each number in bold; a status line is plain text, so
there it stays as it is.
