// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine, MockClock } from "claude-code/testing"
import {
  clockOf,
  MINUTE,
  machine,
  settleAll,
  skillTurnStart,
  skillTurnEnd,
  runPrs,
  startSession,
  mountPane,
  GITHUB
} from "./testing/world"
import type { World, Seen } from "./testing/world"

describe("a skill at work on its row", () => {
  test("while the review's turn runs, its row says so in place of its buttons; the turn's end gives them back", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    // However the turn ends: answered, interrupted, or failed.
    for (const reason of ["answer", "aborted", "error"]) {
      await ui.press({ key: "review-7" })
      await clock.settle()
      // The command ran and its turn starts within a moment: the row says so already, so it can't be pressed twice.
      expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
      expect(await ui.find({ key: "review-7" })).toBeUndefined()
      await $.turn.start(skillTurnStart(`review-${reason}`))
      await clock.settle()
      expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
      expect(await ui.find({ key: "review-7" })).toBeUndefined()

      await $.turn.complete(skillTurnEnd(`review-${reason}`, reason))
      await clock.settle()
      expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeUndefined()
      expect(await ui.find({ key: "review-7" })).toBeDefined()
    }
    expect(seen.commands).toHaveLength(3)
  })

  test("pressed while a turn runs, the row says the review waits for it, then that it is at work", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "This session",
      slowCommandMs: 5_000
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await $.turn.start(skillTurnStart("busy"))
    const ui = await mountPane($, "terminal")

    await ui.press({ key: "review-7" })
    await clock.advance(1_000)
    expect(await ui.find({ type: "Text", text: "Review Starts When This Turn Ends" })).toBeDefined()

    await $.turn.complete(skillTurnEnd("busy"))
    await clock.advance(5_000)
    expect(seen.commands).toEqual(["/gh-prs-monitor:review https://github.com/acme/app/pull/7"])
    // The turn that ended was not the review's; the next to start is.
    await $.turn.start(skillTurnStart("review"))
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
    await $.turn.complete(skillTurnEnd("review"))
    await clock.settle()
    expect(await ui.find({ key: "review-7" })).toBeDefined()
  })

  test("a review typed by number or address is shown on its row too, as in a session a button opened", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const typed = async (args: string, turnId: string): Promise<boolean> => {
      await $.command.run({ command: "gh-prs-monitor:review", args } as Parameters<Engine["command"]["run"]>[0])
      await $.turn.start(skillTurnStart(turnId))
      await clock.settle()
      const isShown = (await ui.find({ type: "Text", text: "Reviewing…" })) !== undefined
      await $.turn.complete(skillTurnEnd(turnId))
      await clock.settle()

      return isShown
    }

    expect(await typed("7", "by-number")).toBe(true)
    expect(await typed("https://github.com/acme/app/pull/7 -- focus on the API", "by-address")).toBe(true)
    // Another repository's pull request has no row here, and nothing marks one of these.
    expect(await typed("https://github.com/acme/other/pull/7", "elsewhere")).toBe(false)
    expect(await ui.find({ key: "review-7" })).toBeDefined()
  })

  test(
    "a review typed before the session has looked its repository up still marks its row",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
      await startSession($)
      await clock.settle()

      await $.command.run({
        command: "gh-prs-monitor:review",
        args: "https://github.com/acme/app/pull/7"
      } as Parameters<Engine["command"]["run"]>[0])
      await $.turn.start(skillTurnStart("review"))
      await clock.settle()
      await runPrs($, "")
      await clock.settle()
      const ui = await mountPane($, "terminal")

      expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
    }
  )

  test("a bare Resolve Comments, typed, marks the row of the branch it works on", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "fix/menu", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await $.command.run({ command: "gh-prs-monitor:resolve-comments", args: "--include-outdated" } as Parameters<
      Engine["command"]["run"]
    >[0])
    await $.turn.start(skillTurnStart("resolve"))
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "Resolving Comments…" })).toBeDefined()
    expect(await ui.find({ key: "resolve-1" })).toBeUndefined()
  })

  test("a typed review that fails to run leaves no mark for the next turn", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, commandFailure: "no such skill" }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await expect(
      $.command.run({ command: "gh-prs-monitor:review", args: "7" } as Parameters<Engine["command"]["run"]>[0])
    ).rejects.toThrow()
    await $.turn.start(skillTurnStart("chat"))
    await clock.settle()

    expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeUndefined()
    expect(await ui.find({ key: "review-7" })).toBeDefined()
  })

  test("a turn with no skill waiting to start marks nothing", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await $.turn.start(skillTurnStart("chat"))
    await clock.settle()

    expect(await ui.find({ key: "review-7" })).toBeDefined()
    expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeUndefined()
  })
})

