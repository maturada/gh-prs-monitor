// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { PullRow } from "../types"
import {
  asyncMergeArgv,
  asyncMergeDone,
  asyncMergeStatusArgv,
  confirmLabels,
  confirmQuestion,
  mergeArgv,
  mergeConfirm,
  mergeDone,
  readAsyncMerge,
  readConfirm,
  readCurrentPull,
  isOffTheChoices,
  readFailedRuns,
  readMergeOutcome,
  readStack,
  readyArgv,
  readyConfirm,
  readyDone,
  rerequestArgv,
  rerequestConfirm,
  rerequestDone,
  rerunArgv,
  rerunConfirm,
  rerunDone,
  staleFor,
  staleNote,
  updateArgv,
  updateConfirm,
  updateDone
} from "./actions"
import { readAnswer } from "./question"

const ROW: PullRow = {
  number: 7,
  title: "Fix the menu",
  url: "https://github.com/acme/app/pull/7",
  author: "me",
  headRefName: "fix/menu",
  headOid: "abc123",
  baseRefName: "main",
  isCrossRepository: false,
  isDraft: false,
  stack: null,
  stage: "ready",
  status: { text: "Ready To Merge", tone: "success" },
  details: [],
  actions: ["merge"],
  primary: "merge",
  rerequestFrom: [],
  signals: {
    ci: "SUCCESS",
    isConflicting: false,
    unresolvedThreads: 0,
    isAutoMerge: false,
    isQueued: false,
    reviews: {},
    conversation: { count: 0, authors: [] },
    isRequested: false,
    hasCommitsSinceMyReview: false
  }
}

const GITHUB = { name: "acme/app", host: "github.com" }

const ENTERPRISE = { name: "acme/app", host: "github.acme.dev" }

// A button pressed, with no instructions typed.
const pressed = (choice: string) => ({ choice, instructions: "" })

describe("merge", () => {
  test("asks with the repository's methods, its usual one first, Cancel last", () => {
    const confirm = mergeConfirm(ROW, ["SQUASH", "MERGE"], false)

    expect(confirm).toMatchObject({
      header: "Merge PR",
      subject: "#7 Fix the menu",
      text: "Merge into main?",
      detail: null
    })
    expect(confirmLabels(confirm)).toEqual(["Squash and merge", "Create a merge commit", "Cancel"])
    expect(mergeConfirm(ROW, ["REBASE"], true).text).toBe(
      "Merge into main once nothing holds it back (checks, required reviews)?"
    )
    // The dialog's question: the pull request's own method drawn as the main answer, no instructions taken.
    expect(confirmQuestion(confirm)).toEqual({
      header: "Merge PR",
      subject: "#7 Fix the menu",
      text: "Merge into main?",
      detail: null,
      choices: ["Squash and merge", "Create a merge commit", "Cancel"],
      main: "Squash and merge",
      instructions: null
    })
  })

  test("only a method's own label merges; Cancel, a dismissal or typed text do not", () => {
    const confirm = mergeConfirm(ROW, ["SQUASH", "MERGE"], false)

    expect(readConfirm(confirm, pressed("Create a merge commit"))).toBe("MERGE")
    expect(readConfirm(confirm, pressed("Cancel"))).toBe(null)
    expect(readConfirm(confirm, null)).toBe(null)
    expect(readConfirm(confirm, readAnswer("squash it please", confirmLabels(confirm)))).toBe(null)
    // A method typed under Claude Code's Other, in any case, is that method.
    expect(readConfirm(confirm, readAnswer(" squash AND merge ", confirmLabels(confirm)))).toBe("SQUASH")
  })

  test("pinned to the commit shown, on the repository's own host", () => {
    expect(mergeArgv(GITHUB, ROW, "SQUASH", false)).toEqual([
      ...["gh", "pr", "merge", "7", "--repo", "github.com/acme/app", "--squash"],
      ...["--match-head-commit", "abc123"]
    ])
    expect(mergeArgv(ENTERPRISE, ROW, "REBASE", true)).toEqual([
      ...["gh", "pr", "merge", "7", "--repo", "github.acme.dev/acme/app", "--rebase"],
      ...["--match-head-commit", "abc123", "--auto"]
    ])
  })
})

