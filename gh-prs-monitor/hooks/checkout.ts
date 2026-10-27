// Author: David Matura

// The checkouts Resolve Comments, Fix CI, Resolve Conflicts and Create PR work in: /prs's worktree for a pull request,
// a switch of this checkout to its branch, with what it changed installed (`deps.ts`). A step that fails rejects with
// what went wrong, worded for the person, as the toast that ends the flow shows it.

import type { CheckoutAt, PullRow } from "../types"
import { installChanged, lockedProjects } from "./deps"
import type { ClosedState } from "./ended"
import { failureLine, firstLine, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { fetchPull } from "./fetch-source"
import type { Fetched } from "./fetch-source"
import { hasCommit } from "./github"
import { copyIncluded, INCLUDE_FILE } from "./include"
import { branchName, branchTip, git } from "./machine"
import type { Host } from "./machine"
import { failureOf, moveTo } from "./switch"
import type { CheckoutPlace, Move } from "./switch"
import { listWorktrees, mainRootOf, prBranch, worktreePath, WORKTREES_IGNORE_LINE } from "./worktrees"
import type { Worktree } from "./worktrees"

// The branch the checkout is on, or "HEAD" on none. Asked for by its full name, as git shortens one that a tag shares
// to `heads/<name>`, which is not the branch's name.
export async function currentBranch(host: Host): Promise<string> {
  return branchName((await git(host, ["rev-parse", "--symbolic-full-name", "HEAD"])).stdout.trim())
}

// The branch the checkout is on, or null when it is on none (git says "HEAD") or git could not tell.
export async function checkedOutBranch(host: Host): Promise<string | null> {
  try {
    const branch = await currentBranch(host)

    return branch === "" || branch === "HEAD" ? null : branch
  } catch {
    return null
  }
}

// The branch a checkout is on and its commit (`checkedOut`).
export type CheckoutHead = { branch: string | null; head: string | null }

// The branch the checkout is on and its commit, in one call: the branch null where it is on none (git says "HEAD"),
// both null where git could not tell, as in a repository with no commits yet.
export async function checkedOut(host: Host): Promise<CheckoutHead> {
  try {
    const ran = await git(host, ["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"])
    const [head = "", ref = ""] = ran.stdout.trim().split("\n")
    if (ran.exitCode !== 0 || head === "") {
      return { branch: null, head: null }
    }
    const branch = branchName(ref)

    return { branch: branch === "" || branch === "HEAD" ? null : branch, head }
  } catch {
    return { branch: null, head: null }
  }
}

// The checkout as read last: a read that came before the one kept, as a load's that a press read past, never takes
// its place. One kept from further ahead than a load takes from its read to its write was read before the clock was
// set back, and gives way.
export function newerCheckout(kept: CheckoutAt | null, read: CheckoutAt): CheckoutAt {
  return kept !== null && kept.at > read.at && kept.at - read.at <= CHECKOUT_ORDER_MS ? kept : read
}

const CHECKOUT_ORDER_MS = 60_000

// Tracked changes only, a line each as git lists them: untracked files ride along a branch switch without harm.
export async function uncommittedChanges(host: Host): Promise<string[]> {
  const status = await git(host, ["status", "--porcelain", "--untracked-files=no"])

  return status.stdout.split("\n").filter((line) => line.trim() !== "")
}

// The main checkout's root, also when the session already works inside one of its worktrees.
export async function mainRoot(host: Host): Promise<string> {
  const commonDir = await git(host, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const root = commonDir.exitCode === 0 ? mainRootOf(commonDir.stdout) : null
  if (root) {
    return root
  }

  return toplevel(host)
}

export type PreparedWorktree = { path: string; warning?: string }

// A link at `.claude`, at `.claude/worktrees` or at the worktree's own folder, as a repository can commit one: git
// would make the worktree, and check the pull request out, wherever it leads. Claude Code refuses these for its own.
async function linkOnTheWay(host: Host, root: string, path: string): Promise<string | null> {
  for (const folder of [`${root}/.claude`, `${root}/.claude/worktrees`, path]) {
    if (await host.isLink(folder)) {
      return folder.slice(root.length + 1)
    }
  }

  return null
}

// The pull request's own worktree at `.claude/worktrees/pr-<number>`, made or brought up to date, and never a folder
// the person works in: the branch skills work there while the person goes on with their own work. The branch is set
// up as gh pr checkout sets one up, forks included (`checkOutApart`).
export async function prepareWorktree(host: Host, row: PullRow, repo: RepoRef): Promise<PreparedWorktree> {
  const root = await mainRoot(host)
  const path = worktreePath(root, row.number)
  const link = await linkOnTheWay(host, root, path)
  if (link !== null) {
    throw new Error(`${link} is a link, which could put the worktree outside the repository, so none is made there`)
  }
  const { own, worktrees } = await ownWorktree(host, root, path)
  const ownBranch = own?.branch ?? null
  if (ownBranch !== null) {
    // The folder is /prs's only while it holds the pull request's branch: the host's own worktrees share the folder,
    // and the person may have switched it to a branch of theirs.
    const pull = { branch: row.headRefName, isCrossRepository: row.isCrossRepository }
    if (!holdsPullBranch({ number: row.number, path, branch: ownBranch }, pull)) {
      throw new Error(`${path} holds the branch ${ownBranch}, not the pull request's: switch it back or remove it`)
    }
    return updateOwnWorktree(host, row, repo, path, ownBranch)
  }
  // On no branch, commits made there are kept by nothing but the worktree: a move onto a branch would leave them
  // behind, and the worktree's removal once the pull request ends would drop them for good.
  if (own && !(await isKeptElsewhere(host, repo, path))) {
    throw new Error(
      `the worktree at ${path} is on no branch, at commits no branch here holds and GitHub lacks: put them on a branch, or remove that worktree`
    )
  }
  if (!own) {
    await ignoreWorktrees(host, root)
    const added = await git(host, ["worktree", "add", "--detach", path], root)
    if (added.exitCode !== 0) {
      throw new Error(`could not create the worktree: ${firstLine(added.stderr)}`)
    }
  }

  return checkOutInWorktree(host, row, repo, { root, path, worktrees, isNew: !own })
}

// The pull request's worktree as git and the disk have it, and git's list of the clone's worktrees.
async function ownWorktree(
  host: Host,
  root: string,
  path: string
): Promise<{ own: Worktree | undefined; worktrees: Worktree[] }> {
  const isThere = await host.exists(path)
  let worktrees = await listWorktrees(host, root)
  // A folder with no `.git` of its own is no worktree to relink, as one left empty: `worktree add` takes it as it is.
  if (isThere && !worktrees.some((worktree) => worktree.path === path) && (await host.exists(`${path}/.git`))) {
    worktrees = await relink(host, root, path)
  }
  const listed = worktrees.find((worktree) => worktree.path === path)
  // A worktree whose folder was deleted by hand is still listed, and cannot be worked in. Only its own entry goes:
  // pruning would drop every worktree git can't reach now, as one on a volume not mounted, with its index and HEAD.
  const own = listed && isThere ? listed : undefined
  if (listed && !own) {
    await git(host, ["worktree", "remove", path], root)
  }

  return { own, worktrees }
}

// The pull request checked out in its worktree, which is on no branch; a failure leaves no branch behind for the next
// run to take for the pull request's.
async function checkOutInWorktree(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  { root, path, worktrees, isNew }: { root: string; path: string; worktrees: readonly Worktree[]; isNew: boolean }
): Promise<PreparedWorktree> {
  let reason: string
  try {
    const failure = await checkOutApart(host, row, repo, path, heldBranches(worktrees, path), { kind: "worktree" })
    if (failure === null) {
      // A new worktree gets the ignored files the repository's `.worktreeinclude` names, as Claude Code's own do; not a
      // fork's, whose code could read them.
      const warning = isNew && !row.isCrossRepository ? await includeWarning(host, root, path) : null

      return warning === null ? { path } : { path, warning }
    }
    reason = failure
  } catch (error) {
    reason = messageOf(error)
  }
  if (!isNew) {
    // Back on no branch, so a branch a failed step switched to is not taken for the pull request's next time.
    await git(host, ["checkout", "--detach"], path).catch(() => undefined)
    throw new Error(`the worktree at ${path} holds no branch and could not check one out: ${reason}`)
  }
  // A detached worktree left behind would hold the base's code, and the next run would take it for the PR.
  await git(host, ["worktree", "remove", "--force", path], root).catch(() => undefined)
  throw new Error(`could not check out the pull request in a worktree: ${reason}`)
}

// Whether the commit a worktree on no branch is at is on a branch, a remote's copy of one or a tag, or on GitHub; a
// stash holds it only until it is dropped.
async function isKeptElsewhere(host: Host, repo: RepoRef, cwd: string): Promise<boolean> {
  const head = (await git(host, ["rev-parse", "--verify", "--quiet", "HEAD"], cwd)).stdout.trim()
  if (head === "") {
    return true
  }
  const refs = await git(
    host,
    ["for-each-ref", "--contains", head, "--count=1", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"],
    cwd
  )
  if (refs.exitCode === 0 && refs.stdout.trim() !== "") {
    return true
  }
  return hasCommit(host, repo, head)
}

// The pull request's folder where git lists no worktree, as after the repository's folder was moved: git lists it
// where it was and refuses to add one over it, so it is relinked to where it is, once.
async function relink(host: Host, root: string, path: string): Promise<Worktree[]> {
  const repaired = await git(host, ["worktree", "repair", path], root)
  const worktrees = await listWorktrees(host, root)
  if (!worktrees.some((worktree) => worktree.path === path)) {
    const reason = repaired.exitCode === 0 ? "git still lists none there" : failureLine(repaired.stderr)
    throw new Error(
      `${path} is a folder git lists no worktree at, and \`git worktree repair\` could not relink it (${reason}): move that folder aside, and the worktree is made anew`
    )
  }

  return worktrees
}

// Checks the pull request out, and says why that failed, worded for its place, or null. /prs's own worktree always
// takes `prBranch`: a branch of the head's name held there would make git refuse `git switch` to it in every other
// folder, the person's own included. A folder the person switches takes the head's name, the branch they would work
// on, only ever fast-forwarded to GitHub's; `prBranch` where that won't do: a fork's always, as its head's name may be
// one of this repository's, and any pull request's whose branch of the head's name another worktree holds or has gone
// its own way from it, as after a rebase on GitHub, or whose head's name differs only in case from a branch here
// (`isTakenInOtherCase`). A `prBranch` left in /prs's worktree from an earlier run is brought to GitHub's version when
// that loses nothing; nothing in a folder the person works in is.
async function checkOutApart(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  cwd: string | undefined,
  held: ReadonlyMap<string, string>,
  place: CheckoutPlace
): Promise<string | null> {
  const head = row.headRefName
  // git takes a name that starts with a dash for an option, as gh, which refuses one, knows.
  const triesHead =
    place.kind === "here" &&
    !row.isCrossRepository &&
    !held.has(head) &&
    !head.startsWith("-") &&
    !(await isTakenInOtherCase(host, cwd, head))
  const apart = prBranch(row.number)
  const holder = held.get(apart)
  if (holder && !triesHead) {
    return heldFailure(apart, holder, place)
  }
  const pull = await fetchPull(host, row, repo, cwd)
  if (triesHead) {
    const onHead = await moveTo(host, cwd, head, pull)
    if (onHead.kind !== "diverged" && onHead.kind !== "held") {
      return failureOf(onHead, head, place)
    }
  }
  if (holder) {
    return heldFailure(apart, holder, place)
  }
  const onApart =
    place.kind === "worktree" ? await moveOwn(host, row, repo, cwd, apart, pull) : await moveTo(host, cwd, apart, pull)

  return failureOf(onApart, apart, place)
}

// What the person is told when files `.worktreeinclude` names were not all copied into the new worktree; null when they
// were.
async function includeWarning(host: Host, root: string, path: string): Promise<string | null> {
  try {
    const { failed } = await copyIncluded(host, root, path)
    const more = failed.length > 1 ? ` and ${failed.length - 1} more` : ""

    return failed.length === 0 ? null : `could not copy ${failed[0]}${more} from ${INCLUDE_FILE} into the worktree`
  } catch (error) {
    return `could not copy what ${INCLUDE_FILE} names into the worktree: ${messageOf(error)}`
  }
}

// Why `branch` can't be checked out here, held by the folder `holder`: the pull request's own worktree is where to
// work on it, and any other folder can switch away from it.
function heldFailure(branch: string, holder: string, place: CheckoutPlace): string {
  if (place.kind === "here" && holder === place.ownWorktree) {
    return `the branch ${branch} is checked out in the pull request's own worktree, ${holder}: choose "Worktree, this session" to work there, or remove that worktree`
  }

  return `the branch ${branch} is checked out in ${holder}: switch that folder to another branch to work on the pull request apart from it`
}

// Whether a branch here differs from `name` only in case, or might, as git's list could not be read. Where the file
// system ignores case, as macOS's and Windows' do by default, git finds a branch by its file's name: `Feature` would
// find, and a switch to it move, the person's own `feature`.
async function isTakenInOtherCase(host: Host, cwd: string | undefined, name: string): Promise<boolean> {
  const listed = await git(host, ["for-each-ref", "--format=%(refname)", "refs/heads/"], cwd)
  if (listed.exitCode !== 0 || listed.isStdoutTruncated) {
    return true
  }
  const wanted = `refs/heads/${name}`
  const folded = (ref: string): string => ref.normalize("NFC").toLowerCase()

  return listed.stdout.split("\n").some((ref) => ref !== wanted && folded(ref) === folded(wanted))
}

// The folder of another worktree than the one at `root` that has `branch` checked out, where `root` can't switch to it;
// null for none.
export async function heldElsewhere(host: Host, branch: string, root: string): Promise<string | null> {
  return heldBranches(await listWorktrees(host), root).get(branch) ?? null
}

// The branches the other worktrees hold, the main checkout among them, with where: git keeps a branch in one
// worktree at a time. One that is mid-rebase is listed on no branch; git's own refusal tells of it (`isHeldElsewhere`).
function heldBranches(worktrees: readonly Worktree[], except: string): Map<string, string> {
  return new Map(
    worktrees.flatMap((worktree): [string, string][] =>
      worktree.path !== except && worktree.branch ? [[worktree.branch, worktree.path]] : []
    )
  )
}

// The pull request's own worktree from an earlier run, brought up to date on the branch it holds. One whose branch
// went its own way, as after a rebase on GitHub, is brought to GitHub's version when that loses nothing; otherwise
// it is used as it is.
async function updateOwnWorktree(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  path: string,
  branch: string
): Promise<PreparedWorktree> {
  let reason: string | null
  try {
    const pull = await fetchPull(host, row, repo, path)
    reason = failureOf(await moveOwn(host, row, repo, path, branch, pull), branch, { kind: "worktree" })
  } catch (error) {
    reason = messageOf(error)
  }

  return reason === null
    ? { path }
    : { path, warning: `the worktree could not be updated, so it may be behind (${reason})` }
}

// `moveTo` in /prs's own worktree, where a branch that went its own way is brought to GitHub's version when that
// loses nothing (`losesNothing`).
async function moveOwn(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  cwd: string | undefined,
  branch: string,
  pull: Fetched
): Promise<Move> {
  const move = await moveTo(host, cwd, branch, pull)
  if (move.kind !== "diverged" || !(await losesNothing(host, row, repo, cwd, branch))) {
    return move
  }

  return moveTo(host, cwd, branch, pull, { isForced: true })
}

// Whether bringing `branch`, in /prs's own worktree at `cwd`, to GitHub's version loses nothing: no file changed or
// added there, and the branch's own commit one GitHub has, as one pushed before a rebase there. A fork's commits live
// in the fork, so its branch is left as it is.
async function losesNothing(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  cwd: string | undefined,
  branch: string
): Promise<boolean> {
  if (row.isCrossRepository) {
    return false
  }
  const status = await git(host, ["status", "--porcelain", "--untracked-files=normal"], cwd)
  const tip = await branchTip(host, branch, cwd)
  if (status.exitCode !== 0 || status.stdout.trim() !== "" || tip === "") {
    return false
  }
  return hasCommit(host, repo, tip)
}

// A worktree /prs made for a pull request, and the branch it holds.
export type PullWorktree = { number: number; path: string; branch: string | null }

// /prs checks a pull request out on `prBranch`, or one of this repository's on a branch of its head's name too
// (`checkOutApart`); a fork's head may share its name with a branch of the person's own, as `main`. A worktree in
// /prs's folder holding any other branch is not the pull request's: the host's own worktrees live in the same
// folder, so cleaning such a one up would take away a branch someone still works on.
export function holdsPullBranch(
  worktree: PullWorktree,
  pull: Pick<ClosedState, "branch" | "isCrossRepository">
): boolean {
  const names = pull.isCrossRepository ? [prBranch(worktree.number)] : [pull.branch, prBranch(worktree.number)]

  return worktree.branch !== null && names.includes(worktree.branch)
}

// Keeps the worktrees out of `git status` in the main checkout, through the clone's own exclude file so
// nothing in the repository changes.
async function ignoreWorktrees(host: Host, root: string): Promise<void> {
  const probe = await git(host, ["check-ignore", "-q", ".claude/worktrees/probe"], root)
  if (probe.exitCode === 0) {
    return
  }

  const commonDir = (await git(host, ["rev-parse", "--path-format=absolute", "--git-common-dir"], root)).stdout.trim()
  const excludeFile = `${commonDir}/info/exclude`
  try {
    const text = (await host.exists(excludeFile)) ? await host.read(excludeFile) : ""
    const separator = text === "" || text.endsWith("\n") ? "" : "\n"
    await host.write(excludeFile, `${text}${separator}${WORKTREES_IGNORE_LINE}\n`)
  } catch {
    // Only cosmetic: the worktree then shows as untracked in the main checkout.
  }
}

// Switches this checkout to the pull request's branch (`checkOutApart`), its uncommitted changes going along as git
// takes them; git refuses a switch that would overwrite one, or a file it doesn't track, as an ignored `.env`
// (`moveTo`), and nothing changes then. Installs dependencies only for the projects whose lockfile the switch changed
// (or package manager), as the person's own installs are otherwise left as they are (`installChanged`).
export async function switchHere(
  host: Host,
  row: PullRow,
  repo: RepoRef,
  onInstall: (command: string) => void
): Promise<string | undefined> {
  const root = await toplevel(host)
  const before = await lockedProjects(host, root)

  const worktrees = await listWorktrees(host)
  const place: CheckoutPlace = { kind: "here", ownWorktree: worktreePath(await mainRoot(host), row.number) }
  let failure: string | null
  try {
    failure = await checkOutApart(host, row, repo, undefined, heldBranches(worktrees, root), place)
  } catch (error) {
    failure = messageOf(error)
  }
  if (failure !== null) {
    throw new Error(`not switched: ${failure}`)
  }

  return installChanged(host, root, before, row.isCrossRepository, onInstall)
}

// The checkout's root, which git names; rejects outside one.
export async function toplevel(host: Host): Promise<string> {
  const ran = await git(host, ["rev-parse", "--show-toplevel"])
  if (ran.exitCode !== 0) {
    throw new Error(`this folder is not a git checkout (${firstLine(ran.stderr)})`)
  }

  return ran.stdout.trim()
}
