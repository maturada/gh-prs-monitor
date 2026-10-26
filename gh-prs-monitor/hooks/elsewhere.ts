// Author: David Matura

// The light check of other repositories: one request on the folder's server for the open pull requests where the
// viewer is the author or asked to review, the folder's repository left out, which the full list tells. What it reads,
// what it keeps of each pull request between checks, what it alerts (through the rules the full list judges a change
// by, so either list words it alike), and what waits for the viewer there.

import type { Timer } from "claude-code"

import type { CiState, ReviewMark } from "../types"
import { ciEvent, isNewRequest, reviewEvents } from "./alerts"
import type { Alert, AlertBatch, AlertKind, Event } from "./alerts"
import { DEFAULT_HOST, pullKey } from "./gh"
import type { RepoRef } from "./gh"
import { authStatus, ghRun, GH_LOOKUP_TIMEOUT_MS, sessionRepo } from "./github"
import type { Host } from "./machine"
import { isCiFailing, isCiRunning } from "./pull-status"
import { isAskedOf, ownFacts } from "./pulls"
import type { RawPull } from "./pulls"
import type { Session } from "./session"

// One search's page: the pull requests updated last, as the full list's searches take them.
const SEARCH_LIMIT = 30

// The kinds of change the light check judges; the others need mergeability, comments, threads or commits since a
// review, which it doesn't ask for.
export const CHECKED_KINDS: readonly AlertKind[] = ["ci", "reviews", "reviewRequests"]

// A day: a pull request not seen again within it is forgotten. At most so many are kept.
const KEPT_MS = 24 * 60 * 60_000
const KEPT_LIMIT = 200

// The viewer, and two searches asking only what the alerts judge: one rate-limit point (checked 23.10.2026). It leaves
// out the verdicts of those who can push, which the full list reads, as they would make it two points; the viewer's
// latest review stands in for theirs.
export function elsewhereQuery(folder: RepoRef | null): string {
  const search = (who: string): string =>
    JSON.stringify(`is:pr is:open archived:false sort:updated-desc ${who}${folder ? ` -repo:${folder.name}` : ""}`)

  return `query {
  viewer { login }
  mine: search(type: ISSUE, query: ${search("author:@me")}, first: ${SEARCH_LIMIT}) { issueCount nodes { ...mine } }
  requested: search(type: ISSUE, query: ${search("review-requested:@me")}, first: ${SEARCH_LIMIT}) {
    issueCount nodes { ...requested }
  }
}
fragment pull on PullRequest {
  number title url isDraft author { login } repository { nameWithOwner } statusCheckRollup { state }
}
fragment mine on PullRequest {
  ...pull
  latestReviews(first: 20) { nodes { author { __typename login } state submittedAt } }
}
fragment requested on PullRequest {
  ...pull
  viewerLatestReview { state submittedAt }
  reviewRequests(first: 100) { nodes { requestedReviewer { __typename ... on Actor { login } ... on Team { slug } } } }
}`
}

// A pull request as the light check knows it: the viewer's own (`isMine`), or one asking their review.
export type ElsewherePull = {
  repo: RepoRef
  number: number
  title: string
  url: string
  author: string
  isMine: boolean
  isRequested: boolean
  ci: CiState
  reviews: Record<string, ReviewMark>
}

// One check's answer: the viewer, the pull requests, and whether a search had more than it gave.
export type ElsewhereRead = { viewer: string; pulls: ElsewherePull[]; isCut: { mine: boolean; requested: boolean } }

type RawNode = (RawPull & { repository?: { nameWithOwner?: string } | null }) | null
type RawSearch = { issueCount?: number; nodes?: RawNode[] } | null

// GitHub's answer on server `host`; null where it gave none to read. A pull request it couldn't read costs no other;
// with drafts hidden, the viewer's own drafts are left out, as the folder's list leaves them out.
export function readElsewhere(
  json: string,
  host: string,
  options: { isHidingDrafts?: boolean } = {}
): ElsewhereRead | null {
  let raw: { data?: { viewer?: { login?: string }; mine?: RawSearch; requested?: RawSearch } | null } | null
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const data = raw?.data
  const viewer = data?.viewer?.login
  if (!viewer) {
    return null
  }
  const read = (search: RawSearch | undefined, isMine: boolean): ElsewherePull[] =>
    (search?.nodes ?? []).flatMap((node) => {
      const name = node?.repository?.nameWithOwner
      if (!node || typeof node.number !== "number" || !name || (isMine && options.isHidingDrafts && node.isDraft)) {
        return []
      }
      const own = ownFacts(node)

      return [
        {
          repo: { host, name },
          number: node.number,
          title: node.title ?? "",
          url: node.url ?? "",
          author: own.author,
          isMine,
          isRequested: !isMine && isAskedOf(node, viewer),
          ci: own.ci,
          reviews: isMine ? own.reviews : {}
        }
      ]
    })
  const isCut = (search: RawSearch | undefined): boolean => (search?.issueCount ?? 0) > (search?.nodes?.length ?? 0)

  return {
    viewer,
    pulls: [...read(data?.mine, true), ...read(data?.requested, false)],
    isCut: { mine: isCut(data?.mine), requested: isCut(data?.requested) }
  }
}

