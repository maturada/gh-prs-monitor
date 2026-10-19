// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"
import type { ResponseFixture } from "./testing/fixtures"
import { FORK_DEPS_NOTE } from "./deps"
import {
  clockOf,
  machine,
  settleAll,
  skillTurnStart,
  skillTurnEnd,
  startSession,
  mountPane,
  GITHUB,
  keptOverReload,
  settleUntil
} from "./testing/world"
import type { World, Seen } from "./testing/world"

// Presses a row's button in the terminal once the list has loaded, and returns what the machine saw.
async function pressOn($: Engine, on: On, key: string, world: World): Promise<Seen> {
  const clock = clockOf(on)
  const seen = machine($, on, world)
  await startSession($)
  await clock.settle()
  const ui = await mountPane($, "terminal")
  // Each flow ends by handing Claude a command or by telling the person why not.
  const told = () => seen.commands.length + seen.toasts.length + seen.notices.length
  const before = told()
  await ui.press({ key })
  await settleAll(clock, seen, () => told() > before)

  return seen
}

describe("Resolve Comments", () => {
  test("while Resolve Comments' turn runs, its row says so in place of its buttons", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    // The command has run, so the turn that starts next is the skill's.
    await settleAll(clock, seen, () => seen.commands.length > 0)
    await $.turn.start(skillTurnStart("resolve"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Resolving Comments…" })).toBeDefined()
    expect(await ui.find({ key: "resolve-1" })).toBeUndefined()

    await $.turn.complete(skillTurnEnd("resolve", "aborted"))
    await clock.settle()
    expect(await ui.find({ key: "resolve-1" })).toBeDefined()
  })

  test("once its command has run, the row can't start it again before its turn ends", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine(
      $,
      on,
      { github: GITHUB, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" },
      clock
    )
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    await clock.settle()

    // Between the command and its turn the row already says the skill is at work: there is no button to press again.
    expect(await ui.find({ type: "Text", text: "Resolving Comments…" })).toBeDefined()
    expect(await ui.find({ key: "resolve-1" })).toBeUndefined()
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("a skill's turn that ends gives back only its own mark, not one another flow put on the row since", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, this session",
      slowCheckoutMs: 5_000
    }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    // Resolve Comments is preparing its worktree when a review typed for the same pull request starts its turn.
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    await $.command.run({ command: "gh-prs-monitor:review", args: "1" } as Parameters<Engine["command"]["run"]>[0])
    await $.turn.start(skillTurnStart("review"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
    // The worktree is ready and Resolve Comments' command runs, marking the row its own way.
    await clock.advance(5_000)
    expect(await ui.find({ type: "Text", text: "Resolving Comments…" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("review"))
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "Resolving Comments…" })).toBeDefined()
  })

  test("on the pull request's own branch it still asks, Here first, and works there as it is", async ($, on) => {
    // Another session may be working in this checkout, so nothing starts unasked.
    const world: World = { github: GITHUB, branch: "fix/menu", uncommitted: 4, answer: "Here, on this branch" }
    const seen = await pressOn($, on, "resolve-1", world)

    expect(world.choices).toEqual(["Here, on this branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(world.detail).toMatch(
      /^This checkout is on the pull request's branch already: working here uses it as it is, with its 4 uncommitted changes;/
    )
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
  })

  test("on the pull request's own branch, a dismissed dialog starts nothing", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", { github: GITHUB, branch: "fix/menu", uncommitted: 0 })

    expect(seen.commands).toEqual([])
  })

  test("cancelled, nothing runs", async ($, on) => {
    const cancelled = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Cancel"
    })

    expect(cancelled.commands).toEqual([])
    expect(cancelled.runs.some((run) => run.startsWith("git worktree add"))).toBe(false)
  })

  test("dismissed, nothing runs and nothing is reported", async ($, on) => {
    const dismissed = await pressOn($, on, "resolve-1", { github: GITHUB, branch: "main", uncommitted: 0 })

    expect(dismissed.commands).toEqual([])
    expect(dismissed.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(dismissed.toasts).toEqual([])
  })

  test("a separate worktree is prepared and handed to the skill", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 2,
      answer: "Worktree, this session"
    })

    expect(seen.runs).toContain("git worktree add --detach /repo/.claude/worktrees/pr-1")
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c pr-1 head-1")
    expect(seen.commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("its worktree from an earlier run, rebased on GitHub since, is brought to GitHub's version when GitHub has its commit", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, this session",
      pullWorktrees: [{ number: 1, branch: "fix/menu", tip: "pushed" }]
    })

    // Asked of this repository on its own host, as the session found it.
    expect(seen.runs).toContain("gh api repos/acme/app/commits/pushed --hostname github.com --silent")
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -C fix/menu --no-track head-1")
    expect(seen.commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("instructions typed in the dialog go along, in a worktree", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "only the naming ones"
    })

    expect(seen.commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed" -- only the naming ones'
    ])
  })

  test("a worktree in a new session is prepared here, then opened with the command typed in", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, new session"
    })
    const prompt =
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --deps "no lockfile the plugin installs from, nothing installed"'

    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c pr-1 head-1")
    expect(seen.runs).toContain(
      `open claude-cli://open?cwd=${encodeURIComponent("/repo/.claude/worktrees/pr-1")}&q=${encodeURIComponent(prompt)}`
    )
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual(["#1: Resolve Comments is typed into a new session for its worktree; send it there"])
  })

  test("instructions typed before pressing a new session go into its command", async ($, on) => {
    const note = "only the naming ones"
    const deps = '--deps "no lockfile the plugin installs from, nothing installed"'
    const fresh = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, new session",
      instructions: note
    })
    const prompt = `/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 ${deps} -- ${note}`

    expect(fresh.runs).toContain(
      `open claude-cli://open?cwd=${encodeURIComponent("/repo/.claude/worktrees/pr-1")}&q=${encodeURIComponent(prompt)}`
    )
  })

  test("instructions typed before pressing Here go with it", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "fix/menu",
      uncommitted: 0,
      answer: "Here, on this branch",
      instructions: "only the naming ones"
    })

    expect(seen.commands).toEqual([
      "/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 -- only the naming ones"
    ])
  })

  test("from the desktop app, the new session opens at the repository's root and is told the worktree", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      answer: "Worktree, new session"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const prompt =
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'

    const ui = await mountPane($, "desktop")
    await ui.press({ key: "resolve-1" })
    await clock.settle()

    expect(seen.runs).toContain(`open claude://code/new?folder=%2Frepo&q=${encodeURIComponent(prompt)}`)
    expect(seen.commands).toEqual([])
  })

  test("from VS Code, the new session opens as a tab of its editor, at the window's folder, and is told the worktree", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      editor: { scheme: "vscode-insiders" },
      answer: "Worktree, new session"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const prompt =
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'

    const ui = await mountPane($, "vscode")
    await ui.press({ key: "resolve-1" })
    await clock.settle()

    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(seen.runs).toContain(
      `open vscode-insiders://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`
    )
    expect(seen.commands).toEqual([])
  })

  test("from VS Code, a new session whose link won't open runs the skill in this session, in the worktree prepared", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      answer: "Worktree, new session",
      openFailure: "LSOpenURLsWithRole() failed with error -10814"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const command =
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'

    const ui = await mountPane($, "vscode")
    await ui.press({ key: "resolve-1" })
    await clock.settle()

    expect(seen.runs).toContain(`open vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(command)}`)
    expect(seen.commands).toEqual([command])
    expect(seen.toasts).toContain(
      "#1: no new session opened (LSOpenURLsWithRole() failed with error -10814), so it runs in this one"
    )
  })

  test("where no new session can be opened, the dialog offers none", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "mobile")
    await ui.press({ key: "resolve-1" })
    await clock.settle()

    expect(world.header).toBe("Resolve PR")
    expect(world.subject).toBe("#1 Fix the menu")
    expect(world.question).toBe("Where should its review comments on fix/menu be resolved?")
    expect(world.detail).not.toContain("new session")
    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Cancel"])
    expect(seen.commands).toEqual([])
  })

  test("a failure is reported, and the row can be pressed again", async ($, on) => {
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, this session",
      checkoutFailure: "GraphQL: Could not resolve to a PullRequest"
    }
    const clock = clockOf(on)
    const seen = machine($, on, world)
    await startSession($)
    await settleAll(clock, seen)
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    await settleAll(clock, seen, () => seen.toasts.length >= 1)
    await ui.press({ key: "resolve-1" })
    await settleAll(clock, seen, () => seen.toasts.length >= 2)

    expect(world.asked).toBe(2)
    expect(seen.toasts).toEqual([
      "#1: could not check out the pull request in a worktree: GraphQL: Could not resolve to a PullRequest",
      "#1: could not check out the pull request in a worktree: GraphQL: Could not resolve to a PullRequest"
    ])
    expect(seen.commands).toEqual([])
  })

  test("a fork's pull request never runs on a same-named local branch", async ($, on) => {
    const fork: ResponseFixture = { mine: [{ ...GITHUB.mine![0]!, headRefName: "main", isCrossRepository: true }] }
    const world: World = { github: fork, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = await pressOn($, on, "resolve-1", world)

    expect(world.asked).toBe(1)
    expect(seen.commands).toEqual([])
  })

  test("no worktree is made through a link at .claude, however the file system spells it", async ($, on) => {
    // A link that could lead anywhere, as one a pull request's base tracks; macOS finds `.claude` through `.Claude`.
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, this session",
      links: ["/repo/.Claude"]
    })

    expect(seen.runs.some((run) => run.startsWith("git worktree add"))).toBe(false)
    expect(seen.commands).toEqual([])
    expect([...seen.toasts, ...seen.notices].join("\n")).toMatch(/\.claude is a link/)
  })

  test("a fork's pull request gets a worktree but no install, and the skill is told why", async ($, on) => {
    const fork: ResponseFixture = { mine: [{ ...GITHUB.mine![0]!, isCrossRepository: true }] }
    const seen = await pressOn($, on, "resolve-1", {
      github: fork,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, this session"
    })

    expect(seen.commands).toEqual([
      `/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "${FORK_DEPS_NOTE}"`
    ])
    expect(seen.runs.some((run) => /^(npm|pnpm|yarn|bun) /.test(run))).toBe(false)
  })

  test("with uncommitted changes, switching here is still offered, said what it costs, and done", async ($, on) => {
    const world: World = { github: GITHUB, branch: "main", uncommitted: 2, answer: "Here, switch branch" }
    const seen = await pressOn($, on, "resolve-1", world)

    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(world.detail).toMatch(/^This checkout has 2 uncommitted changes: switching here takes them along/)
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("while a turn runs, switching here waits for it to end, then switches and starts", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    expect(world.detail).toMatch(/^This session is busy, so switching here waits until its turn ends/)
    expect(await ui.find({ type: "Text", text: "Switches Branch When This Turn Ends" })).toBeDefined()
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)

    await $.turn.complete(skillTurnEnd("busy"))
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("a turn that began before a reload is waited for too", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    keptOverReload(on, { turns: ["busy"] })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    expect(world.detail).toMatch(/^This session is busy, so switching here waits until its turn ends/)
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)

    await $.turn.complete(skillTurnEnd("busy"))
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
  })

  test("a prompt queued behind the turn starts the next one as it ends, and the switch waits for that too", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)

    // The queued prompt's turn starts as the plugin looks at the checkout once the first has ended.
    world.queuedTurn = "queued"
    await $.turn.complete(skillTurnEnd("busy"))
    await settleAll(clock, seen)
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(await ui.find({ type: "Text", text: "Switches Branch When This Turn Ends" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("queued"))
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("one switch of this checkout at a time: another asked for while the first waits is told so", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = { ...GITHUB, mine: [GITHUB.mine![0]!, { ...GITHUB.mine![1]!, ci: "FAILURE" }] }
    const world: World = { github, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)

    await ui.press({ key: "fixCi-2" })
    await settleAll(clock, seen, () => seen.toasts.length > 0)
    expect(seen.toasts).toEqual(["#2: #1 is switching this checkout; press Fix CI again once it is done"])
    expect(await ui.find({ key: "fixCi-2" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("busy"))
    await settleAll(clock, seen, () => seen.commands.length > 0)
    expect(seen.runs.filter((run) => run.startsWith("git switch --no-overwrite-ignore"))).toEqual([
      "git switch --no-overwrite-ignore -c fix/menu head-1"
    ])
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("nor is work on this branch started here while a switch waits, as it would find another branch under it", async ($, on) => {
    const clock = clockOf(on)
    const github: ResponseFixture = {
      ...GITHUB,
      mine: [GITHUB.mine![0]!, { ...GITHUB.mine![1]!, headRefName: "feature/two", ci: "FAILURE" }]
    }
    const world: World = { github, branch: "feature/two", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    // The switch waiting for the turn, and Fix CI drawn on the other row.
    await settleUntil(
      clock,
      async () =>
        (await ui.find({ type: "Text", text: "Switches Branch When This Turn Ends" })) !== undefined &&
        (await ui.find({ key: "fixCi-2" })) !== undefined
    )

    world.answer = "Here, on this branch"
    await ui.press({ key: "fixCi-2" })
    await settleAll(clock, seen, () => seen.toasts.length > 0)

    expect(seen.toasts).toEqual(["#2: #1 is switching this checkout; press Fix CI again once it is done"])
    expect(seen.commands).toEqual([])
  })

  // A press on Resolve Comments answered "Here, switch branch" while a turn runs, which changes the checkout as it
  // ends.
  async function switchAfterTurnChanged($: Engine, on: On, change: Partial<World>) {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)

    Object.assign(world, change)
    await $.turn.complete(skillTurnEnd("busy"))
    await settleAll(clock, seen)

    return { seen, ui }
  }

  const NOT_SWITCHED =
    "#1: this checkout changed since you were asked, so it was not switched; press Resolve Comments again to choose"

  test("a checkout the turn changed meanwhile is left as it is, and the person told", async ($, on) => {
    const { seen, ui } = await switchAfterTurnChanged($, on, { uncommitted: 1 })

    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toContain(NOT_SWITCHED)
    expect(await ui.find({ key: "resolve-1" })).toBeDefined()
  })

  test("so is one the turn switched to another branch", async ($, on) => {
    const { seen } = await switchAfterTurnChanged($, on, { branch: "feature/other" })

    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(seen.toasts).toContain(NOT_SWITCHED)
  })

  // The question answered only after the change: by a turn under way at the press, which ends first, or by hand.
  async function switchAfterChangeBeforeAnswer($: Engine, on: On, change: Partial<World>, isTurn: boolean) {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Here, switch branch",
      slowDialogMs: 5_000
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    if (isTurn) {
      await $.turn.start(skillTurnStart("busy"))
    }
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "resolve-1" })
    await clock.advance(1_000)
    Object.assign(world, change)
    if (isTurn) {
      await $.turn.complete(skillTurnEnd("busy"))
    }
    await clock.advance(5_000)
    await settleAll(clock, seen)

    return seen
  }

  test("so is one a turn switched before the person answered, the turn over by then", async ($, on) => {
    const seen = await switchAfterChangeBeforeAnswer($, on, { branch: "feature/other" }, true)

    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(seen.toasts).toContain(NOT_SWITCHED)
  })

  test("and one where a commit was made while the question was open, the branch the same", async ($, on) => {
    const seen = await switchAfterChangeBeforeAnswer($, on, { head: "a-new-commit" }, false)

    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
    expect(seen.toasts).toContain(NOT_SWITCHED)
  })

  test("switching here checks the branch out in this folder", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Here, switch branch"
    })

    expect(seen.runs.some((run) => run.startsWith("git worktree add"))).toBe(false)
    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1"])
  })

  test("switching here stops, git changing nothing, where it would overwrite a file git doesn't track here", async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "Here, switch branch",
      inTheWay: [".vscode/settings.json"]
    })

    expect(seen.runs).toContain(
      "git -c credential.helper= -c credential.helper=!gh auth git-credential fetch --no-tags origin +refs/heads/fix/menu:refs/remotes/origin/fix/menu"
    )
    expect(seen.runs.filter((run) => /^git (switch|config branch)/.test(run))).toEqual([
      "git switch --no-overwrite-ignore -c fix/menu head-1"
    ])
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual([
      "#1: not switched: that would overwrite .vscode/settings.json in this checkout, which git doesn't track and the pull request's branch does: move it aside, or choose \"Worktree, this session\""
    ])
  })

  test("outdated comments are passed on when counted", { options: { includeOutdated: true } }, async ($, on) => {
    const seen = await pressOn($, on, "resolve-1", {
      github: GITHUB,
      branch: "fix/menu",
      uncommitted: 0,
      answer: "Here, on this branch"
    })

    expect(seen.commands).toEqual([
      "/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --include-outdated"
    ])
  })
})

