// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { Answer, Question } from "../types"
import type { ElsewhereState } from "./elsewhere"
import { OPEN_QUESTION_NOTE } from "./dialog-flow"
import { askPick, choiceOf, elsewhereCount, repoChoices, repoPickerQuestion } from "./repo-picker"
import type { PickerHost } from "./repo-picker"
import { createSession } from "./session"
import { readSettings } from "./settings"
import { held } from "./testing/promises"

const APP = { host: "github.com", name: "acme/app" }
const WEB = { host: "github.com", name: "acme/web" }
const IOS = { host: "github.com", name: "acme/ios-app" }
const ADMIN = { host: "github.com", name: "acme/admin" }

function pull(repo: typeof WEB, number: number, fields: Partial<ElsewhereState["pulls"][string]> = {}) {
  return {
    repo,
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo.name}/pull/${number}`,
    author: "me",
    isMine: true,
    isRequested: false,
    ci: "SUCCESS" as const,
    reviews: {},
    seenAt: 0,
    changedAt: 0,
    ...fields
  }
}

function stateOf(pulls: ReturnType<typeof pull>[], pickedAt: number | null = null): ElsewhereState {
  return {
    viewer: "me",
    pulls: Object.fromEntries(pulls.map((each) => [`${each.repo.host}/${each.repo.name}#${each.number}`, each])),
    isCut: { mine: false, requested: false },
    at: 0,
    pickedAt,
    isTold: true
  }
}

describe("the repositories the picker offers", () => {
  test("the folder's, then the clones on this machine, then those on GitHub alone, what waits first", () => {
    const state = stateOf([
      pull(WEB, 12, { ci: "FAILURE" }),
      pull(ADMIN, 3, { isMine: false, isRequested: true, author: "bo" }),
      pull(ADMIN, 4, { isMine: false, isRequested: true, author: "bo" }),
      pull(IOS, 7, { ci: "FAILURE" }),
      pull({ host: "github.com", name: "acme/quiet" }, 1)
    ])
    const clones = [
      { root: "/code/docs", repo: { host: "github.com", name: "acme/docs" } },
      { root: "/code/web", repo: WEB },
      { root: "/code/web-old", repo: WEB }
    ]

    expect(repoChoices(clones, state, APP)).toEqual([
      { repo: APP, clone: null, mine: 0, requested: 0, open: 0, isNew: false, isFolder: true },
      { repo: WEB, clone: "/code/web", mine: 1, requested: 0, open: 1, isNew: false, isFolder: false },
      {
        repo: { host: "github.com", name: "acme/docs" },
        clone: "/code/docs",
        mine: 0,
        requested: 0,
        open: 0,
        isNew: false,
        isFolder: false
      },
      { repo: ADMIN, clone: null, mine: 0, requested: 2, open: 2, isNew: false, isFolder: false },
      { repo: IOS, clone: null, mine: 1, requested: 0, open: 1, isNew: false, isFolder: false },
      {
        repo: { host: "github.com", name: "acme/quiet" },
        clone: null,
        mine: 0,
        requested: 0,
        open: 1,
        isNew: false,
        isFolder: false
      }
    ])
  })

  test("one where your pull requests wait only on others is offered too, after those where something waits", () => {
    const QUIET = { host: "github.com", name: "acme/quiet" }
    const state = stateOf([
      pull(QUIET, 1),
      pull(QUIET, 2, { ci: "PENDING" }),
      pull(IOS, 7, { ci: "FAILURE" }),
      pull(IOS, 8)
    ])

    expect(repoChoices([], state, APP).map((choice) => [choice.repo.name, choice.mine, choice.open])).toEqual([
      ["acme/app", 0, 0],
      ["acme/ios-app", 1, 2],
      ["acme/quiet", 0, 2]
    ])
  })

  test("another checkout of the folder's own repository is the folder's, offered once", () => {
    const clones = [
      { root: "/code/app-2", repo: { host: "GitHub.com", name: "ACME/app" } },
      { root: "/code/web", repo: WEB }
    ]

    expect(repoChoices(clones, null, APP).map((choice) => choice.repo.name)).toEqual(["acme/app", "acme/web"])
  })

  test("marks what changed since the picker was last opened; opened never, nothing is new", () => {
    const state = (pickedAt: number | null) => stateOf([pull(WEB, 12, { ci: "FAILURE", changedAt: 50 })], pickedAt)

    expect(repoChoices([], state(10), APP).find((choice) => choice.repo === WEB)?.isNew).toBe(true)
    expect(repoChoices([], state(60), APP).find((choice) => choice.repo === WEB)?.isNew).toBe(false)
    expect(repoChoices([], state(null), APP).find((choice) => choice.repo === WEB)?.isNew).toBe(false)
  })

  test("a folder with no repository starts with the clones; with no light check read, only clones", () => {
    expect(repoChoices([{ root: "/code/web", repo: WEB }], null, null)).toEqual([
      { repo: WEB, clone: "/code/web", mine: 0, requested: 0, open: 0, isNew: false, isFolder: false }
    ])
  })

  test("+N elsewhere counts what waits outside the folder's and the visited repository", () => {
    const state = stateOf([
      pull(WEB, 12, { ci: "FAILURE" }),
      pull(ADMIN, 3, { isMine: false, isRequested: true }),
      pull(IOS, 7, { ci: "FAILURE" }),
      pull(IOS, 8)
    ])

    expect(elsewhereCount(state, APP, null)).toBe(3)
    expect(elsewhereCount(state, APP, WEB)).toBe(2)
    expect(elsewhereCount(null, APP, null)).toBe(0)
  })
})

