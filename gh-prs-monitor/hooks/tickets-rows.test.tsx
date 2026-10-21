// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import {
  clockOf,
  drawnNodes,
  GITHUB,
  machine,
  mountPane,
  runPrs,
  startSession,
  SURFACES,
  wordsIn
} from "./testing/world"
import type { Drawn, World } from "./testing/world"

const LINEAR = "https://linear.app/acme/issue/{key}"
const LINKED = { "tickets:github.com/acme/app": { "WEB-": LINEAR } }

// The pull request on fix/menu, its branch now naming a ticket.
const KEYED: World["github"] = {
  ...GITHUB,
  mine: [{ ...GITHUB.mine![0]!, headRefName: "feature/WEB-5761-menu" }, GITHUB.mine![1]!]
}

const TICKET = "https://linear.app/acme/issue/WEB-5761"

// A line of a row, as drawn: its status, or its facts.
function lineOf(nodes: Drawn[], number: number, key: "status" | "facts"): Drawn[] {
  const row = nodes.find((node) => node.props?.key === `pr-${number}`)

  return drawnNodes((row?.children as Drawn[]).find((node) => node.props?.key === key))
}

function hasTicketLink(nodes: Drawn[]): boolean {
  return nodes.some((node) => node.type === "Link" && node.props?.href === TICKET)
}

describe("a pull request's ticket on its row", () => {
  test("a branch naming a ticket shows it first in the row's details, as a link, on every surface", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, store: LINKED })
    await startSession($)
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      const nodes = drawnNodes(await ui.drawn())
      const facts = lineOf(nodes, 1, "facts")

      // A detail as the others are, its mark saying it opens elsewhere.
      expect(wordsIn(facts)).toBe("WEB-5761 ⧉ · CI ✓ · 1 unresolved comment")
      expect(facts.find((node) => node.type === "Link")?.props).toMatchObject({
        label: "WEB-5761\u00a0⧉",
        href: TICKET
      })
      expect(wordsIn(lineOf(nodes, 1, "status"))).toBe("❗ Changes Requested")
      await ui.unmount()
    }
  })

  test("in a narrow terminal the ticket moves to the next line whole, its mark and dot with it", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, store: LINKED })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal", 30)
    const [ticket] = (await ui.find({ key: "facts" }))?.children as Drawn[]
    // As wide as the key, the no-break space, the mark and the dot's two cells: a line can't part them.
    expect(ticket?.props?.minWidth).toBe("WEB-5761\u00a0⧉".length + 2)
  })

  test("links another session saved show once the list loads again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: KEYED, branch: "main", uncommitted: 0, store: {} }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    expect(hasTicketLink(drawnNodes(await ui.drawn()))).toBe(false)

    world.store!["tickets:github.com/acme/app"] = { "WEB-": LINEAR }
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(hasTicketLink(drawnNodes(await ui.drawn()))).toBe(true)
  })

  test("a row without a ticket draws as it did before links were set", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: KEYED, branch: "main", uncommitted: 0, store: {} }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const before = await ui.find({ key: "pr-2" })

    world.store!["tickets:github.com/acme/app"] = { "WEB-": LINEAR }
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(hasTicketLink(drawnNodes(await ui.drawn()))).toBe(true)
    expect(await ui.find({ key: "pr-2" })).toEqual(before)
  })

  test("parentheses in a ticket's address keep the printed list's link whole", async ($, on) => {
    const clock = clockOf(on)
    const store = { "tickets:github.com/acme/app": { "WEB-": "https://tracker.example.com/a(b)/{key}" } }
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, surfaces: [], store })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "")).text).toContain("](https://tracker.example.com/a%28b%29/WEB-5761)")
  })

  test("the compact view shows no ticket", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, store: LINKED })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "view" })
    await clock.settle()
    expect(hasTicketLink(drawnNodes(await ui.drawn()))).toBe(false)
  })

  test(
    "with Ticket links on rows off, the row is as without links",
    { options: { showTickets: false } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, { github: KEYED, branch: "main", uncommitted: 0, store: LINKED })
      await startSession($)
      await clock.settle()

      const ui = await mountPane($, "terminal")
      expect(wordsIn(lineOf(drawnNodes(await ui.drawn()), 1, "facts"))).toBe("CI ✓ · 1 unresolved comment")
    }
  )

  test("with ticket links off for the repository, the row is as without links", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, store: { "tickets:github.com/acme/app": "off" } })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    expect(wordsIn(lineOf(drawnNodes(await ui.drawn()), 1, "facts"))).toBe("CI ✓ · 1 unresolved comment")
  })

  test("the list /prs prints has the ticket first in the row's details, as a link", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, surfaces: [], store: LINKED })
    await startSession($)
    await clock.settle()

    const row = (await runPrs($, "")).text?.split("\n").find((line) => line.startsWith("| [#1]"))
    expect(row).toContain(`| ❗ Changes Requested | [WEB-5761\u00a0⧉](${TICKET}) · [CI ✓](`)
  })
})
