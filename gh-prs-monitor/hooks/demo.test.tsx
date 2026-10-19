// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import { DEMO_ALERTS, demoAnswerNote, demoQuestion, demoSnapshot, demoStartNote } from "./demo"
import {
  clockOf,
  MINUTE,
  machine,
  runPrs,
  startSession,
  drawnNodes,
  hasText,
  mountPane,
  wordsIn,
  GITHUB,
  settleUntil,
  pressDrawn,
  lines,
  SURFACES
} from "./testing/world"
import type { On } from "claude-code"
import type { Engine, MockClock } from "claude-code/testing"
import type { Drawn, World } from "./testing/world"

// The person leaves the examples with their Refresh; closing the pane ends them too, but the kit raises no close by
// the person.
async function leaveExamples($: Engine, clock: MockClock): Promise<void> {
  const pane = await mountPane($, "terminal")
  await pane.press({ key: "refresh" })
  await clock.settle()
  await pane.unmount()
}

describe("/prs demo", () => {
  test("the word is read whatever its case", async ($, on) => {
    clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    expect((await runPrs($, " Demo ")).text).toBe(
      "Showing example pull requests, their alerts and summary until you close the pane."
    )
  })

  test("sent from a phone, where no pane draws, demo prints the example list there and shows the examples on the computer", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["terminal"] }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ran = await runPrs($, "demo", { kind: "bridge" })

    expect(lines(ran.text)[0]).toBe(
      "Remote Control shows no pane, so /prs prints the list here, while the pane, its alerts and summary show on " +
        "the computer. With example pull requests:"
    )
    expect(lines(ran.text)).toContain("**Your Pull Requests** (14)")
    expect(world.isPaneOpen).toBe(true)
    await leaveExamples($, clock)
  })

  test("sent from a phone that draws the pane, demo shows the examples there", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["terminal", "mobile"] })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "demo", { kind: "bridge" })).text).toBe(
      "Showing example pull requests, their alerts and summary until you close the pane."
    )
    await leaveExamples($, clock)
  })

  test("demo shows the examples' alerts one at a time, and their summary until they are left", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    const ran = await runPrs($, "demo")

    expect(ran.text).toBe("Showing example pull requests, their alerts and summary until you close the pane.")
    expect(seen.toasts).toEqual([DEMO_ALERTS[0]])
    expect(seen.statuses).toEqual([
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 6 Need You\u00a0\u00a0🔍 4 To Review\u00a0\u00a0(/prs)"
    ])

    // One at a time, so each is the newest on the stack while it shows, all before the examples go.
    await clock.advance(1_500)
    expect(seen.toasts).toEqual(DEMO_ALERTS.slice(0, 2))
    await clock.advance(12_000)
    expect(seen.toasts).toEqual(DEMO_ALERTS)
    expect(DEMO_ALERTS).toEqual([
      "✓ #1242 Offline downloads — ready to merge, approved by a-teammate",
      "✎ #1235 Fix the share sheet on iOS — new comment from a-teammate",
      "± #1236 Cache the search results — changes requested by a-teammate",
      "✗ #1237 Move the map to the tiles API — CI failed",
      "⚠ #1238 Rename the settings fields — merge conflicts",
      "✓ #1230 PDF export — merged by a-teammate, #1242 is next in stack #30",
      "⌕ #1240 Activity cards on the home feed (a-teammate) — review requested",
      "↻ #1241 Shareable invite links — new commits since your review",
      "@ #1243 Cache the map tiles offline (a-teammate) — you were mentioned",
      "Since yesterday 17:40, 9 pull requests changed — see /prs"
    ])

    await clock.advance(10 * MINUTE)
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 6 Need You\u00a0\u00a0🔍 4 To Review\u00a0\u00a0(/prs)"
    )
  })

  test("after the demo the real summary comes back", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()
    const real = seen.statuses.at(-1)

    await runPrs($, "demo")
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 6 Need You\u00a0\u00a0🔍 4 To Review\u00a0\u00a0(/prs)"
    )

    await leaveExamples($, clock)
    expect(real).toBe("PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)")
    expect(seen.statuses.at(-1)).toBe(real)
  })

  test("after the demo a turned-off status line stays off", { options: { statusLine: false } }, async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    await leaveExamples($, clock)

    expect(seen.statuses).toEqual([
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 6 Need You\u00a0\u00a0🔍 4 To Review\u00a0\u00a0(/prs)",
      undefined
    ])
  })
})