describe("what a merge came to", () => {
  function state(pull: unknown): string {
    return JSON.stringify({ data: { repository: { pullRequest: pull } } })
  }

  test("read from the pull request's state on GitHub after the merge", () => {
    expect(readMergeOutcome(state({ state: "MERGED", isInMergeQueue: false, autoMergeRequest: null }))).toBe("merged")
    expect(readMergeOutcome(state({ state: "OPEN", isInMergeQueue: true, autoMergeRequest: null }))).toBe("queued")
    expect(
      readMergeOutcome(state({ state: "OPEN", isInMergeQueue: false, autoMergeRequest: { enabledAt: "x" } }))
    ).toBe("auto")
    expect(readMergeOutcome(state({ state: "OPEN", isInMergeQueue: false, autoMergeRequest: null }))).toBe("unknown")
    expect(readMergeOutcome("not json")).toBe("unknown")
  })

  test("said as it came out, the queue included", () => {
    expect(mergeDone(ROW, "merged")).toBe("#7 merged into main")
    expect(mergeDone(ROW, "queued")).toBe("#7 is in the merge queue for main")
    expect(mergeDone(ROW, "auto")).toBe("#7 merges into main once nothing holds it back")
    expect(mergeDone(ROW, "unknown")).toBe("#7 merge sent to GitHub")
  })
})

describe("update branch", () => {
  test("merging the base in, or rebasing onto it", () => {
    const confirm = updateConfirm(ROW)

    expect(confirm).toMatchObject({
      header: "Update PR",
      subject: "#7 Fix the menu",
      text: "Bring the latest main into it?",
      detail: "Rebasing rewrites its commits on GitHub, so a copy of the branch here then needs checking out again."
    })
    expect(confirmLabels(confirm)).toEqual(["Merge main in", "Rebase onto main", "Cancel"])
    expect(updateArgv(GITHUB, ROW, readConfirm(confirm, pressed("Merge main in"))!)).toEqual([
      ...["gh", "pr", "update-branch", "7", "--repo", "github.com/acme/app"]
    ])
    expect(updateArgv(GITHUB, ROW, readConfirm(confirm, pressed("Rebase onto main"))!)).toEqual([
      ...["gh", "pr", "update-branch", "7", "--repo", "github.com/acme/app", "--rebase"]
    ])
  })

  test("says whether there was anything to bring in, as gh does", () => {
    expect(updateDone(ROW, "✓ PR branch updated\n")).toBe("#7 updated with the latest main")
    expect(updateDone(ROW, "\n✓ PR branch already up-to-date\n")).toBe("#7 was already up to date with main")
  })
})

