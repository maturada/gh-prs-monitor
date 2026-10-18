// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { ProcessRunResult } from "claude-code"

import { BRANCH_PULLS_QUERY, isBranchTaken, lookUpBranch, readBranchPulls } from "./branch-lookup"
import type { BranchLookupHost } from "./branch-lookup"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { REPO, snapshotOf } from "./testing/fixtures"
import { promisesRun } from "./testing/promises"
import { hostAnswering } from "./testing/git-host"
import type { Ran } from "./testing/git-host"

describe("a branch's pull requests the lists never showed", () => {
  test("its answer: one open, and how and where the latest ended, a fork's of the same name left out", () => {
    const answer = (nodes: unknown[]) => JSON.stringify({ data: { repository: { pullRequests: { nodes } } } })
    const pull = (state: string, headRefOid: string, isCrossRepository = false) => ({
      number: 1,
      state,
      headRefOid,
      isCrossRepository
    })

    expect(readBranchPulls(answer([]), "local-head")).toEqual({ isOpen: false, isHeadMerged: false, ended: null })
    expect(readBranchPulls(answer([pull("MERGED", "abc"), pull("CLOSED", "older")]), "local-head")).toEqual({
      isOpen: false,
      isHeadMerged: false,
      ended: { state: "MERGED", head: "abc" }
    })
    expect(readBranchPulls(answer([pull("OPEN", "abc", true), pull("CLOSED", "older")]), "local-head")).toEqual({
      isOpen: false,
      isHeadMerged: false,
      ended: { state: "CLOSED", head: "older" }
    })
    expect(readBranchPulls(answer([pull("OPEN", "abc"), null]), "local-head")).toEqual({
      isOpen: true,
      isHeadMerged: false,
      ended: null
    })
    expect(readBranchPulls(JSON.stringify({ data: { repository: null } }), "local-head")).toBeNull()
    expect(readBranchPulls("not json", "local-head")).toBeNull()
  })

  test("an answer whose list isn't one is none; one that ended with no commit to name names none", () => {
    const answer = (nodes: unknown) => JSON.stringify({ data: { repository: { pullRequests: { nodes } } } })

    expect(readBranchPulls(answer(null), "local-head")).toBeNull()
    expect(readBranchPulls(answer({ number: 3 }), "local-head")).toBeNull()
    expect(readBranchPulls(answer([{ number: 3, state: "MERGED", isCrossRepository: false }]), "local-head")).toEqual({
      isOpen: false,
      isHeadMerged: false,
      ended: null
    })
  })

  test("the commit is held by a merged one from the branch where GitHub has it among that one's commits", () => {
    const answer = (associated: unknown) =>
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                { number: 3, state: "MERGED", headRefOid: "B", isCrossRepository: false },
                { number: 4, state: "CLOSED", headRefOid: "C", isCrossRepository: false },
                { number: 6, state: "MERGED", headRefOid: "F", isCrossRepository: true }
              ]
            },
            object: associated
          }
        }
      })
    const by = (...pulls: [number, string][]) => ({
      associatedPullRequests: {
        nodes: pulls.map(([number, state]) => ({
          number,
          state,
          mergeCommit: state === "MERGED" ? { oid: `merged-${number}` } : null
        }))
      }
    })

    expect(readBranchPulls(answer(by([3, "MERGED"])), "pushed")?.isHeadMerged).toBe(true)
    // The commit #3's merge made on the base, which GitHub counts among #3's too, is not one of the branch's.
    expect(readBranchPulls(answer(by([3, "MERGED"])), "merged-3")?.isHeadMerged).toBe(false)
    // Closed unmerged, merged from a fork's branch of the same name or from another branch, or no commit GitHub has.
    for (const associated of [by([4, "CLOSED"]), by([6, "MERGED"]), by([9, "MERGED"]), by(), null]) {
      expect(readBranchPulls(answer(associated), "pushed")).toEqual({
        isOpen: false,
        isHeadMerged: false,
        ended: { state: "MERGED", head: "B" }
      })
    }
  })

  test("asked of every state, newest first, by the branch's name, with the pull requests GitHub has the commit in", () => {
    expect(BRANCH_PULLS_QUERY).toContain(
      "pullRequests(headRefName: $branch, first: 100, orderBy: { field: CREATED_AT, direction: DESC })"
    )
    expect(BRANCH_PULLS_QUERY).toContain("nodes { number state headRefOid isCrossRepository }")
    expect(BRANCH_PULLS_QUERY).toContain(
      "... on Commit { associatedPullRequests(first: 5) { nodes { number state mergeCommit { oid } } } }"
    )
    expect(BRANCH_PULLS_QUERY).not.toContain("states:")
  })
})

