// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { ALERT_KINDS } from "./alerts"
import {
  checkElsewhere,
  elsewhereAlerts,
  elsewhereQuery,
  elsewhereSummary,
  needsYou,
  nextElsewhere,
  readElsewhere,
  withPickedAt
} from "./elsewhere"
import type { ElsewhereHost, ElsewherePull, ElsewhereState } from "./elsewhere"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { fakeHost } from "./testing/git-host"

const WEB = { host: "github.com", name: "acme/web" }
const ADMIN = { host: "github.com", name: "acme/admin" }
const HOUR = 60 * 60_000

// A pull request as GitHub's search answers it: `mine` the viewer's own, else one asking their review.
function node(name: string, number: number, fields: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/${name}/pull/${number}`,
    author: { login: "me" },
    repository: { nameWithOwner: name },
    statusCheckRollup: { state: "SUCCESS" },
    ...fields
  }
}

function answer(mine: unknown[], requested: unknown[], counts: { mine?: number; requested?: number } = {}): string {
  return JSON.stringify({
    data: {
      viewer: { login: "me" },
      mine: { issueCount: counts.mine ?? mine.length, nodes: mine },
      requested: { issueCount: counts.requested ?? requested.length, nodes: requested }
    }
  })
}

function pull(repo: typeof WEB, number: number, fields: Partial<ElsewherePull> = {}): ElsewherePull {
  return {
    repo,
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo.name}/pull/${number}`,
    author: "me",
    isMine: true,
    isRequested: false,
    ci: "SUCCESS",
    reviews: {},
    ...fields
  }
}

function stateOf(pulls: ElsewherePull[], isCut = { mine: false, requested: false }): ElsewhereState {
  return nextElsewhere(null, { viewer: "me", pulls, isCut }, 0)
}

describe("the light check's request", () => {
  test("asks for the viewer and two searches of open pull requests, the folder's repository left out", () => {
    const query = elsewhereQuery({ host: "github.com", name: "acme/app" })

    expect(query).toContain("viewer { login }")
    expect(query).toContain('"is:pr is:open archived:false sort:updated-desc author:@me -repo:acme/app"')
    expect(query).toContain('"is:pr is:open archived:false sort:updated-desc review-requested:@me -repo:acme/app"')
    expect(query).toContain("first: 30")
    expect(query).toContain("latestReviews(first: 20)")
    expect(query).toContain("reviewRequests(first: 100)")
    expect(query).toContain("viewerLatestReview")
    expect(query).toContain("isDraft")
    expect(elsewhereQuery(null)).not.toContain("-repo:")
  })
})

describe("reading its answer", () => {
  test("an answer that is no object, as gh printing null, is none to read", () => {
    expect(readElsewhere("null", "github.com")).toBe(null)
  })

  test("reads both searches, the viewer and authors; a pull request it couldn't read costs no other", () => {
    const read = readElsewhere(
      answer(
        [
          node("acme/web", 12, {
            statusCheckRollup: { state: "FAILURE" },
            latestReviews: {
              nodes: [
                {
                  author: { __typename: "User", login: "ann" },
                  state: "APPROVED",
                  submittedAt: "2026-10-23T10:00:00Z"
                },
                { author: { __typename: "User", login: "me" }, state: "COMMENTED", submittedAt: "2026-10-23T09:00:00Z" }
              ]
            }
          }),
          null,
          { title: "no number" },
          { number: 40, title: "no repository" }
        ],
        [
          node("acme/admin", 3, {
            author: { login: "bo" },
            reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] }
          })
        ]
      ),
      "github.com"
    )

    expect(read).toEqual({
      viewer: "me",
      pulls: [
        pull(WEB, 12, {
          ci: "FAILURE",
          reviews: { ann: { state: "APPROVED", at: "2026-10-23T10:00:00Z", isBot: false } }
        }),
        pull(ADMIN, 3, { author: "bo", isMine: false, isRequested: true })
      ],
      isCut: { mine: false, requested: false }
    })
  })

  test("a request to a team of the viewer's counts until the viewer reviews, or starts to; after, only one by name", () => {
    const teamOnly = { reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", slug: "web" } }] } }
    const reviewed = { viewerLatestReview: { state: "COMMENTED", submittedAt: "2026-10-23T09:00:00Z" } }
    const drafting = { viewerLatestReview: { state: "PENDING", submittedAt: null } }
    const requested = readElsewhere(
      answer(
        [],
        [
          node("acme/web", 1, teamOnly),
          node("acme/web", 2, { ...teamOnly, ...reviewed }),
          node("acme/web", 3, { ...teamOnly, ...drafting })
        ]
      ),
      "github.com"
    )

    expect(requested?.pulls.map((each) => each.isRequested)).toEqual([true, false, false])
  })

  test("with drafts hidden, your own drafts are left out, as the folder's list leaves them out", () => {
    const json = answer([node("acme/web", 1, { isDraft: true }), node("acme/web", 2)], [])

    expect(readElsewhere(json, "github.com", { isHidingDrafts: true })?.pulls.map((each) => each.number)).toEqual([2])
    expect(readElsewhere(json, "github.com")?.pulls.map((each) => each.number)).toEqual([1, 2])
  })

  test("says where a search was cut at 30; an answer it can't read is none", () => {
    expect(readElsewhere(answer([], [], { mine: 31 }), "github.com")?.isCut).toEqual({ mine: true, requested: false })
    expect(readElsewhere("not json", "github.com")).toBe(null)
    expect(readElsewhere(JSON.stringify({ errors: [{ message: "bad" }] }), "github.com")).toBe(null)
  })
})

