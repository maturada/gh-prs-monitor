// Author: David Matura

import type { On, RenderElement } from "claude-code"
import { describe, expect, test } from "claude-code/testing"
import type { Engine } from "claude-code/testing"

import type { Answer, Question } from "../types"
import { answerOpen, questionView } from "./dialog"
import { answerKey, PICK_ALL_KEY, pickKey } from "./keys"
import { pickerActions, pickerView } from "./picker"
import type { PickerActions } from "./picker"
import type { PickingQuestion } from "./picking"
import type { QuestionKit } from "./question-frame"
import { createSession } from "./session"
import type { Session } from "./session"
import { readSettings } from "./settings"
import { stableButtons } from "./stable-buttons"
import { drawnNodes, PLUGIN, SURFACES } from "./testing/world"
import type { Drawn } from "./testing/world"

// Request Review's: any number of the people GitHub suggests, none at first, and the request only once one is.
const PEOPLE: PickingQuestion = {
  header: "Request",
  subject: "#41 Sort the reading list",
  text: "Who should review it?",
  detail: "GitHub suggests them from who changed or reviewed this code before.",
  choices: ["Request Review", "Cancel"],
  main: "Request Review",
  instructions: null,
  picking: { names: ["kim", "lou"], isSingle: false, initial: [], needsPick: true, startsOn: "names" }
}

// Re-Review's: one kind of review of two, what changed at first, with a place to start it and room for instructions.
const KIND: PickingQuestion = {
  header: "Review PR",
  subject: "#1241 Shareable invite links",
  text: "What should it cover, and where?",
  detail: "Your review was on a1b2c3d, 20h ago; new commits came in since.",
  choices: ["This session", "New session", "Cancel"],
  main: null,
  instructions: "to a review in this session",
  picking: {
    names: ["Since Your Review", "Full Review"],
    isSingle: true,
    initial: [0],
    needsPick: false,
    startsOn: "answers"
  }
}

// Re-Review's, where it would ask for a piece of text of its own: the keyboard starts in its field.
const KIND_WITH_FIELD: PickingQuestion = {
  ...KIND,
  field: { label: "Focus", placeholder: "What to look at", submitLabel: "Start", otherHint: "" }
}

const NONE: PickerActions = { pick: () => {}, pickAll: () => {}, answer: () => {} }

type Drawing = { question: PickingQuestion; picks: readonly number[]; actions: PickerActions }

// The picker as a surface draws it, through a drawing of the test's own beside the plugin's pane: one drawing hook a
// test, drawing what `draw` was last given.
function drawer($: Engine, on: On) {
  let current: Drawing = { question: PEOPLE, picks: [], actions: NONE }
  let mounted: { unmount: () => Promise<unknown> } | null = null
  on("ui.render", { component: "Pane", requestId: "picker" }, async ($, e) => {
    const { Box, Text, Button, ...rest } = $.ui.resolve(e)
    const Input = e.surface !== "mobile" && "Input" in rest ? rest.Input : undefined
    const field = { key: "answer-text-1", read: () => "", keep: () => {} }
    const site = { surface: e.surface, isEscapable: false }

    return pickerView({ Box, Text, Button, Input }, current.question, current.picks, current.actions, field, site)
  })

  return async (
    question: PickingQuestion,
    picks: readonly number[],
    surface: (typeof SURFACES)[number] = "terminal",
    actions: PickerActions = NONE
  ) => {
    current = { question, picks, actions }
    await mounted?.unmount()
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: "Pane",
      requestId: "picker",
      props: {
        title: "Pull requests",
        isFocused: true,
        bodyColumns: 100,
        placement: "dock",
        scroll: { offset: 0, bodyRows: 30 },
        view: {}
      } as never
    })

    mounted = ui

    return { ui, nodes: drawnNodes(await ui.drawn()) }
  }
}

const SITE = { surface: "terminal", isEscapable: false }

// The picker built with plain elements (`plain`).
function built(question: PickingQuestion, picks: readonly number[], actions: PickerActions) {
  const field = { key: "answer-text-1", read: () => "", keep: () => {} }

  return plain((kit) => pickerView(kit, question, picks, actions, field, SITE))
}

