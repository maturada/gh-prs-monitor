// Author: David Matura

// The hooks module: everything that reaches the engine (`$`) or the session's state is in this file, as the engine
// follows `$` and the state's names only within it. The other modules hold what decides, parses or draws, and the
// flows that reach the engine through a host this file builds (`…HostOf`), each member a call passed on, a few with
// a guard of their own (a load of the module a reload replaced shows nothing).

import { atom, read, update } from "claude-code"
import type { EngineInterface, Register, RenderElement, RenderInput, Timer, UiOpenResult } from "claude-code"

import type { Activity, CheckoutAt, PullAction, PullRow, Question } from "../types"
import { ACTION_LABELS } from "./actions"
import { nextNoteExpiry, nothingHeld, recentNotes } from "./alerts"
import { pullSuggestions } from "./autocomplete"
import { checkingAgain } from "./when"
import { focusMoved, forgetWindow, windowMoved } from "./back-to-row"
import { lookUpBranch } from "./branch-lookup"
import type { BranchLookupHost } from "./branch-lookup"
import { checkedOut, newerCheckout } from "./checkout"
import type { Host } from "./machine"
import { cleanUp } from "./cleanup"
import type { CleanupHost } from "./cleanup"
import { answerChoices, CHOICES_TOOL } from "./create-choices"
import { CREATE_PR, createPlaceQuestion, pullToOpen } from "./create-flow"
import {
  DEMO_ALERTS,
  demoAnswerNote,
  demoNotification,
  DEMO_SEEN_NOTE,
  demoQuestion,
  demoSnapshot,
  demoStartNote,
  DEMO_TOAST_GAP_MS,
  demoCounts,
  demoText,
  demoView,
  DEMO_TO_OPEN
} from "./demo"
import { dialogView } from "./dialog"
import { ask, askInEngineDialog, closeAsked, drawnQuestion, isQuestionOpen } from "./dialog-flow"
import type { DialogHost } from "./dialog-flow"
import { messageOf, SETUP_NOTE_MS } from "./gh"
import type { GhProblem, RepoRef } from "./gh"
import { drawsToasts, isTerminal } from "./layout"
import { linksOf, listText } from "./list"
import { canOpenSession, editorScheme } from "./new-session"
import { buttonKey } from "./keys"
import { drawBand, drawPane } from "./pane"
import { claimedBusy, resumeMerged, withBusy, withoutBusyIf } from "./press"
import type { PressHost } from "./press"
import { rowOf, storedSnapshot } from "./pulls"
import { reportFacts, reportText } from "./report"
import type { ReportHost } from "./report"
import {
  checkAgain,
  checkShared,
  ensurePolling,
  isCheckingMode,
  lookBack,
  refresh,
  refreshInTurn,
  retry,
  retryMinutes
} from "./refresh"
import type { RefreshHost } from "./refresh"
import { createSession, randomId } from "./session"
import type { Mark, Session, SkillStart } from "./session"
import { readSettings } from "./settings"
import { createPull, review, SKILLS, skillTurnEnded, skillTurnStarted, workOnBranch } from "./skill-runs"
import type { SkillHost } from "./skill-runs"
import { stableButtons } from "./stable-buttons"
import {
  claimCleanup,
  claimFetch,
  freeCleanup,
  freeShared,
  keepChoices,
  keepKept,
  keepTickets,
  keepView,
  notShownElsewhere,
  recallChoices,
  recallClaim,
  recallCleanup,
  recallKept,
  recallLook,
  recallShared,
  recallTickets,
  recallView,
  rememberLook,
  shareAnswer
} from "./store"
import type { StoreHost } from "./store"
import { hasAnything, statusSummary, summaryCounts, summaryText } from "./summary"
import { answerTicketLinks, TICKET_TOOL } from "./ticket-tool"
import type { TicketToolHost } from "./ticket-tool"
import { ticketsKey } from "./tickets"
import type { TicketLinks } from "./tickets"
import { ticketsFlow, ticketsText } from "./tickets-flow"
import type { TicketsHost } from "./tickets-flow"
import { announce, release } from "./toasts"
import type { ToastHost } from "./toasts"
import { markReady, merge, rerequestReview, rerun, updateBranch } from "./writes"

type Engine = EngineInterface

// This load of the module; each reload makes another.
const LOADED = randomId()

const PANE = "gh-prs-monitor"
const PANE_TITLE = "Pull Requests"

const snapshotState = atom({ plugin: "gh-prs-monitor", key: "snapshot" } as const, null)
const moduleState = atom({ plugin: "gh-prs-monitor", key: "module" } as const, null)
const problemState = atom({ plugin: "gh-prs-monitor", key: "problem" } as const, null)
const busyState = atom({ plugin: "gh-prs-monitor", key: "busy" } as const, {})
const dialogState = atom({ plugin: "gh-prs-monitor", key: "dialog" } as const, null)
const demoState = atom({ plugin: "gh-prs-monitor", key: "isDemo" } as const, false)
const activityState = atom({ plugin: "gh-prs-monitor", key: "activity" } as const, [])
const checkoutState = atom({ plugin: "gh-prs-monitor", key: "checkout" } as const, null)
const branchPullsState = atom({ plugin: "gh-prs-monitor", key: "branchPulls" } as const, null)
const mergedState = atom({ plugin: "gh-prs-monitor", key: "merged" } as const, [])
const compactState = atom({ plugin: "gh-prs-monitor", key: "isCompact" } as const, false)
const paneAskedState = atom({ plugin: "gh-prs-monitor", key: "paneAskedAt" } as const, null)
const turnsState = atom({ plugin: "gh-prs-monitor", key: "turns" } as const, [])
const heldAlertsState = atom({ plugin: "gh-prs-monitor", key: "heldAlerts" } as const, nothingHeld())

