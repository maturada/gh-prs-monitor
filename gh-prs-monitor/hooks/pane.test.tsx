// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import { QUERY_VERSION } from "./shared"
import { sharedAnswer } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import {
  clockOf,
  MINUTE,
  SURFACES,
  machine,
  startSession,
  drawnNodes,
  hasText,
  wordsIn,
  mountPane,
  skillTurnStart,
  skillTurnEnd,
  keptList,
  keptOverReload,
  runPrs,
  lines,
  GITHUB
} from "./testing/world"
import type { World, Drawn } from "./testing/world"
import type { On, RenderSurface } from "claude-code"

// Written out per surface rather than read from layout.ts, so a change there shows here as the drawing it changes.
// The space down between framed buttons and what is above them, or their wrapped rows (`buttonsApart`).
const BUTTONS_APART: Readonly<Record<RenderSurface, number>> = {
  terminal: 0,
  desktop: 1,
  vscode: 0.25,
  mobile: 1
}

describe("the pane", () => {
  test("the pane lists both groups with their status on every surface", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      for (const title of ["Your Pull Requests", "Waiting On Your Review"]) {
        expect((await ui.find({ type: "Text", text: title }))?.props).toMatchObject({ bold: true })
        expect((await ui.find({ type: "Text", text: title }))?.props.underline).toBe(undefined)
      }
      // No status carries a shape for a mark.
      expect(await ui.findAll({ type: "Text", text: /^[●◆] / })).toEqual([])
      expect((await ui.find({ key: "header" }))?.props.borderStyle).toBe("round")
      // The header's counts, each number bold after its mark, on one line with the name that never parts.
      const counts = drawnNodes(await ui.find({ key: "header-title" })).filter(
        (node) => node.type === "Text" && node.props?.bold && /^\d+$/.test(String(node.children?.[0]))
      )
      expect(counts.map((node) => node.children?.[0])).toEqual(["1", "1", "1"])
      expect((await ui.find({ key: "panel-mine" }))?.props.borderStyle).toBe("round")
      expect((await ui.find({ key: "panel-review" }))?.props.borderStyle).toBe("round")
      // VS Code draws a frame flush on what it holds, where buttons at its edge would touch it.
      for (const frame of ["header", "panel-mine", "card-1"]) {
        expect((await ui.find({ key: frame }))?.props.paddingY).toBe(surface === "vscode" ? 0.25 : undefined)
      }
      // A rule under each title and between rows, as in a table, none above the first row; an app spaces them
      // apart instead.
      const titleRule = await ui.find({ key: "rule-title" })
      expect(surface === "terminal" ? titleRule?.props.height : titleRule?.props.marginTop).toBe(1)
      // There each pull request is a card of its own instead.
      expect((await ui.find({ key: "card-1" }))?.props.borderStyle).toBe(surface === "terminal" ? undefined : "round")
      // Framed buttons keep their frames off the facts above; the terminal's are text a line high.
      expect((await ui.find({ key: "actions" }))?.props.marginTop).toBe(BUTTONS_APART[surface] || undefined)
      // VS Code wraps a row unless told not to: there the number and the title say so, and the title wraps beside it.
      const titleLine = drawnNodes(await ui.find({ key: "pr-1" })).find(
        (node) => node.type === "Box" && node.props?.gap === 1
      )
      expect(wordsIn(drawnNodes(titleLine))).toContain("Fix the menu")
      expect(titleLine?.props?.flexWrap).toBe(surface === "vscode" ? "nowrap" : undefined)
      expect((titleLine?.children?.[0] as Drawn | undefined)?.props?.flexWrap).toBe(
        surface === "vscode" ? "nowrap" : undefined
      )
      expect(await ui.find({ key: "rule-2" })).toBeDefined()
      expect(await ui.find({ key: "rule-1" })).toBeUndefined()
      // VS Code draws the theme's warning as plain text, so there it is the theme's terminal yellow.
      const warning = surface === "vscode" ? "yellow" : "warning"
      const changes = await ui.find({ type: "Text", text: "❗ Changes Requested" })
      expect(changes?.props).toMatchObject({ color: warning, bold: true })
      expect(changes?.props.backgroundColor).toBe(undefined)
      expect((await ui.find({ type: "Text", text: "✅ Ready To Merge" }))?.props.color).toBe("success")
      expect((await ui.find({ type: "Text", text: "✅ Ready To Merge" }))?.props.dimColor).toBe(undefined)
      expect((await ui.find({ type: "Text", text: "🔍 Review Requested" }))?.props.color).toBe(warning)
      expect(await ui.findAll({ type: "Text", text: /[▐▌\u{E0B6}\u{E0B4}]/u })).toEqual([])
      expect(await ui.find({ type: "Link", text: "#1" })).toBeDefined()
      expect(await ui.find({ key: "resolve-1" })).toBeDefined()
      expect(await ui.find({ key: "resolve-2" })).toBeUndefined()
      expect(await ui.find({ key: "review-7" })).toBeDefined()
      await ui.unmount()
    }
  })

  test("each row's next step is its main button; a row waiting on others has none", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Fix the menu", ci: "FAILURE", threads: [{ isResolved: false }] },
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", isDraft: true }
      ],
      requested: [{ number: 7, title: "Usage chart", author: "ann" }],
      commented: [{ number: 8, title: "Activity cards", author: "bob" }]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    const variant = async (key: string): Promise<unknown> => (await ui.find({ key }))?.props.variant
    const label = async (key: string): Promise<unknown> => (await ui.find({ key }))?.props.label

    expect(await variant("rerun-1")).toBe("primary")
    expect(await variant("resolve-1")).toBe(undefined)
    expect(await variant("fixCi-1")).toBe(undefined)
    expect(await variant("merge-2")).toBe("primary")
    expect(await variant("ready-3")).toBe("primary")
    expect(await variant("review-7")).toBe("primary")
    expect(await variant("review-8")).toBe(undefined)
    expect(await label("rerun-1")).toBe("Re-Run CI")
    expect(await label("fixCi-1")).toBe("Fix CI")
    expect(await label("ready-3")).toBe("Ready For Review")
  })

  test("details stay dim and link to where they are dealt with; a CI mark and good news take their colour", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Fix the menu", ci: "FAILURE", threads: [{ isResolved: false }] },
        {
          number: 2,
          title: "Add a legend",
          reviews: [{ login: "ann", state: "APPROVED", at: "2026-10-07T09:00:00Z" }]
        },
        { number: 3, title: "Rename the fields", isDraft: true },
        { number: 4, title: "Speed up the map", ci: "PENDING", requested: ["ann"] }
      ],
      requested: [
        { number: 7, title: "Usage chart", author: "bob", ci: "FAILURE" },
        { number: 8, title: "Draft chart", author: "bob", isDraft: true }
      ]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    const failing = await ui.find({ type: "Link", text: "❗ CI Failing" })

    expect(failing?.props.href).toBe("https://github.com/acme/app/pull/1/checks")
    expect((await ui.find({ type: "Link", text: "1 unresolved comment" }))?.props.href).toBe(
      "https://github.com/acme/app/pull/1/files"
    )
    // Good news reads in green, not dim: the status keeps green for what can merge now.
    const approval = drawnNodes(await ui.drawn()).find(
      (node) => node.type === "Text" && node.children?.[0] === "approved: ann"
    )
    expect(approval?.props).toMatchObject({ color: "success" })
    expect(approval?.props?.dimColor).toBe(undefined)
    expect((await ui.find({ type: "Text", text: "Rename the fields" }))?.props.dimColor).toBe(true)
    // Drafts are dim in both lists, as they aren't up for review yet.
    expect((await ui.find({ type: "Text", text: "Draft chart" }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: "Text", text: "Usage chart" }))?.props.dimColor).toBe(undefined)
    // A green check needs no visit, and a terminal without links would print its address; its ✓ alone is green.
    expect(await ui.findAll({ type: "Link", text: "CI ✓" })).toEqual([])
    expect((await ui.find({ type: "Text", text: /^CI$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: "Text", text: /^✓$/ }))?.props.color).toBe("success")
    // Running and failed CI lead to the checks; their marks are yellow and red, as on GitHub.
    expect((await ui.findAll({ type: "Link", text: /^CI$/ })).map((link) => link.props.href)).toEqual([
      "https://github.com/acme/app/pull/4/checks",
      "https://github.com/acme/app/pull/7/checks"
    ])
    expect((await ui.find({ type: "Text", text: /^●$/ }))?.props.color).toBe("warning")
    expect((await ui.find({ type: "Text", text: /^✗$/ }))?.props.color).toBe("error")
    await ui.unmount()

    // VS Code draws the theme's warning as plain text: there a running check is the theme's terminal yellow.
    const editor = await mountPane($, "vscode")
    expect((await editor.find({ type: "Text", text: /^✓$/ }))?.props.color).toBe("success")
    expect((await editor.find({ type: "Text", text: /^●$/ }))?.props.color).toBe("yellow")
    expect((await editor.find({ type: "Text", text: /^✗$/ }))?.props.color).toBe("error")
  })

  test("the header links the repository, counts like the status line, and r refreshes", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")

    expect((await ui.find({ type: "Link", text: "acme/app" }))?.props.href).toBe("https://github.com/acme/app/pulls")
    expect(await ui.find({ type: "Text", text: "✅ 1  ❗ 1  🔍 1" })).toBeDefined()
    expect((await ui.find({ key: "refresh" }))?.props.hotkey).toBe("r")
  })

  test("a row's status has a line of its own, the facts the next, wherever a narrow pane breaks them", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 40)
      const row = drawnNodes(await ui.drawn()).find((node) => node.props?.key === "pr-1")
      const lineOf = (key: string) => drawnNodes((row?.children as Drawn[]).find((node) => node.props?.key === key))
      const status = lineOf("status")
      const facts = lineOf("facts")

      expect(wordsIn(status)).toBe("❗ Changes Requested")
      expect(wordsIn(facts)).toBe("CI ✓ · 1 unresolved comment")
      expect(facts[0]?.props?.flexWrap).toBe("wrap")
      await ui.unmount()
    }
  })

  test("buttons sit a cell apart, and their wrapped rows keep their frames apart: none in the terminal, a quarter of a line in VS Code", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      const gaps = { columnGap: 1, rowGap: BUTTONS_APART[surface] }

      expect((await ui.find({ key: "actions" }))?.props).toMatchObject({ ...gaps, flexWrap: "wrap" })
      expect((await ui.find({ key: "header-buttons" }))?.props).toMatchObject({ ...gaps, flexWrap: "wrap" })
      await ui.unmount()
    }
  })

  test("a stacked row shows its stack in the compact view, just before the status, counted when it decides one line or two", async ($, on) => {
    const clock = clockOf(on)
    const stacked: ResponseFixture = {
      ...GITHUB,
      mine: [
        { ...GITHUB.mine![0]!, stack: { number: 30, position: 2, size: 4 } },
        { ...GITHUB.mine![1]!, stack: { number: 31, position: 10, size: 12 } }
      ],
      requested: [{ ...GITHUB.requested![0]!, stack: { number: 32, position: 1, size: 2 } }]
    }
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const compactAt = async (surface: "terminal" | "desktop", columns: number) => {
      const ui = await mountPane($, surface, columns)
      await ui.press({ key: "view" })
      const nodes = drawnNodes(await ui.drawn())
      await ui.press({ key: "view" })
      await ui.unmount()
      const row = (number: number) => nodes.find((node) => node.props?.key === `pr-${number}`)
      const stack = (number: number) => drawnNodes(row(number)).find((node) => node.props?.key === "stack")

      return { row, stack }
    }

    // One line from 49 columns without a stack, or 66 with "stack #31 10/12" and the two columns after it.
    expect((await compactAt("terminal", 52)).row(1)?.props?.flexDirection).not.toBe("column")
    world.github = stacked
    await clock.advance(3 * MINUTE)
    const narrow = await compactAt("terminal", 65)
    expect(narrow.row(1)?.props?.flexDirection).toBe("column")
    // Two lines keep the stack at the title line's end, with no status beside it to keep apart from.
    expect(narrow.stack(1)).toBeDefined()
    expect(narrow.stack(1)?.props?.marginRight).toBeUndefined()
    expect((await compactAt("terminal", 66)).row(1)?.props?.flexDirection).not.toBe("column")

    // Right before the status, a column further apart, the two at the line's end: no column of cells, so a stack never
    // sits mid-row ahead of a short status.
    for (const surface of ["terminal", "desktop"] as const) {
      const wide = await compactAt(surface, 100)
      for (const number of [1, 2, 7]) {
        const parts = (wide.row(number)?.children ?? []) as Drawn[]
        expect(wide.row(number)?.props?.flexDirection).not.toBe("column")
        expect(parts.indexOf(wide.stack(number)!)).toBe(parts.length - 2)
        expect(wide.stack(number)?.props).toMatchObject({ flexShrink: 0, marginRight: 1 })
        expect(wide.stack(number)?.props?.width).toBeUndefined()
        expect(parts.at(-1)?.props?.width).toBeUndefined()
      }
      expect(drawnNodes(wide.stack(1)).find((node) => node.type === "Text")).toMatchObject({
        props: { dimColor: true },
        children: ["stack #30 2/4"]
      })
      expect(hasText(drawnNodes(wide.stack(2)), "stack #31 10/12")).toBe(true)
      expect(hasText(drawnNodes(wide.stack(7)), "stack #32 1/2")).toBe(true)
    }

    // The full view names the stack in the details instead.
    const full = await mountPane($, "terminal", 100)
    expect(await full.find({ key: "stack" })).toBeUndefined()
    expect(await full.find({ type: "Text", text: /stack #30 2\/4/ })).toBeDefined()
  })

  test("a terminal's detail moves to the next line whole: its box is as wide as its text, up to a line; an app's has no width", async ($, on) => {
    const clock = clockOf(on)
    const reviewer = "a-reviewer-with-a-very-long-name"
    const github: ResponseFixture = {
      mine: [{ number: 1, title: "Fix the menu", requested: ["ann", reviewer], threads: [{ isResolved: false }] }]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const factsAt = async (columns: number, surface: (typeof SURFACES)[number] = "terminal") => {
      const ui = await mountPane($, surface, columns)
      const facts = await ui.find({ key: "facts" })
      await ui.unmount()

      return (facts?.children ?? []) as Drawn[]
    }
    // Each detail but CI, whose mark keeps it whole already.
    const boxesAt = async (columns: number) =>
      (await factsAt(columns)).filter((child) => child.props?.minWidth !== undefined)
    const text = `requested: ann, ${reviewer}`

    // Wide: exactly its text, with the no-break space and dot ending all but the last one.
    expect((await boxesAt(100)).map((box) => box.props?.minWidth)).toEqual([
      text.length + 2,
      "1 unresolved comment".length
    ])
    // Narrow: no wider than the room past the number column, which a box wider than the line would overflow.
    const [narrow] = await boxesAt(30)
    expect(narrow?.props?.minWidth).toBeGreaterThan(0)
    expect(narrow?.props?.minWidth).toBeLessThan(text.length)
    // An app moves a detail whole by itself, and a width in cells would leave a gap after its narrower text: there it
    // may shrink to the line, as a title does, and wraps within it.
    for (const surface of SURFACES.filter((each) => each !== "terminal")) {
      for (const columns of [100, 30]) {
        const details = (await factsAt(columns, surface)).filter((child) => child.props?.minWidth !== undefined)
        expect(details.map((box) => box.props)).toEqual([
          { flexShrink: 1, minWidth: 0 },
          { flexShrink: 1, minWidth: 0 }
        ])
        expect(details.map((box) => (box.children?.[0] as Drawn | undefined)?.props?.wrap)).toEqual(["wrap", "wrap"])
      }
    }
  })

  test("a long title wraps in its own column on every surface, never cut short", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      for (const view of ["full", "compact"]) {
        const title = await ui.find({ type: "Text", text: "Fix the menu" })
        expect(title?.props.wrap).toBe("wrap")
        // Its box may shrink below the title's length, leaving the compact view's status its room.
        const box = drawnNodes(await ui.find({ key: "pr-1" })).find(
          (node) =>
            node.type === "Box" &&
            (node.children ?? []).some((child) => (child as Drawn).children?.[0] === "Fix the menu")
        )
        expect(box?.props).toMatchObject({ minWidth: 0, flexShrink: 1 })
        if (view === "full") {
          await ui.press({ key: "view" })
        }
      }
      await ui.press({ key: "view" })
      await ui.unmount()
    }
  })

  test("a row's details are parted by dim dots, each ending the detail before it", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [{ number: 1, title: "Fix the menu", requested: ["ann"], threads: [{ isResolved: false }] }]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      const facts = drawnNodes(await ui.find({ key: "facts" }))

      expect(wordsIn(facts)).toBe("CI ✓ · requested: ann · 1 unresolved comment")
      // At the end of the short, coloured CI result too, which is kept whole, its spaces the text's own.
      const ci = (facts[0]?.children as Drawn[]).find((node) => node.type === "Box" && hasText(drawnNodes(node), "CI"))
      expect(drawnNodes(ci).find((node) => node.children?.[0] === "\u00a0·")?.props).toMatchObject({ dimColor: true })
      expect(ci?.props?.flexShrink).toBe(0)
      expect(ci?.props?.gap).toBeUndefined()
      // At the end of a dim one, in the same text, joined by a no-break space, so it stays with the detail's last word.
      const requested = facts.find(
        (node) =>
          node.type === "Text" &&
          (node.children ?? []).some((child) => (child as Drawn).children?.[0] === "requested: ann")
      )
      expect((requested?.children as Drawn[]).map((child) => [child.children?.[0], child.props?.dimColor])).toEqual([
        ["requested: ann", true],
        ["\u00a0·", true]
      ])
      // None after the last, a link to the changed files.
      const last = facts.find(
        (node) =>
          node.type === "Text" && (node.children?.[0] as Drawn | undefined)?.props?.label === "1 unresolved comment"
      )
      expect(last?.children).toHaveLength(1)
      await ui.unmount()
    }
  })

  test("the pointer on a row lights its title", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    // A hover is the surface's to apply, so it rides on the drawn tree beside the element's props.
    const all = drawnNodes(await ui.drawn())

    expect(all.find((node) => node.props?.key === "pr-1")?.hover).toEqual({ scope: "pr-1" })
    expect(all.find((node) => node.type === "Text" && node.children?.[0] === "Fix the menu")?.hover).toEqual({
      scope: "pr-1",
      color: "suggestion"
    })
  })

  test("a list cut short says so, and links to the rest on GitHub", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: { ...GITHUB, totals: { mine: 45 } }, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    const more = await ui.findAll({ type: "Link", text: "More on GitHub" })

    expect(more).toHaveLength(1)
    expect(more[0]?.props.href).toBe("https://github.com/acme/app/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me")
    expect(await ui.find({ type: "Text", text: "Only the most recently updated are listed." })).toBeDefined()
  })

  test("a waiting status is plain bold text, in the theme's own colour", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: { mine: [{ number: 3, title: "Legend", requested: ["ann"] }] },
      branch: "main",
      uncommitted: 0
    })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    const waiting = await ui.find({ type: "Text", text: "Waiting For Review" })

    expect(waiting?.text).toBe("Waiting For Review")
    // Dimmed, so it doesn't read as a second title in the title's own colour.
    expect(waiting?.props).toMatchObject({ bold: true, dimColor: true })
    expect(waiting?.props.color).toBe(undefined)
    expect(waiting?.props.backgroundColor).toBe(undefined)
    expect((await ui.find({ type: "Text", text: "Legend" }))?.props.dimColor).toBe(undefined)
  })

  test("the two panels sit side by side when the pane is wide, and stack a line apart when narrow", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const wide = await mountPane($, "terminal", 140)
    expect((await wide.find({ key: "panels" }))?.props.flexDirection).toBe("row")
    expect((await wide.find({ key: "panel-mine" }))?.props.width).toBe(69)
    await wide.unmount()

    const narrow = await mountPane($, "terminal", 80)
    expect((await narrow.find({ key: "panels" }))?.props.flexDirection).toBe("column")
    // Stacked panels whose borders met would read as one box.
    expect((await narrow.find({ key: "panels" }))?.props.gap).toBe(1)
    expect((await narrow.find({ key: "panel-mine" }))?.props.width).toBe(undefined)
  })

  test("an empty list takes one line, and leaves the full width to the other", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: { mine: GITHUB.mine }, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 140)
      expect((await ui.find({ key: "panels" }))?.props.flexDirection).toBe("column")
      expect((await ui.find({ key: "panel-mine" }))?.props.width).toBe(undefined)
      const empty = drawnNodes(await ui.find({ key: "panel-review" }))
      expect(empty[0]?.props?.flexDirection).toBe(undefined)
      expect(hasText(empty, "Waiting On Your Review")).toBe(true)
      expect(hasText(empty, "0")).toBe(true)
      expect(hasText(empty, "Nothing waits on your review.")).toBe(true)
      // Only the list with rows has a rule under its title.
      expect(await ui.findAll({ key: "rule-title" })).toHaveLength(1)
      await ui.unmount()
    }
  })

  test("Compact shows each pull request on one line, its status at the end, and Full brings the rest back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "fix/menu", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      expect((await ui.find({ key: "view" }))?.props.label).toBe("Compact")
      await ui.press({ key: "view" })

      expect((await ui.find({ key: "view" }))?.props.label).toBe("Full")
      const line = drawnNodes(await ui.find({ key: "pr-1" }))
      expect(hasText(line, "Fix the menu")).toBe(true)
      expect(hasText(line, "❗ Changes Requested")).toBe(true)
      expect(hasText(line, "●")).toBe(true)
      // No facts, buttons or what changed lately, and nothing between the lines: no rule, no card.
      expect(await ui.find({ type: "Text", text: "1 unresolved comment" })).toBeUndefined()
      expect(await ui.find({ key: "resolve-1" })).toBeUndefined()
      expect(await ui.find({ key: "rule-2" })).toBeUndefined()
      expect(await ui.find({ key: "card-1" })).toBeUndefined()
      expect(await ui.find({ key: "rule-title" })).toBeDefined()

      await ui.press({ key: "view" })
      expect(await ui.find({ key: "resolve-1" })).toBeDefined()
      expect(await ui.find({ type: "Text", text: "1 unresolved comment" })).toBeDefined()
      await ui.unmount()
    }
  })

  test("a narrow pane puts the header's buttons under the name, and compact rows on two lines", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "fix/menu", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const [columns, isNarrow] of [
      [40, true],
      [100, false]
    ] as const) {
      const ui = await mountPane($, "terminal", columns)
      expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe(isNarrow ? "column" : "row")
      await ui.press({ key: "view" })
      const row = drawnNodes(await ui.drawn()).find((node) => node.props?.key === "pr-1")
      const lines = (row?.children as Drawn[]).filter((node) => node.type === "Box")
      // Two lines, the status under the title, or one that ends with the status.
      expect(row?.props?.flexDirection).toBe(isNarrow ? "column" : undefined)
      expect(wordsIn(drawnNodes(lines.find((node) => node.props?.key === "status")))).toBe(
        isNarrow ? "❗ Changes Requested" : ""
      )
      expect(wordsIn(drawnNodes(row)).endsWith("❗ Changes Requested")).toBe(true)
      await ui.press({ key: "view" })
      await ui.unmount()
    }
  })

  test("the branch mark sits in a gutter its panel's rows share, and takes nothing from the title", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "fix/menu", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 30)
      const marks = await ui.findAll({ key: "mark" })
      // Both of your rows have the gutter, the one on the branch marked; the other panel has none.
      expect(marks.map((mark) => mark.props.width)).toEqual([2, 2])
      expect(await ui.findAll({ type: "Text", text: /^●$/ })).toHaveLength(1)
      expect(hasText(drawnNodes(await ui.find({ key: "pr-1" })), "●")).toBe(true)
      // The lines under a title start past the gutter and the widest number, "● #1 ".
      expect((await ui.find({ key: "status" }))?.props.paddingLeft).toBe(5)
      // The name, too, wraps rather than being cut short.
      expect((await ui.find({ type: "Text", text: "acme/app" }))?.props.wrap).toBe("wrap")
      await ui.unmount()
    }
  })

  test("a store too full for the view gives up the answers sessions share first", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const other = `shared:github.com/acme/other:me:${QUERY_VERSION}`
    const padding = { mine: [{ number: 9, title: "x".repeat(6_000) }] }
    world.store = { ...world.store, [other]: sharedAnswer("another-session", 0, padding) }
    world.storeLimit = JSON.stringify(world.store).length + 10

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "view" })
    await clock.settle()

    expect(world.store?.isCompact).toBe(true)
    expect(world.store?.[other]).toBeUndefined()
  })

  test("two presses at once of Compact leave the view as it was", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await Promise.all([ui.press({ key: "view" }), ui.press({ key: "view" })])
    await clock.settle()

    expect((await ui.find({ key: "view" }))?.props.label).toBe("Compact")
    expect(world.store?.isCompact).toBe(false)
  })

  test("compact rows go to two lines where the title would get less than 20 columns", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    // "❗ Changes Requested" beside "#1 ", with a column between each of number, title, spacer and status: one line
    // from 49 columns of pane, the panel's border and padding taking 4.
    for (const [columns, direction] of [
      [48, "column"],
      [49, undefined]
    ] as const) {
      const ui = await mountPane($, "terminal", columns)
      await ui.press({ key: "view" })
      const row = drawnNodes(await ui.drawn()).find((node) => node.props?.key === "pr-1")
      expect(row?.props?.flexDirection).toBe(direction)
      await ui.press({ key: "view" })
      await ui.unmount()
    }
  })

  test("a compact row's long text of what is under way takes its own line rather than run past the panel", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "fix/menu",
      uncommitted: 0,
      answer: "Here, on this branch",
      slowCommandMs: 5_000
    }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))

    // One line at 50 columns, but what the row says while Resolve Comments waits for the turn is longer than the
    // status it stands in for.
    const ui = await mountPane($, "terminal", 50)
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    await ui.press({ key: "view" })
    const row = drawnNodes(await ui.drawn()).find((node) => node.props?.key === "pr-1")

    expect(wordsIn(drawnNodes(row))).toContain("Resolving Comments Starts When This Turn Ends")
    expect(row?.props?.flexDirection).toBe("column")
    await $.turn.complete(skillTurnEnd("busy"))
    await clock.advance(5_000)
  })

  test("the header's buttons go under the name once name, counts, time and buttons don't fit on one line", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: { mine: [GITHUB.mine![1]!] }, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const direction = async (columns: number) => {
      const ui = await mountPane($, "terminal", columns)
      const header = await ui.find({ key: "header" })
      await ui.unmount()

      return header?.props.flexDirection
    }

    // The buttons a cell apart are part of the width: one column less and they no longer fit.
    expect(await direction(42)).toBe("column")
    expect(await direction(43)).toBe("row")
  })

  test("the name wraps, and the counts go under it whole where both don't fit side by side", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal", 30)

    expect((await ui.find({ key: "header-title" }))?.props).toMatchObject({ flexWrap: "wrap", columnGap: 2 })
  })

  test("a terminal button too wide past the number column starts at the panel's edge, never broken", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        {
          number: 1234,
          title: "Cache the tiles",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const indentAt = async (surface: "terminal" | "desktop", columns: number) => {
      const ui = await mountPane($, surface, columns)
      const actions = await ui.find({ key: "actions" })
      await ui.unmount()

      return actions?.props.paddingLeft
    }

    // "[ Re-Request Review ]" takes 21 columns.
    expect(await indentAt("terminal", 30)).toBe(0)
    // At 31, room for it exactly.
    expect(await indentAt("terminal", 31)).toBe(6)
    expect(await indentAt("terminal", 100)).toBe(6)
    // An app wraps a label inside its button, so its buttons keep their place.
    expect(await indentAt("desktop", 30)).toBe(6)
  })

  test("the header keeps its shape while refreshing, and spaces its buttons under the name where a surface spaces by steps", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: { mine: [GITHUB.mine![1]!] }, branch: "main", uncommitted: 0 }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // At 41 columns "updated 01:00" no longer fits beside the buttons, though "refreshing…" would.
    const ui = await mountPane($, "terminal", 41)
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe("column")
    world.slowGithubMs = 20_000
    await ui.press({ key: "refresh" })
    expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeDefined()
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe("column")
    expect((await ui.find({ key: "header-buttons" }))?.props.marginTop).toBe(undefined)
    await clock.advance(30_000)
    await ui.unmount()

    const app = await mountPane($, "desktop", 41)
    expect((await app.find({ key: "header-buttons" }))?.props.marginTop).toBe(1)
    await app.unmount()

    // VS Code spaces by rows, as the terminal does: a margin there would be a blank line.
    const editor = await mountPane($, "vscode", 41)
    expect((await editor.find({ key: "header" }))?.props.flexDirection).toBe("column")
    expect((await editor.find({ key: "header-buttons" }))?.props.marginTop).toBe(undefined)
  })

  test(
    "a list from another day says the day, as the problem box does",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const today = new Date(2026, 9, 13, 9, 0).getTime()
      const yesterday = new Date(2026, 9, 12, 17, 40).getTime()
      clockOf(on, { now: today })
      machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      keptOverReload(on, { snapshot: { ...keptList(GITHUB)!, fetchedAt: yesterday } })
      await startSession($)

      const ui = await mountPane($, "terminal", 120)
      expect(await ui.find({ type: "Text", text: "updated yesterday 17:40" })).toBeDefined()
    }
  )

  test("the header makes room for a day in its time", { options: { refresh: "on-demand" } }, async ($, on) => {
    clockOf(on, { now: new Date(2026, 9, 13, 9, 0).getTime() })
    const github = { mine: [GITHUB.mine![1]!] }
    machine($, on, { github, branch: "main", uncommitted: 0 })
    keptOverReload(on, { snapshot: { ...keptList(github)!, fetchedAt: new Date(2026, 9, 12, 17, 40).getTime() } })
    await startSession($)

    // At 45 columns "updated 17:40" fits beside the buttons, and "updated yesterday 17:40" doesn't.
    const ui = await mountPane($, "terminal", 45)
    expect(await ui.find({ type: "Text", text: "updated yesterday 17:40" })).toBeDefined()
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe("column")
  })

  test("the line between rows runs the pane's width, clipped to its panel's", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    for (const columns of [60, 450]) {
      const ui = await mountPane($, "terminal", columns)
      expect(await ui.find({ type: "Text", text: "─".repeat(columns) })).toBeDefined()
      expect((await ui.find({ key: "rule-title" }))?.props.overflow).toBe("hidden")
      await ui.unmount()
    }
  })

  test("the view chosen is kept for later sessions", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "view" })
    await clock.settle()
    expect(world.store?.isCompact).toBe(true)
    await ui.unmount()

    // A later session reads it back; one with nothing kept shows the full view.
    const labelIn = async (): Promise<unknown> => {
      await startSession($)
      await clock.settle()
      const later = await mountPane($, "terminal")
      const label = (await later.find({ key: "view" }))?.props.label
      await later.unmount()

      return label
    }
    expect(await labelIn()).toBe("Full")
    world.store = {}
    expect(await labelIn()).toBe("Compact")
  })

  test("a view the store can't read back, or keep, still switches, and only the debug log says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: { isCompact: true },
      isStoreBroken: true
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    expect((await ui.find({ key: "view" }))?.props.label).toBe("Compact")
    expect(seen.debug.some((line) => line.startsWith("The pane's view could not be read back"))).toBe(true)
    world.isStoreBroken = false
    world.storeSetDeny = "the disk is read-only"
    await ui.press({ key: "view" })
    await clock.settle()
    expect((await ui.find({ key: "view" }))?.props.label).toBe("Full")
    expect(seen.debug.some((line) => line.startsWith("The pane's view could not be kept"))).toBe(true)
    expect(world.store?.isCompact).toBe(true)
    await ui.unmount()
  })

  test("the pull request whose branch the session is on is marked, until the session leaves it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: {
        mine: GITHUB.mine,
        // A fork's branch can share the name and still be another branch.
        requested: [
          { number: 7, title: "Usage chart", author: "ann", headRefName: "fix/menu", isCrossRepository: true }
        ]
      },
      branch: "fix/menu",
      uncommitted: 0
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      expect(await ui.findAll({ type: "Text", text: /^●$/ })).toHaveLength(1)
      expect(hasText(drawnNodes(await ui.find({ key: "pr-1" })), "●")).toBe(true)
      await ui.unmount()
    }

    world.branch = "main"
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(await ui.findAll({ type: "Text", text: /^●$/ })).toEqual([])
    expect(await ui.findAll({ key: "mark" })).toEqual([])
  })

  test("a panel's rows line up past its widest number, as in a table", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Fix the menu", ci: "FAILURE" },
        { number: 1234, title: "Add a legend", reviewDecision: "APPROVED" }
      ]
    }
    machine($, on, { github, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    const boxes = await ui.findAll({ type: "Box" })

    // "#1234" and a space: every line under a title starts there, and each number sits in a column that wide.
    expect(new Set(boxes.map((box) => box.props.paddingLeft).filter((left) => left !== undefined))).toEqual(
      new Set([6])
    )
    expect(boxes.filter((box) => box.props.width === 5)).toHaveLength(2)
  })

  test(
    "hidden drafts are counted under your own list, which then never reads as all clear",
    { options: { hideDrafts: true } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, {
        github: { mine: [{ number: 3, title: "Rename the fields", isDraft: true }] },
        branch: "main",
        uncommitted: 0
      })
      await startSession($)
      await clock.settle()

      const ui = await mountPane($, "terminal")

      expect(await ui.find({ type: "Text", text: "Rename the fields" })).toBeUndefined()
      expect(await ui.find({ type: "Text", text: /^1 draft hidden$/ })).toBeDefined()
      expect(await ui.find({ type: "Text", text: "Nothing open and nothing waiting on you." })).toBeUndefined()
      // A draft is an open pull request of yours, so the panel doesn't say there are none.
      expect(await ui.find({ type: "Text", text: "No open pull requests of yours here." })).toBeUndefined()
    }
  )

  test("a panel says when it is empty", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: { requested: [{ number: 7, author: "ann" }] }, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "vscode")

    expect(await ui.find({ type: "Text", text: "No open pull requests of yours here." })).toBeDefined()
  })

  test("with nothing in either list, one line says so instead of two empty panels", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: {}, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")

    expect(await ui.find({ type: "Text", text: "Nothing open and nothing waiting on you." })).toBeDefined()
    // One line under the header, from the pane's own gap, as everything under it is.
    expect((await ui.find({ key: "empty" }))?.props).toEqual({ key: "empty", justifyContent: "center" })
    expect(await ui.find({ key: "panel-mine" })).toBeUndefined()
    expect(await ui.find({ key: "panel-review" })).toBeUndefined()
  })

  test("a button drawn again unchanged keeps its handle, so a press from the drawing an app shows still lands", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const handleOf = async (key: string): Promise<unknown> =>
      (drawnNodes(await ui.drawn()).find((node) => node.props?.key === key) as { press?: { handle?: unknown } })?.press
        ?.handle
    const review = await handleOf("review-7")
    const view = await handleOf("view")
    expect(review).toBeDefined()

    // A refresh that finds nothing new redraws the pane as it goes; a press of the old drawing still runs.
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(await handleOf("review-7")).toBe(review)
    expect(await handleOf("view")).toBe(view)

    // A button that looks different is a new one.
    await ui.press({ key: "view" })
    expect(await handleOf("view")).not.toBe(view)

    await ui.press({ key: "view" })
    await ui.press({ key: "review-7" })
    await clock.settle()
    expect(seen.commands).toEqual(["/gh-prs-monitor:review https://github.com/acme/app/pull/7"])
  })
})

