// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"

import {
  clockOf,
  drawnNodes,
  fieldKey,
  GITHUB,
  machine,
  MINUTE,
  mountPane,
  pressDrawn,
  runPrs,
  startSession,
  wordsIn
} from "./testing/world"
import { gitConfigOf } from "./testing/git-config"
import { held } from "./testing/promises"
import type { Drawn, World } from "./testing/world"

const WEB = { mine: [{ number: 12, title: "Checkout page" }] }

// acme/app's folder; acme/web cloned at ~/code/web, as a session there noted it; acme/admin on GitHub alone, where a
// review asks for you.
function worldWith(overrides: Partial<World> = {}): World {
  return {
    github: GITHUB,
    others: { "github.com/acme/web": WEB, "github.com/acme/admin": { requested: [{ number: 3, title: "Roles" }] } },
    branch: "main",
    uncommitted: 0,
    store: {
      clones: [{ root: "/Users/me/code/web", repo: { host: "github.com", name: "acme/web" }, at: 1 }]
    },
    gitConfigs: { "/Users/me/code/web": gitConfigOf({ origin: "git@github.com:acme/web.git" }) },
    elsewhere: { requested: [{ repo: "acme/admin", number: 3, title: "Roles", author: "bo" }] },
    ...overrides
  }
}

// The lines the terminal draws under a panel's title and between its rows.
function rules(nodes: Drawn[]): number {
  return nodes.filter((node) => node.type === "Text" && String(node.children?.[0]).startsWith("─")).length
}

async function paneOn($: Engine, on: On, world: World) {
  const clock = clockOf(on)
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  const ui = await mountPane($, "terminal")

  return { clock, seen, ui }
}

