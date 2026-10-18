// Author: David Matura

// The files git ignores that work on a pull request needs as the main checkout has them (a `.env`, Android's
// `local.properties`, an app's secrets config), named in the repository's `.worktreeinclude` the way Claude Code's own
// worktrees take them: copied into a worktree /prs makes; and, whatever put them there, a worktree's ignored files the
// main checkout holds the same are nothing its removal loses.

import { isNotStarted } from "./gh"
import { foldersOf, git, namesIn, namesOf } from "./machine"
import type { Host } from "./machine"
import { isJudgedByText, isRemade, isRemadeText, remadeFolderOf } from "./remade"

export const INCLUDE_FILE = ".worktreeinclude"

// What came of copying: the files copied, and those that should have been but could not.
export type IncludeCopy = { copied: string[]; failed: string[] }

// Copies into the new worktree at `path` the files of the main checkout at `root` that git ignores and the include
// file names, each where the worktree has nothing and its git ignores the file too, and none from a link or through a
// link on its way there, as the pull request's tree can hold one leading out of the worktree. Throws, having copied
// nothing, where git can't list them whole.
export async function copyIncluded(host: Host, root: string, path: string): Promise<IncludeCopy> {
  const patterns = await includePatterns(host, root)
  if (patterns.length === 0) {
    return { copied: [], failed: [] }
  }
  const isLink = linksOf(host)
  const free: string[] = []
  for (const file of await includedFiles(host, root, patterns)) {
    const onTheWay = [...foldersOf(file), file].map((each) => `${path}/${each}`)
    if (await isLink(`${root}/${file}`)) {
      continue
    }
    if (!(await someOf(onTheWay, isLink)) && !(await host.exists(`${path}/${file}`))) {
      free.push(file)
    }
  }
  const ignored = await ignoredThere(host, path, free)
  if (ignored === null) {
    return { copied: [], failed: free }
  }
  const failed = new Set(await copyFiles(host, root, path, ignored))

  return { copied: ignored.filter((file) => !failed.has(file)), failed: [...failed] }
}

// `host.isLink`, each path asked once.
function linksOf(host: Host): (path: string) => Promise<boolean> {
  const links = new Map<string, Promise<boolean>>()

  return (path) => {
    const known = links.get(path) ?? host.isLink(path)
    links.set(path, known)

    return known
  }
}

// Whether `test` holds for any, asked in order until one does.
async function someOf(items: readonly string[], test: (item: string) => Promise<boolean>): Promise<boolean> {
  for (const item of items) {
    if (await test(item)) {
      return true
    }
  }

  return false
}

// The include file's patterns, in gitignore's syntax; none without the file.
async function includePatterns(host: Host, root: string): Promise<string[]> {
  const text = await host.read(`${root}/${INCLUDE_FILE}`).catch(() => "")

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
}

// The ignored files of the checkout at `cwd` that the main checkout's include file takes, the same for the copy (from
// the main checkout) as for cleanup (of a worktree it copied into), however git lists them there: a folder it ignores
// whole as the folder, asked into only where a pattern could match in it, and a file apart. In a folder tools make again
// only the patterns that name it count (`remadeFolderOf`, `namedIn`), so `*.pem` never reaches into an install.
// Elsewhere every pattern counts, and a file tools make (a `.pyc`, a `.DS_Store`) is left out, unless a pattern names
// its path. git itself matches the paths. Case is ignored here, as git ignores it where the file system does.
async function includedFiles(host: Host, root: string, patterns: readonly string[], cwd = root): Promise<string[]> {
  const ignored = await git(host, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], cwd)
  const listed = whole(namesOf(ignored), "")
  const isAnyDepth = patterns.some(matchesAtAnyDepth)
  const matched: string[] = []
  // Files in a folder tools make again, by that folder, for the patterns that name it.
  const inRemade = new Map<string, string[]>()
  const sortOut = (files: readonly string[]): string[] => {
    const elsewhere: string[] = []
    for (const file of files) {
      const remade = remadeFolderOf(file)
      if (remade === null) {
        elsewhere.push(file)
      } else {
        inRemade.set(remade, [...(inRemade.get(remade) ?? []), file])
      }
    }

    return elsewhere
  }
  for (const folder of listed.filter((entry) => entry.endsWith("/"))) {
    const remade = remadeFolderOf(folder)
    if (remade !== null) {
      matched.push(...(await namedIn(host, root, patterns, remade, [folder], cwd)))
    } else if (isAnyDepth || patterns.some((pattern) => couldNameFolder(pattern, folder))) {
      const found = sortOut(whole(await includedAmong(host, root, [folder], cwd), folder))
      matched.push(...found.filter((file) => isIncludable(patterns, file)))
    }
  }
  const files = sortOut(listed.filter((entry) => !entry.endsWith("/"))).filter((file) => isIncludable(patterns, file))
  for (const batch of batchesOf(files)) {
    matched.push(...whole(await includedAmong(host, root, batch, cwd), batch[0]!))
  }
  for (const [remade, inFolder] of inRemade) {
    matched.push(...(await namedIn(host, root, patterns, remade, inFolder, cwd)))
  }

  // git lists a folder it ignores whole within another as well as that one, and a file of one apart as well.
  return [...new Set(matched)]
}

