// Author: David Matura

// The dependencies of a checkout's projects, each installed exactly as its lockfile pins it: the projects, by the
// files git tracks at the root and a few folders down; their installs, one after another; and the note that tells the
// branch skills whether the projects' commands can run there.

import type { ProcessRunResult } from "claude-code"

import { isNotStarted, lastLine, messageOf } from "./gh"
import { git, isUnder } from "./machine"
import type { Host } from "./machine"

// One project's install: its folder from the checkout's root ("" for the root), the lockfile it installs exactly (its
// path from the root), the command and any variables it runs with, and the folder within the project it installs
// into, which keeps the marker, or null where the tool installs into a place of its own.
export type Installer = {
  folder: string
  lockfile: string
  argv: string[]
  env?: Record<string, string>
  installsInto: string | null
}

// A project whose tool fetches its dependencies on the first build, into a cache of its own: nothing to install.
export type FetchedOnBuild = { folder: string; tool: string }

export type Projects = { installers: Installer[]; onBuild: FetchedOnBuild[] }

// A fork's code is anyone's: installing runs its install scripts with the person's own access, so it is left to them.
export const FORK_DEPS_NOTE =
  "not installed: the pull request comes from a fork, and installing would run its install scripts: install the dependencies yourself once you trust the code"

export const NOTHING_TO_INSTALL = "no lockfile the plugin installs from, nothing installed"

// How a Yarn project installs: Yarn 2 and later (Berry) renamed the frozen flag, and by default install no
// node_modules but Plug'n'Play files beside `.yarn`.
export type YarnSetup = { isBerry: boolean; isPnp: boolean }

// The installs of the projects in one folder, from the names of its files, in the order they run: a JavaScript
// project's first, as a React Native app's pods build on its node_modules. Each frozen install takes what the lockfile
// pins and fails rather than change it. Without `yarn`, read from its files (`yarnSetupOf`), a `.yarnrc.yml` there
// says Berry, with node_modules.
export function installersIn(
  files: readonly string[],
  isFlutter = false,
  yarn: YarnSetup = { isBerry: files.includes(".yarnrc.yml"), isPnp: false }
): Omit<Installer, "folder">[] {
  const has = (name: string): boolean => files.includes(name)
  const installers: Omit<Installer, "folder">[] = []
  const add = (lockfile: string, argv: string[], installsInto: string | null, env?: Record<string, string>): void => {
    installers.push({ lockfile, argv, installsInto, ...(env ? { env } : {}) })
  }

  if (has("pnpm-lock.yaml")) {
    add("pnpm-lock.yaml", ["pnpm", "install", "--frozen-lockfile"], "node_modules")
  } else if (has("bun.lock") || has("bun.lockb")) {
    add(has("bun.lock") ? "bun.lock" : "bun.lockb", ["bun", "install", "--frozen-lockfile"], "node_modules")
  } else if (has("yarn.lock")) {
    add(
      "yarn.lock",
      ["yarn", "install", yarn.isBerry ? "--immutable" : "--frozen-lockfile"],
      yarn.isPnp ? ".yarn" : "node_modules"
    )
  } else if (has("package-lock.json")) {
    add("package-lock.json", ["npm", "ci"], "node_modules")
  } else if (has("npm-shrinkwrap.json")) {
    add("npm-shrinkwrap.json", ["npm", "ci"], "node_modules")
  }
  if (has("pubspec.lock")) {
    add("pubspec.lock", [isFlutter ? "flutter" : "dart", "pub", "get", "--enforce-lockfile"], ".dart_tool")
  }
  if (has("uv.lock")) {
    add("uv.lock", ["uv", "sync", "--frozen"], ".venv")
  } else if (has("poetry.lock")) {
    add("poetry.lock", ["poetry", "install", "--no-interaction"], null)
  } else if (has("Pipfile.lock")) {
    add("Pipfile.lock", ["pipenv", "sync"], null)
  }
  if (has("Gemfile.lock")) {
    add("Gemfile.lock", ["bundle", "install"], null, { BUNDLE_FROZEN: "true" })
  }
  if (has("composer.lock")) {
    add("composer.lock", ["composer", "install", "--no-interaction"], "vendor")
  }
  if (has("packages.lock.json")) {
    add("packages.lock.json", ["dotnet", "restore", "--locked-mode"], null)
  }
  if (has("Podfile.lock") && has("Podfile")) {
    add("Podfile.lock", ["pod", "install", "--deployment"], "Pods")
  }

  return installers
}

