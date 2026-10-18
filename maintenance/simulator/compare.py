# Author: David Matura
#
# compare.py <name A> <name B>: each row of run B against the same row of run A (both in .work/sim), every measure
# that differs, A -> B.
import glob, json, os, pathlib, sys

work = pathlib.Path(__file__).resolve().parent.parent / ".work" / "sim"


def load(name):
    rows = {}
    for path in sorted(glob.glob(str(work / name / "results" / "*.txt"))):
        for line in open(path):
            if line.startswith("{"):
                row = json.loads(line)
                rows[f"{os.path.basename(path)} | {row['name']}"] = row
    return rows


a, b = load(sys.argv[1]), load(sys.argv[2])
differing = 0
for key in sorted(b):
    if key not in a:
        print("NEW", key)
        continue
    changed = {k: (a[key].get(k), v) for k, v in b[key].items() if k not in ("name", "seeds") and a[key].get(k) != v}
    if changed:
        differing += 1
        print(key)
        for measure, (before, after) in changed.items():
            print("   ", measure, ":", before, "->", after)
print(f"compared {len(b)} rows; {differing} differ; {len(set(a) - set(b))} missing")