// What the light check keeps, the plugin's state `elsewhere`: each pull request's last state, when it was last seen and
// last changed, so a reload, or one leaving the 30 and coming back, loses no change; the searches' cuts; when it last
// looked; when the picker was last opened, which marks what is new since; and whether the last check told the person
// what it read, as with the alerts from other repositories on, and not the picker's own check with them off.
export type ElsewhereState = {
  viewer: string
  pulls: Record<string, ElsewherePull & { seenAt: number; changedAt: number }>
  isCut: { mine: boolean; requested: boolean }
  at: number
  pickedAt: number | null
  isTold: boolean
}

// The state after a check read at `now`. Another account's state is none to go on from.
export function nextElsewhere(before: ElsewhereState | null, read: ElsewhereRead, now: number): ElsewhereState {
  const known = stateOf(before, read.viewer)
  const pulls: ElsewhereState["pulls"] = {}
  for (const pull of read.pulls) {
    const was = known?.pulls[pullKey(pull.repo, pull.number)]
    pulls[pullKey(pull.repo, pull.number)] = {
      ...pull,
      seenAt: now,
      changedAt: was && isSame(was, pull) ? was.changedAt : now
    }
  }
  // One missing from its search is kept as it was where that search was cut, as it may be past the 30. From one that
  // wasn't, it left it: your own closed, or a review no more asked of you, which a request asked again tells anew.
  for (const [key, was] of Object.entries(known?.pulls ?? {})) {
    const wasCut = was.isMine ? read.isCut.mine : read.isCut.requested
    if (!(key in pulls) && wasCut && now - was.seenAt < KEPT_MS) {
      pulls[key] = was
    }
  }
  const kept = Object.entries(pulls)
    .sort(([, one], [, other]) => other.seenAt - one.seenAt)
    .slice(0, KEPT_LIMIT)

  return {
    viewer: read.viewer,
    pulls: Object.fromEntries(kept),
    isCut: read.isCut,
    at: now,
    pickedAt: known?.pickedAt ?? null,
    isTold: known?.isTold ?? false
  }
}

// The state, where it is of this account; another's is none to go on from.
function stateOf(before: ElsewhereState | null, viewer: string): ElsewhereState | null {
  return before?.viewer === viewer ? before : null
}

// Whether what the alerts and the picker judge stayed the same.
function isSame(one: ElsewherePull, other: ElsewherePull): boolean {
  return (
    one.ci === other.ci &&
    one.isRequested === other.isRequested &&
    JSON.stringify(one.reviews) === JSON.stringify(other.reviews)
  )
}

// What changed since the state `before`, of the kinds on: none against no state, which the first check only sets.
// The light check reads reviews, CI and review requests alone (`CHECKED_KINDS`), each judged as the full list judges
// it; one batch per pull request.
export function elsewhereAlerts(
  before: ElsewhereState | null,
  after: readonly ElsewherePull[],
  kinds: readonly AlertKind[]
): AlertBatch[] {
  if (!before) {
    return []
  }

  return after.flatMap((pull): AlertBatch[] => {
    const was = before.pulls[pullKey(pull.repo, pull.number)]
    const events = [...ownEvents(was, pull), ...requestEvents(was, pull, before.isCut.requested)].filter((alert) =>
      kinds.includes(alert.kind)
    )

    return events.length > 0 ? [{ kind: "events", from: "check", repo: pull.repo, events }] : []
  })
}

// On the viewer's own, known before: CI, then each new review, as `mineAlerts` orders them.
function ownEvents(was: ElsewherePull | undefined, pull: ElsewherePull): Alert[] {
  if (!was || !pull.isMine) {
    return []
  }
  const ci = ciEvent(was.ci, pull.ci)

  return [
    ...(ci ? [alertOn(pull, "ci", ci)] : []),
    ...reviewEvents(was.reviews, pull.reviews).map((review) => alertOn(pull, "reviews", review))
  ]
}