export const register: Register = (on, options) => {
  const session = createSession(readSettings(options))

  on("tool.call", { tool: new RegExp(`^${CHOICES_TOOL_NAME}$`) }, async ($, e) =>
    answerChoices(
      {
        recall: (key) => recallChoices(storeOf($), key),
        keep: (key, choices) => keepChoices(storeOf($), key, choices)
      },
      e as { repo?: unknown; save?: unknown }
    )
  )

  on("tool.call", { tool: new RegExp(`^${TICKET_TOOL_NAME}$`) }, async ($, e) =>
    answerTicketLinks(ticketToolHostOf($, session), e as Parameters<typeof answerTicketLinks>[1])
  )

  on("session.start", async ($, e, next) => {
    const started = await next(e)
    await update($, moduleState, () => ({ id: LOADED, isLoading: false }))
    // The command first, so nothing below can keep it from being there.
    await registerCommand($)
    await registerTool($, CHOICES_TOOL)
    await registerTool($, TICKET_TOOL)
    session.id = await sessionId($, session.id)
    // A reload during a turn: the turn goes on, and so do the alerts held for it.
    session.runningTurns = new Set(await read($, turnsState))
    session.fromBefore = new Set(session.runningTurns)
    // A module before 1.2.0 kept no `changes`: what it held shows, as none of it notifies.
    const kept = await read($, heldAlertsState)
    session.alerts = { ...kept, changes: kept.changes ?? [] }
    // A reload mid-demo puts the person's own summary back. Any reload leaves the status line as the module before
    // set it, as when a /config change turned the summary off: over a list kept, it is put as the settings now say.
    await endDemo($, session)
    if (storedSnapshot(await read($, snapshotState))) {
      await showStatus($, session)
    }
    await clearLeftovers($)
    await resumeMerged(pressHostOf($, session), session)
    background($, expireNotes($, session))
    await restoreView($)
    // A list kept over a reload from a version that kept the checkout apart has none to be drawn with until a load.
    if (storedSnapshot(await read($, snapshotState)) && (await read($, checkoutState)) === null) {
      background(
        $,
        checkoutNow($).then((checkout) => keepCheckout($, checkout))
      )
    }
    // With sharing off, the answers and claims shared before go: nobody takes them.
    if (!session.settings.isSharingRefreshes) {
      background($, freeShared(storeOf($)))
    }
    // A desktop session starts with no person at it and attaches its surface later; after a reload the surface is
    // already there, and no attach comes again.
    if (e.isInteractive || (await $.session.surfaces()).length > 0) {
      // A pane left open over a reload with no list it can draw, as after an update, is checked once in any mode.
      await loadMissingList($, session)
      background($, ensurePolling(refreshHostOf($, session), session))
    }

    return started
  })

  // A `/clear`, or a resume within this process, empties the session's state and starts no session again.
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear" || e.reason === "resume") {
      session.isStateEmptied = true
    }

    return next(e)
  })

  // A `/clear` or a resume starts a conversation with the state empty (`loadNewConversation`), alongside the person's
  // own SessionStart hooks, as nothing waits on them.
  on("classic.SessionStart", async ($, e, next) => {
    if (e.source === "clear" || e.source === "resume") {
      background($, loadNewConversation($, session))
    }

    return next(e)
  })

  // An SDK host that draws the session (the desktop app) starts it with no person at it and attaches its surface
  // afterwards, so the background checks begin there. One that attaches nothing gets none: no alert would show.
  // Attaching again after the window closed comes back to what changed meanwhile, as a new session would.
  on("session.attach", async ($, e, next) => {
    const attached = await next(e)
    const askedAt = await read($, paneAskedState)
    if (askedAt !== null) {
      await update($, paneAskedState, () => null)
      if ((await $.clock.now()) - askedAt <= OPEN_ON_ATTACH_MS) {
        background($, openPane($, session))
      }
    }
    if (session.checks.timer) {
      if (session.settings.isSharingRefreshes) {
        background($, checkShared(refreshHostOf($, session), session))
      }

      return attached
    }
    session.checks.isReturning = session.checks.wasDetached
    session.checks.wasDetached = false
    const host = refreshHostOf($, session)
    if (await isCheckingMode(host, session)) {
      background($, refresh(host, session, false))
    }
    background($, ensurePolling(host, session))

    return attached
  })

  on("command.run", { command: "prs" }, async ($, e) => {
    const args = e.args.trim().toLowerCase()
    // Anything else, as a mistyped close, changes nothing.
    if (!["", "close", "demo", "report", "tickets"].includes(args)) {
      return { text: `/prs takes nothing, demo, close, report or tickets, not "${e.args.trim()}".` }
    }
    // Text for the person and the conversation alike, whatever the pane shows.
    if (args === "report") {
      return { text: reportText(await reportFacts(reportHostOf($))) }
    }
    await update($, paneAskedState, () => null)
    // Typed, it closes the pane where no click does.
    if (args === "close") {
      if (!(await $.ui.panes()).some((pane) => pane.id === PANE)) {
        return { text: "The pull requests pane is not open." }
      }
      await $.ui.close({ id: PANE })

      return { text: "Closed the pull requests pane." }
    }
    // With nothing attached (a `-p` run, the SDK, or the desktop app before it attaches) the engine places a pane
    // nobody draws, and only the command's own output shows, so the list and the demo come as text; the list's pane
    // opens if an app attaches soon after.
    const surfaces = await $.session.surfaces()
    const isDrawn = surfaces.length > 0
    // Sent over Remote Control, from a phone or the web, where no pane draws while none attaches as `mobile`: the list
    // comes as text there, and the pane opens on the computer too. An engine older than these types may stamp no
    // origin; its /prs only opens the pane.
    const isSentFromAfar = e.origin?.kind === "bridge" && !surfaces.includes("mobile")
    // Its questions ask for a link to paste, where the mobile app draws no field, and the computer's pane may be out of
    // reach: sent over Remote Control at all, what is set comes as text.
    if (args === "tickets") {
      return { text: await ticketsCommand($, session, isDrawn && e.origin?.kind !== "bridge") }
    }
    if (args === "demo") {
      if (!isDrawn) {
        return { text: demoText(await $.clock.now(), "unattached", session.settings.isShowingTickets) }
      }
      // An app that places no panes still shows the alerts, and gets the list as text.
      const isPlaced = await showDemo($, session)

      return {
        text: !isPlaced
          ? demoText(await $.clock.now(), "unplaced", session.settings.isShowingTickets)
          : isSentFromAfar
            ? demoText(await $.clock.now(), "remote", session.settings.isShowingTickets)
            : "Showing example pull requests, their alerts and summary until you close the pane."
      }
    }
    // Sent from afar, the pane opens only after the list is printed: the load opening it starts would take the last
    // look, which the printed list leads with.
    if (isDrawn && !isSentFromAfar && (await openPane($, session)).isPlaced) {
      return { text: "Opened the pull requests pane." }
    }
    if (!isDrawn) {
      const now = await $.clock.now()
      await update($, paneAskedState, () => now)
    }
    const text = await printedList($, session)
    if (isDrawn && isSentFromAfar) {
      await openPane($, session, { isLoaded: true })
    }

    return { text }
  })

  on("prompt.autocomplete", { token: /^#/ }, async ($, e, next) => {
    const snapshot = storedSnapshot(await read($, snapshotState))
    const rows = snapshot ? pullSuggestions(snapshot, e.token) : []

    return { suggestions: [...(await next(e)).suggestions, ...rows] }
  })

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const isDemo = await read($, demoState)
    if (e.surface !== "desktop" || e.props.hasSurvey || !(session.settings.isShowingStatus || isDemo)) {
      return next(e)
    }

    const stored = storedSnapshot(await read($, snapshotState))
    const problem = await read($, problemState)
    const counts = isDemo ? demoCounts(await $.clock.now()) : stored && problem === null ? summaryCounts(stored) : null
    if (!counts || !hasAnything(counts)) {
      return next(e)
    }

    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const kit = { Box, Text, Button: stableButtons(session.drawnButtons, `${e.surface}:band`, Button), Link }

    return drawBand(kit, counts, () => background($, openPane($, session)))
  })

  // Closing the pane is having seen what it showed: the changes it marked, and the list itself as the last look;
  // closing the examples ends them instead. The engine's own close of a pane nothing draws any more (a reload, a
  // drawing that threw) reaches none of the plugin's hooks. While the pane asks a question, the person's close (Escape,
  // the close mark) cancels the question and leaves the pane open.
  on("ui.close", async ($, e, next) => {
    if (e.id === PANE && !closeAsked(session, e.origin.kind === "person")) {
      return { value: undefined }
    }
    const closed = await next(e)
    if (e.id === PANE) {
      forgetWindow(session)
    }
    if (e.id === PANE && (await read($, demoState))) {
      await endDemo($, session)
    } else if (e.id === PANE) {
      await update($, activityState, () => [])
      const shown = storedSnapshot(await read($, snapshotState))
      if (session.repo && shown) {
        await rememberLook(storeOf($), session.repo, shown)
      }
    }

    return closed
  })

  // A bundled skill works over several turns (fixing, replying, resolving), so the list follows it, whether the person
  // typed it, as in a session a button opened for it, or a pane button started it. The plugin's own command passes
  // its own hooks by, so this sees only the typed ones; `runSkill` marks the pressed.
  for (const command of Object.keys(SKILLS)) {
    on("command.run", { command }, async ($, e, next) => {
      const starting: SkillStart = { command, mark: null, args: e.args }
      session.skills.starting.push(starting)
      try {
        const ran = await next(e)
        session.skills.startedAt = await $.clock.now()

        return ran
      } catch (error) {
        session.skills.starting = session.skills.starting.filter((each) => each !== starting)
        throw error
      }
    })
  }

  on("turn.start", async ($, e, next) => {
    // Counted once started, so a start that failed holds nothing. A subagent's run, which Claude Code raises turns for
    // since 2.1.299, works inside a turn of the main loop: it holds no alert or switch back, and is no skill's turn.
    const started = await next(e)
    if ((e as { agentId?: string }).agentId !== undefined) {
      return started
    }
    for (const ended of session.fromBefore) {
      session.runningTurns.delete(ended)
    }
    session.fromBefore.clear()
    session.runningTurns.add(e.turnId)
    keepTurns($, session)
    skillTurnStarted(skillHostOf($, session), session, e.turnId)

    return started
  })

  on("turn.complete", async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      session.fromBefore.delete(e.turnId)
      if (session.runningTurns.delete(e.turnId) && session.runningTurns.size === 0) {
        background($, release(toastHostOf($, session), session))
        for (const resume of session.idleWaiters.splice(0)) {
          resume()
        }
      }
      keepTurns($, session)
      skillTurnEnded(skillHostOf($, session), session, e.turnId, e.agentId === undefined)
    }
  })

  // The window's moves and the keyboard's over the pane (`windowMoved`, `focusMoved`); the plugin's own moves reach
  // none of its hooks.
  on("ui.scroll", { component: "Pane", requestId: PANE }, async ($, e, next) =>
    windowMoved(session, e.origin.kind === "person", e.offset, () => next(e))
  )
  on("ui.focus", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    focusMoved(session, e.origin.kind === "person", e.element !== undefined)

    return next(e)
  })

  // Each drawing takes its buttons (`stableButtons`) last, once nothing is awaited, so drawings taken in turn finish in
  // the same order.
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    // A question takes the list's place until it is answered (`ask`).
    const question = drawnQuestion(session, await read($, dialogState))
    if (question !== null) {
      return drawQuestion(session, e, question, $.ui.resolve(e))
    }
    // Where the window stands over the list, for a question to put it back there (`backToRow`): the terminal's drawing
    // says; elsewhere the drawing carries what the app last sent, and the `ui.scroll` hook keeps it as each move lands.
    if (isTerminal(e.surface)) {
      session.listOffset = e.props.scroll.offset
    }

    return (await read($, demoState)) ? drawDemo($, session, e) : drawList($, session, e)
  })
}

