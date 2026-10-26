// Author: David Matura

import type { Activity, Answer, Badge, MergedPull, PullAction, PullRow, PullsSnapshot, Question } from "../types"
import {
  andList,
  confirmQuestion,
  mergeConfirm,
  readyConfirm,
  requestQuestion,
  rerequestConfirm,
  rerunConfirm,
  updateConfirm
} from "./actions"
import { branchPlaceQuestion, cloneOpens, isBranchSkill, openCloneQuestion } from "./branch-flow"
import type { PullToOpen } from "./create-flow"
import { CHECKED_KINDS, elsewhereAlerts, nextElsewhere, readElsewhere } from "./elsewhere"
import type { ElsewhereRead, ElsewhereState } from "./elsewhere"
import { DEFAULT_HOST, sameRepo } from "./gh"
import type { RepoRef } from "./gh"
import { canOpenSession } from "./new-session"
import { isInFolder, typedPath } from "./paths"
import { CANCEL, isDecline } from "./question"
import { isBackToReview, backToReviewQuestion, reviewPlaceQuestion } from "./review-flow"
import type { PaneView } from "./pane"
import { readPulls, rowsOf } from "./pulls"
import { choiceOf, elsewhereCount, repoChoices, repoPickerQuestion } from "./repo-picker"
import type { RepoChoice } from "./repo-picker"
import { activityOf, alertLines, awayLine, batchLines, systemNotificationText, toastLines } from "./alerts"
import type { Alert, AlertKind } from "./alerts"
import { listText } from "./list"
import { withRequestReview } from "./suggestions"
import { summaryCounts } from "./summary"
import type { SummaryCounts } from "./summary"
import type { TicketLinks } from "./tickets"

// Everything `/prs demo` shows: example pull requests, one of each status, the alerts they would raise and what
// changed on them lately. The examples are written as GitHub would answer and read by the same code as the real
// ones, so the demo always shows each status as it is today.

// The examples stay in the pane, the status line and the desktop app's band until the pane closes, Refresh is pressed
// or /prs runs; their alerts show `DEMO_TOAST_GAP_MS` apart.
export const DEMO_TOAST_GAP_MS = 1_500

// An example's ✕, which keeps its note: the examples stay as they are.
export const DEMO_SEEN_NOTE =
  "These are examples, so their notes stay. Close the pane, or press ↻, for your own pull requests."

// What an example's button asks: the real button's own question, about the example, from a checkout on another branch
// with nothing uncommitted, asked from `surface` while a turn runs or none (`isWorking`); null where the real one asks
// nothing and starts here, as Review where no new session can be opened. A stacked example's Merge says what merges
// along, as GitHub's stack says of a real one. On another repository's examples (`visited`), a branch skill asks as a
// visit's does, of the clone known here or none.
export function demoQuestion(
  action: PullAction,
  row: PullRow,
  snapshot: PullsSnapshot,
  { surface, visited = null, isWorking = false }: { surface: string; visited?: string | null; isWorking?: boolean }
): Question | null {
  const other = otherShown(visited)
  if (other && isBranchSkill(action)) {
    return openCloneQuestion(action, row, repoOf(other), other.clone, cloneOpens(surface))
  }
  const canOpen = canOpenSession(surface)
  const checkout = { uncommitted: 0, isDetached: false, isOnBranch: false }
  const methods = snapshot.merging.methods
  const placed = row.stack
  const below = rowsOf(snapshot).filter(
    (each) => placed && each.stack?.number === placed.number && each.stack.position < placed.position
  )
  const stack = placed
    ? {
        number: placed.number,
        base: snapshot.defaultBranch ?? row.baseRefName,
        below: below.map((each) => ({ number: each.number, title: each.title }))
      }
    : null
  const questions: Readonly<Record<PullAction, () => Question | null>> = {
    merge: () => confirmQuestion(mergeConfirm(row, methods, false, stack, placed)),
    autoMerge: () => confirmQuestion(mergeConfirm(row, methods, true, null, placed)),
    updateBranch: () => confirmQuestion(updateConfirm(row)),
    ready: () => confirmQuestion(readyConfirm(row)),
    rerequest: () => confirmQuestion(rerequestConfirm(row)),
    requestReview: () => requestQuestion(row, demoSuggested(row)),
    rerun: () => confirmQuestion(rerunConfirm(row, [{ id: 0, name: "test" }])),
    review: () =>
      isBackToReview(row)
        ? backToReviewQuestion(row, isWorking, snapshot.fetchedAt, canOpen)
        : canOpen
          ? reviewPlaceQuestion(row, isWorking)
          : null,
    resolve: () => branchPlaceQuestion("resolve", row, checkout, canOpen, isWorking),
    fixCi: () => branchPlaceQuestion("fixCi", row, checkout, canOpen, isWorking),
    resolveConflicts: () => branchPlaceQuestion("resolveConflicts", row, checkout, canOpen, isWorking)
  }

  return questions[action]()
}

