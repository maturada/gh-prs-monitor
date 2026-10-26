// Author: David Matura

// A visit: another repository's list, shown in the pane beside the folder's, which goes on as it was: what the person
// types to start one, the repository found as GitHub writes it, its list read as the folder's is, its own timer, and
// whether the pane is there for it.

import type { Timer, UiPane } from "claude-code"

import type { PullsSnapshot, Visit } from "../types"
import { isRepoName, readAddress } from "./args"
import { isSshAlias, readFolder } from "./clones"
import { DEFAULT_HOST, GH_MISSING, repoKey, sameRepo } from "./gh"
import type { RepoRef } from "./gh"
import { askPulls, authStatus, sessionRepo, viewRepo } from "./github"
import { linksOf, listText } from "./list"
import type { Host } from "./machine"
import { typedPath } from "./paths"
import { readPulls, storedSnapshot, withoutMerged } from "./pulls"
import { randomId } from "./session"
import type { Session } from "./session"
import { forgetListSuggestions } from "./suggestions"
import type { TicketLinks } from "./tickets"

export type VisitHost = Host & {
  now: () => Promise<number>
  every: (ms: number, tick: () => void) => Timer
  background: (work: Promise<unknown>) => void
  log: (line: string) => void
  visit: () => Promise<Visit | null>
  // A change to the visit in one write, which gives back the visit written.
  changeVisit: (change: (visit: Visit | null) => Visit | null) => Promise<Visit | null>
  // The plugin's pane as the engine lists it, none where it is closed.
  pane: () => Promise<Pick<UiPane, "isPlaced" | "isShown"> | undefined>
  // Whether a reload replaced the module this host serves, whose loads then write nothing.
  isReplaced: () => Promise<boolean>
  // A repository's ticket links as the store keeps them, none where none are set or they are off; null where the store
  // couldn't be read. And GitHub's suggested reviewers asked for a list's rows (`askSuggestions`).
  ticketLinks: (repo: RepoRef) => Promise<{ links: TicketLinks | null } | null>
  suggestReviewers: (repo: RepoRef, snapshot: PullsSnapshot) => Promise<void>
  // The folder's list as last read, none where none was; and a read of it again, which a visit's end may start.
  folderList: () => Promise<PullsSnapshot | null>
  refreshFolder: () => Promise<void>
  // Opens the pane on the visit, which an app that places no panes doesn't draw (`isPlaced` false).
  openPane: () => Promise<{ isPlaced: boolean }>
}

// Starts a visit, its list loading (`loading`), or says why it can't. The folder's own repository (`folder`, null for a
// folder with none) is no visit: it ends any, and the folder's list is the one to show (null). Only the latest asked
// for starts: one asked for after it, or a visit's end (Back), while GitHub is asked for the repository, overtakes it
// (`isOvertaken`), as does a reload, whose module this one no longer is, and the asker's no longer wanting it
// (`isWanted`), as the picker cancelled meanwhile.
export async function startVisit(
  host: VisitHost,
  session: Session,
  repo: RepoRef,
  folder: RepoRef | null,
  isWanted: () => boolean
): Promise<{ problem: string } | { loading: Promise<void> } | { isOvertaken: true } | null> {
  if (folder && sameRepo(repo, folder)) {
    if (!isWanted()) {
      return { isOvertaken: true }
    }
    await endVisit(host, session)

    return null
  }
  const start = randomId()
  session.visitStart = start
  const found = await findRepo(host, repo)
  const isLatest = () => session.visitStart === start && isWanted()
  if ((await host.isReplaced()) || !isLatest()) {
    return { isOvertaken: true }
  }
  if ("problem" in found) {
    session.visitStart = null

    return found
  }
  // Named as GitHub writes it, the folder's own may show only now, as under a name it had before a rename.
  if (folder && sameRepo(found.repo, folder)) {
    await endVisit(host, session)

    return null
  }
  const before = await host.visit()
  // Written with its first load's mark, so a pane opening on it says it is loading rather than to press ↻; and
  // only while it is still the latest asked for, which the write itself checks, as a visit's end may come in between.
  const loadId = randomId()
  const written = await host.changeVisit((visit) => {
    if (!isLatest()) {
      return visit
    }
    const kept = visit && sameRepo(visit.repo, found.repo) ? visit : null

    return {
      repo: found.repo,
      snapshot: kept?.snapshot ?? null,
      problem: null,
      loadId,
      folder: folder?.name ?? null,
      merged: kept?.merged ?? [],
      tickets: kept?.tickets ?? null
    }
  })
  if (written?.loadId !== loadId) {
    return { isOvertaken: true }
  }
  session.visitStart = null
  if (before && !sameRepo(before.repo, found.repo)) {
    forgetVisit(session, before)
  }
  const loading = loadVisit(host, session, loadId)
  host.background(loading)
  pollVisit(host, session)

  return { loading }
}

