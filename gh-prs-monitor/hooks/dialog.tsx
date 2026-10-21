// Author: David Matura

import type { BoxProps, ButtonProps, ElementConstructor, InputProps, RenderElement, TextProps } from "claude-code"

import type { Answer, Question } from "../types"
import { answerKey } from "./keys"
import { buttonGaps, framePadding } from "./layout"
import { readAnswer } from "./question"

// The elements the dialog draws with; `Input` only where the surface has one (not the mobile app).
export type DialogKit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
}

// The field for instructions of the question open: its key, new for each question, as the terminal keeps what was
// typed in a field under its key until the pane closes; and the instructions typed so far, kept outside the drawing,
// as a button pressed later sends them along.
export type InstructionsField = { key: string; read: () => string; keep: (text: string) => void }

// Where a question asks for a piece of text and the surface draws no field (the mobile app), the person answers where
// one is drawn.
const NO_FIELD = "This app has no text field: answer on the computer."

// The plugin's dialog, drawn in the pane in place of the list and framed as one: what kind of question it is and what
// it is about, the question with what its answers do under it, a field for instructions where the question takes them
// and the surface can draw one, a button per answer, and, where Escape reaches the pane, how to leave without
// answering. A button sends the instructions typed along with its choice; Enter sends them alone. The text wraps and
// the answers sit in a row that wraps, so a narrow pane cuts nothing off.
export function dialogView(
  kit: DialogKit,
  question: Question,
  answer: (answer: Answer) => void,
  field: InstructionsField,
  site: { surface: string; isEscapable: boolean }
): RenderElement {
  const { Box, Text, Button, Input } = kit
  // A question's own field says what its Enter does beside it; the instructions' field says under it where they go.
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
      {input && Input ? (
        <Box flexDirection="column">
          <Input
            key={field.key}
            {...(question.field ? { autoFocus: true as const } : {})}
            label={input.label}
            placeholder={input.placeholder}
            {...(input.submitLabel ? { submitLabel: input.submitLabel } : {})}
            value={field.read()}
            onInput={field.keep}
            onSubmit={(text) => {
              // An empty Enter is no answer: the question stays.
              if (text.trim() !== "") {
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
      ) : question.field ? (
        <Text dimColor wrap="wrap">
          {NO_FIELD}
        </Text>
      ) : null}
      <Box flexDirection="row" flexWrap="wrap" {...buttonGaps(site.surface)}>
        {question.choices.map((choice, index) => (
          <Button
            key={answerKey(index)}
            label={choice}
            {...(index === 0 && !question.field ? { autoFocus: true as const } : {})}
            {...(choice === question.main ? { variant: "primary" as const } : {})}
            onPress={() => answer({ choice, instructions: field.read().trim() })}
          />
        ))}
      </Box>
      {site.isEscapable ? <Text dimColor>Esc cancels</Text> : null}
    </Box>
  )
}
