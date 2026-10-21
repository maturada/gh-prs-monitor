// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import { fetchClaim, sharedAnswer, snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import { GH_MISSING } from "./gh"
import { DEMO_ALERTS } from "./demo"
import { BRANCH_MARK } from "./list"
import { QUERY_VERSION } from "./shared"
import {
  clockOf,
  MINUTE,
  machine,
  HEADING,
  lines,
  runPrs,
  startSession,
  mountPane,
  GITHUB,
  keepOlderSnapshot,
  keptList,
  keptOverReload,
  settleAll,
  drawnNodes,
  PLUGIN,
  pressDrawn
} from "./testing/world"
import type { World } from "./testing/world"

describe("background refresh", () => {
  test("loads at session start, shows the summary, and alerts on what changes later", async ($, on) => {
    const clock = clockOf(on, { now: 1_000 })
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)

    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("gh "))).toHaveLength(2)
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )
    expect(seen.toasts).toEqual([])

    world.github = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!],
      requested: [...GITHUB.requested!, { number: 8, title: "Activity cards", author: "bob" }]
    }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed", "⌕ #8 Activity cards (bob) — review requested"])
    expect(seen.toastDurations).toEqual([8_000, 8_000])
    // The repository is resolved once; each refresh is one GraphQL request.
    expect(seen.runs.filter((run) => run.startsWith("gh repo view"))).toHaveLength(1)
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(2)
  })

  const summaryOff: Record<string, string | boolean>[] = [
    { statusLine: false },
    { refresh: "while-open" },
    { refresh: "on-demand" }
  ]
  for (const options of summaryOff) {
    test(
      `a reload with the summary turned off (${JSON.stringify(options)}) clears what the module before left`,
      { options },
      async ($, on) => {
        const clock = clockOf(on)
        const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
        // The list kept over the reload a /config change makes.
        keptOverReload(on, { snapshot: keptList(GITHUB), checkout: { branch: "main", head: "h", at: 0 } })
        await startSession($)
        await clock.settle()

        expect(seen.statuses).toEqual([undefined])
      }
    )
  }

  test("a reload with the summary on puts it back over the list kept", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    keptOverReload(on, { snapshot: keptList(GITHUB), checkout: { branch: "main", head: "h", at: 0 } })
    await startSession($)

    expect(seen.statuses[0]).toMatch(/^PRs /)
    await clock.settle()
    expect(seen.statuses.at(-1)).toMatch(/^PRs /)
  })

  test("the interval follows the setting", { options: { pollMinutes: 10 } }, async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    await startSession($)
    await clock.advance(9 * MINUTE)
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)

    await clock.advance(MINUTE)
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(2)
  })

  test("on-demand loads nothing until /prs", { options: { refresh: "on-demand" } }, async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    await startSession($)
    await clock.advance(30 * MINUTE)
    expect(seen.runs).toEqual([])

    await runPrs($, "")
    await clock.settle()
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)
  })

  test("only the alert kinds turned on show", { options: { alertCi: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)

    await startSession($)
    await clock.settle()
    world.github = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!],
      requested: [...GITHUB.requested!, { number: 8, title: "Activity cards", author: "bob" }]
    }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["⌕ #8 Activity cards (bob) — review requested"])
  })

  test("alerts stay up as long as the setting says", { options: { alertSeconds: 20 } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)

    await startSession($)
    await clock.settle()
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toastDurations).toEqual([20_000])
  })

  test(
    "alerts and the status line can be turned off",
    { options: { notify: false, statusLine: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      const seen = machine($, on, world)

      await startSession($)
      world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }] }
      await clock.advance(3 * MINUTE)

      expect(seen.toasts).toEqual([])
      expect(seen.statuses).toEqual([])
    }
  )
})

describe("setup problems", () => {
  test("a missing gh is announced once, and the checks stop", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isGhMissing: true })

    await startSession($)
    await clock.advance(10 * MINUTE)

    expect(seen.toasts).toEqual([
      "The GitHub CLI (gh) is not installed. Get it from https://cli.github.com, then run: gh auth login"
    ])
    expect(seen.runs).toEqual([
      'gh repo view --json nameWithOwner,url --jq .nameWithOwner + " " + .url',
      "gh --version"
    ])
  })

  test("once gh is installed, /prs loads and the stopped checks come back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isGhMissing: true }
    const seen = machine($, on, world)
    await startSession($)
    await clock.advance(6 * MINUTE)

    world.isGhMissing = false
    await runPrs($, "")
    await clock.advance(6 * MINUTE)

    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(3)
  })

  test("signed out is announced once and checked again later", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "To get started with GitHub CLI, please run:  gh auth login"
    })

    await startSession($)
    await clock.advance(6 * MINUTE)

    expect(seen.toasts).toEqual(["The GitHub CLI is not signed in. Run: gh auth login"])
    expect(seen.runs.filter((run) => run.startsWith("gh repo view"))).toHaveLength(3)
  })

  test("a folder without a GitHub project stays quiet, and the pane says why", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "failed to run git: fatal: not a git repository (or any of the parent directories): .git"
    })

    await startSession($)
    await clock.advance(10 * MINUTE)
    expect(seen.toasts).toEqual([])
    expect(seen.runs).toHaveLength(1)

    const ui = await mountPane($, "terminal")
    expect(
      await ui.find({ type: "Text", text: "This folder is not a git repository, so it has no GitHub project." })
    ).toBeDefined()
  })
})

describe("a repository renamed or moved on GitHub", () => {
  test("is read under its new name from GitHub's first answer on, as the searches find nothing under the old one", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, movedTo: "acme/application" })
    const searched = () =>
      seen.runs.flatMap((run) =>
        run.startsWith("gh api graphql") && run.includes("$mine") ? [/repo:(\S+)/.exec(run)?.[1]] : []
      )

    await startSession($)
    await clock.settle()
    expect(searched()).toEqual(["acme/app", "acme/application"])
    expect(seen.statuses.at(-1)).toBe(
      "PRs ✅ 1 Ready\u00a0\u00a0❗ 1 Needs You\u00a0\u00a0🔍 1 To Review\u00a0\u00a0(/prs)"
    )

    await clock.advance(3 * MINUTE)
    expect(searched()).toEqual(["acme/app", "acme/application", "acme/application"])
  })
})

describe("a snapshot from another version", () => {
  test("is not drawn: with nothing loading, the pane says what to press, centred as the empty list's line is", async ($, on) => {
    clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    keepOlderSnapshot(on, GITHUB)

    const ui = await mountPane($, "terminal")

    expect(await ui.find({ type: "Text", text: "Press Refresh to check GitHub for pull requests." })).toBeDefined()
    // One line under the header, from the pane's own gap, as everything under it is.
    expect((await ui.find({ key: "loading" }))?.props).toEqual({ key: "loading", justifyContent: "center" })
    expect(
      (await ui.find({ type: "Text", text: "Press Refresh to check GitHub for pull requests." }))?.props
    ).toMatchObject({ dimColor: true, wrap: "wrap" })
  })

  test(
    "a pane open but not drawn is not checked at start on demand",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, {
        github: GITHUB,
        branch: "main",
        uncommitted: 0,
        isPaneOpen: true,
        placesPanes: false
      })
      keepOlderSnapshot(on, GITHUB)

      await startSession($)
      await clock.advance(10 * MINUTE)

      expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(0)
    }
  )

  test(
    "a pane open over a reload with a list it can draw waits on demand, as before",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true })
      const loads = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
      await startSession($)
      await runPrs($, "")
      await clock.settle()
      expect(loads()).toBe(1)

      await startSession($)
      await clock.advance(10 * MINUTE)

      expect(loads()).toBe(1)
    }
  )

  test(
    "the check at start tells nothing in a toast, as no list was there to compare",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }
      const seen = machine($, on, world)
      keepOlderSnapshot(on, GITHUB)
      world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }

      await startSession($)
      await clock.settle()

      expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)
      expect(seen.toasts).toEqual([])
    }
  )

  test(
    "a pane left open over a reload with no list is checked at once, even on demand",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true })
      keepOlderSnapshot(on, GITHUB)

      await startSession($)
      await clock.advance(10 * MINUTE)

      expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)
    }
  )
})

