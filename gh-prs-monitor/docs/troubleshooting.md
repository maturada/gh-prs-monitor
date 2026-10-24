# When something is wrong

Most problems show in the pane itself, with what to do about them. This page lists each message and its fix, then a
few problems that come with no message.

## Messages in the pane

The pane shows the problem in a box framed in the warning colour, under the header. Above the last list it read, if
any, it says when that list is from.

While the checks run by themselves, the box says how often they try again, and **Retry** checks at once. Where it
leaves no list to show, **Show Another Repository** opens the
[repository picker](other-repositories.md#the-repository-picker).

| Message | Fix |
|---|---|
| The GitHub CLI (gh) is not installed. | Install it from https://cli.github.com, then `gh auth login`. On Windows, restart Claude Code after installing: a running program keeps the `PATH` it started with. |
| This GitHub server lacks a field the plugin asks for: GitHub Enterprise Server needs to be 3.16 or later (…). | The server is older than the plugin's queries; nothing is asked again in this session. |
| The GitHub CLI is not signed in. | `gh auth login`. |
| This folder is not a git repository, so it has no GitHub project. | Expected outside a GitHub repository. |
| This repository has no git remote, so it has no GitHub project. | Expected for a repository that was never pushed anywhere. |
| This repository has no remote on a GitHub host the GitHub CLI is signed in to. | Expected for a repository on another service. On GitHub Enterprise, sign the CLI in to your server with `gh auth login --hostname <your server>`, then **Retry**. |
| No access to this repository (or to acme/app) with your GitHub account, or it does not exist on GitHub. | Your `gh` account can't see it; check `gh auth status`. |
| GitHub's own message about the organization's single sign-on (SAML) or IP allow list. | The organization hides its repositories from your token: authorize it for the organization (`gh auth refresh`, or the token's SSO settings on GitHub), or connect from an allowed network, then **Retry**. |
| The GitHub CLI is not signed in to ghe.example.com. Run: gh auth login --hostname ghe.example.com | A repository you showed is on a server `gh` isn't signed in to: run that, or show another. |
| GitHub answered acme/web under another name again: try once more. | The repository was renamed again while the plugin looked it up: show it once more. |
| GitHub refused the request (rate limit or permissions). / Could not reach GitHub. / GitHub took too long to answer, or had an error of its own. / GitHub sent a response that could not be read. / GitHub sent no data. / GitHub left part of the answer out, or GitHub's own message about a part it failed to work out. / The GitHub CLI did not finish (…). | Tried again by the next check (in on-demand mode, the next `/prs` or Refresh), or **Retry**. |

After fixing a problem, press **Retry** (or **Refresh**) in the pane, or run `/prs`, to start again.

## Problems without a message

**The pane's buttons and its close mark do nothing**, while hovering still highlights them and the wheel still scrolls:
Claude Code no longer passes the pane its clicks (seen in VS Code's terminal). Clicking in the pane doesn't give it the
keyboard either. `/prs close` closes it; restarting Claude Code brings the clicks back.

**In VS Code, `/prs` prints the list instead of opening the pane**: the Claude Code extension draws what plugins add
from its version 2.1.299, in a session that
[fetches feature flags](https://code.claude.com/docs/en/env-vars#features-that-need-feature-flag-fetching). Update the
extension, or see that page for what turns the fetching off.

**In VS Code, New session runs the skill in this session instead**, and the alert says the link didn't open. The
plugin opens a new tab through the extension's link, in the scheme your editor names in its `product.json`, or in
VS Code's where it can't read that, and nothing on the machine answered it.

With VS Code installed beside another editor, that last case opens the tab in VS Code instead. A bug report naming your
editor helps (`/prs report`).

**The pane lists another repository than you expected**, as in a fork's clone. With several remotes, `gh` picks the
repository: the one `gh repo set-default` chose, else the remote named `upstream`, `github`, then `origin`.

Run `gh repo set-default` in the folder to choose. A session takes the repository once, so sessions started after it
list the one chosen. A folder's path typed in `/prs` or the repository picker names its repository by the same order of
remotes.

**`+N elsewhere` doesn't show in the pane's header**: **Alerts from other repositories** is off (the default), or
nothing waits for you outside the folder's repository and the one shown. The number counts a review asked of you, and
on your own pull requests CI failing, changes requested, or an approval with the checks done.

The count updates in background mode only while a terminal, the desktop app or VS Code shows the session, and in
while-open mode only while the pane is open. A check that fails leaves the count as it was
([Other repositories](other-repositories.md#alerts-from-other-repositories)).

**A folder isn't offered in the repository picker**: the picker lists the clones where a Claude Code session loaded its
list, the 50 latest. A clone stays only while its own git config still names that repository (or the name it had
there, where GitHub renamed or moved it since), and only the latest loaded one is offered for each repository. Another
checkout of the folder's own repository counts as the folder.

The picker knows a clone once a session there has loaded its list; until then, type its path or `owner/name`. A path in
no git repository, as one mistyped, gives `<path> is in no git repository: check the path.`; one that is no clone gives
`<path> is no clone of a GitHub repository: its git config names no remote on a GitHub server.`, as does a clone whose
remote is set in a file its config includes, or rewritten by `insteadOf`, which aren't followed (type `owner/name` for
it); one whose remotes are all on servers the GitHub CLI isn't signed in to names them, and says how to sign in. More in
[the picker](other-repositories.md#the-repository-picker).

**Resolve Comments, Fix CI or Resolve Conflicts on another repository's pull request asks you to open a session
elsewhere**: these skills work in a clone of that repository, never in the folder you are in.

With a clone known, you can open a session there. With none known, the question says to open a session in a clone of it
once, and it is offered from then on ([Other repositories](other-repositories.md#buttons-on-its-rows)).

**Resolve Conflicts stops before it merges** where the checkout:

- is in the middle of a merge, a rebase, a cherry-pick or a revert (finish or abort it, or work in a worktree);
- lacks commits GitHub's branch has (let it bring them in first);
- is a sparse checkout (a full clone works).

In a repository that allows only rebase merging, it asks before rebasing, as a rebase rewrites the branch and needs a
force push.

**Resolve Conflicts' last step**, moving your checkout onto the merge, stops rather than overwrite a file git doesn't
track or a change you haven't committed. Move the file aside, or commit or stash the change, then run the command it
gives.

Meanwhile the merge waits in a temporary worktree, and nothing is pushed.

## Versions and setups

The minimum versions are in the [README](../README.md#requirements). This is what the plugin has been tried on, and what
a few features need beyond the minimum.

**Claude Code** 2.1.292 or later. The plugin is tested on 2.1.292, 2.1.295, 2.1.296 and 2.1.299 to 2.1.304, the desktop
app's 2.1.293, and the VS Code extension's 2.1.303.

- **Alerts as system notifications** needs 2.1.295; before it, alerts show as toasts only.
- In VS Code and editors built on it, the pane needs the Claude Code extension 2.1.299 or later, in a session that
  [fetches feature flags](https://code.claude.com/docs/en/env-vars#features-that-need-feature-flag-fetching).
  Otherwise `/prs` prints the list (see above).

**The GitHub CLI (`gh`)** 2.53 or later, signed in with `gh auth login`. The plugin works through your `gh` account and
has no token of its own, so it sees what you can see. It is tested with `gh` 2.97.

- **Update Branch** needs `gh pr update-branch`, which came with 2.53.
- If `gh` is missing or signed out, a notice tells you once, with the fix (the first rows of the table above).

**git** 2.31 or later. The worktrees the branch skills work in, and their cleanup, use
`git rev-parse --path-format=absolute`; **Here, switch branch** uses `git switch`.

**A folder whose git remote is on GitHub**: github.com, or GitHub Enterprise Server 3.16 or later, the version whose
schema the list query was checked against. Anywhere else the plugin stays quiet, and `/prs` says why.

With several remotes, `gh` picks the repository; how it chooses, and how to choose yourself, is in
the entry "The pane lists another repository than you expected" under
[Problems without a message](#problems-without-a-message).

## Something else?

For anything this page doesn't cover, `/prs report` prints a link to report it, with the versions of the plugin, Claude
Code, the system, `gh` and git filled in.
