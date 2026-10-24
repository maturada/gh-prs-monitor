// Author: David Matura

// A press's host in memory (`PressHost`), for the tests of what a press and a skill's run do: git and gh answer as
// `fakeHost`'s table says, the session's state is the test's, and what reaches the engine is kept to look at.

import type { Timer } from "claude-code"

import type { MergedPull, PullsSnapshot } from "../../types"
import type { RepoRef } from "../gh"
import type { PressHost } from "../press"
import { REPO } from "./fixtures"
import { fakeHost } from "./git-host"

// The clock's time, and the repository, every press here sees.
export const NOW = 100_000
export { REPO } from "./fixtures"

// A press's host over a list, the rows shown merged, the problem shown and the demo, as the session's state holds them;
// it keeps the status lines set, the timers started (to fire by hand), the loads and the cleanups asked for.
export function fakePressHost(state: {
  list: PullsSnapshot | null
  merged?: MergedPull[]
  problem?: string | null
  isDemo?: boolean
  // The list's repository, acme/app unless given; and the list's load under way, none unless given.
  repo?: RepoRef
  settled?: () => Promise<void>
}) {
  let list = state.list
  let merged = state.merged ?? []
  const seen = {
    status: [] as (string | undefined)[],
    timers: [] as { ms: number; fire: () => void }[],
    refreshes: [] as boolean[],
    refreshAfterWrites: 0,
    cleanups: 0,
    work: [] as Promise<unknown>[]
  }
  const host: PressHost = {
    ...fakeHost([]).host,
    now: async () => NOW,
    sleep: async () => {},
    after: (ms, fire) => {
      seen.timers.push({ ms, fire })

      return { cancel: () => {} } as unknown as Timer
    },
    background: (work) => {
      seen.work.push(work)
    },
    log: () => {},
    notify: async () => {},
    notifyProblem: async () => {},
    repo: async () => ({ repo: state.repo ?? REPO }),
    settled: state.settled ?? (async () => {}),
    storedList: async () => list,
    keepList: async (change) => (list = change(list)),
    merged: async () => merged,
    keepMerged: async (change) => (merged = change(merged)),
    problem: async () => state.problem ?? null,
    isDemo: async () => state.isDemo ?? false,
    setStatus: async (text) => {
      seen.status.push(text)
    },
    claimBusy: async () => true,
    setBusy: async () => {},
    ask: async () => null,
    isQuestionOpen: async () => false,
    refresh: async (isAlerting) => {
      seen.refreshes.push(isAlerting)
    },
    refreshAfterWrite: async () => {
      seen.refreshAfterWrites += 1
    },
    cleanUp: async () => {
      seen.cleanups += 1
    }
  }

  return { host, seen, list: () => list, merged: () => merged }
}
