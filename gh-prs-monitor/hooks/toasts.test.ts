// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { AlertBatch } from "./alerts"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { announce, limitHold, release } from "./toasts"
import type { ToastHost } from "./toasts"
import { REPO } from "./testing/fixtures"

const OTHER = { host: "github.com", name: "acme/web" }

// A change on pull request `number` of `repo`, as the folder's load raises it, or the light check another
// repository's: its toast reads `✎ #<number> PR <number> — <event>`, naming that other repository.
function change(number: number, event: string, repo = REPO): AlertBatch {
  return {
    kind: "events",
    from: repo === REPO ? "list" : "check",
    repo,
    events: [{ kind: "comments", number, title: `PR ${number}`, by: null, symbol: "✎", event }]
  }
}

// A line that is no pull request change: a session's first summary, a cleanup's note.
function line(text: string, repo: AlertBatch["repo"] = REPO): AlertBatch {
  return { kind: "line", repo, line: text }
}

// A session in acme/app's folder, with `options` set.
function folderSession(options: Parameters<typeof readSettings>[0] = {}) {
  const session = createSession(readSettings(options))
  session.repo = REPO

  return session
}

// A host that keeps what reaches the person: each toast with how long it stays, each sound, and apart from them each
// system notification with its title; `others` are the events and lines another session showed lately.
function hostOf(others: readonly string[] = []): {
  host: ToastHost
  seen: { toasts: [string, number][]; sounds: number }
  notified: [string, string][]
} {
  const seen = { toasts: [] as [string, number][], sounds: 0 }
  const notified: [string, string][] = []
  const host: ToastHost = {
    now: async () => 0,
    notify: async (text, timeoutMs) => {
      seen.toasts.push([text, timeoutMs])
    },
    playSound: () => {
      seen.sounds += 1
    },
    notifySystem: (title, text) => {
      notified.push([title, text])
    },
    keepHeld: () => undefined,
    after: () => {},
    notShownByOtherSessions: async (batches) =>
      batches.flatMap((batch): AlertBatch[] => {
        if (batch.kind === "line") {
          return others.includes(batch.line) ? [] : [batch]
        }
        const events = batch.events.filter((event) => !others.includes(event.event))

        return events.length > 0 ? [{ ...batch, events }] : []
      })
  }

  return { host, seen, notified }
}