// The open question in the pane, its buttons kept stable across redraws.
function drawQuestion(
  session: Session,
  e: RenderInput<"Pane">,
  question: Question,
  elements: ReturnType<Engine["ui"]["resolve"]>
): RenderElement {
  const { Box, Text, Button } = elements
  const kit = {
    Box,
    Text,
    Button: stableButtons(session.drawnButtons, `${e.surface}:pane:question`, Button),
    // The engine completes every surface's table, an element a surface lacks drawing nothing, so the phone app,
    // which has no field, is told by its surface; the table's own check only narrows its type.
    Input: e.surface !== "mobile" && "Input" in elements ? elements.Input : undefined
  }
  // Escape cancels where the pane holds the keyboard; at the prompt it may stop Claude's turn instead.
  const isEscapable = e.surface === "terminal" && e.props.isFocused
  const field = {
    key: session.asking?.fieldKey ?? "answer-text",
    read: () => session.asking?.draft ?? "",
    keep: (text: string) => {
      if (session.asking) {
        session.asking.draft = text
      }
    }
  }

  return dialogView(kit, question, (answer) => session.asking?.answer(answer), field, {
    surface: e.surface,
    isEscapable
  })
}

// The examples' list. Its buttons write nothing; Refresh leaves it for the person's own list. They keep buttons of
// their own, as one drawn alike in the list would carry the list's closure.
async function drawDemo($: Engine, session: Session, e: RenderInput<"Pane">): Promise<RenderElement> {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const isCompact = await read($, compactState)
  const demo = demoView(
    await $.clock.now(),
    e.props.bodyColumns,
    e.surface,
    isCompact,
    session.settings.isShowingTickets
  )
  const kit = { Box, Text, Button: stableButtons(session.drawnButtons, `${e.surface}:pane:demo`, Button), Link }

  return drawPane(
    kit,
    demo,
    {
      refresh: () => background($, leaveDemo($, session)),
      act: (action, pullNumber) => background($, askInDemo($, session, action, pullNumber, e.surface)),
      create: () => background($, askCreateInDemo($, session, e.surface)),
      markSeen: () => background($, notify($, DEMO_SEEN_NOTE, session.settings.alertMs)),
      toggleCompact: () => background($, toggleView($))
    },
    session.goingBack?.offset ?? null
  )
}

