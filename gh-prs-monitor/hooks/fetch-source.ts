// Author: David Matura

// Where a pull request's head, or the base a branch merged into, is fetched from, as gh pr checkout fetches it: a
// remote of this clone that names its repository, or its address, with gh's credentials; and what a branch made for it
// pulls from and pushes to.

// A branch as fetched, a pull request's head or the base it merged into: the commit to check out, and what a branch
// made for it pulls from.
export type Fetched = { commit: string; upstream: Upstream }

import type { PullRow } from "../types"
import { failureLine } from "./gh"
import type { RepoRef } from "./gh"
import { currentPull } from "./github"
import { git, GIT } from "./machine"
import type { Host } from "./machine"

// What a branch pulls from and pushes to (`branch.<name>.remote`, `.merge` and, where gh sets it, `.pushRemote`).
export type Upstream = { remote: string; merge: string; isPush: boolean }

// Fetches the pull request's head as gh pr checkout does (`sourceOf`), with gh's own credentials, into the remote's
// copy of its branch or FETCH_HEAD alone: no branch of the person's moves before the switch.
export async function fetchPull(host: Host, row: PullRow, repo: RepoRef, cwd: string | undefined): Promise<Fetched> {
  return fetched(host, await sourceOf(host, row, repo, cwd), cwd, "the pull request")
}

// Fetches `base`, the branch a pull request merged into, from the remote that is its repository into that remote's
// copy of it, as `fetchPull` fetches a head: no branch of the person's moves before the switch. Rejects where no remote
// of this clone names the repository, or the base is no branch there any more.
export async function fetchBase(host: Host, repo: RepoRef, base: string, cwd: string | undefined): Promise<Fetched> {
  const remote = remoteNaming(await fetchRemotes(host, cwd), repo)
  if (remote === null) {
    throw new Error(`no remote of this clone names ${repo.name}`)
  }

  return fetched(host, fromRemote(remote, base), cwd, base)
}

// What `source` names once fetched with gh's own credentials (`what`, said where it fails).
async function fetched(host: Host, source: Source, cwd: string | undefined, what: string): Promise<Fetched> {
  const ran = await host.run([...GH_CREDENTIALS, "fetch", "--no-tags", source.from, source.refspec], {
    cwd,
    timeoutMs: 120_000
  })
  if (ran.exitCode !== 0) {
    throw new Error(`${what} could not be fetched: ${failureLine(ran.stderr)}`)
  }
  const commit = await git(host, ["rev-parse", "--verify", "--quiet", `${source.start}^{commit}`], cwd)
  if (commit.exitCode !== 0 || commit.stdout.trim() === "") {
    throw new Error(`${what} could not be fetched: git found no commit at ${source.start}`)
  }

  return { commit: commit.stdout.trim(), upstream: source.upstream }
}

// git with gh's own credentials alone, as gh runs it for `gh pr checkout`, so a private repository fetches as the
// switch itself would, with no credential helper of the person's.
const GH_CREDENTIALS = [...GIT, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]

// Where gh pr checkout (2.97) fetches the head from, and what a branch it makes follows: the head's branch on the
// remote that is its repository, fetched into that remote's copy; with none, GitHub's copy of the head
// (`refs/pull/<number>/head`) from the base repository's remote, or else its address, the branch then pulling from and
// pushing to the fork's branch when the fork lets maintainers push, else that copy. A branch of this repository's
// follows its own branch there, where gh would have it follow the copy, which takes no push.
async function sourceOf(host: Host, row: PullRow, repo: RepoRef, cwd: string | undefined): Promise<Source> {
  const remotes = await fetchRemotes(host, cwd)
  const base = remoteNaming(remotes, repo)
  const head = row.headRefName
  const pullRef = `refs/pull/${row.number}/head`
  const address = addresses(host, repo.host)
  if (!row.isCrossRepository) {
    if (base !== null) {
      return fromRemote(base, head)
    }
    const url = await address(repo.name)

    return {
      from: url,
      refspec: pullRef,
      start: "FETCH_HEAD",
      upstream: { remote: url, merge: `refs/heads/${head}`, isPush: true }
    }
  }

  const found = await currentPull(host, repo, row.number)
  if ("problem" in found) {
    throw new Error(`the pull request could not be read from GitHub: ${found.problem.message}`)
  }
  const { headRepo, maintainerCanModify } = found.pull
  const fork = headRepo === null ? null : remoteNaming(remotes, { name: headRepo, host: repo.host })
  if (fork !== null) {
    return fromRemote(fork, head)
  }
  const from = base ?? (await address(repo.name))
  const upstream =
    headRepo !== null && maintainerCanModify
      ? { remote: await address(headRepo), merge: `refs/heads/${head}`, isPush: true }
      : { remote: from, merge: pullRef, isPush: true }

  return { from, refspec: pullRef, start: "FETCH_HEAD", upstream }
}

