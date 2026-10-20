// Author: David Matura

// Refreshing the list: the timer that runs the loads, one load at a time, and each load's way from GitHub's answer to
// the pane, the status line and the alerts, compared with the list before it or the last look. Sessions in the same
// repository share GitHub's answers (`shared.ts`): the timer takes one another session read where it is new enough.

import type { Timer } from "claude-code"

import type { Activity, CheckoutAt, MergedPull, PullsSnapshot } from "../types"
import {
  activityAfter,
  alertLines,
  changesBetween,
  closedAlerts,
  refreshAlerts,
  sinceLastLook,
  vanishedPulls
} from "./alerts"
import type { Alert, RefreshKind, SinceLastLook } from "./alerts"
import { leftHeads, leftToAsk, listAfter, rowsGone } from "./carry"
import { checkedOut } from "./checkout"
import type { Host } from "./machine"
import { addStates, numbersToAsk } from "./ended"
import type { ClosedState } from "./ended"
import { messageOf, SETUP_NOTE_MS } from "./gh"
import type { GhProblem, RepoRef } from "./gh"
import { CLOSED_LOOKUP_LIMIT, pullStates, queryPulls, viewRepo } from "./github"
import { isStackless, readPulls, storedSnapshot, withoutMerged } from "./pulls"
import type { Checks, Session } from "./session"
import {
  answerToShare,
  audienceId,
  isAskedSince,
  isOthersClaim,
  isOverdue,
  planShareCheck,
  planTick,
  QUERY_VERSION,
  SHARE_CHECK_MS
} from "./shared"
import type { FetchClaim, SharedAnswer, TickPlan } from "./shared"
import { statusSummary } from "./summary"

// What refreshing needs beyond git and gh (`Host`), handed in by the hooks module, which alone calls the engine and
// holds the session's state.
export type RefreshHost = Host & {
  now: () => Promise<number>
  every: (ms: number, tick: () => void) => Timer
  after: (ms: number, fire: () => void) => Timer
  // Work nobody waits for, whose failure goes to the debug log, as `log` writes a line there.
  background: (work: Promise<unknown>) => void
  log: (line: string) => void
  // The session's state: the list as stored, the rows shown merged meanwhile, and what a load writes.
  storedList: () => Promise<PullsSnapshot | null>
  merged: () => Promise<MergedPull[]>
  // The list, with the branch and commit the session's checkout was on as it was read, and no problem; resolves the
  // checkout kept, a newer one a press read meanwhile in place of this one (`newerCheckout`). None where a reload
  // replaced this load of the module while one of its hooks still ran: the newer one's list stays.
  showList: (snapshot: PullsSnapshot, checkout: CheckoutAt) => Promise<CheckoutAt | null>
  writeProblem: (message: string) => Promise<void>
  markLoading: (isLoading: boolean) => Promise<unknown>
  keepActivity: (change: (kept: readonly Activity[]) => Activity[]) => Promise<unknown>
  isDemo: () => Promise<boolean>
  // The last look at a repository, which the store keeps across sessions.
  recall: (repo: RepoRef) => Promise<PullsSnapshot | null>
  remember: (repo: RepoRef, snapshot: PullsSnapshot) => Promise<void>
  // What the person sees: whether anything is drawn, the pane, the status line, toasts and alerts.
  isDrawn: () => Promise<boolean>
  isPaneOpen: () => Promise<boolean>
  isPaneShown: () => Promise<boolean>
  setStatus: (text: string | undefined) => Promise<void>
  clearStatus: () => Promise<void>
  notify: (text: string, timeoutMs: number) => Promise<void>
  // `areChanges`: pull request changes, which a system notification may carry; a session's first summary is not one.
  announce: (repo: RepoRef, lines: readonly string[], areChanges: boolean) => Promise<void>
  // What a load sets off: the lookup Create PR waits on, and the cleanup of pull requests that left the lists, with
  // what the load found of how they ended (`known`), which it asks GitHub no more.
  lookUpBranch: (repo: RepoRef, branch: string | null, head: string | null) => Promise<unknown>
  cleanUp: (repo: RepoRef, known: readonly ClosedState[]) => Promise<void>
  // The answer a person's sessions in a repository share through the store, and the claim of one asking GitHub now
  // (`audienceId`); one that can't be read is none, and one that can't be kept is logged, and `shareAnswer` says so.
  recallShared: (repo: RepoRef, viewer: string) => Promise<SharedAnswer | null>
  // Whether the store holds the answer, or one asked for later; not where it refused it.
  shareAnswer: (repo: RepoRef, shared: SharedAnswer) => Promise<boolean>
  recallClaim: (repo: RepoRef, viewer: string) => Promise<FetchClaim | null>
  claimFetch: (repo: RepoRef, claim: FetchClaim) => Promise<void>
}

