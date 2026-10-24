// Author: David Matura

// What a load's list carries over from the lists before it, as GitHub's answer lacks it: what was known of a pull
// request GitHub is rechecking, the branches and pull requests that ended; and which of those that left the lists
// GitHub is asked how they ended.

import type { EndedPull, PullHead, PullsSnapshot } from "../types"
import { byNumber, isComparable, vanishedPulls } from "./alerts"
import type { ClosedState } from "./ended"
import { rowsOf } from "./pulls"

// The list a load shows: what GitHub listed, with what was known of each pull request in the list it is compared with
// (`before`), and the heads and pull requests that ended, as GitHub said (`states`), carried from the list as it
// stands, which a base kept from before loads nothing drew lacks; of the pull requests, only those `before` told of.
export function listAfter(
  previous: PullsSnapshot | null,
  before: PullsSnapshot | null,
  fresh: PullsSnapshot,
  states: readonly ClosedState[] | null
): PullsSnapshot {
  const source = previous ?? before

  return carryEndedPulls(source, carryEndedHeads(source, carryKnownStates(before, fresh), states), states, before)
}

// Marks each pull request GitHub is rechecking with what was known of it just before, as `pullAlerts` reads it:
// whether it was ready to merge, and whether it conflicted, carried through any number of rechecks.
export function carryKnownStates(before: PullsSnapshot | null, after: PullsSnapshot): PullsSnapshot {
  // With nothing known of it before, one GitHub is rechecking is taken as ready already: what the first sight of a
  // pull request shows is never news, and its settling to ready would otherwise be.
  if (!isComparable(before, after)) {
    return {
      ...after,
      mine: after.mine.map((row) =>
        row.stage === "checking" ? { ...row, signals: { ...row.signals, wasReady: true } } : row
      )
    }
  }
  const previous = byNumber(before.mine)

  return {
    ...after,
    mine: after.mine.map((row) => {
      const was = previous.get(row.number)
      const signals = { ...row.signals }
      if (row.stage === "checking") {
        signals.wasReady = was ? was.stage === "ready" || was.signals.wasReady === true : true
      }
      if (row.signals.isConflicting === null) {
        signals.lastConflict = was ? (was.signals.isConflicting ?? was.signals.lastConflict ?? null) : null
      }

      return { ...row, signals }
    })
  }
}

// Keeps the branches the viewer's own pull requests came from that left the list since `before`, with those kept
// before, the latest few: Create PR is not offered from a branch whose pull request merged or closed while nothing new
// came on it. Each is kept at the commit GitHub says its pull request ended at (`states`), as a list read before the
// final push or update may have seen an older one; at the commit the list last saw where GitHub didn't say. One GitHub
// says is open only left the search, and a branch with one open again is no longer among them.
export function carryEndedHeads(
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  states: readonly ClosedState[] | null
): PullsSnapshot {
  if (!isComparable(before, after)) {
    return after
  }
  const isOpen = (head: PullHead) => after.ownHeads.some((each) => each.branch === head.branch)
  const left = leftHeads(before, after).flatMap((head): PullHead[] => {
    const state = states?.find((each) => each.number === head.number)
    if (state?.state === "OPEN") {
      return []
    }
    const final = state && !state.isCrossRepository ? state.head : null

    return [{ branch: head.branch, oid: final ?? head.oid }]
  })
  const kept = before.endedHeads.filter((head) => !isOpen(head) && !left.some((each) => each.branch === head.branch))

  return { ...after, endedHeads: [...kept, ...left].slice(-ENDED_HEADS_KEPT) }
}

const ENDED_HEADS_KEPT = 20

// A branch of the viewer's own that no open pull request comes from any more, with the number of the one that did, null
// where unknown: a list kept by an earlier version names it only through that pull request's row, which a hidden draft
// has none of.
export type LeftHead = { branch: string; oid: string; number: number | null }

export function leftHeads(before: PullsSnapshot | null, after: PullsSnapshot): LeftHead[] {
  if (!isComparable(before, after)) {
    return []
  }
  const open = new Set(after.ownHeads.map((head) => head.branch))
  const rowOn = (branch: string) => before.mine.find((row) => !row.isCrossRepository && row.headRefName === branch)

  return before.ownHeads
    .filter((head) => !open.has(head.branch))
    .map(({ branch, oid, number }) => ({ branch, oid, number: number ?? rowOn(branch)?.number ?? null }))
}

