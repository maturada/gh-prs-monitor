// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine, MockClock, Mounted } from "claude-code/testing"

import {
  clockOf,
  keptList,
  keptOverReload,
  machine,
  MINUTE,
  mountPane,
  runPrs,
  settleAll,
  settleUntil,
  skillTurnEnd,
  skillTurnStart,
  startSession,
  GITHUB
} from "./testing/world"
import { GH_MISSING } from "./gh"
import { QUERY_VERSION } from "./shared"
import { sharedAnswer } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import type { Seen, World } from "./testing/world"

// A session on `branch`, its list read from `github`, and the pane drawn in the terminal.
async function paneOn(
  $: Engine,
  on: On,
  branch: string,
  extra: Partial<World> = {}
): Promise<{ world: World; seen: Seen; clock: MockClock; ui: Mounted<"terminal", "Pane"> }> {
  const clock = clockOf(on)
  const world: World = { github: GITHUB, branch, uncommitted: 0, ...extra }
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  const ui = await mountPane($, "terminal")

  return { world, seen, clock, ui }
}

const CREATE = { key: "create-pr" }

// The list, the checkout on feature/export and GitHub's answer that none came from it, as kept over a reload.
function keptOnExport(): { snapshot: unknown; checkout: unknown; branchPulls: unknown } {
  return {
    snapshot: keptList(GITHUB),
    checkout: { branch: "feature/export", head: "local-1", at: 0 },
    branchPulls: { repo: "acme/app", branch: "feature/export", head: "local-1", isTaken: false, endedHead: null }
  }
}

