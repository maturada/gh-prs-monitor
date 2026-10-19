// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import type { ResponseFixture } from "./testing/fixtures"
import { lineOf } from "./testing/git-host"
import {
  clockOf,
  keptList,
  keptOverReload,
  MINUTE,
  TIMED_OUT,
  machine,
  startSession,
  drawnNodes,
  hasText,
  wordsIn,
  mountPane,
  settleAll,
  settleUntil,
  GITHUB,
  pressDrawn
} from "./testing/world"
import type { Drawn, World } from "./testing/world"

describe("acting on GitHub from the pane", () => {
  const READY: ResponseFixture = { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] }

  test("a compact row shows what is under way in place of its status", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // gh is slow to merge, and the person switches to the compact view meanwhile.
    world.slowWriteMs = 20_000
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.advance(1_000)
    await ui.press({ key: "view" })

    const line = drawnNodes(await ui.find({ key: "pr-2" }))
    expect(wordsIn(line).endsWith("Merging…")).toBe(true)
    expect(hasText(line, "✅ Ready To Merge")).toBe(false)
    // In the full view, under the row's details, in their column, wrapping there.
    await ui.press({ key: "view" })
    const busy = drawnNodes(await ui.find({ key: "pr-2" })).find((node) => node.props?.key === "actions")
    expect(busy?.props?.paddingLeft).toBe("#2".length + 1)
    expect((busy?.children?.[0] as Drawn | undefined)?.props).toMatchObject({ dimColor: true, wrap: "wrap" })
    await clock.advance(60_000)
  })

  test("a pull request merged on GitHub since the list was read is not asked about, and shows as merged", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // Merged on GitHub's page; the list hasn't been read again since.
    world.current = { 2: { state: "merged" } }
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toContain("#2 was merged meanwhile")
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeDefined()
    expect(seen.runs.some((run) => run.startsWith("gh pr merge"))).toBe(false)
  })

  test("closed, moved on or out of draft since the list was read, a press says so and refreshes instead of asking", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Fix the menu", ci: "FAILURE" },
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", isDraft: true }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    world.current = { 1: { state: "closed" }, 2: { head: "pushed-since" }, 3: { isDraft: false } }
    const ui = await mountPane($, "terminal")
    const loads = () => seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = loads()

    for (const key of ["fixCi-1", "merge-2", "ready-3"]) {
      await ui.press({ key })
      await clock.settle()
    }

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toEqual(
      expect.arrayContaining([
        "#1 was closed meanwhile; refreshing the list",
        "#2: new commits arrived since the list was refreshed; refreshing it",
        "#3 is ready for review already; refreshing the list"
      ])
    )
    expect(loads()).toBeGreaterThan(before)
    expect(seen.commands).toEqual([])
  })

  test("Auto-Merge on already, or a branch with nothing to bring in or conflicting now: said, refreshed, nothing asked", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      merging: { autoMerge: true },
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED", ci: "PENDING" },
        { number: 4, title: "Bump the icons", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" },
        { number: 5, title: "Rename the tiles", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    // Turned on, brought up to date and pushed on with a conflict on GitHub since the list was read.
    world.current = { 2: { isAutoMerge: true }, 4: { behindBase: 0 }, 5: { isConflicting: true } }
    const ui = await mountPane($, "terminal")
    const loads = () => seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = loads()

    for (const key of ["autoMerge-2", "updateBranch-4", "updateBranch-5"]) {
      await ui.press({ key })
      await clock.settle()
    }

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toEqual(
      expect.arrayContaining([
        "#2 has auto-merge on already; refreshing the list",
        "#4 is up to date with main already; refreshing the list",
        "#5 conflicts with main now; refreshing the list"
      ])
    )
    expect(loads()).toBeGreaterThan(before)
    expect(seen.runs.some((run) => /^gh pr (merge|update-branch) /.test(run))).toBe(false)
    // Only Update Branch compares the branch with its base.
    expect(seen.runs.filter((run) => run.includes("--jq .behind_by")).map((run) => run.split(" ")[2])).toEqual([
      "repos/acme/app/compare/main...head-4",
      "repos/acme/app/compare/main...head-5"
    ])
  })

  test("two presses on Merge at once start one flow: the second finds the row taken", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Cancel", slowPullMs: 2_000 }
    const seen = machine($, on, world, clock)
    // The button's own handler runs twice at once for one press, as for two presses that reach the plugin together.
    on("ui.press", async ($, e, next) => {
      const [first] = await Promise.all([next(e), next(e)])
      return first
    })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "merge-2" })
    await clock.advance(5_000)
    await settleAll(clock, seen)

    expect(seen.runs.filter((run) => /^gh api repos\/acme\/app\/pulls\/2 /.test(run))).toHaveLength(1)
    expect(seen.toasts).toEqual([])
  })

  test("on GitHub Enterprise, a press and the lookup of pull requests that left ask its server", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Cancel",
      repoUrl: "https://ghe.example.com/acme/app",
      closed: [{ number: 2, state: "MERGED", by: "ann" }]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.runs.some((run) => run.includes("pulls/7")))
    world.github = { ...GITHUB, mine: [GITHUB.mine![0]!] }
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen, () => seen.runs.some((run) => run.includes("CLOSED_EVENT")))

    expect(seen.runs).toContain("gh api repos/acme/app/pulls/7 --hostname ghe.example.com")
    const lookup = seen.runs.find((run) => run.includes("CLOSED_EVENT"))
    expect(lookup?.startsWith("gh api graphql --hostname ghe.example.com ")).toBe(true)
  })

  test("Merge and Update Branch on one GitHub moved to another base meanwhile ask nothing; the list refreshes", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    world.current = { 2: { base: "release" }, 3: { base: "release" } }
    const ui = await mountPane($, "terminal")

    for (const key of ["merge-2", "updateBranch-3"]) {
      await ui.press({ key })
      await clock.settle()
    }

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toEqual(
      expect.arrayContaining([
        "#2 goes into another branch now; refreshing the list",
        "#3 goes into another branch now; refreshing the list"
      ])
    )
    expect(seen.runs.some((run) => run.startsWith("gh pr merge") || run.startsWith("gh pr update-branch"))).toBe(false)
  })

  test("Review on one merged meanwhile, and Re-Run CI on one closed, ask nothing; the lists refresh", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }],
      requested: [{ number: 7, title: "Usage chart", author: "ann" }]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    world.current = { 1: { state: "closed" }, 7: { state: "merged" } }
    const ui = await mountPane($, "terminal")

    for (const key of ["review-7", "rerun-1"]) {
      await ui.press({ key })
      await clock.settle()
    }

    expect(world.asked).toBe(undefined)
    expect(seen.toasts).toEqual(
      expect.arrayContaining([
        "#7 was merged meanwhile; refreshing the list",
        "#1 was closed meanwhile; refreshing the list"
      ])
    )
    // Someone else's pull request isn't drawn as merged among your own.
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeUndefined()
    expect(seen.commands).toEqual([])
    // Re-Run CI stopped before looking up the failed runs.
    expect(seen.runs.some((run) => run.includes("checkSuites"))).toBe(false)
  })

  test("where GitHub can't be asked how it stands now, the press asks as before", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      isLookupFailing: true
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await settleAll(clock, seen, () => seen.runs.some((run) => run.startsWith("gh pr merge")))

    expect(world.asked).toBe(1)
    expect(seen.runs).toContain("gh pr merge 2 --repo github.com/acme/app --squash --match-head-commit head-2")
  })

  test("where GitHub can't be asked how it stands now, Merge words the stack place as the list read it", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED", stack: { number: 30, position: 2, size: 3 } }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel", isLookupFailing: true }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await settleAll(clock, seen, () => world.asked !== undefined)

    expect(world.detail).toBe("It is 2 of 3 in stack #30.")
  })

  test("while Claude Code's own dialog asks, another press is told to answer it first, and asks GitHub nothing", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", isDraft: true }
      ]
    }
    // The pane isn't shown, so the merge is asked in Claude Code's own dialog; the person takes a while.
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel", slowDialogMs: 5_000 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.isPaneOpen = false

    await ui.press({ key: "merge-2" })
    await clock.settle()
    const lookups = seen.runs.filter((run) => run.startsWith("gh api repos/acme/app/pulls/")).length
    await ui.press({ key: "ready-3" })
    await clock.settle()

    expect(seen.toasts).toContain("Answer or cancel the open question first.")
    expect(seen.runs.filter((run) => run.startsWith("gh api repos/acme/app/pulls/"))).toHaveLength(lookups)
    await clock.advance(5_000)
    expect(world.asked).toBe(1)
    expect(seen.runs.some((run) => run.startsWith("gh pr ready"))).toBe(false)
  })

  test("two presses whose looks at GitHub overlap ask once: the later is told to answer the first", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", isDraft: true }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, slowPullMs: 2_000 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal", 100, true)

    // The second press is made while GitHub still answers the first's look, before its question opens.
    await ui.press({ key: "merge-2" })
    await clock.advance(1_000)
    await ui.press({ key: "ready-3" })
    await clock.advance(5_000)

    expect(world.asked).toBe(1)
    expect(world.header).toBe("Merge PR")
    expect(seen.toasts).toContain("Answer or cancel the open question first.")
    expect(seen.runs.some((run) => run.startsWith("gh pr ready"))).toBe(false)
  })

  test("Merge asks how, then merges the commit the pane showed", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.asked).toBe(1)
    // Asked whether it is in a stack first: one in none merges as it always did.
    expect(seen.runs).toContain("gh api repos/acme/app/pulls/2 --hostname github.com")
    expect(seen.runs).toContain("gh pr merge 2 --repo github.com/acme/app --squash --match-head-commit head-2")
    expect(seen.toasts).toContain("#2 merged into main")
  })

  test("a stacked pull request merges through GitHub's asynchronous merge, the open ones below it along, and says so", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Lay the groundwork", reviewDecision: "APPROVED" },
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" }
      ]
    }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      stack: {
        number: 40,
        base: "main",
        pulls: [
          { number: 39, title: "Merged earlier", state: "closed" },
          { number: 1, title: "Lay the groundwork", state: "open" },
          { number: 2, title: "Add a legend", state: "open" }
        ]
      },
      // One look times out, as GitHub can be slow to answer.
      asyncMerge: [
        JSON.stringify({ status: "pending", details: { uuid: "u-1" } }),
        TIMED_OUT,
        JSON.stringify({ status: "pending" }),
        JSON.stringify({ status: "merged", details: { sha: "abc" } })
      ]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    await clock.advance(10_000)

    expect(world.question).toBe("Merge into main?")
    expect(world.detail).toBe("It is 3 of 3 in stack #40, so #1 below it merges along.")
    expect(seen.runs).toContain(
      "gh api --method PUT repos/acme/app/pulls/2/merge-async --hostname github.com -f merge_method=squash -f sha=head-2"
    )
    expect(seen.runs).toContain("gh api repos/acme/app/pulls/2/merge-async/u-1 --hostname github.com")
    expect(seen.runs.some((run) => run.startsWith("gh pr merge"))).toBe(false)
    expect(seen.toasts).toContain("#2 merged into main, with #1 below it")
    // Both show as merged where they were, until GitHub's search has caught up.
    expect(await ui.findAll({ type: "Text", text: "✓ Merged" })).toHaveLength(2)
  })

  test("a stacked merge GitHub could not make says why", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      stack: { number: 40, base: "main", pulls: [{ number: 2, title: "Add a legend", state: "open" }] },
      asyncMerge: [JSON.stringify({ status: "failed", details: { message: "Head branch was modified" } })]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const queries = (): number =>
      seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = queries()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    await clock.advance(10_000)

    expect(world.question).toBe("Merge into main?")
    expect(seen.toasts).toContain("#2: GitHub could not merge it: Head branch was modified")
    // The list refreshes, to show where the pull request stands now.
    expect(queries()).toBe(before + 1)
    expect(await ui.find({ key: "merge-2" })).toBeDefined()
  })

  test("a stacked merge still under way after a minute is GitHub's to finish, and the list shows it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      stack: { number: 40, base: "main", pulls: [{ number: 2, title: "Add a legend", state: "open" }] },
      asyncMerge: [JSON.stringify({ status: "pending", details: { uuid: "u-1" } })]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    await clock.advance(2 * MINUTE)

    // Looked at every 3 seconds until the minute is up, then left.
    expect(world.asyncLooks).toBe(19)
    expect(seen.toasts).toContain("#2: GitHub is merging it into main; the list shows it once done")
  })

  test("looks that are slow to answer still end the wait at a minute", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      stack: { number: 40, base: "main", pulls: [{ number: 2, title: "Add a legend", state: "open" }] },
      asyncMerge: [JSON.stringify({ status: "pending", details: { uuid: "u-1" } })],
      slowLookMs: 20_000
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    await clock.advance(65_000)

    // Each look takes 20 seconds after a 3-second pause: the third is cut off at the minute, and the alert comes then.
    expect(world.asyncLooks).toBe(3)
    expect(seen.toasts).toContain("#2: GitHub is merging it into main; the list shows it once done")
  })

  test("while the dialog asks one question, another press is not asked but told to answer it first", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 3, title: "Try the new tiles", isDraft: true },
        { number: 4, title: "Sort the legend", isDraft: true }
      ]
    }
    // The person takes a while to cancel the first question.
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel", slowDialogMs: 5_000 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // Two presses reach the plugin together, from a drawing that shows neither one's question yet.
    const ui = await mountPane($, "terminal")
    await Promise.all([ui.press({ key: "ready-3" }), ui.press({ key: "ready-4" })])
    await clock.settle()
    await clock.advance(5_000)

    expect(world.asked).toBe(1)
    expect(seen.toasts).toContain("Answer or cancel the open question first.")
    // The refused row has its buttons back, as does the cancelled one.
    expect(await ui.find({ key: "ready-3" })).toBeDefined()
    expect(await ui.find({ key: "ready-4" })).toBeDefined()
    expect(seen.runs.some((run) => run.startsWith("gh pr ready"))).toBe(false)
  })

  test("a question answered, the next press asks at once", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Try the new tiles", isDraft: true }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    world.answer = "Mark ready for review"
    await pressDrawn(clock, ui, "ready-3")
    await clock.settle()

    expect(world.asked).toBe(2)
    expect(world.header).toBe("Ready PR")
    expect(seen.toasts).not.toContain("Answer or cancel the open question first.")
    expect(seen.runs).toContain("gh pr ready 3 --repo github.com/acme/app")
  })

  test("Cancel merges nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.asked).toBe(1)
    expect(seen.runs.filter((run) => run.startsWith("gh pr merge"))).toEqual([])
    expect(await ui.find({ key: "merge-2" })).toBeDefined()
  })

  test("GitHub refusing says why, without gh's mark, reads the list again, and the button comes back", async ($, on) => {
    const clock = clockOf(on)
    const refusal = "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)"
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Create a merge commit",
      writeFailure: `X ${refusal}\n`
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const queries = (): number =>
      seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = queries()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(seen.toasts).toContain(`#2: ${refusal}`)
    expect(queries()).toBe(before + 1)
    expect(await ui.find({ key: "merge-2" })).toBeDefined()
  })

  test("a base branch with a merge queue takes the pull request into the queue, and the alert says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      hasMergeQueue: true
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(seen.toasts).toContain("#2 is in the merge queue for main")
    expect(seen.toasts).not.toContain("#2 merged into main")
  })

  test("a merged row says so where it was until GitHub's search has caught up, and counts no more", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: {
        mine: [
          { number: 1, title: "Fix the menu", ci: "FAILURE" },
          { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
          { number: 3, title: "Rename the fields" }
        ]
      },
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    const order = async () =>
      drawnNodes(await ui.drawn())
        .map((node) => node.props?.key)
        .filter((key) => typeof key === "string" && /^pr-\d+$/.test(key))

    expect(await ui.find({ key: "merge-2" })).toBeUndefined()
    expect((await ui.find({ type: "Text", text: "✓ Merged" }))?.props).toMatchObject({ color: "merged", bold: true })
    expect(await ui.find({ type: "Text", text: "into main" })).toBeDefined()
    // VS Code knows no merged colour: there it is the theme's terminal magenta.
    const editor = await mountPane($, "vscode")
    expect((await editor.find({ type: "Text", text: "✓ Merged" }))?.props.color).toBe("magenta")
    await editor.unmount()
    expect(await order()).toEqual(["pr-1", "pr-2", "pr-3"])
    expect(seen.statuses.at(-1)).toBe("PRs ❗ 1 Needs You\u00a0\u00a0(/prs)")
    // The search still lists it open, and a refresh in the meantime leaves it merged and out of the counts.
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(await ui.find({ type: "Text", text: /Ready To Merge/ })).toBeUndefined()
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeDefined()
    expect(seen.statuses.at(-1)).toBe("PRs ❗ 1 Needs You\u00a0\u00a0(/prs)")

    world.github = { mine: [world.github.mine![0]!, world.github.mine![2]!] }
    await clock.advance(15_000)
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeUndefined()
    expect(await order()).toEqual(["pr-1", "pr-3"])
  })

  test("a merge from the pane cleans up its /prs worktree once the search has caught up", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      pullWorktrees: [{ number: 2, branch: "feature/branch-2" }],
      closed: [{ number: 2, state: "MERGED", by: "me" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([])

    await clock.advance(15_000)
    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-2")
  })

  test("a merge from the pane is asked about once, by the refresh that sees its branch leave, for the cleanup too", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      pullWorktrees: [{ number: 2, branch: "feature/branch-2" }],
      closed: [{ number: 2, state: "MERGED", by: "me" }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    world.github = { ...READY, mine: READY.mine!.filter((pull) => pull.number !== 2) }
    await clock.advance(15_000)

    expect(seen.runs).toContain("git worktree remove /repo/.claude/worktrees/pr-2")
    expect(seen.runs.filter((run) => run.includes("CLOSED_EVENT"))).toHaveLength(1)
    expect(seen.toasts.filter((toast) => toast.includes("worktree"))).toEqual([
      "#2 merged: removed its worktree and the branch feature/branch-2"
    ])
  })

  test("what refreshes find while a cleanup runs adds up for its next run, which asks GitHub nothing again", async ($, on) => {
    const clock = clockOf(on)
    // The first cleanup's look at the worktrees takes half a minute, so what follows comes while it runs.
    let isListingSlow = true
    on("process.run", { init: { cwd: "/repo" } }, async (_, e, next) => {
      if (isListingSlow && lineOf(e.argv).startsWith("git worktree list")) {
        isListingSlow = false
        await clock.sleep(30_000)
      }

      return next(e)
    })
    const world: World = {
      github: { mine: [...READY.mine!, { number: 11, title: "Tidy the legend" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Squash and merge",
      pullWorktrees: [
        { number: 2, branch: "feature/branch-2" },
        { number: 11, branch: "feature/branch-11" }
      ],
      closed: [
        { number: 2, state: "MERGED", by: "me" },
        { number: 11, state: "MERGED", by: "ann" }
      ]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    // #2 merged from the pane, #11 on GitHub; a refresh finds both gone and asks how they ended.
    await ui.press({ key: "merge-2" })
    await clock.settle()
    world.github = { mine: [] }
    await pressDrawn(clock, ui, "refresh")
    await clock.settle()
    // The merged row settles, which asks for a cleanup too, while the first still runs.
    await clock.advance(15_000)
    await clock.advance(30_000)
    await settleAll(clock, seen)

    expect(seen.runs.filter((run) => run.includes("CLOSED_EVENT"))).toHaveLength(1)
    expect(seen.runs.filter((run) => run.startsWith("git worktree remove"))).toEqual([
      "git worktree remove /repo/.claude/worktrees/pr-2",
      "git worktree remove /repo/.claude/worktrees/pr-11"
    ])
  })

  test("a reload while a merged row waits keeps it merged until the search has caught up", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    // A reload replays the start, whose refresh the search still answers with the pull request open.
    await clock.advance(5_000)
    await startSession($)
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeDefined()
    expect(await ui.find({ key: "merge-2" })).toBeUndefined()
    expect(seen.statuses.at(-1)).toBe(undefined)

    world.github = {}
    await clock.advance(10_000)
    expect(await ui.find({ type: "Text", text: "✓ Merged" })).toBeUndefined()
  })

  test("two merged one after the other each stay where they were", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        { number: 1, title: "Fix the menu", ci: "FAILURE" },
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
        { number: 3, title: "Rename the fields", reviewDecision: "APPROVED" }
      ]
    }
    machine($, on, { github, branch: "main", uncommitted: 0, answer: "Squash and merge" })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const merged = async () => (await ui.findAll({ type: "Text", text: "✓ Merged" })).length

    // The second once the first is through, as one question is asked at a time.
    await ui.press({ key: "merge-2" })
    await settleUntil(clock, async () => (await merged()) === 1)
    await ui.press({ key: "merge-3" })
    await settleUntil(clock, async () => (await merged()) === 2)

    expect(
      drawnNodes(await ui.drawn())
        .map((node) => node.props?.key)
        .filter((key) => typeof key === "string" && /^pr-\d+$/.test(key))
    ).toEqual(["pr-1", "pr-2", "pr-3"])
    expect(await ui.findAll({ type: "Text", text: "✓ Merged" })).toHaveLength(2)
  })

  test("a compact view's merged row is one line, the status at its end", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()
    await pressDrawn(clock, ui, "view")

    const line = drawnNodes(await ui.find({ key: "pr-2" }))
    expect(hasText(line, "Add a legend")).toBe(true)
    expect(hasText(line, "✓ Merged")).toBe(true)
    expect(hasText(line, "into main")).toBe(false)
  })

  test("where no pane can be placed, a method picked in the engine's own dialog merges with it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: READY,
      branch: "main",
      uncommitted: 0,
      placesPanes: false,
      answer: "Squash and merge"
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.header).toBe("Merge PR")
    expect(world.question).toBe("#2 Add a legend — Merge into main?")
    expect(seen.runs).toContain("gh pr merge 2 --repo github.com/acme/app --squash --match-head-commit head-2")
  })

  test("where no pane can be placed, the engine's own dialog asks, and dismissing it merges nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, placesPanes: false, slowDialogMs: 5_000 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.advance(1_000)
    // The engine's dialog asks, so a drawing of the pane keeps the list.
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    await clock.advance(5_000)

    expect(world.asked).toBe(1)
    expect(seen.runs.filter((run) => run.startsWith("gh pr merge"))).toEqual([])
    expect(await ui.find({ key: "merge-2" })).toBeDefined()
  })

  test("Auto-Merge turns auto-merge on while approved checks run", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      merging: { autoMerge: true },
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", ci: "PENDING" }]
    }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Create a merge commit",
      // In a stack, which auto-merge has nothing to do with.
      stack: { number: 40, base: "main", pulls: [{ number: 2, title: "Add a legend", state: "open" }] }
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "autoMerge-2" })
    await clock.settle()

    expect(seen.runs).toContain("gh pr merge 2 --repo github.com/acme/app --merge --match-head-commit head-2 --auto")
    expect(seen.toasts).toContain("#2 merges into main once nothing holds it back")
    // Auto-merge is gh's own; GitHub's asynchronous merge has none, so no stack is looked up for it.
    expect(seen.runs.some((run) => run.startsWith("gh api repos/acme/app/stacks/"))).toBe(false)
  })

  test("Update Branch brings the base in the way chosen", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Rebase onto main" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "updateBranch-2" })
    await clock.settle()

    expect(seen.runs).toContain("gh pr update-branch 2 --repo github.com/acme/app --rebase")
    expect(seen.toasts).toContain("#2 updated with the latest main")
  })

  test("Update Branch on a branch with nothing to bring in says so", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Merge main in", isUpToDate: true }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "updateBranch-2" })
    await clock.settle()

    expect(seen.toasts).toContain("#2 was already up to date with main")
  })

  test("Re-Run CI re-runs the failed GitHub Actions runs it named", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Re-run failed jobs",
      suites: [{ conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()

    expect(seen.runs).toContain("gh run rerun 11 --failed --repo github.com/acme/app")
    expect(seen.toasts).toContain("#1: re-running the failed jobs")
  })

  test("Cancel re-runs nothing and updates nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: {
        mine: [
          { number: 1, title: "Fix the menu", ci: "FAILURE" },
          { number: 2, title: "Add a legend", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }
        ]
      },
      branch: "main",
      uncommitted: 0,
      answer: "Cancel",
      suites: [{ conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()
    await pressDrawn(clock, ui, "updateBranch-2")
    await clock.settle()

    expect(world.asked).toBe(2)
    expect(seen.runs.filter((run) => /^gh (run rerun|pr update-branch)/.test(run))).toEqual([])
  })

  test("one run refusing leaves the others to go", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Re-run failed jobs",
      suites: [
        { conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } },
        { conclusion: "FAILURE", workflowRun: { databaseId: 12, workflow: { name: "E2E" } } }
      ],
      refusedReruns: [11]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()

    expect(seen.runs).toContain("gh run rerun 12 --failed --repo github.com/acme/app")
    expect(seen.toasts).toContain("#1: re-ran 1 of 2 runs; run 11 cannot be rerun; it is already running")
  })

  test("Merge words its stack place as GitHub has it at the press, not as the list read it", async ($, on) => {
    const clock = clockOf(on)
    // The list read #2 as 2 of 3 in stack #30; since then it moved to stack #41, on top of #9.
    const github: ResponseFixture = {
      mine: [
        { number: 2, title: "Add a legend", reviewDecision: "APPROVED", stack: { number: 30, position: 2, size: 3 } }
      ]
    }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Cancel",
      stack: {
        number: 41,
        base: "main",
        pulls: [
          { number: 9, title: "Lay the groundwork", state: "open" },
          { number: 2, title: "Add a legend", state: "open" }
        ]
      }
    }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "merge-2" })
    await clock.settle()
    expect(world.detail).toBe("It is 2 of 2 in stack #41, so #9 below it merges along.")

    // Left the stack since: nothing about one.
    world.stack = undefined
    await ui.press({ key: "merge-2" })
    await clock.settle()
    expect(world.detail).toBe(undefined)
  })

  test("Re-Request Review asks, then asks the reviewers again on GitHub and refreshes the list", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        {
          number: 4,
          title: "Cache the tiles",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Re-request review" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const queries = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    const before = queries()

    const ui = await mountPane($, "terminal")
    expect((await ui.find({ key: "rerequest-4" }))?.props).toMatchObject({
      label: "Re-Request Review",
      variant: "primary"
    })
    await ui.press({ key: "rerequest-4" })
    await clock.settle()

    expect(world.header).toBe("Re-Request")
    expect(world.question).toBe("Ask ann to review it again?")
    expect(seen.runs).toContain(
      "gh api --method POST repos/acme/app/pulls/4/requested_reviewers --hostname github.com -f reviewers[]=ann"
    )
    expect(seen.toasts).toContain("#4: review re-requested from ann")
    expect(queries()).toBe(before + 1)
  })

  test("a review re-requested on GitHub since the list was read asks nothing, and the list refreshes", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        {
          number: 4,
          title: "Cache the tiles",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Re-request review" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const queries = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    const before = queries()

    world.current = { 4: { requested: ["ann"] } }
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerequest-4" })
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
    expect(seen.toasts).toContain("#4 had its review re-requested meanwhile; refreshing the list")
    expect(queries()).toBe(before + 1)
  })

  test("GitHub refusing to ask someone says why, and the button stays", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        {
          number: 4,
          title: "Cache the tiles",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Re-request review",
      writeFailure: "gh: Reviews may only be requested from collaborators. (HTTP 422)"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerequest-4" })
    await clock.settle()

    expect(seen.toasts).toContain("#4: gh: Reviews may only be requested from collaborators. (HTTP 422)")
    expect(await ui.find({ key: "rerequest-4" })).toBeDefined()
  })

  test("Cancel asks no one again", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      mine: [
        {
          number: 4,
          title: "Cache the tiles",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerequest-4" })
    await clock.settle()

    expect(world.asked).toBe(1)
    expect(seen.runs.some((run) => run.includes("requested_reviewers"))).toBe(false)
    expect(await ui.find({ key: "rerequest-4" })).toBeDefined()
  })

  test("Ready For Review asks, then marks the draft ready and refreshes the list", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 3, title: "Try the new tiles", isDraft: true }] }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Mark ready for review" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const queries = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    const before = queries()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "ready-3" })
    await clock.settle()

    expect(world.subject).toBe("#3 Try the new tiles")
    expect(world.question).toBe("Mark it ready for review?")
    expect(world.choices).toEqual(["Mark ready for review", "Cancel"])
    expect(seen.runs).toContain("gh pr ready 3 --repo github.com/acme/app")
    expect(seen.toasts).toContain("#3 is ready for review")
    expect(queries()).toBe(before + 1)
  })

  test("Cancel leaves the draft a draft", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 3, title: "Try the new tiles", isDraft: true }] }
    const seen = machine($, on, { github, branch: "main", uncommitted: 0, answer: "Cancel" })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "ready-3" })
    await clock.settle()

    expect(seen.runs.some((run) => run.startsWith("gh pr ready"))).toBe(false)
    expect(seen.toasts).toEqual([])
    expect(await ui.find({ key: "ready-3" })).toBeDefined()
  })

  test("GitHub refusing to mark a draft ready says why, and the button comes back", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 3, title: "Try the new tiles", isDraft: true }] }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Mark ready for review",
      writeFailure: "GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "ready-3" })
    await clock.settle()

    expect(seen.toasts).toEqual(["#3: GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)"])
    expect(await ui.find({ key: "ready-3" })).toBeDefined()
  })

  test("while Ready For Review waits for an answer and then works, the row says so in place of its buttons", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 3, title: "Try the new tiles", isDraft: true }] }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Mark ready for review",
      slowDialogMs: 5_000
    }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    // gh is slow to mark it ready, so the row is caught while it works. While the person answers, the question takes
    // the list's place.
    world.slowWriteMs = 5_000
    await ui.press({ key: "ready-3" })
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "Mark it ready for review?" })).toBeDefined()
    expect(await ui.find({ key: "ready-3" })).toBeUndefined()

    await clock.advance(5_000)
    expect(await ui.find({ type: "Text", text: "Marking It Ready…" })).toBeDefined()
    expect(await ui.find({ key: "ready-3" })).toBeUndefined()
    expect(world.header).toBe("Ready PR")
    await clock.advance(5_000)
  })

  test("two presses before the row is drawn again ask once", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 3, title: "Try the new tiles", isDraft: true }] }
    const world: World = {
      github,
      branch: "main",
      uncommitted: 0,
      answer: "Mark ready for review",
      slowDialogMs: 5_000
    }
    const seen = machine($, on, world, clock)
    // The button's own handler runs twice at once for one press, as for two presses that reach the plugin together.
    on("ui.press", async ($, e, next) => {
      const [first] = await Promise.all([next(e), next(e)])
      return first
    })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "ready-3" })
    await clock.settle()
    await clock.advance(10_000)

    expect(world.asked).toBe(1)
    expect(seen.runs.filter((run) => run.startsWith("gh pr ready"))).toEqual([
      "gh pr ready 3 --repo github.com/acme/app"
    ])
  })

  test("the refresh after a merge waits out one already under way, so the row shows the merge", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: READY, branch: "main", uncommitted: 0, answer: "Squash and merge" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // A timer's load asks GitHub before the merge and answers after it.
    world.slowGithubMs = 20_000
    await clock.advance(3 * MINUTE)
    const ui = await mountPane($, "terminal")
    world.github = {}
    await ui.press({ key: "merge-2" })
    await clock.advance(20_000)
    await clock.advance(20_000)

    expect(seen.runs).toContain("gh pr merge 2 --repo github.com/acme/app --squash --match-head-commit head-2")
    expect(await ui.find({ key: "merge-2" })).toBeUndefined()
    expect(await ui.find({ type: "Text", text: /Ready To Merge/ })).toBeUndefined()
    await clock.advance(60_000)
    expect(await ui.find({ type: "Text", text: "Nothing open and nothing waiting on you." })).toBeDefined()
  })

  test("new commits since the list was refreshed: nothing is re-run, the list refreshes", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Re-run failed jobs",
      suites: [{ conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } }],
      runsHeadOid: "pushed-since"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.runs.filter((run) => run.startsWith("gh run rerun"))).toEqual([])
    expect(seen.toasts).toContain("#1: new commits arrived since the list was refreshed; refreshing it")
  })

  test("checks from another service cannot be re-run, and nothing is asked", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Re-run failed jobs",
      suites: [{ conclusion: "FAILURE", workflowRun: null }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.runs.filter((run) => run.startsWith("gh run rerun"))).toEqual([])
    expect(seen.toasts).toContain(
      "#1: the failed checks are not GitHub Actions runs, so they can't be re-run from here."
    )
  })

  test("runs already going again, or passed since, are said so, nothing asked, and the list read again", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: { mine: [{ number: 1, title: "Fix the menu", ci: "FAILURE" }] },
      branch: "main",
      uncommitted: 0,
      answer: "Re-run failed jobs",
      suites: [{ conclusion: null, workflowRun: { databaseId: 11, workflow: { name: "CI" } } }]
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const queries = (): number =>
      seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine")).length
    const before = queries()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "rerun-1" })
    await clock.settle()

    expect(world.asked).toBe(undefined)
    expect(seen.runs.filter((run) => run.startsWith("gh run rerun"))).toEqual([])
    expect(seen.toasts).toContain("#1: none of its GitHub Actions runs is failing now")
    expect(queries()).toBe(before + 1)
  })
})

