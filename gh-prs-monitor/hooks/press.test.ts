// Author: David Matura

import type { PluginOptions } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import type { MergedPull, PullRow, PullsSnapshot } from "../types"
import { GhFailure } from "./github"
import {
  claimedBusy,
  dropMerged,
  lookBeforeAsking,
  markKey,
  marksOfVisit,
  namedOn,
  pressing,
  resumeMerged,
  withBusy,
  withoutBusyIf
} from "./press"
import { createSession, FOLDER_LIST } from "./session"
import type { Session } from "./session"
import { readSettings } from "./settings"
import { statusSummary } from "./summary"
import { snapshotOf } from "./testing/fixtures"
import { fakePressHost, NOW, REPO } from "./testing/press-host"
import { promisesRun } from "./testing/promises"

function sessionOf(options: PluginOptions = {}): Session {
  const session = createSession(readSettings(options))
  session.repo = REPO

  return session
}

const LIST = snapshotOf({ mine: [{ number: 1 }, { number: 7, title: "Fix the menu" }, { number: 9 }] })
const row = (number: number): PullRow => LIST.mine.find((each) => each.number === number) as PullRow

describe("a pull request merged from the pane", () => {
  test("is shown merged where its row was, out of the list and the summary, until the search catches up", async () => {
    const { host, seen, list, merged } = fakePressHost({ list: LIST })

    await dropMerged(host, sessionOf(), row(7))
    expect(merged()).toEqual([
      { number: 7, title: "Fix the menu", url: row(7).url, base: row(7).baseRefName, index: 1, at: NOW }
    ])
    expect(list()?.mine.map((each) => each.number)).toEqual([1, 9])
    expect(seen.status).toEqual([statusSummary(list() as PullsSnapshot)])
    expect(seen.timers.map((timer) => timer.ms)).toEqual([15_000])
  })

  test("one no longer drawn goes first", async () => {
    const { host, merged } = fakePressHost({ list: snapshotOf({ mine: [{ number: 1 }] }) })

    await dropMerged(host, sessionOf(), row(7))
    expect(merged()[0]?.index).toBe(0)
  })

  test("the status line is left as it is where a problem or the demo holds it, or where it shows nothing", async () => {
    for (const [state, options] of [
      [{ problem: "GitHub took too long to answer, or had an error of its own." }, {}],
      [{ isDemo: true }, {}],
      [{}, { statusLine: false }]
    ] as const) {
      const { host, seen } = fakePressHost({ list: LIST, ...state })

      await dropMerged(host, sessionOf(options), row(7))
      expect(seen.status).toEqual([])
    }
  })

  test("a load under way finishes before the row is taken out of its list", async () => {
    let finish = (): void => {}
    const loading = new Promise<void>((resolve) => (finish = resolve))
    const { host, list } = fakePressHost({ list: LIST, settled: () => loading })
    const session = sessionOf()

    const dropped = dropMerged(host, session, row(7))
    await promisesRun(20)
    expect(list()?.mine.map((each) => each.number)).toEqual([1, 7, 9])
    finish()
    await dropped
    expect(list()?.mine.map((each) => each.number)).toEqual([1, 9])
  })

  test("once the search caught up: refreshed with no alerts, let go, cleaned up where cleanup is on", async () => {
    for (const [options, cleanups] of [
      [{}, 1],
      [{ cleanupWorktrees: false }, 0]
    ] as const) {
      const { host, seen, merged } = fakePressHost({ list: LIST })

      await dropMerged(host, sessionOf(options), row(7))
      seen.timers[0]?.fire()
      await Promise.all(seen.work)
      expect(seen.refreshes).toEqual([false])
      expect(merged()).toEqual([])
      expect(seen.cleanups).toBe(cleanups)
    }
  })

  test("after a reload, one waits out the rest of its time; one past it is let go", async () => {
    const shown = (number: number, at: number): MergedPull => ({
      number,
      title: "",
      url: "",
      base: "main",
      index: 0,
      at
    })
    const { host, seen, merged } = fakePressHost({
      list: LIST,
      merged: [shown(7, NOW - 5_000), shown(9, NOW - 15_000)]
    })

    await resumeMerged(host, sessionOf())
    expect(merged().map((each) => each.number)).toEqual([7])
    expect(seen.timers.map((timer) => timer.ms)).toEqual([10_000])
  })
})

