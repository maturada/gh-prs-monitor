// Author: David Matura

import type { AskOptions } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import type { Answer, Question } from "../types"
import { ask, closeAsked, drawnQuestion, dropAsked, isQuestionOpen, OPEN_QUESTION_NOTE } from "./dialog-flow"
import type { DialogHost } from "./dialog-flow"
import { pickKey } from "./keys"
import { createSession } from "./session"
import type { OpenQuestion, Session } from "./session"
import { readSettings } from "./settings"
import { promisesRun } from "./testing/promises"

const PANE = "gh-prs-monitor"

const QUESTION: Question = {
  header: "Merge",
  subject: "#7 Fix the menu",
  text: "Merge it?",
  detail: null,
  choices: ["Merge", "Cancel"],
  main: "Merge",
  instructions: null
}

const MERGE: Answer = { choice: "Merge", instructions: "" }

// A host that keeps what the dialog did: the questions the pane showed (null where it showed the list again), the
// notes, where the window and the keyboard went, what Claude Code's dialog asked and offered, and the work left
// running. Where the pane shows, which panes there are, and what Claude Code's dialog answers to what it offers, the
// test says; `hold("look")` makes the pane's look wait, `hold("list")` the pane's going back to the list,
// `hold("wait")` a pause, until `release`.
function hostOf(
  options: { isShown?: boolean; panes?: string[]; engine?: (offered: AskOptions) => Promise<string> } = {}
) {
  const seen = {
    shown: [] as (string | null)[],
    notes: [] as string[],
    focused: [] as string[],
    tops: 0,
    engine: [] as string[],
    offered: [] as AskOptions[],
    background: 0
  }
  const held = { look: false, list: false, wait: false }
  const waiting: (() => void)[] = []
  const later = <T>(kind: keyof typeof held, value: T): Promise<T> =>
    held[kind] ? new Promise((resolve) => waiting.push(() => resolve(value))) : Promise.resolve(value)
  const host: DialogHost = {
    pane: PANE,
    now: async () => 1_000,
    sleep: async () => {},
    after: (_ms, fire) => {
      void later("wait", undefined).then(fire)

      return { cancel: () => {} }
    },
    background: () => {
      seen.background += 1
    },
    notify: async (text) => {
      seen.notes.push(text)
    },
    panes: async () =>
      (options.panes ?? [PANE]).map((id) => ({
        id,
        title: "Pull Requests",
        isShown: true,
        isFocused: false,
        isPlaced: true
      })),
    surfaces: async () => ["terminal"],
    isPaneShown: () => later("look", options.isShown ?? true),
    showQuestion: (question) => {
      seen.shown.push(question?.subject ?? null)

      return question === null ? later("list", undefined) : Promise.resolve(undefined)
    },
    scrollToTop: async () => {
      seen.tops += 1

      return {}
    },
    scrollTo: async () => ({}),
    focus: async (key) => {
      seen.focused.push(key)
    },
    redraw: () => {},
    askInEngine: (text, offered) => {
      seen.engine.push(text)
      seen.offered.push(offered)

      return options.engine?.(offered) ?? Promise.resolve("Merge")
    }
  }

  return {
    host,
    seen,
    hold: (kind: keyof typeof held) => {
      held[kind] = true
    },
    release: () => {
      held.look = false
      held.list = false
      held.wait = false
      waiting.splice(0).forEach((resume) => resume())
    }
  }
}

// What a promise came to once every turn has run, or "pending".
async function settled<T>(promise: Promise<T>): Promise<T | "pending"> {
  return Promise.race([promise, promisesRun(20).then(() => "pending" as const)])
}

function sessionOf(): Session {
  return createSession(readSettings({}))
}

// The question open now, answered as the pane's buttons answer it.
function answerAsked(session: Session, answer: Answer | null): void {
  ;(session.asking as OpenQuestion).answer(answer)
}

