// Author: David Matura

// The plugin's store: a JSON file the sessions that load the plugin alike read and write (the terminal's one, the
// desktop app's another), 4 MiB of JSON in all, each key at most 256 characters (`storeKey`). Every key the plugin
// keeps there is named, read and written here, but the create-pr skill's choices', which `choicesKey` names: the last
// look at each repository, the pane's view, what cleanups left in place and the cleanup under way in each clone, the
// alerts shown, and the answers and claims sessions share; with what a failure to read or keep each costs, and what
// gives way when the store is full. The view and the choices are passed on as the store holds them, their checks and
// failures their callers' (`restoreView`, `toggleView`, `answerChoices`). What a value holds, and the check it passes
// when read back, belong to the module that decides with it.

import type { PullsSnapshot } from "../types"
import { freshAlerts } from "./alerts"
import type { AlertBatch } from "./alerts"
import { storedCleanupClaim } from "./cleanup"
import type { CleanupClaim } from "./cleanup"
import { isNothingKept, readKeptNotes } from "./kept-notes"
import type { KeptNotes } from "./kept-notes"
import type { CreateChoices } from "./create-choices"
import { isRepo, messageOf } from "./gh"
import type { RepoRef } from "./gh"
import { storedSnapshot } from "./pulls"
import { MAX_POLL_MINUTES } from "./settings"
import { audienceId, CLAIM_MS, isAhead, isKeptOver, SHARED_MAX_CHARS, storedClaim, storedShared } from "./shared"
import { readTicketLinks, ticketsKey } from "./tickets"
import type { TicketLinks } from "./tickets"
import type { FetchClaim, SharedAnswer } from "./shared"
import { storeKey } from "./store-keys"

// The store as the hooks module hands it in, with the clock and the debug log a failure goes to.
export type StoreHost = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
  now: () => Promise<number>
  log: (line: string) => void
}

// --- The last look at each repository ---

// The keys of the looks the store keeps, oldest first.
const LOOKS_KEY = "looks"

// How many repositories' looks the store keeps.
const LOOKS_KEPT = 20

const LOOK_PREFIX = "look:"

// Where the store keeps a repository's last look: the list as the pane last put it in front of the person, which the
// next session's first load and a /prs where nothing is drawn compare with.
export function lookKey(repo: RepoRef): string {
  return storeKey(LOOK_PREFIX, `${repo.host}/${repo.name}`)
}

// The store is small and shared by every repository a person works in, so only the latest few looks are kept: the
// one just taken last, and the oldest beyond the limit dropped. Looks the list doesn't name (`unlisted`) join it as
// recent ones, as each is a look another session kept just now and wrote the list without.
export function keptLooks(
  listed: unknown,
  key: string,
  unlisted: readonly string[] = []
): { kept: unknown[]; dropped: string[] } {
  const all = [
    ...(Array.isArray(listed) ? listed : []).filter((each) => each !== key),
    ...unlisted.filter((each) => each !== key),
    key
  ]

  return { kept: all.slice(-LOOKS_KEPT), dropped: all.slice(0, -LOOKS_KEPT).map(String) }
}

// The store is the plugin's across sessions, one look per repository; failing to read or keep one loses only a
// comparison.
export async function recallLook(store: StoreHost, repo: RepoRef): Promise<PullsSnapshot | null> {
  try {
    return storedSnapshot(await store.get(lookKey(repo)))
  } catch (error) {
    store.log(`The last look at ${repo.name} could not be read: ${messageOf(error)}`)

    return null
  }
}

export async function rememberLook(store: StoreHost, repo: RepoRef, snapshot: PullsSnapshot): Promise<void> {
  try {
    await withRoom(store, () => keepLook(store, repo, snapshot))
  } catch (error) {
    store.log(`The last look at ${repo.name} could not be kept: ${messageOf(error)}`)
  }
}

