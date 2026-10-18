// Author: David Matura
//
// A Host over the real machine for probing the plugin against real git, in throwaway repositories only.
import * as fs from "node:fs"
import * as path from "node:path"

export type Result = {
  exitCode: number
  stdout: string
  stderr: string
  isStdoutTruncated: boolean
  isStderrTruncated: boolean
}
export type Gh = (argv: readonly string[], cwd: string) => Promise<Result> | Result

export const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "n",
  GIT_AUTHOR_EMAIL: "a@b",
  GIT_COMMITTER_NAME: "n",
  GIT_COMMITTER_EMAIL: "a@b",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1"
}

export function sh(argv: readonly string[], cwd: string): Result {
  const ran = Bun.spawnSync([...argv], { cwd, env: ENV, stdout: "pipe", stderr: "pipe" })
  return {
    exitCode: ran.exitCode ?? -1,
    stdout: ran.stdout.toString(),
    stderr: ran.stderr.toString(),
    isStdoutTruncated: false,
    isStderrTruncated: false
  }
}

export function realHost(sessionCwd: () => string, gh: Gh, log: string[] = []) {
  return {
    run: async (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string }) => {
      const cwd = init?.cwd ? path.resolve(sessionCwd(), init.cwd) : sessionCwd()
      log.push(`${argv.join(" ")}  @${path.basename(cwd)}`)
      if (argv[0] === "gh") return gh(argv, cwd)
      const proc = Bun.spawn([...argv], { cwd, env: { ...ENV, ...init?.env }, stdin: init?.stdin === undefined ? "ignore" : new Blob([init.stdin]), stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const exitCode = await proc.exited
      log.push(
        `  -> exit ${exitCode} ${stdout.trim().split("\n")[0].slice(0, 60)} ${stderr.trim().split("\n")[0].slice(0, 80)}`
      )
      return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
    },
    read: async (p: string) => fs.readFileSync(p, "utf8"),
    write: async (p: string, text: string) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, text)
    },
    exists: async (p: string) => fs.existsSync(p),
    isLink: async (p: string) => {
      try {
        return fs.lstatSync(p).isSymbolicLink()
      } catch {
        return false
      }
    }
  }
}

export function must(argv: readonly string[], cwd: string): string {
  const r = sh(argv, cwd)
  if (r.exitCode !== 0) throw new Error(`${argv.join(" ")} failed in ${cwd}: ${r.stderr}`)
  return r.stdout.trim()
}

export function fresh(dir: string): string {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