// What a load reads: GitHub's answer, and when it was asked for and came.
type Read = { stdout: string; requestedAt: number; fetchedAt: number }

// --- The timer ---

// Asking again is how the person retries after fixing a problem that stopped the refreshes.
export async function retry(host: RefreshHost, session: Session): Promise<void> {
  checkAgain(host, session)
  await ensurePolling(host, session)
}

// Checks come back after a problem stopped them, and one runs now.
export function checkAgain(host: RefreshHost, session: Session): void {
  session.checks.isStopped = false
  host.background(refresh(host, session, false))
}

// Background mode polls for the whole session and while-open mode only while the pane is up; either picks
// up again after a reload or a stop.
export async function ensurePolling(host: RefreshHost, session: Session): Promise<void> {
  if (session.checks.timer || session.checks.isStopped) {
    return
  }

  const isChecking = await isCheckingMode(host, session)
  // Another call may have started the timer while this one asked about the pane.
  if (isChecking && !session.checks.timer && !session.checks.isStopped) {
    startTimers(host, session)
  }
}

// Whether the refresh setting has checks run now: always in background mode, while the pane is open in while-open
// mode, never on demand. A problem that stopped them (`checks.isStopped`) is the caller's to weigh: the timer and a
// skill's turns heed it, while coming back to an attached window refreshes regardless, as asking again would, and a
// load that works lifts it.
export async function isCheckingMode(host: RefreshHost, session: Session): Promise<boolean> {
  return (
    session.settings.refresh === "background" ||
    (session.settings.refresh === "while-open" && (await host.isPaneOpen()))
  )
}

// How often checks run by themselves, in minutes, while the timer runs them: not once a problem stopped them (which
// stops the timer), nor in a refresh mode that doesn't poll now.
export function retryMinutes(session: Session): number | null {
  return session.checks.timer !== null ? session.settings.pollMs / 60_000 : null
}

function startTimers(host: RefreshHost, session: Session): void {
  session.checks.timer = host.every(session.settings.pollMs, () => host.background(tick(host, session)))
  if (session.settings.isSharingRefreshes) {
    session.checks.shareTimer = host.every(SHARE_CHECK_MS, () => host.background(checkShared(host, session)))
  }
}

function stopTimer(session: Session): void {
  session.checks.timer?.cancel()
  session.checks.timer = null
  session.checks.shareTimer?.cancel()
  session.checks.shareTimer = null
}

async function tick(host: RefreshHost, session: Session): Promise<void> {
  // With nothing attached any more (the desktop window closed) nobody would see what a check finds; attaching
  // again starts the checks again.
  if (!(await host.isDrawn())) {
    stopTimer(session)
    session.checks.wasDetached = true

    return
  }
  if (session.settings.refresh === "while-open" && !(await host.isPaneOpen())) {
    stopTimer(session)

    return
  }
  const repo = session.repo
  // With sharing off, or no repository, the tick refreshes as without sharing; so does a session that shows no list
  // yet, which has none to compare an answer with, nor a person to share one with.
  const own = repo && session.settings.isSharingRefreshes ? storedSnapshot(await host.storedList()) : null
  if (!repo || !own) {
    await refresh(host, session, true)

    return
  }
  const { plan, awaited } = planTick({
    own,
    requestedAt: session.checks.requestedAt,
    shared: await host.recallShared(repo, own.viewer),
    unreadable: session.checks.unreadable,
    claim: await host.recallClaim(repo, own.viewer),
    now: await host.now(),
    pollMs: session.settings.pollMs,
    sessionId: session.id,
    repo
  })
  session.checks.awaited = awaited
  await followPlan(host, session, repo, plan, own.viewer, false)
}