describe("an answer checked before the question closes", () => {
  test("while it is checked the question says so; a problem keeps it open and says why; one that passes closes it", async () => {
    const session = sessionOf()
    const { host } = hostOf()
    const results = ["No access to acme/wbe.", null]
    const checked: string[] = []
    let release = () => {}
    const check = async (answer: Answer) => {
      checked.push(answer.instructions)
      await new Promise<void>((resolve) => (release = resolve))

      const problem = results.shift() ?? null

      return problem === null ? { isChanged: true } : { problem }
    }

    const answered = ask(host, session, QUESTION, "refresh", check)
    await promisesRun(20)
    answerAsked(session, { choice: "Merge", instructions: "acme/wbe" })
    expect(session.asking?.checking).toEqual({ choice: "Merge", instructions: "acme/wbe" })
    // A press while it is checked does nothing.
    answerAsked(session, { choice: "Merge", instructions: "acme/other" })
    release()
    await promisesRun(20)
    expect(session.asking?.checking).toBe(null)
    expect(session.asking?.problem).toBe("No access to acme/wbe.")

    answerAsked(session, { choice: "Merge", instructions: "acme/web" })
    release()
    expect(await answered).toEqual({ choice: "Merge", instructions: "acme/web" })
    expect(checked).toEqual(["acme/wbe", "acme/web"])
  })

  test("Cancel is no answer to check, and closes it at once", async () => {
    const session = sessionOf()
    const { host } = hostOf()
    const checked: Answer[] = []
    const answered = ask(host, session, QUESTION, "refresh", async (answer) => {
      checked.push(answer)

      return { isChanged: true }
    })
    await promisesRun(20)
    answerAsked(session, { choice: "Cancel", instructions: "" })

    expect(await answered).toEqual({ choice: "Cancel", instructions: "" })
    expect(checked).toEqual([])
  })

  test("in Claude Code's own dialog, the answer is checked once given, and a problem is told", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false, engine: async () => "Merge" })

    const answered = await ask(host, session, QUESTION, "refresh", async () => ({ problem: "No access to acme/wbe." }))

    expect(answered).toBe(null)
    expect(seen.notes).toEqual(["No access to acme/wbe."])
  })

  test("an answer carried out is wanted until the question is answered otherwise, as by Cancel while it is checked", async () => {
    const session = sessionOf()
    const { host } = hostOf()
    let isWanted = () => false
    let release = () => {}
    const answered = ask(host, session, QUESTION, "refresh", async (_answer, wanted) => {
      isWanted = wanted
      await new Promise<void>((resolve) => (release = resolve))

      return { isChanged: true }
    })
    await promisesRun(20)

    answerAsked(session, { choice: "Merge", instructions: "acme/web" })
    expect(isWanted()).toBe(true)
    answerAsked(session, { choice: "Cancel", instructions: "" })
    expect(isWanted()).toBe(false)
    expect(await answered).toEqual({ choice: "Cancel", instructions: "" })
    release()
  })

  test("one carried out changed what the pane shows: its window starts at the top, the keyboard on the button pressed", async () => {
    const session = sessionOf()
    const carried = hostOf()
    const answered = ask(carried.host, session, QUESTION, "repo", async () => ({ isChanged: true }))
    await promisesRun(20)
    const tops = carried.seen.tops
    answerAsked(session, { choice: "Merge", instructions: "acme/web" })
    await answered
    await promisesRun(20)

    expect(session.goingBack).toBe(null)
    expect(carried.seen.tops).toBe(tops + 1)
    expect(carried.seen.focused.at(-1)).toBe("repo")

    const plain = hostOf()
    const asked = ask(plain.host, session, QUESTION, "repo")
    await promisesRun(20)
    answerAsked(session, { choice: "Merge", instructions: "" })
    await asked
    expect(session.goingBack).not.toBe(null)
  })

  test("one carried out that changed nothing puts the window back on its row, as Cancel does", async () => {
    const session = sessionOf()
    session.listOffset = 40
    const { host } = hostOf()
    const answered = ask(host, session, QUESTION, "repo", async () => ({ isChanged: false }))
    await promisesRun(20)

    answerAsked(session, { choice: "Merge", instructions: "nope" })
    await answered

    expect(session.goingBack).toEqual({ offset: 40 })
  })

  test("once one changed what the pane shows, the next question goes back to its top, not the old list's row", async () => {
    const session = sessionOf()
    session.listOffset = 40
    const { host } = hostOf()
    const answered = ask(host, session, QUESTION, "repo", async () => ({ isChanged: true }))
    await promisesRun(20)
    answerAsked(session, { choice: "Merge", instructions: "acme/web" })
    await answered

    const next = ask(host, session, QUESTION, "refresh")
    await promisesRun(20)
    answerAsked(session, { choice: "Cancel", instructions: "" })
    await next

    expect(session.goingBack).toEqual({ offset: 0 })
  })

  test("answered in the pane before the pane's look comes back, and kept open by a problem, it is the pane's still", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf({ isShown: false })
    hold("look")
    const answered = ask(host, session, QUESTION, "refresh", async () => ({ problem: "No access to acme/wbe." }))
    await promisesRun(20)

    answerAsked(session, { choice: "Merge", instructions: "acme/wbe" })
    await promisesRun(20)
    release()
    await promisesRun(20)

    // Neither put away nor asked in Claude Code's own dialog.
    expect(seen.shown).toEqual([QUESTION.subject])
    expect(seen.engine).toEqual([])
    expect(await settled(answered)).toBe("pending")
    expect(session.asking?.problem).toBe("No access to acme/wbe.")
  })

  test("answered in the pane as it is put away, it is drawn again, not asked in Claude Code's own dialog", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf({ isShown: false })
    hold("list")
    let done = () => {}
    const answered = ask(host, session, QUESTION, "refresh", async () => {
      await new Promise<void>((resolve) => (done = resolve))

      return { isChanged: true }
    })
    await promisesRun(20)

    answerAsked(session, { choice: "Merge", instructions: "acme/web" })
    release()
    await promisesRun(20)
    expect(seen.shown).toEqual([QUESTION.subject, null, QUESTION.subject])
    done()

    expect(await answered).toEqual({ choice: "Merge", instructions: "acme/web" })
    expect(seen.engine).toEqual([])
  })

  test("in Claude Code's own dialog, a check that fails outright is told as its problem would be", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false, engine: async () => "Merge" })

    const answered = await ask(host, session, QUESTION, "refresh", async () => {
      throw new Error("gh: connection refused")
    })

    expect(answered).toBe(null)
    expect(seen.notes).toEqual(["gh: connection refused"])
  })

  test("in Claude Code's own dialog, Cancel is no answer to carry out either", async () => {
    const session = sessionOf()
    const { host } = hostOf({ isShown: false, engine: async () => "Cancel" })
    const checked: Answer[] = []

    const answered = await ask(host, session, QUESTION, "refresh", async (answer) => {
      checked.push(answer)

      return { problem: "never" }
    })

    expect(answered).toEqual({ choice: "Cancel", instructions: "" })
    expect(checked).toEqual([])
  })

  test("in Claude Code's own dialog, an answer that passes its check is the answer, nothing told", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false, engine: async () => "Merge" })
    const checked: string[] = []

    const answered = await ask(host, session, QUESTION, "refresh", async (answer) => {
      checked.push(String(answer.choice))

      return { isChanged: true }
    })

    expect(answered).toEqual({ choice: "Merge", instructions: "" })
    expect(checked).toEqual(["Merge"])
    expect(seen.notes).toEqual([])
  })
})

