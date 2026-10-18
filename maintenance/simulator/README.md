# The simulator: many sessions, one store, one GitHub

Several Claude Code sessions run the plugin's real refresh, sharing and store code (imported from the plugin's
`hooks/`) over one simulated store, one simulated GitHub and a virtual clock, for hours of simulated time per seed.
Every host call takes virtual time drawn at random, so the runs explore the interleavings the plugin's awaits allow:
sessions starting together, waking from sleep, reloading, pressing buttons, closing windows, slow or failing stores,
clocks out of step. It finds races the test suite can't reach, and it compares two versions world by world.

Needs [Bun](https://bun.sh).

## Running it

From the repository root:

```
zsh maintenance/simulator/run.sh gh-prs-monitor now           # every world, sharing on and off, 100 seeds each
zsh maintenance/simulator/run.sh <older copy> before          # the same on a version before (a checkout of a tag)
python3 maintenance/simulator/compare.py before now
```

`run.sh <plugin> <name> wake looks` runs only the worlds named. One world in one mode by hand: in
`.work/sim/<name>/sim`, `bun batch.ts <world> [seeds] [on|off]`. `bun trace.ts <scenario> <seed>` there prints one
run's requests, lists and toasts around its first step back or doubled toast.

The worlds (`sim/batch.ts`): random, aligned and near-aligned starts; people pressing and writing; wake bursts after
sleep; slow GitHub, slow store; fetch flavours; duplicate alerts; lifecycles (hot reloads, `/prs` typed, panes toggled,
surfaces detached and attached); exact timers; merges by others and the closed lookup, slow or dead; sessions leaving;
`showList` throwing; turns holding alerts; clocks seconds apart; and looks: sessions in several repositories sharing
the stored last-look list.

## What a row measures

| Measure | What it counts | Should be |
|---|---|---|
| `req/interval`, `maxPerWindow`, `windowsOver1` | list requests to GitHub per 3-minute polling interval, all sessions together | about 1 (0.8–1.2) in one repository with sharing on; more with reloads, presses or several repositories |
| `maxAgeS`, `watchedMaxS`, `watched>200s` | how old a shown list gets, and how often one being watched is older than 200 s | low; compare between versions |
| `stepBacks`, `stepBackRuns` | a session showing a GitHub state older than one it showed before | 0 but with clocks seconds apart |
| `duplicates` | an alert toasted by more than one session | low with sharing on |
| `lost` | new review requests during the run that no session alerted | compare between versions |
| `errors` | errors thrown out of the plugin's code | 0, but where the world makes them: `showList` throwing, and an ended session's calls failing |
| `aborted` | runs a hot reload ended | only in reload worlds |
| `badTimers` | sessions left with other timers than the polling mode's | 0 |
| `unfinished` | loads that never ended | 0 |
| `lockFailures` | store writes the store's own lock gave up on | 0 but with store writes of 100–600 ms |
| `unanswered` | a press or question with no list request from that session within two minutes | at most 1 in one repository; up to about 1% with a very slow store |
| `mergeAlerts` | merges by others toasted, and how many by more than one session | doubled near 0 |
| `looks` | at the end: looks no list names, list entries with no look, live repositories' looks missing, the longest list | 0, 0, 0, at most 20 |

## Reading a comparison

The worlds are random but seeded, so a version that keeps behaviour gives the same rows. An added or removed `await`
shifts timings: small differences that go both ways across rows (a few lost of 7,000, a doubled alert more or less) are
that. A measure that should be 0 turning non-zero, or one moving the same way across many rows, is a behaviour change.

The simulator calls the plugin's functions directly (`sim/world.ts` imports them from `../C/hooks/`), so a version
compared must export what it imports; when those functions change, change `world.ts` with them.
