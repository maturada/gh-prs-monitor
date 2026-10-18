// Author: David Matura
//
// Several sessions of the real refresh.ts/shared.ts over one simulated store, a simulated GitHub, and a virtual clock.
// The host as register.tsx builds it (`isReplaced` before a load's writes).
// Every host call takes virtual time, so the interleavings are those the awaits allow, ordered by random latencies.

import { holdAlerts } from "../C/hooks/alerts"
import { storedSnapshot } from "../C/hooks/pulls"
import { checkAgain, checkShared, ensurePolling, isCheckingMode, refresh, refreshAfterWrite, retry } from "../C/hooks/refresh"
import type { RefreshHost } from "../C/hooks/refresh"
import { createSession } from "../C/hooks/session"
import type { Session } from "../C/hooks/session"
import { readSettings } from "../C/hooks/settings"
import type { SharedAnswer } from "../C/hooks/shared"
import { claimFetch, notShownElsewhere, recallClaim, recallLook, recallShared, rememberLook, shareAnswer } from "../C/hooks/store"
import type { StoreHost } from "../C/hooks/store"
import { response } from "../C/hooks/testing/fixtures"
import type { PullFixture, ResponseFixture } from "../C/hooks/testing/fixtures"

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ev = { at: number; seq: number; fn: () => void }

// A call into the engine by a module a reload replaced: the engine ends such a module's runs (World.reload).
export class Unloaded extends Error {}

// What a load of the module reaches, failing once that load is gone, and before a call returns into it again; `own`
// names the module's own functions among them (register.tsx's `background`), which are no calls into the engine. The
// check after a call takes a step of its own, which orders same-instant work differently, so a world without reloads
// goes without it and stays as it ran before reloads were checked.
function liveOnly<T extends object>(target: T, isLoaded: () => boolean, own: readonly string[] = []): T {
  const check = () => {
    if (!isLoaded()) throw new Unloaded("module replaced")
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(target)) {
    out[key] =
      typeof value !== "function" || own.includes(key)
        ? value
        : (...args: unknown[]) => {
            check()
            const result = value(...args)
            return result instanceof Promise ? result.then((v) => (check(), v)) : result
          }
  }
  return out as T
}

export class Clock {
  now = 1_800_000_000_000
  private seq = 0
  private heap: Ev[] = []
  // A laptop asleep from `from` to `to`: whatever falls due meanwhile runs at `to`, spread by `spread`.
  sleepWindow: { from: number; to: number; spread: () => number } | null = null

  push(at: number, fn: () => void): void {
    const ev = { at, seq: this.seq++, fn }
    const heap = this.heap
    heap.push(ev)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(heap[p]!, heap[i]!)) break
      ;[heap[p], heap[i]] = [heap[i]!, heap[p]!]
      i = p
    }
  }

  private pop(): Ev | undefined {
    const heap = this.heap
    if (heap.length === 0) return undefined
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
        i = m
      }
    }
    return top
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.push(this.now + Math.max(0, ms), resolve))
  }

  async runUntil(until: number): Promise<void> {
    for (;;) {
      const head = this.heap[0]
      if (!head || head.at > until) break
      const ev = this.pop()!
      const w = this.sleepWindow
      if (w && ev.at >= w.from && ev.at < w.to) {
        this.push(w.to + w.spread(), ev.fn)
        continue
      }
      this.now = Math.max(this.now, ev.at)
      ev.fn()
      await drain()
    }
    this.now = Math.max(this.now, until)
  }
}

function less(a: Ev, b: Ev): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq)
}

