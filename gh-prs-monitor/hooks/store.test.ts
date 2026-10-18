// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { audienceId, QUERY_VERSION } from "./shared"
import {
  claimCleanup,
  claimFetch,
  claimKey,
  cleanupKey,
  freeCleanup,
  freeShared,
  isSharingKey,
  keepKept,
  keepView,
  keptKey,
  keptLooks,
  lookKey,
  notShownElsewhere,
  recallClaim,
  recallCleanup,
  recallKept,
  recallLook,
  recallShared,
  recallView,
  rememberLook,
  shareAnswer,
  SHARED_KEPT_CHARS,
  sharedKey,
  sharedToDrop
} from "./store"
import type { StoreHost } from "./store"
import { shortHash } from "./store-keys"
import { answer, fetchClaim, MINUTE, REPO, snapshotOf } from "./testing/fixtures"
import { memoryStoreHost } from "./testing/memory-store"
import type { StoreWorld } from "./testing/memory-store"

const ID = audienceId(REPO, "me")
const DAY = 24 * 60 * MINUTE

// A store in memory holding `values`, `store.ts`'s host over it at `now`, and the debug lines it logs.
function storeWith(
  values: Record<string, unknown>,
  now = 11 * MINUTE
): { world: StoreWorld; host: StoreHost; logs: string[] } {
  const world: StoreWorld = { store: values }
  const logs: string[] = []

  return { world, host: memoryStoreHost(world, { now }, logs), logs }
}

// The message a write or delete is refused with; null where it was made.
function refusalOf(write: Promise<unknown>): Promise<string | null> {
  return write.then(
    () => null,
    (error: Error) => error.message
  )
}

const FULL = /^gh-prs-monitor: \$\.store\.set: the store would be \d+ characters, over the \d+ limit$/

