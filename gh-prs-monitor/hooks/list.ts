// Author: David Matura

import type { Badge, MergedPull, PullRow, PullsSnapshot } from "../types"
import { groupByPull } from "./alerts"
import type { SinceLastLook } from "./alerts"
import type { RepoRef } from "./gh"
import { isOnBranch } from "./pulls"
import { markOf, MARKS, summaryCounts, summaryMarks } from "./summary"
import { detailsWithTicket } from "./tickets"
import type { TicketLinks } from "./tickets"
import { lookedAt } from "./when"

// Where the printed list links to: the repository's pull requests, and a pull request by number (one that left the
// lists has no row to carry its address).
export type ListLinks = { pulls: string; pull: (number: number) => string }

export function linksOf(repo: RepoRef): ListLinks {
  const base = `https://${repo.host}/${repo.name}`

  return { pulls: `${base}/pulls`, pull: (number) => `${base}/pull/${number}` }
}

// What the two lists are called, in the pane and in the list /prs prints.
export const LIST_TITLES = { mine: "Your Pull Requests", review: "Waiting On Your Review" } as const

// Said under the viewer's own list when the Hide drafts setting leaves drafts out of it.
export function hiddenDraftsNote(count: number): string | null {
  return count > 0 ? `${count} draft${count === 1 ? "" : "s"} hidden` : null
}

// Between a row's details: some hold commas of their own ("approved: ann, bob 2h ago").
export const DETAIL_SEPARATOR = "·"

// In front of the number of the pull request whose branch the session's checkout is on; the pane draws it bold and
// green.
export const BRANCH_MARK = "●"

// What the pane and the printed list say with nothing in either list.
export const NOTHING_OPEN = "Nothing open and nothing waiting on you."

// What each list says when it holds nothing.
export const EMPTY_LISTS = {
  mine: "No open pull requests of yours here.",
  review: "Nothing waits on your review."
} as const

// The same list on GitHub, for when it holds more than the searches here return.
const LIST_QUERIES = { mine: "is:pr is:open author:@me", review: "is:pr is:open involves:@me -author:@me" }

export function fullListUrl(repoUrl: string, list: "mine" | "review"): string {
  return `${repoUrl}/pulls?q=${encodeURIComponent(LIST_QUERIES[list])}`
}

export const CUT_NOTE = "Only the most recently updated are listed."

// The pull requests as markdown, for where nothing draws the pane (no surface attached, or an app that places no
// panes): a table per list with each number a link, led by what changed since the last look when there is one.
export function listText(
  snapshot: PullsSnapshot,
  since: SinceLastLook | null = null,
  links: ListLinks | null = null,
  branch: string | null = null,
  now: number = snapshot.fetchedAt,
  tickets: TicketLinks | null = null
): string {
  const repo = escapeMarkdown(snapshot.repo)
  // As the pane's header: the repository, the counts the status line has, and when the list was read, with its day
  // where that isn't today (`now`).
  const heading = [
    `**${links ? `[${repo}](${links.pulls})` : repo}**`,
    ...summaryMarks(summaryCounts(snapshot)).map(({ mark, count }) => `${mark} **${count}**`),
    `updated ${lookedAt(snapshot.fetchedAt, now)}`
  ].join(` ${DETAIL_SEPARATOR} `)
  const isEmpty = snapshot.mine.length === 0 && snapshot.review.length === 0 && snapshot.hiddenDrafts === 0

  return [
    heading,
    ...(since ? ["", ...sinceMarkdown(since, links)] : []),
    "",
    ...(isEmpty
      ? [`_${NOTHING_OPEN}_`]
      : [
          ...listTable(snapshot, LIST_TITLES.mine, "mine", branch, tickets),
          "",
          ...listTable(snapshot, LIST_TITLES.review, "review", branch, tickets)
        ])
  ].join("\n")
}

