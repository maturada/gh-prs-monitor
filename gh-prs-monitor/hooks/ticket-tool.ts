// Author: David Matura

// The skills' ticket tool: what Create PR and Review learn of a pull request's ticket, and a link Create PR was given,
// kept, all read by code here as the rows read them, so a skill never reads a link or a key itself.

import type { ToolCallResult } from "claude-code"

import type { Answer, PullRow, Question } from "../types"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { keyLikeIn, LINK_PROBLEMS, linksIn, ticketLink, ticketOf, ticketsKey, withLink } from "./tickets"
import type { TicketLinks } from "./tickets"
import { saveQuestion } from "./tickets-flow"

// The longest link the tool reads, as its schema says: a ticket's link is far shorter, and a longer one would push
// the dialog's question out of view.
const MAX_LINK = 2048

export const TICKET_TOOL = {
  name: "ticket_links",
  description:
    'For the gh-prs-monitor skills: the ticket a pull request names, by its key in its branch or title, as JSON {"key","url"}, or "none"; with `key`, that key\'s link; with `save`, a ticket link the user pasted (verbatim), kept as this session\'s repository\'s once the user saves it in the dialog it shows, or "off" for their no where none are set up. Not set up, a branch with a key-like word answers {"unset": key}.',
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "The repository, as <host>/<owner>/<name>: github.com/acme/app" },
      branch: { type: "string", description: "The pull request's branch" },
      title: { type: "string", description: "The pull request's title" },
      key: { type: "string", description: "A ticket's key the user named, as WEB-5785" },
      save: { type: "string", maxLength: MAX_LINK, description: 'A ticket link as the user pasted it, or "off"' }
    },
    required: ["repo"],
    additionalProperties: false
  }
}

// What the tool needs of the plugin (`register.tsx`): the links kept for a repository, and keeping them, which sets
// the session's rows too; the session's own repository, null before it is known; a question in Claude Code's own
// dialog, which the person alone answers; and the pull requests listed, for what a link would find.
export type TicketToolHost = {
  recall: (repo: RepoRef) => Promise<TicketLinks | "off" | null>
  keep: (repo: RepoRef, value: TicketLinks | "off") => Promise<void>
  ownRepo: () => RepoRef | null
  ask: (question: Question) => Promise<Answer | null>
  listed: () => Promise<readonly PullRow[]>
  // The repositories (`ticketsKey`) whose link the person didn't save in this session, which it asks about no more.
  declined: Set<string>
}

type Input = { repo?: unknown; branch?: unknown; title?: unknown; key?: unknown; save?: unknown }

// The plugin answers the call itself, so it asks no permission. A refusal is what the skill reads, and goes on
// without a ticket.
export async function answerTicketLinks(host: TicketToolHost, input: Input): Promise<ToolCallResult> {
  const repo = typeof input.repo === "string" ? repoOf(input.repo) : null
  if (!repo) {
    return { deny: "repo names the repository as <host>/<owner>/<name>, as github.com/acme/app." }
  }
  const branch = textOf(input.branch)
  const title = textOf(input.title)
  try {
    if (typeof input.save === "string") {
      return await save(host, repo, input.save, { branch, title })
    }
    const kept = await host.recall(repo)
    if (kept === null && typeof input.key !== "string") {
      const key = keyLikeIn(branch)

      return { result: key ? JSON.stringify({ unset: key }) : "none" }
    }
    // Off, there are no links, so no ticket.
    const pull = typeof input.key === "string" ? { branch: input.key, title: "" } : { branch, title }
    const ticket = ticketOf(pull, linksIn(kept))

    return { result: ticket ? JSON.stringify(ticket) : "none" }
  } catch (error) {
    return { deny: `The ticket links could not be read or kept: ${messageOf(error)}` }
  }
}

// A link joins those kept once the person saves it, the person's no turns them off; a link that can't be used says
// why, and keeps nothing. Only the session's own repository: a call can name any.
async function save(
  host: TicketToolHost,
  repo: RepoRef,
  text: string,
  pull: { branch: string; title: string }
): Promise<ToolCallResult> {
  const own = host.ownRepo()
  if (!own || ticketsKey(own) !== ticketsKey(repo)) {
    return { deny: `Ticket links are saved for this session's repository alone${own ? `, ${own.name}` : ""}.` }
  }
  if (text.trim() === "off") {
    // A no where links are set up is about this pull request alone: they stay.
    const kept = await host.recall(repo)
    if (kept !== null && kept !== "off") {
      return { result: `Ticket links stay set up for ${repo.name}: /prs tickets removes them.` }
    }
    await host.keep(repo, "off")

    return {
      result: `Ticket links are off for ${repo.name}: Create PR won't ask about them there again; /prs tickets sets them up.`
    }
  }
  if (text.length > MAX_LINK) {
    return { deny: "That link is too long to be a ticket's link." }
  }
  const pasted = ticketLink(text, repo.host)
  if (pasted.kind === "none") {
    return { deny: LINK_PROBLEMS[pasted.reason] }
  }
  if (pasted.kind === "needs-key") {
    return {
      deny: "That link holds only the ticket's number: /prs tickets sets such a tracker up, asking how its keys are written."
    }
  }
  // The call may come from text the model read rather than from the person: Claude Code's own dialog, which they alone
  // answer, says a skill asks and shows what the link would make, and any address it would replace, before anything
  // is kept. Their no holds for the session, so such text can't ask again until they give in.
  if (host.declined.has(ticketsKey(repo))) {
    return { deny: "Not saved: the user didn't save a ticket link here in this session; /prs tickets sets them up." }
  }
  const asked = saveQuestion(repo, pasted, linksIn(await host.recall(repo)), await host.listed())
  const question = { ...asked, text: `A skill asks to keep a ticket link. ${asked.text}` }
  if ((await host.ask(question))?.choice !== question.main) {
    host.declined.add(ticketsKey(repo))

    return { deny: "Not saved: the user didn't save the link in the dialog." }
  }
  const links = withLink(await host.recall(repo), pasted)
  await host.keep(repo, links)
  const ticket = ticketOf(pull, links)

  return { result: JSON.stringify({ saved: pasted.prefix, ...(ticket ?? {}) }) }
}

function repoOf(text: string): RepoRef | null {
  const found = /^([^/\s]+)\/([^/\s]+\/[^/\s]+)$/.exec(text)

  return found ? { host: found[1]!, name: found[2]! } : null
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}