describe("what the store keeps for the sessions in a repository", () => {
  test("keys by repository, person and query, so other accounts' and versions' sessions keep theirs apart", () => {
    const id = audienceId({ name: "acme/app", host: "git.acme.dev" }, "me")

    expect([id, sharedKey(id), claimKey(id)]).toEqual([
      `git.acme.dev/acme/app:me:${QUERY_VERSION}`,
      `shared:git.acme.dev/acme/app:me:${QUERY_VERSION}`,
      `claim:git.acme.dev/acme/app:me:${QUERY_VERSION}`
    ])
    expect(audienceId({ name: "acme/app", host: "git.acme.dev" }, "you")).not.toBe(id)
    expect([sharedKey(id), claimKey(id), "shared", "look:x", "shown"].map(isSharingKey)).toEqual([
      true,
      true,
      false,
      false,
      false
    ])
  })

  test("keys an audience too long for the store's 256 characters by its hash", () => {
    const longest = (owner: string) =>
      audienceId({ name: `${owner}/${"r".repeat(100)}`, host: `${"h".repeat(60)}.example` }, "v".repeat(39))
    const id = longest("o".repeat(39))

    expect([sharedKey(id), claimKey(id)]).toEqual([`shared:${shortHash(id)}`, `claim:${shortHash(id)}`])
    expect(sharedKey(longest("p".repeat(39)))).not.toBe(sharedKey(id))
    const fitting = "x".repeat(256 - "shared:".length)
    expect([sharedKey(fitting), sharedKey(`${fitting}x`), claimKey(`${fitting}x`)]).toEqual([
      `shared:${fitting}`,
      `shared:${shortHash(`${fitting}x`)}`,
      // The claim's key, one shorter, ends as the answer's does.
      `claim:${shortHash(`${fitting}x`)}`
    ])
  })

  test("keeps the latest answers that fit, by when they were read, and lapsed claims only with them", () => {
    const now = 11 * MINUTE
    // Four of these fit, as four of the largest would.
    const readAt = (fetchedAt: number) => answer({ requestedAt: 0, fetchedAt, answer: { data: "x".repeat(140_000) } })
    const stored = {
      // Dated ahead of the clock, as after the clock was set back.
      "shared:github.com/a/0": answer({ requestedAt: now + 2 * MINUTE, fetchedAt: now + 2 * MINUTE }),
      "shared:github.com/a/1": readAt(5),
      "shared:github.com/a/2": readAt(4),
      "shared:github.com/a/3": "unreadable",
      "shared:github.com/a/4": readAt(3),
      "shared:github.com/a/5": readAt(2),
      "shared:github.com/a/6": readAt(1),
      "claim:github.com/a/1": fetchClaim("other", 0),
      "claim:github.com/a/6": fetchClaim("other", 0),
      // A repository none shared yet: its claim stays while it holds.
      "claim:github.com/a/7": fetchClaim("other", now - 5_000),
      "claim:github.com/a/8": fetchClaim("other", now - 35_000),
      // Dated ahead of the clock: it lapses too, as one that can't be read does.
      "claim:github.com/a/9": fetchClaim("other", now + 2 * MINUTE),
      "claim:github.com/a/10": "unreadable",
      "look:github.com/a/1": {}
    }

    expect(sharedToDrop(stored, now).sort()).toEqual(
      [
        "shared:github.com/a/0",
        "shared:github.com/a/3",
        "shared:github.com/a/6",
        "claim:github.com/a/6",
        "claim:github.com/a/8",
        "claim:github.com/a/9",
        "claim:github.com/a/10"
      ].sort()
    )
  })

  test("keeps the answers of many repositories where they are small, up to the room four of the largest take", () => {
    const now = 11 * MINUTE
    const sized = (fetchedAt: number, chars: number) => {
      const empty = answer({ requestedAt: 0, fetchedAt, answer: { data: "" } })

      return { ...empty, answer: { data: "x".repeat(chars - JSON.stringify(empty).length) } }
    }
    const small = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `shared:github.com/a/${index}`,
        answer({ requestedAt: 0, fetchedAt: index })
      ])
    )
    expect(sharedToDrop(small, now)).toEqual([])
    // One gone between listing the store and reading it.
    expect(sharedToDrop({ ...small, "shared:github.com/gone": undefined }, now)).toEqual([])

    const half = SHARED_KEPT_CHARS / 2
    const full = {
      "shared:github.com/a/1": sized(3, half),
      "shared:github.com/a/2": sized(2, half),
      "shared:github.com/a/3": answer({ requestedAt: 0, fetchedAt: 1 })
    }
    expect(sharedToDrop(full, now)).toEqual(["shared:github.com/a/3"])
    expect(sharedToDrop({ ...full, "shared:github.com/a/2": sized(2, half + 1) }, now)).toEqual([
      "shared:github.com/a/2",
      "shared:github.com/a/3"
    ])
  })

  test("lets go of the answers read longer ago than the longest interval, and of their claims", () => {
    const day = 24 * 60 * MINUTE
    const now = 3 * day
    const stored = {
      "shared:github.com/a/1": answer({ requestedAt: 0, fetchedAt: now - day }),
      "shared:github.com/a/2": answer({ requestedAt: 0, fetchedAt: now - day - 1 }),
      "claim:github.com/a/2": fetchClaim("other", 0)
    }

    expect(sharedToDrop(stored, now).sort()).toEqual(["claim:github.com/a/2", "shared:github.com/a/2"])
  })
})

describe("the looks the store keeps", () => {
  test("one per repository, the latest twenty, the one just taken last", () => {
    const key = lookKey({ host: "github.com", name: "acme/app" })
    const listed = Array.from({ length: 20 }, (_, index) => `look:github.com/acme/r${index}`)

    expect(key).toBe("look:github.com/acme/app")
    expect(keptLooks(undefined, key)).toEqual({ kept: [key], dropped: [] })
    expect(keptLooks(["look:github.com/acme/b", key], key)).toEqual({
      kept: ["look:github.com/acme/b", key],
      dropped: []
    })
    expect(keptLooks(listed.slice(1), key)).toEqual({ kept: [...listed.slice(1), key], dropped: [] })
    expect(keptLooks(listed, key)).toEqual({ kept: [...listed.slice(1), key], dropped: [listed[0]] })
    expect(keptLooks("broken", key)).toEqual({ kept: [key], dropped: [] })
    // Whatever else the list holds is dropped by its name as a string, oldest first.
    expect(keptLooks([7, ...listed], key).dropped).toEqual(["7", listed[0]])
    // Looks it doesn't name join it as recent ones, before the one just taken; the oldest listed go first.
    expect(keptLooks(listed, key, ["look:github.com/acme/lost", key])).toEqual({
      kept: [...listed.slice(2), "look:github.com/acme/lost", key],
      dropped: listed.slice(0, 2)
    })
  })
})

