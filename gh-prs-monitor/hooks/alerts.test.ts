// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { Activity, PullsSnapshot } from "../types"
import { REPO, snapshotOf } from "./testing/fixtures"
import type { PullFixture, ResponseFixture } from "./testing/fixtures"
import {
  activityAfter,
  activityOf,
  alertLine,
  alertLines,
  awayLine,
  changesBetween,
  closedAlerts,
  freshAlerts,
  holdAlerts,
  noteEvents,
  pullAlerts as changesOf,
  readHeld,
  refreshAlerts,
  sinceLastLook,
  toastsFor,
  vanishedPulls
} from "./alerts"
import { carryKnownStates } from "./carry"
import { clockTime, lookedAt } from "./when"
import type { Alert } from "./alerts"
import { listText } from "./list"
import { statusSummary, summaryText } from "./summary"

// Each change as its own line, with its kind, the way a toast would show it alone.
function pullAlerts(before: PullsSnapshot | null, after: PullsSnapshot): { kind: Alert["kind"]; text: string }[] {
  return changesOf(before, after).map((alert) => ({
    kind: alert.kind,
    text: alertLine(alert.symbol, alert, alert.event, alert.by ?? undefined)
  }))
}

// A change a refresh noticed, as the tests below need it: a comment unless they say otherwise.
function alertOf(number: number, event: string, fields: Partial<Alert> = {}): Alert {
  return { kind: "comments", number, title: `Pull request ${number}`, by: null, symbol: "✎", event, ...fields }
}

const MINUTE = 60_000
const AT = "2026-10-01T11:00:00Z"
const LATER = "2026-10-01T15:00:00Z"

