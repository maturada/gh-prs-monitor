// Author: David Matura

// The machine the hooks module's tests run against: gh, git and the system answer from a world each test sets up,
// and the engine's own nouns are mocked through the test kit. Shared by the *.test.tsx files beside this folder.

import type {
  On,
  ProcessRunResult,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
  PromptOrigin,
  RenderSurface
} from "claude-code"
import { mock } from "claude-code/testing"
import type { Engine, MockClock, MockClockOptions, Mounted } from "claude-code/testing"

import type { PullsSnapshot } from "../../types"
import { readPulls, SNAPSHOT_SCHEMA } from "../pulls"
import { MINUTE, response, snapshotOf } from "./fixtures"
import { ghReposAnswer, pullLookAnswer, suggestionsAnswer } from "./gh-repos"
import type { GhRepos, PullNow } from "./gh-repos"
import type { ResponseFixture } from "./fixtures"
import { lineOf } from "./git-host"
import { storeDelete, storeGet, storeKeys, storeSet } from "./memory-store"
import type { StoreWorld } from "./memory-store"

export const PLUGIN = "gh-prs-monitor"
export const SURFACES: readonly RenderSurface[] = ["terminal", "desktop", "vscode", "mobile"]
export { MINUTE }

// An editor's app folder, as its extension host's messages file and product file lie in it.
const EDITOR_APP = "/Applications/Editor.app/Contents/Resources/app"
const EDITOR_MESSAGES = `${EDITOR_APP}/out/nls.messages.json`
const EDITOR_PRODUCT = `${EDITOR_APP}/product.json`

export type World = StoreWorld & GhRepos & WorldState

// What a test sets for its machine, besides its store and the other repositories GitHub has (`gh-repos.ts`).
type WorldState = {
  // What the next GraphQL query answers; swapped by a test to move GitHub on.
  github: ResponseFixture
  // While set, the light check of other repositories waits for it before GitHub answers, so a test can act while one
  // is under way.
  elsewhereGate?: Promise<void>
  // The environment's variables a test sets or takes away (undefined), over the person's home, /Users/me.
  env?: Record<string, string | undefined>
  branch: string
  // The commit the checkout is on; one of its own unless given, as a pull request's head is `head-<number>`.
  head?: string
  uncommitted: number
  // What git names in the way of switching this folder to a pull request's head: files it doesn't track here, where
  // the head has one.
  inTheWay?: string[]
  // The pull request's head a switch fetched last, as git then names it.
  fetched?: string
  // Thrown by `gh` itself, as when it is not installed.
  isGhMissing?: boolean
  // True while gh starts but the list query outlives its timeout, so the run rejects.
  isListHanging?: boolean
  // True for a server without stacked pull requests (GitHub Enterprise Server), which refuses a query naming them.
  isStackless?: boolean
  repoViewFailure?: string
  // Where the remote points; github.com unless a test stands for GitHub Enterprise. And the repository gh finds
  // there, acme/app unless a test moved the folder to another.
  repoUrl?: string
  repoName?: string
  // The repository's name on GitHub, where it was renamed or moved from the one the folder's remote names.
  movedTo?: string
  graphqlFailure?: { stdout: string; stderr: string }
  // Whom GitHub suggests to review each pull request, by number (`suggestions.ts`): nobody unless given.
  suggested?: Record<number, string[]>
  checkoutFailure?: string
  isPaneOpen?: boolean
  // Which apps draw the session; the terminal unless a test stands for another.
  surfaces?: RenderSurface[]
  // The git config of each folder a repository is cloned in on this machine, by the folder's path; and other files on
  // it the plugin reads, by their path, as a worktree's `.git` file.
  gitConfigs?: Record<string, string>
  files?: Record<string, string>
  // False where the attached app places no panes, as an older desktop app.
  placesPanes?: boolean
  // True while another pane is in front of the plugin's, which is then a tab behind it.
  isPaneBehind?: boolean
  answer?: string
  // Instructions the person types in the pane's field before pressing the answer.
  instructions?: string
  // The names the person picks in the pane before pressing the answer, where the question offers some; in the
  // repository picker, the row named so is opened, which answers.
  picks?: string[]
  // Claude Code's own dialog answered in steps, one answer each, in order; `answer` once these run out.
  engineAnswers?: string[]
  // What changes on GitHub while the question is open, before the person answers.
  whileAsking?: () => void
  asked?: number
  // The last question the dialog asked, its header, and the choices it offered; the pane's also its subject and the
  // detail under the question.
  question?: string
  header?: string
  subject?: string
  detail?: string
  choices?: string[]
  // The repository picker's rows as drawn, the words of each.
  rows?: string[]
  // How long the person takes to answer the dialog.
  slowDialogMs?: number
  // What `uname -s` answers: macOS unless a test stands for another system.
  system?: string
  // What the system's link opener says when it cannot open a link.
  openFailure?: string
  // The editor the VS Code extension runs in, where a test stands for one: the scheme its product file names, found
  // through the messages file its extension host is handed (`editorScheme`), and how often that file was read. None
  // unless given.
  editor?: { scheme: string; reads?: number }
  // How pull requests that left the lists ended, and their last commit (`head-<n>` unless given).
  // Each with the branch it came from: by default the one its /prs worktree holds.
  closed?: { number: number; state: string; by: string | null; head?: string; branch?: string; isFork?: boolean }[]
  // Worktrees /prs made, by pull request: the branch each holds, whether files in it changed, and its commit.
  pullWorktrees?: { number: number; branch: string; isChanged?: boolean; tip?: string }[]
  // The paths on disk that are symbolic links, spelt as the file system keeps them; it ignores case, as macOS's does.
  links?: string[]
  // The pr-<number> branches a switch here left in this folder, whether it is still on one, and what each tracks:
  // its pull request's head unless said otherwise ("" for none, as a branch made by hand).
  pullBranches?: { number: number; tip?: string; isCheckedOut?: boolean; upstream?: string }[]
  // The folder the session works in; the repository's unless given.
  cwd?: string
  // Another session removes the worktrees, with their branches, as this one looks up how their pull requests ended.
  isTakenByAnother?: boolean
  // The check suites of a pull request's latest commit.
  suites?: unknown[]
  // What gh says when a merge, branch update, re-run or ready for review fails, and how long one takes.
  writeFailure?: string
  slowWriteMs?: number
  // gh's answer when the branch had nothing to bring in.
  isUpToDate?: boolean
  // Runs gh refuses to re-run, by id.
  refusedReruns?: number[]
  // The stack the pull requests are in, bottom first, as GitHub's REST API lists it; and what its asynchronous merge
  // answers: the first to the request, the rest to each look at it after.
  stack?: { number: number; base: string; pulls: { number: number; title: string; state: "open" | "closed" }[] }
  // True while GitHub can't be asked how a pull request stands now.
  isLookupFailing?: boolean
  // How a pull request stands on GitHub now, where it moved on since the list was read.
  current?: Record<number, PullNow>
  asyncMerge?: string[]
  asyncLooks?: number
  // How long GitHub takes to answer each look at an asynchronous merge.
  slowLookMs?: number
  // How long GitHub takes to answer a press's look at its pull request.
  slowPullMs?: number
  // The last merge gh made, and whether the base branch queues merges instead.
  lastMerge?: "merge" | "auto"
  hasMergeQueue?: boolean
  // The pull request's latest commit when the failed runs are asked for; its row's head unless given.
  runsHeadOid?: string
  // How long the pull request query takes to answer, on the test's clock; and the lookup of how pull requests ended,
  // cut at its timeout as gh is.
  slowGithubMs?: number
  slowClosedMs?: number
  // How long git takes to check a pull request out.
  slowCheckoutMs?: number
  // How long a skill's command waits before it runs, as behind a running turn.
  slowCommandMs?: number
  // What a skill's command fails with.
  commandFailure?: string
  // The pull requests from the session's branch GitHub lists, newest first, as Create PR looks them up: their number
  // (`<index + 1>` unless given), state and last commit (`head-<index>` unless given); none unless given.
  branchPulls?: { number?: number; state: "OPEN" | "MERGED" | "CLOSED"; head?: string; isFork?: boolean }[]
  // The pull requests GitHub has a commit among the commits of, by commit, as that lookup asks of the checkout's, with
  // the commit each one's merge made on the base, where it merged.
  associated?: Record<string, { number: number; state: "OPEN" | "MERGED" | "CLOSED"; mergeCommit?: string }[]>
  // True while that lookup fails, and how long it takes to answer.
  isBranchPullsFailing?: boolean
  slowBranchPullsMs?: number
  // True while gh is signed out: every request fails as gh says then. And how long `gh repo view` takes.
  isSignedOut?: boolean
  slowRepoViewMs?: number
  // Commits that came after another, as `<earlier>..<later>`, for `git merge-base --is-ancestor` and GitHub's compare.
  laterCommits?: string[]
  // Commits this clone lacks, as pushed from elsewhere and never fetched, which git can't place; and commits GitHub
  // lacks, never pushed, which its compare can't find; and the compare failing, as GitHub down.
  missingCommits?: string[]
  unpushedCommits?: string[]
  isCompareFailing?: boolean
  // A turn that starts as the plugin next looks at the checkout's changes, as a prompt queued behind a turn starts the
  // next one as that ends.
  queuedTurn?: string
}

