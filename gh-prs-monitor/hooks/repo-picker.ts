// Author: David Matura

// The repository picker the pane's header and its problem box open: which repositories it offers, in what order, and
// what each says; the question that asks for one, picked or typed; the answer read back, and shown (`askPick`). What
// waits elsewhere comes from the light check of other repositories (`elsewhere.ts`), the clones from the folders
// sessions noted (`clones.ts`).

import type { Answer, Question, RepoRow } from "../types"
import { needsYou } from "./elsewhere"
import { OPEN_QUESTION_NOTE } from "./dialog-flow"
import type { Carried, Check } from "./dialog-flow"
import type { ElsewhereState } from "./elsewhere"
import { repoKey, sameRepo } from "./gh"
import type { RepoRef } from "./gh"
import { homeShort } from "./paths"
import { CANCEL, ENGINE_OPTIONS, isDecline } from "./question"
import type { Session } from "./session"
import type { NotedClone } from "./store"
import { readRepoInput } from "./visit"

// A repository the picker offers: its clone on this machine, if any; how many of the viewer's own wait for them, and
// how many ask their review; whether something changed since the picker was last opened; and whether it is the
// folder's own.
export type RepoChoice = {
  repo: RepoRef
  clone: string | null
  mine: number
  requested: number
  isNew: boolean
  isFolder: boolean
}

// The folder's repository first; then those cloned on this machine, the latest noted first; then those on GitHub alone
// where something waits. Within the clones and those on GitHub, what waits for the viewer comes first.
export function repoChoices(
  clones: readonly { root: string; repo: RepoRef }[],
  elsewhere: ElsewhereState | null,
  folder: RepoRef | null
): RepoChoice[] {
  const pulls = Object.values(elsewhere?.pulls ?? {})
  const choiceOf = (repo: RepoRef, clone: string | null): RepoChoice => {
    const own = pulls.filter((pull) => sameRepo(pull.repo, repo))
    const waiting = own.filter(needsYou)

    return {
      repo,
      clone,
      mine: waiting.filter((pull) => pull.isMine).length,
      requested: waiting.filter((pull) => pull.isRequested).length,
      isNew: elsewhere?.pickedAt != null && own.some((pull) => pull.changedAt > elsewhere.pickedAt!),
      isFolder: false
    }
  }
  // Each repository once, where it comes first: the folder's, then its latest clone, then GitHub's.
  const taken = new Set(folder ? [repoKey(folder)] : [])
  const cloned = firstOfEach(clones, (clone) => repoKey(clone.repo), taken).map((clone) =>
    choiceOf(clone.repo, clone.root)
  )
  const onGitHub = firstOfEach(
    pulls.filter(needsYou).map((pull) => pull.repo),
    repoKey,
    taken
  ).map((repo) => choiceOf(repo, null))

  return [
    ...(folder ? [{ repo: folder, clone: null, mine: 0, requested: 0, isNew: false, isFolder: true }] : []),
    ...waitingFirst(cloned),
    ...waitingFirst(onGitHub)
  ]
}

// The items whose key neither an item before them nor `taken` has, each key taken as it comes.
function firstOfEach<T>(items: readonly T[], keyOf: (item: T) => string, taken: Set<string>): T[] {
  return items.filter((item) => {
    const key = keyOf(item)
    const isFirst = !taken.has(key)
    taken.add(key)

    return isFirst
  })
}

// Those where something waits first, each group in the order it came.
function waitingFirst(choices: readonly RepoChoice[]): RepoChoice[] {
  const isWaiting = (choice: RepoChoice): boolean => choice.mine + choice.requested > 0

  return [...choices.filter(isWaiting), ...choices.filter((choice) => !isWaiting(choice))]
}

// "+N elsewhere": what waits for the viewer outside the folder's repository and the one visited.
export function elsewhereCount(
  elsewhere: ElsewhereState | null,
  folder: RepoRef | null,
  visit: RepoRef | null
): number {
  return Object.values(elsewhere?.pulls ?? {}).filter(
    (pull) => needsYou(pull) && !(folder && sameRepo(pull.repo, folder)) && !(visit && sameRepo(pull.repo, visit))
  ).length
}

const SHOW = "Show"

