// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { ResponseFixture } from "./testing/fixtures"
import {
  clockOf,
  drawnNodes,
  GITHUB,
  HEADING,
  keptList,
  keptOverReload,
  lines,
  machine,
  mountBand,
  mountPane,
  pressDrawn,
  runPrs,
  startSession,
  SURFACES,
  wordsIn
} from "./testing/world"
import type { World } from "./testing/world"

const WEB: ResponseFixture = {
  mine: [{ number: 12, title: "Checkout page", headRefName: "feature/web-12" }],
  requested: [{ number: 3, title: "Search box", author: "ann" }]
}
const LOOK = "look:github.com/acme/app"
const POLL_MS = 3 * 60_000

function worldWith(overrides: Partial<World> = {}): World {
  return { github: GITHUB, others: { "github.com/acme/web": WEB }, branch: "main", uncommitted: 0, ...overrides }
}

// How many times the list of a repository was asked of GitHub.
function listsOf(runs: readonly string[], name: string): number {
  const [owner, repo] = name.split("/")

  return runs.filter((line) => line.includes(`-f owner=${owner} -f name=${repo}`) && line.includes("$mine")).length
}

async function header(ui: Awaited<ReturnType<typeof mountPane>>): Promise<string> {
  return wordsIn(drawnNodes(await ui.find({ key: "header" })))
}