// The person's list, as the session's state holds it. A snapshot kept from another version of the plugin waits for
// the next refresh instead of being drawn.
async function drawList($: Engine, session: Session, e: RenderInput<"Pane">): Promise<RenderElement> {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const snapshot = storedSnapshot(await read($, snapshotState))
  const checkout = await read($, checkoutState)
  const branch = checkout?.branch ?? null
  const head = checkout?.head ?? null
  const view = {
    snapshot,
    problem: await read($, problemState),
    retryMinutes: retryMinutes(session),
    now: await $.clock.now(),
    isLoading: (await read($, moduleState))?.isLoading === true,
    busy: await read($, busyState),
    activity: await read($, activityState),
    branch,
    toOpen: pullToOpen(snapshot, branch, head, await read($, branchPullsState)),
    merged: await read($, mergedState),
    isCompact: await read($, compactState),
    columns: e.props.bodyColumns,
    surface: e.surface,
    tickets: shownTickets(session)
  }
  const kit = { Box, Text, Button: stableButtons(session.drawnButtons, `${e.surface}:pane`, Button), Link }

  return drawPane(
    kit,
    view,
    {
      refresh: () => background($, retry(refreshHostOf($, session), session)),
      act: (action, pullNumber) => background($, actOn($, session, action, pullNumber, e.surface)),
      create: () => background($, createPull(skillHostOf($, session), session, e.surface)),
      markSeen: (pullNumber) => background($, markSeen($, pullNumber)),
      toggleCompact: () => background($, toggleView($))
    },
    session.goingBack?.offset ?? null
  )
}

// --- The pane, the band and the status line ---

// `isLoaded`: the list was loaded just now, for the text a /prs printed, and draws as it is. `isTakingKeys`: the pane
// asks for the keyboard, as `/prs tickets` does for the link pasted next, since only a pane holding it can move it to
// its field; the prompt hands it over only while its composer is empty.
async function openPane(
  $: Engine,
  session: Session,
  { isLoaded = false, isTakingKeys = false }: { isLoaded?: boolean; isTakingKeys?: boolean } = {}
): Promise<UiOpenResult> {
  await endDemo($, session)
  // The load under way, and its state written, before the pane draws, so its first drawing says it is checking rather
  // than to press Refresh; the timer after, as while-open mode polls only once the pane is open. The drawing reads
  // state alone: a write redraws only the drawings that read it.
  const host = refreshHostOf($, session)
  if (!isLoaded) {
    checkAgain(host, session)
    await session.checks.marking?.catch(() => undefined)
  }
  const opened = await $.ui.open({
    id: PANE,
    title: PANE_TITLE,
    closeOnEscape: true,
    ...(isTakingKeys ? { focus: true } : {})
  })
  await ensurePolling(host, session)

  return opened
}

// The list /prs prints where no pane shows it, or a problem. It is a look like the pane's, and leads with what changed
// since the last one, whatever toasts said meanwhile: a toast nobody may have seen is no look, and `awayLine` and
// `alertLines` send the person here.
async function printedList($: Engine, session: Session): Promise<string> {
  const host = refreshHostOf($, session)
  await refreshInTurn(host, session)
  const snapshot = await read($, snapshotState)
  const problem = await read($, problemState)
  if (problem || !snapshot) {
    const checksEvery = retryMinutes(session)

    return problem
      ? [problem, checksEvery === null ? null : checkingAgain(checksEvery)].filter(Boolean).join("\n\n")
      : "No pull requests loaded yet."
  }

  const since = await lookBack(host, session, snapshot)
  const branch = (await read($, checkoutState))?.branch ?? null
  const links = session.repo ? linksOf(session.repo) : null

  return listText(snapshot, since, links, branch, await $.clock.now(), shownTickets(session))
}

// How long after a /prs that found no app attached the pane still opens when one attaches.
const OPEN_ON_ATTACH_MS = 10 * 60_000

// The branch and commit the session's checkout is on, as git says now.
async function checkoutNow($: Engine): Promise<CheckoutAt> {
  return { ...(await checkedOut(hostOf($))), at: await $.clock.now() }
}

// Kept unless a load or a press read the checkout later meanwhile (`newerCheckout`); resolves the one kept.
async function keepCheckout($: Engine, checkout: CheckoutAt): Promise<CheckoutAt> {
  return (await update($, checkoutState, (kept) => newerCheckout(kept, checkout)))!
}

// The desktop app cuts a long status line short, so there the band above the prompt carries the summary; a
// terminal attached beside it keeps its line.
async function setStatus($: Engine, text: string | undefined): Promise<void> {
  const surfaces = await $.session.surfaces()
  const isDesktopOnly = surfaces.includes("desktop") && !surfaces.includes("terminal")
  $.ui.status(isDesktopOnly ? undefined : text)
}

// A list the session's state doesn't hold, as at a start, or after a reload or a `/clear`: checked at once in
// background mode, and in any mode while the pane is open waiting for one, rather than wait for a timer or a press.
async function loadMissingList($: Engine, session: Session): Promise<void> {
  const isPaneWaiting = !storedSnapshot(await read($, snapshotState)) && (await isPaneOpen($))
  if (session.settings.refresh === "background" || isPaneWaiting) {
    background($, refresh(refreshHostOf($, session), session, false))
  }
}

// A conversation a `/clear` or a resume started holds no list: it is checked as at a session's start. A load under way
// across the end lost its loading mark with the state, and takes it again. The polling goes on, as this load's timers
// outlive the conversation. A session launched with `--resume` holds its list already, or is loading it.
async function loadNewConversation($: Engine, session: Session): Promise<void> {
  if (storedSnapshot(await read($, snapshotState)) || (await $.session.surfaces()).length === 0) {
    return
  }
  if (session.checks.inFlight) {
    await refreshHostOf($, session).markLoading(true)
  }
  await loadMissingList($, session)
}

// Open and drawn: a pane that waits undrawn (a surface that places none) shows nothing yet.
async function isPaneOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some((pane) => pane.id === PANE && pane.isPlaced)
}

// Drawn and in front: a tab behind another shows the person nothing either, and a plugin can't bring it forward.
async function isPaneShown($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some((pane) => pane.id === PANE && pane.isPlaced && pane.isShown)
}

async function restoreView($: Engine): Promise<void> {
  try {
    const isCompact = (await recallView(storeOf($))) === true
    await update($, compactState, () => isCompact)
  } catch (error) {
    logDebug($, `The pane's view could not be read back: ${messageOf(error)}`)
  }
}

async function toggleView($: Engine): Promise<void> {
  const isCompact = await update($, compactState, (was) => !was)
  try {
    await keepView(storeOf($), isCompact)
  } catch (error) {
    logDebug($, `The pane's view could not be kept: ${messageOf(error)}`)
  }
}

