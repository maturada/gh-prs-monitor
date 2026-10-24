# Settings

Change the plugin's settings in `/config`, where they are rows of their own, or with
`/plugin configure gh-prs-monitor@gh-prs-monitor`. The part after `@` is the marketplace you installed the plugin from.

The defaults suit most people: checks in the background every 3 minutes, an alert for every kind of change, and the
summary in the status line. The tables below list each setting by the title `/config` shows and its key. What the plugin
runs and sends is on [What it runs and what it sends](what-it-runs.md).

## Checking GitHub

| Setting | Key | Values | Default | What it does |
|---|---|---|---|---|
| Refresh | `refresh` | `background`, `while-open`, `on-demand` | `background` | When pull requests are checked: **background**, **while-open** or **on-demand**, below. |
| Refresh interval (minutes) | `pollMinutes` | 1 to 1440 | `3` | How often background and while-open check. |
| Share refreshes between sessions | `shareRefresh` | on / off | on | Sessions in the same repository take turns asking GitHub and share its answers, below. |

**Refresh** decides when the plugin looks:

- **background**: from session start, every interval, with alerts and the summary.
- **while-open**: only while the `/prs` pane is open; alerts while it is, no summary.
- **on-demand**: only when you ask, with no alerts about the list and no summary.
  - It checks when `/prs` runs, when Refresh (or a problem's Retry) is pressed, and after a row's button.
  - It also checks once, with the pane open and no list in it, when a session starts, or a `/clear` or a resume starts
    a new conversation. Where an organization manages Claude Code, a plugin you install isn't told, so this one is
    left out.
  - **Alerts from other repositories**, where it is on, still toasts what it finds at `/prs` and Refresh.

With **Share refreshes between sessions** on, the timers ask GitHub about once an interval for the repository, however
many of your sessions show it, and the answers usually reach the others within 20 seconds. Opening the pane, Refresh,
`/prs` and the refreshes after a button's action or a skill's turn always ask GitHub. Off, each session asks for
itself. The terminal's, VS Code's and the desktop app's sessions share alike.

## Alerts

| Setting | Key | Values | Default | What it does |
|---|---|---|---|---|
| Change alerts | `notify` | on / off | on | Turns every way changes are shown on or off together: alerts, the note on a changed row, the list `/prs` prints where no pane shows. |
| Alert duration (seconds) | `alertSeconds` | 2 to 60 | `8` | How long an alert stays up. |
| Change notes last (minutes) | `recentChangesExpiryMinutes` | 1 to 1440 | `30` | How long the note of what changed stays on a pull request in the pane, counted from the refresh that noticed it. |
| Hold alerts while working | `holdWhileWorking` | on / off | on | Keeps alerts back while a turn runs, and shows them when it finishes, or every five minutes of a long one. |
| Alert sound | `alertSound` | on / off | off | A short chime with alerts; macOS only. |
| Alerts as system notifications | `systemNotification` | on / off | off | Also sends your alerts about pull request changes as system notifications, the way Claude Code sends its own. Terminal only; needs Claude Code 2.1.295. |
| Alerts from other repositories | `alertOtherRepos` | on / off | off | Also alerts a review asked of you in your other repositories on the folder's GitHub server, and reviews and CI on your pull requests there; the pane's header counts what waits there. |
| Alert: ready to merge | `alertReady` | on / off | on | One of your pull requests can merge. |
| Alert: comments | `alertComments` | on / off | on | New comments in your pull requests' conversations. |
| Alert: reviews | `alertReviews` | on / off | on | Approvals, change requests and reviews on your pull requests. |
| Alert: CI | `alertCi` | on / off | on | Checks failing, or passing after running. |
| Alert: conflicts | `alertConflicts` | on / off | on | New merge conflicts. |
| Alert: review requests | `alertReviewRequests` | on / off | on | Being asked to review, or asked again. |
| Alert: new commits | `alertNewCommits` | on / off | on | New commits on pull requests you reviewed without approving. |
| Alert: mentions | `alertMentions` | on / off | on | Someone mentions you on another person's open pull request. |
| Alert: merged and closed | `alertClosed` | on / off | on | Pull requests merged or closed by someone else. |

**Change notes last (minutes)** also covers the dot a changed pull request has in the compact view. The note's ✕, one
of its buttons or closing the pane clears it sooner.

**Alerts as system notifications** shows a banner in iTerm2, kitty or Ghostty, or in another terminal once Claude Code's
notification channel is set for it. It follows **Change alerts** and the **Alert** rows
([more](alerts.md#sound-and-system-notifications)).

**Alerts from other repositories** follows **Change alerts** and the **Alert** rows too. It costs one light request at
each check, or at `/prs` and Refresh on demand: 1 point each, of the 5,000 an hour GitHub gives you
([more](other-repositories.md#alerts-from-other-repositories)).

The **Alert** rows pick the kinds. What each kind alerts, and when alerts show:
[Alerts and the status line](alerts.md).

## The pane and the status line

| Setting | Key | Values | Default | What it does |
|---|---|---|---|---|
| Status line summary | `statusLine` | on / off | on | The summary in the status line, or the band in the desktop app; background refresh only. |
| Count outdated comments | `includeOutdated` | on / off | off | Counts unresolved comments on changed code, and lets Resolve Comments work on them too. |
| Hide my drafts | `hideDrafts` | on / off | off | Leaves your own draft pull requests out of the pane, its counts and the list `/prs` prints; a line says how many are hidden. Drafts you are asked to review still show. |
| Ticket links on rows | `showTickets` | on / off | on | Shows each pull request's ticket first in its details, as a link, in repositories with [ticket links](tickets.md) set up; off, only the skills use them. |

## Worktrees and branches

| Setting | Key | Values | Default | What it does |
|---|---|---|---|---|
| Clean up worktrees and branches | `cleanupWorktrees` | on / off | on | Removes the worktrees and branches the branch skills left behind, once their pull request is merged or closed and nothing would be lost. |

**Clean up worktrees and branches** removes the worktrees Resolve Comments, Fix CI and Resolve Conflicts made, their
local branches, and the `pr-<number>` branches **Here, switch branch** left while they still track their pull request.
The conditions are in [Cleanup](working-on-a-branch.md#cleanup).

## Cost

In short: a check every 3 minutes uses about 2% of your GitHub rate limit an hour for each repository, shared by your
sessions there, and the pane, the checks and the alerts cost no model tokens; a skill does once you start it. Three
sessions on one repository still use about 100 points an hour between them. Every request the plugin makes is listed in
[What it runs and what it sends](what-it-runs.md).

### GitHub

- **Each refresh** is one GraphQL request (five searches, mentions included) of 5 rate-limit points, out of the 5,000
  an hour your account gets. Every 3 minutes, that is 100 an hour, 2% of them, for each repository, as your sessions
  there share one request each interval (**Share refreshes between sessions**; off, it is 100 an hour per session).
- **Sessions that ask for themselves:** those of another GitHub account, of a version of the plugin that asks GitHub
  something else, of another install of it, or of a Claude Code run with its own configuration folder
  (`CLAUDE_CONFIG_DIR`), which keeps a plugin store of its own. So does each session where the list GitHub sends is
  over 150,000 characters, too large to share (the busiest repositories send about 110,000). What you ask for yourself
  asks GitHub in the session you ask in.
- **The repository** is looked up once per session.
- **Alerts from other repositories:** with the setting on, one GraphQL request of 1 point (two searches) at each
  check, which follows **Refresh**: each interval in the background mode, each interval while the pane is open and at
  `/prs` and Refresh in while-open, and at `/prs` and Refresh on demand. At 3 minutes, that is 20 points an hour for
  each session, a fraction of a percent; sessions do not share it. Opening the repository picker with the setting off
  runs it once.
- **A repository you show:** its list is one more request like the folder's at each check while it shows, as
  **Refresh** says, not shared with other sessions; showing it first looks the repository up once (`gh auth status`
  and `gh repo view`).
- **A pull request that leaves the lists:** one more request of 1 point asks whether it was merged or closed, in each
  session whose lists it left, whatever **Alert: merged and closed** says, as what it finds carries on with the list:
  a pull request reopened is no news (where the answer comes within the 10 seconds the list waits for it), and
  **Create PR** knows where a merged branch ended. A session that starts with worktrees of pull requests no longer
  listed asks the same of those its first refresh didn't.
- **A branch with no pull request in the lists:** one request of 1 point per branch and commit, and one per press of
  **Create PR**, asks GitHub whether one was open or ended there. For one closed at a commit this clone lacks, one
  REST request compares the two on GitHub.
- **GitHub's suggested reviewers:** where your own pull requests wait for review with no person asked (a bot such as
  Copilot aside), or need more approvals with no person asked, one request of 1 point after a refresh asks for all of
  them not asked about yet, whether or not the pane is open, in each session. Each pull request is in it once per
  commit, and again after a review, after someone was asked, or after the request failed.
- **Each button** first asks how the pull request stands now, with one REST request (REST has its own 5,000 an hour).
  **Update Branch** makes a second, which compares the branch with its base, and **Request Review** one more once you
  picked whom to ask, as the question may have been open for minutes. **Re-Run CI** also looks up its failed runs (1
  point). **Merge** looks up the stack the pull request is in, if any (REST), then how the merge ended (1 point). A
  stacked merge checks its progress every 3 seconds for up to a minute.
- **While a bundled skill is at work**, its finished turns refresh the list, at most twice a minute (not on demand).

### Model tokens

The pane, refreshes, alerts and the status line use none. The bundled skills are hidden from the model until a button
(or their slash command) runs them; only then do they cost tokens.

The plugin's two tools put their descriptions in each session's context, a few hundred tokens, or only their names where
Claude Code defers tools:

- `create_pr_choices`, which Create PR uses for its kept choices.
- `ticket_links`, which Create PR and Review use for a pull request's ticket.

Where no pane shows (a VS Code extension older than 2.1.299, an app that places no panes, or a `claude -p` run), the
list `/prs` prints is the command's output, which goes into the conversation, so a long list adds to its context.
