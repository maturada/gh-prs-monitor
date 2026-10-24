// Author: David Matura

import type { On } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"

import type { ResponseFixture } from "./testing/fixtures"
import {
  clockOf,
  drawnNodes,
  GITHUB,
  machine,
  mountPane,
  pressDrawn,
  runPrs,
  skillTurnEnd,
  skillTurnStart,
  startSession,
  // TBD: with `#` in the prompt, off for now.
  // typeahead,
  wordsIn
} from "./testing/world"
import { gitConfigOf } from "./testing/git-config"
import type { World } from "./testing/world"

// acme/web: your #12, approved, its branch naming a ticket; a draft of yours, #14; and #3 to review. The folder's list
// (acme/app) has a #12 of its own, its head on another commit.
const WEB: ResponseFixture = {
  mine: [
    { number: 12, title: "Checkout page", reviewDecision: "APPROVED", headRefName: "feature/WEB-12-checkout" },
    { number: 14, title: "Gift cards", isDraft: true }
  ],
  requested: [{ number: 3, title: "Search box", author: "ann" }]
}
const APP: ResponseFixture = {
  ...GITHUB,
  mine: [...GITHUB.mine!, { number: 12, title: "Folder's own twelve", reviewDecision: "APPROVED" }]
}

function worldWith(overrides: Partial<World> = {}): World {
  return { github: APP, others: { "github.com/acme/web": WEB }, branch: "main", uncommitted: 0, ...overrides }
}

// A session in the folder's repository visiting acme/web, its pane drawn in the terminal.
async function visiting($: Engine, on: On, world: World) {
  const clock = clockOf(on)
  const seen = machine($, on, world, clock)
  await startSession($)
  await clock.settle()
  await runPrs($, "acme/web")
  await clock.settle()
  const ui = await mountPane($, "terminal")

  return { clock, seen, ui }
}

// Each other write a visit's row offers: its row, the answer that goes on, and the gh run it makes on acme/web.
const WRITES: { key: string; pull: ResponseFixture; answer: string; run: string; world?: Partial<World> }[] = [
  {
    key: "autoMerge-12",
    pull: {
      merging: { autoMerge: true },
      mine: [{ number: 12, title: "Checkout page", reviewDecision: "APPROVED", ci: "PENDING" }]
    },
    answer: "Create a merge commit",
    run: "gh pr merge 12 --repo github.com/acme/web --merge --match-head-commit head-12 --auto"
  },
  {
    key: "updateBranch-12",
    pull: { mine: [{ number: 12, title: "Checkout page", reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }] },
    answer: "Rebase onto main",
    run: "gh pr update-branch 12 --repo github.com/acme/web --rebase"
  },
  {
    key: "rerun-12",
    pull: { mine: [{ number: 12, title: "Checkout page", ci: "FAILURE" }] },
    answer: "Re-run failed jobs",
    run: "gh run rerun 11 --failed --repo github.com/acme/web",
    world: { suites: [{ conclusion: "FAILURE", workflowRun: { databaseId: 11, workflow: { name: "CI" } } }] }
  },
  {
    key: "rerequest-12",
    pull: {
      mine: [
        {
          number: 12,
          title: "Checkout page",
          reviewDecision: "CHANGES_REQUESTED",
          reviews: [{ login: "ann", state: "CHANGES_REQUESTED", at: "2026-10-07T13:20:00Z", commit: "old" }]
        }
      ]
    },
    answer: "Re-request review",
    run: "gh api --method POST repos/acme/web/pulls/12/requested_reviewers --hostname github.com -f reviewers[]=ann"
  }
]

