// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { Answer, Question } from "../types"
import { ask, closeAsked, drawnQuestion, isQuestionOpen, OPEN_QUESTION_NOTE } from "./dialog-flow"
import type { DialogHost } from "./dialog-flow"
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
// notes, where the window and the keyboard went, what Claude Code's dialog asked, and the work left running. Where the
// pane shows and which panes there are, the test says; `hold("look")` makes the pane's look wait, `hold("list")` the
// pane's going back to the list, `hold("wait")` a pause, until `release`.
function hostOf(options: { isShown?: boolean; panes?: string[]; engine?: () => Promise<string> } = {}) {
  const seen = {
    shown: [] as (string | null)[],
    notes: [] as string[],
    focused: [] as string[],
    tops: 0,
    engine: [] as string[],
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
    askInEngine: (text) => {
      seen.engine.push(text)

      return options.engine?.() ?? Promise.resolve("Merge")
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
function answerOpen(session: Session, answer: Answer | null): void {
  ;(session.asking as OpenQuestion).answer(answer)
}

describe("asking in the pane", () => {
  test("the question takes the list's place, the keyboard on its first answer, and the answer comes back", async () => {
    const session = sessionOf()
    const { host, seen } = hostOf()

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    expect(seen).toMatchObject({ shown: ["#7 Fix the menu"], tops: 1, focused: ["answer-0"], engine: [] })
    answerOpen(session, MERGE)
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
    answerOpen(session, null)
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
    answerOpen(session, MERGE)
    expect(await second).toEqual(MERGE)
  })

  test("a question in Claude Code's dialog stays open whatever the panes", async () => {
    const session = sessionOf()
    session.asking = { answer: () => {}, isAnswered: false, isInPane: false, fieldKey: "answer-text-1", draft: "" }

    expect(await isQuestionOpen(hostOf({ panes: [] }).host, session)).toBe(true)
  })

  test("answered before the pane's look came back: the keyboard is not moved", async () => {
    const session = sessionOf()
    const { host, seen, hold, release } = hostOf()
    hold("look")

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerOpen(session, MERGE)
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
    answerOpen(session, null)
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
    answerOpen(session, null)
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
    answerOpen(session, MERGE)
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
    answerOpen(session, null)
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

describe("a put-away Claude Code never answers", () => {
  test("holds no answer back: after a pause the answer goes on, and the question is let go", async () => {
    const session = sessionOf()
    const { host, seen, hold } = hostOf()
    hold("list")

    const answered = ask(host, session, QUESTION, "merge-7")
    await promisesRun(20)
    answerOpen(session, MERGE)

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
        answer: (answer: Answer | null) => void answers.push(answer),
        isAnswered: false,
        isInPane,
        fieldKey: "f",
        draft: ""
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
    answerOpen(session, MERGE)
    await promisesRun(20)

    expect(closeAsked(session, true)).toBe(true)
    expect(session.asking).toBeNull()
  })
})
