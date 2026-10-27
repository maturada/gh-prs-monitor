// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { ProcessRunResult } from "claude-code"

import type { BranchPulls, MergedBranch } from "../types"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { mergedBranchOf, putAwaySwitch, switchToBase } from "./switch-base"
import type { SwitchBaseHost } from "./switch-base"
import { fakeHost } from "./testing/git-host"
import { promisesRun } from "./testing/promises"
import type { Call } from "./testing/git-host"
import { REPO, snapshotOf } from "./testing/fixtures"

const SNAPSHOT = snapshotOf({ mine: [{ number: 7, headRefName: "fix/menu" }] })

// GitHub said #1242, merged into main, holds commit h1 of feature/x.
const LOOKED: BranchPulls = {
  repo: SNAPSHOT.repo,
  branch: "feature/x",
  head: "h1",
  isTaken: true,
  endedHead: null,
  merged: { number: 1242, base: "main" }
}

describe("what the pane offers to leave", () => {
  test("the checkout's branch, where a merged pull request holds its commit, with its base", () => {
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", LOOKED, null)).toEqual({
      repo: SNAPSHOT.repo,
      branch: "feature/x",
      head: "h1",
      number: 1242,
      base: "main"
    })
  })

  test("nothing where GitHub said nothing merged it, of another commit or branch, or named no base", () => {
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", { ...LOOKED, merged: null }, null)).toBe(null)
    // One kept by 1.5.0 has no merge at all.
    const { merged: _, ...earlier } = LOOKED
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", earlier, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h2", LOOKED, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, "feature/y", "h1", LOOKED, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", { ...LOOKED, merged: { number: 1242, base: null } }, null)).toBe(
      null
    )
    expect(mergedBranchOf(null, "feature/x", "h1", LOOKED, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, null, "h1", LOOKED, null)).toBe(null)
  })

  test("none for a branch an open pull request in the lists merges into, as a long-lived develop", () => {
    const targeted = snapshotOf({ mine: [{ number: 7, headRefName: "fix/menu", baseRefName: "feature/x" }] })

    expect(mergedBranchOf(targeted, "feature/x", "h1", { ...LOOKED, repo: targeted.repo }, null)).toBe(null)
  })

  test("none for a branch a pull request in the lists is open from again, nor /prs's own pr-<number> checkout", () => {
    const reopened = snapshotOf({ mine: [{ number: 9, headRefName: "feature/x" }] })
    expect(mergedBranchOf(reopened, "feature/x", "h1", { ...LOOKED, repo: reopened.repo }, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, "pr-1242", "h1", { ...LOOKED, branch: "pr-1242" }, null)).toBe(null)
  })

  test("none where another worktree holds the base, as git said when GitHub was asked", () => {
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", { ...LOOKED, baseHeldBy: "/repo-main" }, null)).toBe(null)
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", { ...LOOKED, baseHeldBy: null }, null)).not.toBe(null)
  })

  test("never the base itself, nor once its ✕ was pressed", () => {
    // A list where nothing merges into main, so this rule alone hides the note there.
    const intoDevelop = snapshotOf({ mine: [{ number: 7, headRefName: "fix/menu", baseRefName: "develop" }] })
    const onMain = { ...LOOKED, repo: intoDevelop.repo, branch: "main" }
    expect(mergedBranchOf(intoDevelop, "main", "h1", onMain, null)).toBe(null)
    expect(
      mergedBranchOf(intoDevelop, "main", "h1", { ...onMain, merged: { number: 1242, base: "release" } }, null)
    ).not.toBe(null)
    const dismissed = { repo: SNAPSHOT.repo, branch: "feature/x", head: "h1" }
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", LOOKED, dismissed)).toBe(null)
    // Dismissed at another commit: the branch moved and merged again, offered again.
    expect(mergedBranchOf(SNAPSHOT, "feature/x", "h1", LOOKED, { ...dismissed, head: "h0" })).not.toBe(null)
  })
})

