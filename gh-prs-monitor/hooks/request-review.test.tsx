// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { createSession } from "./session"
import { readSettings } from "./settings"
import { REPO, snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import { fakePressHost } from "./testing/press-host"
import { clockOf, drawnNodes, machine, mountPane, runPrs, startSession } from "./testing/world"
import type { World } from "./testing/world"
import { requestReview } from "./writes"

// One of the viewer's own pull requests nobody was asked to review, and one approved that needs another approval.
const UNASKED: ResponseFixture = { mine: [{ number: 12, title: "Add the map", headRefOid: "h12" }] }
const MORE_APPROVALS: ResponseFixture = {
  mine: [
    {
      number: 13,
      title: "Cache the tiles",
      headRefOid: "h13",
      reviewDecision: "REVIEW_REQUIRED",
      mergeStateStatus: "BLOCKED",
      reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-07T13:20:00Z" }]
    }
  ]
}

const SUGGESTED = { 12: ["kim", "lou"], 13: ["kim", "lou"] }

const REQUEST = "gh api --method POST repos/acme/app/pulls/12/requested_reviewers --hostname github.com"

// The session started on `world`, its list and GitHub's suggestions loaded, and the pane drawn in the terminal.
async function loaded($: Parameters<typeof machine>[0], on: Parameters<typeof machine>[1], world: World) {
  const clock = clockOf(on)
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  const ui = await mountPane($, "terminal")

  return { clock, seen, ui }
}

describe("Request Review", () => {
  test("shows once GitHub suggests someone; those picked are asked, and the list is read again", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["lou"],
      answer: "Request Review"
    }
    const { clock, seen, ui } = await loaded($, on, world)
    const lists = () => seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = lists()

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(world.header).toBe("Request")
    expect(world.question).toBe("Who should review it?")
    expect(world.detail).toBe("GitHub suggests the people who last changed this code.")
    expect(world.choices).toEqual(["kim", "lou", "Select All", "Request Review", "Cancel"])
    expect(seen.runs).toContain(`${REQUEST} -f reviewers[]=lou`)
    expect(seen.toasts).toContain("#12: review requested from lou")
    expect(lists()).toBe(before + 1)
  })

  test("its question in the pane draws no field, so nothing typed picks anyone", async ($, on) => {
    const world: World = { github: UNASKED, branch: "main", uncommitted: 0, suggested: SUGGESTED }
    const { clock, ui } = await loaded($, on, world)

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    const nodes = drawnNodes(await ui.drawn())
    expect(nodes.some((node) => node.type === "Button" && node.props?.label === "Select All")).toBe(true)
    expect(nodes.some((node) => node.type === "Input")).toBe(false)
  })

  test("no button where GitHub suggests nobody", async ($, on) => {
    const { ui } = await loaded($, on, { github: UNASKED, branch: "main", uncommitted: 0 })

    expect(await ui.find({ key: "requestReview-12" })).toBeUndefined()
  })

  test("Cancel asks nobody", async ($, on) => {
    const world: World = { github: UNASKED, branch: "main", uncommitted: 0, suggested: SUGGESTED, picks: ["kim"] }
    world.answer = "Cancel"
    const { clock, seen, ui } = await loaded($, on, world)

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(world.asked).toBe(1)
    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
  })

  test("someone asked on GitHub while the question was open is left out; with everyone, nobody is asked twice", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim", "lou"],
      answer: "Request Review",
      whileAsking: () => (world.current = { 12: { requested: ["kim"] } })
    }
    const { clock, seen, ui } = await loaded($, on, world)

    await ui.press({ key: "requestReview-12" })
    await clock.settle()
    expect(seen.runs).toContain(`${REQUEST} -f reviewers[]=lou`)

    world.current = undefined
    world.picks = ["kim"]
    seen.toasts.length = 0
    await ui.press({ key: "requestReview-12" })
    await clock.settle()
    expect(seen.runs.filter((run) => run.includes("requested_reviewers"))).toHaveLength(1)
    expect(seen.toasts).toContain("#12: kim is asked to review it already; refreshing the list")
  })

  test("someone asked since GitHub suggested them is offered no more; with everyone, it asks nothing and says so", async ($, on) => {
    const world: World = { github: UNASKED, branch: "main", uncommitted: 0, suggested: SUGGESTED, answer: "Cancel" }
    const { clock, seen, ui } = await loaded($, on, world)

    world.current = { 12: { requested: ["kim"] } }
    await ui.press({ key: "requestReview-12" })
    await clock.settle()
    expect(world.choices).toEqual(["lou", "Select All", "Request Review", "Cancel"])

    world.current = { 12: { requested: ["kim", "lou"] } }
    await ui.press({ key: "requestReview-12" })
    await clock.settle()
    expect(world.asked).toBe(1)
    expect(seen.toasts).toContain("#12: kim and lou are asked to review it already; refreshing the list")
  })

  test("merged or turned into a draft while the question was open, it says so and asks nobody", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim"],
      answer: "Request Review",
      whileAsking: () => (world.current = { 12: { isDraft: true } })
    }
    const { clock, seen, ui } = await loaded($, on, world)

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
    expect(seen.toasts).toContain("#12 is a draft now; refreshing the list")
  })

  test("GitHub refusing anyone asks nobody, says so, and the button stays", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim"],
      answer: "Request Review",
      writeFailure: "gh: Reviews may only be requested from collaborators. (HTTP 422)"
    }
    const { clock, seen, ui } = await loaded($, on, world)

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(seen.toasts).toContain(
      "#12: nobody was asked: gh: Reviews may only be requested from collaborators. (HTTP 422)"
    )
    expect(await ui.find({ key: "requestReview-12" })).toBeDefined()
  })

  test("once asked, a row that still wants reviewers has GitHub asked afresh, so whoever was just asked isn't offered", async ($, on) => {
    const world: World = {
      github: MORE_APPROVALS,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim"],
      answer: "Request Review"
    }
    const { clock, seen, ui } = await loaded($, on, world)
    const suggestionRequests = () => seen.runs.filter((run) => run.includes("suggestedReviewers")).length
    const before = suggestionRequests()

    await ui.press({ key: "requestReview-13" })
    await clock.settle()

    expect(seen.runs).toContain(
      "gh api --method POST repos/acme/app/pulls/13/requested_reviewers --hostname github.com -f reviewers[]=kim"
    )
    expect(suggestionRequests()).toBe(before + 1)
  })

  test("everyone picked asked meanwhile: the names kept are out of date, so GitHub is asked afresh", async ($, on) => {
    const world: World = {
      github: MORE_APPROVALS,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim"],
      answer: "Request Review",
      whileAsking: () => (world.current = { 13: { requested: ["kim"] } })
    }
    const { clock, seen, ui } = await loaded($, on, world)
    const suggestionRequests = () => seen.runs.filter((run) => run.includes("suggestedReviewers")).length
    const before = suggestionRequests()

    await ui.press({ key: "requestReview-13" })
    await clock.settle()

    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
    expect(suggestionRequests()).toBe(before + 1)
  })

  test("where GitHub can't say how the pull request stands, the request goes, GitHub having the last word", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      picks: ["kim"],
      answer: "Request Review"
    }
    const { clock, seen, ui } = await loaded($, on, world)
    world.isLookupFailing = true

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(seen.runs).toContain(`${REQUEST} -f reviewers[]=kim`)
  })

  test("Claude Code's own dialog dismissed asks nobody", async ($, on) => {
    const world: World = { github: UNASKED, branch: "main", uncommitted: 0, suggested: SUGGESTED }
    const { clock, seen, ui } = await loaded($, on, world)
    world.isPaneOpen = false

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(world.asked).toBe(1)
    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
  })

  test("where the pane doesn't show, Claude Code's own dialog asks, the names ticked there", async ($, on) => {
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      suggested: SUGGESTED,
      answer: "kim, lou"
    }
    const { clock, seen, ui } = await loaded($, on, world)
    world.isPaneOpen = false

    await ui.press({ key: "requestReview-12" })
    await clock.settle()

    expect(world.choices).toEqual(["kim", "lou"])
    expect(seen.runs).toContain(`${REQUEST} -f reviewers[]=kim -f reviewers[]=lou`)
  })
})

