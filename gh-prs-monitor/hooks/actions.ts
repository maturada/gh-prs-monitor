// Author: David Matura

import type { Answer, MergeMethod, PullAction, PullRow, PullStack, Question } from "../types"
import { CANCEL, isDecline, pullSubject } from "./question"
import { ghApiArgv } from "./gh"
import type { RepoRef } from "./gh"

export const ACTION_LABELS: Readonly<Record<PullAction, string>> = {
  resolve: "Resolve Comments",
  rerequest: "Re-Request Review",
  review: "Review",
  fixCi: "Fix CI",
  resolveConflicts: "Resolve Conflicts",
  rerun: "Re-Run CI",
  updateBranch: "Update Branch",
  merge: "Merge",
  autoMerge: "Auto-Merge",
  ready: "Ready For Review"
}

// A question asked before writing to GitHub, as `Question` words it: each choice's label and what it stands for,
// Cancel last.
export type Confirm<T> = {
  header: string
  subject: string
  text: string
  detail: string | null
  choices: { label: string; value: T }[]
}

// The dialog's question for a confirmation: its first answer, what the button pressed does (merge, update, mark ready,
// re-run), drawn as the main one; no instructions taken.
export function confirmQuestion<T>(confirm: Confirm<T>): Question {
  const choices = confirmLabels(confirm)

  const { header, subject, text, detail } = confirm

  return { header, subject, text, detail, choices, main: choices[0] ?? null, instructions: null }
}

export function confirmLabels<T>(confirm: Confirm<T>): string[] {
  return [...confirm.choices.map((choice) => choice.label), CANCEL]
}

// Cancel, and anything typed under Other that names no choice, writes nothing.
export function readConfirm<T>(confirm: Confirm<T>, answer: Answer | null): T | null {
  return confirm.choices.find((choice) => choice.label === answer?.choice)?.value ?? null
}

// Text typed in place of a choice that names none, and says no neither: nothing is written, and the person is told,
// as they meant something.
export function isOffTheChoices<T>(confirm: Confirm<T>, answer: Answer | null): boolean {
  return (
    answer !== null &&
    readConfirm(confirm, answer) === null &&
    answer.choice === null &&
    answer.instructions !== "" &&
    !isDecline(answer.instructions)
  )
}

export const OFF_THE_CHOICES_NOTE = "Nothing was sent: pick one of the answers to go ahead."

const METHOD_LABELS: Readonly<Record<MergeMethod, string>> = {
  SQUASH: "Squash and merge",
  MERGE: "Create a merge commit",
  REBASE: "Rebase and merge"
}

const METHOD_FLAGS: Readonly<Record<MergeMethod, string>> = { SQUASH: "--squash", MERGE: "--merge", REBASE: "--rebase" }
const METHOD_NAMES: Readonly<Record<MergeMethod, string>> = { SQUASH: "squash", MERGE: "merge", REBASE: "rebase" }

// The methods the repository allows, its usual one first; with auto-merge, GitHub merges once nothing holds it back
// (checks running, a required review), which may be more than the checks. A pull request in a stack merges into the
// stack's base, and takes the open ones below it along (`Stack`).
export function mergeConfirm(
  row: PullRow,
  methods: readonly MergeMethod[],
  isAutoMerge: boolean,
  stack: Stack | null = null,
  placed: PullStack | null = null
): Confirm<MergeMethod> {
  const when = isAutoMerge ? " once nothing holds it back (checks, required reviews)" : ""
  const base = stack?.base ?? row.baseRefName
  // Its place as GitHub has it at the press (`placed`); the stack lookup says what merges along, and with nothing
  // open below a pull request past the bottom, those below are done.
  const below = stack?.below ?? []
  const place = placed
    ? `It is ${placed.position} of ${placed.size} in stack #${placed.number}`
    : below.length > 0
      ? "It is in a stack"
      : null
  const merging =
    below.length > 0 ? `, so ${pullList(below)} below it ${below.length === 1 ? "merges" : "merge"} along` : ""
  const done =
    stack && below.length === 0 && placed && placed.position > 1 ? "; those below it are merged or closed" : ""
  const along = place ? `${place}${merging}${done}.` : null

  return {
    header: "Merge PR",
    subject: pullSubject(row),
    text: `Merge into ${base}${when}?`,
    detail: along,
    choices: methods.map((method) => ({ label: METHOD_LABELS[method], value: method }))
  }
}