type Answer = [string, Partial<ProcessRunResult> | ((line: string, stdin: string) => Partial<ProcessRunResult>)]

const OFFER: MergedBranch = { repo: SNAPSHOT.repo, branch: "feature/x", head: "h1", number: 1242, base: "main" }
const FETCH = "git -c credential.helper= -c credential.helper=!gh auth git-credential fetch --no-tags"

// A clean checkout of acme/app at /repo on feature/x at h1, origin the repository, main fetched at b1, no local main.
const CLEAN: Answer[] = [
  ["git rev-parse HEAD --symbolic-full-name HEAD", { stdout: "h1\nrefs/heads/feature/x\n" }],
  ["git status --porcelain --untracked-files=no", { stdout: "" }],
  ["git rev-parse --show-toplevel", { stdout: "/repo\n" }],
  ["git worktree list --porcelain", { stdout: "worktree /repo\nHEAD h1\nbranch refs/heads/feature/x\n\n" }],
  [
    "git remote -v",
    { stdout: "origin\tgit@github.com:acme/app.git (fetch)\norigin\tgit@github.com:acme/app.git (push)\n" }
  ],
  ["git rev-parse --verify --quiet refs/remotes/origin/main^{commit}", { stdout: "b1\n" }],
  ["git rev-parse --verify --quiet refs/heads/feature/x", { stdout: "h1\n" }],
  ["git rev-parse --verify --quiet refs/heads/main", { exitCode: 1 }]
]

// A machine answering `answers` first, then as a clean checkout, with `files` tracked at /repo; the session, and what
// the switch runs, says and shows busy, and the installs it starts.
function machineFor(
  answers: Answer[],
  { isBusy = false, listed = SNAPSHOT, files = {} as Record<string, string> } = {}
) {
  const tracked: Answer = [
    "git ls-files -z --",
    {
      stdout: Object.keys(files)
        .map((path) => `${path.slice("/repo/".length)}\0`)
        .join("")
    }
  ]
  const { host: machine, calls } = fakeHost([...answers, tracked, ...CLEAN], files)
  const said: string[] = []
  const busy: (string | null)[] = []
  const installs: string[] = []
  let changed = 0
  let shown: MergedBranch | null = OFFER
  const host: SwitchBaseHost = {
    ...machine,
    storedList: async () => listed,
    offered: async () => shown,
    setBusy: async (label) => {
      busy.push(label)
    },
    notify: async (text) => {
      said.push(text)
    },
    onInstall: (command) => installs.push(command),
    changed: async () => {
      changed++
    }
  }
  const session = createSession(readSettings({}))
  if (isBusy) {
    session.switchingFor = { number: 7 }
  }

  return {
    host,
    session,
    calls,
    said,
    busy,
    installs,
    changed: () => changed,
    offer: (now: MergedBranch | null) => {
      shown = now
    }
  }
}

// The switch run to its end on such a machine.
async function switchOn(answers: Answer[], options: Parameters<typeof machineFor>[1] = {}) {
  const machine = machineFor(answers, options)
  await switchToBase(machine.host, machine.session, REPO, OFFER)

  return machine
}

const ran = (calls: Call[], pattern: RegExp): string[] =>
  calls.map((call) => call.argv).filter((argv) => pattern.test(argv))

