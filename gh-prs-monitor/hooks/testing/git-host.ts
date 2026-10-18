// Author: David Matura

// A machine in memory for the tests of what runs git and gh through a host (`Host`): commands answer from a table,
// files from a map; and the answers and paths the checkout's and the cleanup's tests share.

import type { ProcessRunResult } from "claude-code"

import { GIT } from "../machine"
import type { Host } from "../machine"

// A command run, where, and the variables it was given over the machine's own, when any.
export type Call = { argv: string; cwd: string | undefined; env?: Record<string, string> }

// A command as the tests name it: git's without the setting that runs it with no hooks (`GIT`), which every git command
// here carries, so one run without it fails the test.
export function wordsOf(argv: readonly string[]): readonly string[] {
  if (argv[0] !== "git") {
    return argv
  }
  if (!GIT.every((word, index) => argv[index] === word)) {
    throw new Error(`git run with hooks on: ${argv.join(" ")}`)
  }

  return ["git", ...argv.slice(GIT.length)]
}

export function lineOf(argv: readonly string[]): string {
  return wordsOf(argv).join(" ")
}

// A machine in memory: commands answer from a table keyed by argv (first match by prefix; an answer may be worked out
// from the command line and what it was given on stdin), files from a map.
export function fakeHost(
  answers: [string, Partial<ProcessRunResult> | ((line: string, stdin: string) => Partial<ProcessRunResult>)][],
  files: Record<string, string> = {},
  links: ReadonlySet<string> = new Set()
) {
  const calls: Call[] = []
  const written: Record<string, string> = {}
  const host: Host = {
    run: async (argv, init) => {
      const line = lineOf(argv)
      calls.push({ argv: line, cwd: init?.cwd, ...(init?.env ? { env: init.env } : {}) })
      const answer = answers.find(([prefix]) => line.startsWith(prefix))?.[1]
      const result = typeof answer === "function" ? answer(line, init?.stdin ?? "") : (answer ?? { exitCode: 0 })

      return { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false, ...result }
    },
    read: async (path) => {
      const text = written[path] ?? files[path]
      if (text === undefined) {
        throw new Error(`no file ${path}`)
      }

      return text
    },
    write: async (path, text) => {
      written[path] = text
    },
    exists: async (path) => path in files || path in written,
    isLink: async (path) => links.has(path)
  }

  return { host, calls, written }
}

// git's answer naming the clone's common folder: the main checkout is /repo.
export const COMMON_DIR: [string, Partial<ProcessRunResult>] = [
  "git rev-parse --path-format=absolute --git-common-dir",
  { stdout: "/repo/.git\n" }
]

// The worktree /prs makes for #7.
export const PATH = "/repo/.claude/worktrees/pr-7"

// The own worktree's folder on disk, for the tests where an earlier run left it.
export const OWN_FOLDER = { [PATH]: "" }

export type Ran = { exitCode: number; stdout?: string; stderr?: string }

// A host whose commands answer by `answer`, which may throw as a command that cannot start; it keeps each command run,
// with its timeout.
export function hostAnswering(answer: (argv: readonly string[]) => Ran): Host & {
  runs: { argv: readonly string[]; timeoutMs?: number }[]
} {
  const runs: { argv: readonly string[]; timeoutMs?: number }[] = []

  return {
    runs,
    run: async (argv, init) => {
      const words = wordsOf(argv)
      runs.push({ argv: words, timeoutMs: init?.timeoutMs })
      const ran = answer(words)

      return {
        exitCode: ran.exitCode,
        stdout: ran.stdout ?? "",
        stderr: ran.stderr ?? "",
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    },
    read: async () => "",
    write: async () => undefined,
    exists: async () => false,
    isLink: async () => false
  }
}
