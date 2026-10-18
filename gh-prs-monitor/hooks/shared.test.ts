// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { PullsSnapshot } from "../types"
import { pullSearches, pullsQuery } from "./pulls"
import {
  answerVersion,
  answerToShare,
  isKeptOver,
  newerShared,
  planShareCheck,
  planTick,
  QUERY_VERSION,
  SHARED_MAX_CHARS,
  storedClaim,
  storedShared
} from "./shared"
import { shortHash } from "./store-keys"
import { answer, fetchClaim, MINUTE, REPO, snapshotOf } from "./testing/fixtures"

const POLL = 3 * MINUTE

function listAt(fetchedAt: number, viewer = "me"): PullsSnapshot {
  return snapshotOf({ viewer }, { at: fetchedAt })
}

describe("what the store keeps for the sessions in a repository", () => {
  test("an answer or a claim read back is one only in full", () => {
    expect(storedShared(answer())).toEqual(answer())
    for (const broken of [
      { schema: 2 },
      { query: 7 },
      { viewer: undefined },
      { requestedAt: "now" },
      { requestedAt: 10 * MINUTE + 2_001 },
      { by: null },
      { answer: null }
    ]) {
      expect(storedShared({ ...answer(), ...broken })).toBeNull()
    }
    expect(storedShared("answer")).toBeNull()
    expect(storedClaim(fetchClaim("other", 5))).toEqual(fetchClaim("other", 5))
    for (const broken of [
      { by: 7 },
      { at: "now" },
      { asked: undefined },
      { viewer: undefined },
      { query: undefined }
    ]) {
      expect(storedClaim({ ...fetchClaim("other", 5), ...broken })).toBeNull()
    }
    expect(storedClaim(null)).toBeNull()
  })

  test("names what an answer is to by a short hash of the query's text and its searches, the repository left out", () => {
    expect([shortHash(""), shortHash("a")]).toEqual(["811c9dc5", "e40c292c"])
    expect(QUERY_VERSION).toBe(answerVersion(pullsQuery(true), pullSearches("owner/name")))
  })

  test("tells answers apart by the query's text and by the searches it is asked with", () => {
    const searches = pullSearches("owner/name")

    expect(answerVersion(pullsQuery(false), searches)).not.toBe(QUERY_VERSION)
    expect(answerVersion(pullsQuery(true), { ...searches, mine: `${searches.mine} draft:false` })).not.toBe(
      QUERY_VERSION
    )
    expect(answerVersion(pullsQuery(true), { ...searches, mentioned: `${searches.mentioned} draft:false` })).not.toBe(
      QUERY_VERSION
    )
  })

  test("shares what GitHub answered, with when it was asked and who asked; none too large to keep", () => {
    const read = { stdout: JSON.stringify({ data: { viewer: { login: "me" } } }), requestedAt: 5, fetchedAt: 7 }

    expect(answerToShare(read, REPO, "me", "this")).toEqual(
      answer({ requestedAt: 5, fetchedAt: 7, by: "this", answer: { data: { viewer: { login: "me" } } } })
    )
    const atMost = JSON.stringify({ data: "x".repeat(SHARED_MAX_CHARS - '{"data":""}'.length) })
    expect(answerToShare({ ...read, stdout: atMost }, REPO, "me", "this")).not.toBeNull()
    expect(answerToShare({ ...read, stdout: atMost + " " }, REPO, "me", "this")).toBeNull()
  })

  test("keeps the answer stored over one read since where its request went out as late or later", () => {
    const now = 11 * MINUTE
    const read = answer({ requestedAt: now - 3_000, fetchedAt: now - 1_000, by: "this" })

    expect(isKeptOver(answer({ requestedAt: now - 3_000, fetchedAt: now }), read, now)).toBe(true)
    expect(isKeptOver(answer({ requestedAt: now - 4_000, fetchedAt: now }), read, now)).toBe(false)
    expect(isKeptOver(null, read, now)).toBe(false)
    // Not one dated ahead of the clock, which nobody could read or replace until the clock caught up.
    expect(isKeptOver(answer({ requestedAt: now, fetchedAt: now + 5_000 }), read, now)).toBe(true)
    expect(isKeptOver(answer({ requestedAt: now, fetchedAt: now + 5_001 }), read, now)).toBe(false)
  })
})

