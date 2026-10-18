// Author: David Matura

// A press on a pull request's row, around its write: before the question, whether the pull request still stands as
// the list showed it (`lookBeforeAsking`); after the write, the refresh that follows it, or a merged row shown merged
// where it was until GitHub's search catches up (`dropMerged`), across a reload too (`resumeMerged`).

import type { Timer } from "claude-code"

import type { Answer, MergedPull, PullAction, PullRow, PullsSnapshot, Question } from "../types"
import { staleFor, staleNote } from "./actions"
import type { CurrentPull } from "./actions"
import type { Host } from "./machine"
import { CREATE_PR } from "./create-flow"
import { OPEN_QUESTION_NOTE } from "./dialog-flow"
import type { ClosedState } from "./ended"
import { messageOf } from "./gh"
import type { GhProblem, RepoRef } from "./gh"
import { currentPull, problemOf, viewRepo, WriteRefused } from "./github"
import { entryNumber, ownEntries } from "./list"
import { withoutMerged } from "./pulls"
import type { Mark, Session } from "./session"
import { statusSummary } from "./summary"

// What a press on a pull request's row reaches beyond git and gh (`Host`), handed in by the hooks module: the
// writes take it too, and a skill's run takes more (`SkillHost`).
export type PressHost = Host & {
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  after: (ms: number, fire: () => void) => Timer
  background: (work: Promise<unknown>) => void
  log: (line: string) => void
  notify: (text: string, timeoutMs: number) => Promise<void>
  // What kept gh from asking GitHub, told for as long as it needs (`notifyProblem`).
  notifyProblem: (problem: GhProblem) => Promise<void>
  // The session's state: the list, the rows shown merged, the problem shown, the demo, and the status line.
  storedList: () => Promise<PullsSnapshot | null>
  keepList: (change: (list: PullsSnapshot | null) => PullsSnapshot | null) => Promise<PullsSnapshot | null>
  merged: () => Promise<MergedPull[]>
  keepMerged: (change: (merged: MergedPull[]) => MergedPull[]) => Promise<MergedPull[]>
  problem: () => Promise<string | null>
  isDemo: () => Promise<boolean>
  setStatus: (text: string | undefined) => Promise<void>
  // A row's busy mark: checked and set in one write (`claimBusy`), or set and cleared.
  claimBusy: (mark: Mark, text: string) => Promise<boolean>
  setBusy: (mark: Mark, text: string | null) => Promise<void>
  // The plugin's dialog (`dialog-flow.ts`): a question asked, and whether one is open.
  ask: (question: Question, pressed: string) => Promise<Answer | null>
  isQuestionOpen: () => Promise<boolean>
  // A load (`refresh.ts`), the one after a write, and the cleanup of pull requests that ended (`cleanup.ts`).
  refresh: (isAlerting: boolean) => Promise<void>
  refreshAfterWrite: () => Promise<void>
  cleanUp: (repo: RepoRef, known: readonly ClosedState[]) => Promise<void>
}

// A press's work, while it holds the mark shown as `label` (`claimBusy`); nothing where another press holds it. What
// goes wrong is said, worded for the person, and a write GitHub refused reads the list again, as what it showed has
// moved on (a push, a rule, a conflict). The mark is given back as the work ends, unless a skill it started keeps it
// until its turn ends ("started", `runSkill`).
export async function pressing(
  host: PressHost,
  session: Session,
  mark: Mark,
  label: string,
  work: () => Promise<"started" | void>
): Promise<void> {
  if (!(await host.claimBusy(mark, label))) {
    return
  }
  let isStarted = false
  try {
    isStarted = (await work()) === "started"
  } catch (error) {
    const problem = problemOf(error)
    await host.notify(`${markName(mark)}: ${problem.message}`, session.settings.alertMs)
    // gh's own words, where the person's differ, for the debug log.
    if (messageOf(error) !== problem.message) {
      host.log(`${markName(mark)}: ${messageOf(error)}`)
    }
    if (error instanceof WriteRefused) {
      await settleAfterWrite(host)
    }
  } finally {
    if (!isStarted) {
      await host.setBusy(mark, null)
    }
  }
}

// How a toast names what a mark stands for: a pull request by its number, or Create PR.
export function markName(mark: Mark): string {
  return mark === CREATE_PR ? "Create PR" : `#${mark}`
}

// The write is done and said; a refresh that fails after it says nothing more, as the write did not fail.
export async function settleAfterWrite(host: PressHost): Promise<void> {
  try {
    await host.refreshAfterWrite()
  } catch (error) {
    host.log(`The refresh after a change on GitHub failed: ${messageOf(error)}`)
  }
}

// GitHub's search lists a merged pull request as open for a few seconds more, so the row shows as merged where it
// was, kept out of every refresh until the list is asked again once the search has caught up.
const SEARCH_LAG_MS = 15_000

export async function dropMerged(host: PressHost, session: Session, row: PullRow): Promise<void> {
  await session.checks.inFlight?.done.catch(() => undefined)
  // Its place in the list as drawn, among any others merged a moment ago.
  const snapshot = await host.storedList()
  const drawn = snapshot ? ownEntries(snapshot.mine, await host.merged()) : []
  const index = drawn.findIndex((entry) => entryNumber(entry) === row.number)
  const pull: MergedPull = {
    number: row.number,
    title: row.title,
    url: row.url,
    base: row.baseRefName,
    index: Math.max(0, index),
    at: await host.now()
  }
  await host.keepMerged((merged) => [...merged.filter((each) => each.number !== row.number), pull])
  const shown = await host.keepList((snapshot) => (snapshot ? withoutMerged(snapshot, [pull]) : snapshot))
  // The summary counts it no more either, unless a problem or the demo holds the status line.
  const isShowing = session.settings.isShowingStatus && !(await host.isDemo())
  if (shown && isShowing && (await host.problem()) === null) {
    await host.setStatus(statusSummary(shown))
  }
  host.after(SEARCH_LAG_MS, () => host.background(settleMerged(host, session, row.number)))
}

