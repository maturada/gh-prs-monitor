# Author: David Matura
#
# The setup GIF of docs/tickets.md: frames of the pane as `/prs tickets` draws it, with the plugin's own texts and
# made-up data (acme/app, three of the demo's examples), in a terminal window's look; rendered at 2x by headless Chrome,
# each frame set on the README's card (card.py) and the GIF encoded there. Its frames are worked in
# maintenance/.work/gif/, and the GIF goes to the plugin's screenshots.
import html
import os
import pathlib
import subprocess

from card import Panel, animated

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, "maintenance", ".work", "gif")
GIF = os.path.join(ROOT, "gh-prs-monitor", "assets", "screenshots", "tickets.gif")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WIDTH, HEIGHT = 820, 560
CAPTION = "Ticket links, set up from one link"

STYLE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #000; font: 13px/16px Menlo, monospace; color: #f0f0f0; width: %dpx; height: %dpx; overflow: hidden; }
.chrome { height: 30px; background: #0f0f10; border-bottom: 1px solid #2a2a2a; position: relative; }
.light { position: absolute; top: 9px; width: 12px; height: 12px; border-radius: 6px; }
.main { display: flex; height: calc(100%% - 30px); }
.talk { width: 300px; padding: 14px 12px; border-right: 2px solid #3a3a3a; }
.pane { flex: 1; background: #262626; padding: 22px 8px 8px 8px; position: relative; }
.close { position: absolute; top: 4px; right: 8px; color: #8b8b8b; }
.box { border: 1px solid #d6d6d6; border-radius: 4px; padding: 7px 11px 8px 11px; margin-bottom: 14px; }
.panel { border: 1px solid #8f8f8f; border-radius: 4px; padding: 7px 11px 8px 11px; margin-bottom: 14px; }
.dim { color: #8b8b8b; } .b { font-weight: bold; } .warn { color: #f2c94c; font-weight: bold; } .ok { color: #5fd068; }
.okb { color: #5fd068; font-weight: bold; } .bad { color: #ff6b6b; font-weight: bold; } .acc { color: #9fa8ff; font-weight: bold; }
.gap { height: 16px; } .rule { border-top: 1px solid #5a5a5a; margin: 7px 0; }
.row { display: flex; } .num { width: 52px; flex-shrink: 0; } .right { margin-left: auto; }
.prompt { color: #f0f0f0; } .you { background: #3a3a3a; padding: 0 3px; }
.toast { border: 1px solid #d6d6d6; border-radius: 4px; padding: 6px 10px; margin-top: 14px; }
.field { display: flex; gap: 8px; }
.cursor { display: inline-block; width: 8px; height: 15px; background: #f0f0f0; vertical-align: -3px; }
.focus { background: #f0f0f0; color: #262626; }
""" % (WIDTH, HEIGHT)


def e(text):
    return html.escape(text)


def window(talk, pane):
    lights = "".join(
        f'<span class="light" style="left:{left}px;background:{colour}"></span>'
        for left, colour in ((12, "#ff5f57"), (32, "#febc2e"), (52, "#28c840"))
    )
    return (
        f"<!doctype html><html><head><meta charset='utf-8'><style>{STYLE}</style></head><body>"
        f'<div class="chrome">{lights}</div><div class="main"><div class="talk">{talk}</div>'
        f'<div class="pane"><span class="close">×</span>{pane}</div></div></body></html>'
    )


def talk(toast=None):
    said = (
        '<div class="prompt"><span class="you">❯ /prs tickets</span></div>'
        '<div class="dim" style="margin:4px 0 0 14px">└ gh-prs-monitor: Asking about ticket links in the pane.</div>'
    )
    if toast:
        said += f'<div class="toast"><div class="dim">gh-prs-monitor</div><div>{e(toast)}</div></div>'
    return said


def dialog(subject, text, detail, field, buttons, focused=0):
    parts = [f'<div class="box"><div><span class="b">Ticket links</span> <span class="dim">{e(subject)}</span></div>']
    parts.append(f'<div class="gap"></div><div>{e(text)}</div>')
    if detail:
        parts.append(f'<div class="dim">{e(detail)}</div>')
    if field is not None:
        parts.append(f'<div class="gap"></div>{field}')
    labels = []
    for index, (label, is_main) in enumerate(buttons):
        style = "focus b" if index == focused else ("acc" if is_main else "b")
        labels.append(f'<span class="{style}">[ {e(label)} ]</span>')
    parts.append(f'<div class="gap"></div><div>{" ".join(labels)}</div>')
    parts.append('<div class="gap"></div><div class="dim">Esc cancels</div></div>')
    return "".join(parts)


# The terminal's drawing of a text field, as Warp shows it: the label in bold before it, the placeholder dim with the
# cursor on its first letter while empty, and the engine's Enter label after it.
def field_of(value):
    if value:
        shown = f"<span>{e(value)}</span><span class='cursor'></span>"
    else:
        shown = "<span class='focus'>h</span><span class='dim'>ttps://…</span>"
    return f'<div><span class="b">Ticket link:</span> {shown} <span class="dim">↵Check</span></div>'


def row(number, title, status_class, status, details, buttons, is_last=False):
    # Each detail whole, as the pane moves one to the next line rather than part it.
    detail_html = " <span class='dim'>·</span> ".join(f'<span style="white-space:nowrap">{d}</span>' for d in details)
    button_html = " ".join(f'<span class="{c}">[ {e(b)} ]</span>' for b, c in buttons)
    return (
        f'<div class="row"><span class="num">#{number}</span><span class="b">{e(title)}</span></div>'
        f'<div style="margin-left:52px"><div class="{status_class}">{status}</div><div>{detail_html}</div>'
        f"<div>{button_html}</div></div>" + ("" if is_last else '<div class="rule"></div>')
    )


def ticket(key):
    return f'<span class="dim">{e(key)}&nbsp;⧉</span>'


def listed(with_tickets):
    def t(key):
        return [ticket(key)] if with_tickets else []

    header = (
        '<div class="panel"><div><span class="b">acme/app</span> &nbsp;<span class="ok">✅</span> 1 &nbsp;'
        '<span class="bad">❗</span> 2</div><div class="dim">updated 12:44</div>'
        '<div class="dim">[ Repositories ] [ Compact ] [ ↻ ]</div></div>'
    )
    # In the order the pane sorts them: conflicting first, then what needs you, then what can merge.
    rows = (
        row(1238, "Rename the settings fields", "bad", "❗ Conflicts",
            ['<span class="ok">CI ✓</span>', '<span class="dim">requested: a-teammate</span>'],
            [("Resolve Conflicts", "acc")])
        + row(1236, "Cache the search results", "warn", "❗ Changes Requested",
              t("APP-409") + ['<span class="ok">CI ✓</span>', '<span class="dim">changes requested: a-teammate 1h ago</span>'],
              [("Resolve Comments", "b"), ("Re-Request Review", "acc")])
        + row(1242, "Offline downloads", "okb", "✅ Ready To Merge",
              t("APP-371") + ['<span class="ok">CI ✓</span>', '<span class="ok">approved: a-teammate 2h ago</span>'],
              [("Merge", "acc")], is_last=True)
    )
    return header + (
        '<div class="panel"><div class="row"><span class="b">Your Pull Requests</span> <span class="dim">&nbsp;3</span>'
        f'<span class="right b">[ Create PR ]</span></div><div class="rule"></div>{rows}</div>'
        '<div class="panel"><span class="b">Waiting On Your Review</span> <span class="dim">&nbsp;0 &nbsp;Nothing waits '
        "on your review.</span></div>"
    )


LINK = "https://linear.app/acme/issue/APP-409"

FRAMES = [
    (window(talk(), listed(False)), 1.6),
    (window(talk(), dialog(
        "acme/app",
        "No ticket links for acme/app yet. Paste a link to any ticket from its tracker, as copied from the browser.",
        "Its pull requests then link to their tickets, found by the key in their branch or title. "
        "The link is read here alone; nothing is sent anywhere.",
        field_of(""), [("Check the link", True), ("Cancel", False)], focused=-1)), 2.4),
    (window(talk(), dialog(
        "acme/app",
        "No ticket links for acme/app yet. Paste a link to any ticket from its tracker, as copied from the browser.",
        "Its pull requests then link to their tickets, found by the key in their branch or title. "
        "The link is read here alone; nothing is sent anywhere.",
        field_of(LINK), [("Check the link", True), ("Cancel", False)], focused=-1)), 1.8),
    (window(talk(), dialog(
        "acme/app",
        "Tickets like APP-409 link to https://linear.app/acme/issue/APP-409. Save this for acme/app?",
        "#1236 Cache the search results would link APP-409.",
        None, [("Save", True), ("Cancel", False)], focused=0)), 2.8),
    (window(talk("Ticket links saved for acme/app: tickets like APP-409 link to linear.app."), listed(True)), 4.0),
]


def render():
    os.makedirs(HERE, exist_ok=True)
    pngs = []
    for index, (page, seconds) in enumerate(FRAMES):
        source = os.path.join(HERE, f"frame-{index}.html")
        target = os.path.join(HERE, f"frame-{index}.png")
        with open(source, "w") as file:
            file.write(page)
        subprocess.run(
            [CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=2",
             f"--window-size={WIDTH},{HEIGHT}", f"--screenshot={target}", pathlib.Path(source).as_uri()],
            check=True, capture_output=True)
        pngs.append((target, seconds))
    animated(GIF, [([Panel(CAPTION, target, WIDTH)], seconds) for target, seconds in pngs])

if __name__ == "__main__":
    render()
