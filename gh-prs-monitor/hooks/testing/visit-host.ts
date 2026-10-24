// Author: David Matura

// A visit's host in memory (`VisitHost`), for the tests of a visit: gh answers as GitHub stands for the test
// (`gh-repos.ts`), the visit and the pane are the test's, and the commands run, the timers started and the work begun
// are kept to look at.

import type { ProcessRunResult, Timer, UiPane } from "claude-code"

import type { PullsSnapshot, Visit } from "../../types"
import type { TicketLinks } from "../tickets"
import type { VisitHost } from "../visit"
import { ghReposAnswer, ran } from "./gh-repos"
import type { GhRepos } from "./gh-repos"

export const NOW = 100_000

export type VisitWorld = GhRepos & {
  // The session's folder's repository, as `host/owner/name`, which `gh repo view` finds from its remote; none unless
  // given, as for a folder that is no repository.
  folder?: string
  // While set, a list request waits for it once answered, so a test can act while one is under way.
  gate?: Promise<void>
  // By repository (`owner/name`): its lookup (`gh repo view`) waits for it once answered.
  heldLookups?: Record<string, Promise<void>>
  // The ticket links the store keeps for every repository; none unless given, or a store that can't be read.
  tickets?: TicketLinks | "unreadable"
  // The files on this machine, by path, as a typed folder's git config is read; none unless given.
  files?: Record<string, string>
}

export function fakeVisitHost(world: VisitWorld) {
  const state = {
    visit: null as Visit | null,
    pane: { isPlaced: true, isShown: true } as Pick<UiPane, "isPlaced" | "isShown"> | undefined,
    isReplaced: false,
    // The folder's list as last read, none unless a test gives one.
    folderList: null as PullsSnapshot | null
  }
  const seen = {
    calls: [] as string[],
    timers: [] as { ms: number; tick: () => void; isCancelled: boolean }[],
    work: [] as Promise<unknown>[],
    writes: 0,
    folderReads: 0,
    paneOpens: 0
  }

  const host: VisitHost = {
    run: async (argv) => {
      const line = argv.join(" ")
      seen.calls.push(line)
      const answer = ghReposAnswer(world, world.folder ?? null, line) ?? folderView(world, line)
      if (line.startsWith("gh api graphql")) {
        await world.gate
      }
      const held = Object.entries(world.heldLookups ?? {}).find(
        ([name]) => line.startsWith("gh repo view") && line.toLowerCase().includes(`/${name.toLowerCase()} `)
      )
      await held?.[1]

      return answer
    },
    read: async (path) => {
      const file = world.files?.[path]
      if (file === undefined) {
        throw new Error(`no file ${path}`)
      }

      return file
    },
    write: async () => {},
    exists: async () => false,
    isLink: async () => false,
    now: async () => NOW,
    every: (ms, tick) => {
      const timer = { ms, tick, isCancelled: false }
      seen.timers.push(timer)

      return {
        cancel: () => {
          timer.isCancelled = true
        }
      } as unknown as Timer
    },
    background: (work) => {
      seen.work.push(work)
    },
    log: () => {},
    visit: async () => state.visit,
    changeVisit: async (change) => {
      seen.writes++
      state.visit = change(state.visit)

      return state.visit
    },
    pane: async () => state.pane,
    isReplaced: async () => state.isReplaced,
    ticketLinks: async () => (world.tickets === "unreadable" ? null : { links: world.tickets ?? null }),
    suggestReviewers: async () => {},
    folderList: async () => state.folderList,
    refreshFolder: async () => {
      seen.folderReads++
    },
    openPane: async () => {
      seen.paneOpens++

      return { isPlaced: state.pane?.isPlaced ?? false }
    }
  }

  return { host, state, seen }
}

// `gh repo view` from the folder: its repository, or what gh says of a folder that is no repository.
function folderView(world: VisitWorld, line: string): ProcessRunResult {
  if (!line.startsWith("gh repo view --json")) {
    return ran("", `no answer for ${line}\n`)
  }

  return world.folder
    ? ran(`${world.folder.slice(world.folder.indexOf("/") + 1)} https://${world.folder}\n`)
    : ran("", "failed to run git: fatal: not a git repository\n")
}

// Lets the work a host began finish, and what that began in turn.
export async function settled(seen: { work: Promise<unknown>[] }): Promise<void> {
  while (seen.work.length > 0) {
    await Promise.all(seen.work.splice(0))
  }
}
