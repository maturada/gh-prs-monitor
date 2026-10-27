# Changelog

Each version of gh-prs-monitor, newest first. Versions follow [semantic versioning](https://semver.org).

## 1.6.0 (27.10.2026)

- **Switch to main after a merge**: when the branch your checkout is on has merged, at the commit you have, a note above
  the lists says so, with **Switch to main** (or whichever branch it merged into) and a ✕. It waits for a turn under way
  (the ✕ stops it meanwhile), fetches the base, switches this checkout to it, installs what a changed lockfile needs,
  and deletes the merged branch where it is still at the merged commit and no pull request is open from it. Where
  something stands in the way, as uncommitted changes or the base checked out in another worktree, it changes nothing
  and says why.
  [A branch that merged](gh-prs-monitor/docs/pane.md#a-branch-that-merged)
- **The repository picker lists the repositories you are part of**: those with a pull request of yours open or a
  review asked of you, not only those where something waits; a row where nothing does says how many are open there,
  `2 open`. A field above the rows, where the keyboard starts, narrows them as you type, and Enter opens the one whose
  name you typed, else the first row left, else looks up what you typed as `/prs` does.
  [The repository picker](gh-prs-monitor/docs/other-repositories.md#the-repository-picker)
- **↻ and ←**: the header's Refresh is ↻ and Back is ←, in the desktop app too. While the pane has the keyboard, `r`,
  `c`, `p` and `b` press ↻, **Compact** or **Full**, **Repositories** and ←, except in the VS Code extension, which has
  no keys for buttons; the desktop app shows each key on its button.
  [The header](gh-prs-monitor/docs/pane.md#the-header)
- **New commits since your review** are marked ↑ in alerts and notes, as ↻ is now Refresh.
- **`/prs demo`**'s picker offers four made-up repositories, one where your pull requests only wait on others.
- **`+N elsewhere` and the picker could show what had already ended** in another repository until the next timed
  check in background mode: ↻ didn't read other repositories again. With **Alerts from other repositories** on, opening
  the pane and ↻ now read them at once in every **Refresh** mode, and opening the picker always does, 1 point each.
- **Docs**: shorter and plainer where the header and the picker are described, the same for every app; what Switch to
  main runs and keeps is in [What it runs](gh-prs-monitor/docs/what-it-runs.md) and [Privacy](PRIVACY.md).

## 1.5.0 (24.10.2026)

- **Other repositories in the pane**: the header's **Repositories** button, or `/prs` with `owner/name`, an address or
  a folder such as `~/code/web`, shows another repository's pull requests, with **Back** to this folder's list. The
  picker lists this folder's repository, the clones on this machine where a session loaded its list, and the
  repositories where something waits for you, each a row with what waits there and **Open**; a repository typed in it
  is looked up before it closes, and what keeps it from showing is said there. The buttons work there as on your own
  list; Resolve Comments, Fix CI and Resolve Conflicts offer to open a new session in its clone. The status line, the
  band and this folder's alerts carry on as before.
  [Other repositories](gh-prs-monitor/docs/other-repositories.md)
- **Alerts from other repositories**, a new setting, off by default, alerts a review asked of you in your other
  repositories on the folder's GitHub server, and on your own pull requests there each review given and CI failing or
  passing. It costs one light request at each check, 1 point of the 5,000 an hour GitHub gives you. Each alert names
  its repository and how to show it, `· /prs acme/web`; the first check of a session says what waits where, and the
  pane's header counts it, `+3 elsewhere`.
  [Other repositories](gh-prs-monitor/docs/other-repositories.md#alerts-from-other-repositories)
- **`/prs demo`** shows both: its Repositories button offers three example repositories, one as if cloned at
  `~/code/web`, and shows each; with Alerts from other repositories on, its header counts what waits there and one of
  them alerts.
- **`#` in the prompt** offers no pull requests in this version; its suggestions come back in a later one.
- **`/prs demo`, `/prs tickets`, or `/prs` with a repository, while the pane asks a question** cancels the question and
  shows what you asked for; before, the question stayed over it, and the pane seemed not to change.
- **Another session's alerts** are now matched change by change rather than line by line, so a change shown in one
  session isn't shown again in another that words it with a different change beside it. A 1.4.0 session open beside a
  1.5.0 one may still show a change twice, until it updates too.
- **An alert held while Claude worked longer than ten minutes** could show again after another session had shown it
  meanwhile; it now shows once.
- **Alerts held while Claude works** show at most five minutes late in a long turn, where they waited up to a quarter
  of an hour, and also where no check runs then (the pane closed in while-open mode, or on demand), where they waited
  for the turn to end.
- **The ticket links on rows** showed again only at the next check after the plugin reloaded; they now show at once.
- **`/prs demo`'s buttons** asked as if this session were idle while Claude worked; they now ask as the real ones do
  then.
- **Two settings read more plainly** in `/config`: **Change notes last (minutes)**, which was Recent changes expire
  after, and **Hide my drafts**, which was Hide drafts. What you set carries over.
- **A shorter README, and docs that read more easily**: the README tours what the plugin does, each feature linking to
  its page; other repositories have a page of their own, and so does everything the plugin runs and sends.
- **The plugin notes the folder of each clone a session loads its list in**, with its repository's name, the 50
  latest, only to offer them when you show another repository; [PRIVACY.md](PRIVACY.md) says what it keeps.

## 1.4.0 (22.10.2026)

- **Request Review**, a new button on your own pull requests that no person is asked to review (a bot such as Copilot
  aside), before the first review or when they need more approvals. It offers the people GitHub suggests, those who
  earlier changed or reviewed that code, and asks the ones you pick on GitHub, after one more look at the pull request.
  It is the row's main button there; on Approved · More Approvals Needed, it takes that place from Auto-Merge. The
  suggestions come a moment after the list, from one small request to GitHub after a refresh, asked again after a new
  commit or a review.
  [Request Review](gh-prs-monitor/docs/actions.md#request-review)
- **Review since your review**: on Re-Review Requested and Updated Since Your Review, Review now asks what to cover as
  well as where: **Since Your Review**, already picked, or **Full Review**. So Enter, or **This session**, now reviews
  only what changed since your last review; pick Full Review for the whole pull request, as before. From your review, it
  reads only what the commits since changed, leaving out merges of the base, posts new comments only on lines they
  changed, and tells you, for you alone, what came of your earlier comments: addressed, claimed fixed, still open or
  unclear. Where the commit you reviewed is no longer in the pull request, or most of it is new, it reviews it all and
  says why. Where no new session can open, as on the phone, it now asks what to cover. Typed:
  `/gh-prs-monitor:review 142 since`.
  [Since your review](gh-prs-monitor/docs/review.md#since-your-review)
- **Create PR**'s preview, with no reviewers from your instructions or from last time, offers up to three people who
  last changed the files, or someone else. Nobody is asked until you reply with logins; a plain yes still opens it
  without reviewers.
  [Create PR](gh-prs-monitor/docs/create-pr.md#what-the-skill-does)
- **`/prs demo`** shows both: Request Review on #1239, just opened with nobody asked to review it, and the Since Your
  Review choice on #1252 and #1241.
- **Create PR on a branch behind its base** summed up the base's newer changes as if the pull request made them (594
  files where the branch changed 16, three commits behind); it now reads only the branch's own changes since it left its
  base.
- **A pending review no longer hides your last one**: while you had a review started on GitHub and not yet submitted,
  someone else's pull request whose author pushed after your change request read Waiting On Author; it now reads Updated
  Since Your Review, going by that change request. A comment-only review, or one by someone who can't push to the
  repository, has no change request to go by.

## 1.3.0 (21.10.2026)

- **Ticket links**: paste a link to any ticket with `/prs tickets`, once per repository, and each pull request whose
  branch or title names its key shows its ticket first in its details, as `WEB-5785 ⧉`, linked to Linear, Jira,
  YouTrack, Shortcut, Azure Boards or whichever tracker you use. The link is read on your machine; nothing is sent
  anywhere. **Ticket links on rows** in `/config` takes them off the rows.
  [Ticket links](gh-prs-monitor/docs/tickets.md)
- **Create PR** writes the ticket where your repository writes one: the key in the title only where its titles carry
  keys, `Ticket: WEB-5785` with its link in the body, the key alone where the repository isn't private, and never a
  word that would close the ticket at merge. Where ticket links aren't set up and the branch names a key, the preview
  asks once, and a link pasted there is kept only once you save it in a dialog that shows what it would link.
- **Review** names the ticket in its overview and, with a tool for your tracker already connected to Claude Code,
  reads it once to tell you, for you alone, where the change seems to miss or go beyond it. The skills are told to
  post a ticket's key and link at most, never what it says.
- **`/prs demo`** shows example tickets, and its #1235 says how to set them up.
- **The dialog** puts the keyboard in its field where a question asks for a link, names what its Enter does beside it
  (`↵Check`, as the Check the link button does), and in the mobile app, which draws no field, says to answer on the
  computer.
- **The Alerts as system notifications setting** says what it does in fewer words.
- **`/prs` as a session's first prompt with nothing attached** (a `claude -p` run, or the desktop app before its window
  joins) printed "No pull requests loaded yet." while the session's first list was still loading; it now waits for that
  list and prints it.

## 1.2.0 (20.10.2026)

- **Alerts as system notifications**, a setting off by default: the alerts you turned on also go out as a system
  notification, one each time they show, the way Claude Code sends its own: a banner in iTerm2, kitty or Ghostty, in
  another terminal once you choose Claude Code's notification channel for it (Warp shows them with `iterm2`), or
  through your own `Notification` hook. Pull request changes only, not the summary when a
  session starts nor a cleanup's note. It needs Claude Code 2.1.295; the toasts show either way.
- **Claude Code 2.1.292 or later**, a version earlier than before: the plugin is tested on it.
- **The docs said the desktop app keeps the plugin's store apart; it shares it** with the terminal and VS Code. So
  sessions in every app share their checks of GitHub, show each alert once, and offer the same Create PR choices. Only
  the docs change.
- **Docs that read better**: each page opens with what it does for you and goes on in the order a newcomer asks, and
  the README's "What it runs and what it sends" starts with a short summary. Nothing was dropped.

## 1.1.0 (19.10.2026)

- **VS Code, and editors built on it such as Cursor**: the Claude Code extension draws the pane, its alerts and the
  status line from its version 2.1.299, and the pane now fits it:
  - buttons a little apart and off the edges of their frames, in the pane and its questions, with no blank lines;
  - a long title wraps beside its number, in a narrow pane too;
  - Changes Requested, Review Requested and running checks in yellow, a merge in purple, from the editor's theme;
  - alerts as toasts above the prompt box, not lines left in the conversation;
  - the status line keeps the space between its counts.
- **New session from VS Code**: Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR offer a new session
  there too, a new tab of the editor with the command typed in. Where its link doesn't open, the skill runs in this
  session instead.
- **`#` in the prompt** suggests the pull requests listed, yours first: type `#` and the start of a number, or of a
  word in a title, and pick one to write its number, as `#142`. In the terminal for now: the desktop app and VS Code
  don't ask plugins for suggestions yet.
- **`/prs` from your phone or claude.ai**, over Remote Control: it prints the list in the conversation, as they draw
  no pane yet, and opens the pane on the computer too. `/prs demo` prints the example list and shows the examples on
  the computer.

## 1.0.1 (18.10.2026)

- The README says more of what the plugin does on your machine: the slash commands its buttons run, the Claude Code
  events it follows, the files it reads, writes and removes, the settings it changes, that it reads no credential to
  sign in with, and what its sound and images are for.
- `compact.png` is compressed again, the same to the pixel: by chance its bytes spelled what a check reads as a
  download-and-run command. So are the icon and the README's top screenshot, whose bytes spelled command names.

## 1.0.0 (18.10.2026)

The first public release.

- **`/prs`** opens a pane with your open pull requests and the ones waiting on your review, each with the one status
  that matters and what needs you first, and a compact view. `/prs demo` shows one of each status with example data.
- **Alerts** when one of yours can merge, gets a review, comments, a failing check or conflicts, when you are asked to
  review, when a pull request you reviewed gets new commits, when someone mentions you, and when someone else merges or
  closes one. A summary in the status line, or above the prompt in the desktop app.
- **Buttons** for Merge (stacked pull requests too), Auto-Merge, Update Branch, Re-Run CI, Ready For Review and
  Re-Request Review, each looking at the pull request as it stands on GitHub and asking before it writes.
- **Skills**: Resolve Comments, Fix CI, Resolve Conflicts, Review and Create PR, run here, in a worktree, or in a new
  session. Worktrees get their dependencies and the files `.worktreeinclude` names, and go once their pull request is
  merged or closed, when nothing in them would be lost.
- **`/prs report`** links a bug report with your versions filled in, an idea, and the issues already open.
- **Refreshes** in the background, while the pane is open, or on demand, shared between the sessions in a repository.
- Works in the terminal and the desktop app, against github.com and GitHub Enterprise Server 3.16 or later.