describe("Review", () => {
  test("Review asks where to review, and This session runs the skill here", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(world.question).toBe("Where should it be reviewed?")
    expect(world.detail).toBe(
      "Here it runs in this conversation. A new session opens with the review typed in, for you to send."
    )
    expect(seen.commands).toEqual(["/gh-prs-monitor:review https://github.com/acme/app/pull/7"])
  })

  test("instructions typed before pressing This session go to the review", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "This session",
      instructions: "just bugs"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.commands).toEqual(["/gh-prs-monitor:review https://github.com/acme/app/pull/7 -- just bugs"])
  })

  test("instructions typed in the dialog go to the review, here", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: " focus on\nthe migration " })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(seen.commands).toEqual([
      "/gh-prs-monitor:review https://github.com/acme/app/pull/7 -- focus on the migration"
    ])
  })

  test("Cancel, a decline, or a dismissed dialog starts nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")

    for (const answer of ["Cancel", "no thanks", undefined]) {
      world.answer = answer
      await ui.press({ key: "review-7" })
      await clock.settle()
    }

    // Each press was asked, so none left the row marked busy.
    expect(world.asked).toBe(3)
    expect(seen.commands).toEqual([])
    expect(seen.runs.some((run) => /^(open|xdg-open|rundll32) /.test(run))).toBe(false)
  })

  test("while a turn runs, the question says the review would wait for it here", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel" }
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await $.turn.start({ text: "go", turnId: "t1" } as never)

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(world.detail).toMatch(/^This session is busy, so here the review starts once its turn ends\. /)
  })

  test("New session from the terminal opens a Claude Code window with the review typed in", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: "New session" })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.runs.some((run) => run.startsWith("open ")) && seen.toasts.length > 0)

    expect(seen.runs).toContain(
      "open claude-cli://open?cwd=%2Frepo&q=%2Fgh-prs-monitor%3Areview%20https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7"
    )
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual(["#7: the review is typed into a new session; send it there"])
  })

  test("New session from the desktop app opens one there", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["desktop"],
      answer: "New session"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "desktop")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(seen.runs).toContain(
      "open claude://code/new?folder=%2Frepo&q=%2Fgh-prs-monitor%3Areview%20https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7"
    )
    expect(seen.commands).toEqual([])
  })

  test("a link the system cannot open is said, with the command to type instead", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "New session",
      openFailure:
        "No application knows how to open URL claude-cli://open?cwd=%2Frepo&q=%2Fgh-prs-monitor%3Areview%20https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7 (Error -10814)"
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(seen.toasts).toEqual([
      "#7: could not open a new session (No application knows how to open URL claude-cli://open (Error -10814)); in /repo, type /gh-prs-monitor:review https://github.com/acme/app/pull/7 into one yourself"
    ])
    // A toast goes in seconds; the conversation keeps the command to copy.
    expect(seen.notices).toEqual(seen.toasts)
    expect(seen.commands).toEqual([])
  })

  test("a command too long for a link opens nothing, and is left in the conversation to type", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      answer: "New session",
      instructions: "focus on the naming ".repeat(300)
    }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("open "))).toEqual([])
    expect(seen.notices).toHaveLength(1)
    expect(seen.notices[0]).toMatch(
      /^#7: could not open a new session \(its command is longer than the 5,000 characters a link may carry\); in \/repo, type \/gh-prs-monitor:review https:\/\/github.com\/acme\/app\/pull\/7 -- focus on the naming/
    )
    expect(seen.commands).toEqual([])
  })

  test("New session from VS Code opens a tab of its editor, by the editor's own scheme, with the review typed in", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      editor: { scheme: "cursor" },
      answer: "New session"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "vscode")
    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.runs.some((run) => run.startsWith("open ")) && seen.toasts.length > 0)

    expect(world.choices).toEqual(["This session", "New session", "Cancel"])
    expect(seen.runs).toContain(
      "open cursor://anthropic.claude-code/open?prompt=%2Fgh-prs-monitor%3Areview%20https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7"
    )
    expect(seen.commands).toEqual([])
    expect(seen.toasts).toEqual(["#7: the review is typed into a new session; send it there"])
  })

  test("the editor's scheme is read once a load, when New session is first pressed in VS Code, and not for the question", async ($, on) => {
    const clock = clockOf(on)
    const editor = { scheme: "cursor", reads: 0 }
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      editor,
      answer: "Cancel"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()
    const ui = await mountPane($, "vscode")

    await ui.press({ key: "review-7" })
    await clock.settle()
    expect(world.asked).toBe(1)
    expect(editor.reads).toBe(0)

    world.answer = "New session"
    await ui.press({ key: "review-7" })
    await clock.settle()
    await ui.press({ key: "review-7" })
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("open cursor://"))).toHaveLength(2)
    expect(editor.reads).toBe(1)
  })

  test("from VS Code whose editor isn't found, New session tries VS Code's own link, and where it won't open, the review runs here", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      answer: "New session",
      instructions: "focus on the naming",
      openFailure: "LSOpenURLsWithRole() failed with error -10814"
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "vscode")
    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.commands.length > 0)

    const command = "/gh-prs-monitor:review https://github.com/acme/app/pull/7 -- focus on the naming"
    expect(seen.runs).toContain(`open vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(command)}`)
    expect(seen.commands).toEqual([command])
    expect(seen.toasts).toEqual([
      "#7: no new session opened (LSOpenURLsWithRole() failed with error -10814), so it runs in this one"
    ])
    expect(seen.notices).toEqual([])
    // Its row says so until the skill's turn ends, as one started with This session.
    await clock.settle()
    expect(await ui.find({ type: "Text", text: "Reviewing…" })).toBeDefined()
  })

  test("from VS Code, a command too long for a link runs the review here, its instructions with it", async ($, on) => {
    const clock = clockOf(on)
    const instructions = "focus on the naming ".repeat(300).trim()
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      surfaces: ["vscode"],
      answer: "New session",
      instructions
    }
    const seen = machine($, on, world)
    await $.session.start({ cwd: "/repo", surface: null, isInteractive: false })
    await clock.settle()

    const ui = await mountPane($, "vscode")
    await ui.press({ key: "review-7" })
    await settleAll(clock, seen, () => seen.commands.length > 0)

    expect(seen.runs.filter((run) => run.startsWith("open "))).toEqual([])
    expect(seen.commands).toEqual([`/gh-prs-monitor:review https://github.com/acme/app/pull/7 -- ${instructions}`])
    expect(seen.toasts).toEqual([
      "#7: no new session opened (its command is longer than the 5,000 characters a link may carry), so it runs in this one"
    ])
  })

  test("where no new session can be opened, as in the phone app, Review starts here", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "mobile")
    await ui.press({ key: "review-7" })

    expect(world.asked).toBe(undefined)
    expect(seen.commands).toEqual(["/gh-prs-monitor:review https://github.com/acme/app/pull/7"])
  })
})