describe("what it alerts", () => {
  const KINDS = [...ALERT_KINDS]

  test("against no state, nothing: the first check only sets what is known", () => {
    expect(elsewhereAlerts(null, [pull(WEB, 12, { ci: "FAILURE" })], KINDS)).toEqual([])
  })

  test("a new review request, an approval, changes requested, CI failing: one batch per pull request, as the list words it", () => {
    const before = stateOf([pull(WEB, 12, { ci: "PENDING" }), pull(WEB, 13)])
    const approval = { state: "APPROVED", at: "2026-10-23T10:00:00Z", isBot: false }
    const changes = { state: "CHANGES_REQUESTED", at: "2026-10-23T10:05:00Z", isBot: false }

    const batches = elsewhereAlerts(
      before,
      [
        pull(WEB, 12, { ci: "FAILURE", reviews: { ann: approval } }),
        pull(WEB, 13, { reviews: { bo: changes } }),
        pull(ADMIN, 3, { author: "bo", isMine: false, isRequested: true })
      ],
      KINDS
    )

    expect(batches).toEqual([
      {
        kind: "events",
        from: "check",
        repo: WEB,
        events: [
          { kind: "ci", number: 12, title: "PR 12", by: null, symbol: "✗", event: "CI failed" },
          { kind: "reviews", number: 12, title: "PR 12", by: null, symbol: "✓", event: "approved by ann" }
        ]
      },
      {
        kind: "events",
        from: "check",
        repo: WEB,
        events: [
          { kind: "reviews", number: 13, title: "PR 13", by: null, symbol: "±", event: "changes requested by bo" }
        ]
      },
      {
        kind: "events",
        from: "check",
        repo: ADMIN,
        events: [{ kind: "reviewRequests", number: 3, title: "PR 3", by: "bo", symbol: "⌕", event: "review requested" }]
      }
    ])
  })

  test("a second reviewer's approval is told by its own; a kind turned off is not", () => {
    const ann = { state: "APPROVED", at: "2026-10-23T10:00:00Z", isBot: false }
    const bo = { state: "APPROVED", at: "2026-10-23T11:00:00Z", isBot: false }
    const before = stateOf([pull(WEB, 12, { reviews: { ann } })])
    const after = [pull(WEB, 12, { reviews: { ann, bo }, ci: "FAILURE" })]

    expect(elsewhereAlerts(before, after, ["reviews"])).toEqual([
      {
        kind: "events",
        from: "check",
        repo: WEB,
        events: [{ kind: "reviews", number: 12, title: "PR 12", by: null, symbol: "✓", event: "approved by bo" }]
      }
    ])
  })

  test("CI on a pull request asking your review is not yours to be told", () => {
    const before = stateOf([pull(ADMIN, 3, { isMine: false, isRequested: true, ci: "PENDING" })])

    expect(
      elsewhereAlerts(before, [pull(ADMIN, 3, { isMine: false, isRequested: true, ci: "FAILURE" })], KINDS)
    ).toEqual([])
  })

  test("a request is no news where the search before was cut and didn't know the pull request", () => {
    const before = stateOf([], { mine: false, requested: true })
    const after = [pull(ADMIN, 3, { isMine: false, isRequested: true })]

    expect(elsewhereAlerts(before, after, KINDS)).toEqual([])
  })

  test("a review asked again after you reviewed, within the day, is told", () => {
    const asked = stateOf([pull(ADMIN, 3, { isMine: false, isRequested: true })])
    // Your review drops the request: the search, not cut, finds it no more.
    const reviewed = nextElsewhere(asked, { viewer: "me", pulls: [], isCut: { mine: false, requested: false } }, HOUR)
    const again = [pull(ADMIN, 3, { isMine: false, isRequested: true })]

    expect(elsewhereAlerts(reviewed, again, KINDS)).toEqual([
      {
        kind: "events",
        from: "check",
        repo: ADMIN,
        events: [{ kind: "reviewRequests", number: 3, title: "PR 3", by: "me", symbol: "⌕", event: "review requested" }]
      }
    ])
  })

  test("your own missing from a search not cut is closed: back, it is known again from nothing", () => {
    const known = stateOf([pull(WEB, 12, { ci: "FAILURE" })])
    const closed = nextElsewhere(known, { viewer: "me", pulls: [], isCut: { mine: false, requested: false } }, HOUR)

    expect(closed.pulls).toEqual({})
  })

  test("a pull request leaving the 30 and coming back tells only what changed meanwhile", () => {
    const known = stateOf([pull(WEB, 12, { ci: "FAILURE" })])
    const gone = nextElsewhere(known, { viewer: "me", pulls: [], isCut: { mine: true, requested: false } }, HOUR)

    expect(elsewhereAlerts(gone, [pull(WEB, 12, { ci: "FAILURE" })], KINDS)).toEqual([])
    expect(elsewhereAlerts(gone, [pull(WEB, 12, { ci: "SUCCESS" })], KINDS)).toEqual([
      {
        kind: "events",
        from: "check",
        repo: WEB,
        events: [{ kind: "ci", number: 12, title: "PR 12", by: null, symbol: "✓", event: "CI passed" }]
      }
    ])
  })
})

