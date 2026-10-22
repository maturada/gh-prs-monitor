// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { PullRow } from "../types"
import { demoAnswer } from "./demo"
import { entryNumber, ownEntries } from "./list"
import { DEFAULTS, rawPull, response, snapshotOf } from "./testing/fixtures"
import type { Fragment, PullFixture, ResponseFixture } from "./testing/fixtures"
import {
  isOnBranch,
  noAccessProblem,
  pullOnBranch,
  pullsQuery,
  isStackless,
  pullSearches,
  readPulls,
  rowOf,
  SNAPSHOT_SCHEMA,
  stackText,
  storedSnapshot,
  withoutMerged
} from "./pulls"
import { ago, elapsed } from "./when"
import { prBranch } from "./worktrees"

function mine(pull: Omit<PullFixture, "number">, options = DEFAULTS): PullRow {
  const row = snapshotOf({ mine: [{ number: 1, ...pull }] }, options).mine[0]
  if (!row) {
    throw new Error("expected one row")
  }

  return row
}

function texts(row: PullRow): string[] {
  return row.details.map((detail) => detail.text)
}

// A base that requires a review: GitHub's decision until one approves, the merge blocked meanwhile.
const REVIEW_REQUIRED = { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" }

// GitHub's answer with errors beside its data.
function withErrors(json: string, errors: unknown[]): string {
  return JSON.stringify({ ...(JSON.parse(json) as object), errors })
}

describe("review ages", () => {
  const NOW = Date.parse("2026-10-07T14:00:00Z")

  function rowAt(pull: Omit<PullFixture, "number">): PullRow {
    const result = readPulls(response({ mine: [{ number: 1, ...pull }] }), "acme/app", NOW, DEFAULTS)
    if (!("snapshot" in result) || !result.snapshot.mine[0]) {
      throw new Error("expected one row")
    }

    return result.snapshot.mine[0]
  }

  test("each review detail says how long ago its latest review came", () => {
    const row = rowAt({
      reviews: [
        { login: "ann", state: "APPROVED", at: "2026-10-07T11:00:00Z" },
        { login: "bob", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z" },
        { login: "cid", state: "COMMENTED", at: "2026-10-04T09:00:00Z" },
        { login: "dee", state: "COMMENTED", at: "2026-10-06T10:00:00Z" }
      ]
    })

    expect(texts(row)).toEqual([
      "CI ✓",
      "approved: ann 3h ago",
      "changes requested: bob 40m ago",
      "reviewed: cid, dee 1d ago"
    ])
  })

  test("a review without a time leaves the others to say when", () => {
    const row = rowAt({
      verdicts: [
        { login: "ann", state: "APPROVED", at: "2026-10-07T11:00:00Z" },
        { login: "bob", state: "APPROVED" }
      ]
    })

    expect(texts(row)).toContain("approved: ann, bob 3h ago")
  })

  test("an approval's age is the approval's, not that of a comment after it", () => {
    const row = rowAt({
      reviews: [{ login: "ann", state: "COMMENTED", at: "2026-10-07T13:59:30Z" }],
      verdicts: [{ login: "ann", state: "APPROVED", at: "2026-10-05T14:00:00Z" }]
    })

    expect(texts(row)).toEqual(["CI ✓", "approved: ann 2d ago"])
  })

  test("someone else's pull request ages its approvals the same way", () => {
    const result = readPulls(
      response({
        requested: [
          {
            number: 5,
            author: "ann",
            reviews: [{ login: "bob", state: "APPROVED", at: "2026-10-07T13:00:00Z" }]
          }
        ]
      }),
      "acme/app",
      NOW,
      DEFAULTS
    )
    const row = "snapshot" in result ? result.snapshot.review[0] : undefined

    expect(row ? texts(row) : []).toContain("approved: bob 1h ago")
  })

  test("elapsed time is the same rounding without the words", () => {
    expect(elapsed(NOW - 30_000, NOW)).toBe("")
    expect(elapsed(NOW - 90 * 60_000, NOW)).toBe("1h")
    expect(elapsed(NOW - 15 * 3_600_000, NOW)).toBe("15h")
    expect(elapsed(NOW + 5 * 60_000, NOW)).toBe(null)
  })

  test("ages round down, and a time that cannot be placed says nothing", () => {
    expect(ago(NOW - 30_000, NOW)).toBe("just now")
    expect(ago(NOW + 30_000, NOW)).toBe("just now")
    expect(ago(NOW - 59 * 60_000, NOW)).toBe("59m ago")
    expect(ago(NOW - 60 * 60_000, NOW)).toBe("1h ago")
    expect(ago(NOW - 150_000, NOW)).toBe("2m ago")
    expect(ago(NOW - 90 * 60_000, NOW)).toBe("1h ago")
    expect(ago(NOW - 47 * 3_600_000, NOW)).toBe("1d ago")
    expect(ago(NOW + 5 * 60_000, NOW)).toBe(null)
    expect(ago(Number.NaN, NOW)).toBe(null)
  })
})

describe("hiding drafts", () => {
  test("left out of your own list when asked, and counted; drafts you are asked to review stay", () => {
    const fixture: ResponseFixture = {
      mine: [{ number: 1 }, { number: 2, isDraft: true }, { number: 3, isDraft: true }],
      requested: [{ number: 5, author: "ann", isDraft: true }]
    }
    const hidden = readPulls(response(fixture), "acme/app", 1_000, { ...DEFAULTS, isHidingDrafts: true })
    const shown = snapshotOf(fixture)

    expect("snapshot" in hidden && hidden.snapshot.mine.map((row) => row.number)).toEqual([1])
    expect("snapshot" in hidden && hidden.snapshot.hiddenDrafts).toBe(2)
    expect("snapshot" in hidden && hidden.snapshot.hiddenDraftNumbers).toEqual([2, 3])
    expect("snapshot" in hidden && hidden.snapshot.review.map((row) => row.number)).toEqual([5])
    expect(shown.mine.map((row) => row.number)).toEqual([1, 2, 3])
    expect(shown.hiddenDrafts).toBe(0)
    expect(shown.hiddenDraftNumbers).toEqual([])
  })
})

describe("pull request size", () => {
  test("a review row says how much the pull request changes, after its author; your own rows don't", () => {
    const snapshot = snapshotOf({
      mine: [{ number: 1, size: { additions: 5, deletions: 1, files: 1 } }],
      requested: [
        { number: 5, author: "ann", size: { additions: 120, deletions: 30, files: 8 } },
        { number: 6, author: "bob", size: { additions: 3, deletions: 0, files: 1 } }
      ]
    })
    const review = (number: number): string[] => {
      const row = snapshot.review.find((each) => each.number === number)
      return row ? texts(row) : []
    }

    expect(review(5)).toEqual(["by ann", "+120 −30, 8 files", "CI ✓"])
    expect(review(6)).toEqual(["by bob", "+3 −0, 1 file", "CI ✓"])
    expect(texts(snapshot.mine[0]!)).not.toContain("+5 −1, 1 file")
  })
})

describe("storedSnapshot", () => {
  test("a snapshot kept as plain data reads back", () => {
    const snapshot = snapshotOf({ mine: [{ number: 1 }] })

    expect(storedSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  test("anything else, a snapshot of another version included, is none", () => {
    expect(storedSnapshot(undefined)).toBe(null)
    expect(storedSnapshot("snapshot")).toBe(null)
    expect(storedSnapshot({ ...snapshotOf({ mine: [{ number: 1 }] }), schema: SNAPSHOT_SCHEMA - 1 })).toBe(null)
    expect(storedSnapshot({ schema: SNAPSHOT_SCHEMA, repo: "a/b", viewer: "me", fetchedAt: 0, mine: [] })).toBe(null)
    // Every part a drawing reads, the branches of pull requests that ended among them.
    expect(storedSnapshot({ ...snapshotOf({ mine: [{ number: 1 }] }), endedHeads: undefined })).toBe(null)
    expect(storedSnapshot({ ...snapshotOf({ mine: [{ number: 1 }] }), merging: null })).toBe(null)
  })

  test("one an earlier version kept, with no closed pull requests and its branches unnumbered, reads back", () => {
    const listed = snapshotOf({ mine: [{ number: 1 }] })
    const earlier = { ...listed, ownHeads: listed.ownHeads.map(({ branch, oid }) => ({ branch, oid })) }

    expect(earlier).not.toHaveProperty("endedPulls")
    expect(storedSnapshot(JSON.parse(JSON.stringify(earlier)))).toEqual(earlier)
  })
})

describe("pullSearches", () => {
  test("scopes every search to the repository's open pull requests, newest activity first", () => {
    expect(pullSearches("acme/app")).toEqual({
      mine: "repo:acme/app is:pr is:open sort:updated-desc author:@me",
      requested: "repo:acme/app is:pr is:open sort:updated-desc review-requested:@me",
      commented: "repo:acme/app is:pr is:open sort:updated-desc commenter:@me -author:@me",
      reviewed: "repo:acme/app is:pr is:open sort:updated-desc reviewed-by:@me -author:@me",
      mentioned: "repo:acme/app is:pr is:open sort:updated-desc mentions:@me -author:@me"
    })
  })
})

describe("readPulls problems", () => {
  test("a group GitHub left out is a problem, not an empty list", () => {
    const json = JSON.stringify({
      data: {
        viewer: { login: "me" },
        repository: { nameWithOwner: "acme/app" },
        mine: { nodes: [] },
        requested: null,
        commented: { nodes: [] },
        reviewed: { nodes: [] }
      },
      errors: [{ message: "Something went wrong while executing your query." }]
    })

    expect(readPulls(json, "acme/app", 0, DEFAULTS)).toEqual({
      problem: "Something went wrong while executing your query."
    })
    expect(readPulls(json.replace(/,"errors".*\]/, ""), "acme/app", 0, DEFAULTS)).toEqual({
      problem: "GitHub left part of the answer out."
    })
  })

  test("the mentions left out too, so a later full answer does not announce every old mention", () => {
    const json = JSON.stringify({
      data: {
        viewer: { login: "me" },
        repository: { nameWithOwner: "acme/app" },
        mine: { nodes: [] },
        requested: { nodes: [] },
        commented: { nodes: [] },
        reviewed: { nodes: [] },
        mentioned: null
      }
    })

    expect(readPulls(json, "acme/app", 0, DEFAULTS)).toEqual({
      problem: "GitHub left part of the answer out."
    })
  })

  test("a response that is not JSON", () => {
    expect(readPulls("gh: oops", "acme/app", 0, DEFAULTS)).toEqual({
      problem: "GitHub sent a response that could not be read."
    })
  })

  test("no data names GitHub's first error", () => {
    const json = JSON.stringify({ data: null, errors: [{ message: "Something broke" }] })

    expect(readPulls(json, "acme/app", 0, DEFAULTS)).toEqual({ problem: "Something broke" })
  })

  test("a repository the account cannot see", () => {
    expect(readPulls(response({ hasRepository: false }), "acme/app", 0, DEFAULTS)).toEqual({
      problem: noAccessProblem("acme/app")
    })
    const notFound = { type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository." }
    expect(readPulls(withErrors(response({ hasRepository: false }), [notFound]), "acme/app", 0, DEFAULTS)).toEqual({
      problem: noAccessProblem("acme/app")
    })
  })

  test("a repository GitHub answers under another name was renamed or moved; one differing in case alone was not", () => {
    expect(readPulls(response({ nameWithOwner: "acme/application" }), "acme/app", 0, DEFAULTS)).toEqual({
      movedTo: "acme/application"
    })
    expect("snapshot" in readPulls(response({ nameWithOwner: "Acme/App" }), "acme/app", 0, DEFAULTS)).toBe(true)
  })

  test("a repository an organization's single sign-on or IP allow list hides says what GitHub says to do", () => {
    const saml =
      "Resource protected by organization SAML enforcement. You must grant your token access to this organization."
    const errors = [{ type: "FORBIDDEN", path: ["repository"], extensions: { saml_failure: true }, message: saml }]

    expect(readPulls(withErrors(response({ hasRepository: false }), errors), "acme/app", 0, DEFAULTS)).toEqual({
      problem: saml
    })
  })

  test("a field GitHub failed to work out is part of the answer left out, as it would read as no CI or no threads", () => {
    const answer = response({ mine: [{ number: 1 }], requested: [{ number: 2 }] })
    const failed = { path: ["mine", "nodes", 0, "statusCheckRollup"], message: "Something went wrong." }

    expect(readPulls(withErrors(answer, [failed]), "acme/app", 0, DEFAULTS)).toEqual({
      problem: "Something went wrong."
    })
    expect(readPulls(withErrors(answer, [{ path: ["repository", "url"] }]), "acme/app", 0, DEFAULTS)).toEqual({
      problem: "GitHub left part of the answer out."
    })
  })

  test("a field the token may not read, or an error about no field the list reads, leaves the answer standing", () => {
    const answer = response({ mine: [{ number: 1 }], requested: [{ number: 2 }] })
    const errors = [
      { type: "FORBIDDEN", path: ["mine", "nodes", 0, "statusCheckRollup"], message: "Forbidden." },
      { type: "INSUFFICIENT_SCOPES", path: ["requested", "nodes", 0, "reviewRequests"], message: "Needs read:org." },
      { type: "NOT_FOUND", path: ["mine", "nodes", 0, "author"], message: "Not found." },
      { path: ["viewer", "login"], message: "Something went wrong." },
      { message: "A warning about no field." }
    ]
    const read = readPulls(answer, "acme/app", 0, DEFAULTS)

    expect("snapshot" in read).toBe(true)
    expect(readPulls(withErrors(answer, errors), "acme/app", 0, DEFAULTS)).toEqual(read)
  })

  test("an empty repository is a snapshot with no rows", () => {
    expect(snapshotOf({}, { at: 1_000 })).toEqual({
      schema: SNAPSHOT_SCHEMA,
      repo: "acme/app",
      viewer: "me",
      url: "https://github.com/acme/app",
      fetchedAt: 1_000,
      merging: {
        methods: ["MERGE", "SQUASH"],
        isAutoMergeAllowed: false,
        canWrite: true,
        canRequestReviews: true,
        isUpdateSuggested: false
      },
      isCut: { mine: false, review: false, requested: false },
      mentioned: { pulls: [], isCut: false },
      mine: [],
      review: [],
      hiddenDrafts: 0,
      hiddenDraftNumbers: [],
      defaultBranch: "main",
      ownHeads: [],
      endedHeads: []
    })
  })
})

describe("own pull request status", () => {
  test("a draft says so before anything else", () => {
    expect(mine({ isDraft: true, mergeable: "CONFLICTING", ci: "FAILURE" }).status).toEqual({
      text: "Draft",
      tone: "neutral"
    })
  })

  test("conflicts come before a failing CI", () => {
    expect(mine({ mergeable: "CONFLICTING", ci: "FAILURE" }).status).toEqual({
      text: "Conflicts",
      tone: "error",
      href: "https://github.com/acme/app/pull/1/conflicts"
    })
    expect(mine({ mergeStateStatus: "DIRTY" }).status).toEqual({
      text: "Conflicts",
      tone: "error",
      href: "https://github.com/acme/app/pull/1/conflicts"
    })
  })

  test("a failing or errored CI", () => {
    expect(mine({ ci: "FAILURE" }).status).toEqual({
      text: "CI Failing",
      tone: "error",
      href: "https://github.com/acme/app/pull/1/checks"
    })
    expect(mine({ ci: "ERROR" }).status).toEqual({
      text: "CI Failing",
      tone: "error",
      href: "https://github.com/acme/app/pull/1/checks"
    })
  })

  test("changes requested, from the decision or a reviewer's latest review", () => {
    expect(mine({ reviewDecision: "CHANGES_REQUESTED" }).status).toEqual({
      text: "Changes Requested",
      tone: "warning"
    })

    const row = mine({
      reviews: [
        { login: "ann", state: "APPROVED", at: "2026-10-01T11:00:00Z" },
        { login: "bob", state: "CHANGES_REQUESTED", at: "2026-10-01T12:00:00Z" }
      ]
    })
    expect(row.status).toEqual({ text: "Changes Requested", tone: "warning" })
    expect(texts(row)).toEqual(["CI ✓", "approved: ann", "changes requested: bob"])
    expect(row.actions).toEqual(["resolve"])
  })

  test("a reviewer's comment after approving keeps the approval", () => {
    const row = mine({
      reviews: [{ login: "ann", state: "COMMENTED", at: "2026-10-01T12:00:00Z" }],
      verdicts: [{ login: "ann", state: "APPROVED" }]
    })

    expect(row.status).toEqual({ text: "Ready To Merge", tone: "success" })
    expect(texts(row)).toEqual(["CI ✓", "approved: ann"])
    expect(row.signals.reviews).toEqual({ ann: { state: "COMMENTED", at: "2026-10-01T12:00:00Z", isBot: false } })
  })

  test("mergeability GitHub is still working out is neither conflicting nor clean", () => {
    const row = mine({ mergeable: "UNKNOWN", requested: ["ann"] })

    expect(row.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(row.signals.isConflicting).toBe(null)
  })

  test("a fork's pull request says so", () => {
    expect(mine({ isCrossRepository: true }).isCrossRepository).toBe(true)
    expect(mine({}).isCrossRepository).toBe(false)
  })

  test("approved and mergeable is ready to merge, even where approval is not required", () => {
    const row = mine({ reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T11:00:00Z" }] })

    expect(row.status).toEqual({ text: "Ready To Merge", tone: "success" })
    expect(texts(row)).toEqual(["CI ✓", "approved: ann"])
    expect(row.actions).toEqual(["merge"])
  })

  test("approved but held back", () => {
    const running = mine({ reviewDecision: "APPROVED", ci: "PENDING" })
    expect(running.status).toEqual({ text: "Approved", tone: "neutral" })
    expect(texts(running)).toEqual(["CI ●"])
    expect(mine({ reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }).status).toEqual({
      text: "Approved · Behind Base",
      tone: "warning"
    })
    expect(mine({ reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED" }).status).toEqual({
      text: "Approved · Merge Blocked",
      tone: "warning"
    })
  })

  test("not approved yet: waiting for the requested reviewers, running CI a detail beside it", () => {
    const running = mine({ ci: "EXPECTED", requested: ["ann"] })
    expect(running.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(running.details[0]).toEqual({
      text: "CI ●",
      tone: "warning",
      mark: "●",
      href: "https://github.com/acme/app/pull/1/checks"
    })
    expect(texts(running)).toEqual(["CI ●", "requested: ann"])

    const waiting = mine({ requested: ["ann", "bob", "cid", "dee"] })
    expect(waiting.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(texts(waiting)).toEqual(["CI ✓", "requested: ann, bob, cid +1"])
  })

  test("open review comments without an approval wait on the author, while CI runs too", () => {
    const row = mine({
      ci: "PENDING",
      requested: ["ann"],
      reviews: [{ login: "bob", state: "COMMENTED", at: "2026-10-01T12:00:00Z" }],
      threads: [{ isResolved: false }, { isResolved: false }, { isResolved: true }]
    })

    expect(row.status).toEqual({ text: "Comments To Address", tone: "warning" })
    expect(texts(row)).toEqual(["CI ●", "reviewed: bob", "requested: ann", "2 unresolved comments"])
    expect(row.actions).toEqual(["resolve"])
    expect(row.primary).toBe("resolve")
  })

  test("changes requested still comes first, and an approval keeps its status over open comments", () => {
    const UNRESOLVED = [{ isResolved: false }]

    expect(mine({ reviewDecision: "CHANGES_REQUESTED", threads: UNRESOLVED }).status.text).toBe("Changes Requested")
    expect(mine({ ci: "FAILURE", threads: UNRESOLVED }).status.text).toBe("CI Failing")

    const approved = mine({ reviewDecision: "APPROVED", threads: UNRESOLVED })
    expect(approved.status).toEqual({ text: "Ready To Merge", tone: "success" })
    expect(texts(approved)).toEqual(["CI ✓", "1 unresolved comment"])
    expect(approved.actions).toEqual(["resolve", "merge"])
    expect(approved.primary).toBe("merge")
  })

  test("a bot's comments alone leave the status be", () => {
    const row = mine({
      requested: ["ann"],
      reviews: [{ login: "gemini-code-assist", state: "COMMENTED", at: "2026-10-01T12:00:00Z", isBot: true }],
      threads: [{ isResolved: false }]
    })

    expect(row.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(texts(row)).toEqual(["CI ✓", "requested: ann", "1 unresolved comment"])
    expect(row.actions).toEqual(["resolve"])
  })

  test("everyone who held it back asked to review again: waiting for re-review", () => {
    const BOB_CHANGES = { login: "bob", state: "CHANGES_REQUESTED", at: "2026-10-01T12:00:00Z" }
    const changes = mine({ reviews: [BOB_CHANGES], requested: ["bob"], threads: [{ isResolved: false }] })

    expect(changes.status).toEqual({ text: "Waiting For Re-Review", tone: "neutral" })
    expect(texts(changes)).toEqual(["CI ✓", "changes requested: bob", "requested: bob", "1 unresolved comment"])
    expect(changes.actions).toEqual(["resolve"])
    expect(changes.primary).toBe(null)

    // One who only commented leaves GitHub's latest reviews once asked again, so their comments wait on them.
    const comments = mine({
      reviews: [{ login: "bob", state: "COMMENTED", at: "2026-10-01T12:00:00Z" }],
      requested: ["bob", "ann"],
      threads: [{ isResolved: false }]
    })
    expect(comments.status.text).toBe("Waiting For Review")
    expect(texts(comments)).toEqual(["CI ✓", "requested: bob, ann", "1 unresolved comment"])

    // One of two asked again leaves the other's changes with the author; a team's request names nobody again.
    const cidChanges = { ...BOB_CHANGES, login: "cid" }
    expect(mine({ reviews: [BOB_CHANGES, cidChanges], requested: ["bob"] }).status.text).toBe("Changes Requested")
    expect(mine({ reviews: [BOB_CHANGES], requestedTeams: ["web"] }).status.text).toBe("Changes Requested")
  })

  test("approved by fewer than the base requires waits on the reviewers", () => {
    const row = mine({
      reviewDecision: "REVIEW_REQUIRED",
      mergeStateStatus: "BLOCKED",
      reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T12:00:00Z" }],
      requested: ["bob"]
    })

    expect(row.status).toEqual({ text: "Approved · More Approvals Needed", tone: "neutral" })
    expect(texts(row)).toEqual(["CI ✓", "approved: ann", "requested: bob"])
    // Blocked by something else once the approvals are in, which is the author's to see to.
    expect(
      mine({
        reviewDecision: "APPROVED",
        mergeStateStatus: "BLOCKED",
        reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T12:00:00Z" }]
      }).status.text
    ).toBe("Approved · Merge Blocked")
  })

  test("a bot or a reviewer the query cannot name is still a reviewer requested", () => {
    expect(texts(mine({ requestedOthers: [{ __typename: "Bot", login: "copilot" }] }))).toContain("requested: copilot")
    expect(texts(mine({ requestedOthers: [{ __typename: "EnterpriseTeam" }] }))).toContain("requested: 1 reviewer")
    expect(texts(mine({ requestedHidden: 1 }))).toContain("requested: 1 reviewer")
    expect(texts(mine({ requested: ["ann"], requestedHidden: 2 }))).toContain("requested: ann +2")
    expect(
      texts(
        mine({
          requested: ["ann", "bob", "cid", "dee"],
          requestedOthers: [{ __typename: "EnterpriseTeam" }]
        })
      )
    ).toContain("requested: ann, bob, cid +2")
  })

  test("a verdict from someone who cannot push to the repository counts for nothing, as on GitHub", () => {
    const row = mine({
      reviewDecision: "APPROVED",
      reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T09:00:00Z" }],
      verdicts: [
        { login: "ann", state: "APPROVED", at: "2026-10-01T09:00:00Z" },
        { login: "drive-by", state: "CHANGES_REQUESTED", at: "2026-10-01T10:00:00Z", isWriter: false }
      ]
    })

    expect(row.status).toEqual({ text: "Ready To Merge", tone: "success" })
  })

  test("no reviewer requested is flagged, and no CI shows no CI badge", () => {
    const row = mine({ ci: null })

    expect(row.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(row.details).toEqual([{ text: "no reviewer requested", tone: "warning" }])
  })

  test("the row says in data, as its detail does, that nobody is asked to review it and nobody gave feedback yet", () => {
    const commented = { login: "ann", state: "COMMENTED", at: "2026-10-07T13:00:00Z" }
    const approved = { login: "ann", state: "APPROVED", at: "2026-10-07T13:00:00Z" }
    const rows = [
      mine({ ci: null }),
      mine({ requested: ["ann"] }),
      mine({ reviews: [commented] }),
      mine({ ...REVIEW_REQUIRED, reviews: [approved] }),
      mine({ reviewDecision: "APPROVED", reviews: [approved] }),
      mine({ reviewDecision: "CHANGES_REQUESTED", reviews: [{ ...approved, state: "CHANGES_REQUESTED" }] }),
      mine({ isDraft: true })
    ]

    expect(rows.map((row) => row.isReviewerUnrequested)).toEqual(
      rows.map((row) => texts(row).includes("no reviewer requested"))
    )
    expect(rows[0]?.isReviewerUnrequested).toBe(true)
    expect(rows[1]?.isReviewerUnrequested).toBe(false)
    expect(rows[2]?.isReviewerUnrequested).toBe(false)
    expect(snapshotOf({ requested: [{ number: 2, author: "ann" }] }).review[0]?.isReviewerUnrequested).toBe(false)
  })

  test("after someone's feedback, the missing request is to look again; an approval alone still needs a reviewer", () => {
    const commented = mine({ reviews: [{ login: "ann", state: "COMMENTED", at: "2026-10-07T13:00:00Z" }] })
    expect(commented.details.map((detail) => detail.text)).toEqual(["CI ✓", "reviewed: ann", "no re-review requested"])

    const asked = mine({
      requested: ["ann"],
      reviews: [{ login: "bob", state: "COMMENTED", at: "2026-10-07T13:00:00Z" }]
    })
    expect(asked.details.map((detail) => detail.text)).toContain("requested: ann")
  })

  test("unresolved comments leave resolved and outdated threads out", () => {
    const row = mine({
      requested: ["ann"],
      threads: [
        { isResolved: false },
        { isResolved: false },
        { isResolved: true },
        { isResolved: false, isOutdated: true }
      ]
    })

    expect(texts(row)).toEqual(["CI ✓", "requested: ann", "2 unresolved comments"])
    expect(row.signals.unresolvedThreads).toBe(2)
    expect(row.actions).toEqual(["resolve"])
  })

  test("outdated threads count when the person asks for them", () => {
    const row = mine(
      {
        requested: ["ann"],
        reviews: [{ login: "bob", state: "COMMENTED", at: "2026-10-01T12:00:00Z" }],
        threads: [
          { isResolved: false, isOutdated: true },
          { isResolved: true, isOutdated: true }
        ]
      },
      { includeOutdated: true }
    )

    expect(texts(row)).toEqual(["CI ✓", "reviewed: bob", "requested: ann", "1 unresolved comment"])
    expect(row.status.text).toBe("Comments To Address")
    expect(row.actions).toEqual(["resolve"])
  })

  test("an outdated-only thread is nothing to resolve by default", () => {
    const row = mine({ ...REVIEW_REQUIRED, requested: ["ann"], threads: [{ isResolved: false, isOutdated: true }] })

    expect(row.status.text).toBe("Waiting For Review")
    expect(row.actions).toEqual([])
  })

  test("a bot's review is no verdict, and is kept marked as a bot's", () => {
    const row = mine({
      requested: ["ann"],
      reviews: [{ login: "gemini-code-assist", state: "APPROVED", at: "2026-10-01T11:00:00Z", isBot: true }]
    })

    expect(row.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
    expect(texts(row)).toEqual(["CI ✓", "requested: ann"])
    expect(row.signals.reviews).toEqual({
      "gemini-code-assist": { state: "APPROVED", at: "2026-10-01T11:00:00Z", isBot: true }
    })
  })

  test("keeps the conversation's size and who wrote its latest comments, a bot as none", () => {
    expect(mine({ comments: { count: 3, lastAuthor: "ann" } }).signals.conversation).toEqual({
      count: 3,
      authors: ["ann"]
    })
    expect(
      mine({ comments: { count: 7, earlier: [{ login: "bob" }, { login: "me" }], lastAuthor: "linear", isBot: true } })
        .signals.conversation
    ).toEqual({ count: 7, authors: ["bob", "me", null] })
    expect(mine({}).signals.conversation).toEqual({ count: 0, authors: [] })
  })

  test("in the merge queue: waiting on the queue, with nothing to press", () => {
    const row = mine({
      isInMergeQueue: true,
      reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T10:00:00Z" }]
    })

    expect(row.status).toEqual({ text: "In Merge Queue", tone: "neutral" })
    expect(row.actions).toEqual([])
    expect(row.signals.isQueued).toBe(true)
    expect(mine({ isInMergeQueue: true, mergeStateStatus: "BEHIND", canUpdateBranch: true }).actions).toEqual([])
  })

  test("keeps what the alerts compare", () => {
    const row = mine({
      ci: "PENDING",
      mergeable: "CONFLICTING",
      reviews: [{ login: "ann", state: "COMMENTED", at: "2026-10-01T11:00:00Z" }],
      threads: [{ isResolved: false }]
    })

    expect(row.signals).toEqual({
      ci: "PENDING",
      isConflicting: true,
      unresolvedThreads: 1,
      isAutoMerge: false,
      isQueued: false,
      reviews: { ann: { state: "COMMENTED", at: "2026-10-01T11:00:00Z", isBot: false } },
      conversation: { count: 0, authors: [] },
      isRequested: false,
      hasCommitsSinceMyReview: false
    })
    expect(row).toMatchObject({
      number: 1,
      title: "Pull request 1",
      url: "https://github.com/acme/app/pull/1",
      author: "me",
      headRefName: "feature/branch-1",
      stage: "conflicts"
    })
    expect(snapshotOf({ requested: [{ number: 2, author: "ann" }] }).review[0]?.stage).toBe(null)
  })
})

describe("pull requests waiting on the viewer", () => {
  const MY_REVIEW_AT = "2026-10-01T12:00:00Z"

  function reviewRows(fixture: ResponseFixture): PullRow[] {
    return snapshotOf(fixture).review
  }

  test("a fresh review request", () => {
    const [row] = reviewRows({ requested: [{ number: 7, author: "ann" }] })

    expect(row?.status).toEqual({ text: "Review Requested", tone: "warning" })
    expect(row?.details).toEqual([
      { text: "by ann", tone: "neutral" },
      { text: "CI ✓", tone: "success", mark: "✓", href: "https://github.com/acme/app/pull/7/checks" }
    ])
    expect(row?.signals.isRequested).toBe(true)
    expect(row?.actions).toEqual(["review"])
  })

  test("asked again, the viewer's review of an earlier commit still says new commits came: GitHub keeps it", () => {
    const [row] = reviewRows({
      requested: [
        {
          number: 7,
          author: "ann",
          requested: ["me"],
          reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT, commit: "earlier" }]
        }
      ]
    })

    expect(row?.status).toEqual({ text: "Re-Review Requested", tone: "warning" })
    expect(row?.signals.hasCommitsSinceMyReview).toBe(true)
  })

  test("a review the viewer still has pending is no review given", () => {
    const [row] = reviewRows({
      requested: [{ number: 7, author: "ann", reviews: [{ login: "me", state: "PENDING", at: MY_REVIEW_AT }] }]
    })

    expect(row?.status).toEqual({ text: "Review Requested", tone: "warning" })
  })

  test("the viewer's approval is read among those who can push, or from their latest review where they can't", () => {
    const approvedThenCommented = reviewRows({
      reviewed: [
        {
          number: 7,
          author: "ann",
          reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }],
          verdicts: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT }]
        }
      ]
    })
    const approvedWithoutPush = reviewRows({
      reviewed: [
        {
          number: 7,
          author: "ann",
          reviews: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT }],
          verdicts: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT, isWriter: false }]
        }
      ]
    })
    // Without push access, a comment after the approval leaves GitHub naming no verdict of theirs.
    const commentedSinceWithoutPush = reviewRows({
      reviewed: [
        {
          number: 7,
          author: "ann",
          reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }],
          verdicts: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT, isWriter: false }]
        }
      ]
    })

    expect(approvedThenCommented).toEqual([])
    expect(approvedWithoutPush).toEqual([])
    expect(commentedSinceWithoutPush[0]?.status).toEqual({ text: "You Commented", tone: "neutral" })
  })

  test("asked again after reviewing, even after approving", () => {
    const [row] = reviewRows({
      requested: [
        { number: 7, author: "ann", requested: ["me"], reviews: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT }] }
      ]
    })

    expect(row?.status).toEqual({ text: "Re-Review Requested", tone: "warning" })
  })

  test("a team's request counts until the viewer reviews, and never reads as being asked again", () => {
    const asked = reviewRows({ requested: [{ number: 7, author: "ann", requestedTeams: ["web"] }] })
    const commented = reviewRows({
      requested: [
        {
          number: 7,
          author: "ann",
          requestedTeams: ["web"],
          reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }]
        }
      ]
    })
    const approved = reviewRows({
      requested: [
        {
          number: 7,
          author: "ann",
          requestedTeams: ["web"],
          reviews: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT }]
        }
      ]
    })

    // A verdict the latest twenty reviews leave out is the viewer's review too.
    const changesOnly = reviewRows({
      requested: [
        {
          number: 7,
          author: "ann",
          requestedTeams: ["web"],
          reviews: [],
          verdicts: [{ login: "me", state: "CHANGES_REQUESTED", at: MY_REVIEW_AT }]
        }
      ]
    })

    expect(asked[0]?.status).toEqual({ text: "Review Requested", tone: "warning" })
    expect(commented[0]?.status).toEqual({ text: "You Commented", tone: "neutral" })
    expect(approved).toEqual([])
    expect(changesOnly[0]?.status).toEqual({ text: "Waiting On Author", tone: "neutral" })
  })

  test("leaves the list once the viewer's latest review approves it", () => {
    const rows = reviewRows({
      reviewed: [{ number: 7, author: "ann", reviews: [{ login: "me", state: "APPROVED", at: MY_REVIEW_AT }] }]
    })

    expect(rows).toEqual([])
  })

  test("new commits after the viewer's review", () => {
    const [row] = reviewRows({
      reviewed: [
        {
          number: 7,
          author: "ann",
          headRefOid: "new-head",
          reviews: [{ login: "me", state: "CHANGES_REQUESTED", at: MY_REVIEW_AT, commit: "old-head" }]
        }
      ]
    })

    expect(row?.status).toEqual({ text: "Updated Since Your Review", tone: "warning" })
    expect(row?.signals.hasCommitsSinceMyReview).toBe(true)
  })

  test("changes requested and nothing pushed since waits on the author", () => {
    const [row] = reviewRows({
      reviewed: [{ number: 7, author: "ann", reviews: [{ login: "me", state: "CHANGES_REQUESTED", at: MY_REVIEW_AT }] }]
    })

    expect(row?.status).toEqual({ text: "Waiting On Author", tone: "neutral" })
  })

  test("a dismissed review", () => {
    const [row] = reviewRows({
      reviewed: [{ number: 7, author: "ann", reviews: [{ login: "me", state: "DISMISSED", at: MY_REVIEW_AT }] }]
    })

    expect(row?.status).toEqual({ text: "Your Review Was Dismissed", tone: "warning" })
  })

  test("a conversation comment without a review", () => {
    const [row] = reviewRows({ commented: [{ number: 7, author: "ann" }] })

    expect(row?.status).toEqual({ text: "You Commented", tone: "neutral" })
  })

  test("details name the author, a draft, CI, other approvals and open threads", () => {
    const [row] = reviewRows({
      commented: [
        {
          number: 7,
          author: "ann",
          isDraft: true,
          ci: "FAILURE",
          threads: [{ isResolved: false }, { isResolved: false }],
          reviews: [
            { login: "bob", state: "APPROVED", at: MY_REVIEW_AT },
            { login: "ann", state: "COMMENTED", at: MY_REVIEW_AT }
          ]
        }
      ]
    })

    expect(texts(row as PullRow)).toEqual(["by ann", "draft", "CI ✗", "approved: bob", "2 unresolved comments"])
    // Only the viewer's own pull requests announce reviews, so others' are not read here.
    expect(row?.signals.reviews).toEqual({})
  })

  test("one row per pull request, requested ones first, the viewer's own left out", () => {
    const rows = reviewRows({
      requested: [{ number: 9, author: "ann" }],
      commented: [
        { number: 8, author: "bob" },
        { number: 9, author: "ann" },
        { number: 3, author: "me" }
      ],
      reviewed: [{ number: 8, author: "bob", reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }] }]
    })

    expect(rows.map((row) => row.number)).toEqual([9, 8])
    expect(rows.map((row) => row.status.text)).toEqual(["Review Requested", "You Commented"])
  })

  test("skips search results that are not pull requests", () => {
    const json = JSON.stringify({
      data: {
        viewer: { login: "me" },
        repository: { nameWithOwner: "acme/app" },
        mine: { nodes: [{}, null] },
        requested: { nodes: [] },
        commented: { nodes: [] },
        reviewed: { nodes: [] },
        mentioned: { nodes: [] }
      }
    })

    expect(readPulls(json, "acme/app", 0, DEFAULTS)).toEqual({
      snapshot: {
        schema: SNAPSHOT_SCHEMA,
        repo: "acme/app",
        viewer: "me",
        url: "",
        fetchedAt: 0,
        merging: {
          methods: [],
          isAutoMergeAllowed: false,
          canWrite: false,
          canRequestReviews: false,
          isUpdateSuggested: false
        },
        isCut: { mine: false, review: false, requested: false },
        mentioned: { pulls: [], isCut: false },
        mine: [],
        review: [],
        hiddenDrafts: 0,
        hiddenDraftNumbers: [],
        defaultBranch: null,
        ownHeads: [],
        endedHeads: []
      }
    })
  })

  test("a comment after approving keeps the pull request off the list", () => {
    const rows = reviewRows({
      reviewed: [
        {
          number: 7,
          author: "ann",
          reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }],
          verdicts: [{ login: "me", state: "APPROVED" }]
        }
      ]
    })

    expect(rows).toEqual([])
  })

  test("a review on the current head is not counted as new commits", () => {
    const [row] = reviewRows({
      commented: [{ number: 7, author: "ann", reviews: [{ login: "me", state: "COMMENTED", at: MY_REVIEW_AT }] }]
    })

    expect(row?.status).toEqual({ text: "You Commented", tone: "neutral" })
    expect(row?.signals.hasCommitsSinceMyReview).toBe(false)
  })
})