describe("the pull request as GitHub has it at a press", () => {
  const OPEN = { state: "open", merged: false, draft: false, head: { sha: "abc" }, base: { ref: "main" }, stack: null }

  test("read from the REST pull request: open, merged or closed, draft, head, base, stack, who is asked to review", () => {
    expect(readCurrentPull(JSON.stringify({ ...OPEN, stack: { number: 40, position: 3, size: 4 } }))).toEqual({
      state: "open",
      isDraft: false,
      headOid: "abc",
      stack: { number: 40, position: 3, size: 4 },
      requested: [],
      base: "main",
      headRepo: null,
      maintainerCanModify: false,
      isAutoMerge: false,
      isConflicting: false,
      isConflictFree: false,
      behindBase: null
    })
    // A fork's: where its branch lives, and whether maintainers may push there; a deleted fork has no repository.
    const fork = { ...OPEN, head: { sha: "abc", repo: { full_name: "ann/app" } }, maintainer_can_modify: true }
    expect(readCurrentPull(JSON.stringify(fork))).toMatchObject({ headRepo: "ann/app", maintainerCanModify: true })
    expect(readCurrentPull(JSON.stringify({ ...fork, head: { sha: "abc", repo: null } }))?.headRepo).toBe(null)
    expect(readCurrentPull(JSON.stringify({ ...fork, maintainer_can_modify: "yes" }))?.maintainerCanModify).toBe(false)
    // Auto-merge on is an object of who turned it on and how; a merge GitHub hasn't worked out yet is no conflict.
    const merging = { ...OPEN, auto_merge: { merge_method: "squash" }, mergeable: false }
    expect(readCurrentPull(JSON.stringify(merging))).toMatchObject({
      isAutoMerge: true,
      isConflicting: true,
      isConflictFree: false
    })
    expect(readCurrentPull(JSON.stringify({ ...OPEN, auto_merge: null, mergeable: null }))).toMatchObject({
      isAutoMerge: false,
      isConflicting: false,
      isConflictFree: false
    })
    expect(readCurrentPull(JSON.stringify({ ...OPEN, mergeable: true }))).toMatchObject({
      isConflicting: false,
      isConflictFree: true
    })
    expect(readCurrentPull(JSON.stringify({ ...OPEN, base: null }))?.base).toBe(null)
    // A stack GitHub only half describes is none.
    for (const stack of [
      { number: 40 },
      { number: 40, size: 4 },
      { number: 40, position: 3 },
      { position: 3, size: 4 }
    ]) {
      expect(readCurrentPull(JSON.stringify({ ...OPEN, stack }))?.stack).toBe(null)
    }
    // Teams are asked under `requested_teams`; a reviewer without a login is left out.
    expect(
      readCurrentPull(JSON.stringify({ ...OPEN, requested_reviewers: [{ login: "ann" }, null, {}, { login: "bob" }] }))
        ?.requested
    ).toEqual(["ann", "bob"])
    expect(readCurrentPull(JSON.stringify({ ...OPEN, requested_reviewers: "ann" }))?.requested).toEqual([])
    expect(readCurrentPull(JSON.stringify({ ...OPEN, state: "closed", merged: true, draft: true }))).toMatchObject({
      state: "merged",
      isDraft: true,
      stack: null
    })
    expect(readCurrentPull(JSON.stringify({ ...OPEN, state: "closed" }))?.state).toBe("closed")
    expect(readCurrentPull(JSON.stringify({ message: "Not Found" }))).toBe(null)
    expect(readCurrentPull("not json")).toBe(null)
    for (const json of ["null", "[]", "1"]) {
      expect(readCurrentPull(json)).toBe(null)
    }
  })

  test("merged or closed stops every press; new commits stop a merge; a draft marked ready stops Ready; a review asked again, or a draft again, stops Re-Request Review", () => {
    const current = {
      state: "open",
      isDraft: false,
      headOid: "abc",
      stack: null,
      requested: [],
      base: "main",
      headRepo: "acme/app",
      maintainerCanModify: false,
      isAutoMerge: false,
      isConflicting: false,
      isConflictFree: false,
      behindBase: null
    } as const
    const row = { ...ROW, headOid: "abc" }

    expect(staleFor("review", row, { ...current, state: "merged" })).toBe("merged")
    expect(staleFor("resolve", row, { ...current, state: "closed" })).toBe("closed")
    expect(staleFor("merge", row, { ...current, headOid: "def" })).toBe("moved")
    expect(staleFor("autoMerge", row, { ...current, headOid: "def" })).toBe("moved")
    // A branch update or a skill works on the branch as it is now.
    expect(staleFor("updateBranch", row, { ...current, headOid: "def" })).toBe(null)
    expect(staleFor("fixCi", row, { ...current, headOid: "def" })).toBe(null)
    expect(staleFor("ready", row, current)).toBe("ready")
    expect(staleFor("ready", row, { ...current, isDraft: true })).toBe(null)
    // Asking again doesn't depend on the commit.
    expect(staleFor("rerequest", row, { ...current, headOid: "def" })).toBe(null)
    expect(staleFor("rerequest", row, { ...current, state: "merged" })).toBe("merged")
    // One of those it would ask, asked again meanwhile, would be notified twice; no other press minds.
    const asking = { ...row, rerequestFrom: ["ann", "bob"] }
    expect(staleFor("rerequest", asking, { ...current, requested: ["cid"] })).toBe(null)
    expect(staleFor("rerequest", asking, { ...current, requested: ["bob"] })).toBe("asked")
    // Turned back into a draft, it isn't up for review; other presses don't mind.
    expect(staleFor("rerequest", asking, { ...current, isDraft: true })).toBe("draft")
    expect(staleFor("resolve", asking, { ...current, isDraft: true })).toBe(null)
    expect(staleFor("fixCi", asking, { ...current, isDraft: true })).toBe(null)
    expect(staleNote(asking, "draft")).toBe("#7 is a draft now; refreshing the list")
    expect(staleFor("merge", asking, { ...current, requested: ["bob"] })).toBe(null)
    expect(staleFor("resolve", asking, { ...current, requested: ["bob"] })).toBe(null)
    expect(staleNote(asking, "asked")).toBe("#7 had its review re-requested meanwhile; refreshing the list")
    expect(staleFor("merge", row, current)).toBe(null)
  })

  test("a base GitHub moved on stops a merge and a branch update, which name it; one it can't read stops nothing", () => {
    const current = {
      state: "open",
      isDraft: false,
      headOid: "abc",
      stack: null,
      requested: [],
      base: "release",
      headRepo: "acme/app",
      maintainerCanModify: false,
      isAutoMerge: false,
      isConflicting: false,
      isConflictFree: false,
      behindBase: null
    } as const
    const row = { ...ROW, headOid: "abc" }

    expect(staleFor("merge", row, current)).toBe("retargeted")
    expect(staleFor("autoMerge", row, current)).toBe("retargeted")
    expect(staleFor("updateBranch", row, current)).toBe("retargeted")
    expect(staleFor("resolve", row, current)).toBe(null)
    expect(staleFor("rerun", row, current)).toBe(null)
    expect(staleFor("merge", row, { ...current, base: null })).toBe(null)
    expect(staleNote(row, "retargeted")).toBe("#7 goes into another branch now; refreshing the list")
  })

  test("Auto-Merge with auto-merge on already, and Update Branch with nothing to bring in or a conflict now, stop", () => {
    const current = {
      state: "open",
      isDraft: false,
      headOid: "abc",
      stack: null,
      requested: [],
      base: "main",
      headRepo: "acme/app",
      maintainerCanModify: false,
      isAutoMerge: false,
      isConflicting: false,
      isConflictFree: false,
      behindBase: 2
    } as const
    const row = { ...ROW, headOid: "abc" }

    expect(staleFor("autoMerge", row, current)).toBe(null)
    expect(staleFor("autoMerge", row, { ...current, isAutoMerge: true })).toBe("autoMerged")
    // Said over new commits, as auto-merge waits for those too.
    expect(staleFor("autoMerge", row, { ...current, isAutoMerge: true, headOid: "def" })).toBe("autoMerged")
    // Merging at once is a choice of its own.
    expect(staleFor("merge", row, { ...current, isAutoMerge: true })).toBe(null)

    expect(staleFor("updateBranch", row, current)).toBe(null)
    expect(staleFor("updateBranch", row, { ...current, behindBase: 0 })).toBe("updated")
    expect(staleFor("updateBranch", row, { ...current, behindBase: null })).toBe(null)
    expect(staleFor("updateBranch", row, { ...current, behindBase: 0, isConflicting: true })).toBe("conflicting")
    expect(staleFor("updateBranch", row, { ...current, behindBase: 0, base: "release" })).toBe("retargeted")
    expect(staleFor("merge", row, { ...current, behindBase: 0, isConflicting: true })).toBe(null)

    expect(staleNote(row, "autoMerged")).toBe("#7 has auto-merge on already; refreshing the list")
    expect(staleNote(row, "updated")).toBe("#7 is up to date with main already; refreshing the list")
    expect(staleNote(row, "conflicting")).toBe("#7 conflicts with main now; refreshing the list")

    // Resolve Conflicts stops where GitHub merges it cleanly now; where it can't tell yet, the skill looks itself.
    expect(staleFor("resolveConflicts", row, { ...current, isConflicting: true })).toBe(null)
    expect(staleFor("resolveConflicts", row, current)).toBe(null)
    expect(staleFor("resolveConflicts", row, { ...current, isConflictFree: true })).toBe("conflictFree")
    expect(staleFor("resolveConflicts", row, { ...current, isConflictFree: true, state: "merged" })).toBe("merged")
    expect(staleFor("fixCi", row, { ...current, isConflictFree: true })).toBe(null)
    expect(staleNote(row, "conflictFree")).toBe("#7 has no conflicts with main now; refreshing the list")
  })

  test("each is said with the pull request's number", () => {
    expect(staleNote(ROW, "merged", true)).toBe("#7 was merged meanwhile")
    expect(staleNote(ROW, "merged")).toBe("#7 was merged meanwhile; refreshing the list")
    expect(staleNote(ROW, "closed")).toBe("#7 was closed meanwhile; refreshing the list")
    expect(staleNote(ROW, "moved")).toBe("#7: new commits arrived since the list was refreshed; refreshing it")
    expect(staleNote(ROW, "ready")).toBe("#7 is ready for review already; refreshing the list")
  })
})

