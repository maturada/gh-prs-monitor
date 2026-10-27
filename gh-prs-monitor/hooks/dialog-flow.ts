// Author: David Matura

// The plugin's dialog as it runs: a question asked in the pane where its button was pressed, or in Claude Code's own
// dialog where the pane doesn't show, one at a time; an answer carried out before the question closes, where the asker
// gives a check; and the pane's window put back on its row once it is answered. dialog.tsx, picker.tsx and
// repo-rows.tsx draw the question, in question-frame.tsx's frame; branch-flow, review-flow, create-flow and repo-picker
// build the questions and what their answers do. This one holds the open question (`Session`) and reaches the engine
// through a host.

import type { AskOptions, Timer, UiPane, UiScrollResult } from "claude-code"

import type { Answer, Picking, Question } from "../types"
import { forgetWindow, goBack, topAndFocus } from "./back-to-row"
import { messageOf } from "./gh"
import { BACK_MARK, firstFocusKey } from "./keys"
import { placesOutOfFlow } from "./layout"
import { pickedNames } from "./picking"
import { CANCEL, ENGINE_OPTIONS, isDecline, readAnswer } from "./question"
import type { GoingBack, OpenQuestion, Session } from "./session"

// What the plugin's dialog reaches through the engine, handed in by the hooks module.
export type DialogHost = {
  // The pane's id, the hooks module's, as the engine lists the panes.
  pane: string
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  after: (ms: number, fire: () => void) => Timer
  background: (work: Promise<unknown>) => void
  notify: (text: string, timeoutMs: number) => Promise<void>
  panes: () => Promise<readonly UiPane[]>
  // The surfaces the session draws on.
  surfaces: () => Promise<readonly string[]>
  // Whether the pane is drawn and in front.
  isPaneShown: () => Promise<boolean>
  // The question the pane draws in place of the list, or none.
  showQuestion: (question: Question | null) => Promise<unknown>
  // The pane's window to its top, or onto an element the pane drew; the keyboard onto one; the pane drawn again.
  scrollToTop: () => Promise<UiScrollResult>
  scrollTo: (key: string, block: "start" | "center") => Promise<UiScrollResult>
  focus: (key: string) => Promise<unknown>
  redraw: () => void
  // Claude Code's own dialog; rejects when dismissed.
  askInEngine: (text: string, options: AskOptions) => Promise<string>
}

