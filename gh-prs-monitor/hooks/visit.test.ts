// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { RepoRef } from "./gh"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { snapshotOf } from "./testing/fixtures"
import type { ResponseFixture } from "./testing/fixtures"
import { gitConfigOf } from "./testing/git-config"
import { held, promisesRun } from "./testing/promises"
import { fakeVisitHost, NOW, settled } from "./testing/visit-host"
import type { VisitWorld } from "./testing/visit-host"
import {
  backToFolder,
  endVisit,
  folderOf,
  loadVisit,
  readRepoInput,
  readVisitList,
  repoAtFolder,
  resumeVisit,
  showRepo,
  startVisit,
  visitCommand,
  visitPlace
} from "./visit"

// A visit asked for by someone who wants it still, as `/prs owner/name` does.
const WANTED = () => true

const FOLDER: RepoRef = { host: "github.com", name: "acme/app" }
const WEB: ResponseFixture = {
  mine: [{ number: 12, title: "Checkout page" }],
  requested: [{ number: 3, title: "Search box", author: "ann" }]
}
const ADMIN: ResponseFixture = { mine: [{ number: 40, title: "Roles page" }] }

function folderSession(options: Parameters<typeof readSettings>[0] = {}) {
  const session = createSession(readSettings(options))
  session.repo = FOLDER

  return session
}

// Lets a load begun run until it has asked GitHub for its list, so a gate set before holds it there.
async function untilAsked(made: ReturnType<typeof fakeVisitHost>, lists: number): Promise<void> {
  await promisesRun()
  expect(made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length).toBe(lists)
}

// Starts a visit and lets its first load finish.
async function visited(
  made: ReturnType<typeof fakeVisitHost>,
  session: ReturnType<typeof folderSession>,
  name: string
) {
  const started = await startVisit(made.host, session, { host: "github.com", name }, session.repo, WANTED)
  await settled(made.seen)

  return started
}

describe("what the person types to visit a repository", () => {
  test("an owner with an underscore, as an Enterprise managed user's handle, is a repository too", () => {
    expect(readRepoInput("ann_acme/dotfiles")).toEqual({ name: "ann_acme/dotfiles", host: null })
  })

  test("owner/name is a repository on the folder's server, found once it is needed", () => {
    expect(readRepoInput("acme/web")).toEqual({ name: "acme/web", host: null })
    expect(readRepoInput("  acme/web.site_2 ")).toEqual({ name: "acme/web.site_2", host: null })
    expect(readRepoInput("acme/web.git")).toEqual({ name: "acme/web", host: null })
  })

  test("a pull request's or repository's address is that repository on its own server", () => {
    expect(readRepoInput("https://GHE.example.com/acme/web/pull/3")).toEqual({
      name: "acme/web",
      host: "ghe.example.com"
    })
    expect(readRepoInput("https://github.com/acme/web")).toEqual({ name: "acme/web", host: "github.com" })
  })

  test("a path starts with /, ~ or ., or a Windows drive, and is a folder, not a name", () => {
    for (const path of ["/Users/me/web", "~/web", "./web", "../web", "C:\\code\\web", "d:/code/web"]) {
      expect(readRepoInput(path)).toEqual({ path })
    }
  })

  test("anything else, a name GitHub couldn't hold among it, is no repository", () => {
    for (const text of ["", "web", "acme/web/extra", "acme web", "acme/", "acme/..", "a.b/web", "me@host/web"]) {
      expect(readRepoInput(text)).toBe(null)
    }
    expect(readRepoInput("https://github.com/acme/../pull/3")).toBe(null)
  })
})

describe("where the pane stands for a visit", () => {
  test("a pane drawn in front shows the visit; one undrawn or behind another waits; none ends it", () => {
    expect(visitPlace({ isPlaced: true, isShown: true })).toBe("shown")
    expect(visitPlace({ isPlaced: true, isShown: false })).toBe("waiting")
    expect(visitPlace({ isPlaced: false, isShown: false })).toBe("waiting")
    expect(visitPlace(undefined)).toBe("gone")
  })
})

