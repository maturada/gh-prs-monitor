// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { PullsSnapshot } from "../types"
import { createSession } from "./session"
import { readSettings } from "./settings"
import {
  askSuggestions,
  readSuggestions,
  suggestionsFor,
  suggestionsQuery,
  wantsSuggestions,
  withRequestReview
} from "./suggestions"
import type { SuggestionsHost } from "./suggestions"
import { REPO, snapshotOf } from "./testing/fixtures"
import type { PullFixture } from "./testing/fixtures"
import { hostAnswering } from "./testing/git-host"
import type { Ran } from "./testing/git-host"
import { promisesRun } from "./testing/promises"
import { clockOf, machine, MINUTE, startSession } from "./testing/world"
import type { World } from "./testing/world"

// Request Review's two kinds of row, nobody asked yet and more approvals needed, and two that want nothing.
const UNASKED: PullFixture = { number: 12, headRefOid: "head-12" }
const MORE_APPROVALS: PullFixture = {
  number: 13,
  headRefOid: "head-13",
  reviewDecision: "REVIEW_REQUIRED",
  mergeStateStatus: "BLOCKED",
  reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-01T12:00:00Z" }],
  requested: ["bob"]
}
const REQUESTED: PullFixture = { number: 14, requested: ["ann"] }
const DRAFT: PullFixture = { number: 15, isDraft: true }
const QUEUED: PullFixture = { number: 17, isInMergeQueue: true }

// GitHub's answer for each pull request asked about, by number: whom it suggests, the author among them, who is
// requested, and whose latest verdict approved, or requested changes.
type Asked = { suggested?: string[]; author?: string; requested?: string[]; approved?: string[]; changesBy?: string[] }

function answerOf(pulls: Record<number, Asked | null>): string {
  const repository = Object.fromEntries(
    Object.entries(pulls).map(([number, pull]) => [
      `pull${number}`,
      pull && {
        suggestedReviewers: [
          ...(pull.author ? [{ isAuthor: true, reviewer: { login: pull.author } }] : []),
          ...(pull.suggested ?? []).map((login) => ({ isAuthor: false, reviewer: { login } }))
        ],
        reviewRequests: { nodes: (pull.requested ?? []).map((login) => ({ requestedReviewer: { login } })) },
        latestOpinionatedReviews: {
          nodes: [
            ...(pull.approved ?? []).map((login) => ({ state: "APPROVED", author: { login } })),
            ...(pull.changesBy ?? []).map((login) => ({ state: "CHANGES_REQUESTED", author: { login } }))
          ]
        }
      }
    ])
  )

  return JSON.stringify({ data: { repository } })
}

// A host whose GitHub answers the suggestions with `answer`, keeping each request, the debug log, and the redraws.
function hostOf(answer: () => Ran) {
  const log: string[] = []
  let redraws = 0
  const git = hostAnswering(() => answer())
  const host: SuggestionsHost = { ...git, log: (line) => void log.push(line), redraw: () => void redraws++ }
  // The pull requests each request asked about, by the query's aliases.
  const asked = () =>
    git.runs.map((run) =>
      [...(run.argv.find((word) => word.startsWith("query="))?.matchAll(/pull(\d+):/g) ?? [])].map((match) =>
        Number(match[1])
      )
    )

  return { host, log, asked, redraws: () => redraws }
}

function sessionOf() {
  return createSession(readSettings({}))
}

function rowOf(snapshot: PullsSnapshot, number: number) {
  const row = [...snapshot.mine, ...snapshot.review].find((each) => each.number === number)
  if (!row) {
    throw new Error(`no row ${number}`)
  }

  return row
}

describe("which rows want GitHub's suggestions", () => {
  test("the viewer's own, up for review, nobody asked yet or more approvals needed, where they may request reviews", () => {
    const snapshot = snapshotOf({
      mine: [UNASKED, MORE_APPROVALS, REQUESTED, DRAFT, QUEUED],
      requested: [{ number: 16, author: "ann" }]
    })

    // One in the merge queue is on its way to merge: asking for a review there is noise.
    expect(rowOf(snapshot, 17).isReviewerUnrequested).toBe(true)
    expect([12, 13, 14, 15, 16, 17].filter((number) => wantsSuggestions(snapshot, rowOf(snapshot, number)))).toEqual([
      12, 13
    ])
    const readOnly = snapshotOf({ mine: [UNASKED], merging: { permission: "READ" } })
    expect(wantsSuggestions(readOnly, rowOf(readOnly, 12))).toBe(false)
  })
})