// A look at an asynchronous merge that times out (`World.asyncMerge`).
export const TIMED_OUT = "timed out"

export type Seen = {
  sounds: string[]
  runs: string[]
  toasts: string[]
  notices: string[]
  toastDurations: (number | undefined)[]
  statuses: (string | undefined)[]
  commands: string[]
  // The tools the plugin registered for the model, by the name it calls them.
  tools: string[]
  // The lines the plugin wrote to the debug log.
  debug: string[]
  // The panes the plugin opened, each with whether it asked for the keyboard (`focus`).
  opens: { id: string; isTakingKeys: boolean }[]
}

const GH_WRITE = /^gh (pr merge|pr update-branch|pr ready|run rerun|api --method (PUT|POST)) /

function ok(stdout = ""): ProcessRunResult {
  return { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
}

function failed(stderr: string): ProcessRunResult {
  return { exitCode: 1, stdout: "", stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

// How git names the branch in full, or "HEAD" on none.
function fullBranchName(branch: string): string {
  return branch === "HEAD" ? "HEAD" : `refs/heads/${branch}`
}

// Whether the plugin tried a system notification. Nothing in the kit answers `ui.notify` beneath the plugin: an engine
// that knows the call says there is no implementation, and one before 2.1.295 has no such call. Either way the try
// lands in the plugin's debug log as its own line naming the call, and the toasts are as they were.
export function triedToNotify(debug: readonly string[]): boolean {
  return debug.some((line) => line.startsWith("gh-prs-monitor: ") && line.includes("ui.notify"))
}

// Stands for the machine and the person beneath the plugin: gh and git answer from `world`, and every toast,
// status line and command the plugin raises is recorded.
// `$` is the test's own engine, through which the person at the plugin's dialog reads it and answers.
export function machine($: Engine, on: On, world: World, clock?: MockClock): Seen {
  const person = $
  const seen: Seen = {
    sounds: [],
    runs: [],
    toasts: [],
    notices: [],
    toastDurations: [],
    statuses: [],
    commands: [],
    tools: [],
    debug: [],
    opens: []
  }

  // Operations (gh and git runs, files, toasts, the status line, panes) answer with { value }.
  on("process.run", async ($, e) => {
    const line = lineOf(e.argv)
    seen.runs.push(line)
    // The engine's runtime refuses to start a program missing from PATH in these words.
    if (world.isGhMissing && e.argv[0] === "gh") {
      return { deny: 'Executable not found in $PATH: "gh"' }
    }
    if (world.isSignedOut && e.argv[0] === "gh" && e.argv[1] !== "--version") {
      return { value: failed("To get started with GitHub CLI, please run:  gh auth login") }
    }
    if (world.slowRepoViewMs && clock && line.startsWith("gh repo view")) {
      await clock.sleep(world.slowRepoViewMs)
    }
    if (world.elsewhereGate && line.includes("archived:false")) {
      await world.elsewhereGate
    }
    if (world.isListHanging && line.startsWith("gh api graphql") && line.includes("$mine")) {
      throw new Error("timed out after 30000 ms")
    }
    if (world.queuedTurn && line.startsWith("git status --porcelain --untracked-files=no")) {
      const turnId = world.queuedTurn
      world.queuedTurn = undefined
      await person.turn.start(skillTurnStart(turnId))
    }
    // Answered as GitHub stood when asked, however long the answer takes.
    const value = runOn(world, line, e.init?.cwd)
    if (world.slowCheckoutMs && clock && line.startsWith("git switch --no-overwrite-ignore")) {
      await clock.sleep(world.slowCheckoutMs)
    }
    if (world.slowLookMs && clock && /^gh api repos\/acme\/app\/pulls\/\d+\/merge-async\//.test(line)) {
      // Cut off at its timeout, as gh is; the engine's own is 30 seconds.
      const timeoutMs = e.init?.timeoutMs ?? 30_000
      await clock.sleep(Math.min(world.slowLookMs, timeoutMs))
      if (world.slowLookMs > timeoutMs) {
        throw new Error("gh timed out")
      }
    }
    if (world.slowPullMs && clock && /^gh api repos\/[^/]+\/[^/]+\/pulls\/\d+ --hostname /.test(line)) {
      await clock.sleep(world.slowPullMs)
    }
    if (world.slowBranchPullsMs && clock && line.includes("pullRequests(headRefName")) {
      await clock.sleep(world.slowBranchPullsMs)
    }
    if (world.slowClosedMs && clock && line.startsWith("gh api graphql") && line.includes("CLOSED_EVENT")) {
      const timeoutMs = e.init?.timeoutMs ?? 30_000
      await clock.sleep(Math.min(world.slowClosedMs, timeoutMs))
      if (world.slowClosedMs > timeoutMs) {
        throw new Error("gh timed out")
      }
    }
    if (world.slowGithubMs && clock && line.startsWith("gh api graphql") && line.includes("$mine")) {
      await clock.sleep(world.slowGithubMs)
    }
    if (world.slowWriteMs && clock && GH_WRITE.test(line)) {
      await clock.sleep(world.slowWriteMs)
    }

    return { value }
  })
  // The environment is an editor's extension host's where a test stands for one, and never the one the tests run in;
  // its home is the person's, /Users/me.
  const env: Record<string, string | undefined> = {
    HOME: "/Users/me",
    ...(world.editor ? { VSCODE_NLS_CONFIG: JSON.stringify({ defaultMessagesFile: EDITOR_MESSAGES }) } : {}),
    ...world.env
  }
  mock.env(
    on,
    Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  )
  // Only then, as a test may answer files of its own and `fs.read` takes one hook: the editor's product file, and the
  // git config of each folder the world clones a repository in. Where the world answers files, a clone's git metadata
  // is the world's alone, so no test reads this machine's.
  const editor = world.editor
  const configs = world.gitConfigs
  const files = world.files
  if (editor || configs || files) {
    on("fs.read", async (_, e, next) => {
      if (editor && e.path === EDITOR_PRODUCT) {
        editor.reads = (editor.reads ?? 0) + 1

        return { value: JSON.stringify({ urlProtocol: editor.scheme }) }
      }
      const text = files?.[e.path] ?? (e.path.endsWith("/.git/config") ? configs?.[e.path.slice(0, -12)] : undefined)
      if (text !== undefined) {
        return { value: text }
      }

      return /\/(\.git|\.git\/config|commondir)$/.test(e.path) ? { deny: `no file ${e.path}` } : next(e)
    })
  }
  on("fs.list", async () => ({ value: [] }))
  on("fs.stat", async ($, e) => ({
    value: {
      kind: "dir" as const,
      size: 0,
      mtimeMs: 0,
      isLink: (world.links ?? []).some((link) => link.toLowerCase() === e.path.toLowerCase())
    }
  }))
  on("fs.exists", async ($, e) => ({
    value: (world.pullWorktrees ?? []).some((each) => e.path === `/repo/.claude/worktrees/pr-${each.number}`)
  }))
  on("store.get", async ($, e) => {
    return { value: storeGet(world, e.key) }
  })
  on("store.keys", async () => {
    return { value: storeKeys(world) }
  })
  on("store.delete", async ($, e) => {
    const refusal = storeDelete(world, e.key)

    return refusal === null ? { value: undefined } : { deny: `${PLUGIN}: $.store.delete: ${refusal}` }
  })
  on("store.set", async ($, e) => {
    const refusal = storeSet(world, e.key, e.value)

    return refusal === null ? { value: undefined } : { deny: `${PLUGIN}: $.store.set: ${refusal}` }
  })
  on("command.register", async ($, e) => ({ value: { command: e.name } }))
  on("tool.register", async ($, e) => {
    const tool = `mcp__${PLUGIN}__${e.name}`
    seen.tools.push(tool)

    return { value: { tool } }
  })
  on("ui.open", async (_, e) => {
    seen.opens.push({ id: e.id, isTakingKeys: e.focus === true })
    // Open either way; a surface that places no panes leaves it waiting undrawn.
    if (world.placesPanes === false) {
      world.isPaneOpen ||= e.id === PLUGIN

      return { value: { isPlaced: false, reason: "the attached surfaces place no panes" } as never }
    }
    world.isPaneOpen = true

    return { value: { isPlaced: true } as never }
  })
  on("session.surfaces", async () => ({ value: world.surfaces ?? ["terminal"] }))
  on("session.id", async () => ({ value: "this-session" }))
  on("session.cwd", async () => ({ value: world.cwd ?? "/repo" }))
  // Whether the plugin has put a question in the pane that the person has not seen yet.
  let isQuestionNew = false
  on("state.set", async (_, e, next) => {
    const written = await next(e)
    if (e.plugin === PLUGIN && e.key === "dialog") {
      isQuestionNew = e.value !== null
    }

    return written
  })
  // Open once /prs opened it, or while the test draws it, unless the test closed it; shown in front when placed. A
  // question the plugin just put in it is answered as the plugin looks whether the pane shows.
  on("ui.panes", async () => {
    const isOpen = world.isPaneOpen ?? (testSurfaces.get($)?.size ?? 0) > 0
    const isPlaced = world.placesPanes !== false
    const isShown = isPlaced && !world.isPaneBehind
    if (isQuestionNew && isOpen && isShown) {
      isQuestionNew = false
      await answerDialog($, world, clock)
    }

    return { value: (isOpen ? [{ id: PLUGIN, isPlaced, isShown, isFocused: false }] : []) as never }
  })
  on("turn.complete", async () => ({ text: "" }))
  on("turn.start", async ($, e) => ({ turnId: e.turnId }))
  on("audio.play", async ($, e) => {
    seen.sounds.push("asset" in e.clip && e.clip.asset ? e.clip.asset : "")

    return { value: undefined }
  })
  on("ui.close", async (_, e) => {
    if (e.id === PLUGIN) {
      world.isPaneOpen = false
    }

    return { value: undefined }
  })
  on("ui.log", async ($, e) => {
    if (e.to === "transcript") {
      seen.notices.push(e.text)
    } else if (e.to === "debug") {
      seen.debug.push(e.text)
    }

    return { value: undefined }
  })
  on("ui.toast", async ($, e) => {
    seen.toasts.push(e.text)
    seen.toastDurations.push(e.timeoutMs)

    return { value: undefined }
  })
  on("ui.status", async ($, e) => {
    seen.statuses.push(e.text)

    return { value: undefined }
  })
  on("session.start", async ($, e) => ({ cwd: e.cwd }))
  on("session.attach", async ($, e) => ({ clientId: e.clientId }))
  // The engine's own band, drawn when the plugin has nothing to show there.
  on("ui.render", { component: "AbovePrompt" }, async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: "engine band" })
  })
  on("command.run", async ($, e) => {
    if (world.slowCommandMs && clock) {
      await clock.sleep(world.slowCommandMs)
    }
    if (world.commandFailure) {
      throw new Error(world.commandFailure)
    }
    seen.commands.push(`/${e.command} ${e.args}`.trim())

    return { text: "" }
  })
  // The person at the dialog: a tool's input fields sit on `e` itself.
  on("tool.call", { tool: "AskUserQuestion" }, async ($, e) => {
    const { questions } = e as unknown as {
      questions: { question: string; header?: string; options?: { label: string }[] }[]
    }
    // What Claude Code's own dialog takes (`AskOptions`): four options at most, and a header of 12 characters.
    if ((questions[0]?.options?.length ?? 0) > 4 || (questions[0]?.header?.length ?? 0) > 12) {
      throw new Error("Claude Code's dialog takes four options and a 12-character header at most")
    }
    world.asked = (world.asked ?? 0) + 1
    world.question = questions[0]?.question
    world.header = questions[0]?.header
    world.choices = questions[0]?.options?.map((option) => option.label)
    if (world.slowDialogMs && clock) {
      await clock.sleep(world.slowDialogMs)
    }
    world.whileAsking?.()
    const answer = world.engineAnswers?.shift() ?? world.answer
    if (answer === undefined) {
      return { deny: "dismissed" }
    }

    return { result: { questions, answers: { [questions[0]?.question ?? ""]: answer } } as never }
  })

  return seen
}

