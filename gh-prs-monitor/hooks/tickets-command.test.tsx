// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine, MockClock, Mounted } from "claude-code/testing"

import { clockOf, drawnNodes, fieldKey, GITHUB, machine, mountPane, runPrs, startSession } from "./testing/world"
import type { Drawn, World } from "./testing/world"

const LINEAR = "https://linear.app/acme/issue/{key}"

// The pull request on fix/menu, its branch now naming a ticket.
const KEYED: World["github"] = {
  ...GITHUB,
  mine: [{ ...GITHUB.mine![0]!, headRefName: "feature/WEB-5761-menu" }, GITHUB.mine![1]!]
}

// A session in acme/app with the store holding `store`, and the pane `/prs tickets` opened, holding the keyboard.
async function ticketsPane(
  $: Engine,
  on: On,
  store: Record<string, unknown> = {}
): Promise<{ world: World; seen: ReturnType<typeof machine>; ui: Mounted<"terminal", "Pane">; clock: MockClock }> {
  const clock = clockOf(on)
  const world: World = { github: KEYED, branch: "main", uncommitted: 0, store }
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  expect((await runPrs($, "tickets")).text).toBe("Asking about ticket links in the pane.")
  const ui = await mountPane($, "terminal", 100, true)
  await clock.settle()

  return { world, seen, ui, clock }
}

function texts(nodes: Drawn[]): unknown[] {
  return nodes.filter((node) => node.type === "Text").map((node) => node.children?.[0])
}

function buttons(nodes: Drawn[]): unknown[] {
  return nodes.filter((node) => node.type === "Button").map((node) => node.props?.label)
}

async function typed(ui: Mounted<"terminal", "Pane">, clock: MockClock, text: string): Promise<Drawn[]> {
  await ui.input({ key: fieldKey(drawnNodes(await ui.drawn())), text })
  await clock.settle()

  return drawnNodes(await ui.drawn())
}

async function pressed(ui: Mounted<"terminal", "Pane">, clock: MockClock, label: string): Promise<Drawn[]> {
  const index = buttons(drawnNodes(await ui.drawn())).indexOf(label)
  expect(index).toBeGreaterThanOrEqual(0)
  await ui.press({ key: `answer-${index}` })
  await clock.settle()

  return drawnNodes(await ui.drawn())
}