describe("whether the session's branch has a pull request already", () => {
  const branchAnswer = (nodes: unknown[]): Ran => ({
    exitCode: 0,
    stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes } } } })
  })

  test("one open from it is", async () => {
    const host = hostAnswering(() => branchAnswer([{ state: "OPEN", headRefOid: "x", isCrossRepository: false }]))

    expect(await isBranchTaken(host, REPO, "fix/menu", "x")).toBe(true)
    expect(host.runs.map(({ argv, timeoutMs }) => [...argv.slice(9, 13), timeoutMs])).toEqual([
      ["-f", "branch=fix/menu", "-f", "head=x", 30_000]
    ])
  })

  test("one that ended at the commit, or after it, is; one that ended before a later commit isn't", async () => {
    const ended = [{ state: "MERGED", headRefOid: "tip", isCrossRepository: false }]
    const at = hostAnswering(() => branchAnswer(ended))
    expect(await isBranchTaken(at, REPO, "fix/menu", "tip")).toBe(true)
    expect(at.runs).toHaveLength(1)

    const containing = hostAnswering((argv) => (argv[0] === "git" ? { exitCode: 0 } : branchAnswer(ended)))
    expect(await isBranchTaken(containing, REPO, "fix/menu", "older")).toBe(true)
    expect(containing.runs[1]!.argv).toEqual(["git", "merge-base", "--is-ancestor", "older", "tip"])

    const later = hostAnswering((argv) => (argv[0] === "git" ? { exitCode: 1 } : branchAnswer(ended)))
    expect(await isBranchTaken(later, REPO, "fix/menu", "newer")).toBe(false)
  })

  test("one merged that GitHub has the commit in is, though this clone lacks where it ended, and nothing is compared", async () => {
    const answer = {
      data: {
        repository: {
          pullRequests: { nodes: [{ number: 3, state: "MERGED", headRefOid: "updated", isCrossRepository: false }] },
          object: { associatedPullRequests: { nodes: [{ number: 3, state: "MERGED", mergeCommit: { oid: "merge" } }] } }
        }
      }
    }
    const host = hostAnswering(() => ({ exitCode: 0, stdout: JSON.stringify(answer) }))

    expect(await isBranchTaken(host, REPO, "fix/menu", "pushed")).toBe(true)
    expect(host.runs).toHaveLength(1)
  })

  test("so is one an earlier merged one had, though a later one ended where git finds it not, as a name used again", async () => {
    // Newest first, as asked.
    const answer = {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              { number: 4, state: "MERGED", headRefOid: "later-tip", isCrossRepository: false },
              { number: 3, state: "MERGED", headRefOid: "earlier-tip", isCrossRepository: false }
            ]
          },
          object: { associatedPullRequests: { nodes: [{ number: 3, state: "MERGED", mergeCommit: { oid: "merge" } }] } }
        }
      }
    }
    const host = hostAnswering((argv) =>
      argv[0] === "git" ? { exitCode: 1 } : { exitCode: 0, stdout: JSON.stringify(answer) }
    )

    expect(await isBranchTaken(host, REPO, "fix/menu", "earlier-tip")).toBe(true)
  })

  test("the commit a merge made on the base, which GitHub counts among the pull request's, is not the branch's", async () => {
    // A branch name used again, reset to the squash its last pull request merged as, before new work; this clone may
    // or may not have where that one ended.
    const answer = {
      data: {
        repository: {
          pullRequests: { nodes: [{ number: 3, state: "MERGED", headRefOid: "tip", isCrossRepository: false }] },
          object: {
            associatedPullRequests: { nodes: [{ number: 3, state: "MERGED", mergeCommit: { oid: "squashed" } }] }
          }
        }
      }
    }
    for (const exitCode of [1, 128]) {
      const host = hostAnswering((argv) =>
        argv[0] === "git" ? { exitCode } : { exitCode: 0, stdout: JSON.stringify(answer) }
      )

      expect(await isBranchTaken(host, REPO, "fix/menu", "squashed")).toBe(false)
    }
  })

  test("one that ended at a commit this clone lacks: merged, GitHub said above; closed, GitHub compares the two", async () => {
    const ended = (state: string) => branchAnswer([{ number: 3, state, headRefOid: "tip", isCrossRepository: false }])
    const lacking = (state: string, compare: Ran) =>
      hostAnswering((argv) =>
        argv[0] === "git" ? { exitCode: 128 } : argv[2]?.includes("/compare/") ? compare : ended(state)
      )

    const merged = lacking("MERGED", { exitCode: 0, stdout: "ahead\n" })
    expect(await isBranchTaken(merged, REPO, "fix/menu", "older")).toBe(false)
    expect(merged.runs).toHaveLength(2)

    for (const [status, isTaken] of [
      ["ahead", true],
      ["identical", true],
      ["behind", false],
      ["diverged", false]
    ] as const) {
      const closed = lacking("CLOSED", { exitCode: 0, stdout: `${status}\n` })
      expect(await isBranchTaken(closed, REPO, "fix/menu", "older")).toBe(isTaken)
      expect(closed.runs.at(-1)).toEqual({
        argv: ["gh", "api", "repos/acme/app/compare/older...tip", "--hostname", "github.com", "--jq", ".status"],
        timeoutMs: 30_000
      })
    }
  })

  test("a commit GitHub can't find holds nothing; a compare GitHub can't answer rejects, so the button waits", async () => {
    const ended = branchAnswer([{ number: 3, state: "CLOSED", headRefOid: "tip", isCrossRepository: false }])
    const comparing = (compare: Ran) =>
      hostAnswering((argv) =>
        argv[0] === "git" ? { exitCode: 128 } : argv[2]?.includes("/compare/") ? compare : ended
      )
    const notFound = {
      exitCode: 1,
      stdout: '{"message":"Not Found","status":"404"}',
      stderr: "gh: Not Found (HTTP 404)\n"
    }
    const noCommonAncestor = { exitCode: 1, stderr: "gh: No common ancestor between tip and older. (HTTP 422)\n" }

    expect(await isBranchTaken(comparing(notFound), REPO, "fix/menu", "older")).toBe(false)
    expect(await isBranchTaken(comparing(noCommonAncestor), REPO, "fix/menu", "older")).toBe(false)
    await expect(
      isBranchTaken(comparing({ exitCode: 1, stderr: "gh: Server Error (HTTP 500)\n" }), REPO, "fix/menu", "older")
    ).rejects.toThrow("gh: Server Error (HTTP 500)")
  })

  test("on GitHub Enterprise, GitHub's own compare is asked of its server", async () => {
    const ended = branchAnswer([{ number: 3, state: "CLOSED", headRefOid: "tip", isCrossRepository: false }])
    const host = hostAnswering((argv) =>
      argv[0] === "git" ? { exitCode: 128 } : argv[2]?.includes("/compare/") ? { exitCode: 0, stdout: "ahead" } : ended
    )

    expect(await isBranchTaken(host, { name: "acme/app", host: "git.acme.dev" }, "fix/menu", "older")).toBe(true)
    expect(host.runs.at(-1)?.argv.slice(3, 5)).toEqual(["--hostname", "git.acme.dev"])
  })

  test("one from a fork of the same name isn't", async () => {
    const host = hostAnswering(() => branchAnswer([{ state: "OPEN", headRefOid: "x", isCrossRepository: true }]))

    expect(await isBranchTaken(host, REPO, "fix/menu", "x")).toBe(false)
  })

  test("where GitHub can't be asked, it rejects with what gh said", async () => {
    const host = hostAnswering(() => ({ exitCode: 1, stderr: "\nHTTP 502: Bad Gateway\nmore\n" }))

    await expect(isBranchTaken(host, REPO, "fix/menu", "x")).rejects.toThrow("HTTP 502: Bad Gateway")
  })
})

