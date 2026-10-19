// Author: David Matura

// The bundled skills' runs: Review, Resolve Comments, Fix CI and Resolve Conflicts started from a row's button
// (`review`, `workOnBranch`), and Create PR from its own (`createPull`, with GitHub's lookup of the branch's pull
// requests): here, in a worktree, or typed into a new session; and each skill turn's life — the row it marks while it
// works, typed or pressed, given back as it ends, and the list following the skill for half an hour.

import type { CheckoutAt, PullRow } from "../types"
import { ACTION_LABELS } from "./actions"
import { branchPlaceQuestion, readPlaceAnswer, skillArgs } from "./branch-flow"
import type { BranchSkill, SkillArgs } from "./branch-flow"
import { lookUpBranch } from "./branch-lookup"
import type { BranchLookupHost } from "./branch-lookup"
import {
  checkedOut,
  checkedOutBranch,
  currentBranch,
  mainRoot,
  prepareWorktree,
  switchHere,
  uncommittedChanges
} from "./checkout"
import { ensureDependencies, FORK_DEPS_NOTE } from "./deps"
import { branchPullsOf, CREATE_PR, createArgs, createPlaceQuestion, pullToOpen } from "./create-flow"
import type { PullToOpen } from "./create-flow"
import { pullNumberOf, pullRefIn } from "./args"
import { messageOf } from "./gh"
import type { RepoRef } from "./gh"
import {
  canOpenInWorktree,
  canOpenSession,
  linkRefusal,
  newSessionLink,
  openLink,
  runsHereWhenUnopened,
  sessionAppFor
} from "./new-session"
import type { SessionApp } from "./new-session"
import { buttonKey } from "./keys"
import { lookBeforeAsking, markName, pressing, sessionRepo } from "./press"
import type { PressHost } from "./press"
import { isOnBranch, pullOnBranch, storedSnapshot } from "./pulls"
import { readSessionAnswer } from "./question"
import type { SessionPlace } from "./question"
import { reviewArgs, reviewPlaceQuestion } from "./review-flow"
import type { Mark, Session, SkillMark, SkillStart } from "./session"

// What a bundled skill's run reaches beyond a press's (`PressHost`), handed in by the hooks module.
export type SkillHost = PressHost &
  BranchLookupHost & {
    // The session's checkout as git says now, and kept unless one read later is (`newerCheckout`).
    checkoutNow: () => Promise<CheckoutAt>
    keepCheckout: (checkout: CheckoutAt) => Promise<CheckoutAt>
    // The folder the session works in.
    cwd: () => Promise<string>
    // A line in the conversation, which stays where a toast goes in seconds.
    inConversation: (line: string) => void
    // The plugin's own run of a command, which passes its own `command.run` hooks by (`runSkill` marks the row).
    runCommand: (command: string, args: string) => Promise<unknown>
    // Gives a row its buttons back, unless something else has marked it since.
    clearBusyIf: (mark: Mark, label: string) => Promise<unknown>
    // Whether checks run now (`isCheckingMode`, refresh.ts).
    isCheckingMode: () => Promise<boolean>
    // The scheme of the editor the VS Code extension runs in, or null where it isn't found (`editorScheme`).
    editorScheme: () => Promise<string | null>
  }

export const RESOLVE_COMMAND = "gh-prs-monitor:resolve-comments"

export const REVIEW_COMMAND = "gh-prs-monitor:review"

const FIX_CI_COMMAND = "gh-prs-monitor:fix-ci"

const RESOLVE_CONFLICTS_COMMAND = "gh-prs-monitor:resolve-conflicts"

const CREATE_PR_COMMAND = "gh-prs-monitor:create-pr"

// The bundled skills, by command: what the row of a pull request says in place of its buttons while one waits for a
// running turn to end, and then while its own turn runs.
export const SKILLS: Readonly<Record<string, { queued: string; atWork: string }>> = {
  [RESOLVE_COMMAND]: { queued: "Resolving Comments Starts When This Turn Ends", atWork: "Resolving Comments…" },
  [REVIEW_COMMAND]: { queued: "Review Starts When This Turn Ends", atWork: "Reviewing…" },
  [FIX_CI_COMMAND]: { queued: "Fixing CI Starts When This Turn Ends", atWork: "Fixing CI…" },
  [RESOLVE_CONFLICTS_COMMAND]: {
    queued: "Resolving Conflicts Starts When This Turn Ends",
    atWork: "Resolving Conflicts…"
  },
  [CREATE_PR_COMMAND]: { queued: "Create PR Starts When This Turn Ends", atWork: "Creating PR…" }
}

