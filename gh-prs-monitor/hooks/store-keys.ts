// Author: David Matura

// The store's keys hold 256 characters: an id too long for one, as a long repository on a server with a long name
// makes, is kept under its hash. `longest` is the longest prefix the same id goes under, so its keys end alike.
const STORE_KEY_MAX_CHARS = 256

export function storeKey(prefix: string, id: string, longest: string = prefix): string {
  return prefix + (longest.length + id.length <= STORE_KEY_MAX_CHARS ? id : shortHash(id))
}

// FNV-1a, 32 bits: short, and the same in every session for the same text.
export function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, "0")
}