describe("GitHub's suggestions", () => {
  test("one request names each pull request asked about, by its number", () => {
    const query = suggestionsQuery([12, 13])

    expect(query).toContain("pull12: pullRequest(number: 12)")
    expect(query).toContain("pull13: pullRequest(number: 13)")
    expect(query).toContain("suggestedReviewers")
  })

  test("its answer: the people suggested, in GitHub's order, but the author, anyone requested and anyone who approved, four at most", () => {
    const answer = answerOf({
      12: { suggested: ["kim", "lou"], author: "me" },
      13: {
        suggested: ["ann", "bob", "cy", "dee", "eve", "fay", "gus"],
        requested: ["bob"],
        approved: ["ann"],
        changesBy: ["cy"]
      },
      14: null
    })

    expect(readSuggestions(answer, [12, 13, 14])).toEqual(
      new Map([
        [12, ["kim", "lou"]],
        [13, ["cy", "dee", "eve", "fay"]],
        [14, []]
      ])
    )
  })

  test("a team requested names no one", () => {
    const answer = JSON.stringify({
      data: {
        repository: {
          pull12: {
            suggestedReviewers: [{ isAuthor: false, reviewer: { login: "ann" } }],
            reviewRequests: { nodes: [{ requestedReviewer: {} }] },
            latestOpinionatedReviews: { nodes: [] }
          }
        }
      }
    })

    expect(readSuggestions(answer, [12])).toEqual(new Map([[12, ["ann"]]]))
  })

  test("an answer that can't be read is none", () => {
    expect(readSuggestions("not json", [12])).toBeNull()
    expect(readSuggestions(JSON.stringify({ data: { repository: null } }), [12])).toBeNull()
  })
})

