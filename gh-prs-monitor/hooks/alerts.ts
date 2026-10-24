// Author: David Matura

import type { Activity, CiState, EndedPull, PullRow, PullSignals, PullsSnapshot, PullStack, ReviewMark } from "../types"
import type { ClosedState } from "./ended"
import { isRepo, pullKey } from "./gh"
import type { RepoRef } from "./gh"
import { isCiFailing, isCiRunning } from "./pull-status"
import { rowsOf } from "./pulls"
import { lookedAt } from "./when"

// The kinds a person turns on and off, one setting each.
export const ALERT_KINDS = [
  "ready",
  "comments",
  "reviews",
  "ci",
  "conflicts",
  "reviewRequests",
  "newCommits",
  "mentions",
  "closed"
] as const

export type AlertKind = (typeof ALERT_KINDS)[number]

// One change on one pull request: the symbol its kind shows with and what happened. `by` names the pull
// request's author where the line is about someone else's (a review request).
export type Alert = {
  kind: AlertKind
  number: number
  title: string
  by: string | null
  symbol: string
  event: string
}

// What the person is told, a batch at a time, each of one repository: a change, as a pull request's events, told by the
// folder's list or by the light check of other repositories (`elsewhere.ts`), whose toasts name the repository; or a
// line that is no change (the summary of what changed while away, a cleanup's note, or the light check's first summary,
// `from: "check"`), which no system notification carries. Each says when it was raised (`raisedAt`) once it is
// announced, as one held for a turn shows later. 1.4.0 held its alerts as lines alone, of no repository (`readHeld`).
export type AlertBatch = (
  | { kind: "events"; from: "list" | "check"; repo: RepoRef; events: Alert[] }
  | { kind: "line"; repo: RepoRef | null; line: string; from?: "check" }
) & { raisedAt?: number }

// The folder's changes, as its list tells them, a batch per pull request.
export function batchesOf(repo: RepoRef, changes: readonly Alert[]): AlertBatch[] {
  return groupByPull(changes).map((events) => ({ kind: "events", from: "list", repo, events }))
}

// What a batch says: a line per pull request, or its line.
export function batchLines(batch: AlertBatch): string[] {
  return batch.kind === "events" ? alertLines(batch.events) : [batch.line]
}

// What a batch says as toasts: a change the light check told names its repository, and how to see its list.
export function toastLines(batch: AlertBatch): string[] {
  return batch.kind === "events" && batch.from === "check" ? alertLines(batch.events, batch.repo) : batchLines(batch)
}

// What changed between two refreshes that is worth interrupting for. The first refresh of a session, and one
// after the repository, the account or the plugin's snapshot shape changed, only sets the baseline.
export function pullAlerts(before: PullsSnapshot | null, after: PullsSnapshot): Alert[] {
  if (!isComparable(before, after)) {
    return []
  }

  const ended = before.endedPulls ?? []

  return [
    ...mineAlerts(before.mine, after.mine, after.viewer),
    ...reviewAlerts(before.review, after.review, before.isCut.requested, ended),
    ...mentionAlerts(before.mentioned, after.mentioned, ended)
  ]
}

// Someone else's pull request that mentions the viewer for the first time; one closed and reopened mentioned them
// before. A search cut short at 30 cannot tell a new mention from an old one coming back into its first 30, so it says
// nothing then.
function mentionAlerts(
  before: PullsSnapshot["mentioned"],
  after: PullsSnapshot["mentioned"],
  ended: readonly EndedPull[]
): Alert[] {
  if (before.isCut) {
    return []
  }
  const known = new Set([
    ...before.pulls.map((pull) => pull.number),
    ...ended.filter((pull) => pull.isMentioned).map((pull) => pull.number)
  ])

  return after.pulls
    .filter((pull) => !known.has(pull.number))
    .map((pull) => ({
      kind: "mentions" as const,
      number: pull.number,
      title: pull.title,
      by: pull.author,
      symbol: "@",
      event: "you were mentioned"
    }))
}

export function isComparable(before: PullsSnapshot | null, after: PullsSnapshot): before is PullsSnapshot {
  return (
    before !== null && before.schema === after.schema && before.repo === after.repo && before.viewer === after.viewer
  )
}

