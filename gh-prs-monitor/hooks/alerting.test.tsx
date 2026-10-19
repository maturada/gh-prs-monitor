// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import { snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import {
  clockOf,
  SURFACES,
  MINUTE,
  machine,
  startSession,
  drawnNodes,
  hasText,
  mountPane,
  wordsIn,
  runPrs,
  GITHUB,
  keptOverReload,
  PLUGIN
} from "./testing/world"
import type { Drawn, World } from "./testing/world"

describe("what changed, noted on each row", () => {
  const COMMENTED: ResponseFixture = {
    ...GITHUB,
    mine: [{ ...GITHUB.mine![0]!, comments: { count: 1, lastAuthor: "ann" } }, GITHUB.mine![1]!]
  }

  test("a compact row marks a change with a dot after its title, and says nothing more", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      const dotIn = (nodes: Drawn[]) => nodes.find((node) => node.type === "Text" && node.children?.[0] === "\u00a0•")
      // The full row says what changed, and needs no dot.
      expect(dotIn(drawnNodes(await ui.drawn()))).toBeUndefined()
      await ui.press({ key: "view" })

      const changed = drawnNodes(await ui.find({ key: "pr-1" }))
      const dot = dotIn(changed)
      expect(dot?.props).toMatchObject({ color: "suggestion" })
      // Inside the title's own text, so it follows a wrapped title's last line rather than its column's edge.
      const title = changed.find((node) => node.type === "Text" && node.children?.[0] === "Fix the menu")
      expect(title?.children).toContainEqual(dot)
      expect(dotIn(drawnNodes(await ui.find({ key: "pr-2" })))).toBeUndefined()
      expect(await ui.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
      await ui.press({ key: "view" })
      await ui.unmount()
    }
  })

  test("a changed row's dot is counted when a compact row decides between one line and two", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)

    // One line from 49 columns, or 51 with the dot and the no-break space before it.
    const wide = await mountPane($, "terminal", 51)
    await wide.press({ key: "view" })
    expect(drawnNodes(await wide.drawn()).find((node) => node.props?.key === "pr-1")?.props?.flexDirection).not.toBe(
      "column"
    )
    await wide.press({ key: "view" })
    await wide.unmount()
    const ui = await mountPane($, "terminal", 50)
    await ui.press({ key: "view" })
    const row = drawnNodes(await ui.drawn()).find((node) => node.props?.key === "pr-1")

    expect(row?.props?.flexDirection).toBe("column")
  })

  // The kit raises no close by the person; the plugin's own, as /prs close, runs the same hook.
  test("closing the pane clears the changes' notes it showed", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")
    expect(await ui.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()

    await runPrs($, "close")
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
  })

  test("a change's note stays on its row, drawn after drawn", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)

    const ui = await mountPane($, "terminal")
    expect((await ui.find({ type: "Text", text: "✎ new comment from ann" }))?.props).toMatchObject({
      color: "suggestion",
      wrap: "wrap"
    })
    // Its time in the same words as the details' ages, from the refresh that drew it, kept whole while the changes
    // give way.
    expect(await ui.find({ type: "Text", text: /^just now$/ })).toBeDefined()
    const activity = await ui.find({ key: "activity" })
    const time = drawnNodes(activity).find(
      (node) => node.type === "Box" && hasText(drawnNodes(node), "just now") && node.props?.key !== "activity"
    )
    // The time and the ✕ stay together, under the note where it wraps, rather than squeezing it.
    expect(activity?.props).toMatchObject({ columnGap: 2, flexWrap: "wrap" })
    expect(time?.props).toMatchObject({ flexShrink: 0, columnGap: 2 })
    expect(drawnNodes(time).some((node) => node.props?.key === "seen-1")).toBe(true)
    await ui.unmount()

    await clock.advance(3 * MINUTE)
    const again = await mountPane($, "terminal")
    expect(await again.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()
    expect(await again.find({ type: "Text", text: /^3m ago$/ })).toBeDefined()
  })

  test("a change is a note at the row's foot, after its buttons, until its ✕ marks it seen", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)

    const ui = await mountPane($, "terminal")
    const keys = drawnNodes(await ui.find({ key: "pr-1" })).map((node) => node.props?.key)
    expect(keys.indexOf("activity")).toBeGreaterThan(keys.indexOf("actions"))
    expect((await ui.find({ key: "activity" }))?.props).toMatchObject({ marginTop: 1 })
    for (const surface of SURFACES.filter((other) => other !== "terminal")) {
      // A line apart from the row, as its own part; in VS Code a whole line under framed buttons reads as the gap
      // between rows, so a quarter of one.
      const drawn = await mountPane($, surface)
      expect((await drawn.find({ key: "activity" }))?.props.marginTop).toBe(surface === "vscode" ? 0.25 : 1)
      await drawn.unmount()
    }
    expect((await ui.find({ type: "Text", text: "✎ new comment from ann" }))?.props).toMatchObject({
      italic: true,
      color: "suggestion"
    })
    expect((await ui.find({ key: "seen-1" }))?.props).toMatchObject({ label: "✕", plain: true, dimColor: true })

    await ui.press({ key: "seen-1" })

    expect(await ui.find({ key: "activity" })).toBeUndefined()
    expect(await ui.find({ key: "resolve-1" })).toBeDefined()
  })

  test("a reviewer's single comments, noticed refresh after refresh, are said once with how many came", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    // Each comment posted on its own is a review of its own.
    const reviewedAt = (at: string): ResponseFixture => ({
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, reviews: [{ login: "eve", state: "COMMENTED", at }] }, GITHUB.mine![1]!]
    })

    world.github = reviewedAt("2026-10-09T08:00:00Z")
    await clock.advance(3 * MINUTE)
    world.github = reviewedAt("2026-10-09T08:04:00Z")
    await clock.advance(3 * MINUTE)

    const ui = await mountPane($, "terminal")
    expect(await ui.find({ type: "Text", text: "✎ reviewed by eve\u00a0×2" })).toBeDefined()
  })

  test("a change leaves its row half an hour after a refresh noticed it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    // Noticed by the 14:03 refresh; still there at 14:30, gone at 14:33.
    await clock.advance(30 * MINUTE)

    const before = await mountPane($, "terminal")
    expect(await before.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()
    await before.unmount()

    await clock.advance(3 * MINUTE)
    const after = await mountPane($, "terminal")
    expect(await after.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
  })

  test(
    "a change leaves its row at its time though no refresh comes then, as with a longer interval",
    { options: { pollMinutes: 60, recentChangesExpiryMinutes: 5 } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      const seen = machine($, on, world)
      await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
      await startSession($)
      await clock.settle()
      world.github = COMMENTED
      // Noticed by the 15:00 refresh, the next at 16:00.
      await clock.advance(60 * MINUTE)
      const pane = await mountPane($, "terminal")
      const loads = seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length

      await clock.advance(4 * MINUTE)
      expect(await pane.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()
      await clock.advance(2 * MINUTE)
      expect(await pane.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
      expect(seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine"))).toHaveLength(loads)
    }
  )

  test(
    "one timer takes a change away: each load that keeps the notes replaces the timer before",
    { options: { recentChangesExpiryMinutes: 10 } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world)
      let writes = 0
      on("state.set", { plugin: PLUGIN, key: "activity" }, async (_, e, next) => {
        writes += 1

        return next(e)
      })
      await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
      await startSession($)
      await clock.settle()
      world.github = COMMENTED
      // Noticed at 14:03 and kept again by the refreshes at 14:06, 14:09 and 14:12; it goes at 14:13, in one write.
      await clock.advance(12 * MINUTE + 30_000)
      writes = 0
      await clock.advance(90_000)

      expect(writes).toBe(1)
    }
  )

  test(
    "how long a change shows follows the setting",
    { options: { recentChangesExpiryMinutes: 10 } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world)
      await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
      await startSession($)
      await clock.settle()
      world.github = COMMENTED
      // Noticed by the 14:03 refresh; still there at 14:12, gone at 14:13.
      await clock.advance(12 * MINUTE)

      const before = await mountPane($, "terminal")
      expect(await before.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()
      await before.unmount()

      await clock.advance(3 * MINUTE)
      const after = await mountPane($, "terminal")
      expect(await after.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
    }
  )

  test("pressing one of a row's buttons clears what changed on that row only", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel" }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    world.github = {
      ...GITHUB,
      mine: [
        { ...GITHUB.mine![0]!, comments: { count: 1, lastAuthor: "ann" } },
        { ...GITHUB.mine![1]!, comments: { count: 1, lastAuthor: "bob" } }
      ]
    }
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    await clock.settle()
    await ui.unmount()

    const again = await mountPane($, "terminal")
    expect(await again.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
    expect(await again.find({ type: "Text", text: "✎ new comment from bob" })).toBeDefined()
  })

  test("with the pane already open, what changed while away is not told again in a toast", async ($, on) => {
    const clock = clockOf(on)
    const yesterday = new Date(2026, 9, 6, 17, 40).getTime()
    const earlier = snapshotOf(GITHUB, { at: yesterday })
    const world: World = {
      github: COMMENTED,
      branch: "main",
      uncommitted: 0,
      isPaneOpen: true,
      store: { "look:github.com/acme/app": earlier }
    }
    const seen = machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 0).getTime())
    await startSession($)
    await clock.settle()

    expect(seen.toasts).toEqual([])
  })

  test("what changed while away shows from the first refresh, told in one toast", async ($, on) => {
    const clock = clockOf(on)
    const yesterday = new Date(2026, 9, 6, 17, 40).getTime()
    const earlier = snapshotOf(GITHUB, { at: yesterday })
    const world: World = {
      github: COMMENTED,
      branch: "main",
      uncommitted: 0,
      store: { "look:github.com/acme/app": earlier }
    }
    const seen = machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 0).getTime())
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    expect(await ui.find({ type: "Text", text: "✎ new comment from ann" })).toBeDefined()
    expect(await ui.find({ type: "Text", text: /^in the last 15h$/ })).toBeDefined()
    expect(seen.toasts).toEqual(["Since yesterday 17:40, 1 pull request changed — see /prs"])

    // Only the session's first refresh tells it; a Refresh later in the session shows changes in the pane.
    world.github = { ...COMMENTED, mine: [{ ...COMMENTED.mine![0]!, ci: "FAILURE" }, COMMENTED.mine![1]!] }
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(seen.toasts).toHaveLength(1)
  })

  test("a kind turned off is not marked", { options: { alertComments: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    world.github = COMMENTED
    await clock.advance(3 * MINUTE)

    const ui = await mountPane($, "terminal")
    expect(await ui.find({ type: "Text", text: "✎ new comment from ann" })).toBeUndefined()
  })
})