describe("asking for them after a load", () => {
  const LIST = snapshotOf({ mine: [UNASKED, MORE_APPROVALS, REQUESTED] })

  test("asks once for every row that wants them, keeps the answers for each row's head, and draws the pane again", async () => {
    const session = sessionOf()
    const { host, asked, redraws } = hostOf(() => ({
      exitCode: 0,
      stdout: answerOf({ 12: { suggested: ["kim"] }, 13: { suggested: ["cy"], approved: ["ann"] } })
    }))

    await askSuggestions(host, session, REPO, LIST)
    expect(asked()).toEqual([[12, 13]])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 12))).toEqual(["kim"])
    // Read for a row whose head moved since, or that wants them no more, before a load forgets them: none.
    const moved = snapshotOf({ mine: [{ ...UNASKED, headRefOid: "head-12b" }] })
    expect(suggestionsFor(session, moved, rowOf(moved, 12))).toEqual([])
    const readOnly = { ...LIST, merging: { ...LIST.merging, canRequestReviews: false } }
    expect(suggestionsFor(session, readOnly, rowOf(readOnly, 12))).toEqual([])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 13))).toEqual(["cy"])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 14))).toEqual([])
    expect(redraws()).toBe(1)

    await askSuggestions(host, session, REPO, LIST)
    expect(asked()).toHaveLength(1)
  })

  test("asks nothing where no row wants them", async () => {
    const { host, asked } = hostOf(() => ({ exitCode: 0, stdout: answerOf({}) }))

    await askSuggestions(host, sessionOf(), REPO, snapshotOf({ mine: [REQUESTED, DRAFT] }))
    expect(asked()).toEqual([])
  })

  test("asks again for a row whose head moved, and forgets a row that wants them no more", async () => {
    const session = sessionOf()
    const { host, asked } = hostOf(() => ({ exitCode: 0, stdout: answerOf({ 12: { suggested: ["kim"] } }) }))
    await askSuggestions(host, session, REPO, LIST)

    const moved = snapshotOf({ mine: [{ ...UNASKED, headRefOid: "head-12b" }, MORE_APPROVALS] })
    await askSuggestions(host, session, REPO, moved)
    expect(asked()).toEqual([[12, 13], [12]])

    const asked12 = snapshotOf({ mine: [{ ...UNASKED, headRefOid: "head-12b", requested: ["kim"] }] })
    await askSuggestions(host, session, REPO, asked12)
    expect(suggestionsFor(session, moved, rowOf(moved, 12))).toEqual([])
    // Forgotten, not only passed over: wanting them again, they are asked again.
    await askSuggestions(host, session, REPO, moved)
    expect(asked()).toEqual([[12, 13], [12], [12, 13]])
  })

  // A host whose requests each wait to be let go (`releases`, in the order asked), GitHub answering them in that order.
  function heldHost(answers: Ran[]) {
    const { host } = hostOf(() => answers.shift() ?? { exitCode: 0, stdout: answerOf({}) })
    const releases: (() => void)[] = []
    const held: SuggestionsHost = {
      ...host,
      run: async (argv, init) => {
        const ran = await host.run(argv, init)
        await new Promise<void>((resolve) => releases.push(resolve))

        return ran
      }
    }

    return { host: held, releases }
  }

  test("an answer that comes after its row's head moved is dropped; the move's own is kept", async () => {
    const session = sessionOf()
    const { host, releases } = heldHost([
      { exitCode: 0, stdout: answerOf({ 12: { suggested: ["before"] } }) },
      { exitCode: 0, stdout: answerOf({ 12: { suggested: ["after"] } }) }
    ])
    const moved = snapshotOf({ mine: [{ ...UNASKED, headRefOid: "head-12b" }] })

    const first = askSuggestions(host, session, REPO, snapshotOf({ mine: [UNASKED] }))
    const second = askSuggestions(host, session, REPO, moved)
    await promisesRun(20)
    releases[1]?.()
    await second
    releases[0]?.()
    await first
    expect(suggestionsFor(session, moved, rowOf(moved, 12))).toEqual(["after"])
  })

  test("a request's answer, or its failure, touches only what it set aside: a later load's for the same row keeps its own", async () => {
    const session = sessionOf()
    const { host, releases } = heldHost([
      { exitCode: 1, stderr: "error connecting to api.github.com" },
      { exitCode: 0, stdout: answerOf({ 12: { suggested: ["kim"] } }) }
    ])
    const only12 = snapshotOf({ mine: [UNASKED] })

    const first = askSuggestions(host, session, REPO, only12)
    // The row wants none for a moment, then wants them again at the same head, so a later load asks anew.
    await askSuggestions(host, session, REPO, snapshotOf({ mine: [REQUESTED] }))
    const third = askSuggestions(host, session, REPO, only12)
    await promisesRun(20)
    releases[0]?.()
    await first
    releases[1]?.()
    await third
    expect(suggestionsFor(session, only12, rowOf(only12, 12))).toEqual(["kim"])
  })

  test("a row asked about already is not asked again while its answer comes", async () => {
    const session = sessionOf()
    let release = () => {}
    const { host, asked } = hostOf(() => ({ exitCode: 0, stdout: answerOf({ 12: { suggested: ["kim"] } }) }))
    const slow: SuggestionsHost = {
      ...host,
      run: (argv, init) => new Promise((resolve) => (release = () => resolve(host.run(argv, init))))
    }

    const first = askSuggestions(slow, session, REPO, LIST)
    await askSuggestions(slow, session, REPO, LIST)
    release()
    await first
    expect(asked()).toEqual([[12, 13]])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 12))).toEqual(["kim"])
  })

  test("a failed request is said in the debug log, keeps nothing, and is asked again by the next load", async () => {
    const session = sessionOf()
    let answer: Ran = { exitCode: 1, stderr: "error connecting to api.github.com" }
    const { host, log, asked, redraws } = hostOf(() => answer)

    await askSuggestions(host, session, REPO, LIST)
    expect(log).toHaveLength(1)
    expect(log[0]).toContain("suggest")
    expect(suggestionsFor(session, LIST, rowOf(LIST, 12))).toEqual([])
    expect(redraws()).toBe(0)

    answer = { exitCode: 0, stdout: answerOf({ 12: { suggested: ["kim"] } }) }
    await askSuggestions(host, session, REPO, LIST)
    expect(asked()).toEqual([
      [12, 13],
      [12, 13]
    ])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 12))).toEqual(["kim"])
  })

  test("GitHub's errors beside its data leave the answers it gave: one pull request it couldn't find costs no other", async () => {
    const session = sessionOf()
    const answer = JSON.parse(answerOf({ 12: { suggested: ["kim"] }, 13: null })) as object
    const { host, log } = hostOf(() => ({
      exitCode: 1,
      stdout: JSON.stringify({
        ...answer,
        errors: [{ type: "NOT_FOUND", message: "Could not resolve to a PullRequest" }]
      }),
      stderr: "gh: Could not resolve to a PullRequest with the number of 13."
    }))

    await askSuggestions(host, session, REPO, LIST)
    expect(suggestionsFor(session, LIST, rowOf(LIST, 12))).toEqual(["kim"])
    expect(suggestionsFor(session, LIST, rowOf(LIST, 13))).toEqual([])
    expect(log).toEqual([])
  })

  test("another repository's answers are its own", async () => {
    const session = sessionOf()
    const { host } = hostOf(() => ({ exitCode: 0, stdout: answerOf({ 12: { suggested: ["kim"] } }) }))
    await askSuggestions(host, session, REPO, LIST)

    const other = { ...LIST, repo: "acme/web" }
    expect(suggestionsFor(session, other, rowOf(other, 12))).toEqual([])
  })
})

