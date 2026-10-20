// Author: David Matura

import type { PluginOptions, ProcessRunResult } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import type { Activity, CheckoutAt, MergedPull, PullsSnapshot } from "../types"
import { ALERT_KINDS, changesBetween } from "./alerts"
import type { ClosedState } from "./ended"
import { GH_MISSING } from "./gh"
import {
  checkShared,
  ensurePolling,
  lookBack,
  refresh,
  refreshAfterWrite,
  retry,
  retryMinutes,
  takeKind
} from "./refresh"
import { listAfter } from "./carry"
import type { RefreshHost } from "./refresh"
import { createSession } from "./session"
import type { Session } from "./session"
import { readSettings } from "./settings"
import { audienceId, QUERY_VERSION, storedClaim, storedShared } from "./shared"
import { claimKey, sharedKey } from "./store"
import type { SharedAnswer } from "./shared"
import { statusSummary } from "./summary"
import { fetchClaim, response, sharedAnswer, snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import { wordsOf } from "./testing/git-host"
import { promisesRun } from "./testing/promises"

// How GitHub said a pull request ended, by ann, at commit `head`.
function closedState(number: number, state: ClosedState["state"], head: string | null = null): ClosedState {
  return { number, state, by: "ann", head, branch: null, isCrossRepository: false, headRepo: null }
}

// GitHub's answer to the lookup of how those pull requests ended, as the host's `closed` option takes it.
function closedAnswer(...states: ClosedState[]): unknown {
  const pull = ({ number, state, by, head }: ClosedState) => ({
    number,
    state,
    headRefOid: head,
    mergedBy: state === "MERGED" ? { login: by } : null,
    timelineItems: { nodes: state === "CLOSED" ? [{ actor: { login: by } }] : [] }
  })

  return { data: { repository: Object.fromEntries(states.map((state) => [`p${state.number}`, pull(state)])) } }
}

const open = (...heads: string[]): ResponseFixture => ({
  mine: heads.map((head, index) => ({ number: index + 1, headRefName: head, headRefOid: `at-${head}` }))
})

describe("the list a load shows", () => {
  test("ended heads carry from the list as it stands, which a base kept from before loads nothing drew lacks", () => {
    // Away since before the branch had a pull request; loads nothing drew saw it open, then merged.
    const away = snapshotOf(open())
    const sawOpen = listAfter(away, away, snapshotOf(open("fix/menu")), null)
    const sawMerged = listAfter(sawOpen, away, snapshotOf(open()), [closedState(1, "MERGED", "final-push")])
    expect(sawMerged.endedHeads).toEqual([{ branch: "fix/menu", oid: "final-push" }])

    expect(listAfter(sawMerged, away, snapshotOf(open()), null).endedHeads).toEqual([
      { branch: "fix/menu", oid: "final-push" }
    ])
  })

  test("a session's first load carries them from the last look", () => {
    const look = listAfter(null, null, snapshotOf(open("fix/menu")), null)

    expect(listAfter(null, look, snapshotOf(open()), null).endedHeads).toEqual([
      { branch: "fix/menu", oid: "at-fix/menu" }
    ])
  })

  test("what was known of each, as ready before GitHub rechecks it, comes from the list it is compared with", () => {
    // Ready when last told; loads nothing drew saw its CI fail; GitHub rechecks it now.
    const fixture = { number: 1, title: "Legend", reviewDecision: "APPROVED" as const }
    const told = snapshotOf({ mine: [{ ...fixture, ci: "SUCCESS" }] })
    const sawFailing = snapshotOf({ mine: [{ ...fixture, ci: "FAILURE" }] })
    const checking = snapshotOf({ mine: [{ ...fixture, ci: "SUCCESS", mergeStateStatus: "UNKNOWN" }] })

    expect(listAfter(sawFailing, told, checking, null).mine[0]?.signals.wasReady).toBe(true)
  })

  test("so do the pull requests closed while loads nothing drew ran, those the person was told of: one reopened is no news", () => {
    // Told of #5; #6 came while nothing was drawn; both closed then.
    const away = snapshotOf({ requested: [{ number: 5, author: "ann" }] })
    const both = {
      requested: [
        { number: 5, author: "ann" },
        { number: 6, author: "bob" }
      ]
    }
    const sawSix = listAfter(away, away, snapshotOf(both), null)
    const sawClosed = listAfter(sawSix, away, snapshotOf({}), [closedState(5, "CLOSED"), closedState(6, "CLOSED")])
    const drawn = listAfter(sawClosed, away, snapshotOf({}), null)
    const back = listAfter(drawn, drawn, snapshotOf(both), null)

    expect(drawn.endedPulls).toEqual([
      { number: 5, isMentioned: false, isRequested: true, hasCommitsSinceMyReview: false, at: 0 }
    ])
    // Reopened, #6 asks for a review the person was never told of.
    expect(changesBetween(drawn, back, ALERT_KINDS).map((change) => [change.number, change.event])).toEqual([
      [6, "review requested"]
    ])
    expect(back.endedPulls).toEqual([])
  })
})

describe("how a load came about", () => {
  test("a load over a list kept across a reload is no return: the module starts with no window coming back", () => {
    const { checks } = createSession(readSettings({}))

    expect(takeKind(checks, snapshotOf(open()), false).isReturning).toBe(false)
  })

  test("a session's first load, and the first after loads nothing drew, is a return; the flags are taken", () => {
    const { checks } = createSession(readSettings({}))
    expect(takeKind(checks, null, false)).toEqual({ isReturning: true, isAlerting: false, isListShown: false })

    const list = snapshotOf(open())
    checks.awayBase = list
    checks.isAlertWanted = true
    expect(takeKind(checks, list, true)).toEqual({ isReturning: true, isAlerting: true, isListShown: true })
    expect(takeKind(checks, list, true)).toEqual({ isReturning: false, isAlerting: false, isListShown: true })
    expect(checks.awayBase).toBeNull()

    checks.isReturning = true
    expect(takeKind(checks, list, false).isReturning).toBe(true)
    expect(checks.isReturning).toBe(false)
  })
})

function ran(stdout: string): ProcessRunResult {
  return { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
}

// A host answering gh and git as a repository on github.com would, with `list` as GitHub's lists and `closed` as its
// answer about how pull requests ended, and the session's state and screen as plain values; `calls` keeps what the
// load asked of it, in order, `runs` each command whole, with the time each was given, and `work` what it set off.
// Once held, the next request for the lists waits until released, and `isReached` says it got there.
function hostWith(
  options: {
    list?: ResponseFixture
    closed?: unknown
    isDrawn?: boolean
    isPaneOpen?: boolean
    isDemo?: boolean
    isGhMissing?: boolean
    // The lookup of how pull requests ended rejecting, or refused with no answer; and called as it goes out.
    isClosedLookupFailing?: boolean
    isClosedLookupRefused?: boolean
    atClosedLookup?: () => void
    // Every one-shot wait running out as it is set, before what it waits for settles; and the lookup of how pull
    // requests ended waiting there before it answers.
    isWaitOver?: boolean
    closedGate?: Promise<void>
    // The checkout the list is shown with in place of the one the load read, as a press read it since.
    keptCheckout?: CheckoutAt
    // The store refusing every answer shared; or what each share comes to, in turn.
    isShareRefused?: boolean
    shareResults?: Promise<boolean>[]
    // Called as each request for the lists goes out; and a claim the store keeps only once this settles.
    atListRequest?: () => void
    claimGate?: Promise<void>
    // GitHub's answer to the lists as it comes, in place of `list`'s; and how long, by the clock, the request takes.
    listAnswer?: string
    // gh's error line where the request for the lists fails.
    listRefusal?: string
    fetchMs?: number
    // How many reads of the rows shown merged fail, each read after the gate; and the write that says a load is under
    // way failing.
    mergedFailures?: number
    isMarkingFailing?: boolean
    // Once set, the write that says a load is over waits there, telling `atMarkedOff` it arrived.
    markedOffGate?: Promise<void>
    atMarkedOff?: () => void
    // Called as the last look is kept, the load's last call before it takes its kind.
    atRemember?: () => void
    // The list failing to show; or shown by none, as by a load of the module a reload replaced.
    isShowListFailing?: boolean
    isReplaced?: boolean
    // Once set, every load waits there, before it shows the list (the read of the rows shown merged), telling `atGate`
    // it arrived.
    gate?: Promise<void>
    atGate?: () => void
    // Once set, every read of the shared answer, once read, waits there before it answers, telling `atSharedGate`.
    sharedGate?: Promise<void>
    atSharedGate?: () => void
  } = {}
) {
  const calls: string[] = []
  const state = {
    list: null as PullsSnapshot | null,
    recalled: null as PullsSnapshot | null,
    problem: null as string | null,
    activity: [] as Activity[],
    notes: [] as { text: string; timeoutMs: number }[],
    toasts: [] as string[],
    // The toasts the refresh said were pull request changes, which a system notification may carry.
    changes: [] as string[],
    logs: [] as string[],
    status: undefined as string | undefined,
    timers: [] as { ms: number; tick: () => void; isCancelled: boolean }[],
    waits: [] as { ms: number; isCancelled: boolean }[],
    runs: [] as (readonly string[])[],
    timeouts: [] as (number | undefined)[],
    work: [] as Promise<unknown>[],
    // The rows shown merged, what the lookup Create PR waits on was asked about, and what each cleanup was handed.
    merged: [] as MergedPull[],
    branchLookups: [] as [string | null, string | null][],
    cleanUps: [] as number[][],
    // The store the sessions share, and the clock.
    store: {} as Record<string, unknown>,
    now: 60_000
  }
  let release = (): void => undefined
  let reached = (): void => undefined
  const isReached = new Promise<void>((resolve) => (reached = resolve))
  let isHeld = false
  const host: RefreshHost = {
    run: async (given, init) => {
      const argv = wordsOf(given)
      calls.push(argv.slice(0, 3).join(" "))
      state.runs.push(argv)
      state.timeouts.push(init?.timeoutMs)
      if (argv.some((arg) => arg.startsWith("mine="))) {
        options.atListRequest?.()
      }
      if (options.isGhMissing && argv[0] === "gh") {
        throw new Error("spawn gh ENOENT")
      }
      if (argv[0] === "git") {
        return ran("main-head\nrefs/heads/main\n")
      }
      if (argv[1] === "repo") {
        return ran("acme/app https://github.com/acme/app\n")
      }
      if (options.listRefusal && argv.some((arg) => arg.startsWith("mine="))) {
        return { ...ran(""), exitCode: 1, stderr: `${options.listRefusal}\n` }
      }
      if (argv.some((arg) => arg.includes("CLOSED_EVENT"))) {
        options.atClosedLookup?.()
        if (options.closedGate) {
          await options.closedGate
        }
        if (options.isClosedLookupFailing) {
          throw new Error("HTTP 502")
        }
        if (options.isClosedLookupRefused) {
          const refusal = '{"message":"API rate limit exceeded"}'

          return { ...ran(refusal), exitCode: 1, stderr: "gh: API rate limit exceeded (HTTP 403)\n" }
        }

        return ran(JSON.stringify(options.closed ?? { data: { repository: {} } }))
      }
      if (isHeld) {
        isHeld = false
        reached()
        await new Promise<void>((resolve) => (release = resolve))
      }
      state.now += options.fetchMs ?? 0

      return ran(options.listAnswer ?? response(options.list ?? open()))
    },
    read: async () => "",
    write: async () => undefined,
    exists: async () => false,
    isLink: async () => false,
    now: async () => state.now,
    every: (ms, tick) => {
      const timer = { ms, tick, isCancelled: false }
      state.timers.push(timer)

      return { cancel: () => void (timer.isCancelled = true) }
    },
    after: (ms, fire) => {
      const wait = { ms, isCancelled: false }
      state.waits.push(wait)
      if (options.isWaitOver) {
        fire()
      }

      return { cancel: () => void (wait.isCancelled = true) }
    },
    background: (work) => void state.work.push(work.catch(() => undefined)),
    log: (line) => void state.logs.push(line),
    storedList: async () => state.list,
    merged: async () => {
      if (options.gate) {
        options.atGate?.()
        await options.gate
      }
      if (options.mergedFailures) {
        options.mergedFailures--
        throw new Error("store unreadable")
      }

      return state.merged
    },
    showList: async (snapshot, checkout) => {
      calls.push("showList")
      if (options.isShowListFailing) {
        throw new Error("state unwritable")
      }
      if (options.isReplaced) {
        return null
      }
      state.list = snapshot
      state.problem = null

      return options.keptCheckout ?? checkout
    },
    writeProblem: async (message) => {
      state.problem = message
    },
    markLoading: async (isLoading) => {
      if (options.isMarkingFailing) {
        throw new Error("state unwritable")
      }
      if (!isLoading && options.markedOffGate) {
        options.atMarkedOff?.()
        await options.markedOffGate
      }
    },
    keepActivity: async (change) => {
      calls.push("keepActivity")
      state.activity = change(state.activity)
    },
    isDemo: async () => options.isDemo ?? false,
    recall: async () => {
      calls.push("recall")

      return state.recalled
    },
    remember: async () => {
      calls.push("remember")
      options.atRemember?.()
    },
    isDrawn: async () => options.isDrawn ?? true,
    isPaneOpen: async () => options.isPaneOpen ?? true,
    isPaneShown: async () => true,
    setStatus: async (text) => {
      state.status = text
    },
    clearStatus: async () => {
      state.status = undefined
    },
    notify: async (text, timeoutMs) => {
      state.notes.push({ text, timeoutMs })
    },
    announce: async (_, lines, areChanges) => {
      calls.push("announce")
      state.toasts.push(...lines)
      if (areChanges) {
        state.changes.push(...lines)
      }
    },
    lookUpBranch: async (_, branch, head) => {
      state.branchLookups.push([branch, head])
    },
    cleanUp: async (_, known) => {
      state.cleanUps.push(known.map((each) => each.number))
    },
    recallShared: async (repo, viewer) => {
      const shared = storedShared(state.store[sharedKey(audienceId(repo, viewer))])
      if (options.sharedGate) {
        options.atSharedGate?.()
        await options.sharedGate
      }

      return shared
    },
    shareAnswer: async (repo, shared) => {
      calls.push("share")
      const result = options.shareResults?.shift()
      if (result) {
        return result
      }
      if (options.isShareRefused) {
        return false
      }
      state.store[sharedKey(audienceId(repo, shared.viewer))] = shared

      return true
    },
    recallClaim: async (repo, viewer) => storedClaim(state.store[claimKey(audienceId(repo, viewer))]),
    claimFetch: async (repo, claim) => {
      calls.push("claim")
      if (options.claimGate) {
        await options.claimGate
      }
      state.store[claimKey(audienceId(repo, claim.viewer))] = claim
    }
  }

  return { host, calls, state, hold: () => (isHeld = true), isReached, release: () => release() }
}

// Where the store keeps the answer and the claim for this repository and person.
const ME = audienceId({ name: "acme/app", host: "github.com" }, "me")

// Another session's answer, by default with a pull request this session's list doesn't have.
function sharedBy(by: string, requestedAt: number, list: ResponseFixture = open("feature/shared")): SharedAnswer {
  return sharedAnswer(by, requestedAt, list)
}

type HostOptions = NonNullable<Parameters<typeof hostWith>[0]>

// Holds every load at the gate (the read of the rows shown merged) until opened; `isAtGate` says one got there.
function gateLoads(options: HostOptions): { isAtGate: Promise<void>; open: () => void } {
  let open = (): void => undefined
  options.gate = new Promise<void>((resolve) => (open = resolve))
  const isAtGate = new Promise<void>((resolve) => (options.atGate = resolve))

  return { isAtGate, open: () => open() }
}

// Holds every read of the shared answer, once read, until opened.
function gateSharedReads(options: HostOptions): { isAtGate: Promise<void>; open: () => void } {
  let open = (): void => undefined
  options.sharedGate = new Promise<void>((resolve) => (open = resolve))
  const isAtGate = new Promise<void>((resolve) => (options.atSharedGate = resolve))

  return { isAtGate, open: () => open() }
}

function sessionOf(options: PluginOptions = {}): Session {
  return createSession(readSettings({ cleanupWorktrees: false, ...options }))
}

describe("a load", () => {
  test("compares a session's first list with the last look, and reads the checkout before it writes", async () => {
    const { host, calls, state } = hostWith()
    state.recalled = snapshotOf(open("fix/menu"))

    await refresh(host, sessionOf(), false)

    // The second request asks how the pull request that left the list ended, before the list shows.
    expect(calls).toEqual([
      "gh repo view",
      "gh api graphql",
      "claim",
      "recall",
      "gh api graphql",
      "git rev-parse HEAD",
      "showList",
      "keepActivity",
      "remember",
      "share"
    ])
    expect(state.list?.endedHeads).toEqual([{ branch: "fix/menu", oid: "at-fix/menu" }])
  })

  test("a load of the module a reload replaced shows no list, and tells, keeps and cleans up nothing", async () => {
    const { host, calls, state } = hostWith({ isReplaced: true })

    await refresh(host, sessionOf(), false)
    await Promise.all(state.work)

    expect(calls).toContain("showList")
    expect(state.list).toBeNull()
    expect(calls.filter((call) => call === "keepActivity" || call === "remember")).toEqual([])
    expect(state.status).toBeUndefined()
    expect(state.cleanUps).toEqual([])
  })

  test("compares a later one with the list before it, and asks the store nothing", async () => {
    const { host, calls } = hostWith()
    const session = sessionOf()
    await refresh(host, session, false)
    calls.length = 0

    await refresh(host, session, false)

    expect(calls).not.toContain("recall")
    expect(calls).not.toContain("gh repo view")
  })

  test("nothing drew keeps the list before it for the next drawn load, and tells nothing", async () => {
    const { host, calls, state } = hostWith({ isDrawn: false })
    const session = sessionOf()
    state.recalled = snapshotOf(open("fix/menu"))

    await refresh(host, session, true)

    expect(calls).not.toContain("keepActivity")
    expect(calls).not.toContain("announce")
    expect(session.checks.awayBase).toBe(state.recalled)
    expect(session.checks.isAlertWanted).toBe(false)
  })

  test("asked again while one runs, shares it", async () => {
    const { host, calls, hold, isReached, release } = hostWith()
    const session = sessionOf()
    hold()

    const first = refresh(host, session, false)
    await isReached
    const second = refresh(host, session, true)
    expect(second).toBe(first)
    release()
    await Promise.all([first, second])

    expect(calls.filter((call) => call === "gh api graphql")).toHaveLength(1)
  })

  // The timer's refreshes come k promise turns after the last call before the person's load takes its kind, as where
  // the engine answers two calls at once, up to after the load is over.
  test("a timer's refresh that joins the person's load after it took its kind still gets its toasts, once", async () => {
    const outcomes: [number, string[], boolean][] = []
    const expected: typeof outcomes = []
    for (let k = 0; k <= 8; k++) {
      const options: HostOptions = { list: { mine: [{ number: 1, title: "Legend", ci: "SUCCESS" }] } }
      const { host, state } = hostWith(options)
      const session = sessionOf()
      await refresh(host, session, false)
      options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }] }
      let joins: Promise<void>[] = []
      options.atRemember = () => {
        options.atRemember = undefined
        void (async () => {
          for (let turn = 0; turn < k + 2; turn++) {
            await null
          }
          joins = [refresh(host, session, true), refresh(host, session, true)]
        })()
      }

      const press = refresh(host, session, false)
      await press
      await promisesRun()
      await Promise.all([...joins, ...state.work])

      // One that comes once the load is over runs its own, which finds nothing new.
      const isJoined = joins[0] === press
      outcomes.push([k, state.toasts, session.checks.isAlertWanted])
      expected.push([k, isJoined ? ["✗ #1 Legend — CI failed"] : [], false])
    }

    expect(outcomes).toEqual(expected)
    expect(expected.some(([, toasts]) => toasts.length > 0)).toBe(true)
  })

  test("a timer's refresh that joins a load as it writes that it is over gets its toasts, and leaves the next none", async () => {
    const options: HostOptions = { list: { mine: [{ number: 1, title: "Legend", ci: "SUCCESS" }] } }
    const { host, state } = hostWith(options)
    const session = sessionOf()
    await refresh(host, session, false)
    options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }] }
    let open = (): void => undefined
    options.markedOffGate = new Promise<void>((resolve) => (open = resolve))
    const isMarkedOff = new Promise<void>((resolve) => (options.atMarkedOff = resolve))

    const press = refresh(host, session, false)
    await isMarkedOff
    options.markedOffGate = undefined
    const tick = refresh(host, session, true)
    open()
    await Promise.all([press, tick, ...state.work])
    options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }], requested: [{ number: 8, author: "bob" }] }
    await refresh(host, session, false)

    expect(state.toasts).toEqual(["✗ #1 Legend — CI failed"])
    expect(state.changes).toEqual(["✗ #1 Legend — CI failed"])
  })

  // A load that alerted, or came back to the list, told what it found its own way, so one that joins it late has
  // nothing more to toast.
  test("a timer's refresh that joins an alerting or returning load as it writes that it is over toasts nothing more", async () => {
    const outcomes: string[][] = []
    for (const kind of ["alerting", "returning"]) {
      const options: HostOptions = { list: { mine: [{ number: 1, title: "Legend", ci: "SUCCESS" }] } }
      const { host, state } = hostWith(options)
      const session = sessionOf()
      await refresh(host, session, false)
      options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }] }
      session.checks.isReturning = kind === "returning"
      let open = (): void => undefined
      options.markedOffGate = new Promise<void>((resolve) => (open = resolve))
      const isMarkedOff = new Promise<void>((resolve) => (options.atMarkedOff = resolve))

      const load = refresh(host, session, kind === "alerting")
      await isMarkedOff
      options.markedOffGate = undefined
      const late = refresh(host, session, true)
      open()
      await Promise.all([load, late, ...state.work])
      outcomes.push(state.toasts)
    }

    expect(outcomes).toEqual([["✗ #1 Legend — CI failed"], []])
  })

  test("a load that fails gives a timer's refresh that joined it none of the toasts an earlier load held back", async () => {
    const options: HostOptions = { list: { mine: [{ number: 1, title: "Legend", ci: "SUCCESS" }] } }
    const { host, state } = hostWith(options)
    const session = sessionOf()
    await refresh(host, session, false)
    options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }] }
    await refresh(host, session, false)
    options.isShowListFailing = true

    const press = refresh(host, session, false)
    const tick = refresh(host, session, true)
    await Promise.allSettled([press, tick])
    await Promise.all(state.work)

    expect(state.toasts).toEqual([])
  })

  test("a problem that holds for the session stops the checks, and a setup one is told once", async () => {
    const { host, state } = hostWith({ isGhMissing: true })
    const session = sessionOf()
    let cancelled = 0
    session.checks.timer = { cancel: () => void cancelled++ } as NonNullable<Session["checks"]["timer"]>

    await refresh(host, session, false)
    await refresh(host, session, false)

    expect(session.checks.isStopped).toBe(true)
    expect(session.checks.timer).toBeNull()
    expect(cancelled).toBe(1)
    expect(state.problem).toBe(GH_MISSING.message)
    expect(state.notes).toEqual([{ text: GH_MISSING.message, timeoutMs: 12_000 }])
  })

  test("a problem takes the summary off the status line, unless the demo holds it", async () => {
    const shown = hostWith({ isGhMissing: true })
    shown.state.status = "1 to review"
    await refresh(shown.host, sessionOf(), false)
    expect(shown.state.status).toBeUndefined()

    const demo = hostWith({ isGhMissing: true, isDemo: true })
    demo.state.status = "3 ready to merge"
    await refresh(demo.host, sessionOf(), false)
    expect(demo.state.status).toBe("3 ready to merge")
  })

  test("after a write, one under way is waited out, as it began before the write, and another runs", async () => {
    const { host, calls, hold, isReached, release } = hostWith()
    const session = sessionOf()
    hold()
    const before = refresh(host, session, false)
    await isReached

    const after = refreshAfterWrite(host, session)
    release()
    await Promise.all([before, after])

    expect(calls.filter((call) => call === "gh api graphql")).toHaveLength(2)
  })

  test("a lookup of how pull requests ended that fails leaves them out, and the load goes on", async () => {
    const { host, calls, state } = hostWith({ isClosedLookupFailing: true })
    state.recalled = snapshotOf(open("fix/menu"))

    await refresh(host, sessionOf(), false)

    expect(calls.slice(-3)).toEqual(["keepActivity", "remember", "share"])
    expect(state.logs).toEqual(["Merged and closed pull requests could not be looked up: HTTP 502"])
  })

  test("a list GitHub refused says so worded for the person, and the debug log keeps gh's own words", async () => {
    const { host, state } = hostWith({ listRefusal: "gh: Resource not accessible by integration (HTTP 403)" })

    await refresh(host, sessionOf(), false)

    expect(state.problem).toBe("GitHub refused the request (rate limit or permissions).")
    expect(state.logs).toEqual([
      "The list of acme/app could not be read: gh: Resource not accessible by integration (HTTP 403)"
    ])
  })

  test("retrying lifts a stop at once, so the timer comes back though GitHub's trouble goes on", async () => {
    const { host, state } = hostWith({ listAnswer: "not an answer" })
    const session = sessionOf()
    session.checks.isStopped = true

    await retry(host, session)
    await Promise.all(state.work)

    expect(state.problem).not.toBeNull()
    expect(session.checks.isStopped).toBe(false)
    expect(state.timers.length).toBeGreaterThan(0)
  })

  test("the refresh after a write is the person's own: what it finds is noted on the rows, not toasted", async () => {
    const options: HostOptions = { list: { mine: [{ number: 1, title: "Legend", ci: "SUCCESS" }] } }
    const { host, state } = hostWith(options)
    const session = sessionOf()
    await refresh(host, session, false)
    options.list = { mine: [{ number: 1, title: "Legend", ci: "FAILURE" }] }

    await refreshAfterWrite(host, session)
    await Promise.all(state.work)

    expect(state.activity.map((each) => each.number)).toEqual([1])
    expect(state.toasts).toEqual([])
  })

  test("one that works lifts a stop, and the timer starts again", async () => {
    const { host, state } = hostWith()
    const session = sessionOf()
    session.checks.isStopped = true
    state.problem = "GitHub refused the request (rate limit or permissions)."

    await refresh(host, session, false)
    await Promise.all(state.work)

    expect(session.checks.isStopped).toBe(false)
    expect(state.problem).toBeNull()
    expect(state.timers.map(({ ms }) => ms)).toEqual([3 * 60_000, 20_000])
  })

  test("shows the summary in the status line, unless the demo holds it", async () => {
    const list = { requested: [{ number: 9, author: "ann" }] }
    const { host, state } = hostWith({ list })
    await refresh(host, sessionOf(), false)
    expect(state.status).toBe(statusSummary(state.list!))
    expect(state.status).toBeDefined()

    const demo = hostWith({ list, isDemo: true })
    demo.state.status = "3 ready to merge"
    await refresh(demo.host, sessionOf(), false)
    expect(demo.state.status).toBe("3 ready to merge")
  })

  test("a lookup GitHub answers with nothing, as a refusal, is logged, and the branches carry as the list saw them", async () => {
    const { host, state } = hostWith({ isClosedLookupRefused: true })
    state.recalled = snapshotOf(open("fix/menu"))

    await refresh(host, sessionOf(), false)

    expect(state.logs).toEqual([
      "Merged and closed pull requests could not be looked up: gh: API rate limit exceeded (HTTP 403)"
    ])
    expect(state.list?.endedHeads).toEqual([{ branch: "fix/menu", oid: "at-fix/menu" }])
  })

  test("asks first of those gone since the list it compares with, then of those gone since the list as it stands", async () => {
    // Away since #9 was listed; #2 came meanwhile, and both are gone now.
    const closed = closedAnswer(closedState(9, "MERGED"), closedState(2, "CLOSED"))
    const { host, state } = hostWith({ closed })
    const session = sessionOf()
    session.checks.awayBase = snapshotOf({ mine: [{ number: 9, title: "Old work" }] })
    state.list = snapshotOf({ requested: [{ number: 2, author: "bob" }] })

    await refresh(host, session, false)

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => [...argv.at(-1)!.matchAll(/ p(\d+): /g)].map((match) => Number(match[1])))).toEqual([
      [9, 2]
    ])
    // The one gone since the list compared with is told; the one that came meanwhile, never told, carries nothing.
    expect(state.activity.map((entry) => [entry.number, entry.events])).toEqual([[9, ["merged by ann"]]])
    expect(state.list?.endedPulls).toEqual([])
  })

  test("a session's first load asks of those gone since the last look: rows, mentions and the viewer's own branches", async () => {
    const { host, state } = hostWith({ list: open() })
    // #3 is a hidden draft's branch, which has no row.
    state.recalled = {
      ...snapshotOf({ ...open("fix/menu"), mentioned: [{ number: 7, author: "bob" }] }),
      ownHeads: [
        { branch: "fix/menu", oid: "at-fix/menu", number: 1 },
        { branch: "draft/legend", oid: "at-draft/legend", number: 3 }
      ]
    }

    await refresh(host, sessionOf(), false)

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => [...argv.at(-1)!.matchAll(/ p(\d+): /g)].map((match) => Number(match[1])))).toEqual([
      [1, 3, 7]
    ])
  })

  test("the lookup is given as long as the request for the lists, and the list waits for it a third of that, no more than it takes", async () => {
    const { host, state } = hostWith()
    state.recalled = snapshotOf(open("fix/menu"))

    await refresh(host, sessionOf(), false)

    const isLookup = (argv: readonly string[]) => argv.some((arg) => arg.includes("CLOSED_EVENT"))
    expect(state.timeouts.filter((_, index) => isLookup(state.runs[index]!))).toEqual([30_000])
    expect(state.waits).toEqual([{ ms: 10_000, isCancelled: true }])
  })

  test("loads nothing draws ask only what their carries need, and the next drawn load what its alerts need", async () => {
    const closed = closedAnswer(closedState(1, "MERGED"))
    const options: HostOptions = { closed, list: open("fix/menu", "feature/legend") }
    const { host, state } = hostWith(options)
    const session = sessionOf()
    await refresh(host, session, false)
    const lookups = () => state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT"))).length

    // #1 leaves while nothing is drawn; the loads after it, drawn by nothing either, ask nothing more of it.
    options.isDrawn = false
    options.list = { mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] }
    for (let index = 0; index < 4; index++) {
      await refresh(host, session, false)
    }
    expect(lookups()).toBe(1)

    options.isDrawn = true
    await refresh(host, session, false)
    expect(lookups()).toBe(2)
    expect(state.activity.map((entry) => [entry.number, entry.events])).toEqual([[1, ["merged by ann"]]])
  })

  test("a load nothing drew as it began tells nothing, though drawn by its end, and one after it tells all", async () => {
    // Away since #1 and #2 were listed; #1 left before the list as it stands, #2 leaves now.
    const closed = closedAnswer(closedState(1, "MERGED"), closedState(2, "CLOSED"))
    const options: HostOptions = { closed, list: open(), isDrawn: false }
    options.atClosedLookup = () => void (options.isDrawn = true)
    const { host, state } = hostWith(options)
    const session = sessionOf()
    const away = snapshotOf(open("fix/menu", "feature/legend"))
    session.checks.awayBase = away
    state.list = snapshotOf({ mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] })

    await refresh(host, session, false)
    expect(state.activity).toEqual([])
    expect(session.checks.awayBase).toBe(away)

    // The window came while it ran, and the load after it is drawn.
    await Promise.all(state.work)
    expect(state.activity.map((entry) => [entry.number, entry.events])).toEqual([
      [1, ["merged by ann"]],
      [2, ["closed by ann"]]
    ])
  })

  test("a load drawn as it began but not by its end tells nothing, and the next drawn load tells it", async () => {
    const closed = closedAnswer(closedState(1, "MERGED"))
    const options: HostOptions = {
      closed,
      list: { mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] }
    }
    options.atClosedLookup = () => void (options.isDrawn = false)
    const { host, state } = hostWith(options)
    const session = sessionOf()
    const shown = snapshotOf(open("fix/menu", "feature/legend"))
    state.list = shown

    await refresh(host, session, false)
    expect(state.activity).toEqual([])
    expect(session.checks.awayBase).toBe(shown)

    options.atClosedLookup = undefined
    options.isDrawn = true
    await refresh(host, session, false)
    expect(state.activity.map((entry) => [entry.number, entry.events])).toEqual([[1, ["merged by ann"]]])
  })

  test("a load where only a mention and a hidden draft's row left waits no longer than the list, as no closed alert comes of them", async () => {
    // #1 turned into a draft the list hides, its branch still open; #12 left the mentions.
    const { host, state } = hostWith({
      list: { mine: [{ number: 1, headRefName: "fix/menu", headRefOid: "at-fix/menu", isDraft: true }] },
      isWaitOver: true,
      closedGate: new Promise<void>(() => undefined)
    })
    state.list = snapshotOf({ ...open("fix/menu"), mentioned: [{ number: 12, author: "bob" }] })

    await refresh(host, sessionOf({ hideDrafts: true }), false)

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => [...argv.at(-1)!.matchAll(/ p(\d+): /g)].map((match) => Number(match[1])))).toEqual([
      [12]
    ])
  })

  test("no load follows one a window came during in a mode whose attach doesn't refresh, nor once /prs looked back", async () => {
    const lists = (runs: (readonly string[])[]) => runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))
    const withWindowComing = () => {
      const options: HostOptions = {
        closed: closedAnswer(closedState(1, "MERGED")),
        list: { mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] },
        isDrawn: false
      }
      options.atClosedLookup = () => void (options.isDrawn = true)
      const fixture = hostWith(options)
      fixture.state.list = snapshotOf(open("fix/menu", "feature/legend"))

      return fixture
    }

    const onDemand = withWindowComing()
    await refresh(onDemand.host, sessionOf({ refresh: "on-demand" }), false)
    await Promise.all(onDemand.state.work)
    expect(lists(onDemand.state.runs)).toHaveLength(1)

    const lookedBack = withWindowComing()
    const session = sessionOf()
    await refresh(lookedBack.host, session, false)
    session.checks.awayBase = null
    await Promise.all(lookedBack.state.work)
    expect(lists(lookedBack.state.runs)).toHaveLength(1)
  })

  test("with the closed alert off, a load asks only what its carries need, and waits no longer than the list", async () => {
    // #3 left before the list as it stands, #1 leaves now; GitHub never answers.
    const { host, state } = hostWith({
      list: { mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] },
      isWaitOver: true,
      closedGate: new Promise<void>(() => undefined)
    })
    const session = sessionOf({ alertClosed: false })
    session.checks.awayBase = snapshotOf(open("fix/menu", "feature/legend", "fix/typo"))
    state.list = snapshotOf(open("fix/menu", "feature/legend"))

    await refresh(host, session, false)

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => [...argv.at(-1)!.matchAll(/ p(\d+): /g)].map((match) => Number(match[1])))).toEqual([
      [1]
    ])
    expect(state.list?.mine.map((row) => row.number)).toEqual([2])
  })

  test("a list the lookup kept waiting is shown as without it, and its alerts and cleanup wait for the answer", async () => {
    const closed = closedAnswer(closedState(1, "MERGED", "final-head"))
    const { host, state } = hostWith({ closed, isWaitOver: true })
    state.recalled = snapshotOf(open("fix/menu"))
    const session = sessionOf({ cleanupWorktrees: true })

    await refresh(host, session, false)
    await Promise.all(state.work)

    // The branch carries at the head the list saw, not at GitHub's final one.
    expect(state.list?.endedHeads).toEqual([{ branch: "fix/menu", oid: "at-fix/menu" }])
    expect(state.activity.map((entry) => [entry.number, entry.events])).toEqual([[1, ["merged by ann"]]])
    expect(session.checks.lookedUp).toEqual([closedState(1, "MERGED", "final-head")])
    expect(state.cleanUps).toEqual([[1]])
  })

  test("a merge from the pane that went through while GitHub was asked is not shown open again", async () => {
    const options: HostOptions = { list: open("fix/menu", "feature/legend") }
    const { host, state } = hostWith(options)
    const session = sessionOf()
    await refresh(host, session, false)
    // #2 is merged from the pane while the next load asks how #1, gone, ended; the search still lists #2.
    options.list = { mine: [{ number: 2, headRefName: "feature/legend", headRefOid: "at-feature/legend" }] }
    options.atClosedLookup = () => {
      state.merged = [{ number: 2, title: "Add a legend", url: "", base: "main", index: 1, at: state.now }]
    }

    await refresh(host, session, false)

    expect(state.list?.mine).toEqual([])
  })

  test("the lookup Create PR waits on asks about the checkout kept, a newer one a press read meanwhile", async () => {
    const keptCheckout = { branch: "feature/export", head: "pressed", at: 90_000 }
    const { host, state } = hostWith({ keptCheckout })

    await refresh(host, sessionOf(), false)

    expect(state.branchLookups).toEqual([["feature/export", "pressed"]])
  })

  test("a cleanup is handed how the pull requests that left ended, also where only a branch of the viewer's left", async () => {
    const closed = closedAnswer(closedState(1, "MERGED"))
    const options: HostOptions = { closed, list: open("fix/menu") }
    const { host, state } = hostWith(options)
    const session = sessionOf({ cleanupWorktrees: true })
    await refresh(host, session, false)
    expect(state.cleanUps).toEqual([[]])
    // A load that finds nothing gone has nothing to clean.
    await refresh(host, session, false)
    expect(state.cleanUps).toEqual([[]])

    // Merged from the pane, its row left the list at once; its branch leaves once the search has caught up.
    state.list = { ...state.list!, mine: [] }
    options.list = open()
    await refresh(host, session, false)

    expect(state.cleanUps).toEqual([[], [1]])
  })

  test("asks how at most 30 of those that left the lists ended, in one request", async () => {
    const { host, state } = hostWith()
    state.recalled = snapshotOf(open(...Array.from({ length: 31 }, (_, index) => `branch-${index}`)))

    await refresh(host, sessionOf(), false)

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups).toHaveLength(1)
    expect(lookups[0]!.at(-1)!.match(/pullRequest\(number: /g)).toHaveLength(30)
  })
})