// What an example's press would have done where the real one asks nothing and starts in this session.
export function demoStartNote(example: string, what: string): string {
  return `${example} is an example: in your own list, ${what} would start here without asking. Nothing was sent to GitHub.`
}

// What an answer to an example's question would have done, said instead of done. The example is named as given: its
// number, or Create PR's branch. Nothing is said for Cancel, or for nothing sent; for words sent alone that decline, or
// that the question takes none of; or for a question that only tells, its one choice closing it.
export function demoAnswerNote(example: string, question: Question, answer: Answer | null): string | null {
  if (
    answer === null ||
    answer.choice === CANCEL ||
    question.choices.length === 1 ||
    (answer.choice === null &&
      (question.instructions === null || answer.instructions === "" || isDecline(answer.instructions)))
  ) {
    return null
  }
  // What goes ahead, the place pressed or instructions sent alone, and what goes with it: the names picked, and
  // instructions typed before a press.
  const what = answer.choice === null ? "your instructions" : `"${answer.choice}"`
  const along = [
    ...(answer.picks ?? []),
    ...(answer.choice !== null && answer.instructions !== "" ? ["your instructions"] : [])
  ]
  const picked = along.length > 0 ? `${what} with ${andList(along)}` : what

  return `${example} is an example: in your own list, ${picked} would go ahead. Nothing was sent to GitHub.`
}

// Where a repository's name would stand: the list's, and the title of the examples' system notification.
const DEMO_NAME = "Example pull requests"
// Where every example links: the person's own pull requests on GitHub, as no example exists there.
const LINK = "https://github.com/pulls"
const VIEWER = "you"
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type ExampleReview = {
  login: string
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED"
  hoursAgo: number
  // A review given before the latest commit, so new commits came since.
  isBeforeHead?: boolean
}

type Example = {
  number: number
  title: string
  author?: string
  isDraft?: boolean
  isConflicting?: boolean
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED"
  mergeStateStatus?: "BEHIND" | "BLOCKED" | "UNKNOWN"
  isInMergeQueue?: boolean
  ci?: "FAILURE" | "PENDING"
  unresolvedThreads?: number
  reviews?: ExampleReview[]
  requested?: string[]
  // Lines added and removed, and files changed.
  size?: [number, number, number]
  stack?: { number: number; position: number; size: number }
  // The ticket its branch names, as a team's branches do (`example/APP-409`); some have none, as in a real list.
  ticket?: number
}

