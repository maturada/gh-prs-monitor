// Author: David Matura

import type { ProcessRunResult } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import { holdsPullBranch } from "./checkout"
import type { PullWorktree } from "./checkout"
import type { Host } from "./machine"
import {
  CLEANUP_CLAIM_MS,
  cleanUp,
  cleanupCandidates,
  worktreeCleanupNote,
  isLeftForPull,
  isLeftInPlace,
  keptStill,
  mayRemoveWorktree,
  pullBranches,
  pullWorktrees,
  removePullBranch,
  removePullWorktree,
  statusEntries,
  toldOnce
} from "./cleanup"
import type { CleanupHost } from "./cleanup"
import type { ClosedState } from "./ended"
import { isNothingKept, readKeptNotes } from "./kept-notes"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { claimCleanup, cleanupKey, freeCleanup, keepKept, recallCleanup, recallKept } from "./store"
import { REPO, snapshotOf } from "./testing/fixtures"
import { COMMON_DIR, fakeHost, OWN_FOLDER, PATH } from "./testing/git-host"
import type { Call } from "./testing/git-host"
import { memoryStoreHost } from "./testing/memory-store"
import type { StoreWorld } from "./testing/memory-store"

describe("cleaning up worktrees", () => {
  const OWN: PullWorktree = { number: 7, path: PATH, branch: "fix/menu" }
  const ON_HEAD: [string, Partial<ProcessRunResult>] = ["git rev-parse HEAD", { stdout: "abc\n" }]
  // git places the commit apart from the last head: it holds work the last head doesn't.
  const NOT_WITHIN: [string, Partial<ProcessRunResult>] = ["git merge-base --is-ancestor", { exitCode: 1 }]
  const removals = (calls: Call[]): string[] =>
    calls.map((call) => call.argv).filter((argv) => /^git (worktree (remove|prune)|branch -D)/.test(argv))

  test("only the worktrees /prs made are listed, each with its pull request and branch", async () => {
    const { host } = fakeHost([
      COMMON_DIR,
      [
        "git worktree list --porcelain",
        {
          stdout: [
            "worktree /repo\nHEAD 1\nbranch refs/heads/main",
            `worktree ${PATH}\nHEAD 2\nbranch refs/heads/fix/menu`,
            "worktree /repo/.claude/worktrees/pr-12\nHEAD 3\ndetached",
            "worktree /repo/.claude/worktrees/reload-plugins-1\nHEAD 4\nbranch refs/heads/feature/x-1"
          ].join("\n\n")
        }
      ]
    ])

    expect(await pullWorktrees(host)).toEqual([
      OWN,
      { number: 12, path: "/repo/.claude/worktrees/pr-12", branch: null }
    ])
  })

  test("removed with its branch when it holds nothing GitHub lacks, never by force", async () => {
    const { host, calls } = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status --porcelain -z --ignored", { stdout: "!! node_modules/\0!! .DS_Store\0" }]],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    expect(removals(calls)).toEqual([`git worktree remove ${PATH}`, "git branch -D -- fix/menu"])
  })

  test("what tools make again goes with it, in whatever language: dependencies, build output, caches", async () => {
    const remade = [
      "!! .venv/",
      "!! src/app/__pycache__/",
      "!! .pytest_cache/",
      "!! target/",
      "!! packages/web/dist/",
      "!! .gradle/",
      "!! coverage/",
      "!! tool.pyc",
      "!! Thumbs.db"
    ]
    const { host } = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status", { stdout: remade.map((entry) => `${entry}\0`).join("") }]],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
  })

  test("a status git lists more of than can be read at once is no all-clear: nothing is removed", async () => {
    const { host, calls } = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status", { stdout: "!! node_modules/\0", isStdoutTruncated: true }]],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "failed" })
    expect(removals(calls)).toEqual([])
  })

  test("untracked files are looked for whatever git is set to show, as removing the worktree would delete them", async () => {
    const { host, calls } = fakeHost([COMMON_DIR, ON_HEAD], OWN_FOLDER)

    await removePullWorktree(host, REPO, OWN, "abc")
    expect(calls.map((call) => call.argv)).toContain("git status --porcelain -z --ignored --untracked-files=normal")
  })

  test("only a worktree holding the pull request's own branch is its to clean up", () => {
    const pull = { branch: "fix/menu", isCrossRepository: false }

    expect(holdsPullBranch(OWN, pull)).toBe(true)
    // The host's own worktree in the same folder, one on another pull request's branch, or one on no branch.
    expect(holdsPullBranch({ ...OWN, branch: "worktree-pr-7" }, pull)).toBe(false)
    expect(holdsPullBranch({ ...OWN, branch: "feat/other" }, pull)).toBe(false)
    expect(holdsPullBranch({ ...OWN, branch: null }, pull)).toBe(false)
    // Or the name /prs checks it out as apart from a branch of the head's name, a fork's always.
    expect(holdsPullBranch({ ...OWN, branch: "pr-7" }, pull)).toBe(true)
    expect(holdsPullBranch({ ...OWN, branch: "pr-8" }, pull)).toBe(false)
    // A fork's head name may be one of the person's own branches, as `main`: only pr-<number> is its.
    expect(holdsPullBranch({ ...OWN, branch: "fix/menu" }, { ...pull, isCrossRepository: true })).toBe(false)
    expect(holdsPullBranch({ ...OWN, branch: "pr-7" }, { ...pull, isCrossRepository: true })).toBe(true)
  })

  test("a commit on a remote branch counts as on GitHub, though not the last head", async () => {
    const { host } = fakeHost(
      [
        COMMON_DIR,
        ["git rev-parse HEAD", { stdout: "older\n" }],
        ["git branch -r --contains older", { stdout: "  origin/fix/menu\n" }]
      ],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
  })

  test("a commit before the last head counts as on GitHub, as after Update Branch or a push from elsewhere", async () => {
    const { host, calls } = fakeHost(
      [COMMON_DIR, ["git rev-parse HEAD", { stdout: "older\n" }], ["git merge-base --is-ancestor older abc", {}]],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    expect(calls.some((call) => call.argv.startsWith("gh "))).toBe(false)

    const left = fakeHost([
      COMMON_DIR,
      ["git rev-parse --verify --quiet refs/heads/pr-12", { stdout: "older\n" }],
      ["git merge-base --is-ancestor older abc", {}]
    ])
    expect(await removePullBranch(left.host, REPO, { number: 12, branch: "pr-12" }, "abc")).toEqual({
      outcome: "removed"
    })
  })

  test("one this clone can't place against the last head, as a head never fetched, is asked of GitHub", async () => {
    const asking = (answer: Partial<ProcessRunResult>) =>
      fakeHost(
        [
          COMMON_DIR,
          ["git rev-parse HEAD", { stdout: "older\n" }],
          ["git merge-base --is-ancestor", { exitCode: 128, stderr: "fatal: Not a valid commit name abc\n" }],
          ["gh api repos/acme/app/compare/older...abc", answer]
        ],
        OWN_FOLDER
      )

    const before = asking({ stdout: "ahead\n" })
    expect(await removePullWorktree(before.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    expect(before.calls.map((call) => call.argv)).toContain(
      "gh api repos/acme/app/compare/older...abc --hostname github.com --jq .status"
    )
    const apart = asking({ stdout: "diverged\n" })
    expect(await removePullWorktree(apart.host, REPO, OWN, "abc")).toEqual({ outcome: "unpushed" })
    const unknown = asking({ exitCode: 1, stderr: "gh: Not Found (HTTP 404)" })
    expect(await removePullWorktree(unknown.host, REPO, OWN, "abc")).toEqual({ outcome: "unpushed" })
    // GitHub not answering says nothing either way, so nothing is removed, or told.
    const down = asking({ exitCode: 1, stderr: "gh: Server Error (HTTP 500)" })
    await expect(removePullWorktree(down.host, REPO, OWN, "abc")).rejects.toThrow("gh: Server Error (HTTP 500)")
    for (const { calls } of [apart, unknown, down]) {
      expect(removals(calls)).toEqual([])
    }
  })

  test("paths git would quote, with a space or a letter beyond ASCII, are read as they are", async () => {
    const status = (entries: string[]) =>
      fakeHost(
        [COMMON_DIR, ON_HEAD, ["git status", { stdout: entries.map((entry) => `${entry}\0`).join("") }]],
        OWN_FOLDER
      )

    const notes = status(["!! my app/dist/", "!! scratch notes/"])
    expect(await removePullWorktree(notes.host, REPO, OWN, "abc")).toEqual({
      outcome: "ignored",
      file: "scratch notes/"
    })
    const secret = status(["!! données.env"])
    expect(await removePullWorktree(secret.host, REPO, OWN, "abc")).toEqual({ outcome: "ignored", file: "données.env" })
    const remade = status(["!! my app/node_modules/", "!! café/__pycache__/"])
    expect(await removePullWorktree(remade.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    // A rename's record names the path it came from next, which is no record of its own.
    const renamed = status(["R  src/new name.ts", "src/old name.ts", "!! node_modules/"])
    expect(await removePullWorktree(renamed.host, REPO, OWN, "abc")).toEqual({ outcome: "uncommitted" })
  })

  test("git's -z status is read a record a path, a rename's or copy's with the path it came from", () => {
    expect(
      statusEntries("R  new name.ts\0old name.ts\0 M src/menu.ts\0C  copy.ts\0orig.ts\0?? notes.md\0!! dist/\0")
    ).toEqual([
      { code: "R ", path: "new name.ts", from: "old name.ts" },
      { code: " M", path: "src/menu.ts" },
      { code: "C ", path: "copy.ts", from: "orig.ts" },
      { code: "??", path: "notes.md" },
      { code: "!!", path: "dist/" }
    ])
    expect(statusEntries("")).toEqual([])
  })

  test("kept with changes not committed, a file git ignores, or a commit GitHub doesn't have", async () => {
    const changed = fakeHost([COMMON_DIR, ON_HEAD, ["git status", { stdout: " M src/menu.ts\0" }]], OWN_FOLDER)
    expect(await removePullWorktree(changed.host, REPO, OWN, "abc")).toEqual({ outcome: "uncommitted" })

    const added = fakeHost([COMMON_DIR, ON_HEAD, ["git status", { stdout: "?? notes.md\0" }]], OWN_FOLDER)
    expect(await removePullWorktree(added.host, REPO, OWN, "abc")).toEqual({ outcome: "uncommitted" })

    const ignored = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status", { stdout: "!! node_modules/\0!! .env.local\0" }]],
      OWN_FOLDER
    )
    expect(await removePullWorktree(ignored.host, REPO, OWN, "abc")).toEqual({ outcome: "ignored", file: ".env.local" })
    const secrets = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status", { stdout: "!! target/\0!! .secrets/\0" }]],
      OWN_FOLDER
    )
    expect(await removePullWorktree(secrets.host, REPO, OWN, "abc")).toEqual({ outcome: "ignored", file: ".secrets/" })
    // A file git lists apart, in a tracked folder named as build output is, is not build output.
    const inBuild = fakeHost([COMMON_DIR, ON_HEAD, ["git status", { stdout: "!! build/.env\0" }]], OWN_FOLDER)
    expect(await removePullWorktree(inBuild.host, REPO, OWN, "abc")).toEqual({ outcome: "ignored", file: "build/.env" })
    // Within node_modules everything is installed, a cache file is one wherever it is, and what CocoaPods, Flutter,
    // Composer and Yarn's Plug'n'Play install or generate is made again too.
    const installed = fakeHost(
      [
        COMMON_DIR,
        ON_HEAD,
        [
          "git status",
          {
            stdout:
              "!! node_modules/.gh-prs-monitor-lock\0!! src/app.pyc\0!! ios/Pods/\0!! .dart_tool/\0!! .flutter-plugins\0!! vendor/\0" +
              "!! ios/.symlinks/\0!! ios/Flutter/ephemeral/\0!! .pnp.cjs\0!! .yarn/install-state.gz\0!! .yarn/unplugged/\0" +
              "!! .yarn/.gh-prs-monitor-lock\0"
          }
        ]
      ],
      OWN_FOLDER
    )
    expect(await removePullWorktree(installed.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    // Yarn's Plug'n'Play folder, which git lists whole as all in it is ignored: its cache, its state, the marker.
    const pnp = fakeHost(
      [
        COMMON_DIR,
        ON_HEAD,
        ["git status", { stdout: "!! .pnp.cjs\0!! .yarn/\0" }],
        [
          "git ls-files -z --others --ignored --exclude-standard -- :(literal).yarn/",
          {
            stdout:
              ".yarn/.gh-prs-monitor-lock\0.yarn/cache/.gitignore\0.yarn/cache/is-odd-npm-3.0.1-c1e1c6e4d3.zip\0" +
              ".yarn/install-state.gz\0.yarn/unplugged/fsevents-npm-2.3.3/node_modules/fsevents/fsevents.node\0"
          }
        ]
      ],
      OWN_FOLDER
    )
    expect(await removePullWorktree(pnp.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })

    const local = fakeHost([COMMON_DIR, NOT_WITHIN, ["git rev-parse HEAD", { stdout: "local1\n" }]], OWN_FOLDER)
    expect(await removePullWorktree(local.host, REPO, OWN, "abc")).toEqual({ outcome: "unpushed" })

    for (const { calls } of [changed, added, ignored, secrets, inBuild, local]) {
      expect(removals(calls)).toEqual([])
    }
  })

  test("a file git ignores that the main checkout holds the same, as a copy .worktreeinclude made, loses nothing", async () => {
    const STATUS: [string, Partial<ProcessRunResult>] = ["git status", { stdout: "!! node_modules/\0!! .env\0" }]
    // Hashed here first, then in the main checkout.
    const withHashes = (here: string, there: string) => {
      let asked = 0

      return fakeHost(
        [COMMON_DIR, ON_HEAD, STATUS, ["git hash-object", () => ({ stdout: asked++ === 0 ? here : there })]],
        { ...OWN_FOLDER, "/repo/.env": "" }
      )
    }

    const copy = withHashes("h1\n", "h1\n")
    expect(await removePullWorktree(copy.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    const edited = withHashes("mine\n", "main\n")
    expect(await removePullWorktree(edited.host, REPO, OWN, "abc")).toEqual({ outcome: "ignored", file: ".env" })
    expect(removals(edited.calls)).toEqual([])
  })

  test("a copy .worktreeinclude made into a folder tools make again keeps the worktree once edited there", async () => {
    const STATUS: [string, Partial<ProcessRunResult>] = ["git status", { stdout: "!! vendor/\0" }]
    // The worktree's ignored files, then, in vendor/, those the one pattern that names a path there matches.
    const LISTED: [string, Partial<ProcessRunResult>] = [
      "git ls-files -z --others --ignored --exclude-standard --directory",
      { stdout: "vendor/\0" }
    ]
    const INCLUDED = "git ls-files -z --others --ignored --exclude=vendor/creds.json -- :(literal)vendor/"
    const withHashes = (here: string, there: string) => {
      let asked = 0

      return fakeHost(
        [
          COMMON_DIR,
          ON_HEAD,
          STATUS,
          LISTED,
          [INCLUDED, { stdout: "vendor/creds.json\0" }],
          ["git hash-object", () => ({ stdout: asked++ === 0 ? here : there })]
        ],
        { ...OWN_FOLDER, "/repo/.worktreeinclude": "vendor/creds.json\n", "/repo/vendor/creds.json": "" }
      )
    }

    expect(await removePullWorktree(withHashes("h1\n", "h1\n").host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    const edited = withHashes("mine\n", "main\n")
    expect(await removePullWorktree(edited.host, REPO, OWN, "abc")).toEqual({
      outcome: "ignored",
      file: "vendor/creds.json"
    })
    expect(removals(edited.calls)).toEqual([])
  })

  test("one git can't read is not removed, and said so", async () => {
    const { host, calls } = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git status", { exitCode: 128, stderr: "fatal: not a git repository\n" }]],
      OWN_FOLDER
    )

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "failed" })
    expect(removals(calls)).toEqual([])
  })

  test("a folder deleted by hand is unlisted alone, never pruned with the rest, and its branch checked as any other", async () => {
    const BRANCH = "git rev-parse --verify --quiet refs/heads/fix/menu"
    const pushed = fakeHost([COMMON_DIR, [BRANCH, { stdout: "abc\n" }]])
    expect(await removePullWorktree(pushed.host, REPO, OWN, "abc")).toEqual({ outcome: "removed" })
    expect(removals(pushed.calls)).toEqual([`git worktree remove ${PATH}`, "git branch -D -- fix/menu"])

    const local = fakeHost([COMMON_DIR, NOT_WITHIN, [BRANCH, { stdout: "local1\n" }]])
    expect(await removePullWorktree(local.host, REPO, OWN, "abc")).toEqual({ outcome: "unpushed" })
    expect(removals(local.calls)).toEqual([])

    // Folder and branch both gone, as another session cleaned it up, or a detached one: only the record is left.
    const taken = fakeHost([COMMON_DIR, [BRANCH, { exitCode: 1 }]])
    expect(await removePullWorktree(taken.host, REPO, OWN, "abc")).toEqual({ outcome: "gone" })
    expect(removals(taken.calls)).toEqual([`git worktree remove ${PATH}`])
    const detached = fakeHost([COMMON_DIR])
    expect(await removePullWorktree(detached.host, REPO, { ...OWN, branch: null }, "abc")).toEqual({ outcome: "gone" })
  })

  test("a locked worktree whose folder was deleted is refused, still listed, and said not removed", async () => {
    const { host, calls } = fakeHost([
      COMMON_DIR,
      ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "abc\n" }],
      [
        "git worktree remove",
        { exitCode: 128, stderr: "fatal: cannot remove a locked working tree;\nuse 'remove -f -f' to override\n" }
      ],
      ["git worktree list --porcelain", { stdout: `worktree /repo\nHEAD 1\n\nworktree ${PATH}\nHEAD 2\nlocked\n` }]
    ])

    expect(await removePullWorktree(host, REPO, OWN, "abc")).toEqual({ outcome: "failed" })
    expect(removals(calls)).toEqual([`git worktree remove ${PATH}`])
  })

  test("a refused removal keeps the branch too, and a refused branch is said", async () => {
    const STILL_LISTED: [string, Partial<ProcessRunResult>] = [
      "git worktree list --porcelain",
      { stdout: `worktree /repo\nHEAD 1\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/fix/menu\n` }
    ]
    const refused = fakeHost(
      [COMMON_DIR, ON_HEAD, ["git worktree remove", { exitCode: 1, stderr: "fatal: cannot remove" }], STILL_LISTED],
      OWN_FOLDER
    )
    expect(await removePullWorktree(refused.host, REPO, OWN, "abc")).toEqual({ outcome: "failed" })
    expect(removals(refused.calls)).toEqual([`git worktree remove ${PATH}`])

    // Refused as another session removed it meanwhile: it is gone, which is no failure.
    const folder: Record<string, string> = { ...OWN_FOLDER }
    const taken = fakeHost(
      [
        COMMON_DIR,
        ON_HEAD,
        [
          "git worktree remove",
          () => {
            delete folder[PATH]

            return { exitCode: 1, stderr: "fatal: not a working tree" }
          }
        ]
      ],
      folder
    )
    expect(await removePullWorktree(taken.host, REPO, OWN, "abc")).toEqual({ outcome: "gone" })

    // git unlists one it could delete only in part; the folder left behind is no success.
    const partial = fakeHost(
      [
        COMMON_DIR,
        ON_HEAD,
        ["git worktree remove", { exitCode: 255, stderr: "error: failed to delete: Permission denied" }]
      ],
      OWN_FOLDER
    )
    expect(await removePullWorktree(partial.host, REPO, OWN, "abc")).toEqual({ outcome: "failed" })
    expect(removals(partial.calls)).toEqual([`git worktree remove ${PATH}`])

    const branch = fakeHost([COMMON_DIR, ON_HEAD, ["git branch -D", { exitCode: 1 }]], OWN_FOLDER)
    expect(await removePullWorktree(branch.host, REPO, OWN, "abc")).toEqual({ outcome: "branchKept" })
  })

  test("what came of it, said per pull request", () => {
    const note = (
      cleanup: Parameters<typeof worktreeCleanupNote>[2],
      worktree = OWN,
      state: "MERGED" | "CLOSED" = "MERGED"
    ) => worktreeCleanupNote(worktree, state, cleanup)

    expect(note({ outcome: "removed" })).toBe("#7 merged: removed its worktree and the branch fix/menu")
    expect(note({ outcome: "removed" }, { ...OWN, branch: null }, "CLOSED")).toBe("#7 closed: removed its worktree")
    expect(note({ outcome: "branchKept" })).toBe("#7 merged: removed its worktree, but not the branch fix/menu")
    expect(note({ outcome: "uncommitted" })).toBe(
      "#7 merged: kept its worktree .claude/worktrees/pr-7, which has changes not committed"
    )
    expect(note({ outcome: "ignored", file: ".env.local" })).toBe(
      "#7 merged: kept its worktree .claude/worktrees/pr-7, which holds .env.local, a file git ignores"
    )
    expect(note({ outcome: "ignored", file: ".secrets/" })).toBe(
      "#7 merged: kept its worktree .claude/worktrees/pr-7, which holds .secrets/, a folder git ignores"
    )
    expect(note({ outcome: "unpushed" }, OWN, "CLOSED")).toBe(
      "#7 closed: kept its worktree .claude/worktrees/pr-7, which has commits GitHub doesn't have"
    )
    expect(note({ outcome: "failed" })).toBe("#7 merged: could not remove its worktree .claude/worktrees/pr-7")
  })
})

describe("what a cleanup left in place, told once across sessions", () => {
  const KEPT = "#7 merged: kept its worktree .claude/worktrees/pr-7, which has changes not committed"

  test("one left in place is told unless it was told last, and why it stays is kept for next time", () => {
    expect(toldOnce({}, 7, KEPT, true)).toEqual({ isNews: true, told: { "7": KEPT } })
    expect(toldOnce({ "7": KEPT }, 7, KEPT, true)).toEqual({ isNews: false, told: { "7": KEPT } })
    const unpushed = "#7 merged: kept its worktree .claude/worktrees/pr-7, which has commits GitHub doesn't have"
    expect(toldOnce({ "7": KEPT, "9": "x" }, 7, unpushed, true)).toEqual({
      isNews: true,
      told: { "7": unpushed, "9": "x" }
    })
  })

  test("one removed is always told, and forgotten", () => {
    expect(toldOnce({ "7": KEPT, "9": "x" }, 7, "#7 merged: removed its worktree", false)).toEqual({
      isNews: true,
      told: { "9": "x" }
    })
  })

  test("only what was left in place counts as kept: a failure to remove is told once too", () => {
    for (const outcome of ["uncommitted", "ignored", "unpushed", "failed"] as const) {
      expect(isLeftInPlace(outcome)).toBe(true)
    }
    for (const outcome of ["removed", "branchKept", "gone"] as const) {
      expect(isLeftInPlace(outcome)).toBe(false)
    }
  })

  test("nothing kept is no note of either kind; one of each is two kept", () => {
    expect(isNothingKept({ worktrees: {}, branches: {} })).toBe(true)
    expect(isNothingKept({ worktrees: { "7": KEPT }, branches: { "8": KEPT } })).toBe(false)
    expect(isNothingKept({ worktrees: {}, branches: { "8": KEPT } })).toBe(false)
  })

  test("read back whatever the store holds, and forgotten for what /prs no longer has", () => {
    expect(readKeptNotes(undefined)).toEqual({ worktrees: {}, branches: {} })
    expect(readKeptNotes({ worktrees: { "7": KEPT, "8": 1 }, branches: "x" })).toEqual({
      worktrees: { "7": KEPT },
      branches: {}
    })
    expect(keptStill({ worktrees: { "7": KEPT, "8": "y" }, branches: { "12": "z" } }, [7], [])).toEqual({
      worktrees: { "7": KEPT },
      branches: {}
    })
  })
})

describe("which worktrees a cleanup takes up", () => {
  const worktree = (number: number, branch: string | null): PullWorktree => ({
    number,
    path: `/repo/.claude/worktrees/pr-${number}`,
    branch
  })

  test("those of pull requests gone from both lists, not settled yet, as many as one lookup asks after", () => {
    const listed = snapshotOf({ mine: [{ number: 1 }], requested: [{ number: 2, author: "ann" }] })
    const all = [1, 2, 3, 4, 5, 6].map((number) => worktree(number, `feature/${number}`))

    expect(cleanupCandidates(all, listed, new Set([4]), 30).map((each) => each.number)).toEqual([3, 5, 6])
    expect(cleanupCandidates(all, listed, new Set(), 2).map((each) => each.number)).toEqual([3, 4])
  })

  test("removed only when it holds the pull request's own branch, and no open pull request comes from it", () => {
    const ended = { branch: "fix/menu", isCrossRepository: false }
    const open = snapshotOf({ mine: [{ number: 9, headRefName: "fix/shared" }] })

    expect(mayRemoveWorktree(worktree(7, "fix/menu"), ended, open)).toBe(true)
    expect(mayRemoveWorktree(worktree(7, "feature/other"), ended, open)).toBe(false)
    expect(mayRemoveWorktree(worktree(7, null), ended, open)).toBe(false)
    expect(mayRemoveWorktree(worktree(7, "fix/shared"), { ...ended, branch: "fix/shared" }, open)).toBe(false)
  })

  test("a fork's under pr-<number>, which no open pull request of this repository holds", () => {
    const fork = { branch: "main", isCrossRepository: true }
    const open = snapshotOf({ mine: [{ number: 9, headRefName: "pr-7", isCrossRepository: true }] })

    expect(mayRemoveWorktree(worktree(7, "pr-7"), fork, open)).toBe(true)
    expect(
      mayRemoveWorktree(worktree(7, "main"), fork, snapshotOf({ mine: [{ number: 9, headRefName: "main" }] }))
    ).toBe(false)
    // The person's own `main` there, with no open pull request from it, is still not the fork's.
    expect(mayRemoveWorktree(worktree(7, "main"), fork, snapshotOf({ mine: [] }))).toBe(false)
  })
})

describe("the branches a switch here left", () => {
  test("only pr-<number> as /prs names it, and only those no folder has checked out", async () => {
    const { host } = fakeHost([
      COMMON_DIR,
      ["git for-each-ref", { stdout: "pr-12\npr-012\npr-7/x\npr-13\npr-\nfeature/x\n" }],
      ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/pr-13\n" }]
    ])

    expect(await pullBranches(host)).toEqual([{ number: 12, branch: "pr-12" }])
  })

  test("one is the pull request's when it tracks its head, a fork's by its own ref, and no open pull request comes from it", async () => {
    const left = { number: 12, branch: "pr-12" }
    const tracking = (merge: string, remote = "origin") =>
      fakeHost([
        COMMON_DIR,
        ["git config --get branch.pr-12.merge", { stdout: `${merge}\n` }],
        ["git config --get branch.pr-12.remote", { stdout: `${remote}\n` }],
        ["git config --get remote.origin.url", { stdout: "git@github.com:acme/app.git\n" }],
        ["git config --get remote.ann.url", { stdout: "https://github.com/Ann/App\n" }]
      ]).host
    const own = (branch: string | null) => ({ branch, isCrossRepository: false, headRepo: "acme/app" })
    const fork = (branch: string, headRepo: string | null = "ann/app") => ({
      branch,
      isCrossRepository: true,
      headRepo
    })
    const none = snapshotOf({})

    expect(await isLeftForPull(tracking("refs/heads/feature/legend"), left, own("feature/legend"), none)).toBe(true)
    expect(await isLeftForPull(tracking("refs/pull/12/head"), left, fork("main"), none)).toBe(true)
    // A fork that lets maintainers edit: its head on the fork, at its address or on a remote added for it.
    const atFork = tracking("refs/heads/main", "git@github.com:ann/app.git")
    expect(await isLeftForPull(atFork, left, fork("main"), none)).toBe(true)
    expect(await isLeftForPull(tracking("refs/heads/main", "ann"), left, fork("main"), none)).toBe(true)
    const atForkOverSsh = tracking("refs/heads/main", "ssh://git@github.com/ann/app.git")
    expect(await isLeftForPull(atForkOverSsh, left, fork("main"), none)).toBe(true)
    // On GHE.com over ssh the address's user is the tenant's name.
    const atTenantFork = tracking("refs/heads/main", "acme@acme.ghe.com:ann/app.git")
    expect(await isLeftForPull(atTenantFork, left, fork("main"), none)).toBe(true)
    // Another fork's, or one whose fork is gone so none can be told apart.
    expect(await isLeftForPull(atFork, left, fork("main", "bob/app"), none)).toBe(false)
    expect(await isLeftForPull(atFork, left, fork("main", null), none)).toBe(false)
    // A fork's head named like a branch here: a branch of the person's tracking this repository's main is theirs.
    expect(await isLeftForPull(tracking("refs/heads/main"), left, fork("main"), none)).toBe(false)
    // Made by hand or for something else: another upstream, or none.
    expect(await isLeftForPull(tracking("refs/heads/develop"), left, own("feature/legend"), none)).toBe(false)
    expect(await isLeftForPull(tracking(""), left, own(null), none)).toBe(false)
    // An open pull request of this repository comes from a branch of that name.
    const open = snapshotOf({ mine: [{ number: 57, headRefName: "pr-12" }] })
    expect(await isLeftForPull(tracking("refs/pull/12/head"), left, fork("main"), open)).toBe(false)
  })

  test("deleted only with its commit on GitHub; one gone already, or git refusing, comes out as such", async () => {
    const left = { number: 12, branch: "pr-12" }
    const removing = (answers: [string, Partial<ProcessRunResult>][]) => fakeHost([COMMON_DIR, ...answers])

    const pushed = removing([["git rev-parse --verify --quiet refs/heads/pr-12", { stdout: "last\n" }]])
    expect(await removePullBranch(pushed.host, REPO, left, "last")).toEqual({ outcome: "removed" })
    expect(pushed.calls.map((call) => call.argv)).toContain("git branch -D -- pr-12")

    const unpushed = removing([
      ["git rev-parse --verify --quiet refs/heads/pr-12", { stdout: "mine\n" }],
      ["git merge-base --is-ancestor", { exitCode: 1 }]
    ])
    expect(await removePullBranch(unpushed.host, REPO, left, "last")).toEqual({ outcome: "unpushed" })
    expect(unpushed.calls.some((call) => call.argv.startsWith("git branch -D"))).toBe(false)

    const gone = removing([["git rev-parse --verify --quiet refs/heads/pr-12", { exitCode: 1 }]])
    expect(await removePullBranch(gone.host, REPO, left, "last")).toEqual({ outcome: "gone" })

    const refused = removing([
      ["git rev-parse --verify --quiet refs/heads/pr-12", { stdout: "last\n" }],
      ["git branch -D", { exitCode: 1, stderr: "error: cannot delete branch 'pr-12' used by worktree" }]
    ])
    expect(await removePullBranch(refused.host, REPO, left, "last")).toEqual({ outcome: "failed" })
  })
})

// How a pull request that left the lists ended, as a load found it.
function ended(number: number, state: ClosedState["state"]): ClosedState {
  return { number, state, by: null, head: `head-${number}`, branch: null, isCrossRepository: false, headRepo: null }
}

// A cleanup's host over `git`, the store in memory `world` and the clock at `clock.now`, with the list `snapshotOf({})`
// stored: what it toasts and logs, the store's debug lines among them, is kept.
function cleanupHostOver(git: Host, world: StoreWorld = {}, clock = { now: 0 }) {
  const toasts: string[] = []
  const logs: string[] = []
  const store = memoryStoreHost(world, clock, logs)
  const host: CleanupHost = {
    ...git,
    log: (line) => {
      logs.push(line)
    },
    now: async () => clock.now,
    storedList: async () => snapshotOf({}),
    announce: async (_repo, lines) => {
      toasts.push(...lines)
    },
    recallKept: (repo, root) => recallKept(store, repo, root),
    keepKept: (repo, root, kept) => keepKept(store, repo, root, kept),
    recallCleanup: (root) => recallCleanup(store, root),
    claimCleanup: (root, claim) => claimCleanup(store, root, claim),
    freeCleanup: (root, by) => freeCleanup(store, root, by)
  }

  return { host, toasts, logs }
}

// A cleanup's host whose list waits until the test lets it go (`release`), counting the runs that read it; with no
// list, a run ends there.
function heldHost(): { host: CleanupHost; runs: () => number; release: () => void } {
  let runs = 0
  let release = (): void => {}
  const held = new Promise<null>((resolve) => {
    release = () => resolve(null)
  })
  const host: CleanupHost = {
    ...cleanupHostOver(fakeHost([]).host).host,
    storedList: () => {
      runs += 1

      return held
    }
  }

  return { host, runs: () => runs, release: () => release() }
}

describe("a cleanup's runs", () => {
  test("one GitHub could not answer about is looked at again by the next pass, not left for the session", async () => {
    let isGithubDown = true
    const { host: git, calls } = fakeHost(
      [
        COMMON_DIR,
        ["git rev-parse --show-toplevel", { stdout: "/repo\n" }],
        [
          "git worktree list --porcelain",
          {
            stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/pr-7\n`
          }
        ],
        ["git for-each-ref", { stdout: "" }],
        ["git status", { stdout: "" }],
        ["git rev-parse HEAD", { stdout: "abc\n" }],
        ["git branch -r --contains", { stdout: "" }],
        ["git merge-base --is-ancestor", { exitCode: 128, stderr: "fatal: Not a valid commit name head-7\n" }],
        [
          "gh api repos/acme/app/compare",
          () =>
            isGithubDown
              ? { exitCode: 1, stderr: "error connecting to api.github.com\n" }
              : { exitCode: 0, stdout: "ahead\n" }
        ]
      ],
      OWN_FOLDER
    )
    const { host, logs } = cleanupHostOver(git)
    const session = createSession(readSettings({}))
    const removals = () => calls.map((call) => call.argv).filter((argv) => argv.startsWith("git worktree remove"))

    await cleanUp(host, session, REPO, [ended(7, "MERGED")])
    expect(removals()).toEqual([])
    expect(logs).toContain("The worktree of #7 could not be cleaned up: error connecting to api.github.com")

    isGithubDown = false
    await cleanUp(host, session, REPO, [ended(7, "MERGED")])
    expect(removals()).toEqual([`git worktree remove ${PATH}`])
  })

  test("a branch GitHub could not answer about is looked at again by the next pass too", async () => {
    let isGithubDown = true
    const { host: git, calls } = fakeHost([
      COMMON_DIR,
      ["git worktree list --porcelain", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }],
      ["git for-each-ref", { stdout: "pr-7\n" }],
      ["git config --get branch.pr-7.merge", { stdout: "refs/pull/7/head\n" }],
      ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "abc\n" }],
      ["git branch -r --contains", { stdout: "" }],
      ["git merge-base --is-ancestor", { exitCode: 128, stderr: "fatal: Not a valid commit name head-7\n" }],
      [
        "gh api repos/acme/app/compare",
        () =>
          isGithubDown
            ? { exitCode: 1, stderr: "error connecting to api.github.com\n" }
            : { exitCode: 0, stdout: "ahead\n" }
      ]
    ])
    const { host, logs } = cleanupHostOver(git)
    const session = createSession(readSettings({}))
    const deletions = () => calls.map((call) => call.argv).filter((argv) => argv.startsWith("git branch -D"))

    await cleanUp(host, session, REPO, [ended(7, "MERGED")])
    expect(deletions()).toEqual([])
    expect(logs).toContain("The branch pr-7 could not be cleaned up: error connecting to api.github.com")

    isGithubDown = false
    await cleanUp(host, session, REPO, [ended(7, "MERGED")])
    expect(deletions()).toEqual(["git branch -D -- pr-7"])
  })

  test("a pull request leaving while a cleanup runs makes it run once more, not twice", async () => {
    const session = createSession(readSettings({}))
    const { host, runs, release } = heldHost()

    const first = cleanUp(host, session, REPO, [])
    await cleanUp(host, session, REPO, [])
    await cleanUp(host, session, REPO, [])
    expect(runs()).toBe(1)
    release()
    await first
    expect(runs()).toBe(2)
    expect(session.cleanup.isRunning).toBe(false)
  })

  test("what loads found goes to the next run alone, merged by number", async () => {
    const session = createSession(readSettings({}))
    const { host, release } = heldHost()

    const first = cleanUp(host, session, REPO, [ended(7, "MERGED")])
    expect(session.cleanup.known).toEqual([])
    await cleanUp(host, session, REPO, [ended(8, "CLOSED")])
    await cleanUp(host, session, REPO, [ended(8, "MERGED"), ended(9, "CLOSED")])
    expect(session.cleanup.known).toEqual([ended(8, "MERGED"), ended(9, "CLOSED")])
    release()
    await first
    expect(session.cleanup.known).toEqual([])
  })

  test("a worktree a run found not /prs's to take away is not asked about again", async () => {
    const { host: git, calls } = fakeHost([
      COMMON_DIR,
      [
        "git worktree list --porcelain",
        {
          stdout: [
            "worktree /repo\nHEAD 1\nbranch refs/heads/main",
            `worktree ${PATH}\nHEAD 2\nbranch refs/heads/feature/x`
          ].join("\n\n")
        }
      ]
    ])
    const { host } = cleanupHostOver(git)
    const session = createSession(readSettings({}))

    await cleanUp(host, session, REPO, [ended(7, "MERGED")])
    await cleanUp(host, session, REPO, [])
    expect(calls.filter((call) => call.argv.startsWith("gh "))).toEqual([])
    expect([...session.cleanup.settledWorktrees]).toEqual([7])
  })
})

describe("one session cleans up a clone at a time", () => {
  const removals = (calls: Call[]): string[] =>
    calls.map((call) => call.argv).filter((argv) => /^git (worktree (remove|prune)|branch -D)/.test(argv))
  const MERGED: ClosedState = { ...ended(7, "MERGED"), branch: "fix/menu" }
  const DONE = "#7 merged: removed its worktree and the branch fix/menu"
  const KEY = cleanupKey("/repo")

  // The clone at /repo with #7's worktree, clean and at its pull request's last head; the claim the store holds as
  // `git worktree remove` runs is kept in `during`.
  function cloneWith(world: StoreWorld) {
    const during: unknown[] = []
    const { host: git, calls } = fakeHost(
      [
        COMMON_DIR,
        ["git rev-parse --show-toplevel", { stdout: "/repo\n" }],
        [
          "git worktree list --porcelain",
          {
            stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/fix/menu\n`
          }
        ],
        ["git for-each-ref", { stdout: "" }],
        ["git rev-parse HEAD", { stdout: "head-7\n" }],
        [
          "git worktree remove",
          () => {
            during.push(world.store?.[KEY])

            return {}
          }
        ]
      ],
      OWN_FOLDER
    )

    return { git, calls, during }
  }

  test("a pass holds the clone's claim while it removes, and frees it after", async () => {
    const world: StoreWorld = {}
    const { git, during } = cloneWith(world)
    const { host, toasts } = cleanupHostOver(git, world, { now: 5_000 })
    const session = createSession(readSettings({}))

    await cleanUp(host, session, REPO, [MERGED])
    expect(during).toEqual([{ by: session.id, at: 5_000 }])
    expect(toasts).toEqual([DONE])
    expect(world.store?.[KEY]).toBeUndefined()
  })

  test("a pass claims the clone before it asks git about the worktrees, so a pass starting meanwhile leaves them", async () => {
    const world: StoreWorld = {}
    const claims: unknown[] = []
    const { host: git } = fakeHost([
      COMMON_DIR,
      [
        "git worktree list --porcelain",
        () => {
          claims.push(world.store?.[KEY])

          return { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }
        }
      ],
      ["git for-each-ref", { stdout: "" }]
    ])
    const { host } = cleanupHostOver(git, world, { now: 5_000 })
    const session = createSession(readSettings({}))

    await cleanUp(host, session, REPO, [])
    expect(claims.length).toBeGreaterThan(0)
    expect(claims.every((claim) => JSON.stringify(claim) === JSON.stringify({ by: session.id, at: 5_000 }))).toBe(true)
  })

  test("another session's pass under way leaves this one's to the next, which asks GitHub nothing new", async () => {
    const clock = { now: CLEANUP_CLAIM_MS - 1 }
    const world: StoreWorld = { store: { [KEY]: { by: "another-session", at: 0 } } }
    const { git, calls } = cloneWith(world)
    const { host, toasts } = cleanupHostOver(git, world, clock)
    const session = createSession(readSettings({}))

    await cleanUp(host, session, REPO, [MERGED])
    expect(removals(calls)).toEqual([])
    expect(toasts).toEqual([])
    expect([...session.cleanup.settledWorktrees]).toEqual([])
    // Its claim lapses, as that session went without freeing it: the next pass cleans up.
    clock.now = CLEANUP_CLAIM_MS
    await cleanUp(host, session, REPO, [])
    expect(removals(calls)).toEqual([`git worktree remove ${PATH}`, "git branch -D -- fix/menu"])
    expect(toasts).toEqual([DONE])
    expect(calls.some((call) => call.argv.startsWith("gh "))).toBe(false)
  })

  test("its own claim, kept over a reload, or one dated ahead of the clock, holds nothing back", async () => {
    for (const claim of [
      { by: "this-session", at: 1_000 },
      { by: "another-session", at: 1_000 + 10 * CLEANUP_CLAIM_MS }
    ]) {
      const world: StoreWorld = { store: { [KEY]: claim } }
      const { git, calls } = cloneWith(world)
      const { host } = cleanupHostOver(git, world, { now: 1_000 })
      const session = createSession(readSettings({}))
      session.id = "this-session"

      await cleanUp(host, session, REPO, [MERGED])
      expect(removals(calls)).toContain(`git worktree remove ${PATH}`)
    }
  })

  test("a claim the store can't read, keep or free is logged, and the cleanup goes on", async () => {
    const broken: StoreWorld = { isStoreBroken: true }
    const unread = cleanupHostOver(cloneWith(broken).git, broken)
    await cleanUp(unread.host, createSession(readSettings({})), REPO, [MERGED])
    expect(unread.toasts).toEqual([DONE])
    expect(unread.logs).toContain("The claim on the cleanup of /repo could not be read: store unavailable")
    expect(unread.logs).toContain("The claim on the cleanup of /repo could not be freed: store unavailable")

    const refused: StoreWorld = { storeSetDeny: "the disk is full", storeDenyPrefix: "cleanup:" }
    const unkept = cleanupHostOver(cloneWith(refused).git, refused)
    await cleanUp(unkept.host, createSession(readSettings({})), REPO, [MERGED])
    expect(unkept.toasts).toEqual([DONE])
    expect(unkept.logs).toContain(
      "The cleanup of /repo could not be claimed: gh-prs-monitor: $.store.set: the disk is full"
    )
  })
})