// The surfaces each test drew the pane on, and the person's own drawing of it, by the test's engine. The person
// answers on a drawing of their own: one the test pressed is drawn again only once that press has settled.
const testSurfaces = new WeakMap<Engine, Set<RenderSurface>>()
const personPanes = new WeakMap<Engine, { surface: RenderSurface; pane: Mounted<"terminal", "Pane"> }>()
const PERSON_SURFACES: readonly RenderSurface[] = ["vscode", "desktop", "terminal"]

// The plugin's dialog, as the person sees it in the pane: the question and its answers read off the drawing, then
// the answer the world gives, after the time it takes; typed when it is none of the answers offered. With none it
// stays open: the kit raises no close by the person.
async function answerDialog($: Engine, world: World, clock?: MockClock): Promise<void> {
  const pane = await personPane($)
  const nodes = drawnNodes(await pane.drawn())
  const texts = nodes.filter((node) => node.type === "Text").map((node) => node.children?.[0] as string | undefined)
  const choices = nodes.filter((node) => node.type === "Button").map((node) => String(node.props?.label ?? ""))
  world.asked = (world.asked ?? 0) + 1
  // Header, subject, question, then the detail where there is one, drawn dim.
  const asked = nodes.findIndex((node) => node.type === "Text" && node.children?.[0] === texts[2])
  const next = nodes[asked + 1]
  world.header = texts[0]
  world.subject = texts[1]
  world.question = texts[2]
  world.detail = next?.type === "Text" && next.props?.dimColor ? (next.children?.[0] as string) : undefined
  world.choices = choices
  const rows = repoRowsIn(await pane.drawn())
  world.rows = rows.length > 0 ? rows.map((row) => wordsIn(drawnNodes(row))) : undefined
  if (world.slowDialogMs && clock) {
    await clock.sleep(world.slowDialogMs)
  }
  world.whileAsking?.()
  if (world.answer === undefined) {
    return
  }
  // A button by its label, a name picked already drawn with its mark, and the kind its key names: a name to pick, or an
  // answer.
  const keyOf = (label: string, kind: "pick" | "answer") =>
    nodes.find(
      (node) =>
        node.type === "Button" &&
        (node.props?.label === label || node.props?.label === `✓ ${label}`) &&
        String(node.props?.key).startsWith(`${kind}-`)
    )?.props?.key
  for (const name of world.picks ?? []) {
    // A row's Open answers, so the first row named is the last press.
    const row = rows.find((each) =>
      drawnNodes(each).some((node) => node.type === "Text" && node.children?.[0] === name)
    )
    if (row) {
      await pane.press({ key: String(drawnNodes(row).find((node) => node.type === "Button")?.props?.key) })

      return
    }
    await pane.press({ key: String(keyOf(name, "pick")) })
  }
  const answer = keyOf(world.answer, "answer")
  if (answer !== undefined) {
    if (world.instructions !== undefined) {
      await pane.input({ key: fieldKey(nodes), text: world.instructions, kind: "change" })
    }
    await pane.press({ key: String(answer) })
  } else {
    await pane.input({ key: fieldKey(nodes), text: world.answer })
  }
}

