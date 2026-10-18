// Author: David Matura

// The one refusing switch that moves a folder onto a branch at the pull request's commit, and what git says when it
// refuses: the files in the way, the change it would lose, or the operation under way.

// Where a checkout happens: /prs's own worktree, or the folder the person chose to switch ("Here, switch branch"),
// with where the pull request's own worktree would be.
export type CheckoutPlace = { kind: "worktree" } | { kind: "here"; ownWorktree: string }

import { failureLine } from "./gh"
import { branchTip, foldersOf, git, GIT, namesIn } from "./machine"
import type { Host } from "./machine"
import type { FetchedPull, Upstream } from "./fetch-source"

// What came of moving a folder onto a branch at the pull request's commit.
export type Move =
  | { kind: "moved" }
  | { kind: "diverged" }
  | { kind: "held"; reason: string }
  | { kind: "inTheWay"; paths: string[] }
  | { kind: "changed"; paths: string[] }
  | { kind: "busy"; operation: string }
  | { kind: "failed"; reason: string }

// Puts the folder at `cwd` on `branch` at the pull request's commit in one `git switch --no-overwrite-ignore`, which
// checks every path before it writes any: where the commit has a file git doesn't track here, as an ignored `.env`
// (which a switch otherwise writes over without a word, and switching back deletes), or an uncommitted change it
// would overwrite, git refuses and nothing changes, the branch included. It refuses as well in a folder in the middle
// of a merge, a rebase, a cherry-pick, a revert or `git am`, whose next step would land on the new branch. A sparse
// checkout is checked first (`untrackedInTheWay`). A branch there already is only fast-forwarded, or taken as it is
// where it holds commits beyond GitHub's, unless `isForced`, and keeps what it pulls from; one made here pulls from
// where gh pr checkout would have it pull.
export async function moveTo(
  host: Host,
  cwd: string | undefined,
  branch: string,
  pull: FetchedPull,
  { isForced = false }: { isForced?: boolean } = {}
): Promise<Move> {
  const tip = await branchTip(host, branch, cwd)
  let onto = tip === "" ? ["-c", branch, pull.commit] : ["-C", branch, "--no-track", pull.commit]
  let target = pull.commit
  if (tip !== "" && tip !== pull.commit && !isForced) {
    const relation = await relationOf(host, cwd, tip, pull.commit)
    if (relation !== "behind" && relation !== "ahead") {
      return relation
    }
    if (relation === "ahead") {
      onto = [branch]
      target = tip
    }
  }
  const inTheWay = await untrackedInTheWay(host, cwd, target)
  if (inTheWay !== null) {
    return inTheWay
  }
  const moved = await host.run([...GIT, "switch", "--no-overwrite-ignore", ...onto], {
    cwd,
    env: IN_GIT_WORDS,
    timeoutMs: MOVE_TIMEOUT_MS
  })
  if (moved.exitCode !== 0) {
    return refusedMove(moved.stderr)
  }
  const merge = await git(host, ["config", "--get", `branch.${branch}.merge`], cwd)
  if (merge.stdout.trim() === "") {
    await setUpstream(host, cwd, branch, pull.upstream)
  }

  return { kind: "moved" }
}

// A move cut off partway leaves files written and the branch where it was, so it gets as long as an install.
const MOVE_TIMEOUT_MS = 600_000

// In a sparse checkout git (2.50) writes over files it doesn't track, ignored or not, where a move brings in a file,
// with no refusal: those that would be lost are found here instead, at a path the move to `target` writes, in a folder
// holding one, or inside a folder it makes a file; compared ignoring case, as the file system may. Every path the move
// changes counts, those outside the sparse patterns, which git leaves alone, too: a stop costs moving a file aside, a
// miss loses it. Null where the checkout is not sparse, and git's own refusal holds, or where nothing is in the way.
async function untrackedInTheWay(host: Host, cwd: string | undefined, target: string): Promise<Move | null> {
  const sparse = await git(host, ["config", "--type=bool", "--get", "core.sparseCheckout"], cwd)
  if (sparse.stdout.trim() !== "true") {
    return null
  }
  const listed = ["ls-files", "--others", "--directory", "--no-empty-directory", "--full-name", "-z", "--", ":/"]
  const untracked = await git(host, listed, cwd)
  const written = await git(host, ["diff-tree", "-r", "--name-only", "--no-renames", "-z", "HEAD", target], cwd)
  const unread = [untracked, written].find((ran) => ran.exitCode !== 0 || ran.isStdoutTruncated)
  if (unread) {
    const why = unread.exitCode !== 0 ? failureLine(unread.stderr) : "too many to read"
    return {
      kind: "failed",
      reason: `this checkout is sparse, where git writes over files it doesn't track without refusing, and those could not be checked (${why})`
    }
  }

  const key = (path: string): string => path.replace(/\/$/, "").normalize("NFC").toLowerCase()
  const writes = new Set(namesIn(written.stdout).map(key))
  const folders = new Set([...writes].flatMap(foldersOf))
  const paths = namesIn(untracked.stdout).filter((path) => {
    const at = key(path)

    return writes.has(at) || folders.has(at) || foldersOf(at).some((folder) => writes.has(folder))
  })

  return paths.length > 0 ? { kind: "inTheWay", paths } : null
}

