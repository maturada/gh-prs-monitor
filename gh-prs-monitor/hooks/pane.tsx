// Author: David Matura

import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, RenderElement, TextProps } from "claude-code"

import type { Activity, Badge, CiMark, MergedPull, PullAction, PullRow, PullsSnapshot } from "../types"
import { ACTION_LABELS } from "./actions"
import { isOnBranch, stackText } from "./pulls"
import { CREATE_PR } from "./create-flow"
import type { PullToOpen } from "./create-flow"
import { noteEvents } from "./alerts"
import { ago, checkingAgain, elapsed, lookedAt } from "./when"
import { BACK_MARK, buttonKey, rowKey } from "./keys"
import { buttonGaps, isTerminal } from "./layout"
import {
  BRANCH_MARK,
  CUT_NOTE,
  DETAIL_SEPARATOR,
  EMPTY_LISTS,
  fullListUrl,
  hiddenDraftsNote,
  entryNumber,
  LIST_TITLES,
  NOTHING_OPEN,
  ownEntries
} from "./list"
import type { ListEntry } from "./list"
import { markedStatus, MARKS, markText, summaryCounts, summaryMarks, summaryParts } from "./summary"
import type { SummaryCounts, SummaryMark } from "./summary"

// The elements every surface draws, so one tree serves them all.
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
}

export type PaneView = {
  snapshot: PullsSnapshot | null
  problem: string | null
  // How often checks run by themselves while a problem stands, in minutes, or null where none will.
  retryMinutes: number | null
  // The time now, for how old a list kept over a problem is.
  now: number
  isLoading: boolean
  // What is under way, by what it marks (`Mark`): a pull request's number, or Create PR.
  busy: Record<string, string>
  // Changes noticed lately, until their ✕, a row's button or closing the pane marks them seen, or they expire.
  activity: Activity[]
  // The branch this session's checkout is on, whose pull request is marked; and the pull request Create PR would open
  // from it, where it has none (`pullToOpen`).
  branch: string | null
  toOpen: PullToOpen | null
  // Pull requests merged from the pane a moment ago, shown where they were.
  merged: MergedPull[]
  // One line per pull request, or two in a narrow panel: its number, title and status.
  isCompact: boolean
  // The width the pane's body has, in columns.
  columns: number
  // What draws the pane: the terminal, or an app such as the desktop one.
  surface: string
}

// A row's press names its pull request by number: a button drawn again unchanged keeps its first closure
// (`stableButtons`), so the press looks the row up as the list holds it then.
export type PaneActions = {
  refresh: () => void
  act: (action: PullAction, pullNumber: number) => void
  create: () => void
  // Marks what changed on the pull request as seen, which takes its note away.
  markSeen: (pullNumber: number) => void
  toggleCompact: () => void
}

// Wide enough for two panels of readable rows next to each other, as a pane inline at full width is; a pane
// docked beside the transcript stacks them, a line apart so their borders don't meet. An empty list takes a line
// of its own instead, and leaves the full width to the other.
const SIDE_BY_SIDE_COLUMNS = 120
const PANEL_GAP = 2

type Group = "mine" | "review"

// `backRow`: the row a question's close is putting the window back on (`backMark`), or null.
export function drawPane(kit: Kit, view: PaneView, actions: PaneActions, backRow: number | null): RenderElement {
  const { Box } = kit
  const { snapshot, problem } = view

  return (
    <Box flexDirection="column" gap={1}>
      {header(kit, view, actions)}
      {problem ? problemBox(kit, problem, view, actions) : null}
      {snapshot ? body(kit, snapshot, view, actions) : problem ? null : centred(kit, "loading", waiting(view))}
      {backRow === null ? null : backMark(kit, backRow)}
    </Box>
  )
}

// The mark a question's close puts the window back on (`BACK_MARK`). Out of the flow, it takes no room and moves
// nothing; it is empty, so it shows nothing, and a row high so a surface measures where it is.
function backMark(kit: Kit, row: number): RenderElement {
  const { Box } = kit

  return <Box key={BACK_MARK} position="absolute" top={row} left={0} width={1} height={1} />
}

// Before the first list: that it is checking while a load runs, or else what to press.
function waiting(view: PaneView): string {
  return view.isLoading ? "Checking GitHub for pull requests…" : "Press Refresh to check GitHub for pull requests."
}

// A line on its own, centred, one line under the header from the pane's own gap as everything under it is: the line
// before the first list, or a list with nothing in it.
function centred(kit: Kit, key: string, text: string): RenderElement {
  const { Box, Text } = kit

  return (
    <Box key={key} justifyContent="center">
      <Text dimColor wrap="wrap">
        {text}
      </Text>
    </Box>
  )
}