describe("a look kept where the store holds no list of looks, or one it can't read", () => {
  test("starts the list, with the looks the store holds", async () => {
    const other = "look:github.com/acme/other"
    for (const looks of [undefined, "broken"]) {
      const { world, host } = storeWith({
        ...(looks === undefined ? {} : { looks }),
        [other]: snapshotOf({})
      })

      await rememberLook(host, REPO, snapshotOf({}))

      expect(world.store?.looks).toEqual([other, lookKey(REPO)])
    }
  })
})

describe("a look the list doesn't name", () => {
  test("joins it again once the list changes, as a recent one, so the limit drops older looks first", async () => {
    // Two sessions writing the list at once left acme/lost's look out of it; acme/lost's next session still reads it.
    const listed = Array.from({ length: 20 }, (_, index) => `look:github.com/acme/r${index}`)
    const lost = "look:github.com/acme/lost"
    const { world, host } = storeWith({
      looks: listed,
      ...Object.fromEntries(listed.map((key) => [key, snapshotOf({})])),
      [lost]: snapshotOf({})
    })

    await rememberLook(host, REPO, snapshotOf({}))
    expect(world.store?.looks).toEqual([...listed.slice(2), lost, lookKey(REPO)])
    expect(world.store?.[lost]).toBeDefined()
    expect(Object.keys(world.store ?? {}).filter((key) => listed.slice(0, 2).includes(key))).toEqual([])

    // Then it ages as any other.
    const next = { host: "github.com", name: "acme/next" }
    await rememberLook(host, next, snapshotOf({}))
    expect(world.store?.looks).toEqual([...listed.slice(3), lost, lookKey(REPO), lookKey(next)])
  })
})

describe("what a cleanup left in place, told once across sessions", () => {
  test("kept per clone, by its main root, of a repository and server; a key too long for the store by its hash", () => {
    const long = { host: `${"h".repeat(120)}.example`, name: `${"o".repeat(39)}/${"r".repeat(100)}` }

    expect(keptKey(REPO, "/work/app")).toBe("kept:github.com/acme/app:/work/app")
    expect(keptKey(REPO, "/work/app-2")).not.toBe(keptKey(REPO, "/work/app"))
    expect(keptKey(long, "/work/app")).toBe(`kept:${shortHash(`${long.host}/${long.name}:/work/app`)}`)
  })

  test("nothing left deletes the key; notes that can't be read are none, and logged", async () => {
    const { world, host, logs } = storeWith({
      [keptKey(REPO, "/repo")]: { worktrees: { "7": "kept" }, branches: {} },
      [keptKey(REPO, "/other")]: { worktrees: { "9": "kept" }, branches: {} }
    })

    expect(await recallKept(host, REPO, "/repo")).toEqual({ worktrees: { "7": "kept" }, branches: {} })
    await keepKept(host, REPO, "/repo", { worktrees: {}, branches: {} })
    // Another clone's are its own.
    expect(world.store).toEqual({ [keptKey(REPO, "/other")]: { worktrees: { "9": "kept" }, branches: {} } })
    world.isStoreBroken = true
    expect(await recallKept(host, REPO, "/repo")).toEqual({ worktrees: {}, branches: {} })
    expect(logs).toEqual(["What cleanups kept at acme/app could not be read: store unavailable"])
  })
})