describe("a load of the module a reload replaced", () => {
  test("shows no list over the newer one's", async ($, on) => {
    const clock = clockOf(on)
    let isReplaced = false
    on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) =>
      isReplaced ? ({ value: { value: { id: "newer", isLoading: false }, version: 9 } } as never) : next(e)
    )
    let listsAfter = 0
    on("state.set", { plugin: PLUGIN, key: "snapshot" }, async (_, e, next) => {
      listsAfter += isReplaced ? 1 : 0

      return next(e)
    })
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    isReplaced = true
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(listsAfter).toBe(0)
  })

  test("shows no problem over the newer one's list, and leaves its status line and loading mark alone", async ($, on) => {
    const clock = clockOf(on)
    // Once set, a newer load of the module has taken over.
    let isReplaced = false
    on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) =>
      isReplaced ? ({ value: { value: { id: "newer", isLoading: false }, version: 9 } } as never) : next(e)
    )
    // The loading mark is the newer load's then: a write from this one would clear it under that one's load.
    let marksAfter = 0
    on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
      marksAfter += isReplaced ? 1 : 0

      return next(e)
    })
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const shown = seen.statuses.at(-1)
    const ui = await mountPane($, "terminal")

    isReplaced = true
    world.graphqlFailure = { stdout: "", stderr: "gh: Server Error (HTTP 502)" }
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(await ui.find({ type: "Text", text: /GitHub took too long/ })).toBeUndefined()
    expect(seen.statuses.at(-1)).toBe(shown)
    expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeUndefined()
    expect(marksAfter).toBe(0)
  })

  test("leaves the newer one's loading mark when it took over between this one's read and its write", async ($, on) => {
    const clock = clockOf(on)
    // From the race on, the newer load of the module holds the value: this one's end mark misses, as another write
    // beat it, and every write after it lands on what the newer one wrote.
    let isRacing = false
    let held = null as { value: unknown; version: number } | null
    on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) =>
      held === null ? next(e) : ({ value: held } as never)
    )
    on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
      if (held === null && isRacing && (e.value as { isLoading?: boolean } | null)?.isLoading === false) {
        held = { value: { id: "newer", isLoading: true }, version: 9 }

        return { value: { isSet: false, version: held.version } } as never
      }
      if (held !== null) {
        if (e.ifVersion !== undefined && e.ifVersion !== held.version) {
          return { value: { isSet: false, version: held.version } } as never
        }
        held = { value: e.value, version: held.version + 1 }

        return { value: { isSet: true, version: held.version } } as never
      }

      return next(e)
    })
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    isRacing = true
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(held?.value).toEqual({ id: "newer", isLoading: true })
    expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeDefined()
  })
})

describe("a load after /clear, which empties the session's state and starts no session again", () => {
  for (const reason of ["clear", "resume"] as const) {
    test(`still marks the header while it runs, after a ${reason}`, async ($, on) => {
      const clock = clockOf(on)
      // The engine's own end step, beneath the plugin.
      on("session.end", async (_, e) => ({ sessionId: e.sessionId }))
      // Once cleared, the mark reads as never written until written again, at the version the store holds.
      let isCleared = false
      let isWritten = false
      on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
        const held = await next(e)

        return isCleared && !isWritten && "value" in held
          ? ({ value: { ...held.value, value: undefined } } as never)
          : held
      })
      on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
        isWritten ||= isCleared

        return next(e)
      })
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world, clock)
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } })
      isCleared = true
      world.slowGithubMs = MINUTE
      await ui.press({ key: "refresh" })
      await clock.advance(1_000)

      expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeDefined()
      await clock.advance(MINUTE)
      expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeUndefined()
    })
  }

  // A newer load of the module takes the mark, before this load's refresh or during it, then /clear empties it, ending
  // that newer load's session alone. This load may have seen a /clear or a resume of its own before.
  for (const earlier of [null, "clear", "resume"] as const) {
    for (const isReplacedFirst of [false, true]) {
      test(`a load a reload replaced leaves the empty mark to the live one (an end before: ${earlier ?? "none"}; replaced ${isReplacedFirst ? "before" : "during"} its refresh)`, async ($, on) => {
        const clock = clockOf(on)
        on("session.end", async (_, e) => ({ sessionId: e.sessionId }))
        let phase: "live" | "replaced" | "cleared" = "live"
        const marksAfter: unknown[] = []
        on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
          const held = await next(e)
          if (phase === "replaced") {
            return { value: { value: { id: "newer", isLoading: true }, version: 9 } } as never
          }

          return phase === "cleared" && "value" in held
            ? ({ value: { ...held.value, value: undefined } } as never)
            : held
        })
        on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
          if (phase === "cleared") {
            marksAfter.push(e.value)
          }

          return next(e)
        })
        const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
        machine($, on, world, clock)
        await startSession($)
        await clock.settle()
        const ui = await mountPane($, "terminal")
        if (earlier !== null) {
          await $.session.end({ reason: earlier, sessionId: "s0", resume: { id: "s0" } })
          await clock.settle()
        }

        world.slowGithubMs = MINUTE
        if (isReplacedFirst) {
          phase = "replaced"
        }
        await ui.press({ key: "refresh" })
        await clock.advance(1_000)
        phase = "replaced"
        await clock.advance(1_000)
        phase = "cleared"
        await clock.advance(MINUTE)

        // It writes the empty record back as it found it, never a mark of its own.
        expect(marksAfter.filter((mark) => mark !== null)).toEqual([])
      })
    }
  }

  // A conversation a /clear or a resume starts holds no list: it is checked again as at a session's start, in
  // background mode and wherever the pane is open, while compaction keeps the list. A poll comes 3 minutes on.
  for (const [source, refresh, isPaneOpen, loads] of [
    ["clear", "on-demand", true, 1],
    ["clear", "on-demand", false, 0],
    ["clear", "while-open", true, 1],
    ["clear", "background", false, 1],
    ["resume", "on-demand", true, 1],
    ["resume", "background", false, 1],
    ["compact", "on-demand", true, 0],
    ["compact", "background", false, 0]
  ] as const) {
    test(
      `after a ${source} with ${refresh} refresh and the pane ${isPaneOpen ? "open" : "closed"}, the list is checked ${loads ? "at once" : "only as before"}`,
      { options: { refresh } },
      async ($, on) => {
        const clock = clockOf(on)
        const state = endsLikeClear(on)
        const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen }, clock)
        await startSession($)
        // `/prs` opens the pane.
        if (isPaneOpen) {
          await runPrs($, "")
        }
        await clock.settle()
        const before = listLoads(seen)

        if (source !== "compact") {
          await $.session.end({ reason: source, sessionId: "s1", resume: { id: "s1" } })
          state.empty()
        }
        await $.classic.SessionStart({ source })
        await clock.advance(10_000)

        expect(listLoads(seen) - before).toBe(loads)
      }
    )
  }

  test("a session launched with --resume holds its list already, and loads it once", async ($, on) => {
    const clock = clockOf(on)
    endsLikeClear(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()

    // The launch's own start event, with no end before it.
    await $.classic.SessionStart({ source: "resume" })
    await clock.advance(10_000)

    expect(listLoads(seen)).toBe(1)
  })

  test("a /clear in a session nothing draws checks nothing, as such a session starts no checks", async ($, on) => {
    const clock = clockOf(on)
    const state = endsLikeClear(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const before = listLoads(seen)

    world.surfaces = []
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
    state.empty()
    await $.classic.SessionStart({ source: "clear" })
    await clock.advance(10_000)

    expect(listLoads(seen) - before).toBe(0)
  })

  test("the person's own SessionStart hooks run once and their answer comes back, after a /clear too", async ($, on) => {
    const clock = clockOf(on)
    const state = endsLikeClear(on, async () => ({ additionalContext: ["from the person's hook"] }))
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }, clock)
    await startSession($)
    await runPrs($, "")
    await clock.settle()

    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
    const answer = await $.classic.SessionStart({ source: "clear" })

    expect(answer).toMatchObject({ additionalContext: ["from the person's hook"] })
    expect(state.starts).toEqual(["clear"])
  })

  test(
    "the list after a /clear is asked for at once, not after the person's own SessionStart hooks",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      // A SessionStart hook of the person's that takes half a minute.
      const state = endsLikeClear(on, async () => {
        await clock.sleep(30_000)

        return {}
      })
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }, clock)
      await startSession($)
      await runPrs($, "")
      await clock.settle()
      const before = listLoads(seen)

      await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
      state.empty()
      const starting = $.classic.SessionStart({ source: "clear" })
      await clock.advance(1_000)

      expect(listLoads(seen) - before).toBe(1)
      await clock.advance(30_000)
      await starting
      expect(state.starts).toEqual(["clear"])
    }
  )

  test(
    "a pane open over a /clear says it is checking while the list loads, then shows it",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const state = endsLikeClear(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }
      machine($, on, world, clock)
      await startSession($)
      await runPrs($, "")
      await clock.settle()

      world.slowGithubMs = MINUTE
      await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
      state.empty()
      await $.classic.SessionStart({ source: "clear" })
      await clock.advance(1_000)
      // Drawn as the emptied state reads now.
      const checking = await mountPane($, "terminal")
      expect(await checking.find({ type: "Text", text: "Checking GitHub for pull requests…" })).toBeDefined()
      await checking.unmount()

      await clock.advance(MINUTE)
      const listed = await mountPane($, "terminal")
      expect(
        await listed.find({ type: "Text", text: "Press Refresh to check GitHub for pull requests." })
      ).toBeUndefined()
      expect(await listed.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    }
  )

  test(
    "a load under way across a /clear takes its loading mark again, and its list shows when it ends",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const state = endsLikeClear(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }
      const seen = machine($, on, world, clock)
      await startSession($)
      const ui = await mountPane($, "terminal")
      await runPrs($, "")
      await clock.settle()

      world.slowGithubMs = MINUTE
      await ui.press({ key: "refresh" })
      await clock.advance(1_000)
      await ui.unmount()
      const before = listLoads(seen)
      await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
      state.empty()
      await $.classic.SessionStart({ source: "clear" })
      await clock.advance(1_000)

      const checking = await mountPane($, "terminal")
      expect(await checking.find({ type: "Text", text: "Checking GitHub for pull requests…" })).toBeDefined()
      // It joined the load under way.
      expect(listLoads(seen)).toBe(before)
      await checking.unmount()

      await clock.advance(MINUTE)
      const listed = await mountPane($, "terminal")
      expect(await listed.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    }
  )

  test(
    "on demand, the list a /clear's load brings back behind another tab alerts nothing",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const state = endsLikeClear(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }
      const seen = machine($, on, world, clock)
      await startSession($)
      await runPrs($, "")
      await clock.settle()

      world.isPaneBehind = true
      world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
      await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } })
      state.empty()
      await $.classic.SessionStart({ source: "clear" })
      await clock.advance(10_000)

      expect(listLoads(seen)).toBe(2)
      expect(seen.toasts).toEqual([])
    }
  )
})

