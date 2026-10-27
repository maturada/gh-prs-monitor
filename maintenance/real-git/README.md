# Real git: the plugin's checkouts, copies and cleanup on throwaway repositories

The test suite answers git with a fake host. These cases run the plugin's own code (`switchHere`, `switchToBase`,
`prepareWorktree`, `copyIncluded`, `firstNotInMain`, `removePullWorktree`, `ensureDependencies`, `mainRoot`,
`readClone`, `readFolder`, `checkClone`) against real git, in repositories made for each case: a bare `acme/app.git`
standing in for GitHub, a teammate's clone that pushes the pull request's branch, and the person's clone the plugin
works in. GitHub's API is answered by the harness from the bare repository; nothing reaches the network.

Each case states what should happen in its title (`=== … : kept`, `removed`, `copied …`), and the switch cases print
what the plugin did beside what plain git and gh's own checkout steps do in the same clone, and what each lost:

```
=== env
  plugin: STOPPED: not switched: that would overwrite .env in this checkout, … | lost: none
  noi:    refused: error: The following untracked working tree files would be overwritten by checkout:
  merge:  refused: … | lost: none
  plain:  switched | lost: .env  | after back: .env
```

Needs git, [Bun](https://bun.sh) and Python 3. The skill sets take their commands from the skills' own text, so a
skill's edit is checked as written.

## Running it

From the repository root:

```
zsh maintenance/real-git/run.sh gh-prs-monitor now                      # every set (about five minutes)
zsh maintenance/real-git/run.sh gh-prs-monitor now cleanup include-copy  # the sets named
zsh maintenance/real-git/run.sh <older copy> before                      # a version before, to compare
python3 maintenance/real-git/compare.py before now
```

Outputs are in `.work/real-git/<name>/`; the last run's repositories are under `.work/real-git/run/git/`. Every git
command runs with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, so no setting of yours reaches a case, and only
folders under the run's `git/` are touched. `deps-yarn-pnp` runs real Yarn 4 through corepack (it needs Node and the
network the first time), so it runs only when named.

## The sets

| Sets | What they cover |
|---|---|
| `switch-*` (but `switch-base`) | **Here, switch branch**: ignored files in the way, uncommitted changes, local branches of the head's name, forks and their upstreams, sparse and linked checkouts, a folder mid-rebase, hooks a fork's code carries, the install after a switch |
| `switch-base` | **Switch to main** after a squash merge: no local base, one ahead or gone its own way, one another worktree holds, uncommitted, untracked and ignored files, a branch pushed without `-u`, a fork's remote |
| `worktree*` | /prs's own worktree: made, reused, updated, refused, links in the way, a sparse clone |
| `include-*` | what `.worktreeinclude` copies, and that cleanup compares exactly what the copy took |
| `cleanup*` | when a merged pull request's worktree is removed and when it is kept: copies the same or edited, what tools make again |
| `deps`, `deps-yarn-pnp` | the projects found in a monorepo and the installs run, faked or real |
| `skill-resolve-conflicts`, `skills` | the skills' git commands as their text gives them: merges, rebases, pushes, the moves of a checkout |
| `clones` | the folder a session notes (its main checkout, from a worktree too) and the folders a visit offers, by their own git config: moved, deleted, pointed elsewhere, an SSH alias, a fork; a typed folder's repository as gh picks it |

`probe-switch.sh` and `probe-states.sh` are the probes the switch sets run each case through; `lib.sh` makes the
repositories. The harness (`harness/`) calls the plugin's functions with a host over the real machine
(`real-host.ts`).

## Reading a comparison

Between two versions, every difference should be a change one of them meant: a fix, a new rule. A run of the same
version twice gives no difference.
