// Author: David Matura

// Back to the base after the checkout's branch merged: what the pane offers (`mergedBranchOf`), and the switch itself
// (`switchToBase`), which loses nothing of the person's: up to the move, each step stops with what it found, nothing
// changed past it; after it, what fails is told beside the switch. The person is told how it went either way.

import type { BranchPulls, DismissedBranch, MergedBranch, PullsSnapshot } from "../types"
import { checkedOut, heldElsewhere, toplevel, uncommittedChanges } from "./checkout"
import { isAnswered } from "./create-flow"
import { installChanged, lockedProjects } from "./deps"
import type { LockedProjects } from "./deps"
import { fetchBase } from "./fetch-source"
import type { Fetched } from "./fetch-source"
import { failureLine, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { branchTip, git } from "./machine"
import type { Host } from "./machine"
import { isOnBranch, rowsOf, storedSnapshot } from "./pulls"
import { switchingSaid, whenIdle } from "./session"
import type { Session } from "./session"
import { moveTo, moveRefusal } from "./switch"
import type { Move } from "./switch"
import { prNumberOf } from "./worktrees"

// The busy mark the switch shows its progress under, in the note's place for its button.
export const SWITCH_BASE = "switch-base"

// The branch the pane offers to leave: the checkout's, where GitHub said a merged pull request holds its commit, for
// the list as it stands (`isAnswered`), into a base GitHub named that is another branch. None where another worktree
// has that base checked out (as git said when the answer was last taken), as switching there can't happen. None for a
// branch an open pull request in the viewer's lists merges into, as a long-lived develop a release merged into main, or
// a stack's lower branch while the upper one still targets it; none for one a pull request there is open from again.
// None for /prs's own `pr-<number>` checkout, nor once its ✕ put the note away at this commit.
export function mergedBranchOf(
  snapshot: PullsSnapshot | null,
  branch: string | null,
  head: string | null,
  looked: BranchPulls | null,
  dismissed: DismissedBranch | null
): MergedBranch | null {
  if (
    snapshot === null ||
    branch === null ||
    head === null ||
    prNumberOf(branch) !== null ||
    !isAnswered(looked, snapshot, branch, head)
  ) {
    return null
  }
  const merged = looked.merged ?? null
  if (merged === null || merged.base === null || merged.base === branch || (looked.baseHeldBy ?? null) !== null) {
    return null
  }
  if (rowsOf(snapshot).some((row) => row.baseRefName === branch || isOnBranch(row, branch))) {
    return null
  }
  if (dismissed?.repo === snapshot.repo && dismissed.branch === branch && dismissed.head === head) {
    return null
  }

  return { repo: snapshot.repo, branch, head, number: merged.number, base: merged.base }
}

// What a switch reaches beyond git and gh (`Host`): the list, to see whether a pull request is open from the branch
// again; the note as the pane would draw it now (`mergedBranchOf`), null for none; what the note says while it runs;
// the toast that tells how it went; a reinstall starting; and the checkout read again once it changed.
export type SwitchBaseHost = Host & {
  storedList: () => Promise<PullsSnapshot | null>
  offered: () => Promise<MergedBranch | null>
  setBusy: (label: string | null) => Promise<void>
  notify: (text: string) => Promise<void>
  onInstall: (command: string) => void
  changed: () => Promise<void>
}

// Switches this checkout from the merged branch to its base, as GitHub has it, and deletes the branch where nothing of
// it would be lost. One switch of this checkout at a time, as Here, switch branch's (`session.switchingFor`), with no
// turn under way. The pane reads the checkout again once it is done, whatever came of it, before the note's busy label
// goes, so the note never offers again, for a moment, the switch just made; a read that fails leaves the pane as it
// was, and the toast still says how it went.
export async function switchToBase(
  host: SwitchBaseHost,
  session: Session,
  repo: RepoRef,
  offer: MergedBranch
): Promise<void> {
  if (session.switchingFor !== null) {
    const said = switchingSaid(session.switchingFor)
    await host.notify(`${said[0]!.toUpperCase()}${said.slice(1)}; press Switch to ${offer.base} again once it is done.`)

    return
  }
  const putAway = putAwaySignal()
  session.switchingFor = { offer, putAway: putAway.give }
  let said: string
  try {
    said = await switched(host, session, repo, offer, putAway)
  } catch (error) {
    said = `Not switched to ${offer.base}: ${messageOf(error)}.`
  }
  await host.changed().catch(() => undefined)
  session.switchingFor = null
  await host.setBusy(null)
  await host.notify(said)
}

// The switch, step by step, and what the person is told of it. A turn under way is waited for first, as it may be
// running git in this checkout itself (`afterTurns`); then what keeps the checkout from moving is said before GitHub is
// asked, with no turn under way (`lookedAt`). The base is fetched, which moves nothing of the person's; once the
// checkout is clear to move (`readyToMove`), the move follows at once.
async function switched(
  host: SwitchBaseHost,
  session: Session,
  repo: RepoRef,
  offer: MergedBranch,
  putAway: PutAway
): Promise<string> {
  const { base } = offer
  const stopped = (why: string): string => `Not switched to ${base}: ${why}.`
  await host.setBusy(`Switching to ${base}…`)
  const waited = await afterTurns(host, session, offer, putAway)
  if (waited !== null) {
    return stopped(waited)
  }
  const root = await toplevel(host)
  const early = await lookedAt(host, session, offer, root, putAway)
  if (early !== null) {
    return stopped(early)
  }
  let fetched: Fetched
  try {
    fetched = await fetchBase(host, repo, base, root)
  } catch (error) {
    return stopped(messageOf(error))
  }
  const ready = await readyToMove(host, session, offer, root, putAway)
  if ("why" in ready) {
    return stopped(ready.why)
  }
  const { before } = ready
  let move: Move
  let unset: string | null = null
  try {
    move = await moveTo(host, root, base, fetched)
  } catch (error) {
    // Thrown after the switch, as setting what the base follows: the checkout is on it all the same.
    if ((await checkedOut(host)).branch !== base) {
      return stopped(messageOf(error))
    }
    move = { kind: "moved" }
    unset = `what ${base} follows could not be set (${messageOf(error)})`
  }
  if (move.kind !== "moved") {
    return stopped(moveFailure(move, base))
  }
  // Moved: what follows is told, and stops nothing.
  const installed = await installChanged(host, root, before, false, host.onInstall).catch(
    (error: unknown) => `the dependencies could not be installed (${messageOf(error)})`
  )
  const left = await leftBranch(host, root, offer).catch(
    (error: unknown) => `${offer.branch} kept, as it could not be looked at (${messageOf(error)})`
  )

  return `Switched to ${base}; ${[left, unset, installed].filter(Boolean).join("; ")}.`
}

// The checkout once it is clear to move, with what its lockfiles hold before the move: looked at with no turn under
// way (`lookedAt`), and again where a turn began while the lockfiles were read. Else why it can't.
async function readyToMove(
  host: SwitchBaseHost,
  session: Session,
  offer: MergedBranch,
  root: string,
  putAway: PutAway
): Promise<{ before: LockedProjects } | { why: string }> {
  for (;;) {
    const why = await lookedAt(host, session, offer, root, putAway)
    if (why !== null) {
      return { why }
    }
    const before = await lockedProjects(host, root)
    if (session.runningTurns.size === 0) {
      return { before }
    }
  }
}

// What keeps the checkout from moving, looked at with no turn under way: any turn under way waited for first
// (`afterTurns`), and the checkout looked at again where one began meanwhile, as a prompt queued starts one as the
// last ends (as Here, switch branch's `isCheckoutAsAsked`). Null for nothing.
async function lookedAt(
  host: SwitchBaseHost,
  session: Session,
  offer: MergedBranch,
  root: string,
  putAway: PutAway
): Promise<string | null> {
  for (;;) {
    const why = (await afterTurns(host, session, offer, putAway)) ?? (await whyNotNow(host, session, offer, root))
    if (why !== null || session.runningTurns.size === 0) {
      return why
    }
  }
}

// Any turn under way waited out, as it may be running git in this checkout itself, the note saying so meanwhile; then
// why the checkout can't be looked at now: the note's ✕ pressed meanwhile (`putAway`), which ends the wait at once, or
// a skill pressed whose turn has yet to start (`skillStarting`). Null where it can.
async function afterTurns(
  host: SwitchBaseHost,
  session: Session,
  offer: MergedBranch,
  putAway: PutAway
): Promise<string | null> {
  while (session.runningTurns.size > 0 && !putAway.isGiven()) {
    await host.setBusy(`Switches to ${offer.base} when this turn ends`)
    await Promise.race([whenIdle(session), putAway.given])
    await host.setBusy(`Switching to ${offer.base}…`)
  }

  return putAway.isGiven() ? "its note was put away" : skillStarting(session, offer)
}

// A skill pressed here whose turn has yet to start, which would work in this checkout as it moves; null for none.
function skillStarting(session: Session, offer: MergedBranch): string | null {
  return session.skills.starting.length > 0
    ? `a skill is starting here; press Switch to ${offer.base} again once its turn ends`
    : null
}

// What keeps the checkout from moving now, as the person is told; null for nothing. On the branch at the commit GitHub
// said is merged, as the note was drawn; no uncommitted change, which git carries to the base without a word where
// both have the file, and the branch goes after; the base no other worktree holds. The note still offering it, as a
// pull request opened from or into the branch takes it back: asked after the reasons of their own, which the person is
// told rather than that. And no skill pressed while git looked (`skillStarting`).
async function whyNotNow(
  host: SwitchBaseHost,
  session: Session,
  offer: MergedBranch,
  root: string
): Promise<string | null> {
  const now = await checkedOut(host)
  if (now.branch !== offer.branch || now.head !== offer.head) {
    return "this checkout moved since; look at the pane again"
  }
  const changes = await uncommittedChanges(host)
  if (changes.length > 0) {
    return `commit or stash your uncommitted changes first (${filesCount(changes.length)})`
  }
  const holder = await heldElsewhere(host, offer.base, root)
  if (holder !== null) {
    return `it is checked out in ${holder}`
  }
  const shown = await host.offered()
  if (shown?.branch !== offer.branch || shown.head !== offer.head || shown.base !== offer.base) {
    return "the pane no longer offers it"
  }

  return skillStarting(session, offer)
}

// The note's ✕, pressed while a switch to the base is under way: it stops before its move, at once where it waits for
// a turn (`afterTurns`), so this checkout is free again for the row buttons that switch it.
export function putAwaySwitch(session: Session): void {
  const switching = session.switchingFor
  if (switching !== null && "putAway" in switching) {
    switching.putAway()
  }
}

// The note a switch to the base under way was pressed on, which the pane keeps drawn while it runs, with its progress
// and its ✕, whatever changed meanwhile; null for none.
export function switchUnderWay(session: Session): MergedBranch | null {
  const switching = session.switchingFor

  return switching !== null && "offer" in switching ? switching.offer : null
}

// Whether the note's ✕ was pressed during a switch (`isGiven`), and a promise kept once it is (`given`).
type PutAway = { give: () => void; isGiven: () => boolean; given: Promise<void> }

function putAwaySignal(): PutAway {
  let isGiven = false
  let keep = (): void => {}
  const given = new Promise<void>((resolve) => {
    keep = resolve
  })

  return {
    give: () => {
      isGiven = true
      keep()
    },
    isGiven: () => isGiven,
    given
  }
}

// The merged branch, deleted where nothing would be lost: still at the commit GitHub has in the merged pull request,
// and no pull request open from a branch of its name in the list, a fork's included. `git branch -D`, as a squash or
// rebase merge leaves its commits out of the base, where `-d` would refuse it.
async function leftBranch(host: SwitchBaseHost, root: string, offer: MergedBranch): Promise<string> {
  const { branch } = offer
  const list = storedSnapshot(await host.storedList())
  if (list !== null && rowsOf(list).some((row) => row.headRefName === branch)) {
    return `${branch} kept, as a pull request is open from it`
  }
  if ((await branchTip(host, branch, root)) !== offer.head) {
    return `${branch} kept, as it moved`
  }
  const deleted = await git(host, ["branch", "-D", "--", branch], root)

  return deleted.exitCode === 0
    ? `${branch} deleted, as #${offer.number} merged it`
    : `${branch} kept, as git could not delete it (${failureLine(deleted.stderr)})`
}

// Why the move to the base stopped, as the person is told: the base here gone its own way from GitHub's, else as any
// refused move is worded (`moveRefusal`).
function moveFailure(move: Exclude<Move, { kind: "moved" }>, base: string): string {
  return move.kind === "diverged"
    ? `${base} here has commits GitHub's doesn't, and GitHub's has others; bring it up to date yourself first`
    : moveRefusal(move, { where: "this checkout", theirs: base, apart: "" })
}

function filesCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`
}
