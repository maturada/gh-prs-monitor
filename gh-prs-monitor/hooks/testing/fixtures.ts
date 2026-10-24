// Author: David Matura

// Builders for the GraphQL response the pull request query returns, the list read from it, and what sessions share of
// it; imported by the tests only.

import type { PullsSnapshot } from "../../types"
import type { RepoRef } from "../gh"
import { readPulls } from "../pulls"
import type { ReadOptions } from "../pulls"
import { QUERY_VERSION } from "../shared"
import type { FetchClaim, SharedAnswer } from "../shared"

export type PullFixture = {
  number: number
  title?: string
  author?: string
  isDraft?: boolean
  headRefName?: string
  headRefOid?: string
  isCrossRepository?: boolean
  // Lines added and removed, and files touched, which the review lists read; left out unless given.
  size?: { additions: number; deletions: number; files: number }
  reviewDecision?: string | null
  mergeable?: string
  mergeStateStatus?: string
  isInMergeQueue?: boolean
  isAutoMergeOn?: boolean
  // What GitHub says the viewer may do; auto-merge follows the repository's setting unless given.
  canEnableAutoMerge?: boolean
  // True only for a branch behind its base; behind unless given where the base must be up to date.
  canUpdateBranch?: boolean
  // Teams asked to review, beside the people in `requested`.
  requestedTeams?: string[]
  // Other kinds of reviewer asked: a bot or a mannequin by login, or one the query cannot name.
  requestedOthers?: { __typename: string; login?: string }[]
  // Reviewers asked that the viewer can't see, as a secret team, which GitHub answers as none.
  requestedHidden?: number
  ci?: string | null
  threads?: { isResolved: boolean; isOutdated?: boolean }[]
  // Each reviewer's latest review; `commit` defaults to the head, as a review of the current code, and null is none
  // GitHub can name. One whose reviewer is asked again (`requested`) is left out of the latest reviews of an own pull
  // request, as GitHub does; on the review lists only the viewer's own is read.
  reviews?: { login: string; state: string; at: string; commit?: string | null; isBot?: boolean }[]
  // Each reviewer's latest approval or change request; defaults to those among `reviews`. `isWriter: false` for one
  // who cannot push to the repository, left out where GitHub counts only writers; `commit` as a review's.
  verdicts?: {
    login: string
    state: string
    at?: string
    commit?: string | null
    isBot?: boolean
    isWriter?: boolean
  }[]
  requested?: string[]
  // The stack it is in, and where.
  stack?: { number: number; position: number; size: number }
  // The conversation: how many comments, who wrote the latest, and who the ones read before it, oldest first.
  comments?: { count: number; lastAuthor?: string; isBot?: boolean; earlier?: { login: string; isBot?: boolean }[] }
}

function verdictNode(verdict: NonNullable<PullFixture["verdicts"]>[number], head: string): unknown {
  return {
    author: { __typename: verdict.isBot ? "Bot" : "User", login: verdict.login },
    state: verdict.state,
    submittedAt: verdict.at ?? null,
    commit: verdict.commit === null ? null : { oid: verdict.commit ?? head }
  }
}

// The fragment of the query a pull request is read with: the viewer's own (`pull`), or one on the review lists
// (`reviewPull`), which GitHub answers with fewer fields. Each answers exactly what its fragment asks.
export type Fragment = "pull" | "reviewPull"

// The repository the tests' pull requests are in.
export const REPO: RepoRef = { host: "github.com", name: "acme/app" }

