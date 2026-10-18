# Review

**Review** shows on the pull requests waiting on your review. It gives a short overview of the pull request first, then
verified findings, posted as inline comments only after you approve the exact wording, then a separate offer to approve
it. Typed, it is `/gh-prs-monitor:review <number or URL> [-- <instructions>]`; instructions after `--` narrow what it
looks at, never what it asks you.

**Review** asks where to review:

- **This session** — the bundled review skill runs here. While a turn is running, the question says so, and the
  review starts once the turn ends.
- **New session** — a new Claude Code session opens in this folder with `/gh-prs-monitor:review <pull request URL>`
  typed in, for you to send with Enter, and this conversation goes on undisturbed.
  - **From the terminal** it is a terminal window, opened through Claude Code's own `claude-cli://` link, which Claude
    Code sets up the first time you send a prompt in the terminal. Claude Code picks the terminal app, not /prs: of
    iTerm2, Ghostty, kitty, Alacritty, WezTerm and Terminal.app, the one you last started `claude` in, else the first of
    them installed. So from Warp or an editor's terminal, the window opens in one of those.
  - **From the desktop app** it is a new session there, which asks you to confirm the folder. The app types the command
    in with a space after its `/`: delete that before sending.
  - **Where the link can't be opened**, the alert gives the command to type yourself, and the conversation keeps it
    too, as an alert goes in seconds.

Instructions typed in the dialog's field, such as "focus on the migration", go with **This session** or **New
session**, whichever you then press, or Enter sends them alone to a review here. Sent alone, "Cancel", "no thanks" and
the like cancel. Where the pane is drawn somewhere that can't open a new session, such as the phone app, the review
starts here without asking. A review in a new session is followed by that session's own list.

While it runs, its row says so: see [While a skill is at work](actions.md#while-a-skill-is-at-work).