// A drawing built with plain elements, whose props keep their handlers and their key (an engine's element keeps the
// key apart), for reading its buttons, pressing one by its key, and typing or pressing Enter in its field.
function plain(draw: (kit: QuestionKit) => RenderElement) {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as unknown as RenderElement
  const kit = {
    Box: element("Box"),
    Text: element("Text"),
    Button: element("Button"),
    Input: element("Input")
  } as unknown as QuestionKit
  const tree = draw(kit)
  const all = (node: unknown): { type: string; props: Record<string, unknown> }[] => {
    if (typeof node !== "object" || node === null) {
      return []
    }
    if (Array.isArray(node)) {
      return node.flatMap(all)
    }
    const each = node as { type: string; props: Record<string, unknown> }

    return [each, ...all(each.props?.children)]
  }

  const input = () => {
    const found = all(tree).find((node) => node.type === "Input")
    expect(found).toBeDefined()

    return found!.props
  }

  return {
    labels: () => all(tree).flatMap((node) => (node.type === "Button" ? [node.props.label] : [])),
    press: (key: string) => {
      const button = all(tree).find((node) => node.type === "Button" && node.props.key === key)
      expect(button).toBeDefined()
      ;(button!.props.onPress as () => void)()
    },
    fieldKey: () => input().key,
    type: (text: string) => (input().onInput as (text: string) => void)(text),
    enter: (text: string) => (input().onSubmit as (text: string) => void)(text)
  }
}

function buttons(nodes: Drawn[]): Drawn[] {
  return nodes.filter((node) => node.type === "Button")
}

function labels(nodes: Drawn[]): unknown[] {
  return buttons(nodes).map((node) => node.props?.label)
}

describe("the picker as drawn", () => {
  test("nobody picked: each name a plain button, Select All, and the request dim, not the main one yet", async ($, on) => {
    const { nodes } = await drawer($, on)(PEOPLE, [])

    expect(labels(nodes)).toEqual(["kim", "lou", "Select All", "Request Review", "Cancel"])
    const request = buttons(nodes).find((node) => node.props?.label === "Request Review")
    expect(request?.props?.dimColor).toBe(true)
    expect(request?.props?.variant).toBeUndefined()
  })

  test("one picked: its name checked, and the request the main answer", async ($, on) => {
    const { nodes } = await drawer($, on)(PEOPLE, [1])

    expect(labels(nodes)).toEqual(["kim", "✓ lou", "Select All", "Request Review", "Cancel"])
    const request = buttons(nodes).find((node) => node.props?.label === "Request Review")
    expect(request?.props?.variant).toBe("primary")
    expect(request?.props?.dimColor).toBeUndefined()
  })

  test("every one picked: Select All reads Clear", async ($, on) => {
    const { nodes } = await drawer($, on)(PEOPLE, [0, 1])

    expect(labels(nodes)).toEqual(["✓ kim", "✓ lou", "Clear", "Request Review", "Cancel"])
  })

  test("a lone name has no Select All, which would only repeat it", async ($, on) => {
    const lone = { ...PEOPLE, picking: { ...PEOPLE.picking, names: ["lou"] } }
    const { nodes } = await drawer($, on)(lone, [])

    expect(labels(nodes)).toEqual(["lou", "Request Review", "Cancel"])
  })

  test("one of two: the one picked checked, and no Select All", async ($, on) => {
    const { nodes } = await drawer($, on)(KIND, [0])

    expect(labels(nodes)).toEqual(["✓ Since Your Review", "Full Review", "This session", "New session", "Cancel"])
  })

  test("the names, Select All and the answers keep keys of their own, so the keyboard and a press name them", async ($, on) => {
    const { nodes } = await drawer($, on)(PEOPLE, [])

    expect(buttons(nodes).map((node) => node.props?.key)).toEqual([
      pickKey(0),
      pickKey(1),
      PICK_ALL_KEY,
      answerKey(0),
      answerKey(1)
    ])
  })

  test("the keyboard starts on the first name, else on the first answer, else in a field of the question's own", async ($, on) => {
    const draw = drawer($, on)
    const focused = (nodes: Drawn[]) =>
      nodes.filter((node) => node.props?.autoFocus).map((node) => node.props?.key ?? node.type)

    expect(focused((await draw(PEOPLE, [])).nodes)).toEqual([pickKey(0)])
    expect(focused((await draw(KIND, [0])).nodes)).toEqual([answerKey(0)])
    expect(focused((await draw(KIND_WITH_FIELD, [0])).nodes)).toEqual(["answer-text-1"])
  })

  test("a press on a name, Select All or an answer goes to its action", () => {
    const seen: string[] = []
    const actions: PickerActions = {
      pick: (index) => seen.push(`pick ${index}`),
      pickAll: () => seen.push("all"),
      answer: (answer) => seen.push(`answer ${answer.choice}`)
    }
    const { press } = built(PEOPLE, [], actions)

    press(pickKey(1))
    press(PICK_ALL_KEY)
    press(answerKey(1))
    expect(seen).toEqual(["pick 1", "all", "answer Cancel"])
  })

  test("Enter in the field answers as the dialog's does: an answer named, else the instructions alone; empty, nothing", () => {
    const answers: Answer[] = []
    const { enter } = built(KIND, [0], { ...NONE, answer: (answer) => answers.push(answer) })

    enter("new session")
    enter("only the tests")
    enter("  ")
    expect(answers).toEqual([
      { choice: "New session", instructions: "" },
      { choice: null, instructions: "only the tests" }
    ])
  })

  test("instructions get their field where the question takes them and the surface draws one", async ($, on) => {
    const draw = drawer($, on)
    expect((await draw(KIND, [0])).nodes.some((node) => node.type === "Input")).toBe(true)
    expect((await draw(PEOPLE, [])).nodes.some((node) => node.type === "Input")).toBe(false)
  })

  test("every surface draws it, the phone without a field", async ($, on) => {
    const draw = drawer($, on)
    for (const surface of SURFACES) {
      const { nodes } = await draw(KIND, [0], surface)
      expect(labels(nodes)).toContain("✓ Since Your Review")
      expect(nodes.some((node) => node.type === "Input")).toBe(surface !== "mobile")
    }
  })
})

