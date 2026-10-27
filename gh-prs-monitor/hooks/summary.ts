// Author: David Matura

import type { PullRow, PullsSnapshot, Tone } from "../types"

// The status line counts what needs the viewer: own pull requests that are ready to merge or need action, and
// reviews that wait on them. Nothing to report clears it.
export function statusSummary(snapshot: PullsSnapshot): string | undefined {
  return summaryText(summaryCounts(snapshot))
}

export type SummaryCounts = { ready: number; needsYou: number; toReview: number }

type Mark = keyof SummaryCounts

// What the summary counts, and the symbol it counts by; the pane and the printed list mark those statuses with it.
export const MARKS: Readonly<Record<Mark, string>> = { ready: "✅", needsYou: "❗", toReview: "🔍" }

// Own pull requests are ready (green) or need the author (yellow, red); someone else's waits on the viewer
// (yellow). Waiting on others is unmarked.
export function markOf(list: "mine" | "review", tone: Tone): Mark | null {
  if (list === "review") {
    return tone === "warning" ? "toReview" : null
  }
  if (tone === "success") {
    return "ready"
  }

  return tone === "error" || tone === "warning" ? "needsYou" : null
}

export function markedStatus(list: "mine" | "review", row: PullRow): string {
  const mark = markOf(list, row.status.tone)

  return mark ? `${MARKS[mark]} ${row.status.text}` : row.status.text
}

// The counts there are, each after its mark, as the pane's header and the printed list lead with them; the number
// apart, so a surface that can draws it bold.
export type SummaryMark = { mark: string; count: number }

export function summaryMarks(counts: SummaryCounts): SummaryMark[] {
  return (["ready", "needsYou", "toReview"] as const)
    .filter((mark) => counts[mark] > 0)
    .map((mark) => ({ mark: MARKS[mark], count: counts[mark] }))
}

export function markText({ mark, count }: SummaryMark): string {
  return `${mark} ${count}`
}

export function summaryCounts(snapshot: PullsSnapshot): SummaryCounts {
  const count = (list: "mine" | "review", mark: Mark): number =>
    snapshot[list].filter((row) => markOf(list, row.status.tone) === mark).length

  return { ready: count("mine", "ready"), needsYou: count("mine", "needsYou"), toReview: count("review", "toReview") }
}

export function hasAnything(counts: SummaryCounts): boolean {
  return counts.ready + counts.needsYou + counts.toReview > 0
}

// A count with what it counts, in its colour; the number apart, as in `SummaryMark`.
export type SummaryPart = SummaryMark & { label: string; tone: Tone }

// Each count there is, marked and in its colour. The status line keeps them short, as the desktop app cuts a long
// one off; the band above the prompt has room to say what ready means.
export function summaryParts(counts: SummaryCounts, length: "short" | "long"): SummaryPart[] {
  const parts: (SummaryPart | null)[] = [
    counts.ready > 0
      ? {
          mark: MARKS.ready,
          count: counts.ready,
          label: length === "short" ? "Ready" : "Ready To Merge",
          tone: "success"
        }
      : null,
    counts.needsYou > 0
      ? {
          mark: MARKS.needsYou,
          count: counts.needsYou,
          label: `Need${counts.needsYou === 1 ? "s" : ""} You`,
          tone: "warning"
        }
      : null,
    counts.toReview > 0 ? { mark: MARKS.toReview, count: counts.toReview, label: "To Review", tone: "warning" } : null
  ]

  return parts.filter((part): part is SummaryPart => part !== null)
}

// The line is plain text, with no colour and nothing to click, so a symbol marks each count and the hint says
// how to see the list.
export function summaryText(counts: SummaryCounts): string | undefined {
  const parts = summaryParts(counts, "short").map((part) => `${markText(part)} ${part.label}`)

  return parts.length > 0 ? `PRs ${parts.join(COUNT_GAP)}${COUNT_GAP}(/prs)` : undefined
}

// Two no-break spaces between the counts: VS Code draws the line as a web page does, folding plain spaces into one.
const COUNT_GAP = "\u00a0\u00a0"

// What the repository picker says of a repository: what waits for the viewer there, their own (`yours`) and the
// reviews asked of them, with the marks the header counts by (`marks`), in short for the compact view (`short`), or in
// words alone for Claude Code's own dialog (`words`); where nothing waits, how many are open there, of the viewer's or
// asking their review. None where it holds none.
export function repoCounts(
  { mine, requested, open }: { mine: number; requested: number; open: number },
  style: "marks" | "short" | "words"
): { text: string; isWaiting: boolean } | null {
  const said = (mark: string, count: number, words: string): string =>
    style === "words" ? `${count} ${words}` : `${mark} ${count}${style === "short" ? "" : ` ${words}`}`
  const waits = [
    ...(mine > 0 ? [said(MARKS.needsYou, mine, "yours")] : []),
    ...(requested > 0 ? [said(MARKS.toReview, requested, "to review")] : [])
  ]
  if (waits.length > 0) {
    return { text: waits.join(style === "words" ? " · " : "  "), isWaiting: true }
  }

  return open > 0 ? { text: `${open} open`, isWaiting: false } : null
}
