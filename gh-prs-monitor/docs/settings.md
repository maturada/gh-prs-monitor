# Settings

Change them in `/config` (the plugin's rows) or with `/plugin configure gh-prs-monitor@gh-prs-monitor`, where the part
after `@` is the marketplace you installed the plugin from.

| Setting | Key | Values | Default | What it does |
|---|---|---|---|---|
| Refresh | `refresh` | `background`, `while-open`, `on-demand` | `background` | When pull requests are checked. **background**: from session start, every interval, with alerts and the summary. **while-open**: only while the `/prs` pane is open; alerts while it is, no summary. **on-demand**: only when `/prs` runs, when Refresh (or a problem's Retry) is pressed, after a row's button, and once when a session starts, or a `/clear` or a resume starts a new conversation (not where an organization manages Claude Code: there a plugin you install isn't told), with the pane open and no list in it; no alerts and no summary. |
| Refresh interval (minutes) | `pollMinutes` | 1 to 1440 | `3` | How often background and while-open check. |
| Share refreshes between sessions | `shareRefresh` | on / off | on | Sessions in the same repository take turns asking GitHub and share its answers, which usually reach the others within 20 seconds: the timers ask GitHub about once an interval for the repository, however many of your sessions show it. Opening the pane, Refresh, `/prs` and the refreshes after a button's action or a skill's turn always ask GitHub. Off, each session asks for itself. The desktop app's sessions share among themselves, and the terminal's and VS Code's among themselves, but not with each other: Claude Code keeps the plugin's store apart for the desktop app. |
| Change alerts | `notify` | on / off | on | Turns every way changes are shown on or off together: alerts, the note on a changed row, the list `/prs` prints where no pane shows. The rows below pick the kinds. |
| Alert duration (seconds) | `alertSeconds` | 2 to 60 | `8` | How long an alert stays up. |
| Recent changes expire after (minutes) | `recentChangesExpiryMinutes` | 1 to 1440 | `30` | How long the note of what changed stays at the foot of a pull request in the pane, and its dot in the compact view, from when a refresh noticed it. Its ✕, one of its buttons or closing the pane clears it sooner. |
| Hold alerts while working | `holdWhileWorking` | on / off | on | Keeps alerts back while a turn runs, and shows them when it finishes, or each quarter of an hour of a long one. |
| Alert sound | `alertSound` | on / off | off | A short chime with alerts; macOS only. |
| Alert: ready to merge | `alertReady` | on / off | on | One of your pull requests can merge. |
| Alert: comments | `alertComments` | on / off | on | New comments in your pull requests' conversations. |
| Alert: reviews | `alertReviews` | on / off | on | Approvals, change requests and reviews on your pull requests. |
| Alert: CI | `alertCi` | on / off | on | Checks failing, or passing after running. |
| Alert: conflicts | `alertConflicts` | on / off | on | New merge conflicts. |
| Alert: review requests | `alertReviewRequests` | on / off | on | Being asked to review, or asked again. |
| Alert: new commits | `alertNewCommits` | on / off | on | New commits on pull requests you reviewed without approving. |
| Alert: mentions | `alertMentions` | on / off | on | Someone mentions you on another person's open pull request. |
| Alert: merged and closed | `alertClosed` | on / off | on | Pull requests merged or closed by someone else. |
| Status line summary | `statusLine` | on / off | on | The summary in the status line, or the band in the desktop app; background refresh only. |
| Count outdated comments | `includeOutdated` | on / off | off | Counts unresolved comments on changed code, and lets Resolve Comments work on them too. |
| Hide drafts | `hideDrafts` | on / off | off | Leaves your own draft pull requests out of the pane, its counts and the list `/prs` prints; a line says how many are hidden. Drafts you are asked to review still show. |
| Clean up worktrees and branches | `cleanupWorktrees` | on / off | on | Removes the worktrees Resolve Comments, Fix CI and Resolve Conflicts made, their local branches, and the `pr-<number>` branches **Here, switch branch** left while they still track their pull request, once it is merged or closed and nothing would be lost. |

## Cost

- **GitHub.**
  - **Each refresh** is one GraphQL request (five searches, mentions included) of 5 rate-limit points, out of the 5,000
    an hour your account gets. Every 3 minutes, that is 100 an hour, 2% of them, for each repository, as your sessions
    there share one request each interval (**Share refreshes between sessions**; off, it is 100 an hour per session).
  - **Sessions that ask for themselves:** those of another GitHub account, of a version of the plugin that asks GitHub
    something else, or of another install of it. The desktop app's sessions and the terminal's (VS Code's with them)
    count as two, as Claude Code keeps a store apart for each. So does each session where the list GitHub sends is over
    150,000 characters, too large to share (the busiest repositories send about 110,000). What you ask for yourself asks
    GitHub in the session you ask in.
  - **The repository** is looked up once per session.
  - **A pull request that leaves the lists:** one more request of 1 point asks whether it was merged or closed, in each
    session whose lists it left, whatever **Alert: merged and closed** says, as what it finds carries on with the list:
    a pull request reopened is no news (where the answer comes within the 10 seconds the list waits for it), and
    **Create PR** knows where a merged branch ended. A session that starts with worktrees of pull requests no longer
    listed asks the same of those its first refresh didn't.
  - **A branch with no pull request in the lists:** one request of 1 point per branch and commit, and one per press of
    **Create PR**, asks GitHub whether one was open or ended there. For one closed at a commit this clone lacks, one
    REST request compares the two on GitHub.
  - **Each button** first asks how the pull request stands now, with one REST request (REST has its own 5,000 an hour).
    **Update Branch** makes a second, which compares the branch with its base. **Re-Run CI** also looks up its failed
    runs (1 point). **Merge** looks up the stack the pull request is in, if any (REST), then how the merge ended (1
    point). A stacked merge checks its progress every 3 seconds for up to a minute.
  - **While a bundled skill is at work**, its finished turns refresh the list, at most twice a minute (not on demand).
- **Model tokens:** the pane, refreshes, alerts and the status line use none. The bundled skills are hidden from the
  model until a button (or their slash command) runs them; only then do they cost tokens. The plugin's one tool,
  `create_pr_choices`, which Create PR uses for its kept choices, puts its description in each session's context, a
  few hundred tokens, or only its name where Claude Code defers tools. Where no pane shows (a VS Code extension older
  than 2.1.299, an app that places no panes, or a `claude -p` run), the list `/prs` prints is the command's output,
  which goes into the conversation, so a long list adds to its context.
