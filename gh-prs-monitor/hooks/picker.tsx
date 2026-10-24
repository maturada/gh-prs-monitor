// Author: David Matura

// A question answered by picking among names before pressing an answer (`picking.ts`), as the pane draws it: in the
// frame every question is (`questionFrame`), with the same field (`questionField`) and answers (`answerRow`); what is
// its own is here: the names as buttons that pick, Select All and Clear, and an answer that carries the names picked.
// The repository picker draws its names as rows (`repo-rows.tsx`), with the same presses.

import type { RenderElement } from "claude-code"

import type { Answer, Picking } from "../types"
import { firstFocusKey, PICK_ALL_KEY, pickKey } from "./keys"
import { buttonGaps } from "./layout"
import { isAllPicked, isPickReady, pickAllOrClear, togglePick } from "./picking"
import type { PickingQuestion } from "./picking"
import { answerRow, mainLookWhile, problemLine, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite, QuestionState } from "./question-frame"
import type { OpenQuestion, Session } from "./session"

// What the picker's presses do: a name picked or taken off, Select All or Clear, a row opened, and an answer, pressed
// or sent with the field's Enter, which the pane answers as any question's (`answerOpen`), the names picked along.
export type PickerActions = {
  pick: (index: number) => void
  pickAll: () => void
  open: (index: number) => void
  answer: (answer: Answer) => void
}

// The mark on a name picked: the one every surface draws, as `CI ✓` on the rows.
const PICKED = "✓"

// The picker as drawn: the names, a picked one checked, and Select All (Clear once every one is picked) where any
// number of several may be picked; the field where the question has one; the answers, the main one dim, not yet the
// primary, while it waits for a pick; and, where its answer is carried out before it closes (`state`), Checking… on the
// main one meanwhile, then what kept it from working.
export function pickerView(
  kit: QuestionKit,
  question: PickingQuestion,
  picks: readonly number[],
  actions: PickerActions,
  field: InstructionsField,
  site: QuestionSite,
  state: QuestionState
): RenderElement {
  const { Box, Button } = kit
  const picking = question.picking
  const focus = firstFocusKey(question, field.key)
  const names = (
    <Box flexDirection="row" flexWrap="wrap" {...buttonGaps(site.surface)}>
      {picking.names.map((name, index) => (
        <Button
          key={pickKey(index)}
          label={picks.includes(index) ? `${PICKED} ${name}` : name}
          {...(pickKey(index) === focus ? { autoFocus: true as const } : {})}
          onPress={() => actions.pick(index)}
        />
      ))}
      {picking.isSingle || picking.names.length < 2 ? null : (
        <Button
          key={PICK_ALL_KEY}
          label={isAllPicked(picks, picking.names.length) ? "Clear" : "Select All"}
          dimColor
          onPress={() => actions.pickAll()}
        />
      )}
    </Box>
  )
  const main = mainLookWhile(isPickReady(picking, picks) ? { variant: "primary" } : { dimColor: true }, state)

  return questionFrame(kit, question, site, [
    names,
    questionField(kit, question, field, actions.answer, state.checking !== null),
    problemLine(kit, site, state.problem),
    answerRow(kit, question, field, site, main, actions.answer)
  ])
}

// The picks of the question open, which read it, its names and its picks at the press (`session.asking`), never
// keeping them: a button keeps its first closure through redraws (`stableButtons`), and one drawn alike in the next
// question is the same button. A press with no question open that offers names does nothing. A row opened is picked
// alone and gives the main answer, nothing typed along; while an answer is checked, it does nothing.
export function pickerActions(session: Session, redraw: () => void, answer: (answer: Answer) => void): PickerActions {
  const repick = (change: (picks: readonly number[], picking: Picking) => number[]) => {
    const asked = openPicking(session)
    if (!asked) {
      return
    }
    asked.open.picks = change(asked.open.picks, asked.picking)
    redraw()
  }

  return {
    pick: (index) => repick((picks, picking) => togglePick(picks, index, picking.isSingle)),
    pickAll: () => repick((picks, picking) => pickAllOrClear(picks, picking.names.length)),
    open: (index) => {
      const asked = openPicking(session)
      if (!asked || asked.open.checking) {
        return
      }
      asked.open.picks = [index]
      answer({ choice: asked.open.question.main, instructions: "" })
    },
    answer
  }
}

// The question open, where it offers names to pick.
function openPicking(session: Session): { open: OpenQuestion; picking: Picking } | null {
  const open = session.asking

  return open?.question.picking ? { open, picking: open.question.picking } : null
}
