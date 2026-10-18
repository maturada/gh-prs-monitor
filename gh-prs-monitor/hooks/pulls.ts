// Author: David Matura

import type {
  Badge,
  CiMark,
  CiState,
  MergedPull,
  MergeMethod,
  MineStage,
  PullAction,
  PullRow,
  PullStack,
  PullSignals,
  PullsSnapshot,
  ReviewMark,
  Tone
} from "../types"
import { isCiFailing, isCiRunning, MINE_NEXT_STEPS, mineStatus, reviewStatus, STATUS_PAGES } from "./pull-status"
import { ago } from "./when"
import { prBranch } from "./worktrees"

// One request for every group: five searches cost 5 rate-limit points, where adding per-thread comment authors pushes
// it past 100, so a poll every few minutes stays far under the hourly 5000. GitHub counts each list asked for inside
// every pull request found, so the review lists ask for the fewest: the viewer's own latest review stands alone there.
// They leave out what only the viewer's own rows read (others' reviews, the review decision, the merge state, what the
// viewer may do), which GitHub works out for each pull request: for someone in many reviews they doubled the time the
// query took, up to GitHub's limit of ten seconds. GitHub Enterprise Server has no stacked pull requests, and refuses
// a query that asks for them (`isStackless`).
export function pullsQuery(withStacks: boolean): string {
  const stacks = withStacks ? "  stackEntry { position stack { number size } }\n" : ""
  const shared = `  number title url isDraft headRefName headRefOid baseRefName isCrossRepository
${stacks}  author { login }
  mergeable autoMergeRequest { enabledAt } statusCheckRollup { state }
  reviewThreads(last: 100) { nodes { isResolved isOutdated } }
  writerVerdicts: latestOpinionatedReviews(first: 20, writersOnly: true) {
    nodes { author { __typename login } state submittedAt }
  }
  reviewRequests(first: 100) { nodes { requestedReviewer { __typename ... on Actor { login } ... on Team { slug } } } }
  comments(last: 5) { totalCount nodes { author { __typename login } } }
`

  return `query(
  $owner: String!, $name: String!, $mine: String!, $requested: String!, $commented: String!, $reviewed: String!,
  $mentioned: String!
) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner url viewerPermission
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed autoMergeAllowed viewerDefaultMergeMethod
    allowUpdateBranch defaultBranchRef { name }
  }
  mine: search(type: ISSUE, query: $mine, first: 30) { issueCount nodes { ...pull } }
  requested: search(type: ISSUE, query: $requested, first: 30) { issueCount nodes { ...reviewPull } }
  commented: search(type: ISSUE, query: $commented, first: 30) { issueCount nodes { ...reviewPull } }
  reviewed: search(type: ISSUE, query: $reviewed, first: 30) { issueCount nodes { ...reviewPull } }
  mentioned: search(type: ISSUE, query: $mentioned, first: 30) {
    issueCount nodes { ... on PullRequest { number title author { login } } }
  }
}
fragment pull on PullRequest {
${shared}  latestReviews(first: 20) { nodes { author { __typename login } state submittedAt commit { oid } } }
  reviewDecision mergeStateStatus isInMergeQueue viewerCanEnableAutoMerge viewerCanUpdateBranch
}
fragment reviewPull on PullRequest {
${shared}  additions deletions changedFiles viewerLatestReview { state submittedAt commit { oid } }
}`
}

// GitHub's answer to a query naming a field it doesn't have: the stack fields, on a server without stacked pull
// requests.
export function isStackless(stdout: string): boolean {
  let raw: { data?: unknown; errors?: { extensions?: { code?: unknown; fieldName?: unknown } }[] }
  try {
    raw = JSON.parse(stdout) as typeof raw
  } catch {
    return false
  }

  return (
    !raw?.data &&
    (raw?.errors ?? []).some(
      (error) => error?.extensions?.code === "undefinedField" && error.extensions.fieldName === "stackEntry"
    )
  )
}

// Raised whenever the snapshot's shape or its statuses' wording changes, so an update never compares against the
// old one.
export const SNAPSHOT_SCHEMA = 19

// A snapshot read back from the store, or from the session's state after an update: one from another version of
// the plugin is none.
export function storedSnapshot(value: unknown): PullsSnapshot | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const stored = value as Partial<PullsSnapshot>

  return stored.schema === SNAPSHOT_SCHEMA &&
    typeof stored.repo === "string" &&
    typeof stored.viewer === "string" &&
    typeof stored.fetchedAt === "number" &&
    typeof stored.merging === "object" &&
    stored.merging !== null &&
    typeof stored.hiddenDrafts === "number" &&
    Array.isArray(stored.mine) &&
    Array.isArray(stored.review) &&
    (typeof stored.defaultBranch === "string" || stored.defaultBranch === null) &&
    Array.isArray(stored.ownHeads) &&
    Array.isArray(stored.endedHeads)
    ? (stored as PullsSnapshot)
    : null
}