describe("pullAlerts", () => {
  test("the first refresh only sets the baseline", () => {
    expect(pullAlerts(null, snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }))).toEqual([])
  })

  test("a snapshot kept from another version of the plugin starts over", () => {
    const before = snapshotOf({ mine: [{ number: 1 }] })
    const after = snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] })

    expect(pullAlerts({ ...before, schema: before.schema - 1 }, after)).toEqual([])
    expect(pullAlerts({ mine: before.mine } as never, after)).toEqual([])
  })

  test("another repository or account starts over", () => {
    const before = snapshotOf({ mine: [{ number: 1 }] })

    expect(pullAlerts({ ...before, repo: "acme/other" }, snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }))).toEqual(
      []
    )
    expect(pullAlerts({ ...before, viewer: "you" }, snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }))).toEqual([])
  })

  test("nothing changed, nothing to say", () => {
    const fixture: ResponseFixture = {
      mine: [{ number: 1, reviews: [{ login: "ann", state: "COMMENTED", at: AT }], threads: [{ isResolved: false }] }],
      requested: [{ number: 2, author: "ann" }]
    }

    expect(pullAlerts(snapshotOf(fixture), snapshotOf(fixture))).toEqual([])
  })

  test("CI turning red, and turning green from running or failing", () => {
    const failed = pullAlerts(
      snapshotOf({ mine: [{ number: 1, ci: "PENDING" }] }),
      snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] })
    )
    const passed = pullAlerts(
      snapshotOf({ mine: [{ number: 1, ci: "PENDING" }] }),
      snapshotOf({ mine: [{ number: 1, ci: "SUCCESS" }] })
    )
    const stillRed = pullAlerts(
      snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }),
      snapshotOf({ mine: [{ number: 1, ci: "ERROR" }] })
    )
    const firstRun = pullAlerts(
      snapshotOf({ mine: [{ number: 1, ci: null }] }),
      snapshotOf({ mine: [{ number: 1, ci: "SUCCESS" }] })
    )
    // A re-run that ran from start to end between two refreshes.
    const fixed = pullAlerts(
      snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }),
      snapshotOf({ mine: [{ number: 1, ci: "SUCCESS" }] })
    )

    expect(failed).toEqual([{ kind: "ci", text: "✗ #1 Pull request 1 — CI failed" }])
    expect(passed).toEqual([{ kind: "ci", text: "✓ #1 Pull request 1 — CI passed" }])
    expect(stillRed).toEqual([])
    expect(firstRun).toEqual([])
    expect(fixed).toEqual([{ kind: "ci", text: "✓ #1 Pull request 1 — CI passed" }])
  })

  test("conflicts after an unknown mergeability are not news", () => {
    expect(
      pullAlerts(
        snapshotOf({ mine: [{ number: 1, mergeable: "UNKNOWN" }] }),
        snapshotOf({ mine: [{ number: 1, mergeable: "CONFLICTING" }] })
      )
    ).toEqual([])
  })

  test("new merge conflicts", () => {
    expect(
      pullAlerts(snapshotOf({ mine: [{ number: 1 }] }), snapshotOf({ mine: [{ number: 1, mergeable: "CONFLICTING" }] }))
    ).toEqual([{ kind: "conflicts", text: "⚠ #1 Pull request 1 — merge conflicts" }])
  })

  test("a conflict a push to the base brings is news, though GitHub rechecked in between", () => {
    const clean = snapshotOf({ mine: [{ number: 1 }] })
    const checking = carryKnownStates(clean, snapshotOf({ mine: [{ number: 1, mergeable: "UNKNOWN" }] }))
    const conflicting = carryKnownStates(checking, snapshotOf({ mine: [{ number: 1, mergeable: "CONFLICTING" }] }))

    expect(pullAlerts(checking, conflicting)).toEqual([
      { kind: "conflicts", text: "⚠ #1 Pull request 1 — merge conflicts" }
    ])
    // Through two rechecks the last known state still holds.
    const again = carryKnownStates(checking, snapshotOf({ mine: [{ number: 1, mergeable: "UNKNOWN" }] }))
    expect(pullAlerts(again, carryKnownStates(again, conflicting))).toHaveLength(1)
    // Conflicting before the recheck, it is no news after it.
    const wasConflicting = carryKnownStates(conflicting, snapshotOf({ mine: [{ number: 1, mergeable: "UNKNOWN" }] }))
    expect(pullAlerts(wasConflicting, conflicting)).toEqual([])
  })

  test("each reviewer's new review, the review's own comments not counted again", () => {
    const before = snapshotOf({ mine: [{ number: 1, reviews: [{ login: "ann", state: "COMMENTED", at: AT }] }] })
    const after = snapshotOf({
      mine: [
        {
          number: 1,
          threads: [{ isResolved: false }, { isResolved: false }],
          reviews: [
            { login: "ann", state: "APPROVED", at: LATER },
            { login: "bob", state: "CHANGES_REQUESTED", at: LATER },
            { login: "cid", state: "COMMENTED", at: LATER },
            { login: "dee", state: "DISMISSED", at: LATER }
          ]
        }
      ]
    })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "reviews", text: "✓ #1 Pull request 1 — approved by ann" },
      { kind: "reviews", text: "± #1 Pull request 1 — changes requested by bob" },
      { kind: "reviews", text: "✎ #1 Pull request 1 — reviewed by cid" }
    ])
  })

  test("a bot's review and the comments it brings are no news", () => {
    const before = snapshotOf({ mine: [{ number: 1 }] })
    const after = snapshotOf({
      mine: [
        {
          number: 1,
          threads: [{ isResolved: false }, { isResolved: false }],
          reviews: [{ login: "gemini-code-assist", state: "COMMENTED", at: LATER, isBot: true }]
        }
      ]
    })

    expect(pullAlerts(before, after)).toEqual([])
  })

  test("review threads without a person's new review are no news: the author's own, or one unresolved again", () => {
    // GitHub lists no review of the author's own among the latest reviews, so their comments on their diff come
    // as threads alone.
    expect(
      pullAlerts(
        snapshotOf({ mine: [{ number: 1, threads: [{ isResolved: false }] }] }),
        snapshotOf({
          mine: [{ number: 1, threads: [{ isResolved: false }, { isResolved: false }, { isResolved: false }] }]
        })
      )
    ).toEqual([])
    const resolved = snapshotOf({ mine: [{ number: 1, threads: [{ isResolved: true }] }] })
    const reopened = snapshotOf({ mine: [{ number: 1, threads: [{ isResolved: false }] }] })
    expect(pullAlerts(resolved, reopened)).toEqual([])

    const outdated = { mine: [{ number: 1, threads: [{ isResolved: false, isOutdated: true }] }] }
    expect(pullAlerts(snapshotOf(outdated), snapshotOf(outdated, { includeOutdated: true }))).toEqual([])
  })

  test("someone commenting on the conversation", () => {
    const before = snapshotOf({ mine: [{ number: 1, comments: { count: 1, lastAuthor: "linear", isBot: true } }] })

    expect(
      pullAlerts(before, snapshotOf({ mine: [{ number: 1, comments: { count: 2, lastAuthor: "ann" } }] }))
    ).toEqual([{ kind: "comments", text: "✎ #1 Pull request 1 — new comment from ann" }])
    expect(
      pullAlerts(before, snapshotOf({ mine: [{ number: 1, comments: { count: 4, lastAuthor: "ann" } }] }))
    ).toEqual([{ kind: "comments", text: "✎ #1 Pull request 1 — 3 new comments, the latest from ann" }])
  })

  test("one's own comments and a bot's are no news", () => {
    const before = snapshotOf({ mine: [{ number: 1, comments: { count: 1, lastAuthor: "ann" } }] })

    expect(pullAlerts(before, snapshotOf({ mine: [{ number: 1, comments: { count: 2, lastAuthor: "me" } }] }))).toEqual(
      []
    )
    expect(
      pullAlerts(
        before,
        snapshotOf({ mine: [{ number: 1, comments: { count: 2, lastAuthor: "dependabot", isBot: true } }] })
      )
    ).toEqual([])
  })

  test("the comments people wrote since the viewer's last reply, a bot's after them hiding none", () => {
    const before = snapshotOf({ mine: [{ number: 1, comments: { count: 1, lastAuthor: "ann" } }] })
    const after = (comments: NonNullable<PullFixture["comments"]>) =>
      pullAlerts(before, snapshotOf({ mine: [{ number: 1, comments }] }))

    expect(
      after({ count: 3, earlier: [{ login: "ann" }, { login: "bob" }], lastAuthor: "linear", isBot: true })
    ).toEqual([{ kind: "comments", text: "✎ #1 Pull request 1 — new comment from bob" }])
    expect(after({ count: 3, earlier: [{ login: "ann" }, { login: "bob" }], lastAuthor: "me" })).toEqual([])
    expect(after({ count: 3, earlier: [{ login: "ann" }, { login: "me" }], lastAuthor: "bob" })).toEqual([
      { kind: "comments", text: "✎ #1 Pull request 1 — new comment from bob" }
    ])
    // Seven new, five read: the two before them count as people's, as nothing says otherwise.
    const five = [{ login: "bob" }, { login: "linear", isBot: true }, { login: "cy" }, { login: "bob" }]
    expect(after({ count: 8, earlier: five, lastAuthor: "linear", isBot: true })).toEqual([
      { kind: "comments", text: "✎ #1 Pull request 1 — 5 new comments, the latest from bob" }
    ])
  })

  test("a deleted comment is no news", () => {
    const before = snapshotOf({ mine: [{ number: 1, comments: { count: 3, lastAuthor: "ann" } }] })

    expect(
      pullAlerts(before, snapshotOf({ mine: [{ number: 1, comments: { count: 2, lastAuthor: "ann" } }] }))
    ).toEqual([])
  })

  test("a newly opened pull request of one's own is no news", () => {
    expect(pullAlerts(snapshotOf({}), snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }))).toEqual([])
  })

  test("a new review request names the pull request and its author", () => {
    expect(
      pullAlerts(snapshotOf({}), snapshotOf({ requested: [{ number: 5, title: "Add the map legend", author: "ann" }] }))
    ).toEqual([{ kind: "reviewRequests", text: "⌕ #5 Add the map legend (ann) — review requested" }])
  })

  test("a request again after commenting", () => {
    const before = snapshotOf({ commented: [{ number: 5, author: "ann" }] })
    const after = snapshotOf({ requested: [{ number: 5, title: "Legend", author: "ann" }] })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "reviewRequests", text: "⌕ #5 Legend (ann) — review requested" }
    ])
  })

  test("nothing for one missing before while the requests search was cut short, as it may only be coming back", () => {
    const requests = Array.from({ length: 30 }, (_, index) => ({ number: 100 + index, author: "ann" }))
    const before = snapshotOf({ requested: requests, totals: { requested: 31 } })
    const after = snapshotOf({
      requested: [{ number: 5, author: "ann" }, ...requests.slice(1)],
      totals: { requested: 31 }
    })

    expect(pullAlerts(before, after)).toEqual([])
  })

  test("a new request counts when the requests search was whole before, though it is cut short now", () => {
    const requests = Array.from({ length: 30 }, (_, index) => ({ number: 100 + index, author: "ann" }))
    const before = snapshotOf({ requested: requests.slice(1) })
    const after = snapshotOf({
      requested: [{ number: 5, title: "Legend", author: "ann" }, ...requests.slice(1)],
      totals: { requested: 31 }
    })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "reviewRequests", text: "⌕ #5 Legend (ann) — review requested" }
    ])
  })

  test("a request again after commenting still counts while the requests search is cut short", () => {
    const before = snapshotOf({ commented: [{ number: 5, author: "ann" }], totals: { requested: 31 } })
    const after = snapshotOf({ requested: [{ number: 5, title: "Legend", author: "ann" }], totals: { requested: 31 } })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "reviewRequests", text: "⌕ #5 Legend (ann) — review requested" }
    ])
  })

  test("a new request counts while only the searches of pull requests taken part in are cut short", () => {
    const before = snapshotOf({ commented: [{ number: 6, author: "bob" }], totals: { commented: 31 } })
    const after = snapshotOf({
      requested: [{ number: 5, title: "Legend", author: "ann" }],
      commented: [{ number: 6, author: "bob" }],
      totals: { commented: 31 }
    })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "reviewRequests", text: "⌕ #5 Legend (ann) — review requested" }
    ])
  })

  test("one new to the list with commits since the viewer's review is no news of them, as it may only be coming back", () => {
    const after = snapshotOf({
      reviewed: [{ number: 5, author: "ann", reviews: [{ login: "me", state: "COMMENTED", at: AT, commit: "abc" }] }]
    })

    expect(after.review[0]?.signals.hasCommitsSinceMyReview).toBe(true)
    expect(pullAlerts(snapshotOf({}), after)).toEqual([])
  })

  test("new commits after the viewer's review", () => {
    const review = { login: "me", state: "COMMENTED", at: AT, commit: "abc" }
    const before = snapshotOf({ reviewed: [{ number: 5, author: "ann", headRefOid: "abc", reviews: [review] }] })
    const after = snapshotOf({ reviewed: [{ number: 5, author: "ann", headRefOid: "def", reviews: [review] }] })

    expect(pullAlerts(before, after)).toEqual([
      { kind: "newCommits", text: "↻ #5 Pull request 5 — new commits since your review" }
    ])
  })
})