describe("a reload while a press was under way", () => {
  test(
    "gives the row its buttons back and drops the load's mark, as what they marked went with the module",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
      keptOverReload(on, {
        snapshot: keptList(GITHUB),
        busy: { "1": "Merging…" },
        module: { id: "earlier", isLoading: true }
      })
      await startSession($)
      await settleAll(clock, seen)

      const ui = await mountPane($, "terminal")
      expect(await ui.find({ type: "Text", text: "Merging…" })).toBeUndefined()
      expect(await ui.find({ key: "resolve-1" })).toBeDefined()
      expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeUndefined()
    }
  )
})

describe("a list kept over a reload by an earlier version", () => {
  test(
    "marks the session's branch at once, from one look at the checkout, where no load runs",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "fix/menu", uncommitted: 0 })
      // Kept with no checkout beside it, as the version before read the branch and commit apart.
      const kept = snapshotOf(GITHUB, { at: 0 })
      on("state.get", { plugin: PLUGIN, key: "snapshot" }, async () => ({
        value: { value: kept, version: 1 } as never
      }))

      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      expect(seen.runs).toEqual(["git rev-parse HEAD --symbolic-full-name HEAD"])
      expect(await ui.find({ type: "Text", text: BRANCH_MARK })).toBeDefined()
    }
  )
})

describe("a server without stacked pull requests", () => {
  test("still gets its list: asked once with stacks, then without them for the rest of the session", async ($, on) => {
    const clock = clockOf(on)
    const stacked = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, stack: { number: 30, position: 1, size: 2 } }, GITHUB.mine![1]!]
    }
    const seen = machine($, on, { github: stacked, branch: "main", uncommitted: 0, isStackless: true }, clock)
    const queries = () => seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine"))
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
    expect(await ui.find({ key: "problem" })).toBeUndefined()
    expect(queries().map((run) => run.includes("stackEntry"))).toEqual([true, false])

    await clock.advance(3 * MINUTE)
    expect(queries().map((run) => run.includes("stackEntry"))).toEqual([true, false, false])
  })
})

describe("the first load", () => {
  for (const refresh of ["while-open", "on-demand"] as const) {
    test(
      `/prs opens a pane whose first drawing says it is checking, ${refresh}`,
      { options: { refresh } },
      async ($, on) => {
        const clock = clockOf(on)
        let atOpen: unknown = undefined
        // The pane drawn as it opens, before anything after the open can write.
        on("ui.open", { id: PLUGIN }, async (_, e, next) => {
          const ui = await mountPane($, "terminal")
          atOpen = await ui.find({ type: "Text", text: "Checking GitHub for pull requests…" })
          await ui.unmount()

          return next(e)
        })
        machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, slowGithubMs: MINUTE }, clock)
        await startSession($)

        await runPrs($, "")

        expect(atOpen).toBeDefined()
        await clock.advance(MINUTE)
      }
    )
  }

  for (const kind of ["Refresh", "the timer"] as const) {
    test(`after ${kind}, the header says when the list was read, however long the load takes to end`, async ($, on) => {
      const clock = clockOf(on)
      let slowMs = 0
      // The last look kept slowly, as real storage can be, between the list and the load's end.
      on("store.set", { key: "looks" }, async (_, e, next) => {
        await clock.sleep(slowMs)

        return next(e)
      })
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world, clock)
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      slowMs = 20

      if (kind === "Refresh") {
        await ui.press({ key: "refresh" })
      } else {
        await clock.advance(3 * MINUTE)
      }
      await clock.advance(1_000)

      expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeUndefined()
      expect(await ui.find({ type: "Text", text: /^updated / })).toBeDefined()
    })
  }

  test("while it runs the pane says it is checking, and the header says nothing of it", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, slowGithubMs: MINUTE }, clock)
    await startSession($)
    await clock.advance(1_000)
    const ui = await mountPane($, "terminal")

    expect(await ui.find({ type: "Text", text: "Checking GitHub for pull requests…" })).toBeDefined()
    expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeUndefined()

    await clock.advance(MINUTE)
    expect(await ui.find({ key: "loading" })).toBeUndefined()
    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
  })
})

describe("the pane's problem box", () => {
  // What the box says, line by line, and whether it offers Retry.
  async function problemBox(ui: Awaited<ReturnType<typeof mountPane>>) {
    const box = await ui.find({ key: "problem" })
    const nodes = drawnNodes(box)

    return {
      props: box?.props,
      texts: nodes.filter((node) => node.type === "Text").map((node) => node.children?.[0]),
      wraps: nodes.filter((node) => node.type === "Text").every((node) => node.props?.wrap === "wrap"),
      hasRetry: nodes.some((node) => node.type === "Button" && node.props?.key === "retry")
    }
  }

  test("before any list: framed in the warning colour, why, that checks come back by themselves, and Retry", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "error connecting to api.github.com"
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect(await problemBox(ui)).toEqual({
      props: expect.objectContaining({ borderStyle: "round", borderColor: "warning" }),
      texts: ["⚠ Can't check pull requests", "Could not reach GitHub.", "Checking again every 3 minutes."],
      wraps: true,
      hasRetry: true
    })
    expect(await ui.find({ key: "loading" })).toBeUndefined()

    // Framed as the dialog is: the texts together, a line apart from Retry, the main button.
    const box = await ui.find({ key: "problem" })
    const nodes = drawnNodes(box)
    const [title, , note] = nodes.filter((node) => node.type === "Text")
    const group = nodes.find((node) => node.type === "Box" && node.children?.includes(title))
    expect(box?.props).toMatchObject({ flexDirection: "column", gap: 1, paddingX: 1 })
    expect(group?.props?.flexDirection).toBe("column")
    expect(group?.props?.gap).toBeUndefined()
    expect(title?.props).toMatchObject({ bold: true, color: "warning" })
    expect(nodes.filter((node) => node.type === "Text")[1]?.props?.dimColor).toBeUndefined()
    expect(note?.props?.dimColor).toBe(true)
    const retry = nodes.find((node) => node.props?.key === "retry")
    expect(retry?.props?.variant).toBe("primary")
    // Retry's row adds no spacing of its own: the box's gap is the line before it.
    const retryRow = nodes.find((node) => node.type === "Box" && node.children?.includes(retry))
    expect(retryRow?.props ?? {}).toEqual({})

    // VS Code draws the theme's warning as plain text: there the frame and the title are the theme's terminal yellow.
    const editor = await mountPane($, "vscode")
    expect((await problemBox(editor)).props).toMatchObject({ borderColor: "yellow" })
    expect((await editor.find({ type: "Text", text: "⚠ Can't check pull requests" }))?.props.color).toBe("yellow")
    await editor.unmount()

    // Retry once GitHub answers brings the list, and the box goes.
    world.repoViewFailure = undefined
    await ui.press({ key: "retry" })
    await clock.settle()
    expect(await ui.find({ key: "problem" })).toBeUndefined()
    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
  })

  test("Retry says in the header that it is checking, while the box stays until the list comes", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, repoViewFailure: "dial tcp: i/o timeout" }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    world.repoViewFailure = undefined
    world.slowGithubMs = MINUTE
    await ui.press({ key: "retry" })
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "refreshing…" })).toBeDefined()
    expect(await ui.find({ key: "problem" })).toBeDefined()

    await clock.advance(MINUTE)
    expect(await ui.find({ key: "problem" })).toBeUndefined()
  })

  test("over a list already read: the list stays below, and the box says when it is from", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    world.graphqlFailure = { stdout: "", stderr: "error connecting to api.github.com" }
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")
    const { texts } = await problemBox(ui)

    expect(texts.slice(0, 2)).toEqual(["⚠ Can't check pull requests", "Could not reach GitHub."])
    expect(texts[2]).toMatch(/^The list below is from \d\d:\d\d\. Checking again every 3 minutes\.$/)
    expect(await ui.find({ type: "Text", text: "Fix the menu" })).toBeDefined()
  })

  test(
    "a list from another day says which, and an interval of a day reads in hours",
    // Sharing off: its look every 20 s, 4,320 in the day the clock moves on, would take most of the test's time.
    { options: { pollMinutes: 1440, shareRefresh: false } },
    async ($, on) => {
      const clock = clockOf(on, { now: new Date(2026, 9, 7, 14, 0).getTime() })
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world)
      await startSession($)
      await clock.settle()

      world.graphqlFailure = { stdout: "", stderr: "error connecting to api.github.com" }
      await clock.advance(24 * 60 * MINUTE)
      const ui = await mountPane($, "terminal")

      expect((await problemBox(ui)).texts[2]).toBe(
        "The list below is from yesterday 14:00. Checking again every 24 hours."
      )
    }
  )

  test("gh that starts but doesn't finish is said as such", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isListHanging: true })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    // The kit words the rejection its own way; the sentence around it is the plugin's, with no retry of its own.
    const { texts } = await problemBox(ui)
    expect(texts[0]).toBe("⚠ Can't check pull requests")
    expect(texts[1]).toMatch(/^The GitHub CLI did not finish \(.+\)\.$/)
    expect(texts[2]).toBe("Checking again every 3 minutes.")
  })

  test("a problem that stops the checks says nothing of checking again", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "failed to run git: fatal: not a git repository (or any of the parent directories): .git"
    })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect((await problemBox(ui)).texts).toEqual([
      "⚠ Can't check pull requests",
      "This folder is not a git repository, so it has no GitHub project."
    ])
  })

  test(
    "on demand, where nothing checks by itself, the box says nothing of checking again",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, repoViewFailure: "dial tcp: i/o timeout" }
      machine($, on, world)
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      await ui.press({ key: "refresh" })
      await clock.settle()

      expect((await problemBox(ui)).texts).toEqual(["⚠ Can't check pull requests", "Could not reach GitHub."])
    }
  )

  test("an interval of an hour reads as one", { options: { pollMinutes: 60 } }, async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, repoViewFailure: "dial tcp: i/o timeout" })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect((await problemBox(ui)).texts).toContain("Checking again every hour.")
  })
})

