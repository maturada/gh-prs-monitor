// Author: David Matura

// How the pull requests that left the lists ended: GitHub's lookup of them by number and its answer read, and what
// the loads found, kept for the next cleanup.

// Pull requests that left a list, asked after by number: merged or closed, or still open and only out of the
// search (approved by the viewer, or past the first 30).
export function closedQuery(numbers: readonly number[]): string {
  const fields = numbers
    .filter((number) => Number.isInteger(number) && number > 0)
    .map(
      (number) =>
        `p${number}: pullRequest(number: ${number}) { number state headRefOid headRefName isCrossRepository ` +
        "headRepository { nameWithOwner } " +
        "mergedBy { login } " +
        "timelineItems(itemTypes: CLOSED_EVENT, last: 1) { nodes { ... on ClosedEvent { actor { login } } } } }"
    )

  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(" ")} } }`
}

// How a pull request ended (or that it is still open), who ended it, its last commit, and its branch, with the
// repository that branch is in (`owner/name`; null once that repository is deleted).
export type ClosedState = {
  number: number
  state: "MERGED" | "CLOSED" | "OPEN"
  by: string | null
  head: string | null
  branch: string | null
  isCrossRepository: boolean
  headRepo: string | null
}

type RawClosed = {
  number?: number
  state?: string
  headRefOid?: string
  headRefName?: string
  isCrossRepository?: boolean
  headRepository?: { nameWithOwner?: string } | null
  mergedBy?: { login?: string } | null
  timelineItems?: { nodes?: ({ actor?: { login?: string } | null } | null)[] }
} | null

// A pull request GitHub could not find (deleted with its repository's history) is left out; an answer with none to
// read, as one to a request GitHub refused, is null.
export function readClosed(json: string): ClosedState[] | null {
  let raw: { data?: { repository?: Record<string, RawClosed> | null } | null }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  const repository = raw?.data?.repository
  if (typeof repository !== "object" || repository === null) {
    return null
  }

  return Object.values(repository).flatMap((pull): ClosedState[] => {
    if (typeof pull?.number !== "number" || !["MERGED", "CLOSED", "OPEN"].includes(pull.state ?? "")) {
      return []
    }
    const state = pull.state as ClosedState["state"]
    const by = state === "MERGED" ? pull.mergedBy?.login : pull.timelineItems?.nodes?.at(-1)?.actor?.login

    return [
      {
        number: pull.number,
        state,
        by: by ?? null,
        head: pull.headRefOid ?? null,
        branch: pull.headRefName ?? null,
        isCrossRepository: pull.isCrossRepository === true,
        headRepo: pull.headRepository?.nameWithOwner ?? null
      }
    ]
  })
}

// What loads found of how pull requests ended, kept for the next cleanup: those found now are added to those kept, a
// number found again by its latest.
export function addStates(kept: readonly ClosedState[], found: readonly ClosedState[]): ClosedState[] {
  return [...kept.filter((state) => !found.some((each) => each.number === state.number)), ...found]
}

// The pull requests of `numbers` to ask GitHub how they ended: those a load did not find already (`known`).
export function numbersToAsk(numbers: readonly number[], known: readonly ClosedState[]): number[] {
  return numbers.filter((number) => !known.some((state) => state.number === number))
}