export function rawPull(
  pull: PullFixture,
  merging: MergingFixture,
  fragment: Fragment,
  viewer: string,
  repo = "acme/app"
): Record<string, unknown> {
  const head = pull.headRefOid ?? `head-${pull.number}`
  const reviews = pull.reviews ?? []
  const verdicts: NonNullable<PullFixture["verdicts"]> =
    pull.verdicts ?? reviews.filter((review) => review.state === "APPROVED" || review.state === "CHANGES_REQUESTED")
  const commitOf = (review: (typeof reviews)[number]) =>
    review.commit === null ? null : { oid: review.commit ?? head }
  const shared = {
    number: pull.number,
    title: pull.title ?? `Pull request ${pull.number}`,
    url: `https://github.com/${repo}/pull/${pull.number}`,
    isDraft: pull.isDraft ?? false,
    headRefName: pull.headRefName ?? `feature/branch-${pull.number}`,
    headRefOid: head,
    baseRefName: "main",
    isCrossRepository: pull.isCrossRepository ?? false,
    stackEntry: pull.stack
      ? { position: pull.stack.position, stack: { number: pull.stack.number, size: pull.stack.size } }
      : null,
    author: { login: pull.author ?? "me" },
    mergeable: pull.mergeable ?? "MERGEABLE",
    autoMergeRequest: pull.isAutoMergeOn ? { enabledAt: "2026-10-07T09:00:00Z" } : null,
    statusCheckRollup: pull.ci === null ? null : { state: pull.ci ?? "SUCCESS" },
    reviewThreads: { nodes: pull.threads ?? [] },
    writerVerdicts: {
      nodes: verdicts.filter((verdict) => verdict.isWriter !== false).map((verdict) => verdictNode(verdict, head))
    },
    reviewRequests: {
      nodes: [
        ...(pull.requested ?? []).map((login) => ({ requestedReviewer: { __typename: "User", login } })),
        ...(pull.requestedTeams ?? []).map((slug) => ({ requestedReviewer: { __typename: "Team", slug } })),
        ...(pull.requestedOthers ?? []).map((reviewer) => ({ requestedReviewer: reviewer })),
        ...Array.from({ length: pull.requestedHidden ?? 0 }, () => ({ requestedReviewer: null }))
      ]
    },
    comments: {
      totalCount: pull.comments?.count ?? 0,
      nodes: [
        ...(pull.comments?.earlier ?? []),
        ...(pull.comments?.lastAuthor ? [{ login: pull.comments.lastAuthor, isBot: pull.comments.isBot }] : [])
      ].map((comment) => ({ author: { __typename: comment.isBot ? "Bot" : "User", login: comment.login } }))
    }
  }
  if (fragment === "reviewPull") {
    const own = reviews.find((review) => review.login === viewer)

    return {
      ...shared,
      ...(pull.size
        ? { additions: pull.size.additions, deletions: pull.size.deletions, changedFiles: pull.size.files }
        : {}),
      // A review still being written has no time yet.
      viewerLatestReview: own
        ? { state: own.state, submittedAt: own.state === "PENDING" ? null : own.at, commit: commitOf(own) }
        : null
    }
  }
  // GitHub's latest reviews leave out a reviewer asked to review again, until they do.
  const askedAgain = new Set(pull.requested ?? [])

  return {
    ...shared,
    latestReviews: {
      nodes: reviews
        .filter((review) => !askedAgain.has(review.login))
        .map((review) => ({
          author: { __typename: review.isBot ? "Bot" : "User", login: review.login },
          state: review.state,
          submittedAt: review.at,
          commit: commitOf(review)
        }))
    },
    reviewDecision: pull.reviewDecision ?? null,
    mergeStateStatus: pull.mergeStateStatus ?? "CLEAN",
    isInMergeQueue: pull.isInMergeQueue ?? false,
    viewerCanEnableAutoMerge: pull.canEnableAutoMerge ?? merging.autoMerge ?? false,
    viewerCanUpdateBranch: pull.canUpdateBranch ?? pull.mergeStateStatus === "BEHIND"
  }
}

// The repository's merge settings, as its settings page has them.
export type MergingFixture = {
  // The viewer's access: WRITE unless given; READ stands for a contributor from a fork.
  permission?: string
  squash?: boolean
  merge?: boolean
  rebase?: boolean
  usual?: string
  autoMerge?: boolean
  // "Always suggest updating pull request branches".
  suggestUpdate?: boolean
}

export type ResponseFixture = {
  viewer?: string
  hasRepository?: boolean
  // The repository's name as GitHub answers it: acme/app unless given.
  nameWithOwner?: string
  // The repository's default branch: main unless given, null for a repository with no commits yet.
  defaultBranch?: string | null
  merging?: MergingFixture
  // How many each search found in all, when more than it returned.
  totals?: { mine?: number; requested?: number; commented?: number; reviewed?: number; mentioned?: number }
  mine?: PullFixture[]
  requested?: PullFixture[]
  commented?: PullFixture[]
  reviewed?: PullFixture[]
  // Someone else's pull requests that mention the viewer.
  mentioned?: { number: number; title?: string; author?: string }[]
}

