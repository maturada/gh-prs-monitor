// Author: David Matura

// GitHub's lookup of the pull requests from the session's branch that the lists don't show (`BranchPulls`), as one
// that merged or closed before they looked: the query and its reading, the request, and the lookup a load asks where
// Create PR would show, and Create PR's press asks again unless GitHub said one is open. One lookup per branch and
// commit at a time, its answer kept for the next.

import type { BranchPulls, PullsSnapshot } from "../types"
import { isWithin } from "./machine"
import type { Host } from "./machine"
import { branchPullsOf, isAnswered, wantsBranchLookup } from "./create-flow"
import { firstLine, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { GhFailure, ghRun, graphqlArgv, isWithinOnGithub, problemOf } from "./github"
import { storedSnapshot } from "./pulls"
import type { BranchLook, Session } from "./session"

// What GitHub's lookup of a branch's pull requests reaches beyond git and gh (`Host`): the list, GitHub's last answer
// about the branch (`BranchPulls`), kept for the next, and the debug log. A load asks it too (`RefreshHost`).
export type BranchLookupHost = Host & {
  storedList: () => Promise<PullsSnapshot | null>
  branchPulls: () => Promise<BranchPulls | null>
  keepBranchPulls: (looked: BranchPulls) => Promise<unknown>
  log: (line: string) => void
}

// What GitHub says of the pull requests from the session's branch at its commit that the lists don't show, as one that
// merged or closed before they looked (`BranchPulls`): asked where Create PR would show, once per branch and commit
// while the list knows of no other pull request ending there (`isAnswered`), and asked again by the next load where
// GitHub could not be asked. A press asks again unless GitHub said there is one: one may have opened and ended since,
// which no list showed. Null where it isn't asked about, or couldn't be.
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
  if (snapshot && branch !== null && isAnswered(known, snapshot, branch, head) && (known.isTaken || !isPress)) {
    return { looked: known }
  }
  if (snapshot === null || branch === null || head === null || !wantsBranchLookup(snapshot, branch, head)) {
    return null
  }
  const asked = branchPullsOf(snapshot, branch, head, false)
  const key = `${branch} ${head} ${asked.endedHead}`
  if (session.branchLookup?.key !== key) {
    const done = isBranchTaken(host, repo, branch, head).then(
      async (isTaken): Promise<BranchLook> => {
        const looked = { ...asked, isTaken }
        await host.keepBranchPulls(looked)

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

// The latest pull requests from a branch, to find one open, or the latest that ended. GitHub lists forks' of the same
// name among them, which come from other branches, and can be many for a common one (`patch-1`): a hundred, still one
// rate-limit point, leaves room for them. The pull requests GitHub has commit `head` in tell, at no further cost, one
// merged whose commits this clone never fetched, as pushed from elsewhere or GitHub's "Update branch"; each one's merge
// commit tells apart the commit its merge made on the base, which GitHub counts among its commits too.
export const BRANCH_PULLS_QUERY = `query($owner: String!, $name: String!, $branch: String!, $head: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number state headRefOid isCrossRepository }
    }
    object(oid: $head) {
      ... on Commit { associatedPullRequests(first: 5) { nodes { number state mergeCommit { oid } } } }
    }
  }
}`

// What GitHub said of the pull requests from a branch (`BRANCH_PULLS_QUERY`): whether one is open, whether one merged
// holds the commit asked about among its own, and the latest that ended: how, and at what commit.
export type BranchAnswer = {
  isOpen: boolean
  isHeadMerged: boolean
  ended: { state: "MERGED" | "CLOSED"; head: string } | null
}

// GitHub's answer about commit `head`; null where it can't be read.
export function readBranchPulls(json: string, head: string): BranchAnswer | null {
  type Node = {
    number?: unknown
    state?: unknown
    headRefOid?: unknown
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
  const merged = new Set(own.filter((node) => node?.state === "MERGED").map((node) => node?.number))
  const associated = raw.data?.repository?.object?.associatedPullRequests?.nodes
  // Another branch's merged pull request may hold it too, as the base's commit a branch started from; and the commit a
  // merge made on the base is no commit of the branch's, though a branch name used again may be reset to it.
  const isHeadMerged =
    Array.isArray(associated) &&
    (associated as Node[]).some((node) => merged.has(node?.number) && node?.mergeCommit?.oid !== head)

  return {
    isOpen: own.some((node) => node?.state === "OPEN"),
    isHeadMerged,
    ended:
      ended && typeof ended.headRefOid === "string"
        ? { state: ended.state as "MERGED" | "CLOSED", head: ended.headRefOid }
        : null
  }
}

const UNREAD_BRANCH = "GitHub's answer about the branch's pull requests could not be read."

// One open from the branch, or one that ended at commit `head` or after it, so the branch holds nothing new: a merged
// one with the commit among its own, as GitHub says (`readBranchPulls`), or the latest that ended. Rejects where
// GitHub, or git, could not be asked.
export async function isBranchTaken(host: Host, repo: RepoRef, branch: string, head: string): Promise<boolean> {
  const asked = await ghRun(host, graphqlArgv(repo, BRANCH_PULLS_QUERY, { branch, head }), 30_000)
  const found = asked.ran?.exitCode === 0 ? readBranchPulls(asked.ran.stdout, head) : null
  if (found === null) {
    throw "problem" in asked
      ? new GhFailure(asked.problem, asked.said)
      : new GhFailure({ message: UNREAD_BRANCH, isPermanent: false }, firstLine(asked.ran.stderr))
  }
  if (found.isOpen || found.isHeadMerged) {
    return true
  }
  if (found.ended === null) {
    return false
  }
  const within = await isWithin(host, head, found.ended.head)
  // Where git can't place the two, a merged one doesn't hold `head`, as GitHub didn't list it among its own commits
  // (`isHeadMerged`, above); only a closed one is compared on GitHub.
  if (within !== "unknown" || found.ended.state === "MERGED") {
    return within === "within"
  }

  return isWithinOnGithub(host, repo, head, found.ended.head)
}
