// Author: David Matura

// Cleaning up after pull requests that left the lists: the worktrees and `pr-<number>` branches /prs made for them,
// removed once GitHub says they were merged or closed, unless something of the person's is on them or another pull
// request still needs them; and the notes on what stayed, told once across sessions.

import type { PullsSnapshot } from "../types"
import { holdsPullBranch, mainRoot } from "./checkout"
import { namesRepo } from "./fetch-source"
import type { PullWorktree } from "./checkout"
import { addStates, numbersToAsk } from "./ended"
import type { ClosedState } from "./ended"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { CLOSED_LOOKUP_LIMIT, isWithinOnGithub, pullStates } from "./github"
import { firstNotInMain } from "./include"
import type { KeptNotes } from "./kept-notes"
import type { Session } from "./session"
import { isAhead } from "./shared"
import { branchTip, git, isWithin } from "./machine"
import type { Host } from "./machine"
import { listWorktrees, prBranch, PR_PREFIX, prNumberOf, worktreePullNumber } from "./worktrees"

// What a cleanup reaches beyond git and gh (`Host`), handed in by the hooks module.
export type CleanupHost = Host & {
  log: (line: string) => void
  now: () => Promise<number>
  storedList: () => Promise<PullsSnapshot | null>
  announce: (repo: RepoRef, lines: readonly string[]) => Promise<void>
  // What cleanups left in place in a clone, by its main root, told once across sessions, as the store keeps it.
  recallKept: (repo: RepoRef, root: string) => Promise<KeptNotes>
  keepKept: (repo: RepoRef, root: string, kept: KeptNotes) => Promise<void>
  // The claim of the session cleaning up a clone now, as the store keeps it; freed only by the session that made it.
  recallCleanup: (root: string) => Promise<CleanupClaim | null>
  claimCleanup: (root: string, claim: CleanupClaim) => Promise<void>
  freeCleanup: (root: string, by: string) => Promise<void>
}

// A session's note that it is cleaning up a clone now: another session's pass there would find its removals half done,
// a folder half deleted read as one with changes, so that pass is left to the next (`isOthersCleanup`).
export type CleanupClaim = { by: string; at: number }

// How long a claim holds: past it, the session that claimed is taken to have gone. It is made again before each
// worktree and branch, so it covers the lookup and one removal, however many a pass makes.
export const CLEANUP_CLAIM_MS = 2 * 60_000

export function storedCleanupClaim(value: unknown): CleanupClaim | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const stored = value as Partial<CleanupClaim>

  return typeof stored.by === "string" && typeof stored.at === "number" ? (stored as CleanupClaim) : null
}

// A claim another session made that has not lapsed; none dated ahead of the clock.
function isOthersCleanup(claim: CleanupClaim | null, sessionId: string, now: number): boolean {
  return claim !== null && claim.by !== sessionId && now - claim.at < CLEANUP_CLAIM_MS && !isAhead(claim.at, now)
}

// The worktrees and `pr-<number>` branches /prs made for pull requests that left the lists are cleaned up once GitHub
// says they were merged or closed, one run at a time; a pull request leaving while one runs makes it look once more.
// What a load found of how they ended (`known`) is not asked again.
export async function cleanUp(
  host: CleanupHost,
  session: Session,
  repo: RepoRef,
  known: readonly ClosedState[]
): Promise<void> {
  session.cleanup.known = addStates(session.cleanup.known, known)
  if (session.cleanup.isRunning) {
    session.cleanup.isWanted = true

    return
  }
  session.cleanup.isRunning = true
  try {
    do {
      session.cleanup.isWanted = false
      await cleanUpPass(host, session, repo)
    } while (session.cleanup.isWanted)
  } finally {
    session.cleanup.isRunning = false
  }
}