describe("switching to the base", () => {
  test("fetches the base into the remote's copy, switches to it with git's refusing switch, and deletes the branch", async () => {
    const { calls, said, busy, changed, session } = await switchOn([])

    expect(ran(calls, / fetch |^git switch|^git branch -D|^git config branch\.main/)).toEqual([
      `${FETCH} origin +refs/heads/main:refs/remotes/origin/main`,
      "git switch --no-overwrite-ignore -c main b1",
      "git config branch.main.remote origin",
      "git config branch.main.merge refs/heads/main",
      "git branch -D -- feature/x"
    ])
    expect(said).toEqual(["Switched to main; feature/x deleted, as #1242 merged it."])
    expect(busy).toEqual(["Switching to main…", null])
    expect(changed()).toBe(1)
    expect(session.switchingFor).toBe(null)
  })

  test("a local base behind GitHub's is brought up to it, keeping what it follows", async () => {
    const { calls } = await switchOn([
      ["git rev-parse --verify --quiet refs/heads/main", { stdout: "b0\n" }],
      ["git merge-base --is-ancestor b0 b1", { exitCode: 0 }],
      ["git config --get branch.main.merge", { stdout: "refs/heads/main\n" }]
    ])

    expect(ran(calls, /^git switch|^git config branch\.main\.(remote|merge) /)).toEqual([
      "git switch --no-overwrite-ignore -C main --no-track b1"
    ])
  })

  test("a local base gone its own way stops it before anything moves, the branch kept", async () => {
    const { calls, said } = await switchOn([
      ["git rev-parse --verify --quiet refs/heads/main", { stdout: "b9\n" }],
      ["git merge-base --is-ancestor", { exitCode: 1 }]
    ])

    expect(ran(calls, /^git switch|^git branch -D/)).toEqual([])
    expect(said).toEqual([
      "Not switched to main: main here has commits GitHub's doesn't, and GitHub's has others; bring it up to date yourself first."
    ])
  })

  test("any uncommitted change stops it, as git would carry it to the base and the branch would go", async () => {
    const { calls, said } = await switchOn([
      ["git status --porcelain --untracked-files=no", { stdout: " M src/app.ts\n M README.md\n" }]
    ])

    // Said before GitHub is asked, with no turn under way to change it meanwhile.
    expect(ran(calls, / fetch |^git switch|^git branch -D/)).toEqual([])
    expect(said).toEqual(["Not switched to main: commit or stash your uncommitted changes first (2 files)."])
  })

  test("a checkout moved since the note showed stops it", async () => {
    const { calls, said } = await switchOn([
      ["git rev-parse HEAD --symbolic-full-name HEAD", { stdout: "h2\nrefs/heads/feature/x\n" }]
    ])

    expect(ran(calls, / fetch |^git switch|^git branch -D/)).toEqual([])
    expect(said).toEqual(["Not switched to main: this checkout moved since; look at the pane again."])
  })

  test("a base another worktree holds stops it, naming where, though the note no longer shows for it", async () => {
    const machine = machineFor([
      [
        "git worktree list --porcelain",
        {
          stdout:
            "worktree /repo\nHEAD h1\nbranch refs/heads/feature/x\n\nworktree /repo-main\nHEAD b1\nbranch refs/heads/main\n\n"
        }
      ]
    ])
    // A load since saw the worktree holding the base, which hides the note: the reason of its own is said.
    machine.offer(null)
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    expect(ran(machine.calls, /^git switch|^git branch -D/)).toEqual([])
    expect(machine.said).toEqual(["Not switched to main: it is checked out in /repo-main."])
  })

  test("a base GitHub has no more, or a clone with no remote naming the repository, stops it", async () => {
    const gone = await switchOn([
      [FETCH, { exitCode: 128, stderr: "fatal: couldn't find remote ref refs/heads/main\n" }]
    ])
    expect(ran(gone.calls, /^git switch/)).toEqual([])
    expect(gone.said).toEqual([
      "Not switched to main: main could not be fetched: fatal: couldn't find remote ref refs/heads/main."
    ])

    const unnamed = await switchOn([["git remote -v", { stdout: "fork\tgit@github.com:ann/other.git (fetch)\n" }]])
    expect(unnamed.said).toEqual(["Not switched to main: no remote of this clone names acme/app."])
  })

  test("the branch stays where a pull request is open from a branch of its name again, a fork's too", async () => {
    const reopened = snapshotOf({ mine: [{ number: 1300, headRefName: "feature/x", isCrossRepository: true }] })
    const { calls, said } = await switchOn([], { listed: reopened })

    expect(ran(calls, /^git branch -D/)).toEqual([])
    expect(said).toEqual(["Switched to main; feature/x kept, as a pull request is open from it."])
  })

  test("a file git doesn't track here in the base's way stops it, the file kept", async () => {
    const { said } = await switchOn([
      [
        "git switch --no-overwrite-ignore",
        {
          exitCode: 1,
          stderr:
            "error: The following untracked working tree files would be overwritten by checkout:\n\t.env\nPlease move or remove them before you switch branches.\nAborting\n"
        }
      ]
    ])

    expect(said).toEqual([
      "Not switched to main: that would overwrite .env in this checkout, which git doesn't track and main does: move it aside."
    ])
  })

  test("a branch moved after the note showed is kept", async () => {
    const { calls, said } = await switchOn([
      ["git rev-parse --verify --quiet refs/heads/feature/x", { stdout: "h3\n" }]
    ])

    expect(ran(calls, /^git branch -D/)).toEqual([])
    expect(said).toEqual(["Switched to main; feature/x kept, as it moved."])
  })

  test("installs what a lockfile the switch changed needs, after the move", async () => {
    let hashes = 0
    const { calls, said, installs } = await switchOn(
      [["git hash-object", () => ({ stdout: hashes++ === 0 ? "before\n" : "after\n" })]],
      { files: { "/repo/package-lock.json": "{}" } }
    )

    expect(installs).toEqual(["npm ci"])
    expect(ran(calls, /^git switch|^npm ci|^git branch -D/)).toEqual([
      "git switch --no-overwrite-ignore -c main b1",
      "npm ci",
      "git branch -D -- feature/x"
    ])
    expect(said).toEqual(["Switched to main; feature/x deleted, as #1242 merged it; installed with npm ci."])
  })

  test("waits for a turn under way to end, the note saying so", async () => {
    const machine = machineFor([])
    machine.session.runningTurns.add("turn-1")
    const switching = switchToBase(machine.host, machine.session, REPO, OFFER)
    await promisesRun()

    // Nothing fetched, looked at or moved while the turn runs, as it may be running git in this checkout itself.
    expect(machine.busy).toEqual(["Switching to main…", "Switches to main when this turn ends"])
    expect(machine.calls).toEqual([])
    machine.session.runningTurns.clear()
    for (const resolve of machine.session.idleWaiters.splice(0)) {
      resolve()
    }
    await switching
    expect(machine.said).toEqual(["Switched to main; feature/x deleted, as #1242 merged it."])
    expect(machine.busy).toEqual([
      "Switching to main…",
      "Switches to main when this turn ends",
      "Switching to main…",
      null
    ])
  })

  test("a turn that began while the checkout was first looked at is waited for before GitHub is asked", async () => {
    let looks = 0
    const machine = machineFor([
      [
        "git status --porcelain --untracked-files=no",
        () => {
          // A prompt queued starts a turn as the first look runs.
          if (looks++ === 0) {
            machine.session.runningTurns.add("turn-2")
          }
          return { stdout: "" }
        }
      ]
    ])
    const switching = switchToBase(machine.host, machine.session, REPO, OFFER)
    await promisesRun()

    expect(ran(machine.calls, / fetch /)).toEqual([])
    machine.session.runningTurns.clear()
    for (const resolve of machine.session.idleWaiters.splice(0)) {
      resolve()
    }
    await switching
    expect(ran(machine.calls, / fetch /)).toHaveLength(1)
    expect(machine.said).toEqual(["Switched to main; feature/x deleted, as #1242 merged it."])
  })

  test("a turn that began while the checkout was looked at is waited for, and the checkout looked at again", async () => {
    let looks = 0
    const machine = machineFor([
      [
        "git status --porcelain --untracked-files=no",
        () => {
          // A prompt queued starts a turn as the checkout is looked at after the fetch, the first look before it.
          if (looks++ === 1) {
            machine.session.runningTurns.add("turn-2")
          }
          return { stdout: "" }
        }
      ]
    ])
    const switching = switchToBase(machine.host, machine.session, REPO, OFFER)
    await promisesRun()

    expect(ran(machine.calls, /^git switch/)).toEqual([])
    machine.session.runningTurns.clear()
    for (const resolve of machine.session.idleWaiters.splice(0)) {
      resolve()
    }
    await switching
    expect(looks).toBe(3)
    expect(ran(machine.calls, /^git switch/)).toEqual(["git switch --no-overwrite-ignore -c main b1"])
  })

  test("its note's ✕ while it waits for a turn stops it at once, letting this checkout go, nothing looked at", async () => {
    const machine = machineFor([])
    machine.session.runningTurns.add("turn-1")
    const switching = switchToBase(machine.host, machine.session, REPO, OFFER)
    await promisesRun()
    machine.offer(null)
    putAwaySwitch(machine.session)
    // The turn still runs.
    await switching

    expect(machine.calls).toEqual([])
    expect(machine.said).toEqual(["Not switched to main: its note was put away."])
    expect(machine.session.switchingFor).toBe(null)
    expect(machine.busy.at(-1)).toBe(null)
  })

  test("a note that no longer shows once the turn ends, as for a pull request opened into the branch, stops it", async () => {
    const machine = machineFor([])
    machine.session.runningTurns.add("turn-1")
    const switching = switchToBase(machine.host, machine.session, REPO, OFFER)
    await promisesRun()
    machine.offer(null)
    machine.session.runningTurns.clear()
    for (const resolve of machine.session.idleWaiters.splice(0)) {
      resolve()
    }
    await switching

    expect(ran(machine.calls, /^git switch|^git branch -D/)).toEqual([])
    expect(machine.said).toEqual(["Not switched to main: the pane no longer offers it."])
  })

  test("the checkout is read again before the note's busy label goes, and a read that fails still says how it went", async () => {
    const machine = machineFor([])
    const order: (string | null)[] = []
    const setBusy = machine.host.setBusy
    machine.host.setBusy = async (label) => {
      order.push(label)
      await setBusy(label)
    }
    machine.host.changed = async () => {
      order.push("read again")
      throw new Error("git could not be run")
    }
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    // So the note never offers again, for a moment, the switch just made.
    expect(order.slice(-2)).toEqual(["read again", null])
    expect(machine.said).toEqual(["Switched to main; feature/x deleted, as #1242 merged it."])
    expect(machine.session.switchingFor).toBe(null)
  })

  test("a skill starting here stops it, as its turn would work in the checkout as it moves", async () => {
    const machine = machineFor([])
    machine.session.skills.starting.push({} as never)
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    // Said before git or GitHub is asked, so nothing runs in the checkout as the skill starts.
    expect(ran(machine.calls, /^git status|^git worktree| fetch |^git switch/)).toEqual([])
    expect(machine.said).toEqual([
      "Not switched to main: a skill is starting here; press Switch to main again once its turn ends."
    ])
  })

  test("a skill pressed while git looks at the checkout before the move stops it too", async () => {
    let looks = 0
    const machine = machineFor([
      [
        "git worktree list --porcelain",
        () => {
          // The look after the fetch, the last before the move.
          if (looks++ === 1) {
            machine.session.skills.starting.push({} as never)
          }
          return { stdout: "worktree /repo\nHEAD h1\nbranch refs/heads/feature/x\n\n" }
        }
      ]
    ])
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    expect(ran(machine.calls, /^git switch|^git branch -D/)).toEqual([])
    expect(machine.said).toEqual([
      "Not switched to main: a skill is starting here; press Switch to main again once its turn ends."
    ])
  })

  test("a skill pressed while the base is fetched stops it too, before anything moves", async () => {
    const machine = machineFor([
      [
        FETCH,
        () => {
          machine.session.skills.starting.push({} as never)
          return { stdout: "" }
        }
      ]
    ])
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    expect(ran(machine.calls, / fetch /)).toHaveLength(1)
    expect(ran(machine.calls, /^git switch|^git branch -D/)).toEqual([])
    expect(machine.said).toEqual([
      "Not switched to main: a skill is starting here; press Switch to main again once its turn ends."
    ])
  })

  test("a step that throws clears the note's busy label and the lock, and the pane looks again", async () => {
    const { said, busy, session, changed } = await switchOn([
      ["git rev-parse --show-toplevel", { exitCode: 128, stderr: "fatal: not a git repository\n" }]
    ])

    expect(said).toEqual(["Not switched to main: this folder is not a git checkout (fatal: not a git repository)."])
    expect(busy.at(-1)).toBe(null)
    expect(session.switchingFor).toBe(null)
    expect(changed()).toBe(1)
  })

  test("once moved, nothing after says it wasn't: a branch that can't be looked at is kept", async () => {
    const machine = machineFor([])
    machine.host.storedList = async () => {
      throw new Error("the list could not be read")
    }
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    expect(machine.said).toEqual([
      "Switched to main; feature/x kept, as it could not be looked at (the list could not be read)."
    ])
  })

  test("a switch to the base under way says so to a second press", async () => {
    const machine = machineFor([])
    machine.session.switchingFor = { offer: OFFER, putAway: () => {} }
    await switchToBase(machine.host, machine.session, REPO, OFFER)

    expect(machine.said).toEqual(["This checkout is switching to main; press Switch to main again once it is done."])
    expect(ran(machine.calls, / fetch /)).toEqual([])
  })

  test("after the move, what failed is told beside it: what the base follows, the install, the branch's delete", async () => {
    let isSwitched = false
    const onMain: Answer[] = [
      [
        "git switch --no-overwrite-ignore",
        () => {
          isSwitched = true
          return {}
        }
      ],
      [
        "git rev-parse HEAD --symbolic-full-name HEAD",
        () => ({ stdout: isSwitched ? "b1\nrefs/heads/main\n" : "h1\nrefs/heads/feature/x\n" })
      ]
    ]
    const unset = await switchOn([
      ...onMain,
      [
        "git config branch.main.remote",
        () => {
          throw new Error("could not lock config file")
        }
      ]
    ])
    expect(unset.said).toEqual([
      "Switched to main; feature/x deleted, as #1242 merged it; what main follows could not be set (could not lock config file)."
    ])

    let hashes = 0
    const uninstalled = await switchOn(
      [
        [
          "git hash-object",
          () => {
            if (hashes++ > 0) {
              throw new Error("the lockfile could not be read")
            }
            return { stdout: "before\n" }
          }
        ]
      ],
      { files: { "/repo/package-lock.json": "{}" } }
    )
    expect(uninstalled.said).toEqual([
      "Switched to main; feature/x deleted, as #1242 merged it; the dependencies could not be installed (the lockfile could not be read)."
    ])

    const undeleted = await switchOn([
      ["git branch -D", { exitCode: 1, stderr: "error: Cannot delete branch 'feature/x' checked out at '/repo-2'\n" }]
    ])
    expect(undeleted.said[0]).toMatch(
      /^Switched to main; feature\/x kept, as git could not delete it \(.*feature\/x.*\)\.$/
    )
  })

  test("one switch of this checkout at a time", async () => {
    const { calls, said, session } = await switchOn([], { isBusy: true })

    expect(ran(calls, / fetch |^git switch/)).toEqual([])
    expect(said).toEqual(["#7 is switching this checkout; press Switch to main again once it is done."])
    expect(session.switchingFor).toEqual({ number: 7 })
  })
})