describe("the demo pane", () => {
  test("/prs demo opens the pane with example pull requests, one of each status", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    const ui = await mountPane($, "terminal")

    expect(await ui.find({ type: "Text", text: "Example pull requests" })).toBeDefined()
    // One merged by someone else, noted under the lists.
    expect(wordsIn(drawnNodes(await ui.find({ key: "ended-1230" })))).toMatch(
      /^✓ #1230 PDF export — merged by a-teammate, #1242 is next in stack #30 \d+m ago ✕$/
    )
    // VS Code wraps a row unless told not to: the note keeps its mark and number beside its words.
    for (const surface of SURFACES.filter((other) => other !== "terminal")) {
      const drawn = await mountPane($, surface)
      const ended = await drawn.find({ key: "ended-1230" })
      const nowrap = surface === "vscode" ? "nowrap" : undefined
      expect(ended?.props.flexWrap).toBe(nowrap)
      expect((ended?.children?.[0] as Drawn | undefined)?.props?.flexWrap).toBe(nowrap)
      await drawn.unmount()
    }
    for (const status of [
      "❗ CI Failing",
      "❗ Conflicts",
      "❗ Changes Requested",
      "❗ Comments To Address",
      "❗ Approved · Behind Base",
      "❗ Approved · Merge Blocked",
      "✅ Ready To Merge",
      "Waiting For Re-Review",
      "Approved · More Approvals Needed",
      "Approved",
      "Approved · Checking Mergeability",
      "In Merge Queue",
      "Waiting For Review",
      "Draft",
      "🔍 Review Requested",
      "🔍 Re-Review Requested",
      "🔍 Updated Since Your Review",
      "🔍 Your Review Was Dismissed",
      "Waiting On Author",
      "You Commented"
    ]) {
      expect(await ui.find({ type: "Text", text: new RegExp(`^${status}$`) })).toBeDefined()
    }
    expect(await ui.find({ type: "Text", text: "+120 −30, 8 files" })).toBeDefined()
    expect(await ui.find({ type: "Text", text: "✓ ready to merge\u00a0· approved by a-teammate" })).toBeDefined()
    expect(hasText(drawnNodes(await ui.find({ key: "pr-1236" })), "●")).toBe(true)
    expect(hasText(drawnNodes(await ui.find({ key: "pr-1255" })), "✓ Merged")).toBe(true)
    // The view is the person's to choose here too.
    await ui.press({ key: "view" })
    expect((await ui.find({ key: "view" }))?.props.label).toBe("Full")
    expect(await ui.find({ type: "Text", text: "+120 −30, 8 files" })).toBeUndefined()
    // Not the person's own list.
    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeUndefined()
  })

  // The demo pane, opened before any load, its questions answered `answer`.
  async function examples($: Engine, on: On, answer: string) {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer }
    const seen = machine($, on, world)
    await runPrs($, "demo")
    const ui = await mountPane($, "terminal")
    // GitHub's reads go on behind the examples; nothing written, and no command run.
    const writes = (since: number) =>
      seen.runs.slice(since).filter((run) => !run.startsWith("gh api graphql") || run.includes("mutation"))

    return { clock, world, seen, ui, writes, before: seen.runs.length }
  }

  test("an example's Merge asks what the real one asks; an answer sends nothing and says what it would do", async ($, on) => {
    const { clock, world, seen, ui, writes, before } = await examples($, on, "Squash and merge")
    const said = '#1242 is an example: in your own list, "Squash and merge" would go ahead. Nothing was sent to GitHub.'

    await ui.press({ key: "merge-1242" })
    await settleUntil(clock, () => seen.toasts.at(-1) === said)
    expect(world.header).toBe("Merge PR")
    expect(world.subject).toMatch(/^#1242 /)
    expect(seen.toasts.at(-1)).toBe(said)
    expect(seen.commands).toEqual([])
    expect(writes(before)).toEqual([])
    // Answered, the examples are back.
    expect(await ui.find({ key: "pr-1242" })).toBeDefined()
  })

  for (const [key, header] of [
    ["resolve-1236", "Resolve PR"],
    ["rerequest-1236", "Re-Request"],
    ["rerun-1237", "Re-Run CI"],
    ["resolveConflicts-1238", "Conflicts"],
    ["autoMerge-1250", "Merge PR"],
    ["updateBranch-1249", "Update PR"],
    ["review-1240", "Review PR"]
  ] as const) {
    test(`an example's ${key} asks what the real one asks; Cancel says nothing and sends nothing`, async ($, on) => {
      const { clock, world, seen, ui, writes, before } = await examples($, on, "Cancel")

      await ui.press({ key })
      await settleUntil(clock, () => (world.asked ?? 0) > 0)
      expect(world.asked).toBe(1)
      expect(world.header).toBe(header)
      // Claude Code's own dialog, where the pane doesn't show, heads a question with 12 characters at most.
      expect(header.length).toBeLessThanOrEqual(12)
      expect(world.subject).toMatch(new RegExp(`^#${key.split("-")[1]} `))
      expect(seen.toasts.filter((toast) => toast.includes("is an example"))).toEqual([])
      expect(seen.commands).toEqual([])
      expect(writes(before)).toEqual([])
    })
  }

  test("two open examples form stack #30, each saying where it sits", () => {
    const rows = demoSnapshot(0)!.mine
    const stackOf = (number: number) => rows.find((row) => row.number === number)?.details.map((detail) => detail.text)

    // #1230 below them merged, and still counts, as on GitHub.
    expect(stackOf(1242)).toContain("stack #30 2/3")
    expect(stackOf(1248)).toContain("stack #30 3/3")
  })

  test("Re-Request Review shows on the example with a change request, and asks what the real button asks", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel" }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "rerequest-1236" })
    await clock.settle()

    expect(world.header).toBe("Re-Request")
    expect(world.subject).toBe("#1236 Cache the search results")
    expect(world.question).toBe("Ask a-teammate to review it again?")
  })

  test("where no new session can be opened, an example's Review and Create PR ask nothing, as the real ones", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    const ui = await mountPane($, "mobile")
    const reviewKey = drawnNodes(await ui.drawn())
      .map((node) => String(node.props?.key ?? ""))
      .find((key) => key.startsWith("review-"))!

    await ui.press({ key: reviewKey })
    await clock.settle()
    await pressDrawn(clock, ui, "create-pr")
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toEqual(
      expect.arrayContaining([
        demoStartNote(`#${reviewKey.slice("review-".length)}`, "Review"),
        demoStartNote("feature/export-csv", "Create PR")
      ])
    )
    expect(seen.commands).toEqual([])
  })

  test("in VS Code, an example's Review and Create PR ask where, as the real ones", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["vscode"], answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    const ui = await mountPane($, "vscode")
    const reviewKey = drawnNodes(await ui.drawn())
      .map((node) => String(node.props?.key ?? ""))
      .find((key) => key.startsWith("review-"))!

    await ui.press({ key: reviewKey })
    await clock.settle()
    expect(world.header).toBe("Review PR")
    expect(world.choices).toEqual(["This session", "New session", "Cancel"])
    await pressDrawn(clock, ui, "create-pr")
    await clock.settle()

    expect(world.asked).toBe(2)
    expect(world.choices).toEqual(["This session", "New session", "Cancel"])
    expect(seen.commands).toEqual([])
  })

  test("an example's answer says what it would do, with instructions typed; Cancel and a typed no say nothing", () => {
    const snapshot = demoSnapshot(0)!
    const row = snapshot.mine[0]!
    const example = `#${row.number}`
    const question = demoQuestion("resolve", row, snapshot, true)!
    const confirm = demoQuestion("merge", row, snapshot, true)!
    const said = (what: string) =>
      `${example} is an example: in your own list, ${what} would go ahead. Nothing was sent to GitHub.`

    expect(demoAnswerNote(example, question, { choice: "Here, switch branch", instructions: "" })).toBe(
      said('"Here, switch branch"')
    )
    expect(demoAnswerNote(example, question, { choice: "Here, switch branch", instructions: "only the typos" })).toBe(
      said('"Here, switch branch" with your instructions')
    )
    expect(demoAnswerNote(example, question, { choice: null, instructions: "only the typos" })).toBe(
      said("your instructions")
    )
    expect(demoAnswerNote(example, question, { choice: "Cancel", instructions: "only the typos" })).toBe(null)
    expect(demoAnswerNote(example, question, { choice: null, instructions: "no thanks" })).toBe(null)
    // An empty Other in Claude Code's dialog is no answer, as the real flows read it.
    expect(demoAnswerNote(example, question, { choice: null, instructions: "" })).toBe(null)
    expect(demoAnswerNote(example, question, null)).toBe(null)
    // A confirmation takes no instructions: words typed under Claude Code's Other merge nothing.
    expect(demoAnswerNote(example, confirm, { choice: null, instructions: "squash it" })).toBe(null)
  })

  test("an example asks only what the real button asks: Review nothing where no new session opens; a stacked Merge says what merges along", () => {
    const snapshot = demoSnapshot(0)!
    const reviewed = snapshot.review[0]!
    const stacked = snapshot.mine.find((row) => row.number === 1242)!

    expect(demoQuestion("review", reviewed, snapshot, true)?.header).toBe("Review PR")
    expect(demoQuestion("review", reviewed, snapshot, false)).toBe(null)
    expect(demoQuestion("merge", stacked, snapshot, true)?.detail).toBe(
      "It is 2 of 3 in stack #30; those below it are merged or closed."
    )
    expect(demoStartNote("#1240", "Review")).toBe(
      "#1240 is an example: in your own list, Review would start here without asking. Nothing was sent to GitHub."
    )
  })

  test("Refresh, or /prs, leaves the examples for the person's own list", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    const demo = await mountPane($, "terminal")
    await demo.press({ key: "refresh" })
    await clock.settle()
    await demo.unmount()
    const real = await mountPane($, "terminal")
    expect(await real.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    expect(await real.find({ type: "Text", text: "Example pull requests" })).toBeUndefined()
    await real.unmount()

    await runPrs($, "demo")
    await runPrs($, "")
    await clock.settle()
    const again = await mountPane($, "terminal")
    expect(await again.find({ type: "Text", text: "Fix the menu" })).toBeDefined()

    // The examples drawn where the list was: their Refresh is their own, not the list's, though it looks the same.
    await runPrs($, "demo")
    await clock.settle()
    expect(await again.find({ type: "Text", text: "Example pull requests" })).toBeDefined()
    await again.press({ key: "refresh" })
    await clock.settle()
    expect(await again.find({ type: "Text", text: "Example pull requests" })).toBeUndefined()
  })
})

