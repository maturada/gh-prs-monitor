# Author: David Matura
#
# The repository's README.md, made from the plugin's: the plugin's is the one people read in an install and in
# Anthropic's directory, and the copy is what GitHub shows at the root. Above the plugin's `[//]: # (header end)` line
# its logo, title and tagline become a centred header with the repository's badges, as GitHub draws HTML and the
# directory takes Markdown images only; below it, its relative links are pointed into the plugin folder.
# Usage: python3 maintenance/readme.py [--check]; --check writes nothing and fails when the copy is out of date.
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
plugin = "gh-prs-monitor"
marker = "[//]: # (header end)\n"
note = f"<!-- Made from {plugin}/README.md by maintenance/readme.py: edit that file, then run it. -->\n\n"
# A Markdown link's or image's target that is a path in the repository: not a URL, an anchor, an absolute path or
# another scheme such as mailto.
relative = re.compile(r"\]\((?![a-z][a-z0-9+.-]*:|#|/)([^)\s]+)", re.I)

repository = json.loads((root / plugin / ".claude-plugin/plugin.json").read_text())["repository"]
source = (root / plugin / "README.md").read_text()
if source.count(marker) != 1:
    sys.exit(f"{plugin}/README.md needs one line `{marker.strip()}` after its title and tagline.")
head, body = source.split(marker)


# The sections the header's links lead to, each a `## ` heading of the README.
nav = ["What it does", "Get started", "Features", "Commands", "Documentation"]


# The anchor GitHub gives a heading.
def slug(heading: str) -> str:
    return re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")


missing = [name for name in nav if f"\n## {name}\n" not in body]
if missing:
    sys.exit(f"{plugin}/README.md has no `## ` heading for the header's link to: {', '.join(missing)}")


def header(head: str) -> str:
    title = re.search(r"^# (.+)$", head, re.M).group(1)
    tagline = " ".join(head[head.index(f"# {title}") + len(title) + 2 :].split())
    tagline = re.sub(r"\*\*(.+?)\*\*\s*", r"<strong>\1</strong><br>\n  ", tagline)
    badge = "https://img.shields.io/badge"
    name = repository.removeprefix("https://github.com/")
    colors = "color=2f3d5c&labelColor=1c2333"

    return f"""<p align="center">
  <img src="{plugin}/assets/logo.svg" width="112" height="112" alt="{title} logo">
</p>

<h1 align="center">{title}</h1>

<p align="center">
  {tagline}
</p>

<p align="center">
  <a href="{repository}/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/{name}/ci.yml?branch=main&label=CI&labelColor=1c2333" alt="CI"></a>
  <a href="{repository}/releases/latest"><img src="https://img.shields.io/github/v/release/{name}?label=release&{colors}" alt="Latest release"></a>
  <img src="{badge}/Claude_Code-plugin-2f3d5c?labelColor=1c2333" alt="Claude Code plugin">
  <a href="LICENSE"><img src="{badge}/license-MIT-2f3d5c?labelColor=1c2333" alt="MIT license"></a>
</p>

<p align="center">
  {" · ".join(f'<a href="#{slug(name)}">{name}</a>' for name in nav)} ·
  <a href="{repository}/issues">Issues</a>
</p>

"""


# Outside code, where a `](` is text, not a link.
def pointed(line: str) -> str:
    spans = line.split("`")
    return "`".join(relative.sub(rf"]({plugin}/\1", span) if index % 2 == 0 else span for index, span in enumerate(spans))


lines, fenced = [], False
for line in body.splitlines(keepends=True):
    fence = line.lstrip().startswith("```")
    lines.append(line if fenced or fence else pointed(line))
    fenced = fenced != fence

made = note + header(head) + "".join(lines).lstrip("\n")
copy = root / "README.md"
if "--check" in sys.argv[1:]:
    if not copy.exists() or copy.read_text() != made:
        sys.exit(f"README.md is not made from {plugin}/README.md: run python3 maintenance/readme.py")
else:
    copy.write_text(made)