describe("stacked merge", () => {
  const STACK = JSON.stringify({
    number: 40,
    base: { ref: "main" },
    pull_requests: [
      { number: 5, title: "Merged earlier", state: "closed" },
      { number: 6, title: "Lay the groundwork", state: "open" },
      { number: 7, title: "Fix the menu", state: "open" },
      { number: 8, title: "Above it", state: "open" }
    ]
  })

  test("a pull request's stack, and the open ones below it, bottom first", () => {
    expect(readStack(STACK, 7)).toEqual({
      number: 40,
      base: "main",
      below: [{ number: 6, title: "Lay the groundwork" }]
    })
    expect(readStack(STACK, 5)).toEqual({ number: 40, base: "main", below: [] })
    // A stack that doesn't hold it, or can't be read, is none.
    expect(readStack(STACK, 99)).toBe(null)
    expect(readStack("{}", 7)).toBe(null)
  })

  test("the question merges into the stack's base and names what merges along", () => {
    const stack = {
      number: 40,
      base: "main",
      below: [
        { number: 5, title: "a" },
        { number: 6, title: "b" }
      ]
    }

    expect(mergeConfirm({ ...ROW, baseRefName: "feature/base" }, ["SQUASH"], false, stack)).toMatchObject({
      text: "Merge into main?",
      detail: "It is in a stack, so #5 and #6 below it merge along."
    })
    expect(mergeConfirm(ROW, ["SQUASH"], false, { ...stack, below: [{ number: 5, title: "a" }] }).detail).toBe(
      "It is in a stack, so #5 below it merges along."
    )
    expect(mergeConfirm(ROW, ["SQUASH"], false, { ...stack, below: [] })).toMatchObject({
      text: "Merge into main?",
      detail: null
    })
  })

  test("the question says where the pull request sits in its stack, as GitHub has it at the press", () => {
    const stack = { number: 40, base: "main", below: [{ number: 5, title: "a" }] }
    const at = (position: number) => ({ number: 40, position, size: 3 })

    expect(mergeConfirm(ROW, ["SQUASH"], false, stack, at(2)).detail).toBe(
      "It is 2 of 3 in stack #40, so #5 below it merges along."
    )
    // At the bottom nothing merges along, but its place still says what comes after.
    expect(mergeConfirm(ROW, ["SQUASH"], false, { ...stack, below: [] }, at(1)).detail).toBe(
      "It is 1 of 3 in stack #40."
    )
    // Past the bottom with nothing open below: those below are done.
    expect(mergeConfirm(ROW, ["SQUASH"], false, { ...stack, below: [] }, at(3)).detail).toBe(
      "It is 3 of 3 in stack #40; those below it are merged or closed."
    )
    // Where the stack couldn't be looked up, the place alone, claiming nothing of those below.
    expect(mergeConfirm(ROW, ["SQUASH"], false, null, at(3)).detail).toBe("It is 3 of 3 in stack #40.")
    // Auto-Merge, which looks up no stack, still says the place.
    expect(mergeConfirm(ROW, ["SQUASH"], true, null, at(2)).detail).toBe("It is 2 of 3 in stack #40.")
    // The list's place plays no part: only the one passed in.
    expect(mergeConfirm({ ...ROW, stack: at(2) }, ["SQUASH"], false, null, null).detail).toBe(null)
  })

  test("merges through the asynchronous API, pinned to the commit the pane showed, and reads what came of it", () => {
    expect(asyncMergeArgv(GITHUB, ROW, "REBASE")).toEqual([
      ...["gh", "api", "--method", "PUT", "repos/acme/app/pulls/7/merge-async", "--hostname", "github.com"],
      ...["-f", "merge_method=rebase", "-f", "sha=abc123"]
    ])
    expect(asyncMergeStatusArgv(GITHUB, ROW, "u-1")).toEqual([
      "gh",
      "api",
      "repos/acme/app/pulls/7/merge-async/u-1",
      "--hostname",
      "github.com"
    ])
    expect(readAsyncMerge(JSON.stringify({ status: "pending", details: { uuid: "u-1" } }))).toEqual({
      status: "pending",
      uuid: "u-1",
      message: null
    })
    expect(readAsyncMerge(JSON.stringify({ status: "failed", details: { message: "Conflict" } }))).toEqual({
      status: "failed",
      uuid: null,
      message: "Conflict"
    })
    expect(readAsyncMerge(JSON.stringify({ status: "unheard-of" }))).toBe(null)
    expect(readAsyncMerge("")).toBe(null)
  })

  test("what came of it, for the alert", () => {
    const stack = { number: 40, base: "main", below: [{ number: 6, title: "b" }] }
    const done = (status: "pending" | "merged" | "enqueued" | "failed", message: string | null = null) =>
      asyncMergeDone(ROW, stack, { status, uuid: null, message })

    expect(done("merged")).toBe("#7 merged into main, with #6 below it")
    expect(done("enqueued")).toBe("#7 is in the merge queue for main, with #6 below it")
    expect(done("pending")).toBe("#7: GitHub is merging it into main, with #6 below it; the list shows it once done")
    expect(done("failed", "Conflict")).toBe("#7: GitHub could not merge it: Conflict")
    expect(done("failed")).toBe("#7: GitHub could not merge it")
  })
})

