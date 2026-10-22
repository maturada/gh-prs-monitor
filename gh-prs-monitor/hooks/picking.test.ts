// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { Picking } from "../types"
import { isAllPicked, isPickReady, pickAllOrClear, pickedNames, togglePick } from "./picking"

// Request Review's: any number of people, none at first, and the request only once one is picked.
const PEOPLE: Picking = {
  names: ["kim", "lou"],
  isSingle: false,
  initial: [],
  needsPick: true,
  startsOn: "names"
}

// Re-Review's: one kind of review of two, what changed at first.
const KIND: Picking = {
  names: ["Since Your Review", "Full Review"],
  isSingle: true,
  initial: [0],
  needsPick: false,
  startsOn: "answers"
}

describe("the picker's rules", () => {
  test("several: a press picks a name or takes it off, the picks kept in the names' order", () => {
    expect(togglePick([], 1, false)).toEqual([1])
    expect(togglePick([1], 0, false)).toEqual([0, 1])
    expect(togglePick([0, 1], 1, false)).toEqual([0])
  })

  test("one of them: a press moves the pick, and pressing the one picked keeps it", () => {
    expect(togglePick([0], 1, true)).toEqual([1])
    expect(togglePick([1], 1, true)).toEqual([1])
  })

  test("Select All picks every name; with every one picked, it clears them", () => {
    expect(isAllPicked([0, 1], 3)).toBe(false)
    expect(isAllPicked([0, 1, 2], 3)).toBe(true)
    expect(pickAllOrClear([], 3)).toEqual([0, 1, 2])
    expect(pickAllOrClear([2], 3)).toEqual([0, 1, 2])
    expect(pickAllOrClear([0, 1, 2], 3)).toEqual([])
  })

  test("the main answer waits for a pick only where the question says so", () => {
    expect(isPickReady(PEOPLE, [])).toBe(false)
    expect(isPickReady(PEOPLE, [1])).toBe(true)
    expect(isPickReady(KIND, [0])).toBe(true)
  })

  test("the names picked, in the order drawn", () => {
    expect(pickedNames(PEOPLE, [1, 0])).toEqual(["kim", "lou"])
    expect(pickedNames(PEOPLE, [])).toEqual([])
  })
})
