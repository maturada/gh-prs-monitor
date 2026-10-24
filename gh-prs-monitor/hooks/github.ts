// Author: David Matura

// The requests to GitHub through its CLI, on the host the hooks module hands in (`Host`): the repository, the lists,
// how pull requests ended, one as it stands now, its stack, a merge's outcome, failed runs, and the writes `actions.ts`
// words. A worktree's checkout and cleanup ask GitHub among their git steps (`checkout.ts`), as the lookup of a
// branch's pull requests does (`branch-lookup.ts`).

import type { ProcessRunResult } from "claude-code"

import type { MergeMethod, PullRow } from "../types"
import {
  asyncMergeArgv,
  asyncMergeStatusArgv,
  FAILED_RUNS_QUERY,
  MERGE_STATE_QUERY,
  readAsyncMerge,
  readCurrentPull,
  readFailedRuns,
  readMergeOutcome,
  readStack
} from "./actions"
import type { AsyncMerge, CurrentPull, FailedRuns, MergeOutcome, Stack } from "./actions"
import type { Host } from "./machine"
import { closedQuery, readClosed } from "./ended"
import type { ClosedState } from "./ended"
import {
  describeGhFailure,
  firstLine,
  GH_MISSING,
  ghApiArgv,
  ghRunFailure,
  isNotStarted,
  messageOf,
  parseRepoView
} from "./gh"
import type { GhProblem, RepoRef } from "./gh"
import { isStackless, noAccessProblem, pullSearches, pullsQuery } from "./pulls"

// The clock a merge in the background is waited out by.
export type Clock = { now: () => Promise<number>; sleep: (ms: number) => Promise<void> }

// Whether GitHub has the commit: one this clone made and never pushed it lacks.
export async function hasCommit(host: Host, repo: RepoRef, commit: string): Promise<boolean> {
  const known = await host.run([...ghApiArgv(repo, `commits/${commit}`), "--silent"], { timeoutMs: 60_000 })

  return known.exitCode === 0
}

// A GraphQL request about the repository: its owner and name, the query's other variables (`-f` takes text, `-F` a
// number), and the query.
export function graphqlArgv(
  repo: RepoRef,
  query: string,
  variables: Readonly<Record<string, string | number>> = {}
): string[] {
  const [owner, name] = repo.name.split("/")

  return [
    ...["gh", "api", "graphql", "--hostname", repo.host, "-f", `owner=${owner}`, "-f", `name=${name}`],
    ...Object.entries(variables).flatMap(([key, value]) => [
      typeof value === "number" ? "-F" : "-f",
      `${key}=${value}`
    ]),
    ...["-f", `query=${query}`]
  ]
}

// What gh answered, or what kept it from answering: gh missing or not finishing (`rejectionProblem`), or what gh and
// GitHub said of the failure (`ghRunFailure`); an API error whose answer still holds data is an answer, which the
// caller reads. A problem comes with gh's own first line, or the reason the run rejected (`said`), which a load or a
// press that fails keeps in the debug log, and the run where gh ran, for a caller that tells one failure from another
// by its words.
export type GhAnswer = { ran: ProcessRunResult } | { problem: GhProblem; said: string; ran?: ProcessRunResult }

// Every request to GitHub goes through here, but the writes, whose refusals are gh's own words (`ghWrite`), and the
// lookups any failure of which is none (`stackOf`, `mergeOutcome`, a stacked merge's look at its status).
export async function ghRun(host: Host, argv: string[], timeoutMs: number): Promise<GhAnswer> {
  let ran: ProcessRunResult
  try {
    ran = await host.run(argv, { timeoutMs })
  } catch (error) {
    return { problem: await rejectionProblem(host, error), said: messageOf(error) }
  }
  const failure = ghRunFailure(ran)

  return failure ? { problem: failure, said: firstLine(ran.stderr), ran } : { ran }
}