describe("alerts while a turn runs", () => {
  const START = { text: "go", turnId: "t1" } as never
  const DONE = { answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t1" } as never
  const FAILED: ResponseFixture = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }

  test("wait for the turn to finish, then show", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toEqual([])

    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("a reload during a turn goes on holding for it, what was held before it too, until the turn ends", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    // t1 started before the reload, with an alert held for it; the reload replays the start.
    keptOverReload(on, { turns: ["t1"], heldAlerts: { held: ["✓ #9 Old work — approved"], heldSince: 0 } })
    await startSession($)
    await clock.settle()

    world.github = FAILED
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toEqual([])

    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts).toEqual(["✓ #9 Old work — approved", "✗ #1 Fix the menu — CI failed"])
  })

  test("the turns under way and the alerts held for them are kept in the session's state, for a reload", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    const kept: Record<string, unknown> = {}
    on("state.set", { plugin: PLUGIN, key: /^(turns|heldAlerts)$/ }, async (_, e, next) => {
      kept[e.key] = e.value

      return next(e)
    })
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    expect(kept).toEqual({
      turns: ["t1"],
      heldAlerts: { held: ["✗ #1 Fix the menu — CI failed"], heldSince: expect.any(Number) }
    })
    await $.turn.complete(DONE)
    await clock.settle()
    expect(kept).toEqual({ turns: [], heldAlerts: { held: [], heldSince: null } })
  })

  test("a turn kept over a reload whose end went unseen is over once the next one starts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    keptOverReload(on, { turns: ["t0"] })
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toEqual([])
    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("holding starts over with each turn: the next one's alerts wait their own quarter of an hour", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    // A first turn holds an alert from minute 3, and its end shows it.
    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])

    // The next turn starts at once; its alert from minute 9 still waits at minute 18, fifteen minutes after the first
    // turn's began to.
    await $.turn.start({ text: "again", turnId: "t2" } as never)
    await clock.advance(3 * MINUTE)
    world.github = { ...FAILED, mine: [FAILED.mine![0]!, { ...FAILED.mine![1]!, ci: "FAILURE" }] }
    await clock.advance(3 * MINUTE)
    await clock.advance(9 * MINUTE)
    expect(seen.toasts).toHaveLength(1)

    await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t2" } as never)
    await clock.settle()
    expect(seen.toasts).toHaveLength(2)
    expect(seen.toasts[1]).toContain("#2 Add a legend")
  })

  test("a subagent's turn ending is not the turn ending", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    // A subagent's run raises no start, only its end, under its own turn id.
    await $.turn.complete({
      answer: "",
      durationMs: 1,
      isAborted: false,
      reason: "answer",
      turnId: "s1",
      agentId: "a1"
    } as never)
    await clock.settle()
    expect(seen.toasts).toEqual([])

    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("an interrupted turn ends too, and two turns at once hold until both end", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    await $.turn.start({ text: "and this", turnId: "t2" } as never)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    await $.turn.complete({ answer: "", durationMs: 1, isAborted: true, reason: "aborted", turnId: "t2" } as never)
    await clock.settle()
    expect(seen.toasts).toEqual([])

    await $.turn.complete({ answer: "", durationMs: 1, isAborted: true, reason: "aborted", turnId: "t1" } as never)
    await clock.settle()
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("show at once with the setting off", { options: { holdWhileWorking: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("a long turn shows what it held each quarter of an hour, and goes on holding", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await $.turn.start(START)
    world.github = FAILED
    await clock.advance(3 * MINUTE)
    world.github = {
      ...FAILED,
      requested: [...GITHUB.requested!, { number: 8, title: "Activity cards", author: "bob" }]
    }
    await clock.advance(15 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed", "⌕ #8 Activity cards (bob) — review requested"])

    // The turn runs on, and what changes now is held again, until it ends.
    world.github = {
      ...world.github,
      mine: [...world.github.mine!, { number: 9, title: "Release notes", ci: "FAILURE" }]
    }
    await clock.advance(3 * MINUTE)
    world.github = {
      ...world.github,
      mine: world.github.mine!.map((pull) => (pull.number === 9 ? { ...pull, mergeable: "CONFLICTING" } : pull))
    }
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toHaveLength(2)

    await $.turn.complete(DONE)
    await clock.settle()
    expect(seen.toasts.at(-1)).toBe("⚠ #9 Release notes — merge conflicts")
  })
})

describe("ready to merge, as alerts", () => {
  test("rechecked at the first sight of it, with no look to go by, it is no news when GitHub settles", async ($, on) => {
    const clock = clockOf(on)
    const ready: ResponseFixture = { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] }
    const world: World = {
      github: { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "UNKNOWN" }] },
      branch: "main",
      uncommitted: 0
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = ready
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.filter((toast) => toast.includes("ready to merge"))).toEqual([])
  })

  test("ready at the last look and rechecked at the session's first refresh, it is no news when GitHub settles", async ($, on) => {
    const clock = clockOf(on)
    const ready: ResponseFixture = { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] }
    const yesterday = new Date(2026, 9, 6, 17, 40).getTime()
    const earlier = snapshotOf(ready, { at: yesterday })
    const world: World = {
      github: { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "UNKNOWN" }] },
      branch: "main",
      uncommitted: 0,
      store: { "look:github.com/acme/app": earlier }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = ready
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.filter((toast) => toast.includes("ready to merge"))).toEqual([])
  })

  test("not again when GitHub only rechecked mergeability in between", async ($, on) => {
    const clock = clockOf(on)
    const ready: ResponseFixture = { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] }
    const world: World = { github: ready, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = {
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "UNKNOWN" }]
    }
    await clock.advance(3 * MINUTE)
    world.github = ready
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([])
  })
})