// A review newly asked of the viewer, by the pull request's author.
function requestEvents(was: ElsewherePull | undefined, pull: ElsewherePull, wasCut: boolean): Alert[] {
  return isNewRequest(was, pull.isRequested, wasCut)
    ? [alertOn(pull, "reviewRequests", { symbol: "⌕", event: "review requested" }, pull.author)]
    : []
}

function alertOn(pull: ElsewherePull, kind: AlertKind, event: Event, by: string | null = null): Alert {
  return { kind, number: pull.number, title: pull.title, by, ...event }
}

// What waits for the viewer: a review asked of them; on their own, CI failing, changes requested, or an approval with
// the checks done. One rule for the first check's line, "+N elsewhere" and the picker's counts.
export function needsYou(pull: ElsewherePull): boolean {
  if (pull.isRequested) {
    return true
  }
  const verdicts = Object.values(pull.reviews).filter((review) => !review.isBot)
  const isDone = !isCiFailing(pull.ci) && !isCiRunning(pull.ci)

  return (
    pull.isMine &&
    (isCiFailing(pull.ci) ||
      verdicts.some((review) => review.state === "CHANGES_REQUESTED") ||
      (isDone && verdicts.some((review) => review.state === "APPROVED")))
  )
}

// The first check's line: how many wait, and in which repositories; null where none does.
export function elsewhereSummary(pulls: readonly ElsewherePull[]): string | null {
  const waiting = pulls.filter(needsYou)
  if (waiting.length === 0) {
    return null
  }
  const names = [...new Set(waiting.map((pull) => pull.repo.name))].sort()
  const where = names.length === 1 ? "another repository" : "other repositories"

  return `${waiting.length} waiting in ${where}: ${names.join(", ")}`
}

// --- When it runs ---

// What the light check's timer reaches (`register.tsx`): the clock, the work begun, whether an app draws the session,
// whether the refresh setting has checks run now (`isCheckingMode`), and a check.
export type ElsewhereTimerHost = {
  every: (ms: number, tick: () => void) => Timer
  background: (work: Promise<unknown>) => void
  isDrawn: () => Promise<boolean>
  isCheckingMode: () => Promise<boolean>
  check: () => Promise<void>
}

// The light check where it is on, on the refresh mode's timer, while an app draws the session and the mode has checks
// run now, as the folder's do. A tick that asks nothing lets the next check say what waits in one line again
// (`isReturning`). On demand there is no timer: /prs and ↻ ask (`askElsewhere`).
export function pollElsewhere(host: ElsewhereTimerHost, session: Session): void {
  if (!session.settings.isAlertingElsewhere || session.settings.refresh === "on-demand" || session.elsewhere.timer) {
    return
  }
  session.elsewhere.timer = host.every(session.settings.pollMs, () => host.background(tickElsewhere(host, session)))
  host.background(tickElsewhere(host, session))
}

async function tickElsewhere(host: ElsewhereTimerHost, session: Session): Promise<void> {
  if (!(await host.isDrawn()) || !(await host.isCheckingMode())) {
    session.elsewhere.isReturning = true

    return
  }
  await host.check()
}

// A check now, in every mode, as the folder's list is read again at once: whenever the pane opens (/prs, the band, an
// app attaching) and at Refresh, the folder's, a visit's or the examples'. So "+N elsewhere" shows what waits now, which
// the background's timer would leave as it was for up to an interval.
export function askElsewhere(host: ElsewhereTimerHost, session: Session): void {
  if (session.settings.isAlertingElsewhere) {
    host.background(host.check())
  }
}

// --- A check ---

// What a check needs of the plugin (`register.tsx`): gh, the clock, the debug log, the state it keeps over a reload,
// and the way to the person.
export type ElsewhereHost = Host & {
  now: () => Promise<number>
  log: (line: string) => void
  state: () => Promise<ElsewhereState | null>
  // A change to the state kept, made in one write: none where a reload replaced the module the check began in.
  changeState: (change: (state: ElsewhereState | null) => ElsewhereState) => Promise<void>
  announce: (batches: readonly AlertBatch[]) => Promise<void>
}

// One light check, joining one under way, as the timer's and the person's can meet. The first of a session, the first
// since nothing drew (`isReturning`), or the first to tell after checks that told nothing (the picker's, with the
// alerts from other repositories off, then turned on) says what waits in one line; later ones tell what changed; with
// the setting off, none tells. On the folder's server, gh's default where the folder has no repository for good
// (`folderFor`); none where its repository can't be looked up now. A failure goes to the debug log alone, as the
// folder's problems are said by its own list.
export function checkElsewhere(host: ElsewhereHost, session: Session): Promise<void> {
  session.elsewhere.inFlight ??= runCheck(host, session).finally(() => {
    session.elsewhere.inFlight = null
  })

  return session.elsewhere.inFlight
}