describe("a visit", () => {
  test("shows another repository's list, under the name GitHub writes, and leaves the folder's alone", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()

    expect(await visited(made, session, "Acme/Web")).toMatchObject({ loading: expect.any(Promise) })

    expect(made.state.visit?.repo).toEqual({ host: "github.com", name: "acme/web" })
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])
    expect(made.state.visit?.snapshot?.review.map((row) => row.number)).toEqual([3])
    expect(made.state.visit?.problem).toBe(null)
    expect(made.state.visit?.loadId).toBe(null)
    expect(made.state.visit?.folder).toBe("acme/app")
    expect(session.repo).toEqual(FOLDER)
  })

  test("of two asked one after the other, the one asked last shows, whichever GitHub answers first", async () => {
    const lookup = held()
    const made = fakeVisitHost({
      others: { "github.com/acme/web": WEB, "github.com/acme/admin": ADMIN },
      heldLookups: { "acme/web": lookup.gate }
    })
    const session = folderSession()

    const first = startVisit(made.host, session, { host: "github.com", name: "acme/web" }, FOLDER, WANTED)
    await visited(made, session, "acme/admin")
    lookup.open()

    expect(await first).toEqual({ isOvertaken: true })
    await settled(made.seen)
    expect(made.state.visit?.repo.name).toBe("acme/admin")
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([40])
  })

  test("Back pressed while GitHub is asked for the repository keeps the folder's list", async () => {
    const lookup = held()
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB }, heldLookups: { "acme/web": lookup.gate } })
    const session = folderSession()

    const asked = startVisit(made.host, session, { host: "github.com", name: "acme/web" }, FOLDER, WANTED)
    await endVisit(made.host, session)
    lookup.open()

    expect(await asked).toEqual({ isOvertaken: true })
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
  })

  test("one its asker no longer wants by the time GitHub answers shows nothing, as the picker cancelled meanwhile", async () => {
    const lookup = held()
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB }, heldLookups: { "acme/web": lookup.gate } })
    const session = folderSession()
    let isWanted = true

    const asked = startVisit(made.host, session, { host: "github.com", name: "acme/web" }, FOLDER, () => isWanted)
    isWanted = false
    lookup.open()

    expect(await asked).toEqual({ isOvertaken: true })
    expect(made.state.visit).toBe(null)
  })

  test("the folder's own, no longer wanted once its name is known, leaves a visit as it is", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    await startVisit(made.host, session, { host: "github.com", name: "acme/web" }, FOLDER, WANTED)
    await settled(made.seen)

    expect(await startVisit(made.host, session, FOLDER, FOLDER, () => false)).toEqual({ isOvertaken: true })
    expect(made.state.visit?.repo.name).toBe("acme/web")
  })

  test("one no longer wanted as the visit is written is not written", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    let isWanted = true
    // The picker cancelled as the start reads the visit it would replace, after GitHub answered.
    const host = {
      ...made.host,
      visit: async () => {
        isWanted = false

        return made.host.visit()
      }
    }

    expect(await startVisit(host, session, { host: "github.com", name: "acme/web" }, FOLDER, () => isWanted)).toEqual({
      isOvertaken: true
    })
    expect(made.state.visit).toBe(null)
  })

  test("Back pressed in the moment before the visit is written still overtakes it", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    // Back comes as the start reads the visit it would replace, after GitHub answered.
    const host = {
      ...made.host,
      visit: async () => {
        await endVisit(made.host, session)

        return made.host.visit()
      }
    }

    expect(await startVisit(host, session, { host: "github.com", name: "acme/web" }, FOLDER, WANTED)).toEqual({
      isOvertaken: true
    })
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
  })

  test("a new visit is written loading, so a pane opening on it says so before its list comes", async () => {
    const { gate, open } = held()
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB }, gate })

    await startVisit(made.host, folderSession(), { host: "github.com", name: "acme/web" }, FOLDER, WANTED)

    expect(made.state.visit?.loadId).not.toBe(null)
    open()
    await settled(made.seen)
    expect(made.state.visit?.loadId).toBe(null)
  })

  test("a load a reload replaced writes nothing, not even its mark", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    await visited(made, session, "acme/web")
    const writes = made.seen.writes
    made.state.isReplaced = true

    await loadVisit(made.host, session)

    expect(made.seen.writes).toBe(writes)
    expect(made.state.visit?.loadId).toBe(null)
  })

  test("a server gh isn't signed in to is refused before anything is asked of it", async () => {
    const { host, state, seen } = fakeVisitHost({ others: { "ghe.example.com/acme/web": WEB } })

    expect(
      await startVisit(host, folderSession(), { host: "ghe.example.com", name: "acme/web" }, FOLDER, WANTED)
    ).toEqual({
      problem: "The GitHub CLI is not signed in to ghe.example.com. Run: gh auth login --hostname ghe.example.com"
    })
    // The account gh uses there alone, as another account's trouble on the server is none of the visit's.
    expect(seen.calls).toEqual(["gh auth status --active --hostname ghe.example.com"])
    expect(state.visit).toBe(null)
  })

  test("with gh not installed, a visit says so, not that gh isn't signed in", async () => {
    const { host } = fakeVisitHost({})
    const missing = {
      ...host,
      run: async (): Promise<never> => {
        throw new Error('Executable not found in $PATH: "gh"')
      }
    }

    expect(
      await startVisit(missing, folderSession(), { host: "github.com", name: "acme/web" }, FOLDER, WANTED)
    ).toEqual({
      problem: "The GitHub CLI (gh) is not installed. Get it from https://cli.github.com, then run: gh auth login"
    })
  })

  test("a repository GitHub doesn't show the person is said so, and nothing is visited, listed or polled", async () => {
    const { host, state, seen } = fakeVisitHost({ others: { "github.com/acme/web": WEB } })

    expect(
      await startVisit(host, folderSession(), { host: "github.com", name: "acme/secret" }, FOLDER, WANTED)
    ).toEqual({
      problem: "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    })
    expect(state.visit).toBe(null)
    expect(seen.calls.some((line) => line.startsWith("gh api graphql"))).toBe(false)
    expect(seen.timers).toEqual([])
  })

  test("the folder's own repository, written in any letter case, ends a visit and starts none", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB, "github.com/acme/app": ADMIN } })
    const session = folderSession()
    await visited(made, session, "acme/web")

    const asked = made.seen.calls.length
    expect(await startVisit(made.host, session, { host: "GitHub.com", name: "Acme/App" }, FOLDER, WANTED)).toBe(null)
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
    expect(made.seen.calls.length).toBe(asked)
  })

  for (const how of ["ended", "left for another"] as const) {
    test(`${how}, what GitHub suggested for its rows and its buttons drawn are forgotten; the folder's are kept`, async () => {
      const made = fakeVisitHost({ others: { "github.com/acme/web": WEB, "github.com/acme/admin": ADMIN } })
      const session = folderSession()
      await visited(made, session, "acme/web")
      const kept = { basis: "h", names: ["kim"] }
      session.suggestedReviewers.set("github.com/acme/web#12", kept)
      session.suggestedReviewers.set("github.com/acme/app#12", kept)
      for (const site of [
        "terminal:pane",
        "terminal:pane:visit:github.com/acme/web",
        "desktop:pane:visit:github.com/acme/web"
      ]) {
        session.drawnElements.set(site, new Map())
      }

      if (how === "ended") {
        await endVisit(made.host, session)
      } else {
        await visited(made, session, "acme/admin")
      }

      expect([...session.suggestedReviewers.keys()]).toEqual(["github.com/acme/app#12"])
      expect([...session.drawnElements.keys()]).toEqual(["terminal:pane"])
    })
  }

  test("its rows' ticket links are read with each load; a store that can't be read leaves those it had", async () => {
    const links = { "WEB-": "https://linear.app/acme/issue/{key}" }
    const world: VisitWorld = { others: { "github.com/acme/web": WEB }, tickets: links }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")
    expect(made.state.visit?.tickets).toEqual(links)

    world.tickets = "unreadable"
    await loadVisit(made.host, session)

    expect(made.state.visit?.tickets).toEqual(links)
  })

  test("a visit to another repository keeps nothing of the one before while its list loads", async () => {
    const world: VisitWorld = { others: { "github.com/acme/web": WEB, "github.com/acme/admin": ADMIN } }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")
    const merged = { number: 12, title: "Checkout page", url: "u", base: "main", index: 0, at: 0 }
    made.state.visit = { ...made.state.visit!, merged: [merged], tickets: { "WEB-": "https://linear.app/{key}" } }

    const gate = held()
    world.gate = gate.gate
    await startVisit(made.host, session, { host: "github.com", name: "acme/admin" }, FOLDER, WANTED)

    expect(made.state.visit).toMatchObject({ snapshot: null, merged: [], tickets: null })
    gate.open()
    await settled(made.seen)
  })

  test("ending where there is no visit writes nothing, so a session that never visits writes as before", async () => {
    const made = fakeVisitHost({ others: {} })

    await endVisit(made.host, folderSession())

    expect(made.seen.writes).toBe(0)
  })

  test("where no load found the folder's repository yet, it is looked up once, and kept", async () => {
    const made = fakeVisitHost({ others: {}, folder: "github.com/acme/app" })
    const session = folderSession()
    session.repo = null

    expect(await folderOf(made.host, session)).toEqual(FOLDER)
    expect(await folderOf(made.host, session)).toEqual(FOLDER)

    expect(made.seen.calls.filter((line) => line.startsWith("gh repo view"))).toHaveLength(1)
    expect(session.repo).toEqual(FOLDER)
  })

  test("a repository GitHub now names as the folder's own starts no visit", async () => {
    const made = fakeVisitHost({
      others: {},
      folder: "github.com/acme/app",
      renamed: { "github.com/acme/old-app": "github.com/acme/app" }
    })

    expect(
      await startVisit(made.host, folderSession(), { host: "github.com", name: "acme/old-app" }, FOLDER, WANTED)
    ).toBe(null)
    expect(made.state.visit).toBe(null)
  })

  test("a load still under way when the visit ends, or moves to another repository, is dropped", async () => {
    const world: VisitWorld = { others: { "github.com/acme/web": WEB, "github.com/acme/admin": ADMIN } }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")

    const first = held()
    world.gate = first.gate
    const lists = made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const stale = loadVisit(made.host, session)
    await untilAsked(made, lists + 1)
    world.gate = undefined
    await visited(made, session, "acme/admin")
    first.open()
    await stale
    expect(made.state.visit?.repo.name).toBe("acme/admin")
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([40])

    const second = held()
    world.gate = second.gate
    const before = made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const ended = loadVisit(made.host, session)
    await untilAsked(made, before + 1)
    await endVisit(made.host, session)
    second.open()
    await ended
    expect(made.state.visit).toBe(null)
  })

  test("of two loads of one visit, the older ending last writes nothing", async () => {
    const world: VisitWorld = { others: { "github.com/acme/web": WEB } }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")

    const older = held()
    world.gate = older.gate
    const lists = made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const first = loadVisit(made.host, session)
    await untilAsked(made, lists + 1)
    world.gate = undefined
    world.others!["github.com/acme/web"] = { mine: [{ number: 13, title: "Basket page" }] }
    await loadVisit(made.host, session)
    older.open()
    await first

    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([13])
  })

  test("a load the module's reload replaced writes nothing", async () => {
    const world: VisitWorld = { others: { "github.com/acme/web": WEB } }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")
    const before = made.state.visit

    const { gate, open } = held()
    world.gate = gate
    const lists = made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const loading = loadVisit(made.host, session)
    await untilAsked(made, lists + 1)
    made.state.isReplaced = true
    open()
    await loading

    expect(made.state.visit?.snapshot).toBe(before?.snapshot)
  })

  test("a repository renamed on GitHub renames the visit; the folder's stays", async () => {
    const made = fakeVisitHost({
      others: { "github.com/acme/web": { ...WEB, nameWithOwner: "acme/storefront" }, "github.com/acme/storefront": WEB }
    })
    const session = folderSession()

    await visited(made, session, "acme/web")

    expect(made.state.visit?.repo).toEqual({ host: "github.com", name: "acme/storefront" })
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])
    expect(session.repo).toEqual(FOLDER)
  })

  test("renamed, the buttons drawn under its old name are let go", async () => {
    const made = fakeVisitHost({
      others: { "github.com/acme/web": { ...WEB, nameWithOwner: "acme/storefront" }, "github.com/acme/storefront": WEB }
    })
    const session = folderSession()
    session.drawnElements.set("terminal:pane:visit:github.com/acme/web", new Map())

    await visited(made, session, "acme/web")

    expect([...session.drawnElements.keys()]).toEqual([])
  })

  test("a load that fails keeps the list shown and says why, until one works", async () => {
    const world: VisitWorld = { others: { "github.com/acme/web": WEB } }
    const made = fakeVisitHost(world)
    const session = folderSession()
    await visited(made, session, "acme/web")

    world.others!["github.com/acme/web"] = { ...WEB, hasRepository: false }
    await loadVisit(made.host, session)
    expect(made.state.visit?.problem).toBe(
      "No access to acme/web with your GitHub account, or it does not exist on GitHub."
    )
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])
    expect(made.state.visit?.loadId).toBe(null)

    world.others!["github.com/acme/web"] = WEB
    await loadVisit(made.host, session)
    expect(made.state.visit?.problem).toBe(null)
  })

  test("polls on the refresh mode's timer while the pane shows it, waits while it doesn't, and ends with it", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const { state, seen } = made
    const session = folderSession()
    await visited(made, session, "acme/web")
    const [timer] = seen.timers
    expect(timer?.ms).toBe(session.settings.pollMs)
    const lists = () => seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const asked = lists()

    timer!.tick()
    await settled(seen)
    expect(lists()).toBe(asked + 1)

    state.pane = { isPlaced: true, isShown: false }
    timer!.tick()
    await settled(seen)
    expect(lists()).toBe(asked + 1)
    expect(state.visit).not.toBe(null)

    state.pane = undefined
    timer!.tick()
    await settled(seen)
    expect(state.visit).toBe(null)
    expect(timer!.isCancelled).toBe(true)
    expect(session.visitTimer).toBe(null)
  })

  test("on demand, nothing polls", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })

    await visited(made, folderSession({ refresh: "on-demand" }), "acme/web")

    expect(made.seen.timers).toEqual([])
  })

  test("found again after a reload: a load the replaced module began is forgotten and the list read again", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    made.state.visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: "old",
      folder: "acme/app",
      merged: [],
      tickets: null
    }

    await resumeVisit(made.host, session, true)
    await settled(made.seen)

    expect(made.state.visit?.loadId).toBe(null)
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])
    expect(made.seen.timers.length).toBe(1)
  })

  test("found again after a reload while its pane waits behind another, a load the replaced module began is forgotten", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    made.state.pane = { isPlaced: true, isShown: false }
    made.state.visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: "old",
      folder: "acme/app",
      merged: [],
      tickets: null
    }

    await resumeVisit(made.host, folderSession(), true)
    await settled(made.seen)

    expect(made.state.visit?.loadId).toBe(null)
    expect(made.seen.calls.filter((line) => line.startsWith("gh api graphql"))).toEqual([])
  })

  test("found again after a reload with no list this version can draw, its list is read again", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    const older = { schema: 0 } as never
    made.state.visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: older,
      problem: null,
      loadId: null,
      folder: "acme/app",
      merged: [],
      tickets: null
    }

    await resumeVisit(made.host, session, true)
    await settled(made.seen)

    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])
  })

  test("found as an app attaches, a load under way is left to finish; a visit whose pane is gone ends", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    made.state.visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: "now",
      folder: "acme/app",
      merged: [],
      tickets: null
    }

    await resumeVisit(made.host, session, false)
    expect(made.state.visit?.loadId).toBe("now")

    made.state.pane = undefined
    await resumeVisit(made.host, session, false)
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
  })

  test("found as an app attaches after a while, a list older than a check's interval is read again", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    await visited(made, session, "acme/web")
    const lists = () => made.seen.calls.filter((line) => line.startsWith("gh api graphql")).length
    const before = lists()

    await resumeVisit(made.host, session, false)
    await settled(made.seen)
    expect(lists()).toBe(before)

    const old = made.state.visit!.snapshot!.fetchedAt - session.settings.pollMs - 1
    made.state.visit = { ...made.state.visit!, snapshot: { ...made.state.visit!.snapshot!, fetchedAt: old } }
    await resumeVisit(made.host, session, false)
    await settled(made.seen)
    expect(lists()).toBe(before + 1)
  })

  test("read once, as for the phone, a repository's list is given and no visit is kept", async () => {
    const { host, state, seen } = fakeVisitHost({ others: { "github.com/acme/web": WEB } })

    const read = await readVisitList(host, folderSession(), { host: "github.com", name: "ACME/web" })

    expect("snapshot" in read && read.repo).toEqual({ host: "github.com", name: "acme/web" })
    expect("snapshot" in read && read.snapshot.mine.map((row) => row.number)).toEqual([12])
    expect(state.visit).toBe(null)
    expect(seen.timers).toEqual([])
  })
})