// Those that work on a pull request's branch, by the action that starts them.
const BRANCH_SKILLS: Readonly<Record<BranchSkill, string>> = {
  resolve: RESOLVE_COMMAND,
  fixCi: FIX_CI_COMMAND,
  resolveConflicts: RESOLVE_CONFLICTS_COMMAND
}

// --- The skill turn's life ---

// For half an hour after a skill started, each finished turn refreshes the list, at most every half minute, when
// `isCheckingMode` has checks run. A problem that stopped the checks stops these too.
const SKILL_FOLLOW_MS = 30 * 60_000

const FOLLOW_GAP_MS = 30_000

async function followSkill(host: SkillHost, session: Session): Promise<void> {
  const now = await host.now()
  if (session.skills.startedAt === null || now - session.skills.startedAt > SKILL_FOLLOW_MS) {
    session.skills.startedAt = null

    return
  }
  if (!(await host.isCheckingMode()) || session.checks.isStopped || now - session.skills.lastFollowAt < FOLLOW_GAP_MS) {
    return
  }
  session.skills.lastFollowAt = now
  // Nobody asked for this refresh, so what it finds is alerted, as the timer's is.
  await host.refresh(true)
}

// Once no turn of the main loop runs.
async function whenIdle(session: Session): Promise<void> {
  if (session.runningTurns.size > 0) {
    await new Promise<void>((resolve) => session.idleWaiters.push(resolve))
  }
}

// The command waits for a running turn to end, which the row says meanwhile. Once it has run, the skill's turn is the
// next to start (`skills.starting`), within a moment: the row says the skill is at work from then on, so it can't be
// started twice, and its turn's end gives the buttons back. The caller leaves the row to it.
async function runSkill(host: SkillHost, session: Session, command: string, args: string, mark: Mark): Promise<void> {
  if (session.runningTurns.size > 0) {
    await host.setBusy(mark, SKILLS[command]!.queued)
  }
  try {
    await host.runCommand(command, args)
  } catch (error) {
    throw new Error(`could not run /${command}: ${messageOf(error)}`)
  }
  session.skills.starting.push({ command, mark, args })
  await host.setBusy(mark, SKILLS[command]!.atWork)
  session.skills.startedAt = await host.now()
}

// What a skill's turn marks: what was pressed for it; for a typed skill the pull request its arguments name, or for a
// bare Resolve Comments, Fix CI or Resolve Conflicts the one on the checked-out branch, as the skill finds it itself;
// for Create PR its button.
export async function markSkillTurn(host: SkillHost, session: Session, skill: SkillStart): Promise<SkillMark | null> {
  const mark = skill.mark ?? (skill.command === CREATE_PR_COMMAND ? CREATE_PR : await typedPull(host, session, skill))
  if (mark === null) {
    return null
  }
  const marked = { mark, label: SKILLS[skill.command]!.atWork }
  await host.setBusy(mark, marked.label)

  return marked
}

async function typedPull(host: SkillHost, session: Session, skill: SkillStart): Promise<number | null> {
  const ref = pullRefIn(skill.args)
  if (ref !== null) {
    const known = await sessionRepo(host, session)

    return pullNumberOf(ref, "repo" in known ? known.repo : null)
  }
  if (!Object.values(BRANCH_SKILLS).includes(skill.command)) {
    return null
  }
  const branch = await checkedOutBranch(host)

  return pullOnBranch(await host.storedList(), branch)
}

// Gives the row its buttons back, unless something else has marked it since.
async function unmarkSkillTurn(host: SkillHost, mark: Promise<SkillMark | null>): Promise<void> {
  const marked = await mark
  if (marked) {
    await host.clearBusyIf(marked.mark, marked.label)
  }
}

export function skillTurnStarted(host: SkillHost, session: Session, turnId: string): void {
  // A skill's command starts its turn as it runs, so the first turn to start after it is the skill's.
  const skill = session.skills.starting.shift()
  if (skill) {
    const mark = markSkillTurn(host, session, skill)
    session.skills.turns.set(turnId, mark)
    host.background(mark)
  }
}

