// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine, MockClock, Mounted } from "claude-code/testing"

import { BACK_MARK } from "./keys"
import {
  MINUTE,
  clockOf,
  fieldKey,
  machine,
  settleAll,
  startSession,
  drawnNodes,
  mountPane,
  runPrs,
  GITHUB,
  pressDrawn
} from "./testing/world"
import type { Drawn, World } from "./testing/world"

// A Resolve Comments question left open, as the person sees it in the pane before answering.
async function openQuestion(
  $: Engine,
  on: On,
  key = "resolve-1"
): Promise<{ world: World; commands: string[]; ui: Mounted<"terminal", "Pane">; clock: MockClock }> {
  const clock = clockOf(on)
  const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  // The pane holds the keyboard, as after a press there in the terminal.
  const ui = await mountPane($, "terminal", 100, true)
  await ui.press({ key })
  await clock.settle()

  return { world, commands: seen.commands, ui, clock }
}

// The key the open question's field is drawn under.
async function fieldOf(ui: Mounted<"terminal", "Pane">): Promise<string> {
  return fieldKey(drawnNodes(await ui.drawn()))
}

// Resolve Comments asked in Claude Code's own dialog, as where the pane doesn't show, and answered with `answer`: what
// Claude is handed.
async function answeredInClaudeCodesDialog($: Engine, on: On, answer: string): Promise<string[]> {
  const clock = clockOf(on)
  const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer }
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  const ui = await mountPane($, "terminal")
  world.isPaneOpen = false
  await ui.press({ key: "resolve-1" })
  await settleAll(clock, seen, () => seen.commands.length > 0)

  return seen.commands
}

function texts(nodes: Drawn[]): unknown[] {
  return nodes.filter((node) => node.type === "Text").map((node) => node.children?.[0])
}