export async function drain(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

// GitHub: a list of review requests that grows; PR #1's title carries the version, so a list says which state it is.
export class GitHub {
  version = 0
  states: { at: number; requested: number[]; ci: string; isDraft: boolean }[]
  listRequests: { session: string; start: number; end: number; version: number }[] = []
  constructor(private clock: Clock) {
    this.states = [{ at: clock.now, requested: [], ci: "SUCCESS", isDraft: false }]
  }
  current() {
    return this.states[this.states.length - 1]!
  }
  change(f: (s: { requested: number[]; ci: string; isDraft: boolean }) => void): number {
    const next = { ...this.current(), requested: [...this.current().requested], at: this.clock.now }
    f(next)
    this.states.push(next)
    this.version = this.states.length - 1
    return this.version
  }
  fixture(version: number): ResponseFixture {
    const s = this.states[version]!
    const mine: PullFixture[] = [{ number: 1, title: `v${version}`, ci: s.ci, isDraft: s.isDraft }]
    return {
      mine,
      requested: s.requested.map((n) => ({ number: n, author: "ann", requested: ["me"] }))
    }
  }
}

export type Toast = { session: string; at: number; line: string }

// The engine's store: each call one at a time per process; a write locks the file across processes.
export class Store {
  data: Record<string, string> = {}
  private lockHeld = false
  private lockWaiters: (() => void)[] = []
  writes = 0
  lockFailures = 0
  constructor(
    private clock: Clock,
    private readMs: () => number,
    private writeMs: () => number,
    private retryMs: () => number
  ) {}

  private async lock(): Promise<void> {
    // proper-lockfile: retries 10 times, 5 ms growing to 100 ms; about 0.65 s in all.
    const started = this.clock.now
    while (this.lockHeld) {
      if (this.clock.now - started > 650) {
        this.lockFailures++
        throw new Error("Lock file is already being held")
      }
      await new Promise<void>((resolve) => {
        this.lockWaiters.push(resolve)
        this.clock.push(this.clock.now + this.retryMs(), resolve)
      })
    }
    this.lockHeld = true
  }
  private unlock(): void {
    this.lockHeld = false
    const waiters = this.lockWaiters
    this.lockWaiters = []
    for (const w of waiters) w()
  }

  async get(key: string): Promise<unknown> {
    await this.clock.sleep(this.readMs())
    const text = this.data[key]
    return text === undefined ? undefined : JSON.parse(text)
  }
  async keys(): Promise<string[]> {
    await this.clock.sleep(this.readMs())
    return Object.keys(this.data)
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.lock()
    try {
      await this.clock.sleep(this.writeMs())
      this.data[key] = JSON.stringify(value)
      this.writes++
    } finally {
      this.unlock()
    }
  }
  async delete(key: string): Promise<void> {
    await this.lock()
    try {
      await this.clock.sleep(this.writeMs())
      delete this.data[key]
      this.writes++
    } finally {
      this.unlock()
    }
  }
}

// One process's view of the store: its calls one at a time (`ct(r)` in the engine).
function serialStore(store: Store) {
  let chain: Promise<unknown> = Promise.resolve()
  const one = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => undefined)
    return next
  }
  return {
    get: (key: string) => one(() => store.get(key)),
    keys: () => one(() => store.keys()),
    set: (key: string, value: unknown) => one(() => store.set(key, value)),
    delete: (key: string) => one(() => store.delete(key))
  }
}

export type SimSession = {
  name: string
  session: Session
  host: RefreshHost
  list: ReturnType<typeof storedSnapshot>
  shown: { at: number; version: number; fetchedAt: number }[]
  timers: { ms: number; isCancelled: boolean }[]
  errors: string[]
  logs: string[]
  isDrawn: boolean
  isPaneOpen: boolean
  loads: { start: number; end: number | null }[]
  reloads?: number
  // The module's loads: the current one, how many hooks of each still run (a reload waits for them), and the runs a
  // reload ended.
  generation: number
  dispatching: Map<number, number>
  aborted: number
  makeHost: (generation: number) => { host: RefreshHost; store: StoreHost }
  isWorking: boolean
  gone: boolean
  // When each of its timers fired, to tell which made a request.
  fired?: { ms: number; at: number }[]
  store?: StoreHost
}

export type WorldOptions = {
  seed: number
  fetchMs: (r: () => number) => number
  storeReadMs?: (r: () => number) => number
  storeWriteMs?: (r: () => number) => number
  // Engine dispatch time of a timer's next period after it fired.
  timerOverheadMs?: (r: () => number) => number
  // Where in its request GitHub reads the state, from its start.
  captureMs?: number
  // The closed lookup's time.
  closedMs?: (r: () => number) => number
  // How often the list's write (showList) throws, so the load's present step fails.
  showThrowRate?: number
  // Each session's clock ahead of the true time by this much (by session index).
  skewMs?: number[]
  // Timers stop counting while asleep (each fires its remaining time after the wake), rather than firing at wake.
  sleepSuspend?: boolean
  // Every session's clock steps by `delta` at true time `at` (one clock, as on one machine).
  clockStep?: { at: number; delta: number }
  // A timer's fire is late by `ms` this often (a busy machine).
  stall?: { rate: number; ms: (r: () => number) => number }
  // Called at each timer fire, before and after its callback, in the same instant.
  onFire?: (sim: SimSession, ms: number, when: "before" | "after") => void
  // Whether the store refuses this share (the set throws), by true time and session.
  shareFail?: (at: number, session: string) => boolean
  // A store read stalls this often by `ms` (a busy machine or file system).
  readStall?: { rate: number; ms: (r: () => number) => number }
  // Whether sessions reload (World.reload): only then are a module's calls checked for a reload.
  isReloading?: boolean
  // Sessions in this many repositories, session i in acme/r<i % repos> (one store, one GitHub state).
  repos?: number
}