// Between ticks, an answer another session shared is taken as soon as it is newer, while anyone sees the list; the
// tick alone ends the checks once nobody does. A window that opens again looks at once, as what this session waited for
// may have come due while it was closed.
export async function checkShared(host: RefreshHost, session: Session): Promise<void> {
  const now = await host.now()
  const previousLookAt = session.checks.lastLookAt
  session.checks.lastLookAt = now
  const repo = session.repo
  const isWatched = (await host.isDrawn()) && (session.settings.refresh !== "while-open" || (await host.isPaneOpen()))
  const own = repo && isWatched ? storedSnapshot(await host.storedList()) : null
  if (!repo || !own) {
    return
  }
  const awaited = session.checks.awaited
  const plan = planShareCheck({
    own,
    shared: await host.recallShared(repo, own.viewer),
    unreadable: session.checks.unreadable,
    // Read only for a wait that is due, the one time it decides anything.
    claim: isOverdue(awaited, now, previousLookAt) ? await host.recallClaim(repo, own.viewer) : null,
    requestedAt: session.checks.requestedAt,
    now,
    sessionId: session.id,
    repo,
    awaited,
    previousLookAt
  })
  // The wait ends where this look asks GitHub, or takes the answer waited for; not where a tick set it meanwhile, for
  // an answer later than the one this look takes.
  const waiting = session.checks.awaited
  if (waiting && (plan.kind === "fetch" || (plan.kind === "adopt" && plan.shared.requestedAt >= waiting.since))) {
    session.checks.awaited = null
  }
  await followPlan(host, session, repo, plan, own.viewer, true)
}

// What a plan says to do; `isOffBeat` where the look between ticks made it, not the tick.
async function followPlan(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  plan: TickPlan,
  viewer: string,
  isOffBeat: boolean
): Promise<void> {
  switch (plan.kind) {
    case "adopt":
      await adopt(host, session, plan.shared)
      // One this session can't read has GitHub asked in its place, as with none shared; once for that session, whose
      // answers are left alone from then on, so the timers keep their beat.
      if (session.checks.unreadable.has(plan.shared.by)) {
        await fetchClaimed(host, session, repo, viewer, false)
      }

      return
    case "fetch":
      return fetchClaimed(host, session, repo, viewer, isOffBeat)
    case "none":
      return
    default:
      plan satisfies never
  }
}

// A request a timer makes is claimed first, so the other sessions' timers wait for its answer; where the timer's
// refresh joins a request under way, that request is the one claimed. Nothing is claimed while this session's answers
// aren't shared (`share`), as nobody should wait for one, and a request whose answer none will share lets its claim go
// (`letClaimGo`). This session's timers then start over from the request, so its next tick comes an interval after it:
// where the look between ticks made it, off the tick's beat; and where another session's claim found after it says the
// two sessions' timers fire together, as they would again each interval.
async function fetchClaimed(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  viewer: string,
  isOffBeat: boolean
): Promise<void> {
  const id = audienceId(repo, viewer)
  const at = await host.now()
  const asked = session.checks.inFlight?.requestedAt ?? at
  const claimed = session.checks.unshared.has(id)
    ? null
    : host.claimFetch(repo, { by: session.id, at, asked, viewer, query: QUERY_VERSION })
  if (claimed) {
    host.background(claimed)
  }
  let isAnswered = false
  try {
    await refresh(host, session, true)
    // No answer is on its way where the request came to nothing, a problem shown in its place, or brought one too large
    // to share; nor where the load failed.
    isAnswered = (session.checks.requestedAt ?? -Infinity) >= asked && !session.checks.unshared.has(id)
  } finally {
    if (claimed && !isAnswered) {
      host.background(letClaimGo(host, session, repo, viewer, asked, claimed))
    }
  }
  const isCrossed =
    !isOffBeat && isOthersClaim(await host.recallClaim(repo, viewer), viewer, session.id, await host.now())
  if ((isOffBeat || isCrossed) && session.checks.timer) {
    stopTimer(session)
    startTimers(host, session)
  }
}

// --- The loads ---

// One load at a time: a refresh asked for while one runs shares it. One reading another session's answer may be older
// than what is asked for, so it is waited out and GitHub asked.
export function refresh(host: RefreshHost, session: Session, isAlerting: boolean): Promise<void> {
  const running = session.checks.inFlight
  if (running && !running.isFetching) {
    return running.done.catch(() => undefined).then(() => refresh(host, session, isAlerting))
  }
  session.checks.isAlertWanted ||= isAlerting

  return running ? running.done : startLoad(host, session, null)
}

// Another session's answer, which the timer takes: alerted, as its own refresh would be. A load under way is joined,
// alerted too, and a newer answer taken at the next look.
function adopt(host: RefreshHost, session: Session, shared: SharedAnswer): Promise<void> {
  session.checks.isAlertWanted = true
  if (session.checks.inFlight) {
    return session.checks.inFlight.done
  }

  return startLoad(host, session, shared)
}

