// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { snapshotOf } from "./testing/fixtures"
import { clockOf, MINUTE, machine, settleAll, startSession, GITHUB, triedToNotify } from "./testing/world"
import type { World } from "./testing/world"

// The last look an earlier session kept of the lists.
describe("cleaning up worktrees", () => {
  test("a merged pull request's worktree goes with its branch on the session's first refresh", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-9")
    expect(seen.runs).toContain("git branch -D -- fix/old")
    expect(seen.toasts).toContain("#9 merged: removed its worktree and the branch fix/old")
  })

  test("its note sends no system notification", { options: { systemNotification: true } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.toasts).toContain("#9 merged: removed its worktree and the branch fix/old")
    expect(triedToNotify(seen.debug)).toBe(false)
  })

  test("a worktree in the folder that does not hold the pull request's branch, or holds an open one's, stays", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [
        // The host's own worktree, named like /prs's.
        { number: 9, branch: "worktree-pr-9" },
        // Reused for open #1, whose branch it holds.
        { number: 10, branch: "fix/menu" }
      ],
      closed: [
        { number: 9, state: "MERGED", by: "ann", branch: "fix/old" },
        { number: 10, state: "CLOSED", by: "ann", branch: "fix/menu" }
      ]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => /^git (worktree remove|branch -D)/.test(run))).toEqual([])
    expect(seen.toasts).toEqual([])
  })

  test("a fork's worktree, on the branch /prs named it, goes as any other", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "pr-9" }],
      closed: [{ number: 9, state: "MERGED", by: "ann", branch: "main", isFork: true }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs).toContain("git branch -D -- pr-9")
  })

  test("one holding work is kept and said once; an open pull request's is left alone", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [
        { number: 9, branch: "fix/old", isChanged: true },
        { number: 10, branch: "feat/open" }
      ],
      closed: [
        { number: 9, state: "CLOSED", by: "ann" },
        { number: 10, state: "OPEN", by: null }
      ]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    // A pull request leaving the lists looks again; the kept one is not said twice.
    world.github = { ...GITHUB, requested: [] }
    await clock.advance(3 * MINUTE)

    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([])
    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([
      "#9 closed: kept its worktree .claude/worktrees/pr-9, which has changes not committed"
    ])
  })

  test("one kept is told once across sessions too, and again only once why it stays changes", async ($, on) => {
    const KEY = "kept:github.com/acme/app:/repo"
    const UNCOMMITTED = "#9 closed: kept its worktree .claude/worktrees/pr-9, which has changes not committed"
    const UNPUSHED = "#11 merged: kept its worktree .claude/worktrees/pr-11, which has commits GitHub doesn't have"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [
        { number: 9, branch: "fix/old", isChanged: true },
        { number: 11, branch: "fix/older", tip: "local-only" }
      ],
      closed: [
        { number: 9, state: "CLOSED", by: "ann" },
        { number: 11, state: "MERGED", by: "ann" }
      ],
      // An earlier session told #9's as it is now, #11's for another reason, and #12's, whose worktree is gone.
      store: {
        [KEY]: {
          worktrees: { "9": UNCOMMITTED, "11": "#11 merged: kept its worktree, which had changes", "12": "gone" },
          branches: {}
        }
      }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([UNPUSHED])
    expect(world.store?.[KEY]).toEqual({ worktrees: { "9": UNCOMMITTED, "11": UNPUSHED }, branches: {} })
  })

  test("another clone's notes are its own: neither forgotten here nor told for this one", async ($, on) => {
    const HERE = "kept:github.com/acme/app:/repo"
    const THERE = "kept:github.com/acme/app:/work/app-2"
    const KEPT = "#9 closed: kept its worktree .claude/worktrees/pr-9, which has changes not committed"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old", isChanged: true }],
      closed: [{ number: 9, state: "CLOSED", by: "ann" }],
      // The other clone kept its own #9 and #12 for the same reason; this one has no #12.
      store: { [THERE]: { worktrees: { "9": KEPT, "12": "kept" }, branches: {} } }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([KEPT])
    expect(world.store?.[HERE]).toEqual({ worktrees: { "9": KEPT }, branches: {} })
    expect(world.store?.[THERE]).toEqual({ worktrees: { "9": KEPT, "12": "kept" }, branches: {} })
  })

  test("a cleanup another session runs in this clone is left to it, and looked at again once that is done", async ($, on) => {
    const CLAIM = "cleanup:/repo"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "MERGED", by: "ann" }],
      store: { [CLAIM]: { by: "another-session", at: clock.now() } }
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await settleAll(clock, seen)
    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([])
    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([])

    // That session frees it, and a pull request leaving the lists has this one look again.
    delete world.store?.[CLAIM]
    world.github = { ...GITHUB, requested: [] }
    await clock.advance(3 * MINUTE)
    await settleAll(clock, seen)

    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-9")
    expect(seen.toasts).toContain("#9 merged: removed its worktree and the branch fix/old")
    expect(world.store?.[CLAIM]).toBeUndefined()
  })

  test("what was told of a worktree since gone, or of a pull request open again, is forgotten", async ($, on) => {
    const KEY = "kept:github.com/acme/app:/repo"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 1, branch: "fix/menu" }],
      // #12's worktree was removed by hand; #1 was reopened and is in the list again.
      store: { [KEY]: { worktrees: { "12": "kept", "1": "kept" }, branches: { "13": "kept" } } }
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(world.store?.[KEY]).toBe(undefined)
  })

  test("one removed after it was kept is told, and forgotten", async ($, on) => {
    const KEY = "kept:github.com/acme/app:/repo"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "CLOSED", by: "ann" }],
      store: { [KEY]: { worktrees: { "9": "#9 closed: kept its worktree, which has changes" }, branches: {} } }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.toasts).toContain("#9 closed: removed its worktree and the branch fix/old")
    expect(world.store?.[KEY]).toBe(undefined)
  })

  test("the worktree the session works in stays until it leaves", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "fix/old",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "MERGED", by: "ann" }],
      cwd: "/repo/.claude/worktrees/pr-9"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([])
    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([])
  })

  test("one another session removed first is not told as a failure", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      closed: [{ number: 9, state: "MERGED", by: "ann" }],
      isTakenByAnother: true
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([])
  })

  for (const alertClosed of [true, false]) {
    test(
      `one of a pull request the last look listed is asked about once, as the first refresh asked already${alertClosed ? "" : ", with the alert off too"}`,
      { options: { alertClosed } },
      async ($, on) => {
        const clock = clockOf(on)
        const look = snapshotOf({ ...GITHUB, mine: [...GITHUB.mine!, { number: 9, headRefName: "fix/old" }] })
        const world: World = {
          github: GITHUB,
          branch: "main",
          uncommitted: 0,
          pullWorktrees: [{ number: 9, branch: "fix/old" }],
          closed: [{ number: 9, state: "MERGED", by: "ann" }],
          store: { "look:github.com/acme/app": look, looks: ["look:github.com/acme/app"] }
        }
        const seen = machine($, on, world, clock)
        await startSession($)
        await settleAll(clock, seen)

        expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-9")
        expect(seen.runs.filter((run) => run.includes("CLOSED_EVENT"))).toHaveLength(1)
      }
    )
  }

  test("one of a pull request the first refresh didn't ask about is asked about alone", async ($, on) => {
    const clock = clockOf(on)
    const look = snapshotOf({ ...GITHUB, mine: [...GITHUB.mine!, { number: 9, headRefName: "fix/old" }] })
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      // #11's pull request was never in a list this repository's sessions showed.
      pullWorktrees: [
        { number: 9, branch: "fix/old" },
        { number: 11, branch: "fix/older" }
      ],
      closed: [
        { number: 9, state: "MERGED", by: "ann" },
        { number: 11, state: "MERGED", by: "ann" }
      ],
      store: { "look:github.com/acme/app": look, looks: ["look:github.com/acme/app"] }
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await settleAll(clock, seen)

    const asked = seen.runs
      .filter((run) => run.includes("CLOSED_EVENT"))
      .map((run) => [...run.matchAll(/ p(\d+): pullRequest\(/g)].map((match) => Number(match[1])))
    expect(asked).toEqual([[9], [11]])
    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-11")
  })

  test("what a refresh found of one still open is not taken by a later cleanup, which asks again", async ($, on) => {
    const clock = clockOf(on)
    // #10 left the lists since the last look, still open (its branch's worktree in use elsewhere, say).
    const look = snapshotOf({ ...GITHUB, mine: [...GITHUB.mine!, { number: 10, headRefName: "feat/open" }] })
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 10, branch: "feat/open" }],
      closed: [{ number: 10, state: "OPEN", by: null }],
      store: { "look:github.com/acme/app": look, looks: ["look:github.com/acme/app"] }
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await settleAll(clock, seen)
    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([])

    // It merges; another pull request leaving the lists has the cleanup look again.
    world.closed = [
      { number: 10, state: "MERGED", by: "ann" },
      { number: 2, state: "MERGED", by: "ann" }
    ]
    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    await clock.advance(3 * MINUTE)
    await settleAll(clock, seen)

    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-10")
  })

  test("worktrees of pull requests still on the lists ask GitHub nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 1, branch: "fix/menu" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.includes("CLOSED_EVENT"))).toEqual([])
  })

  test("turned off, nothing is cleaned up", { options: { cleanupWorktrees: false } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullWorktrees: [{ number: 9, branch: "fix/old" }],
      pullBranches: [{ number: 12 }],
      closed: [
        { number: 9, state: "MERGED", by: "ann" },
        { number: 12, state: "MERGED", by: "ann" }
      ]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("git worktree") || run.startsWith("git branch -D"))).toEqual([])
  })
})