describe("the cleanup under way in a clone", () => {
  test("claimed by the clone's main root, read back, and freed only by the session that claimed it", async () => {
    const { world, host } = storeWith({})

    expect(cleanupKey("/work/app")).toBe("cleanup:/work/app")
    expect(cleanupKey(`/${"d".repeat(300)}`)).toBe(`cleanup:${shortHash(`/${"d".repeat(300)}`)}`)
    await claimCleanup(host, "/work/app", { by: "this", at: 5 })
    expect(await recallCleanup(host, "/work/app")).toEqual({ by: "this", at: 5 })
    // One another session made once this one's lapsed is that session's.
    await claimCleanup(host, "/work/app", { by: "other", at: 9 })
    await freeCleanup(host, "/work/app", "this")
    expect(world.store).toEqual({ [cleanupKey("/work/app")]: { by: "other", at: 9 } })
    await freeCleanup(host, "/work/app", "other")
    expect(world.store).toEqual({})
  })

  test("one that isn't a claim is none; one the store can't read or keep is none, and logged", async () => {
    const { world, host, logs } = storeWith({ [cleanupKey("/work/app")]: { by: 7 } })

    expect(await recallCleanup(host, "/work/app")).toBeNull()
    world.isStoreBroken = true
    expect(await recallCleanup(host, "/work/app")).toBeNull()
    world.isStoreBroken = false
    world.storeSetDeny = "the disk is read-only"
    await claimCleanup(host, "/work/app", { by: "this", at: 5 })
    expect(logs).toEqual([
      "The claim on the cleanup of /work/app could not be read: store unavailable",
      "The cleanup of /work/app could not be claimed: gh-prs-monitor: $.store.set: the disk is read-only"
    ])
  })

  test("a store too full for it gives up the answers shared, and keeps the claim", async () => {
    const shared = { [sharedKey(ID)]: answer({ answer: { data: "x".repeat(2_000) } }) }
    const { world, host } = storeWith({ ...shared })
    world.storeLimit = JSON.stringify(world.store).length

    await claimCleanup(host, "/work/app", { by: "this", at: 5 })
    expect(world.store).toEqual({ [cleanupKey("/work/app")]: { by: "this", at: 5 } })
  })
})

describe("a full store", () => {
  const shared = {
    [sharedKey(ID)]: answer({ answer: { data: "x".repeat(2_000) } }),
    [claimKey(ID)]: fetchClaim("other", 0)
  }
  const look = { "look:github.com/acme/app": { kept: true }, looks: ["look:github.com/acme/app"] }

  test("a write refused as full gives up every shared answer and claim, nothing else, and is made again", async () => {
    const { world, host } = storeWith({ ...shared, ...look })
    world.storeLimit = JSON.stringify(world.store).length

    expect(await refusalOf(keepView(host, true))).toBeNull()
    expect(world.store).toEqual({ ...look, isCompact: true })
  })

  test("refused again, the store's own refusal comes back", async () => {
    const { world, host } = storeWith({ ...shared, ...look })
    world.storeLimit = JSON.stringify(look).length

    expect(await refusalOf(keepView(host, true))).toMatch(FULL)
    expect(world.store).toEqual(look)
  })

  test("with nothing shared to give up, it is refused again", async () => {
    const { world, host } = storeWith({ ...look })
    world.storeLimit = JSON.stringify(look).length

    expect(await refusalOf(keepView(host, true))).toMatch(FULL)
    expect(world.store).toEqual(look)
  })

  test("where another session gave up what is shared first, the write is made again and kept", async () => {
    const { world, host } = storeWith({ ...shared, ...look })
    world.storeLimit = JSON.stringify(world.store).length
    // The other session's deletes land between this write's refusal and its look at the keys.
    const racing: StoreHost = {
      ...host,
      keys: async () => {
        for (const key of Object.keys(shared)) {
          delete world.store![key]
        }

        return host.keys()
      }
    }

    expect(await refusalOf(keepView(racing, true))).toBeNull()
    expect(world.store).toEqual({ ...look, isCompact: true })
  })

  test("only the engine's words for a full store give up what is shared", async () => {
    const full = storeWith({ ...shared, ...look })
    full.world.storeSetDeny = "the store would be 10 characters, over the 5 limit"
    const other = storeWith({ ...shared, ...look })
    other.world.storeSetDeny = "the store would be over its limit"

    expect(await refusalOf(keepView(full.host, true))).toMatch(FULL)
    expect(full.world.store).toEqual(look)
    expect(await refusalOf(keepView(other.host, true))).toBe(
      "gh-prs-monitor: $.store.set: the store would be over its limit"
    )
    expect(other.world.store).toEqual({ ...shared, ...look })
  })

  test("a claim never makes room", async () => {
    const { world, host, logs } = storeWith({ ...shared })
    world.storeLimit = JSON.stringify(world.store).length

    await claimFetch(host, { host: "github.com", name: "acme/other" }, fetchClaim("this", 5))
    expect(world.store).toEqual(shared)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(
      /^The refresh of acme\/other could not be claimed: gh-prs-monitor: \$\.store\.set: the store/
    )
  })

  test("a delete the store refuses is logged and frees nothing", async () => {
    const { world, host, logs } = storeWith({ ...shared })
    world.storeLimit = JSON.stringify(world.store).length
    world.storeDeleteDeny = "the disk is read-only"

    await keepKept(host, REPO, "/repo", { worktrees: { "7": "kept" }, branches: {} })
    expect(world.store).toEqual(shared)
    expect(logs).toEqual([
      "What cleanups kept at acme/app could not be kept: gh-prs-monitor: $.store.delete: the disk is read-only"
    ])
  })
})

