// Author: David Matura
//
// The plugin's include.ts, cleanup.ts and deps.ts against real git, in throwaway repositories only.
// usage:
//   bun run harness/probe.ts copy <mainRoot> <worktreePath>            copyIncluded, prints what it copied
//   bun run harness/probe.ts prepare <person> <fork 0|1>              prepareWorktree (fake GitHub as prepareB.ts)
//   bun run harness/probe.ts remove <mainRoot> <number> <lastHead|->   removePullWorktree on the pr-<number> worktree
//   bun run harness/probe.ts first <mainRoot> <worktree> <entry...>    firstNotInMain over the entries
//   bun run harness/probe.ts deps <dir>                                ensureDependencies, installs faked (FAKE=1) or real
//   bun run harness/probe.ts projects <dir>                            projectsAt
// env: TRUNC=<bytes> cuts every git stdout longer than that, as the engine's 4 MiB cut does; SHOWLOG=1
import * as path from "node:path"
import { prepareWorktree, switchHere } from "../plugin/hooks/checkout"
import { removePullWorktree, pullWorktrees } from "../plugin/hooks/cleanup"
import { copyIncluded, firstNotInMain } from "../plugin/hooks/include"
import { ensureDependencies, projectsAt } from "../plugin/hooks/deps"
import type { PullRow } from "../plugin/types"
import { realHost, sh } from "./real-host"
import type { Result } from "./real-host"

const REPO = { host: "github.com", name: "acme/app" }
const ok = (stdout: string): Result => ({
  exitCode: 0,
  stdout,
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false
})
const failed = (stderr: string): Result => ({
  exitCode: 1,
  stdout: "",
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false
})
function gh(root: string, fork: boolean) {
  return (argv: readonly string[]): Result => {
    const line = argv.join(" ")
    if (line.startsWith("gh api repos/acme/app/pulls/7 ")) {
      const sha = sh(["git", "rev-parse", "refs/pull/7/head"], `${root}/acme/app.git`).stdout.trim()
      return ok(
        JSON.stringify({
          state: "open",
          draft: false,
          head: { sha, repo: { full_name: fork ? "bob/app" : "acme/app" } },
          base: { ref: "main" },
          maintainer_can_modify: false
        })
      )
    }
    if (line.startsWith("gh config get git_protocol")) return ok("https\n")
    const commit = /^gh api repos\/acme\/app\/commits\/(\S+)/.exec(line)
    if (commit)
      return sh(["git", "cat-file", "-e", `${commit[1]}^{commit}`], `${root}/acme/app.git`).exitCode === 0
        ? ok("")
        : failed("gh: No commit found for SHA (HTTP 422)")
    return failed(`unexpected gh call: ${line}`)
  }
}

const log: string[] = []
function hostAt(cwd: string, fork = false) {
  const real = realHost(() => cwd, gh(path.dirname(cwd), fork), log)
  const limit = Number(process.env.TRUNC ?? 0)
  const installs: string[] = []
  return {
    installs,
    host: {
      ...real,
      run: async (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string> }) => {
        if (process.env.FAKE && argv[0] !== "git" && argv[0] !== "gh" && argv[0] !== "mkdir" && argv[0] !== "cp") {
          installs.push(`${argv.join(" ")} @${init?.cwd ?? cwd}${init?.env ? ` env=${JSON.stringify(init.env)}` : ""}`)
          return ok("")
        }
        const ran = await real.run(argv, init)
        if (limit > 0 && argv[0] === "git" && ran.stdout.length > limit) {
          return { ...ran, stdout: ran.stdout.slice(0, limit), isStdoutTruncated: true }
        }
        return ran
      }
    }
  }
}

const [mode, ...rest] = process.argv.slice(2)
try {
  if (mode === "copy") {
    const [root, wt] = rest as [string, string]
    const copied = await copyIncluded(hostAt(root).host as never, root, wt)
    console.log(`COPIED ${JSON.stringify(copied)}`)
  } else if (mode === "prepare") {
    const [person, forkFlag] = rest as [string, string]
    const fork = forkFlag === "1"
    const row = {
      number: 7,
      headRefName: process.env.HEAD_NAME ?? "feature",
      isCrossRepository: fork,
      headOid: ""
    } as unknown as PullRow
    const made = await prepareWorktree(hostAt(person, fork).host as never, row, REPO)
    console.log(`PREPARED ${made.path} ${made.warning ?? "clean"}`)
  } else if (mode === "switch") {
    const [person, forkFlag] = rest as [string, string]
    const fork = forkFlag === "1"
    const row = { number: 7, headRefName: process.env.HEAD_NAME ?? "feature", isCrossRepository: fork, headOid: "" } as unknown as PullRow
    const { host, installs } = hostAt(person, fork)
    const labels: string[] = []
    const deps = await switchHere(host as never, row, REPO, (label) => labels.push(label))
    const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], person).stdout.trim()
    console.log(`SWITCHED to ${branch}; deps: ${deps ?? "(none)"}; labels ${JSON.stringify(labels)}`)
    if (installs.length) console.log(`RAN\n  ${installs.join("\n  ")}`)
  } else if (mode === "remove") {
    const [root, number, lastHead] = rest as [string, string, string]
    const { host } = hostAt(root)
    const worktree = (await pullWorktrees(host as never)).find((each) => each.number === Number(number))
    if (!worktree) throw new Error(`no pr-${number} worktree listed`)
    const outcome = await removePullWorktree(host as never, REPO, worktree, lastHead === "-" ? null : lastHead)
    console.log(`OUTCOME ${JSON.stringify(outcome)}`)
  } else if (mode === "first") {
    const [root, wt, ...entries] = rest as string[]
    const remade = (p: string) => p.split("/").includes("node_modules")
    console.log(
      `FIRST ${JSON.stringify(await firstNotInMain(hostAt(root).host as never, root!, wt!, entries, remade))}`
    )
  } else if (mode === "deps") {
    const [dir] = rest as [string]
    const { host, installs } = hostAt(dir)
    const labels: string[] = []
    const note = await ensureDependencies(host as never, dir, (label) => labels.push(label))
    console.log(`NOTE ${note}`)
    console.log(`LABELS ${JSON.stringify(labels)}`)
    if (installs.length) console.log(`RAN\n  ${installs.join("\n  ")}`)
  } else if (mode === "projects") {
    const [dir] = rest as [string]
    console.log(JSON.stringify(await projectsAt(hostAt(dir).host as never, dir), null, 1))
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} catch (error) {
  console.log(`THREW ${(error as Error).message}`)
}
if (process.env.SHOWLOG) console.log(log.join("\n"))