// Asks in the pane where the button was pressed: the question takes the list's place, so it never enters the
// conversation or a turn. Where the pane doesn't show, closed since the press or behind another, Claude Code's own
// dialog asks instead. Resolves to the answer, or null when dismissed. One question at a time: while one is open,
// another is not asked, and the person is told to answer the open one first. `pressed` is the key of the button the
// question came from, where the keyboard goes back once it is answered. An answer `check` carries out before the
// question closes (`answerChecked`) changes what the pane shows, so the window then starts at its top.
export async function ask(
  host: DialogHost,
  session: Session,
  question: Question,
  pressed: string,
  check?: Check
): Promise<Answer | null> {
  // Read before the check, so nothing is awaited between it and the question taking its place.
  const now = await host.now()
  if (await isQuestionOpen(host, session)) {
    await host.notify(OPEN_QUESTION_NOTE, session.settings.alertMs)

    return null
  }
  // One left by a pane that went unheard is cancelled.
  session.asking?.answer(null)
  let open!: OpenQuestion
  // Whether the answer carried out changed what the pane shows. The answer is wanted until the question is answered
  // otherwise, as by Cancel or the pane's close while it is carried out; a check that throws says why as its problem.
  let isChanged = false
  const carryOut = check
    ? async (given: Answer): Promise<string | null> => {
        const carried = await check(given, () => !open.isAnswered).catch((error: unknown) => ({
          problem: messageOf(error)
        }))
        if ("problem" in carried) {
          return carried.problem
        }
        isChanged = carried.isChanged

        return null
      }
    : null
  // Its field's key is new for each question: the count tells apart those this load asks, the time those asked before
  // a reload, which starts the count over.
  const fieldKey = `answer-text-${now}-${++session.questionCount}`
  const answered = new Promise<Answer | null>((resolve) => {
    const settle = (given: Answer | null) => {
      open.isAnswered = true
      resolve(given)
    }
    open = {
      question,
      answer: (given) => (carryOut ? answerChecked(host, open, given, carryOut, settle) : settle(given)),
      isAnswered: false,
      isInPane: true,
      fieldKey,
      draft: "",
      keystroke: null,
      picks: [...(question.picking?.initial ?? [])],
      checking: null,
      problem: null
    }
  })
  session.asking = open
  // Where the window stood over the list, kept before the question takes its place and moves the window; a window still
  // going back after an earlier question stops where it is.
  const listOffset = session.listOffset
  session.goingBack = null
  let isSettled = false
  try {
    await host.showQuestion(question)
    // The person may answer before the keyboard has moved.
    const asked = host.isPaneShown().then(async (isShown) => {
      // Answered meanwhile, as by the pane's close: nothing is left to show or to ask elsewhere. One answered in the
      // pane, being carried out or kept open by a problem, is the pane's.
      if (isSettled) {
        return null
      }
      if (isAnsweredInPane(open)) {
        return answered
      }
      // Claude Code's own dialog offers four answers at most, and four names: one with more waits in the pane where it
      // is placed, though behind; with none placed, it goes there still, whose refusal is a Cancel.
      if (isShown || (!fitsEngineDialog(question) && (await isPanePlaced(host)))) {
        await topAndFocus(host, firstFocusKey(question, fieldKey))

        return answered
      }
      await host.showQuestion(null)
      if (isSettled) {
        return null
      }
      // Answered in the pane as it was put away: drawn again, as the answer is the pane's.
      if (isAnsweredInPane(open)) {
        await host.showQuestion(question)

        return answered
      }
      open.isInPane = false
      // One that only tells, a lone answer to close it, is told: Claude Code's own dialog would pad it with Yes and No.
      const [only, ...more] = question.choices
      if (only !== undefined && more.length === 0 && !question.picking && !question.field) {
        await host.notify(engineText(question, ""), session.settings.alertMs)

        return { choice: only, instructions: "" }
      }
      const given = await askInEngineDialog(host, question)
      // Asked there, the answer is carried out once given, and a problem is told, as no question stays open to say it.
      const problem = given && carryOut && given.choice !== CANCEL ? await carryOut(given) : null
      if (problem !== null) {
        await host.notify(problem, session.settings.alertMs)

        return null
      }

      return given
    })

    return await Promise.race([answered, asked])
  } finally {
    isSettled = true
    // Unless a later question took its place.
    if (session.asking === open) {
      // The list comes back marked on the row the window goes back to (`backToRow`); one an answer carried out changed
      // starts at its top, the keyboard on the button pressed, and a question asked next goes back there.
      const back = open.isInPane && !isChanged ? { offset: listOffset } : null
      session.goingBack = back
      try {
        // A put-away Claude Code never answers holds no answer back: once it is let go, the question is drawn no more
        // (`drawnQuestion`).
        await settledWithin(host, host.showQuestion(null), PUT_AWAY_WAIT_MS)
      } finally {
        // Last, so no other question takes the pane while this one's is put away; unless one given up made way for
        // another meanwhile (`dropAsked`).
        if (session.asking === open) {
          session.asking = null
        }
      }
      if (back) {
        host.background(backToRow(host, session, pressed, back))
      } else if (open.isInPane && isChanged) {
        session.listOffset = 0
        host.background(topAndFocus(host, pressed))
      }
    }
  }
}

// What carries out an answer before the question closes: what kept it from working (`problem`), or whether, carried
// out, it changed what the pane shows. It asks `isWanted` before it acts for good, as the question may be answered
// otherwise meanwhile, as by Cancel.
export type Check = (answer: Answer, isWanted: () => boolean) => Promise<Carried>
export type Carried = { problem: string } | { isChanged: boolean }

// Whether the person answered the question in the pane: its answer is being carried out, or a problem kept it open.
function isAnsweredInPane(open: OpenQuestion): boolean {
  return open.checking !== null || open.problem !== null
}