function startLoad(host: RefreshHost, session: Session, shared: SharedAnswer | null): Promise<void> {
  const done = loadTracked(host, session, shared).finally(() => endLoad(host, session))
  session.checks.inFlight = { done, isFetching: shared === null, requestedAt: null }

  return done
}

// The load is over where a refresh stops joining it, with no await between: a refresh nobody asked for that joined it
// after it took its kind gets the toasts it held back, and no wish to alert outlives it into the next load, which the
// person may have asked for. A load that failed held back nothing; the refresh after it must not alert for it.
function endLoad(host: RefreshHost, session: Session): void {
  const held = session.checks.heldBack
  if (held && session.checks.isAlertWanted) {
    host.background(host.announce(held.repo, held.lines, true))
  }
  session.checks.inFlight = null
  session.checks.isAlertWanted = false
  session.checks.heldBack = null
}

// The load after one a window came during, which tells what that one saw, unless /prs looked back meanwhile.
async function tellAway(host: RefreshHost, session: Session): Promise<void> {
  await session.checks.inFlight?.done.catch(() => undefined)
  if (session.checks.awayBase !== null) {
    await refresh(host, session, false)
  }
}

// A load under way began before the write, and would bring the row back as it was; this waits it out first.
export async function refreshAfterWrite(host: RefreshHost, session: Session): Promise<void> {
  await session.checks.inFlight?.done.catch(() => undefined)
  await refresh(host, session, false)
}

async function loadTracked(host: RefreshHost, session: Session, shared: SharedAnswer | null): Promise<void> {
  session.checks.marking = host.markLoading(true)
  await session.checks.marking
  try {
    await load(host, session, shared)
  } finally {
    await host.markLoading(false)
  }
}

// The list from GitHub's answer, read by this session or, at the timer's tick, by another (`shared`).
async function load(host: RefreshHost, session: Session, shared: SharedAnswer | null): Promise<void> {
  session.repo ??= await resolveRepo(host, session)
  const repo = session.repo
  if (!repo) {
    return
  }
  const read = shared
    ? { stdout: JSON.stringify(shared.answer), requestedAt: shared.requestedAt, fetchedAt: shared.fetchedAt }
    : await fetchList(host, session, repo)
  if (!read) {
    return
  }

  const result = readPulls(read.stdout, repo.name, read.fetchedAt, {
    includeOutdated: session.settings.includeOutdated,
    isHidingDrafts: session.settings.isHidingDrafts
  })
  // The searches go by the new name from now on, and this session asks GitHub under it.
  if ("movedTo" in result) {
    session.repo = { ...repo, name: result.movedTo }
    host.log(`${repo.name} is ${result.movedTo} on GitHub now: the list is read under that name`)

    return load(host, session, null)
  }
  if ("problem" in result) {
    // Another session's answer this one can't read is no problem of its own: GitHub is asked in its place
    // (`followPlan`), and that session's answers and claims are left alone from now on.
    if (shared) {
      session.checks.unreadable.add(shared.by)
      host.log(`The list another session read could not be read here: ${result.problem}`)
    } else {
      await showProblem(host, session, { message: result.problem, isPermanent: false })
    }

    return
  }
  const isSharing = !shared && session.settings.isSharingRefreshes
  const answer = isSharing ? answerToShare(read, repo, result.snapshot.viewer, session.id) : null
  const claimed =
    answer && !session.checks.unshared.has(audienceId(repo, answer.viewer))
      ? claimAnswer(host, session, repo, answer)
      : null
  if (claimed) {
    host.background(claimed)
  }
  try {
    await present(host, session, repo, read, result.snapshot, shared)
  } catch (error) {
    // A load that failed shares no answer.
    if (claimed) {
      host.background(letClaimGo(host, session, repo, result.snapshot.viewer, read.requestedAt, claimed))
    }
    throw error
  }
  // Shared once this session marked its toasts shown, so a session that takes the answer leaves them out.
  if (isSharing) {
    share(host, session, repo, answer, result.snapshot.viewer, claimed)
  }
}

