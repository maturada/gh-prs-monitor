# Development

The engine follows `$`, and the names of the session's state, only within the hooks module itself. So every call into
the engine lives in `hooks/register.tsx`, and everything else lives in the modules it imports: what decides and parses
is tested on its own, the drawing through the hooks module's tests. A module whose steps need the engine takes what it
needs as plain functions the hooks module hands in, its host: `RefreshHost` for a load, `CleanupHost`, `PressHost` for a
press and the writes, `SkillHost` for a skill's run, `BranchLookupHost`, `SuggestionsHost` for GitHub's suggested
reviewers, `DialogHost`, `BackHost` for the window going back to its row, `ToastHost`, `StoreHost`, `KeptChoices` for
the create-pr skill's choices, `TicketsHost` for `/prs tickets`, `TicketToolHost` for the skills' ticket tool,
`ReportHost` for `/prs report`, and `Host` (`machine.ts`) for git and gh.
register.tsx builds each (`refreshHostOf($, session)`, `pressHostOf`, …). A member passes the call on, a few with a
guard of their own (a load of the module a reload replaced shows no list, problem or loading mark; an end mark is
waited for a moment at most), and a module is tested with a host of stand-ins.

```
hooks/hooks.json          names register.tsx as the hooks module
hooks/register.tsx        the hooks module: the hooks, every call into the engine and the session's state, the
                          drawing's and the demo's wiring, and the hosts it hands the other modules
hooks/session.ts          what one load of the module keeps between hooks, grouped by what it serves
hooks/settings.ts         the plugin's options, read into settings
hooks/refresh.ts          the timer, one load at a time, and each load's way from GitHub's answer to the pane, the
                          status line and the alerts
hooks/github.ts           the requests to GitHub through gh: the repository, the lists, how pull requests ended, one
                          as it stands now, its stack, failed runs, and the writes
hooks/pulls.ts            the GraphQL query, each pull request's row read from GitHub's answer, and lookups in the list
hooks/pull-status.ts      each pull request's status: the stage its facts put it at, its label and tone, and the
                          button that moves it on
hooks/ended.ts            how pull requests that left the lists ended: GitHub's lookup and its answer, and what the
                          loads found, kept for the next cleanup
hooks/alerts.ts           what changed between two refreshes, which alerts it raises, and which wait or repeat
hooks/carry.ts            what a load's list carries over from the lists before it, and which pull requests that left
                          them GitHub is asked how they ended
hooks/toasts.ts           the alerts on their way to the person: held while a turn runs, then toasts and the sound,
                          those another session showed lately left out
hooks/summary.ts          the counts the status line, the band and the pane's header show
hooks/list.ts             the list /prs prints where no pane shows, the words both lists use, and a panel's rows
hooks/autocomplete.ts     the pull requests `#` offers in the prompt box, from the list held
hooks/store.ts            every key the plugin keeps in the store, read and written: the last look at each
                          repository, the view, what cleanups left and the cleanup under way in each clone, the alerts
                          shown, the answers sessions share and the create-pr choices; what a failure of each costs,
                          and what gives way when it is full
hooks/store-keys.ts       the store's keys: an id too long for one goes in by its hash
hooks/shared.ts           GitHub's answers the sessions in a repository share, and when a session takes one, waits
                          for one, or asks GitHub
