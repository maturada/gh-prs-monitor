# Author: David Matura
#
# A change to the plugin folder since <base> is a release, as installs follow `main`: it raises `version` in plugin.json
# and gives that version a section in CHANGELOG.md. CI runs it on pull requests.
# Usage: python3 maintenance/version-check.py <base ref>
import json, pathlib, re, subprocess, sys

root = pathlib.Path(__file__).resolve().parent.parent
base = sys.argv[1]
manifest = "gh-prs-monitor/.claude-plugin/plugin.json"


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)


# A version as semantic versioning spells one (semver.org's own pattern), ASCII digits only.
SEMVER = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?",
    re.ASCII,
)


# Semantic versioning's order: build metadata ignored, a pre-release below its release, its identifiers compared as
# numbers where they are numbers, below any that aren't.
def order(version: str) -> tuple:
    spelt = SEMVER.fullmatch(version)
    if not spelt:
        sys.exit(f"`version` {version} in {manifest} is not a semantic version such as 1.2.3.")
    major, minor, patch, pre = spelt.group(1, 2, 3, 4)
    identifiers = [(0, int(each), "") if each.isdigit() else (1, 0, each) for each in pre.split(".")] if pre else []

    return ((int(major), int(minor), int(patch)), 0 if pre else 1, identifiers)


diff = git("diff", "--quiet", f"{base}...HEAD", "--", "gh-prs-monitor")
if diff.returncode == 0:
    print("The plugin folder is unchanged: no new version needed.")
    sys.exit(0)
if diff.returncode != 1:
    sys.exit(diff.stderr.strip())

before = json.loads(git("show", f"{base}:{manifest}").stdout)["version"]
now = json.loads((root / manifest).read_text())["version"]
if order(now) <= order(before):
    sys.exit(f"The plugin folder changed, so raise `version` in {manifest} above {before} (it is {now}).")
notes = subprocess.run([sys.executable, str(root / "maintenance/release-notes.py"), now], capture_output=True, text=True)
if notes.returncode != 0:
    sys.exit(notes.stderr.strip())
print(f"Version {before} -> {now}, with its CHANGELOG section.")
