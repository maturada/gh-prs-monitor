// Author: David Matura

import type { ProcessRunResult } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import type { PullRow } from "../types"
import { checkedOut, checkedOutBranch, newerCheckout, prepareWorktree, switchHere } from "./checkout"
import { addressOf, hostOf } from "./fetch-source"
import { FORK_DEPS_NOTE } from "./deps"
import { isWithin } from "./machine"
import type { Host } from "./machine"
import { COMMON_DIR, fakeHost, OWN_FOLDER, PATH } from "./testing/git-host"
import type { Call } from "./testing/git-host"
import { REPO } from "./testing/fixtures"

const ROW: PullRow = {
  number: 7,
  title: "Fix the menu",
  url: "https://github.com/acme/app/pull/7",
  author: "me",
  headRefName: "fix/menu",
  headOid: "abc",
  baseRefName: "main",
  isCrossRepository: false,
  isDraft: false,
  stack: null,
  stage: "changesRequested",
  status: { text: "Changes Requested", tone: "warning" },
  details: [],
  actions: ["resolve"],
  primary: "resolve",
  rerequestFrom: [],
  isReviewerUnrequested: false,
  signals: {
    ci: "SUCCESS",
    isConflicting: false,
    unresolvedThreads: 1,
    isAutoMerge: false,
    isQueued: false,
    reviews: {},
    conversation: { count: 0, authors: [] },
    isRequested: false,
    hasCommitsSinceMyReview: false
  }
}
const FORK: PullRow = { ...ROW, isCrossRepository: true }

type Answer = [string, Partial<ProcessRunResult> | ((line: string, stdin: string) => Partial<ProcessRunResult>)]
// git's remotes here: origin is the pull request's repository.
const ORIGIN: Answer = [
  "git remote -v",
  { stdout: "origin\tgit@github.com:acme/app.git (fetch)\norigin\tgit@github.com:acme/app.git (push)\n" }
]
// The pull request's head once fetched, as the remote's copy of its branch, or as FETCH_HEAD.
const FETCHED: Answer[] = [
  ["git rev-parse --verify --quiet refs/remotes/", { stdout: "head\n" }],
  ["git rev-parse --verify --quiet FETCH_HEAD", { stdout: "head\n" }]
]
// GitHub's answer about a fork's pull request: where its branch lives, and whether its maintainers may push there.
const forkPull = (canModify = false, repo: string | null = "ann/app"): Answer => [
  "gh api repos/acme/app/pulls/7 --hostname github.com",
  {
    stdout: JSON.stringify({
      state: "open",
      head: { sha: "head", repo: repo === null ? null : { full_name: repo } },
      maintainer_can_modify: canModify
    })
  }
]
// git's list of the files that name a project in the main checkout, as the files there stand when asked.
const trackedIn = (files: Record<string, string>): Answer => [
  "git ls-files -z --",
  () => ({
    stdout: Object.keys(files)
      .filter((path) => path.startsWith("/repo/") && !path.startsWith("/repo/.claude/"))
      .map((path) => `${path.slice("/repo/".length)}\0`)
      .join("")
  })
]
// A machine where the pull request fetches and git checks it out, unless `answers`, asked first, say otherwise.
const gitHost = (answers: Answer[], files: Record<string, string> = {}) =>
  fakeHost([...answers, ORIGIN, ...FETCHED, forkPull(), trackedIn(files)], files)
// What git checked out, and how: each move of a folder is git's own `switch --no-overwrite-ignore`.
const moves = (calls: Call[]): string[] =>
  calls.filter((call) => call.argv.startsWith("git switch --no-overwrite-ignore")).map((call) => call.argv)
const FETCH = "git -c credential.helper= -c credential.helper=!gh auth git-credential fetch --no-tags"
const DIVERGED_PR_7 =
  "the local branch pr-7 has gone its own way from the pull request: reset or delete it once nothing of yours is on it"
// git's refusal to check out over files it doesn't track, as it words it.
const IN_THE_WAY =
  "error: The following untracked working tree files would be overwritten by checkout:\n\t.env\nPlease move or remove them before you switch branches.\nAborting\n"
// A sparse checkout, as git answers about it: the files it doesn't track there, and the paths a move changes.
const SPARSE: Answer = ["git config --type=bool --get core.sparseCheckout", { stdout: "true\n" }]
const UNTRACKED = "git ls-files --others --directory --no-empty-directory --full-name -z -- :/"
const names = (paths: string[]) => paths.map((path) => `${path}\0`).join("")
const sparseAnswers = (untracked: string[], written: string[]): Answer[] => [
  SPARSE,
  [UNTRACKED, { stdout: names(untracked) }],
  ["git diff-tree -r --name-only --no-renames -z HEAD ", { stdout: names(written) }]
]

describe("the branch checked out", () => {
  test("is read by its full name, as a tag of the same name makes git shorten it to heads/<name>", async () => {
    const { host } = fakeHost([
      ["git rev-parse HEAD --symbolic-full-name HEAD", { stdout: "1a2b3c\nrefs/heads/feature/menu\n" }],
      ["git rev-parse --symbolic-full-name HEAD", { stdout: "refs/heads/feature/menu\n" }]
    ])

    expect(await checkedOut(host)).toEqual({ branch: "feature/menu", head: "1a2b3c" })
    expect(await checkedOutBranch(host)).toBe("feature/menu")
  })

  test("is none on a commit of its own, and nothing at all in a repository with no commits", async () => {
    const detached = fakeHost([
      ["git rev-parse HEAD --symbolic-full-name HEAD", { stdout: "1a2b3c\nHEAD\n" }],
      ["git rev-parse --symbolic-full-name HEAD", { stdout: "HEAD\n" }]
    ])
    expect(await checkedOut(detached.host)).toEqual({ branch: null, head: "1a2b3c" })
    expect(await checkedOutBranch(detached.host)).toBeNull()

    const empty = fakeHost([
      [
        "git rev-parse HEAD --symbolic-full-name HEAD",
        { exitCode: 128, stdout: "HEAD\n", stderr: "fatal: ambiguous argument 'HEAD'" }
      ]
    ])
    expect(await checkedOut(empty.host)).toEqual({ branch: null, head: null })
  })
})

describe("whether a commit is the tip or one before it", () => {
  test("the tip itself, asking git nothing; one before it; one git says isn't; or one this clone lacks, unknown", async () => {
    const same = fakeHost([])
    expect(await isWithin(same.host, "tip", "tip")).toBe("within")
    expect(same.calls).toEqual([])

    for (const [exitCode, within] of [
      [0, "within"],
      [1, "not"],
      [128, "unknown"]
    ] as const) {
      const { host, calls } = fakeHost([["git merge-base --is-ancestor", { exitCode }]])
      expect(await isWithin(host, "older", "tip")).toBe(within)
      expect(calls.map((call) => call.argv)).toEqual(["git merge-base --is-ancestor older tip"])
    }
  })
})

