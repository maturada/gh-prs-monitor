// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { createSession } from "./session"
import { readSettings } from "./settings"
import { announce, release } from "./toasts"
import type { ToastHost } from "./toasts"
import { REPO } from "./testing/fixtures"

// A host that keeps what reaches the person: each toast with how long it stays, each sound, and apart from them each
// system notification with its title; `others` are the lines another session in the repository showed lately.
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
    notShownElsewhere: async (_repo, lines) => lines.filter((line) => !others.includes(line))
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

    await announce(host, session, REPO, ["#7 merged"], true)
    session.runningTurns.delete("turn-1")
    await announce(host, session, REPO, ["#8 ready"], true)
    expect(seen).toEqual({ toasts: [], sounds: 0 })
    session.runningTurns.delete("turn-2")
    await release(host, session)
    expect(seen).toEqual({
      toasts: [
        ["#7 merged", 8_000],
        ["#8 ready", 8_000]
      ],
      sounds: 1
    })
    await release(host, session)
    expect(seen.toasts).toHaveLength(2)
  })

  test("lines another session showed lately are left out; with none left nothing shows, no sound plays", async () => {
    const session = createSession(readSettings({ alertSound: true }))
    const { host, seen } = hostOf(["#7 merged"])

    await announce(host, session, REPO, ["#7 merged", "#8 ready"], true)
    expect(seen).toEqual({ toasts: [["#8 ready", 8_000]], sounds: 1 })
    await announce(host, session, REPO, ["#7 merged"], true)
    expect(seen).toEqual({ toasts: [["#8 ready", 8_000]], sounds: 1 })
  })

  test("the sound plays once per showing, and only where it is on", async () => {
    const loud = hostOf()
    const quiet = hostOf()

    await announce(
      loud.host,
      createSession(readSettings({ alertSound: true })),
      REPO,
      ["#1 a", "#2 b", "#3 c", "#4 d"],
      true
    )
    expect(loud.seen).toEqual({
      toasts: [
        ["#1 a", 8_000],
        ["#2 b", 8_000],
        ["2 more pull request changes, see /prs", 8_000]
      ],
      sounds: 1
    })
    await announce(quiet.host, createSession(readSettings({})), REPO, ["#1 a"], true)
    expect(quiet.seen).toEqual({ toasts: [["#1 a", 8_000]], sounds: 0 })
  })
})

describe("the system notification", () => {
  test("goes with each showing where it is on: one for however many alerts, titled with the repository", async () => {
    const { host, seen, notified } = hostOf()

    await announce(
      host,
      createSession(readSettings({ systemNotification: true })),
      REPO,
      ["#1 a", "#2 b", "#3 c", "#4 d"],
      true
    )

    expect(seen.toasts).toHaveLength(3)
    expect(notified).toEqual([["acme/app", "#1 a (3 more)"]])
  })

  test("names one alert alone", async () => {
    const { host, notified } = hostOf()

    await announce(host, createSession(readSettings({ systemNotification: true })), REPO, ["#1 a"], true)

    expect(notified).toEqual([["acme/app", "#1 a"]])
  })

  test("is off by default", async () => {
    const { host, seen, notified } = hostOf()

    await announce(host, createSession(readSettings({})), REPO, ["#1 a"], true)

    expect(seen.toasts).toHaveLength(1)
    expect(notified).toEqual([])
  })

  test("leaves out what another session showed lately, and with nothing left sends none", async () => {
    const { host, notified } = hostOf(["#7 merged"])
    const session = createSession(readSettings({ systemNotification: true }))

    await announce(host, session, REPO, ["#7 merged"], true)
    expect(notified).toEqual([])
    await announce(host, session, REPO, ["#7 merged", "#8 ready"], true)
    expect(notified).toEqual([["acme/app", "#8 ready"]])
  })

  test("waits with the alerts held while turns run, and goes once when they show", async () => {
    const { host, notified } = hostOf()
    const session = createSession(readSettings({ systemNotification: true }))
    session.repo = REPO
    session.runningTurns.add("turn-1")

    await announce(host, session, REPO, ["#7 merged"], true)
    await announce(host, session, REPO, ["#8 ready"], true)
    expect(notified).toEqual([])
    session.runningTurns.delete("turn-1")
    await release(host, session)

    expect(notified).toEqual([["acme/app", "#7 merged (1 more)"]])
  })

  test("a session's first summary or a cleanup's note shows, with the sound, but sends none", async () => {
    const { host, seen, notified } = hostOf()
    const session = createSession(readSettings({ systemNotification: true, alertSound: true }))

    await announce(host, session, REPO, ["Since yesterday 17:40, 1 pull request changed — see /prs"], false)
    await announce(host, session, REPO, ["#9 merged: removed its worktree"], false)

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

    await announce(host, session, REPO, ["Since yesterday 17:40, 1 pull request changed — see /prs"], false)
    await announce(host, session, REPO, ["#8 ready"], true)
    session.runningTurns.delete("turn-1")
    await release(host, session)

    expect(seen.toasts.map(([text]) => text)).toEqual([
      "Since yesterday 17:40, 1 pull request changed — see /prs",
      "#8 ready"
    ])
    expect(notified).toEqual([["acme/app", "#8 ready"]])
  })
})