// The tools that fetch a project's dependencies as it builds, by a file the project has.
const FETCHED_ON_BUILD: readonly [file: string, tool: string][] = [
  ["go.mod", "Go"],
  ["Cargo.lock", "Cargo"],
  ["gradlew", "Gradle"],
  ["settings.gradle", "Gradle"],
  ["settings.gradle.kts", "Gradle"],
  ["build.gradle", "Gradle"],
  ["build.gradle.kts", "Gradle"],
  ["pom.xml", "Maven"],
  ["Package.swift", "Swift Package Manager"]
]

const LOCKFILES = [
  ...["pnpm-lock.yaml", "bun.lock", "bun.lockb", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json"],
  ...["pubspec.lock", "uv.lock", "poetry.lock", "Pipfile.lock", "Gemfile.lock", "composer.lock"],
  ...["packages.lock.json", "Podfile.lock"]
]

// What else decides an install: Yarn's settings, and that a Podfile.lock has its Podfile.
const NAMED = [...LOCKFILES, ".yarnrc.yml", "Podfile", ...new Set(FETCHED_ON_BUILD.map(([file]) => file))]

// git's pathspecs for the files that name a project, at any depth.
const PROJECT_PATHSPECS = NAMED.map((name) => `:(glob)**/${name}`)

// Projects this many folders down at most: an app's own (`ios`, `apps/web`, `apps/mobile/ios`), not every example's.
const DEEPEST = 3

// Folders whose lockfiles are not the repository's own projects: installed or vendored code, examples and test data.
const PASSED_BY: ReadonlySet<string> = new Set([
  ...["node_modules", "bower_components", "vendor", "Pods", "third_party", "third-party", "external"],
  ...["example", "examples", "sample", "samples", "demo", "demos", "docs"],
  ...["fixtures", "__fixtures__", "test", "tests", "__tests__", "testdata", "spec"]
])

// More would hold the skill back for long: the rest are named for it.
export const MOST_INSTALLS = 6

// The projects among the paths git tracks, root first, then folder by folder down; `flutter` names the folders whose
// pubspec.yaml builds on Flutter, `yarn` the Yarn projects' setups by folder. A tool that fetches on build is named
// once per folder tree, for the topmost folder holding its file.
export function projectsOf(
  paths: readonly string[],
  flutter: ReadonlySet<string> = new Set(),
  yarn: ReadonlyMap<string, YarnSetup> = new Map()
): Projects {
  const byFolder = new Map<string, string[]>()
  for (const path of paths) {
    const parts = path.split("/")
    const folders = parts.slice(0, -1)
    if (folders.length > DEEPEST || folders.some((folder) => PASSED_BY.has(folder))) {
      continue
    }
    const folder = folders.join("/")
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), parts.at(-1)!])
  }
  const folders = [...byFolder.keys()].sort(
    (one, other) => depthOf(one) - depthOf(other) || (one < other ? -1 : one > other ? 1 : 0)
  )

  const installers: Installer[] = []
  const onBuild: FetchedOnBuild[] = []
  for (const folder of folders) {
    const files = byFolder.get(folder)!
    for (const installer of installersIn(files, flutter.has(folder), yarn.get(folder))) {
      installers.push({ ...installer, folder, lockfile: pathIn(folder, installer.lockfile) })
    }
    const tools = new Set(FETCHED_ON_BUILD.filter(([file]) => files.includes(file)).map(([, tool]) => tool))
    for (const tool of tools) {
      if (!onBuild.some((project) => project.tool === tool && isUnder(folder, project.folder))) {
        onBuild.push({ folder, tool })
      }
    }
  }

  return { installers, onBuild }
}

function depthOf(folder: string): number {
  return folder === "" ? 0 : folder.split("/").length
}