// A turn ended: a skill's gives its row back, and the main loop's lets the list follow the skill.
export function skillTurnEnded(host: SkillHost, session: Session, turnId: string, isMainLoop: boolean): void {
  // Answered, interrupted or failed, the skill's turn is over: it waits in the conversation, or is done.
  const mark = session.skills.turns.get(turnId)
  if (mark) {
    session.skills.turns.delete(turnId)
    host.background(unmarkSkillTurn(host, mark))
  }
  // A subagent's turns run inside the turn that spawned it, which the list follows once it ends.
  if (session.skills.startedAt !== null && isMainLoop) {
    host.background(followSkill(host, session))
  }
}

// What an install says as it starts: each marks the row with its command; the first alone is told, as the others of
// the same checkout follow it.
export function installNotices(host: SkillHost, session: Session, number: number): (command: string) => void {
  let isInstalling = false

  return (command) => {
    host.background(host.setBusy(number, `Installing Dependencies (${command})…`))
    if (!isInstalling) {
      host.background(
        host.notify(
          `#${number}: installing dependencies (${command}); this can take a few minutes`,
          session.settings.alertMs
        )
      )
    }
    isInstalling = true
  }
}

// --- Review, Resolve Comments, Fix CI and Resolve Conflicts ---

// Asks whether to review here or in a new session where the person's surface can open one (`canOpenSession`);
// elsewhere it starts here.
export async function review(host: SkillHost, session: Session, row: PullRow, surface: string): Promise<void> {
  await pressing(host, session, row.number, "Checking…", async () => {
    if (!(await lookBeforeAsking(host, session, "review", row)).isGoing) {
      return
    }
    const place: SessionPlace = canOpenSession(surface) ? await askReviewPlace(host, session, row) : { kind: "here" }
    if (place.kind === "cancel") {
      return
    }
    const args = reviewArgs(row.url, place.note)
    const here = async (): Promise<"started"> => {
      await host.setBusy(row.number, "Starting Review…")
      await runSkill(host, session, REVIEW_COMMAND, args, row.number)

      return "started"
    }
    if (place.kind !== "new" || !canOpenSession(surface)) {
      return here()
    }

    return typeIntoNewSession(host, session, {
      mark: row.number,
      app: await sessionAppFor(surface, host.editorScheme),
      folder: await host.cwd(),
      prompt: `/${REVIEW_COMMAND} ${args}`,
      typed: "the review is typed into a new session",
      here
    })
  })
}

async function askReviewPlace(host: SkillHost, session: Session, row: PullRow): Promise<SessionPlace> {
  const question = reviewPlaceQuestion(row, session.runningTurns.size > 0)
  const answer = await host.ask(question, buttonKey("review", row.number))

  return answer === null ? { kind: "cancel" } : readSessionAnswer(answer)
}

export async function workOnBranch(
  host: SkillHost,
  session: Session,
  skill: BranchSkill,
  row: PullRow,
  surface: string
): Promise<void> {
  await pressing(host, session, row.number, "Checking…", async () => {
    const look = await lookBeforeAsking(host, session, skill, row)
    if (!look.isGoing) {
      return
    }
    const base: SkillArgs = { includeOutdated: skill === "resolve" && session.settings.includeOutdated }
    const branch = await currentBranch(host)
    const checkout: AskedCheckout = {
      branch,
      head: (await checkedOut(host)).head,
      changes: await uncommittedChanges(host)
    }
    const isHere = isOnBranch(row, branch)
    // git names a checkout on no branch "HEAD".
    const state = { uncommitted: checkout.changes.length, isDetached: branch === "HEAD", isOnBranch: isHere }
    const isWorking = session.runningTurns.size > 0
    const question = branchPlaceQuestion(skill, row, state, canOpenSession(surface), isWorking)
    const answer = await host.ask(question, buttonKey(skill, row.number))
    const place = answer === null ? ({ kind: "cancel" } as const) : readPlaceAnswer(answer)
    if (place.kind === "cancel") {
      return
    }
    const work = { host, session, skill, row, repo: look.repo, base, note: place.note }
    if (place.kind === "here") {
      return workHere(work, isHere ? null : checkout)
    }
    const newSession =
      place.isNewSession && canOpenSession(surface) ? await sessionAppFor(surface, host.editorScheme) : null

    return workInWorktree(work, newSession)
  })
}

// A branch skill's run, as the person asked for it.
type BranchWork = {
  host: SkillHost
  session: Session
  skill: BranchSkill
  row: PullRow
  repo: RepoRef
  base: SkillArgs
  note?: string
}

