// Author: David Matura

// The people GitHub suggests to review the viewer's own pull requests that wait on reviewers nobody asked, at first or
// for more approvals, whom Request Review offers: asked after a load shows the list, in one small request for the rows
// that want them, as asking in the list's own request would load it slower for everyone. GitHub suggests them from who
// changed or reviewed the code a pull request touches before. Each answer is kept for its row's head commit and reviews
// (`suggestionBasis`), so it is asked again only when the head moves, someone reviews, a row newly wants them, or
// someone was asked since, from the pane or as a press found; one that failed is asked again by the next load.

import type { PullRow, PullsSnapshot } from "../types"
import { firstLine, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { GhFailure, ghRun, graphqlArgv } from "./github"
import type { Host } from "./machine"
import { primaryOf } from "./pull-status"
import { ENGINE_OPTIONS } from "./question"
import type { Session, Suggested } from "./session"

// What asking for the suggestions reaches beyond gh (`Host`): the debug log, and the pane, drawn again once they come.
export type SuggestionsHost = Host & {
  log: (line: string) => void
  redraw: () => void
}

// Whether Request Review may offer GitHub's suggestions on a row, once there are any: the viewer's own, up for review
// and not in the merge queue, which merges it anyway, in a repository where they may request reviews, with no person
// asked to review it, at first or for more approvals (`isReviewerUnrequested`).
export function wantsSuggestions(snapshot: PullsSnapshot, row: PullRow): boolean {
  return snapshot.merging.canRequestReviews && !row.isDraft && row.stage !== "queued" && row.isReviewerUnrequested
}

// The people GitHub suggests for a row, as kept for its head commit and reviews; none where it wants none, or none came
// for the row as it stands yet.
export function suggestionsFor(session: Session, snapshot: PullsSnapshot, row: PullRow): string[] {
  const kept = session.suggestedReviewers.get(suggestionKey(snapshot.repo, row.number))

  return wantsSuggestions(snapshot, row) && kept?.basis === suggestionBasis(row) ? (kept.names ?? []) : []
}

// The list as the pane draws it and a press reads it: Request Review on each of the viewer's rows GitHub suggests
// someone for (`suggested`), after the row's own buttons, the main one where its stage puts it first. The list kept
// holds no suggestions, as they come after it.
export function withRequestReview(
  snapshot: PullsSnapshot,
  suggested: (row: PullRow) => readonly string[]
): PullsSnapshot {
  const mine = snapshot.mine.map((row): PullRow => {
    if (row.stage === null || suggested(row).length === 0) {
      return row
    }
    const actions = [...row.actions, "requestReview" as const]

    return { ...row, actions, primary: primaryOf(row.stage, actions) }
  })

  return { ...snapshot, mine }
}

// A row's suggestions forgotten once someone is asked to review it, from the pane or as a press found: they were read
// before that, and the list drawn until the next load, or kept where that load fails, still shows nobody asked. The
// next load asks GitHub afresh.
export function forgetSuggestions(session: Session, repo: string, number: number): void {
  session.suggestedReviewers.delete(suggestionKey(repo, number))
}

// The suggestions a load asks for once it shows the list: for the rows that want them and have none kept for them as
// they stand nor asked for now, in one request. What is kept for rows that want them no more, or whose head moved or
// that someone reviewed since, is forgotten.
export async function askSuggestions(
  host: SuggestionsHost,
  session: Session,
  repo: RepoRef,
  snapshot: PullsSnapshot
): Promise<void> {
  const wanted = new Map(
    snapshot.mine
      .filter((row) => wantsSuggestions(snapshot, row))
      .map((row) => [suggestionKey(snapshot.repo, row.number), row])
  )
  for (const [key, kept] of session.suggestedReviewers) {
    const row = wanted.get(key)
    if (!row || suggestionBasis(row) !== kept.basis) {
      session.suggestedReviewers.delete(key)
    }
  }
  const asked = [...wanted].filter(([key]) => !session.suggestedReviewers.has(key))
  if (asked.length === 0) {
    return
  }
  // Each row asked about gets a place of its own while it is asked; its answer, or the request's failure, goes only to
  // that place, which a later load may have forgotten meanwhile, as the row's head moved or someone reviewed it, or set
  // aside anew.
  const asking = asked.map(([key, row]) => {
    const place: Suggested = { basis: suggestionBasis(row), names: null }
    session.suggestedReviewers.set(key, place)

    return { key, row, place }
  })
  const numbers = asking.map(({ row }) => row.number)
  const named = numbers.map((number) => `#${number}`).join(", ")
  const answered = await suggestionsOf(host, repo, numbers).catch((error: unknown) => {
    host.log(`GitHub's suggested reviewers for ${named} could not be read: ${messageOf(error)}`)

    return null
  })
  for (const { key, row, place } of asking) {
    if (session.suggestedReviewers.get(key) !== place) {
      continue
    }
    if (answered === null) {
      session.suggestedReviewers.delete(key)
    } else {
      session.suggestedReviewers.set(key, { basis: place.basis, names: answered.get(row.number) ?? [] })
    }
  }
  if (answered !== null) {
    host.redraw()
  }
}

// What a row's suggestions are kept under: the repository and the pull request's number, so another repository's never
// stand for its own; a load forgets any other repository's (`askSuggestions`).
function suggestionKey(repo: string, number: number): string {
  return `${repo}#${number}`
}

// What a row's suggestions are kept for: its head commit and its reviews, as GitHub's answer leaves out anyone who
// approved, so a new commit or a review since asks GitHub again.
function suggestionBasis(row: PullRow): string {
  const reviews = Object.entries(row.signals.reviews)
    .map(([login, mark]) => `${login} ${mark.state} ${mark.at}`)
    .sort()

  return [row.headOid, ...reviews].join("\n")
}

// Each pull request asked about under its own name in one request (`pull<number>`), with its author, whom GitHub
// suggests, who is requested, and whose latest verdict approved. GitHub's `isAuthor` on a suggestion says it comes from
// past commits, as nearly all do, not that it names the pull request's author.
export function suggestionsQuery(numbers: readonly number[]): string {
  const pulls = numbers.map((number) => `    pull${number}: pullRequest(number: ${number}) { ...suggestions }`)

  return `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${pulls.join("\n")}
  }
}
fragment suggestions on PullRequest {
  author { login }
  suggestedReviewers { reviewer { login } }
  reviewRequests(first: 100) { nodes { requestedReviewer { ... on User { login } } } }
  latestOpinionatedReviews(first: 100) { nodes { state author { login } } }
}`
}

// GitHub's suggestions for each pull request asked about, in its order: the author, anyone requested now and anyone
// whose latest verdict approved left out, at most as many as Claude Code's own dialog offers names (`ENGINE_OPTIONS`),
// so Request Review can ask there too where the pane doesn't show; none for one it didn't find. Null where it can't be
// read.
export function readSuggestions(json: string, numbers: readonly number[]): Map<number, string[]> | null {
  type Logins = { nodes?: unknown } | null | undefined
  type Pull = {
    author?: { login?: unknown } | null
    suggestedReviewers?: unknown
    reviewRequests?: Logins
    latestOpinionatedReviews?: Logins
  } | null
  let raw: { data?: { repository?: Record<string, Pull | undefined> | null } | null }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const repository = raw?.data?.repository
  if (typeof repository !== "object" || repository === null) {
    return null
  }

  return new Map(
    numbers.map((number) => {
      const pull = repository[`pull${number}`]
      const requested = loginsOf<RequestNode>(pull?.reviewRequests, (node) => node?.requestedReviewer?.login)
      const approved = loginsOf<VerdictNode>(pull?.latestOpinionatedReviews, (node) =>
        node?.state === "APPROVED" ? node.author?.login : undefined
      )
      const author = pull?.author?.login
      const suggested = Array.isArray(pull?.suggestedReviewers)
        ? (pull.suggestedReviewers as SuggestedNode[]).flatMap((each) => {
            const login = each?.reviewer?.login

            return typeof login === "string" && login !== author ? [login] : []
          })
        : []

      return [
        number,
        suggested.filter((login) => !requested.includes(login) && !approved.includes(login)).slice(0, ENGINE_OPTIONS)
      ]
    })
  )
}

type SuggestedNode = { reviewer?: { login?: unknown } | null } | null
type RequestNode = { requestedReviewer?: { login?: unknown } | null } | null
type VerdictNode = { state?: unknown; author?: { login?: unknown } | null } | null

// The logins a connection's nodes name, as `loginOf` reads each.
function loginsOf<Node>(
  connection: { nodes?: unknown } | null | undefined,
  loginOf: (node: Node) => unknown
): string[] {
  const nodes = connection?.nodes

  return Array.isArray(nodes)
    ? (nodes as Node[]).flatMap((node) => {
        const login = loginOf(node)

        return typeof login === "string" ? [login] : []
      })
    : []
}

const UNREAD_SUGGESTIONS = "GitHub's answer about the suggested reviewers could not be read."

// GitHub's suggestions for the pull requests numbered (`readSuggestions`), read also from an answer that holds errors
// beside its data, as one pull request it couldn't find, so that one costs the others nothing. Rejects where GitHub
// could not be asked, or its answer can't be read.
async function suggestionsOf(host: Host, repo: RepoRef, numbers: readonly number[]): Promise<Map<number, string[]>> {
  const asked = await ghRun(host, graphqlArgv(repo, suggestionsQuery(numbers)), 30_000)
  if ("problem" in asked) {
    throw new GhFailure(asked.problem, asked.said)
  }
  const found = readSuggestions(asked.ran.stdout, numbers)
  if (found === null) {
    throw new GhFailure({ message: UNREAD_SUGGESTIONS, isPermanent: false }, firstLine(asked.ran.stderr))
  }

  return found
}
