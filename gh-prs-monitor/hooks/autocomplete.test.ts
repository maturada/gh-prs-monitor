// Author: David Matura

import type { On, PromptAutocompleteInput, PromptAutocompleteResult, PromptAutocompleteSuggestion } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"

import { pullSuggestions } from "./autocomplete"
import { clockOf, GITHUB, keptList, keptOverReload, machine, startSession } from "./testing/world"

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

// The prompt box asking for rows for the token at the end of `text`; the kit's types have no call for it.
async function typeahead($: Engine, text: string): Promise<string[]> {
  const token = text.slice(text.lastIndexOf(" ") + 1)
  const prompt = $.prompt as unknown as {
    autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  }
  const { suggestions } = await prompt.autocomplete({
    text,
    cursor: text.length,
    token,
    start: text.length - token.length
  })

  return suggestions.map((row) => row.label ?? row.text)
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

  test("the prompt box gets none before a list is held", { options: { refresh: "on-demand" } }, async ($, on) => {
    clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    beneath(on)
    await startSession($)

    expect(await typeahead($, "see #ad")).toEqual([])
  })

  test(
    "once a list is held, # offers its pull requests beneath other plugins' rows",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      clockOf(on)
      machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      keptOverReload(on, { snapshot: keptList(GITHUB)! })
      beneath(on, [{ text: "#adr", label: "#adr another plugin's" }])
      await startSession($)

      expect(await typeahead($, "see #ad")).toEqual(["#adr another plugin's", "#2 Add a legend"])
    }
  )
})
