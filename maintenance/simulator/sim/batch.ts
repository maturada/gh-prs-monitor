// Author: David Matura
//
// bun batch.ts <world> [seeds] [on|off]: one world's rows (each a mix of sessions run over the seeds), one JSON line
// each, followed by examples of what went wrong. "off" turns sharing between sessions off.
import { run, usualFetch } from "./scenario"
import type { Scenario } from "./scenario"

type Row = Record<string, string | number>

async function batch(name: string, seeds: number, make: (seed: number) => Scenario): Promise<Row> {
  let requests = 0
  let windows = 0
  let maxPerWindow = 0
  let windowsOver1 = 0
  let maxAge = 0
  let stepBacks = 0
  let stepBackRuns = 0
  let duplicates = 0
  let toldTwice = 0
  let lost = 0
  let events = 0
  let errors = 0
  let aborted = 0
  let badTimers = 0
  let unfinished = 0
  let lockFailures = 0
  let unanswered = 0
  let merges = 0
  let mergeDuplicates = 0
  let mergeToasted = 0
  let asks = 0
  let watchedMax = 0
  let watchedOver200 = 0
  let watchedSamples = 0
  let watchedMaxSeed = 0
  const examples: string[] = []
  // The stored looks at each run's end, where sessions work in several repositories.
  const looks = { orphans: 0, dangling: 0, liveMissing: 0, maxListed: 0 }
  for (let seed = 1; seed <= seeds; seed++) {
    const scenario = make(seed)
    const out = await run(scenario)
    if (scenario.repos) {
      const data = out.world.store.data
      const listed: string[] = data.looks ? JSON.parse(data.looks) : []
      const stored = Object.keys(data).filter((key) => key.startsWith("look:"))
      looks.orphans += stored.filter((key) => !listed.includes(key)).length
      looks.dangling += listed.filter((key) => !(key in data)).length
      const live = Array.from({ length: scenario.repos }, (_, index) => `look:github.com/acme/r${index}`)
      const missing = live.filter((key) => !(key in data))
      looks.liveMissing += missing.length
      if (missing.length && examples.length < 8) examples.push(`seed ${seed} live look missing ${missing} listed ${JSON.stringify(listed)}`)
      looks.maxListed = Math.max(looks.maxListed, listed.length)
    }
    requests += out.requests
    windows += out.windows
    maxPerWindow = Math.max(maxPerWindow, ...out.perWindow)
    windowsOver1 += out.perWindow.filter((n) => n > 1).length
    maxAge = Math.max(maxAge, out.maxAge)
    stepBacks += out.stepBacks.length
    if (out.stepBacks.length) {
      stepBackRuns++
      if (examples.length < 3) examples.push(`seed ${seed} stepBack ${JSON.stringify(out.stepBacks[0])}`)
    }
    duplicates += out.duplicates.length
    toldTwice += out.toldTwice.length
    if (out.duplicates.length && examples.length < 6) examples.push(`seed ${seed} dup ${JSON.stringify(out.duplicates[0])}`)
    lost += out.lost.length
    events += out.events.length
    errors += out.errors.length
    aborted += out.aborted
    const expected = scenario.isSharing === false ? "180000" : "20000+180000"
    // A session with the light check runs its timer too.
    const light = `${expected}+${expected.split("+").at(-1)}`
    const isBad = (t: string) => t !== expected && t !== "gone" && !(scenario.lightCheck && t === light)
    badTimers += out.timers.filter(isBad).length
    if (out.timers.some(isBad) && examples.length < 8) examples.push(`seed ${seed} timers ${out.timers}`)
    unfinished += out.unfinishedLoads.length + out.inFlight.length
    lockFailures += out.lockFailures
    unanswered += out.unanswered.length
    merges += out.merges
    mergeDuplicates += out.mergeDuplicates
    mergeToasted += out.mergeToasted
    asks += out.asks
    if (out.watchedMax > watchedMax) {
      watchedMax = out.watchedMax
      watchedMaxSeed = seed
    }
    watchedOver200 += out.watchedOver200
    watchedSamples += out.watchedSamples
    if (out.unanswered.length && examples.length < 8) examples.push(`seed ${seed} unanswered ${JSON.stringify(out.unanswered[0])}`)
  }
  const row = {
    name,
    seeds,
    "req/interval": (requests / windows).toFixed(2),
    maxPerWindow,
    windowsOver1,
    maxAgeS: Math.round(maxAge / 1000),
    watchedMaxS: `${Math.round(watchedMax / 1000)} (seed ${watchedMaxSeed})`,
    "watched>200s": `${((100 * watchedOver200) / Math.max(1, watchedSamples)).toFixed(3)}%`,
    stepBacks,
    stepBackRuns,
    duplicates,
    // Only where the light check runs, so the other rows compare with the baselines made before it was counted.
    ...(make(1).lightCheck ? { toldTwice } : {}),
    lost: `${lost}/${events}`,
    errors,
    // Only where a reload ended runs, so rows without one compare with the baselines made before it was counted.
    ...(aborted ? { aborted } : {}),
    badTimers,
    unfinished,
    lockFailures,
    unanswered: `${unanswered}/${asks}`,
    mergeAlerts: `${mergeDuplicates} doubled of ${mergeToasted} toasted, ${merges} merges`,
    ...(looks.maxListed ? { looks: `orphans ${looks.orphans}, dangling ${looks.dangling}, live missing ${looks.liveMissing}, max listed ${looks.maxListed}` } : {})
  }
  console.log(JSON.stringify(row))
  for (const e of examples) console.log("   ", e)
  return row
}