describe("following a skill", () => {
  const TURN = { answer: "", durationMs: 1, isAborted: false, reason: "answer" } as never

  test("after Review starts the skill, each finished turn refreshes the list, at most every half minute", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" })
    await startSession($)
    await clock.settle()
    const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    const before = graphql()

    await $.turn.complete(TURN)
    await clock.settle()
    expect(graphql()).toBe(before)

    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.advance(MINUTE)
    const pressed = graphql()
    await $.turn.complete(TURN)
    await clock.settle()
    await $.turn.complete(TURN)
    await clock.settle()

    expect(graphql()).toBe(pressed + 1)
  })

  test("a bundled skill the person types is followed too, as in a session a button opened for it", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 })
    await startSession($)
    await clock.settle()
    const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    for (const command of ["gh-prs-monitor:review", "gh-prs-monitor:resolve-comments"]) {
      await $.command.run({ command, args: "https://github.com/acme/app/pull/7" } as Parameters<
        Engine["command"]["run"]
      >[0])
      await clock.advance(MINUTE)
      const typed = graphql()
      await $.turn.complete(TURN)
      await clock.settle()

      expect(graphql()).toBe(typed + 1)
    }
  })

  test("a subagent's turns ending refresh nothing: the turn that spawned them does, once it ends", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" })
    await startSession($)
    await clock.settle()
    const graphql = (): number => seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.advance(MINUTE)
    const pressed = graphql()

    await $.turn.complete({ ...(TURN as object), turnId: "explore-1", agentId: "agent-1" } as never)
    await clock.settle()
    expect(graphql()).toBe(pressed)

    await $.turn.complete(TURN)
    await clock.settle()
    expect(graphql()).toBe(pressed + 1)
  })

  test("what a refresh after a skill finds is alerted, as the timer's is", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.advance(MINUTE)

    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await $.turn.complete(TURN)
    await clock.settle()

    expect(seen.toasts).toEqual(["✗ #1 Fix the menu — CI failed"])
  })
})