// A row's ticket leads its details, as in the pane, where the repository's links find one.
function listTable(
  snapshot: PullsSnapshot,
  title: string,
  list: "mine" | "review",
  branch: string | null,
  tickets: TicketLinks | null
): string[] {
  const rows = snapshot[list]
  const heading = `**${title}** (${rows.length})`
  const hidden = list === "mine" ? hiddenDraftsNote(snapshot.hiddenDrafts) : null
  const hiddenLine = hidden ? ["", `_${hidden}_`] : []
  // An empty list is one line, as in the pane, which says drafts are hidden where they are.
  if (rows.length === 0) {
    return [`${heading} — _${hidden ?? EMPTY_LISTS[list]}_`]
  }
  const cut = [
    ...(snapshot.isCut[list] && snapshot.url
      ? ["", `_${CUT_NOTE}_ [More on GitHub](${fullListUrl(snapshot.url, list)})`]
      : []),
    ...hiddenLine
  ]

  return [
    heading,
    "",
    "| Pull request | Status | Details |",
    "| --- | --- | --- |",
    ...rows.map((row) => {
      const current = isOnBranch(row, branch) ? `${escapeMarkdown(BRANCH_MARK)} ` : ""
      const pull = `${current}${pullLink(row.number, row.url)} ${escapeMarkdown(row.title)}`
      const mark = markOf(list, row.status.tone)
      const status = `${mark ? `${MARKS[mark]} ` : ""}${badgeLink(row.status)}`
      const details = detailsWithTicket(row, tickets).map(badgeLink).join(` ${DETAIL_SEPARATOR} `)

      return `| ${pull} | ${status} | ${details} |`
    }),
    ...cut
  ]
}

// What changed, as a table like the lists: one row per pull request, its changes in turn after the first one's
// symbol.
function sinceMarkdown(since: SinceLastLook, links: ListLinks | null): string[] {
  if (since.changes.length === 0) {
    return [`_Nothing new since ${since.at}_`]
  }

  return [
    `**Since You Last Looked** (${since.at})`,
    "",
    "| Pull request | What changed |",
    "| --- | --- |",
    ...groupByPull(since.changes).map((group) => {
      const [first] = group
      const by = group.find((alert) => alert.by)?.by
      const pull = `${pullLink(first!.number, links?.pull(first!.number) ?? "")} ${escapeMarkdown(first!.title)}`
      const events = group.map((alert) => alert.event).join(` ${DETAIL_SEPARATOR} `)

      return `| ${pull}${by ? ` (${escapeMarkdown(by)})` : ""} | ${first!.symbol} ${escapeMarkdown(events)} |`
    })
  ]
}

// A status or detail as a link to where it is dealt with, when it has one: markdown draws links, so even a
// green check leads to its runs.
// Parentheses in an address would end its link early, as a ticket tracker's may hold them.
function badgeLink(badge: Badge): string {
  const text = escapeMarkdown(badge.text)

  return badge.href ? `[${text}](${badge.href.replaceAll("(", "%28").replaceAll(")", "%29")})` : text
}

function pullLink(number: number, url: string): string {
  return url ? `[#${number}](${url})` : `#${number}`
}

// Titles and names are people's text: a `|` would end a table cell, a `*` or `_` start emphasis.
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|~]/g, "\\$&")
}

// A panel's rows: its open pull requests, and in your own list those merged a moment ago, back where they were.
export type ListEntry = { kind: "open"; row: PullRow } | { kind: "merged"; pull: MergedPull }

export function ownEntries(rows: PullRow[], merged: MergedPull[]): ListEntry[] {
  // A row merged a moment ago shows merged, also before the list it was read in leaves it out: one key, one row.
  const isMerged = new Set(merged.map((pull) => pull.number))
  const entries: ListEntry[] = rows.filter((row) => !isMerged.has(row.number)).map((row) => ({ kind: "open", row }))
  // Each place was taken in the list as drawn when it merged, so the earlier ones go back first.
  for (const pull of [...merged].sort((one, other) => one.index - other.index)) {
    entries.splice(Math.min(pull.index, entries.length), 0, { kind: "merged", pull })
  }

  return entries
}

export function entryNumber(entry: ListEntry): number {
  return entry.kind === "open" ? entry.row.number : entry.pull.number
}
