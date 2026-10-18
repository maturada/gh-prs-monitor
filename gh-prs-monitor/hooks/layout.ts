// Author: David Matura

// The terminal draws in character cells, an app (the desktop one) in pixels, and the two separate rows differently.
export function isTerminal(surface: string): boolean {
  return surface === "terminal"
}

// The space in a row of buttons that wraps: a cell between buttons, and in an app a line between their rows too, as
// its buttons are boxes that would touch; the terminal's bracketed ones read as rows without one.
export function buttonGaps(surface: string): { columnGap: number; rowGap: number } {
  return { columnGap: 1, rowGap: isTerminal(surface) ? 0 : 1 }
}
