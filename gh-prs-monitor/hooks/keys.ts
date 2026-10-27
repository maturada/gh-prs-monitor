// Author: David Matura

// The keys of what the pane and the dialog draw that the flows name too: a row, a row's button, an answer, a name to
// pick, a repository to open, where a question's keyboard starts, and the mark a closed question puts the window back
// on.

import type { PullAction, Question } from "../types"

// A row's key, which is also its hover scope: the pointer anywhere on the row lights its title, so it is plain which
// row a button belongs to.
export function rowKey(number: number): string {
  return `pr-${number}`
}

// A row's button's key, which the dialog brings the person back to (`backToRow`).
export function buttonKey(action: PullAction, number: number): string {
  return `${action}-${number}`
}

// A question's answer, in the order it offers them; the first takes the keyboard.
export function answerKey(index: number): string {
  return `answer-${index}`
}

// A picker's names, in the order it draws them, and its Select All (Clear once every one is picked).
export function pickKey(index: number): string {
  return `pick-${index}`
}

export const PICK_ALL_KEY = "pick-all"

// The header's Repositories button, where the keyboard goes once Back has left a visit.
export const PICK_KEY = "repo"

// The repository picker's Open on each row, keyed apart from the names that pick: a button keeps the closure of the
// first one drawn alike (`stableButtons`), and Open opens where a name would only be picked.
export function openKey(index: number): string {
  return `open-${index}`
}

// Where the keyboard starts in a question: its field where it asks for a piece of text, as the repository picker
// does above its rows, typing there narrowing them; its first name where it asks to pick some first; else its first
// answer. A surface drawing no field (the phone) has no keyboard to start.
export function firstFocusKey(question: Question, fieldKey: string): string {
  return question.field ? fieldKey : question.picking?.startsOn === "names" ? pickKey(0) : answerKey(0)
}

// What the window goes to as a question's close puts it back on the row it showed (`backToRow`): a plugin's scroll
// names something drawn, never a row, so the list draws a mark on that row.
export const BACK_MARK = "back-to-row"