describe("the repository picker", () => {
  test("lists the folder's, then its clones, then GitHub alone, a row each; the one opened shows", async ($, on) => {
    const world = worldWith({ answer: "Show", picks: ["acme/web"] })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    // A row each, the one shown saying so.
    expect(world.rows).toEqual([
      "acme/app this folder ✓ Shown",
      "acme/web ~/code/web Open",
      "acme/admin 🔍 1 to review Open"
    ])
    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).toContain("Not this session's folder")
    expect(await ui.find({ type: "Link", text: "acme/web" })).toBeDefined()
  })

  test("with the alerts from other repositories off, opening it checks them once, keeping it as told nothing", async ($, on) => {
    const world = worldWith({ answer: "Cancel" })
    const kept: unknown[] = []
    on("state.set", { plugin: "gh-prs-monitor", key: "elsewhere" }, async (_, e, next) => {
      kept.push(e.value)
      return next(e)
    })
    const { clock, seen, ui } = await paneOn($, on, world)
    const checks = () => seen.runs.filter((line) => line.includes("archived:false")).length
    expect(checks()).toBe(0)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(checks()).toBe(1)
    expect(world.rows).toContain("acme/admin 🔍 1 to review Open")
    expect(seen.toasts).toEqual([])
    expect(kept.at(-1)).toMatchObject({ viewer: "me", isTold: false })
  })

  test("a pane closed while the repository picked is looked up stays closed, and nothing is visited", async ($, on) => {
    const world = worldWith({ answer: "Show", picks: ["acme/web"] })
    const { clock, seen, ui } = await paneOn($, on, world)
    world.slowRepoViewMs = 2_000

    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    await runPrs($, "close")
    const opens = seen.opens.length
    await clock.advance(3_000)

    expect(seen.opens.length).toBe(opens)
    expect((await runPrs($, "")).text).toBe("Opened the pull requests pane.")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("Not this session's folder")
  })

  test("a repository typed in its field shows, as /prs owner/name does", async ($, on) => {
    const world = worldWith({ answer: "acme/web" })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(await ui.find({ type: "Link", text: "acme/web" })).toBeDefined()
  })

  test("a folder's path visits the repository its git config names; ~ is the home folder", async ($, on) => {
    const { clock } = await paneOn($, on, worldWith())

    expect((await runPrs($, "~/code/web")).text).toBe("Showing acme/web's pull requests.")
    await clock.settle()
  })

  test("a folder that is no clone of a GitHub repository, or in no git repository at all, is said so, plainly", async ($, on) => {
    await paneOn($, on, worldWith({ gitConfigs: { "/Users/me/notes": "[core]\n\tbare = false\n" } }))

    expect((await runPrs($, "/Users/me/notes")).text).toBe(
      "/Users/me/notes is no clone of a GitHub repository: its git config names no remote on a GitHub server."
    )
    expect((await runPrs($, "/Users/me/nots")).text).toBe("/Users/me/nots is in no git repository: check the path.")
    expect((await runPrs($, "acme/web")).text).toBe("Showing acme/web's pull requests.")
  })

  test("a folder that is no GitHub repository offers the picker in its problem box", async ($, on) => {
    const world = worldWith({
      repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host",
      answer: "Cancel"
    })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "pick-repo")
    await clock.settle()

    expect(world.rows?.[0]).toBe("acme/web ~/code/web Open")
  })

  test("opening it marks what changed since as new the next time, and not again", async ($, on) => {
    const world = worldWith({ answer: "Cancel" })
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    world.elsewhere = { requested: [...world.elsewhere!.requested!, { repo: "acme/admin", number: 4, title: "Audit" }] }
    await clock.advance(MINUTE)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    expect(world.rows).toContain("acme/admin • 🔍 2 to review Open")

    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    expect(world.rows).toContain("acme/admin 🔍 2 to review Open")
  })

  test("in Claude Code's own dialog, where no pane can show it, four repositories at most", async ($, on) => {
    const many = Array.from({ length: 6 }, (_, index) => `/Users/me/code/r${index}`)
    const asked: (string[] | undefined)[] = []
    const world: World = worldWith({
      placesPanes: false,
      answer: "Cancel",
      store: {
        clones: many.map((root, index) => ({ root, repo: { host: "github.com", name: `acme/r${index}` }, at: index }))
      },
      gitConfigs: Object.fromEntries(
        many.map((root, index) => [root, gitConfigOf({ origin: `git@github.com:acme/r${index}.git` })])
      ),
      whileAsking: () => void asked.push(world.choices)
    })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(asked[0]).toHaveLength(4)
  })

  test("a folder noted once that is no clone of its repository now is not offered", async ($, on) => {
    const world = worldWith({
      answer: "Cancel",
      gitConfigs: { "/Users/me/code/web": gitConfigOf({ origin: "git@github.com:acme/old.git" }) }
    })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(world.rows?.some((row) => row.includes("code/web"))).toBe(false)
  })

  test(
    "the folder's own picked while visiting shows its list, read again where it is old",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const world = worldWith()
      const { clock, seen, ui } = await paneOn($, on, world)
      await runPrs($, "")
      await clock.settle()
      await runPrs($, "acme/web")
      await clock.settle()
      await clock.advance(10 * MINUTE)
      const lists = seen.runs.filter((line) => line.includes("-f name=app") && line.includes("$mine")).length

      world.answer = "Show"
      world.picks = ["acme/app"]
      await pressDrawn(clock, ui, "repo")
      await clock.settle()

      expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("Not this session's folder")
      expect(seen.runs.filter((line) => line.includes("-f name=app") && line.includes("$mine")).length).toBe(lists + 1)
    }
  )

  test("with the alerts from other repositories off, the header counts nothing elsewhere", async ($, on) => {
    const world = worldWith({ answer: "Cancel" })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("elsewhere")
  })

  test("paths as typed: a worktree, a folder inside a clone, a trailing slash; ~ alone or before a slash", async ($, on) => {
    const world = worldWith({
      // `/Users/mebob` too, which `~bob` must not reach: it is bob's home, not a folder in the person's.
      gitConfigs: {
        "/Users/me/code/web": gitConfigOf({ origin: "git@github.com:acme/web.git" }),
        "/Users/mebob/code/web": gitConfigOf({ origin: "git@github.com:acme/web.git" })
      },
      files: {
        "/Users/me/code/web-wt/.git": "gitdir: /Users/me/code/web/.git/worktrees/web-wt\n",
        "/Users/me/code/web/.git/worktrees/web-wt/commondir": "../..\n"
      }
    })
    await paneOn($, on, world)
    const shows = "Showing acme/web's pull requests."

    expect((await runPrs($, "~/code/web-wt")).text).toBe(shows)
    expect((await runPrs($, "~/code/web/src")).text).toBe(shows)
    expect((await runPrs($, "~/code/web/")).text).toBe(shows)
    expect((await runPrs($, "~bob/code/web")).text).toBe("~bob/code/web is in no git repository: check the path.")
  })

  test("something typed in its field that names no repository is said in the picker, which stays open", async ($, on) => {
    const world = worldWith({ answer: "what now" })
    const { clock, seen, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.drawn()))).toContain(
      '⚠ "what now" is no repository: type owner/name, an address, or a folder\'s path.'
    )
    expect(seen.toasts).toEqual([])
  })

  test("a repository typed that can't be shown keeps the picker open, saying why; Show says Checking… meanwhile", async ($, on) => {
    const world = worldWith({ answer: "acme/secret" })
    const { clock, seen, ui } = await paneOn($, on, world)
    world.slowRepoViewMs = 2_000

    await pressDrawn(clock, ui, "repo")
    await clock.advance(1_000)
    expect((await ui.find({ type: "Input" }))?.props.submitLabel).toBe("Checking…")
    await clock.advance(2_000)
    await clock.settle()

    const words = wordsIn(drawnNodes(await ui.drawn()))
    expect(words).toContain("⚠ No access to acme/secret with your GitHub account, or it does not exist on GitHub.")
    expect(words).toContain("acme/web ~/code/web Open")
    expect((await ui.find({ type: "Input" }))?.props.submitLabel).toBe("Show")
    expect(seen.toasts).toEqual([])
  })

  test("a repository typed after one that couldn't be shown shows, and the picker closes", async ($, on) => {
    const world = worldWith({ answer: "acme/secret" })
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    await ui.input({ key: fieldKey(drawnNodes(await ui.drawn())), text: "acme/web" })
    await clock.settle()

    expect(await ui.find({ type: "Link", text: "acme/web" })).toBeDefined()
    // The picker closed: its Cancel is gone.
    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
  })

  test("Open on a row after a problem: the problem goes while it is checked, and the repository shows", async ($, on) => {
    const world = worldWith({ answer: "acme/secret" })
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    world.slowRepoViewMs = 2_000

    await pressDrawn(clock, ui, "open-1")
    await clock.advance(1_000)
    expect(wordsIn(drawnNodes(await ui.drawn()))).not.toContain("⚠")
    expect(wordsIn(drawnNodes(await ui.find({ key: "repo-row-1" })))).toBe("acme/web ~/code/web Checking…")
    await clock.advance(2_000)
    await clock.settle()

    expect(await ui.find({ type: "Link", text: "acme/web" })).toBeDefined()
    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
  })

  test("Cancel while a row says Checking… closes the picker, and the repository doesn't show after all", async ($, on) => {
    const world = worldWith({ answer: "Show", picks: ["acme/admin"] })
    const { clock, ui } = await paneOn($, on, world)
    world.slowRepoViewMs = 2_000

    await pressDrawn(clock, ui, "repo")
    await clock.advance(1_000)
    await pressDrawn(clock, ui, "answer-1")
    await clock.advance(3_000)
    await clock.settle()

    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("Not this session's folder")
    expect(await ui.find({ type: "Link", text: "acme/admin" })).toBeUndefined()
  })

  test("/prs demo while the picker is open shows the examples, the picker given up", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    await runPrs($, "demo")
    await clock.settle()

    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).toMatch(/^Example pull requests /)
  })

  test("/prs owner/name while the picker is open shows that repository, the picker given up", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    await runPrs($, "acme/admin")
    await clock.settle()

    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
    expect(await ui.find({ type: "Link", text: "acme/admin" })).toBeDefined()
  })

  test("/prs tickets while the picker is open asks about ticket links instead, the picker given up", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    await runPrs($, "tickets")
    await clock.settle()

    expect(world.header).toBe("Ticket links")
    expect(wordsIn(drawnNodes(await ui.drawn()))).not.toContain("On this machine")
  })

  test("/prs with a name that shows nothing, or sent from the phone, leaves the picker open", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect((await runPrs($, "acme/secret")).text).toBe(
      "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )
    await runPrs($, "acme/admin", { kind: "bridge" } as never)
    await clock.settle()

    expect(await ui.find({ key: "answer-1" })).toBeDefined()
  })

  test("/prs alone while the picker is open leaves it open, as the pane shows what it showed", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    await runPrs($, "")
    await clock.settle()

    expect(await ui.find({ key: "answer-1" })).toBeDefined()
  })

  test("Cancel leaves the pane as it was: nothing looked up, nothing shown", async ($, on) => {
    const world = worldWith({ answer: "Cancel" })
    const { clock, seen, ui } = await paneOn($, on, world)
    const lookups = () => seen.runs.filter((line) => line.startsWith("gh repo view")).length
    const before = lookups()

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(lookups()).toBe(before)
    expect(await ui.find({ key: "answer-1" })).toBeUndefined()
    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("Not this session's folder")
  })

  test("with nothing to list, its Show says Checking… too, and what can't be shown is said in it", async ($, on) => {
    const world = worldWith({
      repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host",
      store: {},
      elsewhere: {},
      answer: "Show",
      instructions: "acme/secret"
    })
    const { clock, ui } = await paneOn($, on, world)
    world.slowRepoViewMs = 2_000

    // The picker waits on the folder's own lookups, as slow, before it asks.
    await pressDrawn(clock, ui, "pick-repo")
    await clock.advance(4_000)
    expect(world.rows).toBe(undefined)
    expect((await ui.find({ key: "answer-0" }))?.props.label).toBe("Checking…")
    await clock.advance(10_000)
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.drawn()))).toContain(
      "⚠ No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )
    expect((await ui.find({ key: "answer-0" }))?.props.label).toBe("Show")
  })

  test("Open on a row says Checking… while the repository is read, then shows it", async ($, on) => {
    const world = worldWith({ answer: "Show", picks: ["acme/admin"] })
    const { clock, ui } = await paneOn($, on, world)
    world.slowRepoViewMs = 2_000

    await pressDrawn(clock, ui, "repo")
    await clock.advance(1_000)
    expect(wordsIn(drawnNodes(await ui.find({ key: "repo-row-2" })))).toBe("acme/admin 🔍 1 to review Checking…")
    await clock.advance(2_000)
    await clock.settle()

    expect(await ui.find({ type: "Link", text: "acme/admin" })).toBeDefined()
  })

  test("in the compact view, a line each: the name, what waits in short, and Open; no line between rows", async ($, on) => {
    const world = worldWith()
    const { clock, ui } = await paneOn($, on, world)
    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    // In full, a line under each group's title and between the rows of a group.
    expect(rules(drawnNodes(await ui.drawn()))).toBe(3)
    await pressDrawn(clock, ui, "answer-1")
    await pressDrawn(clock, ui, "view")
    await clock.settle()

    await pressDrawn(clock, ui, "repo")
    await clock.settle()

    expect(world.rows).toEqual(["acme/app ✓ Shown", "acme/web Open", "acme/admin 🔍 1 Open"])
    expect(rules(drawnNodes(await ui.drawn()))).toBe(2)
  })

  test("a repository picked once a demo started meanwhile is no visit hidden behind the examples", async ($, on) => {
    const world = worldWith({ answer: "Show", picks: ["acme/web"] })
    world.whileAsking = () => void runPrs($, "demo")
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "repo")
    await clock.settle()
    await ui.press({ key: "refresh" })
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "header" })))).not.toContain("Not this session's folder")
  })

  test(
    "with the alerts from other repositories on, the picker opened while a check runs waits for what it finds",
    { options: { alertOtherRepos: true, refresh: "on-demand" } },
    async ($, on) => {
      const { gate, open } = held()
      const world = worldWith({ answer: "Cancel", elsewhereGate: gate })
      const { clock, ui } = await paneOn($, on, world)
      await runPrs($, "")
      await clock.settle()

      await pressDrawn(clock, ui, "repo")
      open()
      await clock.settle()

      expect(world.rows).toContain("acme/admin 🔍 1 to review Open")
    }
  )

  test("while the picker gets ready, its button says Loading… and a press more does nothing", async ($, on) => {
    const { gate, open } = held()
    const world = worldWith({ answer: "Cancel", elsewhereGate: gate })
    const { clock, seen, ui } = await paneOn($, on, world)
    const checks = () => seen.runs.filter((line) => line.includes("archived:false")).length

    await pressDrawn(clock, ui, "repo")
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Loading…")
    await pressDrawn(clock, ui, "repo")
    expect(checks()).toBe(1)
    open()
    await clock.settle()

    expect(world.rows).toContain("acme/admin 🔍 1 to review Open")
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Repositories")
    expect(checks()).toBe(1)
  })

  test("during a visit, its Repositories button says Loading… too while the picker gets ready", async ($, on) => {
    const { gate, open } = held()
    const world = worldWith({ answer: "Cancel" })
    const { clock, ui } = await paneOn($, on, world)
    await runPrs($, "acme/web")
    await clock.settle()
    world.elsewhereGate = gate

    await pressDrawn(clock, ui, "repo")
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Loading…")
    open()
    await clock.settle()
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Repositories")
  })

  test("in a narrow pane, Loading… takes the place of Repositories without moving the header", async ($, on) => {
    const { gate, open } = held()
    const world = worldWith({ answer: "Cancel", elsewhereGate: gate })
    const clock = clockOf(on)
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal", 40)
    const layout = (await ui.find({ key: "header" }))?.props.flexDirection

    await pressDrawn(clock, ui, "repo")
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Loading…")
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe(layout)
    open()
    await clock.settle()
    expect((await ui.find({ key: "repo" }))?.props.label).toBe("Repositories")
  })

  test("the problem box's Show Another Repository says Loading… too while the picker gets ready", async ($, on) => {
    const { gate, open } = held()
    const world = worldWith({
      repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host",
      answer: "Cancel",
      elsewhereGate: gate
    })
    const { clock, ui } = await paneOn($, on, world)

    await pressDrawn(clock, ui, "pick-repo")
    expect((await ui.find({ key: "pick-repo" }))?.props.label).toBe("Loading…")
    open()
    await clock.settle()
    expect((await ui.find({ key: "pick-repo" }))?.props.label).toBe("Show Another Repository")
  })

  test("/prs says it takes a folder's path too", async ($, on) => {
    await paneOn($, on, worldWith())

    expect((await runPrs($, "what now")).text).toContain("a folder's path")
  })

  test("on Windows, where HOME is unset, ~ is the home folder USERPROFILE names", async ($, on) => {
    await paneOn($, on, worldWith({ env: { HOME: undefined, USERPROFILE: "/Users/me" } }))

    expect((await runPrs($, "~/code/web")).text).toBe("Showing acme/web's pull requests.")
  })

  test(
    "before the folder's first list, an SSH alias in a typed folder is on the folder's server, looked up then",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const world = worldWith({
        repoUrl: "https://ghe.example.com/acme/app",
        signedIn: ["ghe.example.com"],
        others: { "ghe.example.com/acme/web": WEB },
        gitConfigs: { "/Users/me/code/work": gitConfigOf({ origin: "git@ghe-work:acme/web.git" }) }
      })
      await paneOn($, on, world)

      expect((await runPrs($, "~/code/work")).text).toBe("Showing acme/web's pull requests.")
    }
  )
})