describe("an answer another session shared", () => {
  const NOW = 11 * MINUTE

  test("is taken where it is newer than the list shown, for the same person, query and repository", () => {
    const own = listAt(5 * MINUTE)

    expect(newerShared(answer(), own, REPO, "this", NOW)).toEqual(answer())
    expect(newerShared(answer({ requestedAt: 5 * MINUTE }), own, REPO, "this", NOW)).toEqual(
      answer({ requestedAt: 5 * MINUTE })
    )
    // To a request that went out before the list came: it may hold an older state, though it came later.
    expect(newerShared(answer({ requestedAt: 5 * MINUTE - 1 }), own, REPO, "this", NOW)).toBeNull()
    // Unless the list is dated ahead of the clock, set back since: then any answer puts the session on the clock again.
    expect(newerShared(answer(), listAt(NOW + 5_001), REPO, "this", NOW)).toEqual(answer())
    expect(newerShared(answer(), listAt(NOW + 5_000), REPO, "this", NOW)).toBeNull()
    expect(newerShared(answer({ by: "this" }), own, REPO, "this", NOW)).toBeNull()
    expect(newerShared(answer({ viewer: "you" }), own, REPO, "this", NOW)).toBeNull()
    expect(newerShared(answer({ query: "0" }), own, REPO, "this", NOW)).toBeNull()
    expect(newerShared(answer({ host: "git.acme.dev" }), own, REPO, "this", NOW)).toBeNull()
    expect(newerShared(answer({ repo: "acme/other" }), own, REPO, "this", NOW)).toBeNull()
    // Dated ahead of this session's clock.
    expect(newerShared(answer({ fetchedAt: NOW + 2 * MINUTE }), own, REPO, "this", NOW)).toBeNull()
    expect(newerShared(null, own, REPO, "this", NOW)).toBeNull()
  })
})

