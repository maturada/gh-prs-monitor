// Author: David Matura

// The writes to GitHub a row's buttons make, each behind the person's yes: merge (a stack's pull requests in order),
// auto-merge, the branch updated, ready for review, review asked of the people GitHub suggests, review asked again, and
// the failed runs re-run. What each asks and says is `actions.ts`'s; the look before the question and the refresh after
// it are `press.ts`'s.

import type { PullAction, PullRow } from "../types"
import {
  asyncMergeDone,
  confirmQuestion,
  isOffTheChoices,
  mergeArgv,
  mergeConfirm,
  mergeDone,
  OFF_THE_CHOICES_NOTE,
  readConfirm,
  readyArgv,
  readyConfirm,
  readyDone,
  REQUEST_REVIEW,
  requestArgv,
  requestDone,
  requestedAlready,
  requestQuestion,
  requestRefused,
  rerequestConfirm,
  rerequestDone,
  rerunArgv,
  rerunConfirm,
  rerunDone,
  staleFor,
  staleNote,
  updateArgv,
  updateConfirm,
  updateDone
} from "./actions"
import type { Confirm, CurrentPull } from "./actions"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { currentPull, failedRuns, ghWrite, mergeOutcome, mergeStacked, stackOf, WriteRefused } from "./github"
import { buttonKey } from "./keys"
import { dropMerged, lookBeforeAsking, pressing, settleAfterWrite, stopStale } from "./press"
import type { PressHost } from "./press"
import { rowOf } from "./pulls"
import type { Session } from "./session"
import { forgetSuggestions, suggestionsFor } from "./suggestions"

export async function merge(host: PressHost, session: Session, row: PullRow, isAutoMerge: boolean): Promise<void> {
  const snapshot = await host.storedList()
  if (!snapshot) {
    return
  }
  await pressing(host, session, row.number, "Checking…", async () => {
    const action = isAutoMerge ? "autoMerge" : "merge"
    const look = await lookBeforeAsking(host, session, action, row)
    if (!look.isGoing) {
      return
    }
    const repo = look.repo
    // Its place as GitHub has it now; the list's only where that couldn't be read.
    const placed = look.current ? look.current.stack : row.stack
    const stack =
      isAutoMerge || !look.current?.stack ? null : await stackOf(host, repo, row.number, look.current.stack.number)
    const confirm = mergeConfirm(row, snapshot.merging.methods, isAutoMerge, stack, placed)
    const method = await askConfirm(host, session, confirm, buttonKey(action, row.number))
    if (method === null) {
      return
    }
    await host.setBusy(row.number, isAutoMerge ? "Turning On Auto-Merge…" : "Merging…")
    if (stack) {
      const merged = await mergeStacked(host, { now: host.now, sleep: host.sleep }, repo, row, method)
      await host.notify(asyncMergeDone(row, stack, merged), session.settings.alertMs)
      if (merged.status === "merged") {
        for (const pull of [...stack.below.map((member) => rowOf(snapshot, member.number)), row]) {
          if (pull) {
            await dropMerged(host, session, pull)
          }
        }
      } else {
        await settleAfterWrite(host)
      }

      return
    }
    await ghWrite(host, mergeArgv(repo, row, method, isAutoMerge))
    const outcome = await mergeOutcome(host, repo, row.number)
    await host.notify(mergeDone(row, outcome), session.settings.alertMs)
    if (outcome === "merged") {
      await dropMerged(host, session, row)
    } else {
      await settleAfterWrite(host)
    }
  })
}

export async function updateBranch(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await askThenWrite(host, session, row, {
    action: "updateBranch",
    confirm: updateConfirm(row),
    busy: "Updating The Branch…",
    argv: (how, repo) => updateArgv(repo, row, how),
    done: (output) => updateDone(row, output)
  })
}

export async function markReady(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await askThenWrite(host, session, row, {
    action: "ready",
    confirm: readyConfirm(row),
    busy: "Marking It Ready…",
    argv: (_, repo) => readyArgv(repo, row),
    done: () => readyDone(row)
  })
}

// Request Review: those of the people GitHub suggests (`suggestionsFor`) the person picks are asked, once GitHub is
// looked at again (`stillToAsk`): a pull request that moved on asks nobody, and anyone asked meanwhile is left out.
export async function requestReview(host: PressHost, session: Session, row: PullRow): Promise<void> {
  const snapshot = await host.storedList()
  if (!snapshot) {
    return
  }
  await pressing(host, session, row.number, "Checking…", async () => {
    // None to offer where a load forgot them since the button was drawn: the row draws without it, and GitHub is asked
    // nothing.
    const suggested = suggestionsFor(session, snapshot, row)
    if (suggested.length === 0) {
      return
    }
    const look = await lookBeforeAsking(host, session, "requestReview", row)
    if (!look.isGoing) {
      return
    }
    const names = unasked(suggested, look.current)
    if (names.length === 0) {
      await askedAlready(host, session, snapshot.repo, row, suggested)

      return
    }
    const picks = await askWhom(host, row, names)
    if (picks.length === 0) {
      return
    }
    const asking = await stillToAsk(host, session, look.repo, row, picks)
    if (asking === null) {
      return
    }
    if (asking.length === 0) {
      await askedAlready(host, session, snapshot.repo, row, picks)

      return
    }
    await host.setBusy(row.number, "Requesting Review…")
    try {
      await ghWrite(host, requestArgv(look.repo, row, asking))
    } catch (error) {
      throw error instanceof WriteRefused ? new WriteRefused(requestRefused(error.message)) : error
    }
    forgetSuggestions(session, snapshot.repo, row.number)
    await host.notify(requestDone(row, asking), session.settings.alertMs)
    await settleAfterWrite(host)
  })
}