describe("the alerts that reach the person", () => {
  test("alerts raised while turns run wait for the last to end, then show together", async () => {
    const session = createSession(readSettings({ alertSound: true }))
    session.repo = REPO
    session.runningTurns.add("turn-1")
    session.runningTurns.add("turn-2")
    const { host, seen } = hostOf()

    await announce(host, session, [change(7, "merged")])
    session.runningTurns.delete("turn-1")
    await announce(host, session, [change(8, "ready")])
    expect(seen).toEqual({ toasts: [], sounds: 0 })
    session.runningTurns.delete("turn-2")
    await release(host, session)
    expect(seen).toEqual({
      toasts: [
        ["✎ #7 PR 7 — merged", 8_000],
        ["✎ #8 PR 8 — ready", 8_000]
      ],
      sounds: 1
    })
    await release(host, session)
    expect(seen.toasts).toHaveLength(2)
  })

  test("what another session showed lately is left out, each event on its own; with none left nothing shows", async () => {
    const session = folderSession({ alertSound: true })
    const { host, seen } = hostOf(["merged", "approved"])
    const both: AlertBatch = {
      kind: "events",
      from: "list",
      repo: REPO,
      events: [
        { kind: "reviews", number: 9, title: "PR 9", by: null, symbol: "✓", event: "approved" },
        { kind: "ci", number: 9, title: "PR 9", by: null, symbol: "✓", event: "CI passed" }
      ]
    }

    await announce(host, session, [change(7, "merged"), change(8, "ready"), both])
    expect(seen).toEqual({
      toasts: [
        ["✎ #8 PR 8 — ready", 8_000],
        ["✓ #9 PR 9 — CI passed", 8_000]
      ],
      sounds: 1
    })
    await announce(host, session, [change(7, "merged")])
    expect(seen.toasts).toHaveLength(2)
    expect(seen.sounds).toBe(1)
  })

  test("the sound plays once per showing, and only where it is on", async () => {
    const loud = hostOf()
    const quiet = hostOf()

    await announce(loud.host, folderSession({ alertSound: true }), [
      change(1, "a"),
      change(2, "b"),
      change(3, "c"),
      change(4, "d")
    ])
    expect(loud.seen).toEqual({
      toasts: [
        ["✎ #1 PR 1 — a", 8_000],
        ["✎ #2 PR 2 — b", 8_000],
        ["2 more pull request changes, see /prs", 8_000]
      ],
      sounds: 1
    })
    await announce(quiet.host, folderSession(), [change(1, "a")])
    expect(quiet.seen).toEqual({ toasts: [["✎ #1 PR 1 — a", 8_000]], sounds: 0 })
  })

  test("a line of no repository, as 1.4.0 held, shows when the turn ends, beside the batches held with it", async () => {
    const { host, seen, notified } = hostOf()
    const session = folderSession({ systemNotification: true })
    session.alerts = { held: [line("#7 merged", null), change(8, "b", OTHER)], heldSince: 0 }

    await release(host, session)

    expect(seen.toasts).toEqual([
      ["#7 merged", 8_000],
      ["✎ acme/web#8 PR 8 — b · /prs acme/web", 8_000]
    ])
    expect(notified).toEqual([["acme/web", "✎ #8 PR 8 — b"]])
  })

  test("the folder's changes read as its own, and the light check's as another's, its repository known or not", async () => {
    const { host, seen } = hostOf()
    // After a reload, before a load has found the folder's repository; or in a folder with none.
    const session = createSession(readSettings({}))
    session.alerts = { held: [change(1, "a"), change(2, "b", OTHER)], heldSince: 0 }

    await release(host, session)

    expect(seen.toasts).toEqual([
      ["✎ #1 PR 1 — a", 8_000],
      ["✎ acme/web#2 PR 2 — b · /prs acme/web", 8_000]
    ])
  })

  test("held batches of two repositories show when the turn ends, each named by its own", async () => {
    const { host, seen } = hostOf()
    const session = folderSession()
    session.runningTurns.add("turn-1")

    await announce(host, session, [change(1, "a")])
    await announce(host, session, [change(2, "b", OTHER)])
    session.runningTurns.delete("turn-1")
    await release(host, session)

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #1 PR 1 — a", "✎ acme/web#2 PR 2 — b · /prs acme/web"])
  })
})

describe("more than three at once", () => {
  test("another repository's changes past the first two are named, as /prs lists only this folder's", async () => {
    const { host, seen } = hostOf()

    await announce(host, folderSession(), [
      change(1, "a"),
      change(2, "b"),
      change(3, "c", OTHER),
      change(4, "d", OTHER)
    ])

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #1 PR 1 — a", "✎ #2 PR 2 — b", "2 more changes in acme/web"])
  })

  test("the light check's first summary shows first, never counted among this folder's changes", async () => {
    const { host, seen } = hostOf()
    const summary: AlertBatch = {
      kind: "line",
      repo: REPO,
      line: "2 waiting in other repositories: acme/web",
      from: "check"
    }

    await announce(host, folderSession(), [change(1, "a"), change(2, "b"), change(3, "c"), summary])

    expect(seen.toasts.map(([text]) => text)).toEqual([
      "2 waiting in other repositories: acme/web",
      "✎ #1 PR 1 — a",
      "2 more pull request changes, see /prs"
    ])
  })
})

