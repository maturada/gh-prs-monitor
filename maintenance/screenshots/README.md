# The README's screenshots

Every picture in the plugin's README and docs, in `gh-prs-monitor/assets/screenshots/`, is a card: screenshots of
`/prs demo` as panels on a card in GitHub's dark colours, each under a caption, side by side. `card.py` renders one,
still or animated, and `clean.py` makes the render ready for the plugin. None of this folder ships with the plugin.

## Taking the screenshots

- Run `/prs demo`, so the picture shows the example pull requests, never your own.
- Shoot on a Retina screen, so the screenshot is 2× and its text stays sharp on the card. A 1× screenshot is scaled up
  there and comes out soft (`vscode.png` of 1.1.0 was made from 1× screenshots).
- Make the pane about 830 points wide, the desktop app's pane in `lists.png`, so text reads the same size across the
  README's pictures.
- Leave out what isn't the plugin's: close notices, usage alerts and banners before shooting.
- For a GIF, shoot every frame at one window size and position, after any animation has settled, so the frames line up.

## Cutting a screenshot for a panel

The card draws each panel's frame and rounds its corners, so a panel's image brings no frame of its own:

- Cut a pane or a window just inside its own frame line, and fill its rounded corners with the background just inside
  them.
- Or cut in plain background, with the same margin on each side; pad a side that comes out thinner with the
  background's colour.
- Find a frame line and a corner's radius from where the brightness jumps along a row or a column, not by eye: a line
  left at an edge, or a corner cut straight, shows on the card.
- A panel cut short (`is_cut`) fades into the card over its last 108px: cut it where only plain background falls in
  that band, never a button or a line of text.

## Rules (`card.py`)

Measured on 1.4.0's `desktop.png`, whose pane was 830px wide.

| Part | Rule |
|---|---|
| Card | `#0d1117`, a 1px `#30363d` border, corners of 11px; inside it 5px of space at the top, 25px at the sides, 27px at the foot |
| Caption | 14.7px, weight 500, `#9198a1`, in the system font; 20px above it, 11px below |
| Panel | the screenshot scaled to the panel's width, a 1px `#30363d` frame, corners of 8px; panels side by side 25px apart |
| A panel cut short | fades into the card over its last 108px, its frame with it |

The README's pictures use one panel 830px wide, or two of 395px.

## Making one

Cut the screenshots into PNGs in `maintenance/.work/screenshots/` (ignored by git), and name the cards in a short script
there, run from the repository's root:

```python
import sys

sys.path.insert(0, "maintenance/screenshots")
from card import Panel, animated, still

SRC = "maintenance/.work/screenshots"
OUT = "gh-prs-monitor/assets/screenshots"

still(f"{OUT}/compact.png", [
    Panel("In a terminal", f"{SRC}/terminal.png", 395, 380, is_cut=True),
    Panel("In the desktop app", f"{SRC}/desktop.png", 395, 380, is_cut=True),
])
animated(f"{OUT}/alerts.gif", [
    ([Panel("An alert, then Merge asking before it merges", f"{SRC}/alerts-{i}.png", 830, is_cut=True)], seconds)
    for i, seconds in enumerate((2.6, 2.2, 3.2))
])
```

A panel's `width` and `height` are in CSS pixels; with a `height`, the panel shows that much of its image. A card is
rendered at 2×, or lower where an image has fewer pixels than that, so no screenshot is scaled up; a GIF's frames
must come out the same size. It needs macOS with Google Chrome, and ffmpeg for a GIF.

`clean.py` trims the rows under the card, drops text and ICC-profile chunks, and compresses the image again until no
run of its bytes reads as a command the directory's scan flags (as `iex` and `irm` did in 1.0.1's `compact.png`). A
GIF is encoded again with fewer colours until none of its bytes do. Keep each file under 5 MiB, the directory's limit
for a file in the plugin folder.

## The ticket links GIF

`gh-prs-monitor/assets/screenshots/tickets.gif`, in `docs/tickets.md`, is drawn rather than shot: frames of the pane
as `/prs tickets` draws it, with the plugin's own texts and the demo's made-up repository, each set on the card. When
the dialog or a row changes, change its frames in `tickets-gif.py` to match, then, from the repository's root:

```
python3 maintenance/screenshots/tickets-gif.py
```