describe("a load whose end Claude Code never answers", () => {
  test("keeps no refresh after it from asking GitHub", async ($, on) => {
    const clock = clockOf(on)
    let isHanging = false
    on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => {
      if ((e.value as { isLoading?: boolean } | null)?.isLoading === false && isHanging) {
        // A day, far past the test's end.
        await clock.sleep(24 * 60 * MINUTE)
      }

      return next(e)
    })
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const lists = () => seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("mine=")).length
    isHanging = true
    await clock.advance(3 * MINUTE)
    await clock.advance(10_000)
    const before = lists()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(lists()).toBe(before + 1)
  })
})

describe("refreshes that meet", () => {
  test("a timer's refresh that joins one under way still raises its toasts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.slowGithubMs = 2 * MINUTE
    await clock.advance(2 * MINUTE)
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "refresh" })
    await clock.advance(2 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("a refresh asked for that joins the timer's under way leaves it its toasts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.slowGithubMs = 2 * MINUTE
    await clock.advance(3 * MINUTE + 1_000)
    await ui.press({ key: "refresh" })
    await clock.advance(2 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("a store that cannot be read loses only the comparison", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isStoreBroken: true })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    expect(await ui.find({ type: "Text", text: "❗ Changes Requested" })).toBeDefined()
  })
})

describe("staying current", () => {
  test("GitHub Enterprise is asked on its own host", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoUrl: "https://git.corp.example/acme/app"
    })

    await startSession($)
    await clock.settle()

    expect(seen.runs.find((run) => run.startsWith("gh api graphql"))).toContain("--hostname git.corp.example ")
  })

  test("a token that stops working mid-session asks for a sign-in", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)

    await startSession($)
    world.graphqlFailure = {
      stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}',
      stderr: "gh: Bad credentials (HTTP 401)"
    }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["The GitHub CLI is not signed in. Run: gh auth login"])
    expect(seen.statuses.at(-1)).toBe(undefined)
  })

  test(
    "pressing Refresh twice at once starts the while-open checks once",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true }
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

      // Closed, the checks stop; opened again, two presses race to start them.
      world.isPaneOpen = false
      await clock.advance(3 * MINUTE)
      world.isPaneOpen = true
      const ui = await mountPane($, "terminal")
      await Promise.all([ui.press({ key: "refresh" }), ui.press({ key: "refresh" })])
      await clock.settle()
      const started = graphql()
      await clock.advance(9 * MINUTE)

      expect(graphql()).toBe(started + 3)
    }
  )

  test("signed out again after working, it is told again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    const SIGNED_OUT = {
      stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}',
      stderr: "gh: Bad credentials (HTTP 401)"
    }
    world.graphqlFailure = SIGNED_OUT
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    world.graphqlFailure = undefined
    await ui.press({ key: "refresh" })
    await clock.settle()
    world.graphqlFailure = SIGNED_OUT
    await pressDrawn(clock, ui, "refresh")
    await clock.settle()

    expect(seen.toasts).toEqual([
      "The GitHub CLI is not signed in. Run: gh auth login",
      "The GitHub CLI is not signed in. Run: gh auth login"
    ])
  })

  test("a refresh asked for after a timer's refresh failed raises no alerts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.graphqlFailure = { stdout: "", stderr: "error connecting to api.github.com" }
    await clock.advance(3 * MINUTE)
    world.graphqlFailure = undefined
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(seen.toasts.filter((toast) => toast.includes("CI failed"))).toEqual([])
  })

  test("Refresh after fixing a permanent problem brings the background checks back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "no git remotes found"
    }
    const seen = machine($, on, world)
    const graphqlRuns = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    await startSession($)
    await clock.advance(10 * MINUTE)
    expect(seen.runs).toHaveLength(1)

    world.repoViewFailure = undefined
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(graphqlRuns()).toBe(1)

    await clock.advance(3 * MINUTE)
    expect(graphqlRuns()).toBe(2)
  })

  test("while-open polls only while the pane is up", { options: { refresh: "while-open" } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    const graphqlRuns = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    await startSession($)
    await clock.advance(10 * MINUTE)
    expect(seen.runs).toEqual([])

    await runPrs($, "")
    await clock.settle()
    expect(graphqlRuns()).toBe(1)
    await clock.advance(3 * MINUTE)
    expect(graphqlRuns()).toBe(2)

    world.isPaneOpen = false
    await clock.advance(9 * MINUTE)
    expect(graphqlRuns()).toBe(2)
  })

  test(
    "while-open picks up again when the module loads with the pane up: at once while it has no list, then on the timer",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true })
      const loads = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

      await startSession($)
      await clock.settle()
      expect(loads()).toBe(1)

      await clock.advance(3 * MINUTE)
      expect(loads()).toBe(2)
    }
  )

  test(
    "while-open keeps no status line, which would go stale once the pane closes",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
      await startSession($)
      await runPrs($, "")
      await clock.advance(6 * MINUTE)

      expect(seen.statuses.filter((status) => status !== undefined)).toEqual([])
    }
  )

  test("on-demand keeps the status line empty", { options: { refresh: "on-demand" } }, async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })

    await startSession($)
    await runPrs($, "")
    await clock.settle()

    expect(seen.statuses).toEqual([])
  })
})

// A host that draws no plugins, as a `-p` run, attaches no surface: the engine, seeing none, places every pane where
// nobody draws it. Only a command's own output shows.

