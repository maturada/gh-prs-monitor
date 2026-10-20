// Author: David Matura

import type { PluginOptions } from "claude-code"

import { ALERT_KINDS } from "./alerts"
import type { AlertKind } from "./alerts"

export type RefreshMode = "background" | "while-open" | "on-demand"

export type Settings = {
  refresh: RefreshMode
  pollMs: number
  // The kinds turned on, none while the alerts' own switch is off.
  alertKinds: AlertKind[]
  alertMs: number
  // How long the note of what changed on a pull request stays at the foot of its row, from when a refresh noticed
  // it, so a pane left open all day says what changed lately rather than everything since it opened.
  changesMs: number
  isShowingStatus: boolean
  includeOutdated: boolean
  isPlayingSound: boolean
  // The pull request changes among the alerts also go out as a system notification, one each time they show, through
  // Claude Code's own channel.
  isSendingSystemNotification: boolean
  // Alerts wait while a turn runs, and show when it is done.
  isHoldingWhileWorking: boolean
  // Worktrees /prs made go, with their branches, and the branches a switch here left, once their pull request is
  // merged or closed.
  isCleaningUp: boolean
  isHidingDrafts: boolean
  // Sessions in the same repository share one request to GitHub per interval, and what it answers.
  isSharingRefreshes: boolean
}

// Each kind's setting, named after it.
const ALERT_SETTINGS: Readonly<Record<AlertKind, string>> = {
  ready: "alertReady",
  comments: "alertComments",
  reviews: "alertReviews",
  ci: "alertCi",
  conflicts: "alertConflicts",
  reviewRequests: "alertReviewRequests",
  newCommits: "alertNewCommits",
  mentions: "alertMentions",
  closed: "alertClosed"
}

// A day; the engine's timers take no longer interval.
export const MAX_POLL_MINUTES = 1_440
const MAX_CHANGES_MINUTES = 1_440

export function readSettings(options: PluginOptions): Settings {
  const mode = options.refresh === "while-open" || options.refresh === "on-demand" ? options.refresh : "background"

  return {
    refresh: mode,
    pollMs: numberIn(options.pollMinutes, 1, MAX_POLL_MINUTES, 3) * 60_000,
    alertKinds: options.notify === false ? [] : ALERT_KINDS.filter((kind) => options[ALERT_SETTINGS[kind]] !== false),
    alertMs: numberIn(options.alertSeconds, 2, 60, 8) * 1_000,
    changesMs: numberIn(options.recentChangesExpiryMinutes, 1, MAX_CHANGES_MINUTES, 30) * 60_000,
    // Only background checks keep the summary current; on demand, or once the pane closes in while-open mode, it
    // would go stale unseen.
    isShowingStatus: options.statusLine !== false && mode === "background",
    includeOutdated: options.includeOutdated === true,
    isPlayingSound: options.alertSound === true,
    isSendingSystemNotification: options.systemNotification === true,
    isHoldingWhileWorking: options.holdWhileWorking !== false,
    isCleaningUp: options.cleanupWorktrees !== false,
    isHidingDrafts: options.hideDrafts === true,
    isSharingRefreshes: options.shareRefresh !== false
  }
}

// A number outside its range is taken at the nearest end; anything but a finite number or its text, as its default.
function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN

  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}