describe("/prs tickets", () => {
  test("with nothing set up, it asks for a link to any ticket, in a field of its own", async ($, on) => {
    const { ui } = await ticketsPane($, on)
    const nodes = drawnNodes(await ui.drawn())

    expect(texts(nodes)).toEqual([
      "Ticket links",
      "acme/app",
      "No ticket links for acme/app yet. Paste a link to any ticket from its tracker, as copied from the browser.",
      "Its pull requests then link to their tickets, found by the key in their branch or title. The link is read here alone; nothing is sent anywhere.",
      "Esc cancels"
    ])
    // Its Enter says what it does, as its main button does, so no line under it repeats it.
    expect(nodes.find((node) => node.type === "Input")?.props).toMatchObject({
      label: "Ticket link",
      placeholder: "https://…",
      submitLabel: "Check"
    })
    expect(buttons(nodes)).toEqual(["Check the link", "Cancel"])
  })

  test("its field takes the keyboard, not its first button", async ($, on) => {
    const { ui } = await ticketsPane($, on)
    const nodes = drawnNodes(await ui.drawn())

    expect(nodes.find((node) => node.type === "Input")?.props?.autoFocus).toBe(true)
    expect(nodes.find((node) => node.type === "Button")?.props?.autoFocus).toBeUndefined()
  })

  // Typed at the prompt, the pane takes the keyboard as it opens, so a link pasted next goes in its field: a pane that
  // doesn't hold it can't move it to the field. /prs leaves it at the prompt.
  test("it opens the pane with the keyboard, for the link pasted next, where /prs leaves it at the prompt", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: KEYED, branch: "main", uncommitted: 0 }, clock)
    await startSession($)
    await clock.settle()

    await runPrs($, "")
    await runPrs($, "tickets")

    expect(seen.opens).toEqual([
      { id: "gh-prs-monitor", isTakingKeys: false },
      { id: "gh-prs-monitor", isTakingKeys: true }
    ])
  })

  test("an app that draws no field says to answer on the computer", async ($, on) => {
    await ticketsPane($, on)
    const phone = drawnNodes(await (await mountPane($, "mobile")).drawn())

    expect(phone.some((node) => node.type === "Input")).toBe(false)
    expect(texts(phone)).toContain("This app has no text field: answer on the computer.")
  })

  test("a link pasted shows what it would link from the list, and is saved for the repository", async ($, on) => {
    const { world, seen, ui, clock } = await ticketsPane($, on)

    const confirming = await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    expect(texts(confirming).slice(2, 4)).toEqual([
      "Tickets like WEB-5761 link to https://linear.app/acme/issue/WEB-5761. Save this for acme/app?",
      "#1 Fix the menu would link WEB-5761."
    ])
    expect(buttons(confirming)).toEqual(["Save", "Cancel"])

    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "WEB-": LINEAR })
    expect(seen.toasts.at(-1)).toBe("Ticket links saved for acme/app: tickets like WEB-5761 link to linear.app.")
    // Saved, the list is back.
    expect(await ui.find({ key: "pr-1" })).toBeDefined()
  })

  test("a link saved shows on its row at once", async ($, on) => {
    const { ui, clock } = await ticketsPane($, on)

    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    const list = await pressed(ui, clock, "Save")
    expect(
      list.some((node) => node.type === "Link" && node.props?.href === "https://linear.app/acme/issue/WEB-5761")
    ).toBe(true)
  })

  test("Check the link with nothing pasted asks again, without a reason", async ($, on) => {
    const { ui, clock } = await ticketsPane($, on)

    const again = await pressed(ui, clock, "Check the link")
    expect(texts(again)[3]).toBe(
      "Its pull requests then link to their tickets, found by the key in their branch or title. The link is read here alone; nothing is sent anywhere."
    )
    expect(again.some((node) => node.type === "Input")).toBe(true)
  })

  test("a link it can't read says why and asks again", async ($, on) => {
    const { ui, clock } = await ticketsPane($, on)

    expect(texts(await typed(ui, clock, "https://tracker.example.com/board?issue=WEB-5"))[3]).toBe(
      "That link names its ticket only in its query: open the ticket on its own page and paste that link."
    )
    expect(texts(await typed(ui, clock, "WEB-5761"))[3]).toBe(
      "That isn't a web link: paste one as copied from the browser's address bar."
    )
  })

  test("a link to the repository's GitHub says GitHub links its issues already", async ($, on) => {
    const { ui, clock } = await ticketsPane($, on)

    expect(texts(await typed(ui, clock, "https://github.com/acme/app/issues/12"))[3]).toBe(
      "GitHub links its own issues already, as #12 in a title or body: ticket links are for another tracker."
    )
  })

  test("a link for keys already set says what it replaces", async ($, on) => {
    const { world, ui, clock } = await ticketsPane($, on, {
      "tickets:github.com/acme/app": { "WEB-": "https://acme.atlassian.net/browse/{key}" }
    })

    await pressed(ui, clock, "Add a link")
    const confirming = await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    expect(texts(confirming)[2]).toBe(
      "Tickets like WEB-5761 link to https://linear.app/acme/issue/WEB-5761, in place of https://acme.atlassian.net/browse/WEB-5761. Save this for acme/app?"
    )
    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "WEB-": LINEAR })
  })

  test("a link with a number alone asks what its keys look like", async ($, on) => {
    const { world, ui, clock } = await ticketsPane($, on)

    const asking = await typed(ui, clock, "https://tracker.example.com/tickets/88")
    expect(texts(asking)[2]).toBe(
      "This link holds only the ticket's number, 88. Type how branches and titles write a ticket, for example ENG-88; where they write the number alone, ticket links can't find these tickets."
    )
    expect(texts(await typed(ui, clock, "the ENG project"))[3]).toBe(
      "That isn't a key: a prefix, then - or #, then a number, as ENG-12."
    )

    await typed(ui, clock, "ENG-12")
    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({
      "ENG-": "https://tracker.example.com/tickets/{number}"
    })
  })

  test("cancelled at the save, nothing is kept", async ($, on) => {
    const { world, seen, ui, clock } = await ticketsPane($, on)
    const toasts = seen.toasts.length

    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    await pressed(ui, clock, "Cancel")
    expect(world.store?.["tickets:github.com/acme/app"]).toBeUndefined()
    expect(seen.toasts).toHaveLength(toasts)
  })

  test("a link saved joins one another session saved meanwhile", async ($, on) => {
    const jira = "https://acme.atlassian.net/browse/{key}"
    const { world, ui, clock } = await ticketsPane($, on)

    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    world.store!["tickets:github.com/acme/app"] = { "OPS-": jira }
    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "OPS-": jira, "WEB-": LINEAR })
  })

  test("a link for keys set in another case takes their place", async ($, on) => {
    const { world, ui, clock } = await ticketsPane($, on, {
      "tickets:github.com/acme/app": { "web-": "https://tracker.example.com/issue/{key}" }
    })

    await pressed(ui, clock, "Add a link")
    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "WEB-": LINEAR })
  })

  test("a link the store refuses to keep says so", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      store: {},
      storeSetDeny: "the store is read-only",
      storeDenyPrefix: "tickets:"
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "tickets")
    const ui = await mountPane($, "terminal", 100, true)
    await clock.settle()

    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    await pressed(ui, clock, "Save")
    expect(seen.toasts.at(-1)).toMatch(/^Couldn't read or save the ticket links: /)
  })

  test("set up, it says what is set and how it reads", async ($, on) => {
    const { ui } = await ticketsPane($, on, { "tickets:github.com/acme/app": { "WEB-": LINEAR } })
    const summary = drawnNodes(await ui.drawn())

    expect(texts(summary).slice(1, 4)).toEqual([
      "acme/app",
      "Tickets like WEB-123 link to https://linear.app/acme/issue/WEB-123.",
      "Keys are read from the branch first, then the title, in upper or lower case. Now: #1 → WEB-5761; 2 pull requests without one. Shown on rows (Ticket links on rows, in /config)."
    ])
    expect(buttons(summary)).toEqual(["Add a link", "Remove", "Done"])
  })

  test("a link added joins those set", async ($, on) => {
    const youTrack = "https://acme.youtrack.cloud/issue/{key}"
    const { world, ui, clock } = await ticketsPane($, on, { "tickets:github.com/acme/app": { "MOB-": youTrack } })

    await pressed(ui, clock, "Add a link")
    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    await pressed(ui, clock, "Save")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "MOB-": youTrack, "WEB-": LINEAR })
  })

  test("removing the last link turns them off, so the skills don't ask about them again", async ($, on) => {
    const { world, seen, ui, clock } = await ticketsPane($, on, { "tickets:github.com/acme/app": { "WEB-": LINEAR } })

    const asking = await pressed(ui, clock, "Remove")
    expect(buttons(asking)).toEqual(["Remove WEB-", "Cancel"])
    await pressed(ui, clock, "Remove WEB-")
    expect(world.store?.["tickets:github.com/acme/app"]).toBe("off")
    expect(seen.toasts.at(-1)).toBe(
      "Removed the WEB- links for acme/app; none left, so Create PR won't ask about tickets here."
    )
  })

  test("removing one of two links keeps the other", async ($, on) => {
    const youTrack = "https://acme.youtrack.cloud/issue/{key}"
    const { world, seen, ui, clock } = await ticketsPane($, on, {
      "tickets:github.com/acme/app": { "WEB-": LINEAR, "MOB-": youTrack }
    })

    await pressed(ui, clock, "Remove")
    await pressed(ui, clock, "Remove WEB-")
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "MOB-": youTrack })
    expect(seen.toasts.at(-1)).toBe("Removed the WEB- links for acme/app.")
  })

  test("saved where rows don't show ticket links, it says so", { options: { showTickets: false } }, async ($, on) => {
    const { seen, ui, clock } = await ticketsPane($, on)

    await typed(ui, clock, "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")
    await pressed(ui, clock, "Save")
    expect(seen.toasts.at(-1)).toBe(
      "Ticket links saved for acme/app: tickets like WEB-5761 link to linear.app. Rows don't show them: Ticket links on rows is off, in /config."
    )
  })

  test("turned off, it asks for a link as with nothing set up", async ($, on) => {
    const { ui } = await ticketsPane($, on, { "tickets:github.com/acme/app": "off" })

    expect(texts(drawnNodes(await ui.drawn()))[2]).toBe(
      "No ticket links for acme/app; Create PR won't ask about tickets here. Paste a link to any ticket from its tracker, as copied from the browser."
    )
  })

  test("what the links find names three pull requests, and counts the rest", async ($, on) => {
    const clock = clockOf(on)
    const mine = [10, 20, 30, 40, 50].map((ticket, index) => ({
      number: index + 1,
      title: `Change ${ticket}`,
      headRefName: `feature/WEB-${ticket}`
    }))
    machine($, on, {
      github: { ...GITHUB, mine },
      branch: "main",
      uncommitted: 0,
      surfaces: [],
      store: { "tickets:github.com/acme/app": { "WEB-": LINEAR } }
    })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "tickets")).text).toContain(
      "Now: #1 → WEB-10, #2 → WEB-20, #3 → WEB-30 and 2 more; 1 pull request without one."
    )
  })

  // The mobile app draws no field to paste in, and the computer's pane may be out of reach.
  test("sent from a phone, it says what is set as text, though the phone draws the pane", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, { github: KEYED, branch: "main", uncommitted: 0, surfaces: ["terminal", "mobile"] })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "tickets", { kind: "bridge" })).text).toBe(
      "No ticket links for acme/app yet. Set them up with /prs tickets in the terminal, the desktop app or VS Code, by pasting a link to any ticket."
    )
  })

  // In the pane, as /prs opens it: the list loads in the pane, and the command waits for none of it.
  test("it answers at once, the list loading in the pane, and asks GitHub once, as /prs does", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: KEYED, branch: "main", uncommitted: 0 }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    const before = seen.runs.length
    world.slowGithubMs = 20_000

    let answer: string | undefined
    const ran = runPrs($, "tickets").then((result) => (answer = result.text))
    await clock.settle()

    expect(answer).toBe("Asking about ticket links in the pane.")
    await clock.advance(30_000)
    await ran
    expect(
      seen.runs.slice(before).filter((line) => line.startsWith("gh api graphql") && line.includes("$mine"))
    ).toHaveLength(1)
  })

  test("in a folder without a GitHub repository, its answer says why, and no pane opens", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "failed to run git: fatal: not a git repository (or any of the parent directories): .git"
    })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "tickets")).text).toBe("This folder is not a git repository, so it has no GitHub project.")
    expect(seen.opens).toEqual([])
  })

  // The first load still under way as it comes finds no repository: the command's reads don't see that load's problem,
  // so it loads once more to say why.
  test("as a session's first prompt in a folder without a GitHub repository, its answer says why", async ($, on) => {
    const clock = clockOf(on)
    machine(
      $,
      on,
      {
        github: KEYED,
        branch: "main",
        uncommitted: 0,
        slowRepoViewMs: 2_000,
        repoViewFailure: "failed to run git: fatal: not a git repository (or any of the parent directories): .git"
      },
      clock
    )
    await startSession($)

    const ran = runPrs($, "tickets")
    await clock.advance(10_000)

    expect((await ran).text).toBe("This folder is not a git repository, so it has no GitHub project.")
  })

  // A first load a problem stopped is looked at again, as /prs looks: the person may have just put it right.
  test("as a session's first prompt after a problem stopped the first load, it looks again, as /prs does", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine(
      $,
      on,
      {
        github: KEYED,
        branch: "main",
        uncommitted: 0,
        slowRepoViewMs: 2_000,
        graphqlFailure: { stdout: "", stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/app'." }
      },
      clock
    )
    await startSession($)

    const ran = runPrs($, "tickets")
    await clock.advance(5_000)
    await ran

    expect(seen.runs.filter((line) => line.startsWith("gh api graphql") && line.includes("$mine"))).toHaveLength(2)
  })

  // Sent from afar before any load found the repository: the load that finds it is the one the answer reads.
  test("sent over Remote Control before a load found the repository, it loads once to answer", async ($, on) => {
    const clock = clockOf(on)
    const world: World = {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      repoViewFailure: "error connecting to api.github.com"
    }
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    world.repoViewFailure = undefined
    const before = seen.runs.length

    expect((await runPrs($, "tickets", { kind: "bridge" })).text).toContain("No ticket links for acme/app yet.")
    expect(
      seen.runs.slice(before).filter((line) => line.startsWith("gh api graphql") && line.includes("$mine"))
    ).toHaveLength(1)
  })

  // So early that the session's first load hasn't named the repository yet: the command waits for it, then asks.
  test("as a session's first prompt, before the repository is known, it waits for it, then asks in the pane", async ($, on) => {
    const clock = clockOf(on)
    const seen = machine($, on, { github: KEYED, branch: "main", uncommitted: 0, slowRepoViewMs: 2_000 }, clock)
    await startSession($)

    const ran = runPrs($, "tickets")
    await clock.advance(5_000)

    expect((await ran).text).toBe("Asking about ticket links in the pane.")
    expect(seen.opens).toEqual([{ id: "gh-prs-monitor", isTakingKeys: true }])
    // The first load's list is the pane's: opening it loads no other.
    expect(seen.runs.filter((line) => line.startsWith("gh api graphql") && line.includes("$mine"))).toHaveLength(1)
  })

  test("as a session's first prompt, it says what the links find once the first list is in", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      store: { "tickets:github.com/acme/app": { "WEB-": LINEAR } }
    })
    await startSession($)

    expect((await runPrs($, "tickets")).text).toBe("Asking about ticket links in the pane.")
    const ui = await mountPane($, "terminal", 100, true)
    await clock.settle()
    expect(texts(drawnNodes(await ui.drawn()))[3]).toBe(
      "Keys are read from the branch first, then the title, in upper or lower case. Now: #1 → WEB-5761; 2 pull requests without one. Shown on rows (Ticket links on rows, in /config)."
    )
  })

  // As a session's first prompt where no pane draws: the list is still loading, so it waits for it rather than say none
  // is listed, as the printed /prs does.
  test("run while the first list loads, it waits for it, to say what the links find in it", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      surfaces: [],
      store: { "tickets:github.com/acme/app": { "WEB-": LINEAR } }
    })
    await startSession($)

    const ran = runPrs($, "tickets")
    await clock.settle()
    expect((await ran).text).toContain("Now: #1 → WEB-5761; 2 pull requests without one.")
  })

  test("where no pane draws, it says what is set as text, and where to change it", async ($, on) => {
    const clock = clockOf(on)
    machine($, on, {
      github: KEYED,
      branch: "main",
      uncommitted: 0,
      surfaces: [],
      store: { "tickets:github.com/acme/app": { "WEB-": LINEAR } }
    })
    await startSession($)
    await clock.settle()

    expect((await runPrs($, "tickets")).text).toBe(
      "Ticket links for acme/app: tickets like WEB-123 link to https://linear.app/acme/issue/WEB-123. Keys are read from the branch first, then the title, in upper or lower case. Now: #1 → WEB-5761; 2 pull requests without one. Change them with /prs tickets in the terminal, the desktop app or VS Code."
    )
  })
})
