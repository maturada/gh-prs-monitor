// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"

import {
  clockOf,
  drawnNodes,
  GITHUB,
  machine,
  mountPane,
  runPrs,
  settleAll,
  startSession,
  wordsIn
} from "./testing/world"
import type { World } from "./testing/world"

const NOTE = { key: "merged-branch" }

// A session on feature/x at h1, which GitHub says #1242 merged into main, none of the lists showing it; the pane drawn
// in the terminal.
async function mergedOn($: Engine, on: On, extra: Partial<World> = {}) {
  const clock = clockOf(on)
  const world: World = {
    github: GITHUB,
    branch: "feature/x",
    head: "h1",
    uncommitted: 0,
    branchPulls: [{ number: 1242, state: "MERGED", head: "h1" }],
    ...extra
  }
  const seen = machine($, on, world, clock)
  await startSession($)
  await settleAll(clock, seen)
  const ui = await mountPane($, "terminal")

  return { world, seen, clock, ui }
}

describe("the note on a branch that merged", () => {
  test("names the branch, its pull request and the base above the lists, with Switch to the base and a ✕", async ($, on) => {
    const { ui } = await mergedOn($, on)

    expect(wordsIn(drawnNodes(await ui.find(NOTE)))).toBe(
      "You're on feature/x, merged into main as #1242 Switch to main ✕"
    )
    const order = drawnNodes(await ui.drawn()).map((node) => node.props?.key)
    expect(order.indexOf("merged-branch")).toBeLessThan(order.indexOf("panels"))
  })

  test("shows too where the session's own pull request merged while the lists watched it", async ($, on) => {
    const own = { number: 1242, title: "Export as CSV", headRefName: "feature/x", headRefOid: "h1" }
    const { ui, clock, seen, world } = await mergedOn($, on, {
      github: { ...GITHUB, mine: [...(GITHUB.mine ?? []), own] },
      branchPulls: []
    })
    expect(await ui.find(NOTE)).toBeUndefined()

    // Merged on GitHub: it leaves the list, which sees where it ended.
    world.github = GITHUB
    world.closed = [{ number: 1242, state: "MERGED", by: null, head: "h1", branch: "feature/x" }]
    world.branchPulls = [{ number: 1242, state: "MERGED", head: "h1" }]
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(wordsIn(drawnNodes(await ui.find(NOTE)))).toBe(
      "You're on feature/x, merged into main as #1242 Switch to main ✕"
    )
  })

  test("names the base it merged into, as a stack's lower branch", async ($, on) => {
    const { ui } = await mergedOn($, on, {
      branchPulls: [{ number: 1242, state: "MERGED", head: "h1", base: "feature/w" }]
    })

    expect(wordsIn(drawnNodes(await ui.find(NOTE)))).toContain("merged into feature/w as #1242 Switch to feature/w")
  })

  test("none for a branch an open pull request in the lists merges into", async ($, on) => {
    const child = { number: 1300, title: "Child", headRefName: "feature/y", baseRefName: "feature/x" }
    const { ui } = await mergedOn($, on, { github: { ...GITHUB, mine: [...(GITHUB.mine ?? []), child] } })

    expect(await ui.find(NOTE)).toBeUndefined()
  })

  test("none where another worktree has the base checked out, as this checkout can't switch to it", async ($, on) => {
    const { ui, clock, seen, world } = await mergedOn($, on, { pullWorktrees: [{ number: 99, branch: "main" }] })
    expect(await ui.find(NOTE)).toBeUndefined()

    // That worktree lets the base go: the next load offers it, at the same commit.
    world.pullWorktrees = []
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(wordsIn(drawnNodes(await ui.find(NOTE)))).toContain("Switch to main")
  })

  test("none where it closed unmerged", async ($, on) => {
    const closed = await mergedOn($, on, { branchPulls: [{ number: 1242, state: "CLOSED", head: "h1" }] })
    expect(await closed.ui.find(NOTE)).toBeUndefined()
  })

  test("its ✕ puts it away for this branch at this commit", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on)

    await ui.press({ key: "dismiss-base" })
    await settleAll(clock, seen)
    expect(await ui.find(NOTE)).toBeUndefined()
  })

  test("Switch to the base switches this checkout, and a toast says how it went", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on)

    await ui.press({ key: "switch-base" })
    await settleAll(clock, seen)
    expect(seen.toasts.filter((toast) => /switched to main/i.test(toast))).toEqual([
      "Switched to main; feature/x deleted, as #1242 merged it."
    ])
  })

  test("its ✕ holds for this commit only: a new one merged offers it again", async ($, on) => {
    const { ui, clock, seen, world } = await mergedOn($, on)

    await ui.press({ key: "dismiss-base" })
    await settleAll(clock, seen)
    world.head = "h3"
    world.branchPulls = [{ number: 1250, state: "MERGED", head: "h3" }]
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(wordsIn(drawnNodes(await ui.find(NOTE)))).toContain("merged into main as #1250")
  })

  test("a switch that stopped leaves the note, which said why", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on, { uncommitted: 2 })

    await ui.press({ key: "switch-base" })
    await settleAll(clock, seen)
    expect(seen.toasts).toContain("Not switched to main: commit or stash your uncommitted changes first (2 files).")
    expect(await ui.find({ key: "switch-base" })).toBeDefined()
  })

  test("while a turn runs, the note says the switch waits for it, in its button's place", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on)

    await $.turn.start({ text: "go", turnId: "t1" } as never)
    await ui.press({ key: "switch-base" })
    await settleAll(clock, seen)
    // Worded as the button it stands in for, and wrapping in a narrow pane rather than running past its edge.
    const waiting = await ui.find({ type: "Text", text: "Switches to main when this turn ends" })
    expect(waiting?.props.wrap).toBe("wrap")
    expect(await ui.find({ key: "switch-base" })).toBeUndefined()
    await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t1" } as never)
    await settleAll(clock, seen)
    expect(seen.toasts).toContain("Switched to main; feature/x deleted, as #1242 merged it.")
  })

  test("its ✕ while the switch waits for a turn stops it at once, the checkout left as it was", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on)

    await $.turn.start({ text: "go", turnId: "t1" } as never)
    await ui.press({ key: "switch-base" })
    await settleAll(clock, seen)
    await ui.press({ key: "dismiss-base" })
    await settleAll(clock, seen)
    expect(await ui.find(NOTE)).toBeUndefined()
    // Said while the turn still runs, so nothing waits on it unseen.
    expect(seen.toasts).toContain("Not switched to main: its note was put away.")
    await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t1" } as never)
    await settleAll(clock, seen)
    expect(seen.toasts.filter((toast) => toast.startsWith("Switched"))).toEqual([])
  })

  test("none on a visit to another repository, nor in the examples", async ($, on) => {
    const { ui, clock, seen } = await mergedOn($, on, {
      others: { "github.com/acme/web": { mine: [{ number: 12, title: "Checkout page" }] } }
    })

    await runPrs($, "acme/web")
    await settleAll(clock, seen)
    expect(wordsIn(drawnNodes(await ui.drawn()))).toContain("acme/web")
    expect(await ui.find(NOTE)).toBeUndefined()
    await runPrs($, "demo")
    await settleAll(clock, seen)
    expect(await ui.find(NOTE)).toBeUndefined()
  })
})