// The repository picker's rows, each the part of the drawing its key names.
function repoRowsIn(node: unknown): Drawn[] {
  return drawnNodes(node).filter((each) => String(each.props?.key ?? "").startsWith("repo-row-"))
}

// The key the dialog's field for instructions is drawn under, new for each question.
export function fieldKey(nodes: Drawn[]): string {
  return String(nodes.find((node) => node.type === "Input")?.props?.key)
}

async function personPane($: Engine): Promise<Mounted<"terminal", "Pane">> {
  const held = personPanes.get($)
  if (held) {
    return held.pane
  }
  const taken = testSurfaces.get($) ?? new Set()
  const surface = PERSON_SURFACES.find((each) => !taken.has(each)) ?? "terminal"
  const pane = (await $.ui.mount(paneMount(surface, 100))) as Mounted<"terminal", "Pane">
  personPanes.set($, { surface, pane })

  return pane
}

function runOn(world: World, line: string, cwd?: string): ProcessRunResult {
  const worktree = world.pullWorktrees?.find((each) => cwd === `/repo/.claude/worktrees/pr-${each.number}`)
  if (worktree && line.startsWith("git status --porcelain")) {
    return ok(worktree.isChanged ? " M src/menu.ts\0" : "")
  }
  if (
    worktree &&
    (line === "git rev-parse HEAD" || line === `git rev-parse --verify --quiet refs/heads/${worktree.branch}`)
  ) {
    return ok(`${worktree.tip ?? `head-${worktree.number}`}\n`)
  }
  if (line === "git rev-parse --show-toplevel") {
    return ok(`${world.cwd ?? "/repo"}\n`)
  }
  if (line.startsWith("git worktree remove ")) {
    const path = line.slice("git worktree remove ".length)
    world.pullWorktrees = world.pullWorktrees?.filter((each) => path !== `/repo/.claude/worktrees/pr-${each.number}`)
  }
  const pullCall = /^gh api repos\/acme\/app\/pulls\/(\d+) --hostname /.exec(line)
  if (pullCall && world.isLookupFailing) {
    return failed("error connecting to api.github.com")
  }
  if (pullCall) {
    const number = Number(pullCall[1])
    // The stack's pull requests from the bottom up.
    const index = world.stack?.pulls.findIndex((pull) => pull.number === number) ?? -1
    const stack =
      world.stack && index >= 0
        ? { number: world.stack.number, position: index + 1, size: world.stack.pulls.length }
        : null

    return ok(pullLookAnswer(world.github, number, world.current?.[number], stack))
  }
  if (world.stack && line.startsWith(`gh api repos/acme/app/stacks/${world.stack.number} `)) {
    const { number, base, pulls } = world.stack

    return ok(JSON.stringify({ number, base: { ref: base }, pull_requests: pulls }))
  }
  if (/^gh api --method PUT repos\/acme\/app\/pulls\/\d+\/merge-async /.test(line) && !world.writeFailure) {
    return ok(world.asyncMerge?.[0] ?? "")
  }
  if (/^gh api repos\/acme\/app\/pulls\/\d+\/merge-async\//.test(line)) {
    const looks = world.asyncMerge ?? []
    world.asyncLooks = (world.asyncLooks ?? 0) + 1
    const look = looks[Math.min(world.asyncLooks, looks.length - 1)] ?? ""
    if (look === TIMED_OUT) {
      throw new Error("gh timed out")
    }

    return ok(look)
  }
  const visited = ghReposAnswer(
    world,
    `${new URL(world.repoUrl ?? "https://github.com").host}/${world.repoName ?? "acme/app"}`,
    line
  )
  if (visited) {
    return visited
  }
  if (line.startsWith("gh repo view")) {
    return world.repoViewFailure
      ? failed(world.repoViewFailure)
      : ok(`${world.repoName ?? "acme/app"} ${world.repoUrl ?? `https://github.com/${world.repoName ?? "acme/app"}`}\n`)
  }
  if (line.startsWith("gh api graphql") && line.includes("suggestedReviewers")) {
    return ok(suggestionsAnswer(world.github, world.suggested, line, (number) => world.current?.[number]?.requested))
  }
  if (line.startsWith("gh api graphql") && line.includes("pullRequests(headRefName") && world.isBranchPullsFailing) {
    return failed("error connecting to api.github.com")
  }
  if (line.startsWith("gh api graphql") && line.includes("pullRequests(headRefName")) {
    const nodes = (world.branchPulls ?? []).map((pull, index) => ({
      number: pull.number ?? index + 1,
      state: pull.state,
      headRefOid: pull.head ?? `head-${index}`,
      isCrossRepository: pull.isFork === true
    }))
    const head = / -f head=(\S+) /.exec(line)?.[1] ?? ""
    const associated = world.associated?.[head]
    // GitHub finds no commit it doesn't have.
    const object = associated
      ? {
          associatedPullRequests: {
            nodes: associated.map(({ mergeCommit, ...pull }) => ({
              ...pull,
              mergeCommit: mergeCommit === undefined ? null : { oid: mergeCommit }
            }))
          }
        }
      : null

    return ok(JSON.stringify({ data: { repository: { pullRequests: { nodes }, object } } }))
  }
  if (line.startsWith("git merge-base --is-ancestor ")) {
    const [earlier = "", later = ""] = line.split(" ").slice(3)
    if ([earlier, later].some((commit) => world.missingCommits?.includes(commit))) {
      return { ...failed(`fatal: Not a valid commit name ${later}`), exitCode: 128 }
    }

    return world.laterCommits?.includes(`${earlier}..${later}`) ? ok() : failed("")
  }
  const behindCompare = /^gh api repos\/acme\/app\/compare\/\S+\.\.\.(\S+) --hostname \S+ --jq \.behind_by$/.exec(line)
  if (behindCompare) {
    const listed = [...(world.github.mine ?? []), ...(world.github.requested ?? [])].find(
      (pull) => (world.current?.[pull.number]?.head ?? pull.headRefOid ?? `head-${pull.number}`) === behindCompare[1]
    )

    return ok(`${(listed && world.current?.[listed.number]?.behindBase) ?? 1}\n`)
  }
  const compared = /^gh api repos\/acme\/app\/compare\/(\S+)\.\.\.(\S+) --hostname /.exec(line)
  if (compared) {
    const [, base = "", head = ""] = compared
    if (world.isCompareFailing) {
      return failed("gh: Server Error (HTTP 500)")
    }
    if ([base, head].some((commit) => world.unpushedCommits?.includes(commit))) {
      return { ...failed("gh: Not Found (HTTP 404)"), stdout: '{"message":"Not Found","status":"404"}' }
    }
    const isLater = (earlier: string, later: string) => world.laterCommits?.includes(`${earlier}..${later}`)
    const status =
      base === head ? "identical" : isLater(base, head) ? "ahead" : isLater(head, base) ? "behind" : "diverged"

    return ok(`${status}\n`)
  }
  // What a merge came to (`MERGE_STATE_QUERY`); the list asks `isInMergeQueue` too, among much else.
  if (line.startsWith("gh api graphql") && line.includes("{ state isInMergeQueue")) {
    const pull =
      world.lastMerge === undefined
        ? { state: "OPEN", isInMergeQueue: false, autoMergeRequest: null }
        : world.hasMergeQueue
          ? { state: "OPEN", isInMergeQueue: true, autoMergeRequest: null }
          : world.lastMerge === "auto"
            ? { state: "OPEN", isInMergeQueue: false, autoMergeRequest: { enabledAt: "2026-10-07T09:00:00Z" } }
            : { state: "MERGED", isInMergeQueue: false, autoMergeRequest: null }

    return ok(JSON.stringify({ data: { repository: { pullRequest: pull } } }))
  }
  if (line.startsWith("gh api graphql") && line.includes("checkSuites")) {
    const number = /number=(\d+)/.exec(line)?.[1]
    const suites = { oid: world.runsHeadOid ?? `head-${number}`, checkSuites: { nodes: world.suites ?? [] } }

    return ok(JSON.stringify({ data: { repository: { pullRequest: { commits: { nodes: [{ commit: suites }] } } } } }))
  }
  if (line.startsWith("gh api graphql") && line.includes("CLOSED_EVENT")) {
    if (world.isTakenByAnother) {
      world.pullWorktrees = []
    }
    const asked = new Set([...line.matchAll(/ p(\d+): pullRequest\(/g)].map((match) => Number(match[1])))
    const pulls = (world.closed ?? [])
      .filter((pull) => asked.has(pull.number))
      .map((pull) => [
        `p${pull.number}`,
        {
          number: pull.number,
          state: pull.state,
          headRefOid: pull.head ?? `head-${pull.number}`,
          headRefName:
            pull.branch ??
            world.pullWorktrees?.find((each) => each.number === pull.number)?.branch ??
            `feature/${pull.number}`,
          isCrossRepository: pull.isFork === true,
          headRepository: { nameWithOwner: pull.isFork === true ? "ann/app" : "acme/app" },
          mergedBy: pull.state === "MERGED" && pull.by ? { login: pull.by } : null,
          timelineItems: { nodes: pull.state === "CLOSED" && pull.by ? [{ actor: { login: pull.by } }] : [] }
        }
      ])

    return ok(JSON.stringify({ data: { repository: Object.fromEntries(pulls) } }))
  }
  if (GH_WRITE.test(line) && world.writeFailure) {
    return failed(world.writeFailure)
  }
  if (line.startsWith("gh pr merge ")) {
    world.lastMerge = line.includes(" --auto") ? "auto" : "merge"
  }
  // Those asked to review are requested on GitHub from then on, in the list and in the pull request.
  const reviewersAsked = /^gh api --method POST repos\/acme\/app\/pulls\/(\d+)\/requested_reviewers /.exec(line)
  if (reviewersAsked) {
    const number = Number(reviewersAsked[1])
    const logins = [...line.matchAll(/reviewers\[\]=(\S+)/g)].map((match) => match[1]!)
    world.github = {
      ...world.github,
      mine: world.github.mine?.map((pull) =>
        pull.number === number ? { ...pull, requested: [...(pull.requested ?? []), ...logins] } : pull
      )
    }
  }
  if (line.startsWith("gh pr update-branch ") && world.isUpToDate) {
    return { ...ok(""), stderr: "✓ PR branch already up-to-date\n" }
  }
  if (world.refusedReruns?.some((id) => line.startsWith(`gh run rerun ${id} `))) {
    return failed(`run ${line.split(" ")[3]} cannot be rerun; it is already running`)
  }
  if (line.startsWith("gh api graphql") && world.isStackless && line.includes("stackEntry")) {
    const refusal = { code: "undefinedField", typeName: "PullRequest", fieldName: "stackEntry" }
    const message = "Field 'stackEntry' doesn't exist on type 'PullRequest'"

    return { ...failed(`gh: ${message}`), stdout: JSON.stringify({ errors: [{ extensions: refusal, message }] }) }
  }
  if (line.startsWith("gh api graphql")) {
    const failure = world.graphqlFailure

    // GitHub answers a repository by the name asked for, or by its new one.
    const [, owner = "acme", name = "app"] = / -f owner=(\S+) -f name=(\S+)/.exec(line) ?? []
    const answer = response({ ...world.github, nameWithOwner: world.movedTo ?? `${owner}/${name}` })

    return failure ? { ...failed(failure.stderr), stdout: failure.stdout } : ok(answer)
  }
  const fetchedPull = / fetch --no-tags \S+ (?:\+refs\/heads\/(\S+):\S+|refs\/pull\/(\d+)\/head)$/.exec(line)
  if (fetchedPull) {
    const [, branch, number] = fetchedPull
    const pull = [...(world.github.mine ?? []), ...(world.github.requested ?? [])].find((each) =>
      number ? each.number === Number(number) : (each.headRefName ?? `feature/branch-${each.number}`) === branch
    )
    world.fetched = pull ? (pull.headRefOid ?? `head-${pull.number}`) : "head"

    return ok()
  }
  if (/^git rev-parse --verify --quiet (refs\/remotes\/\S+|FETCH_HEAD)\^\{commit\}$/.test(line)) {
    return ok(`${world.fetched ?? "head"}\n`)
  }
  if (line.startsWith("git switch --no-overwrite-ignore") && world.checkoutFailure) {
    return failed(world.checkoutFailure)
  }
  if (line.startsWith("git switch --no-overwrite-ignore") && cwd === undefined && world.inTheWay?.length) {
    const named = world.inTheWay.map((path) => `\t${path}\n`).join("")

    return failed(
      `error: The following untracked working tree files would be overwritten by checkout:\n${named}Aborting\n`
    )
  }
  if (line === "git rev-parse --symbolic-full-name HEAD") {
    return ok(`${fullBranchName(world.branch)}\n`)
  }
  if (line === "git rev-parse HEAD --symbolic-full-name HEAD") {
    return ok(`${world.head ?? "local-head"}\n${fullBranchName(world.branch)}\n`)
  }
  if (line.startsWith("git status --porcelain")) {
    return ok(Array.from({ length: world.uncommitted }, (_, index) => ` M file${index}.ts`).join("\n"))
  }
  if (line.startsWith("git rev-parse --path-format=absolute --git-common-dir")) {
    return ok("/repo/.git\n")
  }
  if (line === "git remote -v") {
    const url = `https://github.com/${world.repoName ?? "acme/app"}.git`

    return ok(`origin\t${url} (fetch)\norigin\t${url} (push)\n`)
  }
  if (line === "uname -s") {
    return ok(`${world.system ?? "Darwin"}\n`)
  }
  if (line === "sw_vers -productVersion") {
    return ok("26.4\n")
  }
  if (line === "uname -sr") {
    return ok(`${world.system ?? "Darwin"} 25.4.0\n`)
  }
  if (line === "gh --version") {
    return ok("gh version 2.97.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.97.0\n")
  }
  if (line === "git --version") {
    return ok("git version 2.50.1 (Apple Git-155)\n")
  }
  if (/^(open|xdg-open|rundll32) /.test(line) && world.openFailure) {
    return failed(world.openFailure)
  }
  if (line.startsWith("git worktree list")) {
    const own = (world.pullWorktrees ?? []).map(
      (each) => `worktree /repo/.claude/worktrees/pr-${each.number}\nHEAD 2\nbranch refs/heads/${each.branch}\n`
    )
    const here = world.pullBranches?.find((each) => each.isCheckedOut)

    return ok([`worktree /repo\nHEAD 1\nbranch refs/heads/${here ? `pr-${here.number}` : "main"}\n`, ...own].join("\n"))
  }
  if (line.startsWith("git for-each-ref --format=%(refname:short) refs/heads/pr-*")) {
    const names = [
      ...(world.pullBranches ?? []).map((each) => `pr-${each.number}`),
      ...(world.pullWorktrees ?? []).map((each) => each.branch).filter((branch) => branch.startsWith("pr-"))
    ]

    return ok(names.map((name) => `${name}\n`).join(""))
  }
  const tracked = world.pullBranches?.find((each) => line === `git config --get branch.pr-${each.number}.merge`)
  if (tracked) {
    const head = world.closed?.find((pull) => pull.number === tracked.number)?.branch ?? `feature/${tracked.number}`
    const upstream = tracked.upstream ?? `refs/heads/${head}`

    return upstream === "" ? failed("") : ok(`${upstream}\n`)
  }
  const left = world.pullBranches?.find(
    (each) =>
      line === `git rev-parse --verify --quiet refs/heads/pr-${each.number}` ||
      line === `git branch -D -- pr-${each.number}`
  )
  if (left && line.startsWith("git branch -D ")) {
    world.pullBranches = world.pullBranches?.filter((each) => each !== left)
  } else if (left) {
    return ok(`${left.tip ?? `head-${left.number}`}\n`)
  }

  return ok()
}

// The printed list's first line, as the pane's header: the repository, its counts and when it was read.
export const HEADING =
  /^\*\*\[acme\/app\]\(https:\/\/github\.com\/acme\/app\/pulls\)\*\*( · [✅❗🔍] \*\*\d+\*\*)* · updated \d\d:\d\d$/u

// The printed list's lines, the blank ones between its parts left out.
export function lines(text: string | undefined): string[] {
  return (text ?? "").split("\n").filter((line) => line !== "")
}

// What a skill's turn looks like to the plugin: its start and its end, by id.
export function skillTurnStart(turnId: string): never {
  return { text: "", turnId } as never
}

export function skillTurnEnd(turnId: string, reason = "answer"): never {
  return { answer: "", durationMs: 1, isAborted: reason === "aborted", reason, turnId } as never
}

// The prompt box asking for rows for the token at the end of `text`, each by its label; the kit's types have no call
// for it.
export async function typeahead($: Engine, text: string): Promise<string[]> {
  const token = text.slice(text.lastIndexOf(" ") + 1)
  const prompt = $.prompt as unknown as {
    autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  }
  const { suggestions } = await prompt.autocomplete({
    text,
    cursor: text.length,
    token,
    start: text.length - token.length
  })

  return suggestions.map((row) => row.label ?? row.text)
}

// A command as the person types it, or as it came over Remote Control (`bridge`); the test kit raises the raw event,
// which carries where it came from as the engine stamps it.
export function runPrs($: Engine, args: string, origin: PromptOrigin = { kind: "composer" }) {
  return $.command.run({ command: "prs", args, origin } as Parameters<Engine["command"]["run"]>[0])
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true })
}

