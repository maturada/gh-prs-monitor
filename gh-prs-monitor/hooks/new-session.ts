// Author: David Matura

import type { Host } from "./machine"
import { firstLine } from "./gh"

// Where a session of the person's own can be opened from a link: a terminal window (`claude-cli://`, Claude Code's
// handler), the desktop app (`claude://`), or a tab of the editor the VS Code extension runs in, by the editor's own
// scheme (`editorScheme`). Each types the prompt in and leaves sending it to the person. Not from the phone app.
export type SessionSurface = "terminal" | "desktop" | "vscode"

export type SessionApp = { surface: "terminal" } | { surface: "desktop" } | { surface: "vscode"; scheme: string }

export function canOpenSession(surface: string): surface is SessionSurface {
  return surface === "terminal" || surface === "desktop" || surface === "vscode"
}

// The app a new session opens in from `surface`, once New session is pressed: VS Code's by the editor's scheme, read
// only then, or where it isn't found, VS Code's own.
export async function sessionAppFor(
  surface: SessionSurface,
  readScheme: () => Promise<string | null>
): Promise<SessionApp> {
  return surface === "vscode" ? { surface, scheme: (await readScheme()) ?? VSCODE_SCHEME } : { surface }
}

const VSCODE_SCHEME = "vscode"

// Where a new session's link can't be opened: VS Code's scheme may be a guess, so there the work goes on in this
// session, as if This session had been pressed; the terminal and the desktop app give the person the command to type.
export function runsHereWhenUnopened(app: SessionApp): boolean {
  return app.surface === "vscode"
}

// The terminal opens a session in the folder given. The desktop app reads a folder under
// `<repository>/.claude/worktrees/` as the repository, then starts the session in a scratch folder of its own; a
// repository's root it keeps, so a session for a worktree opens there and enters the worktree itself. VS Code opens its
// tab at the window's own folder, so there too the session enters the worktree.
export function canOpenInWorktree(app: SessionApp): boolean {
  return app.surface === "terminal"
}

// The scheme the editor hosting the VS Code extension answers links on (`<scheme>://anthropic.claude-code/open`):
// VS Code, Insiders, Cursor and the other editors built on it each name their own, as `urlProtocol` in the
// `product.json` of the editor's app folder. The extension host is handed that folder's messages file
// (`defaultMessagesFile` in `VSCODE_NLS_CONFIG`, `<app>/out/nls.messages.json`), which leads there. null where any of
// it is missing or reads otherwise.
export async function editorScheme(host: Pick<Host, "read">, nlsConfig: string | undefined): Promise<string | null> {
  const messages = stringField(nlsConfig, "defaultMessagesFile")
  const app = messages?.match(/^(.+)([\\/])out\2nls\.messages\.json$/)
  if (!app) {
    return null
  }
  const [, folder, separator] = app
  const product = await host.read(`${folder}${separator}product.json`).catch(() => undefined)
  const scheme = stringField(product, "urlProtocol")

  return scheme !== null && /^[a-z][a-z0-9+.-]*$/.test(scheme) ? scheme : null
}

// A string field of a JSON object's text, or null where the text, the object or the field is otherwise.
function stringField(json: string | undefined, key: string): string | null {
  try {
    const value: unknown = JSON.parse(json ?? "")?.[key]

    return typeof value === "string" ? value : null
  } catch {
    return null
  }
}

// Claude Code's terminal handler takes a prompt of at most 5,000 characters, with no control character but a tab or a
// line feed (a carriage return is one), and turns any other away only after the system opened the link, too late to
// tell: so it is not opened. The desktop app's and VS Code's links are held to the same, as nothing says what they
// take. One refused is one that can't be opened (`runsHereWhenUnopened`).
const LINK_PROMPT_LIMIT = 5_000

export function linkRefusal(prompt: string): string | null {
  if (prompt.length > LINK_PROMPT_LIMIT) {
    return `its command is longer than the ${LINK_PROMPT_LIMIT.toLocaleString("en-US")} characters a link may carry`
  }

  return /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(prompt)
    ? "its command holds a control character a link may not carry"
    : null
}

// VS Code's link names no folder: the tab opens at the folder of the window the person pressed in, and a skill that
// works elsewhere is told where (`canOpenInWorktree`).
export function newSessionLink(app: SessionApp, folder: string, prompt: string): string {
  const dir = encodeURIComponent(folder)
  const q = encodeURIComponent(prompt)
  switch (app.surface) {
    case "terminal":
      return `claude-cli://open?cwd=${dir}&q=${q}`
    case "desktop":
      return `claude://code/new?folder=${dir}&q=${q}`
    case "vscode":
      return `${app.scheme}://anthropic.claude-code/open?prompt=${q}`
  }
}

// Hands the link to the system, which starts its handler; what went wrong names the link by its scheme alone.
export async function openLink(host: Host, url: string): Promise<void> {
  const opener = await openerOf(host)
  // rundll32 hands any link on and reports success whether or not anything is registered for its scheme.
  if (opener[0] === "rundll32") {
    const scheme = url.slice(0, url.indexOf(":"))
    const registered = await host.run(["reg", "query", `HKCR\\${scheme}`], { timeoutMs: 5_000 }).catch(() => null)
    if (registered?.exitCode !== 0) {
      throw new Error(`nothing on this machine opens ${scheme}:// links`)
    }
  }
  const argv = [...opener, url]
  const opened = await host.run(argv, { timeoutMs: 15_000 })
  if (opened.exitCode !== 0) {
    const reason = firstLine(opened.stderr) || `${argv[0]} exited with ${opened.exitCode}`
    throw new Error(reason.split(url).join(url.slice(0, url.indexOf("?"))))
  }
}

// The system's own opener: `open` on macOS, `xdg-open` on Linux and the BSDs, and on Windows, where `uname` is
// missing or answers from a POSIX layer, the URL handler `rundll32` starts with no shell to read the link's `&`.
async function openerOf(host: Host): Promise<string[]> {
  let system = ""
  try {
    system = (await host.run(["uname", "-s"], { timeoutMs: 5_000 })).stdout.trim()
  } catch {
    // Not there to start: Windows.
  }
  if (system === "Darwin") {
    return ["open"]
  }
  if (system !== "" && !/^(MINGW|MSYS|CYGWIN|Windows)/i.test(system)) {
    return ["xdg-open"]
  }

  return ["rundll32", "url.dll,FileProtocolHandler"]
}