describe("/prs close", () => {
  test("closes the pane, where no click does", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await runPrs($, "")
    await clock.settle()
    expect(world.isPaneOpen).toBe(true)

    const ran = await runPrs($, "Close")
    await clock.settle()

    expect(ran.text).toBe("Closed the pull requests pane.")
    expect(world.isPaneOpen).toBe(false)
  })

  test("keeps the list it showed as the last look", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await runPrs($, "")
    await clock.settle()
    // Gone, as for a list the pane showed but its loads did not keep: only the close puts it back.
    delete world.store?.["look:github.com/acme/app"]

    await runPrs($, "close")
    await clock.settle()

    expect(world.store?.["look:github.com/acme/app"]).toMatchObject({ repo: "acme/app" })
  })

  test("with no pane open, says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "close")).text).toBe("The pull requests pane is not open.")
    expect(world.isPaneOpen).toBe(undefined)
  })

  test("a word /prs doesn't take, as a mistyped close, says what it takes and opens nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const asked = seen.runs.length

    expect((await runPrs($, " clsoe ")).text).toBe('/prs takes nothing, demo, close, report or tickets, not "clsoe".')
    expect(world.isPaneOpen).toBe(undefined)
    expect(seen.runs.length).toBe(asked)
  })
})

describe("/prs report", () => {
  // What the report reads besides the machine: Claude Code's version and the plugin's manifest.
  function reportReads(on: On): void {
    on("session.version", async () => ({ value: { version: "2.1.302" } }))
    on("fs.read", async (_, e, next) =>
      e.path.endsWith("/.claude-plugin/plugin.json")
        ? { value: JSON.stringify({ version: "1.0.0", repository: "https://github.com/maturada/gh-prs-monitor" }) }
        : next(e)
    )
  }

  test("says where to report, with the versions of the plugin, Claude Code and the machine, and leaves the pane be", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    reportReads(on)
    await startSession($)
    await runPrs($, "")
    await clock.settle()
    const asked = seen.runs.length

    const text = (await runPrs($, " Report ")).text
    await clock.settle()

    expect(lines(text)[0]).toBe(
      "gh-prs-monitor 1.0.0 · Claude Code 2.1.302 · macOS 26.4 (Darwin 25.4.0) · gh 2.97.0 · git 2.50.1"
    )
    expect(text).toContain(
      "[Report a bug](https://github.com/maturada/gh-prs-monitor/issues/new?template=bug_report.yml&plugin=1.0.0" +
        "&claude-code=2.1.302&system=macOS+26.4+%28Darwin+25.4.0%29%2C+gh+2.97.0%2C+git+2.50.1)"
    )
    // It asks GitHub nothing.
    expect(seen.runs.slice(asked).sort()).toEqual([
      "gh --version",
      "git --version",
      "sw_vers -productVersion",
      "uname -sr"
    ])
    expect(world.isPaneOpen).toBe(true)
  })

  test("typed while the pane waits for an app to attach, it leaves the pane to open then", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
    machine($, on, world)
    reportReads(on)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await runPrs($, "")
    await clock.settle()

    await runPrs($, "report")
    await clock.settle()
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()

    expect(world.isPaneOpen).toBe(true)
  })
})