describe("Create PR in the pane", () => {
  test("a branch with no pull request is offered one, beside the title of your own", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/export")

    const button = await ui.find(CREATE)
    expect(button?.type).toBe("Button")
    expect(button?.props.label).toBe("Create PR")
  })

  test("none on the default branch", async ($, on) => {
    const { ui } = await paneOn($, on, "main")

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("none on a branch with its pull request", async ($, on) => {
    const { ui } = await paneOn($, on, "fix/menu")

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("none on a branch /prs checked a pull request out as", async ($, on) => {
    const { ui } = await paneOn($, on, "pr-7")

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("none in a repository the account can only read, as the branch could not go there", async ($, on) => {
    const github: ResponseFixture = { ...GITHUB, merging: { permission: "READ" } }
    const { ui } = await paneOn($, on, "feature/export", { github })

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("with no pull requests at all, the lists still show, for Create PR in your own", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/export", { github: {} })

    expect(await ui.find({ type: "Text", text: "Your Pull Requests" })).toBeDefined()
    expect(await ui.find(CREATE)).toBeDefined()
  })
})

describe("pressing Create PR", () => {
  test("asks where, naming the branch and the branch it goes into; This session runs the skill here", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "This session" })

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(world.header).toBe("Create PR")
    expect(world.subject).toBe("feature/export → main")
    expect(world.question).toBe("Where should it be created?")
    expect(world.choices).toEqual(["This session", "New session", "Cancel"])
    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export"'])
  })

  test("instructions typed with the answer go to the skill", async ($, on) => {
    const { seen, clock, ui } = await paneOn($, on, "feature/export", {
      answer: "This session",
      instructions: "as a draft,\n  into develop"
    })

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export" -- as a draft, into develop'])
  })

  test("New session from the terminal opens one in this folder, with the branch", async ($, on) => {
    const { seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "New session" })

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.toasts.length > 0)

    const typed = '/gh-prs-monitor:create-pr --branch "feature/export"'
    expect(seen.runs).toContain(`open claude-cli://open?cwd=%2Frepo&q=${encodeURIComponent(typed)}`)
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual(["Create PR: its command is typed into a new session; send it there"])
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("New session from the desktop app names the folder too, as the app may open it at the repository's root", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "feature/export",
      uncommitted: 0,
      surfaces: ["desktop"],
      answer: "New session"
    }
    const seen = machine($, on, world, clock)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "desktop")
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.runs.some((run) => run.startsWith("open ")))

    const typed = '/gh-prs-monitor:create-pr --branch "feature/export" --worktree "/repo"'
    expect(seen.runs).toContain(`open claude://code/new?folder=%2Frepo&q=${encodeURIComponent(typed)}`)
  })

  test("New session from VS Code names the folder too, as its editor opens the tab at the window's folder", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "feature/export",
      uncommitted: 0,
      surfaces: ["vscode"],
      editor: { scheme: "cursor" },
      answer: "New session"
    }
    const seen = machine($, on, world, clock)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "vscode")
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.runs.some((run) => run.startsWith("open ")))

    const typed = '/gh-prs-monitor:create-pr --branch "feature/export" --worktree "/repo"'
    expect(seen.runs).toContain(`open cursor://anthropic.claude-code/open?prompt=${encodeURIComponent(typed)}`)
  })

  test("New session from VS Code whose link won't open creates it in this session instead", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "feature/export",
      uncommitted: 0,
      surfaces: ["vscode"],
      answer: "New session",
      openFailure: "LSOpenURLsWithRole() failed with error -10814"
    }
    const seen = machine($, on, world, clock)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "vscode")
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    const typed = '/gh-prs-monitor:create-pr --branch "feature/export" --worktree "/repo"'
    expect(seen.runs).toContain(`open vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(typed)}`)
    // This session works in this folder already, so its command names none.
    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export"'])
    expect(seen.toasts).toEqual([
      "Create PR: no new session opened (LSOpenURLsWithRole() failed with error -10814), so it runs in this one"
    ])
  })

  test("where no new session can be opened, it starts here without asking", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "feature/export", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "mobile")
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(world.asked).toBeUndefined()
    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export"'])
  })

  test("Cancel runs nothing and leaves the button", async ($, on) => {
    const { seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "Cancel" })

    await ui.press(CREATE)
    await settleAll(clock, seen)

    expect(seen.commands).toEqual([])
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("while the skill's turn runs, the button says so in its place; the turn's end gives it back", async ($, on) => {
    const { seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "This session" })

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(await ui.find({ type: "Text", text: "Creating PR…" })).toBeDefined()
    expect(await ui.find(CREATE)).toBeUndefined()
    await $.turn.start(skillTurnStart("create"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Creating PR…" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("create"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Creating PR…" })).toBeUndefined()
    expect(await ui.find(CREATE)).toBeDefined()
    expect(seen.commands).toHaveLength(1)
  })

  test("pressed while a turn runs, the button says it starts when that turn ends, then that it is at work", async ($, on) => {
    const { seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "This session", slowCommandMs: 5_000 })
    await $.turn.start(skillTurnStart("busy"))

    await ui.press(CREATE)
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "Create PR Starts When This Turn Ends" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("busy"))
    await clock.advance(5_000)
    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export"'])
    await $.turn.start(skillTurnStart("create"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Creating PR…" })).toBeDefined()
  })

  test("while a press checks the branch, and then starts the skill, the button says so", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/export", {
      answer: "This session",
      slowCommandMs: 5_000
    })
    // A commit since the list was drawn: the press asks GitHub about it first.
    world.head = "new-work"
    world.slowBranchPullsMs = 5_000
    const isShowing = (text: string) => async () => (await ui.find({ type: "Text", text })) !== undefined
    await ui.press(CREATE)
    await clock.advance(1_000)
    await settleUntil(clock, isShowing("Checking The Branch…"))
    expect(await ui.find({ type: "Text", text: "Checking The Branch…" })).toBeDefined()

    await clock.advance(5_000)
    await settleUntil(clock, isShowing("Starting Create PR…"))
    expect(await ui.find({ type: "Text", text: "Starting Create PR…" })).toBeDefined()
    await clock.advance(5_000)
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/export"'])
  })

  test("typed, the skill marks the button too", async ($, on) => {
    const { clock, ui } = await paneOn($, on, "feature/export")

    await $.command.run({ command: "gh-prs-monitor:create-pr", args: "" } as Parameters<Engine["command"]["run"]>[0])
    await $.turn.start(skillTurnStart("typed"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Creating PR…" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("typed"))
    await clock.settle()
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("a branch switched since the list was drawn asks nothing, says why, and the button goes", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "This session" })

    world.branch = "main"
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.toasts.length > 0)

    expect(world.asked).toBeUndefined()
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual([
      "No pull request to open from this session's branch now: it changed, or one is open for it."
    ])
    expect(await ui.find(CREATE)).toBeUndefined()
  })
})

