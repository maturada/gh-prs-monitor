// Author: David Matura

import type { Answer, PullAction, Question } from "../types"
import { ACTION_LABELS } from "./actions"
import { DEFAULT_HOST } from "./gh"
import type { RepoRef } from "./gh"
import { oneLine, quotedArg } from "./args"
import { canOpenSession } from "./new-session"
import { CANCEL, isDecline, pullSubject } from "./question"

// The bundled skills that work on a pull request's branch: where they work is asked alike, and their arguments read
// alike.
export type BranchSkill = Extract<PullAction, "resolve" | "fixCi" | "resolveConflicts">

// Resolve Comments, Fix CI and Resolve Conflicts: the buttons that work on the pull request's branch.
export function isBranchSkill(action: PullAction): action is BranchSkill {
  return action === "resolve" || action === "fixCi" || action === "resolveConflicts"
}

// What each is there for, as the question names it.
const PURPOSES: Readonly<Record<BranchSkill, { what: string; done: string }>> = {
  resolve: { what: "its review comments", done: "resolved" },
  fixCi: { what: "its failing checks", done: "fixed" },
  resolveConflicts: { what: "its merge conflicts", done: "resolved" }
}

export const CHOICES = {
  here: "Here, switch branch",
  hereOnBranch: "Here, on this branch",
  worktree: "Worktree, this session",
  newSession: "Worktree, new session",
  cancel: CANCEL
} as const

// Switching here keeps to this session: a new one would share the checkout this conversation works in. Instructions
// typed go wherever it works.
export type BranchPlace =
  | { kind: "worktree"; isNewSession: boolean; note?: string }
  | { kind: "here"; note?: string }
  | { kind: "cancel" }

// What the checkout holds: tracked changes a switch takes along to the pull request's branch (or stops on), whether
// it is on no branch, where commits of its own would be left behind by a switch, and whether it is on the pull
// request's branch already, where working here needs no switch.
export type CheckoutState = { uncommitted: number; isDetached: boolean; isOnBranch: boolean }

// From the nearest to the furthest away: this checkout, a worktree in this session, then one in a new session where
// the surface pressed on can open one (`canOpenSession`). Asked even on the pull request's branch, as another session
// may be working in this checkout, where working here needs no switch. Elsewhere switching here is offered whatever
// the checkout holds; the question says what it would cost, and a switch that would overwrite a change, or a file git
// ignores, stops (`switchHere`).
export function placeChoices(canOpenSession: boolean, isOnBranch: boolean): string[] {
  const here = isOnBranch ? CHOICES.hereOnBranch : CHOICES.here

  return canOpenSession
    ? [here, CHOICES.worktree, CHOICES.newSession, CHOICES.cancel]
    : [here, CHOICES.worktree, CHOICES.cancel]
}

// What the dialog of each is headed, in the 12 characters Claude Code's own dialog shows of a header.
const SKILL_HEADERS: Readonly<Record<BranchSkill, string>> = {
  resolve: "Resolve PR",
  fixCi: "Fix CI",
  resolveConflicts: "Conflicts"
}

// The dialog's question for Resolve Comments, Fix CI or Resolve Conflicts: where to work, with room for instructions.
// `isWorking`: a turn is under way in this session.
export function branchPlaceQuestion(
  skill: BranchSkill,
  pull: { number: number; title: string; headRefName: string; isCrossRepository: boolean },
  state: CheckoutState,
  canOpenSession: boolean,
  isWorking: boolean
): Question {
  const { what, done } = PURPOSES[skill]

  return {
    header: SKILL_HEADERS[skill],
    subject: pullSubject(pull),
    text: `Where should ${what} on ${pull.headRefName} be ${done}?`,
    detail: placeDetail(pull, state, canOpenSession, isWorking),
    choices: placeChoices(canOpenSession, state.isOnBranch),
    main: null,
    instructions: PLACE_INSTRUCTIONS
  }
}

// What each place costs or does: a turn under way, uncommitted changes and a checkout on no branch warned of first.
export function placeDetail(
  pull: { isCrossRepository: boolean },
  state: CheckoutState,
  canOpenSession: boolean,
  isWorking: boolean
): string {
  const changes = `${state.uncommitted} uncommitted change${state.uncommitted === 1 ? "" : "s"}`
  // A fork's dependencies are installed nowhere (`fork` below).
  const apart = pull.isCrossRepository
    ? "a worktree works apart from it"
    : "a worktree works apart from it, its dependencies installed in a folder of its own"
  const onBranch = `This checkout is on the pull request's branch already: working here uses it as it is${state.uncommitted > 0 ? `, with its ${changes}` : ""}; ${apart}.`
  const warnings = [
    state.uncommitted > 0
      ? `This checkout has ${changes}: switching here takes ${state.uncommitted === 1 ? "it" : "them"} along to the pull request's branch, or stops rather than overwrite one.`
      : null,
    state.isDetached
      ? "This checkout is on no branch: switching here leaves commits made there behind, found again only through git reflog."
      : null
  ].filter((warning) => warning !== null)
  const busy = !isWorking
    ? []
    : state.isOnBranch
      ? ["This session is busy, so working here starts once its turn ends."]
      : [
          "This session is busy, so switching here waits until its turn ends, and stops if that turn changed this checkout."
        ]
  const ignored = "Switching here stops rather than overwrite a file git ignores that the branch tracks"
  // A fork's dependencies are installed nowhere (`fork` below).
  const switching = pull.isCrossRepository
    ? `${ignored}; a worktree leaves this checkout as it is.`
    : `${ignored}, and reinstalls dependencies if the branch's lockfile differs; a worktree installs them in a folder of its own, leaving this checkout as it is.`
  const lead = state.isOnBranch ? [...busy, onBranch].join(" ") : [...busy, ...warnings, switching].join(" ")
  const newSession = canOpenSession
    ? " A new session opens with the command typed in, for you to send, and works in the worktree."
    : ""
  const fork = pull.isCrossRepository ? " It comes from a fork, so its dependencies are not installed." : ""

  return `${lead}${newSession}${fork}`
}