describe("the last look", () => {
  test("one kept beside twenty keeps the latest twenty, the oldest deleted, across a full store too", async () => {
    const listed = Array.from({ length: 20 }, (_, index) => `look:github.com/acme/r${index}`)
    const looks = Object.fromEntries(listed.map((key) => [key, { kept: true }]))
    const { world, host, logs } = storeWith({
      ...looks,
      looks: listed,
      [sharedKey(ID)]: answer({ answer: { data: "x".repeat(20_000) } })
    })
    world.storeLimit = JSON.stringify(world.store).length
    const shown = snapshotOf({ mine: [{ number: 7 }] })

    await rememberLook(host, REPO, shown)
    expect(logs).toEqual([])
    expect(world.store?.looks).toEqual([...listed.slice(1), "look:github.com/acme/app"])
    expect(Object.keys(world.store ?? {}).sort()).toEqual(
      [...listed.slice(1), "look:github.com/acme/app", "looks"].sort()
    )
    expect(await recallLook(host, REPO)).toEqual(shown)
  })

  test("a look at the repository looked at last leaves the list of looks as it is, unwritten", async () => {
    const { world, host } = storeWith({ looks: ["look:github.com/acme/b", "look:github.com/acme/app"] })
    const written: string[] = []
    const watched: StoreHost = { ...host, set: (key, value) => (written.push(key), host.set(key, value)) }

    await rememberLook(watched, REPO, snapshotOf({ mine: [{ number: 7 }] }))
    expect(written).toEqual(["look:github.com/acme/app"])
    expect(world.store?.looks).toEqual(["look:github.com/acme/b", "look:github.com/acme/app"])
  })

  test("a look that can't be read is none, and logged", async () => {
    const { world, host, logs } = storeWith({})
    world.isStoreBroken = true

    expect(await recallLook(host, REPO)).toBeNull()
    expect(logs).toEqual(["The last look at acme/app could not be read: store unavailable"])
  })
})