describe("the timer's tick", () => {
  const own = listAt(5 * MINUTE)
  const tick = (input: Partial<Parameters<typeof planTick>[0]>) =>
    planTick({
      own,
      requestedAt: 5 * MINUTE - 2_000,
      shared: null,
      unreadable: new Set(),
      claim: null,
      now: 11 * MINUTE,
      pollMs: POLL,
      sessionId: "this",
      repo: REPO,
      ...input
    })
  const fetch = { plan: { kind: "fetch" }, awaited: null }
  // The next answer of the session that asked, due an interval and a claim's time after its request.
  const NEXT = { since: 10 * MINUTE + 1, until: 10 * MINUTE + POLL + 20_000 }

  test("takes a newer answer another session asked for within the interval, asks GitHub nothing, and awaits its next", () => {
    expect(tick({ shared: answer() })).toEqual({ plan: { kind: "adopt", shared: answer() }, awaited: NEXT })
    // One it already shows, or shows a newer list than, leaves it be.
    expect(tick({ own: listAt(10 * MINUTE + 2_000), requestedAt: 10 * MINUTE, shared: answer() })).toEqual({
      plan: { kind: "none" },
      awaited: NEXT
    })
  })

  test("asks GitHub where the answer shared was asked for before the list it shows, as where its own wasn't shared", () => {
    expect(tick({ own: listAt(10 * MINUTE + 3_000), requestedAt: 10 * MINUTE + 1, shared: answer() })).toEqual(fetch)
    // A list dated ahead of the clock, as after it was set back, waits for any.
    expect(tick({ own: listAt(20 * MINUTE), requestedAt: 20 * MINUTE - 2_000, shared: answer() })).toEqual({
      plan: { kind: "adopt", shared: answer() },
      awaited: NEXT
    })
    // Nor does a list whose request isn't known, as after a reload.
    expect(tick({ requestedAt: null, shared: answer() })).toEqual({
      plan: { kind: "adopt", shared: answer() },
      awaited: NEXT
    })
  })

  test("asks GitHub once that answer is nearly an interval old", () => {
    expect(tick({ shared: answer(), now: 10 * MINUTE + POLL - 16_000 })).toEqual({
      plan: { kind: "adopt", shared: answer() },
      awaited: NEXT
    })
    expect(tick({ shared: answer(), now: 10 * MINUTE + POLL - 15_000 })).toEqual(fetch)
  })

  test("asks GitHub at its own pace where only its own answer is shared, or none, or one it can't read", () => {
    expect(tick({ shared: answer({ by: "this" }) })).toEqual(fetch)
    expect(tick({})).toEqual(fetch)
    expect(tick({ shared: answer({ viewer: "you" }) })).toEqual(fetch)
  })

  test("waits for another session asking GitHub now; not for its own claim, nor one that lapsed", () => {
    const now = 11 * MINUTE

    // A claim holds longer than the request it names may take.
    expect(tick({ claim: fetchClaim("other", now - 34_000) })).toEqual({
      plan: { kind: "none" },
      awaited: { since: now - 34_000, until: now + 1_000 }
    })
    expect(tick({ claim: fetchClaim("other", now - 35_000) })).toEqual(fetch)
    // One claimed as its answer came awaits an answer to the request it names, by the claim's time.
    expect(tick({ claim: fetchClaim("other", now - 5_000, "me", now - 15_000) })).toEqual({
      plan: { kind: "none" },
      awaited: { since: now - 15_000, until: now + 30_000 }
    })
    expect(tick({ claim: fetchClaim("this", now - 1_000) })).toEqual(fetch)
    expect(tick({ claim: fetchClaim("other", now + 2 * MINUTE) })).toEqual(fetch)
  })

  test("asks GitHub at its own pace towards a session whose answers it could not read: its answers and claims left", () => {
    const unreadable = new Set(["other"])

    expect(tick({ shared: answer(), unreadable })).toEqual(fetch)
    expect(tick({ claim: fetchClaim("other", 11 * MINUTE - 1_000), unreadable })).toEqual(fetch)
    expect(tick({ shared: answer({ by: "third" }), unreadable })).toEqual({
      plan: { kind: "adopt", shared: answer({ by: "third" }) },
      awaited: NEXT
    })
  })

  test("waits for none whose answer it couldn't read: another person's, or another version's", () => {
    const now = 11 * MINUTE

    expect(tick({ claim: { ...fetchClaim("other", now - 1_000), viewer: "you" } })).toEqual(fetch)
    expect(tick({ claim: { ...fetchClaim("other", now - 1_000), query: "0" } })).toEqual(fetch)
  })
})

