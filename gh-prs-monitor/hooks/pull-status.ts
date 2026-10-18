// Author: David Matura

// Each pull request's status in the lists: for the viewer's own, the stage its facts put it at (the first that needs
// the author), its label and tone, and the button that moves it on; for one to review, where the viewer's review
// stands.

import type { Badge, CiState, MineStage, PullAction } from "../types"

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
export const MINE_NEXT_STEPS: Readonly<Record<MineStage, readonly PullAction[]>> = {
  draft: ["ready"],
  queued: [],
  conflicts: ["resolveConflicts"],
  ciFailing: ["rerun", "fixCi"],
  // Commits since the change request make asking again the next step; before them, addressing it.
  changesRequested: ["rerequest", "resolve"],
  comments: ["resolve"],
  rereview: [],
  moreApprovals: ["autoMerge"],
  approvedCiRunning: ["autoMerge"],
  behind: ["updateBranch"],
  // Open conversations are often what holds an approved pull request back, where the base requires them resolved.
  blocked: ["resolve", "autoMerge"],
  checking: [],
  ready: ["merge"],
  waiting: []
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

export function reviewStatus(facts: ReviewFacts): Badge {
  if (facts.isRequested) {
    return { text: facts.hasReviewed ? "Re-Review Requested" : "Review Requested", tone: "warning" }
  }
  if (facts.myState === "DISMISSED") {
    return { text: "Your Review Was Dismissed", tone: "warning" }
  }
  if (facts.hasCommitsSinceMyReview) {
    return { text: "Updated Since Your Review", tone: "warning" }
  }
  if (facts.myState === "CHANGES_REQUESTED") {
    return { text: "Waiting On Author", tone: "neutral" }
  }

  return { text: "You Commented", tone: "neutral" }
}

export function isCiFailing(ci: CiState): boolean {
  return ci === "FAILURE" || ci === "ERROR"
}

export function isCiRunning(ci: CiState): boolean {
  return ci === "PENDING" || ci === "EXPECTED"
}
