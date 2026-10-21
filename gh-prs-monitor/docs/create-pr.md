# Create PR

**Create PR** opens a pull request for the branch you are on, the way your repository writes them. It runs the checks
you pick, commits the changes you choose, drafts the title and body in the repository's own form, and shows you one
preview before anything is pushed or opened. Next time in that repository it offers your choices again.

## When the button shows

**Create PR** shows in the title line of **Your Pull Requests** when this session's branch has no open pull request,
that is, when:

- the branch is neither the repository's default one nor one of the `pr-<number>` branches /prs checks pull requests
  out as;
- none of your open pull requests comes from it (drafts the list hides included), nor one listed for your review;
- you can push to the repository.

It is not offered either where a pull request the lists leave out comes from the branch:

- one open, as a colleague's;
- one merged that holds the branch's last commit, also where it ended at commits GitHub has and this clone never
  fetched, as GitHub's **Update branch** makes;
- the latest that closed, with no commit on the branch since (changes not yet committed don't count).

The pane asks GitHub about these once per branch and commit, and again as the button is pressed, so on a branch new to
it the button comes a moment after the list; while GitHub can't be asked, it waits for the next refresh. With no pull
requests open at all, both lists still show, for the button.

## Where it runs

**Create PR** asks where to create it, as [Review](review.md) does, naming the branch and the one it goes into:

- **This session** — the bundled create-pr skill runs here. While a turn is running, the question says so, and the
  skill starts once the turn ends.
- **New session** — a new Claude Code session opens in this folder with the command typed in, for you to send. From
  the desktop app it also names the folder the branch is checked out in, as the app opens a new session at the
  repository's root, from where the skill goes to that folder; from VS Code too, as its new tab opens at the window's
  folder. Where VS Code's link doesn't open, it runs in this session instead, as [Review](review.md)'s does.

The pull request goes into the repository's default branch, unless your instructions name another ("into develop").
Instructions typed in the dialog's field go with either answer, or Enter sends them alone to this session: "as a draft",
"ask ann to review", "skip the e2e tests", "say why the cache moved". Where the pane is drawn somewhere that can't open
a new session, such as the phone app, it starts here without asking.

Typed, Create PR is `/gh-prs-monitor:create-pr [-- <instructions>]`, for the branch checked out. The pane adds
`--branch "<name>"`, the branch it offered, and, where the new session may open in another folder (the desktop app at
the repository's root, VS Code at the window's folder), `--worktree "<path>"`, the folder that branch is checked out in.

## What the skill does

1. **Looks at the branch.** It must still be the branch the pane offered, with commits or changes to bring. It stops at
   any of these:
   - a pull request opened from it elsewhere since the list was read (with its link);
   - one that merged or closed with nothing new since;
   - GitHub's copy of the branch holding commits this one lacks;
   - a branch with no commits yet;
   - a `pr-<number>` branch, the name /prs checks a pull request out under.

   It asks you first when the new pull request would carry commits another one has:
   - this branch's own earlier one, squashed or rebased or closed;
   - another open, with them up for review (whose branch you can name as the base);
   - another squashed or rebased into another branch, or into the base (then, where this branch has no merges of its
     own, with the commands that drop them from it, for you to run);
   - one merged into another branch that holds this branch's work, such as an epic, offered as the base while it is on
     GitHub.

   Pull requests from forks are not looked at this way.
2. **Reads how the repository writes pull requests:** its pull request template (it asks which, among several), its
   contributing guide, `CLAUDE.md` and `AGENTS.md`, the commands its `package.json`, `Makefile` and the like define,
   what its CI runs on a pull request, and the titles and bodies of its latest merged pull requests.
3. **Offers the checks it found,** numbered, with where each comes from: lint, type-check, a format check and unit
   tests first, long suites after, nothing that writes or publishes; the ones run last time are marked. You pick
   (`1 3`, `all`, `none`, `marked`); nothing runs that you didn't. One that fails: it fixes it on your yes, goes on
   (the preview says it failed), or stops. They run on the folder as it is, so the preview says when changes left out
   of the pull request were there as they ran.
4. **Asks which uncommitted changes go into a commit,** if there are any, file by file (a new folder of more than 20
   files as one, with its count), with a message in the form of the repository's own.
5. **Drafts the title and body** in the repository's form, filling in the template, ticking only what is true, and
   naming an issue only where the branch, the commits or your instructions do, in the words the repository uses.
   Nothing in them credits an assistant or a tool. With [ticket links](tickets.md), the branch's ticket goes in: its
   key in the title only where the repository's titles carry one, and `Ticket: WEB-5785` with its link in the body,
   the key alone where the repository isn't private (reply `add the link` to put it in). Never a word that would close
   the ticket at merge, such as `Closes WEB-5785`, unless your instructions ask for it.
6. **Shows one preview:** the branch and the one it goes into, draft or ready for review, the commit with every file and
   its whole message, the push, the reviewers, the checks run, the ticket, and the title and body as they will be
   posted. `yes` goes ahead; `draft` or `ready` switches; logins add or drop reviewers; anything else changes the draft
   and shows it again. In a repository without ticket links whose branch names something like a key
   (`feature/WEB-5785-…`), the preview asks once: paste a link to a ticket whose address holds its key to set them up
   there (a tracker whose links hold a number alone is set up with `/prs tickets`), or skip. A skip, any no, or a plain
   yes turns the question off for that repository, and `/prs tickets` sets them up whenever you like.
7. **On your yes,** commits, pushes the branch and opens the pull request. It never pushes by force or skips the
   repository's hooks; a branch that moved on GitHub meanwhile stops the push.

It opens one as a draft when your instructions say so, else as you did last time, else (the first time) when the
repository's guide asks for drafts; otherwise it is ready for review.

## What it remembers

Once a pull request is open, the skill keeps three choices for the repository: draft or not, the checks it ran, and the
reviewers GitHub took. The next Create PR there marks those checks to run again (one no longer found is not offered) and
offers the same draft choice and reviewers, each for you to change. Each pull request's choices replace the last.

They are kept in the plugin's own store on this machine, shared by the terminal, VS Code and the desktop app, per
repository and server, never in the repository: Claude Code asks first before a command writes a file into a
repository's `.git` folder, where hooks or config planted run on the next git command. The skill reads and keeps them
through a tool the plugin adds, `create_pr_choices`, which the plugin answers itself, so it asks nothing. The ticket
comes the same way, from `ticket_links`, which reads the branch as the pane's rows do.

## While it runs

While the turn the skill starts with runs, the button reads **Creating PR…** in its place; pressed while another turn
runs, it first says it starts when that turn ends. As that turn ends, answered or interrupted, the button comes back:
the skill then waits for your answer in the conversation, or is done. Once the pull request is open, the next refresh
lists it, and the button goes. In `/prs demo`, the examples offer Create PR from an example branch,
`feature/export-csv`: it asks the real question where the real one asks it, and sends nothing.

Not covered: a pull request from a fork, which needs push access to the repository itself.
