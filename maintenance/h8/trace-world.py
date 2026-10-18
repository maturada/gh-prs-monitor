# Author: David Matura
#
# Inserts the harness's trace calls into a copy's hooks/testing/world.ts, each by the text of the handler it starts,
# so it holds as world.ts's lines move. Fails loudly when an anchor is missing or not unique.
import sys, pathlib
path = pathlib.Path(sys.argv[1]) / "hooks" / "testing" / "world.ts"
s = path.read_text()
anchors = [
    # A git command is traced without the setting that runs it with no hooks (`git -c core.hooksPath=/dev/null …`), so
    # two sides compare by the command itself whether or not a version passes it.
    ('  on("process.run", async ($, e) => {\n', 'traceEvent("run", e.argv.join(" ").replace(/^git -c core\\.hooksPath=\\/dev\\/null /, "git "))'),
    ('  on("store.get", async ($, e) => {\n', 'traceEvent("store.get", e.key)'),
    ('  on("store.keys", async () => {\n', 'traceEvent("store.keys", null)'),
    ('  on("store.delete", async ($, e) => {\n', 'traceEvent("store.delete", e.key)'),
    ('  on("store.set", async ($, e) => {\n', 'traceEvent("store.set", [e.key, e.value])'),
    ('  on("ui.open", async (_, e) => {\n', 'traceEvent("open", e.id)'),
    ('  on("state.set", async (_, e, next) => {\n', 'traceEvent("state", [e.plugin, e.key, e.value])'),
    ('  on("ui.panes", async () => {\n', 'traceEvent("panes", null)'),
    ('  on("audio.play", async ($, e) => {\n', 'traceEvent("sound", 1)'),
    ('  on("ui.close", async (_, e) => {\n', 'traceEvent("close", e.id)'),
    ('  on("ui.log", async ($, e) => {\n', 'traceEvent("log", [e.to, e.text])'),
    ('  on("ui.toast", async ($, e) => {\n', 'traceEvent("toast", [e.text, e.timeoutMs])'),
    ('  on("ui.status", async ($, e) => {\n', 'traceEvent("status", e.text)'),
    ('  on("command.run", async ($, e) => {\n', 'traceEvent("command", `${e.command} ${e.args}`)'),
    ('  on("tool.call", { tool: "AskUserQuestion" }, async ($, e) => {\n', 'traceEvent("ask", (e as unknown as { questions: unknown }).questions)'),
]
for anchor, call in anchors:
    if s.count(anchor) != 1:
        sys.exit(f"anchor not found once ({s.count(anchor)}): {anchor.strip()}")
    s = s.replace(anchor, anchor + "    " + call + "\n")
first_import = s.index("import ")
s = s[:first_import] + 'import { traceEvent } from "./trace"\n' + s[first_import:]
path.write_text(s)
print("traced", len(anchors), "handlers")
