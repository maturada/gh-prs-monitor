// Author: David Matura

import type { RenderElement } from "claude-code"

import type { Answer, Question } from "../types"
import { pickerActions, pickerView } from "./picker"
import { isPickingQuestion, isPickReady, pickedNames } from "./picking"
import { answerRow, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite } from "./question-frame"
import type { Session } from "./session"

// The open question as the pane draws it in place of the list, from what the session keeps of it (`session.asking`):
// one that offers names by the picker, drawn again (`redraw`) as a press changes the picks; any other by the plugin's
// dialog.
export function questionView(
  kit: QuestionKit,
  session: Session,
  question: Question,
  site: QuestionSite,
  redraw: () => void
): RenderElement {
  const field = instructionsField(session)
  const answer = answerOpen(session)
  if (isPickingQuestion(question)) {
    const actions = { ...pickerActions(session, redraw), answer }

    return pickerView(kit, question, session.asking?.picks ?? [], actions, field, site)
  }

  return dialogView(kit, question, answer, field, site)
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

// The plugin's dialog, in the frame every question is drawn in (`questionFrame`): its field (`questionField`), and a
// button per answer (`answerRow`), the main one the primary. A button sends the instructions typed along with its
// choice; Enter sends them alone.
function dialogView(
  kit: QuestionKit,
  question: Question,
  answer: (answer: Answer) => void,
  field: InstructionsField,
  site: QuestionSite
): RenderElement {
  return questionFrame(kit, question, site, [
    questionField(kit, question, field, answer),
    answerRow(kit, question, field, site, { variant: "primary" }, answer)
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
