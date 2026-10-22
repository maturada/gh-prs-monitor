// Author: David Matura

export type Tone = "success" | "warning" | "error" | "neutral"

// `href` leads where the thing it names is dealt with: a failing check to the checks, conflicts to resolving them.
// A CI result's mark, which ends its badge's text and is drawn in its colour: passed, running, failed.
export type CiMark = "✓" | "●" | "✗"

export type Badge = { text: string; tone: Tone; href?: string; mark?: CiMark }

// Where one of the viewer's own pull requests stands: the first of its facts that needs the author (`pull-status.ts`).
export type MineStage =
  | "draft"
  | "queued"
  | "conflicts"
  | "ciFailing"
  | "changesRequested"
  | "comments"
  | "rereview"
  | "moreApprovals"
  | "approvedCiRunning"
  | "behind"
  | "blocked"
  | "checking"
  | "ready"
  | "waiting"

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null

// A bot's review (a code assistant's) is never announced.
export type ReviewMark = { state: string; at: string; isBot: boolean }

// The raw facts a row was derived from, kept to tell what changed between two refreshes.
export type PullSignals = {
  ci: CiState
  // null while GitHub is still working out mergeability, as it does after every push to the base.
  isConflicting: boolean | null
  unresolvedThreads: number
  isAutoMerge: boolean
  // In the base branch's merge queue, which merges it once the queue's checks pass; never on the review list.
  isQueued: boolean
  // Latest review per reviewer on the viewer's own pull requests, the author's left out; none on the review list, whose
  // alerts are requests and new commits.
  reviews: Record<string, ReviewMark>
  // The conversation's comment count, and who wrote the latest five, oldest first: null for a bot's.
  conversation: { count: number; authors: (string | null)[] }
  isRequested: boolean
  hasCommitsSinceMyReview: boolean
  // While GitHub rechecks mergeability: whether the pull request was ready to merge just before, and whether it
  // conflicted, carried from the previous refresh, so coming back to either is no news but turning to it is.
  wasReady?: boolean
  lastConflict?: boolean | null
}

// The buttons a row offers. Resolve Comments, Review, Fix CI and Resolve Conflicts start a bundled skill; the others
// write to GitHub, each after a confirmation.
export type PullAction =
  | "resolve"
  | "rerequest"
  | "requestReview"
  | "review"
  | "fixCi"
  | "resolveConflicts"
  | "rerun"
  | "updateBranch"
  | "merge"
  | "autoMerge"
  | "ready"

export type MergeMethod = "SQUASH" | "MERGE" | "REBASE"

export type MentionedPull = { number: number; title: string; author: string }

export type PullStack = { number: number; position: number; size: number }

export type PullRow = {
  number: number
  title: string
  url: string
  author: string
  headRefName: string
  // The commit the row was read at; a merge is refused when the branch has moved since.
  headOid: string
  baseRefName: string
  // A fork's branch may share its name with one of this repository's, so the name alone proves nothing.
  isCrossRepository: boolean
  // Not up for review yet: drawn dim, and listed last.
  isDraft: boolean
  // The stack it is in (GitHub's stacked pull requests): which, and its place from the bottom; null in none.
  stack: PullStack | null
  // The stage its status says, on the viewer's own; null on someone else's.
  stage: MineStage | null
  status: Badge
  details: Badge[]
  actions: PullAction[]
  // The one of `actions` that is the next step, drawn as the main button; none on a row that waits on others.
  primary: PullAction | null
  // On your own: those whose change request stands though commits came after their latest review, and who aren't
  // asked to review again yet, whom Re-Request Review asks. Empty on others'.
  rerequestFrom: string[]
  // On your own: whether nobody is asked to review it and nobody requested changes or left a comment-only review yet, as
  // its details say ("no reviewer requested"); Request Review offers GitHub's suggestions then (`suggestions.ts`).
  // False on others'.
  isReviewerUnrequested: boolean
  signals: PullSignals
}

export type PullsSnapshot = {
  // The shape this snapshot was read into; one kept in the session from another version only sets a baseline.
  schema: number
  repo: string
  viewer: string
  fetchedAt: number
  // The repository's address on GitHub, for links to it.
  url: string
  // How the repository lets pull requests merge: the methods it allows, the viewer's usual one first, whether the
  // viewer can push there (merge, re-run checks) and request reviews there (triage access and up), and whether it
  // suggests updating any branch behind its base.
  merging: {
    methods: MergeMethod[]
    isAutoMergeAllowed: boolean
    canWrite: boolean
    canRequestReviews: boolean
    isUpdateSuggested: boolean
  }
  // Whether a list holds fewer pull requests than GitHub found, each search being cut at 30; `requested`, whether the
  // search for review requests, one of those the review list joins, was.
  isCut: { mine: boolean; review: boolean; requested: boolean }
  // Someone else's open pull requests that mention the viewer, and whether the search held them all.
  mentioned: { pulls: MentionedPull[]; isCut: boolean }
  mine: PullRow[]
  review: PullRow[]
  // The viewer's own drafts left out of `mine`, with the Hide drafts setting on: how many, and their numbers, which a
  // list kept by an earlier version lacks.
  hiddenDrafts: number
  hiddenDraftNumbers?: number[]
  // The repository's default branch, null for one with no commits yet; the branches of this repository that the
  // viewer's open pull requests come from, hidden drafts' included; and the latest ones whose pull request left the
  // list since, merged, closed or past the search's 30, carried from refresh to refresh.
  defaultBranch: string | null
  ownHeads: PullHead[]
  endedHeads: PullHead[]
  // The latest pull requests GitHub said were closed once they left the lists, with what was known of them then, so
  // one reopened is no news; carried from refresh to refresh. A list kept by an earlier version has none.
  endedPulls?: EndedPull[]
}

