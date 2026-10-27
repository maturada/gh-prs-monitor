// Author: David Matura

import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, RenderElement, TextProps } from "claude-code"

import type { Activity, Badge, CiMark, MergedBranch, MergedPull, PullAction, PullRow, PullsSnapshot } from "../types"
import { ACTION_LABELS } from "./actions"
import { isOnBranch, rowsOf, stackText } from "./pulls"
import { CREATE_PR } from "./create-flow"
import type { PullToOpen } from "./create-flow"
import { SWITCH_BASE } from "./switch-base"
import { noteEvents } from "./alerts"
import { ago, checkingAgain, elapsed, lookedAt } from "./when"
import { BACK_MARK, buttonKey, PICK_KEY, rowKey } from "./keys"
import {
  buttonGaps,
  buttonsApart,
  colourOn,
  framePadding,
  isTerminal,
  lineApart,
  placesOutOfFlow,
  spacesByRows,
  unwrapped
} from "./layout"
import type { PaneColour } from "./layout"
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
import { card, CHANGED_MARK, panelTitle, rule } from "./panels"
import { markedStatus, MARKS, markText, summaryCounts, summaryMarks, summaryParts } from "./summary"
import type { SummaryCounts, SummaryMark } from "./summary"
import { detailsWithTicket } from "./tickets"
import type { TicketLinks } from "./tickets"

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
  // The checkout's branch, where its pull request merged at its commit, which the note above the lists offers to leave
  // (`mergedBranchOf`), or the one a switch under way left, so its progress and its ✕ stay in sight; null for none,
  // and on a visit or the examples.
  mergedBranch: MergedBranch | null
  // One line per pull request, or two in a narrow panel: its number, title and status.
  isCompact: boolean
  // The width the pane's body has, in columns.
  columns: number
  // What draws the pane: the terminal, or an app such as the desktop one.
  surface: string
  // The repository's ticket links where rows show them: a row's ticket leads its facts; null where they don't.
  tickets: TicketLinks | null
  // A visit's list, another repository's (`visit.ts`): that repository, named before its list comes, and the folder's,
  // which Back goes to, null where the folder has none. Null for the folder's own list.
  visit: { repo: string; folder: string | null } | null
  // What waits for the viewer in other repositories than the folder's and the one visited, as the light check of other
  // repositories last read it (`elsewhereCount`); 0 for none, or with it off.
  elsewhere?: number
  // The repository picker getting ready, which its buttons say until it asks (`askPick`).
  isPreparingPicker?: boolean
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
  // Switches this checkout to the merged branch's base (`switchToBase`), and puts the note away (its ✕).
  switchToBase: () => void
  dismissMergedBranch: () => void
  // From a visit, back to the folder's list.
  back?: () => void
  // The repository picker, which the header's Repositories button and the problem box open (`repo-picker.ts`), from the
  // button pressed (its key, where the keyboard goes back).
  pick: (pressed: string) => void
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
      {backRow === null || !placesOutOfFlow(view.surface) ? null : backMark(kit, backRow)}
    </Box>
  )
}

// The mark a question's close puts the window back on (`BACK_MARK`). Out of the flow, it takes no room and moves
// nothing; it is empty, so it shows nothing, and a row high so a surface measures where it is. A surface that lays
// every box out in the flow would draw it at the pane's foot, so there is none there, and the window goes to the
// button pressed (`goBack`).
function backMark(kit: Kit, row: number): RenderElement {
  const { Box } = kit

  return <Box key={BACK_MARK} position="absolute" top={row} left={0} width={1} height={1} />
}

// Before the first list: that it is checking while a load runs, or else what to press.
function waiting(view: PaneView): string {
  return view.isLoading
    ? "Checking GitHub for pull requests…"
    : `Press ${REFRESH_GLYPH} to check GitHub for pull requests.`
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
  const warning = colourOn(view.surface, "warning")

  return (
    <Box
      key="problem"
      flexDirection="column"
      gap={1}
      borderStyle="round"
      borderColor={warning}
      paddingX={1}
      {...framePadding(view.surface)}
    >
      <Box flexDirection="column">
        <Text bold color={warning} wrap="wrap">
          ⚠ Can't check pull requests
        </Text>
        <Text wrap="wrap">{problem}</Text>
        {notes.length > 0 ? (
          <Text dimColor wrap="wrap">
            {notes.join(" ")}
          </Text>
        ) : null}
      </Box>
      <Box {...buttonGaps(view.surface)} flexWrap="wrap">
        <Button key="retry" label="Retry" variant="primary" onPress={actions.refresh} />
        {/* With no list at all, as in a folder that is no GitHub repository, another repository's can show. */}
        {!view.snapshot ? (
          <Button
            key="pick-repo"
            label={view.isPreparingPicker ? PREPARING_LABEL : "Show Another Repository"}
            onPress={() => actions.pick("pick-repo")}
          />
        ) : null}
      </Box>
    </Box>
  )
}

