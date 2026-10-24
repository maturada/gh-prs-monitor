// Author: David Matura

// The folders on this machine a repository is cloned in: those sessions noted (`noteClone`, in the store), each checked
// before it is offered by its own git config, read as a file, as no git runs in a folder Claude Code hasn't been asked
// to trust yet.

import { mainRoot } from "./checkout"
import type { RepoRef } from "./gh"
import type { Host } from "./machine"
import { isAbsolute, normalPath } from "./paths"
import { knownClones, noteClone } from "./store"
import type { NotedClone, StoreHost } from "./store"

// Notes the session's clone (the main checkout, for a worktree) as one of `repo`, the folder's repository as GitHub
// writes its name now; with the remote gh found it by, as the git config writes it, where none reads as that
// repository: one through an SSH alias with a dot, by its name; else one on its server, left on an old name after
// GitHub renamed or moved the repository.
export async function noteOwnClone(host: Host, store: StoreHost, repo: RepoRef, at: number): Promise<void> {
  const root = await mainRoot(host)
  const remotes = (await readFolder(host, root)) ?? []
  const remote = remotes.some((each) => isClonedFrom(each, repo))
    ? undefined
    : (remotes.find((each) => isSameName(each, repo)) ?? remotes.find((each) => isOnServer(each, repo.host)))

  await noteClone(store, { root, repo, ...(remote ? { remote } : {}) }, at)
}

// The folders noted as clones, the session's own left out, each still a clone of its repository by its own git config.
export async function stillCloned(host: Host, store: StoreHost): Promise<NotedClone[]> {
  const own = await mainRoot(host).catch(() => null)
  const noted = await knownClones(store, own)
  const isCloned = await Promise.all(noted.map((each) => checkClone(host, each)))

  return noted.filter((_, index) => isCloned[index])
}

// Whether the folder noted is still a clone of its repository: a remote in its git config names it, on its server or
// through an SSH alias (`git@github-work:acme/web.git`), which names no server; or is the remote noted beside it.
export async function checkClone(host: Host, clone: NotedClone): Promise<boolean> {
  const { remote } = clone

  return (await readClone(host, clone.root)).some(
    (named) =>
      isClonedFrom(named, clone.repo) ||
      (remote !== undefined && named.host === remote.host.toLowerCase() && isSameName(named, remote))
  )
}

// Whether a remote's repository is `repo`: the same name, on its server or through an SSH alias.
function isClonedFrom(named: RepoRef, repo: RepoRef): boolean {
  return isSameName(named, repo) && isOnServer(named, repo.host)
}

function isSameName(one: RepoRef, other: RepoRef): boolean {
  return one.name.toLowerCase() === other.name.toLowerCase()
}

// Whether a remote's repository is on `server`, or names none, through an SSH alias.
function isOnServer(named: RepoRef, server: string): boolean {
  return named.host === server.toLowerCase().replace(/:\d+$/, "") || isSshAlias(named.host)
}

// A remote's host with no dot, as `github-work` in `git@github-work:acme/web.git`, is an SSH alias, which names no
// server: gh reads it from the SSH config. One with a dot (`github.com-work`) reads as a server.
export function isSshAlias(host: string): boolean {
  return !host.includes(".")
}

// The repositories the folder's remotes name, in the order its git config lists them; none for a folder gone or with
// no git config of its own.
export async function readClone(host: Host, path: string): Promise<RepoRef[]> {
  const config = await readOrNone(host, `${path}/.git/config`)

  return config === null ? [] : reposOf(remotesIn(config))
}

function reposOf(remotes: readonly Remote[]): RepoRef[] {
  return remotes.flatMap((remote) => {
    const repo = repoOfRemote(remote.url)

    return repo ? [repo] : []
  })
}

// The repositories the remotes of the repository a typed folder is in name, as git finds that repository: the folder's
// own `.git/config`; a worktree's main checkout's, which its `.git` file names; or, inside a repository, the nearest
// folder above's. Read as files, as `readClone` reads them. First the one gh picks, as a session there lists it
// (`byGhChoice`). None (null) where the folder is in no git repository.
export async function readFolder(host: Host, path: string): Promise<RepoRef[] | null> {
  const config = await configAt(host, normalPath(path))

  return config === null ? null : reposOf(byGhChoice(remotesIn(config)))
}

