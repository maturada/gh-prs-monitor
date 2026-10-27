// Author: David Matura

// GitHub's lookup of the pull requests from the session's branch that the lists don't show (`BranchPulls`), as one
// that merged or closed before they looked: the query and its reading, the request, and the lookup a load asks where
// Create PR would show or the list saw one from the branch end (for the note on a merged branch), and Create PR's press
// asks again unless GitHub said one is open. One lookup per branch and commit at a time, its answer kept for the next.

import type { BranchMerge, BranchPulls, PullsSnapshot } from "../types"
import { isWithin } from "./machine"
import type { Host } from "./machine"
import { heldElsewhere, toplevel } from "./checkout"
import { branchPullsOf, isAnswered, wantsBranchLookup } from "./create-flow"
import { firstLine, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { GhFailure, ghRun, graphqlArgv, isWithinOnGithub, problemOf } from "./github"
import { storedSnapshot } from "./pulls"
import type { BranchLook, Session } from "./session"

// What GitHub's lookup of a branch's pull requests reaches beyond git and gh (`Host`): the list, GitHub's last answer
// about the branch (`BranchPulls`), kept for the next by a change of the answer kept as it then stands, and the debug
// log. A load asks it too (`RefreshHost`).
export type BranchLookupHost = Host & {
  storedList: () => Promise<PullsSnapshot | null>
  branchPulls: () => Promise<BranchPulls | null>
  changeBranchPulls: (change: (kept: BranchPulls | null) => BranchPulls | null) => Promise<unknown>
  log: (line: string) => void
}

// What GitHub says of the pull requests from the session's branch at its commit that the lists don't show, as one that
// merged or closed before they looked (`BranchPulls`): asked where Create PR would show, once per branch and commit
// while the list knows of no other pull request ending there (`isAnswered`), and asked again by the next load where
// GitHub could not be asked. A press asks again unless GitHub said there is one: one may have opened and ended since,
// which no list showed (`isKept`). Where the answer kept is taken, the base a merged one went into is looked for again
// in the other worktrees (`withBaseHolder`). Null where it isn't asked about, or couldn't be.
export async function lookUpBranch(
  host: BranchLookupHost,
  session: Session,
  repo: RepoRef,
  branch: string | null,
  head: string | null,
  isPress: boolean
): Promise<BranchLook | null> {
  const snapshot = storedSnapshot(await host.storedList())
  const known = await host.branchPulls()
  if (snapshot && branch !== null && isAnswered(known, snapshot, branch, head) && isKept(known, isPress)) {
    return { looked: await withBaseHolder(host, known) }
  }
  if (snapshot === null || branch === null || head === null || !wantsBranchLookup(snapshot, branch, head)) {
    return null
  }
  const asked = branchPullsOf(snapshot, branch, head, false, null)
  const key = `${branch} ${head} ${asked.endedHead}`
  if (session.branchLookup?.key !== key) {
    const done = isBranchTaken(host, repo, branch, head).then(
      async ({ isTaken, merged }): Promise<BranchLook> => {
        const looked = { ...asked, isTaken, merged, baseHeldBy: await baseHolder(host, merged) }
        await host.changeBranchPulls(() => looked)

        return { looked }
      },
      async (error: unknown): Promise<BranchLook> => {
        host.log(`The pull requests from ${branch} could not be looked up: ${messageOf(error)}`)

        return { problem: problemOf(error) }
      }
    )
    session.branchLookup = {
      key,
      done: done.finally(() => {
        if (session.branchLookup?.key === key) {
          session.branchLookup = null
        }
      })
    }
  }

  return (await session.branchLookup?.done) ?? null
}

// Whether GitHub's answer kept is taken as it is, by a press (`isPress`) or a load: by a press where it found the
// branch taken, as one may have opened and ended since that no list showed; by a load unless an earlier version kept
// it, which said the branch was taken but not by what merge, which the note on a merged branch needs.
function isKept(known: BranchPulls, isPress: boolean): boolean {
  return isPress ? known.isTaken : !(known.isTaken && known.merged === undefined)
}

// GitHub's answer kept, with the other worktree that has the base it merged into checked out read again, as worktrees
// come and go at the same commit; kept again where that changed, over this answer only, as another lookup may have
// kept a newer one while git was asked.
async function withBaseHolder(host: BranchLookupHost, known: BranchPulls): Promise<BranchPulls> {
  const baseHeldBy = await baseHolder(host, known.merged)
  if (baseHeldBy === (known.baseHeldBy ?? null)) {
    return known
  }
  await host.changeBranchPulls((kept) => (kept !== null && isSameAsk(kept, known) ? { ...kept, baseHeldBy } : kept))

  return { ...known, baseHeldBy }
}

// Whether two answers are about the same branch at the same commit, asked while the list knew the same last end.
function isSameAsk(one: BranchPulls, other: BranchPulls): boolean {
  return (
    one.repo === other.repo &&
    one.branch === other.branch &&
    one.head === other.head &&
    (one.endedHead ?? null) === (other.endedHead ?? null)
  )
}

// The folder of another worktree that has the base `merged` went into checked out, where switching this checkout to
// it can't happen; null for none, for no merge, or where git can't tell, as the switch itself checks again.
async function baseHolder(host: Host, merged: BranchMerge | null | undefined): Promise<string | null> {
  if (!merged?.base) {
    return null
  }
  try {
    return await heldElsewhere(host, merged.base, await toplevel(host))
  } catch {
    return null
  }
}

// The latest pull requests from a branch, to find one open, or the latest that ended, and where one merged, into what.
// GitHub lists forks' of the same name among them, which come from other branches, and can be many for a common one
// (`patch-1`): a hundred, still one rate-limit point, leaves room for them. The pull requests GitHub has commit `head`
// in tell, at no further cost, one merged whose commits this clone never fetched, as pushed from elsewhere or GitHub's
// "Update branch"; each one's merge commit tells apart the commit its merge made on the base, which GitHub counts among
// its commits too.
export const BRANCH_PULLS_QUERY = `query($owner: String!, $name: String!, $branch: String!, $head: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number state headRefOid baseRefName isCrossRepository }
    }
    object(oid: $head) {
      ... on Commit { associatedPullRequests(first: 5) { nodes { number state baseRefName mergeCommit { oid } } } }
    }
  }
}`

// What GitHub said of the pull requests from a branch (`BRANCH_PULLS_QUERY`): whether one is open, the merged one that
// holds the commit asked about among its own (`heldBy`), and the latest that ended: how, at what commit, and where it
// merged, which one and into what.
export type BranchAnswer = {
  isOpen: boolean
  heldBy: BranchMerge | null
  ended: { state: "MERGED" | "CLOSED"; head: string; merge: BranchMerge | null } | null
}

// GitHub's answer about commit `head`; null where it can't be read.
export function readBranchPulls(json: string, head: string): BranchAnswer | null {
  type Node = {
    number?: unknown
    state?: unknown
    headRefOid?: unknown
    baseRefName?: unknown
    isCrossRepository?: unknown
    mergeCommit?: { oid?: unknown } | null
  } | null
  type Repository = {
    pullRequests?: { nodes?: unknown }
    object?: { associatedPullRequests?: { nodes?: unknown } } | null
  }
  let raw: { data?: { repository?: Repository | null } | null }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const nodes = raw?.data?.repository?.pullRequests?.nodes
  if (!Array.isArray(nodes)) {
    return null
  }
  const own = (nodes as Node[]).filter((node) => node?.isCrossRepository === false)
  const ended = own.find((node) => node?.state === "MERGED" || node?.state === "CLOSED")
  // By number, so one GitHub sent with none, which can't be named, holds nothing.
  const merged = new Set(
    own.flatMap((node) => (node?.state === "MERGED" && typeof node.number === "number" ? [node.number] : []))
  )
  const associated = raw.data?.repository?.object?.associatedPullRequests?.nodes
  // Another branch's merged pull request may hold it too, as the base's commit a branch started from; and the commit a
  // merge made on the base is no commit of the branch's, though a branch name used again may be reset to it.
  const holder = Array.isArray(associated)
    ? (associated as Node[]).find(
        (node) => typeof node?.number === "number" && merged.has(node.number) && node.mergeCommit?.oid !== head
      )
    : undefined

  return {
    isOpen: own.some((node) => node?.state === "OPEN"),
    heldBy: holder ? mergeOf(holder) : null,
    ended:
      ended && typeof ended.headRefOid === "string"
        ? {
            state: ended.state as "MERGED" | "CLOSED",
            head: ended.headRefOid,
            merge: ended.state === "MERGED" ? mergeOf(ended) : null
          }
        : null
  }
}

// A merged pull request as GitHub listed it: its number, and the branch it merged into where GitHub named one.
function mergeOf(node: { number?: unknown; baseRefName?: unknown }): BranchMerge | null {
  return typeof node.number === "number"
    ? { number: node.number, base: typeof node.baseRefName === "string" ? node.baseRefName : null }
    : null
}

const UNREAD_BRANCH = "GitHub's answer about the branch's pull requests could not be read."

// Whether a branch is taken (`isBranchTaken`), and the merged pull request that takes it, if one does.
type BranchTaken = { isTaken: boolean; merged: BranchMerge | null }

// Whether the branch is taken: one open from it, or one that ended at commit `head` or after it, so the branch holds
// nothing new: a merged one with the commit among its own, as GitHub says (`readBranchPulls`), or the latest that
// ended. Where one merged takes it, which one and into what (`merged`). Rejects where GitHub, or git, could not be
// asked.
export async function isBranchTaken(host: Host, repo: RepoRef, branch: string, head: string): Promise<BranchTaken> {
  const asked = await ghRun(host, graphqlArgv(repo, BRANCH_PULLS_QUERY, { branch, head }), 30_000)
  const found = asked.ran?.exitCode === 0 ? readBranchPulls(asked.ran.stdout, head) : null
  if (found === null) {
    throw "problem" in asked
      ? new GhFailure(asked.problem, asked.said)
      : new GhFailure({ message: UNREAD_BRANCH, isPermanent: false }, firstLine(asked.ran.stderr))
  }
  if (found.isOpen || found.heldBy !== null) {
    return { isTaken: true, merged: found.isOpen ? null : found.heldBy }
  }
  if (found.ended === null) {
    return { isTaken: false, merged: null }
  }
  const within = await isWithin(host, head, found.ended.head)
  // Where git can't place the two, a merged one doesn't hold `head`, as GitHub didn't list it among its own commits
  // (`heldBy`, above); only a closed one is compared on GitHub.
  if (within !== "unknown" || found.ended.state === "MERGED") {
    return within === "within" ? { isTaken: true, merged: found.ended.merge } : { isTaken: false, merged: null }
  }

  return { isTaken: await isWithinOnGithub(host, repo, head, found.ended.head), merged: null }
}
