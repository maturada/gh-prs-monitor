// Author: David Matura

// A skill's argument line: how the pane writes it, a value that may hold spaces in double quotes, as the skills read
// it, with a backslash or quote in it escaped, and instructions on one line, after `--`; and the pull request a line
// names, read back as a skill's turn starts.

import { sameRepo } from "./gh"
import type { RepoRef } from "./gh"

export function quotedArg(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

// What a terminal reads as colour or control, as an installer's coloured last line holds, is left out.
export function oneLine(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// The pull request a skill's arguments name, as given: the first word that is not one of the options the pane writes
// (`--worktree "…"`, `--deps "…"`, `--branch "…"`, `--include-outdated`), before any ` -- ` instructions; a review's
// `since` follows it. None when they name none, as Create PR's, or a branch skill typed bare, which works on the
// current branch's.
export function pullRefIn(args: string): string | null {
  const options = args.split(/(?:^|\s)--(?:\s|$)/)[0] ?? ""
  const words = options
    .replace(/--(?:worktree|deps|branch)\s+"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/--include-outdated/g, " ")
    .trim()

  return words === "" ? null : words.split(/\s+/)[0]!
}

// The number of the pull request a reference names: `7`, `#7`, or an address on this repository; none for another's.
export function pullNumberOf(ref: string, repo: RepoRef | null): number | null {
  const number = /^#?(\d+)$/.exec(ref)
  if (number) {
    return Number(number[1])
  }
  const address = readAddress(ref)
  if (!address || address.number === null || !repo) {
    return null
  }

  return sameRepo(address, repo) ? address.number : null
}

// The repository an address on GitHub leads to, its server's name as written, and the pull request it names where it
// leads to one (`/pull/7`, whatever follows); none for anything else, a name GitHub couldn't hold among it.
export function readAddress(text: string): { host: string; name: string; number: number | null } | null {
  const address = /^https?:\/\/([^/\s]+)\/([^/\s]+\/[^/\s?#]+?)(?:\.git)?(?:\/pull\/(\d+))?(?:[/?#]\S*)?$/.exec(
    text.trim()
  )
  if (!address || !isRepoName(address[2]!)) {
    return null
  }
  const [, host, name, number] = address

  return { host: host!, name: name!, number: number === undefined ? null : Number(number) }
}

// `owner/name` as GitHub allows it: an owner of letters, digits and hyphens; a repository's name of those, `.` and
// `_`, but `.` or `..` alone.
export function isRepoName(name: string): boolean {
  return /^[\w-]+\/[\w.-]+$/.test(name) && !/\/\.\.?$/.test(name)
}