// A request's rejection where GitHub could not say: what kept it from saying, worded for the person (`problem`), with
// what gh said as its message (`said`).
export class GhFailure extends Error {
  constructor(
    readonly problem: GhProblem,
    said: string
  ) {
    super(said || problem.message)
  }
}

// gh's answer, or a rejection with what kept it from coming (`GhFailure`).
async function answerOf(host: Host, argv: string[], timeoutMs: number): Promise<ProcessRunResult> {
  const asked = await ghRun(host, argv, timeoutMs)
  if ("problem" in asked) {
    throw new GhFailure(asked.problem, asked.said)
  }

  return asked.ran
}

// What kept a request from answering, worded for the person, from its rejection (`GhFailure`); else the error's words.
export function problemOf(error: unknown): GhProblem {
  return error instanceof GhFailure ? error.problem : { message: messageOf(error), isPermanent: false }
}

// How long gh may take to say how GitHub writes a repository's name, or whether it is signed in to a server.
export const GH_LOOKUP_TIMEOUT_MS = 30_000

// Whether the GitHub CLI is signed in to `server`, by the account it uses there (`--active`): another account's trouble
// on the same server, as an expired token, is none of the plugin's.
export function authStatus(host: Host, server: string): Promise<GhAnswer> {
  return ghRun(host, ["gh", "auth", "status", "--active", "--hostname", server], GH_LOOKUP_TIMEOUT_MS)
}

// The session's folder's repository, as gh finds it from the git remote, or another one named (`named`, as typed), as
// GitHub writes its name; or what kept it from being found.
export async function viewRepo(host: Host, named?: RepoRef): Promise<{ repo: RepoRef } | { problem: GhProblem }> {
  const asked = await ghRun(
    host,
    [
      ...["gh", "repo", "view", ...(named ? [`https://${named.host}/${named.name}`] : [])],
      ...["--json", "nameWithOwner,url", "--jq", '.nameWithOwner + " " + .url']
    ],
    GH_LOOKUP_TIMEOUT_MS
  )
  if ("problem" in asked) {
    // A repository named is named in what is said of it, as a list's is (`noAccessProblem`).
    const isMissing = named && /could not resolve to a repository/i.test(asked.said)

    return { problem: isMissing ? { message: noAccessProblem(named.name), isPermanent: true } : asked.problem }
  }
  const repo = parseRepoView(asked.ran.stdout)

  return repo ? { repo } : { problem: describeGhFailure(asked.ran.stderr) }
}

// `run` rejects when gh cannot start or outlives its timeout; whether gh starts at all tells the two apart. A
// `gh --version` that only ran out of time, on a machine under load, says nothing of gh missing.
async function rejectionProblem(host: Host, error: unknown): Promise<GhProblem> {
  try {
    await host.run(["gh", "--version"], { timeoutMs: 10_000 })
  } catch (versionError) {
    if (isNotStarted(versionError)) {
      return GH_MISSING
    }
  }

  return { message: `The GitHub CLI did not finish (${messageOf(error)}).`, isPermanent: false }
}

// How long the request for the lists may take.
export const LIST_QUERY_TIMEOUT_MS = 30_000

// The lists of pull requests, by the searches `pullSearches` writes, with their stacks or without.
export function queryPulls(host: Host, repo: RepoRef, withStacks: boolean): Promise<GhAnswer> {
  const { mine, requested, commented, reviewed, mentioned } = pullSearches(repo.name)
  const argv = graphqlArgv(repo, pullsQuery(withStacks), { mine, requested, commented, reviewed, mentioned })

  return ghRun(host, argv, LIST_QUERY_TIMEOUT_MS)
}