export type PullSearches = { mine: string; requested: string; commented: string; reviewed: string; mentioned: string }

// `commenter:` matches conversation comments only and `reviewed-by:` matches reviews, so together they cover
// every pull request the viewer has taken part in.
export function pullSearches(repo: string): PullSearches {
  const scope = `repo:${repo} is:pr is:open sort:updated-desc`

  return {
    mine: `${scope} author:@me`,
    requested: `${scope} review-requested:@me`,
    commented: `${scope} commenter:@me -author:@me`,
    reviewed: `${scope} reviewed-by:@me -author:@me`,
    mentioned: `${scope} mentions:@me -author:@me`
  }
}

type RawReview = {
  author?: { __typename?: string; login?: string } | null
  state?: string
  submittedAt?: string | null
  commit?: { oid?: string } | null
} | null

type RawPull = {
  number?: number
  title?: string
  url?: string
  isDraft?: boolean
  headRefName?: string
  headRefOid?: string
  baseRefName?: string
  isCrossRepository?: boolean
  additions?: number
  deletions?: number
  changedFiles?: number
  author?: { login?: string } | null
  reviewDecision?: string | null
  mergeable?: string
  mergeStateStatus?: string
  isInMergeQueue?: boolean
  autoMergeRequest?: { enabledAt?: string } | null
  viewerCanEnableAutoMerge?: boolean
  viewerCanUpdateBranch?: boolean
  statusCheckRollup?: { state?: string } | null
  reviewThreads?: { nodes?: ({ isResolved?: boolean; isOutdated?: boolean } | null)[] }
  latestReviews?: { nodes?: RawReview[] }
  writerVerdicts?: { nodes?: RawReview[] }
  viewerLatestReview?: Omit<NonNullable<RawReview>, "author"> | null
  reviewRequests?: {
    nodes?: ({ requestedReviewer?: { __typename?: string; login?: string; slug?: string } | null } | null)[]
  }
  comments?: { totalCount?: number; nodes?: ({ author?: { __typename?: string; login?: string } | null } | null)[] }
  stackEntry?: { position?: number; stack?: { number?: number; size?: number } | null } | null
}

type RawGroup = { issueCount?: number; nodes?: (RawPull | null)[] } | null

type RawRepository = {
  nameWithOwner?: string
  url?: string
  viewerPermission?: string | null
  squashMergeAllowed?: boolean
  mergeCommitAllowed?: boolean
  rebaseMergeAllowed?: boolean
  autoMergeAllowed?: boolean
  viewerDefaultMergeMethod?: string
  allowUpdateBranch?: boolean
  defaultBranchRef?: { name?: string } | null
}

type RawResponse = {
  data?: {
    viewer?: { login?: string }
    repository?: RawRepository | null
    mine?: RawGroup
    requested?: RawGroup
    commented?: RawGroup
    reviewed?: RawGroup
    mentioned?: RawGroup
  } | null
  errors?: RawError[]
}

// GitHub's errors beside its data: `type` names the kind, `path` the field of the query it is about.
type RawError = { message?: string; type?: string; path?: unknown[] }

type Pull = RawPull & { number: number }

type Review = { login: string; state: string; at: string; commit: string | null; isBot: boolean }

// A repository renamed or moved on GitHub is answered under its new name (`movedTo`), as the searches find nothing
// under the old one.
export type PullsResult = { snapshot: PullsSnapshot } | { problem: string } | { movedTo: string }

export function noAccessProblem(repo: string): string {
  return `No access to ${repo} with your GitHub account, or it does not exist on GitHub.`
}

const PARTIAL_PROBLEM = "GitHub left part of the answer out."

// The kinds of error GitHub gives for a field the token may not read, which it leaves empty in an answer that stands.
const UNREADABLE: readonly string[] = ["FORBIDDEN", "INSUFFICIENT_SCOPES", "NOT_FOUND"]

// A path into the repository or one of the groups, whose fields the list is made of.
function isAnsweredPath(path: unknown[] | undefined): boolean {
  return ["repository", "mine", "requested", "commented", "reviewed", "mentioned"].includes(String(path?.[0]))
}

// Outdated review comments counted or not, and the viewer's own drafts shown or left out.
export type ReadOptions = { includeOutdated: boolean; isHidingDrafts?: boolean }