// --- The demo ---

// The examples take over the pane, the status line and the desktop app's band until the pane closes, Refresh is
// pressed or /prs runs, while every example alert shows, one at a time so each is the newest on the stack while it
// shows. An app that places no panes gets the alerts alone, and the list as text: nothing there could end the rest.
async function showDemo($: Engine, session: Session): Promise<boolean> {
  cancelDemoToasts(session)
  const timeoutMs = session.settings.alertMs
  session.demo.toasts = DEMO_ALERTS.flatMap((alert, index) => {
    if (index === 0) {
      background($, notify($, alert, timeoutMs))

      return []
    }

    return [$.clock.after(index * DEMO_TOAST_GAP_MS, () => background($, notify($, alert, timeoutMs)))]
  })
  if (session.settings.isPlayingSound) {
    background($, $.audio.play({ asset: ALERT_SOUND }))
  }
  if (session.settings.isSendingSystemNotification) {
    const { title, text } = demoNotification()
    background($, notifySystem($, title, text))
  }
  // Set before the pane opens, so its first drawing is of the examples.
  await update($, demoState, () => true)
  const isPlaced = (await $.ui.open({ id: PANE, title: PANE_TITLE, closeOnEscape: true })).isPlaced
  if (isPlaced) {
    await setStatus($, summaryText(demoCounts(await $.clock.now())))
  } else {
    await update($, demoState, () => false)
  }

  return isPlaced
}

function cancelDemoToasts(session: Session): void {
  for (const toast of session.demo.toasts) {
    toast.cancel()
  }
  session.demo.toasts = []
}

async function leaveDemo($: Engine, session: Session): Promise<void> {
  await endDemo($, session)
  await retry(refreshHostOf($, session), session)
}

// The person's own list, summary and band come back, and example alerts still to show don't.
async function endDemo($: Engine, session: Session): Promise<void> {
  if (!(await read($, demoState))) {
    return
  }
  cancelDemoToasts(session)
  await update($, demoState, () => false)
  await showStatus($, session)
}

// The summary where the settings show it, over a list and no problem; nothing otherwise.
async function showStatus($: Engine, session: Session): Promise<void> {
  const snapshot = storedSnapshot(await read($, snapshotState))
  const problem = await read($, problemState)
  const isShowing = session.settings.isShowingStatus && snapshot !== null && problem === null
  await setStatus($, isShowing ? statusSummary(snapshot) : undefined)
}

// An example's button asks what the real one asks about it, and sends nothing: an answer is told as what it would do
// in the person's own list.
async function askInDemo(
  $: Engine,
  session: Session,
  action: PullAction,
  pullNumber: number,
  surface: string
): Promise<void> {
  const snapshot = demoSnapshot(await $.clock.now())
  const row = rowOf(snapshot, pullNumber)
  if (!snapshot || !row) {
    return
  }
  const question = demoQuestion(action, row, snapshot, canOpenSession(surface))
  const note =
    question === null
      ? demoStartNote(`#${pullNumber}`, ACTION_LABELS[action])
      : demoAnswerNote(
          `#${pullNumber}`,
          question,
          await ask(dialogHostOf($), session, question, buttonKey(action, pullNumber))
        )
  if (note) {
    await notify($, note, session.settings.alertMs)
  }
}

// Create PR's example asks what the real button asks, about the example's branch, and sends nothing; where no new
// session can be opened, the real one asks nothing, and neither does the example.
async function askCreateInDemo($: Engine, session: Session, surface: string): Promise<void> {
  const question = createPlaceQuestion(DEMO_TO_OPEN.branch, DEMO_TO_OPEN.base, false)
  const note = canOpenSession(surface)
    ? demoAnswerNote(DEMO_TO_OPEN.branch, question, await ask(dialogHostOf($), session, question, CREATE_PR))
    : demoStartNote(DEMO_TO_OPEN.branch, "Create PR")
  if (note) {
    await notify($, note, session.settings.alertMs)
  }
}

// --- Ticket links ---

// `/prs tickets`: its questions in the pane, where one draws for the person here, opened as /prs opens it, the list
// loading in it; elsewhere, or where no pane is placed, what is set, as text. A session's first prompt can come before
// its first load named the repository: that load is waited for, and where it named none, the command loads once more,
// as its reads see no other's writes (`refreshInTurn`), to answer why.
async function ticketsCommand($: Engine, session: Session, isAskedInPane: boolean): Promise<string> {
  const isWaiting = !session.repo
  if (isWaiting) {
    await session.checks.inFlight?.done.catch(() => undefined)
  }
  // Still none: the command loads it itself, as its reads see its own load alone.
  const isLoadedHere = !session.repo
  if (isLoadedHere) {
    await refreshInTurn(refreshHostOf($, session), session)
  }
  const repo = session.repo
  if (!repo) {
    return (await read($, problemState)) ?? "No repository loaded yet."
  }
  // The load waited for draws as it is, unless a problem stopped the checks, which the pane's opening lifts, as /prs's.
  const isFresh = isWaiting && !session.checks.isStopped
  if (isAskedInPane && (await openPane($, session, { isLoaded: isFresh, isTakingKeys: true })).isPlaced) {
    background($, ticketsFlow(ticketsHostOf($, session), repo, session.settings.isShowingTickets))

    return "Asking about ticket links in the pane."
  }

  return printedTickets($, session, repo, isLoadedHere)
}

// What is set, as text. What the links find is told from the list, which a session's first prompt can find still
// loading, and which the command's own reads see only as it loaded it itself (`refreshInTurn`), unless it just did.
async function printedTickets($: Engine, session: Session, repo: RepoRef, isLoaded: boolean): Promise<string> {
  if (!isLoaded) {
    await refreshInTurn(refreshHostOf($, session), session)
  }
  const view = { rows: await listedRows($, session), isShowingTickets: session.settings.isShowingTickets }
  try {
    return ticketsText(repo, await recallTickets(storeOf($), repo), view)
  } catch (error) {
    return `Couldn't read the ticket links: ${messageOf(error)}`
  }
}

// The pull requests the pane lists, as a question about them is asked. With none listed yet, as at a session's first
// prompt, the load under way is waited out: work a command leaves running reads the session's state as it stands once
// the command has answered, the load's list by then.
async function listedRows($: Engine, session: Session): Promise<readonly PullRow[]> {
  let listed = storedSnapshot(await read($, snapshotState))
  if (!listed) {
    await session.checks.inFlight?.done.catch(() => undefined)
    listed = storedSnapshot(await read($, snapshotState))
  }

  return rowsOf(listed)
}

function rowsOf(listed: ReturnType<typeof storedSnapshot>): readonly PullRow[] {
  return listed ? [...listed.mine, ...listed.review] : []
}