// Those of `logins` the pull request as it stands asks nobody of yet; all of them where it couldn't be looked up.
function unasked(logins: readonly string[], current: CurrentPull | null): string[] {
  return logins.filter((login) => !current?.requested.includes(login))
}

// Whom the person picks among `names`; nobody on Cancel, or with the question dismissed.
async function askWhom(host: PressHost, row: PullRow, names: readonly string[]): Promise<string[]> {
  const answer = await host.ask(requestQuestion(row, names), buttonKey("requestReview", row.number))

  return answer?.choice === REQUEST_REVIEW ? (answer.picks ?? []) : []
}

// Those picked still to ask, once GitHub is looked at again, as the question may have been open for minutes: none
// (null) where the pull request moved on, which is said; all of them where the lookup fails, GitHub having the last word.
async function stillToAsk(
  host: PressHost,
  session: Session,
  repo: RepoRef,
  row: PullRow,
  picks: readonly string[]
): Promise<string[] | null> {
  const found = await currentPull(host, repo, row.number)
  const current = "pull" in found ? found.pull : null
  const stale = current ? staleFor("requestReview", row, current) : null
  if (stale !== null) {
    await stopStale(host, session, row, stale)

    return null
  }

  return unasked(picks, current)
}

// Everyone Request Review would ask was asked on GitHub already: said so, and the list read again, the names kept for
// the row forgotten, as out of date, so the next load asks GitHub afresh.
async function askedAlready(
  host: PressHost,
  session: Session,
  repo: string,
  row: PullRow,
  logins: readonly string[]
): Promise<void> {
  forgetSuggestions(session, repo, row.number)
  await host.notify(requestedAlready(row, logins), session.settings.alertMs)
  await settleAfterWrite(host)
}

export async function rerequestReview(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await askThenWrite(host, session, row, {
    action: "rerequest",
    confirm: rerequestConfirm(row),
    busy: "Re-Requesting Review…",
    argv: (_, repo) => requestArgv(repo, row, row.rerequestFrom),
    done: () => rerequestDone(row)
  })
}

// A write that is one gh command behind one question: the button that starts it, what the row says while it runs, the
// command for the answer, and what to say from its output.
type SimpleWrite<T> = {
  action: PullAction
  confirm: Confirm<T>
  busy: string
  argv: (answer: T, repo: RepoRef) => string[]
  done: (output: string) => string
}

async function askThenWrite<T>(host: PressHost, session: Session, row: PullRow, write: SimpleWrite<T>): Promise<void> {
  await pressing(host, session, row.number, "Checking…", async () => {
    const look = await lookBeforeAsking(host, session, write.action, row)
    if (!look.isGoing) {
      return
    }
    const answer = await askConfirm(host, session, write.confirm, buttonKey(write.action, row.number))
    if (answer === null) {
      return
    }
    await host.setBusy(row.number, write.busy)
    const ran = await ghWrite(host, write.argv(answer, look.repo))
    await host.notify(write.done(`${ran.stdout}\n${ran.stderr}`), session.settings.alertMs)
    await settleAfterWrite(host)
  })
}

export async function rerun(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await pressing(host, session, row.number, "Looking Up The Failed Checks…", async () => {
    const look = await lookBeforeAsking(host, session, "rerun", row)
    if (!look.isGoing) {
      return
    }
    const repo = look.repo
    const { headOid, runs, hasActionsRuns } = await failedRuns(host, repo, row.number)
    // New commits since the pane last refreshed have runs of their own; the dialog would name the wrong ones.
    if (headOid && row.headOid && headOid !== row.headOid) {
      await host.notify(staleNote(row, "moved"), session.settings.alertMs)
      await settleAfterWrite(host)

      return
    }
    // None failing now: re-run already, by the person or another, while the list still showed the failure.
    if (runs.length === 0 && hasActionsRuns) {
      await host.notify(`#${row.number}: none of its GitHub Actions runs is failing now`, session.settings.alertMs)
      await settleAfterWrite(host)

      return
    }
    if (runs.length === 0) {
      await host.notify(
        `#${row.number}: the failed checks are not GitHub Actions runs, so they can't be re-run from here.`,
        session.settings.alertMs
      )

      return
    }
    if ((await askConfirm(host, session, rerunConfirm(row, runs), buttonKey("rerun", row.number))) === null) {
      return
    }
    await host.setBusy(row.number, "Re-Running…")
    // One run refusing (already re-running, say) leaves the others to go.
    const refusals: string[] = []
    for (const run of runs) {
      try {
        await ghWrite(host, rerunArgv(repo, run))
      } catch (error) {
        refusals.push(messageOf(error))
      }
    }
    await host.notify(rerunDone(row, runs.length, refusals), session.settings.alertMs)
    await settleAfterWrite(host)
  })
}

async function askConfirm<T>(
  host: PressHost,
  session: Session,
  confirm: Confirm<T>,
  pressed: string
): Promise<T | null> {
  const answer = await host.ask(confirmQuestion(confirm), pressed)
  if (isOffTheChoices(confirm, answer)) {
    await host.notify(OFF_THE_CHOICES_NOTE, session.settings.alertMs)
  }

  return readConfirm(confirm, answer)
}
