// Author: David Matura

import type { Answer, PullRow, Question } from "../types"
import { oneLine } from "./args"
import type { PickingQuestion } from "./picking"
import { CANCEL, pullSubject, readSessionAnswer, SESSION_CHOICES } from "./question"
import type { SessionPlace } from "./question"
import { ago } from "./when"

// What each place does with the review.
export function reviewDetail(isWorking: boolean): string {
  return `${hereDetail(isWorking)} A new session opens with the review typed in, for you to send.`
}

function hereDetail(isWorking: boolean): string {
  return isWorking
    ? "This session is busy, so here the review starts once its turn ends."
    : "Here it runs in this conversation."
}

// Where instructions sent alone go (`readSessionAnswer`).
const REVIEW_INSTRUCTIONS = "to a review in this session"

// Review's question of where, alone or after what to cover.
const WHERE = "Where should it be reviewed?"

// The dialog's question for Review: here or in a new session, with room for instructions.
export function reviewPlaceQuestion(pull: { number: number; title: string }, isWorking: boolean): Question {
  return {
    header: "Review PR",
    subject: pullSubject(pull),
    text: WHERE,
    detail: reviewDetail(isWorking),
    choices: Object.values(SESSION_CHOICES),
    main: null,
    instructions: REVIEW_INSTRUCTIONS
  }
}

// A pull request back to the viewer since their review: asked to review it again, or new commits came since. Review
// offers there to start from their review (`rereviewQuestion`).
export function isBackToReview(row: PullRow): boolean {
  return row.reviewStage === "rerequested" || row.reviewStage === "updated"
}

// What a review back to the viewer covers: what changed since their review, or the whole pull request again.
export const REVIEW_KINDS = { since: "Since Your Review", full: "Full Review" } as const

// Where no new session can open (`canOpenSession`), the one place there is: this session.
export const START_REVIEW = "Start Review"

// The line the choice stands on: the viewer's last review, its commit and how long ago where the row knows them, and
// what brought the pull request back: a request again, whose sender the list doesn't know, new commits, or both. A
// review that names no commit says nothing of commits since.
export function sinceLine(row: PullRow, now: number): string {
  const review = row.myReview
  const when = review?.at ? ago(Date.parse(review.at), now) : null
  const facts = [review?.commit ? `on ${review.commit.slice(0, 7)}` : null, when].filter(Boolean)
  const reviewed = facts.length > 0 ? `Your review was ${facts.join(", ")}` : "You reviewed it before"

  return `${reviewed}; ${backLine(row)}.`
}

function backLine(row: PullRow): string {
  if (row.reviewStage !== "rerequested") {
    return "new commits came in since"
  }
  if (!row.myReview?.commit) {
    return "you're asked again"
  }

  return row.signals.hasCommitsSinceMyReview
    ? "you're asked again, and new commits came in since"
    : "you're asked again, with no new commits since"
}

// Review's question on a row back to the viewer: what to cover, from their review at first, and where. The keyboard
// starts on This session, so Enter starts it here, from their review. Where no new session can open, it asks what to
// cover alone, with Start Review. Claude Code's own dialog asks what to cover, then where, each in its own words.
export function rereviewQuestion(row: PullRow, isWorking: boolean, now: number, canOpen: boolean): PickingQuestion {
  const since = sinceLine(row, now)
  const cover = "What should it cover?"

  return {
    header: "Review PR",
    subject: pullSubject(row),
    text: canOpen ? "What should it cover, and where?" : cover,
    detail: `${since} ${canOpen ? reviewDetail(isWorking) : hereDetail(isWorking)}`,
    choices: canOpen ? Object.values(SESSION_CHOICES) : [START_REVIEW, CANCEL],
    main: canOpen ? null : START_REVIEW,
    instructions: REVIEW_INSTRUCTIONS,
    picking: {
      names: [REVIEW_KINDS.since, REVIEW_KINDS.full],
      isSingle: true,
      initial: [0],
      needsPick: false,
      startsOn: "answers",
      ...(canOpen
        ? {
            steps: {
              names: { text: cover, detail: since },
              answers: { text: WHERE, detail: reviewDetail(isWorking) }
            }
          }
        : {})
    }
  }
}

// How a review starts: where, and whether from the viewer's last review.
export type ReviewStart = { place: SessionPlace; isSince: boolean }

// A review answer read, of either question: Start Review is this session; the kind picked says whether it starts from
// the viewer's review, and where none was offered it reviews the whole pull request.
export function readReviewAnswer(answer: Answer): ReviewStart {
  const place = readSessionAnswer(answer.choice === START_REVIEW ? { ...answer, choice: SESSION_CHOICES.here } : answer)

  return { place, isSince: answer.picks?.includes(REVIEW_KINDS.since) === true }
}

// The argument line the review skill reads: `<number or URL> [since] [-- <instructions>]`.
export function reviewArgs(pull: string, note?: string, isSince = false): string {
  const from = isSince ? `${pull} since` : pull

  return note ? `${from} -- ${oneLine(note)}` : from
}
