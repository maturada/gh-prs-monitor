// Author: David Matura

import type { Timer } from "claude-code"

import type { Answer, BranchPulls, PullsSnapshot } from "../types"
import { nothingHeld } from "./alerts"
import type { HeldAlerts } from "./alerts"
import type { CREATE_PR } from "./create-flow"
import type { ClosedState } from "./ended"
import type { GhProblem, RepoRef } from "./gh"
import type { Settings } from "./settings"
import type { AwaitedAnswer } from "./shared"
import type { DrawnButtons } from "./stable-buttons"

// What a lookup of the pull requests from the checkout's branch came to (`branch-lookup.ts`): GitHub's answer, or what
// kept gh from asking.
export type BranchLook = { looked: BranchPulls } | { problem: GhProblem }

// What one load of the hooks module keeps between hooks; a reload starts it over. What must outlive one lives in the
// session's state too and is read back when the next starts: the pull requests, the main loop's running turns, the
// alerts held back, and a `/prs` waiting for the window. What belongs together is grouped in one part: the checks, the
// alerts held back, the bundled skills' runs, the worktree cleanups and the demos.
export type Session = {
  settings: Settings
  // Tells this session's toasts from another's in the store they share: the transcript's id, read when the session
  // starts.
  id: string
  // Resolved once; null until it is, or while it cannot be.
  repo: RepoRef | null
  // The main loop's turns under way, by id (a subagent's run is none of them), and the work waiting for none to be
  // (`whenIdle`). A reload's module takes those the module before saw start, as `fromBefore` too: the main loop runs
  // one turn at a time, so one starting shows those ended, whatever kept their end from being seen.
  runningTurns: Set<string>
  fromBefore: Set<string>
  // Whether a `/clear`, or a resume within this process, ended the conversation since this load last wrote its loading
  // mark: Claude Code then empties the session's state and starts no session again, so the next mark takes the empty
  // record for this load. A load a reload replaced sees no later end, and once it finds the newer load's mark, never
  // claims one; only a single load of its running through a `/clear`, a reload and another `/clear` still could.
  isStateEmptied: boolean
  idleWaiters: (() => void)[]
  // The buttons the pane and the band last drew, kept so one drawn again unchanged keeps its handle.
  drawnButtons: DrawnButtons
  // The timer that takes the first note of what changed away at its time (`keepNotes`).
  notesTimer: Timer | null
  checks: Checks
  // Alerts waiting for the running turns to end.
  alerts: HeldAlerts
  skills: SkillRuns
  cleanup: CleanupRuns
  demo: DemoRuns
  // Hosts that said they have no stacked pull requests (GitHub Enterprise Server), asked without them.
  stacklessHosts: Set<string>
  // The pull request this checkout is being switched to, waiting for a turn to end or under way: one switch at a time.
  switchingFor: number | null
  // GitHub asked about the pull requests from the session's branch at a commit, with where the list knew the last one
  // to end (`BranchPulls`), `<branch> <commit> <ended at>`, shared by what asks the same meanwhile.
  branchLookup: { key: string; done: Promise<BranchLook> } | null
  // The question the plugin's dialog asks, one at a time, or null while none is open, and how many it has asked.
  asking: OpenQuestion | null
  questionCount: number
  // The first row of the list the pane's window showed when last drawn or moved, and the window a question's close is
  // putting back there, or null while none is.
  listOffset: number
  goingBack: GoingBack | null
  // The scheme of the editor the VS Code extension runs in (`editorScheme`), read the first time New session is pressed
  // there: neither the editor nor its files change while the module runs.
  editorScheme: Promise<string | null> | null
}

// A question's close putting the pane's window back on the row it showed first over the list (`backToRow`), which the
// list marks for the window to go to while it does.
export type GoingBack = {
  offset: number
}

// A question open: what gives it its answer (null when dismissed), whether it has one already, which its press has yet
// to put away, whether it is in the pane, where the pane's close cancels it, or in Claude Code's own dialog, and its
// field for instructions in the pane: the key it is drawn under and what was typed in it so far.
export type OpenQuestion = {
  answer: (answer: Answer | null) => void
  isAnswered: boolean
  isInPane: boolean
  fieldKey: string
  draft: string
}