export function readPulls(json: string, repo: string, fetchedAt: number, options: ReadOptions): PullsResult {
  let raw: RawResponse
  try {
    raw = JSON.parse(json) as RawResponse
  } catch {
    return { problem: "GitHub sent a response that could not be read." }
  }

  const data = raw.data
  if (!data) {
    return { problem: raw.errors?.[0]?.message ?? "GitHub sent no data." }
  }
  if (!data.repository) {
    // An organization's single sign-on or IP allow list hides its repositories, and GitHub's message says what to do.
    const forbidden = raw.errors?.find((error) => error.type === "FORBIDDEN" && error.path?.[0] === "repository")

    return { problem: forbidden?.message ?? noAccessProblem(repo) }
  }
  const name = data.repository.nameWithOwner
  if (name && name.toLowerCase() !== repo.toLowerCase()) {
    return { movedTo: name }
  }
  // A group GitHub left out would read as empty, and the next full answer would announce all of it again.
  const { mine, requested, commented, reviewed, mentioned } = data
  if (!mine || !requested || !commented || !reviewed || !mentioned) {
    return { problem: raw.errors?.[0]?.message ?? PARTIAL_PROBLEM }
  }
  // So would a field GitHub failed to work out, as "no CI" or "no threads"; one the token may not read stays empty.
  const failed = raw.errors?.find((error) => isAnsweredPath(error.path) && !UNREADABLE.includes(error.type ?? ""))
  if (failed) {
    return { problem: failed.message ?? PARTIAL_PROBLEM }
  }

  const viewer = data.viewer?.login ?? ""
  const requestedPulls = pullsOf(requested)
  const requestedNumbers = new Set(requestedPulls.map((pull) => pull.number))
  const participated = uniqueByNumber([...requestedPulls, ...pullsOf(commented), ...pullsOf(reviewed)])
  const merging = mergingOf(data.repository)
  const isCut = (group: RawGroup): boolean => (group?.issueCount ?? 0) > (group?.nodes?.length ?? 0)
  const ownPulls = pullsOf(mine)
  const shownMine = options.isHidingDrafts ? ownPulls.filter((pull) => pull.isDraft !== true) : ownPulls

  return {
    snapshot: {
      schema: SNAPSHOT_SCHEMA,
      repo,
      url: data.repository.url ?? "",
      viewer,
      fetchedAt,
      merging,
      isCut: {
        mine: isCut(mine),
        review: isCut(requested) || isCut(commented) || isCut(reviewed),
        requested: isCut(requested)
      },
      // Someone else's pull requests that mention the viewer, kept to tell a new mention; one cut short at 30
      // cannot tell, and says so.
      mentioned: {
        pulls: pullsOf(mentioned).map((pull) => ({
          number: pull.number,
          title: pull.title ?? "",
          author: authorOf(pull)
        })),
        isCut: isCut(mentioned)
      },
      mine: byUrgency(shownMine.map((pull) => mineRow(pull, merging, fetchedAt, options))),
      review: byUrgency(
        participated
          .map((pull) => reviewRow(pull, viewer, requestedNumbers.has(pull.number), fetchedAt, options))
          .filter((row): row is PullRow => row !== null)
      ),
      hiddenDrafts: ownPulls.length - shownMine.length,
      hiddenDraftNumbers: ownPulls.filter((pull) => !shownMine.includes(pull)).map((pull) => pull.number),
      defaultBranch: data.repository.defaultBranchRef?.name ?? null,
      ownHeads: ownPulls.flatMap((pull) =>
        pull.isCrossRepository || !pull.headRefName
          ? []
          : [{ branch: pull.headRefName, oid: pull.headRefOid ?? "", number: pull.number }]
      ),
      endedHeads: []
    }
  }
}

const MERGE_METHODS: readonly MergeMethod[] = ["SQUASH", "MERGE", "REBASE"]

function mergingOf(repository: RawRepository): PullsSnapshot["merging"] {
  const allowed = MERGE_METHODS.filter(
    (method) =>
      (method === "SQUASH" && repository.squashMergeAllowed === true) ||
      (method === "MERGE" && repository.mergeCommitAllowed === true) ||
      (method === "REBASE" && repository.rebaseMergeAllowed === true)
  )
  const usual = allowed.find((method) => method === repository.viewerDefaultMergeMethod)

  return {
    methods: usual ? [usual, ...allowed.filter((method) => method !== usual)] : allowed,
    isAutoMergeAllowed: repository.autoMergeAllowed === true,
    // Merging and re-running checks need push access; a contributor's pull request offers neither.
    canWrite: ["WRITE", "MAINTAIN", "ADMIN"].includes(repository.viewerPermission ?? ""),
    // Asking for a review takes triage access; a contributor gets no Re-Request Review either.
    canRequestReviews: ["TRIAGE", "WRITE", "MAINTAIN", "ADMIN"].includes(repository.viewerPermission ?? ""),
    // "Always suggest updating pull request branches", beside a base that must be up to date to merge.
    isUpdateSuggested: repository.allowUpdateBranch === true
  }
}

