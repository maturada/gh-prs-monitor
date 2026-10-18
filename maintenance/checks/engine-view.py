# Author: David Matura
#
# engine-view.py <before dir> <after dir>: `claude plugin validate --json` on both, each folder's path made ROOT; the
# hooks module's hooks, calls and state reads and writes must read the same (a moved function may change the "via"
# names only where the step says so: those lines are printed for the step to check).
import json, subprocess, sys, difflib
def view(path):
    out = subprocess.run(["claude", "plugin", "validate", path, "--json"], capture_output=True, text=True).stdout
    return json.dumps(json.loads(out.replace(path.rstrip("/"), "ROOT")), indent=1).split("\n")
a, b = view(sys.argv[1]), view(sys.argv[2])
diff = list(difflib.unified_diff(a, b, "before", "after", lineterm="", n=0))
print("\n".join(diff[:60]) if diff else "engine's view: identical")
sys.exit(1 if diff else 0)