describe("a question given up as /prs shows something else", () => {
  test("one open in the pane is cancelled, and the window goes back to no row of the list it covered", async () => {
    const session = sessionOf()
    session.listOffset = 40
    const { host } = hostOf()
    const answered = ask(host, session, QUESTION, "refresh")
    await promisesRun(20)

    dropAsked(session)

    expect(await answered).toBe(null)
    expect(session.goingBack).toBe(null)
    expect(session.listOffset).toBe(0)
    expect(session.asking).toBe(null)
  })

  test("its answer being carried out is no longer wanted", async () => {
    const session = sessionOf()
    const { host } = hostOf()
    let isWanted = () => true
    const answered = ask(host, session, QUESTION, "refresh", async (_answer, wanted) => {
      isWanted = wanted
      await promisesRun(50)

      return { isChanged: true }
    })
    await promisesRun(20)
    answerAsked(session, { choice: "Merge", instructions: "acme/web" })

    dropAsked(session)

    expect(isWanted()).toBe(false)
    expect(await answered).toBe(null)
  })

  test("one that only tells, asked where the pane doesn't show, is told instead: Claude Code's dialog would pad it", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false })
    const tells: Question = { ...QUESTION, choices: ["OK"], main: "OK" }

    expect(await ask(host, session, tells, "refresh")).toEqual({ choice: "OK", instructions: "" })
    expect(seen.engine).toEqual([])
    expect(seen.notes).toEqual([`${tells.subject} — ${tells.text}`])
  })

  test("one answered that still shows while it is put away is let go at once", async () => {
    const session = sessionOf()
    const { host, hold, release } = hostOf()
    const answered = ask(host, session, QUESTION, "refresh")
    await promisesRun(20)
    // Its put-away hangs, and so does the wait that would let it go.
    hold("list")
    hold("wait")
    answerAsked(session, { choice: "Merge", instructions: "" })
    await promisesRun(20)
    expect(session.asking?.isAnswered).toBe(true)

    dropAsked(session)

    expect(session.asking).toBe(null)
    release()
    expect(await answered).toEqual({ choice: "Merge", instructions: "" })
  })

  test("another may be asked at once, and the given up one's late put-away leaves it open", async () => {
    const session = sessionOf()
    const { host, hold, release } = hostOf()
    const first = ask(host, session, QUESTION, "refresh")
    await promisesRun(20)
    hold("list")
    hold("wait")
    answerAsked(session, { choice: "Merge", instructions: "" })
    await promisesRun(20)

    expect(dropAsked(session)).toBe(true)
    const next: Question = { ...QUESTION, subject: "#7 Another" }
    void ask(host, session, next, "refresh")
    await promisesRun(20)
    release()
    await first
    await promisesRun(20)

    expect(session.asking?.question.subject).toBe("#7 Another")
  })

  test("one asked in Claude Code's own dialog stays", async () => {
    const session = sessionOf()
    let answer = (_text: string) => {}
    const { host } = hostOf({ isShown: false, engine: () => new Promise((resolve) => (answer = resolve)) })
    const answered = ask(host, session, QUESTION, "refresh")
    await promisesRun(20)

    dropAsked(session)
    expect(await settled(answered)).toBe("pending")
    answer("Merge")

    expect(await answered).toEqual({ choice: "Merge", instructions: "" })
  })
})

