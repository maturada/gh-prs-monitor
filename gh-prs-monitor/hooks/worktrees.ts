// Author: David Matura

// The worktrees and branches /prs makes for pull requests, by their `pr-<number>` names, and git's list of worktrees.

import { branchName, git, isUnder } from "./machine"
import type { Host } from "./machine"

// A worktree, and the name of the branch it holds; null where it holds none.
export type Worktree = { path: string; branch: string | null }

// git's list of the clone's worktrees, asked in `root`, or in the session's folder. git keeps each worktree's path as
// it was when made: after the repository's folder was renamed in case only (`work` to `Work`), where the file system
// ignores case (`core.ignorecase`), a path git still reports in the old spelling is respelt to `root`'s, so it equals
// the path built from `root`.
export async function listWorktrees(host: Host, root?: string): Promise<Worktree[]> {
  const listed = parseWorktreeList((await git(host, ["worktree", "list", "--porcelain"], root)).stdout)
  const isRespelt =
    root !== undefined &&
    listed.some((worktree) => !isUnder(worktree.path, root) && isUnder(worktree.path.toLowerCase(), root.toLowerCase()))
  if (!isRespelt || (await git(host, ["config", "--type=bool", "core.ignorecase"], root)).stdout.trim() !== "true") {
    return listed
  }

  return listed.map((worktree) =>
    isUnder(worktree.path.toLowerCase(), root.toLowerCase())
      ? { ...worktree, path: `${root}${worktree.path.slice(root.length)}` }
      : worktree
  )
}

// `git worktree list --porcelain`: one block per worktree, blank-line separated; `branch` is absent when
// the worktree is detached.
export function parseWorktreeList(porcelain: string): Worktree[] {
  return porcelain
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n")
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length)
      const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? null

      return path ? { path, branch: branch === null ? null : branchName(branch) } : null
    })
    .filter((worktree): worktree is Worktree => worktree !== null)
}

// The local name /prs checks a pull request out as where its head's name won't do: a fork's, which may share that name
// with a branch here, and any whose branch of that name the person works on or has gone its own way, so the person's
// own branch is never moved.
export function prBranch(pullNumber: number): string {
  return `${PR_PREFIX}${pullNumber}`
}

// What the names of /prs's worktrees and branches start with, `pr-<number>`.
export const PR_PREFIX = "pr-"

// The pull request a name `prBranch` gives is for; null for any other name.
export function prNumberOf(name: string): number | null {
  const rest = name.startsWith(PR_PREFIX) ? name.slice(PR_PREFIX.length) : ""

  return /^\d+$/.test(rest) ? Number(rest) : null
}

// Under the repository's .claude/worktrees, the one place a session can switch into an existing worktree
// from another worktree.
export function worktreePath(mainRoot: string, pullNumber: number): string {
  return `${mainRoot}/.claude/worktrees/${prBranch(pullNumber)}`
}

// The pull request a worktree /prs made is for, from its folder's name; null for any other worktree.
export function worktreePullNumber(mainRoot: string, path: string): number | null {
  const folder = `${mainRoot}/.claude/worktrees/`

  return path.startsWith(folder) ? prNumberOf(path.slice(folder.length)) : null
}

// `git rev-parse --git-common-dir` names the main checkout's .git from any of its worktrees; a bare
// repository or a separate git dir has no such parent, and the caller falls back to the toplevel.
export function mainRootOf(commonDir: string): string | null {
  const trimmed = commonDir.trim().replace(/\/+$/, "")

  return trimmed.endsWith("/.git") ? trimmed.slice(0, -"/.git".length) : null
}

export const WORKTREES_IGNORE_LINE = "/.claude/worktrees/"