describe("re-request review", () => {
  test("asks those named again, by GitHub's request for reviewers, and says so", () => {
    const row = { ...ROW, rerequestFrom: ["ann"] }
    const confirm = rerequestConfirm(row)

    expect(confirm).toMatchObject({
      header: "Re-Request",
      subject: "#7 Fix the menu",
      text: "Ask ann to review it again?",
      detail: "ann requested changes before the latest commits."
    })
    expect(confirmLabels(confirm)).toEqual(["Re-request review", "Cancel"])
    expect(readConfirm(confirm, pressed("Re-request review"))).toBe(true)
    expect(readConfirm(confirm, pressed("Cancel"))).toBe(null)
    expect(rerequestArgv(GITHUB, row)).toEqual([
      ...["gh", "api", "--method", "POST", "repos/acme/app/pulls/7/requested_reviewers", "--hostname", "github.com"],
      ...["-f", "reviewers[]=ann"]
    ])
    expect(rerequestDone(row)).toBe("#7: review re-requested from ann")
  })

  test("several are named together, on the repository's own host", () => {
    const row = { ...ROW, rerequestFrom: ["ann", "bob", "cid"] }

    expect(rerequestConfirm(row).text).toBe("Ask ann, bob and cid to review it again?")
    expect(rerequestArgv(ENTERPRISE, row)).toEqual([
      ...["gh", "api", "--method", "POST", "repos/acme/app/pulls/7/requested_reviewers", "--hostname"],
      ...["github.acme.dev", "-f", "reviewers[]=ann", "-f", "reviewers[]=bob", "-f", "reviewers[]=cid"]
    ])
    expect(rerequestDone(row)).toBe("#7: review re-requested from ann, bob and cid")
  })
})