// The links the rows show: the repository's, where Ticket links on rows is on.
function shownTickets(session: Session): TicketLinks | null {
  return session.settings.isShowingTickets ? session.ticketLinks : null
}

// The repository's links as the store holds them, for its rows; one that can't be read leaves those read before, and
// says so in the debug log.
async function refreshTicketLinks($: Engine, session: Session): Promise<void> {
  if (!session.repo) {
    return
  }
  try {
    const kept = await recallTickets(storeOf($), session.repo)
    session.ticketLinks = kept === "off" ? null : kept
  } catch (error) {
    logDebug($, `gh-prs-monitor: ticket links could not be read: ${messageOf(error)}`)
  }
}

// Links kept for a repository, which the session's rows show at once where it is the session's.
async function keepTicketLinks($: Engine, session: Session, repo: RepoRef, value: TicketLinks | "off"): Promise<void> {
  await keepTickets(storeOf($), repo, value)
  if (session.repo && ticketsKey(session.repo) === ticketsKey(repo)) {
    session.ticketLinks = value === "off" ? null : value
    $.ui.invalidate("ui.render")
  }
}

// What the skills' ticket tool needs of the engine (`ticket-tool.ts`).
// Its question goes to Claude Code's own dialog, which a tool's call may wait on as long as the person takes: the
// pane's would count against the hook's own time, as would a load; so the list is read as it stands.
function ticketToolHostOf($: Engine, session: Session): TicketToolHost {
  return {
    recall: (repo) => recallTickets(storeOf($), repo),
    keep: (repo, value) => keepTicketLinks($, session, repo, value),
    ownRepo: () => session.repo,
    ask: (question) => askInEngineDialog(dialogHostOf($), question),
    listed: async () => rowsOf(storedSnapshot(await read($, snapshotState))),
    declined: session.ticketSavesDeclined
  }
}

// What `/prs tickets` needs of the engine (`tickets-flow.ts`): its questions go where a press's would, the list's
// refresh button taking the keyboard back.
function ticketsHostOf($: Engine, session: Session): TicketsHost {
  return {
    recall: (repo) => recallTickets(storeOf($), repo),
    keep: (repo, value) => keepTicketLinks($, session, repo, value),
    ask: (question) => ask(dialogHostOf($), session, question, "refresh"),
    listed: () => listedRows($, session),
    notify: (text) => notify($, text, session.settings.alertMs)
  }
}

// --- The plugin's store, as store.ts reads and writes it ---

function storeOf($: Engine): StoreHost {
  return {
    get: (key) => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: (key) => $.store.delete(key),
    keys: () => $.store.keys(),
    now: () => $.clock.now(),
    log: (line) => logDebug($, line)
  }
}

// --- Alerts ---

const ALERT_SOUND = "sounds/alert.wav"

// What the alerts need of the engine to reach the person (`toasts.ts`).
function toastHostOf($: Engine, session: Session): ToastHost {
  return {
    now: () => $.clock.now(),
    keepHeld: () =>
      background(
        $,
        update($, heldAlertsState, () => session.alerts)
      ),
    notify: (text, timeoutMs) => notify($, text, timeoutMs),
    playSound: () => background($, $.audio.play({ asset: ALERT_SOUND })),
    notifySystem: (title, text) => background($, notifySystem($, title, text)),
    notShownElsewhere: (repo, lines) =>
      notShownElsewhere(storeOf($), repo, lines, { by: session.id, pollMs: session.settings.pollMs })
  }
}

// The turns under way, as they are when written, kept for a reload's module (`session.start`).
function keepTurns($: Engine, session: Session): void {
  background(
    $,
    update($, turnsState, () => [...session.runningTurns])
  )
}

// A system notification through the person's own channel, the one Claude Code's notifications take
// (`preferredNotifChannel`): a banner in iTerm2, kitty or Ghostty, the bell in another terminal, and where no terminal
// shows only their own `Notification` hooks. Engines before 2.1.295 have no such call, and a hook's refusal or a failed
// write rejects it: async, so each of these reaches `background`'s log, as the toasts have said it already.
async function notifySystem($: Engine, title: string, text: string): Promise<void> {
  await $.ui.notify(text, { title })
}

// Where no surface draws toasts, a message becomes a dim notice in the conversation, which the model never sees; with
// nothing attached it goes to the SDK host as `ui_log`.
async function notify($: Engine, text: string, timeoutMs: number): Promise<void> {
  if ((await $.session.surfaces()).some(drawsToasts)) {
    $.ui.toast(text, { timeoutMs })
  } else {
    $.ui.log(text)
  }
}

// What kept gh from asking GitHub, said longer where gh needs setting up.
async function notifyProblem($: Engine, session: Session, problem: GhProblem): Promise<void> {
  await notify($, problem.message, problem.needsSetup ? SETUP_NOTE_MS : session.settings.alertMs)
}

// --- Cleaning up the worktrees and branches of pull requests that ended ---

// What a cleanup reaches beyond git and gh (`cleanup.ts`).
function cleanupHostOf($: Engine, session: Session): CleanupHost {
  return {
    ...hostOf($),
    log: (line) => logDebug($, line),
    storedList: () => read($, snapshotState),
    // A cleanup's notes are no pull request changes: they notify nothing.
    announce: (repo, lines) => announce(toastHostOf($, session), session, repo, lines, false),
    now: () => $.clock.now(),
    recallKept: (repo, root) => recallKept(storeOf($), repo, root),
    keepKept: (repo, root, kept) => keepKept(storeOf($), repo, root, kept),
    recallCleanup: (root) => recallCleanup(storeOf($), root),
    claimCleanup: (root, claim) => claimCleanup(storeOf($), root, claim),
    freeCleanup: (root, by) => freeCleanup(storeOf($), root, by)
  }
}

// --- A press on a pull request's row ---

// What a press reaches beyond git and gh (`press.ts`).
function pressHostOf($: Engine, session: Session): PressHost {
  return {
    ...hostOf($),
    now: () => $.clock.now(),
    after: (ms, fire) => $.clock.after(ms, fire),
    sleep: (ms) => $.clock.sleep(ms),
    background: (work) => background($, work),
    log: (line) => logDebug($, line),
    notify: (text, timeoutMs) => notify($, text, timeoutMs),
    notifyProblem: (problem) => notifyProblem($, session, problem),
    storedList: () => read($, snapshotState),
    keepList: (change) => update($, snapshotState, change),
    merged: () => read($, mergedState),
    keepMerged: (change) => update($, mergedState, change),
    problem: () => read($, problemState),
    isDemo: () => read($, demoState),
    setStatus: (text) => setStatus($, text),
    claimBusy: (mark, text) => claimBusy($, mark, text),
    setBusy: (mark, text) => setBusy($, mark, text),
    ask: (question, pressed) => ask(dialogHostOf($), session, question, pressed),
    isQuestionOpen: () => isQuestionOpen(dialogHostOf($), session),
    refresh: (isAlerting) => refresh(refreshHostOf($, session), session, isAlerting),
    refreshAfterWrite: () => refreshInTurn(refreshHostOf($, session), session),
    cleanUp: (repo, known) => cleanUp(cleanupHostOf($, session), session, repo, known)
  }
}