// A pull request's stack, as GitHub's REST API has it: the branch the stack merges into, and the open pull requests
// below this one, bottom first. GitHub merges a stacked pull request only together with those, and only through its
// asynchronous merge.
export type StackMember = { number: number; title: string }
export type Stack = { number: number; base: string; below: StackMember[] }

// The pull request as GitHub has it at a press, from `GET repos/<repo>/pulls/<number>`: open, merged or closed, a
// draft or not, its head commit, the stack it is in, and who is asked to review it. It carries no reviews, so one
// given since the list was read isn't seen here.
export type CurrentPull = {
  state: "open" | "merged" | "closed"
  isDraft: boolean
  headOid: string | null
  stack: PullStack | null
  // The people asked to review it now.
  requested: readonly string[]
  // The branch it goes into now.
  base: string | null
  // The repository its branch lives in (`owner/name`), a fork's for a fork's, null once that is deleted; and whether
  // the fork lets the base repository's maintainers push to it.
  headRepo: string | null
  maintainerCanModify: boolean
  // Whether auto-merge is on, and whether GitHub found it conflicting with its base, or merging cleanly: GitHub works
  // it out lazily, so it may know neither yet.
  isAutoMerge: boolean
  isConflicting: boolean
  isConflictFree: boolean
  // How many commits its base has that its head lacks, where asked for (`currentPull`) and GitHub could say.
  behindBase: number | null
}

export function readCurrentPull(json: string): CurrentPull | null {
  let raw: {
    state?: unknown
    merged?: unknown
    draft?: unknown
    head?: { sha?: unknown; repo?: { full_name?: unknown } | null }
    base?: { ref?: unknown }
    stack?: { number?: unknown; position?: unknown; size?: unknown }
    requested_reviewers?: unknown
    maintainer_can_modify?: unknown
    auto_merge?: unknown
    mergeable?: unknown
  }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null || (raw.state !== "open" && raw.state !== "closed")) {
    return null
  }

  return {
    state: raw.state === "open" ? "open" : raw.merged === true ? "merged" : "closed",
    isDraft: raw.draft === true,
    headOid: typeof raw.head?.sha === "string" ? raw.head.sha : null,
    stack:
      typeof raw.stack?.number === "number" &&
      typeof raw.stack.position === "number" &&
      typeof raw.stack.size === "number"
        ? { number: raw.stack.number, position: raw.stack.position, size: raw.stack.size }
        : null,
    requested: Array.isArray(raw.requested_reviewers)
      ? raw.requested_reviewers.flatMap((reviewer: { login?: unknown } | null) =>
          typeof reviewer?.login === "string" ? [reviewer.login] : []
        )
      : [],
    base: typeof raw.base?.ref === "string" ? raw.base.ref : null,
    headRepo: typeof raw.head?.repo?.full_name === "string" ? raw.head.repo.full_name : null,
    maintainerCanModify: raw.maintainer_can_modify === true,
    isAutoMerge: typeof raw.auto_merge === "object" && raw.auto_merge !== null,
    isConflicting: raw.mergeable === false,
    isConflictFree: raw.mergeable === true,
    behindBase: null
  }
}

// What changed since the list was read that a press doesn't go on past: merged or closed, new commits under a merge,
// which would pin it to a commit the pull request no longer ends at, a draft marked ready already, auto-merge on
// already, a branch with nothing of its base to bring in now or conflicting with it, conflicts resolved already, and
// for Re-Request Review a review asked again already of someone it would ask, who would be notified twice, or a pull
// request turned back into a draft, which isn't up for review. Null for none.
export type Stale =
  | "merged"
  | "closed"
  | "moved"
  | "retargeted"
  | "ready"
  | "autoMerged"
  | "updated"
  | "conflicting"
  | "conflictFree"
  | "asked"
  | "draft"

export function staleFor(action: PullAction, row: PullRow, current: CurrentPull): Stale | null {
  if (current.state !== "open") {
    return current.state
  }
  const isMerge = action === "merge" || action === "autoMerge"
  if (action === "autoMerge" && current.isAutoMerge) {
    return "autoMerged"
  }
  if (isMerge && current.headOid !== null && row.headOid && current.headOid !== row.headOid) {
    return "moved"
  }
  // A merge and a branch update name the base, which GitHub moves on when the one below in a stack merges, or when the
  // base branch is renamed or deleted.
  if ((isMerge || action === "updateBranch") && current.base !== null && current.base !== row.baseRefName) {
    return "retargeted"
  }
  if (action === "updateBranch" && current.isConflicting) {
    return "conflicting"
  }
  if (action === "updateBranch" && current.behindBase === 0) {
    return "updated"
  }
  // Where GitHub hasn't worked it out yet, the skill looks for itself.
  if (action === "resolveConflicts" && current.isConflictFree) {
    return "conflictFree"
  }
  if (action === "ready" && !current.isDraft) {
    return "ready"
  }
  if (action === "rerequest" && row.rerequestFrom.some((login) => current.requested.includes(login))) {
    return "asked"
  }
  if (action === "rerequest" && current.isDraft) {
    return "draft"
  }

  return null
}