// The viewer's own, one of each status, in the order the pane sorts them.
const MINE: readonly Example[] = [
  { number: 1237, title: "Move the map to the tiles API", ci: "FAILURE", requested: ["a-teammate"], ticket: 412 },
  { number: 1238, title: "Rename the settings fields", isConflicting: true, requested: ["a-teammate"] },
  {
    number: 1236,
    title: "Cache the search results",
    ticket: 409,
    reviewDecision: "CHANGES_REQUESTED",
    unresolvedThreads: 2,
    // Commits came after it, so it can be asked again.
    reviews: [{ login: "a-teammate", state: "CHANGES_REQUESTED", hoursAgo: 1, isBeforeHead: true }]
  },
  {
    number: 1235,
    // Its title says how ticket links are set up, and its ticket opens the page on it.
    title: "Link your tickets with /prs tickets",
    ticket: 398,
    unresolvedThreads: 3,
    reviews: [{ login: "a-teammate", state: "COMMENTED", hoursAgo: 3 }],
    requested: ["another-teammate"]
  },
  {
    number: 1249,
    title: "Activity cards in the sidebar",
    reviewDecision: "APPROVED",
    mergeStateStatus: "BEHIND",
    reviews: [{ login: "a-teammate", state: "APPROVED", hoursAgo: 4 }]
  },
  {
    number: 1250,
    title: "Remove the old map",
    reviewDecision: "APPROVED",
    mergeStateStatus: "BLOCKED",
    reviews: [{ login: "another-teammate", state: "APPROVED", hoursAgo: 26 }]
  },
  {
    number: 1242,
    title: "Offline downloads",
    ticket: 371,
    // The lowest open one of stack #30, with #1248 above it; #1230 below it merged, and still counts, as on GitHub.
    stack: { number: 30, position: 2, size: 3 },
    reviewDecision: "APPROVED",
    reviews: [{ login: "a-teammate", state: "APPROVED", hoursAgo: 2 }]
  },
  {
    number: 1246,
    title: "Retry failed uploads",
    ticket: 420,
    reviewDecision: "CHANGES_REQUESTED",
    reviews: [{ login: "a-teammate", state: "CHANGES_REQUESTED", hoursAgo: 6 }],
    requested: ["a-teammate"]
  },
  {
    number: 1247,
    title: "Monthly usage summary",
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "BLOCKED",
    reviews: [{ login: "a-teammate", state: "APPROVED", hoursAgo: 1 }],
    requested: ["another-teammate"]
  },
  {
    number: 1248,
    title: "Sticky page header",
    stack: { number: 30, position: 3, size: 3 },
    reviewDecision: "APPROVED",
    ci: "PENDING",
    reviews: [{ login: "another-teammate", state: "APPROVED", hoursAgo: 5 }]
  },
  {
    number: 1251,
    title: "Fix the date picker",
    reviewDecision: "APPROVED",
    mergeStateStatus: "UNKNOWN",
    reviews: [{ login: "a-teammate", state: "APPROVED", hoursAgo: 0.5 }]
  },
  {
    number: 1256,
    title: "Compress uploaded photos",
    ticket: 405,
    reviewDecision: "APPROVED",
    isInMergeQueue: true,
    reviews: [{ login: "another-teammate", state: "APPROVED", hoursAgo: 1 }]
  },
  // Just opened where the base requires a review, nobody asked yet: Request Review offers the people GitHub would
  // suggest (`DEMO_SUGGESTED`).
  {
    number: 1239,
    title: "Lazy-load the video player",
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "BLOCKED"
  },
  { number: 1244, title: "New onboarding experiment", isDraft: true }
]

// Someone else's, waiting on the viewer or taken part in, one of each status.
const REVIEW: readonly Example[] = [
  {
    number: 1240,
    title: "Activity cards on the home feed",
    ticket: 423,
    author: "a-teammate",
    requested: [VIEWER],
    size: [120, 30, 8]
  },
  {
    number: 1252,
    title: "Search filters",
    author: "another-teammate",
    reviews: [{ login: VIEWER, state: "COMMENTED", hoursAgo: 24 }],
    requested: [VIEWER],
    size: [64, 9, 4]
  },
  {
    number: 1241,
    title: "Shareable invite links",
    ticket: 401,
    author: "another-teammate",
    reviews: [{ login: VIEWER, state: "COMMENTED", hoursAgo: 20, isBeforeHead: true }],
    size: [48, 12, 3]
  },
  {
    number: 1253,
    title: "Offline maps",
    author: "a-teammate",
    reviews: [{ login: VIEWER, state: "DISMISSED", hoursAgo: 30 }],
    size: [310, 120, 14]
  },
  {
    number: 1254,
    title: "Account deletion flow",
    author: "another-teammate",
    reviews: [{ login: VIEWER, state: "CHANGES_REQUESTED", hoursAgo: 8 }],
    size: [92, 40, 6]
  },
  {
    number: 1243,
    title: "Cache the map tiles offline",
    ticket: 375,
    author: "a-teammate",
    reviews: [{ login: VIEWER, state: "COMMENTED", hoursAgo: 4 }],
    size: [210, 95, 11]
  }
]

