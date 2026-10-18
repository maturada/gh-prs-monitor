// Author: David Matura

// The keys of what the pane and the dialog draw that the flows name too: a row, a row's button, an answer, and the
// mark a closed question puts the window back on.

import type { PullAction } from "../types"

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

// What the window goes to as a question's close puts it back on the row it showed (`backToRow`): a plugin's scroll
// names something drawn, never a row, so the list draws a mark on that row.
export const BACK_MARK = "back-to-row"