export class World {
  clock = new Clock()
  r: () => number
  github: GitHub
  store: Store
  sessions: SimSession[] = []
  toasts: Toast[] = []
  shareCalls: { session: string; at: number; requestedAt: number }[] = []
  shareLanded: { session: string; at: number; requestedAt: number }[] = []
  shareRefused: { session: string; at: number; requestedAt: number }[] = []
  claims: { session: string; at: number; asked: number; trueAt: number }[] = []
  reloadTimes: { session: string; at: number }[] = []
  drawnLog: { session: string; at: number; isDrawn: boolean }[] = []
  showThrows = 0
  work: Promise<unknown>[] = []
  constructor(public options: WorldOptions) {
    this.r = rng(options.seed)
    this.github = new GitHub(this.clock)
    const r = this.r
    this.store = new Store(
      this.clock,
      () => (options.storeReadMs ? options.storeReadMs(r) : 0.3 + 2 * r()) + (options.readStall && r() < options.readStall.rate ? options.readStall.ms(r) : 0),
      () => (options.storeWriteMs ? options.storeWriteMs(r) : 1 + 6 * r()),
      // A stream of its own, so a run's other draws are as they were without lock waits, and a seed repeats exactly.
      ((retry) => () => 5 + 20 * retry())(rng(options.seed * 7919 + 1))
    )
  }

  tiny(): Promise<void> {
    return this.clock.sleep(0.02 + 0.3 * this.r())
  }