const TONE_URGENCY: Readonly<Record<Tone, number>> = { error: 0, warning: 1, success: 2, neutral: 3 }

// What needs the viewer first: failing, then waiting on them, then ready, then waiting on others, drafts last.
// Within each, the order they came in: latest update first, the review list's requests before the pull requests the
// viewer commented on, then those they reviewed.
function byUrgency(rows: PullRow[]): PullRow[] {
  const urgency = (row: PullRow): number => (row.isDraft ? 4 : TONE_URGENCY[row.status.tone])

  return rows
    .map((row, index) => ({ row, index }))
    .sort((one, other) => urgency(one.row) - urgency(other.row) || one.index - other.index)
    .map(({ row }) => row)
}

function pullsOf(group: RawGroup): Pull[] {
  return (group?.nodes ?? []).filter((pull): pull is Pull => typeof pull?.number === "number")
}

function uniqueByNumber(pulls: Pull[]): Pull[] {
  const seen = new Set<number>()

  return pulls.filter((pull) => !seen.has(pull.number) && seen.add(pull.number))
}

// What the viewer's own pull request says of its reviews, CI and conflicts, read once for its status, its details and
// its buttons.
type OwnPull = {
  reviews: Review[]
  approvals: Review[]
  changes: Review[]
  isChangesRequested: boolean
  isApproved: boolean
  ci: CiState
  isConflicting: boolean | null
  unresolvedThreads: number
  // People whose latest review only commented.
  commentedBy: string[]
  isAskedAgain: boolean
  rerequestFrom: string[]
}

function ownPullOf(pull: Pull, options: ReadOptions): OwnPull {
  const author = authorOf(pull)
  const reviews = reviewsOf(pull.latestReviews).filter((review) => review.login !== author)
  // A comment after an approval is still the reviewer's latest review; their verdict is their latest approval or
  // change request. Only those of people who can push count, as on GitHub: anyone's may be left on a public
  // repository.
  const verdicts = reviewsOf(pull.writerVerdicts).filter((review) => review.login !== author)
  const approvals = reviewsIn(verdicts, "APPROVED")
  const changes = reviewsIn(verdicts, "CHANGES_REQUESTED")
  const changesBy = changes.map((review) => review.login)
  const isChangesRequested = pull.reviewDecision === "CHANGES_REQUESTED" || changesBy.length > 0
  // GitHub drops a reviewer's request once they review, so a request standing again is the author asking them
  // to look at the answer; a change request stays among the verdicts meanwhile.
  const requestedUsers = requestedUsersOf(pull)
  // Whom to ask again: a change request whose reviewer's latest review was of an earlier commit. One whose latest
  // review is not among those read is left out, as nothing says commits came after it.
  const reviewedCommits = new Map(reviews.map((review) => [review.login, review.commit]))

  return {
    reviews,
    approvals,
    changes,
    isChangesRequested,
    isApproved: !isChangesRequested && (pull.reviewDecision === "APPROVED" || approvals.length > 0),
    ci: ciOf(pull),
    isConflicting: conflictOf(pull),
    unresolvedThreads: unresolvedThreadsOf(pull, options),
    // GitHub leaves one asked to review again out of the latest reviews until they do, so their comments wait on the
    // reviewer then. Threads carry no author here (fetching one per thread would triple the query's cost), so a bot's
    // threads alone, as an automated reviewer's, leave the status be.
    commentedBy: loginsIn(reviews, "COMMENTED"),
    isAskedAgain: changesBy.length > 0 && changesBy.every((login) => requestedUsers.includes(login)),
    rerequestFrom: changesBy.filter((login) => {
      const reviewed = reviewedCommits.get(login)

      return (
        reviewed !== undefined && reviewed !== null && reviewed !== pull.headRefOid && !requestedUsers.includes(login)
      )
    })
  }
}