// Reads the visit's list again (`begun`: the load's mark, where its start wrote it already). Its answer is written only
// while its load is the visit's latest (a visit started or ended since, or a newer load, takes that from it), and
// nothing at all once a reload replaced this module; nothing of the folder's is written.
export async function loadVisit(host: VisitHost, session: Session, begun: string | null = null): Promise<void> {
  const visit = await host.visit()
  if (!visit || (await host.isReplaced())) {
    return
  }
  const loadId = begun ?? randomId()
  if (begun === null) {
    await host.changeVisit((current) =>
      current && sameRepo(current.repo, visit.repo) ? { ...current, loadId } : current
    )
  }
  const read = await readNamed(host, session, visit.repo)
  if (await host.isReplaced()) {
    return
  }
  // Read once the list is, and written with it, so its rows never show another repository's links; those the visit has
  // stay where the store couldn't be read.
  const tickets = "snapshot" in read ? await host.ticketLinks(read.repo) : null
  let shown = null as PullsSnapshot | null
  await host.changeVisit((current) => {
    if (current?.loadId !== loadId) {
      return current
    }
    if ("problem" in read) {
      return { ...current, problem: read.problem, loadId: null }
    }
    // Rows merged from the pane a moment ago stay merged, as the search lists them open a while longer.
    shown = withoutMerged(read.snapshot, current.merged)

    return {
      ...current,
      repo: read.repo,
      snapshot: shown,
      problem: null,
      loadId: null,
      tickets: tickets ? tickets.links : current.tickets
    }
  })
  // Renamed on GitHub: what was kept under the old name is let go.
  if ("repo" in read && !sameRepo(read.repo, visit.repo)) {
    forgetVisit(session, visit)
  }
  if (shown && "repo" in read) {
    host.background(host.suggestReviewers(read.repo, shown))
  }
}

// Back, the pane's close or a pane gone, the band's press, the picker's choice of the folder's own repository,
// `/prs demo`, `/prs` with the folder's own repository, `/clear` and a resume end a visit. Nothing is written where
// there is none, so a session that never visits writes as before. Its rows' marks stay with their presses and turns.
export async function endVisit(host: Pick<VisitHost, "visit" | "changeVisit">, session: Session): Promise<void> {
  session.visitTimer?.cancel()
  session.visitTimer = null
  session.visitStart = null
  const visit = await host.visit()
  if (visit) {
    forgetVisit(session, visit)
    await host.changeVisit(() => null)
  }
}

// Back from a visit: the folder's list, read again where it is missing or older than a check's interval, as when the
// pane was closed before the visit, or a first /prs visited on demand; else as its timer keeps it.
export async function backToFolder(host: VisitHost, session: Session): Promise<void> {
  await endVisit(host, session)
  const list = await host.folderList()
  if (!list || (await host.now()) - list.fetchedAt > session.settings.pollMs) {
    host.background(host.refreshFolder())
  }
}

// A repository chosen in the picker, shown in the pane: a visit, or, for the folder's own, the folder's list; what kept
// it from showing otherwise. Picked in Claude Code's own dialog after the pane closed, the pane opens again on it. One
// the picker no longer wants (`isWanted`), cancelled while it was looked up, shows nothing.
export async function showRepo(
  host: VisitHost,
  session: Session,
  asked: { name: string; host: string | null },
  isWanted: () => boolean
): Promise<string | null> {
  const folder = await folderOf(host, session)
  const started = await startVisit(host, session, repoNamed(asked, folder), folder, isWanted)
  if (started === null) {
    await backToFolder(host, session)
  } else if ("problem" in started) {
    return started.problem
  } else if ("isOvertaken" in started) {
    // What overtook it shows.
    return null
  }
  if (visitPlace(await host.pane()) === "gone") {
    await host.openPane()
  }

  return null
}