// Every change between two snapshots of the kinds turned on, those on pull requests that left the lists (`closed`,
// looked up apart) included.
export function changesBetween(
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  kinds: readonly AlertKind[],
  closed: readonly Alert[] = []
): Alert[] {
  return isComparable(before, after)
    ? [...pullAlerts(before, after), ...closed].filter((alert) => kinds.includes(alert.kind))
    : []
}

// The pull requests in the lists before and gone after: merged, closed, or out of the search for another reason.
export function vanishedPulls(before: PullsSnapshot | null, after: PullsSnapshot): PullRow[] {
  if (!isComparable(before, after)) {
    return []
  }
  const present = new Set(rowsOf(after).map((row) => row.number))

  return rowsOf(before).filter((row) => !present.has(row.number))
}

// A pull request merged or closed by someone else; the viewer's own merge or close is no news, and one still
// open only left the search. A merged one in a stack names the one above it, next to merge, when that one is still
// in the lists (`listed`): GitHub keeps each one's place in a stack as those below it merge.
export function closedAlerts(
  vanished: readonly PullRow[],
  states: readonly ClosedState[],
  viewer: string,
  listed: readonly PullRow[]
): Alert[] {
  const stateOf = new Map(states.map((state) => [state.number, state]))
  const nextOf = (stack: PullStack): PullRow | undefined =>
    listed.find((other) => other.stack?.number === stack.number && other.stack.position === stack.position + 1)

  return vanished.flatMap((row): Alert[] => {
    const found = stateOf.get(row.number)
    // GitHub credits an auto-merge to whoever turned it on: the viewer's is news, as it happened while away; so is a
    // merge the queue made, whoever GitHub credits it to.
    const isOwnAutoMerge = found?.state === "MERGED" && found.by === viewer && row.signals.isAutoMerge
    const isQueueMerge = found?.state === "MERGED" && row.signals.isQueued
    if (!found || found.state === "OPEN" || (found.by === viewer && !isOwnAutoMerge && !isQueueMerge)) {
      return []
    }
    const by = isQueueMerge
      ? " from the merge queue"
      : isOwnAutoMerge
        ? " by auto-merge"
        : found.by
          ? ` by ${found.by}`
          : ""
    const alert = { kind: "closed" as const, number: row.number, title: row.title, by: null }

    const next = row.stack ? nextOf(row.stack) : undefined
    const nextNote = next && row.stack ? `, #${next.number} is next in stack #${row.stack.number}` : ""

    return [
      found.state === "MERGED"
        ? { ...alert, symbol: "✓", event: `merged${by}${nextNote}` }
        : { ...alert, symbol: "✕", event: `closed${by}` }
    ]
  })
}

// One line per pull request, so a reviewer's approval and comment are one toast: the first change's symbol, then
// each change in turn. Another repository's (`elsewhere`) names it, and says how to see its list.
export function alertLines(alerts: readonly Alert[], elsewhere: RepoRef | null = null): string[] {
  return groupByPull(alerts).map((group) => {
    const [first] = group
    const line = alertLine(
      first!.symbol,
      first!,
      group.map((alert) => alert.event).join(", "),
      group.find((alert) => alert.by)?.by ?? undefined,
      elsewhere?.name
    )

    return elsewhere ? `${line} · /prs ${elsewhere.name}` : line
  })
}

// The changes one refresh noticed, one entry per pull request, for the pane's note at the foot of its row, or under the
// lists for one that merged or closed, which left them.
export function activityOf(alerts: readonly Alert[], since: number, at: number): Activity[] {
  return groupByPull(alerts).map((group) => ({
    number: group[0]!.number,
    symbol: group[0]!.symbol,
    events: group.map((alert) => alert.event),
    since,
    at,
    ...(group.some((alert) => alert.kind === "closed") ? { ended: { title: group[0]!.title } } : {})
  }))
}

// The changes a row's notes hold, in order. One noticed again by a later refresh, as a reviewer posting single
// comments one after another is, is said once, where it came last, with how many times it came: `reviewed by ann ×2`,
// a no-break space before the count so a wrapped line doesn't start with it.
export function noteEvents(entries: readonly Activity[]): string[] {
  const counts = new Map<string, number>()
  for (const event of entries.flatMap((entry) => entry.events)) {
    const count = (counts.get(event) ?? 0) + 1
    // Taken out and put back, so it moves to its latest place.
    counts.delete(event)
    counts.set(event, count)
  }

  return [...counts].map(([event, count]) => (count > 1 ? `${event}\u00a0×${count}` : event))
}

