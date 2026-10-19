// Author: David Matura

import type { Color } from "claude-code"

// The terminal draws in character cells, where a width holds a text to its length; an app draws its text in a font of
// its own, wider than a cell, so a width in cells leaves a gap after it there.
export function isTerminal(surface: string): boolean {
  return surface === "terminal"
}

// The terminal and VS Code space by rows of text: a gap or a margin of 1 is a blank line, and a button is a line high.
// The desktop app and the phone space by steps of their own, a 1 a small one, and draw a button taller than a line.
export function spacesByRows(surface: string): boolean {
  return surface === "terminal" || surface === "vscode"
}

// The space in a row of buttons that wraps: a cell between buttons, and where a surface spaces by steps, one between
// their rows too, as its buttons are boxes that would touch; buttons a line high read as rows without one.
export function buttonGaps(surface: string): { columnGap: number; rowGap: number } {
  return { columnGap: 1, rowGap: spacesByRows(surface) ? 0 : 1 }
}

// Whether a box can be placed out of the flow (`position="absolute"`): VS Code ignores the prop and lays it out in the
// flow as any other.
export function placesOutOfFlow(surface: string): boolean {
  return surface !== "vscode"
}

// Whether a surface draws toasts: the terminal, the desktop app, and VS Code above its prompt box. The phone app's own
// drawing of them is unknown, so it gets the conversation's notice.
export function drawsToasts(surface: string): boolean {
  return surface === "terminal" || surface === "desktop" || surface === "vscode"
}

// The colours the pane draws in beyond the theme's plain text.
export type PaneColour = "success" | "warning" | "error" | "merged"

// The colour to name for one on a surface. VS Code draws the theme's `warning` in its menus' text colour, so it reads
// as plain text, and knows no `merged`: there they are the editor theme's terminal yellow and magenta, which follow
// its light or dark theme as the theme's colours do.
export function colourOn(surface: string, colour: PaneColour): Color {
  if (surface === "vscode") {
    return colour === "warning" ? "yellow" : colour === "merged" ? "magenta" : colour
  }

  return colour
}