describe("order", () => {
  test("what needs the viewer first, GitHub's order kept within each, drafts last in both lists", () => {
    const snapshot = snapshotOf({
      mine: [
        { number: 1, isDraft: true },
        { number: 2 },
        { number: 3, reviewDecision: "APPROVED" },
        { number: 4, reviewDecision: "CHANGES_REQUESTED" },
        { number: 5, ci: "FAILURE" },
        { number: 6, reviewDecision: "CHANGES_REQUESTED" }
      ],
      commented: [{ number: 7, author: "ann" }],
      requested: [
        { number: 9, author: "cy", isDraft: true },
        { number: 8, author: "bob" }
      ]
    })

    expect(snapshot.mine.map((row) => `${row.number} ${row.status.text}`)).toEqual([
      "5 CI Failing",
      "4 Changes Requested",
      "6 Changes Requested",
      "3 Ready To Merge",
      "2 Waiting For Review",
      "1 Draft"
    ])
    expect(snapshot.review.map((row) => `${row.number} ${row.status.text}`)).toEqual([
      "8 Review Requested",
      "7 You Commented",
      "9 Review Requested"
    ])
    expect(snapshot.review.map((row) => row.isDraft)).toEqual([false, false, true])
  })
})

describe("stacks", () => {
  const STACK = { number: 30, position: 2, size: 4 }

  test("a stacked pull request says where it sits right after CI, in either list; others say nothing", () => {
    const own = mine({ reviewDecision: "APPROVED", stack: STACK })
    const approved = [{ login: "bob", state: "APPROVED", at: "2026-10-07T11:00:00Z" }]
    const theirs = snapshotOf({
      requested: [{ number: 2, author: "ann", requested: ["me"], stack: STACK, reviews: approved }]
    }).review[0]

    expect(own.stack).toEqual(STACK)
    expect(own.details.slice(0, 2)).toEqual([
      expect.objectContaining({ text: "CI ✓" }),
      { text: "stack #30 2/4", tone: "neutral" }
    ])
    expect(theirs?.details.map((detail) => detail.text).slice(0, 4)).toEqual([
      "by ann",
      "CI ✓",
      "stack #30 2/4",
      expect.stringMatching(/^approved: bob/)
    ])
    expect(mine({}).stack).toBe(null)
    expect(mine({}).details.some((detail) => detail.text.startsWith("stack"))).toBe(false)
  })

  test("a stack GitHub only half describes is none", () => {
    const pull = (stackEntry: unknown) =>
      readPulls(
        response({ mine: [{ number: 1 }] }).replace('"stackEntry":null', `"stackEntry":${JSON.stringify(stackEntry)}`),
        "acme/app",
        0,
        DEFAULTS
      )

    for (const entry of [
      { position: 2 },
      { position: 2, stack: null },
      { stack: { number: 30, size: 4 } },
      { position: 2, stack: { size: 4 } }
    ]) {
      const read = pull(entry)
      expect("snapshot" in read ? read.snapshot.mine[0]?.stack : read).toBe(null)
    }
  })

  test("stackText words it", () => {
    expect(stackText(STACK)).toBe("stack #30 2/4")
  })
})