describe("with nothing attached", () => {
  const NOTHING_ATTACHED: Partial<World> = { surfaces: [] }

  // As a session's first prompt, a `-p` run's or the desktop app's before it attaches: the session's own first load is
  // under way, and /prs waits for it. What that load showed is read from it, as /prs's reads of the session's state
  // stay at their first moment, before the load wrote it.
  test("/prs as the first prompt, while the session's first load runs, prints the list it loads", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED })
    await startSession($)

    const ran = runPrs($, "")
    await clock.settle()
    expect((await ran).text).toContain("**Your Pull Requests** (2)")
  })

  test("/prs as the first prompt, while a first load meets a problem, prints the problem", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isSignedOut: true, ...NOTHING_ATTACHED })
    await startSession($)

    const ran = runPrs($, "")
    await clock.settle()
    expect((await ran).text).toContain("gh auth login")
  })

  test("/prs prints the list and opens no pane nobody draws", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })

    const ran = await runPrs($, "")
    await clock.settle()

    expect(ran.text?.split("\n")).toEqual([
      expect.stringMatching(HEADING),
      "",
      "**Your Pull Requests** (2)",
      "",
      "| Pull request | Status | Details |",
      "| --- | --- | --- |",
      "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ❗ Changes Requested | [CI ✓](https://github.com/acme/app/pull/1/checks) · [1 unresolved comment](https://github.com/acme/app/pull/1/files) |",
      "| [#2](https://github.com/acme/app/pull/2) Add a legend | ✅ Ready To Merge | [CI ✓](https://github.com/acme/app/pull/2/checks) |",
      "",
      "**Waiting On Your Review** (1)",
      "",
      "| Pull request | Status | Details |",
      "| --- | --- | --- |",
      "| [#7](https://github.com/acme/app/pull/7) Usage chart | 🔍 Review Requested | by ann · [CI ✓](https://github.com/acme/app/pull/7/checks) |"
    ])
    expect(world.isPaneOpen).toBe(undefined)
  })

  test("the printed list marks the pull request whose branch the session is on", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "fix/menu", uncommitted: 0, ...NOTHING_ATTACHED })
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })

    const ran = await runPrs($, "")
    await clock.settle()

    expect(lines(ran.text)).toContain(
      "| ● [#1](https://github.com/acme/app/pull/1) Fix the menu | ❗ Changes Requested | [CI ✓](https://github.com/acme/app/pull/1/checks) · [1 unresolved comment](https://github.com/acme/app/pull/1/files) |"
    )
    expect(lines(ran.text).filter((line) => line.includes("●"))).toHaveLength(1)
  })

  test("each /prs carries what was known from the one before it, however many came before", async ($, on) => {
    const clock = clockOf(on)
    const legend = (fields: object) => ({ ...GITHUB, mine: [GITHUB.mine![0]!, { ...GITHUB.mine![1]!, ...fields }] })
    const world: World = { github: legend({ ci: "PENDING" }), branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    const look = async (fields: object): Promise<string[]> => {
      world.github = legend(fields)
      await clock.advance(MINUTE)

      return lines((await runPrs($, "")).text)
    }
    const isReadyNews = (printed: string[]): boolean => printed.some((line) => line.includes("ready to merge"))

    await look({ ci: "PENDING" })
    expect(isReadyNews(await look({}))).toBe(true)
    // GitHub rechecks it after a push to the base, and it comes back ready: no news.
    await look({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })
    expect(isReadyNews(await look({}))).toBe(false)
  })

  test("no background checks run, as no alert would show", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED })
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    expect(seen.runs).toEqual([])

    await runPrs($, "")
    await clock.advance(10 * MINUTE)

    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)
  })

  test("/prs demo prints the example list, led by what changed on it", async ($, on) => {
    clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED })

    const ran = await runPrs($, "demo")
    const printed = lines(ran.text)

    expect(printed.slice(0, 3)).toEqual([
      "Nothing attached to this session draws the pane or alerts, so /prs prints the list here, led by what " +
        "changed since you last looked. With example pull requests:",
      expect.stringMatching(
        /^\*\*Example pull requests\*\* · ✅ \*\*1\*\* · ❗ \*\*6\*\* · 🔍 \*\*4\*\* · updated \d\d:\d\d$/u
      ),
      "**Since You Last Looked** (yesterday 17:40)"
    ])
    expect(printed).toContain("| #1242 Offline downloads | ✓ ready to merge · approved by a-teammate |")
    expect(printed).toContain("**Your Pull Requests** (14)")
    expect(printed).toContain(
      "| [#1242](https://github.com/pulls) Offline downloads | ✅ Ready To Merge | [APP-371\u00a0⧉](https://github.com/maturada/gh-prs-monitor/blob/main/gh-prs-monitor/docs/tickets.md) · CI ✓ · stack #30 2/3 · approved: a-teammate 2h ago |"
    )
    expect(printed).toContain("**Waiting On Your Review** (6)")
    expect(printed.filter((line) => line.startsWith("| ● [#1236]"))).toHaveLength(1)
    expect(seen.toasts).toEqual([])
    expect(seen.notices).toEqual([])
  })

  test("the next /prs starts with what changed since the last one", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 5).getTime())
    await runPrs($, "")

    await clock.advance(2 * 60 * MINUTE)
    const unchanged = await runPrs($, "")
    world.github = {
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE", comments: { count: 1, lastAuthor: "ann" } }, GITHUB.mine![1]!],
      requested: [...GITHUB.requested!, { number: 8, title: "Invite links", author: "bob" }]
    }
    await clock.advance(MINUTE)
    const changed = await runPrs($, "")
    const again = await runPrs($, "")

    expect(lines(unchanged.text).slice(0, 2)).toEqual([expect.stringMatching(HEADING), "_Nothing new since 09:05_"])
    expect(lines(changed.text).slice(0, 7)).toEqual([
      expect.stringMatching(HEADING),
      "**Since You Last Looked** (11:05)",
      "| Pull request | What changed |",
      "| --- | --- |",
      "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ✗ CI failed · new comment from ann |",
      "| [#8](https://github.com/acme/app/pull/8) Invite links (bob) | ⌕ review requested |",
      "**Your Pull Requests** (2)"
    ])
    expect(lines(again.text).slice(0, 2)).toEqual([expect.stringMatching(HEADING), "_Nothing new since 11:06_"])
  })

  test("ready to merge and mentions are listed with what changed", async ($, on) => {
    const clock = clockOf(on)
    const running: ResponseFixture = {
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", ci: "PENDING" }]
    }
    const world: World = { github: running, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 5).getTime())
    await runPrs($, "")
    world.github = {
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", ci: "SUCCESS" }],
      mentioned: [{ number: 9, title: "Map tiles", author: "bob" }]
    }
    await clock.advance(MINUTE)

    const ran = await runPrs($, "")

    expect(lines(ran.text).slice(1, 6)).toEqual([
      "**Since You Last Looked** (09:05)",
      "| Pull request | What changed |",
      "| --- | --- |",
      "| [#2](https://github.com/acme/app/pull/2) Add a legend | ✓ ready to merge · CI passed |",
      "| [#9](https://github.com/acme/app/pull/9) Map tiles (bob) | @ you were mentioned |"
    ])
  })

  // On demand, so no timer runs overnight between the two looks.
  test(
    "a look in another session counts, the terminal's pane included",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      machine($, on, world)
      await clock.set(new Date(2026, 9, 6, 17, 40).getTime())
      await startSession($)
      await runPrs($, "")
      await clock.settle()

      world.surfaces = []
      world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, mergeable: "CONFLICTING" }, GITHUB.mine![1]!] }
      await clock.set(new Date(2026, 9, 7, 9, 0).getTime())
      const ran = await runPrs($, "")

      expect(lines(ran.text).slice(0, 5)).toEqual([
        expect.stringMatching(HEADING),
        "**Since You Last Looked** (yesterday 17:40)",
        "| Pull request | What changed |",
        "| --- | --- |",
        "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ⚠ merge conflicts |"
      ])
    }
  )

  test("only the alert kinds turned on are listed", { options: { alertCi: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 5).getTime())
    await runPrs($, "")
    world.github = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE", comments: { count: 1, lastAuthor: "ann" } }, GITHUB.mine![1]!]
    }

    const ran = await runPrs($, "")

    expect(lines(ran.text).slice(0, 6)).toEqual([
      expect.stringMatching(HEADING),
      "**Since You Last Looked** (09:05)",
      "| Pull request | What changed |",
      "| --- | --- |",
      "| [#1](https://github.com/acme/app/pull/1) Fix the menu | ✎ new comment from ann |",
      "**Your Pull Requests** (2)"
    ])
  })

  test("with change alerts off the list comes alone", { options: { notify: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, ...NOTHING_ATTACHED }
    machine($, on, world)
    await runPrs($, "")
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(MINUTE)

    const ran = await runPrs($, "")

    expect(lines(ran.text).slice(0, 2)).toEqual([expect.stringMatching(HEADING), "**Your Pull Requests** (2)"])
  })

  test("a setup problem comes as /prs output", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, isGhMissing: true, ...NOTHING_ATTACHED })

    const ran = await runPrs($, "")
    await clock.settle()

    expect(ran.text).toBe(GH_MISSING.message)
  })
})

// An SDK host that draws the session attaches its surface after the session starts, with no person at it.