describe("what it keeps", () => {
  test("each pull request's last state, when it was last seen and last changed, a day after it was last seen", () => {
    const first = nextElsewhere(
      null,
      { viewer: "me", pulls: [pull(WEB, 12)], isCut: { mine: false, requested: false } },
      0
    )
    const same = nextElsewhere(
      first,
      { viewer: "me", pulls: [pull(WEB, 12)], isCut: { mine: false, requested: false } },
      HOUR
    )
    const changed = nextElsewhere(
      same,
      { viewer: "me", pulls: [pull(WEB, 12, { ci: "FAILURE" })], isCut: { mine: false, requested: false } },
      2 * HOUR
    )

    expect(same.pulls["github.com/acme/web#12"]).toMatchObject({ seenAt: HOUR, changedAt: 0 })
    expect(changed.pulls["github.com/acme/web#12"]).toMatchObject({ seenAt: 2 * HOUR, changedAt: 2 * HOUR })
    // Past a search cut at 30, it is kept a day after it was last seen.
    const cut = { mine: true, requested: false }
    expect(Object.keys(nextElsewhere(changed, { viewer: "me", pulls: [], isCut: cut }, 25 * HOUR).pulls)).toEqual([
      "github.com/acme/web#12"
    ])
    const later = nextElsewhere(changed, { viewer: "me", pulls: [], isCut: cut }, 26 * HOUR)
    expect(later.pulls).toEqual({})
    expect(later.at).toBe(26 * HOUR)
  })

  test("at most 200, the latest seen", () => {
    const older = Array.from({ length: 10 }, (_, index) => pull(ADMIN, index + 1))
    const known = nextElsewhere(null, { viewer: "me", pulls: older, isCut: { mine: true, requested: false } }, 0)
    const newer = Array.from({ length: 195 }, (_, index) => pull(WEB, index + 1))
    const kept = nextElsewhere(known, { viewer: "me", pulls: newer, isCut: { mine: true, requested: false } }, HOUR)

    expect(Object.keys(kept.pulls)).toHaveLength(200)
    expect(Object.values(kept.pulls).filter((each) => each.repo.name === "acme/web")).toHaveLength(195)
  })

  test("when the picker was last opened stays from check to check", () => {
    const opened = { ...stateOf([pull(WEB, 12)]), pickedAt: 5 }

    expect(
      nextElsewhere(opened, { viewer: "me", pulls: [], isCut: { mine: false, requested: false } }, HOUR).pickedAt
    ).toBe(5)
  })

  test("another account's state is no state to compare with", () => {
    const before = { ...stateOf([pull(WEB, 12), pull(WEB, 13)]), pickedAt: 5 }
    const other = nextElsewhere(
      before,
      { viewer: "you", pulls: [pull(WEB, 12)], isCut: { mine: false, requested: false } },
      HOUR
    )

    expect(other.pulls["github.com/acme/web#12"]).toMatchObject({ changedAt: HOUR })
    expect(other.pulls["github.com/acme/web#13"]).toBe(undefined)
    expect(other.pickedAt).toBe(null)
    expect(other.viewer).toBe("you")
  })
})