function mineRow(pull: Pull, merging: PullsSnapshot["merging"], now: number, options: ReadOptions): PullRow {
  const own = ownPullOf(pull, options)
  const isQueued = pull.isInMergeQueue === true
  const { stage, status } = mineStatus({
    isDraft: pull.isDraft === true,
    isQueued,
    isConflicting: own.isConflicting === true,
    ci: own.ci,
    isChangesRequested: own.isChangesRequested,
    isApproved: own.isApproved,
    isMoreApprovalNeeded: pull.reviewDecision === "REVIEW_REQUIRED",
    hasCommentsToAddress: own.unresolvedThreads > 0 && own.commentedBy.length > 0,
    isReviewAskedAgain: own.isAskedAgain,
    mergeState: pull.mergeStateStatus ?? null
  })
  const isAutoMergeOn = Boolean(pull.autoMergeRequest)
  // GitHub offers to bring the base in when the base must be up to date to merge, or when the repository always
  // suggests it, at any stage; it says itself whether the branch is behind and the viewer may update it.
  const isUpdateOffered =
    pull.viewerCanUpdateBranch === true &&
    (pull.mergeStateStatus === "BEHIND" || merging.isUpdateSuggested) &&
    stage !== "draft" &&
    stage !== "conflicts" &&
    stage !== "queued"
  const identity = identityOf(pull)
  const actions = mineActions(pull, own, stage, merging, { isUpdateOffered, isAutoMergeOn })
  const url = pull.url ?? ""

  return {
    ...identity,
    stage,
    status:
      stage === "conflicts" || stage === "ciFailing" ? { ...status, ...linked(url, STATUS_PAGES[stage]) } : status,
    details: mineDetails(pull, own, stage, identity, now, { isUpdateOffered, isAutoMergeOn }),
    actions,
    primary: MINE_NEXT_STEPS[stage].find((action) => actions.includes(action)) ?? null,
    rerequestFrom: own.rerequestFrom,
    signals: {
      ci: own.ci,
      isConflicting: own.isConflicting,
      unresolvedThreads: own.unresolvedThreads,
      isAutoMerge: isAutoMergeOn,
      isQueued,
      reviews: marksOf(own.reviews),
      conversation: conversationOf(pull),
      isRequested: false,
      hasCommitsSinceMyReview: false
    }
  }
}

// What GitHub offers on the row beside its status.
type Offers = { isUpdateOffered: boolean; isAutoMergeOn: boolean }

// The details under an own pull request's status, as they apply, parted by dots.
function mineDetails(
  pull: Pull,
  own: OwnPull,
  stage: MineStage,
  identity: ReturnType<typeof identityOf>,
  now: number,
  { isUpdateOffered, isAutoMergeOn }: Offers
): Badge[] {
  const url = pull.url ?? ""
  const details: Badge[] = []
  const ciDetail = ciBadge(own.ci, url)
  // A failing status says so itself.
  if (ciDetail && stage !== "ciFailing") {
    details.push(ciDetail)
  }
  const stackBadge = stackDetail(identity.stack)
  if (stackBadge) {
    details.push(stackBadge)
  }
  if (own.approvals.length > 0) {
    details.push(reviewedBy("approved", own.approvals, now, "success"))
  }
  if (own.changes.length > 0) {
    details.push(reviewedBy("changes requested", own.changes, now, "warning"))
  }
  // Someone who only commented has no verdict to name them, but their review is still news to the author.
  const withVerdicts = new Set([...own.approvals, ...own.changes].map((review) => review.login))
  const commentsOnly = reviewsIn(own.reviews, "COMMENTED").filter((review) => !withVerdicts.has(review.login))
  if (commentsOnly.length > 0) {
    details.push(reviewedBy("reviewed", commentsOnly, now, "neutral"))
  }
  if ((!own.isApproved && !own.isChangesRequested) || stage === "rereview" || stage === "moreApprovals") {
    const reviewers = requestedReviewersOf(pull)
    // GitHub takes a reviewer off the requested ones once they review, so after feedback the one missing is a request
    // to look again.
    const isAfterFeedback = own.changes.length + commentsOnly.length > 0
    details.push(
      reviewers.named.length + reviewers.unnamed > 0
        ? { text: `requested: ${requestedText(reviewers)}`, tone: "neutral" }
        : { text: isAfterFeedback ? "no re-review requested" : "no reviewer requested", tone: "warning" }
    )
  }
  if (own.unresolvedThreads > 0) {
    details.push({
      ...linked(url, "files"),
      text: plural(own.unresolvedThreads, "unresolved comment"),
      tone: "warning"
    })
  }
  if (isUpdateOffered && stage !== "behind") {
    const isBehindRequired = pull.mergeStateStatus === "BEHIND"
    details.push({ text: `behind ${pull.baseRefName ?? "base"}`, tone: isBehindRequired ? "warning" : "neutral" })
  }
  if (isAutoMergeOn) {
    details.push({ text: "auto-merge on", tone: "success" })
  }

  return details
}

