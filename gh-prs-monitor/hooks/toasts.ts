// Author: David Matura

// The alerts a load or a cleanup raises, on their way to the person: held while a turn runs, then shown together as
// toasts, those another session in the repository showed lately left out, with the sound where it is on.

import { holdAlerts, toastsFor } from "./alerts"
import type { RepoRef } from "./gh"
import type { Session } from "./session"

// What an alert needs to reach the person, handed in by the hooks module.
export type ToastHost = {
  now: () => Promise<number>
  notify: (text: string, timeoutMs: number) => Promise<void>
  playSound: () => void
  // Writes the held alerts (`session.alerts`) to the session's state, so a reloaded module takes them over.
  keepHeld: () => void
  // The lines no other session in the repository showed lately, now marked as this one's (`notShownElsewhere`).
  notShownElsewhere: (repo: RepoRef, lines: readonly string[]) => Promise<string[]>
}

// While a turn runs, alerts wait for it to finish (`holdAlerts`); then they show together. The time is read first, so
// the turns under way and the alerts waiting are read and written back with no await between: a turn that ends, or
// another alert raised, while the clock answers is not missed or overwritten.
export async function announce(
  host: ToastHost,
  session: Session,
  repo: RepoRef,
  lines: readonly string[]
): Promise<void> {
  const now = await host.now()
  const isHolding = session.settings.isHoldingWhileWorking && session.runningTurns.size > 0
  const { shown, waiting } = holdAlerts(session.alerts, lines, now, isHolding)
  session.alerts = waiting
  host.keepHeld()
  if (shown.length > 0) {
    await show(host, session, repo, shown)
  }
}

export async function release(host: ToastHost, session: Session): Promise<void> {
  if (session.alerts.held.length === 0 || !session.repo) {
    return
  }
  const held = session.alerts.held
  session.alerts = { held: [], heldSince: null }
  host.keepHeld()
  await show(host, session, session.repo, held)
}

async function show(host: ToastHost, session: Session, repo: RepoRef, lines: readonly string[]): Promise<void> {
  const fresh = await host.notShownElsewhere(repo, lines)
  if (fresh.length === 0) {
    return
  }
  for (const toast of toastsFor(fresh)) {
    await host.notify(toast, session.settings.alertMs)
  }
  if (session.settings.isPlayingSound) {
    host.playSound()
  }
}