// Each worktree's and branch's note is told once, as alerts are, and one left in place once across sessions too, until
// why it stays changes (`toldOnce`); the worktree this session works in stays until it leaves. One session cleans up a
// clone at a time: each session there that takes the same shared list starts a pass, and a pass while another's runs is
// skipped, so nothing is settled and the next pass looks again.
async function cleanUpPass(host: CleanupHost, session: Session, repo: RepoRef): Promise<void> {
  // This run's alone: those found while it runs go to the next.
  const known = session.cleanup.known
  session.cleanup.known = []
  const snapshot = await host.storedList()
  if (!snapshot) {
    return
  }
  const root = await mainRoot(host)
  if (isOthersCleanup(await host.recallCleanup(root), session.id, await host.now())) {
    session.cleanup.known = addStates(known, session.cleanup.known)

    return
  }
  // Claimed at once, so another session's pass starting meanwhile leaves this clone to this one.
  const claim = async (): Promise<void> => host.claimCleanup(root, { by: session.id, at: await host.now() })
  await claim()
  try {
    const { settledWorktrees, settledBranches } = session.cleanup
    const madeWorktrees = await pullWorktrees(host)
    const madeBranches = await pullBranches(host)
    const worktrees = cleanupCandidates(madeWorktrees, snapshot, settledWorktrees, CLOSED_LOOKUP_LIMIT)
    const branches = cleanupCandidates(madeBranches, snapshot, settledBranches, CLOSED_LOOKUP_LIMIT)
    const numbers = [...new Set([...worktrees, ...branches].map((each) => each.number))].slice(0, CLOSED_LOOKUP_LIMIT)
    // What was told of one gone, or of one whose pull request is open again, is forgotten first.
    const listed = listedNumbers(snapshot)
    const ended = (made: readonly { number: number }[]) =>
      made.flatMap((each) => (listed.has(each.number) ? [] : [each.number]))
    let told = keptStill(await host.recallKept(repo, root), ended(madeWorktrees), ended(madeBranches))
    if (numbers.length === 0) {
      await host.keepKept(repo, root, told)

      return
    }
    const missing = numbersToAsk(numbers, known)
    const states = missing.length > 0 ? [...known, ...(await pullStates(host, repo, missing))] : known
    const here = await sessionWorktree(host)
    const endedState = (number: number) =>
      states.find((each): each is EndedState => each.number === number && each.state !== "OPEN")
    // GitHub or git could not answer, which may pass: unsettled, so the next pass looks again.
    const attempt = async (settled: Set<number>, number: number, what: string, work: () => Promise<void>) => {
      try {
        await work()
      } catch (error) {
        settled.delete(number)
        host.log(`${what} could not be cleaned up: ${messageOf(error)}`)
      }
    }
    // Another session may have got there first: then nothing is said.
    const tell = async (kind: keyof KeptNotes, number: number, note: string, outcome: CleanupOutcome) => {
      if (outcome === "gone") {
        return
      }
      const once = toldOnce(told[kind], number, note, isLeftInPlace(outcome))
      told = { ...told, [kind]: once.told }
      if (once.isNews) {
        await host.announce(repo, [note])
      }
    }
    for (const worktree of worktrees) {
      const state = endedState(worktree.number)
      if (!state || worktree.path === here) {
        continue
      }
      settledWorktrees.add(worktree.number)
      // Not the pull request's own branch, or one still in use: not /prs's to take away, so nothing is said.
      if (!mayRemoveWorktree(worktree, state, snapshot)) {
        continue
      }
      await attempt(settledWorktrees, worktree.number, `The worktree of #${worktree.number}`, async () => {
        await claim()
        const cleanup = await removePullWorktree(host, repo, worktree, state.head)
        await tell("worktrees", worktree.number, worktreeCleanupNote(worktree, state.state, cleanup), cleanup.outcome)
      })
    }
    for (const left of branches) {
      const state = endedState(left.number)
      if (!state) {
        continue
      }
      settledBranches.add(left.number)
      await attempt(settledBranches, left.number, `The branch ${left.branch}`, async () => {
        // One that isn't the pull request's, or that an open one comes from: the person's, so nothing is said.
        if (!(await isLeftForPull(host, left, state, snapshot))) {
          return
        }
        await claim()
        const cleanup = await removePullBranch(host, repo, left, state.head)
        await tell("branches", left.number, branchCleanupNote(left, state.state, cleanup), cleanup.outcome)
      })
    }
    await host.keepKept(repo, root, told)
  } finally {
    await host.freeCleanup(root, session.id)
  }
}

export async function pullWorktrees(host: Host): Promise<PullWorktree[]> {
  const root = await mainRoot(host)
  const listed = await listWorktrees(host, root)

  return listed.flatMap((worktree) => {
    const number = worktreePullNumber(root, worktree.path)

    return number === null ? [] : [{ number, path: worktree.path, branch: worktree.branch }]
  })
}

// A `prBranch` /prs left outside its worktrees, as "Here, switch branch" checks a pull request out apart in a folder
// of the person's (`checkOutApart`).
export type PullBranch = { number: number; branch: string }