hooks/writes.ts           the writes a row's buttons make, each behind the person's yes: merge (a stack's in order),
                          auto-merge, branch update, ready for review, review requested of GitHub's suggestions,
                          review asked again, failed runs re-run
hooks/press.ts            what a press on a row does around its write: the look at GitHub before the question, the
                          refresh after, a merged row shown merged until GitHub's search catches up
hooks/actions.ts          the merge, branch update, re-run, ready for review, request review and re-request review
                          questions, commands and outcomes, and what a press finds changed on GitHub since the list
                          was read
hooks/skill-runs.ts       the bundled skills' runs: Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR
                          started from a button (here, in a worktree, or typed into a new session), and each skill
                          turn's life (its row marked while it works, given back as it ends, the list following it)
hooks/branch-lookup.ts    GitHub's lookup of the pull requests from the session's branch the lists don't show, which
                          a load and Create PR's press ask: its query, the answer read, and the request
hooks/suggestions.ts      the people GitHub suggests to review your own pull requests nobody was asked to review, or
                          that need more approvals, which a load asks once it shows the list: which rows want them,
                          the request, the answer read, kept for each row's head commit and reviews
hooks/branch-flow.ts      where Resolve Comments, Fix CI and Resolve Conflicts work, and the arguments they hand
                          their skills
hooks/review-flow.ts      Review's question and the arguments it hands the skill
hooks/create-flow.ts      Create PR: the pull request it could open from the session's branch, its question, the
                          arguments it hands the skill, and the key its button and work go by
hooks/args.ts             a skill's argument line: written with values quoted and instructions on one line, and the
                          pull request it names read back
hooks/create-choices.ts   the choices the create-pr skill keeps per repository, and the tool it reads and keeps
                          them through
hooks/tickets.ts          ticket links: a pasted link read into a key's address, a pull request's ticket found by its
                          key in its branch or title, the row's detail, and the links as the store keeps them
hooks/tickets-flow.ts     /prs tickets: the questions that set ticket links up, show, add and remove them, and the
                          text printed where no pane draws
hooks/ticket-tool.ts      the skills' ticket tool: a pull request's ticket, a key's link, a pasted link kept
hooks/new-session.ts      the links that open a new session, VS Code's editor's scheme for them, and the system's
                          opener
hooks/report.ts           /prs report: where to report, and the versions a bug report asks for
hooks/checkout.ts         the checkouts the branch skills work in: /prs's worktree for a pull request, or a switch of
                          this checkout to its branch
hooks/fetch-source.ts     where the pull request's head is fetched from, as gh pr checkout fetches it, and what a branch
                          made for it pulls from
hooks/switch.ts           the one refusing switch onto the pull request's commit, and what git says when it refuses
hooks/cleanup.ts          the worktrees and branches of pull requests that ended, cleaned up by one session of a clone
                          at a time, and the notes on what stayed, told once across sessions
hooks/kept-notes.ts       those notes as the store keeps them, and their check when read back
hooks/worktrees.ts        the worktrees and branches /prs makes, by their pr-<number> names, and git's list of a clone's
                          worktrees
hooks/machine.ts          the machine git and gh run on (`Host`), and what git says that several modules read
hooks/deps.ts             the projects in a checkout, by their lockfiles, their installs and the note on them
hooks/include.ts          the ignored files .worktreeinclude names, copied into a new worktree, and cleanup's check,
                          by the same selection, that the main checkout holds the same
hooks/remade.ts           what git ignores in a worktree that tools make again: installed dependencies, build output,
                          caches
hooks/gh.ts               reading gh's output and its errors
hooks/when.ts             how times read: a clock time, the day, how long ago, how often checks run
hooks/demo.ts             the example pull requests, alerts and list /prs demo shows
hooks/pane.tsx            the pane, from elements every surface draws, and the desktop app's band above the prompt,
                          the header's counts
hooks/question-frame.tsx  what every question is drawn with, in place of the list: the frame (header, subject, text,
                          how to leave), the field, and the answers' row
hooks/dialog.tsx          the question a button asks as the pane draws it: by the picker where it offers names, else
                          its field and its answers, in that frame
hooks/picking.ts          the rules of a question answered by picking names first: a pick, Select All and Clear, when
                          the main answer may go, the names an answer carries
hooks/picker.tsx          that question as the pane draws it, in that frame: the names that pick, Select All and
                          Clear, and an answer that carries the names picked
hooks/keys.ts             the keys of what the pane and the dialog draw that the flows name too, and where a
                          question's keyboard starts
hooks/dialog-flow.ts      the dialog as it runs: one question at a time, in the pane or Claude Code's own dialog, and
                          the pane's window back on its row once it is answered
hooks/back-to-row.ts      the pane's window put back on its row once a question is answered
hooks/question.ts         what a question is about, text typed in place of a choice read as an answer, and where a
                          skill runs: this session or a new one
hooks/layout.ts           what each surface draws differently: text in cells or a font, space by rows or steps, a box
                          out of the flow, toasts, and the colours VS Code names otherwise
hooks/stable-buttons.ts   a button drawn again unchanged kept as the same element, so its handle outlives a redraw
hooks/*.test.ts           the modules' logic, apart from the engine (helpers.test.ts holds the small ones')
hooks/*.test.tsx          the hooks module, by area, against the machine in hooks/testing/
hooks/testing/            that machine (gh, git and the system answering from a world each test sets up), the
                          GitHub answers it serves, the store in memory it answers from, and the git and press hosts
                          in memory the module tests share
skills/                   the bundled resolve-comments, fix-ci, resolve-conflicts, review and create-pr skills, and
                          in skills/shared/ the steps the first three share, reading the arguments and checking the
                          checkout against the pull request, and the first two's committing and pushing
docs/                     the guides README.md links to
types/index.d.ts          the state the pane reads
sounds/alert.wav          the alert sound
assets/                   the logo and screenshots the README shows, and the icon Anthropic's directory lists
```

Work on the plugin from a clone of [the repository](https://github.com/maturada/gh-prs-monitor):
`claude --plugin-dir gh-prs-monitor`, from the clone's root, loads this folder for that session in place of an
installed copy, and `/reload-plugins` reads an edit. An installed plugin runs the copy its install made, and gets a
change only as a new version: `version` raised in `.claude-plugin/plugin.json`, merged to `main`, and then
`/plugin marketplace update gh-prs-monitor` or the marketplace's auto-update. How a change gets there:
[CONTRIBUTING.md](https://github.com/maturada/gh-prs-monitor/blob/main/CONTRIBUTING.md); what CI and the release do
by themselves: [maintenance/README.md](https://github.com/maturada/gh-prs-monitor/blob/main/maintenance/README.md#what-runs-by-itself).

`maintenance/check.sh`, in the repository, runs the checks: `claude plugin validate` (the manifest, the hooks, what
they call and touch), Prettier, `claude plugin test`, and last TypeScript against the engine's API types, which fails
the script when those types are missing. TypeScript and Prettier come at the versions the script pins, from outside
this folder; there is no `package.json`, as Claude Code installs a plugin's npm dependencies, development ones
included, with the plugin.

The type check reads the engine's API types from `.claude-plugin/types/`, which the engine writes when it loads the
plugin from this folder in a session it can draw: start `claude --plugin-dir gh-prs-monitor` from the repository's root
once (a headless `claude -p` writes none). From the repository's root, `claude plugin validate .` checks the
marketplace that lists the plugin.

## What the code relies on in the engine

Each of these is a behaviour of Claude Code the code works with, named where it does so; a new engine version that
changes one is where to look first.

- Engines before 2.1.292 refuse a hooks module that declares the name of a function handed `$` twice, even in another
  scope: no variable or parameter in `hooks/register.tsx` takes the name of a function there that is handed `$`.
- The desktop app presses a button by the handle of the drawing it shows, and a redraw that builds the button anew
  drops that handle: `stableButtons` hands an unchanged button back as the same element.
- A plugin's own `$.command.run` does not pass through its own `command.run` hooks, so a skill a pane button starts
  marks its row itself (`runSkill`), while a typed one is caught by the hooks.
- A pane opened while another holds the keyboard opens behind it, as a tab, and a plugin can't bring it forward: so
  a question is drawn in the pane whose button was pressed, and only while `$.ui.panes()` says it is shown; otherwise
  the engine's own dialog asks.
- Escape, or the close mark, closes the pane as the person's close, raising `ui.close`: while a question is up, the hook
  takes it as Cancel and keeps the pane open. A question answered already that still shows has a press waiting on an
  engine call that never came back: that close lets it go and closes the pane, and the pane draws a question only while
  one is open (`drawnQuestion`). An answer's put-away is waited for two seconds at most, and a load's mark five, so one
  never answered holds no answer or load back. The test kit models no keyboard and raises no such close, so the hook's
  decision is tested on its own (`closeAsked`), as are those of the person's own scroll and keys (`windowMoved`,
  `focusMoved`).
- A plugin's `$.ui.scroll` names something drawn, never a row, and it reaches none of the plugin's own hooks: the
  engine leaves a plugin's hooks out of the scrolls and focus moves its own code raises (not a close: `/prs close`'s
  `$.ui.close` runs the plugin's `ui.close` hook). So the list comes back after a question with an empty
  mark drawn on the row kept, out of the flow (`BACK_MARK`), and the window is scrolled to it. A surface knows where the
  mark is once it has drawn the list again, which the desktop app does when next asked to draw: a try that finds no
  mark asks for a drawing (`$.ui.invalidate`) and comes again a moment later, and one that moved is made once more, for
  a surface that held the window to the question's length (`backToRow`). Where the mark is never found, the window goes
  to the button pressed. The row kept comes from the terminal's drawing, which carries the window's row; the desktop
  app moves the window without drawing the pane again, and its drawing carries the row as the app last sent it, so the
  `ui.scroll` hook keeps where each of the person's moves over the list lands. The test kit carries out no plugin's
  scroll, so the mark drawn is tested in the pane, and the window's way to it (`goBack`) through a host of its own.
- The VS Code extension (2.1.299 and later) lays a tree out in rows of text as the terminal does, a gap of 1 a blank
  line and a fraction of one drawn as such (a quarter keeps framed buttons apart), while it draws the desktop app's
  framed buttons and cards. A row Box wraps there unless it says `flexWrap="nowrap"`. It ignores `position` (so the mark
  above isn't drawn there, and the window goes to the button pressed), `hover`, and a button's `plain` and `hotkey`. It
  draws the theme's `warning` in its menus' text colour and knows no `merged`, while a named colour follows the editor
  theme's terminal colours; it folds the status line's plain spaces into one; and it draws toasts, above its prompt box.
  `hooks/layout.ts` names each of these. Its new tab opens from `<scheme>://anthropic.claude-code/open?prompt=…`, the
  scheme the editor's `product.json` names (`urlProtocol`), which `VSCODE_NLS_CONFIG`'s messages file leads to
  (`editorScheme`): the extension tells the plugin neither. Where it isn't found, VS Code's own scheme is tried, and a
  link that doesn't open runs the skill in this session (`runsHereWhenUnopened`); a scheme that opens another app, as VS
  Code beside the editor pressed in, can't be told from one that opens the right one.
- Sizes are in character cells on every surface, and an app's cells are wider than its text: a width that holds a
  text to its length in the terminal leaves a gap after it in an app. So such widths are the terminal's alone (a
  detail's, a column's), and in an app a text shrinks to its line and wraps, as a title does.
- The plugin's store is one JSON file for every session of an install (under `~/.claude/plugins/store/`): each read
  reads the file, and each write locks it, reads it again, sets its key and replaces the file whole, so a session's next
  read sees another's write, and writes to different keys never undo one another (a read then a write, as `shareAnswer`
  and a cleanup's claim make, is two calls, which another session's may come between). It holds 4 MiB of JSON across all
  keys: a write that would pass that is refused in words the plugin reads ("the store would be N characters, over the M
  limit", `isStoreFull`, as of 2.1.296), and the answers sessions share give way first. No event says another session
  wrote it, so a session looks (`checkShared`). It is kept per plugin source (`name@marketplace`, or `name@inline` for a
  plugin handed in with `--plugin-dir`, as the desktop app hands in installed plugins), so the desktop app's sessions
  never share it with the terminal's, nor with VS Code's, which load the installed plugin as the terminal does. The test
  kit has no store of its own: the tests' world answers the store's events from a store in memory
  (`hooks/testing/memory-store.ts`), and store.test.ts hands store.ts a host over the same one.
- Claude Code asks before a command writes a file into a repository's `.git` folder, as hooks or config planted there
  run on the next git command; git's own writes there go on unasked. So the create-pr skill keeps its choices in the
  plugin's store, through a tool the plugin registers (`$.tool.register`; the model calls it
  `mcp__gh-prs-monitor__create_pr_choices`, behind ToolSearch by default). The plugin's `tool.call` hook answers it
  without calling `next`, where the permission check runs, so the call asks nothing.
- A hook's reads of the session's state (`state.get`) show one moment until it answers: its own writes after it, and
  no other hook's. A command that prints what a load another hook started will show (the session's first, still
  running as a first prompt arrives) would read the list from before it, so the printed `/prs` and `/prs tickets` load
  once more within the command after it (`refreshInTurn`), at the cost of one more GitHub request when a load is under
  way. Work a command leaves running reads the state as it stands once the command has answered: `/prs tickets` in the
  pane answers at once, and its questions read the list as they are asked (`listedRows`).
- `$.ui.focus` moves the focus only within a pane that holds the keyboard, and a pane a typed command opens doesn't,
  unless it asks for it (`ui.open`'s `focus`), which the prompt grants while its composer is empty: so `/prs tickets`
  asks, for the link pasted next, and `/prs` leaves the keyboard at the prompt.
- An Input draws its `label` before it, its `placeholder` dim while empty, and its `submitLabel` beside it while it has
  focus (`↵Check`); the mobile app draws no Input, so a question that needs one says to answer on the computer there.
- The terminal keeps what was typed in an Input under its key, drawing that in place of the hook's `value` until the
  hook draws a different `value` or the pane closes (Enter empties it): so each question's field for instructions has
  a key of its own, or text typed for one would show in the next while its buttons sent none of it.
- The desktop app opens a folder under `.claude/worktrees/` as its repository, then starts the session in a scratch
  folder of its own: a new session for a worktree opens at the repository's root and the skill enters the worktree.
- A skill's `SKILL.md` is handed to the model with its arguments put in: `$ARGUMENTS` for all of them, and `$0`, `$1`
  and so on for each, wherever such a name stands, code examples included; the files it has the model read
  (`skills/shared/`, `references/`) come as they are. So in a `SKILL.md`, a `$` before a digit meant literally, as
  the `$0` of fix-ci's awk line, is written `\$0`, which comes through as `$0`.