describe("alertLines", () => {
  const APPROVED_AND_COMMENTED = {
    before: { mine: [{ number: 1, title: "Fix the menu", comments: { count: 0 } }] },
    after: {
      mine: [
        {
          number: 1,
          title: "Fix the menu",
          reviews: [{ login: "ann", state: "APPROVED", at: LATER }],
          comments: { count: 1, lastAuthor: "ann" }
        }
      ]
    }
  } satisfies { before: ResponseFixture; after: ResponseFixture }
  const ALL = ["comments", "reviews", "ci", "conflicts", "reviewRequests", "newCommits", "closed"] as const

  test("one line per pull request, its changes in turn", () => {
    const { before, after } = APPROVED_AND_COMMENTED
    const requested = snapshotOf({ ...after, requested: [{ number: 5, title: "Legend", author: "bob" }] })

    expect(alertLines(changesBetween(snapshotOf(before), requested, ALL))).toEqual([
      "✓ #1 Fix the menu — approved by ann, new comment from ann",
      "⌕ #5 Legend (bob) — review requested"
    ])
  })

  test("a kind turned off leaves only the others on the line", () => {
    const { before, after } = APPROVED_AND_COMMENTED

    expect(alertLines(changesBetween(snapshotOf(before), snapshotOf(after), ["reviews"]))).toEqual([
      "✓ #1 Fix the menu — approved by ann"
    ])
    expect(alertLines(changesBetween(snapshotOf(before), snapshotOf(after), ["comments"]))).toEqual([
      "✎ #1 Fix the menu — new comment from ann"
    ])
    expect(changesBetween(snapshotOf(before), snapshotOf(after), [])).toEqual([])
  })
})

