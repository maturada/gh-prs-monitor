// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { ALERT_KINDS, changesBetween } from "./alerts"
import type { Alert } from "./alerts"
import { carryEndedHeads, carryEndedPulls, leftToAsk, rowsGone } from "./carry"
import type { ClosedState } from "./ended"
import { snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"

const AT = "2026-10-01T11:00:00Z"

// How GitHub said a pull request ended, at commit `head`.
function endedAs(
  number: number,
  state: ClosedState["state"],
  head: string | null = null,
  isCrossRepository = false
): ClosedState {
  return { number, state, by: "ann", head, branch: null, isCrossRepository, headRepo: null }
}

describe("the branches whose pull requests ended", () => {
  const open = (...heads: string[]): ResponseFixture => ({
    mine: heads.map((head, index) => ({ number: index + 1, headRefName: head, headRefOid: `at-${head}` }))
  })

  test("a branch whose pull request left the list is kept, and leaves again once one is open from it", () => {
    const before = carryEndedHeads(null, snapshotOf(open("fix/menu", "feature/legend")), null)
    expect(before.endedHeads).toEqual([])

    const after = carryEndedHeads(before, snapshotOf(open("feature/legend")), null)
    const menu = { branch: "fix/menu", oid: "at-fix/menu" }
    expect(after.endedHeads).toEqual([menu])
    expect(carryEndedHeads(after, snapshotOf(open("feature/legend")), null).endedHeads).toEqual([menu])
    expect(carryEndedHeads(after, snapshotOf(open("feature/legend", "fix/menu")), null).endedHeads).toEqual([])
  })

  test("each is kept at the commit GitHub says its pull request ended at, which the list may not have seen", () => {
    const before = snapshotOf(open("fix/menu", "feature/legend"))
    const states = [endedAs(1, "MERGED", "final-push"), endedAs(2, "CLOSED", "last-push")]

    expect(carryEndedHeads(before, snapshotOf({}), states).endedHeads).toEqual([
      { branch: "fix/menu", oid: "final-push" },
      { branch: "feature/legend", oid: "last-push" }
    ])
  })

  test("at the commit the list last saw where GitHub didn't say, or said it of a fork's", () => {
    const before = snapshotOf(open("fix/menu", "feature/legend"))
    const listed = [
      { branch: "fix/menu", oid: "at-fix/menu" },
      { branch: "feature/legend", oid: "at-feature/legend" }
    ]

    expect(carryEndedHeads(before, snapshotOf({}), null).endedHeads).toEqual(listed)
    expect(carryEndedHeads(before, snapshotOf({}), [endedAs(9, "MERGED", "other")]).endedHeads).toEqual(listed)
    const unsaid = [endedAs(1, "MERGED", null), endedAs(2, "CLOSED", "fork-push", true)]
    expect(carryEndedHeads(before, snapshotOf({}), unsaid).endedHeads).toEqual(listed)
  })

  test("one GitHub says is open only left the search, and is not kept", () => {
    const before = snapshotOf(open("fix/menu"))

    expect(carryEndedHeads(before, snapshotOf({}), [endedAs(1, "OPEN", "at-fix/menu")]).endedHeads).toEqual([])
  })

  test("a list an earlier version kept, its branches unnumbered, finds each one's pull request by its row", () => {
    const listed = snapshotOf(open("fix/menu"))
    const earlier = { ...listed, ownHeads: listed.ownHeads.map(({ branch, oid }) => ({ branch, oid })) }
    const merged = [endedAs(1, "MERGED", "final-push")]

    expect(carryEndedHeads(earlier, snapshotOf({}), merged).endedHeads).toEqual([
      { branch: "fix/menu", oid: "final-push" }
    ])
    // A hidden draft has no row to find it by.
    expect(carryEndedHeads({ ...earlier, mine: [] }, snapshotOf({}), merged).endedHeads).toEqual([
      { branch: "fix/menu", oid: "at-fix/menu" }
    ])
  })

  test("the latest twenty are kept", () => {
    const heads = Array.from({ length: 25 }, (_, index) => `branch-${index}`)
    let snapshot = carryEndedHeads(null, snapshotOf(open(...heads)), null)
    for (let left = 1; left <= heads.length; left++) {
      snapshot = carryEndedHeads(snapshot, snapshotOf(open(...heads.slice(left))), null)
    }

    expect(snapshot.endedHeads.map((head) => head.branch)).toEqual(heads.slice(5))
  })

  test("nothing carries from another repository's list", () => {
    const other = { ...snapshotOf(open("fix/menu")), repo: "acme/other" }

    expect(carryEndedHeads(other, snapshotOf(open()), [endedAs(1, "MERGED", "final-push")]).endedHeads).toEqual([])
  })
})

describe("a pull request closed and reopened", () => {
  // ann's #5, which asks for the viewer's review and mentions them.
  const WITH_5: ResponseFixture = {
    requested: [{ number: 5, title: "Legend", author: "ann" }],
    mentioned: [{ number: 5, title: "Legend", author: "ann" }]
  }
  const seen = snapshotOf(WITH_5)
  const gone = snapshotOf({})
  const named = (alerts: Alert[]): string[] => alerts.map((alert) => `${alert.kind} #${alert.number}`)
  // The requests search cut short at 30.
  const requests = Array.from({ length: 30 }, (_, index) => ({ number: 100 + index, author: "ann" }))
  const CUT: ResponseFixture = { requested: requests, totals: { requested: 31 } }

  test("is carried once GitHub says it was closed, with what the review list and the mentions knew of it", () => {
    expect(carryEndedPulls(seen, gone, [endedAs(5, "CLOSED")]).endedPulls).toEqual([
      { number: 5, isMentioned: true, isRequested: true, hasCommitsSinceMyReview: false, at: 0 }
    ])
  })

  test("not one the lists still show, as GitHub's state comes ahead of its search", () => {
    expect(carryEndedPulls(seen, seen, [endedAs(5, "CLOSED")]).endedPulls).toEqual([])
  })

  test("not once merged, which can't reopen, nor still open, which only left the search, nor where GitHub didn't say", () => {
    for (const states of [[endedAs(5, "MERGED")], [endedAs(5, "OPEN")], [], null]) {
      expect(carryEndedPulls(seen, gone, states).endedPulls).toEqual([])
    }
  })

  test("one only the mentions held is carried knowing nothing of requests; the viewer's own is not carried", () => {
    const before = snapshotOf({ mine: [{ number: 1 }], mentioned: [{ number: 6, author: "bob" }] })

    expect(carryEndedPulls(before, gone, [endedAs(1, "CLOSED"), endedAs(6, "CLOSED")]).endedPulls).toEqual([
      { number: 6, isMentioned: true, at: 0 }
    ])
  })

  test("is no longer carried once back in a list or the mentions, stays while GitHub can't say, and the latest fifty are", () => {
    const closed = carryEndedPulls(seen, gone, [endedAs(5, "CLOSED")])

    expect(carryEndedPulls(closed, gone, null).endedPulls).toEqual(closed.endedPulls)
    expect(carryEndedPulls(closed, snapshotOf({ mentioned: [{ number: 5 }] }), null).endedPulls).toEqual([])
    expect(carryEndedPulls(closed, snapshotOf({ commented: [{ number: 5, author: "ann" }] }), null).endedPulls).toEqual(
      []
    )

    let list = gone
    for (let number = 1; number <= 55; number++) {
      const mentioning = carryEndedPulls(list, snapshotOf({ mentioned: [{ number }] }), null)
      list = carryEndedPulls(mentioning, gone, [endedAs(number, "CLOSED")])
    }
    expect(list.endedPulls?.map((pull) => pull.number)).toEqual(Array.from({ length: 50 }, (_, index) => index + 6))
  })

  test("reopened, its review request and its mention are no news; a list an earlier version kept still tells them", () => {
    const closed = carryEndedPulls(seen, gone, [endedAs(5, "CLOSED")])

    expect(changesBetween(closed, snapshotOf(WITH_5), ALERT_KINDS)).toEqual([])
    expect(named(changesBetween(gone, snapshotOf(WITH_5), ALERT_KINDS))).toEqual(["reviewRequests #5", "mentions #5"])
  })

  test("reopened with nothing new, the commits it had since the viewer's review are no news either", () => {
    const reviewed: ResponseFixture = {
      reviewed: [{ number: 5, author: "ann", reviews: [{ login: "me", state: "COMMENTED", at: AT, commit: "abc" }] }]
    }
    const closed = carryEndedPulls(snapshotOf(reviewed), gone, [endedAs(5, "CLOSED")])

    expect(closed.endedPulls).toEqual([
      { number: 5, isMentioned: false, isRequested: false, hasCommitsSinceMyReview: true, at: 0 }
    ])
    expect(changesBetween(closed, snapshotOf(reviewed), ALERT_KINDS)).toEqual([])
  })

  test("is carried though the mentions still list it, as GitHub's state is newer than that search", () => {
    const mentionsLag = snapshotOf({ mentioned: WITH_5.mentioned })

    expect(carryEndedPulls(seen, mentionsLag, [endedAs(5, "CLOSED")]).endedPulls).toEqual([
      { number: 5, isMentioned: true, isRequested: true, hasCommitsSinceMyReview: false, at: 0 }
    ])
  })

  test("stays while the mentions search lists it all along, as it may lag; back in it after it left, it came back", () => {
    const mentionsLag = snapshotOf({ mentioned: WITH_5.mentioned })
    const closed = carryEndedPulls(seen, mentionsLag, [endedAs(5, "CLOSED")])
    const caughtUp = carryEndedPulls(closed, gone, null)

    expect(carryEndedPulls(closed, mentionsLag, null).endedPulls).toEqual(closed.endedPulls)
    expect(caughtUp.endedPulls).toEqual(closed.endedPulls)
    expect(carryEndedPulls(caughtUp, mentionsLag, null).endedPulls).toEqual([])
    // Back in the review list, it came back, whatever the mentions show.
    expect(carryEndedPulls(closed, snapshotOf(WITH_5), null).endedPulls).toEqual([])
    // Still listed ten minutes after the load that closed it, longer than that search lags, it came back: a request
    // it makes after is news.
    const closedLater = carryEndedPulls(seen, { ...mentionsLag, fetchedAt: 5 * 60_000 }, [endedAs(5, "CLOSED")])
    const tenMinutesOn = { ...mentionsLag, fetchedAt: 15 * 60_000 }
    expect(carryEndedPulls(closedLater, tenMinutesOn, null).endedPulls).toEqual(closedLater.endedPulls)
    expect(
      carryEndedPulls(closedLater, { ...tenMinutesOn, fetchedAt: tenMinutesOn.fetchedAt + 1 }, null).endedPulls
    ).toEqual([])
  })

  test("nothing new is carried from a list told of another repository", () => {
    const other = { ...seen, repo: "acme/other" }

    expect(carryEndedPulls(seen, gone, [endedAs(5, "CLOSED")], other).endedPulls).toEqual([])
  })

  test("is carried as the person was told of it: not one the list told never held, and one it held ended as it was", () => {
    const told = carryEndedPulls(seen, gone, [endedAs(5, "CLOSED")])
    // #5 came back and #6 came while nothing was drawn, and both closed again.
    const source = snapshotOf({
      requested: [
        { number: 5, author: "ann" },
        { number: 6, author: "bob" }
      ]
    })

    expect(carryEndedPulls(source, gone, [endedAs(5, "CLOSED"), endedAs(6, "CLOSED")], told).endedPulls).toEqual([
      { number: 5, isMentioned: true, isRequested: true, hasCommitsSinceMyReview: false, at: 0 }
    ])
  })

  test("one that left while open, as the viewer's approval takes it off the review list, is news when asked again", () => {
    // Still mentioning the viewer, it is open, so GitHub is not asked about it and nothing is carried.
    const approved = carryEndedPulls(seen, snapshotOf({ mentioned: WITH_5.mentioned }), null)

    expect(approved.endedPulls).toEqual([])
    expect(named(changesBetween(approved, snapshotOf(WITH_5), ALERT_KINDS))).toEqual(["reviewRequests #5"])
  })

  test("one closed while it didn't ask for the viewer's review, nor mention them, is news when it comes back doing so", () => {
    const closed = carryEndedPulls(snapshotOf({ commented: [{ number: 5, author: "ann" }] }), gone, [
      endedAs(5, "CLOSED")
    ])
    const asking = snapshotOf({ requested: [{ number: 5, author: "ann" }], mentioned: [{ number: 5, author: "ann" }] })

    expect(closed.endedPulls).toEqual([
      { number: 5, isMentioned: false, isRequested: false, hasCommitsSinceMyReview: false, at: 0 }
    ])
    expect(named(changesBetween(closed, asking, ALERT_KINDS))).toEqual(["reviewRequests #5", "mentions #5"])
  })

  test("known so, it is news though the requests search was cut short, as a row before would be", () => {
    const commented = snapshotOf({ ...CUT, commented: [{ number: 5, author: "ann" }] })
    const closed = carryEndedPulls(commented, snapshotOf(CUT), [endedAs(5, "CLOSED")])
    const back = snapshotOf({ ...CUT, requested: [{ number: 5, author: "ann" }, ...requests.slice(1)] })

    expect(named(changesBetween(closed, back, ALERT_KINDS))).toEqual(["reviewRequests #5"])
  })

  test("one only the mentions held, closed while the requests search was cut short, comes back asking unannounced", () => {
    const mentioning = snapshotOf({ ...CUT, mentioned: [{ number: 5, author: "ann" }] })
    const closed = carryEndedPulls(mentioning, snapshotOf(CUT), [endedAs(5, "CLOSED")])
    const back = snapshotOf({
      ...CUT,
      requested: [{ number: 5, author: "ann" }, ...requests.slice(1)],
      mentioned: [{ number: 5, author: "ann" }]
    })

    expect(closed.endedPulls).toEqual([{ number: 5, isMentioned: true, at: 0 }])
    expect(changesBetween(closed, back, ALERT_KINDS)).toEqual([])
  })
})

describe("the pull requests that left the lists GitHub is asked about", () => {
  // Compared with a list from before the person went away (`before`); the list as it stands (`source`) has #8, which
  // came meanwhile, a hidden draft's branch, #9, and a mention, #12.
  const before = snapshotOf({ mine: [{ number: 1 }], requested: [{ number: 2, author: "ann" }] })
  const listed = snapshotOf({
    requested: [
      { number: 2, author: "ann" },
      { number: 8, author: "bob" }
    ],
    mentioned: [{ number: 12, author: "bob" }]
  })
  const source = { ...listed, ownHeads: [{ branch: "draft/legend", oid: "d", number: 9 }] }

  test("those gone since the list compared with first, then those gone since the list as it stands, as many as asked", () => {
    expect(leftToAsk(source, before, snapshotOf({}), 30)).toEqual([1, 2, 8, 9, 12])
    expect(leftToAsk(source, before, snapshotOf({}), 3)).toEqual([1, 2, 8])
    expect(leftToAsk(null, null, snapshotOf({}), 30)).toEqual([])
  })

  test("a row gone since the list compared with is asked about though the mentions still list it, as that search may lag", () => {
    expect(leftToAsk(before, before, snapshotOf({ mentioned: [{ number: 2, author: "ann" }] }), 30)).toEqual([1, 2])
  })

  test("a hidden draft's row, its branch still open, is asked about from neither list", () => {
    const draft = snapshotOf({ mine: [{ number: 1, headRefName: "fix/old" }] })
    const hidden = { ...snapshotOf({}), ownHeads: [{ branch: "fix/old", oid: "o", number: 1 }] }

    expect(leftToAsk(draft, draft, hidden, 30)).toEqual([])
  })

  test("a hidden draft from a fork, which has no branch here, is asked about from neither list", () => {
    const draft = snapshotOf({ mine: [{ number: 1, isCrossRepository: true }] })
    const hidden = { ...snapshotOf({}), hiddenDrafts: 1, hiddenDraftNumbers: [1] }

    expect(leftToAsk(draft, draft, hidden, 30)).toEqual([])
    expect(rowsGone(draft, hidden)).toEqual([])
    expect(rowsGone(draft, snapshotOf({}))).toEqual([1])
  })

  test("none the lists still show open: in a list, among the mentions or the viewer's own branches", () => {
    const after = {
      ...snapshotOf({ commented: [{ number: 2, author: "ann" }], mentioned: [{ number: 8, author: "bob" }] }),
      ownHeads: [{ branch: "fix/old", oid: "o", number: 1 }]
    }

    expect(leftToAsk(source, before, after, 30)).toEqual([9, 12])
  })

  test("one only the mentions held is left out where the mentions search is cut short now, not where it was before", () => {
    const cut = snapshotOf({ mentioned: [{ number: 12, author: "bob" }], totals: { mentioned: 31 } })

    expect(leftToAsk(source, before, snapshotOf({ totals: { mentioned: 31 } }), 30)).toEqual([1, 2, 8, 9])
    // Every mention is listed now, so one the cut list held and this one lacks has left.
    expect(leftToAsk({ ...source, mentioned: cut.mentioned }, before, snapshotOf({}), 30)).toEqual([1, 2, 8, 9, 12])
  })

  test("a hidden draft's branch in a list an earlier version kept, which names no pull request, is not asked about", () => {
    const earlier = { ...snapshotOf({}), ownHeads: [{ branch: "draft/legend", oid: "d" }] }

    expect(leftToAsk(earlier, null, snapshotOf({}), 30)).toEqual([])
  })
})