// The `prBranch` branches no folder holds: one checked out somewhere is that folder's, and git keeps it anyway.
export async function pullBranches(host: Host): Promise<PullBranch[]> {
  const root = await mainRoot(host)
  const names = await git(host, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${PR_PREFIX}*`], root)
  const worktrees = await listWorktrees(host, root)
  const held = new Set(worktrees.map((worktree) => worktree.branch))

  return names.stdout.split("\n").flatMap((line) => {
    const name = line.trim()
    const number = prNumberOf(name)

    return number !== null && number > 0 && name === prBranch(number) && !held.has(name)
      ? [{ number, branch: name }]
      : []
  })
}

// What /prs made for pull requests that left the lists and that this session has not settled yet, worktrees or
// branches, as many as one lookup asks after.
export function cleanupCandidates<T extends { number: number }>(
  made: readonly T[],
  snapshot: PullsSnapshot,
  settled: ReadonlySet<number>,
  limit: number
): T[] {
  const listed = listedNumbers(snapshot)

  return made.filter((each) => !listed.has(each.number) && !settled.has(each.number)).slice(0, limit)
}

function listedNumbers(snapshot: PullsSnapshot): Set<number> {
  return new Set([...snapshot.mine, ...snapshot.review].map((row) => row.number))
}

// Whether the worktree of a pull request that ended is /prs's to remove: it holds the pull request's own branch, and
// no open pull request of this repository in the lists comes from that branch, whichever worktree holds it.
export function mayRemoveWorktree(
  worktree: PullWorktree,
  pull: Pick<ClosedState, "branch" | "isCrossRepository">,
  snapshot: PullsSnapshot
): boolean {
  return holdsPullBranch(worktree, pull) && !(worktree.branch !== null && openHeads(snapshot).has(worktree.branch))
}

// The branches the open pull requests of this repository in the lists come from.
function openHeads(snapshot: PullsSnapshot): Set<string> {
  return new Set(
    [...snapshot.mine, ...snapshot.review].filter((row) => !row.isCrossRepository).map((row) => row.headRefName)
  )
}

// Whether a `prBranch` left outside /prs's worktrees is the one the pull request was checked out on, by /prs or by
// gh, and no open pull request in the lists comes from it. Either has it track the pull request's head:
// `refs/heads/<head>` on the remote it came from, or for a fork `refs/pull/<number>/head`, or, when the fork lets
// maintainers edit, the head on the fork: at its address, or on a remote already added for it. One of that name made
// by hand, or for something else, is the person's.
export async function isLeftForPull(
  host: Host,
  left: PullBranch,
  pull: Pick<ClosedState, "branch" | "isCrossRepository" | "headRepo">,
  snapshot: PullsSnapshot
): Promise<boolean> {
  if (openHeads(snapshot).has(left.branch)) {
    return false
  }
  const root = await mainRoot(host)
  const config = async (key: string) =>
    (await git(host, ["config", "--get", `branch.${left.branch}.${key}`], root)).stdout.trim()
  const tracked = await config("merge")
  if (tracked === `refs/pull/${left.number}/head`) {
    return true
  }
  if (pull.branch === null || tracked !== `refs/heads/${pull.branch}`) {
    return false
  }

  if (!pull.isCrossRepository) {
    return true
  }
  // A fork's head may be named like a branch of this repository: only one tracked on the fork itself counts.
  const remote = await config("remote")
  const url = isAddress(remote)
    ? remote
    : (await git(host, ["config", "--get", `remote.${remote}.url`], root)).stdout.trim()

  return pull.headRepo !== null && isAddressOf(url, pull.headRepo)
}

// An address rather than a remote's name: a URL, or ssh's `<user>@<host>:`, the user `git` or a GHE.com tenant's name.
function isAddress(remote: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|[^@/:\s]+@[^/:\s]+:)/.test(remote)
}

function isAddressOf(url: string, repo: string): boolean {
  return isAddress(url) && namesRepo(url, repo)
}

// What came of cleaning one up: gone, or kept because something in it would be lost, with the first such file
// git ignores.
export type WorktreeCleanup =
  | { outcome: "removed" | "branchKept" | "gone" | "uncommitted" | "unpushed" | "failed" }
  | { outcome: "ignored"; file: string }

// Whether a cleanup left the worktree or branch where it is.
// How a pull request that left the lists ended, where it is no longer open.
type EndedState = ClosedState & { state: Exclude<ClosedState["state"], "OPEN"> }

type CleanupOutcome = WorktreeCleanup["outcome"] | BranchCleanup["outcome"]

export function isLeftInPlace(outcome: CleanupOutcome): boolean {
  return ["uncommitted", "ignored", "unpushed", "failed"].includes(outcome)
}

// Removes a worktree /prs made, and its branch, only when that loses nothing: no file changed or added in it, none git
// ignores but what tools make again or the main checkout holds the same (`firstNotInMain`), and its commit on GitHub
// (`isOnGithub`). A worktree whose folder was deleted by hand is unlisted alone, its branch checked alike: pruning
// would drop every worktree git can't reach now, as one on a volume not mounted, with its index and HEAD. Untracked
// files are listed whatever the person's `status.showUntrackedFiles`, as `git worktree remove` goes by it too and would
// delete them unseen.
export async function removePullWorktree(
  host: Host,
  repo: RepoRef,
  worktree: PullWorktree,
  lastHead: string | null
): Promise<WorktreeCleanup> {
  const root = await mainRoot(host)
  const isThere = await host.exists(worktree.path)
  let tip = ""
  if (isThere) {
    const status = await git(
      host,
      ["status", "--porcelain", "-z", "--ignored", "--untracked-files=normal"],
      worktree.path
    )
    // A list cut short could leave out a file `git worktree remove` would delete.
    if (status.exitCode !== 0 || status.isStdoutTruncated) {
      return { outcome: "failed" }
    }
    const entries = statusEntries(status.stdout)
    if (entries.some((entry) => entry.code !== "!!")) {
      return { outcome: "uncommitted" }
    }
    const lost = await firstNotInMain(
      host,
      root,
      worktree.path,
      entries.map((entry) => entry.path)
    )
    if (lost !== null) {
      return { outcome: "ignored", file: lost }
    }
    tip = (await git(host, ["rev-parse", "HEAD"], worktree.path)).stdout.trim()
  } else if (worktree.branch) {
    tip = await branchTip(host, worktree.branch, root)
  }
  // Its folder gone and no branch left, as when another session cleaned it up first: only git's record remains.
  if (!isThere && tip === "") {
    await git(host, ["worktree", "remove", worktree.path], root)

    return { outcome: "gone" }
  }
  if (!(await isOnGithub(host, repo, root, tip, lastHead))) {
    return { outcome: "unpushed" }
  }
  const removed = await git(host, ["worktree", "remove", worktree.path], root)
  // A locked worktree is refused and stays listed; one refused as it went meanwhile, as when another session cleaned
  // it up first, is no failure. git also unlists one it could delete only in part, so a folder left behind is.
  if (removed.exitCode !== 0) {
    if (await isListed(host, root, worktree.path)) {
      return { outcome: "failed" }
    }

    return { outcome: (await host.exists(worktree.path)) ? "failed" : "gone" }
  }
  if (!worktree.branch) {
    return { outcome: "removed" }
  }
  const deleted = await git(host, ["branch", "-D", "--", worktree.branch], root)

  return { outcome: deleted.exitCode === 0 ? "removed" : "branchKept" }
}

// `git status --porcelain -z`: a record a path, `XY <path>`, unquoted whatever the path holds; a rename's or copy's
// record is followed by the path it came from.
export function statusEntries(text: string): { code: string; path: string; from?: string }[] {
  const fields = text.split("\0")
  const entries: { code: string; path: string; from?: string }[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    if (field === "") {
      continue
    }
    const code = field.slice(0, 2)
    if (/[RC]/.test(code)) {
      index++
      entries.push({ code, path: field.slice(3), from: fields[index] ?? "" })
    } else {
      entries.push({ code, path: field.slice(3) })
    }
  }

  return entries
}

// Whether a commit is on GitHub: the pull request's last head or one before it, or on a remote branch. Where this
// clone can't place it against the last head, as one pushed from elsewhere and never fetched, GitHub is asked, which
// rejects where it could not say.
async function isOnGithub(
  host: Host,
  repo: RepoRef,
  root: string,
  tip: string,
  lastHead: string | null
): Promise<boolean> {
  if (tip === "") {
    return false
  }
  if (tip === lastHead || (await git(host, ["branch", "-r", "--contains", tip], root)).stdout.trim() !== "") {
    return true
  }
  if (lastHead === null) {
    return false
  }
  const within = await isWithin(host, tip, lastHead)

  return within === "unknown" ? isWithinOnGithub(host, repo, tip, lastHead) : within === "within"
}

// What came of cleaning up a branch /prs left: deleted, gone already, or kept as GitHub lacks its commit.
export type BranchCleanup = { outcome: "removed" | "gone" | "unpushed" | "failed" }

// Deletes a `prBranch` left outside /prs's worktrees only when that loses nothing: its commit on GitHub. Deleted by
// force, as git calls a branch whose pull request was squashed or rebased in not merged.
export async function removePullBranch(
  host: Host,
  repo: RepoRef,
  left: PullBranch,
  lastHead: string | null
): Promise<BranchCleanup> {
  const root = await mainRoot(host)
  const tip = await branchTip(host, left.branch, root)
  if (tip === "") {
    return { outcome: "gone" }
  }
  if (!(await isOnGithub(host, repo, root, tip, lastHead))) {
    return { outcome: "unpushed" }
  }
  const deleted = await git(host, ["branch", "-D", "--", left.branch], root)

  return { outcome: deleted.exitCode === 0 ? "removed" : "failed" }
}

function branchCleanupNote(left: PullBranch, state: EndedState["state"], cleanup: BranchCleanup): string {
  const notes: Readonly<Record<BranchCleanup["outcome"], string>> = {
    removed: `removed the branch ${left.branch} a switch here left`,
    gone: `the branch ${left.branch} was already removed`,
    unpushed: `kept the branch ${left.branch}, which has commits GitHub doesn't have`,
    failed: `could not remove the branch ${left.branch}`
  }

  return `#${left.number} ${state === "MERGED" ? "merged" : "closed"}: ${notes[cleanup.outcome]}`
}