// The lists, asked with stacked pull requests until the repository's server says it has none; `stackless` keeps the
// servers that said so, which are asked without them from then on.
export async function askPulls(host: Host, repo: RepoRef, stackless: Set<string>): Promise<GhAnswer> {
  const withStacks = !stackless.has(repo.host)
  const asked = await queryPulls(host, repo, withStacks)
  if (!withStacks || !asked.ran || !isStackless(asked.ran.stdout)) {
    return asked
  }
  stackless.add(repo.host)

  return queryPulls(host, repo, false)
}

// The session's repository for a press or a typed skill, looked up here where no load has found it since a reload, and
// kept on the session (`repo`). What kept it from being found is the loads' to show, and to stop the checks for: a
// press may end after a load that worked.
export async function sessionRepo(
  host: Host,
  session: { repo: RepoRef | null }
): Promise<{ repo: RepoRef } | { problem: GhProblem }> {
  if (session.repo) {
    return { repo: session.repo }
  }
  const viewed = await viewRepo(host)
  if ("repo" in viewed) {
    session.repo ??= viewed.repo
  }

  return session.repo ? { repo: session.repo } : viewed
}

// How many pull requests one request asks how they ended.
export const CLOSED_LOOKUP_LIMIT = 30

// How pull requests ended, asked of GitHub in one request. Rejects where GitHub answered about none of them.
export async function pullStates(host: Host, repo: RepoRef, numbers: readonly number[]): Promise<ClosedState[]> {
  // A number GitHub cannot find fails the run but leaves the others' answers in its output.
  const ran = await answerOf(host, graphqlArgv(repo, closedQuery(numbers)), 30_000)
  const states = readClosed(ran.stdout)
  if (states === null) {
    throw new GhFailure({ message: "GitHub sent no answer.", isPermanent: false }, firstLine(ran.stderr))
  }

  return states
}

// Whether GitHub has commit `head` at `tip` or before it. One GitHub doesn't have, as a commit never pushed, is not;
// rejects where GitHub could not say.
export async function isWithinOnGithub(host: Host, repo: RepoRef, head: string, tip: string): Promise<boolean> {
  const asked = await ghRun(host, [...ghApiArgv(repo, `compare/${head}...${tip}`), "--jq", ".status"], 30_000)
  if (!("problem" in asked)) {
    return ["identical", "ahead"].includes(asked.ran.stdout.trim())
  }
  if (/\(HTTP (404|422)\)/.test(asked.ran?.stderr ?? "")) {
    return false
  }
  throw new GhFailure(asked.problem, asked.said)
}

// The pull request as GitHub has it now, or what kept it from being read; `withBase`, also how far behind its base its
// head is, which only a comparison of the two says (the pull request's own `mergeable_state` says "behind" only where
// the base must be up to date to merge). A comparison GitHub doesn't answer leaves that unknown.
export async function currentPull(
  host: Host,
  repo: RepoRef,
  pullNumber: number,
  { withBase = false }: { withBase?: boolean } = {}
): Promise<{ pull: CurrentPull } | { problem: GhProblem }> {
  const asked = await ghRun(host, ghApiArgv(repo, `pulls/${pullNumber}`), 10_000)
  if ("problem" in asked) {
    return { problem: asked.problem }
  }
  const pull = asked.ran.exitCode === 0 ? readCurrentPull(asked.ran.stdout) : null
  if (!pull) {
    return { problem: { message: UNREAD_PULL, isPermanent: false } }
  }
  if (!withBase || pull.state !== "open" || pull.base === null || pull.headOid === null) {
    return { pull }
  }
  const base = pull.base.split("/").map(encodeURIComponent).join("/")
  const compared = await ghRun(
    host,
    [...ghApiArgv(repo, `compare/${base}...${pull.headOid}`), ...["--jq", ".behind_by"]],
    10_000
  )
  const behind = "problem" in compared ? "" : compared.ran.stdout.trim()

  return { pull: { ...pull, behindBase: /^\d+$/.test(behind) ? Number(behind) : null } }
}

const UNREAD_PULL = "GitHub's answer about the pull request could not be read."

