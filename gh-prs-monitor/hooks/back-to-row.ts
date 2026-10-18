// Author: David Matura

import type { Session } from "./session"

// What putting the pane's window back after a question needs of the engine: a scroll to an element the plugin drew,
// the pane drawn again, a pause, the keyboard moved onto an element; whether the window is still to go back (the
// person's own scroll or keys, or a question asked since, end it); and the end of it, the mark with it.
export type BackHost = {
  scrollTo: (key: string, block: "start" | "center") => Promise<{ deny?: string }>
  redraw: () => void
  sleep: (ms: number) => Promise<void>
  focus: (key: string) => Promise<unknown>
  isGoingBack: () => boolean
  end: () => void
}

export const BACK_TO_ROW_TRIES = 5
export const BACK_TO_ROW_PAUSE_MS = 200

// Back where the person was: the window on the row it showed first over the list, and the keyboard on the button
// pressed where the pane holds it and the button is drawn again, as after Cancel; a row at work shows no buttons, and
// the ring stays where it was. A plugin's scroll names something drawn rather than a row, so the list comes back with
// `mark` drawn on that row for the window to go to. A surface knows where the mark is once it has drawn the list
// again, so a try that finds none asks for that drawing and comes again a moment later; a try that moved is made once
// more, for a surface that held the window to the question's length as it moved. Where the mark is never found, the
// window goes to the button pressed. The person's own scroll or keys meanwhile end it where they are, and leave the
// ring, as moving it would scroll its button into view again.
export async function goBack(host: BackHost, mark: string, pressed: string): Promise<void> {
  let hasMoved = false
  let isUndisturbed = false
  try {
    for (let tries = 1; tries <= BACK_TO_ROW_TRIES && host.isGoingBack(); tries++) {
      const scrolled = await host.scrollTo(mark, "start").catch(() => ({ deny: "failed" }))
      if (scrolled.deny !== undefined) {
        host.redraw()
      } else if (hasMoved) {
        break
      } else {
        hasMoved = true
      }
      if (tries < BACK_TO_ROW_TRIES) {
        await host.sleep(BACK_TO_ROW_PAUSE_MS)
      }
    }
    if (!hasMoved && host.isGoingBack()) {
      await host.scrollTo(pressed, "center").catch(() => undefined)
    }
  } finally {
    isUndisturbed = host.isGoingBack()
    host.end()
  }
  if (isUndisturbed) {
    await host.focus(pressed).catch(() => undefined)
  }
}

// The pane closed: opened again, its window starts at the top, and goes back nowhere.
export function forgetWindow(session: Pick<Session, "listOffset" | "goingBack">): void {
  session.listOffset = 0
  session.goingBack = null
}

// The window over the pane moved (`ui.scroll`, the engine's move `move`, which holds it to the list's length): the
// person's own move ends a window going back, and where one over the list lands, not over a question, is kept for a
// question to put it back there, as the desktop app moves the window without drawing the pane again.
export async function windowMoved<T extends { deny?: string }>(
  session: Pick<Session, "listOffset" | "goingBack" | "asking">,
  isPerson: boolean,
  offset: number,
  move: () => Promise<T>
): Promise<T> {
  if (isPerson) {
    session.goingBack = null
  }
  const isOverList = session.asking === null
  const moved = await move()
  if (moved.deny === undefined && isOverList) {
    session.listOffset = offset
  }

  return moved
}

// The keyboard moved in the pane (`ui.focus`): the person's own move onto one of the plugin's elements ends a window
// going back; one onto the engine's own stops may be the ring set down as a question's answers go.
export function focusMoved(session: Pick<Session, "goingBack">, isPerson: boolean, isOwnElement: boolean): void {
  if (isPerson && isOwnElement) {
    session.goingBack = null
  }
}
