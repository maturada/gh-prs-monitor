// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { BranchPulls } from "../types"
import { createArgs, createPlaceQuestion, pullToOpen, wantsBranchLookup } from "./create-flow"
import { readPulls } from "./pulls"
import { DEFAULTS, response, snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"

// GitHub said there is no pull request from `branch` at commit `head` (`BranchPulls`), while the list knew the
// branch's last to end at `endedHead`.
function said(branch: string, head: string, endedHead: string | null = null): BranchPulls {
  return { repo: "acme/app", branch, head, isTaken: false, endedHead }
}

describe("the pull request Create PR could open", () => {
  const fixture: ResponseFixture = {
    mine: [
      { number: 1, headRefName: "fix/menu" },
      { number: 2, headRefName: "draft/legend", isDraft: true },
      { number: 3, headRefName: "feature/fork-only", isCrossRepository: true }
    ],
    requested: [{ number: 7, author: "ann", headRefName: "ann/chart" }]
  }
  const hidingDrafts = readPulls(response(fixture), "acme/app", 1_000, { ...DEFAULTS, isHidingDrafts: true })
  const snapshot = "snapshot" in hidingDrafts ? hidingDrafts.snapshot : null

  test("the default branch and the branches the viewer's open pull requests come from are read, hidden drafts' too", () => {
    expect(snapshot?.defaultBranch).toBe("main")
    // A fork's head may share its name with a branch here, which is not its pull request's.
    expect(snapshot?.ownHeads).toEqual([
      { branch: "fix/menu", oid: "head-1", number: 1 },
      { branch: "draft/legend", oid: "head-2", number: 2 }
    ])
    expect(snapshotOf({ defaultBranch: null }).defaultBranch).toBeNull()
  })

  test("from a branch with none, into the default branch", () => {
    expect(pullToOpen(snapshot, "feature/export", "local-head", said("feature/export", "local-head"))).toEqual({
      branch: "feature/export",
      base: "main"
    })
    expect(pullToOpen(snapshot, "feature/fork-only", "local-head", said("feature/fork-only", "local-head"))).toEqual({
      branch: "feature/fork-only",
      base: "main"
    })
  })

  test("none from the default branch, one with an open pull request of the viewer's or under review, or a pr-<number> one", () => {
    for (const branch of ["main", "fix/menu", "draft/legend", "ann/chart", "pr-7", "pr-12"]) {
      expect(pullToOpen(snapshot, branch, "local-head", said(branch, "local-head"))).toBeNull()
    }
  })

  test("none from a branch whose pull request ended while nothing new came on it; one once it has new commits", () => {
    const ended = snapshot && { ...snapshot, endedHeads: [{ branch: "fix/old", oid: "head-9" }] }

    expect(pullToOpen(ended, "fix/old", "head-9", said("fix/old", "head-9", "head-9"))).toBeNull()
    expect(pullToOpen(ended, "fix/old", "local-head", said("fix/old", "local-head", "head-9"))).toEqual({
      branch: "fix/old",
      base: "main"
    })
  })

  test("none on what GitHub said before the list knew the branch's pull request to end where it knows it now", () => {
    const ended = snapshot && { ...snapshot, endedHeads: [{ branch: "fix/old", oid: "head-9" }] }

    // Said before that pull request ended, as one opened and closed while the session was on another branch.
    expect(pullToOpen(ended, "fix/old", "local-head", said("fix/old", "local-head"))).toBeNull()
    expect(pullToOpen(ended, "fix/old", "local-head", said("fix/old", "local-head", "head-8"))).toBeNull()
    expect(wantsBranchLookup(ended, "fix/old", "local-head")).toBe(true)
  })

  test("on what GitHub said as an earlier version kept it, with no ended head, where the list knows none", () => {
    const { endedHead: _, ...kept } = said("feature/export", "local-head")
    const earlier = kept as BranchPulls
    const ended = snapshot && { ...snapshot, endedHeads: [{ branch: "feature/export", oid: "head-9" }] }

    expect(pullToOpen(snapshot, "feature/export", "local-head", earlier)).toEqual({
      branch: "feature/export",
      base: "main"
    })
    expect(pullToOpen(ended, "feature/export", "local-head", earlier)).toBeNull()
  })

  test("none with no branch checked out, no list, an empty repository, or no push access", () => {
    expect(pullToOpen(snapshot, null, "local-head", null)).toBeNull()
    expect(pullToOpen(null, "feature/export", "local-head", said("feature/export", "local-head"))).toBeNull()
    expect(
      pullToOpen(
        snapshotOf({ defaultBranch: null }),
        "feature/export",
        "local-head",
        said("feature/export", "local-head")
      )
    ).toBeNull()
    expect(
      pullToOpen(
        snapshotOf({ merging: { permission: "READ" } }),
        "feature/export",
        "local-head",
        said("feature/export", "local-head")
      )
    ).toBeNull()
  })
})

describe("a branch's pull requests the lists never showed", () => {
  const snapshot = snapshotOf({ mine: [{ number: 1, headRefName: "fix/menu" }] })

  test("Create PR waits for GitHub to say there is none from the branch at that commit", () => {
    expect(pullToOpen(snapshot, "feature/export", "local-head", null)).toBeNull()
    expect(pullToOpen(snapshot, "feature/export", "local-head", said("feature/export", "local-head"))).toEqual({
      branch: "feature/export",
      base: "main"
    })
    // Said of another commit, another branch or another repository, or said to have one.
    expect(pullToOpen(snapshot, "feature/export", "local-head", said("feature/export", "older"))).toBeNull()
    expect(pullToOpen(snapshot, "feature/export", "local-head", said("feature/other", "local-head"))).toBeNull()
    const elsewhere = { ...said("feature/export", "local-head"), repo: "acme/other" }
    expect(pullToOpen(snapshot, "feature/export", "local-head", elsewhere)).toBeNull()
    const taken = { ...said("feature/export", "local-head"), isTaken: true }
    expect(pullToOpen(snapshot, "feature/export", "local-head", taken)).toBeNull()
  })

  test("is asked only where Create PR would show once it says so", () => {
    expect(wantsBranchLookup(snapshot, "feature/export", "local-head")).toBe(true)
    for (const branch of ["main", "fix/menu", "pr-7"]) {
      expect(wantsBranchLookup(snapshot, branch, "local-head")).toBe(false)
    }
    expect(wantsBranchLookup(snapshot, null, "local-head")).toBe(false)
    expect(wantsBranchLookup(snapshot, "feature/export", null)).toBe(false)
    expect(wantsBranchLookup(null, "feature/export", "local-head")).toBe(false)
  })
})

describe("Create PR's question and arguments", () => {
  test("asks where, naming the branch and the one it goes into, as Review asks", () => {
    expect(createPlaceQuestion("feature/export", "main", false)).toEqual({
      header: "Create PR",
      subject: "feature/export → main",
      text: "Where should it be created?",
      detail:
        "Here it runs in this conversation. A new session opens with it typed in, for you to send. Nothing is pushed or opened before you say yes to its preview.",
      choices: ["This session", "New session", "Cancel"],
      main: null,
      instructions: "to a pull request created in this session"
    })
    expect(createPlaceQuestion("feature/export", "main", true).detail).toMatch(
      /^This session is busy, so here it starts once its turn ends\. /
    )
  })

  test("the branch, the folder where a new session finds it, and instructions on one line after --", () => {
    expect(createArgs({ branch: "feature/export" })).toBe('--branch "feature/export"')
    expect(createArgs({ branch: 'odd"name', worktree: "/a folder\\x", note: "as a draft,\n  into develop" })).toBe(
      '--branch "odd\\"name" --worktree "/a folder\\\\x" -- as a draft, into develop'
    )
  })
})