// Why GitHub can't be asked, framed in the warning colour above whatever list there is, with when that list is from,
// whether checks come back by themselves, and Retry.
function problemBox(kit: Kit, problem: string, view: PaneView, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const notes = [
    view.snapshot ? `The list below is from ${lookedAt(view.snapshot.fetchedAt, view.now)}.` : null,
    view.retryMinutes === null ? null : checkingAgain(view.retryMinutes)
  ].filter((note) => note !== null)

  return (
    <Box key="problem" flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
      <Box flexDirection="column">
        <Text bold color="warning" wrap="wrap">
          ⚠ Can't check pull requests
        </Text>
        <Text wrap="wrap">{problem}</Text>
        {notes.length > 0 ? (
          <Text dimColor wrap="wrap">
            {notes.join(" ")}
          </Text>
        ) : null}
      </Box>
      <Box>
        <Button key="retry" label="Retry" variant="primary" onPress={actions.refresh} />
      </Box>
    </Box>
  )
}

// A bordered box's border and padding, and the terminal's `[ label ]` around a button's label, in columns.
const BOX_CHROME = 4
const BUTTON_CHROME = 4
const HEADER_GAP = 2
const WHEN_COLUMNS = "updated 00:00".length
const REFRESH_LABEL = "Refresh"

// The repository (a link to its pull requests), the status line's counts, when the list was read, the switch
// between the full and the compact view, and Refresh, which `r` presses while the pane has the keyboard, in a box
// of their own above the panels.
function header(kit: Kit, view: PaneView, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link } = kit
  const { snapshot } = view
  // Before the first list, with no problem, the line under the header says it is checking, so the header doesn't.
  const isBodyChecking = !snapshot && !view.problem
  // With its day where that isn't today, as the problem box says when the list is from.
  const updated = snapshot ? `updated ${lookedAt(snapshot.fetchedAt, view.now)}` : ""
  const when = view.isLoading ? (isBodyChecking ? "" : "refreshing…") : updated
  const counts = snapshot ? summaryCounts(snapshot) : null
  const marks = counts ? summaryMarks(counts) : []

  const name = snapshot?.repo ?? "Pull Requests"
  const viewLabel = view.isCompact ? "Full" : "Compact"
  const buttonsWidth = [viewLabel, REFRESH_LABEL].reduce(
    (sum, label) => sum + label.length + BUTTON_CHROME,
    buttonGaps(view.surface).columnGap
  )
  // The counts are one piece, never parted, as a narrow layout would leave a count alone; the name wraps, and where
  // the two don't fit side by side the counts go under it whole. The time may go under them. Where the name and
  // counts, or the time, don't fit whole beside the buttons, the buttons go on a line of their own under them. The
  // time as its widest, so the header keeps its shape while "refreshing…" stands in for it.
  const countsWidth = columnsOf(marks.map(markText).join("  "))
  const titleWidth = name.length + (marks.length > 0 ? 2 + countsWidth : 0)
  const infoWidth = Math.max(titleWidth, WHEN_COLUMNS, updated.length)
  const isStacked = view.columns < BOX_CHROME + infoWidth + HEADER_GAP + buttonsWidth

  return (
    <Box
      key="header"
      flexDirection={isStacked ? "column" : "row"}
      justifyContent="space-between"
      columnGap={HEADER_GAP}
      borderStyle="round"
      borderDimColor
      paddingX={1}
    >
      <Box columnGap={2} flexWrap="wrap" flexShrink={1}>
        <Box key="header-title" columnGap={2} flexWrap="wrap" flexShrink={1} minWidth={0}>
          <Box flexShrink={1} minWidth={0}>
            <Text bold wrap="wrap">
              {snapshot?.url ? <Link href={`${snapshot.url}/pulls`} label={snapshot.repo} /> : name}
            </Text>
          </Box>
          {marks.length > 0 ? (
            <Box flexShrink={0}>
              <Text>{marks.flatMap((mark, index) => [index > 0 ? "  " : "", ...boldCount(kit, mark)])}</Text>
            </Box>
          ) : null}
        </Box>
        {when ? <Text dimColor>{when}</Text> : null}
      </Box>
      <Box
        key="header-buttons"
        {...buttonGaps(view.surface)}
        flexShrink={0}
        flexWrap="wrap"
        {...(isStacked && !isTerminal(view.surface) ? { marginTop: 1 } : {})}
      >
        <Button key="view" label={viewLabel} dimColor onPress={actions.toggleCompact} />
        <Button key="refresh" label={REFRESH_LABEL} hotkey="r" dimColor onPress={actions.refresh} />
      </Box>
    </Box>
  )
}