describe("the timer", () => {
  test("runs in background mode, in while-open mode while the pane is open, and never on demand", async () => {
    const cases = [
      { mode: "background", isPaneOpen: false, isRunning: true },
      { mode: "while-open", isPaneOpen: true, isRunning: true },
      { mode: "while-open", isPaneOpen: false, isRunning: false },
      { mode: "on-demand", isPaneOpen: true, isRunning: false }
    ]
    for (const { mode, isPaneOpen, isRunning } of cases) {
      const { host, state } = hostWith({ isPaneOpen })
      const session = sessionOf({ refresh: mode, pollMinutes: 5 })

      await ensurePolling(host, session)

      // Beside the refreshes, a look for an answer another session shared.
      expect(state.timers.map(({ ms }) => ms)).toEqual(isRunning ? [5 * 60_000, 20_000] : [])
      expect(retryMinutes(session)).toBe(isRunning ? 5 : null)
    }
  })

  test("with sharing off, only the refreshes run", async () => {
    const { host, state } = hostWith()

    await ensurePolling(host, sessionOf({ shareRefresh: false }))

    expect(state.timers.map(({ ms }) => ms)).toEqual([3 * 60_000])
  })

  test("starts once, however often asked at the same time, and not while a problem stopped the checks", async () => {
    const { host, state } = hostWith()
    const session = sessionOf()
    session.checks.isStopped = true
    await ensurePolling(host, session)
    expect(state.timers).toHaveLength(0)

    session.checks.isStopped = false
    await Promise.all([ensurePolling(host, session), ensurePolling(host, session)])
    await ensurePolling(host, session)
    expect(state.timers.map(({ ms }) => ms)).toEqual([3 * 60_000, 20_000])
  })

  test("stops with nothing drawn, to start again on attach, and in while-open mode once the pane closed", async () => {
    const away = hostWith({ isDrawn: false })
    const session = sessionOf()
    await ensurePolling(away.host, session)
    away.state.timers[0]!.tick()
    await Promise.all(away.state.work)
    expect(away.state.timers.map(({ isCancelled }) => isCancelled)).toEqual([true, true])
    expect(session.checks).toMatchObject({ timer: null, shareTimer: null, wasDetached: true })

    const pane = { isPaneOpen: true }
    const shut = hostWith(pane)
    const whileOpen = sessionOf({ refresh: "while-open" })
    await ensurePolling(shut.host, whileOpen)
    pane.isPaneOpen = false
    shut.state.timers[0]!.tick()
    await Promise.all(shut.state.work)
    expect(shut.state.timers.map(({ isCancelled }) => isCancelled)).toEqual([true, true])
    expect(whileOpen.checks).toMatchObject({ timer: null, shareTimer: null, wasDetached: false })
    expect(shut.calls).toEqual([])
  })
})

