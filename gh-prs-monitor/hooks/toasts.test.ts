// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { createSession } from "./session"
import { readSettings } from "./settings"
import { announce, release } from "./toasts"
import type { ToastHost } from "./toasts"
import { REPO } from "./testing/fixtures"

// A host that keeps what reaches the person: each toast with how long it stays, and each sound; `others` are the lines
// another session in the repository showed lately.
function hostOf(others: readonly string[] = []): {
  host: ToastHost
  seen: { toasts: [string, number][]; sounds: number }
} {
  const seen = { toasts: [] as [string, number][], sounds: 0 }
  const host: ToastHost = {
    now: async () => 0,
    notify: async (text, timeoutMs) => {
      seen.toasts.push([text, timeoutMs])
    },
    playSound: () => {
      seen.sounds += 1
    },
    keepHeld: () => undefined,
    notShownElsewhere: async (_repo, lines) => lines.filter((line) => !others.includes(line))
  }

  return { host, seen }
}

describe("the alerts that reach the person", () => {
  test("alerts raised while turns run wait for the last to end, then show together", async () => {
    const session = createSession(readSettings({ alertSound: true }))
    session.repo = REPO
    session.runningTurns.add("turn-1")
    session.runningTurns.add("turn-2")
    const { host, seen } = hostOf()

    await announce(host, session, REPO, ["#7 merged"])
    session.runningTurns.delete("turn-1")
    await announce(host, session, REPO, ["#8 ready"])
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

    await announce(host, session, REPO, ["#7 merged", "#8 ready"])
    expect(seen).toEqual({ toasts: [["#8 ready", 8_000]], sounds: 1 })
    await announce(host, session, REPO, ["#7 merged"])
    expect(seen).toEqual({ toasts: [["#8 ready", 8_000]], sounds: 1 })
  })

  test("the sound plays once per showing, and only where it is on", async () => {
    const loud = hostOf()
    const quiet = hostOf()

    await announce(loud.host, createSession(readSettings({ alertSound: true })), REPO, ["#1 a", "#2 b", "#3 c", "#4 d"])
    expect(loud.seen).toEqual({
      toasts: [
        ["#1 a", 8_000],
        ["#2 b", 8_000],
        ["2 more pull request changes, see /prs", 8_000]
      ],
      sounds: 1
    })
    await announce(quiet.host, createSession(readSettings({})), REPO, ["#1 a"])
    expect(quiet.seen).toEqual({ toasts: [["#1 a", 8_000]], sounds: 0 })
  })
})