describe("what another session showed", () => {
  test("is weighed from when each alert was raised, also where the hold's five minutes let them through", async () => {
    const asked: (number | undefined)[][] = []
    let now = 0
    const host: ToastHost = {
      ...hostOf().host,
      now: async () => now,
      notShownByOtherSessions: async (batches) => {
        asked.push(batches.map((batch) => batch.raisedAt))

        return [...batches]
      }
    }
    const session = folderSession()
    session.runningTurns.add("turn-1")

    await announce(host, session, [change(1, "a")])
    now = 2 * 60_000
    await announce(host, session, [change(2, "b")])
    now = 6 * 60_000
    await announce(host, session, [change(3, "c")])

    expect(asked).toEqual([[0, 2 * 60_000, 6 * 60_000]])
  })
})

describe("the system notification", () => {
  test("goes with each showing where it is on: one for however many alerts, titled with the repository", async () => {
    const { host, seen, notified } = hostOf()

    await announce(host, createSession(readSettings({ systemNotification: true })), [
      change(1, "a"),
      change(2, "b"),
      change(3, "c"),
      change(4, "d")
    ])

    expect(seen.toasts).toHaveLength(3)
    expect(notified).toEqual([["acme/app", "✎ #1 PR 1 — a (3 more)"]])
  })

  test("names one alert alone", async () => {
    const { host, notified } = hostOf()

    await announce(host, createSession(readSettings({ systemNotification: true })), [change(1, "a")])

    expect(notified).toEqual([["acme/app", "✎ #1 PR 1 — a"]])
  })

  test("is off by default", async () => {
    const { host, seen, notified } = hostOf()

    await announce(host, createSession(readSettings({})), [change(1, "a")])

    expect(seen.toasts).toHaveLength(1)
    expect(notified).toEqual([])
  })

  test("leaves out what another session showed lately, and with nothing left sends none", async () => {
    const { host, notified } = hostOf(["merged"])
    const session = createSession(readSettings({ systemNotification: true }))

    await announce(host, session, [change(7, "merged")])
    expect(notified).toEqual([])
    await announce(host, session, [change(7, "merged"), change(8, "ready")])
    expect(notified).toEqual([["acme/app", "✎ #8 PR 8 — ready"]])
  })

  test("waits with the alerts held while turns run, and goes once when they show", async () => {
    const { host, notified } = hostOf()
    const session = createSession(readSettings({ systemNotification: true }))
    session.repo = REPO
    session.runningTurns.add("turn-1")

    await announce(host, session, [change(7, "merged")])
    await announce(host, session, [change(8, "ready")])
    expect(notified).toEqual([])
    session.runningTurns.delete("turn-1")
    await release(host, session)

    expect(notified).toEqual([["acme/app", "✎ #7 PR 7 — merged (1 more)"]])
  })

  test("a session's first summary or a cleanup's note shows, with the sound, but sends none", async () => {
    const { host, seen, notified } = hostOf()
    const session = createSession(readSettings({ systemNotification: true, alertSound: true }))

    await announce(host, session, [line("Since yesterday 17:40, 1 pull request changed — see /prs")])
    await announce(host, session, [line("#9 merged: removed its worktree")])

    expect(seen).toEqual({
      toasts: [
        ["Since yesterday 17:40, 1 pull request changed — see /prs", 8_000],
        ["#9 merged: removed its worktree", 8_000]
      ],
      sounds: 2
    })
    expect(notified).toEqual([])
  })

  test("held with pull request changes, a summary shows with them but stays out of their notification", async () => {
    const { host, seen, notified } = hostOf()
    const session = createSession(readSettings({ systemNotification: true }))
    session.repo = REPO
    session.runningTurns.add("turn-1")

    await announce(host, session, [line("Since yesterday 17:40, 1 pull request changed — see /prs")])
    await announce(host, session, [change(8, "ready")])
    session.runningTurns.delete("turn-1")
    await release(host, session)

    expect(seen.toasts.map(([text]) => text)).toEqual([
      "Since yesterday 17:40, 1 pull request changed — see /prs",
      "✎ #8 PR 8 — ready"
    ])
    expect(notified).toEqual([["acme/app", "✎ #8 PR 8 — ready"]])
  })

  test("a change in another repository than the folder's names it, and how to see its list", async () => {
    const { host, seen } = hostOf()

    await announce(host, folderSession(), [change(1, "a"), change(2, "b", OTHER)])

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #1 PR 1 — a", "✎ acme/web#2 PR 2 — b · /prs acme/web"])
  })

  test("changes in two repositories go as one notification each, titled with its repository", async () => {
    const { host, notified } = hostOf()

    await announce(host, folderSession({ systemNotification: true }), [
      change(1, "a"),
      change(2, "b", OTHER),
      change(3, "c")
    ])

    expect(notified).toEqual([
      ["acme/app", "✎ #1 PR 1 — a (1 more)"],
      ["acme/web", "✎ #2 PR 2 — b"]
    ])
  })
})