describe("the look between ticks", () => {
  // A session showing its list, then a newer one another session shared, and nobody looking at either.
  async function unwatched(options: Parameters<typeof hostWith>[0], settings: PluginOptions = {}) {
    const fixture = hostWith(options)
    const session = sessionOf(settings)
    await refresh(fixture.host, session, false)
    await ensurePolling(fixture.host, session)
    fixture.calls.length = 0
    fixture.state.store[sharedKey(ME)] = {
      schema: 1,
      query: QUERY_VERSION,
      host: "github.com",
      repo: "acme/app",
      viewer: "me",
      requestedAt: fixture.state.now + 1_000,
      fetchedAt: fixture.state.now + 2_000,
      by: "other",
      answer: JSON.parse(response(open("feature/shared"))) as unknown
    }

    return { ...fixture, session }
  }

  test("takes nothing and ends nothing with nothing drawn or the pane closed: the tick ends them, an interval on", async () => {
    const drawn = { isDrawn: true }
    const away = await unwatched(drawn)
    drawn.isDrawn = false
    away.state.timers[1]!.tick()
    await Promise.all(away.state.work)
    expect(away.calls).toEqual([])
    expect(away.state.timers.map(({ isCancelled }) => isCancelled)).toEqual([false, false])
    expect(away.session.checks.wasDetached).toBe(false)

    const pane = { isPaneOpen: true }
    const shut = await unwatched(pane, { refresh: "while-open" })
    pane.isPaneOpen = false
    shut.state.timers[1]!.tick()
    await Promise.all(shut.state.work)
    expect(shut.calls).toEqual([])
    expect(shut.state.timers.map(({ isCancelled }) => isCancelled)).toEqual([false, false])
  })
})

