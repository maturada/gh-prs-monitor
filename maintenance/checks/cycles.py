# Author: David Matura
#
# Import cycles among a plugin's hooks modules, type-only imports included (they are part of the design's graph).
# Usage: python3 cycles.py <plugin>/hooks
import os, re, sys

root = sys.argv[1]
graph = {}
for name in os.listdir(root):
    if not re.search(r"\.tsx?$", name) or ".test." in name:
        continue
    text = open(os.path.join(root, name)).read()
    deps = set()
    for target in re.findall(r'from\s+"\./([^"]+)"', text):
        for ext in (".ts", ".tsx"):
            if os.path.exists(os.path.join(root, target + ext)):
                deps.add(target + ext)
    graph[name] = deps

cycles, state = [], {}


def visit(node, path):
    state[node] = "open"
    for dep in sorted(graph.get(node, ())):
        if state.get(dep) == "open":
            cycles.append(path[path.index(dep):] + [dep])
        elif dep not in state:
            visit(dep, path + [dep])
    state[node] = "done"


for node in sorted(graph):
    if node not in state:
        visit(node, [node])
print("no cycles" if not cycles else "\n".join(" -> ".join(cycle) for cycle in cycles))