describe("ready to merge", () => {
  const ALL = [
    "ready",
    "comments",
    "reviews",
    "ci",
    "conflicts",
    "reviewRequests",
    "newCommits",
    "mentions",
    "closed"
  ] as const
  const approvedRunning = snapshotOf({
    mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "PENDING" }]
  })
  const ready = snapshotOf({ mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS" }] })

  test("said when it becomes ready, ahead of what led to it", () => {
    expect(alertLines(changesBetween(approvedRunning, ready, ALL))).toEqual(["✓ #1 Legend — ready to merge, CI passed"])
  })

  test("not again after GitHub rechecks mergeability, as it does after a push to the base", () => {
    const checking = carryKnownStates(
      ready,
      snapshotOf({
        mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS", mergeStateStatus: "UNKNOWN" }]
      })
    )

    expect(changesBetween(ready, checking, ALL)).toEqual([])
    expect(changesBetween(checking, carryKnownStates(checking, ready), ALL)).toEqual([])
    // Through any number of rechecks it is still known ready.
    const again = carryKnownStates(
      checking,
      snapshotOf({
        mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS", mergeStateStatus: "UNKNOWN" }]
      })
    )
    expect(changesBetween(again, carryKnownStates(again, ready), ALL)).toEqual([])
  })

  test("but said when it first becomes ready by way of a recheck, or after being blocked", () => {
    const checking = carryKnownStates(
      approvedRunning,
      snapshotOf({
        mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS", mergeStateStatus: "UNKNOWN" }]
      })
    )
    const blocked = snapshotOf({
      mine: [{ number: 1, title: "Legend", reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED" }]
    })

    expect(alertLines(changesBetween(checking, carryKnownStates(checking, ready), ["ready"]))).toEqual([
      "✓ #1 Legend — ready to merge"
    ])
    expect(alertLines(changesBetween(blocked, ready, ["ready"]))).toEqual(["✓ #1 Legend — ready to merge"])
  })

  test("not for one first seen while GitHub rechecks it, as no first sight is news", () => {
    const other = { number: 2, title: "Tiles" }
    const before = snapshotOf({ mine: [other] })
    const checking = carryKnownStates(
      before,
      snapshotOf({
        mine: [
          other,
          { number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS", mergeStateStatus: "UNKNOWN" }
        ]
      })
    )
    const settled = snapshotOf({
      mine: [other, { number: 1, title: "Legend", reviewDecision: "APPROVED", ci: "SUCCESS" }]
    })

    expect(changesBetween(before, checking, ALL)).toEqual([])
    expect(changesBetween(checking, carryKnownStates(checking, settled), ALL)).toEqual([])
  })

  test("said once, and left out with its kind off", () => {
    expect(changesBetween(ready, ready, ALL)).toEqual([])
    expect(alertLines(changesBetween(approvedRunning, ready, ["ci"]))).toEqual(["✓ #1 Legend — CI passed"])
  })
})

describe("mentions", () => {
  const ALL = ["mentions"] as const

  test("someone else's pull request mentioning the viewer for the first time", () => {
    const before = snapshotOf({ mentioned: [{ number: 8, title: "Activity cards", author: "bob" }] })
    const after = snapshotOf({
      mentioned: [
        { number: 8, title: "Activity cards", author: "bob" },
        { number: 9, title: "Map tiles", author: "ann" }
      ]
    })

    expect(alertLines(changesBetween(before, after, ALL))).toEqual(["@ #9 Map tiles (ann) — you were mentioned"])
    expect(changesBetween(after, after, ALL)).toEqual([])
  })

  test("nothing while the search was cut short, as an old mention may only be coming back", () => {
    const before = snapshotOf({ mentioned: [{ number: 8 }], totals: { mentioned: 31 } })
    const after = snapshotOf({ mentioned: [{ number: 9 }], totals: { mentioned: 31 } })

    expect(changesBetween(before, after, ALL)).toEqual([])
  })
})

describe("merged in a stack", () => {
  const STACKED = { number: 30, size: 3 }
  const before = snapshotOf({
    mine: [
      // Another stack, its places overlapping, listed first.
      { number: 9, title: "Other work", stack: { number: 31, size: 3, position: 2 } },
      { number: 1, title: "Fix the menu", stack: { ...STACKED, position: 1 } },
      { number: 2, title: "Add a legend", stack: { ...STACKED, position: 2 } },
      { number: 3, title: "Use the legend", stack: { ...STACKED, position: 3 } }
    ]
  })
  // The lists as they are after a merge: those still open.
  const listedWithout = (...gone: number[]) => before.mine.filter((row) => !gone.includes(row.number))
  const left = (...numbers: number[]) => before.mine.filter((row) => numbers.includes(row.number))
  const state = (number: number, merged: boolean) => ({
    number,
    state: merged ? ("MERGED" as const) : ("CLOSED" as const),
    by: "ann",
    head: null,
    branch: null,
    isCrossRepository: false,
    headRepo: null
  })

  test("a merged one names the one above it in its own stack as next", () => {
    expect(alertLines(closedAlerts(left(1), [state(1, true)], "me", listedWithout(1)))).toEqual([
      "✓ #1 Fix the menu — merged by ann, #2 is next in stack #30"
    ])
  })

  test("a closed one, the top one, or one whose next merged too names none", () => {
    expect(alertLines(closedAlerts(left(1), [state(1, false)], "me", listedWithout(1)))).toEqual([
      "✕ #1 Fix the menu — closed by ann"
    ])
    expect(alertLines(closedAlerts(left(3), [state(3, true)], "me", listedWithout(3)))).toEqual([
      "✓ #3 Use the legend — merged by ann"
    ])
    expect(alertLines(closedAlerts(left(1, 2), [state(1, true), state(2, true)], "me", listedWithout(1, 2)))).toEqual([
      "✓ #1 Fix the menu — merged by ann",
      "✓ #2 Add a legend — merged by ann, #3 is next in stack #30"
    ])
  })
})

describe("merged and closed", () => {
  const before = snapshotOf({
    mine: [
      { number: 1, title: "Fix the menu" },
      { number: 2, title: "Add a legend" }
    ],
    requested: [{ number: 5, title: "Usage chart", author: "ann" }]
  })
  const after = snapshotOf({ mine: [{ number: 2, title: "Add a legend" }] })

  test("the pull requests that left the lists", () => {
    expect(vanishedPulls(before, after).map((row) => row.number)).toEqual([1, 5])
    expect(vanishedPulls(null, after)).toEqual([])
  })

  test("merged or closed by someone else is news; by the viewer, or still open, is not", () => {
    const gone = vanishedPulls(before, after)
    const lines = (states: Parameters<typeof closedAlerts>[1]): string[] =>
      alertLines(closedAlerts(gone, states, "me", []))

    expect(
      lines([
        { number: 1, state: "MERGED", by: "ann", head: null, branch: null, isCrossRepository: false, headRepo: null },
        { number: 5, state: "CLOSED", by: "ann", head: null, branch: null, isCrossRepository: false, headRepo: null }
      ])
    ).toEqual(["✓ #1 Fix the menu — merged by ann", "✕ #5 Usage chart — closed by ann"])
    expect(
      lines([
        { number: 1, state: "CLOSED", by: null, head: null, branch: null, isCrossRepository: false, headRepo: null }
      ])
    ).toEqual(["✕ #1 Fix the menu — closed"])
    expect(
      lines([
        { number: 1, state: "MERGED", by: "me", head: null, branch: null, isCrossRepository: false, headRepo: null },
        { number: 5, state: "OPEN", by: null, head: null, branch: null, isCrossRepository: false, headRepo: null }
      ])
    ).toEqual([])
    expect(lines([])).toEqual([])
  })

  test("an auto-merge the viewer turned on is news when GitHub merges it, credited to them", () => {
    const gone = [snapshotOf({ mine: [{ number: 1, title: "Fix the menu", isAutoMergeOn: true }] }).mine[0]!]
    const merged = (by: string) => [
      { number: 1, state: "MERGED" as const, by, head: null, branch: null, isCrossRepository: false, headRepo: null }
    ]

    expect(alertLines(closedAlerts(gone, merged("me"), "me", []))).toEqual(["✓ #1 Fix the menu — merged by auto-merge"])
    // Merged by hand, the viewer's own merge is no news.
    const byHand = [snapshotOf({ mine: [{ number: 1, title: "Fix the menu" }] }).mine[0]!]
    expect(closedAlerts(byHand, merged("me"), "me", [])).toEqual([])
  })

  test("a merge the queue made is news, whoever GitHub credits it to", () => {
    const gone = [snapshotOf({ mine: [{ number: 1, title: "Fix the menu", isInMergeQueue: true }] }).mine[0]!]
    const merged = (by: string) => [
      { number: 1, state: "MERGED" as const, by, head: null, branch: null, isCrossRepository: false, headRepo: null }
    ]

    for (const by of ["me", "github-merge-queue"]) {
      expect(alertLines(closedAlerts(gone, merged(by), "me", []))).toEqual([
        "✓ #1 Fix the menu — merged from the merge queue"
      ])
    }
  })

  test("listed with the other changes, and left out with their kind off", () => {
    const closed = closedAlerts(
      vanishedPulls(before, after),
      [{ number: 1, state: "MERGED", by: "ann", head: null, branch: null, isCrossRepository: false, headRepo: null }],
      "me",
      []
    )

    expect(alertLines(changesBetween(before, after, ["closed"], closed))).toEqual(["✓ #1 Fix the menu — merged by ann"])
    expect(changesBetween(before, after, ["comments"], closed)).toEqual([])
  })
})

describe("activityOf", () => {
  test("one entry per pull request, with the window the changes happened in", () => {
    expect(
      activityOf(
        [
          alertOf(1, "approved by ann", { symbol: "✓" }),
          alertOf(1, "new comment from ann"),
          alertOf(2, "CI failed", { symbol: "✗" })
        ],
        10,
        20
      )
    ).toEqual([
      { number: 1, symbol: "✓", events: ["approved by ann", "new comment from ann"], since: 10, at: 20 },
      { number: 2, symbol: "✗", events: ["CI failed"], since: 10, at: 20 }
    ])
  })

  test("one that merged or closed keeps its title, as it has no row to be noted on", () => {
    expect(activityOf([alertOf(3, "merged by ann", { kind: "closed", symbol: "✓", title: "Legend" })], 10, 20)).toEqual(
      [{ number: 3, symbol: "✓", events: ["merged by ann"], since: 10, at: 20, ended: { title: "Legend" } }]
    )
  })
})

describe("noteEvents", () => {
  const note = (events: string[]): Activity => ({ number: 1, symbol: "✎", events, since: 0, at: 1 })

  test("the changes of a row's notes in order", () => {
    expect(noteEvents([note(["approved by ann", "CI passed"]), note(["new comment from bob"])])).toEqual([
      "approved by ann",
      "CI passed",
      "new comment from bob"
    ])
    expect(noteEvents([])).toEqual([])
  })

  test("a change noticed again is said once, where it came last, with how many times it came", () => {
    const notes = [
      note(["reviewed by eve"]),
      note(["CI failed"]),
      note(["reviewed by eve"]),
      note(["reviewed by eve", "CI passed"])
    ]

    expect(noteEvents(notes)).toEqual(["CI failed", "reviewed by eve\u00a0×3", "CI passed"])
  })
})

describe("activityAfter", () => {
  const before = { ...snapshotOf({ mine: [{ number: 1 }] }), fetchedAt: 100 * MINUTE }
  const after = { ...snapshotOf({ mine: [{ number: 1 }] }), fetchedAt: 130 * MINUTE }

  test("keeps the notes still recent, then adds what this refresh noticed, one that merged or closed too", () => {
    const kept = [
      { number: 5, symbol: "✓", events: ["approved"], since: 0, at: 99 * MINUTE },
      // Exactly as old as the setting allows: it goes.
      { number: 4, symbol: "✓", events: ["approved"], since: 0, at: 100 * MINUTE },
      { number: 6, symbol: "✗", events: ["CI failed"], since: 0, at: 101 * MINUTE }
    ]

    expect(
      activityAfter(
        kept,
        [alertOf(1, "new comment"), alertOf(2, "merged", { kind: "closed" })],
        before,
        after,
        30 * MINUTE
      )
    ).toEqual([
      { number: 6, symbol: "✗", events: ["CI failed"], since: 0, at: 101 * MINUTE },
      { number: 1, symbol: "✎", events: ["new comment"], since: 100 * MINUTE, at: 130 * MINUTE },
      {
        number: 2,
        symbol: "✎",
        events: ["merged"],
        since: 100 * MINUTE,
        at: 130 * MINUTE,
        ended: { title: "Pull request 2" }
      }
    ])
  })

  test("a first load notices nothing, and only the newest hundred notes are kept", () => {
    const kept = Array.from({ length: 120 }, (_, index) => ({
      number: index,
      symbol: "✎",
      events: ["new comment"],
      since: 0,
      at: after.fetchedAt
    }))

    expect(activityAfter([], [alertOf(1, "new comment")], null, after, 30 * MINUTE)).toEqual([])
    expect(activityAfter(kept, [], before, after, 30 * MINUTE).map((entry) => entry.number)).toEqual(
      kept.slice(20).map((entry) => entry.number)
    )
  })
})

describe("refreshAlerts", () => {
  const before = { ...snapshotOf({ mine: [{ number: 1 }] }), fetchedAt: Date.parse("2026-10-01T09:00:00Z") }
  const after = { ...snapshotOf({ mine: [{ number: 1 }] }), fetchedAt: Date.parse("2026-10-01T11:00:00Z") }
  const changes = [alertOf(1, "new comment"), alertOf(1, "approved"), alertOf(2, "new comment")]
  const KIND = { isReturning: false, isAlerting: false, isListShown: false }

  test("coming back, one line counts the pull requests that changed, unless the pane lists them", () => {
    const away = [{ kind: "line", repo: REPO, line: awayLine(2, lookedAt(before.fetchedAt, after.fetchedAt)) }]

    expect(refreshAlerts(changes, before, after, { ...KIND, isReturning: true }, REPO)).toEqual(away)
    expect(refreshAlerts(changes, before, after, { ...KIND, isReturning: true, isAlerting: true }, REPO)).toEqual(away)
    expect(refreshAlerts(changes, before, after, { ...KIND, isReturning: true, isListShown: true }, REPO)).toBe(null)
    expect(refreshAlerts([], before, after, { ...KIND, isReturning: true }, REPO)).toBe(null)
    expect(refreshAlerts(changes, null, after, { ...KIND, isReturning: true }, REPO)).toBe(null)
  })

  test("a refresh nobody asked for has a batch per pull request; even none lets held alerts through", () => {
    const batches = refreshAlerts(changes, before, after, { ...KIND, isAlerting: true }, REPO)

    expect(batches).toEqual([
      { kind: "events", from: "list", repo: REPO, events: [changes[0], changes[1]] },
      { kind: "events", from: "list", repo: REPO, events: [changes[2]] }
    ])
    expect(batches!.flatMap((batch) => (batch.kind === "events" ? alertLines(batch.events) : []))).toEqual([
      "✎ #1 Pull request 1 — new comment, approved",
      "✎ #2 Pull request 2 — new comment"
    ])
    expect(refreshAlerts([], before, after, { ...KIND, isAlerting: true }, REPO)).toEqual([])
  })

  test("a refresh the person asked for announces nothing", () => {
    expect(refreshAlerts(changes, before, after, KIND, REPO)).toBe(null)
    expect(refreshAlerts(changes, before, after, { ...KIND, isListShown: true }, REPO)).toBe(null)
  })
})

describe("sinceLastLook", () => {
  const ALL = ["comments", "reviews", "ci", "conflicts", "reviewRequests", "newCommits"] as const
  const MORNING = new Date(2026, 9, 7, 9, 5).getTime()

  test("the changes since the last look, with when it was", () => {
    const before = { ...snapshotOf({ mine: [{ number: 1, ci: "PENDING" }] }), fetchedAt: MORNING }
    const after = { ...snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] }), fetchedAt: MORNING + 3_600_000 }

    const since = sinceLastLook(before, after, ALL)

    expect(since?.at).toBe("09:05")
    expect(alertLines(since?.changes ?? [])).toEqual(["✗ #1 Pull request 1 — CI failed"])
    expect(sinceLastLook(before, { ...before, fetchedAt: MORNING + 60_000 }, ALL)).toEqual({ at: "09:05", changes: [] })
  })

  test("only the kinds turned on, and none at all with the alerts off", () => {
    const before = snapshotOf({ mine: [{ number: 1, ci: "PENDING" }] })
    const after = snapshotOf({ mine: [{ number: 1, ci: "FAILURE" }] })

    expect(sinceLastLook(before, after, ["comments"])?.changes).toEqual([])
    expect(sinceLastLook(before, after, [])).toBe(null)
  })

  test("nothing to compare with: no look yet, or one by another account", () => {
    const after = snapshotOf({ mine: [{ number: 1 }] })

    expect(sinceLastLook(null, after, ALL)).toBe(null)
    expect(sinceLastLook({ ...after, viewer: "someone-else" }, after, ALL)).toBe(null)
  })
})