describe("the look between ticks", () => {
  const own = listAt(5 * MINUTE)
  const check = (input: Partial<Parameters<typeof planShareCheck>[0]>) =>
    planShareCheck({
      own,
      shared: null,
      unreadable: new Set(),
      claim: null,
      requestedAt: 5 * MINUTE,
      now: 11 * MINUTE,
      sessionId: "this",
      repo: REPO,
      awaited: null,
      previousLookAt: null,
      ...input
    })

  test("takes a newer answer as soon as one is shared", () => {
    expect(check({ shared: answer() })).toEqual({ kind: "adopt", shared: answer() })
    expect(check({ shared: answer({ by: "this" }) })).toEqual({ kind: "none" })
  })

  test("counts as awaited no answer it can't read: dated ahead of its clock, or another person's", () => {
    const awaited = { since: 11 * MINUTE - 20_000, until: 11 * MINUTE }

    expect(check({ awaited, shared: answer({ requestedAt: awaited.since, fetchedAt: 13 * MINUTE }) })).toEqual({
      kind: "fetch"
    })
    expect(
      check({ awaited, shared: answer({ requestedAt: awaited.since, fetchedAt: awaited.since, viewer: "you" }) })
    ).toEqual({ kind: "fetch" })
  })

  test("counts an answer to the request a claim names as the one awaited, though it was claimed as it came", () => {
    // The tick waited on a claim made as the answer came, 10 s after its request went out.
    const askedAt = 11 * MINUTE - 45_000
    const awaited = { since: askedAt, until: askedAt + 10_000 + 35_000 }
    const own = listAt(askedAt + 10_000)

    expect(check({ awaited, own, requestedAt: askedAt })).toEqual({ kind: "none" })
    expect(check({ awaited, own, requestedAt: askedAt - 1 })).toEqual({ kind: "fetch" })
  })

  test("waits on while a session claimed the request it awaits, and leaves a wait that went stale to the tick", () => {
    const awaited = { since: 11 * MINUTE - 20_000, until: 11 * MINUTE }

    // Claimed since it was asked for: that session is on its way to the answer.
    expect(check({ awaited, claim: fetchClaim("other", awaited.since) })).toEqual({ kind: "none" })
    // Not one from before, its own, or one that lapsed; nor one claimed since for an answer to a request from before.
    expect(check({ awaited, claim: fetchClaim("other", awaited.since - 1) })).toEqual({ kind: "fetch" })
    expect(check({ awaited, claim: fetchClaim("other", awaited.since + 5_000, "me", awaited.since - 1) })).toEqual({
      kind: "fetch"
    })
    expect(check({ awaited, claim: fetchClaim("this", awaited.since) })).toEqual({ kind: "fetch" })
    expect(check({ awaited, now: awaited.since + 35_000, claim: fetchClaim("other", awaited.since) })).toEqual({
      kind: "fetch"
    })
    // Long overdue, the looks having run all along, as with a closed window: it asks.
    expect(check({ awaited, now: awaited.until + 200_000, previousLookAt: awaited.until + 180_000 })).toEqual({
      kind: "fetch"
    })
    // Due while the looks were stopped, as the computer slept: the next look, or a tick firing with this one, decides.
    expect(check({ awaited, previousLookAt: awaited.until - 40_000 })).toEqual({ kind: "fetch" })
    expect(check({ awaited, previousLookAt: awaited.until - 40_001 })).toEqual({ kind: "none" })
  })

  test("takes no answer of a session whose answers it could not read, nor counts its answer or claim as awaited", () => {
    const awaited = { since: 11 * MINUTE - 20_000, until: 11 * MINUTE }
    const unread = answer({ requestedAt: awaited.since, fetchedAt: awaited.since + 2_000 })
    const unreadable = new Set([unread.by])

    expect(check({ shared: unread, unreadable })).toEqual({ kind: "none" })
    expect(check({ shared: unread, unreadable, awaited })).toEqual({ kind: "fetch" })
    expect(check({ claim: fetchClaim(unread.by, awaited.since), unreadable, awaited })).toEqual({ kind: "fetch" })
  })

  test("asks GitHub once the answer its tick awaited is overdue, with no answer to a request since", () => {
    const awaited = { since: 11 * MINUTE - 20_000, until: 11 * MINUTE }

    expect(check({ awaited })).toEqual({ kind: "fetch" })
    expect(check({ awaited: { ...awaited, until: 11 * MINUTE + 1 } })).toEqual({ kind: "none" })
    // An answer to a request made since it was asked for, its own or one it can read, needs none.
    expect(check({ awaited, requestedAt: awaited.since })).toEqual({ kind: "none" })
    expect(check({ awaited, requestedAt: awaited.since - 1 })).toEqual({ kind: "fetch" })
    expect(
      check({
        awaited,
        own: listAt(11 * MINUTE),
        shared: answer({ requestedAt: awaited.since, fetchedAt: awaited.since + 2_000 })
      })
    ).toEqual({
      kind: "none"
    })
    expect(
      check({
        awaited,
        own: listAt(11 * MINUTE),
        shared: answer({ requestedAt: awaited.since - 1, fetchedAt: awaited.since + 2_000 })
      })
    ).toEqual({
      kind: "fetch"
    })
  })
})