describe("the picker's question", () => {
  const choices = repoChoices(
    [{ root: "/code/web", repo: WEB }],
    stateOf([pull(WEB, 12, { ci: "FAILURE", changedAt: 5 }), pull(ADMIN, 3, { isMine: false, isRequested: true })], 1),
    APP
  )

  test("one repository picked, the one shown to start with, or one typed: owner/name, an address or a folder", () => {
    const question = repoPickerQuestion(choices, WEB)

    expect(question.picking).toEqual({
      names: ["acme/app  this folder", "acme/web  /code/web  1 yours  new", "acme/admin  1 to review"],
      isSingle: true,
      initial: [1],
      needsPick: false,
      startsOn: "names",
      rows: [
        {
          group: "On this machine",
          name: "acme/app",
          place: "this folder",
          mine: 0,
          requested: 0,
          open: 0,
          isNew: false,
          isShown: false
        },
        {
          group: "On this machine",
          name: "acme/web",
          place: "/code/web",
          mine: 1,
          requested: 0,
          open: 1,
          isNew: true,
          isShown: true
        },
        {
          group: "On GitHub",
          name: "acme/admin",
          place: null,
          mine: 0,
          requested: 1,
          open: 1,
          isNew: false,
          isShown: false
        }
      ]
    })
    expect(question.choices).toEqual(["Show", "Cancel"])
    expect(question.main).toBe("Show")
    expect(question.field?.submitLabel).toBe("Show")
  })

  test("its rows are cut to the four Claude Code's own dialog lists, as its names are, so each Open names its own", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      repo: { host: "github.com", name: `acme/r${index}` },
      clone: null,
      mine: 1,
      requested: 0,
      open: 1,
      isNew: false,
      isFolder: false
    }))

    expect(repoPickerQuestion(many, null, 4).picking?.rows?.map((row) => row.name)).toEqual([
      "acme/r0",
      "acme/r1",
      "acme/r2",
      "acme/r3"
    ])
  })

  test("in Claude Code's own dialog, four at most, the rest typed under Other", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      repo: { host: "github.com", name: `acme/r${index}` },
      clone: null,
      mine: 0,
      requested: 0,
      open: 1,
      isNew: false,
      isFolder: false
    }))

    expect(repoPickerQuestion(many, null, 4).picking?.names).toHaveLength(4)
    expect(repoPickerQuestion(many, null, 4).detail).toBe("2 more aren't listed here.")
    expect(repoPickerQuestion(many, null, 4).field?.otherHint).toContain("under Other")
    expect(repoPickerQuestion(many, null).picking?.names).toHaveLength(6)
  })

  test("Claude Code's own dialog says how many are open where nothing waits, and matches the answer by it", () => {
    const quiet = repoChoices([], stateOf([pull({ host: "github.com", name: "acme/quiet" }, 1), pull(IOS, 7)]), null)
    const names = repoPickerQuestion(quiet, null).picking?.names

    expect(names).toEqual(["acme/quiet  1 open", "acme/ios-app  1 open"])
    expect(choiceOf({ choice: "Show", instructions: "", picks: [names![0]!] }, quiet)).toEqual({
      repo: { host: "github.com", name: "acme/quiet" }
    })
  })

  test("names each repository's server where they are on more than one, and the home folder as ~", () => {
    const ghe = { host: "ghe.example.com", name: "acme/web" }
    const both = repoChoices(
      [
        { root: "/Users/me/code/web", repo: WEB },
        { root: "/Users/me/work/web", repo: ghe }
      ],
      null,
      null
    )
    const question = repoPickerQuestion(both, null, Infinity, "/Users/me")

    expect(question.picking?.names).toEqual(["github.com/acme/web  ~/code/web", "ghe.example.com/acme/web  ~/work/web"])
    expect(question.picking?.rows?.map((row) => [row.name, row.place])).toEqual([
      ["github.com/acme/web", "~/code/web"],
      ["ghe.example.com/acme/web", "~/work/web"]
    ])
    const [, other] = question.picking!.names
    expect(choiceOf({ choice: "Show", instructions: "", picks: [other!] }, both, "/Users/me")).toEqual({ repo: ghe })
  })

  test("with no repository to list, only the field asks; typed under Claude Code's own Other, it is read, a decline not", () => {
    expect(repoPickerQuestion([], null).picking).toBeUndefined()
    expect(repoPickerQuestion([], null).field).toMatchObject({
      label: "Type one",
      otherHint: "Type owner/name, an address, or a folder's path under Other."
    })
    expect(choiceOf({ choice: "Show", instructions: "" }, [])).toEqual({
      problem: "Type a repository to show: owner/name, an address, or a folder's path."
    })
    expect(choiceOf({ choice: null, instructions: " acme/web " }, [])).toEqual({ name: "acme/web", host: null })
    expect(choiceOf({ choice: null, instructions: "never mind" }, [])).toBe(null)
    expect(choiceOf({ choice: null, instructions: "" }, [])).toBe(null)
  })

  test("something typed that names no repository says so", () => {
    expect(choiceOf({ choice: "Show", instructions: "what now", picks: [] }, choices)).toEqual({
      problem: '"what now" is no repository: type owner/name, an address, or a folder\'s path.'
    })
  })

  test("the answer read back: a repository picked, or what was typed, or nothing on Cancel", () => {
    const question = repoPickerQuestion(choices, null)
    const [, web] = question.picking!.names

    expect(choiceOf({ choice: "Show", instructions: "", picks: [web!] }, choices)).toEqual({ repo: WEB })
    expect(choiceOf({ choice: "Show", instructions: " acme/docs ", picks: [web!] }, choices)).toEqual({
      name: "acme/docs",
      host: null
    })
    expect(choiceOf({ choice: "Show", instructions: "~/code/docs", picks: [] }, choices)).toEqual({
      path: "~/code/docs"
    })
    expect(choiceOf({ choice: "Cancel", instructions: "acme/docs", picks: [web!] }, choices)).toBe(null)
    expect(choiceOf({ choice: "Show", instructions: "", picks: [] }, choices)).toBe(null)
  })
})