describe("one toast per change across sessions", () => {
  const KEY = "shown"
  const LINE = "✗ #1 Fix the menu — CI failed"
  const MARK = `github.com/acme/app ${LINE}`

  test("a change this session shows is marked for the others, at the time it showed", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([LINE])
    const marks = world.store?.[KEY] as Record<string, { at: number; by: string }>
    expect(Object.keys(marks)).toEqual([MARK])
    expect(marks[MARK]!.at).toBe(clock.now())
  })

  test("a change another session just showed is not shown again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.store = { ...world.store, [KEY]: { [MARK]: { at: clock.now() + 2 * MINUTE, by: "another-session" } } }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([])
  })

  test("a session repeats its own, and another repository's marks do not count", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.store = {
      ...world.store,
      [KEY]: { [`github.com/acme/other ${LINE}`]: { at: clock.now(), by: "another-session" } }
    }
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)
    world.github = GITHUB
    await clock.advance(3 * MINUTE)
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.filter((toast) => toast === LINE)).toHaveLength(2)
  })

  test("what this session showed before a reload is still its own to show again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.store = { ...world.store, [KEY]: { [MARK]: { at: clock.now(), by: "this-session" } } }
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([LINE])
  })

  test("one shown long ago is shown again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await clock.set(60 * MINUTE)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.store = { ...world.store, [KEY]: { [MARK]: { at: 0, by: "another-session" } } }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([LINE])
  })
})