// A bordered box's border and padding, and the terminal's `[ label ]` around a button's label, in columns.
const BOX_CHROME = 4
const BUTTON_CHROME = 4
const HEADER_GAP = 2
const WHEN_COLUMNS = "updated 00:00".length
// What Refresh and Back show, as their labels: the desktop app draws a native button from its label alone.
const REFRESH_GLYPH = "↻"
const BACK_GLYPH = "←"
// The repository picker's button, which shows another repository's pull requests.
const PICK_LABEL = "Repositories"
// What the picker's button, or the problem box's, says while the picker gets ready.
const PREPARING_LABEL = "Loading…"
// What a visit's header says beside the time.
const VISIT_NOTE = "Not this session's folder"

// The repository (a link to its pull requests), the status line's counts, and what waits elsewhere; when the list was
// read; the picker, the switch between the full and the compact view, and Refresh (↻), in a box of their own above the
// panels, `p`, `c` and `r` pressing them while the pane has the keyboard. A visit says it isn't the session's folder,
// with Back (←, `b`) to the folder's list.
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

  const name = snapshot?.repo ?? view.visit?.repo ?? "Pull Requests"
  const viewLabel = view.isCompact ? "Full" : "Compact"
  // The buttons keep to one line where they can, measured by what they show: Back shows the folder's repository only
  // where the whole row then fits the pane, else ← alone; a pane narrower still wraps them. Repositories is wider than
  // the Loading… that stands in for it while the picker gets ready, so the header keeps its shape.
  const widthOf = (shown: readonly string[]): number =>
    shown.reduce(
      (sum, each) => sum + columnsOf(each) + BUTTON_CHROME,
      buttonGaps(view.surface).columnGap * (shown.length - 1)
    )
  const measured = (back: string | null): string[] => [...(back ? [back] : []), PICK_LABEL, viewLabel, REFRESH_GLYPH]
  const room = view.columns - BOX_CHROME
  const backs = view.visit && actions.back ? [backTo(view.visit.folder), backTo(null)] : [null]
  const backLabel = backs.find((each) => widthOf(measured(each)) <= room) ?? backs[backs.length - 1]!
  const pickLabel = view.isPreparingPicker ? PREPARING_LABEL : PICK_LABEL
  const buttonsWidth = widthOf(measured(backLabel))
  // The counts are one piece, never parted, as a narrow layout would leave a count alone; the name wraps, and where
  // the two don't fit side by side the counts go under it whole. The time may go under them. Where the name and
  // counts, or the time, don't fit whole beside the buttons, the buttons go on a line of their own under them. The
  // time as its widest, so the header keeps its shape while "refreshing…" stands in for it.
  const elsewhere = view.elsewhere ? `+${view.elsewhere} elsewhere` : ""
  const countsWidth = columnsOf(marks.map(markText).join("  "))
  const titleWidth = name.length + (marks.length > 0 ? 2 + countsWidth : 0) + (elsewhere ? 2 + columnsOf(elsewhere) : 0)
  // The time's line holds a visit's note beside it.
  const whenWidth = Math.max(WHEN_COLUMNS, updated.length) + (view.visit ? 2 + VISIT_NOTE.length : 0)
  const infoWidth = Math.max(titleWidth, whenWidth)
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
      {...framePadding(view.surface)}
    >
      <Box columnGap={2} flexWrap="wrap" flexShrink={1} minWidth={0}>
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
          {elsewhere ? <Text dimColor>{elsewhere}</Text> : null}
        </Box>
        {when ? <Text dimColor>{when}</Text> : null}
        {view.visit ? (
          <Text key="visit" dimColor>
            {VISIT_NOTE}
          </Text>
        ) : null}
      </Box>
      <Box
        key="header-buttons"
        {...buttonGaps(view.surface)}
        flexShrink={0}
        flexWrap="wrap"
        {...(isStacked && !spacesByRows(view.surface) ? { marginTop: 1 } : {})}
      >
        {backLabel && actions.back ? <Button key="back" label={backLabel} hotkey="b" onPress={actions.back} /> : null}
        <Button key={PICK_KEY} label={pickLabel} hotkey="p" dimColor onPress={() => actions.pick(PICK_KEY)} />
        <Button key="view" label={viewLabel} hotkey="c" dimColor onPress={actions.toggleCompact} />
        <Button key="refresh" label={REFRESH_GLYPH} hotkey="r" dimColor onPress={actions.refresh} />
      </Box>
    </Box>
  )
}