// The files git matches among `paths`, files or folders in the folder tools make again `remade`, by the patterns that
// name it alone: by its path or a path in it, or by its name (`vendor/creds.json`, `**/vendor/`), with every `!`
// pattern in its place, as one may take a file back. A file tools make there is left out, unless a pattern names its
// path.
async function namedIn(
  host: Host,
  root: string,
  patterns: readonly string[],
  remade: string,
  paths: readonly string[],
  cwd: string
): Promise<string[]> {
  const naming = patterns.filter((pattern) => pattern.startsWith("!") || couldNameFolder(pattern, remade))
  if (naming.every((pattern) => pattern.startsWith("!"))) {
    return []
  }
  const matched: string[] = []
  for (const batch of batchesOf(paths)) {
    matched.push(...whole(await includedAmong(host, root, batch, cwd, naming), batch[0]!))
  }

  return matched.filter((file) => isIncludable(patterns, file))
}

// A list git can't give whole, and the entry it was of ("" for the checkout's own): what it left out can't be known,
// so nothing is copied, and that is said.
class Unlisted extends Error {
  constructor(readonly entry: string) {
    super("git could not list them whole")
  }
}

function whole(names: string[] | null, entry: string): string[] {
  if (names === null) {
    throw new Unlisted(entry)
  }

  return names
}

// Whether the include file can take a file: anything but what tools make (`isRemade`), and that only where a pattern
// names its path, so `*.xcconfig` never takes Flutter's Generated.xcconfig.
function isIncludable(patterns: readonly string[], file: string): boolean {
  return !isRemade(file) || isNamedWithin(patterns, file)
}

// Paths per git run, well within the longest command line Windows takes.
const BATCH = 200

function batchesOf<T>(items: readonly T[]): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += BATCH) {
    batches.push(items.slice(start, start + BATCH))
  }

  return batches
}

