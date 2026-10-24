// Author: David Matura

// GitHub as the tests of visits see it: the repositories it has, keyed `host/owner/name` as it writes them, and the
// servers gh is signed in to; and gh's answers about them, which the test machine (`world.ts`) and a visit's host in
// memory (`visit-host.ts`) share.

import type { ProcessRunResult } from "claude-code"

import { response } from "./fixtures"
import type { ResponseFixture } from "./fixtures"

export type GhRepos = {
  // The repositories a session may visit.
  others?: Record<string, ResponseFixture>
  // The servers gh is signed in to: github.com unless given.
  signedIn?: string[]
  // Repositories renamed on GitHub: an old `host/owner/name` and the key it answers under now.
  renamed?: Record<string, string>
  // The people GitHub suggests to review pull requests of `others`, by key and number.
  suggestedIn?: Record<string, Record<number, string[]>>
  // How pull requests of `others` stand on GitHub now, by key and number, where they moved on since listed.
  currentIn?: Record<string, Record<number, PullNow>>
  // The open pull requests in every repository that are the viewer's (`mine`) or ask their review, as the light check
  // of other repositories finds them.
  elsewhere?: { mine?: ElsewhereFixture[]; requested?: ElsewhereFixture[] }
  // What gh says where the light check fails.
  elsewhereFailure?: string
}

// A pull request the light check finds: its repository as `owner/name`, its CI, and the latest reviews of others.
export type ElsewhereFixture = {
  repo: string
  number: number
  title?: string
  author?: string
  // GitHub's rollup of its checks; none for one with none.
  ci?: string | null
  reviews?: { login: string; state: string; at: string }[]
  isDraft?: boolean
}

// How a pull request stands on GitHub now, where it moved on since the list was read.
export type PullNow = {
  state?: "open" | "merged" | "closed"
  isDraft?: boolean
  head?: string
  base?: string
  requested?: string[]
  isAutoMerge?: boolean
  isConflicting?: boolean
  // Commits its base has that its head lacks; behind unless given, as a row offering Update Branch is.
  behindBase?: number
}

// A stack's place for a pull request, as GitHub's REST API gives it.
type StackPlace = { number: number; position: number; size: number }

// gh's answer to `gh auth status` for a server, to `gh repo view` of a repository's address, and to the list, the
// suggested reviewers and a press's look at a pull request of one of `others`; null for any other command. `folder`:
// the session's own repository, as `host/owner/name`, which GitHub has too.
export function ghReposAnswer(repos: GhRepos, folder: string | null, line: string): ProcessRunResult | null {
  const auth = /^gh auth status (?:--active )?--hostname (\S+)/.exec(line)
  if (auth) {
    const server = auth[1]!

    return isSignedIn(repos, server) ? ran("") : ran("", `You are not logged into any accounts on ${server}\n`)
  }
  const viewed = /^gh repo view https:\/\/([^/]+)\/(\S+) --json/.exec(line)
  if (viewed) {
    const [, server, name] = viewed
    const old = Object.keys(repos.renamed ?? {}).find((key) => key.toLowerCase() === `${server}/${name}`.toLowerCase())
    const key = old ? repos.renamed![old]! : keyOf(repos, folder, server!, name!)

    return key
      ? ran(`${nameIn(key)} https://${key}\n`)
      : ran("", `GraphQL: Could not resolve to a Repository with the name '${name}'. (repository)\n`)
  }
  if (line.startsWith("gh api graphql") && line.includes("archived:false")) {
    // As gh answers a server it isn't signed in to.
    const server = /--hostname (\S+)/.exec(line)?.[1] ?? "github.com"
    if (!isSignedIn(repos, server)) {
      return ran("", "To get started with GitHub CLI, please run:  gh auth login\n")
    }

    return repos.elsewhereFailure ? ran("", repos.elsewhereFailure) : ran(elsewhereAnswer(repos.elsewhere ?? {}, line))
  }
  const listed = /^gh api graphql --hostname (\S+) -f owner=(\S+) -f name=(\S+)/.exec(line)
  const key = listed ? keyOf(repos, null, listed[1]!, `${listed[2]}/${listed[3]}`) : null
  if (key && line.includes("$mine")) {
    return ran(response({ nameWithOwner: nameIn(key), ...repos.others![key] }))
  }
  if (key && line.includes("suggestedReviewers")) {
    return ran(suggestionsAnswer(repos.others![key]!, repos.suggestedIn?.[key], line))
  }
  const looked = /^gh api repos\/(\S+)\/pulls\/(\d+) --hostname (\S+)/.exec(line)
  const lookedKey = looked ? keyOf(repos, null, looked[3]!, looked[1]!) : null
  if (looked && lookedKey) {
    const number = Number(looked[2])

    return ran(pullLookAnswer(repos.others![lookedKey]!, number, repos.currentIn?.[lookedKey]?.[number]))
  }

  return null
}

// Whether the GitHub CLI is signed in to `server`: github.com unless the test says otherwise.
function isSignedIn(repos: GhRepos, server: string): boolean {
  return (repos.signedIn ?? ["github.com"]).some((each) => each.toLowerCase() === server.toLowerCase())
}