// Said when a press stops; a merged pull request shown as merged where it was needs no refresh.
export function staleNote(row: PullRow, stale: Stale, isShownMerged = false): string {
  const notes: Readonly<Record<Stale, string>> = {
    merged: isShownMerged ? "was merged meanwhile" : "was merged meanwhile; refreshing the list",
    closed: "was closed meanwhile; refreshing the list",
    moved: "new commits arrived since the list was refreshed; refreshing it",
    retargeted: "goes into another branch now; refreshing the list",
    ready: "is ready for review already; refreshing the list",
    autoMerged: "has auto-merge on already; refreshing the list",
    updated: `is up to date with ${row.baseRefName} already; refreshing the list`,
    conflicting: `conflicts with ${row.baseRefName} now; refreshing the list`,
    conflictFree: `has no conflicts with ${row.baseRefName} now; refreshing the list`,
    asked: "had its review re-requested meanwhile; refreshing the list",
    draft: "is a draft now; refreshing the list"
  }

  return `#${row.number}${stale === "moved" ? ":" : ""} ${notes[stale]}`
}

// The stack `GET repos/<repo>/stacks/<number>` lists, as it bears on merging `pullNumber`; null when it can't be read
// or doesn't hold that pull request.
export function readStack(json: string, pullNumber: number): Stack | null {
  type Listed = { number?: unknown; title?: unknown; state?: unknown }
  let raw: { number?: unknown; base?: { ref?: unknown }; pull_requests?: Listed[] }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const pulls = Array.isArray(raw.pull_requests) ? raw.pull_requests : []
  const index = pulls.findIndex((pull) => pull.number === pullNumber)
  if (typeof raw.number !== "number" || typeof raw.base?.ref !== "string" || index < 0) {
    return null
  }
  const below = pulls
    .slice(0, index)
    .filter((pull) => pull.state === "open" && typeof pull.number === "number")
    .map((pull) => ({ number: pull.number as number, title: typeof pull.title === "string" ? pull.title : "" }))

  return { number: raw.number, base: raw.base.ref, below }
}

// The asynchronous merge, pinned like `mergeArgv` to the commit the pane showed; a base with a merge queue takes it
// into the queue.
export function asyncMergeArgv(repo: RepoRef, row: PullRow, method: MergeMethod): string[] {
  return [
    ...ghApiArgv(repo, `pulls/${row.number}/merge-async`, "PUT"),
    ...["-f", `merge_method=${METHOD_NAMES[method]}`],
    ...(row.headOid ? ["-f", `sha=${row.headOid}`] : [])
  ]
}

export function asyncMergeStatusArgv(repo: RepoRef, row: PullRow, uuid: string): string[] {
  return ghApiArgv(repo, `pulls/${row.number}/merge-async/${uuid}`)
}

// Where an asynchronous merge stands: GitHub answers the request, and each later look at it, with its status, the id
// to look it up by while it is pending, and what went wrong when it failed.
export type AsyncMerge = {
  status: "pending" | "merged" | "enqueued" | "failed"
  uuid: string | null
  message: string | null
}

export function readAsyncMerge(json: string): AsyncMerge | null {
  let raw: { status?: unknown; uuid?: unknown; details?: { uuid?: unknown; message?: unknown } | null }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const status = raw.status
  if (status !== "pending" && status !== "merged" && status !== "enqueued" && status !== "failed") {
    return null
  }
  const uuid = typeof raw.details?.uuid === "string" ? raw.details.uuid : typeof raw.uuid === "string" ? raw.uuid : null
  const message = typeof raw.details?.message === "string" ? raw.details.message : null

  return { status, uuid, message }
}

