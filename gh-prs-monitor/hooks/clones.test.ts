// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { checkClone, noteOwnClone, readClone, readFolder } from "./clones"
import { CLONES_LIMIT, knownClones, noteClone } from "./store"
import { gitConfigOf } from "./testing/git-config"
import { fakeHost } from "./testing/git-host"
import { memoryStoreHost } from "./testing/memory-store"
import type { StoreWorld } from "./testing/memory-store"
import { clockOf, GITHUB, machine, MINUTE, startSession } from "./testing/world"
import type { World } from "./testing/world"

const WEB = { host: "github.com", name: "acme/web" }
const APP = { host: "github.com", name: "acme/app" }

function storeOf(values: Record<string, unknown> = {}) {
  const world: StoreWorld = { store: values }

  return { world, store: memoryStoreHost(world, { now: 0 }, []) }
}

describe("the folders a repository is cloned in", () => {
  test("noted folders come newest first, the session's own left out, all in one read", async () => {
    const { store } = storeOf()
    await noteClone(store, { root: "/code/web", repo: WEB }, 1)
    await noteClone(store, { root: "/code/app", repo: APP }, 2)
    await noteClone(store, { root: "/code/web-2", repo: WEB }, 3)
    let reads = 0
    const counted = { ...store, get: (key: string) => ((reads += 1), store.get(key)) }

    expect(await knownClones(counted, "/code/app")).toEqual([
      { root: "/code/web-2", repo: WEB },
      { root: "/code/web", repo: WEB }
    ])
    expect(reads).toBe(1)
  })

  test(`the ${CLONES_LIMIT} latest are kept, in one record; a folder noted again is the newest`, async () => {
    const { world, store } = storeOf()
    for (let at = 0; at <= CLONES_LIMIT; at++) {
      await noteClone(store, { root: `/code/r${at}`, repo: { host: "github.com", name: `acme/r${at}` } }, at)
    }
    await noteClone(store, { root: "/code/r1", repo: { host: "github.com", name: "acme/r1" } }, 99)

    const known = await knownClones(store, null)
    expect(known).toHaveLength(CLONES_LIMIT)
    expect(known[0]?.root).toBe("/code/r1")
    expect(known.map((each) => each.root)).not.toContain("/code/r0")
    expect(Object.keys(world.store ?? {})).toEqual(["clones"])
  })

  test("a note another session's write took away is written again", async () => {
    const { world, store } = storeOf()
    let isFirst = true
    // Another session notes its own folder between this one's write and its read back, from the list as it was.
    const racing = {
      ...store,
      set: async (key: string, value: unknown) => {
        await store.set(key, value)
        if (isFirst) {
          isFirst = false
          await store.set(key, [{ root: "/code/app", repo: APP, at: 2 }])
        }
      }
    }

    await noteClone(racing, { root: "/code/web", repo: WEB }, 3)

    expect((await knownClones(store, null)).map((each) => each.root).sort()).toEqual(["/code/app", "/code/web"])
    expect(world.store?.clones).toHaveLength(2)
  })

  test("a clone noted with the name its git config gives reads back with it; one noted without, with none", async () => {
    const { store } = storeOf()
    await noteClone(store, { root: "/code/web", repo: WEB, remote: { host: "github.com", name: "acme/old-web" } }, 1)
    await noteClone(store, { root: "/code/app", repo: APP }, 2)

    expect(await knownClones(store, null)).toEqual([
      { root: "/code/app", repo: APP },
      { root: "/code/web", repo: WEB, remote: { host: "github.com", name: "acme/old-web" } }
    ])
  })

  test("the session's clone reached through an SSH alias with a dot is noted with that remote", async () => {
    const { store } = storeOf()
    const { host } = fakeHost(
      [["git rev-parse --path-format=absolute --git-common-dir", { stdout: "/code/app/.git\n" }]],
      {
        "/code/app/.git/config": gitConfigOf({ origin: "git@github.com-work:acme/app.git" })
      }
    )

    await noteOwnClone(host, store, APP, 1)

    expect(await knownClones(store, null)).toEqual([
      { root: "/code/app", repo: APP, remote: { host: "github.com-work", name: "acme/app" } }
    ])
  })

  test("the session's clone is noted by the remote gh picks on GitHub's server, not one on another", async () => {
    const { store } = storeOf()
    const { host } = fakeHost(
      [["git rev-parse --path-format=absolute --git-common-dir", { stdout: "/code/app/.git\n" }]],
      {
        "/code/app/.git/config": gitConfigOf({
          upstream: "git@gitlab.com:acme/old-app.git",
          origin: "git@github.com:acme/older-app.git"
        })
      }
    )

    await noteOwnClone(host, store, APP, 1)

    expect(await knownClones(store, null)).toEqual([
      { root: "/code/app", repo: APP, remote: { host: "github.com", name: "acme/older-app" } }
    ])
  })

  test("what the store holds that isn't a noted folder is skipped", async () => {
    const { store } = storeOf({
      clones: [{ root: "/a", repo: WEB, at: 1 }, "broken", { root: "/c", repo: { host: "github.com" }, at: 2 }]
    })

    expect(await knownClones(store, null)).toEqual([{ root: "/a", repo: WEB }])
  })

  test("a store that can't be read or written knows none, and noting fails quietly", async () => {
    const { world, store } = storeOf()
    world.isStoreBroken = true

    expect(await knownClones(store, null)).toEqual([])
    await noteClone(store, { root: "/code/web", repo: WEB }, 1)
  })
})