describe("one lookup per branch and commit at a time", () => {
  test("one that ends after a newer one started leaves the newer one's place, which its own end frees", async () => {
    const pending: ((ran: ProcessRunResult) => void)[] = []
    const none = JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } })
    const answered = { exitCode: 0, stdout: none, stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
    const host: BranchLookupHost = {
      run: () => new Promise((resolve) => pending.push(resolve)),
      read: async () => "",
      write: async () => undefined,
      exists: async () => false,
      isLink: async () => false,
      storedList: async () => snapshotOf({ mine: [{ number: 1, headRefName: "fix/menu" }] }),
      branchPulls: async () => null,
      keepBranchPulls: async () => undefined,
      log: () => undefined
    }
    const session = createSession(readSettings({}))

    const first = lookUpBranch(host, session, REPO, "feature/export", "h1", false)
    await promisesRun()
    const second = lookUpBranch(host, session, REPO, "feature/export", "h2", false)
    await promisesRun()
    expect(pending).toHaveLength(2)

    pending[0]!(answered)
    expect(await first).toMatchObject({ looked: { head: "h1", isTaken: false } })
    expect(session.branchLookup?.key).toBe("feature/export h2 null")

    pending[1]!(answered)
    expect(await second).toMatchObject({ looked: { head: "h2", isTaken: false } })
    expect(session.branchLookup).toBe(null)
  })
})
