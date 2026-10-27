// Author: David Matura

// The repository picker as the pane draws it, in the frame every question is (`questionFrame`): each repository a row,
// grouped as the pane's lists group pull requests and drawn with their parts (`panels.tsx`), opened by a button of its
// own; the field to type one; and how the answer carried out before the picker closes stands. Its presses are any
// picker's (`pickerActions`).

import type { RenderElement } from "claude-code"

import type { RepoRow } from "../types"
import { openKey } from "./keys"
import { buttonGaps } from "./layout"
import { card, CHANGED_MARK, panelTitle, rule } from "./panels"
import type { PickerActions } from "./picker"
import type { PickingQuestion } from "./picking"
import { readAnswer } from "./question"
import { answerRow, CHECKING_LABEL, problemLine, questionField, questionFrame } from "./question-frame"
import type { InstructionsField, QuestionKit, QuestionSite, QuestionState } from "./question-frame"
import { repoCounts } from "./summary"

const OPEN = "Open"
const NO_FIELD = "To type one, use the computer: this app has no text field."
const SHOWN = "✓ Shown"
const NO_MATCH = "No repository listed matches: Enter looks up what you typed."

// The repository picker as drawn: the field to type one at the top, where the keyboard starts, what is typed there
// narrowing the rows to those whose name holds it; the rows by group, as the pane's lists are drawn (`panels.tsx`);
// what kept the last one from showing, and Cancel. Open on a row and the field's Enter give its answer, so it has no
// button of its own. While one is carried out, its Open, or else the field's Enter, says Checking…, and its row stays
// drawn whatever is typed.
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
  // The phone draws no field, so nothing typed elsewhere narrows its rows.
  const typed = kit.Input ? field.read() : ""
  const drawn = rows.flatMap((row, index) => (matches(row, typed) || index === opened ? [{ row, index }] : []))
  const groups = [...new Set(drawn.map(({ row }) => row.group))].map((group) => ({
    group,
    members: drawn.filter(({ row }) => row.group === group)
  }))

  return questionFrame(kit, question, site, [
    kit.Input
      ? questionField(kit, question, field, actions.answer, {
          isChecking: state.checking !== null && opened === null,
          submit: (text) => enter(question, rows, text, actions)
        })
      : null,
    drawn.length === 0 && typed.trim() !== "" ? (
      <Text key="no-match" dimColor wrap="wrap">
        {NO_MATCH}
      </Text>
    ) : null,
    ...groups.map(({ group, members }) => (
      <Box key={`group-${group}`} flexDirection="column">
        {panelTitle(kit, group, members.length)}
        {rule(kit, "rule-title", site.surface, site.columns)}
        {members.flatMap(({ row, index }, at) => [
          // Compact rows, a line each, need nothing between them.
          ...(at > 0 && !site.isCompact ? [rule(kit, `rule-${index}`, site.surface, site.columns)] : []),
          repoRow(kit, row, index, opened === index, actions, site)
        ])}
      </Box>
    )),
    // On the phone, which draws no field, the rows still open; the line saying so comes under them.
    kit.Input ? null : (
      <Text key="no-field" dimColor wrap="wrap">
        {NO_FIELD}
      </Text>
    ),
    problemLine(kit, site, state.problem),
    answerRow(kit, question, field, site, null, actions.answer)
  ])
}

// Whether a row's name holds what is typed, ignoring case; every row does while nothing is.
function matches(row: RepoRow, typed: string): boolean {
  return row.name.toLowerCase().includes(typed.trim().toLowerCase())
}

// The field's Enter: a listed name typed whole opens its row; where repositories on several servers are named with
// theirs, `owner/name` opens the first row ending in it; else the first row left opens. Each passes over the one shown,
// which opens only as the one meant (as Show on it does); with no row left, the text is looked up as typed. An empty
// Enter opens the first row but the one shown. Worked out from the text and the question's rows, never from a drawing,
// as the field keeps its first closures.
function enter(question: PickingQuestion, rows: readonly RepoRow[], text: string, actions: PickerActions): void {
  const said = text.trim()
  const named = said.toLowerCase()
  const exact = rows.findIndex((row) => row.name.toLowerCase() === named)
  const onServer = named.includes("/")
    ? rows.flatMap((row, index) => (row.name.toLowerCase().endsWith(`/${named}`) ? [index] : []))
    : []
  const matching = rows.flatMap((row, index) => (matches(row, said) ? [index] : []))
  const meant = exact >= 0 ? [exact] : onServer.length > 0 ? onServer : matching
  const toOpen = meant.find((index) => !rows[index]!.isShown) ?? (said !== "" ? meant[0] : undefined)
  if (toOpen !== undefined) {
    actions.open(toOpen)
  } else if (said !== "") {
    actions.answer(readAnswer(said, question.choices))
  }
}

// A repository's row: its name, a dot where it changed lately, what waits there (or, dim, how many are open where
// nothing does), where it is on this machine, and Open, or, for the one shown, that it is. In the compact view, a line,
// its place left to its group: the name, the dot, what waits in short, and Open. The pointer anywhere on the row lights
// its name, as on the pane's rows.
function repoRow(
  kit: QuestionKit,
  row: RepoRow,
  index: number,
  isChecking: boolean,
  actions: PickerActions,
  site: QuestionSite
): RenderElement {
  const { Box, Text, Button } = kit
  const scope = `repo-row-${index}`
  const said = repoCounts(row, site.isCompact ? "short" : "marks")
  const counts = said ? <Text {...(said.isWaiting ? {} : { dimColor: true })}>{said.text}</Text> : null
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
          {counts}
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
        {counts}
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