// A branch a pull request comes from, the commit it was at, and the pull request's number, which a list kept by an
// earlier version lacks.
export type PullHead = { branch: string; oid: string; number?: number }

// A pull request that was closed, as the lists knew it: whether it mentioned the viewer, and, from the review list
// alone, whether the viewer was asked to review it and whether commits came after their review; and when the list that
// first kept it was read.
export type EndedPull = {
  number: number
  isMentioned: boolean
  isRequested?: boolean
  hasCommitsSinceMyReview?: boolean
  at?: number
}

// What GitHub said of the pull requests from a branch of a repository, with the checkout at commit `head`: whether one
// is open from it, or one that ended holds that commit, so Create PR has nothing to open (`pullToOpen`). Said while
// the list knew the branch's last pull request to end at `endedHead` (`endedHeads`), null for none: once the list
// knows another, it is asked again.
export type BranchPulls = { repo: string; branch: string; head: string; isTaken: boolean; endedHead: string | null }

// The branch this session's checkout was on and its commit, both null where git could not tell, and when they were
// read, so an older read never takes a newer one's place.
export type CheckoutAt = { branch: string | null; head: string | null; at: number }

// Changes one refresh noticed on a pull request, noted at the foot of its row until marked seen or expired. They
// happened between the refresh before (`since`) and this one (`at`). One that merged or closed has no row left: it is
// noted under the lists, by its title (`ended`).
export type Activity = {
  number: number
  symbol: string
  events: string[]
  since: number
  at: number
  ended?: { title: string }
}

// A pull request merged from the pane a moment ago (`at`), shown where its row was (`index` in your own list)
// until GitHub's search has caught up with the merge.
export type MergedPull = { number: number; title: string; url: string; base: string; index: number; at: number }

// A question the plugin asks in its own dialog: what kind it is, short enough for Claude Code's own dialog to head it,
// and what it is about (the pull request's number and title); the question, then what its answers do or cost, or
// null; the answers offered, and the one drawn as the main action, or null where none is; and where instructions sent
// alone go ("to a review in this session"), or null where none are taken.
export type Question = {
  header: string
  subject: string
  text: string
  detail: string | null
  choices: string[]
  main: string | null
  instructions: string | null
  // A question that asks for a piece of text other than instructions, as a link to paste, names its field.
  field?: QuestionField
  // A question answered by picking among names before pressing an answer names them (`picking.ts`).
  picking?: Picking
}

// What a question offers to pick: names, any number of them or one of them always (`isSingle`), those picked as it
// opens (`first`, by index), whether its main answer waits for a pick (`needsPick`), and whether the keyboard starts on
// the names or on the answers.
export type Picking = {
  names: string[]
  isSingle: boolean
  first: number[]
  needsPick: boolean
  startsOn: "names" | "answers"
}

// A field for a piece of text: its label and placeholder, what its Enter does in a word (drawn beside it, `↵Check`),
// and what Claude Code's own dialog says of typing it under Other.
export type QuestionField = { label: string; placeholder: string; submitLabel: string; otherHint: string }

// An answer: the choice pressed, or null for instructions sent alone, with the instructions typed ("" for none), and the
// names picked where the question offered some.
export type Answer = { choice: string | null; instructions: string; picks?: string[] }

declare module "claude-code" {
  interface PluginState {
    "gh-prs-monitor": {
      snapshot: PullsSnapshot | null
      // The load of the module that shows lists, and whether a load of the list is under way there: a reload's, once
      // it started, so the module it replaced, still finishing a hook, shows none over the newer one's, nor marks it.
      module: { id: string; isLoading: boolean } | null
      problem: string | null
      // When /prs printed the list as no app was attached to draw the pane, the pane opening once one attaches, as
      // the desktop app does a moment after its session starts, a reload between them too; null while none waits.
      paneAskedAt: number | null
      // What is under way, by what it marks: a pull request's number, drawn in place of its buttons, or of its status
      // in the compact view; or "create-pr", in place of Create PR.
      busy: Record<string, string>
      // While /prs demo runs, the pane, the status line and the desktop app's band show example pull requests.
      isDemo: boolean
      // Changes noticed lately, until marked seen or expired.
      activity: Activity[]
      // The branch this session's checkout was on, whose pull request the pane marks, and its commit, as last read;
      // null until first read.
      checkout: CheckoutAt | null
      // What GitHub said of the pull requests from that branch at that commit, asked once while the list knows the
      // branch's last pull request to end where it did, and again by a press of Create PR unless it said taken.
      branchPulls: BranchPulls | null
      // Pull requests merged from the pane a moment ago.
      merged: MergedPull[]
      // The pane shows each pull request's number, title and status alone, on one line or two; the choice is kept in
      // the store for later sessions.
      isCompact: boolean
      // The question the pane shows in place of the list, until it is answered or dismissed.
      dialog: Question | null
      // The main loop's turns under way, by id, and the alerts held for them to end: kept over a reload, as a turn
      // that began before it ends after it, the module that saw it start gone. Which held lines are pull request
      // changes (`changes`) is missing where a module before 1.2.0 kept them.
      turns: string[]
      heldAlerts: { held: string[]; heldSince: number | null; changes?: string[] }
    }
  }
}