// The buttons an own pull request offers, as its state calls for them and the viewer's access allows.
function mineActions(
  pull: Pull,
  own: OwnPull,
  stage: MineStage,
  merging: PullsSnapshot["merging"],
  { isUpdateOffered, isAutoMergeOn }: Offers
): PullAction[] {
  const actions: PullAction[] = []
  // Resolving works on a local copy of the branch too, a draft's included.
  if (own.isConflicting === true) {
    actions.push("resolveConflicts")
  }
  if (own.unresolvedThreads > 0 || own.isChangesRequested) {
    actions.push("resolve")
  }
  // A draft isn't up for review yet.
  if (own.rerequestFrom.length > 0 && stage !== "draft" && merging.canRequestReviews) {
    actions.push("rerequest")
  }
  if (isCiFailing(own.ci) && stage !== "draft" && merging.canWrite) {
    actions.push("rerun")
  }
  // Fixing works on a local copy of the branch, so it asks no access to the repository, and a draft fails CI too.
  if (isCiFailing(own.ci)) {
    actions.push("fixCi")
  }
  if (isUpdateOffered) {
    actions.push("updateBranch")
  }
  // Where the base requires no review, GitHub gives no review decision, and merges one nobody has reviewed once it says
  // it can, its checks green. The status still says it waits for review, as one is still wanted; open comments are the
  // author's to deal with first.
  const isMergeableUnreviewed =
    stage === "waiting" &&
    pull.reviewDecision == null &&
    own.unresolvedThreads === 0 &&
    !isCiFailing(own.ci) &&
    !isCiRunning(own.ci) &&
    (pull.mergeStateStatus === "CLEAN" || pull.mergeStateStatus === "HAS_HOOKS")
  if (
    (stage === "ready" || isMergeableUnreviewed) &&
    merging.methods.length > 0 &&
    merging.canWrite &&
    !isAutoMergeOn
  ) {
    actions.push("merge")
  }
  // GitHub merges once what still holds it back clears: checks still running, or a requirement such as a second
  // approval. It says itself whether the viewer may turn that on; a stacked pull request it never merges so.
  const isWaitingToMerge = stage === "moreApprovals" || stage === "approvedCiRunning" || stage === "blocked"
  const canAutoMerge = pull.viewerCanEnableAutoMerge === true && stackOf(pull) === null
  if (isWaitingToMerge && merging.methods.length > 0 && canAutoMerge && !isAutoMergeOn) {
    actions.push("autoMerge")
  }
  if (stage === "draft") {
    actions.push("ready")
  }

  return actions
}

function linked(url: string, page: string): { href?: string } {
  return url ? { href: `${url}/${page}` } : {}
}

// A pull request stays on the review list until the viewer's own verdict approves it; a new review request
// brings it back.
function reviewRow(
  pull: Pull,
  viewer: string,
  isInRequested: boolean,
  now: number,
  options: ReadOptions
): PullRow | null {
  const author = authorOf(pull)
  if (author === viewer) {
    return null
  }

  // The viewer's latest review stays theirs when they are asked again, where GitHub's latest reviews drop it. Their
  // verdict, their latest approval or change request, is read among those who can push; for a reviewer who can't,
  // their latest review is all GitHub names.
  const myReview = viewerReviewOf(pull, viewer)
  const myVerdict = reviewsOf(pull.writerVerdicts).find((review) => review.login === viewer) ?? null
  const myState = myVerdict?.state ?? myReview?.state ?? null
  // A request to the viewer by name always counts. One to a team of theirs counts until they review: GitHub may
  // keep the team's request after a member's review, which must not read as being asked again.
  const isRequested =
    isInRequested && (requestedUsersOf(pull).includes(viewer) || (myReview === null && myVerdict === null))
  if (myState === "APPROVED" && !isRequested) {
    return null
  }

  // A review names the commit it was given on, so a moved head is new work whenever it was committed.
  const hasCommitsSinceMyReview =
    myReview?.commit !== null && myReview?.commit !== undefined && myReview.commit !== pull.headRefOid
  const approvals = reviewsIn(
    reviewsOf(pull.writerVerdicts).filter((review) => review.login !== viewer && review.login !== author),
    "APPROVED"
  )
  const ci = ciOf(pull)
  const unresolvedThreads = unresolvedThreadsOf(pull, options)

  const url = pull.url ?? ""
  const details: Badge[] = [{ text: `by ${author}`, tone: "neutral" }]
  const size = sizeOf(pull)
  if (size) {
    details.push({ text: size, tone: "neutral" })
  }
  if (pull.isDraft) {
    details.push({ text: "draft", tone: "neutral" })
  }
  const ciDetail = ciBadge(ci, url)
  if (ciDetail) {
    details.push(ciDetail)
  }
  const identity = identityOf(pull)
  const stackBadge = stackDetail(identity.stack)
  if (stackBadge) {
    details.push(stackBadge)
  }
  if (approvals.length > 0) {
    details.push(reviewedBy("approved", approvals, now, "success"))
  }
  if (unresolvedThreads > 0) {
    details.push({ ...linked(url, "files"), text: plural(unresolvedThreads, "unresolved comment"), tone: "neutral" })
  }
  const status = reviewStatus({
    hasReviewed: myReview !== null || myVerdict !== null,
    myState,
    isRequested,
    hasCommitsSinceMyReview
  })

  return {
    ...identity,
    stage: null,
    status,
    details,
    actions: ["review"],
    // A review is the next step only while it waits on the viewer.
    primary: status.tone === "warning" ? "review" : null,
    rerequestFrom: [],
    signals: {
      ci,
      isConflicting: conflictOf(pull),
      unresolvedThreads,
      isAutoMerge: Boolean(pull.autoMergeRequest),
      isQueued: false,
      reviews: {},
      conversation: conversationOf(pull),
      isRequested,
      hasCommitsSinceMyReview
    }
  }
}

