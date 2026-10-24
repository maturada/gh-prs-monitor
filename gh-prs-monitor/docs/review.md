# Review

**Review** reads a pull request waiting on your review and gives you a short overview of it. It leaves out what other
reviewers, bots and your own earlier reviews already raised, and checks each finding before it shows it to you, and
posts the ones you approve as inline comments, only after you approve the exact wording. Then it offers, separately, to
approve the pull request. Nothing is written to GitHub without your yes.

The button shows on the pull requests waiting on your review. Typed, it is
`/gh-prs-monitor:review <number or URL> [since] [-- <instructions>]`. `since` starts from your last review
([Since your review](#since-your-review)). Instructions after `--` narrow what it looks at, never what it asks you.

## Where it runs

**Review** asks where to review:

- **This session**: the bundled review skill runs here. While a turn is running, the question says so, and the review
  starts once the turn ends.
- **New session**: a new Claude Code session opens in this folder with `/gh-prs-monitor:review <pull request URL>`
  typed in, for you to send with Enter. This conversation goes on undisturbed. [How it opens](#opening-a-new-session)
  depends on the app you press in.

Instructions typed in the dialog's field, such as "focus on the migration", go with **This session** or **New
session**, whichever you then press. Enter sends them alone to a review here. Sent alone, "Cancel", "no thanks" and the
like cancel.

A review in a new session is followed by that session's own list.

Where the pane is drawn somewhere that can't open a new session, the review starts here without asking where. On a pull
request back to you, it still asks what to cover: see below.

While it runs, its row says so: see [While a skill is at work](actions.md#while-a-skill-is-at-work). It works the same
on the rows of [another repository's list](other-repositories.md).

## Since your review

Review can read only what changed since your last review of a pull request, and tell you what came of your comments.

On **Re-Review Requested** and **Updated Since Your Review**, Review asks what to cover as well as where. One line above
the choice recalls your last review, its commit and how long ago where the list knows them, and what brought the pull
request back: new commits, a new request for your review, or both.

- **Since Your Review**, already picked when the question opens, so Enter starts it here: what the commits since your
  last review changed, and what came of your comments.
- **Full Review**: the whole pull request again, as the first time.

Where no new session can open, it asks only what to cover, and **Start Review** starts it here. Where the pane doesn't
show, Claude Code's own dialog asks instead: what to cover, then where
([Where each part shows](pane.md#where-each-part-shows)).

Your last review is the latest you left, dismissed or not: an approval, a change request or comments. From it, Review
reads what the commits since changed in the pull request's files, leaving out what a merge of the base brought in. New
comments go only on lines changed since, and a problem the new commits cause elsewhere is in the summary it shows you.
The offer to approve says it read only what changed since.

Its overview adds **Since your review**: that review and its commit, the commits since, and where each of your comments
stands:

- addressed;
- claimed fixed: a reply says so, but the code doesn't plainly show it;
- still open;
- unclear.

Each one not addressed comes with its link. This is for you alone: your open points aren't posted again, and it replies
to no thread.

It reviews the whole pull request instead, and says why, where:

- you haven't reviewed it before, or it can't tell which reviews are yours;
- the commit you reviewed is no longer part of it, after a force-push or a rebase, or your review names none;
- more than half of it is new since your review;
- the changes since reach 300 files, the most GitHub lists at once.

Where no file of the pull request changed since, it says so, names any commits that came in anyway, and stops. If you
are asked to review it again, it tells you what came of your comments instead, then offers to approve.

## With ticket links

In a repository with [ticket links](tickets.md), the overview names the pull request's ticket. Where a tool for your
tracker is already connected to Claude Code (Linear's or Atlassian's, say), Review reads the ticket once, read-only.

The draft it shows you then adds **Against WEB-5785**: up to three questions on where the change seems to miss what the
ticket asks, or go beyond it, minding that one ticket may span several pull requests. They are for you alone: none is
posted, and it is told never to post what the ticket says. With no such tool, it reads nothing and asks nothing.

## Opening a new session

What **New session** does depends on where you press the button.

- **From the terminal** it is a terminal window, opened through Claude Code's own `claude-cli://` link, which Claude
  Code sets up the first time you send a prompt in the terminal. Claude Code picks the terminal app, not /prs: of
  iTerm2, Ghostty, kitty, Alacritty, WezTerm and Terminal.app, the one you last started `claude` in, else the first of
  them installed. So from Warp or an editor's terminal, the window opens in one of those.
- **From the desktop app** it is a new session there, which asks you to confirm the folder. The app types the command in
  with a space after its `/`: delete that before sending.
- **From VS Code** it is a new tab of the extension in the editor window in front, usually the one you pressed in. It
  opens through the extension's own link, in the scheme your editor answers on (`vscode://`, `cursor://`, …), which the
  plugin reads from the editor's `product.json`, or else VS Code's. Where that link doesn't open, the review runs in
  this session instead, and the alert says why.
- **Where the link can't be opened** from the terminal or the desktop app, the alert gives the command to type yourself.
  The conversation keeps it too, as an alert goes in seconds.