describe("looking back", () => {
  test("compares with the last look, asks how those gone ended, and keeps this list as the look", async () => {
    const closed = {
      data: {
        repository: { p1: { number: 1, state: "MERGED", mergedBy: { login: "ann" }, headRefOid: "at-fix/menu" } }
      }
    }
    const { host, calls, state } = hostWith({ closed })
    const session = sessionOf()
    session.repo = { name: "acme/app", host: "github.com" }
    session.checks.awayBase = snapshotOf(open())
    state.recalled = snapshotOf(open("fix/menu"))

    const since = await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))

    expect(calls).toEqual(["recall", "gh api graphql", "remember"])
    expect(session.checks.awayBase).toBeNull()
    expect(since?.changes).toEqual([
      { kind: "closed", number: 1, title: "Pull request 1", by: null, symbol: "✓", event: "merged by ann" }
    ])
  })

  test("asks only of those gone since the last look that the load before it didn't find", async () => {
    const closed = closedAnswer(closedState(2, "CLOSED"))
    const { host, state } = hostWith({ closed })
    const session = sessionOf()
    session.repo = { name: "acme/app", host: "github.com" }
    session.checks.lookedUp = [closedState(1, "MERGED")]
    state.recalled = snapshotOf(open("fix/menu", "feature/legend"))

    const since = await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => [...argv.at(-1)!.matchAll(/ p(\d+): /g)].map((match) => Number(match[1])))).toEqual([
      [2]
    ])
    expect(since?.changes.map((change) => [change.number, change.event])).toEqual([
      [1, "merged by ann"],
      [2, "closed by ann"]
    ])

    session.checks.lookedUp = [closedState(1, "MERGED"), closedState(2, "CLOSED")]
    state.runs.length = 0
    await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))
    expect(state.runs).toEqual([])
  })

  test("asks again of one the load before it found still open, which may have ended since", async () => {
    const closed = closedAnswer(closedState(1, "MERGED"))
    const { host, state } = hostWith({ closed })
    const session = sessionOf()
    session.repo = { name: "acme/app", host: "github.com" }
    session.checks.lookedUp = [closedState(1, "OPEN")]
    state.recalled = snapshotOf(open("fix/menu"))

    const since = await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))

    expect(since?.changes.map((change) => [change.number, change.event])).toEqual([[1, "merged by ann"]])
  })

  test("asks how at most 30 of those gone since the last look ended", async () => {
    const { host, state } = hostWith()
    const session = sessionOf()
    session.repo = { name: "acme/app", host: "github.com" }
    state.recalled = snapshotOf(open(...Array.from({ length: 31 }, (_, index) => `branch-${index}`)))

    await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))

    const lookups = state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))
    expect(lookups.map((argv) => argv.at(-1)!.match(/pullRequest\(number: /g)?.length)).toEqual([30])
  })

  test("a lookup that fails keeps what the load before it found", async () => {
    const { host, state } = hostWith({ isClosedLookupFailing: true })
    const session = sessionOf()
    session.repo = { name: "acme/app", host: "github.com" }
    session.checks.lookedUp = [closedState(1, "MERGED")]
    state.recalled = snapshotOf(open("fix/menu", "feature/legend"))

    const since = await lookBack(host, session, snapshotOf(open(), { at: 60_000 }))

    expect(since?.changes.map((change) => [change.number, change.event])).toEqual([[1, "merged by ann"]])
  })

  test("where nothing is drawn, asks nothing of those the load before it asked about", async () => {
    const closed = closedAnswer(closedState(1, "MERGED"))
    const { host, state } = hostWith({ closed, isDrawn: false })
    const session = sessionOf()
    state.recalled = snapshotOf(open("fix/menu"))
    await refresh(host, session, false)

    const since = await lookBack(host, session, state.list!)

    expect(state.runs.filter((argv) => argv.some((arg) => arg.includes("CLOSED_EVENT")))).toHaveLength(1)
    expect(since?.changes.map((change) => [change.number, change.event])).toEqual([[1, "merged by ann"]])
  })

  test("with the alert off, asks nothing of those gone since the last look", async () => {
    const { host, calls, state } = hostWith()
    const session = sessionOf({ alertClosed: false })
    session.repo = { name: "acme/app", host: "github.com" }
    state.recalled = snapshotOf(open("fix/menu"))

    expect((await lookBack(host, session, snapshotOf(open(), { at: 60_000 })))?.changes).toEqual([])
    expect(calls).toEqual(["recall", "remember"])
  })

  test("with no repository yet, asks nothing", async () => {
    const { host, calls } = hostWith()

    expect(await lookBack(host, sessionOf(), snapshotOf(open()))).toBeNull()
    expect(calls).toEqual([])
  })
})