// The picker: one repository picked, the one shown to start with, or one typed as `owner/name`, an address or a
// folder's path. The pane lists each as a row (`rowsOf`); Claude Code's own dialog offers a few at most (`limit`), by
// their labels, and the rest are typed under Other. `home`, the home folder, which a clone's path starts with as `~`.
export function repoPickerQuestion(
  choices: readonly RepoChoice[],
  shown: RepoRef | null,
  limit = Infinity,
  home: string | null = null
): Question {
  const offered = choices.slice(0, limit)
  const initial = offered.findIndex((choice) => shown && sameRepo(choice.repo, shown))

  return {
    header: "Repositories",
    subject: "",
    text: "Which repository's pull requests should the pane show?",
    detail: offered.length < choices.length ? `${choices.length - offered.length} more aren't listed here.` : null,
    choices: [SHOW, CANCEL],
    main: SHOW,
    instructions: null,
    field: {
      label: offered.length > 0 ? "Or type one" : "Type one",
      placeholder: "owner/name, an address, or a folder",
      submitLabel: SHOW,
      otherHint: `${offered.length > 0 ? "Or type" : "Type"} owner/name, an address, or a folder's path under Other.`
    },
    // With none to list, the field alone asks, as Claude Code's own dialog would offer an empty list as Yes and No.
    ...(offered.length > 0
      ? {
          picking: {
            names: labelsOf(choices, home).slice(0, limit),
            isSingle: true,
            initial: initial >= 0 ? [initial] : [],
            needsPick: false,
            startsOn: "names" as const,
            // Cut alike: an Open answers with the name of its row's index.
            rows: rowsOf(choices, home, shown).slice(0, limit)
          }
        }
      : {})
  }
}

// Each repository as the pane's row shows it, under the group it is in: on this machine, as the folder's own or a
// clone, or on GitHub alone.
function rowsOf(choices: readonly RepoChoice[], home: string | null, shown: RepoRef | null): RepoRow[] {
  const names = namesOf(choices)

  return choices.map((choice, index) => ({
    group: choice.isFolder || choice.clone ? "On this machine" : "On GitHub",
    name: names[index]!,
    place: placeOf(choice, home),
    mine: choice.mine,
    requested: choice.requested,
    isNew: choice.isNew,
    isShown: shown !== null && sameRepo(choice.repo, shown)
  }))
}

// Each repository as Claude Code's own dialog lists it, on one line: its name, where it is on this machine, what waits
// there, and whether it changed lately.
function labelsOf(choices: readonly RepoChoice[], home: string | null): string[] {
  const names = namesOf(choices)

  return choices.map((choice, index) => {
    const counts = [
      ...(choice.mine > 0 ? [`${choice.mine} yours`] : []),
      ...(choice.requested > 0 ? [`${choice.requested} to review`] : [])
    ].join(" · ")
    const place = placeOf(choice, home)

    return [
      names[index]!,
      ...(place ? [place] : []),
      ...(counts ? [counts] : []),
      ...(choice.isNew ? ["new"] : [])
    ].join("  ")
  })
}

// Each repository's name, with its server where they are on more than one, so no two read alike.
function namesOf(choices: readonly RepoChoice[]): string[] {
  const isOnSeveral = new Set(choices.map((choice) => choice.repo.host.toLowerCase())).size > 1

  return choices.map((choice) => (isOnSeveral ? `${choice.repo.host}/${choice.repo.name}` : choice.repo.name))
}

// Where a repository is on this machine: the folder's own, or its clone's path, from `~` in the home folder.
function placeOf(choice: RepoChoice, home: string | null): string | null {
  return choice.isFolder ? "this folder" : choice.clone ? homeShort(choice.clone, home) : null
}

// What the person chose: a repository picked; or what they typed, read as `/prs` reads it, or why it names none; none
// on Cancel, or with nothing picked or typed. Typed under Claude Code's own Other, where the picker lists none, it
// comes with no answer of its own, and a decline there is none either. `home` as the question was asked with.
export function choiceOf(
  answer: Answer,
  choices: readonly RepoChoice[],
  home: string | null = null
): { repo: RepoRef } | { problem: string } | ReturnType<typeof readRepoInput> {
  const typed = answer.instructions.trim()
  if (answer.choice !== SHOW && (answer.choice !== null || typed === "" || isDecline(typed))) {
    return null
  }
  if (typed) {
    return (
      readRepoInput(typed) ?? {
        problem: `"${typed}" is no repository: type owner/name, an address, or a folder's path.`
      }
    )
  }
  // With none listed, Show with nothing typed says what to type.
  if (choices.length === 0) {
    return { problem: "Type a repository to show: owner/name, an address, or a folder's path." }
  }
  const picked = labelsOf(choices, home).indexOf(answer.picks?.[0] ?? "")

  return picked >= 0 ? { repo: choices[picked]!.repo } : null
}

