// Author: David Matura

// `/prs tickets`: a repository's ticket links, set up by pasting a link to any ticket, then shown, added to or
// removed, in the plugin's dialog; where no pane draws, what is set is told as text.

import type { Answer, PullRow, Question, QuestionField } from "../types"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { CANCEL } from "./question"
import {
  isSamePrefix,
  LINK_PROBLEMS,
  linksIn,
  ticketAddress,
  ticketLink,
  ticketOf,
  withKeyForm,
  withLink,
  withoutPrefix
} from "./tickets"
import type { FoundLink, NeedsKey, TicketLinks } from "./tickets"

// What the flow needs of the engine (`register.tsx`): the dialog, the pull requests listed as a question about them is
// asked (the pane may still be loading them as the flow starts), the links kept for the repository as the store reads
// them back (`readTicketLinks`), keeping them, and a toast.
export type TicketsHost = {
  ask: (question: Question) => Promise<Answer | null>
  listed: () => Promise<readonly PullRow[]>
  recall: (repo: RepoRef) => Promise<TicketLinks | "off" | null>
  keep: (repo: RepoRef, value: TicketLinks | "off") => Promise<void>
  notify: (text: string) => Promise<void>
}

// The pull requests listed, whose branches and titles show what the links find, and whether rows show them.
export type TicketsView = { rows: readonly PullRow[]; isShowingTickets: boolean }

// Why a link is asked for: none kept yet; the last one removed, or Create PR told not to ask; or one more.
type Asking = "unset" | "off" | "adding"

const HEADER = "Ticket links"
const CHECK = "Check the link"
const USE_KEY = "Use this key"
const SAVE = "Save"
const ADD = "Add a link"
const REMOVE = "Remove"
const DONE = "Done"

const LINK_FIELD: QuestionField = {
  label: "Ticket link",
  placeholder: "https://…",
  submitLabel: "Check",
  otherHint: "Paste it under Other."
}

const KEY_FIELD: QuestionField = {
  label: "A ticket's key",
  placeholder: "ENG-12",
  submitLabel: "Use",
  otherHint: "Type it under Other."
}

const NOT_A_KEY = "That isn't a key: a prefix, then - or #, then a number, as ENG-12."

// The flow as the pane runs it: with links set, what they are and the ways to change them; else a link asked for and
// saved. Where the store fails to read or keep them, the person is told.
export async function ticketsFlow(host: TicketsHost, repo: RepoRef, isShowingTickets: boolean): Promise<void> {
  try {
    const kept = await host.recall(repo)
    if (kept === null || kept === "off") {
      await addLink(host, repo, isShowingTickets, kept === null ? "unset" : "off")

      return
    }
    const answer = await host.ask(setQuestion(repo, kept, { rows: await host.listed(), isShowingTickets }))
    if (answer?.choice === ADD) {
      await addLink(host, repo, isShowingTickets, "adding")
    } else if (answer?.choice === REMOVE) {
      await removeLink(host, repo, kept)
    }
  } catch (error) {
    await host.notify(`Couldn't read or save the ticket links: ${messageOf(error)}`)
  }
}

// What is set, as `/prs` prints it where no pane draws.
export function ticketsText(repo: RepoRef, kept: TicketLinks | "off" | null, view: TicketsView): string {
  const elsewhere = "with /prs tickets in the terminal, the desktop app or VS Code"
  if (kept === null || kept === "off") {
    return `${noLinks(repo, kept === null ? "unset" : "off")} Set them up ${elsewhere}, by pasting a link to any ticket.`
  }

  return `Ticket links for ${repo.name}: ${linksSentence(kept)}. ${howItReads(kept, view)} Change them ${elsewhere}.`
}