describe("a row's busy mark", () => {
  test("is claimed only where nothing holds it, so two quick presses cannot both start", () => {
    expect(claimedBusy({}, 7, "Checking…")).toEqual({ "7": "Checking…" })
    expect(claimedBusy({ "7": "Merging…" }, 7, "Checking…")).toBe(null)
    expect(claimedBusy({ "7": "Merging…" }, "create-pr", "Checking The Branch…")).toEqual({
      "7": "Merging…",
      "create-pr": "Checking The Branch…"
    })
  })

  test("is set and cleared, and cleared after a skill's turn only where it still shows that skill", () => {
    expect(withBusy({ "7": "Checking…" }, 7, "Merging…")).toEqual({ "7": "Merging…" })
    expect(withBusy({ "7": "Merging…", "8": "Checking…" }, 7, null)).toEqual({ "8": "Checking…" })
    expect(withoutBusyIf({ "7": "Fixing CI…" }, 7, "Fixing CI…")).toEqual({})
    expect(withoutBusyIf({ "7": "Checking…" }, 7, "Fixing CI…")).toEqual({ "7": "Checking…" })
  })
})

describe("a press's work", () => {
  test("a failure is said worded for the person, gh's own words kept in the debug log, and the row given back", async () => {
    const { host } = fakePressHost({ list: snapshotOf({ mine: [{ number: 7 }] }) })
    const toasts: string[] = []
    const logs: string[] = []
    const busy: (string | null)[] = []
    const pressHost = {
      ...host,
      notify: async (text: string) => void toasts.push(text),
      log: (line: string) => void logs.push(line),
      setBusy: async (_: unknown, text: string | null) => void busy.push(text)
    }
    const refused = { message: "GitHub refused the request (rate limit or permissions).", isPermanent: false }

    await pressing(pressHost, sessionOf(), 7, "Checking…", async () => {
      throw new GhFailure(refused, "HTTP 403: Resource not accessible by integration")
    })
    await pressing(pressHost, sessionOf(), 7, "Checking…", async () => {
      throw new Error("spawn git ENOENT")
    })

    expect(toasts).toEqual(["#7: GitHub refused the request (rate limit or permissions).", "#7: spawn git ENOENT"])
    expect(logs).toEqual(["#7: HTTP 403: Resource not accessible by integration"])
    expect(busy).toEqual([null, null])
  })

  test("a skill it started keeps the mark; work that ends gives it back", async () => {
    const { host } = fakePressHost({ list: snapshotOf({ mine: [{ number: 7 }] }) })
    const busy: (string | null)[] = []
    const pressHost = { ...host, setBusy: async (_: unknown, text: string | null) => void busy.push(text) }

    await pressing(pressHost, sessionOf(), 7, "Checking…", async () => "started")
    expect(busy).toEqual([])
    await pressing(pressHost, sessionOf(), 7, "Checking…", async () => undefined)
    expect(busy).toEqual([null])
  })
})

describe("the list a press acts on", () => {
  const WEB = { host: "github.com", name: "acme/web" }

  test("is the repository its host says, the visit's or the folder's", async () => {
    const { host } = fakePressHost({ list: { ...LIST, repo: "acme/web" }, repo: WEB })

    const look = await lookBeforeAsking(host, sessionOf(), "merge", row(7))

    expect(look).toMatchObject({ isGoing: true, repo: WEB })
  })

  test("a list kept of another repository than its host's asks nothing, and is read again", async () => {
    const { host, seen } = fakePressHost({ list: LIST, repo: WEB })

    expect(await lookBeforeAsking(host, sessionOf(), "merge", row(7))).toEqual({ isGoing: false })
    expect(seen.refreshAfterWrites).toBe(1)
  })
})

describe("a list's marks and words", () => {
  const WEB = { kind: "visit" as const, repo: { host: "GitHub.com", name: "Acme/Web" } }

  test("the folder's rows are marked by their number, as ever; a visit's under its repository too", () => {
    expect(markKey(FOLDER_LIST, 12)).toBe("12")
    expect(markKey(WEB, 12)).toBe("github.com/acme/web#12")
  })

  test("a visit's pane draws its own marks alone, by number", () => {
    const all = { "12": "Merging…", "github.com/acme/web#12": "Checking…", "github.com/acme/web-app#3": "Reviewing…" }

    expect(marksOfVisit(all, WEB.repo)).toEqual({ "12": "Checking…" })
  })

  test("on a visit, what names #12 names its repository; on the folder's list, and anything else, as it is", () => {
    expect(namedOn(WEB, "#12: merged")).toBe("Acme/Web#12: merged")
    expect(namedOn(WEB, "Answer the open question first.")).toBe("Answer the open question first.")
    expect(namedOn(FOLDER_LIST, "#12: merged")).toBe("#12: merged")
  })
})