// The loads, and the timer that runs them.
export type Checks = {
  // Set by a problem that holds for the whole session, which stops the timer.
  isStopped: boolean
  timer: Timer | null
  // The timer that looks for an answer another session shared, between the refreshes (`shared.ts`).
  shareTimer: Timer | null
  // The load under way: whether it asks GitHub or reads an answer another session shared, and when its request went
  // out, once it has, which a timer's refresh that joins it claims (`fetchClaimed`).
  inFlight: { done: Promise<void>; isFetching: boolean; requestedAt: number | null } | null
  // When the request for the list shown went out, by this session or the one whose answer it read.
  requestedAt: number | null
  // The answer the last tick left GitHub's request to another session for, until it comes (`planShareCheck`).
  awaited: AwaitedAnswer | null
  // When the look between ticks last ran, watched or not (`isOverdue`).
  lastLookAt: number | null
  // The sessions whose answers this one could not read (`SharedAnswer.by`), which it leaves alone, with their claims.
  unreadable: Set<string>
  // The audiences (`audienceId`) whose last answer was too large to share, or refused, whose requests this session
  // doesn't claim.
  unshared: Set<string>
  // Which share is the latest, the one whose result decides `unshared`.
  shareTurn: number
  // The write that says a load is under way, which the pane waits for before it opens.
  marking: Promise<unknown> | null
  // Set by a timer's refresh, which may join a load another started; that load then raises the toasts.
  isAlertWanted: boolean
  // The toasts the load under way held back, as nobody asked for it, once it took its kind: a timer's refresh that
  // joins it from then on still gets them.
  heldBack: { repo: RepoRef; lines: string[] } | null
  // A setup problem (gh missing or signed out) is announced once, not on every refresh, until the checks work again.
  hasAnnouncedSetup: boolean
  // The checks stopped as nothing was drawn any more (the desktop window closed); the next attach comes back to what
  // changed meanwhile.
  wasDetached: boolean
  isReturning: boolean
  // The list as it stood before loads that nothing drew (a skill's turn ending with the window closed): the next load
  // that is drawn compares with it, so what changed meanwhile is still told.
  awayBase: PullsSnapshot | null
  // How the pull requests that left the lists by the last load ended, as GitHub said (`endedStates`), which /prs
  // looking back where nothing is drawn asks no more (`lookBack`).
  lookedUp: ClosedState[]
}

// The bundled skills' runs.
export type SkillRuns = {
  // Skills whose command has run and whose turn has not started yet, in order; then the turn each runs in, by its id,
  // with the row it marks once that is known. The row says the skill is at work for that turn alone.
  starting: SkillStart[]
  turns: Map<string, Promise<SkillMark | null>>
  // When a skill last started, pressed or typed, whose turns the list follows for a while, and when it last did.
  startedAt: number | null
  lastFollowAt: number
}

// A skill's command that has run: a pressed one knows its pull request, a typed one has its arguments.
export type SkillStart = { command: string; mark: Mark | null; args: string }

// The row a skill's turn marks, and what it says there.
export type SkillMark = { mark: Mark; label: string }

// What a press under way, or a skill's turn, marks in the pane, saying meanwhile what is under way there: a pull
// request's row, by its number, or the Create PR button.
export type Mark = number | typeof CREATE_PR

// Cleaning up the worktrees and `pr-<number>` branches of pull requests that ended.
export type CleanupRuns = {
  // Pull requests whose worktree, or whose branch a switch here left, this session already cleaned up or kept, told
  // once; apart, as a branch a folder held may come free after its pull request was settled.
  settledWorktrees: Set<number>
  settledBranches: Set<number>
  isRunning: boolean
  // A pull request left the lists while a cleanup ran, so it runs once more.
  isWanted: boolean
  // How pull requests that left the lists ended, as the loads since the last run found, which the next run takes and
  // asks GitHub no more.
  known: ClosedState[]
}

// The example alerts still to show.
export type DemoRuns = { toasts: Timer[] }

export function createSession(settings: Settings): Session {
  return {
    settings,
    id: randomId(),
    repo: null,
    runningTurns: new Set(),
    fromBefore: new Set(),
    isStateEmptied: false,
    idleWaiters: [],
    drawnButtons: new Map(),
    notesTimer: null,
    checks: {
      isStopped: false,
      timer: null,
      shareTimer: null,
      inFlight: null,
      requestedAt: null,
      awaited: null,
      lastLookAt: null,
      unreadable: new Set(),
      unshared: new Set(),
      shareTurn: 0,
      marking: null,
      isAlertWanted: false,
      heldBack: null,
      hasAnnouncedSetup: false,
      wasDetached: false,
      isReturning: false,
      awayBase: null,
      lookedUp: []
    },
    alerts: nothingHeld(),
    skills: { starting: [], turns: new Map(), startedAt: null, lastFollowAt: 0 },
    cleanup: { settledWorktrees: new Set(), settledBranches: new Set(), isRunning: false, isWanted: false, known: [] },
    demo: { toasts: [] },
    stacklessHosts: new Set(),
    switchingFor: null,
    branchLookup: null,
    asking: null,
    questionCount: 0,
    listOffset: 0,
    goingBack: null,
    editorScheme: null
  }
}

// An id no other load or session shares, for the moment: until a session's own is read, and for a load of the module.
export function randomId(): string {
  return Math.random().toString(36).slice(2)
}