export function worktreeCleanupNote(
  worktree: PullWorktree,
  state: EndedState["state"],
  cleanup: WorktreeCleanup
): string {
  const pull = `#${worktree.number} ${state === "MERGED" ? "merged" : "closed"}`
  const folder = `.claude/worktrees/${prBranch(worktree.number)}`
  const branch = worktree.branch ?? ""
  const notes: Readonly<Record<WorktreeCleanup["outcome"], string>> = {
    removed: `removed its worktree${branch ? ` and the branch ${branch}` : ""}`,
    branchKept: `removed its worktree, but not the branch ${branch}`,
    gone: "its worktree was already removed",
    uncommitted: `kept its worktree ${folder}, which has changes not committed`,
    ignored: `kept its worktree ${folder}, which holds ${ignoredOf(cleanup)}`,
    unpushed: `kept its worktree ${folder}, which has commits GitHub doesn't have`,
    failed: `could not remove its worktree ${folder}`
  }

  return `${pull}: ${notes[cleanup.outcome]}`
}

// git lists an ignored folder with a slash at its end.
function ignoredOf(cleanup: WorktreeCleanup): string {
  const path = "file" in cleanup ? cleanup.file : ""

  return `${path}, a ${path.endsWith("/") ? "folder" : "file"} git ignores`
}

