# Author: David Matura
#
# The README's card: panels of screenshots on a card in GitHub's dark colours, each under a caption, side by side; a
# panel cut short fades into the card over its foot. Every picture in the plugin's README and docs is one, still or
# animated. README.md beside this file holds the rules and how to cut a screenshot for a panel.
#
#   still(target, panels): renders a card into the plugin's screenshots, cleaned by clean.py.
#   animated(target, frames): a GIF of cards, one a frame, held for its seconds, in a palette whose bytes spell no
#   command the directory's scan flags.
#
# A panel is Panel(caption, image, width, height=None, is_cut=False): `width` and `height` in CSS pixels, the image (a
# PNG) scaled to the width; with a height, the panel shows that much of it. A card is rendered at 2x, as a Retina
# screenshot, or lower where an image has fewer pixels than that, so no screenshot is scaled up (`scale_for`).
import math
import os
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from typing import NamedTuple

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FLAGGED = re.compile(rb"(?i)iex|irm|iwr|npx|curl|wget|cmd|powershell|bash")

# The rules, measured on 1.4.0's desktop.png: the card's colours and spacing, a caption's type, a panel's frame.
STYLE = """
html, body { margin: 0; background: transparent; }
.card { box-sizing: border-box; display: inline-grid; grid-auto-flow: column; column-gap: 25px; align-items: start;
  padding: 5px 25px 27px; background: #0d1117; border: 1px solid #30363d; border-radius: 11px;
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; }
h2 { margin: 20px 0 11px; color: #9198a1; font-size: 14.7px; font-weight: 500; }
.shot { border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
.shot img { display: block; }
.cut { border-bottom: none; border-radius: 8px 8px 0 0;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 108px), transparent); }
"""


class Panel(NamedTuple):
    caption: str
    image: str
    width: int
    height: int | None = None
    is_cut: bool = False


def png_size(path: str) -> tuple[int, int]:
    """A PNG's width and height, from its header."""
    with open(path, "rb") as file:
        head = file.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise SystemExit(f"{path} is not a PNG: cut the screenshot into one first.")
    return struct.unpack(">II", head[16:24])


def scale_for(panels: list[Panel]) -> float:
    """The device scale to render at: 2, or the fewest image pixels any panel has to a CSS pixel, kept to two decimals
    rounded down (rounded first to six, so 1150 / 1000 stays 1.15)."""
    return min([2.0] + [math.floor(round(png_size(panel.image)[0] / panel.width * 100, 6)) / 100 for panel in panels])


def shown_height(panel: Panel) -> int:
    """How tall a panel shows its image, in CSS pixels."""
    width, height = png_size(panel.image)
    return panel.height or math.ceil(height * panel.width / width)


def render(panels: list[Panel], out: str, scale: float) -> None:
    """The card rendered by headless Chrome into `out`, with the transparent rows under it left for clean.py."""
    cells = ""
    for panel in panels:
        size = f"width:{panel.width}px;" + (f"height:{panel.height}px;" if panel.height else "")
        image = pathlib.Path(panel.image).resolve().as_uri()
        cells += (f'<div><h2>{panel.caption}</h2><div class="shot{" cut" if panel.is_cut else ""}" style="{size}">'
                  f'<img src="{image}" style="width:{panel.width}px"></div></div>')
    with tempfile.TemporaryDirectory() as work:
        page = os.path.join(work, "card.html")
        with open(page, "w") as file:
            file.write(f'<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body>'
                       f'<div class="card">{cells}</div></body></html>')
        width = sum(panel.width for panel in panels) + 25 * (len(panels) - 1) + 52
        # The card's padding and a caption take under 100px; clean.py trims what is left under the card.
        height = max(shown_height(panel) for panel in panels) + 200
        subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", f"--force-device-scale-factor={scale}",
                        "--default-background-color=00000000", f"--window-size={width},{height}",
                        f"--screenshot={out}", pathlib.Path(page).as_uri()], check=True, capture_output=True)


def clean(render_png: str, target: str) -> None:
    subprocess.run([sys.executable, os.path.join(HERE, "clean.py"), render_png, target], check=True)


def still(target: str, panels: list[Panel]) -> None:
    with tempfile.TemporaryDirectory() as work:
        out = os.path.join(work, "render.png")
        render(panels, out, scale_for(panels))
        clean(out, target)


def animated(target: str, frames: list[tuple[list[Panel], float]]) -> None:
    """Each frame a card, all at one scale and trimmed as a still one is, then the GIF (`encode`)."""
    scale = min(scale_for(panels) for panels, _ in frames)
    with tempfile.TemporaryDirectory() as work:
        listing = os.path.join(work, "frames.txt")
        cards = []
        for index, (panels, seconds) in enumerate(frames):
            out = os.path.join(work, f"render-{index}.png")
            card = os.path.join(work, f"card-{index}.png")
            render(panels, out, scale)
            clean(out, card)
            cards.append((card, seconds))
        # ffmpeg would scale every frame to the first one's size without a word.
        if len({png_size(card) for card, _ in cards}) > 1:
            raise SystemExit("The frames' cards differ in size: shoot every frame at one size, or give each panel a "
                             "height.")
        with open(listing, "w") as file:
            for card, seconds in cards:
                file.write(f"file '{card}'\nduration {seconds}\n")
            file.write(f"file '{cards[-1][0]}'\n")
        encode(listing, target, work)


def encode(listing: str, target: str, work: str) -> None:
    """The frames `listing` names (ffmpeg's concat list), as a GIF. The plugin directory's scan flags byte runs that
    spell commands (as `iex` in 1.0.1's compact.png): another palette size encodes the same frames in other bytes, until
    one holds none."""
    palette = os.path.join(work, "palette.png")
    out = os.path.join(work, "out.gif")
    for colours in range(128, 24, -1):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
                        "-vf", f"palettegen=max_colors={colours}:stats_mode=full", palette], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-i",
                        palette, "-lavfi", "paletteuse=dither=none", "-loop", "0", out], check=True)
        with open(out, "rb") as file:
            if not FLAGGED.search(file.read()):
                shutil.copyfile(out, target)
                print(target, os.path.getsize(target), f"{colours} colours, no flagged run")
                return
    raise SystemExit("Every palette tried has a flagged run: render again a pixel wider or taller.")