describe("the picker's presses", () => {
  // The open question as `ask` keeps it, the question and its picks among it; a press reads them there, as its button
  // keeps its first closure through redraws (`stableButtons`).
  function opened(question: PickingQuestion) {
    const session = createSession(readSettings({}))
    const answers: (Answer | null)[] = []
    let redraws = 0
    session.asking = {
      question,
      answer: (answer) => answers.push(answer),
      isAnswered: false,
      isInPane: true,
      fieldKey: "answer-text-1",
      draft: "",
      picks: [...question.picking.initial]
    }
    const actions: PickerActions = { ...pickerActions(session, () => redraws++), answer: answerOpen(session) }

    return { session, answers, actions, redraws: () => redraws }
  }

  test("a name pressed is picked or taken off and drawn again, nothing answered", () => {
    const { session, answers, actions, redraws } = opened(PEOPLE)

    actions.pick(1)
    expect(session.asking?.picks).toEqual([1])
    actions.pick(1)
    expect(session.asking?.picks).toEqual([])
    expect(redraws()).toBe(2)
    expect(answers).toEqual([])
  })

  test("Select All, then Clear", () => {
    const { session, actions } = opened(PEOPLE)

    actions.pickAll()
    expect(session.asking?.picks).toEqual([0, 1])
    actions.pickAll()
    expect(session.asking?.picks).toEqual([])
  })

  test("the request with nobody picked does nothing; once someone is, it answers with the names picked", () => {
    const { answers, actions } = opened(PEOPLE)

    actions.answer({ choice: "Request Review", instructions: "" })
    expect(answers).toEqual([])
    actions.pick(1)
    actions.answer({ choice: "Request Review", instructions: "" })
    expect(answers).toEqual([{ choice: "Request Review", instructions: "", picks: ["lou"] }])
  })

  test("instructions sent alone wait for a pick as the main answer does", () => {
    const { answers, actions } = opened(PEOPLE)

    actions.answer({ choice: null, instructions: "the API changes first" })
    expect(answers).toEqual([])
    actions.pick(0)
    actions.answer({ choice: null, instructions: "the API changes first" })
    expect(answers).toEqual([{ choice: null, instructions: "the API changes first", picks: ["kim"] }])
  })

  test("Cancel answers whatever is picked", () => {
    const { answers, actions } = opened(PEOPLE)

    actions.answer({ choice: "Cancel", instructions: "" })
    expect(answers).toEqual([{ choice: "Cancel", instructions: "", picks: [] }])
  })

  test("one of two: an answer carries the kind picked and the instructions typed", () => {
    const { answers, actions } = opened(KIND)

    actions.pick(1)
    actions.answer({ choice: "This session", instructions: "look closer at error handling" })
    actions.answer({ choice: null, instructions: "only the tests" })
    expect(answers).toEqual([
      { choice: "This session", instructions: "look closer at error handling", picks: ["Full Review"] },
      { choice: null, instructions: "only the tests", picks: ["Full Review"] }
    ])
  })

  test("a button kept from an earlier question acts on the one open now", () => {
    const { session, answers, actions } = opened(PEOPLE)
    session.asking = { ...session.asking!, question: KIND, picks: [0] }

    actions.pick(1)
    expect(session.asking?.picks).toEqual([1])
    actions.answer({ choice: "Cancel", instructions: "" })
    expect(answers).toEqual([{ choice: "Cancel", instructions: "", picks: ["Full Review"] }])
  })

  test("a press after the question went does nothing", () => {
    const { session, answers, actions } = opened(PEOPLE)
    session.asking = null

    actions.pick(0)
    actions.answer({ choice: "Cancel", instructions: "" })
    expect(answers).toEqual([])
  })
})