// Asks for a link, then, where it holds a number alone, for its key form; shows what it would link, and saves it with
// the links set. Those are read again as it saves: another session may have saved one while the person answered.
async function addLink(host: TicketsHost, repo: RepoRef, isShowingTickets: boolean, asking: Asking): Promise<void> {
  const link = await askLink(host, repo, asking)
  if (!link) {
    return
  }
  const answer = await host.ask(saveQuestion(repo, link, linksIn(await host.recall(repo)), await host.listed()))
  if (answer?.choice !== SAVE) {
    return
  }
  await host.keep(repo, withLink(await host.recall(repo), link))
  // Saved where rows don't show them, the person would see nothing change.
  const rows = isShowingTickets ? "" : " Rows don't show them: Ticket links on rows is off, in /config."
  await host.notify(
    `Ticket links saved for ${repo.name}: tickets like ${link.key} link to ${new URL(link.address).host}.${rows}`
  )
}

async function askLink(host: TicketsHost, repo: RepoRef, asking: Asking): Promise<FoundLink | null> {
  const pasted = await askUntil<FoundLink | NeedsKey>(
    host,
    (reason) => linkQuestion(repo, asking, reason),
    (text) => {
      const read = ticketLink(text, repo.host)

      return read.kind === "none" ? { reason: LINK_PROBLEMS[read.reason] } : { value: read }
    }
  )
  if (pasted === null || pasted.kind === "link") {
    return pasted
  }

  return askUntil<FoundLink>(
    host,
    (reason) => keyQuestion(repo, pasted.number, reason),
    (text) => {
      const link = withKeyForm(pasted, text)

      return link ? { value: link } : { reason: NOT_A_KEY }
    }
  )
}

// Asks until what is typed reads as wanted, the question saying why the last didn't; none where the person cancels.
// Nothing typed is no answer, so the question stays as it was.
async function askUntil<T>(
  host: TicketsHost,
  question: (reason: string | null) => Question,
  read: (text: string) => { value: T } | { reason: string }
): Promise<T | null> {
  let reason: string | null = null
  for (;;) {
    const answer = await host.ask(question(reason))
    if (!answer || answer.choice === CANCEL) {
      return null
    }
    if (answer.instructions.trim() === "") {
      continue
    }
    const result = read(answer.instructions)
    if ("value" in result) {
      return result.value
    }
    reason = result.reason
  }
}

// The last one removed leaves the links off, so the skills don't ask about them again; `/prs tickets` still sets them
// up. The links are read again as it removes one, as when it saves.
async function removeLink(host: TicketsHost, repo: RepoRef, links: TicketLinks): Promise<void> {
  const prefixes = Object.keys(links)
  const answer = await host.ask(removeQuestion(repo, prefixes))
  const prefix = prefixes.find((each) => answer?.choice === removeLabel(each))
  if (prefix === undefined) {
    return
  }
  const rest = withoutPrefix(linksIn(await host.recall(repo)), prefix)
  const isLast = Object.keys(rest).length === 0
  await host.keep(repo, isLast ? "off" : rest)
  await host.notify(
    `Removed the ${prefix} links for ${repo.name}${isLast ? "; none left, so Create PR won't ask about tickets here" : ""}.`
  )
}

function linkQuestion(repo: RepoRef, asking: Asking, reason: string | null): Question {
  return {
    header: HEADER,
    subject: repo.name,
    text:
      asking === "adding"
        ? "Paste a link to any ticket from the tracker to add, as copied from the browser."
        : `${noLinks(repo, asking)} Paste a link to any ticket from its tracker, as copied from the browser.`,
    detail:
      reason ??
      "Its pull requests then link to their tickets, found by the key in their branch or title. The link is read here alone; nothing is sent anywhere.",
    choices: [CHECK, CANCEL],
    main: CHECK,
    instructions: null,
    field: LINK_FIELD
  }
}

function keyQuestion(repo: RepoRef, number: string, reason: string | null): Question {
  return {
    header: HEADER,
    subject: repo.name,
    text:
      `This link holds only the ticket's number, ${number}. Type how branches and titles write a ticket, for example ` +
      `ENG-${number}; where they write the number alone, ticket links can't find these tickets.`,
    detail: reason,
    choices: [USE_KEY, CANCEL],
    main: USE_KEY,
    instructions: null,
    field: KEY_FIELD
  }
}

