// Author: David Matura

import type { Color } from "claude-code"

// The terminal draws in character cells, where a width holds a text to its length; an app draws its text in a font of
// its own, wider than a cell, so a width in cells leaves a gap after it there.
export function isTerminal(surface: string): boolean {
  return surface === "terminal"
}

// The terminal and VS Code space by rows of text: a gap or a margin of 1 is a blank line. The desktop app and the phone
// space by steps of their own, a 1 a small one, and draw a button taller than a line.
export function spacesByRows(surface: string): boolean {
  return surface === "terminal" || surface === "vscode"
}

// The space down that keeps a button's frame off what is above or below it: a step where a surface spaces by steps,
// none in the terminal, whose buttons are text a line high. VS Code frames its buttons but spaces by whole lines, so
// there a quarter of one.
export function buttonsApart(surface: string): number {
  return surface === "vscode" ? QUARTER_LINE : spacesByRows(surface) ? 0 : 1
}

// A line of space that parts what reads apart, as a row's note from the row: a blank line in the terminal, a step in
// the desktop app. In VS Code a whole line under framed buttons reads as the gap between rows, so a quarter of one.
export function lineApart(surface: string): number {
  return surface === "vscode" ? QUARTER_LINE : 1
}

// VS Code draws a frame flush on what it holds, where framed buttons at its top or foot would touch it: there a frame
// keeps a quarter of a line inside, above and below.
export function framePadding(surface: string): { paddingY?: number } {
  return surface === "vscode" ? { paddingY: QUARTER_LINE } : {}
}

const QUARTER_LINE = 0.25

// The space in a row of buttons that wraps: a cell between buttons, and their frames apart between its rows.
export function buttonGaps(surface: string): { columnGap: number; rowGap: number } {
  return { columnGap: 1, rowGap: buttonsApart(surface) }
}

// VS Code wraps a row Box's children onto lines of their own unless told not to, where the terminal keeps them on one:
// a row that must stay one line, as a number beside its title, says so there.
export function unwrapped(surface: string): { flexWrap?: "nowrap" } {
  return surface === "vscode" ? { flexWrap: "nowrap" } : {}
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