function branchOf(example: Example): string {
  return `example/${example.ticket ? `${DEMO_PREFIX}${example.ticket}` : example.number}`
}

// The examples' tickets link to the page on setting ticket links up (`/prs tickets`), as no example ticket exists.
const DEMO_PREFIX = "APP-"
const DEMO_TICKETS: TicketLinks = {
  [DEMO_PREFIX]: "https://github.com/maturada/gh-prs-monitor/blob/main/gh-prs-monitor/docs/tickets.md"
}

// As GitHub answers the query: the viewer's own fragment (`pull`) or the review lists' (`reviewPull`).
function rawPull(example: Example, now: number, isOwn: boolean): unknown {
  // Commit ids that read as GitHub's do, cut to seven characters as a review's line names one: the head, and one
  // before it.
  const head = `${example.number}ab3f9c2e7d1`
  const before = `${example.number}0d71e5a4c96`
  const reviews = example.reviews ?? []
  const review = (each: ExampleReview) => ({
    author: { __typename: "User", login: each.login },
    state: each.state,
    submittedAt: new Date(now - each.hoursAgo * HOUR).toISOString(),
    commit: { oid: each.isBeforeHead ? before : head }
  })
  const verdicts = reviews.filter((each) => each.state === "APPROVED" || each.state === "CHANGES_REQUESTED").map(review)
  const [additions, deletions, changedFiles] = example.size ?? []
  const own = reviews.find((each) => each.login === VIEWER)
  const ownReview = own && review(own)
  // GitHub's latest reviews leave out a reviewer asked to review again, until they do.
  const askedAgain = new Set(example.requested ?? [])
  const byFragment = isOwn
    ? {
        latestReviews: { nodes: reviews.filter((each) => !askedAgain.has(each.login)).map(review) },
        reviewDecision: example.reviewDecision ?? null,
        mergeStateStatus: example.isConflicting ? "DIRTY" : (example.mergeStateStatus ?? "CLEAN"),
        isInMergeQueue: example.isInMergeQueue === true,
        viewerCanEnableAutoMerge: true,
        viewerCanUpdateBranch: example.mergeStateStatus === "BEHIND"
      }
    : {
        additions,
        deletions,
        changedFiles,
        viewerLatestReview: ownReview
          ? { state: ownReview.state, submittedAt: ownReview.submittedAt, commit: ownReview.commit }
          : null
      }

  return {
    number: example.number,
    title: example.title,
    url: LINK,
    isDraft: example.isDraft === true,
    headRefName: branchOf(example),
    headRefOid: head,
    baseRefName: "main",
    isCrossRepository: false,
    stackEntry: example.stack
      ? { position: example.stack.position, stack: { number: example.stack.number, size: example.stack.size } }
      : null,
    author: { login: example.author ?? VIEWER },
    mergeable: example.isConflicting ? "CONFLICTING" : "MERGEABLE",
    autoMergeRequest: null,
    statusCheckRollup: { state: example.ci ?? "SUCCESS" },
    reviewThreads: { nodes: Array.from({ length: example.unresolvedThreads ?? 0 }, () => ({ isResolved: false })) },
    writerVerdicts: { nodes: verdicts },
    reviewRequests: {
      nodes: (example.requested ?? []).map((login) => ({ requestedReviewer: { __typename: "User", login } }))
    },
    comments: { totalCount: 0, nodes: [] },
    ...byFragment
  }
}

function group(examples: readonly Example[], now: number, isOwn = false): unknown {
  return { issueCount: examples.length, nodes: examples.map((example) => rawPull(example, now, isOwn)) }
}

// An example's status and details lead nowhere real, so they are drawn as plain text.
function withoutLinks(rows: PullRow[]): PullRow[] {
  const plain = ({ text, tone }: Badge): Badge => ({ text, tone })

  return rows.map((row) => ({ ...row, status: plain(row.status), details: row.details.map(plain) }))
}