describe("Fix CI", () => {
  const FAILING: ResponseFixture = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
  const NO_LOCKFILE = "no lockfile the plugin installs from, nothing installed"

  test("on the pull request's own branch it still asks, and Here works there as it is", async ($, on) => {
    const world: World = { github: FAILING, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" }
    const seen = await pressOn($, on, "fixCi-1", world)

    expect(world.choices?.[0]).toBe("Here, on this branch")
    expect(seen.commands).toEqual(["/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1"])
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
  })

  test("a subagent's run, which Claude Code raises turns for, keeps no switch waiting", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: FAILING, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start({ text: "", turnId: "agent-turn", agentId: "agent-1" } as never)
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "fixCi-1" })
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1"])
  })

  test("elsewhere it asks where the failing checks should be fixed", async ($, on) => {
    const world: World = { github: FAILING, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = await pressOn($, on, "fixCi-1", world)

    expect(world.header).toBe("Fix CI")
    expect(world.question).toBe("Where should its failing checks on fix/menu be fixed?")
    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(seen.commands).toEqual([])
  })

  test(
    "a worktree is prepared and handed to the skill, without Resolve Comments' outdated flag",
    { options: { includeOutdated: true } },
    async ($, on) => {
      const seen = await pressOn($, on, "fixCi-1", {
        github: FAILING,
        branch: "main",
        uncommitted: 0,
        answer: "Worktree, this session"
      })

      expect(seen.runs).toContain("git switch --no-overwrite-ignore -c pr-1 head-1")
      expect(seen.commands).toEqual([
        `/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "${NO_LOCKFILE}"`
      ])
    }
  )

  test("switching here checks the branch out in this folder first", async ($, on) => {
    const seen = await pressOn($, on, "fixCi-1", {
      github: FAILING,
      branch: "main",
      uncommitted: 0,
      answer: "Here, switch branch"
    })

    expect(seen.runs).toContain("git switch --no-overwrite-ignore -c fix/menu head-1")
    expect(seen.commands).toEqual(["/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1"])
  })

  test("a new session from the terminal opens in the worktree with Fix CI typed in", async ($, on) => {
    const seen = await pressOn($, on, "fixCi-1", {
      github: FAILING,
      branch: "main",
      uncommitted: 0,
      answer: "Worktree, new session"
    })
    const prompt = `/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1 --deps "${NO_LOCKFILE}"`

    expect(seen.runs).toContain(
      `open claude-cli://open?cwd=${encodeURIComponent("/repo/.claude/worktrees/pr-1")}&q=${encodeURIComponent(prompt)}`
    )
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual(["#1: Fix CI is typed into a new session for its worktree; send it there"])
  })

  test("while its turn runs, the row says CI is being fixed in place of its buttons", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: FAILING, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "fixCi-1" })
    await clock.settle()
    await $.turn.start(skillTurnStart("fix"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Fixing CI…" })).toBeDefined()
    expect(await ui.find({ key: "fixCi-1" })).toBeUndefined()

    await $.turn.complete(skillTurnEnd("fix"))
    await clock.settle()
    expect(await ui.find({ key: "fixCi-1" })).toBeDefined()
  })

  test("pressed while a turn runs, the row says fixing CI waits for it", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: FAILING,
      branch: "fix/menu",
      uncommitted: 0,
      answer: "Here, on this branch",
      slowCommandMs: 5_000
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "fixCi-1" })
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "Fixing CI Starts When This Turn Ends" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("busy"))
    await clock.advance(5_000)
    expect(seen.commands).toEqual(["/gh-prs-monitor:fix-ci https://github.com/acme/app/pull/1"])
  })

  test("two presses before the row is drawn again ask once", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: FAILING, branch: "main", uncommitted: 0, answer: "Cancel", slowDialogMs: 5_000 }
    machine($, on, world, clock)
    // The button's own handler runs twice at once for one press, as for two presses that reach the plugin together.
    on("ui.press", async ($, e, next) => {
      const [first] = await Promise.all([next(e), next(e)])
      return first
    })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "fixCi-1" })
    await clock.settle()
    await clock.advance(10_000)

    expect(world.asked).toBe(1)
  })

  test("typed, by number or bare on the pull request's branch, it marks that row too", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: FAILING, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const typed = async (args: string, turnId: string): Promise<boolean> => {
      await $.command.run({ command: "gh-prs-monitor:fix-ci", args } as Parameters<Engine["command"]["run"]>[0])
      await $.turn.start(skillTurnStart(turnId))
      await clock.settle()
      const isShown = (await ui.find({ type: "Text", text: "Fixing CI…" })) !== undefined
      await $.turn.complete(skillTurnEnd(turnId))
      await clock.settle()

      return isShown
    }

    expect(await typed("1", "by-number")).toBe(true)
    expect(await typed("", "bare")).toBe(true)
  })
})

