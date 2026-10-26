// Author: David Matura
//
// switchToBase against real git, in a scenario's person clone: its checkout on `branch`, merged as #7 into the base.
// usage: bun run harness/switch-base.ts <personPath> <branch> [sessionFolder]
// env: BASE (main), OFFER_HEAD (the commit the note was drawn at; the session's HEAD)
import { createSession } from "../plugin/hooks/session"
import { readSettings } from "../plugin/hooks/settings"
import { switchToBase } from "../plugin/hooks/switch-base"
import { realHost, sh } from "./real-host"
import type { Result } from "./real-host"

const REPO = { host: "github.com", name: "acme/app" }
const failed = (stderr: string): Result => ({ exitCode: 1, stdout: "", stderr, isStdoutTruncated: false, isStderrTruncated: false })

const [person, branch, session = person] = process.argv.slice(2) as [string, string, string?]
const base = process.env.BASE ?? "main"
const head = process.env.OFFER_HEAD || sh(["git", "rev-parse", "HEAD"], session).stdout.trim()
const said: string[] = []
const host = {
  ...realHost(() => session, (argv) => failed(`unexpected gh call: ${argv.join(" ")}`)),
  storedList: async () => null,
  setBusy: async () => undefined,
  notify: async (text: string) => {
    said.push(text)
  },
  onInstall: () => undefined,
  changed: async () => undefined
}
await switchToBase(host as never, createSession(readSettings({})), REPO, { repo: REPO.name, branch, head, number: 7, base })
const now = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], session).stdout.trim()
const kept = sh(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], session).exitCode === 0
const at = sh(["git", "log", "-1", "--format=%s", `refs/heads/${base}`], session).stdout.trim() || "-"
const tracks = sh(["git", "config", "--get", `branch.${base}.remote`], session).stdout.trim() || "-"
const changes = sh(["git", "status", "--porcelain", "--ignored"], session).stdout.trim().replaceAll("\n", ", ") || "none"
console.log(`${said.join(" ")} | now on ${now}; ${branch} ${kept ? "kept" : "deleted"}; ${base} at "${at}", tracking ${tracks}; changes: ${changes}`)