// Whether a pattern names an entry git lists (a file, or a folder whole) or a path within the folder.
function isNamedWithin(patterns: readonly string[], folder: string): boolean {
  const named = folder.toLowerCase()

  return patterns.some((pattern) => {
    const path = pattern.replace(/^\//, "").toLowerCase()

    return path.startsWith(named) || `${path}/` === named
  })
}

// Whether a pattern's last name could be the folder's (as `**/certs/`'s is `certs/`'s), read loosely, a `[…]` as any
// one character, so git is asked wherever it could match; or one of its folders is the folder's name, spelt out (as
// `**/vendor/creds.json`'s), where a wildcard folder (`*/key.pem`) names none. A `!` pattern takes files back out, and
// names none.
function couldNameFolder(pattern: string, folder: string): boolean {
  const parts = pattern.replace(/\/+$/, "").split("/")
  const name = folder.split("/").at(-2) ?? ""
  const loose = (parts.at(-1) ?? "").replace(/\[[^\]]*\]?|\\(.)|([*?])|([^*?[\\]+)/g, (_, escaped, wildcard, text) =>
    looseRegExp(escaped, wildcard, text)
  )
  const isSpeltOut = parts
    .slice(0, -1)
    .some((part) => !/[*?[\\]/.test(part) && part.toLowerCase() === name.toLowerCase())

  return !pattern.startsWith("!") && (isSpeltOut || new RegExp(`^${loose}$`, "i").test(name))
}

// One part of a pattern's name as a regular expression: an escaped character as itself, `*` as anything, `?` and a
// bracket expression as one character, and plain text as itself.
function looseRegExp(escaped: string | undefined, wildcard: string | undefined, text: string | undefined): string {
  if (escaped !== undefined) {
    return escapeRegExp(escaped)
  }
  if (wildcard === "*") {
    return ".*"
  }

  return wildcard === "?" || text === undefined ? "." : escapeRegExp(text)
}

// Whether a pattern can match below a folder it doesn't spell out: one with no slash but at its end matches at any
// depth, as `.env` does, and so does one with a wildcard among its folders, as `**/secrets/*.json` or `*/key.pem`.
function matchesAtAnyDepth(pattern: string): boolean {
  const path = pattern.replace(/\/+$/, "")

  return !pattern.startsWith("!") && (!path.includes("/") || /[*?[]/.test(path.slice(0, path.lastIndexOf("/"))))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The files git doesn't track among `paths`, files or folders of the checkout at `cwd`, that the include file of the
// main checkout at `root` matches, or only `patterns` of it; null where git can't list them all.
async function includedAmong(
  host: Host,
  root: string,
  paths: readonly string[],
  cwd: string,
  patterns?: readonly string[]
): Promise<string[] | null> {
  const matching = patterns
    ? patterns.map((pattern) => `--exclude=${pattern}`)
    : [`--exclude-from=${root}/${INCLUDE_FILE}`]
  const ran = await git(
    host,
    ["ls-files", "-z", "--others", "--ignored", ...matching, "--", ...paths.map((path) => `:(literal)${path}`)],
    cwd
  )

  return namesOf(ran)
}

// The files git ignores within a folder of the checkout at `cwd`; null where git can't list them all.
async function ignoredIn(host: Host, cwd: string, folder: string): Promise<string[] | null> {
  const ran = await git(
    host,
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", `:(literal)${folder}`],
    cwd
  )

  return namesOf(ran)
}

// The files the checkout at `cwd` ignores as well: one it tracks, or one its branch doesn't ignore, would show there as
// work of the person's, and go into a commit with it. Null where git can't say.
async function ignoredThere(host: Host, cwd: string, files: readonly string[]): Promise<string[] | null> {
  if (files.length === 0) {
    return []
  }
  const ran = await git(host, ["check-ignore", "--stdin", "-z"], cwd, files.map((file) => `${file}\0`).join(""))
  // git exits 1 when it ignores none of them.
  if ((ran.exitCode !== 0 && ran.exitCode !== 1) || ran.isStdoutTruncated) {
    return null
  }
  const ignored = new Set(namesIn(ran.stdout))

  return files.filter((file) => ignored.has(file))
}

// Copies each file of the checkout at `root` to its place in the worktree at `path`, to the byte with its times, a
// folder's files in one command; returns those not copied. On Windows, which has no cp, robocopy, which takes each name
// as given, where cmd's own copy would read `&`, `^` or `%` in a path as its own syntax.
async function copyFiles(host: Host, root: string, path: string, files: readonly string[]): Promise<string[]> {
  const byFolder = new Map<string, string[]>()
  for (const file of files) {
    const folder = file.slice(0, Math.max(file.lastIndexOf("/"), 0))
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), file])
  }
  const within = (base: string, folder: string): string => (folder === "" ? base : `${base}/${folder}`)
  const failed: string[] = []
  // A batch the command copied whole is there; of any other, the files there now.
  const noteMissing = async (batch: readonly string[], isWhole: boolean): Promise<void> => {
    for (const file of batch) {
      if (!isWhole && !(await host.exists(`${path}/${file}`))) {
        failed.push(file)
      }
    }
  }
  const made = async (folders: readonly string[]): Promise<boolean> =>
    (await host.run(["mkdir", "-p", "--", ...folders.map((folder) => within(path, folder))], { timeoutMs: 10_000 }))
      .exitCode === 0
  try {
    // mkdir makes all it can; a folder it can't, as where the branch holds a file of that name, fails its files alone.
    const unmade = new Set<string>()
    for (const folders of batchesOf([...byFolder.keys()])) {
      if (!(await made(folders))) {
        for (const folder of folders) {
          if (!(await made([folder]))) {
            unmade.add(folder)
          }
        }
      }
    }
    for (const [folder, inFolder] of byFolder) {
      if (unmade.has(folder)) {
        failed.push(...inFolder)
        continue
      }
      for (const batch of batchesOf(inFolder)) {
        const sources = batch.map((file) => `${root}/${file}`)
        const ran = await host.run(["cp", "-p", "--", ...sources, within(path, folder)], { timeoutMs: 60_000 })
        await noteMissing(batch, ran.exitCode === 0)
      }
    }

    return failed
  } catch (error) {
    if (!isNotStarted(error)) {
      return [...files]
    }
  }
  const windows = (each: string): string => each.replaceAll("/", "\\")
  try {
    for (const [folder, inFolder] of byFolder) {
      for (const batch of batchesOf(inFolder)) {
        const names = batch.map((file) => file.slice(file.lastIndexOf("/") + 1))
        // No retries, as robocopy's own are a million, 30 s apart. It makes the folder, and exits 1, or 3 with other
        // files there, when it copied every file and failed none.
        const ran = await host.run(
          ["robocopy", windows(within(root, folder)), windows(within(path, folder)), ...names, "/R:0", "/W:0"],
          { timeoutMs: 60_000 }
        )
        await noteMissing(batch, ran.exitCode === 1 || ran.exitCode === 3)
      }
    }

    return failed
  } catch {
    return [...files]
  }
}

// The first of a worktree's ignored entries whose removal would lose something: a file the main checkout lacks, holds
// differently, or reaches through a link (which could lead back into the worktree), or a folder git can't list; null
// when the main checkout holds each the same. What tools make again (`isRemade`) is left out, but for the files the
// include file takes there, as the copy takes them (`includedFiles`): those are the person's. An Android
// `local.properties` holding only what the tools write there (`isRemadeText`) is not.
export async function firstNotInMain(
  host: Host,
  root: string,
  worktree: string,
  entries: readonly string[]
): Promise<string | null> {
  const files: string[] = []
  for (const entry of entries.filter((each) => !isRemade(each))) {
    if (!entry.endsWith("/")) {
      files.push(entry)
      continue
    }
    const inside = await ignoredIn(host, worktree, entry)
    // git lists a folder for the files it ignores in it: one it finds none in is one it can't read.
    if (inside === null || inside.length === 0) {
      return entry
    }
    files.push(...inside.filter((file) => !isRemade(file)))
  }
  if (await host.exists(`${root}/${INCLUDE_FILE}`)) {
    try {
      files.push(...(await includedFiles(host, root, await includePatterns(host, root), worktree)))
    } catch (error) {
      // A list git can't give whole may hold a copy: the entry it was of, or where the worktree's own list is the one,
      // its first entry not made again.
      const unlisted = error instanceof Unlisted ? error.entry : ""

      return unlisted || entries.find((entry) => !isRemade(entry)) || entries[0] || INCLUDE_FILE
    }
  }
  const checked: string[] = []
  for (const file of new Set(files)) {
    const text = isJudgedByText(file) ? await host.read(`${worktree}/${file}`).catch(() => null) : null
    if (text === null || !isRemadeText(text)) {
      checked.push(file)
    }
  }
  const isLink = linksOf(host)
  for (const file of checked) {
    const onTheWay = [...foldersOf(file), file].map((each) => `${root}/${each}`)
    if (!(await host.exists(`${root}/${file}`)) || (await someOf(onTheWay, isLink))) {
      return file
    }
  }
  for (const batch of batchesOf(checked)) {
    const here = await hashes(host, worktree, batch)
    const there = await hashes(host, root, batch)
    const differing = batch.find((_, index) => here?.[index] === undefined || here[index] !== there?.[index])
    if (differing !== undefined) {
      return differing
    }
  }

  return null
}

// The bytes' hashes as they are: git's filters would hash a file the same as one with other line endings, or other
// content a clean filter drops.
async function hashes(host: Host, cwd: string, files: readonly string[]): Promise<string[] | null> {
  const ran = await git(host, ["hash-object", "--no-filters", "--", ...files], cwd)
  const lines = ran.stdout.trim().split("\n")

  return ran.exitCode === 0 && lines.length === files.length ? lines.map((line) => line.trim()) : null
}
