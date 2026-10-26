// Author: David Matura

// Create PR: whether the session's branch has a pull request to open (`pullToOpen`) and, where the lists can't tell,
// GitHub's lookup of the branch's pull requests; the question its button asks, and the argument line it hands the
// create-pr skill.

import type { BranchMerge, BranchPulls, PullsSnapshot, Question } from "../types"
import { oneLine, quotedArg } from "./args"
import { isOnBranch } from "./pulls"
import { prNumberOf } from "./worktrees"
import { SESSION_CHOICES } from "./question"

// Create PR's button, by its key, and what a press of it or its skill's turn marks as under way (`Mark`).
export const CREATE_PR = "create-pr"

// What each place does, and that nothing reaches GitHub unasked.
function createDetail(isWorking: boolean): string {
  const here = isWorking
    ? "This session is busy, so here it starts once its turn ends."
    : "Here it runs in this conversation."

  return `${here} A new session opens with it typed in, for you to send. Nothing is pushed or opened before you say yes to its preview.`
}

// Where instructions sent alone go (`readSessionAnswer`).
const CREATE_INSTRUCTIONS = "to a pull request created in this session"

// The dialog's question for Create PR: here or in a new session, with room for instructions. The pull request goes
// from the branch into the repository's default one, unless instructions name another.
export function createPlaceQuestion(branch: string, base: string, isWorking: boolean): Question {
  return {
    header: "Create PR",
    subject: `${branch} → ${base}`,
    text: "Where should it be created?",
    detail: createDetail(isWorking),
    choices: Object.values(SESSION_CHOICES),
    main: null,
    instructions: CREATE_INSTRUCTIONS
  }
}

// The argument line the create-pr skill reads: `--branch "<name>" [--worktree "<path>"] [-- <instructions>]`, the
// folder where a session opened elsewhere finds the branch checked out.
export function createArgs(args: { branch: string; worktree?: string; note?: string }): string {
  const parts = [`--branch ${quotedArg(args.branch)}`]
  if (args.worktree) {
    parts.push(`--worktree ${quotedArg(args.worktree)}`)
  }
  if (args.note) {
    parts.push(`-- ${oneLine(args.note)}`)
  }

  return parts.join(" ")
}

// A pull request Create PR could open: from the session's branch into the repository's default one.
export type PullToOpen = { branch: string; base: string }

// The one from the session's branch, at commit `head`, where it has none: a branch other than the repository's default
// and the `pr-<number>` ones /prs checks pull requests out as, from which none of the viewer's open pull requests
// comes, nor any listed for review, nor one that ended with nothing new on the branch since; in a repository the viewer
// can push to, as the branch goes there. One the lists don't show, as one that ended before they looked, only GitHub
// can tell (`looked`, `BRANCH_PULLS_QUERY`): none until it said there is none from the branch at that commit.
export function pullToOpen(
  snapshot: PullsSnapshot | null,
  branch: string | null,
  head: string | null,
  looked: BranchPulls | null
): PullToOpen | null {
  if (snapshot === null) {
    return null
  }
  const base = snapshot.defaultBranch
  if (
    branch === null ||
    base === null ||
    branch === base ||
    prNumberOf(branch) !== null ||
    !snapshot.merging.canWrite
  ) {
    return null
  }
  const isTaken =
    snapshot.ownHeads.some((each) => each.branch === branch) ||
    snapshot.endedHeads.some((each) => each.branch === branch && each.oid === head) ||
    snapshot.review.some((row) => isOnBranch(row, branch))

  return isTaken || !isAnswered(looked, snapshot, branch, head) || looked.isTaken ? null : { branch, base }
}

// Whether `looked` is GitHub's answer about `branch` at commit `head` in the list's repository, given while the list
// knew the branch's last pull request to end where it knows it now: one given before that pull request ended, as one
// opened and closed while the session was on another branch, is no answer about it.
export function isAnswered(
  looked: BranchPulls | null,
  snapshot: PullsSnapshot,
  branch: string,
  head: string | null
): looked is BranchPulls {
  return (
    looked?.repo === snapshot.repo &&
    looked.branch === branch &&
    looked.head === head &&
    // One kept by an earlier version has no ended head, and counts as given while the list knew none.
    (looked.endedHead ?? null) === endedHeadOn(snapshot, branch)
  )
}

// GitHub's answer about the pull requests from `branch` at commit `head`, given now, with what the list knows of the
// branch's last one that ended.
export function branchPullsOf(
  snapshot: PullsSnapshot,
  branch: string,
  head: string,
  isTaken: boolean,
  merged: BranchMerge | null
): BranchPulls {
  return { repo: snapshot.repo, branch, head, isTaken, endedHead: endedHeadOn(snapshot, branch), merged }
}

function endedHeadOn(snapshot: PullsSnapshot, branch: string): string | null {
  return snapshot.endedHeads.find((each) => each.branch === branch)?.oid ?? null
}

// Whether GitHub is to be asked about the pull requests from `branch` at `head` (`BRANCH_PULLS_QUERY`): where Create
// PR would show once it says there is none; and where the list saw one from the branch end at that commit, for the note
// on a merged branch to learn whether it merged, and into what. Create PR has nothing to open there either way.
export function wantsBranchLookup(snapshot: PullsSnapshot | null, branch: string | null, head: string | null): boolean {
  if (snapshot === null || branch === null || head === null) {
    return false
  }
  const isEndedHere =
    branch !== snapshot.defaultBranch && snapshot.endedHeads.some((each) => each.branch === branch && each.oid === head)

  return isEndedHere || pullToOpen(snapshot, branch, head, branchPullsOf(snapshot, branch, head, false, null)) !== null
}