// What a load does with the list it read: shows it and, where it is drawn, alerts what changed.
async function present(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  read: Read,
  list: PullsSnapshot,
  shared: SharedAnswer | null
): Promise<void> {
  const previous = await host.storedList()
  // A list that came after the answer's request went out may be newer, and stays (`isAskedSince`).
  if (shared && previous && !isAskedSince(shared, previous, await host.now())) {
    return
  }
  session.checks.requestedAt = read.requestedAt
  // A session's first load compares with the last look of an earlier one, so the pane shows what changed while
  // the person was away, and what was known of each pull request then carries over.
  const before = session.checks.awayBase ?? previous ?? (await host.recall(repo))
  const source = previous ?? before
  // What left since `before` but not since `source` matters only to the closed alerts a drawn load tells, which come of
  // rows that left since `before`; a load that tells none asks only what its carries need, so loads nothing draws don't
  // ask of the same ones again and again, and nothing waits on an answer no alert comes of.
  const isDrawn = await host.isDrawn()
  const isTellingClosed = isDrawn && session.settings.alertKinds.includes("closed") && rowsGone(before, list).length > 0
  // The list waits a while for GitHub to say how the pull requests that left ended, and carries what it knew of them
  // only if told by then; the closed alerts wait for the answer as long as it may take.
  const lookup = endedStates(host, repo, source, isTellingClosed ? before : source, list)
  const states = (await settledWithin(host, lookup, ENDED_LOOKUP_WAIT_MS)) ?? null
  // What /prs looks back on where nothing is drawn; a drawn load telling closed alerts keeps the full answer instead.
  session.checks.lookedUp = states ?? []
  // Read once GitHub said how pull requests ended, so a merge from the pane that went through meanwhile is not shown
  // open again.
  const fresh = withoutMerged(list, await host.merged())
  // Read with the list, so a switch of branch, or a commit, shows by the next refresh; a press that read it since keeps
  // its own (`showList`).
  const checkout = { ...(await checkedOut(host)), at: await host.now() }
  const snapshot = listAfter(previous, before, fresh, states)
  const shown = await host.showList(snapshot, checkout)
  if (!shown) {
    return
  }
  host.background(host.lookUpBranch(repo, shown.branch, shown.head))
  // Working again, a later sign-out is news again, and checks a problem stopped come back, as when /prs or an
  // attached window loaded past it.
  session.checks.hasAnnouncedSetup = false
  if (session.checks.isStopped) {
    session.checks.isStopped = false
    host.background(ensurePolling(host, session))
  }
  // The demo's summary stays until it ends, which puts this one back.
  if (session.settings.isShowingStatus && !(await host.isDemo())) {
    await host.setStatus(statusSummary(snapshot))
  }
  // Looked for when the session starts and whenever a pull request leaves the lists, or a branch of the viewer's does,
  // as one merged from the pane left the list as it merged.
  const isLeaving = vanishedPulls(previous, snapshot).length > 0 || leftHeads(previous, snapshot).length > 0
  if (session.settings.isCleaningUp && (previous === null || isLeaving)) {
    host.background(lookup.then((answer) => host.cleanUp(repo, answer ?? [])))
  }
  // Where nothing is drawn, or wasn't as the load began, /prs looks back by itself (`lookBack`), and the next drawn
  // load tells what this one saw: at once where a window came meanwhile in a mode whose attach refreshes, as that
  // refresh joined this load.
  const isDrawnNow = await host.isDrawn()
  if (!isDrawn || !isDrawnNow) {
    session.checks.awayBase ??= before
    if (isDrawnNow && (await isCheckingMode(host, session))) {
      host.background(tellAway(host, session))
    }

    return
  }

  const answer = isTellingClosed ? await lookup : states
  session.checks.lookedUp = answer ?? []
  const changes = changesBetween(before, snapshot, session.settings.alertKinds, closedSince(before, snapshot, answer))
  await host.keepActivity((kept) => activityAfter(kept, changes, before, snapshot, session.settings.changesMs))
  // The last look is what the pane put in front of the person, for a /prs where nothing is drawn and for the next
  // session's first load; a toast nobody may have seen is not one, nor a pane in a tab behind another, nor a list the
  // demo's examples cover.
  const isListShown = (await host.isPaneShown()) && !(await host.isDemo())
  if (isListShown) {
    await host.remember(repo, snapshot)
  }
  // Read after the last wait, so a timer's refresh that joined while this load ran still gets its toasts; one that
  // joins it later gets those it holds back as it ends (`endLoad`).
  const kind = takeKind(session.checks, previous, isListShown)
  // On demand nothing alerts, a list come back after a start or a `/clear` behind another tab neither.
  const lines = session.settings.refresh === "on-demand" ? null : refreshAlerts(changes, before, snapshot, kind)
  session.checks.heldBack = kind.isAlerting || kind.isReturning ? null : { repo, lines: alertLines(changes) }
  if (lines) {
    await host.announce(repo, lines, !kind.isReturning)
  }
}

