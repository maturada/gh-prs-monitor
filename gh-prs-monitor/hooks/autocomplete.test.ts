// Author: David Matura

import type { On, PromptAutocompleteSuggestion } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import { pullSuggestions } from "./autocomplete"
// TBD: runPrs comes back with the visit's tests below, once `#` in the prompt is on again.
import { clockOf, GITHUB, keptList, keptOverReload, machine, startSession, typeahead } from "./testing/world"

const LIST = keptList({
  mine: [
    { number: 142, title: "Cache the search results" },
    { number: 14, title: "Fix the share-sheet on iOS" },
    { number: 1420, title: "Rename the settings fields" }
  ],
  requested: [
    { number: 7, title: "Usage chart", author: "ann" },
    { number: 143, title: "Searchable invite links", author: "bo" }
  ]
})!

// What answers beneath the plugin: core adds no rows; `others` stands for another plugin's.
function beneath(on: On, others: PromptAutocompleteSuggestion[] = []): void {
  on("prompt.autocomplete", () => ({ suggestions: others }))
}

function texts(token: string): string[] {
  return pullSuggestions(LIST, token).map((row) => row.text)
}

describe("# in the prompt box", () => {
  test("digits match a number from its start, the viewer's own pull requests first", () => {
    expect(texts("#1")).toEqual(["#142", "#14", "#1420", "#143"])
    expect(texts("#142")).toEqual(["#1420"])
    expect(texts("#9")).toEqual([])
  })

  test("other characters match the start of a word in a title, once two are typed", () => {
    expect(texts("#se")).toEqual(["#142", "#1420", "#143"])
    expect(texts("#SHEET")).toEqual(["#14"])
    expect(texts("#ar")).toEqual([])
    expect(texts("#s")).toEqual([])
  })

  test("a bare # offers none", () => {
    expect(texts("#")).toEqual([])
  })

  test("a row writes the number, and shows the title and the status", () => {
    expect(pullSuggestions(LIST, "#7")).toEqual([])
    expect(pullSuggestions(LIST, "#us")).toEqual([
      { text: "#7", label: "#7 Usage chart", description: LIST.review[0]!.status.text }
    ])
    expect(LIST.review[0]!.status.text).toBe("Review Requested")
  })

  test("eight rows at most", () => {
    const many = keptList({ mine: Array.from({ length: 12 }, (_, at) => ({ number: 100 + at, title: `Step ${at}` })) })!

    expect(pullSuggestions(many, "#1")).toHaveLength(8)
  })

  // TBD: `#` in the prompt is off for now (register.tsx's `prompt.autocomplete`); these come back with it.
  test(
    "for now the prompt box gets none of its pull requests, though a list is held",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      clockOf(on)
      machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      keptOverReload(on, { snapshot: keptList(GITHUB)! })
      beneath(on, [{ text: "#adr", label: "#adr another plugin's" }])
      await startSession($)

      expect(await typeahead($, "see #ad")).toEqual(["#adr another plugin's"])
    }
  )

  // test("the prompt box gets none before a list is held", { options: { refresh: "on-demand" } }, async ($, on) => {
  //   clockOf(on)
  //   machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
  //   beneath(on)
  //   await startSession($)
  //
  //   expect(await typeahead($, "see #ad")).toEqual([])
  // })
  //
  // test(
  //   "once a list is held, # offers its pull requests beneath other plugins' rows",
  //   { options: { refresh: "on-demand" } },
  //   async ($, on) => {
  //     clockOf(on)
  //     machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
  //     keptOverReload(on, { snapshot: keptList(GITHUB)! })
  //     beneath(on, [{ text: "#adr", label: "#adr another plugin's" }])
  //     await startSession($)
  //
  //     expect(await typeahead($, "see #ad")).toEqual(["#adr another plugin's", "#2 Add a legend"])
  //   }
  // )
})

// acme/web's list as a visit holds it, and the address of its #12.
const WEB_12 = "https://github.com/acme/web/pull/12"
const READ = keptList({ mine: [{ number: 12, title: "Checkout page" }] })!
const VISIT = {
  ...READ,
  repo: "acme/web",
  url: "https://github.com/acme/web",
  mine: READ.mine.map((row) => ({ ...row, url: WEB_12 }))
}

describe("# suggestions while a visit shows", () => {
  test("the visit's pull requests come after the folder's, written by their address, which every skill takes", () => {
    const offered = pullSuggestions(LIST, "#1", VISIT)

    expect(offered.map((row) => row.text)).toContain(WEB_12)
    expect(offered.findIndex((row) => row.text === WEB_12)).toBeGreaterThan(
      offered.findIndex((row) => row.text === "#142")
    )
    expect(offered.find((row) => row.text === WEB_12)?.label).toBe("acme/web#12 Checkout page")
  })

  test("a number only the visit has offers its pull request alone", () => {
    expect(pullSuggestions(LIST, "#12", VISIT).map((row) => row.text)).toEqual([WEB_12])
  })

  test("with no list of the folder's held, the visit's are offered", () => {
    expect(pullSuggestions(null, "#12", VISIT).map((row) => row.text)).toEqual([WEB_12])
  })

  // TBD: `#` in the prompt is off for now (register.tsx's `prompt.autocomplete`); these come back with it.
  // test(
  //   "the prompt box offers a visit's pull requests before the folder's list is loaded",
  //   { options: { refresh: "on-demand" } },
  //   async ($, on) => {
  //     const clock = clockOf(on)
  //     machine($, on, {
  //       github: GITHUB,
  //       others: { "github.com/acme/web": { mine: [{ number: 12, title: "Checkout page" }] } },
  //       branch: "main",
  //       uncommitted: 0
  //     })
  //     beneath(on)
  //     await startSession($)
  //     await runPrs($, "acme/web")
  //     await clock.settle()
  //
  //     expect(await typeahead($, "see #12")).toEqual(["acme/web#12 Checkout page"])
  //   }
  // )
  //
  // test(
  //   "once the pane is closed, even by Claude Code with no word to the plugin, a visit's are offered no more",
  //   { options: { refresh: "on-demand" } },
  //   async ($, on) => {
  //     const clock = clockOf(on)
  //     const world = {
  //       github: GITHUB,
  //       others: { "github.com/acme/web": { mine: [{ number: 12, title: "Checkout page" }] } },
  //       branch: "main",
  //       uncommitted: 0
  //     }
  //     machine($, on, world)
  //     beneath(on)
  //     await startSession($)
  //     await runPrs($, "acme/web")
  //     await clock.settle()
  //
  //     Object.assign(world, { isPaneOpen: false })
  //
  //     expect(await typeahead($, "see #12")).toEqual([])
  //   }
  // )
})