const which = process.argv[2] ?? "all"
const seeds = Number(process.argv[3] ?? 100)
const isSharing = process.argv[4] !== "off"
const tag = isSharing ? "" : " [sharing off]"
const both = (s: Scenario): Scenario => ({ ...s, isSharing })

if (which === "all" || which === "random") {
  for (const n of [2, 3, 4]) {
    await batch(`random offsets n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n }))
  }
}
if (which === "all" || which === "aligned") {
  for (const n of [2, 3, 4]) {
    await batch(`aligned starts (0-5 ms) n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n, startSpreadMs: 5 }))
  }
}
if (which === "all" || which === "near") {
  for (const n of [2, 4]) {
    await batch(`near-aligned starts (0-500 ms) n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, startSpreadMs: 500 })
    )
  }
}
if (which === "all" || which === "people") {
  for (const n of [2, 3]) {
    await batch(`random offsets, presses 6/h + writes 4/h per session, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, pressesPerHour: 6, writesPerHour: 4 })
    )
  }
}
if (which === "all" || which === "wake") {
  for (const n of [2, 3, 4]) {
    await batch(`wake burst (asleep 40 min at 50 min, wake spread 0-20 ms) n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, hours: 3, sleep: { atMs: 50 * 60_000, minutes: 40, spreadMs: 20 } })
    )
  }
}
if (which === "all" || which === "slow") {
  await batch(`slow GitHub (12-28 s) n=3${tag}`, seeds, (seed) =>
    both({ seed, sessions: 3, fetchMs: (r) => 12_000 + 16_000 * r() })
  )
}
if (which === "looks") {
  const slow = { storeReadMs: (r: () => number) => 5 + 45 * r(), storeWriteMs: (r: () => number) => 20 + 130 * r() }
  // Looks of other repositories already kept, oldest first, so the limit of 20 bites.
  const seeded = (count: number) => (world: { store: { data: Record<string, string> } }) => {
    const keys = Array.from({ length: count }, (_, index) => `look:github.com/acme/old${index}`)
    world.store.data.looks = JSON.stringify(keys)
    for (const key of keys) world.store.data[key] = "{}"
  }
  const rows: [string, Scenario][] = [
    ["3 sessions in 3 repositories, slow store, presses 6/h, 18 looks kept before", { sessions: 3, repos: 3, pressesPerHour: 6, onWorld: seeded(18) as never }],
    ["4 sessions in 2 repositories, slow store, presses 6/h, 18 looks kept before", { sessions: 4, repos: 2, pressesPerHour: 6, onWorld: seeded(18) as never }],
    ["3 sessions in 3 repositories, slow store, reloads 2/h, presses 4/h", { sessions: 3, repos: 3, pressesPerHour: 4, reloadsPerHour: 2 }],
    ["6 sessions in 6 repositories, slow store, presses 6/h, 16 looks kept before", { sessions: 6, repos: 6, pressesPerHour: 6, onWorld: seeded(16) as never }],
    // Sessions started within 5 ms of each other load together, and a very slow store holds each keep open longer:
    // two sessions read the list before either writes it back.
    ["6 sessions in 6 repositories, started together, store writes 100-600 ms, 16 looks kept before", { sessions: 6, repos: 6, startSpreadMs: 5, pressesPerHour: 6, storeWriteMs: (r: () => number) => 100 + 500 * r(), onWorld: seeded(16) as never }],
    ["4 sessions in 4 repositories, started together, store writes 100-600 ms, reloads 2/h", { sessions: 4, repos: 4, startSpreadMs: 5, reloadsPerHour: 2, pressesPerHour: 6, storeWriteMs: (r: () => number) => 100 + 500 * r() }]
  ]
  for (const [name, s] of rows) {
    await batch(`${name}${tag}`, seeds, (seed) => both({ seed, fetchMs: usualFetch, ...slow, ...s } as Scenario))
  }
}

if (which === "all" || which === "slowstore") {
  await batch(`slow store (reads 5-50 ms, writes 20-150 ms) n=4${tag}`, seeds, (seed) =>
    both({
      seed,
      sessions: 4,
      storeReadMs: (r) => 5 + 45 * r(),
      storeWriteMs: (r) => 20 + 130 * r(),
      fetchMs: usualFetch
    })
  )
}
const fast = (r: () => number) => 1_000 + 7_000 * r() * r()
if (which === "flavors") {
  for (const n of [2, 3]) {
    await batch(`fetches 1-8 s only, no presses, n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n, fetchMs: fast }))
    await batch(`fetches 1-8 s only, presses 6/h + writes 4/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, pressesPerHour: 6, writesPerHour: 4 })
    )
    await batch(`3% slow fetches, no presses, n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n }))
  }
}
if (which === "dups") {
  for (const [label, read, write] of [
    ["store reads 0.3-2.3 ms, writes 1-7 ms", (r: () => number) => 0.3 + 2 * r(), (r: () => number) => 1 + 6 * r()],
    ["store reads 2-10 ms, writes 5-40 ms", (r: () => number) => 2 + 8 * r(), (r: () => number) => 5 + 35 * r()],
    ["store reads 5-50 ms, writes 20-150 ms", (r: () => number) => 5 + 45 * r(), (r: () => number) => 20 + 130 * r()]
  ] as const) {
    await batch(`dups: ${label}, fetches 1-8 s, n=4${tag}`, seeds, (seed) =>
      both({ seed, sessions: 4, fetchMs: fast, storeReadMs: read, storeWriteMs: write })
    )
  }
}
if (which === "elsewhere") {
  for (const [label, mode] of [
    ["background", "background"],
    ["while-open", "while-open"]
  ] as const) {
    await batch(`light check: half the sessions in another folder, ${label}, n=4${tag}`, seeds, (seed) =>
      both({ seed, sessions: 4, lightCheck: true, mode, fetchMs: fast })
    )
    await batch(`light check, detach/attach 3/h and turns 4/h, ${label}, n=4${tag}`, seeds, (seed) =>
      both({ seed, sessions: 4, lightCheck: true, mode, fetchMs: fast, detachesPerHour: 3, turnsPerHour: 4 })
    )
  }
}
if (which === "life") {
  for (const n of [2, 3]) {
    await batch(`detach/attach 3/h, n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n, detachesPerHour: 3 }))
    await batch(`while-open, pane toggles 4/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, mode: "while-open", paneTogglesPerHour: 4 })
    )
    await batch(`hot reloads 2/h + presses 4/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, reloadsPerHour: 2, pressesPerHour: 4 })
    )
    await batch(`hot reloads 4/h + /prs printed 12/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, reloadsPerHour: 4, printsPerHour: 12 })
    )
  }
}
if (which === "exact") {
  for (const n of [1, 2, 3]) {
    await batch(`timers re-armed with no overhead (tick and look fire together), random offsets, presses, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, timerOverheadMs: () => 0, fetchMs: fast, pressesPerHour: 4 })
    )
    await batch(`no timer overhead, starts 0-5 ms apart, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, timerOverheadMs: () => 0, startSpreadMs: 5, fetchMs: fast })
    )
  }
}