describe("Request Review's press", () => {
  test("with the suggestions forgotten by a load since the button was drawn, it asks GitHub nothing and says nothing", async () => {
    const list = snapshotOf({ mine: [{ number: 12, headRefOid: "h12" }] })
    const { host } = fakePressHost({ list })
    const session = createSession(readSettings({}))
    session.repo = REPO
    const seen = { asked: 0, runs: 0, notes: 0 }
    const watched = {
      ...host,
      ask: async () => (seen.asked++, null),
      run: async (...args: Parameters<typeof host.run>) => (seen.runs++, host.run(...args)),
      notify: async () => void seen.notes++
    }

    await requestReview(watched, session, list.mine[0]!)
    expect(seen).toEqual({ asked: 0, runs: 0, notes: 0 })
  })
})

describe("Request Review in the examples", () => {
  test("the example nobody was asked to review offers two teammates; its request asks nobody, and says what it would do", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: UNASKED,
      branch: "main",
      uncommitted: 0,
      picks: ["a-teammate"],
      answer: "Request Review"
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "requestReview-1239" })
    await clock.settle()

    expect(world.choices).toEqual(["a-teammate", "another-teammate", "Select All", "Request Review", "Cancel"])
    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
    expect(seen.toasts.some((toast) => toast.includes("#1239 is an example") && toast.includes("a-teammate"))).toBe(
      true
    )
  })
})