// What to fetch (`git fetch <from> <refspec>`), and what names the head once fetched.
type Source = { from: string; refspec: string; start: string; upstream: Upstream }

function fromRemote(remote: string, head: string): Source {
  const copy = `refs/remotes/${remote}/${head}`

  return {
    from: remote,
    refspec: `+refs/heads/${head}:${copy}`,
    start: copy,
    upstream: { remote, merge: `refs/heads/${head}`, isPush: false }
  }
}

// A remote git fetches from: its name and address.
type Remote = { name: string; url: string }

async function fetchRemotes(host: Host, cwd: string | undefined): Promise<Remote[]> {
  const remotes = await git(host, ["remote", "-v"], cwd)

  return remotes.stdout.split("\n").flatMap((line): Remote[] => {
    // A partial clone's remote ends in its filter, as `(fetch) [blob:none]`.
    const [, name = "", url = ""] = /^([^\t]+)\t(.*?) \(fetch\)(?: \[[^\]]*\])?$/.exec(line.trim()) ?? []

    return name === "" ? [] : [{ name, url }]
  })
}

// The remote that is `repo`: of those whose address names it, one on its host first, as a GitHub Enterprise server
// and github.com can each hold a repository of the name; else the first, as one through an ssh host alias.
function remoteNaming(remotes: readonly Remote[], repo: RepoRef): string | null {
  const naming = remotes.filter((remote) => namesRepo(remote.url, repo.name))
  const onHost = naming.find((remote) => hostOf(remote.url) === repo.host.toLowerCase())

  return (onHost ?? naming[0])?.name ?? null
}

// `git@github.com:ann/app.git`, `https://github.com/ann/app` and the like, for `ann/app`.
export function namesRepo(url: string, repo: string): boolean {
  const path = url
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .toLowerCase()
  const name = repo.toLowerCase()

  return path.endsWith(`/${name}`) || path.endsWith(`:${name}`)
}

// The host an address names: `scheme://[user@]host[:port]/…`, or ssh's `[user@]host:path`; null for a path.
export function hostOf(url: string): string | null {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url) ?? /^(?:[^@/:]*@)?([^/:]+):/.exec(url)

  return host?.[1]?.toLowerCase() ?? null
}

// Addresses of repositories on `repoHost` in the protocol gh uses there, as gh pr checkout writes one where no remote
// names the repository; gh is asked which once.
function addresses(host: Host, repoHost: string): (name: string) => Promise<string> {
  let protocol: Promise<string> | undefined
  const asked = async (): Promise<string> => {
    const ran = await host.run(["gh", "config", "get", "git_protocol", "--host", repoHost], { timeoutMs: 10_000 })

    return ran.exitCode === 0 ? ran.stdout.trim() : ""
  }

  return async (name) => addressOf(name, repoHost, await (protocol ??= asked()))
}

// gh's own form: `git@<host>:<name>.git` over ssh, the user a tenant's name on GHE.com; else https, or http for gh's
// own development host.
export function addressOf(name: string, repoHost: string, protocol: string): string {
  const host = repoHost.toLowerCase()
  if (protocol === "ssh") {
    const [, tenant] = /(?:^|\.)([^.]+)\.ghe\.com$/.exec(host) ?? []

    return `${tenant ?? "git"}@${host}:${name}.git`
  }

  return `${host === "github.localhost" ? "http" : "https"}://${host}/${name}.git`
}