async function keepLook(store: StoreHost, repo: RepoRef, snapshot: PullsSnapshot): Promise<void> {
  const key = lookKey(repo)
  await store.set(key, snapshot)
  const listed = await store.get(LOOKS_KEY)
  // Most loads are of the repository looked at last, which the list already ends with: another write of the whole
  // store would change nothing.
  if (JSON.stringify(keptLooks(listed, key).kept) === JSON.stringify(listed)) {
    return
  }
  const { kept, dropped } = keptLooks(listed, key, await unlistedLooks(store, listed))
  for (const old of dropped) {
    await store.delete(old)
  }
  await store.set(LOOKS_KEY, kept)
}

// Two sessions keeping looks at two repositories at once can each write the list back without the other's: the looks
// the list doesn't name, which the limit would then never drop, while each is its repository's last look, read by the
// next session there.
async function unlistedLooks(store: StoreHost, listed: unknown): Promise<string[]> {
  const named = new Set(Array.isArray(listed) ? listed.map(String) : [])

  return (await store.keys()).filter((each) => each.startsWith(LOOK_PREFIX) && !named.has(each))
}

// --- The folders repositories are cloned in ---

// Every session notes its folder's main checkout: the latest 50 folders, newest first, in one record, so the picker and
// a visit's branch skills read them all in one read of the store.
const CLONES = "clones"
export const CLONES_LIMIT = 50

// A folder on this machine, and the repository its session found there, as GitHub writes its name; with the remote gh
// found it by, as its git config writes it, where that reads otherwise (`remote`): a clone left on a repository's old
// name after GitHub renamed or moved it, or reached through an SSH alias with a dot (`github.com-work`).
export type NotedClone = { root: string; repo: RepoRef; remote?: RepoRef }

// Noting a folder is a saving for the picker and a visit's branch skills: failing to keep one loses only that. Two
// sessions noting at once may write over each other's list, so the note is read back and written once more where it
// was taken away.
export async function noteClone(store: StoreHost, clone: NotedClone, at: number): Promise<void> {
  const { root } = clone
  try {
    await withRoom(store, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const kept = readNotedList(await store.get(CLONES)).filter((each) => each.root !== root)
        await store.set(CLONES, [{ ...clone, at }, ...kept].slice(0, CLONES_LIMIT))
        if (readNotedList(await store.get(CLONES)).some((each) => each.root === root)) {
          return
        }
      }
    })
  } catch (error) {
    store.log(`The folder ${root} could not be noted: ${messageOf(error)}`)
  }
}

// The folders noted, newest first, but `own`, the session's own; none where the store can't be read.
export async function knownClones(store: StoreHost, own: string | null): Promise<NotedClone[]> {
  try {
    return readNotedList(await store.get(CLONES))
      .filter((each) => each.root !== own)
      .sort((a, b) => b.at - a.at)
      .map(({ at: _, ...clone }) => clone)
  } catch (error) {
    store.log(`The folders noted could not be read: ${messageOf(error)}`)

    return []
  }
}

// The noted folders a record holds; what isn't one is skipped.
function readNotedList(value: unknown): (NotedClone & { at: number })[] {
  return Array.isArray(value) ? value.flatMap(readNoted) : []
}

function readNoted(value: unknown): (NotedClone & { at: number })[] {
  const { root, repo, remote, at } = (value as { root?: unknown; repo?: unknown; remote?: unknown; at?: unknown }) ?? {}

  return typeof root === "string" && isRepo(repo) && typeof at === "number"
    ? [
        {
          root,
          repo: { host: repo.host, name: repo.name },
          ...(isRepo(remote) ? { remote: { host: remote.host, name: remote.name } } : {}),
          at
        }
      ]
    : []
}

// --- The pane's view ---

// The person's choice of view, kept across sessions.
const COMPACT_KEY = "isCompact"

// What the store holds for the view: compact where it is `true`.
export function recallView(store: StoreHost): Promise<unknown> {
  return store.get(COMPACT_KEY)
}

