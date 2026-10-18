// Author: David Matura

// The list GitHub sent one session, shared through the store with the other sessions in the same repository: one asks
// GitHub per refresh interval, and the others take its answer, at their timer's tick or a look between ticks, instead
// of asking again. Only the timers take an answer another session read; everything the person asks for asks GitHub.

import type { PullsSnapshot } from "../types"
import type { RepoRef } from "./gh"
import { LIST_QUERY_TIMEOUT_MS } from "./github"
import { pullSearches, pullsQuery } from "./pulls"
import type { PullSearches } from "./pulls"
import { shortHash } from "./store-keys"

// GitHub's answer to the list query as one session read it, for the others, who each read it with their own settings.
export type SharedAnswer = {
  schema: typeof SHARED_SCHEMA
  // What it answers (`answerVersion`): a session of a version of the plugin that asks GitHub something else asks its
  // own.
  query: string
  host: string
  repo: string
  viewer: string
  // When the request went out, and when the answer came.
  requestedAt: number
  fetchedAt: number
  // The session that asked (`Session.id`).
  by: string
  answer: unknown
}

// A session's note that it is asking GitHub now, or that its answer came and is on its way to the store, so another
// session's timer firing meanwhile waits for that answer instead of asking too. Only a session of the same person and
// query waits: it alone could read that answer.
export type FetchClaim = {
  by: string
  // When it was claimed, which it lapses from (`CLAIM_MS`).
  at: number
  // When the request it names went out: the answer that comes is one to a request made then.
  asked: number
  viewer: string
  query: string
}

const SHARED_SCHEMA = 1

// What an answer and a claim are kept under: the repository, the person and what is asked (`answerVersion`), so the
// sessions of another GitHub account, or of a version of the plugin that asks GitHub something else, keep theirs apart.
export function audienceId(repo: RepoRef, viewer: string): string {
  return `${repo.host}/${repo.name}:${viewer}:${QUERY_VERSION}`
}

// How often a session looks for an answer another shared, between its own ticks, so a refresh in any session usually
// reaches the others within it.
export const SHARE_CHECK_MS = 20_000

// How long a claim holds: past it, the session that claimed is taken to have gone without an answer. Longer than the
// request for the lists may take, so a slow answer still counts as coming.
export const CLAIM_MS = LIST_QUERY_TIMEOUT_MS + 5_000

// Looks further apart than this were stopped: the computer slept, or the timers stopped. A wait that came due meanwhile
// is left to the next look, or to the tick where one fires with the first look after.
const LOOK_GAP_MS = 2 * SHARE_CHECK_MS

// An answer another session asked for more than an interval less this ago is due again: the session whose tick finds
// it asks GitHub, and the other takes that answer.
const FRESH_MARGIN_MS = 15_000

// A larger answer is not shared, so those kept stay small beside the rest of the store; a busy repository with every
// list full answers about 109,000 characters (godotengine/godot).
export const SHARED_MAX_CHARS = 150_000

// The sessions on one machine read one clock, so a time ahead of a session's by more than the moments between reading
// the clock and reading the store was taken before the clock was set back. The order of answers (`isAskedSince`) takes
// sessions on one clock; on another machine's, sharing one store, it could take an older answer for a newer one.
const CLOCK_SKEW_MS = 5_000

export function isAhead(at: number, now: number): boolean {
  return at > now + CLOCK_SKEW_MS
}

// What an answer holds: the query's text and the searches it is asked with. The repository the searches name is a part
// of the key of its own (`audienceId`).
export function answerVersion(query: string, searches: PullSearches): string {
  return shortHash(query + JSON.stringify(searches))
}

export const QUERY_VERSION = answerVersion(pullsQuery(true), pullSearches("owner/name"))

// An answer read back from the store; anything else is none. So is one asked for after it came: it would be taken again
// and again (`isAskedSince`), or keep a tick from ever asking GitHub (`planTick`).
export function storedShared(value: unknown): SharedAnswer | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const stored = value as Partial<SharedAnswer>

  return stored.schema === SHARED_SCHEMA &&
    typeof stored.query === "string" &&
    typeof stored.host === "string" &&
    typeof stored.repo === "string" &&
    typeof stored.viewer === "string" &&
    typeof stored.requestedAt === "number" &&
    typeof stored.fetchedAt === "number" &&
    stored.requestedAt <= stored.fetchedAt &&
    typeof stored.by === "string" &&
    typeof stored.answer === "object" &&
    stored.answer !== null
    ? (stored as SharedAnswer)
    : null
}