// The examples as GitHub would answer the list query about them.
export function demoAnswer(now: number): string {
  return listAnswer(DEMO_NAME, MINE, REVIEW, now)
}

// A repository's examples, the viewer's own (`mine`) and others' (`review`), as GitHub would answer the list query.
function listAnswer(name: string, mine: readonly Example[], review: readonly Example[], now: number): string {
  return JSON.stringify({
    data: {
      viewer: { login: VIEWER },
      repository: {
        nameWithOwner: name,
        url: "",
        viewerPermission: "WRITE",
        squashMergeAllowed: true,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: false,
        autoMergeAllowed: true,
        viewerDefaultMergeMethod: "SQUASH",
        allowUpdateBranch: false,
        defaultBranchRef: { name: "main" }
      },
      mine: group(mine, now, true),
      requested: group(
        review.filter((example) => example.requested?.includes(VIEWER)),
        now
      ),
      commented: group([], now),
      reviewed: group(
        review.filter((example) => example.reviews?.some((each) => each.login === VIEWER)),
        now
      ),
      mentioned: { issueCount: 0, nodes: [] }
    }
  })
}

export function demoSnapshot(now: number): PullsSnapshot | null {
  const snapshot = listOf(DEMO_NAME, demoAnswer(now), now)

  return snapshot && withRequestReview(snapshot, demoSuggested)
}

// The list the pane shows of examples: their own (`visited` null), or another repository's.
export function demoList(now: number, visited: string | null): PullsSnapshot | null {
  const other = otherShown(visited)

  return other ? otherList(other, now) : demoSnapshot(now)
}

function otherList(other: OtherExamples, now: number): PullsSnapshot | null {
  return listOf(other.name, listAnswer(other.name, other.mine, other.review, now), now)
}

// A repository's examples read as a real list is, from GitHub's answer about them, with nothing of them linked.
function listOf(name: string, answer: string, now: number): PullsSnapshot | null {
  const result = readPulls(answer, name, now, { includeOutdated: false })

  return "snapshot" in result
    ? { ...result.snapshot, mine: withoutLinks(result.snapshot.mine), review: withoutLinks(result.snapshot.review) }
    : null
}

// Whom GitHub would suggest to review the example nobody was asked to review, as Request Review offers a real list's
// suggestions (`suggestions.ts`).
const DEMO_SUGGESTED: Readonly<Record<number, readonly string[]>> = { 1239: ["a-teammate", "another-teammate"] }

function demoSuggested(row: PullRow): readonly string[] {
  return DEMO_SUGGESTED[row.number] ?? []
}

// What changed lately on two of the examples, from their example alerts, as the pane marks it under their rows, and
// the one merged meanwhile, noted under the lists.
function demoActivity(now: number): Activity[] {
  const changesOf = (number: number) => DEMO_CHANGES.filter((change) => change.number === number)

  return [
    ...activityOf(changesOf(1230), now - 20 * MINUTE, now - 18 * MINUTE),
    ...activityOf(changesOf(1242), now - 3 * MINUTE, now),
    ...activityOf(changesOf(1237), now - 15 * MINUTE, now - 12 * MINUTE)
  ]
}

// The examples' session sits on the branch of the one with changes requested, as if working on them; Create PR's
// example opens one from a branch of its own.
const DEMO_BRANCH = branchOf(MINE.find((example) => example.number === 1236)!)

export const DEMO_TO_OPEN: PullToOpen = { branch: "feature/export-csv", base: "main" }

// One merged from the pane a moment ago, just before the one ready to merge.
function demoMerged(snapshot: PullsSnapshot | null, now: number): MergedPull[] {
  const index = snapshot?.mine.findIndex((row) => row.stage === "ready") ?? -1

  return [
    {
      number: 1255,
      title: "Fix the onboarding copy",
      url: LINK,
      base: "main",
      index: Math.max(0, index),
      at: now - 5_000
    }
  ]
}