describe("cleaning up the branches a switch here left", () => {
  test("a merged pull request's pr-<number> branch goes once no folder is on it and GitHub has its commit", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullBranches: [{ number: 12 }],
      closed: [{ number: 12, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs).toContain("git branch -D -- pr-12")
    expect(seen.toasts).toContain("#12 merged: removed the branch pr-12 a switch here left")
    expect(world.pullBranches).toEqual([])
  })

  test("one with commits GitHub doesn't have is kept and said so; one a folder is on is left alone", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "pr-13",
      uncommitted: 0,
      pullBranches: [
        { number: 12, tip: "mine" },
        { number: 13, isCheckedOut: true }
      ],
      closed: [
        { number: 12, state: "CLOSED", by: "ann" },
        { number: 13, state: "MERGED", by: "ann" }
      ]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("git branch -D"))).toEqual([])
    expect(seen.toasts).toContain("#12 closed: kept the branch pr-12, which has commits GitHub doesn't have")
    expect(seen.toasts.some((toast) => toast.includes("pr-13"))).toBe(false)
    // Told once across sessions too.
    expect(world.store?.["kept:github.com/acme/app:/repo"]).toEqual({
      worktrees: {},
      branches: { "12": "#12 closed: kept the branch pr-12, which has commits GitHub doesn't have" }
    })
  })

  test("one kept that an earlier session told is not told again", async ($, on) => {
    const NOTE = "#12 closed: kept the branch pr-12, which has commits GitHub doesn't have"
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullBranches: [{ number: 12, tip: "mine" }],
      closed: [{ number: 12, state: "CLOSED", by: "ann" }],
      store: { "kept:github.com/acme/app:/repo": { worktrees: {}, branches: { "12": NOTE } } }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs).toContain("git rev-parse --verify --quiet refs/heads/pr-12")
    expect(seen.toasts.some((toast) => toast.includes("pr-12"))).toBe(false)
  })

  test("the pr-<number> branch of a pull request still in the lists stays, whatever GitHub's lookup says", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullBranches: [{ number: 1 }],
      closed: [{ number: 1, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("git branch -D"))).toEqual([])
  })

  test("a branch of that name made by hand, or one an open pull request comes from, is yours and stays", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 57, title: "Tidy the legend", headRefName: "pr-13" }] },
      branch: "main",
      uncommitted: 0,
      // pr-12 tracks nothing, as after `git fetch origin pull/12/head:pr-12`; #57 comes from pr-13.
      pullBranches: [{ number: 12, upstream: "" }, { number: 13 }],
      closed: [
        { number: 12, state: "MERGED", by: "ann" },
        { number: 13, state: "MERGED", by: "ann" }
      ]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("git branch -D"))).toEqual([])
    expect(seen.toasts.some((toast) => toast.includes("pr-12") || toast.includes("pr-13"))).toBe(false)
  })

  test("a branch a folder held when its worktree was cleaned up goes once it comes free", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "pr-12",
      uncommitted: 0,
      // An older worktree on the head's name, and pr-12 checked out in this folder.
      pullWorktrees: [{ number: 12, branch: "feature/12" }],
      pullBranches: [{ number: 12, isCheckedOut: true }],
      closed: [{ number: 12, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-12")
    expect(seen.runs).not.toContain("git branch -D -- pr-12")

    // The folder switches away, and a pull request leaving the lists makes it look again.
    world.pullBranches = [{ number: 12 }]
    world.github = { ...GITHUB, mine: GITHUB.mine!.slice(1) }
    await clock.advance(3 * MINUTE)

    expect(seen.runs).toContain("git branch -D -- pr-12")
  })

  test("a fork's, which tracks the pull request's own ref, goes like any other", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      pullBranches: [{ number: 12, upstream: "refs/pull/12/head" }],
      closed: [{ number: 12, state: "CLOSED", by: "ann", isFork: true }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    expect(seen.runs).toContain("git branch -D -- pr-12")
  })
})