async function runCheck(host: ElsewhereHost, session: Session): Promise<void> {
  // Taken as the check starts: a tick that finds nothing drawn while it runs is for the next check.
  const isReturning = session.elsewhere.isReturning
  session.elsewhere.isReturning = false
  const failed = (why: string): void => {
    session.elsewhere.isReturning ||= isReturning
    host.log(`Other repositories could not be checked: ${why}`)
  }
  // A load under way, as a session's first, finds the folder's repository: waited for, so gh isn't asked twice.
  if (!session.repo) {
    await session.checks.inFlight?.done.catch(() => undefined)
  }
  const folder = await folderFor(host, session)
  if (folder === undefined) {
    failed("the folder's repository could not be looked up")

    return
  }
  const server = folder?.host ?? DEFAULT_HOST
  // gh's default server is asked only where gh is signed in to it, as no server is asked that it isn't.
  if (folder === null && "problem" in (await authStatus(host, server))) {
    failed(`the GitHub CLI is not signed in to ${server}`)

    return
  }
  const asked = await ghRun(
    host,
    ["gh", "api", "graphql", "--hostname", server, "-f", `query=${elsewhereQuery(folder)}`],
    GH_LOOKUP_TIMEOUT_MS
  )
  const read =
    "problem" in asked
      ? null
      : readElsewhere(asked.ran.stdout, server, { isHidingDrafts: session.settings.isHidingDrafts })
  if (!read) {
    failed("problem" in asked ? asked.problem.message : "no answer read")

    return
  }
  const before = await host.state()
  const known = stateOf(before, read.viewer)
  const isFirst = known === null || isReturning || !known.isTold
  const next = { ...nextElsewhere(before, read, await host.now()), isTold: session.settings.isAlertingElsewhere }
  await host.changeState((current) => withLaterPickedAt(next, current))
  // With the setting off, as for the picker's check, what it read is kept and nothing is told.
  if (!session.settings.isAlertingElsewhere) {
    return
  }
  if (isFirst) {
    // Said only while the alerts it reads are on, as Change alerts and the Alert rows turn them.
    const isAlerting = session.settings.alertKinds.some((kind) => CHECKED_KINDS.includes(kind))
    const line = isAlerting ? elsewhereSummary(read.pulls) : null
    await host.announce(line ? [{ kind: "line", repo: folder, line, from: "check" }] : [])
  } else {
    await host.announce(elsewhereAlerts(known, read.pulls, session.settings.alertKinds))
  }
}

// The folder's repository; null where it has none for good (no git repository, no remote on a GitHub server gh is
// signed in to), and the check asks gh's default server; undefined where it couldn't be looked up now, as with GitHub
// out of reach, where asking without leaving the folder's out would tell its changes as another repository's.
async function folderFor(host: ElsewhereHost, session: Session): Promise<RepoRef | null | undefined> {
  const found = await sessionRepo(host, session)
  if ("repo" in found) {
    return found.repo
  }

  return found.problem.isPermanent ? null : undefined
}

// The state kept (`value`) as the repository picker leaves it, opened at `at`: what changes after it is new the next
// time. A state that isn't one, as before any check, stays as it is.
export function withPickedAt(value: object | null, at: number): object | null {
  const state = readElsewhereState(value)

  return state ? { ...state, pickedAt: at } : value
}

// What a check writes (`next`) over the state kept now (`current`): when the picker was last opened stays the later of
// the two, as the picker may open while a check runs.
function withLaterPickedAt(next: ElsewhereState, current: ElsewhereState | null): ElsewhereState {
  const picked = current?.pickedAt ?? -Infinity

  return picked > (next.pickedAt ?? -Infinity) ? { ...next, pickedAt: picked } : next
}

// The state as a module before a reload kept it; anything else is none.
export function readElsewhereState(value: unknown): ElsewhereState | null {
  const state = value as Partial<ElsewhereState> | null

  return typeof state?.viewer === "string" &&
    typeof state.at === "number" &&
    typeof state.pulls === "object" &&
    state.pulls !== null &&
    typeof state.isCut === "object" &&
    state.isCut !== null
    ? {
        ...(state as ElsewhereState),
        pickedAt: typeof state.pickedAt === "number" ? state.pickedAt : null,
        isTold: state.isTold === true
      }
    : null
}
