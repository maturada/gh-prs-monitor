// Author: David Matura

// The repository picker as the pane draws it, in the frame every question is (`questionFrame`): each repository a row,
// grouped as the pane's lists group pull requests and drawn with their parts (`panels.tsx`), opened by a button of its
// own; the field to type one; and how the answer carried out before the picker closes stands. Its presses are any
// picker's (`pickerActions`).

import type { RenderElement } from "claude-code"

import type { RepoRow } from "../types"
import { firstFocusKey, openKey } from "./keys"
import { buttonGaps } from "./layout"
import { card, CHANGED_MARK, panelTitle, rule } from "./panels"
import type { PickerActions } from "./picker"
import type { PickingQuestion } from "./picking"
import { answerRow, CHECKING_LABEL, problemLine, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite, QuestionState } from "./question-frame"
import { MARKS } from "./summary"

const OPEN = "Open"
const NO_FIELD = "To type one, use the computer: this app has no text field."
const SHOWN = "✓ Shown"

// The repository picker as drawn: its rows by group, as the pane's lists are drawn (`panels.tsx`), the field to type
// one, what kept the last one from showing, and Cancel. Open on a row and the field's Enter give its answer, so it has
// no button of its own. While one is carried out, its Open, or else the field's Enter, says Checking….
export function repoRowsView(
  kit: QuestionKit,
  question: PickingQuestion,
  rows: readonly RepoRow[],
  actions: PickerActions,
  field: InstructionsField,
  site: QuestionSite,
  state: QuestionState
): RenderElement {
  const { Box, Text } = kit
  const opened = openedRow(question, rows, state)
  const focus = firstFocusKey(question, field.key)
  const groups = [...new Set(rows.map((row) => row.group))].map((group) => ({
    group,
    members: rows.flatMap((row, index) => (row.group === group ? [{ row, index }] : []))
  }))

  return questionFrame(kit, question, site, [
    ...groups.map(({ group, members }) => (
      <Box key={`group-${group}`} flexDirection="column">
        {panelTitle(kit, group, members.length)}
        {rule(kit, "rule-title", site.surface, site.columns)}
        {members.flatMap(({ row, index }, at) => [
          // Compact rows, a line each, need nothing between them.
          ...(at > 0 && !site.isCompact ? [rule(kit, `rule-${index}`, site.surface, site.columns)] : []),
          repoRow(kit, row, index, { isChecking: opened === index, isFocused: openKey(index) === focus }, actions, site)
        ])}
      </Box>
    )),
    // On the phone, which draws no field, the rows still open.
    kit.Input ? (
      questionField(kit, question, field, actions.answer, state.checking !== null && opened === null)
    ) : (
      <Text key="no-field" dimColor wrap="wrap">
        {NO_FIELD}
      </Text>
    ),
    problemLine(kit, site, state.problem),
    answerRow(kit, question, field, site, null, actions.answer)
  ])
}

// A repository's row: its name, a dot where it changed lately, what waits there, where it is on this machine, and Open,
// or, for the one shown, that it is. In the compact view, a line, its place left to its group: the name, the dot, what
// waits in short, and Open. The pointer anywhere on the row lights its name, as on the pane's rows.
function repoRow(
  kit: QuestionKit,
  row: RepoRow,
  index: number,
  { isChecking, isFocused }: { isChecking: boolean; isFocused: boolean },
  actions: PickerActions,
  site: QuestionSite
): RenderElement {
  const { Box, Text, Button } = kit
  const scope = `repo-row-${index}`
  const waits = waitsOf(row, site.isCompact)
  const name = (
    <Text bold wrap="wrap" hover={{ scope, color: "suggestion" }}>
      {row.name}
      {row.isNew ? <Text color="suggestion">{`\u00a0${CHANGED_MARK}`}</Text> : null}
    </Text>
  )
  const opener = (
    <Box flexShrink={0}>
      {row.isShown ? (
        <Text dimColor>{SHOWN}</Text>
      ) : (
        <Button
          key={openKey(index)}
          label={isChecking ? CHECKING_LABEL : OPEN}
          {...(isFocused ? { autoFocus: true as const } : {})}
          {...(isChecking ? { dimColor: true } : {})}
          onPress={() => actions.open(index)}
        />
      )}
    </Box>
  )
  const line = { columnGap: 2, rowGap: buttonGaps(site.surface).rowGap, flexWrap: "wrap" as const }
  if (site.isCompact) {
    return (
      <Box key={scope} {...line} justifyContent="space-between" hover={{ scope }}>
        <Box columnGap={2} flexShrink={1} flexWrap="wrap">
          {name}
          {waits ? <Text>{waits}</Text> : null}
        </Box>
        {opener}
      </Box>
    )
  }

  return card(
    kit,
    site.surface,
    `card-${index}`,
    <Box key={scope} {...line} justifyContent="space-between" alignItems="flex-end" hover={{ scope }}>
      <Box flexDirection="column" flexShrink={1} minWidth={0}>
        {name}
        {waits ? <Text>{waits}</Text> : null}
        {row.place ? (
          <Text dimColor wrap="wrap">
            {row.place}
          </Text>
        ) : null}
      </Box>
      {opener}
    </Box>
  )
}

// What waits in a repository, with the marks the header and the status line count with: in full, or in short for the
// compact view.
function waitsOf(row: RepoRow, isCompact: boolean): string {
  return [
    ...(row.mine > 0 ? [`${MARKS.needsYou} ${row.mine}${isCompact ? "" : " yours"}`] : []),
    ...(row.requested > 0 ? [`${MARKS.toReview} ${row.requested}${isCompact ? "" : " to review"}`] : [])
  ].join("  ")
}

// The row whose Open gave the answer being carried out: Open gives the main answer with its row's name picked and
// nothing typed. None for one typed, or for the one shown, which has no Open to say so: the field's Enter says it.
function openedRow(question: PickingQuestion, rows: readonly RepoRow[], state: QuestionState): number | null {
  const given = state.checking
  if (!given || given.choice !== question.main || given.instructions.trim() !== "") {
    return null
  }
  const index = question.picking.names.indexOf(given.picks?.[0] ?? "")

  return index >= 0 && !rows[index]?.isShown ? index : null
}