// Two panels, or, with nothing in either and Create PR neither offered nor at work, one line that says so, centred
// under the header; and under them the pull requests that merged or closed lately.
function body(kit: Kit, snapshot: PullsSnapshot, view: PaneView, actions: PaneActions): RenderElement {
  const { Box } = kit
  const isEmpty = GROUPS.every((group) => entriesOf(group, snapshot, view).length === 0)
  const lists =
    isEmpty && snapshot.hiddenDrafts === 0 && view.toOpen === null && !view.busy[CREATE_PR]
      ? centred(kit, "empty", NOTHING_OPEN)
      : panels(kit, snapshot, view, actions)
  const ended = endedNotes(kit, snapshot, view, actions)

  return ended ? (
    <Box key="body" flexDirection="column" gap={1}>
      {lists}
      {ended}
    </Box>
  ) : (
    lists
  )
}

// Pull requests that merged or closed lately, by someone else, which left the lists: under them, a line each, as a
// row's note says what changed (`recentChanges`), the title dimmed as done, with when and a ✕ that marks it seen; they
// go as notes go. One that came back into a list is noted on its row instead.
function endedNotes(kit: Kit, snapshot: PullsSnapshot, view: PaneView, actions: PaneActions): RenderElement | null {
  const { Box, Text, Button, Link } = kit
  const listed = new Set([...snapshot.mine, ...snapshot.review].map((row) => row.number))
  const byPull = new Map<number, Activity[]>()
  for (const entry of view.activity) {
    if (entry.ended && !listed.has(entry.number)) {
      byPull.set(entry.number, [...(byPull.get(entry.number) ?? []), entry])
    }
  }
  if (byPull.size === 0) {
    return null
  }
  const since = Math.min(...[...byPull.values()].flat().map((entry) => entry.since))
  // The symbol and the number in a column as wide as the widest, so the titles line up and the time and the ✕, where
  // they wrap, go under the text rather than the number. An app lays out by pixels, where cells don't line up.
  const labelColumns = 2 + Math.max(...[...byPull.keys()].map((number) => `#${number}`.length))
  const column = isTerminal(view.surface) ? { width: labelColumns } : {}

  return (
    <Box key="ended" flexDirection="column" paddingX={1}>
      <Text dimColor wrap="wrap">{`Merged or closed since ${lookedAt(since, snapshot.fetchedAt)}`}</Text>
      {[...byPull].map(([number, entries]) => {
        const latest = entries.at(-1)!
        const when = noteTime(latest, snapshot.fetchedAt)
        const label = `#${number}`

        return (
          <Box key={`ended-${number}`} gap={1}>
            <Box gap={1} flexShrink={0} {...column}>
              <Text color="suggestion" italic>
                {latest.symbol}
              </Text>
              {snapshot.url ? <Link href={`${snapshot.url}/pull/${number}`} label={label} /> : <Text>{label}</Text>}
            </Box>
            <Box columnGap={2} flexWrap="wrap" flexShrink={1} minWidth={0}>
              <Text wrap="wrap">
                <Text dimColor>{latest.ended?.title ?? ""}</Text>
                <Text color="suggestion" italic>{` — ${noteEvents(entries).join(`\u00a0${DETAIL_SEPARATOR} `)}`}</Text>
              </Text>
              <Box columnGap={2} flexShrink={0}>
                {when ? <Text dimColor>{when}</Text> : null}
                <Button
                  key={`seen-${number}`}
                  label={SEEN_LABEL}
                  plain
                  dimColor
                  onPress={() => actions.markSeen(number)}
                />
              </Box>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

const GROUPS = ["mine", "review"] as const

function entriesOf(group: Group, snapshot: PullsSnapshot, view: PaneView): ListEntry[] {
  return group === "mine"
    ? ownEntries(snapshot.mine, view.merged)
    : snapshot.review.map((row) => ({ kind: "open", row }))
}

function panels(kit: Kit, snapshot: PullsSnapshot, view: PaneView, actions: PaneActions): RenderElement {
  const { Box } = kit
  const isSideBySide =
    view.columns >= SIDE_BY_SIDE_COLUMNS && GROUPS.every((group) => entriesOf(group, snapshot, view).length > 0)
  const width = isSideBySide ? Math.floor((view.columns - PANEL_GAP) / 2) : undefined

  return (
    <Box key="panels" flexDirection={isSideBySide ? "row" : "column"} gap={isSideBySide ? PANEL_GAP : 1}>
      {GROUPS.map((group) =>
        entriesOf(group, snapshot, view).length > 0
          ? panel(kit, group, snapshot, width, view, actions)
          : emptyPanel(kit, group, snapshot, view, actions)
      )}
    </Box>
  )
}

// A list with nothing in it, its title and what it would hold on one line, and in your own Create PR.
function emptyPanel(
  kit: Kit,
  group: Group,
  snapshot: PullsSnapshot,
  view: PaneView,
  actions: PaneActions
): RenderElement {
  const { Box, Text } = kit
  const hidden = group === "mine" ? hiddenDraftsNote(snapshot.hiddenDrafts) : null

  return (
    <Box
      key={`panel-${group}`}
      borderStyle="round"
      borderDimColor
      paddingX={1}
      columnGap={2}
      rowGap={buttonGaps(view.surface).rowGap}
      flexWrap="wrap"
      justifyContent="space-between"
    >
      <Box columnGap={2} flexWrap="wrap" flexShrink={1}>
        {panelTitle(kit, group, 0)}
        {/* Drafts the setting hides are open pull requests of yours: the panel says they are hidden instead. */}
        <Text dimColor>{hidden ?? EMPTY_LISTS[group]}</Text>
      </Box>
      {group === "mine" ? createButton(kit, view, actions) : null}
    </Box>
  )
}

// A panel's title and how many it holds.
function panelTitle(kit: Kit, group: Group, count: number): RenderElement {
  const { Box, Text } = kit

  return (
    <Box gap={1}>
      <Text bold>{LIST_TITLES[group]}</Text>
      <Text dimColor>{String(count)}</Text>
    </Box>
  )
}

// Create PR, where the session's branch has no pull request: the button, or what is under way since it was pressed.
function createButton(kit: Kit, view: PaneView, actions: PaneActions): RenderElement | null {
  const { Button, Text } = kit
  const busy = view.busy[CREATE_PR]
  if (busy) {
    return <Text dimColor>{busy}</Text>
  }

  return view.toOpen ? <Button key={CREATE_PR} label="Create PR" onPress={actions.create} /> : null
}

function panel(
  kit: Kit,
  group: Group,
  snapshot: PullsSnapshot,
  width: number | undefined,
  view: PaneView,
  actions: PaneActions
): RenderElement {
  const { Box, Text, Link } = kit
  const hidden = group === "mine" ? hiddenDraftsNote(snapshot.hiddenDrafts) : null
  const rows = snapshot[group]
  const entries = entriesOf(group, snapshot, view)
  const frame = rowFrame(group, entries, view, (width ?? view.columns) - BOX_CHROME)

  return (
    <Box
      key={`panel-${group}`}
      flexDirection="column"
      borderStyle="round"
      borderDimColor
      paddingX={1}
      {...(width === undefined ? {} : { width })}
    >
      <Box
        key="title"
        columnGap={2}
        rowGap={buttonGaps(view.surface).rowGap}
        flexWrap="wrap"
        justifyContent="space-between"
      >
        {panelTitle(kit, group, rows.length)}
        {group === "mine" ? createButton(kit, view, actions) : null}
      </Box>
      {rule(kit, "rule-title", view)}
      {entries.flatMap((entry, index) => [
        // Compact rows, a line or two each, need nothing between them.
        ...(index > 0 && frame.layout === "full" ? [rule(kit, `rule-${entryNumber(entry)}`, view)] : []),
        entry.kind === "open"
          ? pullRow(kit, group, entry.row, frame, view, actions)
          : mergedRow(kit, entry.pull, frame, view)
      ])}
      {snapshot.isCut[group] && snapshot.url
        ? [
            rule(kit, "rule-cut", view),
            <Box key="cut" columnGap={1} flexWrap="wrap">
              <Text dimColor>{CUT_NOTE}</Text>
              <Link href={fullListUrl(snapshot.url, group)} label="More on GitHub" />
            </Box>
          ]
        : null}
      {hidden ? (
        <Box key="hidden-drafts" marginTop={1}>
          <Text dimColor>{hidden}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// How a panel draws its rows: in full, or in the compact view on one line each (number, title, status) where the
// panel leaves a readable title beside its longest status, and on two otherwise (the status under the title).
// Compact rows need nothing between them.
type RowLayout = "full" | "line" | "lines"

// What every row of a panel shares, so they line up as in a table: the column their lines start in, past the
// widest number and the gutter for the branch mark, when a row has one; and the layout.
type RowFrame = {
  indent: number
  gutter: number
  layout: RowLayout
  columns: number
}

// The branch mark and a space in front of the number, as `git branch` marks the current branch.
const MARK_GUTTER = 2
const MIN_TITLE_COLUMNS = 20
// The column a stacked row's stack keeps from its status, past the one between them all, so the two read apart.
const STACK_GAP = 1

function rowFrame(group: Group, entries: ListEntry[], view: PaneView, rowColumns: number): RowFrame {
  const isMarking = entries.some((entry) => entry.kind === "open" && isOnBranch(entry.row, view.branch))
  const gutter = isMarking ? MARK_GUTTER : 0
  const indent = gutter + Math.max(0, ...entries.map((entry) => `#${entryNumber(entry)}`.length)) + 1
  // A compact row shows what is under way in place of its status, so that counts as one too.
  const statusColumns = Math.max(
    0,
    ...entries.map((entry) =>
      entry.kind === "open"
        ? columnsOf(view.busy[String(entry.row.number)] ?? markedStatus(group, entry.row))
        : columnsOf(MERGED_STATUS)
    )
  )
  // The title line holds the number's column, the title with a changed row's dot after a no-break space, a spacer, a
  // stacked row's stack and the status, a column apart each and two between those two (`titleLine`).
  const isAnyChanged = entries.some(
    (entry) => entry.kind === "open" && view.activity.some((change) => change.number === entry.row.number)
  )
  // A stacked row's stack, as "stack #30 2/4", before the status.
  const stackColumns = Math.max(
    0,
    ...entries.map((entry) => (entry.kind === "open" && entry.row.stack ? columnsOf(stackText(entry.row.stack)) : 0))
  )
  const titleColumns =
    rowColumns -
    (indent - 1) -
    3 -
    (isAnyChanged ? CHANGED_COLUMNS : 0) -
    (stackColumns > 0 ? stackColumns + STACK_GAP + 1 : 0) -
    statusColumns
  const layout = !view.isCompact ? "full" : titleColumns >= MIN_TITLE_COLUMNS ? "line" : "lines"

  return { indent, gutter, layout, columns: rowColumns }
}

// The columns a text of ours takes in the terminal: one a character, two for each mark (✅ ❗ 🔍), which appears in
// it at most once.
function columnsOf(text: string): number {
  return [...text].length + Object.values(MARKS).filter((mark) => text.includes(mark)).length
}

// The line under a panel's title and between its rows. Boxes draw only whole borders, so the terminal gets a run of
// rule characters as wide as the pane, clipped to the panel's width. An app neither clips the run (the desktop app
// wraps it onto a second line) nor draws an empty bordered box as a line, so there the rows are spaced apart, each a
// card.
function rule(kit: Kit, key: string, view: PaneView): RenderElement {
  const { Box, Text } = kit

  return isTerminal(view.surface) ? (
    <Box key={key} height={1} overflow="hidden">
      <Text dimColor>{"─".repeat(view.columns)}</Text>
    </Box>
  ) : (
    <Box key={key} marginTop={1} />
  )
}

// A row: the title line, its status, the facts under it, its buttons, and what changed lately. A compact row keeps
// the title and the status (`compactRow`): a dot after the title says something changed, a stacked one's stack shows
// before the status, and what is under way shows in place of the status.
function pullRow(
  kit: Kit,
  group: Group,
  row: PullRow,
  frame: RowFrame,
  view: PaneView,
  actions: PaneActions
): RenderElement {
  const { Box, Text } = kit
  const { indent } = frame
  const activity = view.activity.filter((entry) => entry.number === row.number)
  const titleParts = {
    number: row.number,
    url: row.url,
    title: row.title,
    isDim: row.isDraft,
    isOnBranch: isOnBranch(row, view.branch),
    isChanged: activity.length > 0,
    stack: row.stack ? stackText(row.stack) : null
  }
  if (frame.layout !== "full") {
    const busy = view.busy[String(row.number)]

    return compactRow(kit, titleParts, frame, busy ? <Text dimColor>{busy}</Text> : statusText(kit, group, row))
  }

  return card(
    kit,
    view,
    row.number,
    <Box key={rowKey(row.number)} flexDirection="column" hover={{ scope: rowKey(row.number) }}>
      {titleLine(kit, titleParts, frame, null)}
      <Box key="status" paddingLeft={indent}>
        {statusText(kit, group, row)}
      </Box>
      {factsLine(kit, view, frame, row.details)}
      {actionsFor(kit, row, view, actions, frame)}
      {activity.length > 0 && view.snapshot
        ? recentChanges(kit, row, activity, { indent, now: view.snapshot.fetchedAt }, actions)
        : null}
    </Box>
  )
}

// The facts under the status, parted by dots: a line of their own, so wherever a narrow pane breaks it, the
// status keeps its place. A fact moves to the next line whole, and only one longer than a line wraps within itself.
// The lines follow each other with no gap, which the desktop app would draw as a wide one.
function factsLine(kit: Kit, view: PaneView, frame: RowFrame, facts: Badge[]): RenderElement | null {
  const { Box } = kit
  if (facts.length === 0) {
    return null
  }
  // The room past the number column, which a terminal's detail is held to (`detailText`); an app wraps its details
  // itself.
  const room = isTerminal(view.surface) ? frame.columns - frame.indent : null

  return (
    <Box key="facts" paddingLeft={frame.indent} columnGap={1} flexWrap="wrap">
      {facts.map((fact, index) => detailText(kit, fact, index < facts.length - 1, room))}
    </Box>
  )
}

// A pull request merged from the pane a moment ago: done, so dimmed, and said in the colour GitHub gives a merge.
function mergedRow(kit: Kit, pull: MergedPull, frame: RowFrame, view: PaneView): RenderElement {
  const { Box, Text } = kit
  const titleParts = {
    number: pull.number,
    url: pull.url,
    title: pull.title,
    isDim: true,
    isOnBranch: false,
    isChanged: false,
    stack: null
  }
  const status = (
    <Text bold color="merged">
      {MERGED_STATUS}
    </Text>
  )
  if (frame.layout !== "full") {
    return compactRow(kit, titleParts, frame, status)
  }

  return card(
    kit,
    view,
    pull.number,
    <Box key={rowKey(pull.number)} flexDirection="column" hover={{ scope: rowKey(pull.number) }}>
      {titleLine(kit, titleParts, frame, null)}
      <Box key="status" paddingLeft={frame.indent} gap={1}>
        {status}
        <Text dimColor>{`into ${pull.base}`}</Text>
      </Box>
    </Box>
  )
}

const MERGED_STATUS = "✓ Merged"

type TitleParts = {
  number: number
  url: string
  title: string
  isDim: boolean
  isOnBranch: boolean
  // Changed lately, as its note says until marked seen or expired (`recentChanges`); a compact row, without the note,
  // marks it with a dot.
  isChanged: boolean
  // Its stack and place in it, which a compact row, without the details, shows before its status.
  stack: string | null
}

// A compact row: the title line with a stacked one's stack and the status at its end, or, in a narrow panel, the
// status on the line under it, the stack staying at the title line's end.
function compactRow(kit: Kit, title: TitleParts, frame: RowFrame, status: RenderElement): RenderElement {
  const { Box } = kit
  const scope = rowKey(title.number)
  if (frame.layout === "line") {
    return titleLine(kit, title, frame, status)
  }

  return (
    <Box key={scope} flexDirection="column" hover={{ scope }}>
      {titleLine(kit, title, frame, null)}
      <Box key="status" paddingLeft={frame.indent}>
        {status}
      </Box>
    </Box>
  )
}

// The number, marked when the session is on its branch, in a column as wide as the panel's widest; the title; and,
// in a compact row, a dot when it changed, and at the end a stacked row's stack, set a column further apart, and the
// status. Only the title gives way when room runs short, wrapping in its own column, never cut, so the rest keeps its
// shape.
function titleLine(kit: Kit, parts: TitleParts, frame: RowFrame, status: RenderElement | null): RenderElement {
  const { Box, Text, Link } = kit
  const scope = rowKey(parts.number)
  const stack = frame.layout !== "full" ? parts.stack : null

  return (
    <Box key={status ? scope : undefined} gap={1} {...(status ? { hover: { scope } } : {})}>
      <Box width={frame.indent - 1} flexShrink={0}>
        {frame.gutter > 0 ? (
          <Box key="mark" width={frame.gutter} flexShrink={0}>
            {parts.isOnBranch ? (
              <Text bold color="success">
                {BRANCH_MARK}
              </Text>
            ) : null}
          </Box>
        ) : null}
        <Link href={parts.url} label={`#${parts.number}`} />
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text bold wrap="wrap" {...(parts.isDim ? { dimColor: true } : {})} hover={{ scope, color: "suggestion" }}>
          {parts.title}
          {/* At the end of the title's last line, wherever a wrapped title ends. */}
          {parts.isChanged && frame.layout !== "full" ? (
            <Text color="suggestion">{`\u00a0${CHANGED_MARK}`}</Text>
          ) : null}
        </Text>
      </Box>
      {status || stack ? <Box flexGrow={1} /> : null}
      {stack ? (
        <Box key="stack" flexShrink={0} {...(status ? { marginRight: STACK_GAP } : {})}>
          <Text dimColor>{stack}</Text>
        </Box>
      ) : null}
      {status ? <Box flexShrink={0}>{status}</Box> : null}
    </Box>
  )
}

// As a mail app marks what is unread: the row changed lately (`isChanged`). With the no-break space before it, which
// keeps it on the title's last line.
const CHANGED_MARK = "•"
const CHANGED_COLUMNS = 2

// In an app, where no line can part the rows (`rule`), each is a card of its own.
function card(kit: Kit, view: PaneView, number: number, content: RenderElement): RenderElement {
  const { Box } = kit

  return isTerminal(view.surface) ? (
    content
  ) : (
    <Box key={`card-${number}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      {content}
    </Box>
  )
}

const ACTIVITY_EVENTS = 4
const SEEN_LABEL = "✕"
// Up to a few polls apart, the refresh's own time says when a change happened closely enough.
const EXACT_WINDOW_MS = 10 * 60_000

// When a note's changes happened, in the same words as the details' ages; one noticed after a longer gap, as on
// coming back, happened somewhere within it.
function noteTime(entry: Activity, now: number): string | null {
  const span = elapsed(entry.since, now)

  return entry.at - entry.since <= EXACT_WINDOW_MS ? ago(entry.at, now) : span ? `in the last ${span}` : null
}

// What changed on the row lately, a note at its foot after a line of space, apart from what the row is and what can
// be done with it: in the theme's accent and italics, the latest change's symbol, the changes in order parted by dots,
// when they happened, and a ✕ that marks them seen. The changes give way to a narrow pane; the time and the ✕ stay
// whole. A dot ends the change before it, a no-break space before it, so no wrapped line starts with one.
function recentChanges(
  kit: Kit,
  row: PullRow,
  entries: Activity[],
  { indent, now }: { indent: number; now: number },
  actions: PaneActions
): RenderElement {
  const { Box, Text, Button } = kit
  const latest = entries.at(-1)!
  const events = noteEvents(entries)
  const shown = events.slice(-ACTIVITY_EVENTS)
  const earlier = events.length - shown.length
  const when = noteTime(latest, now)

  return (
    <Box key="activity" paddingLeft={indent} columnGap={2} flexWrap="wrap" marginTop={1}>
      <Text color="suggestion" italic wrap="wrap">
        {`${latest.symbol} ${shown.join(`\u00a0${DETAIL_SEPARATOR} `)}${earlier > 0 ? ` (+${earlier} earlier)` : ""}`}
      </Text>
      {/* The time and the ✕ together, under the note where it wraps. */}
      <Box columnGap={2} flexShrink={0}>
        {when ? <Text dimColor>{when}</Text> : null}
        <Button
          key={`seen-${row.number}`}
          label={SEEN_LABEL}
          plain
          dimColor
          onPress={() => actions.markSeen(row.number)}
        />
      </Box>
    </Box>
  )
}

// The status is the one thing drawn in its colour and bold, marked as the summary counts it, so the list reads at
// a glance; a waiting status has no colour or mark and is dimmed, so it doesn't read as a second title. Conflicts
// and failing checks link to where they are dealt with.
function statusText(kit: Kit, group: Group, row: PullRow): RenderElement {
  const { Text } = kit
  const label = linkedText(kit, markedStatus(group, row), row.status.href)

  return row.status.tone === "neutral" ? (
    <Text bold dimColor>
      {label}
    </Text>
  ) : (
    <Text bold color={row.status.tone}>
      {label}
    </Text>
  )
}

// A CI result's mark in GitHub's colours: passed, running, failed.
const CI_COLOURS: Readonly<Record<CiMark, "success" | "warning" | "error">> = {
  "✓": "success",
  "●": "warning",
  "✗": "error"
}

// Details stay dim under the status; a CI result's mark alone takes its colour, so checks read at a glance, and good
// news (an approval, auto-merge on) reads in green, the status keeping green for what can merge now. A passed result
// needs no visit, and a terminal without links would print the address beside each one, so it stays plain. The dot
// that parts a detail from the next ends its text, a no-break space before it, so it stays with the detail's last
// word and no line starts with one. Spaces inside a detail are the text's own, as an app's cells are wider than its
// text: a CI result is short and kept whole; any other may be long enough to wrap.
function detailText(kit: Kit, detail: Badge, isParted: boolean, room: number | null): RenderElement {
  const { Box, Text } = kit
  const href = detail.tone === "success" ? undefined : detail.href
  const dot = isParted ? <Text dimColor>{`\u00a0${DETAIL_SEPARATOR}`}</Text> : null
  const mark = detail.mark
  if (mark) {
    return (
      <Box flexShrink={0}>
        <Text>
          <Text dimColor>{linkedText(kit, detail.text.slice(0, -mark.length).trimEnd(), href)}</Text>{" "}
          <Text color={CI_COLOURS[mark]}>{mark}</Text>
          {dot}
        </Text>
      </Box>
    )
  }
  const label = linkedText(kit, detail.text, href)
  // In the terminal as wide as it is, up to a line, so one that doesn't fit beside the detail before it starts the
  // next line whole rather than wrapping beside it; never below none, which the engine refuses. An app moves it whole
  // by itself, and its cells are wider than its text, so a width in cells would leave a gap after it: there it may
  // shrink to the line instead, as a title does, and wraps within it.
  const width =
    room === null
      ? { flexShrink: 1, minWidth: 0 }
      : { minWidth: Math.max(0, Math.min(columnsOf(detail.text) + (isParted ? 2 : 0), room)) }
  const wrap = room === null ? { wrap: "wrap" as const } : {}
  const tone = detail.tone === "success" ? { color: "success" as const } : { dimColor: true }

  return (
    <Box {...width}>
      <Text {...wrap}>
        <Text {...tone}>{label}</Text>
        {dot}
      </Text>
    </Box>
  )
}

function linkedText(kit: Kit, text: string, href: string | undefined): RenderElement | string {
  const { Link } = kit

  return href ? <Link href={href} label={text} /> : text
}

// The buttons get a line of their own under the facts, so a narrow pane keeps the facts readable. An app draws a
// button taller than a line of text, and it would sit flush against the facts without a line's space above it.
function actionsFor(
  kit: Kit,
  row: PullRow,
  view: PaneView,
  actions: PaneActions,
  frame: RowFrame
): RenderElement | null {
  const { Box, Button, Text } = kit
  const spacing = isTerminal(view.surface) ? {} : { marginTop: 1 }
  // What is under way wraps in the row's column, as its facts do.
  const busy = view.busy[String(row.number)]
  if (busy) {
    return (
      <Box key="actions" paddingLeft={frame.indent} {...spacing}>
        <Text dimColor wrap="wrap">
          {busy}
        </Text>
      </Box>
    )
  }
  // A terminal button too wide for the room past the number column would break inside its brackets: there the
  // buttons start at the panel's edge instead.
  const widest = Math.max(0, ...row.actions.map((action) => ACTION_LABELS[action].length + BUTTON_CHROME))
  const indent = isTerminal(view.surface) && frame.columns - frame.indent < widest ? 0 : frame.indent
  if (row.actions.length === 0) {
    return null
  }

  return (
    <Box key="actions" paddingLeft={indent} {...buttonGaps(view.surface)} flexWrap="wrap" {...spacing}>
      {row.actions.map((action) => (
        <Button
          key={buttonKey(action, row.number)}
          label={ACTION_LABELS[action]}
          {...(action === row.primary ? { variant: "primary" as const } : {})}
          onPress={() => actions.act(action, row.number)}
        />
      ))}
    </Box>
  )
}

// A count's mark, then its number in bold, so the number is what the eye finds.
function boldCount(kit: Kit, { mark, count }: SummaryMark): (string | RenderElement)[] {
  const { Text } = kit

  return [`${mark} `, <Text bold>{String(count)}</Text>]
}

// The summary as a row above the prompt, for the desktop app, which cuts a long status line short: the counts in
// the colours the pane uses, and a button that opens it.
export function drawBand(kit: Kit, counts: SummaryCounts, open: () => void): RenderElement {
  const { Box, Text, Button } = kit

  return (
    <Box gap={2}>
      <Text bold>PRs</Text>
      {summaryParts(counts, "long").map((part) => (
        <Text color={part.tone}>
          {boldCount(kit, part)} {part.label}
        </Text>
      ))}
      <Button key="open-prs" label="Open" onPress={open} />
    </Box>
  )
}