// The checkout as the question about where to work described it.
type AskedCheckout = { branch: string; head: string | null; changes: string[] }

// The skill runs in this checkout, switched to the pull request's branch first unless it is on it (`switchFrom` null).
// One switch of this checkout at a time, and no work started here while one waits or runs: a second would leave a
// branch other than the one its question named, and work on this branch would find another under it.
async function workHere(work: BranchWork, switchFrom: AskedCheckout | null): Promise<"started" | void> {
  const { host, session, skill, row } = work
  const press = ACTION_LABELS[skill]
  if (session.switchingFor !== null) {
    const other = `#${session.switchingFor}`
    await host.notify(
      `#${row.number}: ${other} is switching this checkout; press ${press} again once it is done`,
      session.settings.alertMs
    )

    return
  }
  if (switchFrom !== null) {
    session.switchingFor = row.number
  }
  try {
    let deps: string | undefined
    if (switchFrom !== null) {
      if (!(await isCheckoutAsAsked(work, switchFrom))) {
        await host.notify(
          `#${row.number}: this checkout changed since you were asked, so it was not switched; press ${press} again to choose`,
          session.settings.alertMs
        )

        return
      }
      await host.setBusy(row.number, "Switching Branch…")
      deps = await switchHere(host, row, work.repo, installNotices(host, session, row.number))
    }
    const args = skillArgs(row.url, { ...work.base, deps, note: work.note })
    await runSkill(host, session, BRANCH_SKILLS[skill], args, row.number)

    return "started"
  } finally {
    if (switchFrom !== null) {
      session.switchingFor = null
    }
  }
}

// A turn under way works in this checkout, so the switch waits for it to end. A checkout changed since the question,
// by a turn or by hand (another branch, a commit, a change), is left as it is: what the question said would go along
// is no longer all. A prompt the person queued starts the next turn as one ends, which is waited for too, and the
// checkout looked at again after it.
async function isCheckoutAsAsked({ host, session, row }: BranchWork, asked: AskedCheckout): Promise<boolean> {
  let isSame: boolean
  do {
    while (session.runningTurns.size > 0) {
      await host.setBusy(row.number, "Switches Branch When This Turn Ends")
      await whenIdle(session)
    }
    isSame =
      (await currentBranch(host)) === asked.branch &&
      (await checkedOut(host)).head === asked.head &&
      (await uncommittedChanges(host)).join("\n") === asked.changes.join("\n")
  } while (isSame && session.runningTurns.size > 0)

  return isSame
}

// The skill runs in the pull request's worktree, in this session, or in a new one `newSession` opens there.
async function workInWorktree(work: BranchWork, newSession: SessionApp | null): Promise<"started" | void> {
  const { host, session, skill, row } = work
  const command = BRANCH_SKILLS[skill]
  await host.setBusy(row.number, "Preparing Worktree…")
  const worktree = await prepareWorktree(host, row, work.repo)
  if (worktree.warning) {
    await host.notify(`#${row.number}: ${worktree.warning}`, session.settings.alertMs)
  }
  const deps = row.isCrossRepository
    ? FORK_DEPS_NOTE
    : await ensureDependencies(host, worktree.path, installNotices(host, session, row.number))
  const here = async (): Promise<"started"> => {
    const args = skillArgs(row.url, { ...work.base, worktree: worktree.path, deps, note: work.note })
    await runSkill(host, session, command, args, row.number)

    return "started"
  }
  if (!newSession) {
    return here()
  }
  // A session opened in the worktree works there from the start; one opened elsewhere is told the worktree to enter.
  const isInWorktree = canOpenInWorktree(newSession)
  const worktreeArg = isInWorktree ? undefined : worktree.path
  const args = skillArgs(row.url, { ...work.base, worktree: worktreeArg, deps, note: work.note })

  return typeIntoNewSession(host, session, {
    mark: row.number,
    app: newSession,
    folder: isInWorktree ? worktree.path : await mainRoot(host),
    prompt: `/${command} ${args}`,
    typed: `${ACTION_LABELS[skill]} is typed into a new session for its worktree`,
    here
  })
}

// A new session's work: what it marks, the app and folder it opens in, the command typed in, what the alert says once
// it opened, and the same work in this session (`here`), for where its link can't be opened (`runsHereWhenUnopened`).
type NewSessionWork = {
  mark: Mark
  app: SessionApp
  folder: string
  prompt: string
  typed: string
  here: () => Promise<"started">
}

