// Author: David Matura

import type { Host } from "./machine"
import { firstLine } from "./gh"

// Where a session of the person's own can be opened from a link: a terminal window (`claude-cli://`, Claude Code's
// handler) or the desktop app (`claude://`). Both type the prompt in and leave sending it to the person.
export type SessionSurface = "terminal" | "desktop"

export function canOpenSession(surface: string): surface is SessionSurface {
  return surface === "terminal" || surface === "desktop"
}

// The terminal opens a session in the folder given. The desktop app reads a folder under
// `<repository>/.claude/worktrees/` as the repository, then starts the session in a scratch folder of its own; a
// repository's root it keeps, so a session for a worktree opens there and enters the worktree itself.
export function canOpenInWorktree(surface: SessionSurface): boolean {
  return surface === "terminal"
}

// Claude Code's terminal handler takes a prompt of at most 5,000 characters, with no control character but a tab or a
// line feed (a carriage return is one), and turns any other away only after the system opened the link, too late to
// tell: so it is not opened. The desktop app's link is held to the same, as nothing says what it takes; one refused
// goes to the conversation.
const LINK_PROMPT_LIMIT = 5_000

export function linkRefusal(prompt: string): string | null {
  if (prompt.length > LINK_PROMPT_LIMIT) {
    return `its command is longer than the ${LINK_PROMPT_LIMIT.toLocaleString("en-US")} characters a link may carry`
  }

  return /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(prompt)
    ? "its command holds a control character a link may not carry"
    : null
}

export function newSessionLink(surface: SessionSurface, folder: string, prompt: string): string {
  const dir = encodeURIComponent(folder)
  const q = encodeURIComponent(prompt)

  return surface === "desktop" ? `claude://code/new?folder=${dir}&q=${q}` : `claude-cli://open?cwd=${dir}&q=${q}`
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