function identityOf(
  pull: Pull
): Pick<
  PullRow,
  | "number"
  | "title"
  | "url"
  | "author"
  | "headRefName"
  | "headOid"
  | "baseRefName"
  | "isCrossRepository"
  | "isDraft"
  | "stack"
> {
  return {
    number: pull.number,
    title: pull.title ?? "",
    url: pull.url ?? "",
    author: authorOf(pull),
    headRefName: pull.headRefName ?? "",
    headOid: pull.headRefOid ?? "",
    baseRefName: pull.baseRefName ?? "",
    isCrossRepository: pull.isCrossRepository === true,
    isDraft: pull.isDraft === true,
    stack: stackOf(pull)
  }
}

function stackOf(pull: Pull): PullStack | null {
  const position = pull.stackEntry?.position
  const number = pull.stackEntry?.stack?.number
  const size = pull.stackEntry?.stack?.size

  return typeof position === "number" && typeof number === "number" && typeof size === "number"
    ? { number, position, size }
    : null
}

// The stack it is in, right after CI in its details, as what merges with it depends on it.
function stackDetail(stack: PullStack | null): Badge | null {
  return stack ? { text: stackText(stack), tone: "neutral" } : null
}

// Where a pull request sits in its stack, as its details and a compact row say it: "stack #30 2/4".
export function stackText(stack: PullStack): string {
  return `stack #${stack.number} ${stack.position}/${stack.size}`
}

function reviewsOf(connection: { nodes?: RawReview[] } | undefined): Review[] {
  return (connection?.nodes ?? []).flatMap((node) =>
    node?.author?.login && node.state
      ? [
          {
            login: node.author.login,
            state: node.state,
            at: node.submittedAt ?? "",
            commit: node.commit?.oid ?? null,
            isBot: node.author.__typename === "Bot"
          }
        ]
      : []
  )
}

// One still pending is the viewer's draft, not a review given.
function viewerReviewOf(pull: Pull, viewer: string): Review | null {
  const review = pull.viewerLatestReview

  return review?.state && review.state !== "PENDING"
    ? {
        login: viewer,
        state: review.state,
        at: review.submittedAt ?? "",
        commit: review.commit?.oid ?? null,
        isBot: false
      }
    : null
}

function marksOf(reviews: Review[]): Record<string, ReviewMark> {
  return Object.fromEntries(
    reviews.map((review) => [review.login, { state: review.state, at: review.at, isBot: review.isBot }])
  )
}

// A verdict counts only from a person: a bot's approval is not a review anyone gave.
function reviewsIn(reviews: Review[], state: string): Review[] {
  return reviews.filter((review) => review.state === state && !review.isBot)
}

function loginsIn(reviews: Review[], state: string): string[] {
  return reviewsIn(reviews, state).map((review) => review.login)
}

// Who gave a kind of review, and how long ago the latest of theirs came, labelled like the requested reviewers.
function reviewedBy(label: string, reviews: Review[], now: number, tone: Tone): Badge {
  // A review without a time leaves the others to say when.
  const latest = Math.max(...reviews.map((review) => Date.parse(review.at)).filter(Number.isFinite))
  const age = ago(latest, now)

  return { text: `${label}: ${names(reviews.map((review) => review.login))}${age ? ` ${age}` : ""}`, tone }
}

// How much a pull request changes, to pick what to review first.
function sizeOf(pull: Pull): string | null {
  const { additions, deletions, changedFiles } = pull
  if (typeof additions !== "number" || typeof deletions !== "number" || typeof changedFiles !== "number") {
    return null
  }

  return `+${additions} −${deletions}, ${plural(changedFiles, "file")}`
}