describe("row actions", () => {
  const AUTO_MERGE = { merging: { autoMerge: true } }

  function actionsOf(pull: Omit<PullFixture, "number">, fixture: Omit<ResponseFixture, "mine"> = {}): string[] {
    return snapshotOf({ ...fixture, mine: [{ number: 1, ...pull }] }).mine[0]?.actions ?? []
  }

  test("a stacked pull request offers no Auto-Merge, which GitHub doesn't do for one", () => {
    const waiting = { reviewDecision: "APPROVED", ci: "PENDING" }
    expect(actionsOf(waiting, AUTO_MERGE)).toEqual(["autoMerge"])
    expect(actionsOf({ ...waiting, stack: { number: 30, position: 2, size: 4 } }, AUTO_MERGE)).toEqual([])
  })

  describe("Re-Request Review", () => {
    const AT = "2026-10-07T13:20:00Z"
    const changes = (login: string, commit?: string | null) => ({ login, state: "CHANGES_REQUESTED", at: AT, commit })

    test("asks again those who requested changes before the latest commits, and is then the next step", () => {
      const row = mine({ reviewDecision: "CHANGES_REQUESTED", reviews: [changes("ann", "old"), changes("bob", "old")] })

      expect(row.rerequestFrom).toEqual(["ann", "bob"])
      expect(row.actions).toEqual(["resolve", "rerequest"])
      expect(row.primary).toBe("rerequest")
    })

    test("not before commits came after the change request: addressing it is the next step", () => {
      const row = mine({ reviewDecision: "CHANGES_REQUESTED", reviews: [changes("ann")] })

      expect(row.rerequestFrom).toEqual([])
      expect(row.actions).toEqual(["resolve"])
      expect(row.primary).toBe("resolve")
    })

    test("leaves out those asked again already, and is gone once everyone is", () => {
      const reviews = [changes("ann", "old"), changes("bob", "old")]

      expect(mine({ reviewDecision: "CHANGES_REQUESTED", reviews, requested: ["bob"] }).rerequestFrom).toEqual(["ann"])
      const askedAll = mine({ reviewDecision: "CHANGES_REQUESTED", reviews, requested: ["ann", "bob"] })
      expect(askedAll.rerequestFrom).toEqual([])
      expect(askedAll.actions).not.toContain("rerequest")
    })

    test("asks no one who only commented, or approved, and none whose latest review is not among those read", () => {
      const commented = { login: "cid", state: "COMMENTED", at: AT, commit: "old" }
      const approved = { login: "dee", state: "APPROVED", at: AT, commit: "old" }

      expect(mine({ reviews: [commented, approved] }).rerequestFrom).toEqual([])
      // A change request with no latest review read for its reviewer: nothing says commits came after it.
      expect(
        mine({ reviewDecision: "CHANGES_REQUESTED", reviews: [], verdicts: [changes("ann")] }).rerequestFrom
      ).toEqual([])
    })

    test("offered beside another stage's main button, but not on a draft, nor without triage access", () => {
      const before = { reviewDecision: "CHANGES_REQUESTED", reviews: [changes("ann", "old")] }
      const failing = mine({ ...before, ci: "FAILURE" })

      expect(failing.actions).toContain("rerequest")
      expect(failing.primary).toBe("rerun")
      expect(mine({ ...before, isDraft: true }).actions).not.toContain("rerequest")
      // Asking for a review takes triage access to the repository.
      const access = (permission: string) =>
        snapshotOf({ merging: { permission }, mine: [{ number: 1, ...before }] }).mine[0]?.actions ?? []
      expect(access("READ")).not.toContain("rerequest")
      expect(access("TRIAGE")).toContain("rerequest")
    })

    test("merging and re-running need push access; asking for a review, triage access", () => {
      const access = (permission: string) => snapshotOf({ merging: { permission }, mine: [] }).merging

      expect(
        ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"].map((permission) => {
          const { canWrite, canRequestReviews } = access(permission)

          return [permission, canWrite, canRequestReviews]
        })
      ).toEqual([
        ["READ", false, false],
        ["TRIAGE", false, true],
        ["WRITE", true, true],
        ["MAINTAIN", true, true],
        ["ADMIN", true, true]
      ])
    })

    test("a latest review whose commit GitHub can't name asks no one", () => {
      expect(mine({ reviewDecision: "CHANGES_REQUESTED", reviews: [changes("ann", null)] }).rerequestFrom).toEqual([])
    })

    test("someone else's pull request asks no one again", () => {
      const row = snapshotOf({
        requested: [{ number: 2, author: "ann", reviews: [changes("bob", "old")], requested: ["me"] }]
      }).review[0]

      expect(row?.rerequestFrom).toEqual([])
      expect(row?.actions).toEqual(["review"])
    })
  })

  test("Merge when approved, green and nothing blocks", () => {
    expect(actionsOf({ reviewDecision: "APPROVED" })).toEqual(["merge"])
    expect(actionsOf({ reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED" })).toEqual([])
    expect(actionsOf({ reviewDecision: "APPROVED" }, { merging: { squash: false, merge: false } })).toEqual([])
  })

  test("Auto-Merge while approved checks run, where the repository allows auto-merge", () => {
    expect(actionsOf({ reviewDecision: "APPROVED", ci: "PENDING" }, AUTO_MERGE)).toEqual(["autoMerge"])
    expect(actionsOf({ reviewDecision: "APPROVED", ci: "PENDING" })).toEqual([])
    expect(actionsOf({ reviewDecision: "APPROVED", ci: "PENDING", isAutoMergeOn: true }, AUTO_MERGE)).toEqual([])
  })

  test("auto-merge already on says so, and offers no merge", () => {
    const row = snapshotOf({ mine: [{ number: 1, reviewDecision: "APPROVED", isAutoMergeOn: true }] }).mine[0]

    expect(row?.actions).toEqual([])
    expect(row ? texts(row) : []).toContain("auto-merge on")
  })

  test("Update Branch when approved but behind its base, if GitHub lets the viewer", () => {
    expect(actionsOf({ reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" })).toEqual(["updateBranch"])
    expect(actionsOf({ reviewDecision: "APPROVED", mergeStateStatus: "BEHIND", canUpdateBranch: false })).toEqual([])
  })

  test("Update Branch before approval too, where the base must be up to date to merge", () => {
    const waiting = snapshotOf({ mine: [{ number: 1, mergeStateStatus: "BEHIND", requested: ["ann"] }] }).mine[0]

    expect(waiting?.status.text).toBe("Waiting For Review")
    expect(waiting?.actions).toEqual(["updateBranch"])
    expect(waiting?.primary).toBe(null)
    expect(waiting?.details).toContainEqual({ text: "behind main", tone: "warning" })
    expect(actionsOf({ mergeStateStatus: "BEHIND", threads: [{ isResolved: false }] })).toEqual([
      "resolve",
      "updateBranch"
    ])
    expect(actionsOf({ reviewDecision: "APPROVED", ci: "PENDING", mergeStateStatus: "BEHIND" })).toEqual([
      "updateBranch"
    ])
  })

  test("Update Branch on any branch behind its base where the repository always suggests it", () => {
    const SUGGESTS = { merging: { suggestUpdate: true } }
    const behind = snapshotOf({ ...SUGGESTS, mine: [{ number: 1, ...REVIEW_REQUIRED, canUpdateBranch: true }] }).mine[0]

    expect(behind?.actions).toEqual(["updateBranch"])
    expect(behind?.details).toContainEqual({ text: "behind main", tone: "neutral" })
    expect(actionsOf({ reviewDecision: "APPROVED", canUpdateBranch: true }, SUGGESTS)).toEqual([
      "updateBranch",
      "merge"
    ])
    // Up to date, or a base that needs neither: nothing to offer.
    expect(actionsOf(REVIEW_REQUIRED, SUGGESTS)).toEqual([])
    expect(texts(snapshotOf({ mine: [{ number: 1, canUpdateBranch: true }] }).mine[0]!)).not.toContain("behind main")
    expect(actionsOf({ ...REVIEW_REQUIRED, canUpdateBranch: true })).toEqual([])
  })

  test("no Update Branch on a draft, or with conflicts that need resolving first", () => {
    expect(actionsOf({ isDraft: true, mergeStateStatus: "BEHIND" })).toEqual(["ready"])
    expect(
      actionsOf({ mergeable: "CONFLICTING", canUpdateBranch: true }, { merging: { suggestUpdate: true } })
    ).toEqual(["resolveConflicts"])
  })

  test("the approved status already says the branch is behind, so no detail repeats it", () => {
    const row = snapshotOf({ mine: [{ number: 1, reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }] }).mine[0]

    expect(row?.status.text).toBe("Approved · Behind Base")
    expect(row ? texts(row) : []).not.toContain("behind main")
  })

  test("Auto-Merge also while a requirement such as a second approval still blocks", () => {
    expect(actionsOf({ reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED" }, AUTO_MERGE)).toEqual(["autoMerge"])
    const oneOfTwo = snapshotOf({
      ...AUTO_MERGE,
      mine: [
        {
          number: 1,
          reviewDecision: "REVIEW_REQUIRED",
          mergeStateStatus: "BLOCKED",
          reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T12:00:00Z" }]
        }
      ]
    }).mine[0]
    expect(oneOfTwo?.actions).toEqual(["autoMerge"])
    expect(oneOfTwo?.primary).toBe("autoMerge")
    // Blocked with conversations open: resolving them comes first.
    const withThreads = snapshotOf({
      ...AUTO_MERGE,
      mine: [{ number: 1, reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED", threads: [{ isResolved: false }] }]
    }).mine[0]
    expect(withThreads?.actions).toEqual(["resolve", "autoMerge"])
    expect(withThreads?.primary).toBe("resolve")
    expect(
      actionsOf({ reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED", canEnableAutoMerge: false }, AUTO_MERGE)
    ).toEqual([])
  })

  test("a viewer without push access, as a contributor from a fork, gets no merge or re-run", () => {
    const READ = { merging: { permission: "READ" } }

    expect(actionsOf({ reviewDecision: "APPROVED" }, READ)).toEqual([])
    // Fixing works on a local copy, so it needs no access to the repository.
    expect(actionsOf({ ci: "FAILURE", threads: [{ isResolved: false }] }, READ)).toEqual(["resolve", "fixCi"])
  })

  test("Re-Run CI and Fix CI while CI fails, beside Resolve Comments; a draft gets Fix CI but no re-run", () => {
    expect(actionsOf({ ci: "FAILURE" })).toEqual(["rerun", "fixCi"])
    expect(actionsOf({ ci: "ERROR", threads: [{ isResolved: false }] })).toEqual(["resolve", "rerun", "fixCi"])
    expect(actionsOf({ ci: "FAILURE", isDraft: true })).toEqual(["fixCi", "ready"])
  })

  test("a draft's next step is Ready For Review; failing CI's is a re-run, or a fix without push access", () => {
    const list = snapshotOf({
      mine: [
        { number: 1, isDraft: true, ci: "FAILURE" },
        { number: 2, ci: "FAILURE" }
      ]
    })
    const readOnly = snapshotOf({ mine: [{ number: 3, ci: "FAILURE" }], merging: { permission: "READ" } })

    expect(rowOf(list, 1)?.primary).toBe("ready")
    expect(rowOf(list, 2)?.primary).toBe("rerun")
    expect(rowOf(readOnly, 3)?.primary).toBe("fixCi")
  })

  test("Resolve Conflicts where GitHub says the branch conflicts, the next step there; a draft's is still Ready", () => {
    expect(actionsOf({ mergeable: "CONFLICTING" })).toEqual(["resolveConflicts"])
    expect(actionsOf({ mergeStateStatus: "DIRTY", ci: "FAILURE" })).toEqual(["resolveConflicts", "rerun", "fixCi"])
    // GitHub still working it out is no conflict yet.
    expect(actionsOf({ mergeable: "UNKNOWN" })).not.toContain("resolveConflicts")
    // It works on a local copy, so it needs no access to the repository.
    expect(actionsOf({ mergeable: "CONFLICTING" }, { merging: { permission: "READ" } })).toEqual(["resolveConflicts"])
    const list = snapshotOf({
      mine: [
        { number: 1, mergeable: "CONFLICTING", ci: "FAILURE" },
        { number: 2, mergeable: "CONFLICTING", isDraft: true }
      ]
    })

    expect(rowOf(list, 1)?.primary).toBe("resolveConflicts")
    expect(rowOf(list, 2)?.actions).toEqual(["resolveConflicts", "ready"])
    expect(rowOf(list, 2)?.primary).toBe("ready")
  })

  test("someone else's pull request offers a review only, even a failing draft or a conflicting one", () => {
    const failing = snapshotOf({ requested: [{ number: 5, author: "ann", ci: "FAILURE", isDraft: true }] }).review[0]
    const conflicting = snapshotOf({ requested: [{ number: 6, author: "ann", mergeable: "CONFLICTING" }] }).review[0]

    expect(failing?.actions).toEqual(["review"])
    expect(conflicting?.actions).toEqual(["review"])
  })
})

describe("mergeability", () => {
  test("not ready to merge while GitHub is still working it out", () => {
    const row = snapshotOf({ mine: [{ number: 1, reviewDecision: "APPROVED", mergeStateStatus: "UNKNOWN" }] }).mine[0]

    expect(row?.status).toEqual({ text: "Approved · Checking Mergeability", tone: "neutral" })
    expect(row?.actions).toEqual([])
  })

  test("ready when clean, or clean but for merge hooks", () => {
    for (const mergeStateStatus of ["CLEAN", "HAS_HOOKS"]) {
      expect(
        snapshotOf({ mine: [{ number: 1, reviewDecision: "APPROVED", mergeStateStatus }] }).mine[0]?.status.text
      ).toBe("Ready To Merge")
    }
  })

  test("ready when approved and only checks the base doesn't require fail: the failure shown, with Merge, Re-Run and Fix", () => {
    const row = mine({ reviewDecision: "APPROVED", ci: "FAILURE", mergeStateStatus: "UNSTABLE" })

    expect(row.status).toEqual({ text: "Ready To Merge", tone: "success" })
    expect(row.stage).toBe("ready")
    expect(row.details).toContainEqual({ text: "CI ✗", tone: "error", mark: "✗", href: `${row.url}/checks` })
    expect(row.actions).toEqual(["rerun", "fixCi", "merge"])
    expect(row.primary).toBe("merge")
  })

  test("CI failing where a required check fails, or nobody approved yet, however GitHub sums it up", () => {
    expect(mine({ reviewDecision: "APPROVED", ci: "FAILURE", mergeStateStatus: "BLOCKED" }).status.text).toBe(
      "CI Failing"
    )
    expect(mine({ ci: "FAILURE", mergeStateStatus: "UNSTABLE" }).status.text).toBe("CI Failing")
    expect(mine({ ci: "FAILURE", mergeStateStatus: "UNSTABLE" }).actions).toEqual(["rerun", "fixCi"])
  })
})

describe("a base that requires no review", () => {
  test("Merge on one nobody reviewed yet, once GitHub says it can merge and its checks are green; still waiting", () => {
    for (const mergeStateStatus of ["CLEAN", "HAS_HOOKS"]) {
      const row = mine({ requested: ["ann"], mergeStateStatus })

      expect(row.status).toEqual({ text: "Waiting For Review", tone: "neutral" })
      expect(row.actions).toEqual(["merge"])
      expect(row.primary).toBe(null)
    }
    expect(mine({ ci: null }).actions).toEqual(["merge"])
  })

  test("no Merge while checks run or fail, comments wait, GitHub can't merge it yet, or the viewer can't push", () => {
    expect(mine({ ci: "PENDING" }).actions).toEqual([])
    expect(mine({ ci: "FAILURE", mergeStateStatus: "UNSTABLE" }).actions).toEqual(["rerun", "fixCi"])
    expect(mine({ mergeStateStatus: "UNKNOWN" }).actions).toEqual([])
    expect(mine({ mergeStateStatus: "BLOCKED" }).actions).toEqual([])
    expect(mine({ threads: [{ isResolved: false }] }).actions).toEqual(["resolve"])
    expect(mine(REVIEW_REQUIRED).actions).toEqual([])
    expect(snapshotOf({ merging: { permission: "READ" }, mine: [{ number: 1 }] }).mine[0]?.actions).toEqual([])
    expect(mine({ isAutoMergeOn: true }).actions).toEqual([])
  })

  test("a change request or a comment review is the author's to answer first", () => {
    const at = "2026-10-01T12:00:00Z"
    const changes = mine({ reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at }] })
    const comments = mine({ reviews: [{ login: "ann", state: "COMMENTED", at }], threads: [{ isResolved: false }] })

    expect(changes.status.text).toBe("Changes Requested")
    expect(changes.actions).not.toContain("merge")
    expect(comments.status.text).toBe("Comments To Address")
    expect(comments.actions).toEqual(["resolve"])
  })
})

describe("lists cut short", () => {
  test("says when a search found more than it returned", () => {
    expect(snapshotOf({ mine: [{ number: 1 }], totals: { mine: 42 } }).isCut).toEqual({
      mine: true,
      review: false,
      requested: false
    })
    expect(snapshotOf({ reviewed: [{ number: 2, author: "ann" }], totals: { reviewed: 31 } }).isCut).toEqual({
      mine: false,
      review: true,
      requested: false
    })
    expect(snapshotOf({ requested: [{ number: 2, author: "ann" }], totals: { requested: 31 } }).isCut).toEqual({
      mine: false,
      review: true,
      requested: true
    })
  })
})

describe("a deleted account", () => {
  test("its pull request names GitHub's stand-in", () => {
    const raw = JSON.parse(response({ requested: [{ number: 5 }] })) as {
      data: { requested: { nodes: { author: unknown }[] } }
    }
    raw.data.requested.nodes[0]!.author = null
    const result = readPulls(JSON.stringify(raw), "acme/app", 0, DEFAULTS)

    expect("snapshot" in result ? result.snapshot.review[0]?.author : null).toBe("ghost")
  })
})

describe("merge settings", () => {
  test("the methods the repository allows, the viewer's usual one first", () => {
    expect(snapshotOf({ merging: { squash: true, merge: true, rebase: true, usual: "REBASE" } }).merging).toEqual({
      methods: ["REBASE", "SQUASH", "MERGE"],
      isAutoMergeAllowed: false,
      canWrite: true,
      canRequestReviews: true,
      isUpdateSuggested: false
    })
    expect(
      snapshotOf({ merging: { squash: true, merge: false, usual: "MERGE", autoMerge: true, suggestUpdate: true } })
        .merging
    ).toEqual({
      methods: ["SQUASH"],
      isAutoMergeAllowed: true,
      canWrite: true,
      canRequestReviews: true,
      isUpdateSuggested: true
    })
  })
})

describe("isOnBranch", () => {
  const row = { number: 7, headRefName: "fix/menu", isCrossRepository: false }

  test("a pull request from this repository, by its head's name, or the name /prs checks it out as apart from it", () => {
    expect(isOnBranch(row, "fix/menu")).toBe(true)
    expect(isOnBranch(row, prBranch(7))).toBe(true)
    expect(isOnBranch(row, prBranch(8))).toBe(false)
    expect(isOnBranch(row, "main")).toBe(false)
    expect(isOnBranch(row, null)).toBe(false)
  })

  test("a fork's, only under the name /prs checks it out as, since its head's name may be one of ours", () => {
    const fork = { ...row, isCrossRepository: true }

    expect(isOnBranch(fork, prBranch(7))).toBe(true)
    expect(prBranch(7)).toBe("pr-7")
    // The person's own branch of the same name is not the fork's.
    expect(isOnBranch(fork, "fix/menu")).toBe(false)
  })
})

describe("what the query asks of GitHub", () => {
  test("the latest threads, as the newest comments are what matter", () => {
    expect(pullsQuery(true)).toContain("reviewThreads(last: 100) { nodes { isResolved isOutdated } }")
  })

  test("the stack each is in, as plain fields that cost no rate-limit points, unless the server has no stacks", () => {
    expect(pullsQuery(true)).toContain("stackEntry { position stack { number size } }")
    expect(pullsQuery(false)).not.toContain("stackEntry")
    // Otherwise the same query.
    expect(pullsQuery(false)).toBe(pullsQuery(true).replaceAll("  stackEntry { position stack { number size } }\n", ""))
  })

  test("the review lists without what only your own rows read, which GitHub takes long to work out", () => {
    const [own, review] = pullsQuery(true).split("fragment reviewPull on PullRequest {")
    for (const field of ["reviewDecision", "mergeStateStatus", "viewerCanEnableAutoMerge", "viewerCanUpdateBranch"]) {
      expect(own).toContain(field)
      expect(review).not.toContain(field)
    }
    expect(review).toContain("reviewRequests(first: 100)")
    expect(pullsQuery(true).match(/\.\.\.reviewPull/g)).toHaveLength(3)
  })

  test("a server without stacked pull requests says so in its own words", () => {
    const refused = (extensions: unknown) =>
      JSON.stringify({ errors: [{ extensions, message: "Field doesn't exist" }] })

    expect(isStackless(refused({ code: "undefinedField", typeName: "PullRequest", fieldName: "stackEntry" }))).toBe(
      true
    )
    expect(isStackless(refused({ code: "undefinedField", fieldName: "isDraft" }))).toBe(false)
    expect(isStackless(refused({ code: "RATE_LIMITED" }))).toBe(false)
    // An answer with data is no refusal, whatever else it says.
    expect(
      isStackless(
        JSON.stringify({ data: {}, errors: [{ extensions: { code: "undefinedField", fieldName: "stackEntry" } }] })
      )
    ).toBe(false)
    expect(isStackless("not json")).toBe(false)
    expect(isStackless("null")).toBe(false)
  })

  test("every review request, as a press reads them all from GitHub", () => {
    expect(pullsQuery(true)).toContain("reviewRequests(first: 100)")
  })
})

describe("a panel's rows", () => {
  test("one merged a moment ago is drawn merged where it was, once, before the list it was read in leaves it out", () => {
    const rows = snapshotOf({ mine: [{ number: 1 }, { number: 2 }, { number: 3 }] }).mine
    const merged = { number: 2, title: "Two", url: "", base: "main", index: 1, at: 0 }

    expect(ownEntries(rows, [merged]).map((entry) => `${entry.kind} ${entryNumber(entry)}`)).toEqual([
      "open 1",
      "merged 2",
      "open 3"
    ])
  })
})

describe("finding a pull request in the list", () => {
  const list = snapshotOf({
    mine: [{ number: 1, headRefName: "fix/menu" }, { number: 2 }],
    requested: [{ number: 3, author: "ann" }]
  })

  test("by number, in either group", () => {
    expect(rowOf(list, 1)?.number).toBe(1)
    expect(rowOf(list, 3)?.number).toBe(3)
    expect(rowOf(list, 4)).toBe(undefined)
    expect(rowOf(null, 1)).toBe(undefined)
  })

  test("by the branch the checkout is on, in either group", () => {
    const reviewing = snapshotOf({ requested: [{ number: 4, author: "ann", headRefName: "feature/x" }] })

    expect(pullOnBranch(list, "fix/menu")).toBe(1)
    expect(pullOnBranch(reviewing, "feature/x")).toBe(4)
    expect(pullOnBranch(list, "main")).toBe(null)
    expect(pullOnBranch(list, null)).toBe(null)
    expect(pullOnBranch(null, "fix/menu")).toBe(null)
  })

  test("without the ones merged from the pane, from the viewer's own list", () => {
    const merged = { number: 2, title: "B", url: "u", base: "main", index: 1, at: 0 }

    expect(withoutMerged(list, [merged]).mine.map((row) => row.number)).toEqual([1])
    expect(withoutMerged(list, [merged]).review).toEqual(list.review)
    expect(withoutMerged(list, [])).toBe(list)
  })
})

// Every field a fragment of the list query asks for, as its path from the pull request
// (`reviewThreads.nodes.isResolved`) under the name GitHub answers it by: an alias where one is given, and an inline
// fragment's fields as its parent's.
function queryPaths(query: string, fragment: Fragment): string[] {
  const start = query.indexOf("{", query.indexOf(`fragment ${fragment} on PullRequest`))
  const tokens =
    query
      .slice(start)
      .replace(/\([^)]*\)/g, " ")
      .match(/\.\.\.|\w+|[{}:]/g) ?? []
  const paths: string[] = []
  // The field each open selection belongs to, null for an inline fragment's.
  const open: (string | null)[] = []
  let last: string | null = null
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token === "...") {
      // `... on Type {`: the selection that follows adds to the field it sits in.
      index += 3
      open.push(null)
    } else if (token === "{") {
      open.push(last)
    } else if (token === "}") {
      open.pop()
      if (open.length === 0) {
        break
      }
    } else {
      // An alias names the field in the answer; the field it stands for follows its colon.
      if (tokens[index + 1] === ":") {
        index += 2
      }
      last = token
      paths.push([...open.slice(1).filter((each) => each !== null), token].join("."))
    }
  }

  return [...new Set(paths)].sort()
}

// The same paths, as an answer holds them: each key's, and those of every item in a list.
function answerPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => answerPaths(item, prefix))
  }
  if (typeof value !== "object" || value === null) {
    return []
  }

  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...answerPaths(child, `${prefix}${key}.`)])
}

function pathsIn(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => answerPaths(value)))].sort()
}