// What a session kept before a reload, read back as kept until the session writes each anew, at the version the store
// holds, so a conditional write lands as on the value kept.
export function keptOverReload(
  on: On,
  kept: Partial<
    Record<
      | "snapshot"
      | "checkout"
      | "branchPulls"
      | "busy"
      | "module"
      | "paneAskedAt"
      | "turns"
      | "heldAlerts"
      | "visit"
      | "elsewhere",
      unknown
    >
  >
): void {
  const keys = /^(snapshot|checkout|branchPulls|busy|module|paneAskedAt|turns|heldAlerts|visit|elsewhere)$/
  const unwritten = new Set<string>(Object.keys(kept))
  on("state.set", { plugin: PLUGIN, key: keys }, async (_, e, next) => {
    unwritten.delete(e.key)

    return next(e)
  })
  on("state.get", { plugin: PLUGIN, key: keys }, async (_, e, next) => {
    if (!unwritten.has(e.key)) {
      return next(e)
    }
    const held = await next(e)

    return "value" in held ? ({ value: { ...held.value, value: kept[e.key as keyof typeof kept] } } as never) : held
  })
}

// A list as GitHub sends `fixture`, read as a session keeps it.
export function keptList(fixture: ResponseFixture): PullsSnapshot | null {
  const read = readPulls(response(fixture), "acme/app", 0, { includeOutdated: false })

  return "snapshot" in read ? read.snapshot : null
}