// The pane as the examples fill it, at the time, width and surface it is drawn (`frame`): their own list, or, where
// the person picked another of their repositories (`visited`), that one's, as a visit shows it. As a real list's, their
// tickets show where Ticket links on rows is on (`isShowingTickets`), and "+N elsewhere" where the alerts from other
// repositories are (`isCountingElsewhere`).
export function demoView(
  frame: { now: number; columns: number; surface: string; isCompact: boolean },
  shown: { isShowingTickets: boolean; isCountingElsewhere: boolean; visited: string | null }
): PaneView {
  const { now } = frame
  const other = otherShown(shown.visited)
  const elsewhere = shown.isCountingElsewhere
    ? elsewhereCount(demoElsewhere(now), DEMO_FOLDER, other && repoOf(other))
    : 0
  const quiet = { problem: null, retryMinutes: null, isLoading: false, busy: {}, elsewhere }
  if (other) {
    return {
      ...frame,
      ...quiet,
      snapshot: otherList(other, now),
      activity: [],
      branch: null,
      toOpen: null,
      merged: [],
      mergedBranch: null,
      tickets: null,
      visit: { repo: other.name, folder: DEMO_NAME }
    }
  }
  const snapshot = demoSnapshot(now)

  return {
    ...frame,
    ...quiet,
    snapshot,
    activity: demoActivity(now),
    branch: DEMO_BRANCH,
    toOpen: DEMO_TO_OPEN,
    merged: demoMerged(snapshot, now),
    // The examples' session sits on an open pull request's branch: no merged one to leave.
    mergedBranch: null,
    tickets: shown.isShowingTickets ? DEMO_TICKETS : null,
    visit: null
  }
}

export function demoCounts(now: number): SummaryCounts {
  const snapshot = demoSnapshot(now)

  return snapshot ? summaryCounts(snapshot) : { ready: 0, needsYou: 0, toReview: 0 }
}

// --- The examples' other repositories ---

// Where the examples' repositories are, as the repository picker offers them; their own list stands for the folder's.
const DEMO_HOST = DEFAULT_HOST
const DEMO_FOLDER: RepoRef = { host: DEMO_HOST, name: DEMO_NAME }

// Another repository with examples: its clone on this machine, a made-up folder, or none; the viewer's own and others'.
type OtherExamples = { name: string; clone: string | null; mine: readonly Example[]; review: readonly Example[] }

// One cloned here, whose branch skills offer to open it; one on GitHub alone, whose say none is known; one where a
// review was asked since the picker was last opened, so it is marked new (`demoChecks`); and one where your two only
// wait on others, so the picker says how many are open. The first three have something waiting, so each is counted in
// "+N elsewhere"; acme/web's #14 has changes requested, which the light check counts as the list does, so the picker
// and the list agree, and a comment unresolved, for its Resolve Comments.
const OTHERS: readonly OtherExamples[] = [
  {
    name: "acme/web",
    clone: "~/code/web",
    mine: [
      { number: 12, title: "Checkout page", ci: "FAILURE", requested: ["a-teammate"] },
      {
        number: 14,
        title: "Gift cards",
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        unresolvedThreads: 1,
        reviews: [{ login: "a-teammate", state: "CHANGES_REQUESTED", hoursAgo: 2 }],
        requested: ["another-teammate"]
      }
    ],
    review: [
      { number: 15, title: "Product images", author: "another-teammate", requested: [VIEWER], size: [86, 14, 5] }
    ]
  },
  {
    name: "acme/ios-app",
    clone: null,
    mine: [
      {
        number: 31,
        title: "Dark mode",
        isConflicting: true,
        reviewDecision: "APPROVED",
        reviews: [{ login: "a-teammate", state: "APPROVED", hoursAgo: 5 }]
      }
    ],
    review: [{ number: 33, title: "Push notifications", author: "a-teammate", requested: [VIEWER], size: [140, 22, 9] }]
  },
  {
    name: "acme/admin",
    clone: null,
    mine: [],
    review: [
      { number: 7, title: "Roles and permissions", author: "another-teammate", requested: [VIEWER], size: [58, 6, 3] }
    ]
  },
  {
    name: "acme/docs",
    clone: null,
    mine: [
      { number: 21, title: "Getting started guide", requested: ["a-teammate"] },
      { number: 22, title: "API reference", ci: "PENDING", requested: ["another-teammate"] }
    ],
    review: []
  }
]