// Enough for a long day away; the oldest go first.
const ACTIVITY_LIMIT = 100

// The notes still recent by the clock, and when the first of them goes, null with none left.
export function recentNotes(kept: readonly Activity[], now: number, recentMs: number): Activity[] {
  return kept.filter((entry) => now - entry.at < recentMs)
}

export function nextNoteExpiry(notes: readonly Activity[], recentMs: number): number | null {
  return notes.length > 0 ? Math.min(...notes.map((entry) => entry.at)) + recentMs : null
}

// The notes of changed pull requests after a refresh: those still recent, then what it noticed.
export function activityAfter(
  kept: readonly Activity[],
  changes: readonly Alert[],
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  recentMs: number
): Activity[] {
  const noticed = changes.length > 0 && before ? activityOf(changes, before.fetchedAt, after.fetchedAt) : []

  return [...kept.filter((entry) => after.fetchedAt - entry.at < recentMs), ...noticed].slice(-ACTIVITY_LIMIT)
}

export function groupByPull(alerts: readonly Alert[]): Alert[][] {
  const groups = new Map<number, Alert[]>()
  for (const alert of alerts) {
    groups.set(alert.number, [...(groups.get(alert.number) ?? []), alert])
  }

  return [...groups.values()]
}

// The alerts a session that showed them would have raised since the person last looked, for /prs to list where
// nothing draws alerts.
export type SinceLastLook = { at: string; changes: Alert[] }

// Null where there is nothing to compare with, or the alerts are off.
export function sinceLastLook(
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  kinds: readonly AlertKind[],
  closed: readonly Alert[] = []
): SinceLastLook | null {
  if (!isComparable(before, after) || kinds.length === 0) {
    return null
  }

  return {
    at: lookedAt(before.fetchedAt, after.fetchedAt),
    changes: changesBetween(before, after, kinds, closed)
  }
}

function mineAlerts(before: PullRow[], after: PullRow[], viewer: string): Alert[] {
  const previous = byNumber(before)

  return after.flatMap((row) => {
    const wasRow = previous.get(row.number)
    const was = wasRow?.signals
    if (!wasRow || !was) {
      return []
    }

    const now = row.signals
    const alerts: Alert[] = []
    const add = (kind: AlertKind, symbol: string, event: string): void => {
      alerts.push({ kind, number: row.number, title: row.title, by: null, symbol, event })
    }

    // The moment that matters, ahead of what led to it (the approval, the checks passing) on the same line. GitHub
    // recomputes mergeability after every push to the base; coming back to ready from that is no news.
    const wasReady = wasRow.stage === "ready" || (wasRow.stage === "checking" && was.wasReady === true)
    if (row.stage === "ready" && !wasReady) {
      add("ready", "✓", "ready to merge")
    }

    const ci = ciEvent(was.ci, now.ci)
    if (ci) {
      add("ci", ci.symbol, ci.event)
    }
    // Unknown mergeability in between is skipped by what was known before it, so a recompute after a base push
    // does not alert again, and a conflict that push brought does.
    const wasConflicting = was.isConflicting ?? was.lastConflict ?? null
    if (now.isConflicting === true && wasConflicting === false) {
      add("conflicts", "⚠", "merge conflicts")
    }

    for (const review of reviewEvents(was.reviews, now.reviews)) {
      add("reviews", review.symbol, review.event)
    }

    // The new comments among the latest read that people wrote after the viewer's own last reply, which says they
    // read what came before it; new ones beyond those read count as people's, unless the viewer replied since.
    const newComments = now.conversation.count - was.conversation.count
    if (newComments > 0) {
      const read = now.conversation.authors.slice(-newComments)
      const people = read
        .slice(read.lastIndexOf(viewer) + 1)
        .filter((login): login is string => login !== null && login !== viewer)
      const unread = read.includes(viewer) ? 0 : newComments - read.length
      const latest = people.at(-1)
      if (latest) {
        const count = people.length + unread
        add("comments", "✎", `${count === 1 ? "new comment" : `${count} new comments, the latest`} from ${latest}`)
      }
    }

    // Review comments come inside a review, so a person's are announced with it above, and a bot's, or the author's
    // own on their diff, are no news.

    return alerts
  })
}