describe("Resolve Conflicts", () => {
  const CONFLICTING: ResponseFixture = {
    ...GITHUB,
    mine: [{ ...GITHUB.mine![0]!, mergeable: "CONFLICTING" }, GITHUB.mine![1]!]
  }
  const NO_LOCKFILE = "no lockfile the plugin installs from, nothing installed"

  test("elsewhere it asks where the merge conflicts should be resolved", async ($, on) => {
    const world: World = { github: CONFLICTING, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = await pressOn($, on, "resolveConflicts-1", world)

    expect(world.header).toBe("Conflicts")
    expect(world.question).toBe("Where should its merge conflicts on fix/menu be resolved?")
    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(seen.commands).toEqual([])
  })

  test("on the pull request's own branch, Here hands the skill the pull request as it is", async ($, on) => {
    const world: World = { github: CONFLICTING, branch: "fix/menu", uncommitted: 0, answer: "Here, on this branch" }
    const seen = await pressOn($, on, "resolveConflicts-1", world)

    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-conflicts https://github.com/acme/app/pull/1"])
    expect(seen.runs.some((run) => run.startsWith("git switch --no-overwrite-ignore"))).toBe(false)
  })

  test(
    "a worktree is prepared and handed to the skill, without Resolve Comments' outdated flag",
    { options: { includeOutdated: true } },
    async ($, on) => {
      const seen = await pressOn($, on, "resolveConflicts-1", {
        github: CONFLICTING,
        branch: "main",
        uncommitted: 0,
        answer: "Worktree, this session"
      })

      expect(seen.runs).toContain("git switch --no-overwrite-ignore -c pr-1 head-1")
      expect(seen.commands).toEqual([
        `/gh-prs-monitor:resolve-conflicts https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "${NO_LOCKFILE}"`
      ])
    }
  )

  test("no longer conflicting on GitHub, it says so, asks nothing and reads the list again", async ($, on) => {
    const world: World = { github: CONFLICTING, branch: "main", uncommitted: 0, answer: "Here, switch branch" }
    world.current = { 1: { isConflicting: false } }
    const seen = await pressOn($, on, "resolveConflicts-1", world)

    expect(seen.toasts).toEqual(["#1 has no conflicts with main now; refreshing the list"])
    expect(world.asked ?? 0).toBe(0)
    expect(seen.commands).toEqual([])
  })

  test("while its turn runs, the row says conflicts are being resolved; pressed during a turn, that it waits", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: CONFLICTING,
      branch: "fix/menu",
      uncommitted: 0,
      answer: "Here, on this branch",
      slowCommandMs: 5_000
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "resolveConflicts-1" })
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "Resolving Conflicts Starts When This Turn Ends" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("busy"))
    await clock.advance(5_000)
    expect(seen.commands).toEqual(["/gh-prs-monitor:resolve-conflicts https://github.com/acme/app/pull/1"])
    await $.turn.start(skillTurnStart("resolve-conflicts"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Resolving Conflicts…" })).toBeDefined()
    expect(await ui.find({ key: "resolveConflicts-1" })).toBeUndefined()

    await $.turn.complete(skillTurnEnd("resolve-conflicts"))
    await clock.settle()
    expect(await ui.find({ key: "resolveConflicts-1" })).toBeDefined()
  })

  test("typed bare on the pull request's branch, it marks that row too", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: CONFLICTING, branch: "fix/menu", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await $.command.run({ command: "gh-prs-monitor:resolve-conflicts", args: "" } as Parameters<
      Engine["command"]["run"]
    >[0])
    await $.turn.start(skillTurnStart("typed"))
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "Resolving Conflicts…" })).toBeDefined()
  })
})