// The row a press names, as the list holds it now: a button drawn again unchanged keeps the closure it was first drawn
// with, so it carries only the number. One that has left the list meanwhile is left alone.
async function actOn(
  $: Engine,
  session: Session,
  action: PullAction,
  pullNumber: number,
  surface: string
): Promise<void> {
  const row = rowOf(await read($, snapshotState), pullNumber)
  if (row?.actions.includes(action)) {
    act($, session, action, row, surface)
  }
}

// The notes of what changed, kept: each goes at its time, whether or not a load comes then (on demand, or with an
// interval longer than they last).
async function keepNotes(
  $: Engine,
  session: Session,
  change: (kept: readonly Activity[]) => Activity[]
): Promise<Activity[]> {
  const notes = await update($, activityState, change)
  session.notesTimer?.cancel()
  const at = nextNoteExpiry(notes, session.settings.changesMs)
  session.notesTimer =
    at === null
      ? null
      : $.clock.after(Math.max(0, at - (await $.clock.now())), () => background($, expireNotes($, session)))

  return notes
}

async function expireNotes($: Engine, session: Session): Promise<void> {
  const now = await $.clock.now()
  await keepNotes($, session, (kept) => recentNotes(kept, now, session.settings.changesMs))
}

// What changed on a pull request, as its note says, is seen: by the note's ✕, or by acting on the pull request.
async function markSeen($: Engine, pullNumber: number): Promise<void> {
  await update($, activityState, (all) => all.filter((entry) => entry.number !== pullNumber))
}

function act($: Engine, session: Session, action: PullAction, row: PullRow, surface: string): void {
  background($, markSeen($, row.number))
  switch (action) {
    case "resolve":
    case "fixCi":
    case "resolveConflicts":
      return background($, workOnBranch(skillHostOf($, session), session, action, row, surface))
    case "review":
      return background($, review(skillHostOf($, session), session, row, surface))
    case "merge":
    case "autoMerge":
      return background($, merge(pressHostOf($, session), session, row, action === "autoMerge"))
    case "updateBranch":
      return background($, updateBranch(pressHostOf($, session), session, row))
    case "ready":
      return background($, markReady(pressHostOf($, session), session, row))
    case "rerequest":
      return background($, rerequestReview(pressHostOf($, session), session, row))
    case "rerun":
      return background($, rerun(pressHostOf($, session), session, row))
    default:
      action satisfies never
  }
}

// --- The bundled skills: Review, Resolve Comments, Fix CI, Resolve Conflicts and Create PR, and their turns ---

// What GitHub's lookup of a branch's pull requests reaches (`branch-lookup.ts`): a load's and a press's.
function branchLookupHostOf($: Engine): BranchLookupHost {
  return {
    ...hostOf($),
    storedList: () => read($, snapshotState),
    ...branchPullsStateOf($),
    log: (line) => logDebug($, line)
  }
}

// The pull requests from the checkout's branch, as a lookup last found them, which a load, a press and a skill share.
function branchPullsStateOf($: Engine): Pick<BranchLookupHost, "branchPulls" | "keepBranchPulls"> {
  return {
    branchPulls: () => read($, branchPullsState),
    keepBranchPulls: (looked) => update($, branchPullsState, () => looked)
  }
}

// What a skill's run reaches beyond a press's (`skill-runs.ts`).
function skillHostOf($: Engine, session: Session): SkillHost {
  return {
    ...pressHostOf($, session),
    ...branchPullsStateOf($),
    checkoutNow: () => checkoutNow($),
    keepCheckout: (checkout) => keepCheckout($, checkout),
    cwd: () => $.session.cwd(),
    inConversation: (line) => $.ui.log(line),
    runCommand: (command, args) => $.command.run({ command, args }),
    clearBusyIf: (mark, label) => update($, busyState, (all) => withoutBusyIf(all, mark, label)),
    isCheckingMode: () => isCheckingMode(refreshHostOf($, session), session),
    editorScheme: () => editorSchemeOf($, session)
  }
}

// The scheme of the editor the VS Code extension runs in, read once for each load of the module
// (`Session.editorScheme`); one that can't be read is none.
function editorSchemeOf($: Engine, session: Session): Promise<string | null> {
  session.editorScheme ??= $.env
    .get("VSCODE_NLS_CONFIG")
    .then((config) => editorScheme(hostOf($), config))
    .catch(() => null)

  return session.editorScheme
}

// --- A row's busy mark ---

// Checks and marks in one write (`claimedBusy`).
async function claimBusy($: Engine, mark: Mark, text: string): Promise<boolean> {
  let isClaimed = false
  await update($, busyState, (all) => {
    const claimed = claimedBusy(all, mark, text)
    isClaimed = claimed !== null

    return claimed ?? all
  })

  return isClaimed
}

async function setBusy($: Engine, mark: Mark, text: string | null): Promise<void> {
  await update($, busyState, (all) => withBusy(all, mark, text))
}

// --- The engine's services, as the rest uses them ---

// Work started from a timer, a press or another event has nobody to answer to; a failure goes to the debug log.
function background($: Engine, work: Promise<unknown>): void {
  work.catch((error: unknown) => logDebug($, `gh-prs-monitor: ${messageOf(error)}`))
}

// The transcript's id, the same after a reload, so the alerts this session showed before stay its own; a host that
// cannot say keeps the one made when the module loaded.
async function sessionId($: Engine, fallback: string): Promise<string> {
  try {
    return await $.session.id()
  } catch {
    return fallback
  }
}

// `work`, or a moment, whichever ends first.
async function withinMoment($: Engine, work: Promise<unknown>): Promise<void> {
  let timer: Timer | undefined
  try {
    await Promise.race([work, new Promise<void>((resolve) => (timer = $.clock.after(MARK_WAIT_MS, resolve)))])
  } finally {
    timer?.cancel()
  }
}

const MARK_WAIT_MS = 5_000

// The session's state outlives a reload, and this load's memory doesn't: a press or a question under way is gone (a
// load's mark went with the module's own write), and a question still showing could never be answered. A skill's turn
// still running is no longer known either, so its row gives its buttons back before the turn ends.
async function clearLeftovers($: Engine): Promise<void> {
  await update($, busyState, () => ({}))
  await update($, dialogState, () => null)
}

