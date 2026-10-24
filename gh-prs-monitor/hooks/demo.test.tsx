// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import {
  DEMO_ALERTS,
  demoAnswerNote,
  demoNotification,
  demoQuestion,
  demoSnapshot,
  demoStartNote,
  DEMO_TOAST_GAP_MS
} from "./demo"
import {
  clockOf,
  MINUTE,
  machine,
  runPrs,
  startSession,
  drawnNodes,
  fieldKey,
  hasText,
  mountPane,
  wordsIn,
  GITHUB,
  settleUntil,
  pressDrawn,
  lines,
  SURFACES,
  skillTurnEnd,
  skillTurnStart,
  triedToNotify
} from "./testing/world"
import type { On, RenderSurface } from "claude-code"
import type { Engine, MockClock, Mounted } from "claude-code/testing"
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
      "✎ #1235 Link your tickets with /prs tickets — new comment from a-teammate",
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

  test("demo's system notification carries the examples' changes, not the summary after them", () => {
    expect(demoNotification()).toEqual({ title: "Example pull requests", text: `${DEMO_ALERTS[0]} (8 more)` })
  })

  test(
    "demo tries a system notification where it is on, its failing leaving the examples' toasts",
    { options: { systemNotification: true } },
    async ($, on) => {
      clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

      await runPrs($, "demo")

      expect(seen.toasts).toEqual([DEMO_ALERTS[0]])
      expect(triedToNotify(seen.debug)).toBe(true)
    }
  )

  test("demo tries no system notification by default", async ($, on) => {
    clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    await runPrs($, "demo")

    expect(triedToNotify(seen.debug)).toBe(false)
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

  test("examples whose branches name a ticket show it, linked to how ticket links are set up; the rest none", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    const ui = await mountPane($, "terminal")
    const ticketOf = async (number: number) =>
      drawnNodes(await ui.find({ key: `pr-${number}` })).find(
        (node) => node.type === "Link" && /⧉$/.test(String(node.props?.label))
      )

    expect((await ticketOf(1237))?.props).toMatchObject({
      label: "APP-412\u00a0⧉",
      href: "https://github.com/maturada/gh-prs-monitor/blob/main/gh-prs-monitor/docs/tickets.md"
    })
    expect(await ticketOf(1238)).toBeUndefined()
  })

  test(
    "with Ticket links on rows off, the examples show no tickets either",
    { options: { showTickets: false } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      await startSession($)
      await clock.settle()

      await runPrs($, "demo")
      const ui = await mountPane($, "terminal")
      expect(drawnNodes(await ui.drawn()).some((node) => /⧉$/.test(String(node.props?.label)))).toBe(false)
    }
  )

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
    const question = demoQuestion("resolve", row, snapshot, { surface: "terminal" })!
    const confirm = demoQuestion("merge", row, snapshot, { surface: "terminal" })!
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
    // What was picked goes along, with the place pressed or with instructions sent alone.
    expect(
      demoAnswerNote(example, question, { choice: "This session", instructions: "", picks: ["Full Review"] })
    ).toBe(said('"This session" with Full Review'))
    expect(
      demoAnswerNote(example, question, {
        choice: "This session",
        instructions: "only the typos",
        picks: ["Full Review"]
      })
    ).toBe(said('"This session" with Full Review and your instructions'))
    expect(
      demoAnswerNote(example, question, { choice: null, instructions: "only the typos", picks: ["Since Your Review"] })
    ).toBe(said("your instructions with Since Your Review"))
    expect(demoAnswerNote(example, question, { choice: "Cancel", instructions: "only the typos" })).toBe(null)
    expect(demoAnswerNote(example, question, { choice: null, instructions: "no thanks" })).toBe(null)
    // An empty Other in Claude Code's dialog is no answer, as the real flows read it.
    expect(demoAnswerNote(example, question, { choice: null, instructions: "" })).toBe(null)
    expect(demoAnswerNote(example, question, null)).toBe(null)
    // A confirmation takes no instructions: words typed under Claude Code's Other merge nothing.
    expect(demoAnswerNote(example, confirm, { choice: null, instructions: "squash it" })).toBe(null)
  })

  test("an example asks only what the real button asks: Review nothing where no new session opens, but what to cover where it's back to you; a stacked Merge says what merges along", () => {
    const snapshot = demoSnapshot(0)!
    const reviewed = snapshot.review.find((row) => row.number === 1240)!
    const back = snapshot.review.find((row) => row.number === 1241)!
    const stacked = snapshot.mine.find((row) => row.number === 1242)!

    expect(demoQuestion("review", reviewed, snapshot, { surface: "terminal" })?.header).toBe("Review PR")
    expect(demoQuestion("review", reviewed, snapshot, { surface: "mobile" })).toBe(null)
    expect(demoQuestion("review", back, snapshot, { surface: "mobile" })?.choices).toEqual(["Start Review", "Cancel"])
    expect(demoQuestion("review", back, snapshot, { surface: "terminal" })?.picking?.names).toEqual([
      "Since Your Review",
      "Full Review"
    ])
    const askedAgain = snapshot.review.find((row) => row.number === 1252)!
    // The line names each example's commit as GitHub's short form would.
    expect(demoQuestion("review", askedAgain, snapshot, { surface: "terminal" })?.detail).toMatch(
      /^Your review was on 1252ab3, \d+[hd] ago; you're asked again, with no new commits since\. /
    )
    expect(demoQuestion("review", back, snapshot, { surface: "terminal" })?.detail).toMatch(
      /^Your review was on 12410d7, \d+[hd] ago; new commits came in since\. /
    )
    expect(demoQuestion("merge", stacked, snapshot, { surface: "terminal" })?.detail).toBe(
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

describe("the examples' other repositories", () => {
  const OWN = "Example pull requests"
  const WEB = "acme/web"
  const IOS = "acme/ios-app"
  const ADMIN = "acme/admin"

  async function examplesOn($: Engine, on: On, world: Partial<World> = {}, surface: RenderSurface = "terminal") {
    const clock = clockOf(on)
    const full: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [surface], ...world }
    const seen = machine($, on, full, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    const ui = await mountPane($, surface)
    const before = seen.runs.length
    const store = JSON.stringify(full.store ?? {})
    // Nothing read of other repositories, nothing written to GitHub or kept in the store, and no command run.
    const isUntouched = () =>
      seen.runs.slice(before).every((run) => run.startsWith("gh api graphql") && !run.includes("mutation")) &&
      !seen.runs.slice(before).some((run) => run.includes("archived:false")) &&
      JSON.stringify(full.store ?? {}) === store &&
      seen.commands.length === 0

    return { clock, world: full, seen, ui, isUntouched }
  }

  // The picker opened, and the repository named `name` opened; the questions after it pick nothing.
  async function visit(
    clock: MockClock,
    ui: Pick<Mounted, "find" | "press">,
    world: World,
    name: string
  ): Promise<void> {
    world.answer = "Show"
    world.picks = [name]
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    world.picks = undefined
  }

  async function header(ui: Pick<Mounted, "find">): Promise<string> {
    return wordsIn(drawnNodes(await ui.find({ key: "header" })))
  }

  test(
    "with the alerts from other repositories on, the examples' header counts what waits in the others",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const { ui } = await examplesOn($, on)

      expect(await header(ui)).toContain("+6 elsewhere")
    }
  )

  test("with them off, as by default, the header counts nothing elsewhere, as a real list's", async ($, on) => {
    const { ui } = await examplesOn($, on)

    expect(await header(ui)).not.toContain("elsewhere")
  })

  test("the picker offers the examples' own, acme/web cloned here, then two on GitHub alone, one new; it reads and keeps nothing", async ($, on) => {
    const { clock, world, ui, isUntouched } = await examplesOn($, on, { answer: "Cancel" })

    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    const rows = [
      "Example pull requests this folder ✓ Shown",
      "acme/web ❗ 2 yours 🔍 1 to review ~/code/web Open",
      "acme/ios-app ❗ 1 yours 🔍 1 to review Open",
      "acme/admin • 🔍 1 to review Open"
    ]
    expect(world.header).toBe("Repositories")
    expect(world.rows).toEqual(rows)
    // Opened again, what is new stays new: the examples stay as they are.
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    expect(world.rows).toEqual(rows)
    expect(isUntouched()).toBe(true)
  })

  test(
    "Show visits one, with the banner and Back; Back is the examples' own list again",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const { clock, world, ui, isUntouched } = await examplesOn($, on)

      await visit(clock, ui, world, WEB)
      expect(await header(ui)).toMatch(
        /^acme\/web .*\+3 elsewhere.*Not this session's folder Back to Example pull requests/
      )
      expect(await ui.find({ type: "Text", text: "Checkout page" })).toBeDefined()
      expect(await ui.find({ type: "Text", text: "Product images" })).toBeDefined()
      expect(await ui.find({ type: "Text", text: "Move the map to the tiles API" })).toBeUndefined()
      // The picker starts on the one shown.
      world.answer = "Cancel"
      await pressDrawn(clock, ui, "repo")
      await clock.settle()
      expect(world.rows?.[1]).toBe("acme/web ❗ 2 yours 🔍 1 to review ~/code/web ✓ Shown")

      await pressDrawn(clock, ui, "back")
      await clock.settle()
      expect(await header(ui)).toMatch(/^Example pull requests .*\+6 elsewhere/)
      expect(await header(ui)).not.toContain("Not this session's folder")
      // Each visit counts what waits outside it.
      await visit(clock, ui, world, IOS)
      expect(await header(ui)).toMatch(/^acme\/ios-app .*\+4 elsewhere/)
      await visit(clock, ui, world, ADMIN)
      expect(await header(ui)).toMatch(/^acme\/admin .*\+5 elsewhere/)
      expect(isUntouched()).toBe(true)
    }
  )

  test("the examples' own picked while visiting is their list again", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    await visit(clock, ui, world, IOS)
    expect(await header(ui)).toMatch(/^acme\/ios-app /)

    await visit(clock, ui, world, OWN)

    expect(await header(ui)).toMatch(/^Example pull requests /)
  })

  for (const surface of ["terminal", "desktop"] as const) {
    test(`on acme/web's, a branch skill offers its clone, as a real visit's in the ${surface}; Open says what it would do and opens nothing`, async ($, on) => {
      const { clock, world, seen, ui, isUntouched } = await examplesOn($, on, {}, surface)
      await visit(clock, ui, world, WEB)
      const said =
        'acme/web#12 is an example: in your own list, "New Session in ~/code/web" would go ahead. Nothing was sent to GitHub.'

      world.answer = "New Session in ~/code/web"
      await pressDrawn(clock, ui, "fixCi-12")
      await settleUntil(clock, () => seen.toasts.at(-1) === said)

      expect(seen.toasts.at(-1)).toBe(said)
      expect(world.header).toBe("Fix CI")
      expect(world.question).toBe(
        "Its failing checks on example/12 get fixed in your clone of acme/web at ~/code/web, not in this session's folder. Start a new session there?"
      )
      expect(world.choices).toEqual(["New Session in ~/code/web", "Cancel"])
      expect(isUntouched()).toBe(true)
    })
  }

  for (const [surface, text] of [
    ["vscode", "Open that folder in a new window, run /prs acme/web in Claude Code there, then press Fix CI on #12."],
    ["mobile", "On the computer, open a Claude Code session there, run /prs acme/web, then press Fix CI on #12."]
  ] as const) {
    test(`on acme/web's, in ${surface}, a branch skill tells the clone, as a real visit's; its OK says nothing`, async ($, on) => {
      const { clock, world, seen, ui, isUntouched } = await examplesOn($, on, {}, surface)
      await visit(clock, ui, world, WEB)

      world.answer = "OK"
      await pressDrawn(clock, ui, "fixCi-12")
      await settleUntil(clock, () => `${world.question} ${world.detail}`.includes(text))
      await clock.settle()

      expect(world.choices).toEqual(["OK"])
      expect(await ui.find({ key: "pr-12" })).toBeDefined()
      expect([...seen.toasts, ...seen.notices].filter((note) => note.includes("is an example"))).toEqual([])
      expect(isUntouched()).toBe(true)
    })
  }

  test("on acme/ios-app's, cloned nowhere here, a branch skill says none is known; its OK says nothing", async ($, on) => {
    const { clock, world, seen, ui, isUntouched } = await examplesOn($, on)
    await visit(clock, ui, world, IOS)

    world.answer = "OK"
    await pressDrawn(clock, ui, "resolveConflicts-31")
    await settleUntil(clock, () => (world.question ?? "").includes("none is known on this machine"))
    await clock.settle()

    expect(world.header).toBe("Conflicts")
    expect(world.choices).toEqual(["OK"])
    expect(await ui.find({ key: "pr-31" })).toBeDefined()
    expect(seen.toasts.filter((toast) => toast.includes("is an example"))).toEqual([])
    expect(isUntouched()).toBe(true)
  })

  test("an other repository's example asks what the real button asks, and an answer is said as the example's", async ($, on) => {
    const { clock, world, seen, ui, isUntouched } = await examplesOn($, on)
    await visit(clock, ui, world, ADMIN)
    const said =
      'acme/admin#7 is an example: in your own list, "New session" would go ahead. Nothing was sent to GitHub.'

    world.answer = "New session"
    await pressDrawn(clock, ui, "review-7")
    await settleUntil(clock, () => seen.toasts.at(-1) === said)

    expect(seen.toasts.at(-1)).toBe(said)
    expect(world.header).toBe("Review PR")
    expect(world.subject).toMatch(/^#7 Roles and permissions/)
    expect(isUntouched()).toBe(true)
  })

  test("on acme/web's, a button that is no branch skill asks what the real one asks, clone or none", async ($, on) => {
    const { clock, world, ui, isUntouched } = await examplesOn($, on, { answer: "Cancel" })
    await visit(clock, ui, world, WEB)

    world.answer = "Cancel"
    await pressDrawn(clock, ui, "rerun-12")
    await settleUntil(clock, () => world.header === "Re-Run CI")

    expect(world.header).toBe("Re-Run CI")
    expect(world.subject).toMatch(/^#12 Checkout page/)
    expect(isUntouched()).toBe(true)
  })

  test(
    "with the alerts from other repositories on, the demo's alerts tell what changed there too, named by repository",
    { options: { alertOtherRepos: true, systemNotification: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
      await startSession($)
      await clock.settle()
      const tries = () => seen.debug.filter((line) => line.includes("ui.notify")).length
      const before = tries()

      await runPrs($, "demo")
      await clock.advance(DEMO_TOAST_GAP_MS * (DEMO_ALERTS.length + 1))

      expect(seen.toasts.slice(-2)).toEqual([
        DEMO_ALERTS.at(-1),
        "⌕ acme/admin#7 Roles and permissions (another-teammate) — review requested · /prs acme/admin"
      ])
      // The examples' system notification, and acme/admin's.
      expect(tries() - before).toBe(2)
      await leaveExamples($, clock)
    }
  )

  test("with them off, the demo's alerts are the examples' own", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()

    await runPrs($, "demo")
    await clock.advance(DEMO_TOAST_GAP_MS * (DEMO_ALERTS.length + 1))

    expect(seen.toasts.at(-1)).toBe(DEMO_ALERTS.at(-1))
    await leaveExamples($, clock)
  })

  test("while a turn runs, an example's button asks as the real one does then", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on, { answer: "Cancel" })
    await $.turn.start(skillTurnStart("busy"))

    await pressDrawn(clock, ui, "review-1240")
    await settleUntil(clock, () => world.header === "Review PR")

    expect(`${world.question} ${world.detail ?? ""}`).toContain("This session is busy")
    world.header = undefined
    await pressDrawn(clock, ui, "create-pr")
    await settleUntil(clock, () => world.header === "Create PR")
    expect(`${world.question} ${world.detail ?? ""}`).toContain("This session is busy")
    await $.turn.complete(skillTurnEnd("busy"))
  })

  test(
    "Refresh leaving the demo checks other repositories too, as the list's own Refresh does",
    { options: { alertOtherRepos: true, refresh: "on-demand" } },
    async ($, on) => {
      const { clock, seen, ui } = await examplesOn($, on)
      const checks = () => seen.runs.filter((run) => run.includes("archived:false")).length
      const before = checks()

      await ui.press({ key: "refresh" })
      await clock.settle()

      expect(checks()).toBe(before + 1)
    }
  )

  test("typed in the picker's field: an example repository, or a folder in its clone, shows; another is said to be none", async ($, on) => {
    const { clock, world, seen, ui, isUntouched } = await examplesOn($, on)
    // The picker opened, `typed` typed in its field, and what it says when that shows nothing.
    const typed = async (text: string): Promise<string> => {
      world.answer = text
      await pressDrawn(clock, ui, "repo")
      await clock.settle()
      const problem = drawnNodes(await ui.drawn()).find(
        (node) => node.type === "Text" && String(node.children?.[0]).startsWith("⚠ ")
      )?.children?.[0]
      if (problem !== undefined) {
        await pressDrawn(clock, ui, "answer-1")
        await clock.settle()
      }

      return String(problem ?? "")
    }

    expect(await typed("~/code/web/src")).toBe("")
    expect(await header(ui)).toMatch(/^acme\/web /)
    expect(await typed("acme/admin")).toBe("")
    expect(await header(ui)).toMatch(/^acme\/admin /)
    expect(await typed("~/code/web")).toBe("")
    expect(await header(ui)).toMatch(/^acme\/web /)
    // As /prs <path> reads a folder: from the home folder, or the session's, which stands for the examples' own.
    expect(await typed(".")).toBe("")
    expect(await header(ui)).toMatch(/^Example pull requests /)
    expect(await typed("/Users/me/code/web")).toBe("")
    expect(await header(ui)).toMatch(/^acme\/web /)

    // What names none of the examples is said in the picker, and the visit stays.
    expect(await typed("~/code/web/../api")).toBe(
      "⚠ ~/code/web/../api is none of the examples: in your own list, its pull requests would show. Nothing was read from GitHub."
    )
    expect(await typed("acme/other")).toBe(
      "⚠ acme/other is none of the examples: in your own list, its pull requests would show. Nothing was read from GitHub."
    )
    expect(await header(ui)).toMatch(/^acme\/web /)
    expect(await typed("what now")).toBe(
      '⚠ "what now" is no repository: type owner/name, an address, or a folder\'s path.'
    )
    expect(seen.toasts.filter((toast) => toast.includes("examples") || toast.includes("no repository"))).toEqual([])
    expect(isUntouched()).toBe(true)
  })

  test("Refresh on a visit leaves the demo; the next demo starts on the examples' own list", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    await visit(clock, ui, world, WEB)

    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()

    await runPrs($, "demo")
    await clock.settle()
    expect(await header(ui)).toMatch(/^Example pull requests /)
  })

  test("a second demo during a visit starts on the examples' own list", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    await visit(clock, ui, world, WEB)

    await runPrs($, "demo")
    await clock.settle()

    expect(await header(ui)).toMatch(/^Example pull requests /)
  })

  test("a repository picked after that demo ended shows nothing of the examples, in the next demo neither", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    world.answer = "Show"
    world.picks = [WEB]
    world.whileAsking = () => void runPrs($, "").then(() => runPrs($, "demo"))

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(await header(ui)).toMatch(/^Example pull requests /)
  })

  test("a repository picked after a second demo started shows nothing of the first's", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    world.answer = "Show"
    world.picks = [WEB]
    world.whileAsking = () => void runPrs($, "demo")

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(await header(ui)).toMatch(/^Example pull requests /)
  })

  test("a name typed in the picker after that demo ended says nothing, and the picker closes", async ($, on) => {
    const { clock, seen, ui } = await examplesOn($, on)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    await runPrs($, "")
    await clock.settle()

    // The examples' pane is the terminal's, where its field takes typing.
    await (ui as Mounted<"terminal", "Pane">).input({ key: fieldKey(drawnNodes(await ui.drawn())), text: "acme/other" })
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    expect(wordsIn(drawnNodes(await ui.drawn()))).not.toContain("none of the examples")
    expect(seen.toasts.filter((toast) => toast.includes("none of the examples"))).toEqual([])
  })

  test("a visit draws on every surface as a real one: its name, the banner, Back and the picker", async ($, on) => {
    const { clock, world, ui } = await examplesOn($, on)
    await visit(clock, ui, world, WEB)
    await ui.unmount()

    for (const surface of SURFACES) {
      const drawn = await mountPane($, surface)
      expect(await header(drawn)).toMatch(/^acme\/web .*Not this session's folder/)
      expect(await drawn.find({ key: "back" })).toBeDefined()
      expect(await drawn.find({ key: "repo" })).toBeDefined()
      expect(await drawn.find({ type: "Text", text: "Checkout page" })).toBeDefined()
      await drawn.unmount()
    }
  })
})
