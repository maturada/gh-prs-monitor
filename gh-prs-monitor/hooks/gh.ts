// Author: David Matura

// A permanent problem holds for the whole session (no repository, no GitHub remote), so polling stops;
// anything else may pass (signed out, offline) and the next refresh tries again. A setup problem is one
// the person has to fix on their machine before the plugin can work anywhere, so it is announced.
export type GhProblem = { message: string; isPermanent: boolean; needsSetup?: true }

export const GH_MISSING: GhProblem = {
  message: "The GitHub CLI (gh) is not installed. Get it from https://cli.github.com, then run: gh auth login",
  isPermanent: true,
  needsSetup: true
}

const OLD_SERVER =
  "This GitHub server lacks a field the plugin asks for: GitHub Enterprise Server needs to be 3.16 or later"

// How long the toast saying gh needs setting up stays.
export const SETUP_NOTE_MS = 12_000

// Checked in order: gh's message about a non-GitHub remote also suggests `gh auth login`.
const KNOWN: readonly [RegExp, GhProblem][] = [
  [
    /not a git repository/i,
    { message: "This folder is not a git repository, so it has no GitHub project.", isPermanent: true }
  ],
  [
    /no git remotes found/i,
    { message: "This repository has no git remote, so it has no GitHub project.", isPermanent: true }
  ],
  // gh says this alike of a remote on another service and of one on a GitHub Enterprise server it isn't signed in to.
  [
    /none of the git remotes .* point to a known GitHub host/i,
    {
      message:
        "This repository has no remote on a GitHub host the GitHub CLI is signed in to. For GitHub Enterprise, run: gh auth login --hostname <your server>",
      isPermanent: true
    }
  ],
  [
    /gh auth login|not logged in|authentication required|bad credentials|HTTP 401/i,
    { message: "The GitHub CLI is not signed in. Run: gh auth login", isPermanent: false, needsSetup: true }
  ],
  [
    /could not resolve to a repository/i,
    {
      message: "No access to this repository with your GitHub account, or it does not exist on GitHub.",
      isPermanent: true
    }
  ],
  [/rate limit|HTTP 403/i, { message: "GitHub refused the request (rate limit or permissions).", isPermanent: false }],
  [
    /error connecting|dial tcp|no such host|i\/o timeout|network is unreachable|connection refused|TLS handshake/i,
    { message: "Could not reach GitHub.", isPermanent: false }
  ],
  // gh prints the status alone, and GitHub's error page as the answer.
  [/HTTP 5\d\d/, { message: "GitHub took too long to answer, or had an error of its own.", isPermanent: false }]
]

export function describeGhFailure(stderr: string): GhProblem {
  // An organization's single sign-on (SAML) refusing the token: GitHub's own words say what to do.
  if (/\bSAML\b/.test(stderr)) {
    return { message: firstLine(stderr), isPermanent: false }
  }
  // A server older than the plugin's queries, as a GitHub Enterprise Server before 3.16, names a field it lacks: asking
  // again changes nothing.
  const field = /Field '(\w+)' doesn't exist on type/.exec(stderr)?.[1]
  if (field) {
    return { message: `${OLD_SERVER} (${field})`, isPermanent: true }
  }
  const known = KNOWN.find(([pattern]) => pattern.test(stderr))
  if (known) {
    return known[1]
  }

  return { message: firstLine(stderr) || "The GitHub CLI failed without saying why.", isPermanent: false }
}

export type GhRun = { exitCode: number; stdout: string; stderr: string }

// gh exits non-zero on an API error yet often prints the response body: a GraphQL answer with `data`,
// whose own errors the caller reads, or a REST-style `{ "message": ... }` such as "Bad credentials".
export function ghRunFailure(ran: GhRun): GhProblem | null {
  if (ran.exitCode === 0) {
    return null
  }

  const body = parseBody(ran.stdout)
  if (body?.data) {
    return null
  }

  return describeGhFailure([ran.stderr, body?.message ?? ""].join("\n"))
}

function parseBody(stdout: string): { data?: unknown; message?: string } | null {
  try {
    return JSON.parse(stdout) as { data?: unknown; message?: string }
  } catch {
    return null
  }
}

export type RepoRef = { name: string; host: string }

// Whether a value read back from the store or the session's state is a repository.
export function isRepo(value: unknown): value is RepoRef {
  const repo = value as Partial<RepoRef> | null

  return typeof repo?.host === "string" && typeof repo.name === "string"
}

// The server `owner/name` names where the session's folder has no repository to name its own: GitHub's, as gh's own
// default is, unless an environment variable the plugin doesn't read says otherwise.
export const DEFAULT_HOST = "github.com"

// The repository `name` on the server its address `url` is on; none where the address isn't one.
export function repoAt(name: string, url: string): RepoRef | null {
  try {
    return { name, host: new URL(url).host }
  } catch {
    return null
  }
}

// A repository as one text, its server and name in lower case, as GitHub reads both in any letter case.
export function repoKey(repo: RepoRef): string {
  return `${repo.host}/${repo.name}`.toLowerCase()
}

// A pull request of a repository as one text, `github.com/acme/web#12`; a mark of its row too, `…#create-pr`.
export function pullKey(repo: RepoRef, number: number | string): string {
  return `${repoKey(repo)}#${number}`
}

// One repository: the same name on the same server, as GitHub reads both, in any letter case.
export function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return a.host.toLowerCase() === b.host.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()
}

// A REST request to the repository on its own server, `path` within `repos/<owner>/<name>/`.
export function ghApiArgv(repo: RepoRef, path: string, method?: "PUT" | "POST"): string[] {
  return ["gh", "api", ...(method ? ["--method", method] : []), `repos/${repo.name}/${path}`, "--hostname", repo.host]
}

// `gh repo view` follows the remote's host, while `gh api` defaults to github.com, so the host is carried
// along for GitHub Enterprise.
export function parseRepoView(stdout: string): RepoRef | null {
  const [name, url] = stdout.trim().split(/\s+/)
  if (!name?.includes("/") || !url) {
    return null
  }

  return repoAt(name, url)
}

// What git or gh said went wrong: its `fatal:` or `error:` line, or the ref a fetch rejected, ahead of the `hint:`
// lines git may print first, the `From` line a fetch opens with, and gh's `failed to run git` after it.
export function failureLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line !== "")
  const isNoise = (line: string): boolean => /^hint:/i.test(line) || /^(From |failed to run git:)/.test(line)

  return (
    lines.find((line) => /^(fatal|error):/i.test(line)) ??
    lines.find((line) => line.startsWith("! [")) ??
    lines.find((line) => !isNoise(line)) ??
    lines[0] ??
    ""
  )
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A process run rejects both for a program that could not start (missing, or not one the system can run) and for one
// still running at its timeout: this tells the first.
export function isNotStarted(error: unknown): boolean {
  return /ENOENT|EINVAL|not found|cannot find/i.test(messageOf(error))
}

export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  )
}

export function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .at(-1) ?? ""
  )
}