// GitHub's answer to the list query, or null where a problem kept it from coming, which is shown.
async function fetchList(host: RefreshHost, session: Session, repo: RepoRef): Promise<Read | null> {
  const requestedAt = await host.now()
  if (session.checks.inFlight) {
    session.checks.inFlight.requestedAt = requestedAt
  }
  // A server without stacked pull requests, once it said so, is asked without them for the rest of the session.
  const withStacks = !session.stacklessHosts.has(repo.host)
  let asked = await queryPulls(host, repo, withStacks)
  if (withStacks && asked.ran && isStackless(asked.ran.stdout)) {
    session.stacklessHosts.add(repo.host)
    asked = await queryPulls(host, repo, false)
  }
  if ("problem" in asked) {
    if (asked.said !== "" && asked.said !== asked.problem.message) {
      host.log(`The list of ${repo.name} could not be read: ${asked.said}`)
    }
    await showProblem(host, session, asked.problem)

    return null
  }

  return { stdout: asked.ran.stdout, requestedAt, fetchedAt: await host.now() }
}

// Where no answer to this session's request made at `asked` will be shared, its claim on that request, once written
// (`claimed`), is kept as one that lapsed; not a claim on a later request, which the store may hold by then. The check
// and the write are two store calls, so another session's claim made between them is written over too: its answer
// still comes, and a third session may ask GitHub as well.
async function letClaimGo(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  viewer: string,
  asked: number,
  claimed: Promise<void>
): Promise<void> {
  await claimed.catch(() => undefined)
  const claim = await host.recallClaim(repo, viewer)
  if (claim?.by === session.id && claim.asked <= asked) {
    await host.claimFetch(repo, { ...claim, at: 0 })
  }
}

// An answer is claimed as it comes, so the other sessions wait for it while this one shows it rather than ask GitHub
// too; not over another session's claim that still holds, which already has them wait, and which tells this session's
// timer that the two fire together (`fetchClaimed`).
async function claimAnswer(host: RefreshHost, session: Session, repo: RepoRef, answer: SharedAnswer): Promise<void> {
  const { viewer, fetchedAt, requestedAt } = answer
  if (!isOthersClaim(await host.recallClaim(repo, viewer), viewer, session.id, fetchedAt)) {
    await host.claimFetch(repo, { by: session.id, at: fetchedAt, asked: requestedAt, viewer, query: QUERY_VERSION })
  }
}

// The answer goes to the other sessions in the repository in the background. One too large to share (none), said
// once, or one the store refused, stops this session claiming its requests (`fetchClaimed`, `claimAnswer`), as nobody
// should wait for an answer that doesn't come, until an answer is shared again; a refused one lets go of its claim
// (`letClaimGo`) too. Only the latest share decides, as an earlier one may settle after it.
function share(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  answer: SharedAnswer | null,
  viewer: string,
  claimed: Promise<void> | null
): void {
  const id = audienceId(repo, viewer)
  const turn = ++session.checks.shareTurn
  if (answer) {
    host.background(
      host.shareAnswer(repo, answer).then(async (isShared) => {
        if (turn !== session.checks.shareTurn) {
          return
        }
        if (isShared) {
          session.checks.unshared.delete(id)
        } else {
          session.checks.unshared.add(id)
          if (claimed) {
            await letClaimGo(host, session, repo, viewer, answer.requestedAt, claimed)
          }
        }
      })
    )
  } else if (!session.checks.unshared.has(id)) {
    session.checks.unshared.add(id)
    host.log(`The list of ${repo.name} is too large to share with other sessions.`)
  }
}

// How a load came about, for `refreshAlerts`, its flags reset for the next load.
export function takeKind(checks: Checks, previous: PullsSnapshot | null, isListShown: boolean): RefreshKind {
  const kind = {
    isReturning: previous === null || checks.isReturning || checks.awayBase !== null,
    isAlerting: checks.isAlertWanted,
    isListShown
  }
  checks.isAlertWanted = false
  checks.isReturning = false
  checks.awayBase = null

  return kind
}