export function keepView(store: StoreHost, isCompact: boolean): Promise<void> {
  return keepValue(store, COMPACT_KEY, isCompact)
}

// --- What cleanups left in place, and the cleanup under way ---

// Where the store keeps what cleanups left in place in a clone of a repository (`KeptNotes`), by the clone's main root:
// each clone has worktrees and branches of its own, and a session there forgets the notes on any it doesn't have.
export function keptKey(repo: RepoRef, root: string): string {
  return storeKey("kept:", `${repo.host}/${repo.name}:${root}`)
}

// What cleanups left in place in a clone (`KeptNotes`); failing to read or keep it only tells one again.
export async function recallKept(store: StoreHost, repo: RepoRef, root: string): Promise<KeptNotes> {
  try {
    return readKeptNotes(await store.get(keptKey(repo, root)))
  } catch (error) {
    store.log(`What cleanups kept at ${repo.name} could not be read: ${messageOf(error)}`)

    return readKeptNotes(null)
  }
}

export async function keepKept(store: StoreHost, repo: RepoRef, root: string, kept: KeptNotes): Promise<void> {
  const key = keptKey(repo, root)
  try {
    await (isNothingKept(kept) ? store.delete(key) : keepValue(store, key, kept))
  } catch (error) {
    store.log(`What cleanups kept at ${repo.name} could not be kept: ${messageOf(error)}`)
  }
}

// Where the store keeps the claim of the session cleaning up a clone now (`CleanupClaim`), by the clone's main root.
export function cleanupKey(root: string): string {
  return storeKey("cleanup:", root)
}

// Failing to read a claim cleans up as if none were made; failing to keep one leaves another session to clean up
// alongside, and failing to free one, to wait until it lapses. Each costs at most a note told wrong or late: what a
// removal checks is git's, never the claim's.
export async function recallCleanup(store: StoreHost, root: string): Promise<CleanupClaim | null> {
  try {
    return storedCleanupClaim(await store.get(cleanupKey(root)))
  } catch (error) {
    store.log(`The claim on the cleanup of ${root} could not be read: ${messageOf(error)}`)

    return null
  }
}

export async function claimCleanup(store: StoreHost, root: string, claim: CleanupClaim): Promise<void> {
  try {
    await keepValue(store, cleanupKey(root), claim)
  } catch (error) {
    store.log(`The cleanup of ${root} could not be claimed: ${messageOf(error)}`)
  }
}

// Only a claim of the session's own: one another session made once this one's lapsed is that session's.
export async function freeCleanup(store: StoreHost, root: string, by: string): Promise<void> {
  try {
    if (storedCleanupClaim(await store.get(cleanupKey(root)))?.by === by) {
      await store.delete(cleanupKey(root))
    }
  } catch (error) {
    store.log(`The claim on the cleanup of ${root} could not be freed: ${messageOf(error)}`)
  }
}

// --- The alerts shown ---

// Which alerts a session showed, so another session in the same repository leaves them out (`freshAlerts`).
const SHOWN_KEY = "shown"

// What of the batches, each from when it was raised, no other session showed lately, now marked as shown by this one
// (`by`); all of them where the marks can't be read or kept, as an alert shown twice costs less than one lost.
export async function notShownByOtherSessions(
  store: StoreHost,
  batches: readonly AlertBatch[],
  shown: { by: string; pollMs: number }
): Promise<AlertBatch[]> {
  const at = await store.now()
  try {
    const { fresh, marks } = freshAlerts(await store.get(SHOWN_KEY), batches, { ...shown, at })
    await keepValue(store, SHOWN_KEY, marks)

    return fresh
  } catch (error) {
    store.log(`Shown alerts could not be checked: ${messageOf(error)}`)

    return [...batches]
  }
}

// --- The answers and claims sessions share ---

// An audience too long for a key is kept under its hash (`storeKey`), for the answer and the claim alike, so the two
// keys end the same.
export function sharedKey(id: string): string {
  return storeKey(SHARED_PREFIX, id)
}