describe("listText", () => {
  const snapshot = snapshotOf({
    mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE", requested: ["ann"] }],
    requested: [{ number: 5, title: "Use `|` in *titles*", author: "bob" }]
  })
  const LINKS = {
    pulls: "https://github.com/acme/app/pulls",
    pull: (number: number) => `https://github.com/acme/app/pull/${number}`
  }
  const change: Alert = {
    kind: "ci",
    number: 1,
    title: "Fix the menu",
    by: null,
    symbol: "✗",
    event: "CI failed"
  }

  test("a table per list, each number a link to its pull request", () => {
    expect(listText(snapshot, null, LINKS)).toBe(
      [
        // The pane header's counts and time.
        `**[acme/app](https://github.com/acme/app/pulls)** · ❗ **1** · 🔍 **1** · updated ${clockTime(0)}`,
        "",
        "**Your Pull Requests** (1)",
        "",
        "| Pull request | Status | Details |",
        "| --- | --- | --- |",
        "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ❗ [CI Failing](https://github.com/acme/app/pull/1/checks) | requested: ann |",
        "",
        "**Waiting On Your Review** (1)",
        "",
        "| Pull request | Status | Details |",
        "| --- | --- | --- |",
        "| [#5](https://github.com/acme/app/pull/5) Use \\`\\|\\` in \\*titles\\* | 🔍 Review Requested | by bob · [CI ✓](https://github.com/acme/app/pull/5/checks) |"
      ].join("\n")
    )
  })

  test("a list cut short ends with a link to the rest on GitHub", () => {
    const cut = { ...snapshot, isCut: { mine: false, review: true, requested: false } }

    expect(listText(cut, null, LINKS).split("\n").slice(-2)).toEqual([
      "",
      "_Only the most recently updated are listed._ [More on GitHub](https://github.com/acme/app/pulls?q=is%3Apr%20is%3Aopen%20involves%3A%40me%20-author%3A%40me)"
    ])
  })

  test("a detail is escaped as a title is: a managed user's login keeps its underscore", () => {
    const approved = snapshotOf({
      mine: [{ number: 3, title: "Legend", reviews: [{ login: "ann_acme", state: "APPROVED", at: AT }] }]
    })

    expect(listText(approved, null, LINKS)).toContain("approved: ann\\_acme")
  })

  test("a list from another day says the day in its heading, as the pane's header does", () => {
    const at = new Date(2026, 9, 12, 17, 40).getTime()
    const list = { ...snapshotOf({}), fetchedAt: at }
    const heading = (now: number) => listText(list, null, null, null, now).split("\n")[0]

    expect(heading(at + 60_000)).toBe("**acme/app** · updated 17:40")
    expect(heading(new Date(2026, 9, 13, 9, 0).getTime())).toBe("**acme/app** · updated yesterday 17:40")
    expect(heading(new Date(2026, 9, 20, 9, 0).getTime())).toBe("**acme/app** · updated 12 Oct 17:40")
  })

  test("an empty list says so on one line, and two say so as the pane does", () => {
    expect(listText(snapshotOf({ requested: [{ number: 5, author: "bob" }] }), null, LINKS).split("\n")[2]).toBe(
      "**Your Pull Requests** (0) — _No open pull requests of yours here._"
    )
    expect(listText(snapshotOf({}), null, LINKS).split("\n")).toEqual([
      `**[acme/app](https://github.com/acme/app/pulls)** · updated ${clockTime(0)}`,
      "",
      "_Nothing open and nothing waiting on you._"
    ])
  })

  test("led by the changes since the last look, linked, or by saying there are none", () => {
    expect(
      listText(snapshot, { at: "09:05", changes: [change] }, LINKS)
        .split("\n")
        .slice(0, 8)
    ).toEqual([
      `**[acme/app](https://github.com/acme/app/pulls)** · ❗ **1** · 🔍 **1** · updated ${clockTime(0)}`,
      "",
      "**Since You Last Looked** (09:05)",
      "",
      "| Pull request | What changed |",
      "| --- | --- |",
      "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ✗ CI failed |",
      ""
    ])
    expect(listText(snapshot, { at: "09:05", changes: [] }).split("\n").slice(0, 4)).toEqual([
      `**acme/app** · ❗ **1** · 🔍 **1** · updated ${clockTime(0)}`,
      "",
      "_Nothing new since 09:05_",
      ""
    ])
  })
})

