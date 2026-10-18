// Author: David Matura
//
// bun trace.ts <scenario> <seed>: one run's requests, lists shown and toasts around its first step back or doubled
// toast, to see how it came about.
import { run } from "./scenario"
import type { Scenario } from "./scenario"
const [which, seedText] = process.argv.slice(2)
const seed = Number(seedText)
const scenarios: Record<string, Scenario> = {
  random3: { seed, sessions: 3 },
  aligned2: { seed, sessions: 2, startSpreadMs: 5 },
  aligned3: { seed, sessions: 3, startSpreadMs: 5 },
  people2: { seed, sessions: 2, pressesPerHour: 6, writesPerHour: 4 },
  wake2: { seed, sessions: 2, hours: 3, sleep: { atMs: 50 * 60_000, minutes: 40, spreadMs: 20 } },
  reload2: { seed, sessions: 2, reloadsPerHour: 2, pressesPerHour: 4 },
  slowstore4: { seed, sessions: 4, storeReadMs: (r) => 5 + 45 * r(), storeWriteMs: (r) => 20 + 130 * r() },
}
const out = await run(scenarios[which]!)
const t0 = 1_800_000_000_000
const s = (t: number) => ((t - t0) / 1000).toFixed(3)
const back = out.stepBacks[0]
const dup = out.duplicates[0]
const focus = back ? back.at : out.world.toasts.find((t) => dup && t.line === dup[0])!.at
console.log("stepBack", back && { ...back, at: s(back.at) }, "dup", dup)
const lo = focus - 240_000, hi = focus + 30_000
for (const q of out.world.github.listRequests) if (q.end > lo && q.start < hi) console.log(`req   ${q.session} start ${s(q.start)} end ${s(q.end)} v${q.version} (dur ${((q.end-q.start)/1000).toFixed(1)}s)`)
for (const sim of out.sims) for (const sh of sim.shown) if (sh.at > lo && sh.at < hi) console.log(`shown ${sim.name} at ${s(sh.at)} v${sh.version} fetchedAt ${s(sh.fetchedAt)}`)
for (const t of out.world.toasts) if (t.at > lo && t.at < hi) console.log(`toast ${t.session} at ${s(t.at)} ${t.line}`)