export function response(fixture: ResponseFixture): string {
  const viewer = fixture.viewer ?? "me"
  const group = (fragment: Fragment, pulls: PullFixture[] = [], total?: number): unknown => ({
    issueCount: total ?? pulls.length,
    nodes: pulls.map((pull) => rawPull(pull, fixture.merging ?? {}, fragment, viewer, fixture.nameWithOwner))
  })

  return JSON.stringify({
    data: {
      viewer: { login: viewer },
      repository:
        fixture.hasRepository === false
          ? null
          : {
              nameWithOwner: fixture.nameWithOwner ?? "acme/app",
              url: `https://github.com/${fixture.nameWithOwner ?? "acme/app"}`,
              viewerPermission: fixture.merging?.permission ?? "WRITE",
              squashMergeAllowed: fixture.merging?.squash ?? true,
              mergeCommitAllowed: fixture.merging?.merge ?? true,
              rebaseMergeAllowed: fixture.merging?.rebase ?? false,
              autoMergeAllowed: fixture.merging?.autoMerge ?? false,
              viewerDefaultMergeMethod: fixture.merging?.usual ?? "MERGE",
              allowUpdateBranch: fixture.merging?.suggestUpdate ?? false,
              defaultBranchRef: fixture.defaultBranch === null ? null : { name: fixture.defaultBranch ?? "main" }
            },
      mine: group("pull", fixture.mine, fixture.totals?.mine),
      requested: group("reviewPull", fixture.requested, fixture.totals?.requested),
      commented: group("reviewPull", fixture.commented, fixture.totals?.commented),
      reviewed: group("reviewPull", fixture.reviewed, fixture.totals?.reviewed),
      mentioned: {
        issueCount: fixture.totals?.mentioned ?? (fixture.mentioned ?? []).length,
        nodes: (fixture.mentioned ?? []).map((pull) => ({
          number: pull.number,
          title: pull.title ?? `Pull request ${pull.number}`,
          author: { login: pull.author ?? "ann" }
        }))
      }
    }
  })
}

// The options a test reads a list with unless it says otherwise.
export const DEFAULTS = { includeOutdated: false }

export type ListOptions = Partial<ReadOptions> & { at?: number }

// The list read from the answer `fixture` builds, at `at` (the epoch unless given), outdated comments left out unless
// the options count them; a test that gets a problem instead stops there.
export function snapshotOf(fixture: ResponseFixture, { at = 0, ...options }: ListOptions = {}): PullsSnapshot {
  const result = readPulls(response(fixture), "acme/app", at, { ...DEFAULTS, ...options })
  if (!("snapshot" in result)) {
    throw new Error(`expected a snapshot, got: ${JSON.stringify(result)}`)
  }

  return result.snapshot
}

// GitHub's answer to the list query as another session shared it, asked at `requestedAt` and answered 2 seconds later.
export function sharedAnswer(
  by: string,
  requestedAt: number,
  fixture: ResponseFixture = {},
  viewer = "me"
): SharedAnswer {
  return {
    schema: 1,
    query: QUERY_VERSION,
    host: "github.com",
    repo: "acme/app",
    viewer,
    requestedAt,
    fetchedAt: requestedAt + 2_000,
    by,
    answer: JSON.parse(response({ ...fixture, viewer })) as unknown
  }
}

// A session's claim on the request to GitHub it is making, for this person and query; or, where it was asked for
// earlier (`asked`), on the answer that came and is on its way.
export function fetchClaim(by: string, at: number, viewer = "me", asked = at): FetchClaim {
  return { by, at, asked, viewer, query: QUERY_VERSION }
}

// A minute of the clock's.
export const MINUTE = 60_000

// An answer another session shared for this person and query, asked at minute 10 and read 2 seconds later, but
// for what `overrides` says.
export function answer(overrides: Partial<SharedAnswer> = {}): SharedAnswer {
  return {
    schema: 1,
    query: QUERY_VERSION,
    host: "github.com",
    repo: "acme/app",
    viewer: "me",
    requestedAt: 10 * MINUTE,
    fetchedAt: 10 * MINUTE + 2_000,
    by: "other",
    answer: { data: {} },
    ...overrides
  }
}