export function claimKey(id: string): string {
  return storeKey(CLAIM_PREFIX, id, SHARED_PREFIX)
}

export function isSharingKey(key: string): boolean {
  return key.startsWith(SHARED_PREFIX) || key.startsWith(CLAIM_PREFIX)
}

const SHARED_PREFIX = "shared:"
const CLAIM_PREFIX = "claim:"

// The store holds the last looks and the plugin's other keys within 4 MiB, so the answers shared are kept to the
// latest that fit in as much as four of the largest take: those of many repositories, each answer usually far smaller.
export const SHARED_KEPT_CHARS = 4 * SHARED_MAX_CHARS

// The answer the sessions in a repository share (`shared.ts`), and the claim of one asking GitHub now. Failing to read
// one asks GitHub; failing to keep one leaves the other sessions to ask it themselves.
export async function recallShared(store: StoreHost, repo: RepoRef, viewer: string): Promise<SharedAnswer | null> {
  try {
    return storedShared(await store.get(sharedKey(audienceId(repo, viewer))))
  } catch (error) {
    store.log(`The list shared for ${repo.name} could not be read: ${messageOf(error)}`)

    return null
  }
}

// An answer to a request that went out before the kept one's stays out, though it came later (`isKeptOver`). The check
// and the write are two store calls, so two sessions sharing at the same moment can still cross, which costs a refresh
// of sharing, not a step back (`newerShared`).
export async function shareAnswer(store: StoreHost, repo: RepoRef, shared: SharedAnswer): Promise<boolean> {
  const key = sharedKey(audienceId(repo, shared.viewer))
  try {
    if (isKeptOver(storedShared(await store.get(key)), shared, await store.now())) {
      return true
    }
    await keepValue(store, key, shared)
  } catch (error) {
    store.log(`The list of ${repo.name} could not be shared: ${messageOf(error)}`)

    return false
  }
  await pruneShared(store)

  return true
}

// Only the latest answers that fit in `SHARED_KEPT_CHARS` are kept (`sharedToDrop`); those that fail to go are tried
// again with the next answer shared.
async function pruneShared(store: StoreHost): Promise<void> {
  try {
    const stored: Record<string, unknown> = {}
    for (const key of (await store.keys()).filter(isSharingKey)) {
      stored[key] = await store.get(key)
    }
    for (const key of sharedToDrop(stored, await store.now())) {
      await store.delete(key)
    }
  } catch (error) {
    store.log(`The lists shared before could not be cleared: ${messageOf(error)}`)
  }
}

// What the store lets go after a session shares an answer: the answers read longer ago than the longest interval, which
// every session's tick finds due, and those past the latest that fit in `SHARED_KEPT_CHARS`, by when they were read,
// one it can't read or dated ahead of the clock counted oldest; and the claims of repositories whose answer it doesn't
// keep, once lapsed. So the store holds the repositories worked in lately, not every one shared since.
export function sharedToDrop(stored: Readonly<Record<string, unknown>>, now: number): string[] {
  const { kept, dropped } = answersKept(stored, now)

  return [...dropped, ...lapsedClaims(stored, kept, now)]
}

function answersKept(stored: Readonly<Record<string, unknown>>, now: number): { kept: Set<string>; dropped: string[] } {
  const answers = Object.keys(stored)
    .filter((key) => key.startsWith(SHARED_PREFIX))
    .map((key) => {
      const answer = storedShared(stored[key])

      return {
        key,
        fetchedAt: answer && !isAhead(answer.fetchedAt, now) ? answer.fetchedAt : -Infinity,
        isDue: answer !== null && now - answer.fetchedAt > MAX_POLL_MINUTES * 60_000,
        // A key gone between listing the store and reading it holds nothing.
        chars: JSON.stringify(stored[key] ?? null).length
      }
    })
    .sort((one, other) => other.fetchedAt - one.fetchedAt)
  const kept = new Set<string>()
  let chars = 0
  for (const answer of answers.filter(({ isDue }) => !isDue)) {
    chars += answer.chars
    if (chars > SHARED_KEPT_CHARS) {
      break
    }
    kept.add(answer.key)
  }

  return { kept, dropped: answers.filter(({ key }) => !kept.has(key)).map(({ key }) => key) }
}