describe("a row's press after a reload, before any refresh", () => {
  const github: ResponseFixture = {
    mine: [
      { number: 1, title: "Fix the menu", ci: "FAILURE" },
      { number: 2, title: "Add a legend", reviewDecision: "APPROVED" },
      { number: 3, title: "Try the new tiles", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" },
      {
        number: 4,
        title: "Cache the tiles",
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
      },
      { number: 5, title: "Try the new colours", isDraft: true }
    ]
  }
  const isQuestionAsked = (world: World) => world.asked === 1

  // Each asks GitHub how the pull request stands, then asks the person; Re-Run CI looks up the failed runs first.
  for (const [key, isAsked] of [
    ["merge-2", isQuestionAsked],
    ["updateBranch-3", isQuestionAsked],
    ["rerequest-4", isQuestionAsked],
    ["ready-5", isQuestionAsked],
    ["fixCi-1", isQuestionAsked],
    ["rerun-1", (_: World, runs: string[]) => runs.some((run) => run.includes("checkSuites"))]
  ] as const) {
    test(`${key} still acts, finding the repository itself`, { options: { refresh: "on-demand" } }, async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
      const seen = machine($, on, world, clock)
      keptOverReload(on, { snapshot: keptList(github), checkout: { branch: "main", head: "local-1", at: 0 } })
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      expect(await ui.find({ key })).toBeDefined()

      await ui.press({ key })
      await settleAll(clock, seen)

      expect(isAsked(world, seen.runs)).toBe(true)
    })
  }

  test(
    "a list of the folder's repository named in other letter cases is the same one, and the press asks as usual",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel", repoName: "Acme/App" }
      const seen = machine($, on, world, clock)
      keptOverReload(on, { snapshot: keptList(github), checkout: { branch: "main", head: "local-1", at: 0 } })
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await ui.press({ key: "merge-2" })
      await settleAll(clock, seen)

      expect(world.asked).toBe(1)
      expect(seen.toasts.filter((toast) => toast.includes("reading it again"))).toEqual([])
    }
  )

  test(
    "a list kept from another repository than the folder's now asks nothing, says so, and reads the list again",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github, branch: "main", uncommitted: 0, answer: "Squash and merge", repoName: "acme/lib" }
      const seen = machine($, on, world, clock)
      keptOverReload(on, { snapshot: keptList(github), checkout: { branch: "main", head: "local-1", at: 0 } })
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await ui.press({ key: "merge-2" })
      await settleAll(clock, seen)

      expect(world.asked).toBe(undefined)
      expect(seen.runs.filter((run) => run.startsWith("gh pr merge"))).toEqual([])
      expect(seen.toasts).toContain(
        "#2: the list is of acme/app, and this session is in acme/lib now; reading it again"
      )
      expect(seen.runs.some((run) => run.startsWith("gh api graphql") && run.includes("repo:acme/lib"))).toBe(true)
    }
  )

  test(
    "Review on one merged meanwhile says so, as the others do",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const reviewing: ResponseFixture = { requested: [{ number: 8, title: "Usage chart", author: "ann" }] }
      const clock = clockOf(on)
      const world: World = { github: reviewing, branch: "main", uncommitted: 0, answer: "Cancel" }
      const seen = machine($, on, world, clock)
      keptOverReload(on, { snapshot: keptList(reviewing), checkout: { branch: "main", head: "local-1", at: 0 } })
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      world.current = { 8: { state: "merged" } }

      await ui.press({ key: "review-8" })
      await settleAll(clock, seen)

      expect(world.asked).toBeUndefined()
      expect(seen.toasts).toHaveLength(1)
    }
  )

  test(
    "a press while the repository is looked up shows the row checking, in place of its buttons",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel", slowRepoViewMs: 20_000 }
      const seen = machine($, on, world, clock)
      keptOverReload(on, { snapshot: keptList(github), checkout: { branch: "main", head: "local-1", at: 0 } })
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await ui.press({ key: "merge-2" })
      await clock.advance(1_000)
      expect(await ui.find({ key: "merge-2" })).toBeUndefined()
      await clock.advance(30_000)
      await settleAll(clock, seen)

      expect(seen.runs.filter((run) => run.startsWith("gh repo view"))).toHaveLength(1)
      expect(world.asked).toBe(1)
    }
  )

  test("where the repository can't be found, says why", { options: { refresh: "on-demand" } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    keptOverReload(on, { snapshot: keptList(github), checkout: { branch: "main", head: "local-1", at: 0 } })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.repoViewFailure = "error connecting to api.github.com"

    await ui.press({ key: "merge-2" })
    await settleAll(clock, seen)

    expect(seen.toasts).toEqual(["Could not reach GitHub."])
    expect(world.asked).toBeUndefined()
  })
})

describe("a row's press where gh went signed out since the list loaded", () => {
  test("says so, and asks nothing", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.isSignedOut = true

    await ui.press({ key: "merge-2" })
    await settleAll(clock, seen)

    expect(seen.toasts).toEqual(["The GitHub CLI is not signed in. Run: gh auth login"])
    expect(world.asked).toBeUndefined()
  })
})
