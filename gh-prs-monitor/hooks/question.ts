// Author: David Matura

import type { Answer } from "../types"

// What a question about a pull request is about: its number and title.
export function pullSubject(pull: { number: number; title: string }): string {
  return `#${pull.number} ${pull.title}`
}

// Text typed in place of a choice, in the dialog's field or under Claude Code's own dialog's Other: the choice it
// names, in any case, or else instructions.
export function readAnswer(text: string, choices: readonly string[]): Answer {
  const said = text.trim()
  const choice = choices.find((each) => each.toLowerCase() === said.toLowerCase())

  return choice === undefined ? { choice: null, instructions: said } : { choice, instructions: "" }
}

// "Cancel", "no thanks", "never mind that", "cancel it, please" and the like typed under Other mean what they say, not
// instructions; an instruction that merely starts with "no" ("no new tests, just the naming") is still one.
const DECLINES =
  /^(cancel|no|nope|nah|n|stop|abort|quit|exit|skip|none|nothing|nvm|never[ -]?mind|not now|no need|forget it|(no,? )?don'?t( do it)?)( (it|that|this))?(,? (thanks?|thank you|thx|please|i'?m good|all good))?[\s.!:)]*$/i

export function isDecline(said: string): boolean {
  return DECLINES.test(said)
}

// The answer that does nothing, offered last in every question.
export const CANCEL = "Cancel"

// What Claude Code's own dialog offers at each step: four options at most, the answers or the names to pick.
export const ENGINE_OPTIONS = 4

// Where a skill the pane starts runs: in this conversation, or in a new session opened with its command typed in, for
// the person to send.
export const SESSION_CHOICES = {
  here: "This session",
  new: "New session",
  cancel: CANCEL
} as const

export type SessionPlace = { kind: "here" | "new"; note?: string } | { kind: "cancel" }

// Instructions go with either place; sent alone, they go to this session.
export function readSessionAnswer(answer: Answer): SessionPlace {
  const note = answer.instructions === "" ? {} : { note: answer.instructions }
  if (answer.choice === SESSION_CHOICES.here) {
    return { kind: "here", ...note }
  }
  if (answer.choice === SESSION_CHOICES.new) {
    return { kind: "new", ...note }
  }
  if (answer.choice === SESSION_CHOICES.cancel || answer.instructions === "" || isDecline(answer.instructions)) {
    return { kind: "cancel" }
  }

  return { kind: "here", note: answer.instructions }
}
