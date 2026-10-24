// Author: David Matura

// Ticket links: a pull request's ticket (`WEB-5761` in Linear, Jira and the like), found by its key in the branch or
// the title and linked to the address its tracker has for it. They are set up by pasting a link to any ticket, read
// here by code alone: the key in the link's path, or the number some trackers use, and the address around it.

import type { Badge, PullRow } from "../types"
import type { RepoRef } from "./gh"
import { storeKey } from "./store-keys"

// A key's prefix with its separator (`WEB-`, `sc-`, `AB#`), each with the address its tickets are at: `{key}` stands
// for the whole key, `{number}` for its number alone.
export type TicketLinks = Record<string, string>

// What a pasted link gives: an address and the key form it was found with; an address whose key form the person
// still has to give, as its link carries a number alone; or nothing to use, and why. A link to the repository's own
// GitHub is one of those, as GitHub links its issues itself.
export type PastedLink = FoundLink | NeedsKey | NoLink

export type FoundLink = { kind: "link"; prefix: string; address: string; key: string }
export type NeedsKey = { kind: "needs-key"; address: string; number: string }
export type NoLink = { kind: "none"; reason: "not-a-link" | "github" | "query-only" | "no-key" }

export type Ticket = { key: string; url: string }

// A key in a path segment of its own, as trackers write them in their links: `WEB-5761`. One in capitals, as trackers
// write keys, wins over a workspace or a title's slug of that shape (`acme-2`, `fix-scroll-2`).
const PATH_KEY = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/
const CAPITAL_KEY = /^([A-Z][A-Z0-9_]*)-(\d+)$/