// What an asynchronous merge came to, for the alert; one still pending after the pane stopped looking is GitHub's
// to finish, and the list shows it once done.
export function asyncMergeDone(row: PullRow, stack: Stack, merge: AsyncMerge): string {
  const along = stack.below.length > 0 ? `, with ${pullList(stack.below)} below it` : ""
  const said: Readonly<Record<AsyncMerge["status"], string>> = {
    merged: `merged into ${stack.base}${along}`,
    enqueued: `is in the merge queue for ${stack.base}${along}`,
    pending: `GitHub is merging it into ${stack.base}${along}; the list shows it once done`,
    failed: `GitHub could not merge it${merge.message ? `: ${merge.message}` : ""}`
  }

  const isDone = merge.status === "merged" || merge.status === "enqueued"

  return `#${row.number}${isDone ? "" : ":"} ${said[merge.status]}`
}

function pullList(pulls: readonly StackMember[]): string {
  return andList(pulls.map((pull) => `#${pull.number}`))
}

// "a", "a and b", "a, b and c".
function andList(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "")
}

// Pinned to the commit the pane showed, so a push since then makes GitHub refuse the merge.
export function mergeArgv(repo: RepoRef, row: PullRow, method: MergeMethod, isAutoMerge: boolean): string[] {
  return [
    ...["gh", "pr", "merge", String(row.number), "--repo", repoArg(repo), METHOD_FLAGS[method]],
    ...(row.headOid ? ["--match-head-commit", row.headOid] : []),
    ...(isAutoMerge ? ["--auto"] : [])
  ]
}

// What a merge came to, asked of GitHub after it: gh says nothing when not writing to a terminal, and a base
// branch with a merge queue takes the pull request into the queue instead.
export const MERGE_STATE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state isInMergeQueue autoMergeRequest { enabledAt } }
  }
}`

export type MergeOutcome = "merged" | "queued" | "auto" | "unknown"

export function readMergeOutcome(json: string): MergeOutcome {
  let raw: {
    data?: {
      repository?: {
        pullRequest?: { state?: string; isInMergeQueue?: boolean; autoMergeRequest?: unknown } | null
      } | null
    }
  }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return "unknown"
  }
  const pull = raw.data?.repository?.pullRequest
  if (pull?.state === "MERGED") {
    return "merged"
  }
  if (pull?.isInMergeQueue === true) {
    return "queued"
  }

  return pull?.autoMergeRequest ? "auto" : "unknown"
}

export function mergeDone(row: PullRow, outcome: MergeOutcome): string {
  const base = row.baseRefName
  const said: Readonly<Record<MergeOutcome, string>> = {
    merged: `merged into ${base}`,
    queued: `is in the merge queue for ${base}`,
    auto: `merges into ${base} once nothing holds it back`,
    unknown: "merge sent to GitHub"
  }

  return `#${row.number} ${said[outcome]}`
}

export type UpdateHow = "merge" | "rebase"

export function updateConfirm(row: PullRow): Confirm<UpdateHow> {
  const base = row.baseRefName

  return {
    header: "Update PR",
    subject: pullSubject(row),
    text: `Bring the latest ${base} into it?`,
    detail: "Rebasing rewrites its commits on GitHub, so a copy of the branch here then needs checking out again.",
    choices: [
      { label: `Merge ${base} in`, value: "merge" },
      { label: `Rebase onto ${base}`, value: "rebase" }
    ]
  }
}

export function updateArgv(repo: RepoRef, row: PullRow, how: UpdateHow): string[] {
  return [
    ...["gh", "pr", "update-branch", String(row.number), "--repo", repoArg(repo)],
    ...(how === "rebase" ? ["--rebase"] : [])
  ]
}

export function readyConfirm(row: PullRow): Confirm<true> {
  return {
    header: "Ready PR",
    subject: pullSubject(row),
    text: "Mark it ready for review?",
    detail: null,
    choices: [{ label: "Mark ready for review", value: true }]
  }
}

export function readyArgv(repo: RepoRef, row: PullRow): string[] {
  return ["gh", "pr", "ready", String(row.number), "--repo", repoArg(repo)]
}

export function readyDone(row: PullRow): string {
  return `#${row.number} is ready for review`
}

// GitHub's re-request: a review asked of someone who reviewed before is asked again.
export function rerequestConfirm(row: PullRow): Confirm<true> {
  const people = andList(row.rerequestFrom)

  return {
    header: "Re-Request",
    subject: pullSubject(row),
    text: `Ask ${people} to review it again?`,
    detail: `${people} requested changes before the latest commits.`,
    choices: [{ label: "Re-request review", value: true }]
  }
}

