// Author: David Matura

import type { Engine } from "claude-code/testing"
import { describe, expect, test } from "claude-code/testing"

import { clockOf, drawnNodes, GITHUB, machine, mountPane, startSession } from "./testing/world"
import type { World } from "./testing/world"

const TOOL = "mcp__gh-prs-monitor__ticket_links"
const LINEAR = "https://linear.app/acme/issue/{key}"
const LINKED = { "tickets:github.com/acme/app": { "WEB-": LINEAR } }

// The pull request on fix/menu, its branch now naming a ticket.
const KEYED: World["github"] = {
  ...GITHUB,
  mine: [{ ...GITHUB.mine![0]!, headRefName: "feature/WEB-5761-menu" }, GITHUB.mine![1]!]
}

function call($: Engine, input: object): Promise<{ result?: unknown; deny?: string }> {
  return $.tool.call({ tool: TOOL, repo: "github.com/acme/app", ...input } as never) as never
}

async function sessionWith($: Engine, on: Parameters<typeof clockOf>[0], store: Record<string, unknown>) {
  const clock = clockOf(on)
  const world: World = { github: KEYED, branch: "main", uncommitted: 0, store }
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()

  return { world, seen, clock }
}

describe("the skills' ticket tool", () => {
  test("is a tool of the plugin's; set up, it gives the ticket a branch or title names, as rows find it", async ($, on) => {
    const { seen } = await sessionWith($, on, LINKED)

    expect(seen.tools).toContain(TOOL)
    expect(
      JSON.parse(String((await call($, { branch: "feature/WEB-5761-menu", title: "Fix the menu" })).result))
    ).toEqual({ key: "WEB-5761", url: "https://linear.app/acme/issue/WEB-5761" })
    expect((await call($, { branch: "fix/menu", title: "Fix the menu" })).result).toBe("none")
  })

  test("a key gives its link, in the case it was saved in", async ($, on) => {
    await sessionWith($, on, LINKED)

    expect(JSON.parse(String((await call($, { key: "web-12" })).result))).toEqual({
      key: "WEB-12",
      url: "https://linear.app/acme/issue/WEB-12"
    })
    expect((await call($, { key: "OPS-1" })).result).toBe("none")
  })

  test("not set up, a branch naming a key-like word says so, for Create PR's one ask", async ($, on) => {
    await sessionWith($, on, {})

    expect(JSON.parse(String((await call($, { branch: "david/web-5785-fix-login" })).result))).toEqual({
      unset: "WEB-5785"
    })
    expect((await call($, { branch: "fix/utf-8-names" })).result).toBe("none")
  })

  test("turned off, there is none, and nothing is asked", async ($, on) => {
    await sessionWith($, on, { "tickets:github.com/acme/app": "off" })

    expect((await call($, { branch: "feature/WEB-5761-menu" })).result).toBe("none")
  })

  test("a link saved joins the repository's links, shows on its rows at once, and gives the pull request's ticket", async ($, on) => {
    const jira = "https://acme.atlassian.net/browse/{key}"
    const { world, clock } = await sessionWith($, on, { "tickets:github.com/acme/app": { "OPS-": jira } })
    world.answer = "Save"

    const saved = await call($, {
      branch: "feature/WEB-5761-menu",
      save: "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll"
    })

    expect(JSON.parse(String(saved.result))).toEqual({
      saved: "WEB-",
      key: "WEB-5761",
      url: "https://linear.app/acme/issue/WEB-5761"
    })
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "OPS-": jira, "WEB-": LINEAR })
    const ui = await mountPane($, "terminal")
    await clock.settle()
    expect(
      drawnNodes(await ui.drawn()).some(
        (node) => node.type === "Link" && node.props?.href === "https://linear.app/acme/issue/WEB-5761"
      )
    ).toBe(true)
  })

  // The call may come from text the model read rather than from the person: Claude Code's own dialog, which the person
  // alone answers, says a skill asks, shows what the link would make, and nothing is kept until they save it.
  test("a link is saved only once the person saves it in Claude Code's dialog, which says a skill asks", async ($, on) => {
    const { world } = await sessionWith($, on, {})
    world.answer = "Cancel"

    expect((await call($, { save: "https://linear.app/acme/issue/WEB-5761/fix-chat-scroll" })).deny).toBe(
      "Not saved: the user didn't save the link in the dialog."
    )
    expect(world.question).toBe(
      "acme/app — A skill asks to keep a ticket link. Tickets like WEB-5761 link to https://linear.app/acme/issue/WEB-5761. Save this for acme/app? #1 Fix the menu would link WEB-5761."
    )
    expect(world.choices).toEqual(["Save", "Cancel"])
    expect(world.store?.["tickets:github.com/acme/app"]).toBeUndefined()
  })

  test("a dialog dismissed keeps nothing", async ($, on) => {
    const { world } = await sessionWith($, on, {})

    expect((await call($, { save: "https://linear.app/acme/issue/WEB-5761" })).deny).toBe(
      "Not saved: the user didn't save the link in the dialog."
    )
    expect(world.store?.["tickets:github.com/acme/app"]).toBeUndefined()
  })

  // Text the model read could ask again and again: once the person says no, the session asks no more there.
  test("once the person doesn't save one, the session asks about none again for the repository", async ($, on) => {
    const { world } = await sessionWith($, on, {})
    world.answer = "Cancel"
    await call($, { save: "https://linear.app/acme/issue/WEB-5761" })
    world.answer = "Save"

    expect((await call($, { save: "https://tracker.example.com/issue/WEB-1" })).deny).toBe(
      "Not saved: the user didn't save a ticket link here in this session; /prs tickets sets them up."
    )
    expect(world.asked).toBe(1)
    expect(world.store?.["tickets:github.com/acme/app"]).toBeUndefined()
  })

  test("a link too long to be a ticket's is refused, and nothing is asked", async ($, on) => {
    const { world } = await sessionWith($, on, {})
    world.answer = "Save"

    expect((await call($, { save: `https://linear.app/acme/issue/WEB-1/${"x".repeat(2100)}` })).deny).toBe(
      "That link is too long to be a ticket's link."
    )
    expect(world.asked).toBeUndefined()
  })

  test("a link for keys set up already shows the address it would replace, which stays unless saved", async ($, on) => {
    const { world } = await sessionWith($, on, LINKED)

    expect((await call($, { save: "https://tracker.example.com/issue/WEB-1" })).deny).toBe(
      "Not saved: the user didn't save the link in the dialog."
    )
    expect(world.question).toContain(
      "Tickets like WEB-1 link to https://tracker.example.com/issue/WEB-1, in place of https://linear.app/acme/issue/WEB-1."
    )
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "WEB-": LINEAR })
  })

  // A tool's hook has its own time bounded, and a load isn't the engine's call to wait on: the list as it stands.
  test("asked while the first list still loads, it asks at once", async ($, on) => {
    const clock = clockOf(on)
    const world: World = { github: KEYED, branch: "main", uncommitted: 0, store: {}, slowGithubMs: 20_000 }
    machine($, on, world, clock)
    await startSession($)
    // The repository named, its list still on the way.
    await clock.settle()

    let answer: string | undefined
    const called = call($, { save: "https://linear.app/acme/issue/WEB-5761" }).then((result) => (answer = result.deny))
    await clock.settle()

    expect(answer).toBe("Not saved: the user didn't save the link in the dialog.")
    expect(world.question).toContain("No pull request listed now names a WEB- ticket")
    await clock.advance(30_000)
    await called
  })

  test("another repository than the session's is refused, and nothing is asked", async ($, on) => {
    const { world } = await sessionWith($, on, {})
    world.answer = "Save"

    expect((await call($, { repo: "github.com/acme/other", save: "https://linear.app/acme/issue/WEB-1" })).deny).toBe(
      "Ticket links are saved for this session's repository alone, acme/app."
    )
    expect((await call($, { repo: "github.com/acme/other", save: "off" })).deny).toBe(
      "Ticket links are saved for this session's repository alone, acme/app."
    )
    expect(world.asked).toBeUndefined()
    expect(world.store?.["tickets:github.com/acme/other"]).toBeUndefined()
  })

  test("a link it can't use is refused with why, and keeps nothing", async ($, on) => {
    const { world } = await sessionWith($, on, {})

    expect((await call($, { save: "https://github.com/acme/app/issues/3" })).deny).toBe(
      "GitHub links its own issues already, as #12 in a title or body: ticket links are for another tracker."
    )
    expect((await call($, { save: "https://tracker.example.com/tickets/88" })).deny).toBe(
      "That link holds only the ticket's number: /prs tickets sets such a tracker up, asking how its keys are written."
    )
    expect(world.store?.["tickets:github.com/acme/app"]).toBeUndefined()
  })

  test("off keeps the no, so Create PR doesn't ask again", async ($, on) => {
    const { world } = await sessionWith($, on, {})

    expect((await call($, { save: "off" })).result).toBe(
      "Ticket links are off for acme/app: Create PR won't ask about them there again; /prs tickets sets them up."
    )
    expect(world.store?.["tickets:github.com/acme/app"]).toBe("off")
  })

  test("off leaves links already set up: a no there is about this pull request alone", async ($, on) => {
    const { world } = await sessionWith($, on, LINKED)

    expect((await call($, { save: "off" })).result).toBe(
      "Ticket links stay set up for acme/app: /prs tickets removes them."
    )
    expect(world.store?.["tickets:github.com/acme/app"]).toEqual({ "WEB-": LINEAR })
  })

  test("a repository not named as <host>/<owner>/<name> is refused", async ($, on) => {
    await sessionWith($, on, LINKED)

    expect((await call($, { repo: "acme/app", branch: "x" })).deny).toBe(
      "repo names the repository as <host>/<owner>/<name>, as github.com/acme/app."
    )
  })

  test("a store that fails is a refusal the skill goes on without", async ($, on) => {
    const { world } = await sessionWith($, on, {})
    world.storeSetDeny = "the store is read-only"

    expect((await call($, { save: "off" })).deny).toMatch(/^The ticket links could not be read or kept: /)
  })
})