describe("ready for review", () => {
  test("asks once, marks the draft ready with gh, and says so", () => {
    const confirm = readyConfirm({ ...ROW, title: "Try the new tiles" })

    expect(confirm).toMatchObject({
      header: "Ready PR",
      subject: "#7 Try the new tiles",
      text: "Mark it ready for review?",
      detail: null
    })
    expect(confirmLabels(confirm)).toEqual(["Mark ready for review", "Cancel"])
    expect(readConfirm(confirm, pressed("Mark ready for review"))).toBe(true)
    expect(readConfirm(confirm, pressed("Cancel"))).toBe(null)
    // Typed in place of a choice: one that names none is said so, a no is not.
    const typed = (instructions: string) => ({ choice: null, instructions })
    expect(isOffTheChoices(confirm, typed("yes, go"))).toBe(true)
    expect(isOffTheChoices(confirm, typed("no thanks"))).toBe(false)
    expect(isOffTheChoices(confirm, pressed("Mark ready for review"))).toBe(false)
    expect(isOffTheChoices(confirm, pressed("Cancel"))).toBe(false)
    expect(isOffTheChoices(confirm, null)).toBe(false)
    // Nothing typed and nothing picked: there was nothing to say.
    expect(isOffTheChoices(confirm, typed(""))).toBe(false)
    expect(readyArgv(GITHUB, ROW)).toEqual(["gh", "pr", "ready", "7", "--repo", "github.com/acme/app"])
    expect(readyDone(ROW)).toBe("#7 is ready for review")
  })
})

