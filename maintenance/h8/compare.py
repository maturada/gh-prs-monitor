# Author: David Matura
#
# compare.py [shown] [--sorted]: each test's trace in .work/h8/B.txt and C.txt compared in the order it was emitted.
# A change that keeps behaviour gives 0 tests differing. `--sorted` compares each test's events as a multiset instead,
# to tell an order change from a content change. The loading mark's id is random per load of the hooks module, and is
# compared as ID.
import collections, difflib, pathlib, re, sys

work = pathlib.Path(__file__).resolve().parent.parent / ".work" / "h8"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
is_sorted = "--sorted" in sys.argv
shown = int(args[0]) if args else 3
MARK = re.compile(r'(\["gh-prs-monitor","module",\{"id":)"[^"]*"')


def load(path):
    traces = collections.OrderedDict()
    for line in open(path, errors="replace"):
        if line.startswith("TRACE\t"):
            _, name, rest = line.rstrip("\n").split("\t", 2)
            traces.setdefault(name, []).append(MARK.sub(r'\1"ID"', rest))
    return traces


b, c = load(work / "B.txt"), load(work / "C.txt")
names = list(dict.fromkeys([*b, *c]))
differing = []
for name in names:
    x, y = b.get(name, []), c.get(name, [])
    if is_sorted:
        x, y = sorted(x), sorted(y)
    if x != y:
        differing.append(name)
        if len(differing) <= shown:
            print("DIFF", name, f"(B {len(x)} events, C {len(y)})")
            for line in list(difflib.unified_diff(x, y, lineterm="", n=1))[2:16]:
                print("   ", line[:300])
events = sum(len(v) for v in b.values())
print(f"tests differing: {len(differing)} of {len(names)} ({'sorted' if is_sorted else 'in order'}); B events {events}")
sys.exit(1 if differing else 0)