// Back's label: ← and the folder's repository it goes back to, where the folder has one.
function backTo(folder: string | null): string {
  return folder ? `${BACK_GLYPH} ${folder}` : BACK_GLYPH
}

// Two panels, or, with nothing in either and Create PR neither offered nor at work, one line that says so, centred
// under the header; above them the checkout's branch where it merged, and under them the pull requests that merged or
// closed lately.
function body(kit: Kit, snapshot: PullsSnapshot, view: PaneView, actions: PaneActions): RenderElement {
  const { Box } = kit
  const isEmpty = GROUPS.every((group) => entriesOf(group, snapshot, view).length === 0)
  const lists =
    isEmpty && snapshot.hiddenDrafts === 0 && view.toOpen === null && !view.busy[CREATE_PR]
      ? centred(kit, "empty", NOTHING_OPEN)
      : panels(kit, snapshot, view, actions)
  const merged = mergedBranchNote(kit, snapshot, view, actions)
  const ended = endedNotes(kit, snapshot, view, actions)

  return merged || ended ? (
    <Box key="body" flexDirection="column" gap={1}>
      {merged}
      {lists}
      {ended}
    </Box>
  ) : (
    lists
  )
}

// The checkout's branch, merged (`view.mergedBranch`): a line above the lists naming it, its pull request and the base
// it merged into, with Switch to the base, whose place says what it is doing while it runs, and a ✕ that puts the note
// away for this branch at this commit.
function mergedBranchNote(
  kit: Kit,
  snapshot: PullsSnapshot,
  view: PaneView,
  actions: PaneActions
): RenderElement | null {
  const { Box, Text, Button, Link } = kit
  const merged = view.mergedBranch
  if (merged === null) {
    return null
  }
  const label = `#${merged.number}`
  const busy = view.busy[SWITCH_BASE]

  return (
    <Box key="merged-branch" columnGap={1} flexWrap="wrap" paddingX={1}>
      <Text wrap="wrap">{`You're on ${merged.branch}, merged into ${merged.base} as`}</Text>
      {snapshot.url ? <Link href={`${snapshot.url}/pull/${merged.number}`} label={label} /> : <Text>{label}</Text>}
      <Box columnGap={2} flexShrink={1} minWidth={0} marginLeft={1}>
        {busy ? (
          <Text dimColor wrap="wrap">
            {busy}
          </Text>
        ) : (
          <Button key="switch-base" label={`Switch to ${merged.base}`} onPress={actions.switchToBase} />
        )}
        <Button key="dismiss-base" label={SEEN_LABEL} plain dimColor onPress={actions.dismissMergedBranch} />
      </Box>
    </Box>
  )
}