describe("leaving the demo", () => {
  test("the examples stay, however long, and through a second demo", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    await clock.advance(10 * MINUTE)
    await runPrs($, "demo")
    await clock.advance(10 * MINUTE)
    const pane = await mountPane($, "terminal")

    expect(await pane.find({ type: "Text", text: "Example pull requests" })).toBeDefined()
  })

  test("a reload ends the demo", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    await startSession($)
    await clock.settle()

    const pane = await mountPane($, "terminal")
    expect(await pane.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
  })

  test(
    "a reload mid-demo puts back the summary where no refresh would",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      await startSession($)
      await clock.settle()

      await runPrs($, "demo")
      expect(seen.statuses.at(-1)).toMatch(/^PRs /)
      await startSession($)
      await clock.settle()

      expect(seen.statuses.at(-1)).toBe(undefined)
    }
  )

  test("Refresh ends the demo with its alerts still to come", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    const pane = await mountPane($, "terminal")
    await pane.press({ key: "refresh" })
    await clock.advance(MINUTE)

    expect(seen.toasts).toEqual([DEMO_ALERTS[0]])
  })

  test("a refresh during the demo leaves its summary up until the examples are left", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await clock.advance(3 * MINUTE - 5_000)
    await runPrs($, "demo")
    await clock.advance(10_000)
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 6 Need You\u00a0\u00a0🔍 4 To Review\u00a0\u00a0(/prs)"
    )

    await leaveExamples($, clock)
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
  })

  test("a refresh behind the examples does not count the real list as seen", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    // The demo opens the pane just before the regular check runs.
    await clock.advance(3 * MINUTE - 5_000)
    await runPrs($, "demo")
    await clock.advance(10_000)
    expect(world.store?.["look:github.com/acme/app"]).toBe(undefined)

    // With the examples left and the pane still open, the list it shows is the last look.
    await leaveExamples($, clock)
    expect(world.store?.["look:github.com/acme/app"]).toMatchObject({ repo: "acme/app" })
  })
})