describe("leaving a visit, and showing a repository named", () => {
  test("Back ends the visit, and reads the folder's list again where none was read or it is older than a check's interval", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    await visited(made, session, "acme/web")

    await backToFolder(made.host, session)
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
    expect(made.seen.folderReads).toBe(1)

    made.state.folderList = snapshotOf({}, { at: NOW - session.settings.pollMs })
    await backToFolder(made.host, session)
    expect(made.seen.folderReads).toBe(1)

    made.state.folderList = snapshotOf({}, { at: NOW - session.settings.pollMs - 1 })
    await backToFolder(made.host, session)
    expect(made.seen.folderReads).toBe(2)
  })

  test("the picker's choice is visited, on the folder's server where it names none; one that can't be keeps the visit", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()

    expect(await showRepo(made.host, session, { name: "Acme/Web", host: null }, WANTED)).toBe(null)
    await settled(made.seen)
    expect(made.state.visit?.repo).toEqual({ host: "github.com", name: "acme/web" })
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])

    expect(await showRepo(made.host, session, { name: "acme/secret", host: null }, WANTED)).toBe(
      "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )
    expect(made.state.visit?.repo.name).toBe("acme/web")
    expect(made.seen.folderReads).toBe(0)
  })

  test("picked in Claude Code's own dialog after the pane closed, a repository, or the folder's own, opens it again", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    made.state.pane = undefined
    const session = folderSession()

    expect(await showRepo(made.host, session, { name: "acme/web", host: null }, WANTED)).toBe(null)
    expect(made.seen.paneOpens).toBe(1)
    expect(await showRepo(made.host, session, { name: "acme/app", host: null }, WANTED)).toBe(null)
    expect(made.seen.paneOpens).toBe(2)

    // Where the pane shows, it is left as it is.
    made.state.pane = { isPlaced: true, isShown: true }
    await showRepo(made.host, session, { name: "acme/web", host: null }, WANTED)
    expect(made.seen.paneOpens).toBe(2)
  })

  test("the picker's choice of the folder's own repository goes back to the folder's list, as Back does", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()
    await visited(made, session, "acme/web")

    expect(await showRepo(made.host, session, { name: "acme/app", host: null }, WANTED)).toBe(null)
    expect(made.state.visit).toBe(null)
    expect(made.seen.folderReads).toBe(1)
  })

  test("/prs owner/name with the pane here visits it, named as GitHub writes it; the folder's own ends the visit", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()

    expect(await visitCommand(made.host, session, { name: "Acme/Web", host: null }, true)).toBe(
      "Showing acme/web's pull requests."
    )
    await settled(made.seen)
    expect(made.state.visit?.snapshot?.mine.map((row) => row.number)).toEqual([12])

    expect(await visitCommand(made.host, session, { name: "acme/app", host: null }, true)).toBe(null)
    expect(made.state.visit).toBe(null)
    expect(await visitCommand(made.host, session, { name: "acme/secret", host: null }, true)).toBe(
      "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )
  })

  test("/prs owner/name overtaken by another asked for meanwhile says so, and shows the other", async () => {
    const lookup = held()
    const made = fakeVisitHost({
      others: { "github.com/acme/web": WEB, "github.com/acme/admin": ADMIN },
      heldLookups: { "acme/web": lookup.gate }
    })
    const session = folderSession()

    const typed = visitCommand(made.host, session, { name: "acme/web", host: null }, true)
    expect(await showRepo(made.host, session, { name: "acme/admin", host: null }, WANTED)).toBe(null)
    lookup.open()

    expect(await typed).toBe(
      "acme/web isn't shown, as the pane was closed or asked for something else meanwhile. Type /prs acme/web to show it."
    )
    expect(made.state.visit?.repo.name).toBe("acme/admin")
  })

  test("/prs owner/name in an app that places no panes prints its list, and keeps no visit", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    made.state.pane = { isPlaced: false, isShown: false }
    const session = folderSession()

    const text = await visitCommand(made.host, session, { name: "acme/web", host: null }, true)

    expect(text).toContain("Checkout page")
    expect(text).toContain("Search box")
    expect(made.state.visit).toBe(null)
    expect(session.visitTimer).toBe(null)
  })

  test("/prs owner/name where no pane shows it prints its list once and keeps no visit; the folder's own ends one", async () => {
    const made = fakeVisitHost({ others: { "github.com/acme/web": WEB } })
    const session = folderSession()

    const text = await visitCommand(made.host, session, { name: "acme/web", host: null }, false)

    expect(text).toContain("Checkout page")
    expect(made.state.visit).toBe(null)
    expect(made.seen.timers).toEqual([])
    expect(await visitCommand(made.host, session, { name: "acme/secret", host: null }, false)).toBe(
      "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )

    await visited(made, session, "acme/web")
    const asked = made.seen.calls.length
    expect(await visitCommand(made.host, session, { name: "acme/app", host: null }, false)).toBe(null)
    expect(made.state.visit).toBe(null)
    expect(made.seen.calls.length).toBe(asked)
  })
})