// Pull requests that merged or closed lately, by someone else, which left the lists: under them, a line each, as a
// row's note says what changed (`recentChanges`), the title dimmed as done, with when and a ✕ that marks it seen; they
// go as notes go. One that came back into a list is noted on its row instead.
function endedNotes(kit: Kit, snapshot: PullsSnapshot, view: PaneView, actions: PaneActions): RenderElement | null {
  const { Box, Text, Button, Link } = kit
  const listed = new Set(rowsOf(snapshot).map((row) => row.number))
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
          <Box key={`ended-${number}`} gap={1} {...unwrapped(view.surface)}>
            <Box gap={1} flexShrink={0} {...unwrapped(view.surface)} {...column}>
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
      {...framePadding(view.surface)}
      columnGap={2}
      rowGap={buttonGaps(view.surface).rowGap}
      flexWrap="wrap"
      justifyContent="space-between"
    >
      <Box columnGap={2} flexWrap="wrap" flexShrink={1}>
        {panelTitle(kit, LIST_TITLES[group], 0)}
        {/* Drafts the setting hides are open pull requests of yours: the panel says they are hidden instead. */}
        <Text dimColor>{hidden ?? EMPTY_LISTS[group]}</Text>
      </Box>
      {group === "mine" ? createButton(kit, view, actions) : null}
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
      {...framePadding(view.surface)}
      {...(width === undefined ? {} : { width })}
    >
      <Box
        key="title"
        columnGap={2}
        rowGap={buttonGaps(view.surface).rowGap}
        flexWrap="wrap"
        justifyContent="space-between"
      >
        {panelTitle(kit, LIST_TITLES[group], rows.length)}
        {group === "mine" ? createButton(kit, view, actions) : null}
      </Box>
      {rule(kit, "rule-title", view.surface, view.columns)}
      {entries.flatMap((entry, index) => [
        // Compact rows, a line or two each, need nothing between them.
        ...(index > 0 && frame.layout === "full"
          ? [rule(kit, `rule-${entryNumber(entry)}`, view.surface, view.columns)]
          : []),
        entry.kind === "open"
          ? pullRow(kit, group, entry.row, frame, view, actions)
          : mergedRow(kit, entry.pull, frame, view)
      ])}
      {snapshot.isCut[group] && snapshot.url
        ? [
            rule(kit, "rule-cut", view.surface, view.columns),
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
  surface: string
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

  return { indent, gutter, layout, columns: rowColumns, surface: view.surface }
}

// The columns a text of ours takes in the terminal: one a character, two for each mark (✅ ❗ 🔍), which appears in it
// at most once.
function columnsOf(text: string): number {
  return [...text].length + Object.values(MARKS).filter((mark) => text.includes(mark)).length
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

    return compactRow(
      kit,
      titleParts,
      frame,
      busy ? <Text dimColor>{busy}</Text> : statusText(kit, group, row, view.surface)
    )
  }

  return card(
    kit,
    view.surface,
    `card-${row.number}`,
    <Box key={rowKey(row.number)} flexDirection="column" hover={{ scope: rowKey(row.number) }}>
      {titleLine(kit, titleParts, frame, null)}
      <Box key="status" paddingLeft={indent}>
        {statusText(kit, group, row, view.surface)}
      </Box>
      {factsLine(kit, view, frame, detailsWithTicket(row, view.tickets))}
      {actionsFor(kit, row, view, actions, frame)}
      {activity.length > 0 && view.snapshot
        ? recentChanges(kit, row, activity, { indent, now: view.snapshot.fetchedAt, surface: view.surface }, actions)
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
      {facts.map((fact, index) => detailText(kit, fact, index < facts.length - 1, room, view.surface))}
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
    <Text bold color={colourOn(view.surface, "merged")}>
      {MERGED_STATUS}
    </Text>
  )
  if (frame.layout !== "full") {
    return compactRow(kit, titleParts, frame, status)
  }

  return card(
    kit,
    view.surface,
    `card-${pull.number}`,
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
    <Box
      key={status ? scope : undefined}
      gap={1}
      {...unwrapped(frame.surface)}
      {...(status ? { hover: { scope } } : {})}
    >
      <Box width={frame.indent - 1} flexShrink={0} {...unwrapped(frame.surface)}>
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

// The changed mark (`CHANGED_MARK`) with the no-break space before it.
const CHANGED_COLUMNS = 2

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
  { indent, now, surface }: { indent: number; now: number; surface: string },
  actions: PaneActions
): RenderElement {
  const { Box, Text, Button } = kit
  const latest = entries.at(-1)!
  const events = noteEvents(entries)
  const shown = events.slice(-ACTIVITY_EVENTS)
  const earlier = events.length - shown.length
  const when = noteTime(latest, now)

  return (
    <Box key="activity" paddingLeft={indent} columnGap={2} flexWrap="wrap" marginTop={lineApart(surface)}>
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
function statusText(kit: Kit, group: Group, row: PullRow, surface: string): RenderElement {
  const { Text } = kit
  const label = linkedText(kit, markedStatus(group, row), row.status.href)
  const { tone } = row.status

  return tone === "neutral" ? (
    <Text bold dimColor>
      {label}
    </Text>
  ) : (
    <Text bold color={colourOn(surface, tone)}>
      {label}
    </Text>
  )
}

// A CI result's mark in GitHub's colours: passed, running, failed.
const CI_COLOURS: Readonly<Record<CiMark, PaneColour>> = {
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
function detailText(kit: Kit, detail: Badge, isParted: boolean, room: number | null, surface: string): RenderElement {
  const { Box, Text } = kit
  const href = detail.tone === "success" ? undefined : detail.href
  const dot = isParted ? <Text dimColor>{`\u00a0${DETAIL_SEPARATOR}`}</Text> : null
  const mark = detail.mark
  if (mark) {
    return (
      <Box flexShrink={0}>
        <Text>
          <Text dimColor>{linkedText(kit, detail.text.slice(0, -mark.length).trimEnd(), href)}</Text>{" "}
          <Text color={colourOn(surface, CI_COLOURS[mark])}>{mark}</Text>
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

// The buttons get a line of their own under the facts, so a narrow pane keeps the facts readable, their frames apart
// from the facts (`buttonsApart`).
function actionsFor(
  kit: Kit,
  row: PullRow,
  view: PaneView,
  actions: PaneActions,
  frame: RowFrame
): RenderElement | null {
  const { Box, Button, Text } = kit
  const apart = buttonsApart(view.surface)
  const spacing = apart > 0 ? { marginTop: apart } : {}
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
