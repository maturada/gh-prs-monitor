// Author: David Matura
//
import { stepBacks, World } from "./world"
import type { SimSession } from "./world"

export type Scenario = {
  seed: number
  sessions: number
  // Start offsets in ms; random within `startSpreadMs` when left out.
  offsets?: number[]
  startSpreadMs?: number
  hours?: number
  isSharing?: boolean
  fetchMs?: (r: () => number) => number
  storeReadMs?: (r: () => number) => number
  storeWriteMs?: (r: () => number) => number
  timerOverheadMs?: (r: () => number) => number
  // GitHub changes (a new review request) about this often.
  changeEveryMs?: number
  // And a listed review request merged by someone else (a "merged by bob" alert, after the lookup of how it ended).
  mergeShare?: number
  // Refresh presses and writes, per session per hour.
  pressesPerHour?: number
  writesPerHour?: number
  // A laptop sleep: from, minutes asleep.
  sleep?: { atMs: number; minutes: number; spreadMs: number }
  // The desktop window closing and opening again, the pane closing and opening (while-open mode), hot reloads; per
  // session per hour.
  detachesPerHour?: number
  paneTogglesPerHour?: number
  reloadsPerHour?: number
  // `/prs` printed (a hook awaiting a load, which a reload lets finish), per session per hour.
  printsPerHour?: number
  mode?: "background" | "while-open"
  closedMs?: (r: () => number) => number
  showThrowRate?: number
  skewMs?: number[]
  // Turns: per session per hour, each lasting turnMs.
  turnsPerHour?: number
  turnMs?: (r: () => number) => number
  holdWhileWorking?: boolean
  // Sessions that end, by index, at this offset from the start.
  leaves?: Record<number, number>
  // Sessions that end at random (per session per hour), never the last one standing.
  leavesPerHour?: number
  // Settings of one session over the rest's, by index.
  perSession?: Record<string, unknown>[]
  sleepSuspend?: boolean
  clockStep?: { atMs: number; deltaMs: number }
  stall?: { rate: number; ms: (r: () => number) => number }
  // The window closes this often per session per hour, and attaches again after `closedMs`, in the same instant as
  // the session's next look ("look") or tick ("tick") fires, before or after it; where the timers stopped meanwhile, a
  // second later.
  attachRace?: { perHour: number; closedMs: (r: () => number) => number; at: "look" | "tick" | "any" }
  onSessions?: (sim: SimSession, now: () => number) => void
  // The world and its sessions before the run, to schedule events of a probe's own.
  onWorld?: (world: World, sims: SimSession[]) => void
  repos?: number
  shareFail?: (at: number, session: string) => boolean
  readStall?: { rate: number; ms: (r: () => number) => number }
  hoursOverride?: number
}

export const usualFetch = (r: () => number) => (r() < 0.03 ? 15_000 + 13_000 * r() : 1_000 + 7_000 * r() * r())