describe("sharing with the other sessions in the repository", () => {
  const KEY = sharedKey(ME)

  // A session showing the list it read at a minute in, its timers started, three minutes in.
  async function ticking(options: Parameters<typeof hostWith>[0] = {}, settings: PluginOptions = {}) {
    const fixture = hostWith(options)
    const session = sessionOf(settings)
    await refresh(fixture.host, session, false)
    await ensurePolling(fixture.host, session)
    fixture.calls.length = 0
    fixture.state.runs.length = 0
    fixture.state.now = 4 * 60_000
    const fire = async (timer: number) => {
      fixture.state.timers[timer]!.tick()
      await Promise.all(fixture.state.work)
    }

    return { ...fixture, session, tick: () => fire(0), look: () => fire(1) }
  }

  test("a tick takes a newer answer another session asked for in the interval, and asks GitHub nothing", async () => {
    const { calls, state, session, tick } = await ticking()
    const shared = sharedBy("other", state.now - 30_000)
    state.store[KEY] = shared

    await tick()

    expect(calls).not.toContain("gh api graphql")
    expect(calls).toContain("showList")
    expect(state.list?.mine.map((row) => row.headRefName)).toEqual(["feature/shared"])
    expect(state.list?.fetchedAt).toBe(shared.fetchedAt)
    expect(session.checks.requestedAt).toBe(shared.requestedAt)
    // Shared on by none but the session that read it.
    expect(state.store[KEY]).toBe(shared)
  })

  test("a newer answer found while a request runs joins it rather than load beside it", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await ticking(options)
    const { isAtGate, open } = gateLoads(options)
    const asked = refresh(fixture.host, fixture.session, false)
    await isAtGate
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 30_000)

    fixture.state.timers[1]!.tick()
    await promisesRun()
    expect(fixture.session.checks.inFlight?.isFetching).toBe(true)
    options.gate = undefined
    open()
    await Promise.all([asked, ...fixture.state.work])

    expect(fixture.calls.filter((call) => call === "showList")).toHaveLength(1)
  })

  test("a tick that takes an answer awaits that session's next, in place of a claim's", async () => {
    const { calls, state, session, tick, look } = await ticking()
    const claimedAt = state.now - 5_000
    state.store[claimKey(ME)] = fetchClaim("other", claimedAt)
    await tick()
    expect(session.checks.awaited).toEqual({ since: claimedAt, until: claimedAt + 35_000 })

    // Another session's answer to a request from before the claim, newer than the list shown.
    const askedAt = claimedAt - 10_000
    state.store[KEY] = sharedBy("third", askedAt)
    state.now += 1_000
    await tick()
    expect(session.checks.awaited).toEqual({ since: askedAt + 1, until: askedAt + 3 * 60_000 + 20_000 })

    state.now += 30_000
    await look()
    expect(calls).not.toContain("gh api graphql")
  })

  test("a tick that left GitHub to another session asks itself once that session's next answer is overdue", async () => {
    const { calls, state, session, tick, look } = await ticking()
    const askedAt = state.now - 30_000
    state.store[KEY] = sharedBy("other", askedAt)
    await tick()

    // That session went: no answer comes an interval on.
    state.now = askedAt + 3 * 60_000 + 19_000
    await look()
    expect(calls).not.toContain("gh api graphql")
    calls.length = 0
    state.now += 1_000
    await look()
    // A claim, and a request for the lists (the other asks how the pull request it had ended).
    expect(calls[0]).toBe("claim")
    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
    expect(session.checks.awaited).toBeNull()
    // Asked off the tick's beat: its timers start over, so its next tick comes an interval after this request.
    expect(state.timers.map(({ ms, isCancelled }) => [ms, isCancelled])).toEqual([
      [3 * 60_000, true],
      [20_000, true],
      [3 * 60_000, false],
      [20_000, false]
    ])
  })

  test("the look waits on while the session it awaits claimed its next request, and asks once that claim lapses", async () => {
    const { calls, state, tick, look } = await ticking()
    const askedAt = state.now - 30_000
    state.store[KEY] = sharedBy("other", askedAt)
    await tick()
    // That session's next request, slow to answer.
    state.store[claimKey(ME)] = fetchClaim("other", askedAt + 3 * 60_000)
    calls.length = 0

    state.now = askedAt + 3 * 60_000 + 20_000
    await look()
    state.now += 14_000
    await look()
    expect(calls).not.toContain("gh api graphql")

    state.now += 1_000
    await look()
    expect(calls).toContain("gh api graphql")
  })

  test("a wait that came due while the window was closed asks GitHub at the first look it is open again", async () => {
    const options: HostOptions = {}
    const { state, tick, look } = await ticking(options)
    // Due 40 s after this tick: an interval and a look after the request it awaits the next of.
    state.store[KEY] = sharedBy("other", state.now - 160_000)
    await tick()
    state.now += 20_000
    await look()

    // The window closes: the looks run on, unwatched, until long after the answer was due.
    options.isDrawn = false
    for (let looked = 0; looked < 4; looked++) {
      state.now += 20_000
      await look()
    }
    options.isDrawn = true
    state.now += 20_000
    await look()

    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
  })

  test("a wait that came due while the computer slept is left to the next look, or to the tick that fires with it", async () => {
    const { calls, state, tick, look } = await ticking()
    state.store[KEY] = sharedBy("other", state.now - 30_000)
    await tick()
    state.now += 20_000
    await look()

    state.now += 40 * 60_000
    await look()

    expect(calls).not.toContain("gh api graphql")
  })

  for (const racer of ["the look on attach", "the regular look"] as const) {
    test(`${racer}, racing a tick that takes an answer, keeps the tick's wait for the next`, async () => {
      const options: HostOptions = {}
      const { host, session, state, look } = await ticking(options)
      // Another session asked 150 s ago; its answer came while this window was closed, so no look took it.
      const askedAt = state.now - 150_000
      state.store[KEY] = sharedBy("other", askedAt)
      const gate = gateLoads(options)

      state.timers[0]!.tick()
      await gate.isAtGate
      const wait = session.checks.awaited
      state.work.push(
        racer === "the look on attach" ? checkShared(host, session) : Promise.resolve(state.timers[1]!.tick())
      )
      await promisesRun()
      gate.open()
      await Promise.all(state.work)
      expect(session.checks.awaited).toEqual(wait)

      // That session ends before its next request: once the answer is overdue, this one asks.
      state.runs.length = 0
      for (let looked = 0; looked < 3; looked++) {
        state.now += 20_000
        await look()
      }
      expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
    })
  }

  test("a look that read the store while a tick set a wait for a later answer keeps that wait", async () => {
    const options: HostOptions = {}
    const { session, state } = await ticking(options)
    const askedAt = state.now - 30_000
    state.store[KEY] = sharedBy("other", askedAt)
    session.checks.awaited = { since: askedAt - 60_000, until: state.now + 60_000 }
    const reads = gateSharedReads(options)

    state.timers[1]!.tick()
    await reads.isAtGate
    options.sharedGate = undefined
    state.timers[0]!.tick()
    await promisesRun()
    reads.open()
    await Promise.all(state.work)

    // The look took the answer the tick did, not the later one the tick waits for.
    expect(session.checks.awaited).toEqual({ since: askedAt + 1, until: askedAt + 3 * 60_000 + 20_000 })
  })

  test("a look in a session that shows no list yet does nothing, an answer shared or not", async () => {
    const { host, session, state } = await ticking()
    state.list = null
    state.store[KEY] = sharedBy("other", state.now - 5_000)

    await checkShared(host, session)

    expect(state.runs).toEqual([])
    expect(state.list).toBeNull()
  })

  test("a tick that left GitHub to another session takes its next answer when it comes in time", async () => {
    const { calls, state, tick, look } = await ticking()
    const askedAt = state.now - 30_000
    state.store[KEY] = sharedBy("other", askedAt)
    await tick()

    state.now = askedAt + 3 * 60_000 + 20_000
    state.store[KEY] = sharedBy("other", askedAt + 3 * 60_000, open("feature/next"))
    await look()

    expect(calls).not.toContain("gh api graphql")
    expect(state.list?.mine.map((row) => row.headRefName)).toEqual(["feature/next"])
  })

  test("a tick with no answer from another session claims the request, asks GitHub and shares the answer", async () => {
    const { calls, state, session, tick } = await ticking()

    await tick()

    expect(calls.slice(0, 2)).toEqual(["claim", "gh api graphql"])
    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now) })
    // Alone, its timers keep their pace.
    expect(state.timers.map(({ ms, isCancelled }) => [ms, isCancelled])).toEqual([
      [3 * 60_000, false],
      [20_000, false]
    ])
    expect(state.store[KEY]).toMatchObject({
      query: QUERY_VERSION,
      viewer: "me",
      by: session.id,
      requestedAt: state.now,
      fetchedAt: state.now
    })
    expect(storedShared(state.store[KEY])?.answer).toEqual(JSON.parse(response(open())))
  })

  test("a tick claims its request as it goes out, for this person and query", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    delete state.store[claimKey(ME)]
    let claimed: unknown
    options.atListRequest = () => {
      claimed = state.store[claimKey(ME)]
    }

    await tick()

    expect(claimed).toEqual(fetchClaim(session.id, state.now))
  })

  test("an answer's claim the store is slow to keep holds up no list", async () => {
    const options: HostOptions = {}
    const { host, calls, session } = await ticking(options)
    options.claimGate = new Promise<void>(() => undefined)

    await refresh(host, session, false)

    expect(calls).toContain("showList")
  })

  test("a claim the store is slow to keep holds up no request", async () => {
    const options: HostOptions = {}
    const fixture = await ticking(options)
    let keep = (): void => undefined
    options.claimGate = new Promise<void>((resolve) => (keep = resolve))
    fixture.hold()

    fixture.state.timers[0]!.tick()
    await fixture.isReached
    fixture.release()
    keep()
    await Promise.all(fixture.state.work)

    expect(fixture.calls.slice(0, 2)).toEqual(["claim", "gh api graphql"])
  })

  test("timers a problem that holds stopped stay stopped, though another session claimed meanwhile", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    options.isGhMissing = true
    options.atListRequest = () => {
      state.store[claimKey(ME)] = fetchClaim("other", state.now)
    }

    await tick()

    expect(session.checks.isStopped).toBe(true)
    expect(state.timers.filter(({ isCancelled }) => !isCancelled)).toEqual([])
  })

  test("a tick waits for a session asking GitHub now, whose answer the look between ticks then takes", async () => {
    const { calls, state, session, tick, look } = await ticking()
    const claimedAt = state.now - 5_000
    state.store[claimKey(ME)] = fetchClaim("other", claimedAt)

    await tick()
    expect(calls).toEqual([])
    expect(session.checks.awaited).toEqual({ since: claimedAt, until: claimedAt + 35_000 })

    state.store[KEY] = sharedBy("other", claimedAt)
    state.now += 20_000
    await look()

    expect(calls).not.toContain("gh api graphql")
    expect(state.list?.mine.map((row) => row.headRefName)).toEqual(["feature/shared"])
    expect(session.checks.awaited).toBeNull()
  })

  test("the look between ticks asks GitHub itself once the claim it waited on lapsed with no answer", async () => {
    const { calls, state, tick, look } = await ticking()
    state.store[claimKey(ME)] = fetchClaim("other", state.now - 5_000)
    await tick()

    state.now += 10_000
    await look()
    expect(calls).toEqual([])

    // A claim holds 35 s, longer than the request it names may take.
    state.now += 20_000
    await look()
    expect(calls.slice(0, 2)).toEqual(["claim", "gh api graphql"])
  })

  test("a session shares its answer once it alerted what changed, and where nothing is drawn too", async () => {
    const options: Parameters<typeof hostWith>[0] = { list: { mine: [{ number: 1, ci: "SUCCESS" }] } }
    const { host, calls, session, tick } = await ticking(options)
    options.list = { mine: [{ number: 1, ci: "FAILURE" }] }

    await tick()
    expect(calls.filter((call) => call === "announce" || call === "share")).toEqual(["announce", "share"])

    options.isDrawn = false
    calls.length = 0
    await refresh(host, session, false)
    expect(calls).toContain("share")
  })

  test("an answer is claimed as it comes, so the others wait for it while this session shows it", async () => {
    const options: HostOptions = {}
    const { host, calls, session, state } = await ticking(options)
    options.fetchMs = 5_000
    const start = state.now

    await refresh(host, session, false)

    // Named for the request it answers, so a session that waited for it counts it as answered.
    expect(state.store[claimKey(ME)]).toEqual(fetchClaim(session.id, start + 5_000, "me", start))
    expect(calls.indexOf("claim")).toBeGreaterThan(calls.indexOf("gh api graphql"))
    expect(calls.indexOf("claim")).toBeLessThan(calls.indexOf("showList"))
  })

  test("a list dated ahead of the clock, set back since it came, takes the next answer shared", async () => {
    const { state, tick } = await ticking()
    state.list = { ...state.list!, fetchedAt: state.now + 10 * 60_000 }
    state.store[KEY] = sharedBy("other", state.now - 30_000)

    await tick()

    expect(state.list?.mine.map((row) => row.headRefName)).toEqual(["feature/shared"])
    expect(state.list?.fetchedAt).toBe(state.now - 28_000)
  })

  test("a session whose answer the store refused claims none of its requests, until one is kept again", async () => {
    const options: HostOptions = {}
    const { calls, state, tick } = await ticking(options)
    options.isShareRefused = true
    await tick()
    calls.length = 0

    state.now += 3 * 60_000
    await tick()
    expect(calls).not.toContain("claim")
    expect(calls).toContain("gh api graphql")

    options.isShareRefused = false
    state.now += 3 * 60_000
    await tick()
    state.now += 3 * 60_000
    calls.length = 0
    await tick()
    expect(calls.filter((call) => call === "claim")).toHaveLength(2)
  })

  test("a tick's request that comes to nothing lets its claim go, so the others ask GitHub rather than wait", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    options.listAnswer = JSON.stringify({ errors: [{ message: "nope" }] })

    await tick()

    expect(state.problem).toContain("nope")
    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now), at: 0 })
    // A problem that may pass: the timers go on.
    expect(session.checks.isStopped).toBe(false)
  })

  test("a request that comes to nothing leaves another session's claim alone", async () => {
    const options: HostOptions = {}
    const { state, tick } = await ticking(options)
    options.listAnswer = JSON.stringify({ errors: [{ message: "nope" }] })
    // Another session claims as this request goes out, for a request of its own made just before.
    const theirs = fetchClaim("other", state.now, "me", state.now - 1_000)
    options.atListRequest = () => {
      state.store[claimKey(ME)] = theirs
    }

    await tick()

    expect(state.store[claimKey(ME)]).toEqual(theirs)
  })

  test("a tick that joins a request under way claims that request, and its answer's claim stays", async () => {
    const fixture = await ticking()
    const { host, session, state } = fixture
    const pressedAt = state.now
    fixture.hold()
    const pressed = refresh(host, session, false)
    await fixture.isReached

    state.now += 5_000
    state.timers[0]!.tick()
    await promisesRun()
    // Named for the request the tick waits for, so a session that waits on the claim counts its answer.
    expect(state.store[claimKey(ME)]).toEqual(fetchClaim(session.id, pressedAt + 5_000, "me", pressedAt))
    state.now += 2_000
    fixture.release()
    await Promise.all([pressed, ...state.work])

    expect(state.store[claimKey(ME)]).toEqual(fetchClaim(session.id, pressedAt + 7_000, "me", pressedAt))
  })

  test("a tick whose list is newer than the answer the store keeps, its own refused, asks GitHub rather than wait", async () => {
    const options: HostOptions = {}
    const { host, session, state, tick } = await ticking(options)
    const lists = () => state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))
    state.store[KEY] = sharedBy("other", state.now - 30_000)
    // A Refresh after that answer, which the store refuses, so it keeps the other's.
    options.isShareRefused = true
    await refresh(host, session, false)

    state.now += 100_000
    await tick()

    expect(lists()).toHaveLength(2)
    expect(session.checks.awaited).toBeNull()
  })

  test("a tick's request whose answer is too large to share lets its claim go", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    options.list = { mine: [{ number: 1, title: "x".repeat(160_000) }] }

    await tick()

    expect(state.logs).toEqual(["The list of acme/app is too large to share with other sessions."])
    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now), at: 0 })
  })

  test("a tick whose load fails before it asks lets its claim go", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    options.isMarkingFailing = true

    await tick()

    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(0)
    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now), at: 0 })
  })

  test("a tick whose answer, too large to share, fails to show lets its claim go", async () => {
    const options: HostOptions = {}
    const { session, state, tick } = await ticking(options)
    options.list = { mine: [{ number: 1, title: "x".repeat(160_000) }] }
    options.isShowListFailing = true

    await tick()

    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now), at: 0 })
  })

  test("a load that fails before it shows the answer it claimed lets the claim go", async () => {
    const options: HostOptions = {}
    const { host, session, state } = await ticking(options)
    options.fetchMs = 2_000
    options.mergedFailures = 1
    const start = state.now

    await expect(refresh(host, session, false)).rejects.toThrow("store unreadable")
    await Promise.all(state.work)

    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, start + 2_000, "me", start), at: 0 })
  })

  test("an answer the store refused lets its claim go, so the others ask GitHub rather than wait for it", async () => {
    const options: HostOptions = {}
    const { host, session, state } = await ticking(options)
    let keep = (): void => undefined
    options.claimGate = new Promise<void>((resolve) => (keep = resolve))
    options.isShareRefused = true

    await refresh(host, session, false)
    // The claim is kept only once the answer was refused.
    keep()
    await Promise.all(state.work)

    expect(state.store[claimKey(ME)]).toEqual({ ...fetchClaim(session.id, state.now), at: 0 })
  })

  test("only the latest share says whether the store takes this session's answers", async () => {
    const options: HostOptions = {}
    const { host, session, state } = await ticking(options)
    let refuse = (_: boolean): void => undefined
    options.shareResults = [new Promise<boolean>((resolve) => (refuse = resolve)), Promise.resolve(true)]

    await refresh(host, session, false)
    state.now += 1_000
    await refresh(host, session, false)
    // The earlier share settles last, refused.
    refuse(false)
    await Promise.all(state.work)

    expect(session.checks.unshared.size).toBe(0)
  })

  test("an answer is claimed over another session's claim that lapsed while the request ran", async () => {
    const options: HostOptions = {}
    const { host, session, state } = await ticking(options)
    options.fetchMs = 10_000
    const start = state.now
    // Holding as the request goes out, lapsed by the time the answer comes.
    state.store[claimKey(ME)] = fetchClaim("other", start - 30_000)

    await refresh(host, session, false)

    expect(state.store[claimKey(ME)]).toEqual(fetchClaim(session.id, start + 10_000, "me", start))
  })

  test("an answer is not claimed over another session's claim that still holds", async () => {
    const { host, session, state } = await ticking()
    const theirs = fetchClaim("other", state.now - 1_000)
    state.store[claimKey(ME)] = theirs

    await refresh(host, session, false)
    await Promise.all(state.work)

    expect(state.store[claimKey(ME)]).toEqual(theirs)
  })

  test("an answer shared says when its request went out and when it came", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const { host, session, state } = await ticking(options)
    options.fetchMs = 5_000
    const start = state.now

    await refresh(host, session, false)

    expect(state.store[KEY]).toMatchObject({ requestedAt: start, fetchedAt: start + 5_000 })
    expect(session.checks.requestedAt).toBe(start)
    expect(state.list?.fetchedAt).toBe(start + 5_000)
  })

  test("an answer GitHub sent this session that can't be read is its problem, and goes to no other session", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const { host, calls, session, state } = await ticking(options)
    const shared = state.store[KEY]
    options.listAnswer = JSON.stringify({ errors: [{ message: "nope" }] })

    await refresh(host, session, false)

    expect(state.problem).toContain("nope")
    expect(calls).not.toContain("share")
    expect(state.store[KEY]).toBe(shared)
  })

  test("the look asks nothing once a claim it waited on lapses, where the person's refresh asked GitHub since", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const { host, calls, session, state, tick, look } = await ticking(options)
    state.store[claimKey(ME)] = fetchClaim("other", state.now - 5_000)
    await tick()
    // Its answer is too large to share, so only the session knows when it asked.
    options.list = { mine: [{ number: 1, title: "x".repeat(160_000) }] }
    state.now += 1_000
    await refresh(host, session, false)
    calls.length = 0

    // Past the claim's 35 s.
    state.now += 29_000
    await look()

    expect(calls).not.toContain("gh api graphql")
  })

  test("what the person asks for asks GitHub, even with a newer answer shared", async () => {
    const { host, calls, state, session } = await ticking()
    state.store[KEY] = sharedBy("other", state.now - 30_000)

    await refresh(host, session, false)

    expect(calls).toContain("gh api graphql")
    expect(state.list?.mine).toEqual([])
  })

  test("a refresh asked while another session's answer is read waits for it, then asks GitHub", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await ticking(options)
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 30_000)
    const { isAtGate, open } = gateLoads(options)

    fixture.state.timers[0]!.tick()
    await isAtGate
    const asked = refresh(fixture.host, fixture.session, false)
    options.gate = undefined
    open()
    await Promise.all([asked, ...fixture.state.work])

    // One request for the lists, after the adopted list was shown; the other asks how the pull request it had ended.
    const lists = fixture.state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))
    expect(lists).toHaveLength(1)
    expect(fixture.calls.indexOf("gh api graphql")).toBeGreaterThan(fixture.calls.indexOf("showList"))
    expect(fixture.state.list?.mine).toEqual([])
  })

  test("a refresh asked while another session's answer is read, which fails, still asks GitHub", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await ticking(options)
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 30_000)
    const { isAtGate, open } = gateLoads(options)

    fixture.state.timers[0]!.tick()
    await isAtGate
    const asked = refresh(fixture.host, fixture.session, false)
    options.gate = undefined
    options.mergedFailures = 1
    open()
    await asked

    expect(fixture.state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
    expect(fixture.state.list?.mine).toEqual([])
  })

  test("with sharing off, a tick asks GitHub, alerts what changed, and leaves the store alone", async () => {
    const options: Parameters<typeof hostWith>[0] = { list: { mine: [{ number: 1, ci: "SUCCESS" }] } }
    const { calls, state, tick } = await ticking(options, { shareRefresh: false })
    state.store[KEY] = sharedBy("other", state.now - 30_000)
    options.list = { mine: [{ number: 1, ci: "FAILURE" }] }

    await tick()

    expect(calls).toContain("gh api graphql")
    expect(calls).toContain("announce")
    expect(calls).not.toContain("claim")
    expect(state.store[KEY]).toEqual(sharedBy("other", state.now - 30_000))
  })

  test("a session whose answer is too large to share claims none of its requests, until one fits again", async () => {
    const huge = { mine: [{ number: 1, title: "x".repeat(160_000) }] }
    const options: Parameters<typeof hostWith>[0] = { list: huge }
    const { calls, state, tick } = await ticking(options)
    expect(state.logs).toEqual(["The list of acme/app is too large to share with other sessions."])

    await tick()
    expect(calls).not.toContain("claim")
    expect(calls).toContain("gh api graphql")
    expect(state.store[KEY]).toBeUndefined()

    options.list = open()
    calls.length = 0
    state.now += 3 * 60_000
    await tick()
    // Claims start again once an answer that fits is shared: the next request before it goes out, and its answer.
    expect(calls).not.toContain("claim")
    state.now += 3 * 60_000
    await tick()
    expect(calls.filter((call) => call === "claim")).toHaveLength(2)
    expect(state.logs).toHaveLength(1)
  })

  test("an answer shared for another person is never taken, nor waited for", async () => {
    const { calls, state, tick } = await ticking()
    const theirs = audienceId({ name: "acme/app", host: "github.com" }, "you")
    state.store[sharedKey(theirs)] = { ...sharedBy("other", state.now - 30_000), viewer: "you" }
    state.store[claimKey(theirs)] = { ...fetchClaim("other", state.now - 1_000), viewer: "you" }

    await tick()

    expect(calls.slice(0, 2)).toEqual(["claim", "gh api graphql"])
    expect(state.list?.mine).toEqual([])
  })

  test("an answer another session shared that this one can't read is logged, shows no problem, and GitHub is asked in its place", async () => {
    // Its own answers refused, the store keeps the other session's, which the looks find again.
    const options: HostOptions = { isShareRefused: true }
    const { state, tick, look } = await ticking(options)
    const lists = () => state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))
    const unreadableAt = (requestedAt: number) => ({
      ...sharedBy("other", requestedAt),
      answer: { errors: [{ message: "nope" }] }
    })
    state.store[KEY] = unreadableAt(state.now - 30_000)

    await tick()
    expect(lists()).toHaveLength(1)
    expect(state.list?.fetchedAt).toBe(state.now)
    expect(state.problem).toBeNull()
    expect(state.logs).toEqual(["The list another session read could not be read here: nope"])

    // That session's answers are left alone from now on, the next one too.
    state.store[KEY] = unreadableAt(state.now + 15_000)
    state.now += 20_000
    await look()
    expect(lists()).toHaveLength(1)
    // And its claims: a tick that finds one asks GitHub rather than wait for an answer it couldn't read.
    state.now += 20_000
    state.store[claimKey(ME)] = fetchClaim("other", state.now)
    await tick()
    expect(lists()).toHaveLength(2)
    expect(state.logs).toHaveLength(1)
  })

  test("an answer this session can't read is not taken again where GitHub, asked in its place, fails too", async () => {
    const options: HostOptions = {}
    const { state, tick, look } = await ticking(options)
    state.store[KEY] = { ...sharedBy("other", state.now - 30_000), answer: { errors: [{ message: "nope" }] } }
    options.listAnswer = JSON.stringify({ errors: [{ message: "down" }] })

    await tick()
    for (let looked = 0; looked < 3; looked++) {
      state.now += 20_000
      await look()
    }

    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
    expect(state.problem).toContain("down")
    expect(state.logs).toEqual(["The list another session read could not be read here: nope"])
  })

  test("a look that finds an answer this session can't read asks GitHub in its place, claimed, the timers keeping their beat", async () => {
    const { session, state, look } = await ticking()
    state.store[KEY] = { ...sharedBy("other", state.now - 5_000), answer: { errors: [{ message: "nope" }] } }

    await look()

    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
    expect(state.store[claimKey(ME)]).toMatchObject({ by: session.id })
    // Starting over from here would put this session's requests just after the other's, whose ticks would then find
    // them nearly an interval old and ask GitHub too.
    expect(state.timers.map(({ ms, isCancelled }) => [ms, isCancelled])).toEqual([
      [3 * 60_000, false],
      [20_000, false]
    ])
  })

  test("a refresh asked for while GitHub is asked in place of an answer this session can't read joins that request", async () => {
    const fixture = await ticking()
    const { host, session, state } = fixture
    state.store[KEY] = { ...sharedBy("other", state.now - 30_000), answer: { errors: [{ message: "nope" }] } }
    fixture.hold()

    const ticked = fixture.tick()
    await fixture.isReached
    const pressed = refresh(host, session, false)
    fixture.release()
    await Promise.all([ticked, pressed, ...state.work])

    expect(state.runs.filter((argv) => argv.some((arg) => arg.startsWith("mine=")))).toHaveLength(1)
  })
})