// A pull request closed and reopened is compared with what was known of it on the review list as it closed. A requests
// search cut short at 30 cannot tell a new request from an old one coming back into its first 30, so a pull request
// missing from the list before, and not known so, is no news then.
function reviewAlerts(
  before: PullRow[],
  after: PullRow[],
  isRequestsCut: boolean,
  ended: readonly EndedPull[]
): Alert[] {
  const previous = byNumber(before)
  const closed = new Map<number, Pick<PullSignals, "isRequested" | "hasCommitsSinceMyReview">>()
  for (const { number, isRequested, hasCommitsSinceMyReview } of ended) {
    if (isRequested !== undefined && hasCommitsSinceMyReview !== undefined) {
      closed.set(number, { isRequested, hasCommitsSinceMyReview })
    }
  }

  return after.flatMap((row): Alert[] => {
    const was = previous.get(row.number)?.signals ?? closed.get(row.number)
    const pull = { number: row.number, title: row.title }
    if (isNewRequest(was, row.signals.isRequested, isRequestsCut)) {
      return [{ kind: "reviewRequests", ...pull, by: row.author, symbol: "⌕", event: "review requested" }]
    }
    if (was && row.signals.hasCommitsSinceMyReview && !was.hasCommitsSinceMyReview) {
      return [{ kind: "newCommits", ...pull, by: null, symbol: "↻", event: "new commits since your review" }]
    }

    return []
  })
}

// --- The rules both lists judge a change by ---

// The full list and the light check of other repositories (`elsewhere.ts`) tell the same change in the same words, so
// a session that told it from one leaves it out from the other (`freshAlerts`).
export type Event = { symbol: string; event: string }

// CI failing now and not before; or passing after running or failing, as a re-run that ran from start to end between
// two refreshes.
export function ciEvent(was: CiState, now: CiState): Event | null {
  if (isCiFailing(now) && !isCiFailing(was)) {
    return { symbol: "✗", event: "CI failed" }
  }

  return now === "SUCCESS" && (isCiRunning(was) || isCiFailing(was)) ? { symbol: "✓", event: "CI passed" } : null
}

// Each person's review with a time it didn't have before, by its verdict; a bot's is no news.
export function reviewEvents(
  was: Readonly<Record<string, ReviewMark>>,
  now: Readonly<Record<string, ReviewMark>>
): Event[] {
  return Object.entries(now).flatMap(([login, mark]) => {
    const verdict = REVIEW_VERDICTS[mark.state]

    return was[login]?.at !== mark.at && verdict && !mark.isBot
      ? [{ symbol: verdict.symbol, event: `${verdict.verb} by ${login}` }]
      : []
  })
}

// A review request the viewer didn't have: of a pull request known before (`was`), or new where the search before
// wasn't cut short, as one cut at 30 can't tell a new request from an old one coming back into its first 30.
export function isNewRequest(was: { isRequested: boolean } | undefined, isRequested: boolean, isCut: boolean): boolean {
  return isRequested && !was?.isRequested && (was !== undefined || !isCut)
}

const REVIEW_VERDICTS: Readonly<Record<string, { symbol: string; verb: string }>> = {
  APPROVED: { symbol: "✓", verb: "approved" },
  CHANGES_REQUESTED: { symbol: "±", verb: "changes requested" },
  COMMENTED: { symbol: "✎", verb: "reviewed" }
}

const TITLE_LENGTH = 40

// The one toast for what changed while the person was away; the pane notes it on each row.
export function awayLine(pullCount: number, since: string): string {
  return `Since ${since}, ${pullCount} pull request${pullCount === 1 ? "" : "s"} changed — see /prs`
}

// How the refresh came about, for `refreshAlerts`.
export type RefreshKind = {
  // The session's first load, or the first since nothing was drawn.
  isReturning: boolean
  // Nobody asked for it: the timer's, or one following a skill.
  isAlerting: boolean
  // The pane is open with the person's own list in it.
  isListShown: boolean
}