export async function run(s: Scenario) {
  const world = new World({
    seed: s.seed,
    fetchMs: s.fetchMs ?? usualFetch,
    storeReadMs: s.storeReadMs,
    storeWriteMs: s.storeWriteMs,
    timerOverheadMs: s.timerOverheadMs,
    closedMs: s.closedMs,
    showThrowRate: s.showThrowRate,
    skewMs: s.skewMs,
    repos: s.repos,
    sleepSuspend: s.sleepSuspend,
    clockStep: s.clockStep ? { at: 1_800_000_000_000 + s.clockStep.atMs, delta: s.clockStep.deltaMs } : undefined,
    stall: s.stall,
    shareFail: s.shareFail,
    readStall: s.readStall,
    isReloading: (s.reloadsPerHour ?? 0) > 0,
    onFire: s.attachRace
      ? (sim, ms, when) => {
          const pending = attachPending.get(sim)
          if (!pending || world.clock.now < pending.at || pending.which !== ms || pending.when !== when) return
          attachPending.delete(sim)
          world.attach(sim)
        }
      : undefined
  })
  const attachPending = new Map<SimSession, { at: number; which: number; when: "before" | "after" }>()
  const r = world.r
  const clock = world.clock
  const t0 = clock.now
  const hours = s.hours ?? 2
  const end = t0 + hours * 3_600_000
  const settings = {
    ...(s.isSharing === false ? { shareRefresh: false } : {}),
    refresh: s.mode ?? "background",
    ...(s.holdWhileWorking === false ? { holdWhileWorking: false } : {})
  }
  const sims: SimSession[] = []
  for (let i = 0; i < s.sessions; i++) {
    const offset = s.offsets?.[i] ?? (s.startSpreadMs ?? 180_000) * r()
    const sim = world.addSession(`S${i}`, { ...settings, ...(s.perSession?.[i] ?? {}) })
    sims.push(sim)
    s.onSessions?.(sim, () => clock.now)
    clock.push(t0 + offset, () => world.start(sim))
  }
  // GitHub changes.
  const changeEvery = s.changeEveryMs ?? 90_000
  let next = t0 + 240_000
  let number = 100
  const events: { number: number; at: number }[] = []
  const merges: { number: number; at: number }[] = []
  while (next < end - 600_000) {
    const n = number++
    const at = next
    const isMerge = r() < (s.mergeShare ?? 0)
    clock.push(at, () => {
      if (isMerge && world.github.current().requested.length > 3) {
        const gone = world.github.current().requested[0]!
        world.github.change((st) => void st.requested.shift())
        merges.push({ number: gone, at })
      } else {
        world.github.change((st) => st.requested.push(n))
        events.push({ number: n, at })
      }
    })
    next += changeEvery * (0.3 + 1.4 * r())
  }
  // Presses and writes; each must be answered by a request for the lists made after it, or, for a press, by one under
  // way as it came (a press joins a load under way).
  const asks: { session: string; at: number; kind: string }[] = []
  for (const sim of sims) {
    for (const [perHour, kind] of [
      [s.pressesPerHour ?? 0, "press"],
      [s.writesPerHour ?? 0, "write"]
    ] as const) {
      let t = t0 + 300_000
      while (perHour > 0) {
        t += (3_600_000 / perHour) * -Math.log(1 - r())
        if (t > end - 600_000) break
        clock.push(t, () => {
          if (kind === "press") {
            asks.push({ session: sim.name, at: clock.now, kind })
            world.press(sim)
          } else {
            world.write(
              sim,
              (st) => void (st.ci = st.ci === "PENDING" ? "SUCCESS" : "PENDING"),
              () => asks.push({ session: sim.name, at: clock.now, kind })
            )
          }
        })
      }
    }
  }
  const poisson = (perHour: number, each: (sim: SimSession, at: number) => void) => {
    for (const sim of sims) {
      let t = t0 + 300_000
      while (perHour > 0) {
        t += (3_600_000 / perHour) * -Math.log(1 - r())
        if (t > end - 600_000) break
        const at = t
        clock.push(at, () => each(sim, at))
      }
    }
  }
  poisson(s.detachesPerHour ?? 0, (sim) => {
    if (!sim.isDrawn) return
    sim.isDrawn = false
    world.drawnLog.push({ session: sim.name, at: clock.now, isDrawn: false })
    clock.push(clock.now + 5_000 + 400_000 * r() * r(), () => world.attach(sim))
  })
  if (s.attachRace) {
    const race = s.attachRace
    poisson(race.perHour, (sim) => {
      if (!sim.isDrawn || attachPending.has(sim) || sim.gone) return
      sim.isDrawn = false
      world.drawnLog.push({ session: sim.name, at: clock.now, isDrawn: false })
      const which = race.at === "look" ? 20_000 : race.at === "tick" ? 180_000 : r() < 0.5 ? 20_000 : 180_000
      const pending = { at: clock.now + race.closedMs(r), which, when: (r() < 0.5 ? "before" : "after") as "before" | "after" }
      attachPending.set(sim, pending)
      // Timers stopped meanwhile (a tick with nothing drawn): attach plainly.
      const fallback = () => {
        if (attachPending.get(sim) !== pending) return
        if (sim.session.checks.timer) {
          clock.push(clock.now + 1_000, fallback)
          return
        }
        attachPending.delete(sim)
        world.attach(sim)
      }
      clock.push(pending.at + 1_000, fallback)
    })
  }
  poisson(s.paneTogglesPerHour ?? 0, (sim) => {
    if (!sim.isPaneOpen) return
    sim.isPaneOpen = false
    clock.push(clock.now + 5_000 + 400_000 * r() * r(), () => world.openPane(sim))
  })
  poisson(s.reloadsPerHour ?? 0, (sim) => world.reload(sim))
  poisson(s.printsPerHour ?? 0, (sim) => world.print(sim))
  const watchedFrom = new Map<SimSession, number>()
  poisson(s.turnsPerHour ?? 0, (sim) => {
    if (sim.isWorking || sim.gone) return
    world.turnStart(sim)
    clock.push(clock.now + (s.turnMs ? s.turnMs(r) : 30_000 + 600_000 * r() * r()), () => world.turnEnd(sim))
  })
  for (const [index, at] of Object.entries(s.leaves ?? {})) {
    clock.push(t0 + at, () => {
      world.leave(sims[Number(index)]!)
      leftAt.push({ session: sims[Number(index)]!.name, at: clock.now })
    })
  }
  poisson(s.leavesPerHour ?? 0, (sim) => {
    if (sim.gone || sims.filter((one) => !one.gone).length < 2) return
    world.leave(sim)
    leftAt.push({ session: sim.name, at: clock.now })
  })
  if (s.sleep) {
    clock.sleepWindow = {
      from: t0 + s.sleep.atMs,
      to: t0 + s.sleep.atMs + s.sleep.minutes * 60_000,
      spread: () => s.sleep!.spreadMs * r()
    }
  }
  // Sample the lists' ages each second.
  const leftAt: { session: string; at: number }[] = []
  let maxAge = 0
  let watchedMax = 0
  let watchedMaxAt = 0
  let watchedMaxWho = ""
  let watchedOver200 = 0
  let watchedSamples = 0
  let staleMax = 0
  let staleMaxAt = 0
  let staleMaxWho = ""
  const staleSamples: number[] = []
  const isWatched = (sim: SimSession) =>
    !sim.gone && sim.isDrawn && (s.mode !== "while-open" || sim.isPaneOpen)
  const ageFrom = t0 + 420_000
  const sample = () => {
    if (clock.now > ageFrom && !(s.sleep && clock.now < clock.sleepWindow!.to + 60_000 && clock.now > clock.sleepWindow!.from)) {
      for (const sim of sims) {
        if (sim.list && !sim.gone) maxAge = Math.max(maxAge, clock.now - sim.list.fetchedAt)
        if (isWatched(sim)) {
          if (!watchedFrom.has(sim)) watchedFrom.set(sim, clock.now)
        } else watchedFrom.delete(sim)
        // A minute after it is watched again, as attach and opening the pane load first.
        if (sim.list && isWatched(sim) && clock.now - watchedFrom.get(sim)! > 60_000) {
          const age = clock.now - sim.list.fetchedAt
          watchedSamples++
          if (age > 200_000) watchedOver200++
          const v = sim.shown.length ? sim.shown[sim.shown.length - 1]!.version : -1
          const next = world.github.states[v + 1]
          const stale = next && next.at <= clock.now ? clock.now - next.at : 0
          staleSamples.push(stale)
          if (stale > staleMax) {
            staleMax = stale
            staleMaxAt = clock.now
            staleMaxWho = sim.name
          }
          if (age > watchedMax) {
            watchedMax = age
            watchedMaxAt = clock.now
            watchedMaxWho = sim.name
          }
        }
      }
    }
    if (clock.now < end) clock.push(clock.now + 1_000, sample)
  }
  clock.push(t0 + 1_000, sample)

  s.onWorld?.(world, sims)
  await clock.runUntil(end)
  // Let loads under way end (timers keep running meanwhile).
  await clock.runUntil(end + 60_000)

  const P = 180_000
  const requests = world.github.listRequests.filter((q) => q.start >= t0 + 420_000 && q.start < end)
  const windows = Math.floor((end - (t0 + 420_000)) / P)
  const perWindow: number[] = Array.from({ length: windows }, () => 0)
  for (const q of requests) {
    const w = Math.floor((q.start - (t0 + 420_000)) / P)
    if (w < windows) perWindow[w]!++
  }
  const lines = new Map<string, string[]>()
  for (const t of world.toasts) lines.set(t.line, [...(lines.get(t.line) ?? []), t.session])
  const duplicates = [...lines].filter(([, who]) => who.length > 1)
  const mergeLines = [...lines].filter(([line]) => line.includes("merged by bob"))
  const toasted = new Set([...lines.keys()].map((line) => Number(/#(\d+)/.exec(line)?.[1])))
  const lost = events.filter((e) => !toasted.has(e.number))
  const ciToasts = world.toasts.filter((t) => t.line.includes("#1 "))

  return {
    world,
    sims,
    requests: requests.length,
    perWindow,
    windows,
    maxAge,
    stepBacks: sims.flatMap((sim) => stepBacks(sim).map((b) => ({ session: sim.name, ...b }))),
    duplicates,
    lost,
    events,
    ciToasts,
    errors: sims.flatMap((sim) => sim.errors.map((e) => `${sim.name}: ${e}`)),
    aborted: sims.reduce((n, sim) => n + sim.aborted, 0),
    timers: sims.map((sim) => (sim.gone ? "gone" : world.liveTimers(sim).sort((a, b) => a - b).join("+"))),
    // Loads that began before the end and had not ended a minute after it: waits that never resolve.
    unfinishedLoads: sims.flatMap((sim) =>
      sim.loads.filter((l) => l.end === null && l.start < end).map((l) => ({ session: sim.name, ...l }))
    ),
    inFlight: [] as string[],
    lockFailures: world.store.lockFailures,
    merges: merges.length,
    mergeDuplicates: mergeLines.filter(([, who]) => who.length > 1).length,
    mergeToasted: mergeLines.length,
    unanswered: asks.filter((ask) =>
      !world.github.listRequests.some(
        (q) =>
          q.session === ask.session &&
          ((q.start >= ask.at && q.start < ask.at + 120_000) ||
            (ask.kind === "press" && q.start < ask.at && q.end >= ask.at))
      )
    ),
    asks: asks.length,
    watchedMax,
    watchedMaxAt,
    watchedMaxWho,
    watchedOver200,
    watchedSamples,
    leftAt,
    showThrows: world.showThrows,
    staleMax,
    staleMaxAt,
    staleMaxWho,
    staleSamples
  }
}