export function storedClaim(value: unknown): FetchClaim | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const stored = value as Partial<FetchClaim>

  return typeof stored.by === "string" &&
    typeof stored.at === "number" &&
    typeof stored.asked === "number" &&
    typeof stored.viewer === "string" &&
    typeof stored.query === "string"
    ? (stored as FetchClaim)
    : null
}

// A claim another session made that this one would wait for: still within its time, for an answer this one can read.
export function isOthersClaim(
  claim: FetchClaim | null,
  viewer: string,
  sessionId: string,
  now: number
): claim is FetchClaim {
  return (
    claim !== null &&
    claim.by !== sessionId &&
    claim.viewer === viewer &&
    claim.query === QUERY_VERSION &&
    now - claim.at < CLAIM_MS &&
    !isAhead(claim.at, now)
  )
}

// What a session may read from an answer: one to this query, about this repository, for the person its own list is
// for; none dated ahead of its clock.
function isForSession(shared: SharedAnswer, own: PullsSnapshot, repo: RepoRef, now: number): boolean {
  return (
    shared.query === QUERY_VERSION &&
    shared.host === repo.host &&
    shared.repo === repo.name &&
    shared.viewer === own.viewer &&
    !isAhead(shared.fetchedAt, now)
  )
}

// An answer to a request that went out once the list came, so newer. One to a request that crossed the list's may hold
// an older state of GitHub, though it came later, and never replaces it. A list dated ahead of the clock, set back
// since it came, gives no order: any answer is taken, which puts the session on the clock again.
export function isAskedSince(shared: SharedAnswer, list: PullsSnapshot, now: number): boolean {
  return shared.requestedAt >= list.fetchedAt || isAhead(list.fetchedAt, now)
}

// One another session read since the list this session shows: never a step back.
export function newerShared(
  shared: SharedAnswer | null,
  own: PullsSnapshot,
  repo: RepoRef,
  sessionId: string,
  now: number
): SharedAnswer | null {
  return shared && isForSession(shared, own, repo, now) && shared.by !== sessionId && isAskedSince(shared, own, now)
    ? shared
    : null
}

function readable(input: Pick<TickInput, "shared" | "unreadable">): SharedAnswer | null {
  return input.shared && !input.unreadable.has(input.shared.by) ? input.shared : null
}

// The claim of another session to wait for: not one whose answers this session can't read.
function awaitedClaim(input: Pick<TickInput, "claim" | "own" | "sessionId" | "now" | "unreadable">): FetchClaim | null {
  const { claim, own, sessionId, now } = input

  return isOthersClaim(claim, own.viewer, sessionId, now) && !input.unreadable.has(claim.by) ? claim : null
}

// What a timer does: take the answer another session read, ask GitHub, or nothing for now.
export type TickPlan = { kind: "adopt"; shared: SharedAnswer } | { kind: "fetch" } | { kind: "none" }

// An answer a tick left GitHub's request to another session for: one to a request made at or after `since`, due by
// `until`, past which the look between ticks asks GitHub itself.
export type AwaitedAnswer = { since: number; until: number }

export type TickOutcome = { plan: TickPlan; awaited: AwaitedAnswer | null }

export type TickInput = {
  // The list the session shows, and when the request for it went out, by this session or the one whose answer it read.
  own: PullsSnapshot
  requestedAt: number | null
  shared: SharedAnswer | null
  // The sessions whose answers this one could not read, as another version of the plugin may write: their answers it
  // neither takes nor waits on, nor their claims, so towards them it asks GitHub as it would alone.
  unreadable: ReadonlySet<string>
  // The claim of a session asking GitHub now, or whose answer is on its way.
  claim: FetchClaim | null
  now: number
  pollMs: number
  sessionId: string
  repo: RepoRef
}