// Where a branch's `tip` stands against the pull request's `commit`: behind it, ahead of it, or gone its own way.
async function relationOf(
  host: Host,
  cwd: string | undefined,
  tip: string,
  commit: string
): Promise<"behind" | "ahead" | Move> {
  for (const [from, to, relation] of [
    [tip, commit, "behind"],
    [commit, tip, "ahead"]
  ] as const) {
    const ran = await git(host, ["merge-base", "--is-ancestor", from, to], cwd)
    if (ran.exitCode === 0) {
      return relation
    }
    if (ran.exitCode !== 1) {
      return { kind: "failed", reason: failureLine(ran.stderr) }
    }
  }

  return { kind: "diverged" }
}

// git's messages untranslated, as `refusedMove` reads them.
const IN_GIT_WORDS = { LC_ALL: "C" }

// Sets what a branch with none pulls from, as gh pr checkout does; a branch that can't is still checked out. One that
// follows a remote's copy of a branch pulls by rebasing where the person has git set up so (`branch.autoSetupRebase`),
// as `--track`, which gh passes there, would have it.
async function setUpstream(host: Host, cwd: string | undefined, branch: string, upstream: Upstream): Promise<void> {
  await git(host, ["config", `branch.${branch}.remote`, upstream.remote], cwd)
  if (upstream.isPush) {
    await git(host, ["config", `branch.${branch}.pushRemote`, upstream.remote], cwd)
  }
  await git(host, ["config", `branch.${branch}.merge`, upstream.merge], cwd)
  const rebases = (await git(host, ["config", "--get", "branch.autoSetupRebase"], cwd)).stdout.trim()
  if (!upstream.isPush && (rebases === "always" || rebases === "remote")) {
    await git(host, ["config", `branch.${branch}.rebase`, "true"], cwd)
  }
}

// git's refusal to switch, as it words it: the paths, tab-indented, under what is wrong with them. A file it doesn't
// track where the commit has one or needs a folder, or a folder holding such files where the commit has a file, is in
// the way; a tracked file's uncommitted change would be lost. Or an operation git is in the middle of.
function refusedMove(stderr: string): Move {
  const busy = /^fatal: cannot switch branch (?:while (\S+)|in the middle of an am session)/m.exec(stderr)
  if (busy) {
    return { kind: "busy", operation: OPERATIONS[busy[1] ?? "am"] ?? "an operation" }
  }
  const inTheWay: string[] = []
  const changed: string[] = []
  let under: { paths: string[]; end: string } | null = null
  for (const line of stderr.split("\n")) {
    if (line.startsWith("\t") && under !== null) {
      under.paths.push(`${line.slice(1)}${under.end}`)
    } else if (/^error: Your local changes to the following files/.test(line)) {
      under = { paths: changed, end: "" }
    } else if (/^error: The following untracked working tree files would be/.test(line)) {
      under = { paths: inTheWay, end: "" }
    } else if (/^error: Updating the following directories would lose untracked files/.test(line)) {
      under = { paths: inTheWay, end: "/" }
    } else {
      under = null
    }
  }
  if (inTheWay.length > 0) {
    return { kind: "inTheWay", paths: inTheWay }
  }
  if (changed.length > 0) {
    return { kind: "changed", paths: changed }
  }

  return isHeldElsewhere(stderr)
    ? { kind: "held", reason: failureLine(stderr) }
    : { kind: "failed", reason: failureLine(stderr) }
}

const OPERATIONS: Record<string, string> = {
  merging: "a merge",
  rebasing: "a rebase",
  "cherry-picking": "a cherry-pick",
  reverting: "a revert",
  am: "`git am`"
}

// A branch another worktree holds, as git refuses it.
function isHeldElsewhere(stderr: string): boolean {
  return /already (used by worktree|checked out)/i.test(stderr)
}

// Why a move failed, worded for where it was to happen, or null when it did not. A local branch that went its own
// way from the pull request stops it until it is reset or deleted; nothing here does either when that could lose work.
export function failureOf(move: Move, branch: string, place: CheckoutPlace): string | null {
  const where = place.kind === "here" ? "this checkout" : "the worktree"
  const apart = place.kind === "here" ? `, or choose "Worktree, this session"` : ""
  switch (move.kind) {
    case "moved":
      return null
    case "diverged":
      return `the local branch ${branch} has gone its own way from the pull request: reset or delete it once nothing of yours is on it`
    case "inTheWay":
      return `that would overwrite ${namedFew(move.paths)} in ${where}, which git doesn't track and the pull request's branch does: move ${move.paths.length === 1 ? "it" : "them"} aside${apart}`
    case "changed":
      return `that would overwrite uncommitted changes to ${namedFew(move.paths)} in ${where}: commit or stash them first${apart}`
    case "busy":
      return `${where} is in the middle of ${move.operation}: finish or abort it first${apart}`
    case "held":
    case "failed":
      return move.reason
  }
}

// A few paths by name, then how many more.
function namedFew(paths: readonly string[]): string {
  if (paths.length > NAMED_PATHS + 1) {
    return `${paths.slice(0, NAMED_PATHS).join(", ")} and ${paths.length - NAMED_PATHS} more`
  }

  return paths.length === 1 ? paths[0]! : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`
}

const NAMED_PATHS = 3