describe("a branch whose pull request ended", () => {
  // The checkout on #1's branch, at a commit the list never saw (as pushed last, just before the merge), then the list
  // read again once #1 has left it, merged at that commit.
  async function afterItEnded($: Engine, on: On) {
    const opened = await paneOn($, on, "fix/menu", {
      head: "final-push",
      closed: [{ number: 1, state: "MERGED", by: null, head: "final-push" }]
    })
    expect(await opened.ui.find(CREATE)).toBeUndefined()

    opened.world.github = { ...GITHUB, mine: GITHUB.mine?.filter((pull) => pull.number !== 1) }
    await opened.ui.press({ key: "refresh" })
    await opened.clock.settle()
    expect(await opened.ui.find({ key: "pr-1" })).toBeUndefined()

    return opened
  }

  test("is not offered Create PR once its pull request leaves your list, merged or closed", async ($, on) => {
    const { ui } = await afterItEnded($, on)

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("is offered it again once new commits come on the branch", async ($, on) => {
    const { world, clock, ui } = await afterItEnded($, on)

    world.head = "new-work"
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("a press with a new commit on it, while GitHub can't be asked, goes on, as the skill looks again", async ($, on) => {
    const { world, seen, clock, ui } = await afterItEnded($, on)
    world.head = "new-work"
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    world.isBranchPullsFailing = true
    world.answer = "This session"

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "fix/menu"'])
  })

  test("is offered it at once where a commit made before the list saw it leave is beyond where it ended", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "fix/menu", {
      head: "local-commit",
      closed: [{ number: 1, state: "MERGED", by: null, head: "head-1" }],
      branchPulls: [{ number: 1, state: "MERGED", head: "head-1" }]
    })

    world.github = { ...GITHUB, mine: GITHUB.mine?.filter((pull) => pull.number !== 1) }
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)

    expect(await ui.find(CREATE)).toBeDefined()
  })

  for (const alertClosed of [true, false]) {
    test(
      `ended while the session was on another branch, at a commit pushed after the list last read it, is not offered it there, GitHub asked once${alertClosed ? "" : ", with the alert off too"}`,
      { options: { alertClosed } },
      async ($, on) => {
        const { world, seen, clock, ui } = await paneOn($, on, "main", {
          closed: [{ number: 1, state: "MERGED", by: "ann", head: "final-push" }]
        })
        world.github = { ...GITHUB, mine: GITHUB.mine?.filter((pull) => pull.number !== 1) }
        await ui.press({ key: "refresh" })
        await settleAll(clock, seen)

        world.branch = "fix/menu"
        world.head = "final-push"
        await ui.press({ key: "refresh" })
        await settleAll(clock, seen)

        expect(await ui.find(CREATE)).toBeUndefined()
        // GitHub is asked once about the branch at that commit, for the note on a merged branch, and not again.
        await ui.press({ key: "refresh" })
        await settleAll(clock, seen)
        expect(await ui.find(CREATE)).toBeUndefined()
        expect(seen.runs.filter((run) => run.includes("pullRequests(headRefName"))).toHaveLength(1)
      }
    )
  }
})

describe("a branch whose pull request opened and ended while nothing was drawn", () => {
  test("is not offered Create PR when the pane comes back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "feature/new",
      uncommitted: 0,
      closed: [{ number: 9, state: "MERGED", by: null, head: "local-head" }]
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    // The window gone, a typed skill's turns go on loading the list, which nothing draws.
    world.surfaces = []
    await $.command.run({ command: "gh-prs-monitor:review", args: "https://github.com/acme/app/pull/7" } as Parameters<
      Engine["command"]["run"]
    >[0])
    world.github = { ...GITHUB, mine: [...GITHUB.mine!, { number: 9, title: "New work", headRefName: "feature/new" }] }
    await clock.advance(MINUTE)
    await $.turn.complete(skillTurnEnd("one"))
    await clock.settle()
    world.github = GITHUB
    await clock.advance(MINUTE)
    await $.turn.complete(skillTurnEnd("two"))
    await clock.settle()
    expect(seen.runs.filter((run) => run.startsWith("gh api graphql") && run.includes("$mine"))).toHaveLength(3)

    world.surfaces = ["terminal"]
    const ui = await mountPane($, "terminal")
    expect(await ui.find(CREATE)).toBeUndefined()
  })
})

