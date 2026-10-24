// Author: David Matura

// The alerts a load or a cleanup raises, on their way to the person: held while a turn runs, then shown together as
// toasts, what another session showed lately left out, with the sound and a system notification where they are on.

import { batchLines, holdAlerts, holdDue, nothingHeld, systemNotificationText, toastLines, toastsFor } from "./alerts"
import type { AlertBatch } from "./alerts"
import { repoKey } from "./gh"
import type { RepoRef } from "./gh"
import type { Session } from "./session"

// What an alert needs to reach the person, handed in by the hooks module.
export type ToastHost = {
  now: () => Promise<number>
  notify: (text: string, timeoutMs: number) => Promise<void>
  playSound: () => void
  // One system notification, headed `title`; never fails, as the toasts have shown what it says.
  notifySystem: (title: string, text: string) => void
  // Writes the held alerts (`session.alerts`) to the session's state, so a reloaded module takes them over.
  keepHeld: () => void
  // Runs `fire` once, `ms` from now.
  after: (ms: number, fire: () => Promise<void>) => void
  // What of the batches, each from when it was raised, no other session showed lately, now marked as this one's
  // (`notShownByOtherSessions`).
  notShownByOtherSessions: (batches: readonly AlertBatch[]) => Promise<AlertBatch[]>
}

// While a turn runs, alerts wait for it to finish (`holdAlerts`); then they show together, each weighed from when it
// was raised (`raisedAt`). The time is read first, so the turns under way and the alerts waiting are read and written
// back with no await between: a turn that ends, or another alert raised, while the clock answers is not missed or
// overwritten.
export async function announce(host: ToastHost, session: Session, batches: readonly AlertBatch[]): Promise<void> {
  const now = await host.now()
  const isHolding = session.settings.isHoldingWhileWorking && session.runningTurns.size > 0
  const raised = batches.map((batch) => ({ ...batch, raisedAt: now }))
  const isHoldStarting = session.alerts.heldSince === null
  const { shown, waiting } = holdAlerts(session.alerts, raised, now, isHolding)
  session.alerts = waiting
  host.keepHeld()
  if (isHoldStarting) {
    armHold(host, session, now)
  }
  if (shown.length > 0) {
    await show(host, session, shown)
  }
}

// A hold lasts five minutes at most (`holdAlerts`): where no other alert comes to end it, as while no checks run, its
// timer shows what it held then. One a module before a reload began is limited from when it began.
export async function limitHold(host: ToastHost, session: Session): Promise<void> {
  armHold(host, session, await host.now())
}

// The timer of the hold under way, if any, set for what is left of its five minutes at `now`.
function armHold(host: ToastHost, session: Session, now: number): void {
  const { heldSince } = session.alerts
  const due = holdDue(session.alerts, now)
  if (heldSince !== null && due !== null) {
    host.after(due, () => showOverdue(host, session, heldSince))
  }
}

// What the hold that began at `since` held, shown once its five minutes are up; a timer that fires a moment early, as
// the engine's timers and its clock can drift apart, waits the rest. A hold ended since, or begun later, is left to
// its own end.
async function showOverdue(host: ToastHost, session: Session, since: number): Promise<void> {
  if (session.alerts.heldSince !== since) {
    return
  }
  const now = await host.now()
  if (holdDue(session.alerts, now) === 0) {
    await announce(host, session, [])
  } else {
    armHold(host, session, now)
  }
}

// The alerts held for the turns, once the last has ended. Each batch carries its repository and who told it, so none
// waits for the folder's to be known; a line of no repository, as 1.4.0 held for this session alone, shows unmarked
// (`freshAlerts`).
export async function release(host: ToastHost, session: Session): Promise<void> {
  const { held } = session.alerts
  if (held.length === 0) {
    return
  }
  session.alerts = nothingHeld()
  host.keepHeld()
  await show(host, session, held)
}

// The batches no other session showed lately: as toasts, with the sound, and a system notification for each repository
// whose changes they hold, titled with it.
async function show(host: ToastHost, session: Session, batches: readonly AlertBatch[]): Promise<void> {
  const fresh = await host.notShownByOtherSessions(batches)
  if (fresh.length === 0) {
    return
  }
  // The light check's first summary, which says where things wait, leads, so the count of the rest never holds it.
  const isCheckSummary = (batch: AlertBatch): boolean => batch.kind === "line" && batch.from === "check"
  const ordered = [...fresh.filter(isCheckSummary), ...fresh.filter((batch) => !isCheckSummary(batch))]
  const lines = ordered.flatMap((batch) =>
    toastLines(batch).map((text) => ({
      text,
      elsewhere: batch.kind === "events" && batch.from === "check" ? batch.repo.name : null
    }))
  )
  for (const toast of toastsFor(lines)) {
    await host.notify(toast, session.settings.alertMs)
  }
  if (session.settings.isPlayingSound) {
    host.playSound()
  }
  if (session.settings.isSendingSystemNotification) {
    for (const [repo, lines] of changesByRepo(fresh)) {
      host.notifySystem(repo.name, systemNotificationText(lines))
    }
  }
}

// The changes' lines, by the repository they are in, in the order each first came.
function changesByRepo(batches: readonly AlertBatch[]): [RepoRef, string[]][] {
  const byRepo = new Map<string, [RepoRef, string[]]>()
  for (const batch of batches) {
    if (batch.kind === "events") {
      const key = repoKey(batch.repo)
      const [repo, lines] = byRepo.get(key) ?? [batch.repo, []]
      byRepo.set(key, [repo, [...lines, ...batchLines(batch)]])
    }
  }

  return [...byRepo.values()]
}