// GitHub is asked unless another session asked it within the interval, whose answer is taken where it is newer, or is
// asking it now. A session's own requests never skip its tick, so a session alone refreshes exactly as it would without
// sharing; nor does an answer to a request made before the one of the list shown, as where this session's answer
// wasn't shared.
export function planTick(input: TickInput): TickOutcome {
  const { own, now, sessionId, repo, pollMs } = input
  const shared = readable(input)
  const others = shared && shared.by !== sessionId && isForSession(shared, own, repo, now) ? shared : null
  if (others && isAsNew(others, input.requestedAt, now) && now - others.requestedAt < pollMs - FRESH_MARGIN_MS) {
    const newer = newerShared(others, own, repo, sessionId, now)

    // That session asks again an interval on, if it still runs, and claims the request; a look past that with no claim
    // since asks GitHub itself, so none shows a list nearly two intervals old.
    return {
      plan: newer ? { kind: "adopt", shared: newer } : { kind: "none" },
      awaited: { since: others.requestedAt + 1, until: others.requestedAt + pollMs + SHARE_CHECK_MS }
    }
  }
  const claim = awaitedClaim(input)
  if (claim) {
    return { plan: { kind: "none" }, awaited: { since: claim.asked, until: claim.at + CLAIM_MS } }
  }

  return { plan: { kind: "fetch" }, awaited: null }
}

// Whether an answer was asked for no earlier than the list shown (`requestedAt`); any was, where that request is dated
// ahead of the clock.
function isAsNew(shared: SharedAnswer, requestedAt: number | null, now: number): boolean {
  return requestedAt === null || shared.requestedAt >= requestedAt || isAhead(requestedAt, now)
}

// Whether the answer a tick waited for is due, the looks having run all along (`LOOK_GAP_MS`); watched or not, as a
// closed window leaves them running.
export function isOverdue(
  awaited: AwaitedAnswer | null,
  now: number,
  previousLookAt: number | null
): awaited is AwaitedAnswer {
  const isAfterGap = previousLookAt !== null && now - previousLookAt > LOOK_GAP_MS

  return awaited !== null && now >= awaited.until && !isAfterGap
}

// What a session does between its ticks: take a newer answer another session shared. Where the answer its tick waited
// for (`awaited`) is overdue, with no answer to a request made since it was asked for, and no session claiming one
// since, it asks GitHub itself.
export type ShareCheckInput = Omit<TickInput, "pollMs"> & {
  awaited: AwaitedAnswer | null
  // When the look before this one ran.
  previousLookAt: number | null
}

export function planShareCheck(input: ShareCheckInput): TickPlan {
  const { own, now, sessionId, repo, awaited } = input
  const shared = readable(input)
  const newer = newerShared(shared, own, repo, sessionId, now)
  if (newer) {
    return { kind: "adopt", shared: newer }
  }
  if (!isOverdue(awaited, now, input.previousLookAt)) {
    return { kind: "none" }
  }
  const usable = shared && isForSession(shared, own, repo, now) ? shared : null
  const isAnswered = Math.max(input.requestedAt ?? -Infinity, usable?.requestedAt ?? -Infinity) >= awaited.since
  const claim = awaitedClaim(input)
  const isOnItsWay = claim !== null && claim.asked >= awaited.since

  return isAnswered || isOnItsWay ? { kind: "none" } : { kind: "fetch" }
}

// Whether the answer the store keeps stays over one a session just read: where its request went out as late or later,
// its state of GitHub likely the newer; not where it is dated ahead of the clock, which none could read or replace.
export function isKeptOver(before: SharedAnswer | null, shared: SharedAnswer, now: number): boolean {
  return before !== null && !isAhead(before.fetchedAt, now) && before.requestedAt >= shared.requestedAt
}

// The answer a session that read the list from GitHub shares: none too large for the store to keep beside the rest.
export function answerToShare(
  read: { stdout: string; requestedAt: number; fetchedAt: number },
  repo: RepoRef,
  viewer: string,
  by: string
): SharedAnswer | null {
  if (read.stdout.length > SHARED_MAX_CHARS) {
    return null
  }

  return {
    schema: SHARED_SCHEMA,
    query: QUERY_VERSION,
    host: repo.host,
    repo: repo.name,
    viewer,
    requestedAt: read.requestedAt,
    fetchedAt: read.fetchedAt,
    by,
    answer: JSON.parse(read.stdout) as unknown
  }
}