// An answer given in the pane, carried out before the question closes (`ask`'s `check`): the question says which is
// being carried out, and a press meanwhile does nothing; a problem keeps it open, saying why, and an answer carried out
// closes it. Cancel, or the pane's close, is no answer to carry out, and closes it at once.
function answerChecked(
  host: DialogHost,
  open: OpenQuestion,
  given: Answer | null,
  carryOut: (answer: Answer) => Promise<string | null>,
  settle: (answer: Answer | null) => void
): void {
  if (!given || given.choice === CANCEL) {
    settle(given)

    return
  }
  if (open.checking || open.isAnswered) {
    return
  }
  open.checking = given
  open.problem = null
  host.redraw()
  const done = (problem: string | null) => {
    open.checking = null
    if (open.isAnswered) {
      return
    }
    if (problem === null) {
      settle(given)
    } else {
      open.problem = problem
      host.redraw()
    }
  }
  host.background(carryOut(given).then(done))
}

const PUT_AWAY_WAIT_MS = 2_000

// `work`, or `ms`, whichever ends first.
async function settledWithin(host: DialogHost, work: Promise<unknown>, ms: number): Promise<void> {
  let timer: Timer | undefined
  try {
    await Promise.race([work, new Promise<void>((resolve) => (timer = host.after(ms, resolve)))])
  } finally {
    timer?.cancel()
  }
}

export const OPEN_QUESTION_NOTE = "Answer or cancel the open question first."

// The pane closing while it asks a question cancels the question; the person's own close (Escape, the close mark) does
// only that, and the pane stays open on the list. One answered already that still shows waits on its press to put it
// away, which a call into Claude Code that never comes back would hold forever: the close lets it go, and goes on, so
// the pane can always be closed. Whether the close goes on.
export function closeAsked(session: Pick<Session, "asking">, isPerson: boolean): boolean {
  const open = session.asking
  if (!open?.isInPane) {
    return true
  }
  if (open.isAnswered) {
    session.asking = null

    return true
  }
  open.answer(null)

  return !isPerson
}

// The question open in the pane, given up as `/prs` shows something else there (the examples, another repository, a
// question of its own): one unanswered is cancelled, its answer being carried out no longer wanted; one answered that
// still shows is let go. Either is gone at once, so another may be asked, and the window goes back to no row of a list
// the pane no longer shows; the caller puts it away. One in Claude Code's own dialog stays. Whether one was given up.
export function dropAsked(session: Pick<Session, "asking" | "listOffset" | "goingBack">): boolean {
  const open = session.asking
  if (!open?.isInPane) {
    return false
  }
  forgetWindow(session)
  session.asking = null
  if (!open.isAnswered) {
    open.isInPane = false
    open.answer(null)
  }

  return true
}

// The question the pane draws in the list's place, the one kept for it, while its press waits on it: one let go
// (`closeAsked`), or kept over a reload, has nothing left to answer.
export function drawnQuestion(session: Pick<Session, "asking">, kept: Question | null): Question | null {
  return session.asking === null ? null : kept
}

// Whether a question is open still. One in the pane whose pane went without the close hook hearing, as when the pane's
// drawing threw, went with it.
export async function isQuestionOpen(host: DialogHost, session: Session): Promise<boolean> {
  const open = session.asking

  return open !== null && !(open.isInPane && !(await host.panes()).some((pane) => pane.id === host.pane))
}

// The window back on the row kept, through the mark the list draws there (`goBack`), until the person moves it or a
// question is asked again. Where no surface the session draws on can place the mark (VS Code), none is drawn, and the
// window goes to the button pressed at once.
async function backToRow(host: DialogHost, session: Session, pressed: string, back: GoingBack): Promise<void> {
  const isGoingBack = () => session.goingBack === back
  const mark = (await host.surfaces()).some(placesOutOfFlow) ? BACK_MARK : null

  await goBack(
    {
      scrollTo: (key, block) => host.scrollTo(key, block),
      redraw: () => host.redraw(),
      sleep: (ms) => host.sleep(ms),
      focus: (key) => host.focus(key),
      isGoingBack,
      end: () => {
        if (isGoingBack()) {
          session.goingBack = null
        }
        // The mark goes with the next drawing.
        host.redraw()
      }
    },
    mark,
    pressed
  )
}