describe("visiting another repository", () => {
  test("/prs owner/name shows its list under its name, as no folder of this session's, with Back, on every surface", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "Acme/Web")).text).toBe("Showing acme/web's pull requests.")
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface)
      expect(await header(ui)).toContain("acme/web")
      expect(await header(ui)).toContain("Not this session's folder")
      expect((await ui.find({ key: "back" }))?.props.label).toBe("Back to acme/app")
      expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Checkout page")
      expect(wordsIn(drawnNodes(await ui.find({ key: "panel-review" })))).toContain("Search box")
    }
  })

  test("a visit's header: Back, Repositories, the view and Refresh, its width counting each button's gap", async ($, on) => {
    const clock = clockOf(on)
    const one: ResponseFixture = { mine: [{ number: 12, title: "Checkout page" }] }
    machine(
      $,
      on,
      worldWith({ github: { mine: [{ number: 1, title: "Fix the menu" }] }, others: { "github.com/acme/web": one } })
    )
    await startSession($)
    await clock.settle()
    const stacks = async (columns: number) => {
      const ui = await mountPane($, "terminal", columns)
      const direction = (await ui.find({ key: "header" }))?.props.flexDirection
      await ui.unmount()

      return direction
    }
    // The folder's own list draws its header a row from this many columns.
    let folderRow = 30
    while ((await stacks(folderRow)) === "column") {
      folderRow++
    }

    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal", 120)
    const buttons = drawnNodes(await ui.find({ key: "header-buttons" })).filter((node) => node.type === "Button")
    expect(buttons.map((node) => node.props?.key)).toEqual(["back", "repo", "view", "refresh"])
    expect(buttons[1]?.props?.dimColor).toBe(true)
    await ui.unmount()
    // Beside the buttons, 61 columns with "Back to acme/app" (16 + 4) and its gap, the time's line with the note,
    // 13 + 2 + 25, is the widest of the name's two lines: 4 + 40 + 2 + 61.
    expect(folderRow).toBeLessThan(107)
    expect(await stacks(106)).toBe("column")
    expect(await stacks(107)).toBe("row")
  })

  test("while a visit's list loads, its header already makes room for the time the list brings", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith()
    machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    world.slowGithubMs = 20_000

    void runPrs($, "acme/web")
    await clock.advance(1_000)
    // At 79 columns "updated 01:00" won't fit beside Back, Repositories, the view and Refresh, though "acme/web" would.
    const ui = await mountPane($, "terminal", 79)
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe("column")
    await ui.unmount()
    await clock.advance(30_000)
  })

  test("a visit's Back too long for a narrow pane says Back alone", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    const ui = await mountPane($, "terminal", 22)

    expect((await ui.find({ key: "back" }))?.props.label).toBe("Back")
  })

  test("a visit's rows show no branch marker or Create PR, even on the branch the folder is on", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ branch: "feature/web-12" }))
    await startSession($)
    await clock.settle()

    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    for (const panel of ["panel-mine", "panel-review"]) {
      expect(wordsIn(drawnNodes(await ui.find({ key: panel })))).not.toContain("●")
    }
    expect(await ui.find({ key: "create-pr" })).toBe(undefined)
  })

  test("Back shows the folder's list again, as it stands", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    await pressDrawn(clock, ui, "back")
    await clock.settle()

    expect(await header(ui)).toContain("acme/app")
    expect(await header(ui)).not.toContain("Not this session's folder")
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Fix the menu")
  })

  test("/prs alone while a visit shows brings the pane forward with the visit still shown", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect((await runPrs($, "")).text).toBe("Opened the pull requests pane.")
    await clock.settle()

    expect(await header(ui)).toContain("acme/web")
    expect(await header(ui)).toContain("Not this session's folder")
  })

  test("Back names the folder's repository only where the whole row of buttons then fits; Repositories stays", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    // The row, each button 4 columns more than its label and a column between: "Back to acme/app", Repositories (as
    // wide as Loading… at least), Compact and Refresh need 61 of the 4 fewer than the pane's; plain Back 49.
    for (const [columns, back, pick] of [
      [50, "Back", "Repositories"],
      [64, "Back", "Repositories"],
      [65, "Back to acme/app", "Repositories"],
      [100, "Back to acme/app", "Repositories"]
    ] as const) {
      const ui = await mountPane($, "terminal", columns)
      expect([(await ui.find({ key: "back" }))?.props.label, (await ui.find({ key: "repo" }))?.props.label]).toEqual([
        back,
        pick
      ])
      await ui.unmount()
    }
  })

  test("a visit's header puts its buttons under the name where they don't fit beside it and the note", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    const ui = await mountPane($, "terminal", 95)
    expect((await ui.find({ key: "header" }))?.props.flexDirection).toBe("column")
    await ui.unmount()
  })

  test("Refresh on a visit reads its list again, and the folder's not", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const [app, web] = [listsOf(seen.runs, "acme/app"), listsOf(seen.runs, "acme/web")]

    await pressDrawn(clock, ui, "refresh")
    await clock.settle()

    expect(listsOf(seen.runs, "acme/web")).toBe(web + 1)
    expect(listsOf(seen.runs, "acme/app")).toBe(app)
  })

  test("the folder's checks go on while a visit shows, and its last look waits for its own list to show", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith()
    const seen = machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const looked = world.store?.[LOOK]
    const status = seen.statuses.at(-1)
    await runPrs($, "acme/web")
    await clock.settle()
    const asked = listsOf(seen.runs, "acme/app")

    await clock.advance(POLL_MS)

    expect(listsOf(seen.runs, "acme/app")).toBe(asked + 1)
    expect(seen.statuses.at(-1)).toBe(status)
    expect(world.store?.[LOOK]).toEqual(looked)

    // Closing the pane while the visit covers the folder's list is no look at it either.
    await runPrs($, "close")
    expect(world.store?.[LOOK]).toEqual(looked)
  })

  test("a pane the engine closed without a word ends the visit: /prs opens the folder's list", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith()
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    world.isPaneOpen = false
    expect((await runPrs($, "")).text).toBe("Opened the pull requests pane.")
    await clock.settle()

    expect(await header(await mountPane($, "terminal"))).not.toContain("Not this session's folder")
  })

  test("/prs demo ends a visit, and /prs with the folder's own repository is Back", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    expect(await header(ui)).toContain("Not this session's folder")

    await runPrs($, "demo")
    await clock.settle()
    await pressDrawn(clock, ui, "refresh")
    await clock.settle()
    expect(await header(ui)).not.toContain("Not this session's folder")

    await runPrs($, "acme/web")
    await clock.settle()
    expect(await header(ui)).toContain("Not this session's folder")
    expect((await runPrs($, "ACME/app")).text).toBe("Opened the pull requests pane.")
    await clock.settle()
    expect(await header(ui)).not.toContain("Not this session's folder")
  })

  test("sent over Remote Control, /prs owner/name prints that list once, with its own links, and starts no visit", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    const opens = seen.opens.length

    const printed = lines((await runPrs($, "acme/web", { kind: "bridge" })).text)

    expect(printed[0]).toMatch(/^\*\*\[acme\/web\]\(https:\/\/github\.com\/acme\/web\/pulls\)\*\*/)
    expect(printed.join("\n")).toContain("Checkout page")
    expect(seen.opens.length).toBe(opens)
    await runPrs($, "")
    await clock.settle()
    expect(await header(await mountPane($, "terminal"))).not.toContain("Not this session's folder")
  })

  test("sent over Remote Control, /prs with the folder's own repository prints the folder's list, its branch marked", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ branch: "fix/menu" }))
    await startSession($)
    await clock.settle()

    const printed = lines((await runPrs($, "acme/app", { kind: "bridge" })).text)

    expect(printed[0]).toMatch(HEADING)
    expect(printed.find((line) => line.includes("Fix the menu"))).toContain("●")
  })

  test("with no app attached, /prs owner/name prints that list too", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ surfaces: [] }))
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "acme/web")).text).toContain("Checkout page")
  })

  test("a reload keeps the visit, and its timer goes on", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith({ isPaneOpen: true }))
    const visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: null,
      folder: "acme/app",
      merged: [],
      tickets: null
    }
    keptOverReload(on, { snapshot: keptList(GITHUB), checkout: { branch: "main", head: "h", at: 0 }, visit })
    await startSession($)
    await clock.settle()
    const asked = listsOf(seen.runs, "acme/web")

    await clock.advance(POLL_MS)

    expect(listsOf(seen.runs, "acme/web")).toBe(asked + 1)
    const ui = await mountPane($, "terminal")
    expect(await header(ui)).toContain("Not this session's folder")
    expect((await ui.find({ key: "back" }))?.props.label).toBe("Back to acme/app")
  })

  test("a row merged on a visit just before a reload shows merged for the rest of its time, then goes", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith({ isPaneOpen: true })
    machine($, on, world)
    const merged = [
      { number: 12, title: "Checkout page", url: "https://github.com/acme/web/pull/12", base: "main", index: 0 }
    ].map((pull) => ({ ...pull, at: clock.now() - 5_000 }))
    const visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: null,
      folder: "acme/app",
      merged,
      tickets: null
    }
    keptOverReload(on, { snapshot: keptList(GITHUB), checkout: { branch: "main", head: "h", at: 0 }, visit })
    await startSession($)
    await clock.settle()
    const ui = await mountPane($, "terminal")
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Merged")

    // GitHub's search has caught up: #12 is no longer listed open.
    world.others = { "github.com/acme/web": { ...WEB, mine: [] } }
    await clock.advance(10_000)
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).not.toContain("Merged")
  })

  test("a reload during a press on a visit gives the visit's row its buttons back", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ isPaneOpen: true }))
    const visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: { ...keptList(WEB)!, repo: "acme/web", url: "https://github.com/acme/web" },
      problem: null,
      loadId: null,
      folder: "acme/app",
      merged: [],
      tickets: null
    }
    keptOverReload(on, {
      snapshot: keptList(GITHUB),
      checkout: { branch: "main", head: "h", at: 0 },
      visit,
      busy: { "github.com/acme/web#12": "Merging…" }
    })
    await startSession($)
    await clock.settle()

    const ui = await mountPane($, "terminal")
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-12" })))).not.toContain("Merging…")
  })

  for (const reason of ["clear", "resume"] as const) {
    test(`a ${reason} ends the visit's timer`, async ($, on) => {
      const clock = clockOf(on)
      on("session.end", async (_, e) => ({ sessionId: e.sessionId }))
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      await runPrs($, "acme/web")
      await clock.settle()

      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } })
      const asked = listsOf(seen.runs, "acme/web")
      await clock.advance(2 * POLL_MS)

      expect(listsOf(seen.runs, "acme/web")).toBe(asked)
    })
  }

  test("a folder that is no GitHub repository can still visit one", async ($, on) => {
    const clock = clockOf(on)
    machine(
      $,
      on,
      worldWith({
        repoViewFailure: "failed to run git: fatal: not a git repository (or any of the parent directories): .git"
      })
    )
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "acme/web")).text).toBe("Showing acme/web's pull requests.")
    await clock.settle()
    expect(wordsIn(drawnNodes(await (await mountPane($, "terminal")).find({ key: "panel-mine" })))).toContain(
      "Checkout page"
    )
  })

  test("what keeps a visit from starting is said, and the pane stays as it was", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    const opens = seen.opens.length

    expect((await runPrs($, "https://ghe.example.com/acme/web/pull/3")).text).toBe(
      "The GitHub CLI is not signed in to ghe.example.com. Run: gh auth login --hostname ghe.example.com"
    )
    expect((await runPrs($, "acme/secret")).text).toBe(
      "No access to acme/secret with your GitHub account, or it does not exist on GitHub."
    )
    expect(seen.opens.length).toBe(opens)
  })

  test("/prs says what it takes, and that a folder in no repository is none to visit", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith())
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "what now")).text).toBe(
      `/prs takes nothing, demo, close, report, tickets or a repository (owner/name, an address or a folder's path), not "what now".`
    )
    expect((await runPrs($, "~/web")).text).toBe("~/web is in no git repository: check the path.")
  })

  test(
    "on demand, before any load, /prs with the folder's own repository opens its list, and starts no visit",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, worldWith())
      await startSession($)
      await clock.settle()

      expect((await runPrs($, "acme/app")).text).toBe("Opened the pull requests pane.")
      await clock.settle()

      const ui = await mountPane($, "terminal")
      expect(await header(ui)).not.toContain("Not this session's folder")
      expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Fix the menu")
    }
  )

  test(
    "on demand, Back from a first /prs that visited loads the folder's list",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      await runPrs($, "acme/web")
      await clock.settle()
      const ui = await mountPane($, "terminal")

      await pressDrawn(clock, ui, "back")
      await clock.settle()

      expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Fix the menu")
    }
  )

  test("closing the pane while a visit shows keeps the folder's notes of what changed", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith()
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.github = { ...GITHUB, mine: [{ ...GITHUB.mine![0]!, ci: "FAILURE" }, GITHUB.mine![1]!] }
    await clock.advance(POLL_MS)
    expect(await ui.find({ key: "seen-1" })).not.toBe(undefined)

    await runPrs($, "acme/web")
    await clock.settle()
    await runPrs($, "close")
    await runPrs($, "")
    await clock.settle()

    expect(await ui.find({ key: "seen-1" })).not.toBe(undefined)
  })

  test("an app attaching after the pane went without a word ends the visit", async ($, on) => {
    const clock = clockOf(on)
    const world = worldWith()
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    world.isPaneOpen = false
    await $.session.attach({ surface: "desktop", clientId: "desktop:default" })
    await clock.settle()
    world.isPaneOpen = true

    expect(await header(await mountPane($, "terminal"))).not.toContain("Not this session's folder")
  })

  test("an address on another server gh is signed in to is visited there", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine(
      $,
      on,
      worldWith({ others: { "ghe.example.com/acme/web": WEB }, signedIn: ["github.com", "ghe.example.com"] })
    )
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "https://ghe.example.com/acme/web/pull/3")).text).toBe("Showing acme/web's pull requests.")
    await clock.settle()

    expect(
      seen.runs.some((line) => line.startsWith("gh api graphql --hostname ghe.example.com -f owner=acme -f name=web"))
    ).toBe(true)
    expect(wordsIn(drawnNodes(await (await mountPane($, "terminal")).find({ key: "panel-mine" })))).toContain(
      "Checkout page"
    )
  })

  test("a visit whose list can't be read names its repository and says why, with Retry", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ others: { "github.com/acme/web": { ...WEB, hasRepository: false } } }))
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect(await header(ui)).toContain("acme/web")
    expect(wordsIn(drawnNodes(await ui.find({ key: "problem" })))).toContain(
      "No access to acme/web with your GitHub account, or it does not exist on GitHub."
    )
    expect(await ui.find({ key: "retry" })).not.toBe(undefined)
  })

  test("where no pane is placed, /prs with the folder's own repository prints the folder's list, as /prs alone does", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ placesPanes: false }))
    await startSession($)
    await clock.settle()

    expect(lines((await runPrs($, "acme/app")).text)[0]).toMatch(HEADING)
  })

  test("sent over Remote Control, /prs with the folder's own repository opens the pane on the computer too", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    const opens = seen.opens.length

    await runPrs($, "acme/app", { kind: "bridge" })
    await clock.settle()

    expect(seen.opens.length).toBe(opens + 1)
  })

  test(
    "a word /prs doesn't take asks GitHub nothing, even before the folder's repository is known",
    { options: { refresh: "on-demand" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      const runs = seen.runs.length

      await runPrs($, "clsoe")

      expect(seen.runs.slice(runs).filter((line) => line.startsWith("gh "))).toEqual([])
    }
  )

  test("after a reload, Back names the folder's repository even before any load finds it", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ isPaneOpen: true, repoViewFailure: "error connecting to api.github.com" }))
    const visit = {
      repo: { host: "github.com", name: "acme/web" },
      snapshot: null,
      problem: null,
      loadId: null,
      folder: "acme/app",
      merged: [],
      tickets: null
    }
    keptOverReload(on, { visit })
    await startSession($)
    await clock.settle()

    expect((await (await mountPane($, "terminal")).find({ key: "back" }))?.props.label).toBe("Back to acme/app")
  })

  test("Back reads the folder's list again only where it is older than a check's interval", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, worldWith())
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const asked = listsOf(seen.runs, "acme/app")

    await pressDrawn(clock, ui, "back")
    await clock.settle()

    expect(listsOf(seen.runs, "acme/app")).toBe(asked)
  })

  test("pressing the desktop app's band, which counts the folder's pull requests, shows the folder's list", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ surfaces: ["desktop"] }))
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "desktop")

    await (await mountBand($, "desktop")).press({ key: "open-prs" })
    await clock.settle()

    expect(await header(ui)).not.toContain("Not this session's folder")
  })

  test("a repository GitHub now names as the folder's own is the folder's list, in the pane and sent from afar", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, worldWith({ renamed: { "github.com/acme/old-app": "github.com/acme/app" } }))
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "terminal")

    expect(lines((await runPrs($, "acme/old-app", { kind: "bridge" })).text)[0]).toMatch(HEADING)
    await clock.settle()
    expect(await header(ui)).not.toContain("Not this session's folder")

    await runPrs($, "acme/web")
    await clock.settle()
    expect((await runPrs($, "acme/old-app")).text).toBe("Opened the pull requests pane.")
    await clock.settle()
    expect(await header(ui)).not.toContain("Not this session's folder")
  })

  test(
    "Back reads the folder's list again where it is older than a check's interval",
    { options: { refresh: "while-open" } },
    async ($, on) => {
      const clock = clockOf(on)
      const seen = machine($, on, worldWith())
      await startSession($)
      await clock.settle()
      await runPrs($, "")
      await clock.settle()
      await runPrs($, "close")
      await clock.advance(2 * POLL_MS)
      await runPrs($, "acme/web")
      await clock.settle()
      const ui = await mountPane($, "terminal")
      const asked = listsOf(seen.runs, "acme/app")

      await pressDrawn(clock, ui, "back")
      await clock.settle()

      expect(listsOf(seen.runs, "acme/app")).toBe(asked + 1)
    }
  )
})
