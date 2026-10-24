// Author: David Matura

import type { RenderElement } from "claude-code"

import type { Answer, Question } from "../types"
import { pickerActions, pickerView } from "./picker"
import { isPickingQuestion, isPickReady, pickedNames } from "./picking"
import { repoRowsView } from "./repo-rows"
import { answerRow, mainLookWhile, problemLine, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite, QuestionState } from "./question-frame"
import type { Session } from "./session"

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
  const field = instructionsField(session)
  const answer = answerOpen(session)
  const state = { checking: session.asking?.checking ?? null, problem: session.asking?.problem ?? null }
  if (isPickingQuestion(question)) {
    const actions = pickerActions(session, redraw, answer)
    const rows = question.picking.rows

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
    questionField(kit, question, field, answer, state.checking !== null),
    problemLine(kit, site, state.problem),
    answerRow(kit, question, field, site, mainLookWhile({ variant: "primary" }, state), answer)
  ])
}

// The open question's field, kept on it: the key it is drawn under, and what was typed in it so far.
function instructionsField(session: Session): InstructionsField {
  return {
    key: session.asking?.fieldKey ?? "answer-text",
    read: () => session.asking?.draft ?? "",
    keep: (text) => {
      if (session.asking) {
        session.asking.draft = text
      }
    }
  }
}