describe("presses on a visit", () => {
  for (const write of WRITES) {
    test(`${write.key.split("-")[0]} on a visit writes to its repository`, async ($, on) => {
      const world = worldWith({ others: { "github.com/acme/web": write.pull }, answer: write.answer, ...write.world })
      const { clock, seen, ui } = await visiting($, on, world)

      await pressDrawn(clock, ui, write.key)
      await clock.settle()

      expect(seen.runs).toContain(write.run)
      expect(seen.runs.filter((line) => line.includes("acme/app") && /^gh (pr|run) |--method/.test(line))).toEqual([])
    })
  }

  test("a question on the folder's #12 answered in Claude Code's own dialog after a visit started writes to the folder's #12, as it named", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge", slowDialogMs: 5_000 })
    const clock = clockOf(on)
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    // Behind another pane, the question goes to Claude Code's own dialog, which /prs leaves open.
    world.isPaneBehind = true

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    expect(world.question).toContain("Folder's own twelve")
    await runPrs($, "acme/web")
    await clock.settle()
    await clock.advance(5_000)
    await clock.settle()

    expect(seen.runs.filter((line) => line.startsWith("gh pr merge "))).toEqual([
      expect.stringContaining("--repo github.com/acme/app")
    ])
  })

  test("a question in the pane on the folder's #12 is given up as /prs shows another repository, nothing merged", async ($, on) => {
    const world = worldWith({})
    const clock = clockOf(on)
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    expect(world.subject).toBe("#12 Folder's own twelve")

    await runPrs($, "acme/web")
    await clock.settle()

    expect(await ui.find({ key: "answer-0" })).toBeUndefined()
    expect(await ui.find({ type: "Link", text: "acme/web" })).toBeDefined()
    expect(seen.runs.filter((line) => line.startsWith("gh pr merge "))).toEqual([])
  })

  test("a press on a visit that ends before its question asks nothing", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge", slowPullMs: 5_000 })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    await pressDrawn(clock, ui, "back")
    await clock.settle()
    await clock.advance(5_000)
    await clock.settle()

    expect(world.asked).toBeUndefined()
    expect(seen.runs.filter((line) => line.startsWith("gh pr merge "))).toEqual([])
  })

  test("a stale stop on a visit's row, merged meanwhile, shows it merged there and drops no row of the folder's", async ($, on) => {
    const world = worldWith({ currentIn: { "github.com/acme/web": { 12: { state: "merged" } } } })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()

    expect(seen.toasts.at(-1)).toContain("acme/web#12")
    expect(world.asked).toBeUndefined()
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Merged")
    await pressDrawn(clock, ui, "back")
    await clock.settle()
    const folder = wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))
    expect(folder).toContain("Folder's own twelve")
    expect(folder).not.toContain("Merged")
  })

  test("a merge on the folder's #12 hides no row of a visit", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge" })
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "back")
    await clock.settle()
    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Merged")
    await runPrs($, "acme/web")
    await clock.settle()

    const visit = wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))
    expect(visit).toContain("Checkout page")
    expect(visit).not.toContain("Merged")
  })

  test("a visit's Refresh after the folder was drawn reads the visit; the folder's buttons after Back act on the folder", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge" })
    const { clock, seen, ui } = await visiting($, on, world)
    const lists = (name: string) =>
      seen.runs.filter((line) => line.includes(`-f name=${name}`) && line.includes("$mine")).length

    await pressDrawn(clock, ui, "back")
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const [web, app] = [lists("web"), lists("app")]
    await pressDrawn(clock, ui, "refresh")
    await clock.settle()
    expect([lists("web"), lists("app")]).toEqual([web + 1, app])

    await pressDrawn(clock, ui, "back")
    await clock.settle()
    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    expect(seen.runs.filter((line) => line.startsWith("gh pr merge "))).toEqual([
      expect.stringContaining("--repo github.com/acme/app")
    ])
  })
  test("a visit's rows show their buttons and ticket links, and its questions name owner/name#12", async ($, on) => {
    const world = worldWith({
      store: { "tickets:github.com/acme/web": { "WEB-": "https://linear.app/acme/issue/{key}" } }
    })
    const { clock, ui } = await visiting($, on, world)

    expect(await ui.find({ key: "merge-12" })).not.toBe(undefined)
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-12" })))).toContain("WEB-12")

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()

    expect(world.subject).toBe("acme/web#12 Checkout page")
  })

  test("Merge and Ready For Review on a visit write to its repository, and nothing of the folder's", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge" })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    world.answer = "Mark ready for review"
    await pressDrawn(clock, ui, "ready-14")
    await clock.settle()

    const writes = seen.runs.filter((line) => /^gh pr (merge|ready) /.test(line))
    expect(writes).toHaveLength(2)
    expect(writes.every((line) => line.includes("acme/web"))).toBe(true)
  })

  test("a merge on the visit's #12 hides that row only; the folder's #12 stays after Back", async ($, on) => {
    const world = worldWith({ answer: "Squash and merge" })
    // Claude Code's own rows for the prompt box: none.
    on("prompt.autocomplete", () => ({ suggestions: [] }))
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Merged")
    // GitHub's search lists it open a while longer: a Refresh now still shows it merged, with no buttons, and `#`
    // offers it no more.
    await pressDrawn(clock, ui, "refresh")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).toContain("Merged")
    expect(await ui.find({ key: "merge-12" })).toBe(undefined)
    // TBD: with `#` in the prompt, off for now (register.tsx's `prompt.autocomplete`).
    // expect(await typeahead($, "see #12")).not.toContain("acme/web#12 Checkout page")

    await pressDrawn(clock, ui, "back")
    await clock.settle()
    const folder = wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))
    expect(folder).toContain("Folder's own twelve")
    expect(folder).not.toContain("Merged")
  })

  test("a press on the visit's #12 keeps the folder's #12 note, and marks no row of the folder's", async ($, on) => {
    const world = worldWith()
    const marked: string[] = []
    on("state.set", { plugin: "gh-prs-monitor", key: "busy" }, async (_, e, next) => {
      marked.push(...Object.keys((e.value ?? {}) as object))
      return next(e)
    })
    const clock = clockOf(on)
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    world.github = { ...APP, mine: APP.mine!.map((pull) => (pull.number === 12 ? { ...pull, ci: "FAILURE" } : pull)) }
    await clock.advance(3 * 60_000)
    expect(await ui.find({ key: "seen-12" })).not.toBe(undefined)

    await runPrs($, "acme/web")
    await clock.settle()
    world.answer = "Cancel"
    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    await pressDrawn(clock, ui, "back")
    await clock.settle()

    expect(marked).toContain("github.com/acme/web#12")
    expect(marked).not.toContain("12")
    expect(await ui.find({ key: "seen-12" })).not.toBe(undefined)
  })

  test("visit acme/web, then acme/admin: a button of the second acts on the second", async ($, on) => {
    const world = worldWith({
      answer: "Squash and merge",
      others: {
        "github.com/acme/web": WEB,
        "github.com/acme/admin": { mine: [{ number: 12, title: "Roles page", reviewDecision: "APPROVED" }] }
      }
    })
    const { clock, seen, ui } = await visiting($, on, world)

    await runPrs($, "acme/admin")
    await clock.settle()
    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()

    const merges = seen.runs.filter((line) => line.startsWith("gh pr merge "))
    expect(merges).toHaveLength(1)
    expect(merges[0]).toContain("acme/admin")
  })

  test("a write on a visit left for another meanwhile reads the visit it was made on, not the one shown", async ($, on) => {
    const world = worldWith({
      answer: "Squash and merge",
      slowDialogMs: 5_000,
      others: {
        "github.com/acme/web": WEB,
        "github.com/acme/admin": { mine: [{ number: 7, title: "Roles page" }] }
      }
    })
    const { clock, seen, ui } = await visiting($, on, world)
    const admin = () =>
      seen.runs.filter((line) => line.includes("-f owner=acme -f name=admin") && line.includes("$mine"))
    // Behind another pane, the question goes to Claude Code's own dialog, which /prs leaves open.
    world.isPaneBehind = true

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    await runPrs($, "acme/admin")
    await clock.settle()
    const asked = admin().length
    await clock.advance(5_000)
    await clock.settle()

    // The merged row's refresh, once GitHub's search has caught up, too.
    await clock.advance(16_000)

    expect(seen.runs.filter((line) => line.startsWith("gh pr merge "))).toEqual([expect.stringContaining("acme/web")])
    expect(admin()).toHaveLength(asked)
    expect(wordsIn(drawnNodes(await ui.find({ key: "panel-mine" })))).not.toContain("Merged")
  })

  test("two presses on a visit's row before it is drawn again ask once", async ($, on) => {
    const world = worldWith({ answer: "Cancel", slowDialogMs: 5_000 })
    // The button's own handler runs twice at once for one press, as for two presses that reach the plugin together.
    on("ui.press", async ($, e, next) => {
      const [first] = await Promise.all([next(e), next(e)])
      return first
    })
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "merge-12")
    await clock.settle()
    await clock.advance(10_000)

    expect(world.asked).toBe(1)
  })

  // acme/web cloned at ~/code/web, as a session there noted it; its #12 failing CI, its comments and conflicts open.
  const CLONED: Partial<World> = {
    others: {
      "github.com/acme/web": {
        mine: [
          {
            number: 12,
            title: "Checkout page",
            ci: "FAILURE",
            mergeable: "CONFLICTING",
            threads: [{ isResolved: false, isOutdated: false }]
          }
        ]
      }
    },
    store: {
      clones: [{ root: "/Users/me/code/web", repo: { host: "github.com", name: "acme/web" }, at: 1 }]
    },
    gitConfigs: { "/Users/me/code/web": gitConfigOf({ origin: "git@github.com:acme/web.git" }) }
  }

  for (const [surface, link] of [
    [
      "terminal",
      `claude-cli://open?cwd=${encodeURIComponent("/Users/me/code/web")}&q=${encodeURIComponent("/prs acme/web")}`
    ],
    [
      "desktop",
      `claude://code/new?folder=${encodeURIComponent("/Users/me/code/web")}&q=${encodeURIComponent("/prs acme/web")}`
    ]
  ] as const) {
    test(`on a visit, a branch skill offers Open its clone: a new session there, /prs typed in (${surface})`, async ($, on) => {
      const world = worldWith({ ...CLONED, answer: "New Session in ~/code/web" })
      const clock = clockOf(on)
      const seen = machine($, on, world, clock)
      await startSession($)
      await clock.settle()
      await runPrs($, "acme/web")
      await clock.settle()
      const ui = await mountPane($, surface)
      const runs = seen.runs.length

      await pressDrawn(clock, ui, "fixCi-12")
      await clock.settle()

      expect(world.choices).toEqual(["New Session in ~/code/web", "Cancel"])
      expect(seen.runs.slice(runs).filter((line) => line.startsWith("open "))).toEqual([`open ${link}`])
      expect(seen.runs.slice(runs).filter((line) => / (switch|worktree|fetch|checkout) /.test(line))).toEqual([])
      expect(seen.commands).toEqual([])
      expect(seen.toasts.at(-1)).toBe(
        "acme/web#12: a new session in ~/code/web has /prs acme/web typed in; send it there"
      )
    })
  }

  test("on a visit, Cancel opens nothing, and the row's buttons come back", async ($, on) => {
    const world = worldWith({ ...CLONED, answer: "Cancel" })
    const { clock, seen, ui } = await visiting($, on, world)
    const runs = seen.runs.length

    await pressDrawn(clock, ui, "fixCi-12")
    await clock.settle()

    expect(seen.runs.slice(runs).filter((line) => line.startsWith("open "))).toEqual([])
    expect(await ui.find({ key: "fixCi-12" })).toBeDefined()
  })

  test("on a visit, the clone offered is the visited repository's, never another's noted later", async ($, on) => {
    const world = worldWith({
      ...CLONED,
      answer: "Cancel",
      store: {
        clones: [
          { root: "/Users/me/code/admin", repo: { host: "github.com", name: "acme/admin" }, at: 2 },
          { root: "/Users/me/code/web", repo: { host: "github.com", name: "acme/web" }, at: 1 }
        ]
      },
      gitConfigs: {
        "/Users/me/code/web": gitConfigOf({ origin: "git@github.com:acme/web.git" }),
        "/Users/me/code/admin": gitConfigOf({ origin: "git@github.com:acme/admin.git" })
      }
    })
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "fixCi-12")
    await clock.settle()

    expect(world.choices).toEqual(["New Session in ~/code/web", "Cancel"])
  })

  test("on a visit, a clone whose path has spaces opens there", async ($, on) => {
    const root = "/Users/me/My Code/web"
    const world = worldWith({
      ...CLONED,
      answer: "New Session in ~/My Code/web",
      store: {
        clones: [{ root, repo: { host: "github.com", name: "acme/web" }, at: 1 }]
      },
      gitConfigs: { [root]: gitConfigOf({ origin: "git@github.com:acme/web.git" }) }
    })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "fixCi-12")
    await clock.settle()

    expect(seen.runs).toContain(
      `open claude-cli://open?cwd=${encodeURIComponent(root)}&q=${encodeURIComponent("/prs acme/web")}`
    )
  })

  test("on a visit in VS Code, which opens no folder from a link, a branch skill names the folder to open", async ($, on) => {
    const world = worldWith({ ...CLONED, answer: "OK" })
    const clock = clockOf(on)
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    const ui = await mountPane($, "vscode")
    const runs = seen.runs.length

    await pressDrawn(clock, ui, "resolve-12")
    await clock.settle()

    expect(world.question).toMatch(
      /^Its review comments on \S+ get resolved in your clone of acme\/web at ~\/code\/web, not in this session's folder\.$/
    )
    expect(world.detail).toBe(
      "Open that folder in a new window, run /prs acme/web in Claude Code there, then press Resolve Comments on #12."
    )
    expect(world.choices).toEqual(["OK"])
    expect(seen.runs.slice(runs).filter((line) => /^open |^git (switch|worktree|fetch|checkout) /.test(line))).toEqual(
      []
    )
    expect(seen.commands).toEqual([])
  })

  test("on a visit with no clone known, a branch skill says how to add one", async ($, on) => {
    const world = worldWith({ ...CLONED, store: {}, answer: "OK" })
    const { clock, seen, ui } = await visiting($, on, world)
    const runs = seen.runs.length

    await pressDrawn(clock, ui, "resolveConflicts-12")
    await clock.settle()

    expect(world.question).toMatch(
      /^Its merge conflicts on \S+ get resolved in a clone of acme\/web, not in this session's folder, and none is known on this machine\.$/
    )
    expect(world.detail).toBe(
      "Clone it if you haven't (gh repo clone acme/web), open a Claude Code session in it once, and it is offered here."
    )
    expect(world.choices).toEqual(["OK"])
    expect(seen.runs.slice(runs).filter((line) => /^open |^git (switch|worktree|fetch|checkout) /.test(line))).toEqual(
      []
    )
  })

  test("on a visit, a link that won't open says where to type the command, and runs nothing here", async ($, on) => {
    const world = worldWith({ ...CLONED, answer: "New Session in ~/code/web", openFailure: "no handler" })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "fixCi-12")
    await clock.settle()

    expect(seen.commands).toEqual([])
    expect(seen.notices.at(-1)).toContain("in /Users/me/code/web, type /prs acme/web into one yourself")
  })

  test("Request Review on a visit offers whom GitHub suggests there and asks them there; the folder's stay", async ($, on) => {
    const unasked: ResponseFixture = { mine: [{ number: 12, title: "Checkout page" }] }
    const world = worldWith({
      others: { "github.com/acme/web": unasked },
      github: { ...APP, mine: [{ number: 12, title: "Folder's own twelve" }] },
      suggested: { 12: ["folk"] },
      suggestedIn: { "github.com/acme/web": { 12: ["bob"] } },
      picks: ["bob"],
      answer: "Request Review"
    })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "requestReview-12")
    await clock.settle()

    expect(world.choices).toContain("bob")
    expect(world.choices).not.toContain("folk")
    expect(seen.runs.filter((line) => line.includes("requested_reviewers"))).toEqual([
      "gh api --method POST repos/acme/web/pulls/12/requested_reviewers --hostname github.com -f reviewers[]=bob"
    ])
    await pressDrawn(clock, ui, "back")
    await clock.settle()
    expect(await ui.find({ key: "requestReview-12" })).not.toBe(undefined)
  })

  test("a Review on the visit's row marks that row while its turn runs, gives it back after, and reads the visit again", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    expect(seen.commands.at(-1)).toContain("https://github.com/acme/web/pull/3")
    await $.turn.start(skillTurnStart("review-web"))
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).toContain("Reviewing…")
    const asked = seen.runs.filter(
      (line) => line.includes("-f owner=acme -f name=web") && line.includes("$mine")
    ).length

    // A skill's turns are followed at most every half minute.
    await clock.advance(31_000)
    await $.turn.complete(skillTurnEnd("review-web"))
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).not.toContain("Reviewing…")
    expect(
      seen.runs.filter((line) => line.includes("-f owner=acme -f name=web") && line.includes("$mine")).length
    ).toBe(asked + 1)
  })

  test("a visit's row marked by its turn is still marked on a visit again while the turn runs", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    await clock.settle()
    await pressDrawn(clock, ui, "back")
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).toContain("Reviewing…")
  })

  test("the folder's #7 and the visit's #7 marked by their turns: the folder's ending leaves the visit's marked", async ($, on) => {
    const world = worldWith({
      answer: "This session",
      others: { "github.com/acme/web": { requested: [{ number: 7, title: "Tax rules", author: "ann" }] } }
    })
    const clock = clockOf(on)
    machine($, on, world)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    await pressDrawn(clock, ui, "review-7")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-app"))
    await clock.settle()

    await runPrs($, "acme/web")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-7" })))).not.toContain("Reviewing…")
    await pressDrawn(clock, ui, "review-7")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    await clock.settle()
    await clock.advance(31_000)
    await $.turn.complete(skillTurnEnd("review-app"))
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-7" })))).toContain("Reviewing…")
  })

  test("acme/web on two servers: a mark on one's #3 shows on no row of the other's", async ($, on) => {
    const world = worldWith({
      answer: "This session",
      signedIn: ["github.com", "ghe.example.com"],
      others: { "github.com/acme/web": WEB, "ghe.example.com/acme/web": WEB }
    })
    const { clock, seen, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).toContain("Reviewing…")
    await runPrs($, "https://ghe.example.com/acme/web")
    await clock.settle()

    expect(
      seen.runs.some((line) => line.startsWith("gh api graphql --hostname ghe.example.com") && line.includes("$mine"))
    ).toBe(true)
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).not.toContain("Reviewing…")
  })

  test("a skill's turns read a visit again only while the pane shows it", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const { clock, seen, ui } = await visiting($, on, world)
    const lists = () => seen.runs.filter((line) => line.includes("-f name=web") && line.includes("$mine")).length

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    world.isPaneBehind = true
    await clock.advance(31_000)
    const asked = lists()
    await $.turn.complete(skillTurnEnd("review-web"))
    await clock.settle()

    expect(lists()).toBe(asked)
  })

  test("skills started from the folder's list and a visit's: the turns that follow read each list again", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const clock = clockOf(on)
    const seen = machine($, on, world, clock)
    await startSession($)
    await clock.settle()
    await runPrs($, "")
    await clock.settle()
    const ui = await mountPane($, "terminal")
    const lists = (name: string) =>
      seen.runs.filter((line) => line.includes(`-f name=${name}`) && line.includes("$mine")).length

    await pressDrawn(clock, ui, "review-7")
    await clock.settle()
    await runPrs($, "acme/web")
    await clock.settle()
    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("turn"))
    await clock.advance(31_000)
    const [web, app] = [lists("web"), lists("app")]
    await $.turn.complete(skillTurnEnd("turn"))
    await clock.settle()

    expect([lists("web"), lists("app")]).toEqual([web + 1, app + 1])
  })

  test("a visit's skill turns read its list again where the folder's checks stopped, as in a folder with none", async ($, on) => {
    const world = worldWith({
      answer: "This session",
      repoViewFailure: "none of the git remotes configured for this repository point to a known GitHub host"
    })
    const { clock, seen, ui } = await visiting($, on, world)
    const lists = () => seen.runs.filter((line) => line.includes("-f name=web") && line.includes("$mine")).length

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("turn"))
    await clock.advance(31_000)
    const before = lists()
    await $.turn.complete(skillTurnEnd("turn"))
    await clock.settle()

    expect(lists()).toBe(before + 1)
  })

  test("a folder's skill typed after a visit's: the folder's list follows its turns too", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const { clock, seen, ui } = await visiting($, on, world)
    const lists = (name: string) =>
      seen.runs.filter((line) => line.includes(`-f name=${name}`) && line.includes("$mine")).length

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    await clock.advance(31_000)
    await $.turn.complete(skillTurnEnd("review-web"))
    await clock.settle()
    await $.command.run({ command: "gh-prs-monitor:review", args: "7" } as Parameters<Engine["command"]["run"]>[0])
    await $.turn.start(skillTurnStart("review-app"))
    await clock.advance(31_000)
    const [web, app] = [lists("web"), lists("app")]
    await $.turn.complete(skillTurnEnd("review-app"))
    await clock.settle()

    expect([lists("web"), lists("app")]).toEqual([web + 1, app + 1])
  })

  test("a folder's skill typed while a visit's runs: each turn's end gives back its own list's row", async ($, on) => {
    const world = worldWith({ answer: "This session" })
    const { clock, ui } = await visiting($, on, world)

    await pressDrawn(clock, ui, "review-3")
    await clock.settle()
    await $.turn.start(skillTurnStart("review-web"))
    await clock.settle()
    await $.command.run({ command: "gh-prs-monitor:review", args: "7" } as Parameters<Engine["command"]["run"]>[0])
    await $.turn.start(skillTurnStart("review-app"))
    await clock.settle()
    await clock.advance(31_000)
    await $.turn.complete(skillTurnEnd("review-web"))
    await clock.settle()

    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-3" })))).not.toContain("Reviewing…")
    await pressDrawn(clock, ui, "back")
    await clock.settle()
    expect(wordsIn(drawnNodes(await ui.find({ key: "pr-7" })))).toContain("Reviewing…")
  })
})