export function rerequestArgv(repo: RepoRef, row: PullRow): string[] {
  return [
    ...ghApiArgv(repo, `pulls/${row.number}/requested_reviewers`, "POST"),
    ...row.rerequestFrom.flatMap((login) => ["-f", `reviewers[]=${login}`])
  ]
}

export function rerequestDone(row: PullRow): string {
  return `#${row.number}: review re-requested from ${andList(row.rerequestFrom)}`
}

// gh says so, and succeeds, when there was nothing to bring in.
export function updateDone(row: PullRow, output: string): string {
  const isCurrent = /already up.to.date/i.test(output)

  return `#${row.number} ${isCurrent ? "was already up to date with" : "updated with the latest"} ${row.baseRefName}`
}

// The check suites of the pull request's latest commit, with the GitHub Actions run behind each; checks from
// another service have no run here, and cannot be re-run from here.
export const FAILED_RUNS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit {
        oid
        checkSuites(first: 100) { nodes { conclusion workflowRun { databaseId createdAt workflow { id name } } } }
      } } }
    }
  }
}`

export type FailedRun = { id: number; name: string }

// The failed runs of the pull request's latest commit, and that commit, to tell whether it is the one the pane
// showed; and whether the commit has GitHub Actions runs at all, failing or not.
export type FailedRuns = { headOid: string | null; runs: FailedRun[]; hasActionsRuns: boolean }

const FAILED_CONCLUSIONS: readonly string[] = ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "CANCELLED"]

type RawSuite = {
  conclusion?: string | null
  workflowRun?: { databaseId?: number; createdAt?: string; workflow?: { id?: string; name?: string } | null } | null
} | null

export function readFailedRuns(json: string): FailedRuns {
  let raw: {
    data?: {
      repository?: {
        pullRequest?: {
          commits?: { nodes?: ({ commit?: { oid?: string; checkSuites?: { nodes?: RawSuite[] } } } | null)[] }
        }
      }
    }
  }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return { headOid: null, runs: [], hasActionsRuns: false }
  }
  const commit = raw.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit
  const suites = commit?.checkSuites?.nodes ?? []
  // One workflow can run more than once on a commit (on the push and on the pull request, or cancelled by a newer
  // run in its concurrency group); only its latest run says whether it is failing now.
  // Keyed by the workflow itself: two workflow files may share a name.
  const latest = new Map<string, { id: number; name: string; at: string; isFailed: boolean }>()
  for (const suite of suites) {
    const run = suite?.workflowRun
    if (typeof run?.databaseId !== "number") {
      continue
    }
    const name = run.workflow?.name ?? `run ${run.databaseId}`
    const workflow = run.workflow?.id ?? name
    const at = run.createdAt ?? ""
    const seen = latest.get(workflow)
    if (!seen || at > seen.at) {
      const isFailed = FAILED_CONCLUSIONS.includes(suite?.conclusion ?? "")
      latest.set(workflow, { id: run.databaseId, name, at, isFailed })
    }
  }
  const runs = [...latest.values()].flatMap((run) => (run.isFailed ? [{ id: run.id, name: run.name }] : []))

  return {
    headOid: commit?.oid ?? null,
    runs,
    hasActionsRuns: latest.size > 0
  }
}

export function rerunConfirm(row: PullRow, runs: readonly FailedRun[]): Confirm<true> {
  return {
    header: "Re-Run CI",
    subject: pullSubject(row),
    text: `Re-run the failed jobs of ${names(runs)}?`,
    detail: null,
    choices: [{ label: "Re-run failed jobs", value: true }]
  }
}

export function rerunDone(row: PullRow, runCount: number, refusals: readonly string[]): string {
  if (refusals.length === 0) {
    return `#${row.number}: re-running the failed jobs`
  }
  const started = runCount - refusals.length

  return `#${row.number}: re-ran ${started} of ${runCount} run${runCount === 1 ? "" : "s"}; ${refusals[0]}`
}

export function rerunArgv(repo: RepoRef, run: FailedRun): string[] {
  return ["gh", "run", "rerun", String(run.id), "--failed", "--repo", repoArg(repo)]
}

function names(runs: readonly FailedRun[]): string {
  return andList(runs.map((run) => `"${run.name}"`))
}

// gh takes the host in the repository's name, so GitHub Enterprise works the same as github.com.
function repoArg(repo: RepoRef): string {
  return `${repo.host}/${repo.name}`
}