function fitsEngineDialog(question: Question): boolean {
  return question.choices.length <= ENGINE_OPTIONS && (question.picking?.names.length ?? 0) <= ENGINE_OPTIONS
}

async function isPanePlaced(host: DialogHost): Promise<boolean> {
  return (await host.panes()).some((pane) => pane.id === host.pane && pane.isPlaced)
}

// The engine's dialog has a short header and one text, so the subject leads the text, as an alert names a pull
// request, and the detail follows the question. A question that offers names asks for them first, in a step of their
// own (`askPicks`), then for its answer where it has more than one besides Cancel, each step in its own words where
// the question gives them (`Picking.steps`). It rejects when the person dismisses it, which counts as Cancel.
export async function askInEngineDialog(host: DialogHost, question: Question): Promise<Answer | null> {
  try {
    const picking = question.picking
    if (!picking) {
      return await askAnswer(host, question)
    }
    const picked = await askPicks(host, question, picking)
    if (picked === null || "answer" in picked) {
      return picked?.answer ?? null
    }
    const { picks } = picked
    // With one answer besides Cancel, the names were the whole question: that answer, without asking again for it, so
    // with no instructions.
    const [only, ...more] = question.choices.filter((choice) => choice !== CANCEL)
    const answer =
      only !== undefined && more.length === 0
        ? { choice: only, instructions: "" }
        : await askAnswer(host, { ...question, ...picking.steps?.answers })

    return { ...answer, picks: pickedNames(picking, picks) }
  } catch {
    return null
  }
}

// The question's answers; instructions typed under Other are sent alone.
async function askAnswer(host: DialogHost, question: Question): Promise<Answer> {
  const hint = question.field
    ? ` ${question.field.otherHint}`
    : question.instructions === null
      ? ""
      : ` Instructions typed under Other go ${question.instructions}.`
  const said = await host.askInEngine(engineText(question, hint), {
    header: question.header,
    options: question.choices
  })

  return readAnswer(said, question.choices)
}

// The names: ticked where any number may be picked, the engine sending them back comma-joined; one of them chosen
// where one is; a lone name beside Cancel, which the engine would pad with Yes and No. An answer that names no one,
// Cancel or text typed under Other, is no answer, so a decline typed there never starts anything; but where the
// question has a field of its own, what is typed under Other is what the field would send (`answer`), as the picker's
// detail says to type a repository it can't list there.
async function askPicks(
  host: DialogHost,
  question: Question,
  picking: Picking
): Promise<{ picks: number[] } | { answer: Answer } | null> {
  const isLone = picking.names.length === 1
  // Where the question has a field of its own, the names say what may be typed instead.
  const hint = question.field ? ` ${question.field.otherHint}` : ""
  const said = await host.askInEngine(engineText({ ...question, ...picking.steps?.names }, hint), {
    header: question.header,
    options: isLone ? [...picking.names, CANCEL] : picking.names,
    ...(picking.isSingle || isLone ? {} : { multiSelect: true as const })
  })
  const chosen = (picking.isSingle ? [said] : said.split(",")).map((each) => each.trim().toLowerCase())
  const picks = picking.names.flatMap((name, index) => (chosen.includes(name.toLowerCase()) ? [index] : []))
  if (picks.length > 0) {
    return { picks }
  }
  const typed = said.trim()

  return question.field && typed !== "" && !isDecline(typed)
    ? { answer: { choice: question.field.submitLabel, instructions: typed } }
    : null
}

// The question as the engine's dialog shows it, with `hint` saying where instructions typed under Other go; led by its
// subject, the pull request, where it has one.
function engineText(question: Pick<Question, "subject" | "text" | "detail">, hint: string): string {
  const subject = question.subject === "" ? "" : `${question.subject} — `
  const detail = question.detail === null ? "" : ` ${question.detail}`

  return `${subject}${question.text}${detail}${hint}`
}