// The skills' tools: only the skills need them, and go on without them, so a host that refuses one is only logged.
async function registerTool($: Engine, tool: Parameters<Engine["tool"]["register"]>[0]): Promise<void> {
  try {
    await $.tool.register(tool)
  } catch (error) {
    logDebug($, `${toolName(tool)} could not be registered: ${messageOf(error)}`)
  }
}

// The name the model calls a tool by, as the engine prefixes a plugin's tools.
function toolName(tool: { name: string }): string {
  return `mcp__gh-prs-monitor__${tool.name}`
}

const CHOICES_TOOL_NAME = toolName(CHOICES_TOOL)
const TICKET_TOOL_NAME = toolName(TICKET_TOOL)

// A host that refuses the command still gets the background checks, so the failure is only logged.
async function registerCommand($: Engine): Promise<void> {
  try {
    await $.command.register({
      name: "prs",
      description: "Your open pull requests and the ones waiting on your review",
      argumentHint: "[demo|close|report|tickets]",
      immediate: true
    })
  } catch (error) {
    logDebug($, `/prs could not be registered: ${messageOf(error)}`)
  }
}

// A line for the debug log, where what went wrong in the background is told.
function logDebug($: Engine, line: string): void {
  $.ui.log(line, { to: "debug" })
}

function hostOf($: Engine): Host {
  return {
    run: (argv, init) => $.process.run(argv, init),
    read: async (path) => {
      const content = await $.fs.read(path)

      return typeof content === "string" ? content : ""
    },
    write: (path, text) => $.fs.write(path, text),
    exists: (path) => $.fs.exists(path),
    // The file system's own answer (lstat): where it ignores case, `.Claude` is the `.claude` asked about.
    isLink: (path) =>
      $.fs.stat(path).then(
        (stat) => stat.isLink,
        () => false
      )
  }
}

// What `/prs report` reads: the plugin's own manifest, Claude Code's version, and the machine's.
function reportHostOf($: Engine): ReportHost {
  const host = hostOf($)

  return {
    run: host.run,
    manifest: () => host.read(`${$.plugin.root}/.claude-plugin/plugin.json`),
    engineVersion: async () => (await $.session.version()).version
  }
}

// --- Refreshing the list ---

// Whether a reload replaced this load of the module (`module`, written as each starts): a hook of the one before, still
// finishing, as `/prs` awaiting its load, then shows nothing over the newer one's, neither a list nor a problem, and
// leaves its status line and its loading mark alone.
async function isReplaced($: Engine): Promise<boolean> {
  const current = await read($, moduleState)

  return current !== null && current.id !== LOADED
}

// What refreshing reaches through the engine and the session's state (`refresh.ts`).
function refreshHostOf($: Engine, session: Session): RefreshHost {
  return {
    ...hostOf($),
    now: () => $.clock.now(),
    every: (ms, tick) => $.clock.every(ms, tick),
    after: (ms, fire) => $.clock.after(ms, fire),
    background: (work) => background($, work),
    log: (line) => logDebug($, line),
    storedList: () => read($, snapshotState),
    merged: () => read($, mergedState),
    showList: async (snapshot, checkout) => {
      if (await isReplaced($)) {
        return null
      }
      // Read before the list is written, which draws it: another session may have set them since.
      await refreshTicketLinks($, session)
      await update($, snapshotState, () => snapshot)
      const kept = await keepCheckout($, checkout)
      await update($, problemState, () => null)

      return kept
    },
    writeProblem: async (message) => {
      if (!(await isReplaced($))) {
        await update($, problemState, () => message)
      }
    },
    // The mark is the module's own, written only while the module is the session's: a newer one that took over
    // between the read and the write keeps its mark. After `/clear`, which empties the session's state and starts no
    // session again, the record is null, and the load that saw the end writes the mark under its id, once
    // (`isStateEmptied`). Every refresh joins a load until it ends, the end mark included: one Claude Code never answers
    // would keep the list from loading again for the rest of the session, so it is waited for a moment at most.
    markLoading: async (isLoading) => {
      if (await isReplaced($)) {
        session.isStateEmptied = false

        return
      }
      const isClaiming = session.isStateEmptied
      session.isStateEmptied = false
      await withinMoment(
        $,
        update($, moduleState, (current) =>
          (current === null && isClaiming) || current?.id === LOADED ? { id: LOADED, isLoading } : current
        )
      )
    },
    keepActivity: (change) => keepNotes($, session, change),
    isDemo: () => read($, demoState),
    recall: (repo) => recallLook(storeOf($), repo),
    remember: (repo, snapshot) => rememberLook(storeOf($), repo, snapshot),
    isDrawn: async () => (await $.session.surfaces()).length > 0,
    isPaneOpen: () => isPaneOpen($),
    isPaneShown: () => isPaneShown($),
    setStatus: (text) => setStatus($, text),
    clearStatus: async () => {
      if (!(await isReplaced($))) {
        $.ui.status(undefined)
      }
    },
    notify: (text, timeoutMs) => notify($, text, timeoutMs),
    announce: (repo, lines, areChanges) => announce(toastHostOf($, session), session, repo, lines, areChanges),
    lookUpBranch: (repo, branch, head) => lookUpBranch(branchLookupHostOf($), session, repo, branch, head, false),
    cleanUp: (repo, known) => cleanUp(cleanupHostOf($, session), session, repo, known),
    recallShared: (repo, viewer) => recallShared(storeOf($), repo, viewer),
    shareAnswer: (repo, shared) => shareAnswer(storeOf($), repo, shared),
    recallClaim: (repo, viewer) => recallClaim(storeOf($), repo, viewer),
    claimFetch: (repo, claim) => claimFetch(storeOf($), repo, claim)
  }
}

// --- The plugin's dialog ---

// What the dialog reaches through the engine (`dialog-flow.ts`).
function dialogHostOf($: Engine): DialogHost {
  return {
    pane: PANE,
    now: () => $.clock.now(),
    sleep: (ms) => $.clock.sleep(ms),
    after: (ms, fire) => $.clock.after(ms, fire),
    background: (work) => background($, work),
    notify: (text, timeoutMs) => notify($, text, timeoutMs),
    panes: () => $.ui.panes(),
    surfaces: () => $.session.surfaces(),
    isPaneShown: () => isPaneShown($),
    showQuestion: (question) => update($, dialogState, () => question),
    scrollToTop: () => $.ui.scroll({ in: PANE, to: "start" }),
    scrollTo: (key, block) => $.ui.scroll({ in: PANE, to: { key }, block }),
    focus: (key) => $.ui.focus({ requestId: PANE, key }),
    redraw: () => $.ui.invalidate("ui.render"),
    askInEngine: (text, options) => $.ui.ask(text, options)
  }
}
