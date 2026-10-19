# The README's screenshots

The plugin's README shows `/prs demo` in `gh-prs-monitor/assets/screenshots/`. `desktop.png` and `vscode.png` are
composites: panels of screenshots on a card in GitHub's dark colours, each under a caption. `composite.html` holds
their rules, and `clean.py` makes a render ready for the plugin. None of this folder ships with the plugin.

## Taking the screenshots

- Run `/prs demo`, so the image shows the example pull requests, never your own.
- Shoot on a Retina screen, so the screenshot is 2× and its text stays sharp in a 2× composite. A 1× screenshot is
  scaled up there and comes out soft (`vscode.png` of 1.1.0 was made from 1× screenshots).
- Make the pane about 830 points wide, the desktop app's pane in `desktop.png`, so text reads the same size across the
  README's images.
- Cut a screenshot at the app's own panel edges: the card draws each panel's frame.

## Rules (`composite.html`)

Set for a card 880px wide, as `desktop.png` is (1,760 pixels at 2×); `--scale` fits them to a screenshot of another
width, its width over 830px.

| Part | Rule |
|---|---|
| Card | `#0d1117`, a 1px `#30363d` border, corners of 11px, 25px of space at the sides and 27px at the foot |
| Caption | 14.7px, weight 500, `#9198a1`, in the system font; 20px above it, 11px below |
| Panel | the screenshot at its own width, a 1px `#30363d` frame, corners of 8px |
| A panel cut short | fades into the card over its last 108px, its frame with it |

## Making one

From the repository's root, with the screenshots in `maintenance/.work/screenshots/` beside a copy of
`composite.html` whose captions, images and `--shot`/`--scale` are set:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=2 --default-background-color=00000000 --window-size=<card width>,<more than its height> \
  --screenshot="$PWD/maintenance/.work/screenshots/render.png" "file://$PWD/maintenance/.work/screenshots/composite.html"
python3 maintenance/screenshots/clean.py maintenance/.work/screenshots/render.png gh-prs-monitor/assets/screenshots/<name>.png
```

`clean.py` trims the rows under the card, drops text and colour-profile chunks, and compresses the image again until no
run of its bytes reads as a command the directory's scan flags (as `iex` and `irm` did in 1.0.1's `compact.png`). Keep
each file under 5 MiB, the directory's limit for a file in the plugin folder.