// The one whose review was asked since the picker was last opened.
const NEW_SINCE_PICKED = "acme/admin"

// The examples' other repository shown, by its name; none for their own list (null).
function otherShown(visited: string | null): OtherExamples | null {
  return visited === null ? null : otherAt({ host: DEMO_HOST, name: visited })
}

function otherAt(repo: RepoRef): OtherExamples | null {
  return OTHERS.find((other) => sameRepo(repoOf(other), repo)) ?? null
}

function repoOf(other: OtherExamples): RepoRef {
  return { host: DEMO_HOST, name: other.name }
}

// What the light check of other repositories would have kept of the examples' others (`elsewhere.ts`).
function demoElsewhere(now: number): ElsewhereState | null {
  const checks = demoChecks(now)

  return checks && nextElsewhere(checks.before, checks.read, now)
}

// What the light check would tell of them, where the alerts from other repositories are on: what changed since its
// check before, as its toast names their repository, and as each repository's system notification.
export function demoElsewhereAlerts(now: number): {
  toasts: string[]
  notifications: { title: string; text: string }[]
} {
  const checks = demoChecks(now)
  const batches = checks ? elsewhereAlerts(checks.before, checks.read.pulls, CHECKED_KINDS) : []

  return {
    toasts: batches.flatMap(toastLines),
    notifications: batches.flatMap((batch) =>
      batch.kind === "events" ? [{ title: batch.repo.name, text: systemNotificationText(batchLines(batch)) }] : []
    )
  }
}

// The light check's two checks of the examples' others, from GitHub's answers about them: the state one a day ago kept,
// before acme/admin's review was asked, with the picker opened since; and what one now reads.
function demoChecks(now: number): { before: ElsewhereState; read: ElsewhereRead } | null {
  const checked = (others: readonly OtherExamples[]) => {
    const search = (isMine: boolean) => {
      const nodes = others.flatMap((other) =>
        (isMine ? other.mine : other.review.filter((example) => example.requested?.includes(VIEWER))).map(
          (example) => ({ ...(rawPull(example, now, isMine) as object), repository: { nameWithOwner: other.name } })
        )
      )

      return { issueCount: nodes.length, nodes }
    }

    return readElsewhere(
      JSON.stringify({ data: { viewer: { login: VIEWER }, mine: search(true), requested: search(false) } }),
      DEMO_HOST
    )
  }
  const before = checked(OTHERS.filter((other) => other.name !== NEW_SINCE_PICKED))
  const read = checked(OTHERS)

  return before && read ? { before: { ...nextElsewhere(null, before, now - DAY), pickedAt: now - HOUR }, read } : null
}

// The repository picker over the examples, as the real one offers the folder's, its clones and those on GitHub alone,
// starting on the one shown (`visited`, null for the examples' own); its choices, to read the answer by.
export function demoPicker(now: number, visited: string | null): { question: Question; choices: RepoChoice[] } {
  const clones = OTHERS.flatMap((other) => (other.clone ? [{ root: other.clone, repo: repoOf(other) }] : []))
  const choices = repoChoices(clones, demoElsewhere(now), DEMO_FOLDER)
  const other = otherShown(visited)

  return { question: repoPickerQuestion(choices, other ? repoOf(other) : DEMO_FOLDER), choices }
}