describe("an app attached after the session starts", () => {
  test("checks start when it attaches, though the session is not interactive", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
    const seen = machine($, on, world)

    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    expect(seen.runs).toEqual([])

    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(1)

    await clock.advance(3 * MINUTE)
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(2)
  })

  test("/prs typed before the app attaches prints the list, and the pane opens when it attaches", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
    machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })

    const ran = await runPrs($, "")
    await clock.settle()
    expect(lines(ran.text)).toContain("**Your Pull Requests** (2)")
    expect(world.isPaneOpen).toBe(undefined)

    await clock.advance(9 * MINUTE)
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    expect(world.isPaneOpen).toBe(true)
  })

  test("the pane opens on the first attach alone, within ten minutes of the /prs", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
    machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    const attach = async (): Promise<void> => {
      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.settle()
    }

    await runPrs($, "")
    await clock.advance(11 * MINUTE)
    await attach()
    expect(world.isPaneOpen).toBe(undefined)

    world.surfaces = []
    await runPrs($, "")
    await attach()
    expect(world.isPaneOpen).toBe(true)
    // Closed in the app, it stays closed as the app attaches again.
    world.isPaneOpen = false
    await attach()
    expect(world.isPaneOpen).toBe(false)
  })

  for (const later of ["close", "demo"]) {
    test(`a /prs ${later} after it, before the app attaches, keeps the pane from opening then`, async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
      machine($, on, world)
      await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
      await runPrs($, "")
      await runPrs($, later)
      await clock.settle()

      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.settle()
      expect(world.isPaneOpen).toBe(undefined)
    })
  }

  test("a /prs the app showed as text, as it places no panes, opens nothing as it attaches again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false }
    machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await runPrs($, "")
    await clock.settle()
    world.isPaneOpen = false

    world.placesPanes = true
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    expect(world.isPaneOpen).toBe(false)
  })

  test("a reload between the /prs and the attach still opens the pane then", async ($, on) => {
    const clock = clockOf(on, { now: 30 * MINUTE })
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: [] }
    machine($, on, world)
    // The /prs a minute ago, as kept over the reload; the reload replays the start.
    keptOverReload(on, { paneAskedAt: 29 * MINUTE })
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    expect(world.isPaneOpen).toBe(true)
  })

  test("after a reload the checks go on, though the session is not interactive and attaches no more", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] })

    // A reload replays only the start, the app's surface already attached.
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.advance(3 * MINUTE)

    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(2)
  })

  test("with the app gone the checks stop, and come back when it attaches again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    world.surfaces = []
    await clock.advance(9 * MINUTE)
    const whileGone = graphql()
    await clock.advance(9 * MINUTE)
    expect(graphql()).toBe(whileGone)

    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.advance(3 * MINUTE)
    expect(graphql()).toBe(whileGone + 2)
  })

  test("coming back to the window, what changed while it was closed is told in one toast", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    world.surfaces = []
    await clock.advance(3 * MINUTE)
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(60 * MINUTE)
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()

    expect(seen.toasts).toHaveLength(1)
    expect(seen.toasts[0]).toMatch(/^Since .+, 1 pull request changed — see \/prs$/)
  })

  test(
    "while-open checks come back with the window, the pane still up",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], isPaneOpen: true }
      const seen = machine($, on, world)
      await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
      await clock.settle()
      const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

      world.surfaces = []
      await clock.advance(3 * MINUTE)
      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.settle()
      const back = graphql()
      await clock.advance(6 * MINUTE)

      expect(graphql()).toBe(back + 2)
    }
  )

  test(
    "while-open checks nothing when the window comes back with the pane closed",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], isPaneOpen: true }
      const seen = machine($, on, world)
      await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
      await clock.settle()
      const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

      world.surfaces = []
      await clock.advance(3 * MINUTE)
      const away = graphql()
      world.isPaneOpen = false
      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.advance(6 * MINUTE)

      expect(graphql()).toBe(away)
    }
  )

  test("/prs demo prints the example list where the app places no panes, its alerts shown", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      placesPanes: false
    })

    const ran = await runPrs($, "demo")

    expect(lines(ran.text)[0]).toBe(
      "This app places no panes, so /prs prints the list here, while the example alerts show:"
    )
    expect(lines(ran.text)).toContain("**Your Pull Requests** (14)")
    expect(seen.toasts).toEqual([DEMO_ALERTS[0]])
    // Nothing there could leave the examples, so the summary stays the person's own.
    expect(seen.statuses).toEqual([])
    await clock.advance(MINUTE)
  })

  test("what a load saw while nothing was drawn is still told when the window opens again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      answer: "This session"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const ui = await mountPane($, "desktop")
    await ui.press({ key: "review-7" })
    await ui.unmount()
    await clock.advance(MINUTE)

    // The window closes, and a turn of the skill ends meanwhile: its refresh loads with nothing drawn.
    world.surfaces = []
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, reason: "answer" } as never)
    await clock.settle()
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    // The checks never stopped, the window closed between two; the next tells it.
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toHaveLength(1)
    expect(seen.toasts[0]).toMatch(/^Since .+, 1 pull request changed — see \/prs$/)
  })

  test("coming back while GitHub can't be reached, the changes are still told as coming back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    world.surfaces = []
    await clock.advance(3 * MINUTE)
    world.github = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!],
      requested: [...GITHUB.requested!, { number: 8, title: "Activity cards", author: "bob" }]
    }
    world.graphqlFailure = { stdout: "", stderr: "error connecting to api.github.com" }
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    world.graphqlFailure = undefined
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.filter((toast) => !toast.startsWith("GitHub"))).toEqual([
      expect.stringMatching(/^Since .+, 2 pull requests changed — see \/prs$/)
    ])
  })

  test("checks a problem stopped come back once the window's return loads past it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], isGhMissing: true }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.advance(6 * MINUTE)
    const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    expect(graphql()).toBe(0)

    world.isGhMissing = false
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    expect(graphql()).toBe(1)

    await clock.advance(6 * MINUTE)
    expect(graphql()).toBe(3)
  })

  test("coming back with the pane a tab behind another, what changed is told in one toast", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      isPaneOpen: true,
      isPaneBehind: true
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    world.surfaces = []
    await clock.advance(3 * MINUTE)
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()

    expect(seen.toasts).toEqual([expect.stringMatching(/^Since .+, 1 pull request changed — see \/prs$/)])
  })

  test("coming back while GitHub can't be reached, with the pane open, no change is told in a toast", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], isPaneOpen: true }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    world.surfaces = []
    await clock.advance(3 * MINUTE)
    world.github = {
      ...GITHUB,
      mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!],
      requested: [...GITHUB.requested!, { number: 8, title: "Activity cards", author: "bob" }]
    }
    world.graphqlFailure = { stdout: "", stderr: "error connecting to api.github.com" }
    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    world.graphqlFailure = undefined
    // The next check comes back and would alert; the open pane marks the changes instead.
    await clock.advance(3 * MINUTE)

    expect(seen.toasts.filter((toast) => !toast.startsWith("GitHub"))).toEqual([])
  })

  test("/prs prints the list where the app places no panes", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false })

    const ran = await runPrs($, "")
    await clock.settle()

    // The first in a repository has no look to compare with.
    expect(lines(ran.text).slice(0, 4)).toEqual([
      expect.stringMatching(HEADING),
      "**Your Pull Requests** (2)",
      "| Pull request | Status | Details |",
      "| --- | --- | --- |"
    ])
  })

  test("where the pane can't be placed, /prs says the problem and when it is checked again", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      placesPanes: false,
      repoViewFailure: "dial tcp: i/o timeout"
    })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "")).text).toBe("Could not reach GitHub.\n\nChecking again every 3 minutes.")
  })

  test("the next /prs lists what the background checks told as alerts too, as a toast is no look", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
    const again = await runPrs($, "")
    await clock.settle()

    expect(lines(again.text)).toContain("| [#1](https://github.com/acme/app/pull/1) Fix the menu | ✗ CI failed |")
  })

  test("the away toast's /prs lists what it counted, where no pane shows", async ($, on) => {
    const clock = clockOf(on)
    const yesterday = new Date(2026, 9, 6, 17, 40).getTime()
    const earlier = snapshotOf(GITHUB, { at: yesterday })
    const world: World = {
      github: {
        ...GITHUB,
        mine: [{ ...GITHUB.mine![0]!, comments: { count: 1, lastAuthor: "ann" } }, GITHUB.mine![1]!]
      },
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      placesPanes: false,
      store: { "look:github.com/acme/app": earlier }
    }
    const seen = machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 0).getTime())
    await startSession($)
    await clock.settle()
    expect(seen.toasts).toEqual(["Since yesterday 17:40, 1 pull request changed — see /prs"])

    const ran = await runPrs($, "")
    await clock.settle()

    expect(lines(ran.text)[1]).toBe("**Since You Last Looked** (yesterday 17:40)")
    expect(lines(ran.text).some((line) => line.includes("✎ new comment from ann"))).toBe(true)
  })

  test("what /prs's own check finds there leads the list, between two background checks", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")

    // CI fails between two background checks, and /prs runs before the next one.
    await clock.advance(MINUTE)
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    const ran = await runPrs($, "")
    await clock.settle()

    expect(lines(ran.text)).toContain("| [#1](https://github.com/acme/app/pull/1) Fix the menu | ✗ CI failed |")
    // Listed, it is told: neither this load nor the next check raises it again.
    await clock.advance(3 * MINUTE)
    expect(seen.toasts).toEqual([])
  })

  test(
    "with no checks between two /prs, the list leads with what changed, as where nothing is attached",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false }
      machine($, on, world)
      await clock.set(new Date(2026, 9, 7, 9, 5).getTime())
      await runPrs($, "")
      world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
      await clock.advance(MINUTE)

      const ran = await runPrs($, "")

      expect(lines(ran.text).slice(1, 2)).toEqual(["**Since You Last Looked** (09:05)"])
    }
  )

  test("a list printed where no pane shows is a look, background checks or not", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"], placesPanes: false }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    await runPrs($, "")
    await clock.settle()

    expect(world.store?.["look:github.com/acme/app"]).toMatchObject({ repo: "acme/app" })
  })

  test("alerts become notices in the conversation where the app draws no toasts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["mobile"] }
    const seen = machine($, on, world)

    await $.session.attach({ surface: "mobile", clientId: "mobile:default" })
    await clock.settle()
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.notices).toEqual(["✗ #1 Fix the menu — CI failed"])
    expect(seen.toasts).toEqual([])
  })

  test("VS Code draws alerts as toasts above its prompt box, not as notices that stay in the conversation", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["vscode"] }
    const seen = machine($, on, world)

    await $.session.attach({ surface: "vscode", clientId: "vscode:default" })
    await clock.settle()
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
    expect(seen.notices).toEqual([])
  })
})

