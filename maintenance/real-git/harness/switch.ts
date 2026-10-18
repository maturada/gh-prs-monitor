// Author: David Matura
//
// switchHere (git's own refusal, no gh pr checkout) against real git, on a copy of a scenario's person clone.
// usage: bun run harness/switch.ts <personPath> <fork 0|1>
// env: CAN_MODIFY=1 (the fork lets maintainers push), FORK_GONE=1 (head repository deleted), SHOWLOG=1
import * as path from "node:path"
import { switchHere } from "../plugin/hooks/checkout"
import type { PullRow } from "../plugin/types"
import { realHost, sh } from "./real-host"
import type { Result } from "./real-host"

const REPO = { host: "github.com", name: "acme/app" }
const ok = (stdout: string): Result => ({ exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false })
const failed = (stderr: string): Result => ({ exitCode: 1, stdout: "", stderr, isStdoutTruncated: false, isStderrTruncated: false })

// GitHub, read-only: the pull request (its head repository), gh's protocol, and whether GitHub has a commit.
function gh(root: string, fork: boolean) {
  return (argv: readonly string[]): Result => {
    const line = argv.join(" ")
    if (line.startsWith("gh api repos/acme/app/pulls/7 ")) {
      const repo = process.env.FORK_GONE ? null : { full_name: fork ? "bob/app" : "acme/app" }
      const sha = sh(["git", "rev-parse", "refs/pull/7/head"], `${root}/acme/app.git`).stdout.trim()
      return ok(JSON.stringify({ state: "open", draft: false, head: { sha, repo }, base: { ref: "main" }, maintainer_can_modify: process.env.CAN_MODIFY === "1" }))
    }
    if (line.startsWith("gh config get git_protocol")) return ok("https\n")
    const commit = /^gh api repos\/acme\/app\/commits\/(\S+)/.exec(line)
    if (commit) return sh(["git", "cat-file", "-e", `${commit[1]}^{commit}`], `${root}/acme/app.git`).exitCode === 0 ? ok("") : failed("gh: No commit found for SHA (HTTP 422)")
    return failed(`unexpected gh call: ${line}`)
  }
}

const [person, forkFlag] = process.argv.slice(2) as [string, string]
const fork = forkFlag === "1"
const row = { number: 7, headRefName: process.env.HEAD_NAME ?? "feature", isCrossRepository: fork, headOid: "" } as unknown as PullRow
const log: string[] = []
let outcome: string
try {
  await switchHere(realHost(() => person, gh(path.dirname(person), fork), log) as never, row, REPO, () => undefined)
  outcome = "SWITCHED"
} catch (error) {
  outcome = `STOPPED: ${(error as Error).message}`
}
const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], person).stdout.trim()
const config = (key: string) => sh(["git", "config", "--get", `branch.${branch}.${key}`], person).stdout.trim() || "-"
console.log(`${outcome} (now on ${branch}; remote ${config("remote")} merge ${config("merge")} pushRemote ${config("pushRemote")})`)
if (process.env.SHOWLOG) console.log(log.join("\n"))