describe("a branch whose pull request ended before the lists looked", () => {
  const LOOKUPS = (seen: Seen) => seen.runs.filter((run) => run.includes("pullRequests(headRefName"))

  test("is not offered Create PR where nothing new came on it since", async ($, on) => {
    const { ui, seen } = await paneOn($, on, "feature/old", {
      head: "abc",
      branchPulls: [{ state: "MERGED", head: "abc" }]
    })

    expect(await ui.find(CREATE)).toBeUndefined()
    expect(LOOKUPS(seen)).toHaveLength(1)
    expect(LOOKUPS(seen)[0]).toContain("branch=feature/old")
  })

  test("nor where it is behind that pull request's last commit, as after merging commits pushed elsewhere", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/old", {
      head: "older",
      branchPulls: [{ state: "CLOSED", head: "abc" }],
      laterCommits: ["older..abc"]
    })

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("nor where one is open from it that the lists don't show, as a colleague's", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/shared", { branchPulls: [{ state: "OPEN" }] })

    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("is offered it once new commits came on it since", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/old", {
      head: "new-work",
      branchPulls: [{ state: "MERGED", head: "abc" }]
    })
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("nor where it merged at a commit this clone never fetched, as GitHub's Update branch made, holding this one", async ($, on) => {
    const { ui, seen } = await paneOn($, on, "feature/old", {
      head: "pushed",
      branchPulls: [{ number: 3, state: "MERGED", head: "updated" }],
      missingCommits: ["updated"],
      associated: { pushed: [{ number: 3, state: "MERGED" }] }
    })

    expect(await ui.find(CREATE)).toBeUndefined()
    expect(seen.runs.filter((run) => run.includes("/compare/"))).toEqual([])
  })

  test("but a branch name used again, reset to the squash its last one merged as, is offered, though this clone lacks where that one ended", async ($, on) => {
    const { ui } = await paneOn($, on, "wip/notes", {
      head: "squashed",
      branchPulls: [{ number: 3, state: "MERGED", head: "updated" }],
      missingCommits: ["updated"],
      associated: { squashed: [{ number: 3, state: "MERGED", mergeCommit: "squashed" }] }
    })

    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("but where it merged at a commit this clone lacks, holding none of this branch's, it is offered", async ($, on) => {
    const { ui, seen } = await paneOn($, on, "feature/old", {
      head: "local-commit",
      branchPulls: [{ number: 3, state: "MERGED", head: "updated" }],
      missingCommits: ["updated"],
      associated: { "local-commit": [{ number: 2, state: "MERGED" }] }
    })

    expect(await ui.find(CREATE)).toBeDefined()
    expect(seen.runs.filter((run) => run.includes("/compare/"))).toEqual([])
  })

  test("nor where it was closed at a commit this clone lacks, which GitHub compares and finds this one before", async ($, on) => {
    const { ui, seen } = await paneOn($, on, "feature/old", {
      head: "pushed",
      branchPulls: [{ number: 3, state: "CLOSED", head: "updated" }],
      missingCommits: ["updated"],
      laterCommits: ["pushed..updated"]
    })

    expect(await ui.find(CREATE)).toBeUndefined()
    expect(seen.runs.filter((run) => run.includes("/compare/"))).toEqual([
      "gh api repos/acme/app/compare/pushed...updated --hostname github.com --jq .status"
    ])
  })

  test("but where GitHub doesn't have this branch's commit, as one never pushed, it is offered", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/old", {
      head: "local-commit",
      branchPulls: [{ number: 3, state: "CLOSED", head: "updated" }],
      missingCommits: ["updated"],
      unpushedCommits: ["local-commit"]
    })

    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("and where GitHub can't compare them, the button waits, and the next refresh asks again", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", {
      head: "local-commit",
      branchPulls: [{ number: 3, state: "CLOSED", head: "updated" }],
      missingCommits: ["updated"],
      unpushedCommits: ["local-commit"],
      isCompareFailing: true
    })
    expect(await ui.find(CREATE)).toBeUndefined()
    expect(seen.debug).toContain(
      "The pull requests from feature/old could not be looked up: gh: Server Error (HTTP 500)"
    )
    // gh ran and GitHub answered with an error, so nothing asks whether gh starts at all.
    expect(seen.runs.filter((run) => run.startsWith("gh --version"))).toEqual([])

    world.isCompareFailing = false
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("a fork's of the same name is another branch's", async ($, on) => {
    const { ui } = await paneOn($, on, "feature/export", { branchPulls: [{ state: "OPEN", isFork: true }] })

    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("where GitHub can't be asked, the button waits, and the next refresh asks again", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", { isBranchPullsFailing: true })
    expect(await ui.find(CREATE)).toBeUndefined()

    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(LOOKUPS(seen)).toHaveLength(2)
    expect(await ui.find(CREATE)).toBeUndefined()

    world.isBranchPullsFailing = false
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    expect(LOOKUPS(seen)).toHaveLength(3)
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("a press while GitHub can't be asked goes on, as the skill looks again before it opens one", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", { answer: "This session" })
    world.isBranchPullsFailing = true
    world.head = "new-work"

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.commands).toEqual(['/gh-prs-monitor:create-pr --branch "feature/old"'])
  })

  test("a press and a refresh asking about the same commit share one lookup", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", { answer: "Cancel" })
    world.head = "new-work"
    world.slowGithubMs = 5_000
    world.slowBranchPullsMs = 5_000
    // The press comes while the refresh still reads the list: both then ask about the new commit.
    await ui.press({ key: "refresh" })
    await clock.advance(1_000)
    await ui.press(CREATE)
    await clock.advance(10_000)
    await settleAll(clock, seen)

    expect(LOOKUPS(seen)).toHaveLength(2)
    expect(world.asked).toBe(1)
  })

  test("a lookup under way as the branch's pull request ends is not taken for an answer about where it ended", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", { head: "local-commit" })
    // A lookup about a new commit, slow to answer, before any pull request came from the branch.
    world.head = "new-work"
    world.slowBranchPullsMs = 10_000
    await ui.press({ key: "refresh" })
    await clock.advance(1_000)
    // One opens from the branch and closes at a commit before this one while that lookup runs.
    world.github = {
      ...GITHUB,
      mine: [...GITHUB.mine!, { number: 4, headRefName: "feature/old", headRefOid: "older" }]
    }
    await ui.press({ key: "refresh" })
    await clock.advance(1_000)
    world.github = GITHUB
    world.closed = [{ number: 4, state: "CLOSED", by: "me", head: "older" }]
    world.branchPulls = [{ number: 4, state: "CLOSED", head: "older" }]
    await ui.press({ key: "refresh" })
    await clock.advance(20_000)
    await settleAll(clock, seen)

    expect(LOOKUPS(seen)).toHaveLength(3)
    expect(await ui.find(CREATE)).toBeDefined()
  })

  test("a press asks GitHub again where it said there was none, as one may have opened and ended since unlisted", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", { answer: "This session" })
    expect(await ui.find(CREATE)).toBeDefined()

    // Opened and merged at this commit between two refreshes, so no list showed it.
    world.branchPulls = [{ state: "MERGED", head: "local-head" }]
    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.toasts.length > 0)

    expect(LOOKUPS(seen)).toHaveLength(2)
    expect(world.asked).toBeUndefined()
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual([
      "No pull request to open from this session's branch now: it changed, or one is open for it."
    ])
    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("what GitHub said of a commit before the branch's pull request opened and ended elsewhere is asked again", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "fix/export", { head: "pushed" })
    expect(await ui.find(CREATE)).toBeDefined()

    // A pull request opens from the branch, and the session moves to main.
    world.github = {
      ...GITHUB,
      mine: [...GITHUB.mine!, { number: 3, headRefName: "fix/export", headRefOid: "updated" }]
    }
    world.branch = "main"
    world.head = "main-head"
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)
    // It merges at a commit GitHub's Update branch made, which this clone never fetched.
    world.github = GITHUB
    world.closed = [{ number: 3, state: "MERGED", by: "ann", head: "updated" }]
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)

    world.branch = "fix/export"
    world.head = "pushed"
    world.branchPulls = [{ number: 3, state: "MERGED", head: "updated" }]
    world.missingCommits = ["updated"]
    world.associated = { pushed: [{ number: 3, state: "MERGED" }] }
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)

    expect(LOOKUPS(seen)).toHaveLength(2)
    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("a press while a load writes the list keeps the branch it read, which came after the load's", async ($, on) => {
    const clock = clockOf(on)
    // Once set, the next write of the list is slow, coming after the load read the checkout.
    let isWriteSlow = false
    on("state.set", { plugin: "gh-prs-monitor", key: "snapshot" }, async (_, e, next) => {
      if (isWriteSlow) {
        isWriteSlow = false
        await clock.sleep(5_000)
      }

      return next(e)
    })
    const world: World = { github: GITHUB, branch: "feature/export", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    expect(await ui.find(CREATE)).toBeDefined()

    isWriteSlow = true
    await ui.press({ key: "refresh" })
    await clock.advance(1_000)
    world.branch = "main"
    world.head = "main-head"
    await ui.press(CREATE)
    await clock.advance(5_000)
    await settleAll(clock, seen)

    expect(seen.toasts).toEqual([
      "No pull request to open from this session's branch now: it changed, or one is open for it."
    ])
    expect(await ui.find(CREATE)).toBeUndefined()
  })

  test("the lookup the load sets off then asks about the press's branch, not the one the load read", async ($, on) => {
    const clock = clockOf(on)
    let isWriteSlow = false
    on("state.set", { plugin: "gh-prs-monitor", key: "snapshot" }, async (_, e, next) => {
      if (isWriteSlow) {
        isWriteSlow = false
        await clock.sleep(5_000)
      }

      return next(e)
    })
    const world: World = { github: GITHUB, branch: "feature/export", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    isWriteSlow = true
    await ui.press({ key: "refresh" })
    await clock.advance(1_000)
    world.branch = "feature/new"
    world.head = "new-head"
    await ui.press(CREATE)
    await clock.advance(5_000)
    await settleAll(clock, seen)

    expect(LOOKUPS(seen).at(-1)).toContain("branch=feature/new")
  })

  test("a load after a press reads the checkout anew, so a switch since shows", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "feature/export", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await clock.advance(MINUTE)
    await ui.press(CREATE)
    await settleAll(clock, seen)

    await clock.advance(MINUTE)
    world.branch = "fix/menu"
    world.head = "head-1"
    await ui.press({ key: "refresh" })
    await settleAll(clock, seen)

    expect(await ui.findAll({ type: "Text", text: /^●$/ })).toHaveLength(1)
  })

  test(
    "a press after a reload, before any refresh, still asks GitHub",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = {
        github: GITHUB,
        branch: "feature/old",
        head: "pushed",
        uncommitted: 0,
        branchPulls: [{ number: 3, state: "MERGED", head: "updated" }],
        missingCommits: ["updated"],
        associated: { pushed: [{ number: 3, state: "MERGED" }] },
        answer: "Cancel"
      }
      const seen = machine($, on, world, clock)
      // What the session kept before the reload: the list, and GitHub's answer then that none came from the branch.
      const old = {
        snapshot: keptList(GITHUB),
        checkout: { branch: "feature/old", head: "pushed", at: 0 },
        branchPulls: { repo: "acme/app", branch: "feature/old", head: "pushed", isTaken: false, endedHead: null }
      }
      keptOverReload(on, old)
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      expect(await ui.find(CREATE)).toBeDefined()

      await ui.press(CREATE)
      await settleAll(clock, seen)

      expect(seen.toasts).toEqual([
        "No pull request to open from this session's branch now: it changed, or one is open for it."
      ])
      expect(world.asked).toBeUndefined()
    }
  )

  test(
    "a press after a reload where gh needs setting up says so, and starts nothing",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const world: World = {
        github: GITHUB,
        branch: "feature/export",
        head: "local-1",
        uncommitted: 0,
        answer: "This session"
      }
      const seen = machine($, on, world, clock)
      keptOverReload(on, keptOnExport())
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")
      world.isGhMissing = true

      await ui.press(CREATE)
      await settleAll(clock, seen)

      expect(seen.toasts).toEqual([GH_MISSING.message])
      expect(world.asked).toBeUndefined()
      expect(seen.commands).toEqual([])
    }
  )

  for (const [problem, setup] of [
    ["missing", { isGhMissing: true }],
    ["signed out", { isSignedOut: true }]
  ] as const) {
    test(`a press where gh went ${problem} since the list loaded says so, and starts nothing`, async ($, on) => {
      const { world, seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "This session" })
      Object.assign(world, setup)

      await ui.press(CREATE)
      await settleAll(clock, seen)

      expect(seen.toasts).toHaveLength(1)
      expect(seen.toasts[0]).toMatch(/gh auth login/)
      expect(world.asked).toBeUndefined()
      expect(seen.commands).toEqual([])
    })
  }

  test("a press whose lookup GitHub didn't answer, gh working, goes on without asking gh anything more", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/export", { answer: "Cancel" })
    world.isBranchPullsFailing = true
    const runs = seen.runs.length

    await ui.press(CREATE)
    await settleAll(clock, seen)

    expect(world.asked).toBe(1)
    expect(seen.runs.slice(runs).filter((run) => run.startsWith("gh repo view"))).toEqual([])
  })

  test(
    "a press's look for the repository failing after a load's worked leaves what the load showed",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      // The press's look for the repository hangs, then gh gives up; any later one answers.
      let looks = 0
      on("process.run", {}, async (_, e, next) => {
        if (e.argv.join(" ").startsWith("gh repo view") && ++looks === 1) {
          await clock.sleep(25_000)
          throw new Error("timed out after 30000 ms")
        }

        return next(e)
      })
      const world: World = {
        github: GITHUB,
        branch: "feature/export",
        head: "local-1",
        uncommitted: 0,
        answer: "Cancel"
      }
      const seen = machine($, on, world, clock)
      keptOverReload(on, keptOnExport())
      await startSession($)
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await ui.press(CREATE)
      await clock.advance(1_000)
      await ui.press({ key: "refresh" })
      await clock.advance(30_000)
      await settleAll(clock, seen)

      expect(await ui.find({ key: "problem" })).toBeUndefined()
      const views = seen.runs.filter((run) => run.startsWith("gh repo view")).length
      await ui.press(CREATE)
      await settleAll(clock, seen)
      expect(seen.runs.filter((run) => run.startsWith("gh repo view"))).toHaveLength(views)
    }
  )

  test("GitHub is asked once per branch and commit, and a press on a newer commit asks first", async ($, on) => {
    const { world, seen, clock, ui } = await paneOn($, on, "feature/old", {
      head: "new-work",
      branchPulls: [{ state: "MERGED", head: "abc" }],
      answer: "Cancel"
    })
    await ui.press({ key: "refresh" })
    await clock.settle()
    expect(LOOKUPS(seen)).toHaveLength(1)

    // Reset to the merged commit since the list was drawn: the press finds nothing to open.
    world.head = "abc"
    await ui.press(CREATE)
    await settleAll(clock, seen)
    expect(LOOKUPS(seen)).toHaveLength(2)
    expect(world.asked).toBeUndefined()
    expect(seen.toasts).toEqual([
      "No pull request to open from this session's branch now: it changed, or one is open for it."
    ])
    expect(await ui.find(CREATE)).toBeUndefined()
  })
})