describe("the checkout kept", () => {
  test("is the one read last, never one read before it, and the one read now where none was kept", () => {
    const loaded = { branch: "feature/export", head: "local-head", at: 1_000 }
    const pressed = { branch: "main", head: "main-head", at: 2_000 }

    expect(newerCheckout(null, loaded)).toBe(loaded)
    expect(newerCheckout(loaded, pressed)).toBe(pressed)
    expect(newerCheckout(pressed, loaded)).toBe(pressed)
    // Read at the same moment, the one written last.
    expect(newerCheckout(loaded, { ...pressed, at: 1_000 })).toEqual({ ...pressed, at: 1_000 })
  })

  test("gives way to one read after the clock was set back, as no load takes a minute from its read to its write", () => {
    const ahead = { branch: "fix/menu", head: "menu-head", at: 3_600_000 }
    const read = { branch: "feature/export", head: "local-head", at: 3_600_000 - 60_001 }

    expect(newerCheckout(ahead, read)).toBe(read)
    expect(newerCheckout(ahead, { ...read, at: 3_600_000 - 60_000 })).toBe(ahead)
  })
})

describe("prepareWorktree", () => {
  test("makes none through a link at .claude, .claude/worktrees or its own folder, which could lead anywhere", async () => {
    for (const link of ["/repo/.claude", "/repo/.claude/worktrees", PATH]) {
      const { host, calls } = fakeHost([COMMON_DIR], {}, new Set([link]))

      await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(`${link.slice("/repo/".length)} is a link`)
      expect(calls.filter((call) => !call.argv.startsWith("git rev-parse"))).toEqual([])
    }
  })

  // The own worktree's folder as git leaves it, with the `.git` file that names the clone.
  const WORKTREE_FOLDER = { ...OWN_FOLDER, [`${PATH}/.git`]: "gitdir: /repo/.git/worktrees/pr-7\n" }
  const ownOn = (branch: string): Answer => [
    "git worktree list",
    {
      stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/${branch}\n`
    }
  ]

  test("adds a worktree, keeps it out of git status, and checks the pull request out in it as gh would", async () => {
    const { host, calls, written } = gitHost(
      [
        COMMON_DIR,
        ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }],
        ["git check-ignore", { exitCode: 1 }]
      ],
      { "/repo/.git/info/exclude": "# git ls-files --others --exclude-from=.git/info/exclude" }
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(written["/repo/.git/info/exclude"]).toBe(
      "# git ls-files --others --exclude-from=.git/info/exclude\n/.claude/worktrees/\n"
    )
    // The head's branch fetched into the remote's copy of it, which the new branch then follows.
    expect(calls.filter((call) => !/^git (rev-parse|config (--type=bool )?--get)/.test(call.argv))).toEqual([
      { argv: "git worktree list --porcelain", cwd: "/repo" },
      { argv: "git check-ignore -q .claude/worktrees/probe", cwd: "/repo" },
      { argv: `git worktree add --detach ${PATH}`, cwd: "/repo" },
      { argv: "git remote -v", cwd: PATH },
      { argv: `${FETCH} origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu`, cwd: PATH },
      { argv: "git switch --no-overwrite-ignore -c pr-7 head", cwd: PATH, env: { LC_ALL: "C" } },
      { argv: "git config branch.pr-7.remote origin", cwd: PATH },
      { argv: "git config branch.pr-7.merge refs/heads/fix/menu", cwd: PATH }
    ])
  })

  test("a new worktree gets the ignored files .worktreeinclude names; a fork's gets none", async () => {
    const included = (answers: Answer[] = []) =>
      gitHost(
        [
          ...answers,
          COMMON_DIR,
          ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }],
          ["git ls-files -z --others --ignored --exclude-standard --directory", { stdout: ".env\0" }],
          ["git ls-files -z --others --ignored --exclude-from=/repo/.worktreeinclude --", { stdout: ".env\0" }],
          // The pull request's branch ignores it too.
          ["git check-ignore --stdin -z", (_, stdin) => ({ stdout: stdin })]
        ],
        { "/repo/.worktreeinclude": ".env\n" }
      )
    const copies = (calls: Call[]) => calls.filter((call) => call.argv.startsWith("cp ")).map((call) => call.argv)

    const own = included()
    expect(await prepareWorktree(own.host, ROW, REPO)).toEqual({ path: PATH })
    expect(copies(own.calls)).toEqual([`cp -p -- /repo/.env ${PATH}`])
    const fork = included()
    await prepareWorktree(fork.host, FORK, REPO)
    expect(copies(fork.calls)).toEqual([])
    // Files it could not copy are said so; the worktree is used all the same.
    const failing = included([["cp ", { exitCode: 1 }]])
    expect(await prepareWorktree(failing.host, ROW, REPO)).toEqual({
      path: PATH,
      warning: "could not copy .env from .worktreeinclude into the worktree"
    })
    // And so is a list git can't give whole, as what it left out can't be known.
    const unlisted = "could not copy what .worktreeinclude names into the worktree: git could not list them whole"
    for (const answer of [
      [
        "git ls-files -z --others --ignored --exclude-standard --directory",
        { stdout: ".env\0", isStdoutTruncated: true }
      ],
      ["git ls-files -z --others --ignored --exclude-from", { exitCode: 128 }]
    ] as Answer[]) {
      const cut = included([answer])
      expect(await prepareWorktree(cut.host, ROW, REPO)).toEqual({ path: PATH, warning: unlisted })
      expect(copies(cut.calls)).toEqual([])
    }
  })

  test("an ignored worktrees folder is left alone", async () => {
    const { host, written } = gitHost([COMMON_DIR, ["git check-ignore", { exitCode: 0 }]])

    await prepareWorktree(host, ROW, REPO)

    expect(written).toEqual({})
  })

  test("the pull request always goes on pr-<number>, so no branch of the head's name is held here and kept from you", async () => {
    // Free, checked out in the person's folder, or listed for a folder deleted by hand: the worktree takes none.
    const lists = [
      "worktree /repo\nHEAD 1\nbranch refs/heads/main\n",
      "worktree /repo\nHEAD 2\nbranch refs/heads/fix/menu\n",
      "worktree /gone\nHEAD 2\nbranch refs/heads/fix/menu\nprunable\n"
    ]
    for (const list of lists) {
      const { host, calls } = gitHost([
        COMMON_DIR,
        ["git check-ignore", { exitCode: 0 }],
        ["git worktree list", { stdout: list }]
      ])

      expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
      expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
    }
  })

  test("a pr-<number> left from an earlier run behind the pull request is brought up to it, keeping what it follows", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }],
      ["git config --get branch.pr-7.merge", { stdout: "refs/heads/fix/menu\n" }]
    ])

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(calls).toContainEqual({ argv: "git merge-base --is-ancestor old head", cwd: PATH })
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -C pr-7 --no-track head"])
    expect(calls.some((call) => /^git config branch\./.test(call.argv))).toBe(false)
  })

  test("a pr-<number> that went its own way is brought to GitHub's version when GitHub has its commit and nothing in it changed", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }],
      ["git merge-base --is-ancestor", { exitCode: 1 }],
      ["git status --porcelain --untracked-files=normal", { stdout: "" }],
      ["gh api repos/acme/app/commits/old", { exitCode: 0 }]
    ])

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    // Still git's own checkout, which refuses rather than overwrite a file it doesn't track.
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -C pr-7 --no-track head"])
    expect(calls).toContainEqual({
      argv: "gh api repos/acme/app/commits/old --hostname github.com --silent",
      cwd: undefined
    })
  })

  test("a pr-<number> that could not be checked out for another reason is not reset", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }],
      ["git switch --no-overwrite-ignore", { exitCode: 128, stderr: "fatal: unable to write new index file\n" }]
    ])

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      "could not check out the pull request in a worktree: fatal: unable to write new index file"
    )
    expect(moves(calls)).toHaveLength(1)
    expect(calls.some((call) => call.argv.startsWith("gh api"))).toBe(false)
  })

  test("a pr-<number> that went its own way is kept when GitHub lacks its commit, or something in it changed", async () => {
    const run = (answers: Answer[]) =>
      gitHost([
        COMMON_DIR,
        ["git check-ignore", { exitCode: 0 }],
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "mine\n" }],
        ["git merge-base --is-ancestor", { exitCode: 1 }],
        ...answers
      ])
    const unknown = run([["gh api repos/acme/app/commits", { exitCode: 1, stderr: "gh: No commit found (HTTP 422)" }]])
    const changed = run([["git status --porcelain --untracked-files=normal", { stdout: " M src/menu.ts\n" }]])
    const unreadable = run([["git status --porcelain --untracked-files=normal", { exitCode: 128 }]])

    for (const { host, calls } of [unknown, changed, unreadable]) {
      await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
        `could not check out the pull request in a worktree: ${DIVERGED_PR_7}`
      )
      expect(moves(calls)).toEqual([])
      expect(calls.map((call) => call.argv)).toContain(`git worktree remove --force ${PATH}`)
    }
    for (const { calls } of [changed, unreadable]) {
      expect(calls.some((call) => call.argv.startsWith("gh api repos/acme/app/commits"))).toBe(false)
    }
  })

  test("a pr-<number> another folder works on is not taken, and the flow says where it is", async () => {
    // Switched to there before: git keeps a branch in one worktree, and that folder is the person's.
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/pr-7\n" }],
      ["git check-ignore", { exitCode: 0 }]
    ])

    await expect(prepareWorktree(host, FORK, REPO)).rejects.toThrow(
      "could not check out the pull request in a worktree: the branch pr-7 is checked out in /repo: switch that folder to another branch to work on the pull request apart from it"
    )
    // Said before anything is fetched.
    expect(calls.some((call) => call.argv.includes(" fetch ") || call.argv.startsWith("git checkout"))).toBe(false)
    expect(calls.map((call) => call.argv)).toContain(`git worktree remove --force ${PATH}`)
  })

  test("a fork's pull request is checked out as pr-<number>, never under its head's name", async () => {
    // The main checkout on a branch of the fork's head's name, which is not the fork's.
    const fresh = gitHost([
      COMMON_DIR,
      ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/fix/menu\n" }],
      ["git check-ignore", { exitCode: 0 }]
    ])
    await prepareWorktree(fresh.host, FORK, REPO)
    expect(moves(fresh.calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
    // GitHub's copy of the fork's head, as no remote here is the fork.
    expect(fresh.calls.map((call) => call.argv)).toContain(`${FETCH} origin refs/pull/7/head`)

    // Its own worktree on the head's name, as an earlier version made or the person switched to a branch of theirs
    // of that name, as `main`, is not the fork's, and nothing in it is touched.
    const own = gitHost(
      [COMMON_DIR, ownOn("fix/menu"), ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "head\n" }]],
      OWN_FOLDER
    )
    await expect(prepareWorktree(own.host, FORK, REPO)).rejects.toThrow(
      `${PATH} holds the branch fix/menu, not the pull request's: switch it back or remove it`
    )
    expect(moves(own.calls)).toEqual([])
  })

  test("a pr-<number> folder holding another branch is not the pull request's, and nothing in it is touched", async () => {
    // The host's own worktree of that name, or one the person switched to a branch of theirs.
    for (const branch of ["worktree-pr-7", "develop"]) {
      const { host, calls } = gitHost(
        [COMMON_DIR, ["git worktree list", { stdout: `worktree ${PATH}\nHEAD 2\nbranch refs/heads/${branch}\n` }]],
        OWN_FOLDER
      )

      await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
        `${PATH} holds the branch ${branch}, not the pull request's: switch it back or remove it`
      )
      expect(
        calls.filter((call) => !call.argv.startsWith("git rev-parse") && !call.argv.startsWith("git worktree list"))
      ).toEqual([])
    }
  })

  test("the pull request's own worktree on pr-<number> is updated on it", async () => {
    const { host, calls } = gitHost(
      [COMMON_DIR, ownOn("pr-7"), ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }]],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(calls).toContainEqual({
      argv: `${FETCH} origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu`,
      cwd: PATH
    })
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -C pr-7 --no-track head"])
  })

  test("its folder git spells otherwise in case only, as after the repository's was renamed so, is the same one", async () => {
    // git keeps the path the worktree was made at; the file system ignores case, so it is this folder.
    const respelt: Answer = [
      "git worktree list",
      {
        stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /Repo/.claude/worktrees/pr-7\nHEAD 2\nbranch refs/heads/pr-7\n`
      }
    ]
    const ignoringCase = (answer: string): Answer => ["git config --type=bool core.ignorecase", { stdout: answer }]
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        respelt,
        ignoringCase("true\n"),
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }]
      ],
      { ...OWN_FOLDER, [`${PATH}/.git`]: "" }
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(calls.some((call) => call.argv.startsWith("git worktree repair"))).toBe(false)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -C pr-7 --no-track head"])
    // Where git says the file system minds case, it is another folder, and is relinked as one.
    const minding = gitHost([COMMON_DIR, respelt, ignoringCase("false\n")], { ...OWN_FOLDER, [`${PATH}/.git`]: "" })
    await prepareWorktree(minding.host, ROW, REPO).catch(() => undefined)
    expect(minding.calls.some((call) => call.argv.startsWith("git worktree repair"))).toBe(true)
  })

  test("an own worktree whose branch went its own way on GitHub is brought to GitHub's version when that loses nothing", async () => {
    const own = (answers: Answer[]) =>
      gitHost(
        [
          COMMON_DIR,
          ownOn("fix/menu"),
          ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "pushed\n" }],
          ["git merge-base --is-ancestor", { exitCode: 1 }],
          ...answers
        ],
        OWN_FOLDER
      )

    // Pushed before a rebase on GitHub, as by the pane's Update Branch.
    const pushed = own([])
    expect(await prepareWorktree(pushed.host, ROW, REPO)).toEqual({ path: PATH })
    expect(moves(pushed.calls)).toEqual(["git switch --no-overwrite-ignore -C fix/menu --no-track head"])

    // A commit GitHub never had stays, the worktree used as it is.
    const unpushed = own([["gh api repos/acme/app/commits", { exitCode: 1 }]])
    expect(await prepareWorktree(unpushed.host, ROW, REPO)).toEqual({
      path: PATH,
      warning:
        "the worktree could not be updated, so it may be behind (the local branch fix/menu has gone its own way from the pull request: reset or delete it once nothing of yours is on it)"
    })
    expect(moves(unpushed.calls)).toEqual([])
  })

  test("a file git doesn't track in the own worktree, where the pull request's branch has one, keeps it as it is", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ownOn("pr-7"),
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }],
        ["git switch --no-overwrite-ignore", { exitCode: 1, stderr: IN_THE_WAY }]
      ],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({
      path: PATH,
      warning:
        "the worktree could not be updated, so it may be behind (that would overwrite .env in the worktree, which git doesn't track and the pull request's branch does: move it aside)"
    })
    expect(calls.some((call) => call.argv.startsWith("git config branch."))).toBe(false)
  })

  test("in a sparse own worktree, a file git doesn't track where the update writes keeps it as it is", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ownOn("pr-7"),
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "old\n" }],
        ...sparseAnswers(["node_modules/", ".env"], [".env", "src/menu.ts"])
      ],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({
      path: PATH,
      warning:
        "the worktree could not be updated, so it may be behind (that would overwrite .env in the worktree, which git doesn't track and the pull request's branch does: move it aside)"
    })
    expect(moves(calls)).toEqual([])
  })

  test("an own worktree that can't fetch the pull request is used as it is, with a warning", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ownOn("fix/menu"),
        [FETCH, { exitCode: 128, stderr: "fatal: unable to access 'https://github.com/acme/app.git/'\n" }]
      ],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({
      path: PATH,
      warning:
        "the worktree could not be updated, so it may be behind (the pull request could not be fetched: fatal: unable to access 'https://github.com/acme/app.git/')"
    })
    expect(moves(calls)).toEqual([])
    expect(calls.some((call) => call.argv.startsWith("gh api"))).toBe(false)
  })

  test("a fork whose pr-<number> went its own way is said so, and never reset from here", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ownOn("pr-7"),
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "pushed\n" }],
        ["git merge-base --is-ancestor", { exitCode: 1 }]
      ],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, FORK, REPO)).toEqual({
      path: PATH,
      warning: `the worktree could not be updated, so it may be behind (${DIVERGED_PR_7})`
    })
    // A fork's commits live in the fork.
    expect(calls.some((call) => call.argv.startsWith("gh api repos/acme/app/commits"))).toBe(false)
    expect(moves(calls)).toEqual([])
  })

  test("an own worktree left without a branch is not used for the pull request", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ["git worktree list", { stdout: `worktree ${PATH}\nHEAD 2\ndetached\n` }],
        [FETCH, { exitCode: 128, stderr: "fatal: couldn't find remote ref refs/heads/fix/menu\n" }]
      ],
      OWN_FOLDER
    )

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      `the worktree at ${PATH} holds no branch and could not check one out: the pull request could not be fetched: fatal: couldn't find remote ref refs/heads/fix/menu`
    )
    // Back on no branch, so a branch a failed step switched to is not taken for the pull request's next time.
    expect(calls).toContainEqual({ argv: "git checkout --detach", cwd: PATH })
  })

  test("an own worktree on no branch, at commits nothing else holds, is left as it is", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        ["git worktree list", { stdout: `worktree ${PATH}\nHEAD 2\ndetached\n` }],
        ["git rev-parse --verify --quiet HEAD", { stdout: "c0ffee\n" }],
        // A stash of the person's holds them, until it is dropped.
        [
          "git for-each-ref --contains c0ffee",
          (line) => ({ stdout: line.includes(" refs/heads") ? "" : "refs/stash\n" })
        ],
        [
          "gh api repos/acme/app/commits/c0ffee",
          { exitCode: 1, stderr: "gh: No commit found for SHA: c0ffee (HTTP 422)" }
        ]
      ],
      OWN_FOLDER
    )

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      `the worktree at ${PATH} is on no branch, at commits no branch here holds and GitHub lacks: put them on a branch, or remove that worktree`
    )
    expect(moves(calls)).toEqual([])
    expect(calls.some((call) => call.argv.startsWith("git fetch") || call.argv.includes(" fetch "))).toBe(false)
  })

  for (const ref of ["refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1"]) {
    test(`one at a commit a branch, a remote's copy of one or a tag holds is checked out as ever (${ref})`, async () => {
      // git answers for the kinds of refs it is asked to look in.
      const kind = ref.split("/").slice(0, 2).join("/")
      const { host, calls } = gitHost(
        [
          COMMON_DIR,
          ["git worktree list", { stdout: `worktree ${PATH}\nHEAD 2\ndetached\n` }],
          ["git rev-parse --verify --quiet HEAD", { stdout: "c0ffee\n" }],
          [
            "git for-each-ref --contains c0ffee",
            (line) => ({ stdout: line.split(" ").includes(kind) ? `${ref}\n` : "" })
          ],
          [FETCH, { exitCode: 128, stderr: "fatal: couldn't find remote ref refs/heads/fix/menu\n" }]
        ],
        OWN_FOLDER
      )

      await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow("the pull request could not be fetched")
      expect(calls.some((call) => call.argv.startsWith("gh api repos/acme/app/commits"))).toBe(false)
    })
  }

  test("an own worktree whose folder was deleted is unlisted alone and made again", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      [
        "git worktree list",
        {
          stdout: `worktree ${PATH}\nHEAD 2\nbranch refs/heads/fix/menu\nprunable gitdir file points to non-existent location\n`
        }
      ]
    ])

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(
      calls.map((call) => call.argv).filter((argv) => /^git (worktree|switch)/.test(argv) || argv.startsWith("gh "))
    ).toEqual([
      "git worktree list --porcelain",
      `git worktree remove ${PATH}`,
      `git worktree add --detach ${PATH}`,
      "git switch --no-overwrite-ignore -c pr-7 head"
    ])
  })

  test("its folder where git lists it elsewhere, as after the repository moved, is relinked once and used", async () => {
    let isRepaired = false
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        [
          "git worktree repair",
          () => {
            isRepaired = true

            return { stderr: "repair: gitdir incorrect: /repo/.git/worktrees/pr-7/gitdir\n" }
          }
        ],
        [
          "git worktree list",
          () => ({
            stdout: isRepaired
              ? `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/pr-7\n`
              : "worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /old/repo/.claude/worktrees/pr-7\nHEAD 2\nbranch refs/heads/pr-7\nprunable gitdir file points to non-existent location\n"
          })
        ],
        ["git rev-parse --verify --quiet refs/heads/pr-7", { stdout: "head\n" }]
      ],
      WORKTREE_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(
      calls.filter((call) => /^(git worktree (repair|add|remove|prune)|git switch|git checkout|gh )/.test(call.argv))
    ).toEqual([
      { argv: `git worktree repair ${PATH}`, cwd: "/repo" },
      { argv: "git switch --no-overwrite-ignore -C pr-7 --no-track head", cwd: PATH, env: { LC_ALL: "C" } }
    ])
  })

  test("an empty folder of its name, no worktree's, is made the worktree as it is", async () => {
    const { host, calls } = gitHost(
      [COMMON_DIR, ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }]],
      OWN_FOLDER
    )

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: PATH })
    expect(calls.some((call) => call.argv.startsWith("git worktree repair"))).toBe(false)
    expect(calls.some((call) => call.argv.startsWith(`git worktree add`))).toBe(true)
  })

  test("one git can't relink is left as it is, and the flow says what to do", async () => {
    const { host, calls } = gitHost(
      [
        COMMON_DIR,
        [
          "git worktree repair",
          { exitCode: 1, stderr: `error: unable to locate repository; .git file broken: ${PATH}/.git\n` }
        ],
        ["git worktree list", { stdout: "worktree /repo\nHEAD 1\nbranch refs/heads/main\n" }]
      ],
      WORKTREE_FOLDER
    )

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      `${PATH} is a folder git lists no worktree at, and \`git worktree repair\` could not relink it (error: unable to locate repository; .git file broken: ${PATH}/.git): move that folder aside, and the worktree is made anew`
    )
    expect(
      calls.filter((call) => /^(git worktree (add|remove|prune)|git switch|git checkout|gh )/.test(call.argv))
    ).toEqual([])
  })

  test("git failing to start leaves no half-made worktree behind", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      [
        FETCH,
        () => {
          throw new Error("spawn git ENOENT")
        }
      ]
    ])

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      "could not check out the pull request in a worktree: spawn git ENOENT"
    )
    expect(calls.map((call) => call.argv)).toContain(`git worktree remove --force ${PATH}`)
  })

  test("a worktree that cannot be made ends the flow with the reason", async () => {
    const { host } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      ["git worktree add", { exitCode: 128, stderr: "fatal: disk full" }]
    ])

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow("could not create the worktree: fatal: disk full")
  })

  test("a new worktree that cannot check the pull request out is removed again", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      ["git check-ignore", { exitCode: 0 }],
      [FETCH, { exitCode: 128, stderr: "fatal: couldn't find remote ref refs/heads/fix/menu\n" }]
    ])

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      "could not check out the pull request in a worktree: the pull request could not be fetched: fatal: couldn't find remote ref refs/heads/fix/menu"
    )
    expect(calls.at(-1)).toEqual({ argv: `git worktree remove --force ${PATH}`, cwd: "/repo" })
  })

  test("from inside a worktree or a bare-style layout it falls back to the toplevel", async () => {
    const { host } = gitHost([
      ["git rev-parse --path-format=absolute --git-common-dir", { stdout: "/srv/repo.git\n" }],
      ["git rev-parse --show-toplevel", { stdout: "/work/repo\n" }],
      ["git check-ignore", { exitCode: 0 }]
    ])

    expect(await prepareWorktree(host, ROW, REPO)).toEqual({ path: "/work/repo/.claude/worktrees/pr-7" })
  })

  test("an error says what went wrong, worded for the person", async () => {
    const { host } = gitHost([
      ["git rev-parse --path-format=absolute --git-common-dir", { exitCode: 128 }],
      ["git rev-parse --show-toplevel", { exitCode: 128, stderr: "fatal: not a git repository" }]
    ])

    await expect(prepareWorktree(host, ROW, REPO)).rejects.toThrow(
      "this folder is not a git checkout (fatal: not a git repository)"
    )
  })
})

