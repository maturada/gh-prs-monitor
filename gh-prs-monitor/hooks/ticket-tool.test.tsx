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