describe("following a skill, within the refresh setting", () => {
  const TURN = { answer: "", durationMs: 1, isAborted: false, reason: "answer" } as never

  async function pressReviewThenTurn($: Engine, on: On, seen: Seen, clock: MockClock): Promise<number> {
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await ui.unmount()
    await clock.advance(MINUTE)
    const pressed = seen.runs.filter((run) => run.startsWith("gh api graphql")).length
    await $.turn.complete(TURN)
    await clock.settle()

    return seen.runs.filter((run) => run.startsWith("gh api graphql")).length - pressed
  }

  test("never on demand", { options: { refresh: "on-demand" } }, async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" })
    await startSession($)
    await runPrs($, "")
    await clock.settle()

    expect(await pressReviewThenTurn($, on, seen, clock)).toBe(0)
  })

  test("not once half an hour has passed", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    await clock.settle()
    await clock.advance(31 * MINUTE)
    const before = seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    await $.turn.complete(TURN)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("gh api graphql")).length).toBe(before)
  })

  test("in while-open mode, while the pane is up", { options: { refresh: "while-open" } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await runPrs($, "")
    await clock.settle()

    expect(await pressReviewThenTurn($, on, seen, clock)).toBe(1)
  })

  test("in while-open mode, not once the pane is closed", { options: { refresh: "while-open" } }, async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await runPrs($, "")
    await clock.settle()
    world.isPaneOpen = false

    expect(await pressReviewThenTurn($, on, seen, clock)).toBe(0)
  })

  test("not while a problem stopped the checks", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "This session" }
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "review-7" })
    // gh goes missing: the next check stops them all.
    world.isGhMissing = true
    await clock.advance(3 * MINUTE)
    const before = seen.runs.filter((run) => run.startsWith("gh api graphql")).length

    await $.turn.complete(TURN)
    await clock.settle()

    expect(seen.runs.filter((run) => run.startsWith("gh api graphql")).length).toBe(before)
  })
})