async function resolveRepo(host: RefreshHost, session: Session): Promise<RepoRef | null> {
  const viewed = await viewRepo(host)
  if ("repo" in viewed) {
    return viewed.repo
  }
  await showProblem(host, session, viewed.problem)

  return null
}

// A problem that stops the checks stops them before it is drawn, so the pane says they won't come back by themselves.
async function showProblem(host: RefreshHost, session: Session, problem: GhProblem): Promise<void> {
  if (problem.isPermanent) {
    session.checks.isStopped = true
    stopTimer(session)
  }
  await host.writeProblem(problem.message)
  if (!(await host.isDemo())) {
    await host.clearStatus()
  }
  if (problem.needsSetup && !session.checks.hasAnnouncedSetup) {
    session.checks.hasAnnouncedSetup = true
    await host.notify(problem.message, SETUP_NOTE_MS)
  }
}

// --- What changed ---

// What changed since the last look, in any session, at this repository; this list becomes the next look, so what
// the loads before it saw is told here, and the next load nobody sees compares with it.
export async function lookBack(
  host: RefreshHost,
  session: Session,
  snapshot: PullsSnapshot
): Promise<SinceLastLook | null> {
  const repo = session.repo
  if (!repo) {
    return null
  }
  const before = await host.recall(repo)
  const closed = closedSince(before, snapshot, await statesSince(host, session, repo, before, snapshot))
  await host.remember(repo, snapshot)
  session.checks.awayBase = null

  return sinceLastLook(before, snapshot, session.settings.alertKinds, closed)
}

// How the pull requests gone since the last look ended: as the last load found, and, while their alerts are on, as
// GitHub says of the rest, and of any the last load found still open, which may have ended since. A failed lookup
// leaves the rest out.
async function statesSince(
  host: RefreshHost,
  session: Session,
  repo: RepoRef,
  before: PullsSnapshot | null,
  after: PullsSnapshot
): Promise<ClosedState[] | null> {
  const known = session.checks.lookedUp
  const vanished = vanishedPulls(before, after).map((row) => row.number)
  const ended = known.filter((state) => state.state !== "OPEN")
  const missing = numbersToAsk(vanished, ended).slice(0, CLOSED_LOOKUP_LIMIT)
  if (missing.length === 0 || !session.settings.alertKinds.includes("closed")) {
    return known
  }
  const found = await lookUpEnded(host, repo, missing)

  return found === null ? known : addStates(known, found)
}

// How long a load's list waits for GitHub to say how pull requests that left the lists ended, less than the lists' own
// request may take (`LIST_QUERY_TIMEOUT_MS`); a load telling closed alerts waits for the answer as long as it may take.
const ENDED_LOOKUP_WAIT_MS = 10_000

// What `work` settled to within `ms`, or undefined, the work going on.
function settledWithin<T>(host: RefreshHost, work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = host.after(ms, () => resolve(undefined))
    work.finally(() => timer.cancel()).then(resolve, reject)
  })
}

// How the pull requests that left the lists ended, asked in one request whatever the alerts (`leftToAsk`), as what
// carries from the list before needs it too. Null where none left, or where the lookup failed, which is logged: they
// are gone from the pane either way, and the carries go on as without it.
async function endedStates(
  host: RefreshHost,
  repo: RepoRef,
  source: PullsSnapshot | null,
  before: PullsSnapshot | null,
  after: PullsSnapshot
): Promise<ClosedState[] | null> {
  const numbers = leftToAsk(source, before, after, CLOSED_LOOKUP_LIMIT)
  if (numbers.length === 0) {
    return null
  }
  return lookUpEnded(host, repo, numbers)
}

// How `numbers` ended, as GitHub says; null where the lookup failed, which is logged.
async function lookUpEnded(
  host: RefreshHost,
  repo: RepoRef,
  numbers: readonly number[]
): Promise<ClosedState[] | null> {
  try {
    return await pullStates(host, repo, numbers)
  } catch (error) {
    host.log(`Merged and closed pull requests could not be looked up: ${messageOf(error)}`)

    return null
  }
}

// The pull requests that left the lists since `before` and merged or closed, as `states` tell; their alerts' setting
// is the caller's to weigh (`changesBetween`).
function closedSince(
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  states: readonly ClosedState[] | null
): Alert[] {
  return states
    ? closedAlerts(vanishedPulls(before, after), states, after.viewer, [...after.mine, ...after.review])
    : []
}
