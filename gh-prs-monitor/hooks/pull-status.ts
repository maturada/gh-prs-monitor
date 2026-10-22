// Author: David Matura

// Each pull request's status in the lists: for the viewer's own, the stage its facts put it at (the first that needs
// the author), its label and tone, and the button that moves it on; for one to review, where the viewer's review
// stands.

import type { Badge, CiState, MineStage, PullAction, ReviewStage } from "../types"

type MineFacts = {
  isDraft: boolean
  isQueued: boolean
  isConflicting: boolean
  ci: CiState
  isChangesRequested: boolean
  isApproved: boolean
  // Approved, but by fewer people (or not the code owners) the base requires.
  isMoreApprovalNeeded: boolean
  hasCommentsToAddress: boolean
  // Everyone who requested changes has been asked to review again.
  isReviewAskedAgain: boolean
  mergeState: string | null
}

// Where a status is dealt with on GitHub: the page that resolves conflicts, or the checks.
export const STATUS_PAGES = { conflicts: "conflicts", ciFailing: "checks" } as const

// The button that moves a pull request on from each stage, when the row offers it.
const MINE_NEXT_STEPS: Readonly<Record<MineStage, readonly PullAction[]>> = {
  draft: ["ready"],
  queued: [],
  conflicts: ["resolveConflicts"],
  ciFailing: ["rerun", "fixCi"],
  // Commits since the change request make asking again the next step; before them, addressing it.
  changesRequested: ["rerequest", "resolve"],
  comments: ["resolve"],
  rereview: [],
  // Asking someone GitHub suggests, where nobody is asked yet or more approvals are wanted, comes before waiting.
  moreApprovals: ["requestReview", "autoMerge"],
  approvedCiRunning: ["autoMerge"],
  behind: ["updateBranch"],
  // Open conversations are often what holds an approved pull request back, where the base requires them resolved.
  blocked: ["resolve", "autoMerge"],
  checking: [],
  ready: ["merge"],
  waiting: ["requestReview"]
}

// A row's main button: the first of its stage's next steps it offers.
export function primaryOf(stage: MineStage, actions: readonly PullAction[]): PullAction | null {
  return MINE_NEXT_STEPS[stage].find((action) => actions.includes(action)) ?? null
}

const MINE_STATUSES: Readonly<Record<MineStage, Badge>> = {
  draft: { text: "Draft", tone: "neutral" },
  queued: { text: "In Merge Queue", tone: "neutral" },
  conflicts: { text: "Conflicts", tone: "error" },
  ciFailing: { text: "CI Failing", tone: "error" },
  changesRequested: { text: "Changes Requested", tone: "warning" },
  comments: { text: "Comments To Address", tone: "warning" },
  rereview: { text: "Waiting For Re-Review", tone: "neutral" },
  moreApprovals: { text: "Approved · More Approvals Needed", tone: "neutral" },
  approvedCiRunning: { text: "Approved", tone: "neutral" },
  behind: { text: "Approved · Behind Base", tone: "warning" },
  blocked: { text: "Approved · Merge Blocked", tone: "warning" },
  checking: { text: "Approved · Checking Mergeability", tone: "neutral" },
  ready: { text: "Ready To Merge", tone: "success" },
  waiting: { text: "Waiting For Review", tone: "neutral" }
}

export function mineStatus(facts: MineFacts): { stage: MineStage; status: Badge } {
  const stage = mineStage(facts)

  return { stage, status: MINE_STATUSES[stage] }
}

// The first fact that needs the author decides the label, so a pull request shows the most pressing thing.
function mineStage(facts: MineFacts): MineStage {
  if (facts.isDraft) {
    return "draft"
  }
  // The queue merges it once its own checks pass, or puts it back out; nothing is the author's meanwhile.
  if (facts.isQueued) {
    return "queued"
  }
  if (facts.isConflicting) {
    return "conflicts"
  }
  // GitHub says UNSTABLE where only checks the base doesn't require fail: approved, it can merge all the same.
  if (isCiFailing(facts.ci) && !(facts.isApproved && facts.mergeState === "UNSTABLE")) {
    return "ciFailing"
  }
  if (facts.isChangesRequested) {
    return facts.isReviewAskedAgain ? "rereview" : "changesRequested"
  }
  if (facts.isApproved) {
    // The next approval is the reviewers' to give, not the author's.
    if (facts.isMoreApprovalNeeded) {
      return "moreApprovals"
    }
    if (isCiRunning(facts.ci)) {
      return "approvedCiRunning"
    }
    if (facts.mergeState === "BEHIND") {
      return "behind"
    }
    if (facts.mergeState === "BLOCKED") {
      return "blocked"
    }

    // GitHub works mergeability out lazily, after a push to the base among others; until then it says UNKNOWN.
    return MERGEABLE_STATES.includes(facts.mergeState ?? "") ? "ready" : "checking"
  }
  // A review that only comments gives no verdict, but its open threads wait on the author all the same. An
  // approval says the reviewer is fine merging, so there they stay a detail.
  if (facts.hasCommentsToAddress) {
    return "comments"
  }

  return "waiting"
}

// Clean, or clean but for checks the base doesn't require failing, or hooks to run on merge.
const MERGEABLE_STATES: readonly string[] = ["CLEAN", "UNSTABLE", "HAS_HOOKS"]

type ReviewFacts = {
  hasReviewed: boolean
  myState: string | null
  isRequested: boolean
  hasCommitsSinceMyReview: boolean
}

const REVIEW_STATUSES: Readonly<Record<ReviewStage, Badge>> = {
  requested: { text: "Review Requested", tone: "warning" },
  rerequested: { text: "Re-Review Requested", tone: "warning" },
  dismissed: { text: "Your Review Was Dismissed", tone: "warning" },
  updated: { text: "Updated Since Your Review", tone: "warning" },
  waitingOnAuthor: { text: "Waiting On Author", tone: "neutral" },
  commented: { text: "You Commented", tone: "neutral" }
}

export function reviewStatus(facts: ReviewFacts): { stage: ReviewStage; status: Badge } {
  const stage = reviewStage(facts)

  return { stage, status: REVIEW_STATUSES[stage] }
}

// The first of these that holds: a request, a dismissal, new commits since the viewer's review, their change request
// waiting on the author, else their comments.
function reviewStage(facts: ReviewFacts): ReviewStage {
  if (facts.isRequested) {
    return facts.hasReviewed ? "rerequested" : "requested"
  }
  if (facts.myState === "DISMISSED") {
    return "dismissed"
  }
  if (facts.hasCommitsSinceMyReview) {
    return "updated"
  }

  return facts.myState === "CHANGES_REQUESTED" ? "waitingOnAuthor" : "commented"
}

export function isCiFailing(ci: CiState): boolean {
  return ci === "FAILURE" || ci === "ERROR"
}

export function isCiRunning(ci: CiState): boolean {
  return ci === "PENDING" || ci === "EXPECTED"
}
