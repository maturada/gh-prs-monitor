// Author: David Matura

// The writes to GitHub a row's buttons make, each behind the person's yes: merge (a stack's pull requests in order),
// auto-merge, the branch updated, ready for review, review asked again, and the failed runs re-run. What each asks and
// says is `actions.ts`'s; the look before the question and the refresh after it are `press.ts`'s.

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
  rerequestArgv,
  rerequestConfirm,
  rerequestDone,
  rerunArgv,
  rerunConfirm,
  rerunDone,
  staleNote,
  updateArgv,
  updateConfirm,
  updateDone
} from "./actions"
import type { Confirm } from "./actions"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { failedRuns, ghWrite, mergeOutcome, mergeStacked, stackOf } from "./github"
import { buttonKey } from "./keys"
import { dropMerged, lookBeforeAsking, pressing, settleAfterWrite } from "./press"
import type { PressHost } from "./press"
import { rowOf } from "./pulls"
import type { Session } from "./session"

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

export async function rerequestReview(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await askThenWrite(host, session, row, {
    action: "rerequest",
    confirm: rerequestConfirm(row),
    busy: "Re-Requesting Review…",
    argv: (_, repo) => rerequestArgv(repo, row),
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
