// Author: David Matura

import type { ButtonProps, ElementConstructor, InputProps, RenderElement } from "claude-code"

// The elements of each drawing site, by how they look, as last drawn.
export type DrawnElements = Map<string, Map<string, RenderElement>>

// Every Button built gets a handle of its own, and a redraw lets the last drawing's handles go; the desktop app
// presses by the handle of the drawing it shows, so a press that lands just after a redraw names a handle no longer
// held, and nothing happens. A Button drawn again as it was is handed back as the same element, so its handle, and
// the drawing the app shows, stay good through any redraw. It keeps its first closure, so a press must look up what
// it acts on rather than carry it. Each site keeps only the buttons of its latest drawing.
export function stableButtons(
  drawn: DrawnElements,
  site: string,
  Button: ElementConstructor<ButtonProps>
): ElementConstructor<ButtonProps> {
  return stableElements(drawn, site, Button, ["onPress"], true)
}

// A text field is held by its handle as a Button is, so one built again for the redraw a keystroke asks (as the
// repository picker narrows its rows) could drop the next keystroke, or Enter, landing on the drawing before. In the
// drawing a keystroke on this surface asked for (`isTyping`), a field drawn as it was, whatever its value, is handed
// back as the same element, and the surface keeps what is being typed. Any other drawing builds it afresh with its
// value, as a surface drawing it anew (shown again, or another surface) shows the field's value: what was typed. It
// keeps its first closures, so they must look up what they act on.
export function stableInputs(
  drawn: DrawnElements,
  site: string,
  Input: ElementConstructor<InputProps>,
  isTyping: boolean
): ElementConstructor<InputProps> {
  return stableElements(drawn, site, Input, ["onInput", "onSubmit", "value"], isTyping)
}

// Elements by how they look, leaving out `unlooked` (their closures, and what changes without changing them), handed
// back as last drawn where `isReused`, else built afresh; a site keeps only those of its latest drawing.
function stableElements<P extends object>(
  drawn: DrawnElements,
  site: string,
  make: ElementConstructor<P>,
  unlooked: readonly (keyof P & string)[],
  isReused: boolean
): ElementConstructor<P> {
  const before = drawn.get(site) ?? new Map<string, RenderElement>()
  const now = new Map<string, RenderElement>()
  drawn.set(site, now)

  return (props) => {
    const look = Object.fromEntries(
      Object.entries(props).filter(([name]) => !(unlooked as readonly string[]).includes(name))
    )
    const id = JSON.stringify(look)
    const element = (isReused ? (now.get(id) ?? before.get(id)) : undefined) ?? make(props)
    now.set(id, element)

    return element
  }
}