describe("the create-pr skill's choices", () => {
  const TOOL = "mcp__gh-prs-monitor__create_pr_choices"
  const call = ($: Engine, input: object = {}) =>
    $.tool.call({ tool: TOOL, repo: "github.com/acme/app", ...input } as never)

  test("are a tool of the plugin's, none until saved, and kept for the repository once saved", async ($, on) => {
    const { seen, world } = await paneOn($, on, "feature/export")
    const choices = { isDraft: true, checks: ["npm run lint"], reviewers: ["ann"] }

    expect(seen.tools).toEqual([TOOL, "mcp__gh-prs-monitor__ticket_links"])
    expect((await call($)).result).toBe("none")
    expect((await call($, { save: choices })).result).toBe("saved")
    expect(JSON.parse(String((await call($)).result))).toEqual(choices)
    expect(world.store?.["createPr:github.com/acme/app"]).toEqual(choices)
  })

  test("a store too full for a save gives up the answers sessions share, and keeps the save", async ($, on) => {
    const { world } = await paneOn($, on, "feature/export")
    const choices = { isDraft: true, checks: ["npm run lint"], reviewers: ["ann"] }
    const other = `shared:github.com/acme/other:me:${QUERY_VERSION}`
    const padding = { mine: [{ number: 9, title: "x".repeat(6_000) }] }
    // Beside what the plugin keeps of its own, which stays.
    const own = {
      "look:github.com/acme/other": { repo: "acme/other" },
      shown: [],
      "kept:github.com/acme/other:/other": {}
    }
    world.store = { ...world.store, ...own, [other]: sharedAnswer("another-session", 0, padding) }
    world.storeLimit = JSON.stringify(world.store).length + 50

    expect((await call($, { save: choices })).result).toBe("saved")
    expect(world.store?.["createPr:github.com/acme/app"]).toEqual(choices)
    expect(world.store?.[other]).toBeUndefined()
    expect(world.store).toMatchObject(own)
  })

  test("a save the store refuses for another reason gives up nothing", async ($, on) => {
    const { world } = await paneOn($, on, "feature/export")
    const other = `shared:github.com/acme/other:me:${QUERY_VERSION}`
    world.store = { ...world.store, [other]: sharedAnswer("another-session", 0) }
    world.storeSetDeny = "the key is 300 characters, over the 256 limit"

    const refused = await call($, { save: { isDraft: true, checks: [], reviewers: [] } })

    expect(refused.deny).toContain("the key is 300 characters, over the 256 limit")
    expect(world.store?.[other]).toEqual(sharedAnswer("another-session", 0))
  })

  test("a save of another shape is refused and keeps nothing", async ($, on) => {
    const { world } = await paneOn($, on, "feature/export")

    const refused = await call($, { save: { isDraft: "yes", checks: [], reviewers: [] } })

    expect(refused.deny).toBe(
      "save takes isDraft (true or false), checks and reviewers (lists of up to 50 texts, each up to 200 characters)."
    )
    expect(world.store?.["createPr:github.com/acme/app"]).toBeUndefined()
  })

  test("a repository not named as <host>/<owner>/<name> is refused", async ($, on) => {
    await paneOn($, on, "feature/export")

    expect((await call($, { repo: "acme/app" })).deny).toBe(
      "repo names the repository as <host>/<owner>/<name>, as github.com/acme/app."
    )
  })

  test("a store that fails is a refusal the skill goes on without", async ($, on) => {
    await paneOn($, on, "feature/export", { isStoreBroken: true })

    expect((await call($)).deny).toMatch(/^The choices could not be read or kept: /)
  })
})

describe("Create PR in the demo", () => {
  test("the examples offer it from a branch of their own; the question is the real one, and nothing is sent", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "demo")
    const ui = await mountPane($, "terminal")

    await ui.press(CREATE)
    await settleAll(clock, seen, () => seen.toasts.length > 0)

    expect(world.subject).toBe("feature/export-csv → main")
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toContain(
      'feature/export-csv is an example: in your own list, "This session" would go ahead. Nothing was sent to GitHub.'
    )
  })
})
