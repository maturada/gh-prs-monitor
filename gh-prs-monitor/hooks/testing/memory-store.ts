// Author: David Matura

// The plugin's store in memory, for the tests: the world's store events answer from it (`world.ts`), and store.test.ts
// hands `store.ts` a host over it. Values go through JSON as the engine's do, and a write that would take the store
// past its limit is refused in the engine's words.

import type { StoreHost } from "../store"

// What the store holds and how it fails, as a test sets them up: its keys and values; how many characters of JSON it
// holds before it refuses a write, as the engine refuses one past 4 MiB; the words it refuses every write with (after
// `$.store.set: `), or only those of keys that start with `storeDenyPrefix`; the words it refuses every delete with;
// and whether reading it fails.
export type StoreWorld = {
  store?: Record<string, unknown>
  storeLimit?: number
  storeSetDeny?: string
  storeDenyPrefix?: string
  storeDeleteDeny?: string
  isStoreBroken?: boolean
}

export function storeGet(world: StoreWorld, key: string): unknown {
  if (world.isStoreBroken) {
    throw new Error("store unavailable")
  }

  const value = world.store?.[key]

  // A copy, as the engine reads its file afresh: what the plugin changes in it is not the store's until written.
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown)
}

export function storeKeys(world: StoreWorld): string[] {
  if (world.isStoreBroken) {
    throw new Error("store unavailable")
  }

  return Object.keys(world.store ?? {})
}

// The words the store refuses the write or delete with (after `$.store.set: `, `$.store.delete: `); null once done.
export function storeSet(world: StoreWorld, key: string, value: unknown): string | null {
  const next = { ...world.store, [key]: JSON.parse(JSON.stringify(value)) as unknown }
  const size = JSON.stringify(next).length
  if (world.storeSetDeny && (world.storeDenyPrefix === undefined || key.startsWith(world.storeDenyPrefix))) {
    return world.storeSetDeny
  }
  if (world.storeLimit !== undefined && size > world.storeLimit) {
    return `the store would be ${size} characters, over the ${world.storeLimit} limit`
  }
  world.store = next

  return null
}

export function storeDelete(world: StoreWorld, key: string): string | null {
  if (world.storeDeleteDeny) {
    return world.storeDeleteDeny
  }
  const { [key]: _gone, ...kept } = world.store ?? {}
  world.store = kept

  return null
}

// `store.ts`'s host over it, as the hooks module fills one: a refusal rejects with the engine's message, the clock
// reads `clock.now`, and the debug lines go to `logs`.
export function memoryStoreHost(world: StoreWorld, clock: { now: number }, logs: string[]): StoreHost {
  const done = (method: string, refusal: string | null): void => {
    if (refusal !== null) {
      throw new Error(`gh-prs-monitor: $.store.${method}: ${refusal}`)
    }
  }

  return {
    get: async (key) => storeGet(world, key),
    set: async (key, value) => done("set", storeSet(world, key, value)),
    delete: async (key) => done("delete", storeDelete(world, key)),
    keys: async () => storeKeys(world),
    now: async () => clock.now,
    log: (line) => {
      logs.push(line)
    }
  }
}
