// Author: David Matura

import type { Activity, EndedPull, PullRow, PullSignals, PullsSnapshot, PullStack } from "../types"
import type { ClosedState } from "./ended"
import { isCiFailing, isCiRunning } from "./pull-status"
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
  const present = new Set([...after.mine, ...after.review].map((row) => row.number))

  return [...before.mine, ...before.review].filter((row) => !present.has(row.number))
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
// each change in turn.
export function alertLines(alerts: readonly Alert[]): string[] {
  return groupByPull(alerts).map((group) => {
    const [first] = group

    return alertLine(
      first!.symbol,
      first!,
      group.map((alert) => alert.event).join(", "),
      group.find((alert) => alert.by)?.by ?? undefined
    )
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

    // Passing counts after running, or after failing, as a re-run that ran from start to end between two refreshes.
    if (isCiFailing(now.ci) && !isCiFailing(was.ci)) {
      add("ci", "✗", "CI failed")
    } else if (now.ci === "SUCCESS" && (isCiRunning(was.ci) || isCiFailing(was.ci))) {
      add("ci", "✓", "CI passed")
    }
    // Unknown mergeability in between is skipped by what was known before it, so a recompute after a base push
    // does not alert again, and a conflict that push brought does.
    const wasConflicting = was.isConflicting ?? was.lastConflict ?? null
    if (now.isConflicting === true && wasConflicting === false) {
      add("conflicts", "⚠", "merge conflicts")
    }

    const newReviews = Object.entries(now.reviews).filter(([login, mark]) => was.reviews[login]?.at !== mark.at)
    for (const [login, mark] of newReviews) {
      const verdict = REVIEW_VERDICTS[mark.state]
      if (verdict && !mark.isBot) {
        add("reviews", verdict.symbol, `${verdict.verb} by ${login}`)
      }
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
    if (row.signals.isRequested && !was?.isRequested && (was !== undefined || !isRequestsCut)) {
      return [{ kind: "reviewRequests", ...pull, by: row.author, symbol: "⌕", event: "review requested" }]
    }
    if (was && row.signals.hasCommitsSinceMyReview && !was.hasCommitsSinceMyReview) {
      return [{ kind: "newCommits", ...pull, by: null, symbol: "↻", event: "new commits since your review" }]
    }

    return []
  })
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

// What a refresh announces. Coming back, what changed while the person was away is told once, pointing to the pane
// that lists it, even by a refresh that would alert: an alert per change would bury them; with the pane open, its
// marks tell it. Otherwise only the refreshes nobody asked for interrupt, a line per pull request. Null announces
// nothing; an empty list announces nothing new but lets alerts held back for a turn through.
export function refreshAlerts(
  changes: readonly Alert[],
  before: PullsSnapshot | null,
  after: PullsSnapshot,
  kind: RefreshKind
): string[] | null {
  if (kind.isReturning) {
    if (!before || changes.length === 0 || kind.isListShown) {
      return null
    }
    const pullCount = new Set(changes.map((change) => change.number)).size

    return [awayLine(pullCount, lookedAt(before.fetchedAt, after.fetchedAt))]
  }

  return kind.isAlerting ? alertLines(changes) : null
}

// One line: the symbol of the kind of change, the pull request, and what happened. The title is there so a number
// alone need not be remembered, cut at a word to keep the toast to one line.
export function alertLine(
  symbol: string,
  pull: { number: number; title: string },
  event: string,
  author?: string
): string {
  const by = author ? ` (${author})` : ""

  return `${symbol} #${pull.number} ${shortTitle(pull.title)}${by} — ${event}`
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

// The toast stack draws only its newest few, so a refresh never sends more than three toasts: past that, two
// alerts and a count of the rest, which the pane lists.
export function toastsFor(alerts: readonly string[], limit = 3): string[] {
  if (alerts.length <= limit) {
    return [...alerts]
  }
  const shown = alerts.slice(0, limit - 1)

  return [...shown, `${alerts.length - shown.length} more pull request changes, see /prs`]
}

// A showing of alerts as one system notification: its first alert, and how many came with it, which the toasts and the
// pane tell.
export function systemNotificationText(alerts: readonly string[]): string {
  const [first = "", ...rest] = alerts

  return rest.length === 0 ? first : `${first} (${rest.length} more)`
}

// Should a turn's end never be heard, held alerts still show after this long.
const HOLD_LIMIT_MS = 15 * 60_000

// Alerts waiting for the running turns to end, from when the first of them waited, and which of them are pull request
// changes: the only ones a system notification carries, not a session's first summary or a cleanup's note.
export type HeldAlerts = { held: string[]; heldSince: number | null; changes: string[] }

export function nothingHeld(): HeldAlerts {
  return { held: [], heldSince: null, changes: [] }
}

// While a turn runs, alerts wait for it to finish, so they do not cover what is being read; then they show together.
// Held this long, they show now, and holding starts over: a long turn holds what comes later too, a quarter of an hour
// at a time.
export function holdAlerts(
  waiting: HeldAlerts,
  lines: readonly string[],
  now: number,
  isHolding: boolean,
  areChanges: boolean
): { shown: string[]; changes: string[]; waiting: HeldAlerts } {
  const changes = areChanges ? lines : []
  if (isHolding && now - (waiting.heldSince ?? now) < HOLD_LIMIT_MS) {
    const held = {
      held: [...waiting.held, ...lines],
      heldSince: waiting.heldSince ?? now,
      changes: [...waiting.changes, ...changes]
    }

    return { shown: [], changes: [], waiting: lines.length > 0 ? held : waiting }
  }

  return {
    shown: [...waiting.held, ...lines],
    changes: [...waiting.changes, ...changes],
    waiting: nothingHeld()
  }
}

// Who showed an alert line, and when.
export type ShownMark = { at: number; by: string }

// Sessions in one repository (worktrees side by side, say) each notice the same change. The first to show it marks
// it in the store they share, and the others leave it out for a while; a session repeats its own freely. One record
// holds every repository's marks, each gone once its while passes, so the store never grows.
export function freshAlerts(
  stored: unknown,
  lines: readonly string[],
  shown: { repo: string; by: string; at: number; pollMs: number }
): { fresh: string[]; marks: Record<string, ShownMark> } {
  const window = Math.max(10 * 60_000, 2 * shown.pollMs)
  const markOf = (line: string): string => `${shown.repo} ${line}`
  const marks = Object.fromEntries(Object.entries(shownMarks(stored)).filter(([, mark]) => shown.at - mark.at < window))
  const fresh = lines.filter((line) => {
    const mark = marks[markOf(line)]

    return mark === undefined || mark.by === shown.by
  })
  for (const line of fresh) {
    marks[markOf(line)] = { at: shown.at, by: shown.by }
  }

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
