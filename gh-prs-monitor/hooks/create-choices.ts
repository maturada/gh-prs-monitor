// Author: David Matura

import type { ToolCallResult } from "claude-code"

import { messageOf } from "./gh"
import { storeKey } from "./store-keys"

// What the create-pr skill keeps from a pull request it opened, per repository, to offer again next time: whether it
// went up as a draft, the checks run before it, and the reviewers asked. The plugin's store keeps it, and its tool
// (`CHOICES_TOOL`) hands it over, so the skill writes nothing into the repository.
export type CreateChoices = { isDraft: boolean; checks: string[]; reviewers: string[] }

// Where the store keeps a repository's, named `<host>/<owner>/<name>` as the skill finds it; GitHub's names hold no
// case, so neither does the key. None for a name of another form.
export function choicesKey(repo: string): string | null {
  return /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(repo) ? storeKey("createPr:", repo.toLowerCase()) : null
}

// Choices as the store or the skill gives them: none unless each part has its shape.
export function readChoices(value: unknown): CreateChoices | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const { isDraft, checks, reviewers } = value as Partial<Record<keyof CreateChoices, unknown>>

  return typeof isDraft === "boolean" && isTexts(checks) && isTexts(reviewers) ? { isDraft, checks, reviewers } : null
}

// A run's checks or reviewers are a handful of short names; the bounds keep one call from filling the store every
// key shares.
const MAX_CHOICES = 50
const MAX_CHOICE_CHARS = 200

function isTexts(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CHOICES &&
    value.every((each) => typeof each === "string" && each.length <= MAX_CHOICE_CHARS)
  )
}

export const CHOICES_TOOL = {
  name: "create_pr_choices",
  description:
    "For the gh-prs-monitor create-pr skill: the choices the user made the last time it opened a pull request in the repository (draft or not, the checks run, the reviewers asked), as JSON, or none; with `save`, keeps this run's choices instead.",
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "The repository, as <host>/<owner>/<name>: github.com/acme/app" },
      save: {
        type: "object",
        properties: {
          isDraft: { type: "boolean" },
          checks: { type: "array", items: { type: "string", maxLength: MAX_CHOICE_CHARS }, maxItems: MAX_CHOICES },
          reviewers: { type: "array", items: { type: "string", maxLength: MAX_CHOICE_CHARS }, maxItems: MAX_CHOICES }
        },
        required: ["isDraft", "checks", "reviewers"],
        additionalProperties: false
      }
    },
    required: ["repo"],
    additionalProperties: false
  }
}

// The store as the choices tool reaches it, under the key `choicesKey` makes: what it holds there (read back by
// `readChoices`), and new choices written.
export type KeptChoices = {
  recall: (key: string) => Promise<unknown>
  keep: (key: string, choices: CreateChoices) => Promise<void>
}

// The create-pr skill's choices, kept per repository: handed over, or kept on `save`. The plugin answers the call
// itself, so it asks no permission. A refusal is what the skill reads, and goes on without them.
export async function answerChoices(
  store: KeptChoices,
  input: { repo?: unknown; save?: unknown }
): Promise<ToolCallResult> {
  const { repo, save } = input
  try {
    const key = typeof repo === "string" ? choicesKey(repo) : null
    if (!key) {
      return { deny: "repo names the repository as <host>/<owner>/<name>, as github.com/acme/app." }
    }
    if (save === undefined) {
      const kept = readChoices(await store.recall(key))

      return { result: kept ? JSON.stringify(kept) : "none" }
    }
    const choices = readChoices(save)
    if (!choices) {
      return {
        deny: "save takes isDraft (true or false), checks and reviewers (lists of up to 50 texts, each up to 200 characters)."
      }
    }
    await store.keep(key, choices)

    return { result: "saved" }
  } catch (error) {
    return { deny: `The choices could not be read or kept: ${messageOf(error)}` }
  }
}
