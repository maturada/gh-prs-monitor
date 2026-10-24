// Author: David Matura

import { describe, expect, test } from "claude-code/testing"
import { readSettings } from "./settings"

const MINUTE = 60_000

describe("readSettings", () => {
  test("defaults; a number out of range taken at its nearest end, anything else as its default", () => {
    expect(readSettings({})).toEqual({
      refresh: "background",
      pollMs: 3 * MINUTE,
      alertKinds: [
        "ready",
        "comments",
        "reviews",
        "ci",
        "conflicts",
        "reviewRequests",
        "newCommits",
        "mentions",
        "closed"
      ],
      alertMs: 8_000,
      changesMs: 30 * MINUTE,
      isShowingStatus: true,
      includeOutdated: false,
      isPlayingSound: false,
      isSendingSystemNotification: false,
      isAlertingElsewhere: false,
      isHoldingWhileWorking: true,
      isCleaningUp: true,
      isHidingDrafts: false,
      isShowingTickets: true,
      isSharingRefreshes: true
    })
    expect(readSettings({ shareRefresh: false }).isSharingRefreshes).toBe(false)
    expect(readSettings({ showTickets: false }).isShowingTickets).toBe(false)
    expect(readSettings({ alertSeconds: 1 }).alertMs).toBe(2_000)
    expect(readSettings({ pollMinutes: 5_000 }).pollMs).toBe(1_440 * MINUTE)
    expect(readSettings({ pollMinutes: 0 }).pollMs).toBe(MINUTE)
    expect(readSettings({ pollMinutes: -5 }).pollMs).toBe(MINUTE)
    expect(readSettings({ pollMinutes: 1 }).pollMs).toBe(MINUTE)
    expect(readSettings({ recentChangesExpiryMinutes: 10 }).changesMs).toBe(10 * MINUTE)
    expect(readSettings({ recentChangesExpiryMinutes: 0 }).changesMs).toBe(MINUTE)
    expect(readSettings({ recentChangesExpiryMinutes: 1 }).changesMs).toBe(MINUTE)
    expect(readSettings({ recentChangesExpiryMinutes: 5_000 }).changesMs).toBe(1_440 * MINUTE)
    expect(readSettings({ alertSeconds: 600 }).alertMs).toBe(60_000)
    expect(readSettings({ pollMinutes: "5", alertSeconds: "20" })).toMatchObject({
      pollMs: 5 * MINUTE,
      alertMs: 20_000
    })
    for (const wrong of ["", " ", "soon", Infinity, NaN, true, ["5"]]) {
      expect(
        readSettings({ pollMinutes: wrong, alertSeconds: wrong, recentChangesExpiryMinutes: wrong })
      ).toMatchObject({
        pollMs: 3 * MINUTE,
        alertMs: 8_000,
        changesMs: 30 * MINUTE
      })
    }
    expect(readSettings({ alertComments: false, alertNewCommits: false }).alertKinds).toEqual([
      "ready",
      "reviews",
      "ci",
      "conflicts",
      "reviewRequests",
      "mentions",
      "closed"
    ])
    expect(
      readSettings({
        alertSound: true,
        systemNotification: true,
        alertOtherRepos: true,
        holdWhileWorking: false,
        cleanupWorktrees: false,
        hideDrafts: true
      })
    ).toMatchObject({
      isPlayingSound: true,
      isSendingSystemNotification: true,
      isAlertingElsewhere: true,
      isHoldingWhileWorking: false,
      isCleaningUp: false,
      isHidingDrafts: true
    })
    expect(readSettings({ refresh: "on-demand" }).isShowingStatus).toBe(false)
    expect(readSettings({ refresh: "sometimes", pollMinutes: "" })).toMatchObject({
      refresh: "background",
      pollMs: 3 * MINUTE
    })
    expect(
      readSettings({ refresh: "while-open", pollMinutes: 5, notify: false, statusLine: false, includeOutdated: true })
    ).toEqual({
      refresh: "while-open",
      pollMs: 5 * MINUTE,
      alertKinds: [],
      alertMs: 8_000,
      changesMs: 30 * MINUTE,
      isShowingStatus: false,
      includeOutdated: true,
      isPlayingSound: false,
      isSendingSystemNotification: false,
      isAlertingElsewhere: false,
      isHoldingWhileWorking: true,
      isCleaningUp: true,
      isHidingDrafts: false,
      isShowingTickets: true,
      isSharingRefreshes: true
    })
  })
})