describe("asking in the pane", () => {
  test("a question with more answers than Claude Code's own dialog takes stays in the pane, though it's behind", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false })
    const remove: Question = { ...QUESTION, choices: ["Remove A-", "Remove B-", "Remove C-", "Remove D-", "Cancel"] }

    const answered = ask(host, session, remove, "refresh")
    await promisesRun(20)
    expect(seen.engine).toEqual([])
    answerAsked(session, { choice: "Remove D-", instructions: "" })
    expect(await answered).toEqual({ choice: "Remove D-", instructions: "" })
  })

  test("one with more answers than Claude Code's own dialog takes goes there still where no pane is placed", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false, panes: [] })
    const remove: Question = { ...QUESTION, choices: ["Remove A-", "Remove B-", "Remove C-", "Remove D-", "Cancel"] }

    await settled(ask(host, session, remove, "refresh"))
    expect(seen.engine).toHaveLength(1)
  })

  test("a question that offers names to pick opens with its first picks, the keyboard on its first name", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()
    const picking = { names: ["A", "B"], isSingle: false, initial: [1], needsPick: true, startsOn: "names" as const }

    const answered = ask(host, session, { ...QUESTION, picking }, "refresh")
    await promisesRun(20)
    expect(session.asking?.question).toEqual({ ...QUESTION, picking })
    expect(session.asking?.picks).toEqual([1])
    expect(seen.focused).toEqual([pickKey(0)])
    answerAsked(session, null)
    expect(await answered).toBeNull()
  })

  test("one with a field of its own puts the keyboard there, though it offers names first", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()
    const picking = { names: ["A", "B"], isSingle: false, initial: [], needsPick: true, startsOn: "names" as const }
    const field = { label: "Note", placeholder: "Optional", submitLabel: "Send", otherHint: "Type it." }

    const answered = ask(host, session, { ...QUESTION, picking, field }, "refresh")
    await promisesRun(20)
    expect(seen.focused).toEqual([(session.asking as OpenQuestion).fieldKey])
    answerAsked(session, null)
    await answered
  })

  test("one whose keyboard starts on its answers puts it on the first answer, as other questions do", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()
    const picking = { names: ["A", "B"], isSingle: true, initial: [0], needsPick: false, startsOn: "answers" as const }

    const answered = ask(host, session, { ...QUESTION, picking }, "refresh")
    await promisesRun(20)
    expect(seen.focused).toEqual(["answer-0"])
    answerAsked(session, null)
    await answered
  })

  test("a question that asks for a piece of text puts the keyboard in its field", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()
    const field = { label: "Ticket link", placeholder: "https://…", submitLabel: "Check", otherHint: "Paste it." }

    const answered = ask(host, session, { ...QUESTION, field }, "refresh")
    await promisesRun(20)
    expect(seen.focused).toEqual([(session.asking as OpenQuestion).fieldKey])
    answerAsked(session, null)
    expect(await answered).toBeNull()
  })

  test("the question takes the list's place, the keyboard on its first answer, and the answer comes back", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    expect(seen).toMatchObject({ shown: ["#7 Fix the menu"], tops: 1, focused: ["answer-0"], engine: [] })
    answerAsked(session, MERGE)
    expect(await answered).toEqual(MERGE)
    expect(seen.shown).toEqual(["#7 Fix the menu", null])
    expect(session.asking).toBeNull()
    expect(session.goingBack).toEqual({ offset: session.listOffset })
    expect(seen.background).toBe(1)
  })

  test("while one is open, another is not asked, and the person is told to answer it first", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()

    const first = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    expect(await ask(host, session, { ...QUESTION, subject: "#8 Other" }, "merge-8")).toBeNull()
    expect(seen.notes).toEqual([OPEN_QUESTION_NOTE])
    expect(seen.shown).toEqual(["#7 Fix the menu"])
    answerAsked(session, null)
    expect(await first).toBeNull()
  })

  test("one whose pane went unheard counts as closed, and the next question cancels it", async () => {
    const session = sessionOf()
    const panes = [PANE]
    const { host } = hostOf({ panes })

    const first = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    expect(await isQuestionOpen(host, session)).toBe(true)
    panes.length = 0
    expect(await isQuestionOpen(host, session)).toBe(false)
    const second = ask(host, session, { ...QUESTION, subject: "#8 Other" }, "merge-8")
    expect(await settled(first)).toBeNull()
    await promisesRun(20)
    answerAsked(session, MERGE)
    expect(await second).toEqual(MERGE)
  })

  test("a question in Claude Code's dialog stays open whatever the panes", async () => {
    const session = sessionOf()
    session.asking = {
      question: QUESTION,
      answer: () => {},
      isAnswered: false,
      isInPane: false,
      fieldKey: "answer-text-1",
      draft: "",
      keystroke: null,
      picks: [],
      checking: null,
      problem: null
    }

    expect(await isQuestionOpen(hostOf({ panes: [] }).host, session)).toBe(true)
  })

  test("answered before the pane's look came back: the keyboard is not moved", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf()
    hold("look")

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerAsked(session, MERGE)
    expect(await answered).toEqual(MERGE)
    release()
    await promisesRun(20)
    // The keyboard goes back to the button pressed, as after any answer, never onto the question's.
    expect(seen).toMatchObject({ tops: 0, focused: ["merge-7"], engine: [] })
  })

  test("a window still going back after an earlier question stops where it is", async () => {
    const session = sessionOf()
    session.goingBack = { offset: 12 }
    const { host } = hostOf()

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    expect(session.goingBack).toBeNull()
    answerAsked(session, null)
    await answered
  })

  test("a question a later one replaced leaves the later one's in place", async () => {
    const session = sessionOf()
    const panes = [PANE]
    const { host, seen } = hostOf({ panes })

    const first = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    panes.length = 0
    const second = ask(host, session, { ...QUESTION, subject: "#8 Other" }, "merge-8")
    await first
    await promisesRun(20)
    expect(seen.shown.at(-1)).toBe("#8 Other")
    expect(session.asking).not.toBeNull()
    answerAsked(session, null)
    await second
  })

  test("the next question waits until this one's is put away", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf()

    const first = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    // The put-away under way, within the pause it is given.
    hold("list")
    hold("wait")
    answerAsked(session, MERGE)
    await promisesRun(20)
    const second = ask(host, session, { ...QUESTION, subject: "#8 Other" }, "merge-8")
    await promisesRun(20)
    expect(seen.notes).toEqual([OPEN_QUESTION_NOTE])
    expect(seen.shown).not.toContain("#8 Other")
    release()
    expect(await first).toEqual(MERGE)
    expect(await second).toBeNull()
  })
})

