// Author: David Matura

// What a panel of rows is drawn with, the pane's lists and the repository picker alike: its title with how many it
// holds, the line under it and between its rows, in an app the card each row is, and the mark on a row changed lately.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from "claude-code"

import { framePadding, isTerminal } from "./layout"

type PanelKit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

// As a mail app marks what is unread: a row changed lately. Drawn after a no-break space, which keeps it on the title's
// last line.
export const CHANGED_MARK = "•"

// A panel's title and how many it holds.
export function panelTitle(kit: PanelKit, title: string, count: number): RenderElement {
  const { Box, Text } = kit

  return (
    <Box gap={1}>
      <Text bold>{title}</Text>
      <Text dimColor>{String(count)}</Text>
    </Box>
  )
}

// The line under a panel's title and between its rows. Boxes draw only whole borders, so the terminal gets a run of
// rule characters as wide as the pane (`columns`), clipped to the panel's width. An app neither clips the run (the
// desktop app wraps it onto a second line) nor draws an empty bordered box as a line, so there the rows are spaced
// apart, each a card.
export function rule(kit: PanelKit, key: string, surface: string, columns: number): RenderElement {
  const { Box, Text } = kit

  return isTerminal(surface) ? (
    <Box key={key} height={1} overflow="hidden">
      <Text dimColor>{"─".repeat(columns)}</Text>
    </Box>
  ) : (
    <Box key={key} marginTop={1} />
  )
}

// In an app, where no line can part the rows (`rule`), each is a card of its own.
export function card(kit: PanelKit, surface: string, key: string, content: RenderElement): RenderElement {
  const { Box } = kit

  return isTerminal(surface) ? (
    content
  ) : (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} {...framePadding(surface)}>
      {content}
    </Box>
  )
}