describe("the last look", () => {
  const KEY = "look:github.com/acme/app"

  test("is what the pane showed, not what a background check found", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world)
    await startSession($)
    await clock.advance(6 * MINUTE)
    expect(world.store?.[KEY]).toBe(undefined)

    await runPrs($, "")
    await clock.settle()
    expect(world.store?.[KEY]).toMatchObject({ repo: "acme/app" })
  })

  test("is not taken while the pane is a tab behind another", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isPaneOpen: true, isPaneBehind: true }
    machine($, on, world)
    await startSession($)
    await clock.advance(3 * MINUTE)
    expect(world.store?.[KEY]).toBe(undefined)

    world.isPaneBehind = false
    await clock.advance(3 * MINUTE)
    expect(world.store?.[KEY]).toMatchObject({ repo: "acme/app" })
  })

  test("keeps the latest twenty repositories", async ($, on) => {
    const clock = clockOf(on)
    const older = Array.from({ length: 20 }, (_, index) => `look:github.com/acme/repo-${index}`)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: { ...Object.fromEntries(older.map((key) => [key, {}])), looks: older }
    }
    machine($, on, world)
    await startSession($)
    await runPrs($, "")
    await clock.settle()

    expect(world.store?.["looks"]).toEqual([...older.slice(1), KEY])
    expect(world.store?.[older[0]!]).toBe(undefined)
    expect(world.store?.[older[1]!]).toEqual({})
  })
})

describe("sessions in the same repository", () => {
  const KEY = `shared:github.com/acme/app:me:${QUERY_VERSION}`
  const CLAIM = `claim:github.com/acme/app:me:${QUERY_VERSION}`
  const FAILING = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
  const listQueries = (runs: string[]) =>
    runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine"))

  test("a session shares what it read, and takes another's newer list between ticks, asking nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    expect(world.store?.[KEY]).toMatchObject({ by: "this-session", viewer: "me", query: QUERY_VERSION })

    await clock.advance(2 * MINUTE)
    world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now(), FAILING) }
    await clock.advance(MINUTE + 10_000)

    expect(listQueries(seen.runs)).toHaveLength(1)
    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })

  test("a session that took another's answer asks GitHub itself once that session's next is overdue", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    await clock.advance(20_000)
    // Another session's answer, from a Refresh, say; that session then closes.
    world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now(), FAILING) }

    await clock.advance(3 * MINUTE)
    expect(listQueries(seen.runs)).toHaveLength(1)
    await clock.advance(30_000)
    expect(listQueries(seen.runs)).toHaveLength(2)
  })

  test("a window opened again looks at once, and asks GitHub for an answer that came due while it was closed", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    // Another session asks at 25 s, and this one takes its answer; its tick at 180 s leaves GitHub to that session,
    // which closes before its next request. This window closes just after the tick.
    await clock.advance(25_000)
    world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now(), FAILING) }
    await clock.advance(156_000)
    world.surfaces = []
    await clock.advance(119_000)
    expect(listQueries(seen.runs)).toHaveLength(1)

    world.surfaces = ["desktop"]
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()

    expect(listQueries(seen.runs)).toHaveLength(2)
  })

  test(
    "with sharing off, a window opened again takes no answer another session shared",
    { options: { shareRefresh: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["desktop"] }
      const seen = machine($, on, world)
      await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
      await clock.settle()
      world.surfaces = []
      await clock.advance(30_000)
      // A session of a build that shares, with a newer list.
      world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now(), FAILING) }

      world.surfaces = ["desktop"]
      await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
      await clock.settle()

      expect(seen.toasts).toEqual([])
    }
  )

  test("Refresh asks GitHub even with a newer list shared, and shares what it read", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await clock.advance(30_000)
    world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now() - 5_000, FAILING) }

    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(listQueries(seen.runs)).toHaveLength(2)
    expect(world.store?.[KEY]).toMatchObject({ by: "this-session" })
  })

  test("an answer to an earlier request never replaces a later one's; the store keeps the latest answers that fit", async ($, on) => {
    const clock = clockOf(on, { now: 60 * MINUTE })
    // Five other repositories' answers, each nearly as large as one shared gets, read 40 to 8 minutes ago, each with a
    // lapsed claim: four fit beside this session's.
    const large = { mine: [{ number: 9, title: "x".repeat(140_000) }] }
    const others = ["a", "b", "c", "d", "e"].map((name, index) => ({
      id: `github.com/acme/${name}:me:${QUERY_VERSION}`,
      at: (20 + 8 * index) * MINUTE
    }))
    const claim = (at: number) => ({ by: "another-session", at, asked: at, viewer: "me", query: QUERY_VERSION })
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: Object.fromEntries(
        others.flatMap(({ id, at }) => [
          [`shared:${id}`, sharedAnswer("another-session", at, large)],
          [`claim:${id}`, claim(at)]
        ])
      )
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const kept = (prefix: string) =>
      Object.keys(world.store ?? {})
        .filter((key) => key.startsWith(prefix))
        .sort()
    expect(kept("shared:")).toEqual([KEY, ...others.slice(1).map(({ id }) => `shared:${id}`)].sort())
    // This session's own claim, its answer kept, stays with it.
    expect(kept("claim:")).toEqual([CLAIM, ...others.slice(1).map(({ id }) => `claim:${id}`)].sort())

    // Another session's answer to a request that went out before the Refresh's gives way, though it came after it.
    const ui = await mountPane($, "terminal")
    const crossed = {
      ...sharedAnswer("another-session", clock.now() - 10_000, FAILING),
      fetchedAt: clock.now() + 1_000
    }
    world.store = { ...world.store, [KEY]: crossed }
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(world.store?.[KEY]).toMatchObject({ by: "this-session" })

    // One to a request that went out with the Refresh's stays.
    const asLate = sharedAnswer("another-session", clock.now(), FAILING)
    world.store = { ...world.store, [KEY]: asLate }
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(world.store?.[KEY]).toEqual(asLate)
  })

  test("a tick waits for another session's claim, and asks itself once the claim lapses unanswered", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    await clock.advance(3 * MINUTE - 5_000)
    world.store = { ...world.store, [CLAIM]: fetchClaim("another-session", clock.now()) }

    await clock.advance(10_000)
    expect(listQueries(seen.runs)).toHaveLength(1)

    await clock.advance(MINUTE)
    expect(listQueries(seen.runs)).toHaveLength(2)
    expect(world.store?.[CLAIM]).toMatchObject({ by: "this-session", viewer: "me", query: QUERY_VERSION })
  })

  test("with the store failing, a session refreshes on its own, and only the debug log says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, isStoreBroken: true }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    await clock.advance(6 * MINUTE)

    expect(listQueries(seen.runs)).toHaveLength(3)
    for (const line of [
      "The list shared for acme/app could not be read",
      "The claim on acme/app's refresh could not be read",
      "The list of acme/app could not be shared"
    ]) {
      expect(seen.debug.some((debug) => debug.startsWith(line))).toBe(true)
    }
  })

  test("a store too full for an answer to share gives up those already shared, and keeps it", async ($, on) => {
    const clock = clockOf(on)
    const padding = { mine: [{ number: 9, title: "x".repeat(6_000) }] }
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: { [`shared:github.com/acme/other:me:${QUERY_VERSION}`]: sharedAnswer("another-session", 0, padding) }
    }
    world.storeLimit = JSON.stringify(world.store).length + 500
    machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(Object.keys(world.store ?? {}).filter((key) => key.startsWith("shared:"))).toEqual([KEY])
    expect(world.store?.[KEY]).toMatchObject({ by: "this-session" })
  })

  test("a session whose answer the store refuses stops claiming its requests, as no answer would come", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      storeSetDeny: "the disk is full",
      storeDenyPrefix: "shared:"
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const claimed = world.store?.[CLAIM]

    await clock.advance(3 * MINUTE)

    expect(world.store?.[KEY]).toBeUndefined()
    expect(world.store?.[CLAIM]).toEqual(claimed)
  })

  test("a session whose answer the store holds a later one over still claims its requests", async ($, on) => {
    const clock = clockOf(on)
    // Another session asked a moment after this one, and shared first.
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: { [KEY]: sharedAnswer("another-session", clock.now() + 1_000) }
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    expect(world.store?.[KEY]).toMatchObject({ by: "another-session" })
    const claimed = world.store?.[CLAIM]

    await clock.advance(3 * MINUTE)

    expect(world.store?.[CLAIM]).toMatchObject({ by: "this-session" })
    expect(world.store?.[CLAIM]).not.toEqual(claimed)
  })

  test("a claim the store refuses as full frees nothing: the answers shared stay", async ($, on) => {
    const clock = clockOf(on)
    const other = `shared:github.com/acme/other:me:${QUERY_VERSION}`
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      store: { [other]: sharedAnswer("another-session", 0) },
      storeSetDeny: "the store would be 4200000 characters, over the 4194304 limit",
      storeDenyPrefix: "claim:"
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    await clock.advance(3 * MINUTE)

    expect(world.store?.[other]).toMatchObject({ by: "another-session" })
    expect(world.store?.[KEY]).toMatchObject({ by: "this-session" })
    expect(world.store?.[CLAIM]).toBeUndefined()
  })

  test("a store too full for the alerts shown gives up the answers sessions share first", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const other = `shared:github.com/acme/other:me:${QUERY_VERSION}`
    const padding = { mine: [{ number: 9, title: "x".repeat(6_000) }] }
    world.store = { ...world.store, [other]: sharedAnswer("another-session", 0, padding) }
    world.storeLimit = JSON.stringify(world.store).length + 50
    world.github = FAILING

    // No pane shows, so no last look is kept to make room first.
    await clock.advance(3 * MINUTE)

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
    expect(JSON.stringify(world.store?.["shown"])).toContain("CI failed")
    expect(world.store?.[other]).toBeUndefined()
  })

  test("a store too full for the last look gives up the answers sessions share first", async ($, on) => {
    const clock = clockOf(on)
    const padding = { mine: [{ number: 9, title: "x".repeat(6_000) }] }
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: [],
      store: { [`shared:github.com/acme/other:me:${QUERY_VERSION}`]: sharedAnswer("another-session", 0, padding) }
    }
    world.storeLimit = JSON.stringify(world.store).length + 4_000
    machine($, on, world)
    await startSession($)
    await clock.settle()

    await runPrs($, "")

    expect(world.store?.["look:github.com/acme/app"]).toMatchObject({ repo: "acme/app" })
    expect(Object.keys(world.store ?? {}).filter((key) => key.startsWith("shared:"))).toEqual([])
  })

  test(
    "with sharing off, each session asks GitHub itself and shares nothing",
    { options: { shareRefresh: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
      const seen = machine($, on, world)
      await startSession($)
      await clock.settle()
      world.store = { ...world.store, [KEY]: sharedAnswer("another-session", clock.now(), FAILING) }

      await clock.advance(3 * MINUTE)

      expect(listQueries(seen.runs)).toHaveLength(2)
      expect(world.store?.[KEY]).toMatchObject({ by: "another-session" })
      expect(Object.keys(world.store ?? {}).filter((key) => key.startsWith("claim:"))).toEqual([])
    }
  )

  test(
    "with sharing off, the answers and claims shared before go as a session starts",
    { options: { shareRefresh: false } },
    async ($, on) => {
      const clock = clockOf(on)
      const other = "github.com/acme/other"
      const world: World = {
        github: GITHUB,
        branch: "main",
        uncommitted: 0,
        store: {
          [`shared:${other}:me:${QUERY_VERSION}`]: sharedAnswer("another-session", 0),
          [`claim:${other}:me:${QUERY_VERSION}`]: fetchClaim("another-session", 0),
          [`look:${other}`]: { repo: "acme/other" }
        }
      }
      machine($, on, world)
      await startSession($)
      await clock.settle()

      expect(Object.keys(world.store ?? {}).filter((key) => /^(shared|claim):/.test(key))).toEqual([])
      expect(world.store?.[`look:${other}`]).toEqual({ repo: "acme/other" })
    }
  )
})