describe("asking where the pane doesn't show", () => {
  test("Claude Code's dialog asks, the list comes back, and the window goes back nowhere", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false })

    expect(await ask(host, session, QUESTION, "merge-7")).toEqual(MERGE)
    expect(seen.engine).toEqual(["#7 Fix the menu — Merge it?"])
    // The list comes back as the pane gives the question up, and again as the question ends.
    expect(seen.shown).toEqual(["#7 Fix the menu", null, null])
    expect(session.goingBack).toBeNull()
    expect(seen.background).toBe(0)
  })

  test("answered while the pane gives the question up: Claude Code's dialog is not opened", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf({ isShown: false })
    hold("list")

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerAsked(session, null)
    await promisesRun(20)
    release()
    expect(await answered).toBeNull()
    await promisesRun(20)
    expect(seen.engine).toEqual([])
  })

  test("dismissing Claude Code's dialog is no answer", async () => {
    const session = sessionOf()
    const { host } = hostOf({ isShown: false, engine: () => Promise.reject(new Error("dismissed")) })

    expect(await ask(host, session, QUESTION, "merge-7")).toBeNull()
  })
})

describe("a question that offers names, where the pane doesn't show", () => {
  // Request Review's: any number of the people GitHub suggests, none at first.
  const PEOPLE: Question = {
    header: "Request",
    subject: "#7 Fix the menu",
    text: "Who should review it?",
    detail: null,
    choices: ["Request Review", "Cancel"],
    main: "Request Review",
    instructions: null,
    picking: { names: ["kim", "lou"], isSingle: false, initial: [], needsPick: true, startsOn: "names" }
  }
  // Re-Review's: one kind of review of two, what changed at first, then where it runs, with room for instructions.
  const KIND: Question = {
    header: "Review PR",
    subject: "#7 Fix the menu",
    text: "What should it cover, and where?",
    detail: "New commits came in since.",
    choices: ["This session", "New session", "Cancel"],
    main: null,
    instructions: "to a review in this session",
    picking: {
      names: ["Since Your Review", "Full Review"],
      isSingle: true,
      initial: [0],
      needsPick: false,
      startsOn: "answers",
      steps: {
        names: { text: "What should it cover?", detail: "New commits came in since." },
        answers: { text: "Where should it be reviewed?", detail: "Here it runs in this conversation." }
      }
    }
  }

  // Claude Code's dialog answering the names it offers with `names`, and the answers with `answer`.
  function answering(names: string, answer = "Cancel") {
    return hostOf({
      isShown: false,
      engine: async (offered) => (offered.options?.includes("Cancel") && offered.options.length > 2 ? answer : names)
    })
  }

  test("several names: ticked in one step, which is the request, carrying the names ticked in their order", async () => {
    const { host, seen } = answering("lou, KIM")

    expect(await ask(host, sessionOf(), PEOPLE, "request-7")).toEqual({
      choice: "Request Review",
      instructions: "",
      picks: ["kim", "lou"]
    })
    expect(seen.engine).toEqual(["#7 Fix the menu — Who should review it?"])
    expect(seen.offered).toEqual([{ header: "Request", options: ["kim", "lou"], multiSelect: true }])
  })

  test("what is typed beside the names picks no one; with no one ticked, nobody is asked", async () => {
    expect(await ask(answering("kim, ping the whole team").host, sessionOf(), PEOPLE, "request-7")).toEqual({
      choice: "Request Review",
      instructions: "",
      picks: ["kim"]
    })
    expect(await ask(answering("the whole team").host, sessionOf(), PEOPLE, "request-7")).toBeNull()
  })

  test("a question with a field of its own takes what is typed under Other as typed there; a decline cancels", async () => {
    const field = { label: "Type one", placeholder: "owner/name", submitLabel: "Show", otherHint: "Type one." }
    const repos: Question = {
      ...PEOPLE,
      header: "Repositories",
      subject: "",
      text: "Which repository's pull requests should the pane show?",
      choices: ["Show", "Cancel"],
      main: "Show",
      picking: { names: ["acme/app", "acme/web"], isSingle: true, initial: [0], needsPick: false, startsOn: "names" },
      field
    }

    const typed = answering(" acme/r5 ")
    expect(await ask(typed.host, sessionOf(), repos, "repo")).toEqual({ choice: "Show", instructions: "acme/r5" })
    // The names say what may be typed instead; a question about no one pull request leads with its text.
    expect(typed.seen.engine[0]).toBe("Which repository's pull requests should the pane show? Type one.")
    expect(await ask(answering("never mind").host, sessionOf(), repos, "repo")).toBeNull()
    expect(await ask(answering("acme/web").host, sessionOf(), repos, "repo")).toEqual({
      choice: "Show",
      instructions: "",
      picks: ["acme/web"]
    })
  })

  test("a lone name is offered beside Cancel, not padded with Yes and No", async () => {
    const lone: Question = { ...PEOPLE, picking: { ...PEOPLE.picking!, names: ["lou"] } }
    const yes = hostOf({ isShown: false, engine: async () => "lou" })

    expect(await ask(yes.host, sessionOf(), lone, "request-7")).toEqual({
      choice: "Request Review",
      instructions: "",
      picks: ["lou"]
    })
    expect(yes.seen.offered).toEqual([{ header: "Request", options: ["lou", "Cancel"] }])
    const no = hostOf({ isShown: false, engine: async () => "Cancel" })
    expect(await ask(no.host, sessionOf(), lone, "request-7")).toBeNull()
    // Where one name is always picked, Cancel beside it is no answer still.
    const loneKind: Question = { ...KIND, picking: { ...KIND.picking!, names: ["Full Review"] } }
    expect(await ask(no.host, sessionOf(), loneKind, "review-7")).toBeNull()
  })

  test("one of two: what to cover, then where, the instructions' hint only with where", async () => {
    const { host, seen } = answering("Full Review", "This session")

    expect(await ask(host, sessionOf(), KIND, "review-7")).toEqual({
      choice: "This session",
      instructions: "",
      picks: ["Full Review"]
    })
    // Each step says what it asks.
    expect(seen.engine).toEqual([
      "#7 Fix the menu — What should it cover? New commits came in since.",
      "#7 Fix the menu — Where should it be reviewed? Here it runs in this conversation. Instructions typed under Other go to a review in this session."
    ])
    expect(seen.offered).toEqual([
      { header: "Review PR", options: ["Since Your Review", "Full Review"] },
      { header: "Review PR", options: ["This session", "New session", "Cancel"] }
    ])
  })

  test("an answer that names nothing while it asks what to cover is no answer, a decline above all; typed while it asks where, it is instructions", async () => {
    for (const typed of ["no thanks", "cancel", "be thorough"]) {
      expect(await ask(answering(typed, "This session").host, sessionOf(), KIND, "review-7")).toBeNull()
    }
    expect(await ask(answering("full review", "only the tests").host, sessionOf(), KIND, "review-7")).toEqual({
      choice: null,
      instructions: "only the tests",
      picks: ["Full Review"]
    })
  })

  test("with one place to start from, it asks only what to cover", async () => {
    const here: Question = { ...KIND, choices: ["Start Review", "Cancel"], instructions: null }
    const { host, seen } = answering("Full Review")

    expect(await ask(host, sessionOf(), here, "review-7")).toEqual({
      choice: "Start Review",
      instructions: "",
      picks: ["Full Review"]
    })
    expect(seen.engine).toHaveLength(1)
  })

  test("dismissed at either step, it is no answer", async () => {
    const atNames = hostOf({ isShown: false, engine: () => Promise.reject(new Error("dismissed")) })
    expect(await ask(atNames.host, sessionOf(), KIND, "review-7")).toBeNull()
    const atPlace = hostOf({
      isShown: false,
      engine: async (offered) => {
        if (offered.options?.includes("Cancel")) {
          throw new Error("dismissed")
        }

        return "Full Review"
      }
    })
    expect(await ask(atPlace.host, sessionOf(), KIND, "review-7")).toBeNull()
  })

  test("more names than Claude Code's dialog offers wait in the pane where it is placed, its answers fewer", async () => {
    const many: Question = {
      ...PEOPLE,
      picking: { ...PEOPLE.picking!, names: ["ann", "bob", "cy", "dee", "eve"] }
    }
    const session = sessionOf()
    const { host, seen } = hostOf({ isShown: false })

    const answered = ask(host, session, many, "request-7")
    await promisesRun(20)
    expect(seen.engine).toEqual([])
    answerAsked(session, null)
    expect(await answered).toBeNull()
  })

  test("with no pane placed, they go to Claude Code's dialog still, whose refusal is no answer", async () => {
    const many: Question = {
      ...PEOPLE,
      picking: { ...PEOPLE.picking!, names: ["ann", "bob", "cy", "dee", "eve"] }
    }
    const { host, seen } = hostOf({ isShown: false, panes: [], engine: () => Promise.reject(new Error("refused")) })

    expect(await ask(host, sessionOf(), many, "request-7")).toBeNull()
    expect(seen.engine).toHaveLength(1)
  })
})