// Once the search has caught up, the merged pull request has left the list, and its /prs worktree can go: a
// refresh notices a pull request leaving only when the list showed it last, and this row was taken out at once.
async function settleMerged(host: PressHost, session: Session, number: number): Promise<void> {
  try {
    await host.refresh(false)
  } finally {
    await host.keepMerged((merged) => merged.filter((each) => each.number !== number))
  }
  if (session.settings.isCleaningUp && session.repo) {
    await host.cleanUp(session.repo, [])
  }
}

// A merged row waits on a timer of the module that showed it; after a reload it waits out the rest of its time,
// so a refresh the reload starts cannot bring it back as open while the search still lists it.
export async function resumeMerged(host: PressHost, session: Session): Promise<void> {
  const now = await host.now()
  const merged = await host.keepMerged((all) => all.filter((pull) => now - pull.at < SEARCH_LAG_MS))
  for (const pull of merged) {
    host.after(SEARCH_LAG_MS - (now - pull.at), () => host.background(settleMerged(host, session, pull.number)))
  }
}

// What a press finds before it asks: whether it goes on, the repository it acts on, and the pull request as GitHub has
// it then, null where that could not be read.
export type Look = { isGoing: false } | { isGoing: true; repo: RepoRef; current: CurrentPull | null }

// Before a question: none may be open already, and the pull request must still stand as the list, which can be
// minutes old, showed it. One it moved past is said so and shown as it is now: one of your own merged turns ✓ Merged
// where it was, anything else refreshes the list. A lookup that fails lets the press go on, GitHub having the last word
// on any write, unless gh needs setting up, which no write gets past; nor one without its repository, which a press
// before any load since a reload looks up here.
export async function lookBeforeAsking(
  host: PressHost,
  session: Session,
  action: PullAction,
  row: PullRow
): Promise<Look> {
  if (await host.isQuestionOpen()) {
    await host.notify(OPEN_QUESTION_NOTE, session.settings.alertMs)

    return { isGoing: false }
  }
  const known = await sessionRepo(host, session)
  if ("problem" in known) {
    await host.notifyProblem(known.problem)

    return { isGoing: false }
  }
  // A list kept over a reload may be of another repository than the one this session's folder is in now: its number
  // names another pull request there.
  const list = await host.storedList()
  if (list && list.repo.toLowerCase() !== known.repo.name.toLowerCase()) {
    await host.notify(
      `#${row.number}: the list is of ${list.repo}, and this session is in ${known.repo.name} now; reading it again`,
      session.settings.alertMs
    )
    await settleAfterWrite(host)

    return { isGoing: false }
  }
  const found = await currentPull(host, known.repo, row.number, { withBase: action === "updateBranch" })
  if ("problem" in found && found.problem.needsSetup) {
    await host.notifyProblem(found.problem)

    return { isGoing: false }
  }
  const current = "pull" in found ? found.pull : null
  const stale = current ? staleFor(action, row, current) : null
  if (stale === null) {
    return { isGoing: true, repo: known.repo, current }
  }
  const isOwn = list?.mine.some((each) => each.number === row.number) ?? false
  const isShownMerged = stale === "merged" && isOwn
  await host.notify(staleNote(row, stale, isShownMerged), session.settings.alertMs)
  await (isShownMerged ? dropMerged(host, session, row) : settleAfterWrite(host))

  return { isGoing: false }
}

// The session's repository for a press or a typed skill, looked up here where no load has found it since a reload. What
// kept it from being found is the loads' to show, and to stop the checks for: a press may end after a load that worked.
export async function sessionRepo(host: Host, session: Session): Promise<{ repo: RepoRef } | { problem: GhProblem }> {
  if (session.repo) {
    return { repo: session.repo }
  }
  const viewed = await viewRepo(host)
  if ("repo" in viewed) {
    session.repo ??= viewed.repo
  }

  return session.repo ? { repo: session.repo } : viewed
}

// --- A row's busy mark ---

// What each row at work shows in place of its buttons, by its mark (`Mark`).
export type BusyMarks = Readonly<Record<string, string>>

// The marks with `mark` claimed for `label`; null where it is held already, so two quick presses cannot both start a
// flow for the same pull request.
export function claimedBusy(all: BusyMarks, mark: Mark, label: string): BusyMarks | null {
  return all[String(mark)] ? null : { ...all, [String(mark)]: label }
}

// The marks with `mark` showing `label`, or with none.
export function withBusy(all: BusyMarks, mark: Mark, label: string | null): BusyMarks {
  const { [String(mark)]: _was, ...rest } = all

  return label ? { ...rest, [String(mark)]: label } : rest
}

// The marks without `mark` where it still shows `label`: one taken for other work since stays.
export function withoutBusyIf(all: BusyMarks, mark: Mark, label: string): BusyMarks {
  return all[String(mark)] === label ? withBusy(all, mark, null) : all
}