describe("the open question in the pane", () => {
  const MERGE: Question = {
    header: "Merge",
    subject: "#7 Fix the menu",
    text: "Merge it?",
    detail: null,
    choices: ["Merge", "Cancel"],
    main: "Merge",
    instructions: null
  }

  // `question` opened on `session`, as `ask` opens it, its answers kept in `answers`.
  function openOn(session: Session, question: Question, answers: (Answer | null)[]) {
    session.asking = {
      question,
      answer: (answer) => answers.push(answer),
      isAnswered: false,
      isInPane: true,
      fieldKey: "answer-text-1",
      draft: "",
      picks: [...(question.picking?.initial ?? [])]
    }
  }

  // The pane's question drawn from the session's open question, as each of the pane's drawings draws it.
  function paneOf(question: Question) {
    const session = createSession(readSettings({}))
    const answers: (Answer | null)[] = []
    let redraws = 0
    openOn(session, question, answers)
    const draw = () => plain((kit) => questionView(kit, session, question, SITE, () => redraws++))

    return { session, answers, draw, redraws: () => redraws }
  }

  // The open question drawn as the pane draws it, its buttons kept from one drawing to the next (`stableButtons`).
  function drawnStably(session: Session) {
    const question = session.asking!.question

    return plain((kit) =>
      questionView(
        { ...kit, Button: stableButtons(session.drawnButtons, "terminal:pane:question", kit.Button) },
        session,
        question,
        SITE,
        () => {}
      )
    )
  }

  test("a button drawn alike by the picker and then the dialog answers the question open at its press", () => {
    const session = createSession(readSettings({}))
    const answers: (Answer | null)[] = []
    openOn(session, PEOPLE, answers)
    drawnStably(session)

    openOn(session, MERGE, answers)
    drawnStably(session).press(answerKey(1))
    expect(answers).toEqual([{ choice: "Cancel", instructions: "" }])
  })

  test("and drawn by the dialog first, it answers a picker's question with the names picked", () => {
    const session = createSession(readSettings({}))
    const answers: (Answer | null)[] = []
    const { picking: _, ...place } = KIND
    openOn(session, place, answers)
    drawnStably(session)

    openOn(session, KIND, answers)
    drawnStably(session).press(answerKey(0))
    expect(answers).toEqual([{ choice: "This session", instructions: "", picks: ["Since Your Review"] }])
  })

  test("one that offers names is drawn by the picker with the picks the open question keeps; any other by the dialog", () => {
    const people = paneOf(PEOPLE)
    people.session.asking!.picks = [1]

    expect(people.draw().labels()).toEqual(["kim", "✓ lou", "Select All", "Request Review", "Cancel"])
    expect(paneOf(MERGE).draw().labels()).toEqual(["Merge", "Cancel"])
  })

  test("a name pressed is picked on the open question and the pane drawn again; the request then answers with it", () => {
    const pane = paneOf(PEOPLE)

    pane.draw().press(pickKey(1))
    expect(pane.session.asking?.picks).toEqual([1])
    expect(pane.redraws()).toBe(1)
    expect(pane.draw().labels()).toContain("✓ lou")
    pane.draw().press(answerKey(0))
    expect(pane.answers).toEqual([{ choice: "Request Review", instructions: "", picks: ["lou"] }])
  })

  test("instructions typed before a pick are kept through its drawing again, and go with the answer", () => {
    const pane = paneOf(KIND)

    pane.draw().type("look closer at error handling")
    pane.draw().press(pickKey(1))
    pane.draw().press(answerKey(0))
    expect(pane.answers).toEqual([
      { choice: "This session", instructions: "look closer at error handling", picks: ["Full Review"] }
    ])
  })

  test("a button kept from an earlier drawing acts on the question open at its press", () => {
    const pane = paneOf(PEOPLE)
    const earlier = pane.draw()
    pane.session.asking = { ...pane.session.asking!, question: KIND, picks: [0] }

    earlier.press(pickKey(1))
    expect(pane.session.asking?.picks).toEqual([1])
    earlier.press(answerKey(1))
    expect(pane.answers).toEqual([{ choice: "Cancel", instructions: "", picks: ["Full Review"] }])
  })

  test("its field is the open question's: what is typed is kept there and goes with the answer pressed", () => {
    const pane = paneOf(KIND)

    expect(pane.draw().fieldKey()).toBe("answer-text-1")
    pane.draw().type("look closer at error handling")
    expect(pane.session.asking?.draft).toBe("look closer at error handling")
    pane.draw().press(answerKey(0))
    expect(pane.answers).toEqual([
      { choice: "This session", instructions: "look closer at error handling", picks: ["Since Your Review"] }
    ])
  })
})
