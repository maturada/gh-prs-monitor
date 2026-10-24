// Author: David Matura

import type { PromptAutocompleteSuggestion } from "claude-code"

import type { PullRow, PullsSnapshot } from "../types"
import { rowsOf } from "./pulls"

// The rows `#` offers in the prompt box, from the lists held: the viewer's own pull requests first, then those to
// review, as the pane lists them, and a visit's after them. Digits match a number from its start; two or more other
// characters, the start of a word in a title. A bare `#` offers none, as it starts a heading as often. A row whose text
// is typed already is left out: the box asks again once a row is taken, and would offer the same one.
export function pullSuggestions(
  snapshot: PullsSnapshot | null,
  token: string,
  visit: PullsSnapshot | null = null
): PromptAutocompleteSuggestion[] {
  const query = token.slice(1).toLowerCase()
  const matches = /^\d+$/.test(query)
    ? (pull: PullRow) => String(pull.number).startsWith(query)
    : query.length >= 2
      ? (pull: PullRow) => startsAWord(pull.title, query)
      : null
  if (!matches) {
    return []
  }
  // `#12` names the folder's; a visit's is written by its address, which the skills take as they take a number, and
  // labelled `owner/name#12`.
  const offered = [
    ...rowsOf(snapshot).map((pull) => ({ pull, text: `#${pull.number}`, name: `#${pull.number}` })),
    ...(visit ? rowsOf(visit).map((pull) => ({ pull, text: pull.url, name: `${visit.repo}#${pull.number}` })) : [])
  ]

  return offered
    .filter(({ pull, text }) => matches(pull) && text !== token)
    .slice(0, SUGGESTION_LIMIT)
    .map(({ pull, text, name }) => ({ text, label: `${name} ${pull.title}`, description: pull.status.text }))
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