if (which === "closed") {
  for (const n of [2, 3, 4]) {
    await batch(`merges by others (closed lookup 0.5-2 s), usual store, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, mergeShare: 0.5 })
    )
  }
}
if (which === "dups-mid") {
  for (const n of [3, 4]) {
    await batch(`dups: store reads 1-3 ms, writes 3-10 ms (about a 1 MB store), n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, storeReadMs: (r) => 1 + 2 * r(), storeWriteMs: (r) => 3 + 7 * r() })
    )
  }
}

if (which === "leave") {
  for (const n of [2, 3]) {
    await batch(`one session ends at 60 min (S0), random offsets, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, leaves: { 0: 60 * 60_000 } })
    )
    await batch(`sessions end at random 1/h (never the last), n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, hours: 3, leavesPerHour: 1 })
    )
  }
}
if (which === "life2") {
  for (const n of [2, 3]) {
    await batch(`detach/attach 3/h, n=${n}${tag}`, seeds, (seed) => both({ seed, sessions: n, detachesPerHour: 3 }))
    await batch(`while-open, pane toggles 4/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, mode: "while-open", paneTogglesPerHour: 4 })
    )
  }
}
if (which === "slowclosed") {
  for (const [label, closedMs] of [
    ["closed lookup 0.5-2 s", (r: () => number) => 500 + 1500 * r()],
    ["closed lookup 5-30 s", (r: () => number) => 5_000 + 25_000 * r()],
    ["closed lookup 30 s (timeout)", () => 30_000]
  ] as const) {
    for (const n of [2, 3]) {
      await batch(`merges by others, ${label}, fetches 1-8 s, n=${n}${tag}`, seeds, (seed) =>
        both({ seed, sessions: n, fetchMs: fast, mergeShare: 0.5, closedMs })
      )
    }
  }
}
if (which === "throws") {
  for (const rate of [0.05, 1]) {
    for (const n of [2, 3]) {
      await batch(`showList throws ${rate * 100}% of loads, n=${n}${tag}`, seeds, (seed) =>
        both({ seed, sessions: n, fetchMs: fast, showThrowRate: rate })
      )
    }
  }
}
if (which === "holds") {
  for (const n of [2, 3]) {
    await batch(`turns 4/h (0.5-10 min), hold while working, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, turnsPerHour: 4 })
    )
    await batch(`turns 4/h, hold, presses 6/h + writes 4/h, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, turnsPerHour: 4, pressesPerHour: 6, writesPerHour: 4 })
    )
    await batch(`turns 4/h, hold, merges by others, n=${n}${tag}`, seeds, (seed) =>
      both({ seed, sessions: n, fetchMs: fast, turnsPerHour: 4, mergeShare: 0.5 })
    )
  }
}
if (which === "skew") {
  for (const skew of [1_000, 5_000, 30_000]) {
    await batch(`clocks ${skew / 1000} s apart, presses 6/h + writes 4/h, n=2${tag}`, seeds, (seed) =>
      both({ seed, sessions: 2, fetchMs: fast, pressesPerHour: 6, writesPerHour: 4, skewMs: [0, skew] })
    )
  }
}