describe("a folder's own git config", () => {
  test("names the repositories its remotes point at, in each way git writes them", async () => {
    const { host } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({
        origin: "git@github.com:acme/web.git",
        upstream: "https://github.com/Acme/Web",
        fork: "ssh://git@ghe.corp.example:2222/ann/web.git/",
        work: "git@github-work:acme/web.git",
        plain: "https://ann@github.com/acme/app.git"
      })
    })

    expect(await readClone(host, "/code/web")).toEqual([
      { host: "github.com", name: "acme/web" },
      { host: "github.com", name: "Acme/Web" },
      { host: "ghe.corp.example", name: "ann/web" },
      { host: "github-work", name: "acme/web" },
      { host: "github.com", name: "acme/app" }
    ])
  })

  test("reads its config as git writes it by hand too: quoted, commented, any case, CRLF, old-style headers", async () => {
    const { host } = fakeHost([], {
      "/code/web/.git/config": [
        '[remote "origin"]',
        '\tURL = "https://github.com/acme/web.git"',
        '[remote "old"]',
        "\turl = https://github.com/acme/old ; moved",
        "[remote.legacy]",
        "\turl=git@github.com:acme/legacy.git # from before",
        '[Remote "port"]\r',
        "\turl = ssh://git@ssh.github.com:443/acme/port.git\r",
        '[branch "main"]',
        "\turl = https://github.com/acme/not-a-remote"
      ].join("\n")
    })

    expect(await readClone(host, "/code/web")).toEqual([
      { host: "github.com", name: "acme/web" },
      { host: "github.com", name: "acme/old" },
      { host: "github.com", name: "acme/legacy" },
      { host: "github.com", name: "acme/port" }
    ])
  })

  test("a path on this machine names no repository, a Windows drive's either", async () => {
    const { host } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({
        local: "/srv/git/acme/web.git",
        file: "file:///srv/acme/web",
        drive: "C:/acme/web",
        relative: "../acme/web"
      })
    })

    expect(await readClone(host, "/code/web")).toEqual([])
    expect(await checkClone(host, { root: "/code/web", repo: WEB })).toBe(false)
  })

  test("a folder typed names the repository gh would pick: set-default's, else upstream, github, then origin", async () => {
    const fork = gitConfigOf({ origin: "git@github.com:ann/web.git", upstream: "https://github.com/acme/web" })
    const { host } = fakeHost([], {
      "/code/fork/.git/config": fork,
      "/code/chosen/.git/config": fork.replace('[remote "origin"]', '[remote "origin"]\n\tgh-resolved = base'),
      "/code/named/.git/config": gitConfigOf({
        mine: "git@github.com:ann/app.git",
        origin: "git@github.com:acme/app-origin.git",
        github: "git@github.com:acme/app.git"
      })
    })

    expect((await readFolder(host, "/code/fork"))?.[0]).toEqual(WEB)
    expect((await readFolder(host, "/code/chosen"))?.[0]).toEqual({ host: "github.com", name: "ann/web" })
    expect(await readFolder(host, "/code/named")).toEqual([
      { host: "github.com", name: "acme/app" },
      { host: "github.com", name: "acme/app-origin" },
      { host: "github.com", name: "ann/app" }
    ])
    // A clone's remotes are read as its config lists them, as any of them makes it a clone.
    expect((await readClone(host, "/code/fork"))[0]).toEqual({ host: "github.com", name: "ann/web" })
  })

  test("on Windows, a folder and its worktree are read where Windows has them", async () => {
    const { host } = fakeHost([], {
      "C:/code/web/.git/config": gitConfigOf({ origin: "git@github.com:acme/web.git" }),
      "C:/code/web-wt/.git": "gitdir: C:/code/web/.git/worktrees/web-wt\n",
      "C:/code/web/.git/worktrees/web-wt/commondir": "../..\n"
    })

    expect(await readFolder(host, "C:/code/web/src")).toEqual([WEB])
    expect(await readFolder(host, "C:/code/web-wt")).toEqual([WEB])
    expect(await readFolder(host, "C:/elsewhere")).toBe(null)
  })

  test("a folder typed is read as git finds its repository: from a worktree, or from a folder inside it", async () => {
    const { host, calls } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({ origin: "git@github.com:acme/web.git" }),
      "/code/web-wt/.git": "gitdir: /code/web/.git/worktrees/web-wt\n",
      "/code/web/.git/worktrees/web-wt/commondir": "../..\n",
      "/code/web-rel/.git": "gitdir: ../web/.git/worktrees/web-rel\n",
      "/code/web/.git/worktrees/web-rel/commondir": "../..\n"
    })

    expect(await readFolder(host, "/code/web")).toEqual([WEB])
    expect(await readFolder(host, "/code/web-wt")).toEqual([WEB])
    expect(await readFolder(host, "/code/web-rel")).toEqual([WEB])
    expect(await readFolder(host, "/code/web/src/app")).toEqual([WEB])
    // In no git repository at all, it names none, apart from one whose git config names no remote on GitHub.
    expect(await readFolder(host, "/elsewhere/notes")).toBe(null)
    expect(calls).toEqual([])
  })

  test("a folder gone, with no git config or no remote names none", async () => {
    const { host } = fakeHost([], { "/code/bare/.git/config": gitConfigOf({}) })

    expect(await readClone(host, "/code/gone")).toEqual([])
    expect(await readClone(host, "/code/bare")).toEqual([])
  })

  test("a folder is a clone of the repository a remote names, an SSH alias by its owner/name; nothing runs in it", async () => {
    const { host, calls } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({ origin: "git@github-work:acme/web.git" }),
      "/code/fork/.git/config": gitConfigOf({ origin: "git@github.com:ann/web.git" }),
      "/code/ghe/.git/config": gitConfigOf({ origin: "https://ghe.corp.example/acme/web" })
    })

    expect(await checkClone(host, { root: "/code/web", repo: WEB })).toBe(true)
    expect(await checkClone(host, { root: "/code/fork", repo: WEB })).toBe(false)
    expect(await checkClone(host, { root: "/code/ghe", repo: WEB })).toBe(false)
    expect(await checkClone(host, { root: "/code/gone", repo: WEB })).toBe(false)
    expect(calls).toEqual([])
  })

  test("a clone reached through an SSH alias with a dot, which reads as a server, is one by the remote noted", async () => {
    const { host } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({ origin: "git@github.com-work:acme/web.git" })
    })
    const alias = { host: "github.com-work", name: "acme/web" }

    expect(await checkClone(host, { root: "/code/web", repo: WEB, remote: alias })).toBe(true)
    expect(await checkClone(host, { root: "/code/web", repo: WEB })).toBe(false)
    // The remote noted is the one on its own host: the same name elsewhere is another repository.
    expect(
      await checkClone(host, { root: "/code/web", repo: WEB, remote: { host: "gitlab.com", name: "acme/web" } })
    ).toBe(false)
  })

  test("a clone left on a repository's old name, as GitHub keeps answering it after a rename, is one by that name", async () => {
    const { host } = fakeHost([], {
      "/code/web/.git/config": gitConfigOf({ origin: "git@github.com:acme/old-web.git" })
    })

    expect(
      await checkClone(host, { root: "/code/web", repo: WEB, remote: { host: "github.com", name: "acme/old-web" } })
    ).toBe(true)
    expect(await checkClone(host, { root: "/code/web", repo: WEB })).toBe(false)
    expect(
      await checkClone(host, { root: "/code/web", repo: WEB, remote: { host: "github.com", name: "acme/other" } })
    ).toBe(false)
  })
})

describe("in the plugin", () => {
  test("a session notes its folder's main checkout once, at its first load", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0 }
    machine($, on, world, clock)
    const start = clock.now()
    await startSession($)
    await clock.settle()
    await clock.advance(3 * MINUTE)

    expect(world.store?.clones).toEqual([{ root: "/repo", repo: { host: "github.com", name: "acme/app" }, at: start }])
  })

  test("a session in a clone left on its repository's old name notes that name beside GitHub's", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: GITHUB,
      branch: "main",
      uncommitted: 0,
      gitConfigs: { "/repo": gitConfigOf({ origin: "git@github.com:acme/old-app.git" }) }
    }
    machine($, on, world, clock)
    const start = clock.now()
    await startSession($)
    await clock.settle()

    expect(world.store?.clones).toEqual([
      {
        root: "/repo",
        repo: { host: "github.com", name: "acme/app" },
        remote: { host: "github.com", name: "acme/old-app" },
        at: start
      }
    ])
  })

  test("a session whose list can't load notes nothing", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: GITHUB, branch: "main", uncommitted: 0, repoViewFailure: "not a git repository" }
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()

    expect(Object.keys(world.store ?? {}).filter((key) => key.startsWith("clone"))).toEqual([])
  })
})
