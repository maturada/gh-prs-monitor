// Author: David Matura
//
// prepareWorktree (git's own refusal, no gh pr checkout) against real git, in a scenario's person clone.
// usage: bun run harness/prepare.ts <personPath> <fork 0|1>
import * as path from "node:path"
import { prepareWorktree } from "../plugin/hooks/checkout"
import type { PullRow } from "../plugin/types"
import { realHost, sh } from "./real-host"
import type { Result } from "./real-host"

const REPO = { host: "github.com", name: "acme/app" }
const ok = (stdout: string): Result => ({ exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false })
const failed = (stderr: string): Result => ({ exitCode: 1, stdout: "", stderr, isStdoutTruncated: false, isStderrTruncated: false })
function gh(root: string, fork: boolean) {
  return (argv: readonly string[]): Result => {
    const line = argv.join(" ")
    if (line.startsWith("gh api repos/acme/app/pulls/7 ")) {
      const sha = sh(["git", "rev-parse", "refs/pull/7/head"], `${root}/acme/app.git`).stdout.trim()
      return ok(JSON.stringify({ state: "open", draft: false, head: { sha, repo: { full_name: fork ? "bob/app" : "acme/app" } }, base: { ref: "main" }, maintainer_can_modify: false }))
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
try {
  const made = await prepareWorktree(realHost(() => person, gh(path.dirname(person), fork), log) as never, row, REPO)
  const wt = made.path
  const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], wt).stdout.trim()
  const at = sh(["git", "rev-parse", "--short", "HEAD"], wt).stdout.trim()
  const head = sh(["git", "rev-parse", "--short", "refs/pull/7/head"], `${path.dirname(person)}/acme/app.git`).stdout.trim()
  const config = (key: string) => sh(["git", "config", "--get", `branch.${branch}.${key}`], wt).stdout.trim() || "-"
  console.log(`PREPARED ${made.warning ? `with warning: ${made.warning}` : "clean"} (on ${branch} at ${at}, PR head ${head}; remote ${config("remote")} merge ${config("merge")})`)
} catch (error) {
  console.log(`FAILED: ${(error as Error).message}`)
}
if (process.env.SHOWLOG) console.log(log.join("\n"))
