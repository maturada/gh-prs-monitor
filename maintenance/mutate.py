# Author: David Matura
#
# Mutation checks: MUTATE_DIR=<a copy of the plugin> python3 mutate.py <spec.json>
# Each entry of the spec is [path in the plugin, text, replacement]. The text must occur once; each mutant is put in
# the copy alone, the suite runs (through test-one.sh), and the mutant counts as CAUGHT when a test fails. The file is
# rewritten as it was after each run. Never point MUTATE_DIR at the plugin itself or an installed copy: a run that is
# cut short leaves the last mutant in place.
import json, os, pathlib, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
target = os.environ.get("MUTATE_DIR")
if not target:
    sys.exit("MUTATE_DIR is not set: point it at a copy of the plugin (rsync -a gh-prs-monitor/ <copy>/)")
target = pathlib.Path(target).resolve()
for refused in (here.parent / "gh-prs-monitor", pathlib.Path.home() / ".claude" / "plugins"):
    if target == refused.resolve() or refused.resolve() in target.parents:
        sys.exit(f"MUTATE_DIR is {target}: use a copy, not the plugin itself or an installed one")
if not (target / ".claude-plugin" / "plugin.json").exists():
    sys.exit(f"MUTATE_DIR is {target}: no plugin there")

mutants = json.loads(pathlib.Path(sys.argv[1]).resolve().read_text())
caught = 0
for path, text, replacement in mutants:
    file = target / path
    original = file.read_text()
    if original.count(text) != 1:
        print("SKIP (not found once):", text[:60].replace("\n", " "))
        continue
    file.write_text(original.replace(text, replacement))
    try:
        ran = subprocess.run(["bash", str(here / "test-one.sh"), str(target)], capture_output=True, text=True)
        fails = [line for line in ran.stdout.splitlines() if line.startswith("(fail)")]
        caught += bool(fails)
        print(("CAUGHT " if fails else "MISSED ") + str(len(fails)), "|", text[:70].replace("\n", " "))
    finally:
        file.write_text(original)
print(f"{caught} of {len(mutants)} caught; every file restored")