describe("alertLine", () => {
  test("a symbol, the number, the title and what happened", () => {
    expect(alertLine("✎", { number: 7, title: "Fix the menu" }, "new comment from ann")).toBe(
      "✎ #7 Fix the menu — new comment from ann"
    )
  })

  test("a long title is cut at a word within 40 characters", () => {
    const title = "Feature: Settings page - move every section to the new layout"

    expect(alertLine("✓", { number: 7, title }, "CI passed")).toBe(
      "✓ #7 Feature: Settings page - move every… — CI passed"
    )
    expect(alertLine("✓", { number: 7, title: "x".repeat(50) }, "CI passed")).toBe(
      `✓ #7 ${"x".repeat(39)}… — CI passed`
    )
  })

  test("a cut never splits a flag, or emoji joined into one", () => {
    expect(alertLine("✓", { number: 7, title: `${"x".repeat(38)}🇨🇿🇨🇿🇨🇿` }, "CI passed")).toBe(
      `✓ #7 ${"x".repeat(38)}🇨🇿… — CI passed`
    )
    expect(alertLine("✓", { number: 7, title: `${"x".repeat(38)}👩‍👩‍👧👩‍👩‍👧👩‍👩‍👧` }, "CI passed")).toBe(
      `✓ #7 ${"x".repeat(38)}👩‍👩‍👧… — CI passed`
    )
  })

  test("a cut never splits an emoji", () => {
    expect(alertLine("✓", { number: 7, title: `${"x".repeat(38)}🚀🚀🚀` }, "CI passed")).toBe(
      `✓ #7 ${"x".repeat(38)}🚀… — CI passed`
    )
  })
})

