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
import { branchPlaceQuestion } from "./branch-flow"
import type { PullToOpen } from "./create-flow"
import { CANCEL, isDecline } from "./question"
import { isBackToReview, rereviewQuestion, reviewPlaceQuestion } from "./review-flow"
import type { PaneView } from "./pane"
import { readPulls } from "./pulls"
import { activityOf, alertLines, awayLine, systemNotificationText } from "./alerts"
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
  "These are examples, so their notes stay. Close the pane, or press Refresh, for your own pull requests."

// What an example's button asks: the real button's own question, about the example, from a checkout on another branch
// with nothing uncommitted; null where the real one asks nothing and starts here, as Review where no new session can be
// opened. A stacked example's Merge says what merges along, as GitHub's stack says of a real one.
export function demoQuestion(
  action: PullAction,
  row: PullRow,
  snapshot: PullsSnapshot,
  canOpenSession: boolean
): Question | null {
  const checkout = { uncommitted: 0, isDetached: false, isOnBranch: false }
  const methods = snapshot.merging.methods
  const placed = row.stack
  const below = [...snapshot.mine, ...snapshot.review].filter(
    (other) => placed && other.stack?.number === placed.number && other.stack.position < placed.position
  )
  const stack = placed
    ? {
        number: placed.number,
        base: snapshot.defaultBranch ?? row.baseRefName,
        below: below.map((other) => ({ number: other.number, title: other.title }))
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
        ? rereviewQuestion(row, false, snapshot.fetchedAt, canOpenSession)
        : canOpenSession
          ? reviewPlaceQuestion(row, false)
          : null,
    resolve: () => branchPlaceQuestion("resolve", row, checkout, canOpenSession, false),
    fixCi: () => branchPlaceQuestion("fixCi", row, checkout, canOpenSession, false),
    resolveConflicts: () => branchPlaceQuestion("resolveConflicts", row, checkout, canOpenSession, false)
  }

  return questions[action]()
}

// What an example's press would have done where the real one asks nothing and starts in this session.
export function demoStartNote(example: string, what: string): string {
  return `${example} is an example: in your own list, ${what} would start here without asking. Nothing was sent to GitHub.`
}

// What an answer to an example's question would have done, said instead of done, the example named as given (its
// number, or Create PR's branch); nothing for Cancel, for nothing sent, or for words sent alone that decline or that
// the question takes none of.
export function demoAnswerNote(example: string, question: Question, answer: Answer | null): string | null {
  if (
    answer === null ||
    answer.choice === CANCEL ||
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
  return JSON.stringify({
    data: {
      viewer: { login: VIEWER },
      repository: {
        nameWithOwner: DEMO_NAME,
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
      mine: group(MINE, now, true),
      requested: group(
        REVIEW.filter((example) => example.requested?.includes(VIEWER)),
        now
      ),
      commented: group([], now),
      reviewed: group(
        REVIEW.filter((example) => example.reviews?.some((review) => review.login === VIEWER)),
        now
      ),
      mentioned: { issueCount: 0, nodes: [] }
    }
  })
}

export function demoSnapshot(now: number): PullsSnapshot | null {
  const result = readPulls(demoAnswer(now), DEMO_NAME, now, { includeOutdated: false })
  if (!("snapshot" in result)) {
    return null
  }

  const snapshot = {
    ...result.snapshot,
    mine: withoutLinks(result.snapshot.mine),
    review: withoutLinks(result.snapshot.review)
  }

  return withRequestReview(snapshot, demoSuggested)
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

// The pane as the examples fill it, at the width and on the surface it is drawn.
// `isShowingTickets`: the examples' tickets show as real rows' do, where Ticket links on rows is on.
export function demoView(
  now: number,
  columns: number,
  surface: string,
  isCompact: boolean,
  isShowingTickets: boolean
): PaneView {
  const snapshot = demoSnapshot(now)

  return {
    snapshot,
    problem: null,
    retryMinutes: null,
    now,
    isLoading: false,
    busy: {},
    activity: demoActivity(now),
    branch: DEMO_BRANCH,
    toOpen: DEMO_TO_OPEN,
    merged: demoMerged(snapshot, now),
    isCompact,
    columns,
    surface,
    tickets: isShowingTickets ? DEMO_TICKETS : null
  }
}

export function demoCounts(now: number): SummaryCounts {
  const snapshot = demoSnapshot(now)

  return snapshot ? summaryCounts(snapshot) : { ready: 0, needsYou: 0, toReview: 0 }
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
  change(1241, "Shareable invite links", "newCommits", "↻", "new commits since your review"),
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