// What the picker's answer shows of the examples: their own list (`visited` null), or another repository's, picked,
// named, or by a folder in it; else what is said instead: why what was typed names no repository, or that it names none
// of the examples. A folder is read as `/prs <path>` reads one, from the home folder (`home`) and the session's
// (`cwd`), which stands for the examples' own, a clone in it counting first. Nothing for Cancel, or with nothing picked
// or typed.
export function demoPicked(
  answer: Answer | null,
  choices: readonly RepoChoice[],
  { home, cwd }: { home: string | null; cwd: string }
): { visited: string | null } | { note: string } | null {
  const chosen = answer ? choiceOf(answer, choices) : null
  if (!answer || !chosen) {
    return null
  }
  if ("problem" in chosen) {
    return { note: chosen.problem }
  }
  if ("repo" in chosen) {
    return { visited: otherAt(chosen.repo)?.name ?? null }
  }
  const none = {
    note: `${answer.instructions.trim()} is none of the examples: in your own list, its pull requests would show. Nothing was read from GitHub.`
  }
  if ("path" in chosen) {
    const typed = typedPath(chosen.path, home, cwd)
    const other = OTHERS.find((each) => each.clone !== null && isInFolder(typed, typedPath(each.clone, home, cwd)))

    return other ? { visited: other.name } : isInFolder(typed, typedPath(cwd, home, cwd)) ? { visited: null } : none
  }
  // Named on no server, a repository is on the folder's, the examples' own.
  const other = otherAt({ host: chosen.host ?? DEMO_HOST, name: chosen.name })

  return other ? { visited: other.name } : none
}

function change(number: number, title: string, kind: AlertKind, symbol: string, event: string): Alert {
  const isSomeoneElses = kind === "reviewRequests" || kind === "mentions"

  return { kind, number, title, by: isSomeoneElses ? "a-teammate" : null, symbol, event }
}

// One alert of every kind, on the examples, and two changes on one pull request sharing a line.
const DEMO_CHANGES: readonly Alert[] = [
  change(1242, "Offline downloads", "ready", "✓", "ready to merge"),
  change(1242, "Offline downloads", "reviews", "✓", "approved by a-teammate"),
  change(1235, "Link your tickets with /prs tickets", "comments", "✎", "new comment from a-teammate"),
  change(1236, "Cache the search results", "reviews", "±", "changes requested by a-teammate"),
  change(1237, "Move the map to the tiles API", "ci", "✗", "CI failed"),
  change(1238, "Rename the settings fields", "conflicts", "⚠", "merge conflicts"),
  // It sat below #1242 in stack #30, so #1242 is next.
  change(1230, "PDF export", "closed", "✓", "merged by a-teammate, #1242 is next in stack #30"),
  change(1240, "Activity cards on the home feed", "reviewRequests", "⌕", "review requested"),
  change(1241, "Shareable invite links", "newCommits", "↑", "new commits since your review"),
  change(1243, "Cache the map tiles offline", "mentions", "@", "you were mentioned")
]

const AWAY_SINCE = "yesterday 17:40"

export const DEMO_ALERTS: readonly string[] = [
  ...alertLines(DEMO_CHANGES),
  awayLine(new Set(DEMO_CHANGES.map((change) => change.number)).size, AWAY_SINCE)
]

// The examples' system notification, as a refresh would send for their changes; the summary after them is none.
export function demoNotification(): { title: string; text: string } {
  return { title: DEMO_NAME, text: systemNotificationText(alertLines(DEMO_CHANGES)) }
}

// Where nothing draws the pane, /prs prints the list instead, led by what changed since the last look: with nothing
// attached; in an app that places no panes, which still shows the alerts; or sent over Remote Control, while the pane
// shows on the computer.
export type DemoPrint = "unattached" | "unplaced" | "remote"

const DEMO_INTROS: Readonly<Record<DemoPrint, string>> = {
  unattached:
    "Nothing attached to this session draws the pane or alerts, so /prs prints the list here, led by what changed " +
    "since you last looked. With example pull requests:",
  unplaced: "This app places no panes, so /prs prints the list here, while the example alerts show:",
  remote:
    "Remote Control shows no pane, so /prs prints the list here, while the pane, its alerts and summary show on the " +
    "computer. With example pull requests:"
}

export function demoText(now: number, where: DemoPrint, isShowingTickets: boolean): string {
  const snapshot = demoSnapshot(now)
  const intro = DEMO_INTROS[where]

  return snapshot
    ? [
        intro,
        "",
        listText(
          snapshot,
          { at: AWAY_SINCE, changes: [...DEMO_CHANGES] },
          null,
          DEMO_BRANCH,
          now,
          isShowingTickets ? DEMO_TICKETS : null
        )
      ].join("\n")
    : intro
}