// A key as a person writes an example of one: a prefix, `-` or `#`, a number.
const EXAMPLE_KEY = /^([A-Za-z][A-Za-z0-9_]*[-#])(\d+)$/

const SAVED_PREFIX = /^[A-Za-z][A-Za-z0-9_]*[-#]$/

const PLACE = /\{(key|number)\}/g

// Trackers whose links carry a ticket's number alone, with the key form their branches and titles use.
const NUMBER_HOSTS: readonly { host: RegExp; prefix: string }[] = [
  { host: /^app\.shortcut\.com$/i, prefix: "sc-" },
  { host: /^dev\.azure\.com$|\.visualstudio\.com$/i, prefix: "AB#" }
]

// Atlassian's boards name the ticket open on them in the query (`selectedIssue=WEB-123`); its own page is `/browse/`.
const ATLASSIAN = /\.atlassian\.net$/i

// Why a pasted link gave nothing to use, as `/prs tickets` and the skills' tool say it.
export const LINK_PROBLEMS: Readonly<Record<NoLink["reason"], string>> = {
  "not-a-link": "That isn't a web link: paste one as copied from the browser's address bar.",
  github: "GitHub links its own issues already, as #12 in a title or body: ticket links are for another tracker.",
  "query-only": "That link names its ticket only in its query: open the ticket on its own page and paste that link.",
  "no-key": "That link holds no ticket key or number: open a ticket on its own page and paste that link."
}

// A link pasted in a repository on `githubHost`.
export function ticketLink(text: string, githubHost: string): PastedLink {
  const url = webAddress(text.trim())
  if (!url) {
    return { kind: "none", reason: "not-a-link" }
  }
  if (url.host === githubHost.toLowerCase()) {
    return { kind: "none", reason: "github" }
  }
  const segments = url.pathname.split("/")
  // In capitals, the first of that shape, as a title's slug after the key may look like one (`API-2`); in any case, the
  // last, as a workspace or a project before it may (`team-2`).
  const keyAt = [
    segments.findIndex((segment) => CAPITAL_KEY.test(segment)),
    segments.findLastIndex((segment) => PATH_KEY.test(segment))
  ].find((at) => at !== -1)
  if (keyAt !== undefined) {
    const key = segments[keyAt]!

    return { kind: "link", prefix: prefixOf(key), address: addressUpTo(url, segments, keyAt, "{key}"), key }
  }
  const queried = queryValues(url).find((value) => PATH_KEY.test(value))
  if (queried) {
    return ATLASSIAN.test(url.hostname)
      ? { kind: "link", prefix: prefixOf(queried), address: `${url.origin}/browse/{key}`, key: queried }
      : { kind: "none", reason: "query-only" }
  }
  const numberAt = segments.findLastIndex((segment) => /^\d+$/.test(segment))
  if (numberAt === -1) {
    return { kind: "none", reason: "no-key" }
  }
  const number = segments[numberAt]!
  const address = addressUpTo(url, segments, numberAt, "{number}")
  const known = NUMBER_HOSTS.find((each) => each.host.test(url.hostname))

  return known
    ? { kind: "link", prefix: known.prefix, address, key: `${known.prefix}${number}` }
    : { kind: "needs-key", address, number }
}

// A link that carries a number alone, with the key form an example of a key gives (`ENG-12`); none for an example that
// isn't one.
export function withKeyForm(pasted: NeedsKey, example: string): FoundLink | null {
  const form = EXAMPLE_KEY.exec(example.trim())
  if (!form) {
    return null
  }
  const prefix = form[1]!

  return { kind: "link", prefix, address: pasted.address, key: `${prefix}${pasted.number}` }
}

// The ticket a pull request names: the first key with a saved prefix in its branch, else in its title, matched in any
// case at the start of a word and read in its saved form. A prefix that isn't saved never matches, so `UTF-8` is
// nobody's ticket.
export function ticketOf(pull: { branch: string; title: string }, links: TicketLinks): Ticket | null {
  const { prefixes, key } = matcherOf(links)
  if (prefixes.length === 0) {
    return null
  }
  for (const text of [pull.branch, pull.title]) {
    const found = key.exec(text)
    if (found) {
      // Told apart by its own group, as the match was made: Unicode's case folding matches `ſc-` for `sc-`, which
      // lower case doesn't.
      const prefix = prefixes[found.slice(1, -1).findIndex((group) => group !== undefined)]!
      const number = found.at(-1)!

      return { key: `${prefix}${number}`, url: ticketAddress(links[prefix]!, prefix, number) }
    }
  }

  return null
}

// One matcher for a set of links, as rows draw often with the links the session holds: a group per prefix, then the
// number.
const MATCHERS = new WeakMap<TicketLinks, { prefixes: string[]; key: RegExp }>()

function matcherOf(links: TicketLinks): { prefixes: string[]; key: RegExp } {
  const kept = MATCHERS.get(links)
  if (kept) {
    return kept
  }
  const prefixes = Object.keys(links)
  const groups = prefixes.map((prefix) => `(${escaped(prefix)})`).join("|")
  const matcher = { prefixes, key: new RegExp(`(?<![\\p{L}\\p{N}])(?:${groups})(\\d+)`, "iu") }
  MATCHERS.set(links, matcher)

  return matcher
}

// A row's details with its ticket first, where the links find one: a detail as the others are, its mark saying it
// opens elsewhere, as the other details lead to GitHub; a no-break space keeps the mark with the key where a narrow
// pane wraps the details. Else the details as they are.
export function detailsWithTicket(
  row: Pick<PullRow, "headRefName" | "title" | "details">,
  links: TicketLinks | null
): Badge[] {
  const ticket = links ? ticketOf({ branch: row.headRefName, title: row.title }, links) : null

  return ticket
    ? [{ text: `${ticket.key}\u00a0${OPENS_ELSEWHERE}`, tone: "neutral", href: ticket.url }, ...row.details]
    : row.details
}

// Two squares, one over the other, as apps mark a link that opens in a window of its own; one cell wide, and no emoji.
const OPENS_ELSEWHERE = "⧉"

// A word in a branch that looks like a ticket's key, before any links are set up, so Create PR can offer to set them up
// once: at the start of one of the branch's parts, as Linear's and Jira's branches write it (`david/web-5785-…`,
// `feature/WEB-5785-…`), in any case, answered in capitals; none for a word that names a version, an encoding or a
// release (`node-20`, `utf-8`, `release-2024`), nor for one inside a part (`upgrade-node-20`).
export function keyLikeIn(branch: string): string | null {
  for (const part of branch.split("/")) {
    const found = KEY_LIKE.exec(part)
    if (found && !NOT_TICKETS.has(found[1]!.toLowerCase())) {
      return `${found[1]!.toUpperCase()}-${found[2]!}`
    }
  }

  return null
}

const KEY_LIKE = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)(?=$|[-_.])/

const NOT_TICKETS: ReadonlySet<string> = new Set(
  (
    "android angular build bump debian dotnet ecma es go gpt hotfix http https ios iso java jdk kotlin macos mysql net " +
    "next node php phase postgres python py react redis release rfc ruby rust sha sprint step swift ubuntu utf version " +
    "vue win windows"
  ).split(" ")
)

// The address of the ticket with this prefix and number, as `{key}` and `{number}` in a saved address stand for.
export function ticketAddress(address: string, prefix: string, number: string): string {
  return address.replace(PLACE, (_, place: string) =>
    encodeURIComponent(place === "key" ? `${prefix}${number}` : number)
  )
}

// Links as the store gives them back, or off, where the person removed the last or told a skill not to ask: an entry
// is kept only as a prefix and a web address with its key's place in its path, so nothing kept by hand or by another
// version can make a link that isn't one, or one to another host.
export function readTicketLinks(value: unknown): TicketLinks | "off" | null {
  if (value === "off") {
    return "off"
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const links = Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => SAVED_PREFIX.test(entry[0]) && isTicketAddress(entry[1])
    )
  )

  return Object.keys(links).length > 0 ? links : null
}

// The links kept, as links: none where none are kept or they are off.
export function linksIn(kept: TicketLinks | "off" | null): TicketLinks {
  return kept && kept !== "off" ? kept : {}
}

// The links with one more, in place of any for its prefix in another case: `web-` and `WEB-` are one prefix to the
// matching.
export function withLink(kept: TicketLinks | "off" | null, link: { prefix: string; address: string }): TicketLinks {
  return { ...withoutPrefix(linksIn(kept), link.prefix), [link.prefix]: link.address }
}

// The links but those of a prefix, in any case.
export function withoutPrefix(links: TicketLinks, prefix: string): TicketLinks {
  return Object.fromEntries(Object.entries(links).filter(([each]) => !isSamePrefix(each, prefix)))
}

export function isSamePrefix(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

// Where the store keeps a repository's links (`tickets:github.com/acme/app`); GitHub's names hold no case, so neither
// do the keys.
export function ticketsKey(repo: RepoRef): string {
  return storeKey("tickets:", `${repo.host}/${repo.name}`.toLowerCase())
}

function webAddress(text: string): URL | null {
  try {
    const url = new URL(text)

    return url.protocol === "https:" || url.protocol === "http:" ? url : null
  } catch {
    return null
  }
}

function queryValues(url: URL): string[] {
  const values: string[] = []
  url.searchParams.forEach((value) => values.push(value))

  return values
}

// No control characters, which a terminal would act on, and the key's place after the host, so a key can't make one:
// the address must start with its host and a `/` once its places are filled.
function isTicketAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/\{(key|number)\}/.test(value) || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return false
  }
  const url = webAddress(value.replace(PLACE, "1"))

  return url !== null && value.startsWith(`${url.origin}/`)
}

function prefixOf(key: string): string {
  return key.slice(0, key.lastIndexOf("-") + 1)
}

// The link up to the key or number, with its place in its stead; what follows (a title's slug, a query) is left off.
function addressUpTo(url: URL, segments: readonly string[], at: number, place: string): string {
  return `${url.origin}${[...segments.slice(0, at), place].join("/")}`
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