describe("a put-away Claude Code never answers", () => {
  test("holds no answer back: after a pause the answer goes on, and the question is let go", async () => {
    const session = sessionOf()
    const { host, seen, hold } = hostOf()
    hold("list")

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerAsked(session, MERGE)

    expect(await answered).toEqual(MERGE)
    expect(session.asking).toBeNull()
    expect(seen.shown.at(-1)).toBeNull()
  })
})

describe("the pane closing while it asks", () => {
  test("cancels the question; the person's own close does only that, and the pane stays open", () => {
    const answers: (Answer | null)[] = []
    const asking = (isInPane: boolean) => ({
      asking: {
        question: QUESTION,
        answer: (answer: Answer | null) => void answers.push(answer),
        isAnswered: false,
        isInPane,
        fieldKey: "f",
        draft: "",
        keystroke: null,
        picks: [],
        checking: null,
        problem: null
      }
    })

    expect(closeAsked(asking(true), true)).toBe(false)
    expect(closeAsked(asking(true), false)).toBe(true)
    expect(answers).toEqual([null, null])
    // A question in Claude Code's own dialog, or none, is no business of the pane's close.
    expect(closeAsked(asking(false), true)).toBe(true)
    expect(closeAsked({ asking: null }, true)).toBe(true)
    expect(answers).toEqual([null, null])
  })

  test("a question its press never puts away, waiting on Claude Code: the next close lets it go and goes on", async () => {
    const session = sessionOf()
    const { host, hold } = hostOf()
    // Neither the put-away nor the pause after which it is let go comes back.
    hold("list")
    hold("wait")
    void ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)

    // The first close cancels it, and the pane stays open, as ever; the question still shows, as it is never put away.
    expect(closeAsked(session, true)).toBe(false)
    await promisesRun(20)
    expect(drawnQuestion(session, QUESTION)).toEqual(QUESTION)
    // The next one closes the pane, and the question is no longer open or drawn.
    expect(closeAsked(session, true)).toBe(true)
    expect(await isQuestionOpen(host, session)).toBe(false)
    expect(drawnQuestion(session, QUESTION)).toBeNull()
  })

  test("so does a close after an answer its press never took in", async () => {
    const session = sessionOf()
    const { host, hold } = hostOf()
    hold("list")
    hold("wait")
    void ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerAsked(session, MERGE)
    await promisesRun(20)

    expect(closeAsked(session, true)).toBe(true)
    expect(session.asking).toBeNull()
  })
})
