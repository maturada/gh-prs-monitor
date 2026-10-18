# When something is wrong

The pane shows the problem in a box framed in the warning colour, under the header and above the last list it read,
if any, with when that list is from. While the checks run by themselves it says how often they try again, and
**Retry** checks at once.

| Message | Fix |
|---|---|
| The GitHub CLI (gh) is not installed. | Install it from https://cli.github.com, then `gh auth login`. On Windows, restart Claude Code after installing: a running program keeps the `PATH` it started with. |
| This GitHub server lacks a field the plugin asks for: GitHub Enterprise Server needs to be 3.16 or later (…). | The server is older than the plugin's queries; nothing is asked again in this session. |
| The GitHub CLI is not signed in. | `gh auth login`. |
| This folder is not a git repository / This repository has no git remote, so it has no GitHub project. | Expected outside a GitHub repository. |
| This repository has no remote on a GitHub host the GitHub CLI is signed in to. | Expected for a repository on another service. On GitHub Enterprise, sign the CLI in to your server with `gh auth login --hostname <your server>`, then **Retry**. |
| No access to this repository (or to acme/app) with your GitHub account, or it does not exist on GitHub. | Your `gh` account can't see it; check `gh auth status`. |
| GitHub's own message about the organization's single sign-on (SAML) or IP allow list. | The organization hides its repositories from your token: authorize it for the organization (`gh auth refresh`, or the token's SSO settings on GitHub), or connect from an allowed network, then **Retry**. |
| GitHub refused the request (rate limit or permissions). / Could not reach GitHub. / GitHub took too long to answer, or had an error of its own. / GitHub sent a response that could not be read. / GitHub sent no data. / GitHub left part of the answer out, or GitHub's own message about a part it failed to work out. / The GitHub CLI did not finish (…). | Tried again by the next check (in on-demand mode, the next `/prs` or Refresh), or **Retry**. |

After fixing a problem, press **Retry** (or **Refresh**) in the pane, or run `/prs`, to start again.

**The pane's buttons and its close mark do nothing**, while hovering still highlights them and the wheel still
scrolls: Claude Code no longer passes the pane its clicks (seen in VS Code's terminal); clicking in the pane doesn't give
it the keyboard either. `/prs close` closes it; restarting Claude Code brings the clicks back.

**The pane lists another repository than you expected**, as in a fork's clone: with several remotes, `gh` picks the
repository, the one `gh repo set-default` chose, else the remote named `upstream`, `github`, then `origin`. Run
`gh repo set-default` in the folder to choose; a session takes the repository once, so sessions started after it list
the one chosen.

**Resolve Conflicts stops before it merges** where the checkout:

- is in the middle of a merge, a rebase, a cherry-pick or a revert (finish or abort it, or work in a worktree);
- lacks commits GitHub's branch has (let it bring them in first);
- is a sparse checkout (a full clone works).

In a repository that allows only rebase merging, it asks before rebasing, as a rebase rewrites the branch and needs a
force push.

**Its last step**, moving your checkout onto the merge, stops rather than overwrite a file git doesn't track or a change
you haven't committed. Move the file aside, or commit or stash the change, then run the command it gives. Meanwhile the
merge waits in a temporary worktree, and nothing is pushed.

**Something else?** `/prs report` prints a link to report it, with the versions of the plugin, Claude Code, the
system, `gh` and git filled in.