describe("the alert sound", () => {
  test("plays with alerts when turned on", { options: { alertSound: true } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    expect(seen.sounds).toEqual([])

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.sounds).toEqual(["sounds/alert.wav"])
  })

  test("stays quiet by default", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toHaveLength(1)
    expect(seen.sounds).toEqual([])
  })
})

describe("merged and closed pull requests", () => {
  test("one merged by someone else is announced", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    world.closed = [{ number: 2, state: "MERGED", by: "ann" }]
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✓ #2 Add a legend — merged by ann"])
  })

  test("a lookup GitHub is slow to answer holds the list 10 s at most, and the merge is told once it answers", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    world.closed = [{ number: 2, state: "MERGED", by: "ann" }]
    world.slowClosedMs = 20_000
    await clock.advance(3 * MINUTE + 9_000)
    expect(await ui.find({ key: "pr-2" })).toBeDefined()
    await clock.advance(1_000)
    expect(await ui.find({ key: "pr-2" })).toBeUndefined()
    expect(seen.toasts).toEqual([])

    await clock.advance(10_000)
    expect(seen.toasts).toEqual(["✓ #2 Add a legend — merged by ann"])
  })

  test("one merged at the bottom of a stack names the next one up, from either list", async ($, on) => {
    const clock = clockOf(on)
    const stack = (position: number) => ({ number: 30, position, size: 2 })
    // The next one up waits on your review, someone else's above yours.
    const github: ResponseFixture = {
      mine: [{ ...GITHUB.mine![1]!, stack: stack(1) }],
      requested: [{ ...GITHUB.requested![0]!, stack: stack(2) }]
    }
    const world: World = { github, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...github, mine: [] }
    world.closed = [{ number: 2, state: "MERGED", by: "ann" }]
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([
      `✓ #2 Add a legend — merged by ann, #${GITHUB.requested![0]!.number} is next in stack #30`
    ])
  })

  test("two of a stack merged in one refresh: the lower names none, the upper names the one above it", async ($, on) => {
    const clock = clockOf(on)
    const stack = (position: number) => ({ number: 30, position, size: 3 })
    const pull = (number: number, title: string, position: number) => ({ number, title, stack: stack(position) })
    const github: ResponseFixture = {
      mine: [pull(1, "Lay the groundwork", 1), pull(2, "Add a legend", 2), pull(3, "Use the legend", 3)]
    }
    const world: World = { github, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { mine: [pull(3, "Use the legend", 3)] }
    world.closed = [
      { number: 1, state: "MERGED", by: "ann" },
      { number: 2, state: "MERGED", by: "ann" }
    ]
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.flatMap((toast) => toast.split("\n"))).toEqual(
      expect.arrayContaining([
        "✓ #1 Lay the groundwork — merged by ann",
        "✓ #2 Add a legend — merged by ann, #3 is next in stack #30"
      ])
    )
  })

  // Closing the pane clears them with the rows' notes, which the kit can't raise (see "what changed, noted on each
  // row").
  test("the pane notes them under the lists, since when, a line each, each with when and its ✕", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 14, 0).getTime())
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    world.closed = [{ number: 2, state: "MERGED", by: "ann" }]
    await clock.advance(3 * MINUTE)
    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!], requested: [] }
    world.closed = [{ number: 7, state: "CLOSED", by: "bob" }]
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")
    const words = async () => wordsIn(drawnNodes(await ui.find({ key: "ended" })))

    // Since the earliest refresh before them, each line with its own time.
    expect(await words()).toBe(
      "Merged or closed since 14:00 ✓ #2 Add a legend — merged by ann 3m ago ✕ ✕ #7 Usage chart — closed by bob just now ✕"
    )
    expect((await ui.find({ key: "seen-2" }))?.props).toMatchObject({ label: "✕", plain: true })

    await ui.press({ key: "seen-2" })
    await clock.settle()
    expect(await ui.find({ key: "ended-2" })).toBeUndefined()
    expect(await ui.find({ key: "ended-7" })).toBeDefined()
  })

  test("one that comes back into a list is noted on its row instead", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    world.closed = [{ number: 2, state: "CLOSED", by: "ann" }]
    await clock.advance(3 * MINUTE)
    world.github = GITHUB
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")

    expect(await ui.find({ key: "ended" })).toBeUndefined()
    expect(hasText(drawnNodes(await ui.find({ key: "pr-2" })), "✕ closed by ann")).toBe(true)
  })

  test("one closed and reopened is told closed, and not again as asking for your review or mentioning you", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      ...GITHUB,
      requested: [{ number: 5, title: "Usage chart", author: "ann" }],
      mentioned: [{ number: 5, title: "Usage chart", author: "ann" }]
    }
    const world: World = { github, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, requested: [] }
    world.closed = [{ number: 5, state: "CLOSED", by: "ann" }]
    await clock.advance(3 * MINUTE)
    world.github = github
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✕ #5 Usage chart — closed by ann"])
  })

  test("one that left the review list while open, as your approval takes it off, is told when it asks again", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      ...GITHUB,
      requested: [{ number: 5, title: "Usage chart", author: "ann" }],
      mentioned: [{ number: 5, title: "Usage chart", author: "ann" }]
    }
    const world: World = { github, branch: "main", uncommitted: 0, closed: [{ number: 5, state: "OPEN", by: null }] }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...github, requested: [] }
    await clock.advance(3 * MINUTE)
    world.github = github
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["⌕ #5 Usage chart (ann) — review requested"])
  })

  test("the viewer's own merge is no news", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    world.closed = [{ number: 2, state: "MERGED", by: "me" }]
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual([])
  })

  test(
    "with their alerts off they are still looked up, for what carries from the list, and nothing is told",
    { options: { alertClosed: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
      world.closed = [{ number: 2, state: "MERGED", by: "ann" }]
      await clock.advance(3 * MINUTE)

      expect(seen.runs.filter((run) => run.includes("CLOSED_EVENT"))).toHaveLength(1)
      expect(seen.toasts).toEqual([])
      const ui = await mountPane($, "terminal")
      expect(await ui.find({ key: "ended" })).toBeUndefined()
    }
  )
})