// GitHub's answer to the light check: the viewer, `me`, and both searches, the repository the line leaves out
// (`-repo:`) left out as GitHub leaves it out. Each search answers the fields its fragment asks for; a review asked of
// the viewer, by name.
function elsewhereAnswer(found: NonNullable<GhRepos["elsewhere"]>, line: string): string {
  const left = /-repo:(\S+?)(\\"|"|\s)/.exec(line)?.[1]?.toLowerCase()
  const shared = (pull: ElsewhereFixture, isMine: boolean) => ({
    number: pull.number,
    title: pull.title ?? `PR ${pull.number}`,
    url: `https://github.com/${pull.repo}/pull/${pull.number}`,
    author: { login: pull.author ?? (isMine ? "me" : "ann") },
    repository: { nameWithOwner: pull.repo },
    isDraft: pull.isDraft ?? false,
    statusCheckRollup: pull.ci === null ? null : { state: pull.ci ?? "SUCCESS" }
  })
  const mine = (pull: ElsewhereFixture) => ({
    ...shared(pull, true),
    latestReviews: {
      nodes: (pull.reviews ?? []).map((review) => ({
        author: { __typename: "User", login: review.login },
        state: review.state,
        submittedAt: review.at
      }))
    }
  })
  const requested = (pull: ElsewhereFixture) => ({
    ...shared(pull, false),
    viewerLatestReview: null,
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] }
  })
  const search = (pulls: ElsewhereFixture[] | undefined, node: (pull: ElsewhereFixture) => object) => {
    const kept = (pulls ?? []).filter((pull) => pull.repo.toLowerCase() !== left)

    // GitHub gives the first page, as the check asks for, and how many there are in all.
    return { issueCount: kept.length, nodes: kept.slice(0, 30).map(node) }
  }

  return JSON.stringify({
    data: { viewer: { login: "me" }, mine: search(found.mine, mine), requested: search(found.requested, requested) }
  })
}

// GitHub's answer to a press's look at pull request `number`, as `fixture` lists it and `now` says it stands since.
export function pullLookAnswer(
  fixture: ResponseFixture,
  number: number,
  now: PullNow | undefined,
  stack: StackPlace | null = null
): string {
  const listed = [...(fixture.mine ?? []), ...(fixture.requested ?? [])].find((pull) => pull.number === number)
  const state = now?.state === "merged" || now?.state === "closed" ? "closed" : "open"

  return JSON.stringify({
    number,
    state,
    merged: now?.state === "merged",
    draft: now?.isDraft ?? listed?.isDraft ?? false,
    head: { sha: now?.head ?? listed?.headRefOid ?? `head-${number}` },
    base: { ref: now?.base ?? "main" },
    stack,
    requested_reviewers: (now?.requested ?? listed?.requested ?? []).map((login) => ({ login })),
    auto_merge: now?.isAutoMerge ? { merge_method: "merge" } : null,
    mergeable: !(now?.isConflicting ?? listed?.mergeable === "CONFLICTING")
  })
}

// GitHub's answer about the suggested reviewers of the pull requests the request names, as `fixture` lists them:
// those `suggested` by number, and those asked already (`requestedNow`, else the fixture's own).
export function suggestionsAnswer(
  fixture: ResponseFixture,
  suggested: Record<number, string[]> | undefined,
  line: string,
  requestedNow: (number: number) => string[] | undefined = () => undefined
): string {
  const numbers = [...line.matchAll(/pull(\d+): pullRequest/g)].map((match) => Number(match[1]))
  const repository = Object.fromEntries(
    numbers.map((number) => {
      const listed = fixture.mine?.find((pull) => pull.number === number)
      const requested = requestedNow(number) ?? listed?.requested ?? []
      // GitHub's latest verdicts, as the list fixture's own (`verdicts`, else those among `reviews`).
      const approved = (listed?.verdicts ?? listed?.reviews ?? []).filter((review) => review.state === "APPROVED")

      return [
        `pull${number}`,
        {
          author: { login: listed?.author ?? "me" },
          // As GitHub marks a suggestion from past commits, as nearly all are.
          suggestedReviewers: (suggested?.[number] ?? []).map((login) => ({
            isAuthor: true,
            isCommenter: false,
            reviewer: { login }
          })),
          reviewRequests: { nodes: requested.map((login) => ({ requestedReviewer: { login } })) },
          latestOpinionatedReviews: {
            nodes: approved.map((review) => ({ state: "APPROVED", author: { login: review.login } }))
          }
        }
      ]
    })
  )

  return JSON.stringify({ data: { repository } })
}

// The key GitHub has a repository under, in any letter case.
function keyOf(repos: GhRepos, folder: string | null, server: string, name: string): string | null {
  const wanted = `${server}/${name}`.toLowerCase()

  return (
    [...Object.keys(repos.others ?? {}), ...(folder ? [folder] : [])].find((key) => key.toLowerCase() === wanted) ??
    null
  )
}

function nameIn(key: string): string {
  return key.slice(key.indexOf("/") + 1)
}

// gh's run: what it printed, failing where it printed an error.
export function ran(stdout: string, stderr = ""): ProcessRunResult {
  return {
    exitCode: stderr === "" ? 0 : 1,
    stdout,
    stderr,
    isStdoutTruncated: false,
    isStderrTruncated: false
  }
}