// What the picker reaches beyond its own reading (`register.tsx`): the light check, its state, the clones, the folder's
// and the shown repository, the pane, the dialog, and showing what the person picked.
export type PickerHost = {
  // The light check once, telling nothing, where its setting is off.
  checkQuietly: () => Promise<void>
  elsewhere: () => Promise<ElsewhereState | null>
  // Notes the picker opened at `at`, which marks what changes after it as new the next time.
  markPicked: (at: number) => Promise<void>
  clones: () => Promise<NotedClone[]>
  folder: () => Promise<RepoRef | null>
  // The repository a visit shows, none for the folder's list.
  visited: () => Promise<RepoRef | null>
  // Whether the pane is open and placed, where the picker can list every repository; Claude Code's own dialog, which
  // asks where it can't, offers a few.
  isPlaced: () => Promise<boolean>
  home: () => Promise<string | null>
  now: () => Promise<number>
  // Whether a question is open already, in the pane or Claude Code's own dialog, which the picker waits its turn for.
  isAsking: () => Promise<boolean>
  // Asks the question, from the button pressed (`pressed`, where the keyboard goes back); the answer is carried out
  // (`check`) before it closes, and what kept it from working, said there, keeps it open.
  ask: (question: Question, pressed: string, check: Check) => Promise<Answer | null>
  repoAtPath: (path: string) => Promise<RepoRef | { problem: string }>
  isDemo: () => Promise<boolean>
  // Shows a repository in the pane (a visit, or the folder's list for its own), while it is still wanted, or says what
  // kept it from showing.
  show: (asked: { name: string; host: string | null }, isWanted: () => boolean) => Promise<string | null>
  notify: (text: string) => Promise<void>
  // Draws the pane again, as its button says whether the picker is getting ready.
  redraw: () => void
}

// The repository picker, which the header's Repositories button and the problem box open: the folder's repository, the
// clones noted on this machine still cloned, and those on GitHub alone where something waits (`pickerQuestion`). Its
// button says Loading… while it gets ready, and a press more does nothing then; with a question open already, it gets
// nothing ready, as that would read GitHub and use up what is marked new for a picker that isn't asked. What the person
// picks or types shows before the picker closes, and what keeps it from showing is said in it, which stays open to pick
// or type again. `pressed` is the button that opened it.
export async function askPick(host: PickerHost, session: Session, pressed: string): Promise<void> {
  if (session.isPreparingPicker) {
    return
  }
  const asked = await whilePreparing(host, session, async () =>
    (await host.isAsking()) ? null : pickerQuestion(host, session)
  )
  if (!asked) {
    await host.notify(OPEN_QUESTION_NOTE)

    return
  }
  const { question, choices, home } = asked
  await host.ask(question, pressed, (answer, isWanted) => showChosen(host, answer, choices, home, isWanted))
}

// The repository the person picked or typed, shown while it is still wanted (`isWanted`); or why it can't be: what was
// typed names none, the folder typed is in no clone, or showing it failed. A decline typed shows nothing, nor does a
// choice once a demo started while the picker asked: it covers the pane, and the choice would be a visit hidden behind
// the examples.
async function showChosen(
  host: PickerHost,
  answer: Answer,
  choices: readonly RepoChoice[],
  home: string | null,
  isWanted: () => boolean
): Promise<Carried> {
  const chosen = choiceOf(answer, choices, home)
  const named = chosen && "path" in chosen ? await host.repoAtPath(chosen.path) : chosen
  if (!named || !isWanted() || (await host.isDemo())) {
    return { isChanged: false }
  }
  if ("problem" in named) {
    return named
  }
  const problem = await host.show("repo" in named ? named.repo : named, isWanted)

  return problem === null ? { isChanged: true } : { problem }
}

// While `prepare` runs, the picker's button says it is getting ready, and a press more does nothing (`askPick`).
async function whilePreparing<T>(host: PickerHost, session: Session, prepare: () => Promise<T>): Promise<T> {
  session.isPreparingPicker = true
  host.redraw()
  try {
    return await prepare()
  } finally {
    session.isPreparingPicker = false
    host.redraw()
  }
}

// The picker's question, with the choices and home folder its answer is read with: the light check first, run once
// now where it is off, telling nothing, else waited for where one is under way, as /prs starts one on demand, so the
// picker offers what it finds. Opening it marks what is new for the next time.
async function pickerQuestion(
  host: PickerHost,
  session: Session
): Promise<{ question: Question; choices: RepoChoice[]; home: string | null }> {
  if (!session.settings.isAlertingElsewhere) {
    await host.checkQuietly()
  } else {
    await session.elsewhere.inFlight?.catch(() => undefined)
  }
  const folder = await host.folder()
  const choices = repoChoices(await host.clones(), await host.elsewhere(), folder)
  await host.markPicked(await host.now())
  const shown = (await host.visited()) ?? folder
  const limit = (await host.isPlaced()) ? Infinity : ENGINE_OPTIONS
  const home = await host.home()

  return { question: repoPickerQuestion(choices, shown, limit, home), choices, home }
}