// `/prs owner/name`: a visit in the pane, or, where no pane shows it here (`isShownHere` false), that list printed
// once. `owner/name` is on the folder's server (`host` null), looked up only now, where no load found it yet. Null for
// the folder's own repository, however it was named: any visit ends, and /prs gives the folder's list, as with nothing
// after it.
export async function visitCommand(
  host: VisitHost,
  session: Session,
  asked: { name: string; host: string | null },
  isShownHere: boolean
): Promise<string | null> {
  const folder = await folderOf(host, session)
  const repo = repoNamed(asked, folder)
  if (!isShownHere) {
    // The folder's own, as typed or as GitHub writes it after a rename, is the folder's list.
    const read = folder && sameRepo(repo, folder) ? null : await readVisitList(host, session, repo)
    if (read && "problem" in read) {
      return read.problem
    }
    if (!read || (folder && sameRepo(read.repo, folder))) {
      await endVisit(host, session)

      return null
    }

    return visitText(host, read.snapshot, read.repo)
  }
  // The folder's own ends any visit, and is the folder's list (null).
  const started = await startVisit(host, session, repo, folder, () => true)
  if (started === null || "problem" in started) {
    return started?.problem ?? null
  }
  if ("isOvertaken" in started) {
    return `${repo.name} isn't shown, as the pane was closed or asked for something else meanwhile. Type /prs ${repo.name} to show it.`
  }
  // An app that places no panes gets the list as text, and keeps no visit.
  if (!(await host.openPane()).isPlaced) {
    await started.loading
    const visit = await host.visit()
    await endVisit(host, session)
    const snapshot = storedSnapshot(visit?.snapshot)

    return snapshot && visit
      ? visitText(host, snapshot, visit.repo)
      : (visit?.problem ?? "No pull requests loaded yet.")
  }

  return `Showing ${(await host.visit())?.repo.name ?? repo.name}'s pull requests.`
}

// A visited list as text, with its own repository's links.
async function visitText(host: VisitHost, snapshot: PullsSnapshot, repo: RepoRef): Promise<string> {
  return listText(snapshot, null, linksOf(repo), null, await host.now())
}

// Where a visit's buttons are drawn on a surface (`stableButtons`): apart from every other list's, by repository.
export function visitSite(surface: string, repo: RepoRef): string {
  return `${surface}:pane:visit:${repoKey(repo)}`
}

// A visit ended or left for another: what the session held for its rows goes, GitHub's suggested reviewers and the
// buttons last drawn on each surface.
function forgetVisit(session: Session, visit: Visit): void {
  if (visit.snapshot) {
    forgetListSuggestions(session, visit.snapshot)
  }
  const site = visitSite("", visit.repo)
  for (const drawn of [...session.drawnElements.keys()]) {
    if (drawn.endsWith(site)) {
      session.drawnElements.delete(drawn)
    }
  }
}

// A visit found as a module starts after a reload (`isReload`), or as an app attaches: one whose pane is gone ends;
// else its timer, this module's, goes on. After a reload, a load the replaced module began can never write, so it is
// forgotten, and while the pane shows the visit its list is read again, which also asks GitHub's suggested reviewers
// the new module doesn't know.
export async function resumeVisit(host: VisitHost, session: Session, isReload: boolean): Promise<void> {
  const visit = await host.visit()
  if (!visit) {
    return
  }
  const place = visitPlace(await host.pane())
  if (place === "gone") {
    await endVisit(host, session)

    return
  }
  pollVisit(host, session)
  if (!isReload) {
    // An app attaching after a while away: a list older than a check's interval is read again, as the folder's is.
    const fetchedAt = visit.snapshot?.fetchedAt
    const isOld = typeof fetchedAt !== "number" || (await host.now()) - fetchedAt > session.settings.pollMs
    if (place === "shown" && visit.loadId === null && isOld) {
      host.background(loadVisit(host, session))
    }

    return
  }
  if (visit.loadId !== null) {
    await host.changeVisit((current) => (current?.loadId === visit.loadId ? { ...current, loadId: null } : current))
  }
  if (place === "shown") {
    host.background(loadVisit(host, session))
  }
}

