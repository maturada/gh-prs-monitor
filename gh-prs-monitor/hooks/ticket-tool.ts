// Author: David Matura

// The skills' ticket tool: what Create PR and Review learn of a pull request's ticket, and a link Create PR was given,
// kept, all read by code here as the rows read them, so a skill never reads a link or a key itself.

import type { ToolCallResult } from "claude-code"

import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { keyLikeIn, LINK_PROBLEMS, linksIn, ticketLink, ticketOf, withLink } from "./tickets"
import type { TicketLinks } from "./tickets"

export const TICKET_TOOL = {
  name: "ticket_links",
  description:
    'For the gh-prs-monitor skills: the ticket a pull request names, by its key in its branch or title, as JSON {"key","url"}, or "none"; with `key`, that key\'s link; with `save`, keeps a ticket link the user pasted (verbatim) as this repository\'s, or "off" for their no where none are set up. Not set up, a branch with a key-like word answers {"unset": key}.',
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "The repository, as <host>/<owner>/<name>: github.com/acme/app" },
      branch: { type: "string", description: "The pull request's branch" },
      title: { type: "string", description: "The pull request's title" },
      key: { type: "string", description: "A ticket's key the user named, as WEB-5785" },
      save: { type: "string", maxLength: 2048, description: 'A ticket link as the user pasted it, or "off"' }
    },
    required: ["repo"],
    additionalProperties: false
  }
}

// What the tool needs of the plugin (`register.tsx`): the links kept for a repository, and keeping them, which sets
// the session's rows too.
export type TicketToolHost = {
  recall: (repo: RepoRef) => Promise<TicketLinks | "off" | null>
  keep: (repo: RepoRef, value: TicketLinks | "off") => Promise<void>
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

// A link joins those kept, the person's no turns them off; a link that can't be used says why, and keeps nothing.
async function save(
  host: TicketToolHost,
  repo: RepoRef,
  text: string,
  pull: { branch: string; title: string }
): Promise<ToolCallResult> {
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
  const pasted = ticketLink(text, repo.host)
  if (pasted.kind === "none") {
    return { deny: LINK_PROBLEMS[pasted.reason] }
  }
  if (pasted.kind === "needs-key") {
    return {
      deny: "That link holds only the ticket's number: /prs tickets sets such a tracker up, asking how its keys are written."
    }
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