// Every element of a drawn tree, as the surface gets it: props, hover and children.
export type Drawn = { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }

export function drawnNodes(node: unknown): Drawn[] {
  return typeof node === "object" && node !== null
    ? [node as Drawn, ...((node as Drawn).children ?? []).flatMap(drawnNodes)]
    : []
}

export function hasText(nodes: Drawn[], text: string): boolean {
  return nodes.some((node) => node.type === "Text" && node.children?.[0] === text)
}

// All the words a part of the tree shows, a link's label among them.
export function wordsIn(nodes: Drawn[]): string {
  return nodes
    .flatMap((node) => [
      ...(node.children ?? []).filter((child): child is string => typeof child === "string"),
      ...(typeof node.props?.label === "string" ? [node.props.label] : [])
    ])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

// Lets what a press started run to its end: the kit's settle can come back while a hook's answer is still on its way,
// as on a loaded machine, so it settles again until the flow has ended, as `isEnded` tells, and nothing new runs, a
// bounded number of times.
export async function settleAll(clock: MockClock, seen: Seen, isEnded: () => boolean = () => true): Promise<void> {
  for (let rounds = 0, before = -1; rounds < SETTLE_ROUNDS; rounds++) {
    const ran = seen.runs.length + seen.commands.length
    if (ran === before && isEnded()) {
      return
    }
    before = ran
    await clock.settle()
  }
}

// Lets what is under way run, the clock where it is, until `isThere` holds: the kit's settle can come back before a
// press has drawn or run what it does, as on a loaded machine; a bounded number of times.
export async function settleUntil(clock: MockClock, isThere: () => boolean | Promise<boolean>): Promise<void> {
  for (let rounds = 0; rounds < SETTLE_ROUNDS && !(await isThere()); rounds++) {
    await clock.settle()
  }
}

// The kit's clock, each settle and each move followed by a few more settles, the clock where it is: one can come back
// while a hook's answer is still on its way, as on a loaded machine, which the next ones let land.
export function clockOf(on: On, options?: MockClockOptions): MockClock {
  const clock = mock.clock(on, options)
  const settle = async (): Promise<void> => {
    for (let round = 0; round < STEADY_SETTLES; round++) {
      await clock.settle()
    }
  }

  return {
    now: () => clock.now(),
    sleep: (ms) => clock.sleep(ms),
    settle,
    advance: async (ms) => {
      await clock.advance(ms)
      await settle()
    },
    set: async (ms) => {
      await clock.set(ms)
      await settle()
    }
  }
}

const STEADY_SETTLES = 4

// Presses a button once it is drawn: the kit's settle can come back while a question still holds the pane, or a
// redraw is on its way, as on a loaded machine (`settleUntil`).
export async function pressDrawn(clock: MockClock, ui: Pick<Mounted, "find" | "press">, key: string): Promise<void> {
  await settleUntil(clock, async () => (await ui.find({ key })) !== undefined)
  await ui.press({ key })
}

const SETTLE_ROUNDS = 20

// The desktop app's band above the prompt, drawn by the plugin; `hasSurvey`: a survey of Claude Code's own holds the
// space.
export async function mountBand($: Engine, surface: RenderSurface, hasSurvey = false) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: "AbovePrompt",
    props: {
      hasSurvey,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 3 },
      view: {}
    } as never
  })
}

