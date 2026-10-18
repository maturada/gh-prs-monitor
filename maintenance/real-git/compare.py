# Author: David Matura
#
# compare.py <name A> <name B>: each case set's output of run B against run A (both in .work/real-git), with commit
# SHAs, temporary names and timings made alike.
import difflib, pathlib, re, sys

work = pathlib.Path(__file__).resolve().parent.parent / ".work" / "real-git"


def lines(path):
    out = []
    for line in path.read_text(errors="replace").splitlines():
        line = re.sub(r"\b[0-9a-f]{7,40}\b", "SHA", line)
        line = re.sub(r"(tmp|wt)\.[A-Za-z0-9]{4,6}", r"\1.X", line)
        line = re.sub(r"\b\d+(\.\d+)?m?s\b", "T", line)
        out.append(line)
    return out


a, b = sys.argv[1], sys.argv[2]
shown = int(sys.argv[3]) if len(sys.argv) > 3 else 20
differing = 0
for path in sorted((work / b).glob("*.txt")):
    before = work / a / path.name
    if not before.exists():
        print(f"{path.stem}: only in {b}")
        continue
    diff = list(difflib.unified_diff(lines(before), lines(path), lineterm="", n=1))
    if diff:
        differing += 1
        print(f"{path.stem}: differs")
        for line in diff[2 : 2 + shown]:
            print("   ", line[:220])
print(f"{differing} sets differ")
