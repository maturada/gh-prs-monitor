// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import {
  clockOf,
  drawnNodes,
  GITHUB,
  keptOverReload,
  machine,
  MINUTE,
  mountPane,
  runPrs,
  startSession,
  wordsIn
} from "./testing/world"
import { held } from "./testing/promises"
import type { World } from "./testing/world"

const APPROVED = { login: "ann", state: "APPROVED", at: "2026-10-23T10:00:00Z" }

// acme/web: your #12, CI failing; acme/admin: #3 asks your review.
function worldWith(overrides: Partial<World> = {}): World {
  return {
    github: GITHUB,
    branch: "main",
    uncommitted: 0,
    elsewhere: {
      mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE" }],
      requested: [{ repo: "acme/admin", number: 3, title: "Roles page", author: "bo" }]
    },
    ...overrides
  }
}

function checks(runs: readonly string[]): string[] {
  return runs.filter((line) => line.includes("archived:false"))
}

describe("alerts from other repositories", () => {
  test("off, as by default, nothing is asked", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.advance(10 * MINUTE)

    expect(checks(seen.runs)).toEqual([])
  })

  test(
    "on, the first check says what waits in one line, then only what changes, naming its repository",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      expect(seen.toasts).toEqual(["2 waiting in other repositories: acme/admin, acme/web"])
      world.elsewhere = {
        ...world.elsewhere,
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }]
      }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.slice(1)).toEqual(["✓ acme/web#12 Checkout page — approved by ann · /prs acme/web"])
    }
  )

  for (const isHidingDrafts of [true, false]) {
    test(
      `with Hide my drafts ${isHidingDrafts ? "on, your own drafts elsewhere wait for nothing" : "off, they count as any other"}`,
      { options: { alertOtherRepos: true, hideDrafts: isHidingDrafts } },
      async ($, on) => {
        const clock = clockOf(on)
        const seen = machine(
          $,
          on,
          worldWith({
            elsewhere: {
              mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", isDraft: true }]
            }
          })
        )
        await startSession($)
        await clock.settle()

        expect(seen.toasts).toEqual(isHidingDrafts ? [] : ["1 waiting in another repository: acme/web"])
      }
    )
  }

  test(
    "it asks the folder's server alone, the folder's repository left out, once a refresh's interval",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      await clock.advance(6 * MINUTE)

      const asked = checks(seen.runs)
      expect(asked).toHaveLength(3)
      expect(asked.every((line) => line.startsWith("gh api graphql --hostname github.com "))).toBe(true)
      expect(asked.every((line) => line.includes("-repo:acme/app"))).toBe(true)
    }
  )

  test(
    "in the background, /prs asks nothing more: the timer alone checks",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      const asked = checks(seen.runs).length

      await runPrs($, "")
      await clock.settle()

      expect(checks(seen.runs)).toHaveLength(asked)
    }
  )

  test(
    "while nothing draws it asks nothing; drawn again, one line says what waits again",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      const asked = checks(seen.runs).length

      world.surfaces = []
      await clock.advance(9 * MINUTE)
      expect(checks(seen.runs)).toHaveLength(asked)

      world.surfaces = ["terminal"]
      await clock.advance(3 * MINUTE)
      expect(seen.toasts.filter((toast) => toast.startsWith("2 waiting"))).toHaveLength(2)
    }
  )

  test(
    "while open, it asks only while the pane is open",
    { options: { alertOtherRepos: true, refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({ isPaneOpen: false })
      const seen = machine($, on, world)
      await startSession($)
      await clock.advance(6 * MINUTE)
      expect(checks(seen.runs)).toEqual([])

      world.isPaneOpen = true
      await clock.advance(3 * MINUTE)
      expect(checks(seen.runs)).toHaveLength(1)
    }
  )

  test(
    "on demand, it asks when /prs opens the pane, and at no timer",
    { options: { alertOtherRepos: true, refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.advance(6 * MINUTE)
      expect(checks(seen.runs)).toEqual([])

      await runPrs($, "")
      await clock.settle()
      expect(checks(seen.runs)).toHaveLength(1)
    }
  )

  test(
    "a reload keeps the last states: the change since is told, not the line again",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({
        elsewhere: { mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "SUCCESS" }] }
      })
      const seen = machine($, on, world)
      const kept = {
        viewer: "me",
        pulls: {
          "github.com/acme/web#12": {
            repo: { host: "github.com", name: "acme/web" },
            number: 12,
            title: "Checkout page",
            url: "https://github.com/acme/web/pull/12",
            author: "me",
            isMine: true,
            isRequested: false,
            ci: "FAILURE",
            reviews: {},
            seenAt: 0,
            changedAt: 0
          }
        },
        isCut: { mine: false, requested: false },
        at: 0,
        pickedAt: null,
        isTold: true
      }
      keptOverReload(on, { elsewhere: kept })
      await startSession($)
      await clock.settle()

      expect(seen.toasts).toEqual(["✓ acme/web#12 Checkout page — CI passed · /prs acme/web"])
    }
  )

  test(
    "a state the picker's check kept with the setting off is no start to tell from: turned on, it says what waits",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      keptOverReload(on, {
        elsewhere: {
          viewer: "me",
          pulls: {
            "github.com/acme/web#12": {
              repo: { host: "github.com", name: "acme/web" },
              number: 12,
              title: "Checkout page",
              url: "https://github.com/acme/web/pull/12",
              author: "me",
              isMine: true,
              isRequested: false,
              ci: "SUCCESS",
              reviews: {},
              seenAt: 0,
              changedAt: 0
            }
          },
          isCut: { mine: false, requested: false },
          at: 0,
          pickedAt: 0,
          isTold: false
        }
      })
      await startSession($)
      await clock.settle()

      expect(seen.toasts).toEqual(["2 waiting in other repositories: acme/admin, acme/web"])
    }
  )

  test(
    "the visited repository's changes come from the light check too",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({ others: { "github.com/acme/web": { mine: [{ number: 12, title: "Checkout page" }] } } })
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      await runPrs($, "acme/web")
      await clock.settle()

      const ui = await mountPane($, "terminal")
      expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).toContain("Not this session's folder")
      world.elsewhere = { mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "SUCCESS" }] }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.at(-1)).toBe("✓ acme/web#12 Checkout page — CI passed · /prs acme/web")
    }
  )

  test(
    "a change another session told lately, from its own list or its light check, is not told again",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      // Another session showed the approval a moment ago; the same check also finds a review newly asked of you.
      world.store = {
        ...world.store,
        shown: { "github.com/acme/web#12 approved by ann": { at: clock.now(), by: "another-session" } }
      }
      world.elsewhere = {
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }],
        requested: [...world.elsewhere!.requested!, { repo: "acme/admin", number: 9, title: "Audit log", author: "bo" }]
      }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.filter((toast) => toast.includes("approved"))).toEqual([])
      expect(seen.toasts.filter((toast) => toast.includes("acme/admin#9"))).toHaveLength(1)
    }
  )

  test(
    "two checks at once ask GitHub once",
    { options: { alertOtherRepos: true, refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()

      await Promise.all([runPrs($, ""), runPrs($, "")])
      await clock.settle()

      expect(checks(seen.runs)).toHaveLength(1)
    }
  )

  test(
    "at a session's start, the check and the first list look the folder's repository up once between them",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      // gh taking a while to answer, as it does on the network, while both would ask.
      const seen = machine($, on, worldWith({ slowRepoViewMs: 2_000 }), clock)
      await startSession($)
      await clock.advance(5_000)

      expect(checks(seen.runs).length).toBeGreaterThan(0)
      expect(seen.runs.filter((line) => line.startsWith("gh repo view --json"))).toHaveLength(1)
    }
  )

  test(
    "in a folder with no repository, it asks gh's default server, leaving none out",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine(
        $,
        on,
        worldWith({
          repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host"
        })
      )
      await startSession($)
      await clock.settle()

      const asked = checks(seen.runs)
      expect(asked.length).toBeGreaterThan(0)
      expect(
        asked.every((line) => line.startsWith("gh api graphql --hostname github.com ") && !line.includes("-repo:"))
      ).toBe(true)
    }
  )

  test(
    "in a folder with no repository, gh signed in to GitHub Enterprise alone, nothing is asked of github.com",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine(
        $,
        on,
        worldWith({
          repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host",
          signedIn: ["ghe.example.com"]
        })
      )
      await startSession($)
      await clock.advance(10 * MINUTE)

      expect(checks(seen.runs)).toEqual([])
      expect(seen.runs).toContain("gh auth status --active --hostname github.com")
      expect(seen.debug.some((line) => line.includes("is not signed in to github.com"))).toBe(true)
    }
  )

  test(
    "a new review request names its author and repository",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      world.elsewhere = {
        ...world.elsewhere,
        requested: [...world.elsewhere!.requested!, { repo: "acme/admin", number: 5, title: "Audit log", author: "bo" }]
      }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.slice(1)).toEqual(["⌕ acme/admin#5 Audit log (bo) — review requested · /prs acme/admin"])
    }
  )

  test(
    "a kind turned off is not told; with Change alerts off, not even the line",
    { options: { alertOtherRepos: true, alertReviews: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      world.elsewhere = {
        ...world.elsewhere,
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }]
      }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts).toEqual(["2 waiting in other repositories: acme/admin, acme/web"])
    }
  )

  test(
    "with Change alerts off, it says nothing at all",
    { options: { alertOtherRepos: true, notify: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      world.elsewhere = { mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "SUCCESS" }] }
      await clock.advance(3 * MINUTE)

      expect(checks(seen.runs).length).toBeGreaterThan(0)
      expect(seen.toasts).toEqual([])
    }
  )

  test(
    "a check that fails says so in the debug log alone, and keeps nothing",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const kept: unknown[] = []
      on("state.set", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
        kept.push(e.value)
        return next(e)
      })
      const seen = machine($, on, worldWith({ elsewhereFailure: "HTTP 502: Bad Gateway" }))
      await startSession($)
      await clock.settle()

      expect(seen.toasts).toEqual([])
      expect(kept).toEqual([])
      expect(seen.debug.some((line) => line.includes("Other repositories could not be checked"))).toBe(true)
    }
  )

  test(
    "an event held for a turn, which another session shows meanwhile, is not told again as the turn ends",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      await $.turn.start({ text: "", turnId: "t1" } as never)
      world.elsewhere = {
        ...world.elsewhere,
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }]
      }
      await clock.advance(3 * MINUTE)
      world.store = {
        ...world.store,
        shown: { "github.com/acme/web#12 approved by ann": { at: clock.now(), by: "another-session" } }
      }
      await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t1" } as never)
      await clock.settle()

      expect(seen.toasts.filter((toast) => toast.includes("approved"))).toEqual([])
    }
  )

  test(
    "an event held for a long turn is not told again where another session told it since it came",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      await $.turn.start({ text: "", turnId: "t1" } as never)
      world.elsewhere = {
        ...world.elsewhere,
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }]
      }
      await clock.advance(3 * MINUTE)
      world.store = {
        ...world.store,
        shown: { "github.com/acme/web#12 approved by ann": { at: clock.now(), by: "another-session" } }
      }
      await clock.advance(11 * MINUTE)
      await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer", turnId: "t1" } as never)
      await clock.settle()

      expect(seen.toasts.filter((toast) => toast.includes("approved"))).toEqual([])
    }
  )

  test(
    "while open, the pane closed and opened again says what waits in one line again",
    { options: { alertOtherRepos: true, refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({ isPaneOpen: true })
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()

      world.isPaneOpen = false
      await clock.advance(3 * MINUTE)
      world.isPaneOpen = true
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.filter((toast) => toast.startsWith("2 waiting"))).toHaveLength(2)
    }
  )

  test(
    "a state kept for another account is none: the first check says the line, and alerts nothing",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      keptOverReload(on, {
        elsewhere: {
          viewer: "someone-else",
          pulls: {},
          isCut: { mine: false, requested: false },
          at: 0,
          pickedAt: null
        }
      })
      await startSession($)
      await clock.settle()

      expect(seen.toasts).toEqual(["2 waiting in other repositories: acme/admin, acme/web"])
    }
  )

  test("turned off, what it read is forgotten, so turned on again it starts over", async ($, on) => {
    const clock = clockOf(on)
    const kept: unknown[] = []
    on("state.set", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
      kept.push(e.value)
      return next(e)
    })
    machine($, on, worldWith())
    keptOverReload(on, {
      elsewhere: { viewer: "me", pulls: {}, isCut: { mine: false, requested: false }, at: 0, pickedAt: null }
    })
    await startSession($)
    await clock.settle()

    expect(kept).toEqual([null])
  })

  test(
    "while the folder's repository can't be looked up for a while, it asks nothing, rather than leave nothing out",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith({ repoViewFailure: "error connecting to api.github.com" }))
      await startSession($)
      await clock.settle()

      expect(checks(seen.runs)).toEqual([])
      expect(seen.debug.some((line) => line.includes("Other repositories could not be checked"))).toBe(true)
    }
  )

  test(
    "while open, opening the pane checks at once, as the folder's list does",
    { options: { alertOtherRepos: true, refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith({ isPaneOpen: false }))
      await startSession($)
      await clock.settle()
      expect(checks(seen.runs)).toEqual([])

      await runPrs($, "")
      await clock.settle()

      expect(checks(seen.runs)).toHaveLength(1)
    }
  )

  test(
    "on demand, a visit's Refresh checks too, as its changes come from the light check alone",
    { options: { alertOtherRepos: true, refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({ others: { "github.com/acme/web": { mine: [{ number: 12, title: "Checkout page" }] } } })
      const seen = machine($, on, world)
      await startSession($)
      await runPrs($, "acme/web")
      await clock.settle()
      const ui = await mountPane($, "terminal")
      const asked = checks(seen.runs).length

      await ui.press({ key: "refresh" })
      await clock.settle()

      expect(checks(seen.runs)).toHaveLength(asked + 1)
    }
  )

  test(
    "while open, an app attaching again after nothing drew checks at once, as the folder's list does",
    { options: { alertOtherRepos: true, refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith({ isPaneOpen: true })
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      world.surfaces = []
      await clock.advance(3 * MINUTE)
      const asked = checks(seen.runs).length

      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.settle()

      expect(checks(seen.runs)).toHaveLength(asked + 1)
      expect(seen.toasts.filter((toast) => toast.startsWith("2 waiting"))).toHaveLength(2)
    }
  )

  test(
    "a check that fails after nothing drew leaves the next to say what waits in one line",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      world.surfaces = []
      await clock.advance(3 * MINUTE)

      world.surfaces = ["terminal"]
      world.elsewhereFailure = "HTTP 502: Bad Gateway"
      await clock.advance(3 * MINUTE)
      world.elsewhereFailure = undefined
      await clock.advance(3 * MINUTE)

      expect(seen.toasts.filter((toast) => toast.startsWith("2 waiting"))).toHaveLength(2)
    }
  )

  test(
    "a check keeps when the picker was opened while it ran, which it read before the picker wrote it",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      // Once armed, the second read of the state after the check's request (the one its write is made over) finds the
      // picker opened at 500 meanwhile, at the version the check's write is made against.
      let [isArmed, reads] = [false, 0]
      on("state.get", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
        const real = (await next(e)) as { value?: { value: unknown; version: number } | null }
        if (!isArmed || ++reads !== 2 || !real.value?.value) {
          return real as never
        }

        return { value: { ...real.value, value: { ...(real.value.value as object), pickedAt: 500 } } } as never
      })
      const kept: { pickedAt?: number | null }[] = []
      on("state.set", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
        kept.push(e.value as { pickedAt?: number | null })
        return next(e)
      })
      const world = worldWith()
      machine($, on, world, clock)
      await startSession($)
      await clock.settle()
      expect(kept.at(-1)?.pickedAt).toBe(null)

      const { gate, open } = held()
      world.elsewhereGate = gate
      await clock.advance(3 * MINUTE)
      isArmed = true
      open()
      await clock.settle()

      expect(reads).toBeGreaterThanOrEqual(2)
      expect(kept.at(-1)?.pickedAt).toBe(500)
    }
  )

  test(
    "a check the module a reload replaced began keeps nothing and tells nothing",
    { options: { alertOtherRepos: true } },
    async ($, on) => {
      const clock = clockOf(on)
      let isReplaced = false
      on("state.get", { plugin: "gh-prs-monitor", key: "module" }, async (_, e, next) =>
        isReplaced ? ({ value: { value: { id: "newer", isLoading: false }, version: 9 } } as never) : next(e)
      )
      const kept: unknown[] = []
      on("state.set", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
        kept.push(e.value)
        return next(e)
      })
      const world = worldWith()
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      const [keptBefore, toastsBefore] = [kept.length, seen.toasts.length]

      isReplaced = true
      world.elsewhere = {
        ...world.elsewhere,
        mine: [{ repo: "acme/web", number: 12, title: "Checkout page", ci: "FAILURE", reviews: [APPROVED] }]
      }
      await clock.advance(3 * MINUTE)

      expect([kept.length, seen.toasts.length]).toEqual([keptBefore, toastsBefore])
    }
  )
})