// A session of the person's own opens with the command typed in, for them to send: in `folder`, where its link names
// one. The command names the pull request by its address, so the skill finds it wherever that session is.
async function typeIntoNewSession(
  host: SkillHost,
  session: Session,
  { mark, app, folder, prompt, typed, here }: NewSessionWork
): Promise<"started" | void> {
  await host.setBusy(mark, "Opening A New Session…")
  try {
    const refusal = linkRefusal(prompt)
    if (refusal) {
      throw new Error(refusal)
    }
    await openLink(host, newSessionLink(app, folder, prompt))
  } catch (error) {
    if (runsHereWhenUnopened(app)) {
      const note = `${markName(mark)}: no new session opened (${messageOf(error)}), so it runs in this one`
      await host.notify(note, session.settings.alertMs)

      return here()
    }
    const message = `could not open a new session (${messageOf(error)}); in ${folder}, type ${prompt} into one yourself`
    // A toast goes in seconds and may be cut to a line; the conversation keeps the command to copy.
    host.inConversation(`${markName(mark)}: ${message}`)
    throw new Error(message)
  }
  await host.notify(`${markName(mark)}: ${typed}; send it there`, session.settings.alertMs)
}

// --- Create PR ---

// Opens a pull request from the session's branch with the create-pr skill, here or in a new session where the
// person's surface can open one. The branch is read again first, as one switched since the list was drawn goes on
// with the switch: the button then goes where it has none to open.
export async function createPull(host: SkillHost, session: Session, surface: string): Promise<void> {
  await pressing(host, session, CREATE_PR, "Checking The Branch…", async () => {
    const { branch, head } = await host.keepCheckout(await host.checkoutNow())
    // A press before any load since a reload finds the repository itself, so GitHub is still asked.
    const known = await sessionRepo(host, session)
    const look = "repo" in known ? await lookUpBranch(host, session, known.repo, branch, head, true) : null
    // Where the repository or the branch could not be looked up as gh needs setting up, the skill could do nothing
    // either.
    const problem = "problem" in known ? known.problem : look && "problem" in look ? look.problem : null
    if (problem?.needsSetup) {
      await host.notifyProblem(problem)

      return
    }
    const looked = look && "looked" in look ? look.looked : null
    const snapshot = storedSnapshot(await host.storedList())
    // Where GitHub could not be asked, the create-pr skill looks again before it opens one.
    const unknown = snapshot && branch && head ? branchPullsOf(snapshot, branch, head, false) : null
    const toOpen = pullToOpen(snapshot, branch, head, looked ?? unknown)
    if (!toOpen) {
      await host.notify(NOTHING_TO_OPEN_NOTE, session.settings.alertMs)

      return
    }
    const place: SessionPlace = canOpenSession(surface) ? await askCreatePlace(host, session, toOpen) : { kind: "here" }
    if (place.kind === "cancel") {
      return
    }
    const here = async (): Promise<"started"> => {
      await host.setBusy(CREATE_PR, "Starting Create PR…")
      const args = createArgs({ branch: toOpen.branch, note: place.note })
      await runSkill(host, session, CREATE_PR_COMMAND, args, CREATE_PR)

      return "started"
    }
    if (place.kind !== "new" || !canOpenSession(surface)) {
      return here()
    }
    const app = await sessionAppFor(surface, host.editorScheme)
    const folder = await host.cwd()
    // The desktop app opens a session for a worktree at the repository's root, and VS Code at the window's folder, so
    // either is told where the branch is.
    const worktree = canOpenInWorktree(app) ? undefined : folder
    const args = createArgs({ branch: toOpen.branch, worktree, note: place.note })

    return typeIntoNewSession(host, session, {
      mark: CREATE_PR,
      app,
      folder,
      prompt: `/${CREATE_PR_COMMAND} ${args}`,
      typed: "its command is typed into a new session",
      here
    })
  })
}

const NOTHING_TO_OPEN_NOTE =
  "No pull request to open from this session's branch now: it changed, or one is open for it."

async function askCreatePlace(host: SkillHost, session: Session, toOpen: PullToOpen): Promise<SessionPlace> {
  const question = createPlaceQuestion(toOpen.branch, toOpen.base, session.runningTurns.size > 0)
  const answer = await host.ask(question, CREATE_PR)

  return answer === null ? { kind: "cancel" } : readSessionAnswer(answer)
}