// `offset`: the row the pane's window shows first, as the terminal's drawing says.
export async function mountPane<P extends RenderSurface>(
  $: Engine,
  surface: P,
  bodyColumns = 100,
  isFocused = false,
  offset = 0
) {
  // The person's own drawing makes way for the test's on the same surface.
  const held = personPanes.get($)
  if (held?.surface === surface) {
    personPanes.delete($)
    await held.pane.unmount()
  }
  testSurfaces.set($, (testSurfaces.get($) ?? new Set()).add(surface))
  const mounted = await $.ui.mount(paneMount(surface, bodyColumns, isFocused, offset))

  // Taken down, the pane no longer counts as open.
  return {
    ...mounted,
    unmount: async () => {
      testSurfaces.get($)?.delete(surface)
      await mounted.unmount()
    }
  }
}

function paneMount<P extends RenderSurface>(surface: P, bodyColumns: number, isFocused = false, offset = 0) {
  return {
    plugin: PLUGIN,
    surface,
    component: "Pane" as const,
    requestId: PLUGIN,
    props: {
      title: "Pull requests",
      isFocused,
      bodyColumns,
      placement: "dock",
      scroll: { offset, bodyRows: 30 },
      view: {}
    } as never
  }
}

export const GITHUB: ResponseFixture = {
  mine: [
    {
      number: 1,
      title: "Fix the menu",
      headRefName: "fix/menu",
      reviewDecision: "CHANGES_REQUESTED",
      threads: [{ isResolved: false }]
    },
    { number: 2, title: "Add a legend", reviewDecision: "APPROVED" }
  ],
  requested: [{ number: 7, title: "Usage chart", author: "ann" }]
}

// The list as an older version of the plugin left it in the session's state: whole, but of another shape version.
function olderSnapshotOf(fixture: ResponseFixture): PullsSnapshot {
  return { ...snapshotOf(fixture, { at: 0 }), schema: SNAPSHOT_SCHEMA - 1 }
}

// Answers the session's state with that list wherever the plugin reads it.
export function keepOlderSnapshot(on: On, fixture: ResponseFixture): void {
  on("state.get", { plugin: PLUGIN, key: "snapshot" }, async () => ({
    value: { value: olderSnapshotOf(fixture), version: 1 } as never
  }))
}