// Whether a cleanup's note is news, and the notes after it: one that left the worktree or branch where it is (kept, or
// not removed for a failure) is told unless it was told last; one that removed it always is, and forgets it.
export function toldOnce(
  told: Readonly<Record<string, string>>,
  number: number,
  note: string,
  isKept: boolean
): { isNews: boolean; told: Record<string, string> } {
  const { [String(number)]: last, ...rest } = told

  return isKept ? { isNews: last !== note, told: { ...rest, [String(number)]: note } } : { isNews: true, told: rest }
}

// The notes of the worktrees and branches /prs still has for pull requests that ended: a pull request's that went, or
// that is open again, is forgotten.
export function keptStill(told: KeptNotes, worktrees: readonly number[], branches: readonly number[]): KeptNotes {
  const still = (notes: Record<string, string>, numbers: readonly number[]) =>
    Object.fromEntries(Object.entries(notes).filter(([number]) => numbers.includes(Number(number))))

  return { worktrees: still(told.worktrees, worktrees), branches: still(told.branches, branches) }
}

async function isListed(host: Host, root: string, path: string): Promise<boolean> {
  const listed = await listWorktrees(host, root)

  return listed.some((worktree) => worktree.path === path)
}

// The worktree the session works in, as git names it, so a symlinked folder compares the same as git's list.
async function sessionWorktree(host: Host): Promise<string | null> {
  const toplevel = await git(host, ["rev-parse", "--show-toplevel"])

  return toplevel.exitCode === 0 ? toplevel.stdout.trim() : null
}
