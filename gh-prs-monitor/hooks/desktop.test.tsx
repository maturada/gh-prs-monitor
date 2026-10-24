// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import {
  clockOf,
  machine,
  runPrs,
  startSession,
  drawnNodes,
  mountPane,
  GITHUB,
  keepOlderSnapshot,
  mountBand
} from "./testing/world"
import type { World } from "./testing/world"

describe("the desktop app", () => {
  const DESKTOP: Partial<World> = { surfaces: ["desktop"] }

  test("a list an older version of the plugin left draws no band until the next refresh", async ($, on) => {
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, ...DESKTOP })
    keepOlderSnapshot(on, GITHUB)

    const band = await mountBand($, "desktop")

    expect(await band.find({ type: "Text", text: "✅ 1 Ready To Merge" })).toBeUndefined()
  })

  test("the summary is a band above the prompt instead of a status line it would cut short", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, ...DESKTOP }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.statuses.every((status) => status === undefined)).toBe(true)

    const band = await mountBand($, "desktop")
    expect((await band.find({ type: "Text", text: "✅ 1 Ready To Merge" }))?.props.color).toBe("success")
    expect((await band.find({ type: "Text", text: "❗ 1 Needs You" }))?.props.color).toBe("warning")
    expect((await band.find({ type: "Text", text: "🔍 1 To Review" }))?.props.color).toBe("warning")
    // The numbers are what the eye looks for, so each is bold within its count.
    const numbers = drawnNodes(await band.drawn()).filter((node) => node.type === "Text" && node.props?.bold)
    expect(numbers.map((node) => node.children?.[0])).toEqual(["PRs", "1", "1", "1"])

    await band.press({ key: "open-prs" })
    expect(world.isPaneOpen).toBe(true)
  })

  test("a survey above the prompt has the band's place while it shows", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, ...DESKTOP })
    await startSession($)
    await clock.settle()

    const band = await mountBand($, "desktop", true)
    expect(await band.find({ type: "Text", text: "engine band" })).toBeDefined()
    expect(await band.find({ key: "open-prs" })).toBeUndefined()
  })

  test("the terminal keeps the status line and draws no band", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
    const band = await mountBand($, "terminal")
    expect(await band.find({ type: "Text", text: "engine band" })).toBeDefined()
    expect(await band.find({ key: "open-prs" })).toBeUndefined()
  })

  test(
    "the demo shows its band even with the summary turned off",
    { options: { statusLine: false } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, { github: {}, branch: "main", uncommitted: 0, ...DESKTOP })
      await startSession($)
      await clock.settle()

      await runPrs($, "demo")
      const band = await mountBand($, "desktop")
      expect(await band.find({ type: "Text", text: "❗ 6 Need You" })).toBeDefined()
    }
  )

  test("a terminal attached beside the app keeps its status line", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop", "terminal"] })
    await startSession($)
    await clock.settle()

    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
  })

  test("the demo shows its example counts in the band until the examples are left", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: {}, branch: "main", uncommitted: 0, ...DESKTOP })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    const band = await mountBand($, "desktop")
    expect(await band.find({ type: "Text", text: "❗ 6 Need You" })).toBeDefined()
    expect(await band.find({ type: "Text", text: "✅ 1 Ready To Merge" })).toBeDefined()
    await band.unmount()

    const pane = await mountPane($, "desktop")
    await pane.press({ key: "refresh" })
    await clock.settle()
    const after = await mountBand($, "desktop")
    expect(await after.find({ type: "Text", text: "Need You" })).toBeUndefined()
    expect(await after.find({ type: "Text", text: "engine band" })).toBeDefined()
  })
})