// Where instructions sent alone go (`readPlaceAnswer`).
const PLACE_INSTRUCTIONS = "to a worktree in this session"

// A branch skill pressed on a visit: another repository's pull request is worked on in a clone of it, never in this
// session's folder, which the question says first. With a clone known (`clone`, as shown) and an app that opens a
// session in a folder (`opens`), it offers a new session there, with `/prs owner/name` typed in for the person to send
// and press the button again. VS Code, which can't open another folder from a link, and a surface that opens no session
// at all are told the folder and the steps, VS Code not named, as the editor may be another built on it; with none
// known, how to make one known.
export function openCloneQuestion(
  skill: BranchSkill,
  pull: { number: number; title: string; headRefName: string },
  repo: RepoRef,
  clone: string | null,
  opens: "folder" | "vscode" | "none"
): Question {
  const { what, done } = PURPOSES[skill]
  const work = `${what.charAt(0).toUpperCase()}${what.slice(1)} on ${pull.headRefName} get ${done}`
  const prs = `/prs ${repo.name}`
  const again = `then press ${ACTION_LABELS[skill]} on #${pull.number}`
  const isOpening = clone !== null && opens === "folder"
  const text = !clone
    ? `${work} in a clone of ${repo.name}, not in this session's folder, and none is known on this machine.`
    : `${work} in your clone of ${repo.name} at ${clone}, not in this session's folder.${isOpening ? " Start a new session there?" : ""}`
  const detail = !clone
    ? `Clone it if you haven't (gh repo clone ${cloneName(repo)}), open a Claude Code session in it once, and it is offered here.`
    : isOpening
      ? `It opens with ${prs} typed in: send it, ${again} there.`
      : opens === "vscode"
        ? `Open that folder in a new window, run ${prs} in Claude Code there, ${again}.`
        : `On the computer, open a Claude Code session there, run ${prs}, ${again}.`

  return {
    header: SKILL_HEADERS[skill],
    subject: pullSubject(pull),
    text,
    detail,
    choices: isOpening ? [`${NEW_SESSION_IN} ${clone}`, CANCEL] : [OK],
    main: isOpening ? `${NEW_SESSION_IN} ${clone}` : OK,
    instructions: null
  }
}

// The repository as `gh repo clone` takes it: its server named where it isn't GitHub's own.
function cloneName(repo: RepoRef): string {
  return repo.host.toLowerCase() === DEFAULT_HOST ? repo.name : `${repo.host}/${repo.name}`
}

// What a branch skill on a visit can do with a clone from `surface` (`openCloneQuestion`): open a new session in it; in
// VS Code, which opens no other folder from a link, tell it; where no new session opens at all, tell it too.
export function cloneOpens(surface: string): "folder" | "vscode" | "none" {
  return !canOpenSession(surface) ? "none" : surface === "vscode" ? "vscode" : "folder"
}

const NEW_SESSION_IN = "New Session in"
const OK = "OK"

// Whether the answer opens a new session in the clone the question offered.
export function isOpeningClone(answer: Answer | null): boolean {
  return answer?.choice?.startsWith(`${NEW_SESSION_IN} `) === true
}

// Instructions go with any place; sent alone, they work in a worktree in this session.
export function readPlaceAnswer(answer: Answer): BranchPlace {
  const note = answer.instructions === "" ? {} : { note: answer.instructions }
  if (answer.choice === CHOICES.newSession) {
    return { kind: "worktree", isNewSession: true, ...note }
  }
  if (answer.choice === CHOICES.worktree) {
    return { kind: "worktree", isNewSession: false, ...note }
  }
  if (answer.choice === CHOICES.here || answer.choice === CHOICES.hereOnBranch) {
    return { kind: "here", ...note }
  }
  if (answer.choice === CHOICES.cancel || answer.instructions === "" || isDecline(answer.instructions)) {
    return { kind: "cancel" }
  }

  return { kind: "worktree", isNewSession: false, note: answer.instructions }
}

export type SkillArgs = { worktree?: string; deps?: string; includeOutdated?: boolean; note?: string }

// The argument line the branch skills read, `--include-outdated` Resolve Comments' alone:
// `<pull request URL> [--worktree "<path>"] [--deps "<note>"] [--include-outdated] [-- <instructions>]`.
export function skillArgs(pull: string, args: SkillArgs): string {
  const parts = [pull]
  if (args.worktree) {
    parts.push(`--worktree ${quotedArg(args.worktree)}`)
  }
  // The skills read a note with no `"` in it.
  if (args.deps) {
    parts.push(`--deps ${quotedArg(cut(oneLine(args.deps), DEPS_NOTE_LIMIT).replaceAll('"', "'"))}`)
  }
  if (args.includeOutdated) {
    parts.push("--include-outdated")
  }
  if (args.note) {
    parts.push(`-- ${oneLine(args.note)}`)
  }

  return parts.join(" ")
}

// The note says how each project's install went, its folder named for one below the root; a link that types the
// command in has room for 5,000 characters in all.
const DEPS_NOTE_LIMIT = 600

function cut(text: string, limit: number): string {
  const characters = Array.from(text)

  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text
}