describe("toastsFor", () => {
  // This folder's lines, which its pane lists; and another repository's, which no list here shows.
  const own = (...texts: string[]) => texts.map((text) => ({ text, elsewhere: null }))
  const of = (repo: string, ...texts: string[]) => texts.map((text) => ({ text, elsewhere: repo }))

  test("up to three alerts show as they are", () => {
    expect(toastsFor([])).toEqual([])
    expect(toastsFor(own("a", "b", "c"))).toEqual(["a", "b", "c"])
  })

  test("more than three keep to three toasts, the last counting the rest", () => {
    expect(toastsFor(own("a", "b", "c", "d"))).toEqual(["a", "b", "2 more pull request changes, see /prs"])
    expect(toastsFor(own("a", "b", "c", "d", "e", "f"))).toEqual(["a", "b", "4 more pull request changes, see /prs"])
  })

  test("other repositories' changes counted among the rest are named, as /prs lists only this folder's", () => {
    expect(toastsFor([...own("a", "b"), ...of("acme/ios", "c"), ...of("acme/admin", "d")])).toEqual([
      "a",
      "b",
      "2 more changes in acme/admin, acme/ios"
    ])
    expect(toastsFor([...own("a", "b", "c"), ...of("acme/ios", "d", "e")])).toEqual([
      "a",
      "b",
      "1 more pull request change, see /prs; 2 more in acme/ios"
    ])
  })
})

describe("hidden drafts in the printed list", () => {
  test("said under your own list, empty or not", () => {
    const withRows = { ...snapshotOf({ mine: [{ number: 1 }] }), hiddenDrafts: 2 }
    const empty = { ...snapshotOf({}), hiddenDrafts: 1 }

    expect(listText(withRows).split("\n")).toContain("_2 drafts hidden_")
    // Drafts are open pull requests of yours: an empty list says they are hidden, not that there are none.
    expect(listText(empty).split("\n")).toContain("**Your Pull Requests** (0) — _1 draft hidden_")
    expect(listText(snapshotOf({ mine: [{ number: 1 }] }))).not.toContain("hidden")
  })
})

describe("summaryText", () => {
  test("names only the counts there are", () => {
    expect(summaryText({ ready: 1, needsYou: 2, toReview: 1 })).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 2 Need You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
    expect(summaryText({ ready: 0, needsYou: 0, toReview: 3 })).toBe("PRs 🔍 3 To Review\u00a0\u00a0(/prs)")
    expect(summaryText({ ready: 0, needsYou: 0, toReview: 0 })).toBe(undefined)
  })
})

