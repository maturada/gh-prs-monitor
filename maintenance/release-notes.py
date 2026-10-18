# Author: David Matura
#
# A version's section of CHANGELOG.md: the notes of its GitHub release. Fails when the CHANGELOG has none.
# Usage: python3 maintenance/release-notes.py <version>
import pathlib, re, sys

version = sys.argv[1]
text = (pathlib.Path(__file__).resolve().parent.parent / "CHANGELOG.md").read_text()
section = re.search(rf"^## {re.escape(version)}(?: [^\n]*)?\n(.*?)(?=^## |\Z)", text, re.M | re.S)
if not section or not section.group(1).strip():
    sys.exit(f"CHANGELOG.md has no section for {version}: add one headed '## {version} (<date>)'.")
print(section.group(1).strip())
