// Author: David Matura

// The machine the modules run git and gh on, handed in by the hooks module so they stay free of the engine (which only
// follows `$` within the module that declares its hooks), and what git says that several of them read.

import type { ProcessRunInit, ProcessRunResult } from "claude-code"

export type Host = {
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  // Whether the path is itself a symbolic link, wherever it leads.
  isLink: (path: string) => Promise<boolean>
}

// git with no hooks, as every git command here runs: a repository that keeps its hooks among its own files (husky, or
// a hooks folder `core.hooksPath` names) would run a pull request's own code, a fork's too, from a checkout of it.
export const GIT = ["git", "-c", "core.hooksPath=/dev/null"] as const

export function git(host: Host, args: string[], cwd?: string, stdin?: string): Promise<ProcessRunResult> {
  return host.run([...GIT, ...args], { cwd, timeoutMs: 60_000, ...(stdin === undefined ? {} : { stdin }) })
}

// A branch's name, from the full name git gives it (`refs/heads/<name>`); anything else, as "HEAD", as it is.
export function branchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref
}

// The names in a list git wrote with `-z`.
export function namesIn(listed: string): string[] {
  return listed.split("\0").filter((name) => name !== "")
}

// The names in such a list, where git gave it whole: null where it failed or its output was cut short.
export function namesOf(ran: ProcessRunResult): string[] | null {
  return ran.exitCode === 0 && !ran.isStdoutTruncated ? namesIn(ran.stdout) : null
}

// The folders a path lies in: `a` and `a/b` for `a/b/c`.
export function foldersOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1)

  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

// Whether a path is a folder or lies in it; every path lies in the root, "".
export function isUnder(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`)
}

// The commit a local branch is at, or "" where there is no such branch.
export async function branchTip(host: Host, branch: string, cwd?: string): Promise<string> {
  const ran = await git(host, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)

  return ran.exitCode === 0 ? ran.stdout.trim() : ""
}

// Whether commit `head` is `tip` or one before it, so a branch at `head` holds nothing `tip` lacks: git can't tell
// where this clone lacks either commit, as one pushed from elsewhere and never fetched.
export async function isWithin(host: Host, head: string, tip: string): Promise<"within" | "not" | "unknown"> {
  if (head === tip) {
    return "within"
  }
  const { exitCode } = await git(host, ["merge-base", "--is-ancestor", head, tip])

  return exitCode === 0 ? "within" : exitCode === 1 ? "not" : "unknown"
}