// A visit follows the refresh mode while the pane shows it: in background and while-open modes its timer reads its
// list again, as the folder's does; on demand, only Refresh does. Started with the visit, and again after a reload.
export function pollVisit(host: VisitHost, session: Session): void {
  if (session.visitTimer || session.settings.refresh === "on-demand") {
    return
  }
  session.visitTimer = host.every(session.settings.pollMs, () => host.background(tickVisit(host, session)))
}

async function tickVisit(host: VisitHost, session: Session): Promise<void> {
  const place = visitPlace(await host.pane())
  if (place === "gone" || !(await host.visit())) {
    await endVisit(host, session)
  } else if (place === "shown") {
    await loadVisit(host, session)
  }
}

// A visit to `repo` read again after a press, only while the pane shows it: one behind another, or undrawn, loads
// nothing, as at its timer's tick; one ended or moved on to another repository, nothing at all.
export async function reloadVisit(host: VisitHost, session: Session, repo: RepoRef): Promise<void> {
  const visit = await host.visit()
  if (visit && sameRepo(visit.repo, repo) && visitPlace(await host.pane()) === "shown") {
    await loadVisit(host, session)
  }
}

// The list of a visit whose pane is still there, as `#` in the prompt offers its rows: one Claude Code closed, which
// tells no hook, offers none.
export async function shownVisitList(host: Pick<VisitHost, "visit" | "pane">): Promise<PullsSnapshot | null> {
  const visit = await host.visit()
  if (!visit || visitPlace(await host.pane()) === "gone") {
    return null
  }

  return storedSnapshot(visit.snapshot)
}

// A visit lives only while its pane is open: one left by a close no hook heard ends, as the pane opens on the folder's
// list.
export async function endVisitWithoutPane(host: VisitHost, session: Session): Promise<void> {
  if ((await host.visit()) && visitPlace(await host.pane()) === "gone") {
    await endVisit(host, session)
  }
}

// A repository's list read once, for a /prs where no pane shows it, with no visit kept.
export async function readVisitList(
  host: VisitHost,
  session: Session,
  repo: RepoRef
): Promise<{ repo: RepoRef; snapshot: PullsSnapshot } | { problem: string }> {
  const found = await findRepo(host, repo)

  return "problem" in found ? found : readNamed(host, session, found.repo)
}

// The session's folder's repository, looked up where no load has found it yet, as after a reload or before the first
// load on demand; null for a folder with none.
export async function folderOf(host: Host, session: Session): Promise<RepoRef | null> {
  const found = await sessionRepo(host, session)

  return "repo" in found ? found.repo : null
}

// The repository as GitHub writes its name, on a server gh is signed in to, so nothing is asked of another; or why it
// can't be visited.
async function findRepo(host: Host, repo: RepoRef): Promise<{ repo: RepoRef } | { problem: string }> {
  const status = await authStatus(host, repo.host)
  if ("problem" in status) {
    return {
      problem:
        status.problem.needsSetup && status.problem !== GH_MISSING
          ? `The GitHub CLI is not signed in to ${repo.host}. Run: gh auth login --hostname ${repo.host}`
          : status.problem.message
    }
  }
  const viewed = await viewRepo(host, repo)

  return "repo" in viewed ? viewed : { problem: viewed.problem.message }
}

// The repository a name typed, or a picker's choice, names: `owner/name` on the folder's server, or on gh's default
// where the folder has none.
export function repoNamed(asked: { name: string; host: string | null }, folder: RepoRef | null): RepoRef {
  return { name: asked.name, host: asked.host ?? folder?.host ?? DEFAULT_HOST }
}