// What a refresh of `repo` announces. Coming back, what changed while the person was away is told once, pointing to
// the pane that lists it, even by a refresh that would alert: an alert per change would bury them; with the pane open,
// its marks tell it. Otherwise only the refreshes nobody asked for interrupt, a batch per pull request. Null announces
// nothing; an empty list announces nothing new but lets alerts held back for a turn through.
export function refreshAlerts(
  changes: readonly Alert[],
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  kind: RefreshKind,
  repo: RepoRef
): AlertBatch[] | null {
  if (kind.isReturning) {
    if (!before || changes.length === 0 || kind.isListShown) {
      return null
    }
    const pullCount = new Set(changes.map((change) => change.number)).size

    return [{ kind: "line", repo, line: awayLine(pullCount, lookedAt(before.fetchedAt, after.fetchedAt)) }]
  }

  return kind.isAlerting ? batchesOf(repo, changes) : null
}

// One line: the symbol of the kind of change, the pull request, and what happened. The title is there so a number
// alone need not be remembered, cut at a word to keep the toast to one line.
export function alertLine(
  symbol: string,
  pull: { number: number; title: string },
  event: string,
  author?: string,
  repoName = ""
): string {
  const by = author ? ` (${author})` : ""

  return `${symbol} ${repoName}#${pull.number} ${shortTitle(pull.title)}${by} — ${event}`
}

// Counted in what reads as one character, so an emoji, a flag or an accented letter is never cut in half.
function shortTitle(title: string): string {
  const characters = graphemesOf(title)
  if (characters.length <= TITLE_LENGTH) {
    return title
  }
  const cut = characters.slice(0, TITLE_LENGTH).join("")
  const lastSpace = cut.lastIndexOf(" ")
  const kept = lastSpace > cut.length / 2 ? cut.slice(0, lastSpace) : characters.slice(0, TITLE_LENGTH - 1).join("")

  return `${kept.trimEnd()}…`
}

function graphemesOf(text: string): string[] {
  return typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment)
    : Array.from(text)
}

export function byNumber(rows: PullRow[]): Map<number, PullRow> {
  return new Map(rows.map((row) => [row.number, row]))
}

// A line a toast shows, and the other repository it is of (`elsewhere`), none for this folder's.
export type ToastLine = { text: string; elsewhere: string | null }

// The toast stack draws only its newest few, so a showing never sends more than three toasts: past that, two alerts
// and a count of the rest, which the pane lists for this folder; other repositories' changes, which no list here shows,
// are counted apart and named.
export function toastsFor(alerts: readonly ToastLine[], limit = 3): string[] {
  if (alerts.length <= limit) {
    return alerts.map((alert) => alert.text)
  }
  const shown = alerts.slice(0, limit - 1).map((alert) => alert.text)
  const rest = alerts.slice(limit - 1)
  const own = rest.filter((alert) => alert.elsewhere === null).length
  const others = rest.length - own
  const names = [...new Set(rest.flatMap((alert) => (alert.elsewhere === null ? [] : [alert.elsewhere])))].sort()
  const ownText = `${own} more pull request ${own === 1 ? "change" : "changes"}, see /prs`
  const count =
    others === 0
      ? ownText
      : own === 0
        ? `${others} more changes in ${names.join(", ")}`
        : `${ownText}; ${others} more in ${names.join(", ")}`

  return [...shown, count]
}

// A showing of alerts as one system notification: its first alert, and how many came with it, which the toasts and the
// pane tell.
export function systemNotificationText(alerts: readonly string[]): string {
  const [first = "", ...rest] = alerts

  return rest.length === 0 ? first : `${first} (${rest.length} more)`
}

// Should a turn's end never be heard, held alerts still show after this long (`holdDue`).
const HOLD_LIMIT_MS = 5 * 60_000

// Alerts waiting for the running turns to end, and from when the first of them waited.
export type HeldAlerts = { held: AlertBatch[]; heldSince: number | null }

export function nothingHeld(): HeldAlerts {
  return { held: [], heldSince: null }
}

// The alerts held as a module before a reload kept them: this version's batches as they are; 1.4.0's lines, and
// 1.2.0's, as lines of no repository, told once more without a system notification.
export function readHeld(value: unknown): HeldAlerts {
  const kept = value as { held?: unknown; heldSince?: unknown } | null
  const heldSince = typeof kept?.heldSince === "number" ? kept.heldSince : null
  // One that says not when it was raised was raised while the hold began, at the latest.
  const raised = (batch: AlertBatch): AlertBatch =>
    typeof batch.raisedAt === "number" || heldSince === null ? batch : { ...batch, raisedAt: heldSince }
  const held = (Array.isArray(kept?.held) ? kept.held : []).flatMap((each: unknown): AlertBatch[] =>
    typeof each === "string" ? [{ kind: "line", repo: null, line: each }] : isBatch(each) ? [raised(each)] : []
  )

  return held.length > 0 ? { held, heldSince } : nothingHeld()
}