describe("the answers the tests and the demo read", () => {
  // The tests read the fixtures' answers and the demo its own, so a field the query stops asking for, renames, or asks
  // for in one fragment only would go unnoticed if they held more or less than GitHub sends.
  test("the fixtures hold exactly what each fragment of the query asks for, nested fields too", () => {
    const at = "2026-10-01T12:00:00Z"
    const full: PullFixture = {
      number: 1,
      size: { additions: 1, deletions: 1, files: 1 },
      stack: { number: 3, position: 1, size: 2 },
      isAutoMergeOn: true,
      threads: [{ isResolved: false, isOutdated: false }],
      reviews: [
        { login: "me", state: "COMMENTED", at },
        { login: "ann", state: "APPROVED", at }
      ],
      requested: ["bob"],
      requestedTeams: ["web"],
      comments: { count: 1, lastAuthor: "ann" }
    }

    for (const fragment of ["pull", "reviewPull"] as const) {
      expect(pathsIn([rawPull(full, {}, fragment, "me")])).toEqual(queryPaths(pullsQuery(true), fragment))
    }
  })

  test("the demo's hold nothing the query doesn't ask for, and every field it asks for at the top", () => {
    const data = (JSON.parse(demoAnswer(0)) as { data: Record<string, { nodes: object[] }> }).data
    const nodes = (groups: string[]) => groups.flatMap((group) => data[group]!.nodes)
    const top = (paths: string[]) => paths.filter((path) => !path.includes("."))

    for (const [fragment, groups] of [
      ["pull", ["mine"]],
      ["reviewPull", ["requested", "commented", "reviewed"]]
    ] as const) {
      const asked = queryPaths(pullsQuery(true), fragment)
      const held = pathsIn(nodes([...groups]))
      expect(held.filter((path) => !asked.includes(path))).toEqual([])
      expect(top(held)).toEqual(top(asked))
    }
  })
})