describe("switchHere", () => {
  const TOPLEVEL: Answer = ["git rev-parse --show-toplevel", { stdout: "/repo\n" }]
  const stopped = (reason: string) => `not switched: ${reason}`

  test("switches to the head's name as gh would, and leaves dependencies alone when the lockfile did not change", async () => {
    const { host, calls } = gitHost([TOPLEVEL, ["git hash-object", { stdout: "same\n" }]], {
      "/repo/package-lock.json": "{}"
    })
    const installs: string[] = []

    expect(await switchHere(host, ROW, REPO, (command) => installs.push(command))).toBe(undefined)
    // Fetched into the remote's copy of the head's branch, which the new branch follows; git's own checkout, read in
    // its own words.
    expect(calls.filter((call) => / fetch |^git (switch|config branch)/.test(call.argv))).toEqual([
      { argv: `${FETCH} origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu`, cwd: undefined },
      { argv: "git switch --no-overwrite-ignore -c fix/menu head", cwd: undefined, env: { LC_ALL: "C" } },
      { argv: "git config branch.fix/menu.remote origin", cwd: undefined },
      { argv: "git config branch.fix/menu.merge refs/heads/fix/menu", cwd: undefined }
    ])
    expect(installs).toEqual([])
  })

  test("a branch made here pulls by rebasing where git is set up so for a remote's branch, as --track would have it", async () => {
    const settings = async (autoSetupRebase: string, fork = false) => {
      const { host, calls } = gitHost([
        TOPLEVEL,
        ["git config --get branch.autoSetupRebase", { stdout: autoSetupRebase }]
      ])
      await switchHere(host, fork ? FORK : ROW, REPO, () => undefined)

      return calls.map((call) => call.argv).filter((argv) => argv.endsWith(".rebase true"))
    }

    expect(await settings("always\n")).toEqual(["git config branch.fix/menu.rebase true"])
    expect(await settings("remote\n")).toEqual(["git config branch.fix/menu.rebase true"])
    expect(await settings("local\n")).toEqual([])
    expect(await settings("")).toEqual([])
    // A fork's branch pulling GitHub's copy of its head is set by hand, as gh does it, which --track's rule misses.
    expect(await settings("always\n", true)).toEqual([])
  })

  test("a branch of the head's name behind the pull request is brought up to it, keeping what it follows", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "old\n" }],
      ["git config --get branch.fix/menu.merge", { stdout: "refs/heads/mine\n" }]
    ])

    await switchHere(host, ROW, REPO, () => undefined)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -C fix/menu --no-track head"])
    expect(calls.some((call) => call.argv.startsWith("git config branch."))).toBe(false)
  })

  test("installs when the switch changed the lockfile", async () => {
    let hashes = 0
    const { host, calls } = gitHost(
      [TOPLEVEL, ["git hash-object", () => ({ stdout: hashes++ === 0 ? "before\n" : "after\n" })]],
      { "/repo/package-lock.json": "{}" }
    )
    const installs: string[] = []

    expect(await switchHere(host, ROW, REPO, (command) => installs.push(command))).toBe("installed with npm ci")
    expect(installs).toEqual(["npm ci"])
    expect(calls.at(-1)).toEqual({ argv: "npm ci", cwd: "/repo" })
  })

  test("installs with the new package manager when the switch changed it", async () => {
    const files: Record<string, string> = { "/repo/package-lock.json": "{}" }
    const { host, calls } = gitHost(
      [
        TOPLEVEL,
        ["git hash-object", { stdout: "same\n" }],
        [
          "git switch --no-overwrite-ignore",
          () => {
            delete files["/repo/package-lock.json"]
            files["/repo/pnpm-lock.yaml"] = "lockfileVersion: 9"

            return {}
          }
        ]
      ],
      files
    )

    expect(await switchHere(host, ROW, REPO, () => undefined)).toBe("installed with pnpm install --frozen-lockfile")
    expect(calls.at(-1)).toEqual({ argv: "pnpm install --frozen-lockfile", cwd: "/repo" })
  })

  test("a fork's pull request is switched to, its install scripts not run", async () => {
    let hashes = 0
    const { host, calls } = gitHost(
      [TOPLEVEL, ["git hash-object", () => ({ stdout: hashes++ === 0 ? "before\n" : "after\n" })]],
      { "/repo/package-lock.json": "{}" }
    )

    expect(await switchHere(host, FORK, REPO, () => undefined)).toBe(FORK_DEPS_NOTE)
    expect(calls.map((call) => call.argv)).not.toContain("npm ci")
  })

  test("a fork goes on pr-<number> from GitHub's copy of its head, set to pull and push as gh sets it", async () => {
    const branchSetup = (calls: Call[]) =>
      calls.filter((call) => / fetch |^git (switch|config branch)/.test(call.argv)).map((call) => call.argv)

    // Its maintainers can't push to the fork: the branch pulls GitHub's copy of the head.
    const closed = gitHost([TOPLEVEL])
    await switchHere(closed.host, FORK, REPO, () => undefined)
    expect(branchSetup(closed.calls)).toEqual([
      `${FETCH} origin refs/pull/7/head`,
      "git switch --no-overwrite-ignore -c pr-7 head",
      "git config branch.pr-7.remote origin",
      "git config branch.pr-7.pushRemote origin",
      "git config branch.pr-7.merge refs/pull/7/head"
    ])

    // They can: it pulls from and pushes to the fork's branch, at its address in gh's protocol.
    const open = gitHost([TOPLEVEL, forkPull(true), ["gh config get git_protocol", { stdout: "ssh\n" }]])
    await switchHere(open.host, FORK, REPO, () => undefined)
    expect(branchSetup(open.calls).slice(2)).toEqual([
      "git config branch.pr-7.remote git@github.com:ann/app.git",
      "git config branch.pr-7.pushRemote git@github.com:ann/app.git",
      "git config branch.pr-7.merge refs/heads/fix/menu"
    ])

    // The fork deleted: GitHub's copy, as for one that can't take a push.
    const gone = gitHost([TOPLEVEL, forkPull(true, null)])
    await switchHere(gone.host, FORK, REPO, () => undefined)
    expect(branchSetup(gone.calls).at(-1)).toBe("git config branch.pr-7.merge refs/pull/7/head")
  })

  test("a fork with a remote of its own here is fetched from there, and its branch follows that remote's copy", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      [
        "git remote -v",
        {
          stdout:
            "ann\thttps://github.com/ann/app.git (fetch)\nann\thttps://github.com/ann/app.git (push)\norigin\tgit@github.com:acme/app.git (fetch)\n"
        }
      ]
    ])

    await switchHere(host, FORK, REPO, () => undefined)
    expect(
      calls.filter((call) => / fetch |^git (switch|config branch)/.test(call.argv)).map((call) => call.argv)
    ).toEqual([
      `${FETCH} ann +refs/heads/fix/menu:refs/remotes/ann/fix/menu`,
      "git switch --no-overwrite-ignore -c pr-7 head",
      "git config branch.pr-7.remote ann",
      "git config branch.pr-7.merge refs/heads/fix/menu"
    ])
  })

  test("a fork's pull request GitHub doesn't answer about is not switched to", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["gh api repos/acme/app/pulls/7", { exitCode: 1, stderr: "error connecting to api.github.com\n" }]
    ])

    await expect(switchHere(host, FORK, REPO, () => undefined)).rejects.toThrow(
      /^not switched: the pull request could not be read from GitHub: /
    )
    expect(moves(calls)).toEqual([])
  })

  test("no remote here naming the repository, as after a rename: fetched from its address in gh's protocol", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git remote -v", { stdout: "old\tgit@github.com:acme/old-app.git (fetch)\n" }],
      ["gh config get git_protocol --host github.com", { stdout: "https\n" }]
    ])

    await switchHere(host, ROW, REPO, () => undefined)
    expect(
      calls.filter((call) => / fetch |^git (switch|config branch)/.test(call.argv)).map((call) => call.argv)
    ).toEqual([
      `${FETCH} https://github.com/acme/app.git refs/pull/7/head`,
      "git switch --no-overwrite-ignore -c fix/menu head",
      "git config branch.fix/menu.remote https://github.com/acme/app.git",
      "git config branch.fix/menu.pushRemote https://github.com/acme/app.git",
      "git config branch.fix/menu.merge refs/heads/fix/menu"
    ])
  })

  test("of the remotes naming the repository, the one on its host is fetched from; else one through a host alias", async () => {
    const remotes = (stdout: string) => gitHost([TOPLEVEL, ["git remote -v", { stdout }]])

    const two = remotes("gitea\thttps://gitea.corp/acme/app (fetch)\norigin\tgit@github.com:acme/app.git (fetch)\n")
    await switchHere(two.host, ROW, REPO, () => undefined)
    expect(two.calls.map((call) => call.argv)).toContain(
      `${FETCH} origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu`
    )

    const alias = remotes("work\tgit@gh-work:acme/app.git (fetch)\n")
    await switchHere(alias.host, ROW, REPO, () => undefined)
    expect(alias.calls.map((call) => call.argv)).toContain(
      `${FETCH} work +refs/heads/fix/menu:refs/remotes/work/fix/menu`
    )
  })

  test("a file git doesn't track where the pull request's branch has one stops the switch, git changing nothing", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git switch --no-overwrite-ignore", { exitCode: 1, stderr: IN_THE_WAY }]
    ])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped(
        `that would overwrite .env in this checkout, which git doesn't track and the pull request's branch does: move it aside, or choose "Worktree, this session"`
      )
    )
    // Not tried again under pr-<number>, and nothing set up for a branch git never made.
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -c fix/menu head"])
    expect(calls.some((call) => call.argv.startsWith("git config branch."))).toBe(false)
  })

  test("everything git names in the way is counted: files, folders holding such files, and a few named", async () => {
    const refusal =
      "error: Updating the following directories would lose untracked files in them:\n\tbuild\n\tcache/db\n\n" +
      "error: The following untracked working tree files would be overwritten by checkout:\n\t.env\n\tnaïve file\n\t.vscode/settings.json\n" +
      "Please move or remove them before you switch branches.\nAborting\n"
    const { host } = gitHost([TOPLEVEL, ["git switch --no-overwrite-ignore", { exitCode: 1, stderr: refusal }]])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped(
        `that would overwrite build/, cache/db/, .env and 2 more in this checkout, which git doesn't track and the pull request's branch does: move them aside, or choose "Worktree, this session"`
      )
    )
  })

  test("an uncommitted change git would overwrite stops the switch, named", async () => {
    const refusal =
      "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/menu.ts\nPlease commit your changes or stash them before you switch branches.\nAborting\n"
    const { host } = gitHost([TOPLEVEL, ["git switch --no-overwrite-ignore", { exitCode: 1, stderr: refusal }]])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped(
        `that would overwrite uncommitted changes to src/menu.ts in this checkout: commit or stash them first, or choose "Worktree, this session"`
      )
    )
  })

  test("your own branch of the head's name that went its own way is left as it is: this checkout goes on pr-<number>", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "mine\n" }],
      ["git merge-base --is-ancestor", { exitCode: 1 }]
    ])

    expect(await switchHere(host, ROW, REPO, () => undefined)).toBe(undefined)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
    // In a folder the person works in, nothing is reset.
    expect(calls.some((call) => call.argv.startsWith("gh api"))).toBe(false)
  })

  test("your own branch of the head's name with commits beyond GitHub's is taken as it is", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "mine\n" }],
      ["git merge-base --is-ancestor mine head", { exitCode: 1 }],
      ["git merge-base --is-ancestor head mine", { exitCode: 0 }]
    ])

    expect(await switchHere(host, ROW, REPO, () => undefined)).toBe(undefined)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore fix/menu"])
  })

  test("your own branch whose name differs from the head's only in case is never moved: this checkout goes on pr-<number>", async () => {
    // Where the file system ignores case, git would find your Fix/Menu by the head's name and move it.
    const ownIn = (refs: string): Answer => ["git for-each-ref --format=%(refname) refs/heads/", { stdout: refs }]
    const switched = async (answer: Answer) => {
      const { host, calls } = gitHost([TOPLEVEL, answer])
      expect(await switchHere(host, ROW, REPO, () => undefined)).toBe(undefined)
      return moves(calls)
    }

    expect(await switched(ownIn("refs/heads/main\nrefs/heads/Fix/Menu\n"))).toEqual([
      "git switch --no-overwrite-ignore -c pr-7 head"
    ])
    // A list that could not be read might hold one.
    expect(await switched(["git for-each-ref", { stdout: "refs/heads/main\n", isStdoutTruncated: true }])).toEqual([
      "git switch --no-overwrite-ignore -c pr-7 head"
    ])
    expect(await switched(["git for-each-ref", { exitCode: 128 }])).toEqual([
      "git switch --no-overwrite-ignore -c pr-7 head"
    ])
    // The head's own branch, or a name that differs in more than case, is no clash.
    expect(await switched(ownIn("refs/heads/fix/menu\nrefs/heads/fix/menus\n"))).toEqual([
      "git switch --no-overwrite-ignore -c fix/menu head"
    ])
    // An accent kept as a letter and a mark, as macOS can write a name, is the same name.
    const accented = gitHost([TOPLEVEL, ownIn("refs/heads/Fix/Cafe\u0301\n")])
    expect(await switchHere(accented.host, { ...ROW, headRefName: "fix/caf\u00e9" }, REPO, () => undefined)).toBe(
      undefined
    )
    expect(moves(accented.calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
  })

  test("a branch git says another folder holds, though the list didn't, is left there too", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      [
        "git switch --no-overwrite-ignore -c fix/menu",
        { exitCode: 128, stderr: "fatal: 'fix/menu' is already used by worktree at '/other'\n" }
      ]
    ])

    expect(await switchHere(host, ROW, REPO, () => undefined)).toBe(undefined)
    expect(moves(calls)).toEqual([
      "git switch --no-overwrite-ignore -c fix/menu head",
      "git switch --no-overwrite-ignore -c pr-7 head"
    ])
  })

  test("a head's name git would take for an option goes on pr-<number>", async () => {
    const { host, calls } = gitHost([TOPLEVEL])

    await switchHere(host, { ...ROW, headRefName: "--orphan" }, REPO, () => undefined)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
  })

  test("in a folder the person works in, a pr-<number> that went its own way is never reset, though GitHub has its commit", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      ["git rev-parse --verify --quiet refs/heads/", { stdout: "mine\n" }],
      ["git merge-base --is-ancestor", { exitCode: 1 }],
      ["gh api repos/acme/app/commits", { exitCode: 0 }]
    ])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(stopped(DIVERGED_PR_7))
    expect(moves(calls)).toEqual([])
    expect(calls.some((call) => call.argv.startsWith("gh api repos/acme/app/commits"))).toBe(false)
  })

  test("a branch another folder works on is left there: this checkout goes on pr-<number>", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      [
        "git worktree list",
        {
          stdout:
            "worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /other\nHEAD 2\nbranch refs/heads/fix/menu\n"
        }
      ]
    ])

    await switchHere(host, ROW, REPO, () => undefined)
    expect(moves(calls)).toEqual(["git switch --no-overwrite-ignore -c pr-7 head"])
  })

  test("a pr-<number> the pull request's own worktree holds is left there, and the flow says to work in it", async () => {
    const { host, calls } = gitHost([
      COMMON_DIR,
      TOPLEVEL,
      [
        "git worktree list",
        {
          stdout: `worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree ${PATH}\nHEAD 2\nbranch refs/heads/pr-7\n`
        }
      ]
    ])

    await expect(switchHere(host, FORK, REPO, () => undefined)).rejects.toThrow(
      stopped(
        `the branch pr-7 is checked out in the pull request's own worktree, ${PATH}: choose "Worktree, this session" to work there, or remove that worktree`
      )
    )
    expect(calls.some((call) => call.argv.includes(" fetch ") || call.argv.startsWith("git checkout"))).toBe(false)
  })

  test("every git command runs with no hooks, the fetch and the switch too, as a hook can be the pull request's code", async () => {
    const { host } = gitHost([TOPLEVEL])
    const ran: string[] = []
    const recording: Host = {
      ...host,
      run: (argv, init) => {
        ran.push(argv.join(" "))
        return host.run(argv, init)
      }
    }

    await switchHere(recording, ROW, REPO, () => undefined)
    const gits = ran.filter((line) => line.startsWith("git "))
    expect(gits.filter((line) => !line.startsWith("git -c core.hooksPath=/dev/null "))).toEqual([])
    expect(gits).toContain(
      "git -c core.hooksPath=/dev/null -c credential.helper= -c credential.helper=!gh auth git-credential fetch --no-tags origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu"
    )
    expect(gits).toContain("git -c core.hooksPath=/dev/null switch --no-overwrite-ignore -c fix/menu head")
  })

  test("a folder in the middle of a merge or a rebase is not switched, as its next step would land on the new branch", async () => {
    const refused = async (stderr: string) => {
      const { host } = gitHost([TOPLEVEL, ["git switch --no-overwrite-ignore", { exitCode: 128, stderr }]])

      return switchHere(host, ROW, REPO, () => undefined).then(
        () => "switched",
        (error: Error) => error.message
      )
    }
    const midway = (operation: string) =>
      stopped(
        `this checkout is in the middle of ${operation}: finish or abort it first, or choose "Worktree, this session"`
      )

    expect(
      await refused('fatal: cannot switch branch while rebasing\nConsider "git rebase --quit" or "git worktree add".\n')
    ).toBe(midway("a rebase"))
    expect(await refused("fatal: cannot switch branch while merging\n")).toBe(midway("a merge"))
    expect(await refused("fatal: cannot switch branch while cherry-picking\n")).toBe(midway("a cherry-pick"))
    expect(await refused("fatal: cannot switch branch while reverting\n")).toBe(midway("a revert"))
    expect(await refused("fatal: cannot switch branch in the middle of an am session\n")).toBe(midway("`git am`"))
  })

  test("a partial clone's remote, which git lists with its filter, is the one fetched from and followed", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      [
        "git remote -v",
        {
          stdout:
            "origin\thttps://github.com/acme/app.git (fetch) [blob:none]\norigin\thttps://github.com/acme/app.git (push)\n"
        }
      ]
    ])

    await switchHere(host, ROW, REPO, () => undefined)
    expect(calls.map((call) => call.argv).filter((argv) => / fetch |^git config branch/.test(argv))).toEqual([
      `${FETCH} origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu`,
      "git config branch.fix/menu.remote origin",
      "git config branch.fix/menu.merge refs/heads/fix/menu"
    ])
  })

  test("in a sparse checkout, where git writes over files it doesn't track without refusing, those are checked first", async () => {
    const outcome = async (untracked: string[], written: string[]) => {
      const { host, calls } = gitHost([TOPLEVEL, ...sparseAnswers(untracked, written)])
      const result = await switchHere(host, ROW, REPO, () => undefined).then(
        () => "switched",
        (error: Error) => error.message
      )

      return { result, moves: moves(calls) }
    }
    const inTheWay = (named: string, them = "them") =>
      stopped(
        `that would overwrite ${named} in this checkout, which git doesn't track and the pull request's branch does: move ${them} aside, or choose "Worktree, this session"`
      )

    // At a path the switch writes, git doesn't track it: the switch never runs.
    expect(await outcome(["node_modules/", ".env"], [".env", "src/menu.ts"])).toEqual({
      result: inTheWay(".env", "it"),
      moves: []
    })
    // A folder the switch writes into, a folder it makes a file, a file it makes a folder, and a name differing in case
    // alone, as the file system may take for the same.
    expect(
      await outcome(
        ["cache/", "conf/local.json", "link", "Config.json"],
        ["cache/db.json", "conf", "link/to.ts", "config.json"]
      )
    ).toEqual({ result: inTheWay("cache/, conf/local.json, link and Config.json"), moves: [] })
    // Elsewhere, nothing is in the way.
    expect(await outcome(["node_modules/", "notes.md", "src/old/"], ["src/menu.ts", "src/new/a.ts"])).toEqual({
      result: "switched",
      moves: ["git switch --no-overwrite-ignore -c fix/menu head"]
    })
  })

  test("in a sparse checkout, a branch taken as it is is checked against its own commit, and one not listed stops", async () => {
    const ahead = gitHost([
      TOPLEVEL,
      ["git rev-parse --verify --quiet refs/heads/fix/menu", { stdout: "mine\n" }],
      ["git merge-base --is-ancestor mine head", { exitCode: 1 }],
      ...sparseAnswers([], [])
    ])
    await switchHere(ahead.host, ROW, REPO, () => undefined)
    expect(ahead.calls.map((call) => call.argv)).toContain("git diff-tree -r --name-only --no-renames -z HEAD mine")

    const cut = gitHost([TOPLEVEL, SPARSE, [UNTRACKED, { stdout: "a\0", isStdoutTruncated: true }]])
    await expect(switchHere(cut.host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped(
        "this checkout is sparse, where git writes over files it doesn't track without refusing, and those could not be checked (too many to read)"
      )
    )
    expect(moves(cut.calls)).toEqual([])

    // Not sparse: git's own refusal holds, and nothing is listed.
    const dense = gitHost([TOPLEVEL, ["git config --type=bool --get core.sparseCheckout", { exitCode: 1 }]])
    await switchHere(dense.host, ROW, REPO, () => undefined)
    expect(dense.calls.some((call) => call.argv.startsWith(UNTRACKED))).toBe(false)
  })

  test("a fetch that fails stops the switch with git's reason, nothing checked out", async () => {
    const { host, calls } = gitHost([
      TOPLEVEL,
      [FETCH, { exitCode: 128, stderr: "fatal: Could not read from remote repository.\n" }]
    ])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped("the pull request could not be fetched: fatal: Could not read from remote repository.")
    )
    expect(moves(calls)).toEqual([])
  })

  test("a switch git refuses for another reason ends the flow with git's reason", async () => {
    const { host } = gitHost([
      TOPLEVEL,
      [
        "git switch --no-overwrite-ignore",
        { exitCode: 128, stderr: "fatal: Unable to create '/repo/.git/index.lock': File exists.\n" }
      ]
    ])

    await expect(switchHere(host, ROW, REPO, () => undefined)).rejects.toThrow(
      stopped("fatal: Unable to create '/repo/.git/index.lock': File exists.")
    )
  })
})