function requestedUsersOf(pull: Pull): string[] {
  return (pull.reviewRequests?.nodes ?? []).flatMap((node) => {
    const reviewer = node?.requestedReviewer

    return reviewer?.__typename === "User" && reviewer.login ? [reviewer.login] : []
  })
}

// A deleted account's pull requests and reviews keep GitHub's stand-in name.
function authorOf(pull: Pull): string {
  return pull.author?.login ?? "ghost"
}

// People, bots and teams by name; one the query cannot name (an enterprise team, or a team the viewer can't see, which
// GitHub answers as none) still counts.
function requestedReviewersOf(pull: Pull): { named: string[]; unnamed: number } {
  const reviewers = (pull.reviewRequests?.nodes ?? []).flatMap((node) => (node ? [node.requestedReviewer] : []))
  const named = reviewers.flatMap((reviewer) => {
    const name = reviewer?.login ?? reviewer?.slug

    return name ? [name] : []
  })

  return { named, unnamed: reviewers.length - named.length }
}

function requestedText({ named, unnamed }: { named: string[]; unnamed: number }): string {
  if (named.length === 0) {
    return plural(unnamed, "reviewer")
  }
  const shown = named.slice(0, 3)
  const more = named.length - shown.length + unnamed

  return more > 0 ? `${shown.join(", ")} +${more}` : shown.join(", ")
}

// Bots (a tracker linking its issue, a dependency updater) write here too, and are never news.
function conversationOf(pull: Pull): PullSignals["conversation"] {
  return {
    count: pull.comments?.totalCount ?? 0,
    authors: (pull.comments?.nodes ?? []).map((node) =>
      node?.author?.login && node.author.__typename !== "Bot" ? node.author.login : null
    )
  }
}

// GitHub answers UNKNOWN while it recomputes mergeability, which it does after every push to the base.
function conflictOf(pull: Pull): boolean | null {
  if (pull.mergeable === "CONFLICTING" || pull.mergeStateStatus === "DIRTY") {
    return true
  }

  return pull.mergeable === "UNKNOWN" ? null : false
}

// An outdated thread sits on code that has since changed; unless the person counts those, the resolve-comments
// skill leaves them out too. Counted among the latest hundred threads, where an unresolved one is.
function unresolvedThreadsOf(pull: Pull, options: ReadOptions): number {
  return (pull.reviewThreads?.nodes ?? []).filter(
    (thread) => thread?.isResolved === false && (options.includeOutdated || !thread.isOutdated)
  ).length
}

const CI_STATES: readonly string[] = ["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]

function ciOf(pull: Pull): CiState {
  const state = pull.statusCheckRollup?.state

  return state && CI_STATES.includes(state) ? (state as CiState) : null
}

// Whether a checkout on `branch` is on the row's branch: the head's name, or the name /prs checks a pull request out
// as apart from it (`prBranch`). A fork's head can share its name with a branch here, so a fork counts only under
// the latter.
export function isOnBranch(
  row: Pick<PullRow, "number" | "headRefName" | "isCrossRepository">,
  branch: string | null
): boolean {
  return branch !== null && (branch === prBranch(row.number) || (!row.isCrossRepository && branch === row.headRefName))
}

function ciBadge(ci: CiState, url: string): Badge | null {
  const mark: CiMark | null = ci === "SUCCESS" ? "✓" : isCiFailing(ci) ? "✗" : isCiRunning(ci) ? "●" : null
  if (mark === null) {
    return null
  }
  const tone = mark === "✓" ? "success" : mark === "✗" ? "error" : "warning"

  return { text: `CI ${mark}`, tone, mark, ...linked(url, "checks") }
}

function names(logins: string[]): string {
  return logins.length > 3 ? `${logins.slice(0, 3).join(", ")} +${logins.length - 3}` : logins.join(", ")
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

// The list without the pull requests merged from the pane a moment ago, which GitHub's search still lists as open.
export function withoutMerged(snapshot: PullsSnapshot, merged: MergedPull[]): PullsSnapshot {
  const numbers = new Set(merged.map((pull) => pull.number))

  return numbers.size === 0 ? snapshot : { ...snapshot, mine: snapshot.mine.filter((row) => !numbers.has(row.number)) }
}

// A pull request as the list holds it now, in either group.
export function rowOf(snapshot: PullsSnapshot | null, pullNumber: number): PullRow | undefined {
  return snapshot ? [...snapshot.mine, ...snapshot.review].find((row) => row.number === pullNumber) : undefined
}

// The pull request whose branch the checkout is on, as a skill run there without one finds it itself.
export function pullOnBranch(snapshot: PullsSnapshot | null, branch: string | null): number | null {
  return [...(snapshot?.mine ?? []), ...(snapshot?.review ?? [])].find((row) => isOnBranch(row, branch))?.number ?? null
}
