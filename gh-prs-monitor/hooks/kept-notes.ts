// Author: David Matura

// What cleanups left in place, as the store keeps it across sessions (`store.ts`): a note for each worktree and branch
// /prs made, by pull request, and the check it passes when read back. What a cleanup does with them is `cleanup.ts`'s.

// What a cleanup kept, by pull request, as last told: the note for each worktree and branch /prs made, kept across
// sessions so each is told once, until why it stays changes (`toldOnce`).
export type KeptNotes = { worktrees: Record<string, string>; branches: Record<string, string> }

export function isNothingKept(kept: KeptNotes): boolean {
  return Object.keys(kept.worktrees).length === 0 && Object.keys(kept.branches).length === 0
}

export function readKeptNotes(value: unknown): KeptNotes {
  const notesOf = (part: unknown): Record<string, string> =>
    typeof part === "object" && part !== null
      ? Object.fromEntries(
          Object.entries(part).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
      : {}
  const stored = typeof value === "object" && value !== null ? (value as Partial<KeptNotes>) : {}

  return { worktrees: notesOf(stored.worktrees), branches: notesOf(stored.branches) }
}