  addSession(name: string, settings: Record<string, unknown> = {}): SimSession {
    const world = this
    const clock = this.clock
    const r = this.r
    const $store = serialStore(this.store)
    const session = createSession(readSettings({ cleanupWorktrees: false, ...settings } as never))
    session.id = name
    const sim: SimSession = {
      name,
      session,
      host: null as unknown as RefreshHost,
      list: null,
      shown: [],
      timers: [],
      errors: [],
      logs: [],
      isDrawn: true,
      isPaneOpen: true,
      loads: [],
      generation: 0,
      dispatching: new Map(),
      aborted: 0,
      makeHost: null as never,
      isWorking: false,
      gone: false
    }
    const ok = (stdout: string) => ({
      exitCode: 0,
      stdout,
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false
    })
    const versionOf = (snapshot: { mine: { title: string }[] } | null) =>
      snapshot && snapshot.mine[0] ? Number(snapshot.mine[0].title.slice(1)) : -1
    // One load of the module: what it reaches through the engine, which fails once a reload replaced that load and no
    // hook of it still runs.
    const hostFor = (generation: number) => {
      const isLoaded = () => sim.generation === generation || (sim.dispatching.get(generation) ?? 0) > 0
      const own = sim.session
      // register.tsx's `isReplaced`: the `module` mark a newer load wrote at its start, read from the session's state.
      const isReplaced = async () => {
        await world.tiny()
        return sim.generation !== generation
      }
      // The plugin's store as register.tsx hands it in (`storeOf`): this process's calls one at a time, the session's own
      // clock, its debug log; a share refused where the engine's store would refuse it.
      const store: StoreHost = {
        get: (key) => $store.get(key),
        keys: () => $store.keys(),
        delete: (key) => $store.delete(key),
        set: async (key, value) => {
          const requestedAt = (value as SharedAnswer).requestedAt
          if (key.startsWith("shared:") && world.options.shareFail?.(clock.now, name)) {
            await clock.sleep(5)
            world.shareRefused.push({ session: name, at: clock.now, requestedAt })
            throw new Error("refused")
          }
          await $store.set(key, value)
          if (key.startsWith("shared:")) {
            world.shareLanded.push({ session: name, at: clock.now, requestedAt })
          }
        },
        now: () => host.now(),
        log: (line) => void sim.logs.push(line)
      }
      const liveStore = world.options.isReloading ? liveOnly(store, isLoaded) : store
      const repoName = () => world.options.repos ? `acme/r${world.sessions.indexOf(sim) % world.options.repos}` : "acme/app"
      const host: RefreshHost = {
        run: async (argv, init) => {
          if (sim.gone) throw new Error("session gone")
          if (argv[0] === "git") {
            await clock.sleep(3 + 10 * r())
            return ok("main-head\nrefs/heads/main\n")
          }
          if (argv[1] === "repo") {
            await clock.sleep(300 + 300 * r())
            return ok(`${repoName()} https://github.com/${repoName()}\n`)
          }
          if (argv.some((arg) => arg.includes("CLOSED_EVENT"))) {
            const takes = world.options.closedMs ? world.options.closedMs(r) : 500 + 1500 * r()
            // The engine ends a run at its timeout, as the plugin asks (`timeoutMs`).
            const timeoutMs = (init as { timeoutMs?: number } | undefined)?.timeoutMs ?? Infinity
            await clock.sleep(Math.min(takes, timeoutMs))
            if (takes > timeoutMs) throw new Error("timed out")
            const query = argv.find((arg) => arg.startsWith("query=")) ?? ""
            const repository: Record<string, unknown> = {}
            for (const match of query.matchAll(/pullRequest\(number: (\d+)\)/g)) {
              const number = Number(match[1])
              repository[`p${number}`] = { number, state: "MERGED", mergedBy: { login: "bob" }, headRefOid: "x" }
            }
            return ok(JSON.stringify({ data: { repository } }))
          }
          if (argv.some((arg) => arg.startsWith("mine="))) {
            const start = clock.now
            const total = world.options.fetchMs(r)
            const capture = Math.min(total, world.options.captureMs ?? 50)
            await clock.sleep(capture)
            const version = world.github.version
            await clock.sleep(total - capture)
            world.github.listRequests.push({ session: name, start, end: clock.now, version })
            return ok(response({ ...world.github.fixture(version), nameWithOwner: repoName() }))
          }
          throw new Error(`unexpected ${argv.join(" ")}`)
        },
        read: async () => "",
        write: async () => undefined,
        exists: async () => false,
        list: async () => [],
        now: async () => {
          await world.tiny()
          const step = world.options.clockStep
          return clock.now + (world.options.skewMs?.[world.sessions.indexOf(sim)] ?? 0) + (step && clock.now >= step.at ? step.delta : 0)
        },
        after: (ms, fire) => {
          let isCancelled = false
          clock.push(clock.now + ms, () => {
            if (!isCancelled && isLoaded()) fire()
          })
          return { cancel: () => void (isCancelled = true) }
        },
        every: (ms, tick) => {
          const timer = { ms, isCancelled: false }
          sim.timers.push(timer)
          const overhead = () => (world.options.timerOverheadMs ? world.options.timerOverheadMs(r) : 0.5 + 2 * r())
          const arm = (from: number) => {
            let due = from + ms
            const w = clock.sleepWindow
            if (world.options.sleepSuspend && w && from < w.from && due >= w.from) due += w.to - w.from
            const stall = world.options.stall
            if (stall && r() < stall.rate) due += stall.ms(r)
            clock.push(due, () => {
              if (timer.isCancelled || !isLoaded()) return
              ;(sim.fired ??= []).push({ ms, at: clock.now })
              world.options.onFire?.(sim, ms, "before")
              tick()
              world.options.onFire?.(sim, ms, "after")
              arm(clock.now + overhead())
            })
          }
          arm(clock.now)
          return { cancel: () => void (timer.isCancelled = true) }
        },
        background: (work) =>
          void world.work.push(
            work.catch((error: unknown) => world.failed(sim, error))
          ),
        log: (line) => void sim.logs.push(line),
        storedList: async () => {
          await world.tiny()
          return sim.list
        },
        merged: async () => {
          await world.tiny()
          return []
        },
        showList: async (snapshot, checkout) => {
          if (await isReplaced()) return null
          await world.tiny()
          if (sim.gone) throw new Error("session gone")
          if (world.options.showThrowRate && r() < world.options.showThrowRate) {
            world.showThrows++
            throw new Error("state write failed")
          }
          sim.list = snapshot
          sim.shown.push({ at: clock.now, version: versionOf(snapshot), fetchedAt: snapshot.fetchedAt })
          return checkout
        },
        writeProblem: async () => {
          if (await isReplaced()) return
          await world.tiny()
        },
        markLoading: async (isLoading) => {
          if (await isReplaced()) return
          await world.tiny()
          if (isLoading) sim.loads.push({ start: clock.now, end: null })
          else {
            const open = sim.loads.find((l) => l.end === null)
            if (open) open.end = clock.now
          }
        },
        keepActivity: async () => {
          await world.tiny()
        },
        isDemo: async () => false,
        recall: (repo) => recallLook(liveStore, repo),
        remember: (repo, snapshot) => rememberLook(liveStore, repo, snapshot),
        isDrawn: async () => {
          await world.tiny()
          return sim.isDrawn
        },
        isPaneOpen: async () => {
          await world.tiny()
          return sim.isPaneOpen
        },
        isPaneShown: async () => {
          await world.tiny()
          return sim.isPaneOpen
        },
        setStatus: async () => {
          await world.tiny()
        },
        clearStatus: async () => {
          await isReplaced()
        },
        notify: async () => undefined,
        // announce → holdAlerts → show → notShownElsewhere, as register.tsx has it.
        announce: async (repo, lines) => {
          await world.tiny()
          const now = clock.now
          const isHolding = own.settings.isHoldingWhileWorking && sim.isWorking
          const { shown, waiting } = holdAlerts(own.alerts, lines, now, isHolding)
          own.alerts = waiting
          if (shown.length > 0) await world.show(sim, liveStore, repo, shown)
        },
        lookUpBranch: async () => undefined,
        cleanUp: async () => undefined,
        recallShared: (repo, viewer) => recallShared(liveStore, repo, viewer),
        shareAnswer: (repo, shared) => {
          world.shareCalls.push({ session: name, at: clock.now, requestedAt: shared.requestedAt })
          return shareAnswer(liveStore, repo, shared)
        },
        recallClaim: (repo, viewer) => recallClaim(liveStore, repo, viewer),
        claimFetch: (repo, claim) => {
          world.claims.push({ session: name, at: claim.at, asked: claim.asked, trueAt: clock.now })
          return claimFetch(liveStore, repo, claim)
        }
      }
      return world.options.isReloading
        ? { host: liveOnly(host, isLoaded, ["background"]), store: liveStore }
        : { host, store }
    }
    sim.makeHost = hostFor
    ;({ host: sim.host, store: sim.store } = hostFor(0))
    this.sessions.push(sim)
    return sim
  }