function isBatch(value: unknown): value is AlertBatch {
  const batch = value as Partial<{ kind: unknown; from: unknown; repo: unknown; events: unknown; line: unknown }> | null
  if (batch?.kind === "line") {
    return typeof batch.line === "string" && (batch.repo === null || isRepo(batch.repo))
  }

  return (
    batch?.kind === "events" &&
    (batch.from === "list" || batch.from === "check") &&
    isRepo(batch.repo) &&
    Array.isArray(batch.events)
  )
}

// How long the alerts held may wait still before they show, from `now`; none where none are held.
export function holdDue(waiting: HeldAlerts, now: number): number | null {
  return waiting.heldSince === null ? null : Math.max(0, waiting.heldSince + HOLD_LIMIT_MS - now)
}

// While a turn runs, alerts wait for it to finish, so they do not cover what is being read; then they show together.
// Held this long, they show now, and holding starts over: a long turn holds what comes later too, five minutes at a
// time.
export function holdAlerts(
  waiting: HeldAlerts,
  batches: readonly AlertBatch[],
  now: number,
  isHolding: boolean
): { shown: AlertBatch[]; waiting: HeldAlerts } {
  if (isHolding && now - (waiting.heldSince ?? now) < HOLD_LIMIT_MS) {
    const held = { held: [...waiting.held, ...batches], heldSince: waiting.heldSince ?? now }

    return { shown: [], waiting: batches.length > 0 ? held : waiting }
  }

  return { shown: [...waiting.held, ...batches], waiting: nothingHeld() }
}

// Who showed an event or a line, and when.
export type ShownMark = { at: number; by: string }

// Sessions each notice the same change: those in one repository (worktrees side by side, say) by their lists, and any
// other by its light check of other repositories. The first to show an event marks it in the store they share, as
// `host/owner/name#12 event`, so another that groups it with other events, or tells it from another list, leaves it
// out; a session repeats its own freely. A mark counts for a while before the change was raised (each batch's
// `raisedAt`, else now), and from then on, so one held for a long turn still leaves out what another session showed
// meanwhile, and a repeat raised later in the same hold is weighed from its own time; it is kept as long as that may
// take. A line is marked whole, as 1.4.0 marked it, and one of no repository not at all. One record holds
// every repository's marks, each gone once its while passes, so the store never grows.
export function freshAlerts(
  stored: unknown,
  batches: readonly AlertBatch[],
  shown: { by: string; at: number; pollMs: number }
): { fresh: AlertBatch[]; marks: Record<string, ShownMark> } {
  const window = Math.max(10 * 60_000, 2 * shown.pollMs)
  const marks = Object.fromEntries(
    Object.entries(shownMarks(stored)).filter(([, mark]) => shown.at - mark.at < window + HOLD_LIMIT_MS)
  )
  // Shown by no other session since a while before it was raised (`since`); marked as this one's now.
  const isUnshown = (key: string, since: number): boolean => {
    const mark = marks[key]
    if (mark !== undefined && mark.by !== shown.by && mark.at > since - window) {
      return false
    }
    marks[key] = { at: shown.at, by: shown.by }

    return true
  }
  const fresh = batches.flatMap((batch): AlertBatch[] => {
    const since = batch.raisedAt ?? shown.at
    if (batch.kind === "line") {
      // A line's mark is 1.4.0's, its repository as written, so a session of either version leaves the other's out.
      return !batch.repo || isUnshown(`${batch.repo.host}/${batch.repo.name} ${batch.line}`, since) ? [batch] : []
    }
    const events = batch.events.filter((alert) =>
      isUnshown(`${pullKey(batch.repo, alert.number)} ${alert.event}`, since)
    )

    return events.length > 0 ? [{ ...batch, events }] : []
  })

  return { fresh, marks }
}

function shownMarks(value: unknown): Record<string, ShownMark> {
  if (typeof value !== "object" || value === null) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, ShownMark] =>
        typeof entry[1] === "object" &&
        entry[1] !== null &&
        typeof (entry[1] as ShownMark).at === "number" &&
        typeof (entry[1] as ShownMark).by === "string"
    )
  )
}