describe("a repository's address and host", () => {
  test("an address as gh writes one: https, or ssh, the user a tenant's name on GHE.com; the host lowercased", () => {
    expect(addressOf("ann/app", "github.com", "https")).toBe("https://github.com/ann/app.git")
    expect(addressOf("ann/app", "github.com", "")).toBe("https://github.com/ann/app.git")
    expect(addressOf("ann/app", "github.com", "ssh")).toBe("git@github.com:ann/app.git")
    expect(addressOf("ann/app", "acme.ghe.com", "ssh")).toBe("acme@acme.ghe.com:ann/app.git")
    expect(addressOf("ann/app", "Acme.GHE.com", "ssh")).toBe("acme@acme.ghe.com:ann/app.git")
    expect(addressOf("ann/app", "git.corp.example", "ssh")).toBe("git@git.corp.example:ann/app.git")
    expect(addressOf("ann/app", "GitHub.com", "https")).toBe("https://github.com/ann/app.git")
    // gh's own development host alone is plain http.
    expect(addressOf("ann/app", "github.localhost", "https")).toBe("http://github.localhost/ann/app.git")
    expect(addressOf("ann/app", "localhost", "https")).toBe("https://localhost/ann/app.git")
  })

  test("the host an address names, with a scheme or ssh's short form; none for a path", () => {
    expect(hostOf("https://GitHub.com/acme/app.git")).toBe("github.com")
    expect(hostOf("ssh://git@github.com:22/acme/app.git")).toBe("github.com")
    expect(hostOf("https://user:token@ghe.corp/acme/app")).toBe("ghe.corp")
    expect(hostOf("git@github.com:acme/app.git")).toBe("github.com")
    expect(hostOf("gh-work:acme/app.git")).toBe("gh-work")
    expect(hostOf("/srv/git/acme/app.git")).toBe(null)
  })
})