// The claims of repositories whose answer the store doesn't keep (`keptAnswers`, by key), once lapsed.
function lapsedClaims(
  stored: Readonly<Record<string, unknown>>,
  keptAnswers: ReadonlySet<string>,
  now: number
): string[] {
  const kept = new Set([...keptAnswers].map((key) => key.slice(SHARED_PREFIX.length)))

  return Object.keys(stored).filter((key) => {
    const at = storedClaim(stored[key])?.at ?? -Infinity

    return (
      key.startsWith(CLAIM_PREFIX) &&
      !kept.has(key.slice(CLAIM_PREFIX.length)) &&
      (now - at >= CLAIM_MS || isAhead(at, now))
    )
  })
}

export async function recallClaim(store: StoreHost, repo: RepoRef, viewer: string): Promise<FetchClaim | null> {
  try {
    return storedClaim(await store.get(claimKey(audienceId(repo, viewer))))
  } catch (error) {
    store.log(`The claim on ${repo.name}'s refresh could not be read: ${messageOf(error)}`)

    return null
  }
}

// A claim is one of the keys a full store frees (`withRoom`), so it makes no room itself: a store too full for it keeps
// the answers shared.
export async function claimFetch(store: StoreHost, repo: RepoRef, claim: FetchClaim): Promise<void> {
  try {
    await store.set(claimKey(audienceId(repo, claim.viewer)), claim)
  } catch (error) {
    store.log(`The refresh of ${repo.name} could not be claimed: ${messageOf(error)}`)
  }
}

// Every answer and claim shared: with sharing off nobody takes them, and a full store gives them up.
export async function freeShared(store: StoreHost): Promise<void> {
  for (const key of (await store.keys()).filter(isSharingKey)) {
    await store.delete(key)
  }
}

// --- The create-pr skill's choices ---

// The create-pr skill's choices, under the key `choicesKey` makes of the repository the skill names, as the store holds
// them (`readChoices` reads them back). A failure is the caller's to say.
export function recallChoices(store: StoreHost, key: string): Promise<unknown> {
  return store.get(key)
}

export function keepChoices(store: StoreHost, key: string, choices: CreateChoices): Promise<void> {
  return keepValue(store, key, choices)
}

// --- Ticket links ---

// The ticket links kept for a repository, or off. A failure is the caller's to say.
export async function recallTickets(store: StoreHost, repo: RepoRef): Promise<TicketLinks | "off" | null> {
  return readTicketLinks(await store.get(ticketsKey(repo)))
}

// Links, or off, kept for a repository.
export function keepTickets(store: StoreHost, repo: RepoRef, value: TicketLinks | "off"): Promise<void> {
  return keepValue(store, ticketsKey(repo), value)
}

// --- A full store ---

// The store refuses a write that would take it past its 4 MiB, and says so. The answers sessions share are only a
// saving, so they give way to everything else it keeps, and the write is made once more, also where another session
// gave them up first. Every write of the plugin's goes this way (`keepValue`) but a refresh's claim (`claimFetch`):
// that claim is one of those keys itself, and can't make room by freeing them.
async function withRoom(store: StoreHost, write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (!isStoreFull(error)) {
      throw error
    }
    await freeShared(store)
    await write()
  }
}

function keepValue(store: StoreHost, key: string, value: unknown): Promise<void> {
  return withRoom(store, () => store.set(key, value))
}

function isStoreFull(error: unknown): boolean {
  return /store would be \d+ characters, over the \d+ limit/.test(messageOf(error))
}