function pathIn(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`
}

// --- The checkout's projects, and their installs ---

// Written into the folder an install fills, after it finished, holding the command and the lockfile's git blob hash,
// so a worktree used again installs only when its lockfile changed. Only where git ignores it.
export const MARKER_NAME = ".gh-prs-monitor-lock"

const INSTALL_TIMEOUT_MS = 600_000

// The projects git tracks in the checkout at `dir`.
export async function projectsAt(host: Host, dir: string): Promise<Projects> {
  const listed = await git(host, ["ls-files", "-z", "--", ...PROJECT_PATHSPECS], dir)
  const paths = listed.exitCode === 0 ? listed.stdout.split("\0").filter(Boolean) : []
  const flutter = new Set<string>()
  for (const folder of foldersHolding(paths, "pubspec.lock")) {
    const pubspec = await host.read(`${dir}/${pathIn(folder, "pubspec.yaml")}`).catch(() => "")
    if (/^\s*sdk:\s*["']?flutter["']?\s*(#.*)?$/m.test(pubspec)) {
      flutter.add(folder)
    }
  }
  const yarn = new Map<string, YarnSetup>()
  for (const folder of foldersHolding(paths, "yarn.lock")) {
    const setup = await yarnSetupOf(host, dir, folder)
    if (setup) {
      yarn.set(folder, setup)
    }
  }

  return projectsOf(paths, flutter, yarn)
}

function foldersHolding(paths: readonly string[], name: string): string[] {
  return paths
    .filter((path) => path === name || path.endsWith(`/${name}`))
    .map((path) => path.slice(0, -name.length).replace(/\/$/, ""))
}

// A Yarn project's setup, from its lockfile, which Berry writes with a `__metadata` entry and Yarn 1 as `lockfile v1`,
// whatever settings files the folder holds; and from its `.yarnrc.yml`, whose `nodeLinker` is Plug'n'Play unless set.
// Null where the lockfile can't be read.
async function yarnSetupOf(host: Host, dir: string, folder: string): Promise<YarnSetup | null> {
  const lockfile = await host.read(`${dir}/${pathIn(folder, "yarn.lock")}`).catch(() => null)
  if (lockfile === null) {
    return null
  }
  const isBerry = /^__metadata:/m.test(lockfile)
  const settings = isBerry ? await host.read(`${dir}/${pathIn(folder, ".yarnrc.yml")}`).catch(() => "") : ""
  const linker = /^nodeLinker:\s*["']?([\w-]+)/m.exec(settings)?.[1] ?? "pnp"

  return { isBerry, isPnp: isBerry && linker === "pnp" }
}

// Installs the dependencies of the projects in a worktree, each skipped while its marker says the installed set
// matches its lockfile. The note it returns tells the branch skills whether the projects' commands can run there.
export async function ensureDependencies(
  host: Host,
  dir: string,
  onInstall: (command: string) => void
): Promise<string> {
  const projects = await projectsAt(host, dir)
  const hashes = await lockHashes(host, dir, projects.installers)
  const notes: string[] = []
  // Those past the most installs one go makes; projects installed already take none of them.
  const left: Installer[] = []
  let installs = 0
  for (const installer of projects.installers) {
    const command = commandOf(installer)
    const hash = hashes.get(installer.lockfile)
    const done = hash ? await doneOf(host, dir, installer, hash) : null
    if (done && (await readText(host, done.markerPath)) === done.marker) {
      notes.push(noteFor(installer, `dependencies already installed (${command})`))
    } else if (installs < MOST_INSTALLS) {
      installs += 1
      onInstall(labelOf(installer))
      notes.push(noteFor(installer, await install(host, dir, installer, done, hash)))
    } else {
      left.push(installer)
    }
  }

  return noteOf(projects, notes, left)
}

// The projects in a checkout with their lockfiles' hashes, to tell after a switch which ones it changed.
export type LockedProjects = { projects: Projects; hashes: Map<string, string> }

export async function lockedProjects(host: Host, dir: string): Promise<LockedProjects> {
  const projects = await projectsAt(host, dir)

  return { projects, hashes: await lockHashes(host, dir, projects.installers) }
}

// After a switch here, installs the projects whose lockfile it changed, or whose package manager, as the person's own
// installs are otherwise left as they are; undefined where it changed none.
export async function installChanged(
  host: Host,
  dir: string,
  before: LockedProjects,
  isFork: boolean,
  onInstall: (command: string) => void
): Promise<string | undefined> {
  const after = await lockedProjects(host, dir)
  const changed = after.projects.installers.filter(
    (installer) =>
      !before.projects.installers.some(
        (earlier) =>
          earlier.lockfile === installer.lockfile &&
          commandOf(earlier) === commandOf(installer) &&
          before.hashes.get(earlier.lockfile) === after.hashes.get(installer.lockfile)
      )
  )
  if (changed.length === 0) {
    return undefined
  }
  if (isFork) {
    return FORK_DEPS_NOTE
  }
  const notes: string[] = []
  for (const installer of changed.slice(0, MOST_INSTALLS)) {
    onInstall(labelOf(installer))
    notes.push(noteFor(installer, await install(host, dir, installer, null)))
  }
  const left = changed.slice(MOST_INSTALLS)

  return [...notes, ...leftNotes(left)].join("; ")
}

// `done` is what a finished install leaves behind, the command and the lockfile's hash, and where; an old one is
// emptied first, so an install that fails halfway is never taken for a finished one. None is written before the install, which
// would make its folder ahead of the tool (uv refuses a `.venv` that is no environment). Where none could go before,
// it is looked for again after, as a tool can make its folder ignored itself (uv writes `.venv/.gitignore`).
async function install(
  host: Host,
  dir: string,
  installer: Installer,
  done: Done | null,
  hash?: string
): Promise<string> {
  const command = commandOf(installer)
  if (done && (await host.exists(done.markerPath))) {
    await host.write(done.markerPath, "").catch(() => undefined)
  }
  try {
    const ran = await runInstaller(host, installer, installer.folder === "" ? dir : `${dir}/${installer.folder}`)
    if (ran.exitCode !== 0) {
      return `${command} failed (exit ${ran.exitCode}): ${shortened(lastLine(ran.stderr) || lastLine(ran.stdout))}`
    }
    const finished = done ?? (hash ? await doneOf(host, dir, installer, hash) : null)
    if (finished) {
      await host.write(finished.markerPath, finished.marker).catch(() => undefined)
    }

    return `installed with ${command}`
  } catch (error) {
    return isNotStarted(error)
      ? `${command} could not run: ${messageOf(error)}`
      : `${command} did not finish within ${INSTALL_TIMEOUT_MS / 60_000} minutes, so ${installer.installsInto ?? "its dependencies"} may be incomplete`
  }
}

// A package manager that could not start is tried once more through Windows' command interpreter, for an engine that
// doesn't start a `.cmd` script itself. Only one that could not start: one out of time may still be installing.
async function runInstaller(host: Host, installer: Installer, cwd: string): Promise<ProcessRunResult> {
  const init = { cwd, timeoutMs: INSTALL_TIMEOUT_MS, ...(installer.env ? { env: installer.env } : {}) }
  try {
    return await host.run(installer.argv, init)
  } catch (error) {
    if (!isNotStarted(error)) {
      throw error
    }
    try {
      return await host.run(["cmd", "/c", ...installer.argv], init)
    } catch {
      throw error
    }
  }
}

// The lockfiles' git blob hashes, by path, from one run; none where git can't read them all.
async function lockHashes(host: Host, dir: string, installers: readonly Installer[]): Promise<Map<string, string>> {
  const lockfiles = [...new Set(installers.map((installer) => installer.lockfile))]
  if (lockfiles.length === 0) {
    return new Map()
  }
  const hashed = await git(host, ["hash-object", "--", ...lockfiles], dir)
  const lines = hashed.stdout.trim().split("\n")
  if (hashed.exitCode !== 0 || lines.length !== lockfiles.length) {
    return new Map()
  }

  return new Map(lockfiles.map((lockfile, index) => [lockfile, lines[index]!.trim()]))
}

// The marker a finished install leaves, and where; none where it has nowhere to go (`markerPathOf`).
type Done = { markerPath: string; marker: string }

async function doneOf(host: Host, dir: string, installer: Installer, hash: string): Promise<Done | null> {
  const markerPath = await markerPathOf(host, dir, installer)

  return markerPath ? { markerPath, marker: `${commandOf(installer)} ${hash}` } : null
}

// Where the marker goes: in the folder the install fills, while git ignores it there, so it never shows as a change
// (in a project that keeps its Pods in git, say).
async function markerPathOf(host: Host, dir: string, installer: Installer): Promise<string | null> {
  if (installer.installsInto === null) {
    return null
  }
  const marker = pathIn(pathIn(installer.folder, installer.installsInto), MARKER_NAME)
  const ignored = await git(host, ["check-ignore", "-q", "--", marker], dir)

  return ignored.exitCode === 0 ? `${dir}/${marker}` : null
}

// An installer's last line can run long: cut, one project's failure leaves room for others' parts. The note as a whole
// is cut too (`skillArgs`), and the skills check a project it no longer names before running its commands.
function shortened(line: string): string {
  const chars = Array.from(line)

  return chars.length > REASON_LIMIT ? `${chars.slice(0, REASON_LIMIT - 1).join("")}…` : line
}

const REASON_LIMIT = 160

async function readText(host: Host, path: string): Promise<string | null> {
  try {
    return (await host.read(path)).trim()
  } catch {
    return null
  }
}

function commandOf(installer: Installer): string {
  return installer.argv.join(" ")
}

function labelOf(installer: Installer): string {
  return noteFor(installer, commandOf(installer))
}

// A project's part of the note, led by its folder where it is not the root's.
function noteFor(project: { folder: string }, text: string): string {
  return project.folder === "" ? text : `${project.folder}: ${text}`
}

// The projects past the most installed at once, each a part of its own, as the skills read a part by its folder.
function leftNotes(left: readonly Installer[]): string[] {
  return left.map((installer) =>
    noteFor(installer, `not installed, as one go installs ${MOST_INSTALLS} projects at most (${commandOf(installer)})`)
  )
}

// The whole note: each install's outcome, the ones left, and the projects whose tools fetch on build.
function noteOf(projects: Projects, notes: string[], left: readonly Installer[]): string {
  const fetched = projects.onBuild.map((project) =>
    noteFor(project, `${project.tool} fetches its dependencies on the first build`)
  )
  const parts = [...notes, ...leftNotes(left), ...fetched]

  return parts.length > 0 ? parts.join("; ") : NOTHING_TO_INSTALL
}
