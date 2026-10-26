// Author: David Matura

import type { RenderElement } from "claude-code"

import type { Answer, Question } from "../types"
import { pickerActions, pickerView } from "./picker"
import { isPickingQuestion, isPickReady, pickedNames } from "./picking"
import { repoRowsView } from "./repo-rows"
import { answerRow, mainLookWhile, problemLine, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite, QuestionState } from "./question-frame"
import type { Keystroke, Session } from "./session"

// The open question as the pane draws it in place of the list, from what the session keeps of it (`session.asking`):
// one that offers names by the picker, drawn again (`redraw`) as a press changes the picks, the repository picker's as
// rows; any other by the plugin's dialog.
export function questionView(
  kit: QuestionKit,
  session: Session,
  question: Question,
  site: QuestionSite,
  redraw: () => void
): RenderElement {
  const rows = isPickingQuestion(question) ? question.picking.rows : undefined
  // The repository picker narrows its rows to what is typed, so its field draws the pane again on each keystroke.
  const field = instructionsField(session, site.surface, rows ? redraw : null)
  const answer = answerOpen(session)
  const state = { checking: session.asking?.checking ?? null, problem: session.asking?.problem ?? null }
  if (isPickingQuestion(question)) {
    const actions = pickerActions(session, redraw, answer)

    return rows
      ? repoRowsView(kit, question, rows, actions, field, site, state)
      : pickerView(kit, question, session.asking?.picks ?? [], actions, field, site, state)
  }

  return dialogView(kit, question, answer, field, site, state)
}

// Every answer the pane takes, the dialog's and the picker's alike, given to the question open at the press
// (`session.asking`): a button drawn alike in both kinds, as their Cancel, is the same button, which keeps its first
// closure (`stableButtons`). Where the question offers names, the answer carries the names picked, and where it waits
// for a pick (`isPickReady`), the main answer and instructions sent alone do nothing until then.
export function answerOpen(session: Session): (answer: Answer) => void {
  return (answer) => {
    const open = session.asking
    const picking = open?.question.picking
    if (!open || !picking) {
      open?.answer(answer)

      return
    }
    if ((answer.choice === open.question.main || answer.choice === null) && !isPickReady(picking, open.picks)) {
      return
    }
    open.answer({ ...answer, picks: pickedNames(picking, open.picks) })
  }
}

// The plugin's dialog, in the frame every question is drawn in (`questionFrame`): its field (`questionField`), what
// kept the last answer from being carried out, and a button per answer (`answerRow`), the main one the primary. A
// button sends the instructions typed along with its choice; Enter sends them alone.
function dialogView(
  kit: QuestionKit,
  question: Question,
  answer: (answer: Answer) => void,
  field: InstructionsField,
  site: QuestionSite,
  state: QuestionState
): RenderElement {
  return questionFrame(kit, question, site, [
    questionField(kit, question, field, answer, { isChecking: state.checking !== null }),
    problemLine(kit, site, state.problem),
    answerRow(kit, question, field, site, mainLookWhile({ variant: "primary" }, state), answer)
  ])
}

// Whether a drawing on `surface` answers the keystroke it read as it began (`keystroke`), and so keeps the field as it
// was (`stableInputs`); that keystroke is then done with, unless a newer one landed while it drew.
export function answersKeystroke(session: Session, keystroke: Keystroke | null, surface: string): boolean {
  const isAnswering = keystroke !== null && keystroke.surface === surface
  if (isAnswering && session.asking?.keystroke === keystroke) {
    session.asking.keystroke = null
  }

  return isAnswering
}

// The open question's field, kept on it: the key it is drawn under, and what was typed in it so far. With `changed`,
// where typing redraws the pane, each keystroke is kept too, as typed on the surface this field is drawn for
// (`surface`), so the drawing for that surface keeps the field.
function instructionsField(session: Session, surface: string, changed: (() => void) | null): InstructionsField {
  return {
    key: session.asking?.fieldKey ?? "answer-text",
    read: () => session.asking?.draft ?? "",
    keep: (text) => {
      if (session.asking) {
        session.asking.draft = text
        if (changed) {
          session.asking.keystroke = { surface }
          changed()
        }
      }
    }
  }
}