// The repository a folder's path names: of the remotes the git config of the repository it is in names, in the order gh
// picks one (`readFolder`), the first on a server the GitHub CLI is signed in to. An SSH alias
// (`git@github-work:acme/web.git`) names no server, which gh would read from the SSH config, so it counts as on the
// server of the session's folder's repository (`folder`), or gh's default where it has none, as a name typed does
// (`repoNamed`); one with a dot reads as a server (`isSshAlias`). `typed` as the person typed it, read from the home
// folder (`home`) and the session's (`cwd`) (`typedPath`); or why it names none: gh missing or GitHub out of reach as
// gh says, else the servers gh isn't signed in to.
export async function repoAtFolder(
  host: Host,
  typed: string,
  home: string | null,
  cwd: string,
  folder: RepoRef | null
): Promise<RepoRef | { problem: string }> {
  const server = folder?.host ?? DEFAULT_HOST
  const named = await readFolder(host, typedPath(typed, home, cwd))
  if (named === null) {
    return { problem: `${typed} is in no git repository: check the path.` }
  }
  const remotes = named.map((repo) => (isSshAlias(repo.host) ? { ...repo, host: server } : repo))
  if (remotes.length === 0) {
    return {
      problem: `${typed} is no clone of a GitHub repository: its git config names no remote on a GitHub server.`
    }
  }
  const servers = [...new Set(remotes.map((repo) => repo.host.toLowerCase()))]
  for (const each of servers) {
    const status = await authStatus(host, each)
    if (!("problem" in status)) {
      return remotes.find((repo) => repo.host.toLowerCase() === each)!
    }
    // gh missing, or GitHub out of reach, is said as it is: no other server would answer either.
    if (status.problem === GH_MISSING || !status.problem.needsSetup) {
      return { problem: status.problem.message }
    }
  }
  const advice = servers.includes(DEFAULT_HOST)
    ? "Run: gh auth login"
    : "For GitHub Enterprise, run: gh auth login --hostname <your server>; for an SSH alias with a dot, as github.com-work, type its owner/name instead."

  return {
    problem: `${typed} is no clone of a repository the GitHub CLI is signed in to: its remotes are on ${servers.join(", ")}. ${advice}`
  }
}

// The list as the folder's is read, the same request and reader, under the name GitHub writes now where it says the
// repository was renamed; once, as a second answer under yet another name is none to trust.
async function readNamed(
  host: VisitHost,
  session: Session,
  repo: RepoRef
): Promise<{ repo: RepoRef; snapshot: PullsSnapshot } | { problem: string }> {
  const read = await readList(host, session, repo)
  if (!("movedTo" in read)) {
    return "problem" in read ? read : { repo, snapshot: read.snapshot }
  }
  host.log(`${repo.name} is ${read.movedTo} on GitHub now: its list is read under that name`)
  const moved = { ...repo, name: read.movedTo }
  const again = await readList(host, session, moved)
  if ("movedTo" in again) {
    return { problem: `GitHub answered ${moved.name} under another name again: try once more.` }
  }

  return "problem" in again ? again : { repo: moved, snapshot: again.snapshot }
}

async function readList(
  host: VisitHost,
  session: Session,
  repo: RepoRef
): Promise<{ snapshot: PullsSnapshot } | { problem: string } | { movedTo: string }> {
  const asked = await askPulls(host, repo, session.stacklessHosts)
  if ("problem" in asked) {
    return { problem: asked.problem.message }
  }

  return readPulls(asked.ran.stdout, repo.name, await host.now(), {
    includeOutdated: session.settings.includeOutdated,
    isHidingDrafts: session.settings.isHidingDrafts
  })
}

// What the person typed to visit: a folder (a path starting with `/`, `~` or `.`, or a Windows drive); a repository's
// or pull request's address, on its own server; or `owner/name`, on the folder's (`host` null, found only once it is
// needed). Its name is as typed until GitHub says how it is written.
export function readRepoInput(text: string): { name: string; host: string | null } | { path: string } | null {
  const said = text.trim()
  if (/^([/~.]|[A-Za-z]:[\\/])/.test(said)) {
    return { path: said }
  }
  const address = readAddress(said)
  if (address) {
    return { name: address.name, host: address.host.toLowerCase() }
  }

  const name = said.replace(/\.git$/, "")

  return isRepoName(name) ? { name, host: null } : null
}

// A visit is shown while its pane is drawn in front; it waits, loading nothing, while the pane is a tab behind another
// or undrawn (an app detached); and it ends once the pane is gone, which the engine's own close tells no hook.
export function visitPlace(pane: Pick<UiPane, "isPlaced" | "isShown"> | undefined): "gone" | "waiting" | "shown" {
  if (!pane) {
    return "gone"
  }

  return pane.isPlaced && pane.isShown ? "shown" : "waiting"
}