// The engine's end step and the settings hooks of a start, beneath the plugin (answering as `started` does), and what a
// /clear or a resume does to the session's state: from `empty()` on, the list and the loading mark read as never written,
// until written again.
function endsLikeClear(
  on: On,
  started: () => Promise<object> = async () => ({})
): { empty: () => void; starts: string[] } {
  on("session.end", async (_, e) => ({ sessionId: e.sessionId }))
  const starts: string[] = []
  on("classic.SessionStart", async (_, e) => {
    starts.push(e.source)

    return started()
  })
  let isEmptied = false
  const written = new Set<string>()
  const read = <T extends object>(key: string, held: T): T =>
    isEmptied && !written.has(key) && "value" in held
      ? ({ value: { ...(held.value as object), value: undefined } } as never)
      : held
  const write = (key: string): void => {
    if (isEmptied) {
      written.add(key)
    }
  }
  on("state.get", { plugin: PLUGIN, key: "snapshot" }, async (_, e, next) => read("snapshot", await next(e)))
  on("state.get", { plugin: PLUGIN, key: "module" }, async (_, e, next) => read("module", await next(e)))
  on("state.set", { plugin: PLUGIN, key: "snapshot" }, async (_, e, next) => (write("snapshot"), next(e)))
  on("state.set", { plugin: PLUGIN, key: "module" }, async (_, e, next) => (write("module"), next(e)))

  return { empty: () => void (isEmptied = true), starts }
}

function listLoads(seen: { runs: string[] }): number {
  return seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
}

describe("/prs over Remote Control", () => {
  // A message from the phone comes once the session's start has settled.
  test("from a phone, where no pane draws, prints the list, and opens the pane on the computer too", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["terminal"] }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ran = await runPrs($, "", { kind: "bridge" })
    await clock.settle()

    expect(lines(ran.text)).toContain("**Your Pull Requests** (2)")
    expect(world.isPaneOpen).toBe(true)
  })

  // The pane opens once the list is printed, on that list: its own load would take the look the list leads with.
  test("the list from a phone leads with what changed since the last look, from one request", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: {
        ...GITHUB,
        mine: [{ ...GITHUB.mine![0]!, comments: { count: 1, lastAuthor: "ann" } }, GITHUB.mine![1]!]
      },
      branch: "main",
      uncommitted: 0,
      surfaces: ["terminal"],
      store: { "look:github.com/acme/app": snapshotOf(GITHUB, { at: new Date(2026, 9, 6, 17, 40).getTime() }) }
    }
    const seen = machine($, on, world)
    await clock.set(new Date(2026, 9, 7, 9, 0).getTime())
    await startSession($)
    await clock.settle()
    const loads = seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    const ran = await runPrs($, "", { kind: "bridge" })
    await clock.settle()

    expect(lines(ran.text)[1]).toBe("**Since You Last Looked** (yesterday 17:40)")
    expect(lines(ran.text).some((line) => line.includes("✎ new comment from ann"))).toBe(true)
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql"))).toHaveLength(loads + 1)
    expect(world.isPaneOpen).toBe(true)
  })

  test("from a phone that draws the pane, opens it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["terminal", "mobile"] }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ran = await runPrs($, "", { kind: "bridge" })
    await clock.settle()

    expect(ran.text).toBe("Opened the pull requests pane.")
    expect(world.isPaneOpen).toBe(true)
  })

  test("typed at the computer, opens the pane alone", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, surfaces: ["terminal"] }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    const ran = await runPrs($, "", { kind: "composer" })
    await clock.settle()

    expect(ran.text).toBe("Opened the pull requests pane.")
    expect(world.isPaneOpen).toBe(true)
  })
})
