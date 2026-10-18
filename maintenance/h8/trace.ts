// Author: David Matura
//
// H8's trace: what the plugin did, in the order it did it, one line each, for compare.py to compare between two
// versions. build.sh copies it into each side's hooks/testing/; it is never part of the plugin.

import type { MockClock } from "claude-code/testing"

let testName = "?"
let clock: MockClock | null = null

export function traceTest(name: string, testClock: MockClock): void {
  testName = name
  clock = testClock
}

export function traceEvent(kind: string, data: unknown): void {
  let at = -1
  try {
    at = clock?.now() ?? -1
  } catch {
    at = -1
  }
  console.log(`TRACE\t${testName}\t${JSON.stringify([at, kind, data ?? null])}`)
}