describe("what waits for you", () => {
  test("a review asked of you, and your own with CI failing, changes requested or an approval", () => {
    const approval = { state: "APPROVED", at: "t", isBot: false }
    const changes = { state: "CHANGES_REQUESTED", at: "t", isBot: false }

    expect(needsYou(pull(WEB, 1, { isMine: false, isRequested: true }))).toBe(true)
    expect(needsYou(pull(WEB, 2, { ci: "FAILURE" }))).toBe(true)
    expect(needsYou(pull(WEB, 3, { reviews: { bo: changes } }))).toBe(true)
    expect(needsYou(pull(WEB, 4, { reviews: { bo: approval } }))).toBe(true)
    expect(needsYou(pull(WEB, 5))).toBe(false)
    expect(needsYou(pull(WEB, 6, { ci: "PENDING", reviews: { bo: approval } }))).toBe(false)
    expect(needsYou(pull(WEB, 7, { reviews: { bot: { ...approval, isBot: true } } }))).toBe(false)
  })

  test("one line names how many and where, or none", () => {
    const waiting = [
      pull(WEB, 1, { ci: "FAILURE" }),
      pull({ host: "github.com", name: "acme/ios-app" }, 2, { isMine: false, isRequested: true }),
      pull(ADMIN, 3, { isMine: false, isRequested: true }),
      pull(WEB, 4, { ci: "FAILURE" }),
      pull(WEB, 5)
    ]

    expect(elsewhereSummary(waiting)).toBe("4 waiting in other repositories: acme/admin, acme/ios-app, acme/web")
    expect(elsewhereSummary([pull(WEB, 1, { ci: "FAILURE" })])).toBe("1 waiting in another repository: acme/web")
    expect(elsewhereSummary([pull(WEB, 5)])).toBe(null)
  })
})

describe("when the repository picker was last opened", () => {
  test("opening it marks the state kept; before any check there is none to mark", () => {
    const kept = stateOf([pull(WEB, 12)])

    expect(withPickedAt(kept, 500)).toEqual({ ...kept, pickedAt: 500 })
    expect(withPickedAt(null, 500)).toBe(null)
    expect(withPickedAt({ viewer: "me" }, 500)).toEqual({ viewer: "me" })
  })

  // A check of a folder in acme/app over a state kept with the picker opened at 100, the picker opening again at 500
  // where `isOpenedMeanwhile`: after the check read the state, before it writes.
  async function checkedOver(isOpenedMeanwhile: boolean): Promise<ElsewhereState | null> {
    let kept: ElsewhereState | null = { ...stateOf([pull(WEB, 12)]), pickedAt: 100 }
    const host: ElsewhereHost = {
      ...fakeHost([["gh api graphql", { stdout: answer([node("acme/web", 12)], []) }]]).host,
      now: async () => {
        if (isOpenedMeanwhile) {
          kept = kept && { ...kept, pickedAt: 500 }
        }

        return HOUR
      },
      log: () => {},
      state: async () => kept,
      changeState: async (change) => {
        kept = change(kept)
      },
      announce: async () => {}
    }
    const session = createSession(readSettings({ alertOtherRepos: true }))
    session.repo = { host: "github.com", name: "acme/app" }

    await checkElsewhere(host, session)

    return kept
  }

  test("the first check's summary is a line the light check told, so the toasts lead with it", async () => {
    const told: unknown[] = []
    const host: ElsewhereHost = {
      ...fakeHost([
        ["gh api graphql", { stdout: answer([node("acme/web", 12, { statusCheckRollup: { state: "FAILURE" } })], []) }]
      ]).host,
      now: async () => HOUR,
      log: () => {},
      state: async () => null,
      changeState: async () => {},
      announce: async (batches) => {
        told.push(...batches)
      }
    }
    const session = createSession(readSettings({ alertOtherRepos: true }))
    session.repo = { host: "github.com", name: "acme/app" }

    await checkElsewhere(host, session)

    expect(told).toEqual([
      { kind: "line", repo: session.repo, line: "1 waiting in another repository: acme/web", from: "check" }
    ])
  })

  test("a check's write keeps the later opening, as the picker may open while it runs", async () => {
    expect((await checkedOver(true))?.pickedAt).toBe(500)
    expect((await checkedOver(false))?.pickedAt).toBe(100)
    expect((await checkedOver(false))?.at).toBe(HOUR)
  })
})
