// Author: David Matura

// A question answered by picking among names before pressing an answer: Request Review's people, any number of them;
// Re-Review's kind of review, one of two. Its rules are here, for the pane's picker (`picker.tsx`) and for Claude
// Code's own dialog (`dialog-flow.ts`) alike.

import type { Picking, Question } from "../types"

// A question that offers names to pick.
export type PickingQuestion = Question & { picking: Picking }

export function isPickingQuestion(question: Question): question is PickingQuestion {
  return question.picking !== undefined
}

// A name pressed: picked or taken off where any number may be; where one of them is always picked, the pick moves to
// it. The picks stay in the names' order.
export function togglePick(picks: readonly number[], index: number, isSingle: boolean): number[] {
  if (isSingle) {
    return [index]
  }

  return picks.includes(index) ? picks.filter((each) => each !== index) : [...picks, index].sort((a, b) => a - b)
}

// Whether every name is picked, when Select All reads Clear.
export function isAllPicked(picks: readonly number[], count: number): boolean {
  return picks.length === count
}

// Select All picks every name; with every one picked already, it clears them.
export function pickAllOrClear(picks: readonly number[], count: number): number[] {
  return isAllPicked(picks, count) ? [] : Array.from({ length: count }, (_, index) => index)
}

// Whether the main answer can be pressed: once a name is picked, where the question waits for one.
export function isPickReady(picking: Picking, picks: readonly number[]): boolean {
  return !picking.needsPick || picks.length > 0
}

// The names picked, in the order drawn.
export function pickedNames(picking: Picking, picks: readonly number[]): string[] {
  return picking.names.filter((_, index) => picks.includes(index))
}