// The remotes in the order gh picks a repository from them: the one `gh repo set-default` chose, then those named
// `upstream`, `github` and `origin`, then the rest as the config lists them.
function byGhChoice(remotes: readonly Remote[]): Remote[] {
  const rank = (remote: Remote): number => {
    const named = GH_REMOTES.indexOf(remote.name)

    return remote.isDefault ? 0 : named >= 0 ? 1 + named : 1 + GH_REMOTES.length
  }

  return [...remotes].sort((one, other) => rank(one) - rank(other))
}

const GH_REMOTES = ["upstream", "github", "origin"]

async function configAt(host: Host, path: string): Promise<string | null> {
  for (let folder = path; ; folder = parentOf(folder)) {
    const own = await readOrNone(host, `${folder}/.git/config`)
    if (own !== null) {
      return own
    }
    // A worktree's `.git` is a file naming its own folder in the main checkout's, whose `commondir` leads to it.
    const linked = /^gitdir:\s*(.+?)\s*$/m.exec((await readOrNone(host, `${folder}/.git`)) ?? "")?.[1]
    if (linked) {
      const own = normalPath(isAbsolute(linked) ? linked : `${folder}/${linked}`)
      const common = (await readOrNone(host, `${own}/commondir`))?.trim() ?? "."

      return readOrNone(host, `${normalPath(isAbsolute(common) ? common : `${own}/${common}`)}/config`)
    }
    if (folder === "/" || !folder.includes("/")) {
      return null
    }
  }
}

async function readOrNone(host: Host, path: string): Promise<string | null> {
  try {
    return await host.read(path)
  } catch {
    return null
  }
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/"
}

// A remote as git config writes it: its name, an address, and whether `gh repo set-default` chose it.
type Remote = { name: string; url: string; isDefault: boolean }

// Each remote's addresses, as git config writes them: `url = …` in a `[remote "…"]` section, or `[remote.…]` as older
// git wrote it, in the order it lists them; `gh-resolved = base` marks the one `gh repo set-default` chose. Remotes
// from an included file, or rewritten by `insteadOf`, aren't followed: such a folder isn't offered.
function remotesIn(config: string): Remote[] {
  const urls: { name: string; url: string }[] = []
  const chosen = new Set<string>()
  let remote: string | null = null
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?/.exec(line)
    if (section) {
      const dotted = /^remote\.(.+)$/i.exec(section[1]!)
      remote = /^remote$/i.test(section[1]!) ? (section[2] ?? null) : (dotted?.[1] ?? null)
      continue
    }
    const entry = /^\s*(url|gh-resolved)\s*=\s*(.*?)\s*$/i.exec(line)
    if (remote === null || !entry) {
      continue
    }
    if (entry[1]!.toLowerCase() === "url") {
      urls.push({ name: remote, url: valueOf(entry[2]!) })
    } else if (valueOf(entry[2]!) === "base") {
      chosen.add(remote)
    }
  }

  return urls.map((each) => ({ ...each, isDefault: chosen.has(each.name) }))
}

// A value as git reads it: a quoted one as written; else up to a comment, which `#` or `;` starts.
function valueOf(text: string): string {
  const quoted = /^"(.*)"$/.exec(text)

  return quoted ? quoted[1]! : text.replace(/[#;].*$/, "").trim()
}

// The repository a remote's address names, as `https://`, `ssh://` and `git://` addresses and scp-like ones
// (`git@github.com:acme/web.git`) write it: its server, without a port, and its `owner/name`; none for a path on this
// machine (`file://`, a Windows drive's), which names no server, or anything else.
function repoOfRemote(url: string): RepoRef | null {
  let server: string
  let path: string
  if (/^[a-z][a-z+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      server = parsed.hostname
      path = parsed.pathname
    } catch {
      return null
    }
  } else {
    const scp = /^(?:[^@/]+@)?([^:/]{2,}):(.+)$/.exec(url)
    if (!scp) {
      return null
    }
    server = scp[1]!
    path = scp[2]!
  }
  const parts = path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter((part) => part !== "")
  // GitHub's SSH over port 443 is GitHub itself.
  const host = server.toLowerCase() === "ssh.github.com" ? "github.com" : server.toLowerCase()

  return server !== "" && parts.length === 2 ? { host, name: parts.join("/") } : null
}