describe("statusSummary", () => {
  test("counts what is ready, what needs the viewer and what waits on a review", () => {
    const snapshot = snapshotOf({
      mine: [
        { number: 1, reviewDecision: "APPROVED" },
        { number: 2, ci: "FAILURE" },
        { number: 3, reviewDecision: "CHANGES_REQUESTED" },
        { number: 4, requested: ["ann"] }
      ],
      requested: [{ number: 5, author: "ann" }],
      commented: [{ number: 6, author: "bob" }]
    })

    expect(statusSummary(snapshot)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 2 Need You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
  })

  test("open review comments on an unapproved pull request need the viewer", () => {
    const snapshot = snapshotOf({
      mine: [
        {
          number: 4,
          requested: ["ann"],
          reviews: [{ login: "bob", state: "COMMENTED", at: "2026-10-07T09:00:00Z" }],
          threads: [{ isResolved: false }]
        }
      ]
    })

    expect(statusSummary(snapshot)).toBe("PRs ❗ 1 Needs You\u00a0\u00a0(/prs)")
  })

  test("waiting on reviewers needs nobody: asked to re-review, or approved by fewer than required", () => {
    const snapshot = snapshotOf({
      mine: [
        {
          number: 1,
          reviews: [{ login: "bob", state: "CHANGES_REQUESTED", at: "2026-10-07T09:00:00Z" }],
          requested: ["bob"]
        },
        {
          number: 2,
          reviewDecision: "REVIEW_REQUIRED",
          mergeStateStatus: "BLOCKED",
          reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-07T09:00:00Z" }]
        }
      ]
    })

    expect(statusSummary(snapshot)).toBe(undefined)
  })

  test("one that needs the viewer reads in the singular", () => {
    expect(statusSummary(snapshotOf({ mine: [{ number: 2, ci: "FAILURE" }] }))).toBe(
      "PRs ❗ 1 Needs You\u00a0\u00a0(/prs)"
    )
  })

  test("nothing to report clears the line", () => {
    expect(
      statusSummary(
        snapshotOf({ mine: [{ number: 4, requested: ["ann"] }], commented: [{ number: 6, author: "bob" }] })
      )
    ).toBe(undefined)
  })
})

describe("holdAlerts", () => {
  const NONE = { held: [], heldSince: null }
  const [A, B, C] = ["a", "b", "c"].map((text) => ({ kind: "line" as const, repo: REPO, line: text }))

  test("while holding, batches wait from when the first did; with none, nothing changes", () => {
    const first = holdAlerts(NONE, [A!], 10 * MINUTE, true)
    expect(first).toEqual({ shown: [], waiting: { held: [A], heldSince: 10 * MINUTE } })

    const second = holdAlerts(first.waiting, [B!, C!], 12 * MINUTE, true)
    expect(second).toEqual({ shown: [], waiting: { held: [A, B, C], heldSince: 10 * MINUTE } })

    expect(holdAlerts(second.waiting, [], 13 * MINUTE, true)).toEqual({ shown: [], waiting: second.waiting })
    expect(holdAlerts(NONE, [], 13 * MINUTE, true)).toEqual({ shown: [], waiting: NONE })
  })

  test("not holding, everything waiting shows with the new batches, and holding starts over", () => {
    expect(holdAlerts({ held: [A!], heldSince: 10 * MINUTE }, [B!], 11 * MINUTE, false)).toEqual({
      shown: [A, B],
      waiting: NONE
    })
    expect(holdAlerts(NONE, [], 11 * MINUTE, false)).toEqual({ shown: [], waiting: NONE })
  })

  test("held five minutes, they show even while the turn still runs", () => {
    const waiting = { held: [A!], heldSince: 10 * MINUTE }

    expect(holdAlerts(waiting, [B!], 14 * MINUTE, true)).toEqual({
      shown: [],
      waiting: { held: [A, B], heldSince: 10 * MINUTE }
    })
    expect(holdAlerts(waiting, [B!], 15 * MINUTE, true)).toEqual({ shown: [A, B], waiting: NONE })
  })
})

describe("readHeld", () => {
  test("1.4.0's held lines, and 1.2.0's with no changes kept, carry over as lines of no repository", () => {
    expect(readHeld({ held: ["#7 merged"], heldSince: 5, changes: ["#7 merged"] })).toEqual({
      held: [{ kind: "line", repo: null, line: "#7 merged" }],
      heldSince: 5
    })
    expect(readHeld({ held: ["summary"], heldSince: 5 })).toEqual({
      held: [{ kind: "line", repo: null, line: "summary" }],
      heldSince: 5
    })
  })

  test("batches held by this version carry over, one that says not when it was raised as raised as the hold began", () => {
    const held = { held: [{ kind: "line", repo: REPO, line: "a", raisedAt: 7 }], heldSince: 5 }

    expect(readHeld(held)).toEqual(held)
    expect(readHeld({ held: [{ kind: "line", repo: REPO, line: "a" }], heldSince: 5 })).toEqual({
      held: [{ kind: "line", repo: REPO, line: "a", raisedAt: 5 }],
      heldSince: 5
    })
    expect(readHeld(null)).toEqual({ held: [], heldSince: null })
    expect(
      readHeld({
        held: [7, { kind: "events", repo: REPO }, { kind: "events", repo: REPO, events: [] }],
        heldSince: "now"
      })
    ).toEqual({
      held: [],
      heldSince: null
    })
  })
})

describe("freshAlerts", () => {
  // Shown by session "one" at 100 minutes; a batch raised then unless it says when (`raisedAt`).
  const SHOWN = { by: "one", at: 100 * MINUTE, pollMs: 3 * MINUTE }
  const OTHER = { host: "github.com", name: "acme/web" }
  const events = (number: number, ...texts: string[]) => ({
    kind: "events" as const,
    from: "list" as const,
    repo: REPO,
    events: texts.map((text) => alertOf(number, text))
  })
  const line = (text: string) => ({ kind: "line" as const, repo: REPO, line: text })

  test("the first session to show an event marks it; another leaves it out, while its own repeat", () => {
    const first = freshAlerts(undefined, [events(1, "new comment", "approved"), line("summary")], SHOWN)
    expect(first).toEqual({
      fresh: [events(1, "new comment", "approved"), line("summary")],
      marks: {
        "github.com/acme/app#1 new comment": { at: 100 * MINUTE, by: "one" },
        "github.com/acme/app#1 approved": { at: 100 * MINUTE, by: "one" },
        "github.com/acme/app summary": { at: 100 * MINUTE, by: "one" }
      }
    })

    // Another session tells the same change grouped otherwise: only what wasn't told shows.
    const other = freshAlerts(first.marks, [events(1, "approved", "CI failing"), events(2, "new comment")], {
      ...SHOWN,
      by: "two",
      at: 101 * MINUTE
    })
    expect(other.fresh).toEqual([events(1, "CI failing"), events(2, "new comment")])
    expect(other.marks["github.com/acme/app#1 approved"]).toEqual({ at: 100 * MINUTE, by: "one" })

    expect(freshAlerts(first.marks, [events(1, "approved")], { ...SHOWN, at: 101 * MINUTE }).fresh).toEqual([
      events(1, "approved")
    ])
  })

  test("a batch whose every event was shown elsewhere goes; a line's mark is 1.4.0's", () => {
    const marks = {
      "github.com/acme/app#1 approved": { at: 100 * MINUTE, by: "two" },
      "github.com/acme/app summary": { at: 100 * MINUTE, by: "two" }
    }

    expect(freshAlerts(marks, [events(1, "approved"), line("summary"), line("note")], SHOWN).fresh).toEqual([
      line("note")
    ])
  })

  test("the same number in another repository is another pull request", () => {
    const marks = { "github.com/acme/app#1 approved": { at: 100 * MINUTE, by: "two" } }
    const elsewhere = { ...events(1, "approved"), repo: OTHER }

    expect(freshAlerts(marks, [elsewhere], SHOWN).fresh).toEqual([elsewhere])
  })

  test("a mark lasts ten minutes, or two refreshes where they are further apart", () => {
    const marks = { "github.com/acme/app#1 a": { at: 100 * MINUTE, by: "one" } }
    const asked = (at: number, pollMs: number) =>
      freshAlerts(marks, [events(1, "a")], { ...SHOWN, by: "two", at, pollMs }).fresh.length

    expect(asked(109 * MINUTE, 3 * MINUTE)).toBe(0)
    expect(asked(110 * MINUTE, 3 * MINUTE)).toBe(1)
    expect(asked(139 * MINUTE, 20 * MINUTE)).toBe(0)
    expect(asked(140 * MINUTE, 20 * MINUTE)).toBe(1)
  })

  test("held for a long turn, an event leaves out what another session showed since it was raised", () => {
    const marks = { "github.com/acme/app#1 a": { at: 101 * MINUTE, by: "two" } }
    const raised = { ...events(1, "a"), raisedAt: 100 * MINUTE }

    // Raised at 100, shown at 114 as the turn ends: the other session's mark is 13 minutes old, and still counts.
    expect(freshAlerts(marks, [raised], { ...SHOWN, at: 114 * MINUTE }).fresh).toEqual([])
    // Raised and shown at 114, a mark that old doesn't.
    expect(freshAlerts(marks, [events(1, "a")], { ...SHOWN, at: 114 * MINUTE }).fresh).toHaveLength(1)
  })

  test("in one long hold, each event is weighed from when it was raised: a later repeat of one shown elsewhere shows", () => {
    // Another session showed CI failing at 101; this one held it, then CI passing at 109 and failing again at 112.
    const marks = { "github.com/acme/app#1 CI failing": { at: 101 * MINUTE, by: "two" } }
    const held = [
      { ...events(1, "CI failing"), raisedAt: 101 * MINUTE },
      { ...events(1, "CI passing"), raisedAt: 109 * MINUTE },
      { ...events(1, "CI failing"), raisedAt: 112 * MINUTE }
    ]

    expect(freshAlerts(marks, held, { ...SHOWN, at: 114 * MINUTE }).fresh).toEqual(held.slice(1))
  })

  test("a mark is kept as long as an alert may wait for a turn and then count", () => {
    const marks = { "github.com/acme/app#1 a": { at: 100 * MINUTE, by: "two" } }
    const kept = (at: number) => Object.keys(freshAlerts(marks, [], { ...SHOWN, at }).marks).length

    expect(kept(114 * MINUTE)).toBe(1)
    expect(kept(116 * MINUTE)).toBe(0)
  })

  test("a line of no repository is never marked; anything malformed in the store is no mark", () => {
    const stored = {
      "github.com/acme/app#1 a": { at: "now", by: "two" },
      "github.com/acme/app summary": null
    }
    const unknown = { kind: "line" as const, repo: null, line: "summary" }

    expect(freshAlerts(stored, [events(1, "a"), line("summary")], SHOWN).fresh).toEqual([
      events(1, "a"),
      line("summary")
    ])
    expect(freshAlerts("not a record", [events(1, "a")], SHOWN).fresh).toEqual([events(1, "a")])
    const once = freshAlerts(undefined, [unknown], SHOWN)
    expect(once).toEqual({ fresh: [unknown], marks: {} })
  })
})