  // As register.tsx's `show` has it: the lines no other session showed lately (`notShownElsewhere`), each a toast.
  async show(sim: SimSession, store: StoreHost, repo: { host: string; name: string }, lines: readonly string[]): Promise<void> {
    const fresh = await notShownElsewhere(store, repo, lines, { by: sim.session.id, pollMs: sim.session.settings.pollMs })
    for (const line of fresh) this.toasts.push({ session: sim.name, at: this.clock.now, line })
  }

  // A turn starts and ends: alerts held meanwhile show at its end (release).
  turnStart(sim: SimSession): void {
    sim.isWorking = true
  }
  turnEnd(sim: SimSession): void {
    sim.isWorking = false
    const session = sim.session
    if (session.alerts.held.length === 0 || !session.repo) return
    const held = session.alerts.held
    session.alerts = { held: [], heldSince: null }
    this.work.push(this.show(sim, sim.store!, session.repo, held).catch((e) => this.failed(sim, e)))
  }

  // A run a reload ended is no error: the engine ends a replaced module's runs.
  failed(sim: SimSession, error: unknown): void {
    if (error instanceof Unloaded) sim.aborted++
    else sim.errors.push(String(error))
  }

  // The session ends: its timers stop and its calls fail.
  leave(sim: SimSession): void {
    sim.gone = true
    sim.isDrawn = false
    for (const timer of sim.timers) timer.isCancelled = true
  }

  // What session.start does in background mode: a first load, and the timers.
  start(sim: SimSession): void {
    this.work.push(refresh(sim.host, sim.session, false).catch((e) => this.failed(sim, e)))
    this.work.push(ensurePolling(sim.host, sim.session).catch((e) => this.failed(sim, e)))
  }

  // The Refresh button.
  press(sim: SimSession): void {
    this.work.push(retry(sim.host, sim.session).catch((e) => this.failed(sim, e)))
  }