// The stack a pull request is in, which GitHub merges only through its asynchronous merge; null for one in none, and
// for one GitHub did not answer about, which the plain merge then tries and GitHub's refusal explains.
export async function stackOf(
  host: Host,
  repo: RepoRef,
  pullNumber: number,
  stackNumber: number
): Promise<Stack | null> {
  try {
    const stack = await host.run(ghApiArgv(repo, `stacks/${stackNumber}`), {
      timeoutMs: 30_000
    })

    return stack.exitCode === 0 ? readStack(stack.stdout, pullNumber) : null
  } catch {
    return null
  }
}

export async function mergeOutcome(host: Host, repo: RepoRef, pullNumber: number): Promise<MergeOutcome> {
  try {
    const ran = await host.run(graphqlArgv(repo, MERGE_STATE_QUERY, { number: pullNumber }), { timeoutMs: 30_000 })

    return readMergeOutcome(ran.stdout)
  } catch {
    return "unknown"
  }
}

export async function failedRuns(host: Host, repo: RepoRef, pullNumber: number): Promise<FailedRuns> {
  const ran = await answerOf(host, graphqlArgv(repo, FAILED_RUNS_QUERY, { number: pullNumber }), 30_000)

  return readFailedRuns(ran.stdout)
}

// A write gh ran and GitHub, or gh, turned down, as against one that could not run.
export class WriteRefused extends Error {}

export async function ghWrite(host: Host, argv: string[]): Promise<ProcessRunResult> {
  const ran = await host.run(argv, { timeoutMs: WRITE_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    throw refusalOf(ran, argv)
  }

  return ran
}

const WRITE_TIMEOUT_MS = 120_000

// gh says what went wrong on its error stream, a line GitHub wrote among them ("Head branch was modified"), after
// the mark gh puts before a failure.
function refusalOf(ran: ProcessRunResult, argv: readonly string[]): WriteRefused {
  const said = firstLine(ran.stderr).replace(/^[X✗!]\s+/, "")

  return new WriteRefused(said || `${argv.slice(0, 3).join(" ")} failed`)
}

const ASYNC_MERGE_POLL_MS = 3_000
const ASYNC_MERGE_WAIT_MS = 60_000

// Asks GitHub to merge in the background, then looks every few seconds, for up to a minute, at what came of it. A
// second ask while a merge is under way (409), or one GitHub can't merge (400), makes gh exit 1, but GitHub's answer
// is still printed: a merge under way, with its uuid, is followed as if asked now, and a failure says why. Only an
// answer that can't be read is thrown as gh's refusal.
export async function mergeStacked(
  host: Host,
  clock: Clock,
  repo: RepoRef,
  row: PullRow,
  method: MergeMethod
): Promise<AsyncMerge> {
  const argv = asyncMergeArgv(repo, row, method)
  const asked = await host.run(argv, { timeoutMs: WRITE_TIMEOUT_MS })
  const answer = readAsyncMerge(asked.stdout)
  if (asked.exitCode !== 0 && answer === null) {
    throw refusalOf(asked, argv)
  }
  let merged = answer ?? { status: "pending", uuid: null, message: null }
  const deadline = (await clock.now()) + ASYNC_MERGE_WAIT_MS
  while (merged.status === "pending" && merged.uuid !== null) {
    await clock.sleep(ASYNC_MERGE_POLL_MS)
    const left = deadline - (await clock.now())
    if (left <= 0) {
      break
    }
    // A look that fails or times out leaves the merge pending: GitHub has taken it, and the next look may tell.
    const looked = await host
      .run(asyncMergeStatusArgv(repo, row, merged.uuid), { timeoutMs: Math.min(30_000, left) })
      .catch(() => null)
    const now = looked?.exitCode === 0 ? readAsyncMerge(looked.stdout) : null
    if (now) {
      merged = { ...now, uuid: now.uuid ?? merged.uuid }
    }
  }

  return merged
}
