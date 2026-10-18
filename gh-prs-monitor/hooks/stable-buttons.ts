// Author: David Matura

import type { ButtonProps, ElementConstructor, RenderElement } from "claude-code"

// The buttons of each drawing site, by how they look, as last drawn.
export type DrawnButtons = Map<string, Map<string, RenderElement>>

// Every Button built gets a handle of its own, and a redraw lets the last drawing's handles go; the desktop app
// presses by the handle of the drawing it shows, so a press that lands just after a redraw names a handle no longer
// held, and nothing happens. A Button drawn again as it was is handed back as the same element, so its handle, and
// the drawing the app shows, stay good through any redraw. It keeps its first closure, so a press must look up what
// it acts on rather than carry it. Each site keeps only the buttons of its latest drawing.
export function stableButtons(
  drawn: DrawnButtons,
  site: string,
  Button: ElementConstructor<ButtonProps>
): ElementConstructor<ButtonProps> {
  const before = drawn.get(site) ?? new Map<string, RenderElement>()
  const now = new Map<string, RenderElement>()
  drawn.set(site, now)

  return (props) => {
    const { onPress: _onPress, ...look } = props
    const id = JSON.stringify(look)
    const element = now.get(id) ?? before.get(id) ?? Button(props)
    now.set(id, element)

    return element
  }
}
