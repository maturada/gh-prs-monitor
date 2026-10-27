// Author: David Matura

// What every question the pane asks is drawn with, in place of the list: its frame, its field, its answers' row,
// Checking… while an answer is carried out, and what kept one from working; which the plugin's dialog (`dialog.tsx`),
// the picker (`picker.tsx`) and the repository picker's rows (`repo-rows.tsx`) fill.

import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderChildren,
  RenderElement,
  TextProps
} from "claude-code"

import type { Answer, Question } from "../types"
import { answerKey, firstFocusKey } from "./keys"
import { buttonGaps, colourOn, framePadding } from "./layout"
import { readAnswer } from "./question"
import type { OpenQuestion } from "./session"

// Where a question is drawn: the surface, whether Escape reaches the pane there (the terminal, where the pane holds the
// keyboard), the pane's width in columns, and whether the person picked its compact view.
export type QuestionSite = { surface: string; isEscapable: boolean; columns: number; isCompact: boolean }

// Where an answer given stands while it is carried out before the question closes (`ask`'s `check`): by the row picked
// or by the main answer, and why the last one kept the question open.
export type QuestionState = Pick<OpenQuestion, "checking" | "problem">

// What a button, or a field's Enter, says while the answer it gave is checked.
export const CHECKING_LABEL = "Checking…"

// The main answer's look, saying Checking… while an answer is carried out.
export function mainLookWhile(look: NonNullable<MainLook>, state: QuestionState): MainLook {
  return state.checking ? { ...look, label: CHECKING_LABEL } : look
}

// The elements a question draws with: `Input` only where the surface has one (not the mobile app).
export type QuestionKit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
}

// The field for instructions of the question open: its key, new for each question, as the terminal keeps what was
// typed in a field under its key until the pane closes; and the instructions typed so far, kept outside the drawing,
// as a button pressed later sends them along.
export type InstructionsField = { key: string; read: () => string; keep: (text: string) => void }

// How a question's main answer looks apart from the others, and what it says while the answer it gave is checked; none
// where another part of it gives that answer, as the repository picker's rows and field do.
export type MainLook = Pick<ButtonProps, "variant" | "dimColor" | "label"> | null

// Where a question asks for a piece of text and the surface draws no field (the mobile app), the person answers where
// one is drawn.
const NO_FIELD = "This app has no text field: answer on the computer."

// The frame every question the pane asks is drawn in, in place of the list: what kind of question it is and what it is
// about, the question with what its answers do under it, then the question's own parts (`content`: a field, its
// answers), and, where Escape reaches the pane, how to leave without answering. The text wraps, so a narrow pane cuts
// nothing off.
export function questionFrame(
  kit: QuestionKit,
  question: Pick<Question, "header" | "subject" | "text" | "detail">,
  site: QuestionSite,
  content: RenderChildren
): RenderElement {
  const { Box, Text } = kit

  return (
    <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1} {...framePadding(site.surface)}>
      <Box columnGap={1} flexWrap="wrap">
        {/* The header keeps its width; the subject sits beside it, or under it whole where a narrow pane would squeeze
            it into a strip, and wraps there. */}
        <Box flexShrink={0}>
          <Text bold>{question.header}</Text>
        </Box>
        <Text dimColor wrap="wrap">
          {question.subject}
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text wrap="wrap">{question.text}</Text>
        {question.detail !== null ? (
          <Text dimColor wrap="wrap">
            {question.detail}
          </Text>
        ) : null}
      </Box>
      {content}
      {site.isEscapable ? <Text dimColor>Esc cancels</Text> : null}
    </Box>
  )
}

// A question's field: its own where it asks for a piece of text, which says what its Enter does beside it; else one
// for instructions where it takes them, which says under it where they go; none where the surface draws no field (the
// phone), which a question asking for text then says. Enter answers with what was typed, read as an answer where it
// names one (`readAnswer`), unless the caller gives an Enter of its own (`submit`); an empty Enter is no answer, so the
// question stays. While what it gave is checked (`isChecking`), its Enter says so.
export function questionField(
  kit: QuestionKit,
  question: Question,
  field: InstructionsField,
  answer: (answer: Answer) => void,
  { isChecking = false, submit }: { isChecking?: boolean; submit?: (text: string) => void } = {}
): RenderElement | null {
  const { Box, Text, Input } = kit
  const input = question.field
    ? { ...question.field, hint: null }
    : question.instructions !== null
      ? {
          label: "Instructions",
          placeholder: "Optional",
          submitLabel: null,
          hint: `They go with the answer you press, or Enter sends them alone ${question.instructions}.`
        }
      : null
  if (!input || !Input) {
    return question.field ? (
      <Text dimColor wrap="wrap">
        {NO_FIELD}
      </Text>
    ) : null
  }

  return (
    <Box flexDirection="column">
      <Input
        key={field.key}
        {...(firstFocusKey(question, field.key) === field.key ? { autoFocus: true as const } : {})}
        label={input.label}
        placeholder={input.placeholder}
        {...(input.submitLabel ? { submitLabel: isChecking ? CHECKING_LABEL : input.submitLabel } : {})}
        value={field.read()}
        onInput={field.keep}
        onSubmit={(text) => {
          if (submit) {
            submit(text)
          } else if (text.trim() !== "") {
            answer(readAnswer(text, question.choices))
          }
        }}
      />
      {input.hint ? (
        <Text dimColor wrap="wrap">
          {input.hint}
        </Text>
      ) : null}
    </Box>
  )
}

// What kept the answer last given from being carried out, said in the colour of the pane's problems, as the question
// stays open to answer again.
export function problemLine(kit: QuestionKit, site: QuestionSite, problem: string | null): RenderElement | null {
  const { Text } = kit

  return problem === null ? null : (
    <Text color={colourOn(site.surface, "warning")} wrap="wrap">
      {`⚠ ${problem}`}
    </Text>
  )
}

// A question's answers, a button each in a row that wraps, so a narrow pane cuts nothing off; the main one drawn as
// `main` says, or not at all. A press answers with its choice and the instructions typed along.
export function answerRow(
  kit: QuestionKit,
  question: Question,
  field: InstructionsField,
  site: QuestionSite,
  main: MainLook,
  answer: (answer: Answer) => void
): RenderElement {
  const { Box, Button } = kit
  const focus = firstFocusKey(question, field.key)

  return (
    <Box flexDirection="row" flexWrap="wrap" {...buttonGaps(site.surface)}>
      {question.choices.map((choice, index) =>
        choice === question.main && main === null ? null : (
          <Button
            key={answerKey(index)}
            label={choice}
            {...(answerKey(index) === focus ? { autoFocus: true as const } : {})}
            {...(choice === question.main ? main : {})}
            onPress={() => answer({ choice, instructions: field.read().trim() })}
          />
        )
      )}
    </Box>
  )
}