describe("the answers sessions share", () => {
  const now = 3 * DAY
  const old = {
    "shared:github.com/acme/old:me:q": answer({ repo: "acme/old", requestedAt: 0, fetchedAt: now - DAY - 1 })
  }

  test("one the store holds a later one over is not written, and nothing is pruned", async () => {
    const kept = answer({ requestedAt: now - 3_000, fetchedAt: now - 1_000 })
    const { world, host } = storeWith({ ...old, [sharedKey(ID)]: kept }, now)

    expect(await shareAnswer(host, REPO, answer({ requestedAt: now - 4_000, fetchedAt: now, by: "this" }))).toBe(true)
    expect(world.store).toEqual({ ...old, [sharedKey(ID)]: kept })
  })

  test("one written prunes what sharedToDrop names; a prune that fails is logged, and it still counts", async () => {
    const read = answer({ requestedAt: now - 3_000, fetchedAt: now, by: "this" })
    const pruned = storeWith({ ...old }, now)
    const stuck = storeWith({ ...old }, now)
    stuck.world.storeDeleteDeny = "the disk is read-only"

    expect(await shareAnswer(pruned.host, REPO, read)).toBe(true)
    expect(pruned.world.store).toEqual({ [sharedKey(ID)]: read })
    expect(await shareAnswer(stuck.host, REPO, read)).toBe(true)
    expect(stuck.world.store).toEqual({ ...old, [sharedKey(ID)]: read })
    expect(stuck.logs).toEqual([
      "The lists shared before could not be cleared: gh-prs-monitor: $.store.delete: the disk is read-only"
    ])
  })

  test("one the store refuses for another reason reports false, and nothing is pruned", async () => {
    const { world, host, logs } = storeWith({ ...old }, now)
    world.storeSetDeny = "the disk is read-only"
    world.storeDenyPrefix = "shared:"

    expect(await shareAnswer(host, REPO, answer({ requestedAt: now - 3_000, fetchedAt: now, by: "this" }))).toBe(false)
    expect(world.store).toEqual(old)
    expect(logs).toEqual([
      "The list of acme/app could not be shared: gh-prs-monitor: $.store.set: the disk is read-only"
    ])
  })

  test("an answer or a claim that can't be read is none, and logged", async () => {
    const { world, host, logs } = storeWith({ ...old }, now)
    world.isStoreBroken = true

    expect(await recallShared(host, REPO, "me")).toBeNull()
    expect(await recallClaim(host, REPO, "me")).toBeNull()
    expect(logs).toEqual([
      "The list shared for acme/app could not be read: store unavailable",
      "The claim on acme/app's refresh could not be read: store unavailable"
    ])
  })

  test("freeing the shared keys deletes every answer and claim shared, and nothing else", async () => {
    const { world, host } = storeWith({ ...old, [claimKey(ID)]: fetchClaim("other", 0), isCompact: true })

    await freeShared(host)
    expect(world.store).toEqual({ isCompact: true })
  })
})

describe("the alerts shown", () => {
  test("another session's mark in its window leaves a line out; marks unread or unkept show every line", async () => {
    const now = 11 * MINUTE
    const lines = ["#7 merged", "#8 closed", "#9 ready"]
    const marked = {
      "github.com/acme/app #7 merged": { at: now - 5 * MINUTE, by: "other" },
      "github.com/acme/app #8 closed": { at: now - 10 * MINUTE, by: "other" }
    }
    const { world, host } = storeWith({ shown: marked }, now)
    const shown = { by: "this", pollMs: 3 * MINUTE }

    expect(await notShownElsewhere(host, REPO, lines, shown)).toEqual(["#8 closed", "#9 ready"])
    expect(world.store?.shown).toEqual({
      "github.com/acme/app #7 merged": { at: now - 5 * MINUTE, by: "other" },
      "github.com/acme/app #8 closed": { at: now, by: "this" },
      "github.com/acme/app #9 ready": { at: now, by: "this" }
    })
    const unread = storeWith({ shown: marked }, now)
    unread.world.isStoreBroken = true
    const unkept = storeWith({ shown: marked }, now)
    unkept.world.storeSetDeny = "the disk is read-only"

    expect(await notShownElsewhere(unread.host, REPO, lines, shown)).toEqual(lines)
    expect(unread.logs).toEqual(["Shown alerts could not be checked: store unavailable"])
    expect(await notShownElsewhere(unkept.host, REPO, lines, shown)).toEqual(lines)
    expect(unkept.world.store).toEqual({ shown: marked })
  })
})

describe("the pane's view", () => {
  test("read back as it was kept", async () => {
    const { host } = storeWith({})

    expect(await recallView(host)).toBeUndefined()
    await keepView(host, true)
    expect(await recallView(host)).toBe(true)
    await keepView(host, false)
    expect(await recallView(host)).toBe(false)
  })
})