describe("sharing, where loads and timers cross", () => {
  const KEY = sharedKey(ME)

  async function shownAt(options: Parameters<typeof hostWith>[0] = {}) {
    const fixture = hostWith(options)
    const session = sessionOf()
    await refresh(fixture.host, session, false)
    await ensurePolling(fixture.host, session)
    fixture.calls.length = 0
    fixture.state.runs.length = 0
    fixture.state.now = 4 * 60_000

    return { ...fixture, session }
  }

  test("an answer found newer than the list, but older than one read since, never replaces it", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await shownAt(options)
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 30_000)
    const { isAtGate, open } = gateSharedReads(options)

    // The look reads the list shown and the shared answer, and waits while a refresh reads a newer list.
    fixture.state.timers[1]!.tick()
    await isAtGate
    options.sharedGate = undefined
    await refresh(fixture.host, fixture.session, false)
    open()
    await Promise.all(fixture.state.work)

    expect(fixture.state.list?.fetchedAt).toBe(fixture.state.now)
    expect(fixture.state.list?.mine).toEqual([])
    expect(fixture.session.checks.requestedAt).toBe(fixture.state.now)
  })

  test("an answer to a request that went out before a list read since never replaces it, though it came after", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await shownAt(options)
    const { state } = fixture
    state.store[KEY] = { ...sharedBy("other", state.now - 10_000), fetchedAt: state.now + 1_000 }
    const { isAtGate, open } = gateSharedReads(options)

    // The look finds the answer newer than the list shown, and waits while a refresh reads a list before it came.
    state.timers[1]!.tick()
    await isAtGate
    options.sharedGate = undefined
    const refreshedAt = state.now
    await refresh(fixture.host, fixture.session, false)
    state.now += 2_000
    open()
    await Promise.all(state.work)

    expect(state.list?.fetchedAt).toBe(refreshedAt)
    expect(state.list?.mine).toEqual([])
  })

  test("an answer found while the person's refresh runs joins it, and what it finds is alerted", async () => {
    const options: Parameters<typeof hostWith>[0] = { list: { mine: [{ number: 1, ci: "SUCCESS" }] } }
    const fixture = await shownAt(options)
    options.list = { mine: [{ number: 1, ci: "FAILURE" }] }
    const { isAtGate, open } = gateLoads(options)
    const asked = refresh(fixture.host, fixture.session, false)
    await isAtGate
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 30_000)

    fixture.state.timers[1]!.tick()
    await promisesRun()
    options.gate = undefined
    open()
    await Promise.all([asked, ...fixture.state.work])

    expect(fixture.calls.filter((call) => call === "announce")).toHaveLength(1)
  })

  test("an answer found as the person's refresh ends joins it, and what that refresh found is alerted", async () => {
    const options: Parameters<typeof hostWith>[0] = { list: { mine: [{ number: 1, ci: "SUCCESS" }] } }
    const fixture = await shownAt(options)
    options.list = { mine: [{ number: 1, ci: "FAILURE" }] }
    let open = (): void => undefined
    options.markedOffGate = new Promise<void>((resolve) => (open = resolve))
    const isMarkedOff = new Promise<void>((resolve) => (options.atMarkedOff = resolve))
    const asked = refresh(fixture.host, fixture.session, false)
    await isMarkedOff
    options.markedOffGate = undefined
    // Asked for after the person's request went out.
    fixture.state.now += 5_000
    fixture.state.store[KEY] = sharedBy("other", fixture.state.now - 3_000, { mine: [{ number: 1, ci: "FAILURE" }] })

    fixture.state.timers[1]!.tick()
    await promisesRun()
    open()
    await Promise.all([asked, ...fixture.state.work])

    expect(fixture.state.toasts).toEqual(["✗ #1 Pull request 1 — CI failed"])
    expect(fixture.state.changes).toEqual(["✗ #1 Pull request 1 — CI failed"])
  })

  test("timers that fired with another session's, which claimed meanwhile, start over so they stop firing together", async () => {
    const options: Parameters<typeof hostWith>[0] = {}
    const fixture = await shownAt(options)
    const { isAtGate, open } = gateLoads(options)

    fixture.state.timers[0]!.tick()
    await isAtGate
    fixture.state.store[claimKey(ME)] = fetchClaim("other", fixture.state.now)
    options.gate = undefined
    open()
    await Promise.all(fixture.state.work)

    expect(fixture.state.timers.map(({ ms, isCancelled }) => [ms, isCancelled])).toEqual([
      [3 * 60_000, true],
      [20_000, true],
      [3 * 60_000, false],
      [20_000, false]
    ])
    expect(fixture.session.checks.timer).not.toBeNull()
  })
})
