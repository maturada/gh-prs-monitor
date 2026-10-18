// Author: David Matura

import type { Question } from "../types"
import { oneLine } from "./args"
import { pullSubject, SESSION_CHOICES } from "./question"

// What each place does with the review.
export function reviewDetail(isWorking: boolean): string {
  const here = isWorking
    ? "This session is busy, so here the review starts once its turn ends."
    : "Here it runs in this conversation."

  return `${here} A new session opens with the review typed in, for you to send.`
}

// Where instructions sent alone go (`readSessionAnswer`).
const REVIEW_INSTRUCTIONS = "to a review in this session"

// The dialog's question for Review: here or in a new session, with room for instructions.
export function reviewPlaceQuestion(pull: { number: number; title: string }, isWorking: boolean): Question {
  return {
    header: "Review PR",
    subject: pullSubject(pull),
    text: "Where should it be reviewed?",
    detail: reviewDetail(isWorking),
    choices: Object.values(SESSION_CHOICES),
    main: null,
    instructions: REVIEW_INSTRUCTIONS
  }
}

// The argument line the review skill reads: `<number or URL> [-- <instructions>]`.
export function reviewArgs(pull: string, note?: string): string {
  return note ? `${pull} -- ${oneLine(note)}` : pull
}