// What the link makes of its own ticket, and of one listed; where its keys have an address already, which it replaces.
// Asked by `/prs tickets`, and by the skills' tool before it keeps a link (`ticket-tool.ts`).
export function saveQuestion(repo: RepoRef, link: FoundLink, links: TicketLinks, rows: readonly PullRow[]): Question {
  const example = rows
    .map((row) => ({ row, ticket: ticketOf(rowText(row), { [link.prefix]: link.address }) }))
    .find(({ ticket }) => ticket !== null)
  const number = link.key.slice(link.prefix.length)
  const before = Object.entries(links).find(([prefix]) => isSamePrefix(prefix, link.prefix))?.[1]
  const replaced =
    before !== undefined && before !== link.address ? `, in place of ${ticketAddress(before, link.prefix, number)}` : ""

  return {
    header: HEADER,
    subject: repo.name,
    text: `Tickets like ${link.key} link to ${ticketAddress(link.address, link.prefix, number)}${replaced}. Save this for ${repo.name}?`,
    detail: example
      ? `#${example.row.number} ${example.row.title} would link ${example.ticket!.key}.`
      : `No pull request listed now names a ${link.prefix} ticket; those that do will link.`,
    choices: [SAVE, CANCEL],
    main: SAVE,
    instructions: null
  }
}

function setQuestion(repo: RepoRef, links: TicketLinks, view: TicketsView): Question {
  const rows = view.isShowingTickets
    ? "Shown on rows (Ticket links on rows, in /config)."
    : "Not shown on rows (Ticket links on rows, in /config); the skills still use them."

  return {
    header: HEADER,
    subject: repo.name,
    text: `${upperFirst(linksSentence(links))}.`,
    detail: `${howItReads(links, view)} ${rows}`,
    choices: [ADD, REMOVE, DONE],
    main: null,
    instructions: null
  }
}

function removeQuestion(repo: RepoRef, prefixes: readonly string[]): Question {
  return {
    header: HEADER,
    subject: repo.name,
    text: "Which ticket links should go?",
    detail: null,
    choices: [...prefixes.map(removeLabel), CANCEL],
    main: null,
    instructions: null
  }
}

function noLinks(repo: RepoRef, asking: "unset" | "off"): string {
  return asking === "unset"
    ? `No ticket links for ${repo.name} yet.`
    : `No ticket links for ${repo.name}; Create PR won't ask about tickets here.`
}

// The links as one clause, each shown on an example ticket: "tickets like WEB-123 link to …/WEB-123".
function linksSentence(links: TicketLinks): string {
  return Object.entries(links)
    .map(([prefix, address]) => `tickets like ${prefix}123 link to ${ticketAddress(address, prefix, "123")}`)
    .join("; ")
}

function removeLabel(prefix: string): string {
  return `${REMOVE} ${prefix}`
}

function upperFirst(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

// The pull requests named for what the links find, the first few, the rest counted.
const NAMED_FOUND = 3

// How keys are found, and what they find in the list now.
function howItReads(links: TicketLinks, view: TicketsView): string {
  const found = view.rows.flatMap((row) => {
    const ticket = ticketOf(rowText(row), links)

    return ticket ? [`#${row.number} → ${ticket.key}`] : []
  })
  const named = found.slice(0, NAMED_FOUND).join(", ")
  const more = found.length > NAMED_FOUND ? ` and ${found.length - NAMED_FOUND} more` : ""
  const without = view.rows.length - found.length
  const rest = without === 0 ? "" : `; ${without} pull request${without === 1 ? "" : "s"} without one`
  const now =
    view.rows.length === 0
      ? "no pull requests listed"
      : found.length === 0
        ? "none of the pull requests listed names one"
        : `${named}${more}${rest}`

  return `Keys are read from the branch first, then the title, in upper or lower case. Now: ${now}.`
}

function rowText(row: PullRow): { branch: string; title: string } {
  return { branch: row.headRefName, title: row.title }
}
