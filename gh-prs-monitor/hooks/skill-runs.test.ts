// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { BranchPulls, PullsSnapshot, Question } from "../types"
import { lookUpBranch } from "./branch-lookup"
import { sessionRepo } from "./github"
import { createSession, FOLDER_LIST } from "./session"
import type { Mark } from "./session"
import { readSettings } from "./settings"
import { createPull, installNotices, markSkillTurn, RESOLVE_COMMAND, REVIEW_COMMAND, workOnBranch } from "./skill-runs"
import type { SkillHost } from "./skill-runs"
import { snapshotOf } from "./testing/fixtures"
import { fakeHost } from "./testing/git-host"
import { fakePressHost, REPO } from "./testing/press-host"

// A skill's host over a checkout in acme/app on fix/menu (or on `ref`, as git names it) and a list; it keeps the rows
// marked busy and gh's calls.
function skillHostOf(list: PullsSnapshot | null, ref = "refs/heads/fix/menu") {
  const marks: [Mark, string | null][] = []
  const git = fakeHost([
    ["git rev-parse --symbolic-full-name HEAD", { stdout: `${ref}\n` }],
    ["gh repo view", { stdout: "acme/app https://github.com/acme/app\n" }]
  ])
  const host: SkillHost = {
    ...fakePressHost({ list }).host,
    ...git.host,
    list: FOLDER_LIST,
    setBusy: async (mark, text) => {
      marks.push([mark, text])
    },
    branchPulls: async () => null,
    changeBranchPulls: async () => undefined,
    checkoutNow: async () => ({ branch: "fix/menu", head: "head-7", at: 0 }),
    keepCheckout: async (checkout) => checkout,
    cwd: async () => "/repo",
    inConversation: () => {},
    runCommand: async () => undefined,
    clearBusyIf: async () => undefined,
    isCheckingMode: async () => true,
    editorScheme: async () => null,
    clones: async () => [],
    home: async () => null
  }

  return { host, marks, calls: git.calls }
}

describe("a skill's turn", () => {
  test("marks the pull request typed, or a bare branch skill's on the branch; a bare Review none", async () => {
    const { host, marks } = skillHostOf(snapshotOf({ mine: [{ number: 7, headRefName: "fix/menu" }] }))

    expect(await markSkillTurn(host, { command: RESOLVE_COMMAND, mark: null, args: "", list: FOLDER_LIST })).toEqual({
      mark: 7,
      label: "Resolving Comments…",
      list: FOLDER_LIST
    })
    expect(await markSkillTurn(host, { command: REVIEW_COMMAND, mark: null, args: "#9", list: FOLDER_LIST })).toEqual({
      mark: 9,
      label: "Reviewing…",
      list: FOLDER_LIST
    })
    expect(await markSkillTurn(host, { command: REVIEW_COMMAND, mark: null, args: "", list: FOLDER_LIST })).toBeNull()
    expect(marks).toEqual([
      [7, "Resolving Comments…"],
      [9, "Reviewing…"]
    ])
  })

  test("the repository a press looks up, where no load has found it yet, is kept for the next", async () => {
    const session = createSession(readSettings({}))
    const { host, calls } = skillHostOf(null)

    expect(await sessionRepo(host, session)).toEqual({ repo: REPO })
    expect(await sessionRepo(host, session)).toEqual({ repo: REPO })
    expect(session.repo).toEqual(REPO)
    expect(calls.filter((call) => call.argv.startsWith("gh repo view"))).toHaveLength(1)
  })

  test("a branch skill pressed on a checkout on no branch warns that switching leaves its commits behind", async () => {
    const session = createSession(readSettings({}))
    session.repo = REPO
    const list = snapshotOf({ mine: [{ number: 7, headRefName: "fix/menu" }] })
    const asked: Question[] = []
    const { host } = skillHostOf(list, "HEAD")

    await workOnBranch(
      {
        ...host,
        ask: async (question) => {
          asked.push(question)

          return null
        }
      },
      session,
      "resolve",
      list.mine[0]!,
      "terminal"
    )
    expect(asked).toHaveLength(1)
    expect(asked[0]?.detail).toMatch(/^This checkout is on no branch: switching here leaves commits made there behind/)
  })
})

describe("installs as they start", () => {
  test("each marks the row with its command; the first alone is told", async () => {
    const notes: string[] = []
    const { host, marks } = skillHostOf(null)
    const started = installNotices(
      { ...host, notify: async (text) => void notes.push(text), background: (work) => void work },
      createSession(readSettings({})),
      7
    )

    started("npm ci")
    started("ios: pod install --deployment")
    await Promise.resolve()

    expect(marks).toEqual([
      [7, "Installing Dependencies (npm ci)…"],
      [7, "Installing Dependencies (ios: pod install --deployment)…"]
    ])
    expect(notes).toEqual(["#7: installing dependencies (npm ci); this can take a few minutes"])
  })
})

describe("Create PR", () => {
  // GitHub's answer about feature/x at commit h1, as the list in acme/app knows it: whether a pull request is open
  // from it.
  const said = (isTaken: boolean): BranchPulls => ({
    repo: "acme/app",
    branch: "feature/x",
    head: "h1",
    isTaken,
    endedHead: null,
    merged: null
  })

  test("a press asks GitHub about the branch again, unless it said one is open from it", async () => {
    const session = createSession(readSettings({}))
    const list = snapshotOf({})

    for (const [isTaken, asks] of [
      [true, 0],
      [false, 1]
    ] as const) {
      const { host, calls } = skillHostOf(list)

      await lookUpBranch({ ...host, branchPulls: async () => said(isTaken) }, session, REPO, "feature/x", "h1", true)
      expect(calls.filter((call) => call.argv.startsWith("gh api graphql"))).toHaveLength(asks)
    }
  })

  test("its question says the session is busy while a turn runs", async () => {
    const session = createSession(readSettings({}))
    session.repo = REPO
    session.runningTurns.add("turn-1")
    const asked: Question[] = []
    const { host } = skillHostOf(snapshotOf({}))

    await createPull(
      {
        ...host,
        checkoutNow: async () => ({ branch: "feature/x", head: "h1", at: 0 }),
        branchPulls: async () => said(false),
        ask: async (question) => {
          asked.push(question)

          return null
        }
      },
      session,
      "terminal"
    )
    expect(asked.map((question) => question.detail)).toEqual([expect.stringMatching(/^This session is busy/)])
  })
})