describe("the plugin's dialog", () => {
  test("a question takes the list's place: what it is about, the question and what its answers do, the field, an answer each, how to leave", async ($, on) => {
    const { commands, ui } = await openQuestion($, on)
    const nodes = drawnNodes(await ui.drawn())
    const buttons = nodes.filter((node) => node.type === "Button")
    const field = nodes.find((node) => node.type === "Input")

    expect(texts(nodes)).toEqual([
      "Resolve PR",
      "#1 Fix the menu",
      "Where should its review comments on fix/menu be resolved?",
      "Switching here stops rather than overwrite a file git ignores that the branch tracks, and reinstalls dependencies if the branch's lockfile differs; a worktree installs them in a folder of its own, leaving this checkout as it is. A new session opens with the command typed in, for you to send, and works in the worktree.",
      "They go with the answer you press, or Enter sends them alone to a worktree in this session.",
      "Esc cancels"
    ])
    expect(buttons.map((node) => node.props?.label)).toEqual([
      "Here, switch branch",
      "Worktree, this session",
      "Worktree, new session",
      "Cancel"
    ])
    // The field comes first: instructions are typed, then an answer pressed.
    expect(field?.props).toMatchObject({ label: "Instructions", placeholder: "Optional" })
    expect(String(field?.props?.key)).toMatch(/^answer-text-/)
    expect(nodes.indexOf(field!)).toBeLessThan(nodes.indexOf(buttons[0]!))
    expect(await ui.find({ key: "pr-1" })).toBeUndefined()

    await ui.press({ key: "answer-1" })
    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
    // Answered, the list is back.
    expect(await ui.find({ key: "pr-1" })).toBeDefined()
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
  })

  test("an empty Enter in the field is no answer; instructions sent alone work in a worktree in this session", async ($, on) => {
    const { commands, ui } = await openQuestion($, on)

    await ui.input({ key: await fieldOf(ui), text: "   " })
    expect(commands).toEqual([])

    await ui.input({ key: await fieldOf(ui), text: "only the naming ones" })
    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed" -- only the naming ones'
    ])
  })

  test("instructions typed, then an answer pressed, go with that answer; Cancel drops them", async ($, on) => {
    const { commands, ui } = await openQuestion($, on)

    await ui.input({ key: await fieldOf(ui), text: "only the naming ones", kind: "change" })
    await ui.press({ key: "answer-3" })
    expect(commands).toEqual([])

    await ui.press({ key: "resolve-1" })
    await ui.input({ key: await fieldOf(ui), text: "  only the naming ones ", kind: "change" })
    await ui.press({ key: "answer-1" })
    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed" -- only the naming ones'
    ])
  })

  test("each question's field has a key of its own, so what was typed for one never shows in the next", async ($, on) => {
    const { ui } = await openQuestion($, on)
    const first = await fieldOf(ui)

    await ui.input({ key: first, text: "only the naming ones", kind: "change" })
    await ui.press({ key: "answer-3" })
    await ui.press({ key: "resolve-1" })
    const field = drawnNodes(await ui.drawn()).find((node) => node.type === "Input")

    // The terminal keeps what was typed in a field under its key until the pane closes.
    expect(field?.props?.key).not.toBe(first)
    expect(field?.props?.value).toBe("")
    // While one question is open its field keeps its key, drawing after drawing.
    const again = await mountPane($, "desktop")
    expect(fieldKey(drawnNodes(await again.drawn()))).toBe(field?.props?.key)
  })

  test("an answer typed in the field and sent with Enter is that answer, in any case", async ($, on) => {
    const { commands, ui } = await openQuestion($, on)

    await ui.input({ key: await fieldOf(ui), text: " worktree, THIS session " })

    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("only spaces typed, then an answer pressed, send no instructions", async ($, on) => {
    const { commands, ui } = await openQuestion($, on)

    await ui.input({ key: await fieldOf(ui), text: "   ", kind: "change" })
    await ui.press({ key: "answer-1" })

    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("a confirmation takes no instructions, has no field, and marks what the button does as the main answer", async ($, on) => {
    const { world, ui } = await openQuestion($, on, "merge-2")
    const nodes = drawnNodes(await ui.drawn())

    expect(world.subject).toBe("#2 Add a legend")
    expect(world.question).toBe("Merge into main?")
    expect(nodes.some((node) => node.type === "Input")).toBe(false)
    // The repository's usual method comes first, a merge commit here.
    expect(world.choices).toEqual(["Create a merge commit", "Squash and merge", "Cancel"])
    expect(nodes.filter((node) => node.props?.variant === "primary").map((node) => node.props?.label)).toEqual([
      "Create a merge commit"
    ])
  })

  test("where to work has no main answer, as none is the one to press; the ring starts on the first", async ($, on) => {
    const { ui } = await openQuestion($, on)
    const buttons = drawnNodes(await ui.drawn()).filter((node) => node.type === "Button")

    expect(buttons.some((node) => node.props?.variant === "primary")).toBe(false)
    expect(buttons.filter((node) => node.props?.autoFocus).map((node) => node.props?.key)).toEqual(["answer-0"])
  })

  test("Escape is offered where it reaches the pane, the terminal; the phone app gets the answers alone", async ($, on) => {
    const { ui } = await openQuestion($, on)
    expect(texts(drawnNodes(await ui.drawn()))).toContain("Esc cancels")
    // Without the keyboard, Escape at the prompt could stop Claude's turn instead.
    await ui.unmount()
    const unfocused = drawnNodes(await (await mountPane($, "terminal", 100)).drawn())
    const desktop = drawnNodes(await (await mountPane($, "desktop")).drawn())
    const vscode = drawnNodes(await (await mountPane($, "vscode")).drawn())
    const mobile = drawnNodes(await (await mountPane($, "mobile", 40)).drawn())

    expect(texts(unfocused)).not.toContain("Esc cancels")
    expect(texts(vscode)).not.toContain("Esc cancels")
    expect(texts(desktop)).not.toContain("Esc cancels")
    expect(desktop.some((node) => node.type === "Input")).toBe(true)
    expect(texts(mobile)).not.toContain("Esc cancels")
    expect(mobile.some((node) => node.type === "Input")).toBe(false)
    expect(texts(mobile).join(" ")).not.toContain("Enter sends them alone")
    expect(texts(desktop).join(" ")).toContain("Enter sends them alone")
    expect(mobile.filter((node) => node.type === "Button")).toHaveLength(4)
  })

  test("framed as a dialog: the text wraps, and the answers sit apart in a row that wraps in a narrow pane", async ($, on) => {
    const { world, ui } = await openQuestion($, on)
    const nodes = drawnNodes(await ui.drawn())
    const question = nodes.find((node) => node.type === "Text" && node.children?.[0] === world.question)
    const subject = nodes.find((node) => node.type === "Text" && node.children?.[0] === world.subject)
    const detail = nodes.find((node) => node.type === "Text" && node.children?.[0] === world.detail)
    const note = nodes.find((node) => node.type === "Text" && String(node.children?.[0]).startsWith("They go with"))
    const answers = nodes.find(
      (node) => node.type === "Box" && (node.children ?? []).some((child) => (child as Drawn).type === "Button")
    )

    expect(nodes[0]?.props).toMatchObject({ borderStyle: "round", paddingX: 1 })
    // The header keeps its width and nothing is cut short: the subject, as all the rest, wraps; the detail is dim.
    const header = nodes.find((node) => node.type === "Text" && node.children?.[0] === "Resolve PR")
    const headerBox = nodes.find((node) => node.type === "Box" && (node.children ?? []).includes(header))
    expect(headerBox?.props?.flexShrink).toBe(0)
    expect(subject?.props).toMatchObject({ dimColor: true, wrap: "wrap" })
    // A subject too long to sit beside the header goes under it whole, rather than into a narrow strip.
    const subjectRow = nodes.find((node) => node.type === "Box" && (node.children ?? []).includes(headerBox))
    expect(subjectRow?.props).toMatchObject({ columnGap: 1, flexWrap: "wrap" })
    expect(question?.props?.wrap).toBe("wrap")
    expect(question?.props?.dimColor).toBeUndefined()
    expect(detail?.props).toMatchObject({ dimColor: true, wrap: "wrap" })
    expect(note?.props?.wrap).toBe("wrap")
    // One cell apart, as the pane's other buttons are; rows of them in the terminal one under the other, while an
    // app's, which are boxes, keep a line between them.
    expect(answers?.props).toMatchObject({ flexDirection: "row", flexWrap: "wrap", columnGap: 1, rowGap: 0 })
    const desktop = drawnNodes(await (await mountPane($, "desktop")).drawn()).find(
      (node) => node.type === "Box" && (node.children ?? []).some((child) => (child as Drawn).type === "Button")
    )
    expect(desktop?.props).toMatchObject({ columnGap: 1, rowGap: 1 })
  })

  test("a pane not shown, as one closed since the press, leaves the question to Claude Code's own dialog", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel" }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.isPaneOpen = false
    await ui.press({ key: "resolve-1" })
    await clock.settle()

    // Claude Code's dialog has a short header and one text: the subject and the detail go in the text, and
    // instructions typed under Other are sent alone.
    expect(world.header).toBe("Resolve PR")
    expect(world.question).toBe(
      "#1 Fix the menu — Where should its review comments on fix/menu be resolved? Switching here stops rather than overwrite a file git ignores that the branch tracks, and reinstalls dependencies if the branch's lockfile differs; a worktree installs them in a folder of its own, leaving this checkout as it is. A new session opens with the command typed in, for you to send, and works in the worktree. Instructions typed under Other go to a worktree in this session."
    )
    expect(world.choices).toEqual(["Here, switch branch", "Worktree, this session", "Worktree, new session", "Cancel"])
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    expect(seen.commands).toEqual([])
  })

  test("in Claude Code's own dialog, an answer picked goes where it says", async ($, on) => {
    expect(await answeredInClaudeCodesDialog($, on, "Worktree, this session")).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("in Claude Code's own dialog, a label typed in another case is that answer", async ($, on) => {
    expect(await answeredInClaudeCodesDialog($, on, "worktree, THIS session")).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("in Claude Code's own dialog, instructions typed under Other go to a worktree in this session", async ($, on) => {
    expect(await answeredInClaudeCodesDialog($, on, "only the naming ones")).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed" -- only the naming ones'
    ])
  })

  test("a pane behind another, as a tab, leaves the question to Claude Code's own dialog too", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "Cancel", isPaneBehind: true }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.header).toBe("Merge PR")
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
  })

  test("an answer typed in Claude Code's dialog that names no choice sends nothing, and says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, answer: "yes please", isPaneBehind: true }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await ui.press({ key: "merge-2" })
    await clock.settle()

    expect(world.header).toBe("Merge PR")
    expect(seen.runs.filter((run) => run.startsWith("gh pr merge"))).toEqual([])
    expect(seen.toasts).toContain("Nothing was sent: pick one of the answers to go ahead.")
  })

  test("a question whose pane went comes back when /prs opens it again, and is still answered there", async ($, on) => {
    const { world, commands, ui } = await openQuestion($, on)

    // The pane goes; the person opens it again with /prs.
    world.isPaneOpen = false
    await runPrs($, "")
    await ui.press({ key: "answer-1" })

    expect(commands).toEqual([
      '/gh-prs-monitor:resolve-comments https://github.com/acme/app/pull/1 --worktree "/repo/.claude/worktrees/pr-1" --deps "no lockfile the plugin installs from, nothing installed"'
    ])
  })

  test("/prs close takes a question down with the pane: nothing is sent, and the list is back when it opens again", async ($, on) => {
    const { world, commands, ui, clock } = await openQuestion($, on)

    const ran = await runPrs($, "close")
    await clock.settle()

    expect(ran.text).toBe("Closed the pull requests pane.")
    expect(world.isPaneOpen).toBe(false)
    await runPrs($, "")
    await clock.settle()
    expect(commands).toEqual([])
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    expect(await ui.find({ key: "pr-1" })).toBeDefined()
  })

  test("a reload takes down a question whose flow went with the module", async ($, on) => {
    const { ui } = await openQuestion($, on)

    await startSession($)

    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    expect(await ui.find({ key: "pr-1" })).toBeDefined()
  })

  test("a question no press waits on any more is drawn no more: the list comes back", async ($, on) => {
    // The write that puts the question away keeps it, as one that never took effect would.
    let kept: unknown = null
    on("state.set", { plugin: "gh-prs-monitor", key: "dialog" }, async (_, e, next) => {
      kept = e.value ?? kept

      return next({ ...e, value: kept } as typeof e)
    })
    const { ui, clock } = await openQuestion($, on)

    await ui.press({ key: "answer-3" })
    await clock.settle()

    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    expect(await ui.find({ key: "pr-1" })).toBeDefined()
  })

  test("an answer whose put-away Claude Code never answers still goes ahead", async ($, on) => {
    const clock = clockOf(on)
    let isAsked = false
    on("state.set", { plugin: "gh-prs-monitor", key: "dialog" }, async (_, e, next) => {
      isAsked ||= e.value !== null
      if (e.value === null && isAsked) {
        // A day, far past the test's end.
        await clock.sleep(24 * 60 * MINUTE)
      }

      return next(e)
    })
    const world: World = {
      github: { mine: [{ number: 2, title: "Add a legend", reviewDecision: "APPROVED" }] },
      branch: "main",
      uncommitted: 0
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal", 100, true)

    await ui.press({ key: "merge-2" })
    await clock.settle()
    void ui.press({ key: "answer-0" })
    await clock.advance(10_000)

    expect(seen.runs.filter((run) => run.startsWith("gh pr merge"))).toHaveLength(1)
    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
  })

  test("a question answered in the pane brings the list back marked on the row the window showed, for the window to go back to, and the mark goes after", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    // The terminal's drawing says where its window stands.
    const ui = await mountPane($, "terminal", 100, true, 7)
    expect(await ui.find({ key: BACK_MARK })).toBeUndefined()
    await ui.press({ key: "resolve-1" })
    await clock.settle()
    expect(await ui.find({ key: BACK_MARK })).toBeUndefined()

    await ui.press({ key: "answer-3" })
    await clock.settle()
    const mark = await ui.find({ key: BACK_MARK })
    expect(mark?.props).toMatchObject({ position: "absolute", top: 7, left: 0, width: 1, height: 1 })
    expect(mark?.children ?? []).toEqual([])
    expect(await ui.find({ key: "pr-1" })).toBeDefined()

    await clock.advance(5_000)
    expect(await ui.find({ key: BACK_MARK })).toBeUndefined()
  })

  test("in the desktop app, which moves the window without drawing the pane again, the row marked is where the person's last move over the list landed", async ($, on) => {
    const clock = clockOf(on)
    // The engine's own part of a move, beneath the plugin's hook.
    on("ui.scroll", async () => ({}))
    machine($, on, { github: GITHUB, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "desktop")
    const moveTo = (offset: number) =>
      $.ui.scroll({
        component: "Pane",
        requestId: "gh-prs-monitor",
        offset,
        by: offset,
        bodyRows: 30,
        contentRows: 80,
        origin: { kind: "person" }
      })
    await moveTo(9)
    await ui.press({ key: "resolve-1" })
    await clock.settle()
    // A move over the question is not one over the list.
    await moveTo(2)

    await ui.press({ key: "answer-3" })
    await clock.settle()
    expect((await ui.find({ key: BACK_MARK }))?.props).toMatchObject({ top: 9 })
    await clock.advance(5_000)
    expect(await ui.find({ key: BACK_MARK })).toBeUndefined()

    // The window went back there, so the next question goes back there too.
    await ui.press({ key: "resolve-1" })
    await clock.settle()
    await pressDrawn(clock, ui, "answer-3")
    await clock.settle()
    expect((await ui.find({ key: BACK_MARK }))?.props).toMatchObject({ top: 9 })
    await clock.advance(5_000)

    // Closed and opened again, the pane's window starts at the top, and a question goes back there.
    await ui.unmount()
    await runPrs($, "")
    expect((await runPrs($, "close")).text).toBe("Closed the pull requests pane.")
    await runPrs($, "")
    await clock.settle()
    const again = await mountPane($, "desktop")
    await again.press({ key: "resolve-1" })
    await clock.settle()
    await pressDrawn(clock, again, "answer-3")
    await clock.settle()
    expect((await again.find({ key: BACK_MARK }))?.props).not.toMatchObject({ top: 9 })
  })

  // The kit models no keyboard and raises no close by the person, so the ring moving onto the first answer and back to
  // the pressed button, Escape, the close mark and a pane that goes unheard are left untested. The close answers null,
  // as Cancel does, through the `ui.close` hook, which also forgets the window (through `/prs close` above). Nor does
  // the kit carry out a plugin's own scroll: the question showing from the top is left untested, and the window's way
  // back to the mark is tested through a host of its own (`goBack`, helpers.test.ts).
})
