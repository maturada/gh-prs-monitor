// Author: David Matura

import type { PromptAutocompleteSuggestion } from "claude-code"

import type { PullRow, PullsSnapshot } from "../types"

// The rows `#` offers in the prompt box, from the list held: the viewer's own pull requests first, then those to
// review, as the pane lists them. Digits match a number from its start; two or more other characters, the start of a
// word in a title. A bare `#` offers none, as it starts a heading as often. A row whose text is typed already is left
// out: the box asks again once a row is taken, and would offer the same one.
export function pullSuggestions(snapshot: PullsSnapshot, token: string): PromptAutocompleteSuggestion[] {
  const query = token.slice(1).toLowerCase()
  const matches = /^\d+$/.test(query)
    ? (pull: PullRow) => String(pull.number).startsWith(query)
    : query.length >= 2
      ? (pull: PullRow) => startsAWord(pull.title, query)
      : null
  if (!matches) {
    return []
  }

  return [...snapshot.mine, ...snapshot.review]
    .filter((pull) => matches(pull) && `#${pull.number}` !== token)
    .slice(0, SUGGESTION_LIMIT)
    .map((pull) => ({ text: `#${pull.number}`, label: `#${pull.number} ${pull.title}`, description: pull.status.text }))
}

const SUGGESTION_LIMIT = 8

function startsAWord(title: string, query: string): boolean {
  const text = title.toLowerCase()
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    if (at === 0 || !WORD_CHARACTER.test(text.charAt(at - 1))) {
      return true
    }
  }

  return false
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u