describe("a folder typed", () => {
  test("names the repository gh would pick there: its first remote on a server the GitHub CLI is signed in to", async () => {
    const { host } = fakeVisitHost({
      files: {
        "/code/web/.git/config": gitConfigOf({
          upstream: "git@gitlab.com:acme/web.git",
          origin: "git@github.com:acme/web.git"
        })
      }
    })

    expect(await repoAtFolder(host, "/code/web", null, "/repo", FOLDER)).toEqual({
      host: "github.com",
      name: "acme/web"
    })
  })

  test("an SSH alias, which names no server, is on this folder's server, or gh's default for a folder with none", async () => {
    const files = { "/code/work/.git/config": gitConfigOf({ origin: "git@github-work:acme/web.git" }) }
    const enterprise = fakeVisitHost({ signedIn: ["ghe.example.com"], files }).host

    expect(
      await repoAtFolder(enterprise, "~/work", "/code", "/repo", { host: "ghe.example.com", name: "acme/app" })
    ).toEqual({
      host: "ghe.example.com",
      name: "acme/web"
    })
    expect(await repoAtFolder(fakeVisitHost({ files }).host, "~/work", "/code", "/repo", null)).toEqual({
      host: "github.com",
      name: "acme/web"
    })
  })

  test("with no remote, or none on a server the GitHub CLI is signed in to, says which", async () => {
    const { host } = fakeVisitHost({
      files: {
        "/code/notes/.git/config": "[core]\n\tbare = false\n",
        "/code/lab/.git/config": gitConfigOf({ origin: "git@gitlab.com:acme/lab.git" })
      }
    })

    expect(await repoAtFolder(host, "/code/notes", null, "/repo", FOLDER)).toEqual({
      problem: "/code/notes is no clone of a GitHub repository: its git config names no remote on a GitHub server."
    })
    expect(await repoAtFolder(host, "/code/nots", null, "/repo", FOLDER)).toEqual({
      problem: "/code/nots is in no git repository: check the path."
    })
    expect(await repoAtFolder(host, "/code/lab", null, "/repo", FOLDER)).toEqual({
      problem:
        "/code/lab is no clone of a repository the GitHub CLI is signed in to: its remotes are on gitlab.com. For GitHub Enterprise, run: gh auth login --hostname <your server>; for an SSH alias with a dot, as github.com-work, type its owner/name instead."
    })
  })

  test("signed out of github.com, says to sign in there; gh missing or GitHub out of reach, says so as it is", async () => {
    const files = { "/code/web/.git/config": gitConfigOf({ origin: "git@github.com:acme/web.git" }) }

    expect(await repoAtFolder(fakeVisitHost({ signedIn: [], files }).host, "/code/web", null, "/repo", FOLDER)).toEqual(
      {
        problem:
          "/code/web is no clone of a repository the GitHub CLI is signed in to: its remotes are on github.com. Run: gh auth login"
      }
    )
    const { host } = fakeVisitHost({ files })
    const missing = {
      ...host,
      run: async (): Promise<never> => {
        throw new Error('Executable not found in $PATH: "gh"')
      }
    }
    expect(await repoAtFolder(missing, "/code/web", null, "/repo", FOLDER)).toEqual({
      problem: "The GitHub CLI (gh) is not installed. Get it from https://cli.github.com, then run: gh auth login"
    })
    const offline = {
      ...host,
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "error connecting to api.github.com\n",
        isStdoutTruncated: false,
        isStderrTruncated: false
      })
    }
    const answer = await repoAtFolder(offline, "/code/web", null, "/repo", FOLDER)
    expect("problem" in answer && answer.problem).not.toContain("signed in")
  })
})