  // A write from the pane (a re-run, mark ready, ...): GitHub takes it, then the list is refreshed after it.
  write(sim: SimSession, change: Parameters<GitHub["change"]>[0], onApplied?: (version: number) => void): void {
    const { host, session } = sim
    const run = async () => {
      await this.clock.sleep(400 + 800 * this.r())
      const version = this.github.change(change)
      onApplied?.(version)
      await refreshAfterWrite(host, session)
    }
    this.work.push(run().catch((e) => this.failed(sim, e)))
  }

  // session.attach, as register.tsx has it.
  attach(sim: SimSession): void {
    sim.isDrawn = true
    this.drawnLog.push({ session: sim.name, at: this.clock.now, isDrawn: true })
    const { host, session } = sim
    if (session.checks.timer) {
      if (session.settings.isSharingRefreshes) {
        this.work.push(checkShared(host, session).catch((e) => this.failed(sim, e)))
      }
      return
    }
    session.checks.isReturning = session.checks.wasDetached
    session.checks.wasDetached = false
    const go = async () => {
      if (await isCheckingMode(host, session)) {
        this.work.push(refresh(host, session, false).catch((e) => this.failed(sim, e)))
      }
      await ensurePolling(host, session)
    }
    this.work.push(go().catch((e) => this.failed(sim, e)))
  }

  // openPane: a load now, the timer after.
  openPane(sim: SimSession): void {
    sim.isPaneOpen = true
    const { host, session } = sim
    const go = async () => {
      checkAgain(host, session)
      await session.checks.marking?.catch(() => undefined)
      await ensurePolling(host, session)
    }
    this.work.push(go().catch((e) => this.failed(sim, e)))
  }

  // A hot reload, as the engine does it: the old module is unloaded at once, its timers end and its runs fail at their
  // next call into the engine, unless one of its hooks still runs (`print`), which keeps it loaded until it returns.
  // The new module starts with the session's state (its list) and the same session id, and clears the loading mark
  // (`clearLeftovers`).
  reload(sim: SimSession): void {
    for (const timer of sim.timers) timer.isCancelled = true
    const old = sim.session
    const session = createSession(old.settings)
    session.id = old.id
    sim.session = session
    sim.generation++
    ;({ host: sim.host, store: sim.store } = sim.makeHost(sim.generation))
    sim.reloads = (sim.reloads ?? 0) + 1
    this.reloadTimes.push({ session: sim.name, at: this.clock.now })
    for (const load of sim.loads) if (load.end === null) load.end = this.clock.now
    if (session.settings.refresh === "background" || (!sim.list && sim.isPaneOpen)) {
      this.work.push(refresh(sim.host, session, false).catch((e) => this.failed(sim, e)))
    }
    this.work.push(ensurePolling(sim.host, session).catch((e) => this.failed(sim, e)))
  }

  // `/prs` where nothing draws the pane: its hook awaits a load, so a reload meanwhile leaves this module loaded until
  // the load ends.
  print(sim: SimSession): void {
    const { host, session, generation } = sim
    sim.dispatching.set(generation, (sim.dispatching.get(generation) ?? 0) + 1)
    const done = () => sim.dispatching.set(generation, sim.dispatching.get(generation)! - 1)
    this.work.push(refresh(host, session, false).finally(done).catch((e) => this.failed(sim, e)))
  }

  liveTimers(sim: SimSession): number[] {
    return sim.timers.filter((t) => !t.isCancelled).map((t) => t.ms)
  }
}

// A session's list stepping back: a GitHub state older than one it showed before.
export function stepBacks(sim: SimSession): { at: number; from: number; to: number }[] {
  const backs: { at: number; from: number; to: number }[] = []
  let best = -1
  for (const s of sim.shown) {
    if (s.version < best) backs.push({ at: s.at, from: best, to: s.version })
    best = Math.max(best, s.version)
  }
  return backs
}

// What set off a request: the look (the 20 s timer), the tick (the interval's), or something else (a first load,
// a press, a write, an attach), by the timer of that session that fired last within `windowMs` before it.
export function causeOf(sim: SimSession, start: number, windowMs = 200): "look" | "tick" | "other" {
  let best: { ms: number; at: number } | null = null
  for (const f of sim.fired ?? []) if (f.at <= start && start - f.at < windowMs && (!best || f.at >= best.at)) best = f
  return !best ? "other" : best.ms === 20_000 ? "look" : "tick"
}