describe("re-run failed checks", () => {
  function suites(nodes: unknown[]): string {
    return JSON.stringify({
      data: {
        repository: { pullRequest: { commits: { nodes: [{ commit: { oid: "abc123", checkSuites: { nodes } } }] } } }
      }
    })
  }

  test("the failed GitHub Actions runs, each once; passing and outside checks are left out", () => {
    const json = suites([
      { conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } },
      { conclusion: "TIMED_OUT", workflowRun: { databaseId: 12, workflow: { name: "E2E" } } },
      { conclusion: "SUCCESS", workflowRun: { databaseId: 13, workflow: { name: "Lint" } } },
      { conclusion: "CANCELLED", workflowRun: { databaseId: 14, workflow: { name: "Deploy preview" } } },
      { conclusion: "FAILURE", workflowRun: null },
      { conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } }
    ])

    expect(readFailedRuns(json)).toEqual({
      headOid: "abc123",
      runs: [
        { id: 11, name: "CI" },
        { id: 12, name: "E2E" },
        { id: 14, name: "Deploy preview" }
      ],
      hasActionsRuns: true
    })
    expect(readFailedRuns(suites([]))).toEqual({ headOid: "abc123", runs: [], hasActionsRuns: false })
    expect(readFailedRuns("not json")).toEqual({ headOid: null, runs: [], hasActionsRuns: false })
    // Each workflow's latest run passed or still runs: none failing, but they are Actions runs.
    const again = suites([
      { conclusion: null, workflowRun: { databaseId: 15, workflow: { name: "CI" } } },
      { conclusion: "FAILURE", workflowRun: null }
    ])
    expect(readFailedRuns(again)).toEqual({ headOid: "abc123", runs: [], hasActionsRuns: true })
  })

  test("says how many runs went when one refused", () => {
    expect(rerunDone(ROW, 2, [])).toBe("#7: re-running the failed jobs")
    expect(rerunDone(ROW, 1, ["run 11 cannot be rerun"])).toBe("#7: re-ran 0 of 1 run; run 11 cannot be rerun")
    expect(rerunDone(ROW, 3, ["run 12 cannot be rerun; it is already running"])).toBe(
      "#7: re-ran 2 of 3 runs; run 12 cannot be rerun; it is already running"
    )
  })

  test("only each workflow's latest run counts, so one cancelled by a newer run is left out", () => {
    const run = (id: number, conclusion: string, at: string, name: string) => ({
      conclusion,
      workflowRun: { databaseId: id, createdAt: `2026-10-07T${at}:00Z`, workflow: { name } }
    })
    // Newest first, as GitHub may list them; the order must not decide which run counts.
    const json = suites([
      run(12, "FAILURE", "09:05", "CI"),
      run(11, "CANCELLED", "09:00", "CI"),
      run(22, "SUCCESS", "09:05", "E2E"),
      run(21, "CANCELLED", "09:00", "E2E")
    ])

    expect(readFailedRuns(json).runs).toEqual([{ id: 12, name: "CI" }])
  })

  test("two workflows that share a name are told apart", () => {
    const json = suites([
      {
        conclusion: "FAILURE",
        workflowRun: { databaseId: 31, createdAt: "2026-10-07T09:00:00Z", workflow: { id: "W_lint", name: "CI" } }
      },
      {
        conclusion: "SUCCESS",
        workflowRun: { databaseId: 32, createdAt: "2026-10-07T09:05:00Z", workflow: { id: "W_test", name: "CI" } }
      }
    ])

    expect(readFailedRuns(json).runs).toEqual([{ id: 31, name: "CI" }])
  })

  test("names the runs it will re-run", () => {
    expect(rerunConfirm(ROW, [{ id: 11, name: "CI" }])).toMatchObject({
      subject: "#7 Fix the menu",
      text: 'Re-run the failed jobs of "CI"?',
      detail: null
    })
    expect(
      rerunConfirm(ROW, [
        { id: 11, name: "CI" },
        { id: 12, name: "E2E" },
        { id: 13, name: "Deploy preview" }
      ]).text
    ).toBe('Re-run the failed jobs of "CI", "E2E" and "Deploy preview"?')
    expect(rerunArgv(GITHUB, { id: 11, name: "CI" })).toEqual([
      ...["gh", "run", "rerun", "11", "--failed", "--repo", "github.com/acme/app"]
    ])
  })
})