// Keeps the pull requests GitHub says were closed (`states`) once they left the lists, with what the person was told of
// them (`told`, the list the load compares with), and those the list as it stands kept (`source`), the latest fifty:
// one reopened is then no news (`pullAlerts`). One the person was never told of (it asked for their review, or
// mentioned them, and closed while nothing was drawn) is news as it comes back. Only someone else's, from the review
// list or the mentions: the viewer's own is never news as it comes back. Not one that merged, which can't reopen, nor
// one still open, which only left the search: a request that brings it back may be new. One in the lists again is no
// longer among them; with no states, those kept stay and none is added.
export function carryEndedPulls(
  source: PullsSnapshot | null,
  after: PullsSnapshot,
  states: readonly ClosedState[] | null,
  told: PullsSnapshot | null = source
): PullsSnapshot {
  if (!isComparable(source, after)) {
    return after
  }
  const rows = new Set(rowsOf(after).map((pull) => pull.number))
  const listed = new Set([...rows, ...after.mentioned.pulls.map((pull) => pull.number)])
  const base = isComparable(told, after) ? told : null
  const reviewed = byNumber(base?.review ?? [])
  const mentioned = new Set(base?.mentioned.pulls.map((pull) => pull.number))
  const wasEnded = new Map(base?.endedPulls?.map((pull) => [pull.number, pull]))
  const closed = (states ?? []).flatMap((state): EndedPull[] => {
    const row = reviewed.get(state.number)
    const was = wasEnded.get(state.number)
    // GitHub's state is newer than a mentions search that still lists one it closed.
    if (state.state !== "CLOSED" || rows.has(state.number) || (!row && !mentioned.has(state.number) && !was)) {
      return []
    }
    const known = row
      ? { isRequested: row.signals.isRequested, hasCommitsSinceMyReview: row.signals.hasCommitsSinceMyReview }
      : was?.isRequested !== undefined
        ? { isRequested: was.isRequested, hasCommitsSinceMyReview: was.hasCommitsSinceMyReview }
        : undefined

    return [
      {
        number: state.number,
        isMentioned: mentioned.has(state.number) || was?.isMentioned === true,
        ...known,
        at: after.fetchedAt
      }
    ]
  })
  // One the mentions search listed all along may only lag behind GitHub, for a while; one back in it after it dropped
  // it, still in it past that while, or back in a list, came back.
  const wasMentioned = new Set(source.mentioned.pulls.map((pull) => pull.number))
  const isLagging = (pull: EndedPull) =>
    wasMentioned.has(pull.number) && pull.at !== undefined && after.fetchedAt - pull.at <= MENTIONS_LAG_MS
  const kept = (source.endedPulls ?? []).filter(
    (pull) =>
      !rows.has(pull.number) &&
      !(listed.has(pull.number) && !isLagging(pull)) &&
      !closed.some((each) => each.number === pull.number)
  )

  return { ...after, endedPulls: [...kept, ...closed].slice(-ENDED_PULLS_KEPT) }
}

const ENDED_PULLS_KEPT = 50

// How long the mentions search may go on listing a pull request GitHub says was closed, as its index catches up.
const MENTIONS_LAG_MS = 10 * 60_000

// The pull requests to ask GitHub how they ended, at most `limit`, none the lists still show open: first the rows gone
// since `before`, for their closed alerts, asked though the mentions still list one, as that search may lag; then
// those gone since the list as it stands (`source`), the viewer's own branches' among them, for what carries of them
// (`carryEndedHeads`, `carryEndedPulls`). One only the mentions held is left out where the mentions search is cut short
// now: it may only have fallen past the first 30, and a mention is no news then (`mentionAlerts`).
export function leftToAsk(
  source: PullsSnapshot | null,
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  limit: number
): number[] {
  const open = new Set([
    ...[...rowsOf(after), ...after.mentioned.pulls].map((pull) => pull.number),
    ...stillOpen(after)
  ])
  const sinceSource = isComparable(source, after)
    ? [
        ...vanishedPulls(source, after).map((row) => row.number),
        ...leftHeads(source, after).flatMap((head) => head.number ?? []),
        ...(after.mentioned.isCut ? [] : source.mentioned.pulls.map((pull) => pull.number))
      ]
    : []
  const asked = [...rowsGone(before, after), ...sinceSource.filter((number) => !open.has(number))]

  return [...new Set(asked)].slice(0, limit)
}

// The rows gone from the lists since `before` whose closed alerts GitHub is asked for: not a draft of the viewer's own
// the list hides, still open.
export function rowsGone(before: PullsSnapshot | null, after: PullsSnapshot): number[] {
  const open = new Set(stillOpen(after))

  return vanishedPulls(before, after)
    .map((row) => row.number)
    .filter((number) => !open.has(number))
}

// The viewer's own pull requests GitHub still lists open, shown or not: those of the branches still open (a list kept
// by an earlier version names none), and the drafts the list hides, a fork's among them, which has no branch here.
function stillOpen(after: PullsSnapshot): number[] {
  return [...after.ownHeads.flatMap((head) => head.number ?? []), ...(after.hiddenDraftNumbers ?? [])]
}