describe("the picker as it asks", () => {
  // A picker's host whose question is answered `answer`: the folder acme/app, its clone of acme/web in the home folder.
  function pickerHost(answer: Answer | null, fields: Partial<PickerHost> = {}) {
    const seen = {
      questions: [] as Question[],
      paths: [] as string[],
      shown: [] as unknown[],
      problems: [] as string[],
      changed: [] as boolean[],
      notes: [] as string[],
      pressed: [] as string[]
    }
    const host: PickerHost = {
      check: async () => {},
      elsewhere: async () => null,
      markPicked: async () => {},
      clones: async () => [{ root: "/Users/me/code/web", repo: WEB }],
      folder: async () => APP,
      visited: async () => null,
      isPlaced: async () => true,
      home: async () => "/Users/me",
      now: async () => 1_000,
      // The answer, carried out before the question closes, as the pane does; what kept it from showing keeps the
      // question open there.
      isAsking: async () => false,
      ask: async (question, pressed, check) => {
        seen.questions.push(question)
        seen.pressed.push(pressed)
        const carried = answer ? await check(answer, () => true) : null
        if (carried && "problem" in carried) {
          seen.problems.push(carried.problem)

          return null
        }
        if (carried) {
          seen.changed.push(carried.isChanged)
        }

        return answer
      },
      repoAtPath: async (path) => {
        seen.paths.push(path)

        return WEB
      },
      isDemo: async () => false,
      show: async (asked) => {
        seen.shown.push(asked)

        return null
      },
      notify: async (text) => {
        seen.notes.push(text)
      },
      redraw: () => {},
      ...fields
    }

    return { host, seen }
  }

  test("a press while it gets ready asks nothing more", async () => {
    const session = createSession(readSettings({}))
    const check = held()
    const { host, seen } = pickerHost(null, { check: () => check.gate })

    const first = askPick(host, session, "repo")
    await askPick(host, session, "repo")
    check.open()
    await first

    expect(seen.questions).toHaveLength(1)
  })

  test("a check that fails while it gets ready leaves its button ready to press again", async () => {
    const session = createSession(readSettings({}))
    const { host, seen } = pickerHost(null, {
      check: async () => {
        throw new Error("GitHub out of reach")
      }
    })

    await expect(askPick(host, session, "repo")).rejects.toThrow("GitHub out of reach")
    expect(session.isPreparingPicker).toBe(false)
    expect(seen.questions).toEqual([])
  })

  test("during a visit, the repository visited starts picked, not the folder's", async () => {
    const { host, seen } = pickerHost(null, { visited: async () => WEB })

    await askPick(host, createSession(readSettings({})), "repo")

    expect(seen.questions[0]?.picking?.names).toEqual(["acme/app  this folder", "acme/web  ~/code/web"])
    expect(seen.questions[0]?.picking?.initial).toEqual([1])
  })

  test("the pane lists every repository; Claude Code's own dialog, where the pane isn't placed, four", async () => {
    const clones = Array.from({ length: 5 }, (_, index) => ({
      root: `/Users/me/code/r${index}`,
      repo: { host: "github.com", name: `acme/r${index}` }
    }))
    const placed = pickerHost(null, { clones: async () => clones })
    const dialog = pickerHost(null, { clones: async () => clones, isPlaced: async () => false })

    await askPick(placed.host, createSession(readSettings({})), "repo")
    await askPick(dialog.host, createSession(readSettings({})), "repo")

    expect(placed.seen.questions[0]?.picking?.names).toHaveLength(6)
    expect(dialog.seen.questions[0]?.picking?.names).toHaveLength(4)
  })

  test("a folder's path typed shows the repository its git config names, or says why it names none", async () => {
    const typed = { choice: "Show", instructions: "~/code/web" }
    const { host, seen } = pickerHost(typed)

    await askPick(host, createSession(readSettings({})), "repo")

    expect(seen.paths).toEqual(["~/code/web"])
    expect(seen.shown).toEqual([WEB])

    const refused = pickerHost(typed, { repoAtPath: async () => ({ problem: "~/code/web is no clone" }) })
    await askPick(refused.host, createSession(readSettings({})), "repo")

    expect(refused.seen.shown).toEqual([])
    expect(refused.seen.problems).toEqual(["~/code/web is no clone"])
  })

  test("what keeps the repository from showing keeps the question open, saying why; one shown closes it", async () => {
    const typed = { choice: null, instructions: "acme/wbe" }
    const refused = pickerHost(typed, { show: async () => "No access to acme/wbe." })
    const shown = pickerHost({ choice: "Show", instructions: "", picks: ["acme/web  ~/code/web"] })

    await askPick(refused.host, createSession(readSettings({})), "repo")
    await askPick(shown.host, createSession(readSettings({})), "repo")

    expect(refused.seen.problems).toEqual(["No access to acme/wbe."])
    expect(shown.seen.shown).toEqual([WEB])
    expect(shown.seen.problems).toEqual([])
  })

  test("with a question open already, it gets nothing ready: no check, nothing marked, and it says to answer that first", async () => {
    let checks = 0
    let marks = 0
    const { host, seen } = pickerHost(null, {
      isAsking: async () => true,
      check: async () => {
        checks += 1
      },
      markPicked: async () => {
        marks += 1
      }
    })

    await askPick(host, createSession(readSettings({})), "repo")

    expect([checks, marks, seen.questions.length]).toEqual([0, 0, 0])
    expect(seen.notes).toEqual([OPEN_QUESTION_NOTE])
  })

  test("asks from the button pressed, where the keyboard goes back", async () => {
    const { host, seen } = pickerHost(null)

    await askPick(host, createSession(readSettings({})), "pick-repo")

    expect(seen.pressed).toEqual(["pick-repo"])
  })

  test("a repository shown changed the pane; a decline typed, or one no longer wanted, shows nothing and changes nothing", async () => {
    const shown = pickerHost({ choice: "Show", instructions: "", picks: ["acme/web  ~/code/web"] })
    const declined = pickerHost({ choice: null, instructions: "nope" })
    const unwanted = pickerHost(null, {
      ask: async (_question, _pressed, check) => {
        unwantedChanged.push(await check({ choice: null, instructions: "acme/web" }, () => false))

        return null
      }
    })
    const unwantedChanged: unknown[] = []

    await askPick(shown.host, createSession(readSettings({})), "repo")
    await askPick(declined.host, createSession(readSettings({})), "repo")
    await askPick(unwanted.host, createSession(readSettings({})), "repo")

    expect(shown.seen.changed).toEqual([true])
    expect([declined.seen.changed, declined.seen.shown]).toEqual([[false], []])
    expect([unwantedChanged, unwanted.seen.shown]).toEqual([[{ isChanged: false }], []])
  })

  test("once a demo started, a choice shows nothing and closes the question, as the examples cover the pane", async () => {
    const { host, seen } = pickerHost({ choice: null, instructions: "acme/web" }, { isDemo: async () => true })

    await askPick(host, createSession(readSettings({})), "repo")

    expect(seen.shown).toEqual([])
    expect(seen.problems).toEqual([])
  })
})