describe("a hold no alert comes to end", () => {
  const FIVE_MINUTES = 5 * 60_000

  // A host whose clock the test sets, keeping the timers set on it for the test to fire.
  function timedHost() {
    const made = hostOf()
    const clock = { now: 0 }
    const timers: { at: number; fire: () => Promise<void> }[] = []
    const host: ToastHost = {
      ...made.host,
      now: async () => clock.now,
      after: (ms, fire) => {
        timers.push({ at: clock.now + ms, fire })
      }
    }

    return { ...made, host, clock, timers }
  }

  test("shows what it held once its five minutes are up, though the turn goes on and no other alert comes", async () => {
    const { host, seen, clock, timers } = timedHost()
    const session = folderSession()
    session.runningTurns.add("turn-1")

    await announce(host, session, [change(7, "merged")])
    clock.now = 60_000
    await announce(host, session, [change(8, "ready")])
    expect(timers.map((timer) => timer.at)).toEqual([FIVE_MINUTES])
    clock.now = FIVE_MINUTES
    await timers[0]!.fire()

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #7 PR 7 — merged", "✎ #8 PR 8 — ready"])
    expect(session.alerts.held).toEqual([])
  })

  test("one its turn ended first leaves its timer nothing to show, nor a later hold before its own", async () => {
    const { host, seen, clock, timers } = timedHost()
    const session = folderSession()
    session.runningTurns.add("turn-1")
    await announce(host, session, [change(7, "merged")])
    session.runningTurns.delete("turn-1")
    await release(host, session)
    clock.now = 2 * 60_000
    session.runningTurns.add("turn-2")
    await announce(host, session, [change(8, "ready")])

    clock.now = FIVE_MINUTES
    await timers[0]!.fire()

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #7 PR 7 — merged"])
    expect(timers.map((timer) => timer.at)).toEqual([FIVE_MINUTES, 2 * 60_000 + FIVE_MINUTES])
  })

  test("a timer that fires a moment early, as the engine's timers and clock can drift apart, waits the rest", async () => {
    const { host, seen, clock, timers } = timedHost()
    const session = folderSession()
    session.runningTurns.add("turn-1")
    await announce(host, session, [change(7, "merged")])

    clock.now = FIVE_MINUTES - 18
    await timers[0]!.fire()
    expect(seen.toasts).toEqual([])
    expect(timers.map((timer) => timer.at)).toEqual([FIVE_MINUTES, FIVE_MINUTES])
    clock.now = FIVE_MINUTES
    await timers[1]!.fire()

    expect(seen.toasts.map(([text]) => text)).toEqual(["✎ #7 PR 7 — merged"])
  })

  test("one a module before a reload began is limited from when it began", async () => {
    const { host, clock, timers } = timedHost()
    const session = folderSession()
    session.alerts = { held: [change(7, "merged")], heldSince: 0 }
    clock.now = 3 * 60_000

    await limitHold(host, session)

    expect(timers.map((timer) => timer.at)).toEqual([FIVE_MINUTES])
  })
})