describe("Request Review on the rows drawn", () => {
  test("on each row GitHub suggests someone for, after its own buttons, the main one where its stage puts it first", () => {
    const list = snapshotOf({ mine: [UNASKED, MORE_APPROVALS, REQUESTED] })
    const drawn = withRequestReview(list, (row) => (row.number === 14 ? [] : ["ann"]))

    expect(rowOf(drawn, 12).actions).toEqual([...rowOf(list, 12).actions, "requestReview"])
    expect(rowOf(drawn, 12).primary).toBe("requestReview")
    expect(rowOf(drawn, 13).actions).toEqual([...rowOf(list, 13).actions, "requestReview"])
    expect(rowOf(drawn, 13).primary).toBe("requestReview")
    expect(rowOf(drawn, 14)).toBe(rowOf(list, 14))
  })

  test("more approvals needed: asking someone comes before Auto-Merge", () => {
    const list = snapshotOf({ mine: [{ ...MORE_APPROVALS, canEnableAutoMerge: true }] })
    const drawn = withRequestReview(list, () => ["ann"])

    expect(rowOf(list, 13).primary).toBe("autoMerge")
    expect(rowOf(drawn, 13).actions).toEqual(["autoMerge", "requestReview"])
    expect(rowOf(drawn, 13).primary).toBe("requestReview")
  })

  test("a row whose stage puts another button first keeps it the main one", () => {
    const failing = snapshotOf({ mine: [{ ...UNASKED, ci: "FAILURE" }] })
    const drawn = withRequestReview(failing, () => ["ann"])

    expect(rowOf(failing, 12).isReviewerUnrequested).toBe(true)
    expect(rowOf(drawn, 12).actions).toContain("requestReview")
    expect(rowOf(drawn, 12).primary).toBe("rerun")
  })
})

describe("in the plugin", () => {
  test("a load asks GitHub for its suggestions on a row nobody was asked to review, once per head", async ($, on) => {
    const clock = clockOf(on)
    const unasked = { number: 3, title: "Add the map", headRefOid: "h3" }
    const world: World = { github: { mine: [unasked] }, branch: "main", uncommitted: 0, suggested: { 3: ["ann"] } }
    const seen = machine($, on, world, clock)
    const asked = () => seen.runs.filter((line) => line.includes("suggestedReviewers")).length
    await startSession($)
    await clock.settle()
    expect(asked()).toBe(1)

    await clock.advance(3 * MINUTE)
    expect(asked()).toBe(1)

    world.github = { mine: [{ ...unasked, headRefOid: "h3b" }] }
    await clock.advance(3 * MINUTE)
    expect(asked()).toBe(2)
  })
})
