// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { branchPlaceQuestion, CHOICES, placeChoices, placeDetail, readPlaceAnswer, skillArgs } from "./branch-flow"
import { readAnswer, readSessionAnswer, SESSION_CHOICES } from "./question"
import { describeGhFailure, failureLine, firstLine, GH_MISSING, ghRunFailure, lastLine, parseRepoView } from "./gh"
import { pullNumberOf, pullRefIn } from "./args"
import { createArgs } from "./create-flow"
import { mainRootOf, parseWorktreeList, prNumberOf, worktreePath } from "./worktrees"
import {
  canOpenInWorktree,
  canOpenSession,
  editorScheme,
  linkRefusal,
  newSessionLink,
  openLink,
  runsHereWhenUnopened,
  sessionAppFor
} from "./new-session"
import {
  isBackToReview,
  readReviewAnswer,
  REVIEW_KINDS,
  reviewArgs,
  reviewDetail,
  reviewPlaceQuestion,
  rereviewQuestion,
  sinceLine,
  START_REVIEW
} from "./review-flow"
import { snapshotOf } from "./testing/fixtures"
import { stableButtons } from "./stable-buttons"
import { answerChoices, choicesKey, readChoices } from "./create-choices"
import type { KeptChoices } from "./create-choices"
import { linksOf } from "./list"
import { lookKey } from "./store"
import { shortHash, storeKey } from "./store-keys"
import { BACK_TO_ROW_PAUSE_MS, BACK_TO_ROW_TRIES, focusMoved, forgetWindow, goBack, windowMoved } from "./back-to-row"
import type { BackHost } from "./back-to-row"
import type { Host } from "./machine"
import type { ProcessRunResult } from "claude-code"
import { checkingAgain, lookedAt } from "./when"
import { manifestFacts, reportFacts, reportText } from "./report"
import type { ReportFacts, ReportHost } from "./report"

describe("describeGhFailure", () => {
  // The stderr lines gh 2.97 prints for each case.
  test("a folder without a repository, remote or GitHub remote ends the session's checks", () => {
    expect(
      describeGhFailure("failed to run git: fatal: not a git repository (or any of the parent directories): .git")
    ).toEqual({ message: "This folder is not a git repository, so it has no GitHub project.", isPermanent: true })
    expect(describeGhFailure("no git remotes found")).toEqual({
      message: "This repository has no git remote, so it has no GitHub project.",
      isPermanent: true
    })
    expect(
      describeGhFailure(
        "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`"
      )
    ).toEqual({
      message:
        "This repository has no remote on a GitHub host the GitHub CLI is signed in to. For GitHub Enterprise, run: gh auth login --hostname <your server>",
      isPermanent: true
    })
  })

  test("signed out", () => {
    expect(describeGhFailure("To get started with GitHub CLI, please run:  gh auth login")).toEqual({
      message: "The GitHub CLI is not signed in. Run: gh auth login",
      isPermanent: false,
      needsSetup: true
    })
    expect(describeGhFailure("HTTP 401: Bad credentials (https://api.github.com/graphql)").isPermanent).toBe(false)
  })

  test("no access", () => {
    expect(
      describeGhFailure("GraphQL: Could not resolve to a Repository with the name 'acme/secret'. (repository)")
    ).toEqual({
      message: "No access to this repository with your GitHub account, or it does not exist on GitHub.",
      isPermanent: true
    })
  })

  test("rate limits and the network are tried again", () => {
    expect(describeGhFailure("GraphQL: API rate limit exceeded")).toEqual({
      message: "GitHub refused the request (rate limit or permissions).",
      isPermanent: false
    })
    expect(describeGhFailure("error connecting to api.github.com")).toEqual({
      message: "Could not reach GitHub.",
      isPermanent: false
    })
  })

  test("a server that lacks a field the plugin asks for, as an old GitHub Enterprise Server, is not asked again", () => {
    expect(describeGhFailure("gh: Field 'statusCheckRollup' doesn't exist on type 'PullRequest'\n")).toEqual({
      message:
        "This GitHub server lacks a field the plugin asks for: GitHub Enterprise Server needs to be 3.16 or later (statusCheckRollup)",
      isPermanent: true
    })
  })

  test("an organization's single sign-on refusing the token is said in GitHub's words, which say what to do", () => {
    const saml =
      "gh: Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization. (HTTP 403)"
    expect(describeGhFailure(`${saml}\n`)).toEqual({ message: saml, isPermanent: false })
  })

  test("GitHub out of time or in trouble, as gh tells it, its error page printed as the answer", () => {
    const timedOut = { exitCode: 1, stdout: "<!DOCTYPE html>\n<html>…</html>", stderr: "gh: HTTP 504\n" }
    expect(ghRunFailure(timedOut)).toEqual({
      message: "GitHub took too long to answer, or had an error of its own.",
      isPermanent: false
    })
    expect(describeGhFailure("gh: HTTP 502").message).toBe(
      "GitHub took too long to answer, or had an error of its own."
    )
  })

  test("anything else is reported by its first line", () => {
    expect(describeGhFailure("\n  something new\nsecond line")).toEqual({
      message: "something new",
      isPermanent: false
    })
    expect(describeGhFailure("")).toEqual({ message: "The GitHub CLI failed without saying why.", isPermanent: false })
  })

  test("gh missing is permanent, needs setup and says how to fix it", () => {
    expect(GH_MISSING.isPermanent).toBe(true)
    expect(GH_MISSING.needsSetup).toBe(true)
    expect(GH_MISSING.message).toContain("https://cli.github.com")
  })

  test("first and last lines skip blanks", () => {
    expect(firstLine("\n\n a \n b \n")).toBe("a")
    expect(lastLine("\n a \n b \n\n")).toBe("b")
    expect(lastLine("")).toBe("")
  })

  test("the reason a git step failed, past git's hints and the lines a fetch prints around it", () => {
    expect(failureLine("hint: a\nhint:\nfatal: Not possible to fast-forward, aborting.\n")).toBe(
      "fatal: Not possible to fast-forward, aborting."
    )
    // A rejected ref is the reason, though git warned of something else first.
    expect(
      failureLine(
        "warning: redirecting to https://github.com/acme/app.git/\n ! [rejected]        refs/pull/7/head -> pr-7  (non-fast-forward)\n"
      )
    ).toBe("! [rejected] refs/pull/7/head -> pr-7 (non-fast-forward)")
    // gh wraps git's output in its own lines, which say nothing of why.
    expect(
      failureLine(
        "From https://github.com/acme/app\nremote: Repository not found.\nfailed to run git: exit status 128\n"
      )
    ).toBe("remote: Repository not found.")
    expect(failureLine("")).toBe("")
  })
})

describe("ghRunFailure", () => {
  test("a run that succeeded, or answered GraphQL data alongside an error, is the caller's to read", () => {
    expect(ghRunFailure({ exitCode: 0, stdout: "{}", stderr: "" })).toBe(null)
    expect(ghRunFailure({ exitCode: 1, stdout: '{"data":{"viewer":{}},"errors":[{}]}', stderr: "gh: error" })).toBe(
      null
    )
  })

  test("a REST-style error body is read for what went wrong", () => {
    expect(
      ghRunFailure({
        exitCode: 1,
        stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}',
        stderr: ""
      })
    ).toEqual({ message: "The GitHub CLI is not signed in. Run: gh auth login", isPermanent: false, needsSetup: true })
  })

  test("no body at all falls back to what gh printed", () => {
    expect(ghRunFailure({ exitCode: 1, stdout: "", stderr: "error connecting to api.github.com" })).toEqual({
      message: "Could not reach GitHub.",
      isPermanent: false
    })
  })
})

describe("parseRepoView", () => {
  test("names the repository and the host its remote is on", () => {
    expect(parseRepoView("acme/app https://github.com/acme/app\n")).toEqual({ name: "acme/app", host: "github.com" })
    expect(parseRepoView("acme/app https://git.corp.example:8443/acme/app")).toEqual({
      name: "acme/app",
      host: "git.corp.example:8443"
    })
  })

  test("anything else is not a repository", () => {
    expect(parseRepoView("")).toBe(null)
    expect(parseRepoView("acme/app")).toBe(null)
    expect(parseRepoView("acme/app not-a-url")).toBe(null)
  })
})

describe("worktrees", () => {
  test("parses the porcelain list, each branch by its name, detached worktrees without one", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 1111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.claude/worktrees/pr-7",
      "HEAD 2222",
      "detached",
      "",
      "worktree /elsewhere/feature",
      "HEAD 3333",
      "branch refs/heads/feature/x",
      ""
    ].join("\n")

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo/.claude/worktrees/pr-7", branch: null },
      { path: "/elsewhere/feature", branch: "feature/x" }
    ])
    expect(parseWorktreeList("")).toEqual([])
  })

  test("a pull request's worktree path", () => {
    expect(worktreePath("/repo", 3335)).toBe("/repo/.claude/worktrees/pr-3335")
  })

  test("the pull request a pr-<number> name is for; none for a name that only starts so", () => {
    expect(prNumberOf("pr-7")).toBe(7)
    expect(prNumberOf("pr-3335")).toBe(3335)
    expect(prNumberOf("pr-7-old")).toBe(null)
    expect(prNumberOf("pr-7x")).toBe(null)
    expect(prNumberOf("pr-")).toBe(null)
    expect(prNumberOf("fix/pr-7")).toBe(null)
  })

  test("the main checkout from the common git dir", () => {
    expect(mainRootOf("/repo/.git\n")).toBe("/repo")
    expect(mainRootOf("/repo/.git/")).toBe("/repo")
    expect(mainRootOf("/srv/repo.git")).toBe(null)
  })
})

// A button pressed, with no instructions typed.
const pressed = (choice: string) => ({ choice, instructions: "" })

describe("where a branch skill works", () => {
  const pull = { number: 7, title: "Fix the menu", headRefName: "fix/menu", isCrossRepository: false }
  const CLEAN = { uncommitted: 0, isDetached: false, isOnBranch: false }
  const WORKTREE = { kind: "worktree", isNewSession: false }

  test("this checkout first, then a worktree in this session, then in a new one where one can be opened", () => {
    expect(placeChoices(true, false)).toEqual([CHOICES.here, CHOICES.worktree, CHOICES.newSession, CHOICES.cancel])
    expect(placeChoices(false, false)).toEqual([CHOICES.here, CHOICES.worktree, CHOICES.cancel])
    // On the pull request's branch already, working here needs no switch.
    expect(placeChoices(true, true)).toEqual([
      CHOICES.hereOnBranch,
      CHOICES.worktree,
      CHOICES.newSession,
      CHOICES.cancel
    ])
  })

  test("on the pull request's branch, the question says this checkout is used as it is, with any changes in it", () => {
    expect(branchPlaceQuestion("resolve", pull, { ...CLEAN, isOnBranch: true }, true, false)).toEqual({
      header: "Resolve PR",
      subject: "#7 Fix the menu",
      text: "Where should its review comments on fix/menu be resolved?",
      detail:
        "This checkout is on the pull request's branch already: working here uses it as it is; a worktree works apart from it, its dependencies installed in a folder of its own. A new session opens with the command typed in, for you to send, and works in the worktree.",
      choices: [CHOICES.hereOnBranch, CHOICES.worktree, CHOICES.newSession, CHOICES.cancel],
      main: null,
      instructions: "to a worktree in this session"
    })
    expect(placeDetail(pull, { ...CLEAN, uncommitted: 2, isOnBranch: true }, false, false)).toBe(
      "This checkout is on the pull request's branch already: working here uses it as it is, with its 2 uncommitted changes; a worktree works apart from it, its dependencies installed in a folder of its own."
    )
    // A fork's are installed nowhere.
    expect(placeDetail({ ...pull, isCrossRepository: true }, { ...CLEAN, isOnBranch: true }, false, false)).toBe(
      "This checkout is on the pull request's branch already: working here uses it as it is; a worktree works apart from it. It comes from a fork, so its dependencies are not installed."
    )
  })

  test("the detail says what switching here costs and what a new session does", () => {
    expect(placeDetail(pull, CLEAN, true, false)).toBe(
      "Switching here stops rather than overwrite a file git ignores that the branch tracks, and reinstalls dependencies if the branch's lockfile differs; a worktree installs them in a folder of its own, leaving this checkout as it is. A new session opens with the command typed in, for you to send, and works in the worktree."
    )
    expect(placeDetail(pull, CLEAN, false, false)).not.toContain("new session")
  })

  test("the question names what each skill is there for, on the pull request's branch", () => {
    expect(branchPlaceQuestion("fixCi", pull, CLEAN, true, false)).toMatchObject({
      header: "Fix CI",
      text: "Where should its failing checks on fix/menu be fixed?"
    })
    expect(branchPlaceQuestion("resolve", pull, CLEAN, true, false).text).toBe(
      "Where should its review comments on fix/menu be resolved?"
    )
  })

  test("uncommitted changes and a checkout on no branch are warned of first", () => {
    expect(placeDetail(pull, { uncommitted: 1, isDetached: false, isOnBranch: false }, true, false)).toMatch(
      /^This checkout has 1 uncommitted change: switching here takes it along to the pull request's branch, or stops rather than overwrite one\. Switching here stops rather than overwrite a file git ignores/
    )
    expect(placeDetail(pull, { uncommitted: 2, isDetached: false, isOnBranch: false }, true, false)).toMatch(
      /^This checkout has 2 uncommitted changes: switching here takes them along/
    )
    expect(placeDetail(pull, { uncommitted: 0, isDetached: true, isOnBranch: false }, true, false)).toMatch(
      /^This checkout is on no branch: switching here leaves commits made there behind, found again only through git reflog\. Switching here stops/
    )
    expect(placeDetail(pull, { uncommitted: 3, isDetached: true, isOnBranch: false }, true, false)).toMatch(
      /^This checkout has 3 uncommitted changes: [^.]+\. This checkout is on no branch: /
    )
  })

  test("a turn under way here is said first: a switch waits for it, and stops if it changed this checkout", () => {
    expect(placeDetail(pull, { ...CLEAN, uncommitted: 1 }, true, true)).toMatch(
      /^This session is busy, so switching here waits until its turn ends, and stops if that turn changed this checkout\. This checkout has 1 uncommitted change: /
    )
    expect(placeDetail(pull, { ...CLEAN, isOnBranch: true }, true, true)).toMatch(
      /^This session is busy, so working here starts once its turn ends\. This checkout is on the pull request's branch already: /
    )
    expect(placeDetail(pull, CLEAN, true, false)).not.toContain("busy")
  })

  test("a fork's pull request says its dependencies are not installed", () => {
    const fork = placeDetail({ ...pull, isCrossRepository: true }, CLEAN, true, false)
    expect(fork).toContain("It comes from a fork, so its dependencies are not installed.")
    expect(fork).toContain(
      "Switching here stops rather than overwrite a file git ignores that the branch tracks; a worktree leaves this checkout as it is."
    )
    expect(fork).not.toContain("reinstalls")
  })

  test("reads each button, and text typed in place of one", () => {
    const all = placeChoices(true, false)
    const typed = (text: string, choices = all) => readPlaceAnswer(readAnswer(text, choices))

    expect(readPlaceAnswer(pressed(CHOICES.newSession))).toEqual({ kind: "worktree", isNewSession: true })
    expect(readPlaceAnswer(pressed(CHOICES.worktree))).toEqual(WORKTREE)
    expect(readPlaceAnswer(pressed(CHOICES.here))).toEqual({ kind: "here" })
    expect(readPlaceAnswer(pressed(CHOICES.hereOnBranch))).toEqual({ kind: "here" })
    expect(readPlaceAnswer(pressed(CHOICES.cancel))).toEqual({ kind: "cancel" })
    expect(typed("  only the naming ones ")).toEqual({ ...WORKTREE, note: "only the naming ones" })
    expect(typed("worktree, THIS session")).toEqual(WORKTREE)
    expect(typed("   ")).toEqual({ kind: "cancel" })
  })

  test("instructions typed go with the place pressed, and Cancel drops them", () => {
    const note = "only the naming ones"
    const withNote = (choice: string) => readPlaceAnswer({ choice, instructions: note })

    expect(withNote(CHOICES.here)).toEqual({ kind: "here", note })
    expect(withNote(CHOICES.hereOnBranch)).toEqual({ kind: "here", note })
    expect(withNote(CHOICES.worktree)).toEqual({ ...WORKTREE, note })
    expect(withNote(CHOICES.newSession)).toEqual({ kind: "worktree", isNewSession: true, note })
    expect(withNote(CHOICES.cancel)).toEqual({ kind: "cancel" })
  })

  test("a no typed under Other cancels, not instructions for a worktree", () => {
    const all = placeChoices(true, false)

    for (const declined of [
      "cancel",
      "Cancel.",
      "no",
      "NO",
      "nope",
      "abort",
      "stop!",
      "no thanks",
      "No, thank you.",
      "never mind",
      "Nevermind!",
      "not now",
      "nah",
      "skip",
      "nvm",
      "never-mind",
      "no thx",
      "nah, I'm good",
      "quit",
      "no need",
      "don't",
      "no thank you :)",
      "cancel it",
      "cancel that",
      "stop it",
      "skip it",
      "never mind that",
      "Cancel please",
      "cancel it, please",
      "don't do it",
      "no, don't"
    ]) {
      expect(readPlaceAnswer(readAnswer(declined, all))).toEqual({ kind: "cancel" })
    }
    expect(readPlaceAnswer(readAnswer("no renames, only the typos", all))).toEqual({
      ...WORKTREE,
      note: "no renames, only the typos"
    })
  })

  test("a new session typed under Other where none can be opened stays in a worktree in this session", () => {
    expect(readPlaceAnswer(readAnswer(CHOICES.newSession, placeChoices(false, false)))).toEqual({
      ...WORKTREE,
      note: CHOICES.newSession
    })
  })
})

const PULL_URL = "https://github.com/acme/app/pull/7"

describe("skillArgs", () => {
  test("the pull request alone", () => {
    expect(skillArgs(PULL_URL, {})).toBe(PULL_URL)
  })

  test("every part in the order the skill reads them", () => {
    expect(
      skillArgs(PULL_URL, {
        worktree: "/repo/.claude/worktrees/pr-7",
        deps: 'npm ci failed (exit 1): "ERESOLVE"\n could not resolve',
        includeOutdated: true,
        note: "only the\nnaming   ones"
      })
    ).toBe(
      `${PULL_URL} --worktree "/repo/.claude/worktrees/pr-7" --deps "npm ci failed (exit 1): 'ERESOLVE' could not resolve" --include-outdated -- only the naming ones`
    )
  })

  test("a quote or a backslash in a path is escaped, so it cannot end the value", () => {
    expect(skillArgs(PULL_URL, { worktree: '/home/ann/my "work"/pr-7' })).toBe(
      `${PULL_URL} --worktree "/home/ann/my \\"work\\"/pr-7"`
    )
    expect(skillArgs(PULL_URL, { worktree: "/tmp/odd\\" })).toBe(`${PULL_URL} --worktree "/tmp/odd\\\\"`)
  })

  test("an installer's colours and control characters are left out of its note", () => {
    expect(skillArgs(PULL_URL, { deps: "npm ci failed (exit 1): \u001b[31mERR!\u001b[0m peer \u0007dep\r" })).toBe(
      `${PULL_URL} --deps "npm ci failed (exit 1): ERR! peer dep"`
    )
  })

  test("a long install note is cut, so a link that types the command in stays within its limit", () => {
    const args = skillArgs(PULL_URL, { deps: `npm ci failed (exit 1): ${"x".repeat(1_000)}` })
    const note = args.slice(`${PULL_URL} --deps "`.length, -1)

    expect(Array.from(note)).toHaveLength(600)
    expect(note.endsWith("x…")).toBe(true)
    expect(skillArgs(PULL_URL, { deps: "installed with npm ci" })).toBe(`${PULL_URL} --deps "installed with npm ci"`)
  })

  test("an install note's quotes turn single and its backslashes are escaped, so it cannot end the value", () => {
    expect(skillArgs(PULL_URL, { deps: 'npm ci could not run: no "C:\\tmp\\"' })).toBe(
      `${PULL_URL} --deps "npm ci could not run: no 'C:\\\\tmp\\\\'"`
    )
  })

  test("a path with spaces reaches the skill unchanged", () => {
    expect(skillArgs(PULL_URL, { worktree: "/Users/me/My Repos/app/.claude/worktrees/pr-7" })).toBe(
      `${PULL_URL} --worktree "/Users/me/My Repos/app/.claude/worktrees/pr-7"`
    )
  })
})

describe("the review dialog", () => {
  test("the question says where each choice reviews, and how a busy session waits", () => {
    expect(reviewPlaceQuestion({ number: 7, title: "Fix the menu" }, false)).toEqual({
      header: "Review PR",
      subject: "#7 Fix the menu",
      text: "Where should it be reviewed?",
      detail: "Here it runs in this conversation. A new session opens with the review typed in, for you to send.",
      choices: ["This session", "New session", "Cancel"],
      main: null,
      instructions: "to a review in this session"
    })
    expect(reviewDetail(true)).toBe(
      "This session is busy, so here the review starts once its turn ends. A new session opens with the review typed in, for you to send."
    )
  })

  test("reads each answer; instructions go with either place, and sent alone review here", () => {
    const typed = (text: string) => readSessionAnswer(readAnswer(text, Object.values(SESSION_CHOICES)))

    expect(readSessionAnswer(pressed(SESSION_CHOICES.here))).toEqual({ kind: "here" })
    expect(typed(" new SESSION ")).toEqual({ kind: "new" })
    for (const decline of [SESSION_CHOICES.cancel, "", "  ", "no thanks", "never mind."]) {
      expect(typed(decline)).toEqual({ kind: "cancel" })
    }
    expect(typed("no style nits, just bugs")).toEqual({ kind: "here", note: "no style nits, just bugs" })
    expect(readSessionAnswer({ choice: SESSION_CHOICES.new, instructions: "just bugs" })).toEqual({
      kind: "new",
      note: "just bugs"
    })
    expect(readSessionAnswer({ choice: SESSION_CHOICES.cancel, instructions: "just bugs" })).toEqual({ kind: "cancel" })
  })

  // Rows back to the viewer and not: new commits since their review, asked again with none, asked for the first time.
  const AT = "2026-10-07T12:00:00Z"
  const NOW = Date.parse("2026-10-08T08:00:00Z")
  const ROWS = snapshotOf({
    reviewed: [
      {
        number: 9,
        title: "Cache the tiles",
        author: "ann",
        headRefOid: "new-head",
        reviews: [{ login: "me", state: "COMMENTED", at: AT, commit: "a1b2c3d4e5f6" }]
      }
    ],
    requested: [
      {
        number: 10,
        title: "Search filters",
        author: "bob",
        requested: ["me"],
        reviews: [{ login: "me", state: "COMMENTED", at: AT }]
      },
      { number: 11, title: "Usage chart", author: "cid" }
    ]
  }).review
  const rowOf = (number: number) => ROWS.find((row) => row.number === number)!

  test("a row is back to the viewer where they are asked again, or new commits came since their review", () => {
    expect(rowOf(9).reviewStage).toBe("updated")
    expect(rowOf(10).reviewStage).toBe("rerequested")
    expect([9, 10, 11].map((number) => isBackToReview(rowOf(number)))).toEqual([true, true, false])
    for (const stage of ["dismissed", "waitingOnAuthor", "commented", null] as const) {
      expect(isBackToReview({ ...rowOf(9), reviewStage: stage as never })).toBe(false)
    }
  })

  test("the line says when the viewer's review was and what brought the pull request back, from what the row knows", () => {
    expect(sinceLine(rowOf(9), NOW)).toBe("Your review was on a1b2c3d, 20h ago; new commits came in since.")
    expect(sinceLine(rowOf(10), NOW)).toBe(
      "Your review was on head-10, 20h ago; you're asked again, with no new commits since."
    )
    // A review that names no commit says nothing of commits since.
    expect(sinceLine({ ...rowOf(10), myReview: { commit: null, at: AT } }, NOW)).toBe(
      "Your review was 20h ago; you're asked again."
    )
    // Who asked isn't known: anyone who can push may ask.
    expect(sinceLine({ ...rowOf(10), signals: { ...rowOf(10).signals, hasCommitsSinceMyReview: true } }, NOW)).toBe(
      "Your review was on head-10, 20h ago; you're asked again, and new commits came in since."
    )
    expect(sinceLine({ ...rowOf(9), myReview: { commit: null, at: "" } }, NOW)).toBe(
      "You reviewed it before; new commits came in since."
    )
    expect(sinceLine({ ...rowOf(9), myReview: null }, NOW)).toBe("You reviewed it before; new commits came in since.")
    expect(sinceLine({ ...rowOf(9), myReview: { commit: "a1b2c3d4e5f6", at: "" } }, NOW)).toBe(
      "Your review was on a1b2c3d; new commits came in since."
    )
    expect(sinceLine({ ...rowOf(9), myReview: { commit: null, at: AT } }, NOW)).toBe(
      "Your review was 20h ago; new commits came in since."
    )
    // A time ahead of the clock, as on a machine whose clock is behind, names no age.
    expect(sinceLine({ ...rowOf(9), myReview: { commit: null, at: "2026-10-09T08:00:00Z" } }, NOW)).toBe(
      "You reviewed it before; new commits came in since."
    )
  })

  test("back to the viewer, Review asks what to cover, from their review at first, and where, the keyboard on This session", () => {
    expect(rereviewQuestion(rowOf(9), false, NOW, true)).toEqual({
      header: "Review PR",
      subject: "#9 Cache the tiles",
      text: "What should it cover, and where?",
      detail:
        "Your review was on a1b2c3d, 20h ago; new commits came in since. Here it runs in this conversation. A new session opens with the review typed in, for you to send.",
      choices: ["This session", "New session", "Cancel"],
      main: null,
      instructions: "to a review in this session",
      picking: {
        names: ["Since Your Review", "Full Review"],
        isSingle: true,
        initial: [0],
        needsPick: false,
        startsOn: "answers",
        // Claude Code's own dialog asks what to cover, then where, each in its own words.
        steps: {
          names: {
            text: "What should it cover?",
            detail: "Your review was on a1b2c3d, 20h ago; new commits came in since."
          },
          answers: {
            text: "Where should it be reviewed?",
            detail: "Here it runs in this conversation. A new session opens with the review typed in, for you to send."
          }
        }
      }
    })
  })

  test("where no new session can open, it asks only what to cover, and Start Review starts it here", () => {
    expect(rereviewQuestion(rowOf(9), true, NOW, false)).toMatchObject({
      text: "What should it cover?",
      detail:
        "Your review was on a1b2c3d, 20h ago; new commits came in since. This session is busy, so here the review starts once its turn ends.",
      choices: [START_REVIEW, "Cancel"],
      main: START_REVIEW
    })
  })

  test("its answer: where, and whether from the viewer's review; instructions go along, sent alone review here", () => {
    const since = [REVIEW_KINDS.since]
    const full = [REVIEW_KINDS.full]

    expect(readReviewAnswer({ choice: SESSION_CHOICES.new, instructions: "", picks: since })).toEqual({
      place: { kind: "new" },
      isSince: true
    })
    expect(readReviewAnswer({ choice: SESSION_CHOICES.here, instructions: "just bugs", picks: full })).toEqual({
      place: { kind: "here", note: "just bugs" },
      isSince: false
    })
    expect(readReviewAnswer({ choice: START_REVIEW, instructions: "", picks: since })).toEqual({
      place: { kind: "here" },
      isSince: true
    })
    expect(readReviewAnswer({ choice: null, instructions: "just bugs", picks: since })).toEqual({
      place: { kind: "here", note: "just bugs" },
      isSince: true
    })
    expect(readReviewAnswer({ choice: "Cancel", instructions: "", picks: since }).place).toEqual({ kind: "cancel" })
  })

  test("instructions follow the pull request after --, on one line, after since where the review starts from the viewer's", () => {
    expect(reviewArgs("7", "just bugs", true)).toBe("7 since -- just bugs")
    expect(reviewArgs("7", undefined, true)).toBe("7 since")
    expect(reviewArgs("7")).toBe("7")
    expect(reviewArgs("https://github.com/acme/app/pull/7", "focus on\n  the migration ")).toBe(
      "https://github.com/acme/app/pull/7 -- focus on the migration"
    )
  })
})

describe("a new session", () => {
  const PROMPT = "/gh-prs-monitor:review https://github.com/acme/app/pull/7 -- a & b?"

  // A machine that answers `uname -s` as the given system, or cannot start it, and records what ran.
  function fakeHost(system: string | null, opened: Partial<ProcessRunResult> = {}) {
    const runs: string[] = []
    const host: Host = {
      run: async (argv) => {
        runs.push(argv.join(" "))
        if (argv[0] === "uname") {
          if (system === null) {
            throw new Error("spawn uname ENOENT")
          }

          return { exitCode: 0, stdout: `${system}\n`, stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
        }

        return { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false, ...opened }
      },
      read: async () => "",
      write: async () => undefined,
      exists: async () => false,
      isLink: async () => false
    }

    return { host, runs }
  }

  test("the terminal, the desktop app and VS Code can open one; the phone app can't", () => {
    expect(["terminal", "desktop", "vscode", "mobile"].filter(canOpenSession)).toEqual([
      "terminal",
      "desktop",
      "vscode"
    ])
  })

  test("VS Code's opens by its editor's scheme, or else VS Code's; the scheme is read for VS Code alone", async () => {
    let reads = 0
    const scheme = async () => {
      reads++

      return "cursor"
    }
    const none = async () => null

    expect(await sessionAppFor("terminal", scheme)).toEqual({ surface: "terminal" })
    expect(await sessionAppFor("desktop", scheme)).toEqual({ surface: "desktop" })
    expect(reads).toBe(0)
    expect(await sessionAppFor("vscode", scheme)).toEqual({ surface: "vscode", scheme: "cursor" })
    expect(reads).toBe(1)
    expect(await sessionAppFor("vscode", none)).toEqual({ surface: "vscode", scheme: "vscode" })
  })

  test("only VS Code, whose scheme may be a guess, goes on in this session where its link can't be opened", () => {
    expect(runsHereWhenUnopened({ surface: "vscode", scheme: "vscode" })).toBe(true)
    expect(runsHereWhenUnopened({ surface: "terminal" })).toBe(false)
    expect(runsHereWhenUnopened({ surface: "desktop" })).toBe(false)
  })

  test("only the terminal opens one inside a worktree's folder", () => {
    expect(canOpenInWorktree({ surface: "terminal" })).toBe(true)
    expect(canOpenInWorktree({ surface: "desktop" })).toBe(false)
    expect(canOpenInWorktree({ surface: "vscode", scheme: "vscode" })).toBe(false)
  })

  test("the link names the folder and the prompt, encoded; VS Code's, by its editor's scheme, the prompt alone", () => {
    const encoded =
      "%2Fgh-prs-monitor%3Areview%20https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7%20--%20a%20%26%20b%3F"
    expect(newSessionLink({ surface: "terminal" }, "/Users/me/My Repos/app", PROMPT)).toBe(
      `claude-cli://open?cwd=%2FUsers%2Fme%2FMy%20Repos%2Fapp&q=${encoded}`
    )
    expect(newSessionLink({ surface: "desktop" }, "/Users/me/My Repos/app", PROMPT)).toBe(
      `claude://code/new?folder=%2FUsers%2Fme%2FMy%20Repos%2Fapp&q=${encoded}`
    )
    expect(newSessionLink({ surface: "vscode", scheme: "cursor" }, "/Users/me/My Repos/app", PROMPT)).toBe(
      `cursor://anthropic.claude-code/open?prompt=${encoded}`
    )
  })

  describe("the editor's scheme", () => {
    // `VSCODE_NLS_CONFIG` as an editor's extension host is handed it, and a machine whose files answer by path.
    const config = (messages: unknown) => JSON.stringify({ locale: "en", defaultMessagesFile: messages })
    function filesHost(files: Record<string, string>) {
      const reads: string[] = []
      const host = {
        read: async (path: string) => {
          reads.push(path)
          const content = files[path]
          if (content === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`)
          }

          return content
        }
      }

      return { host, reads }
    }

    test("is the urlProtocol of the product file in the app folder the messages file lies in", async () => {
      const cursor = filesHost({
        "/Applications/Cursor.app/Contents/Resources/app/product.json": JSON.stringify({ urlProtocol: "cursor" })
      })
      expect(
        await editorScheme(cursor.host, config("/Applications/Cursor.app/Contents/Resources/app/out/nls.messages.json"))
      ).toBe("cursor")
      expect(cursor.reads).toEqual(["/Applications/Cursor.app/Contents/Resources/app/product.json"])

      // On Windows, by its own separator.
      const app = "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code Insiders\\resources\\app"
      const insiders = filesHost({ [`${app}\\product.json`]: JSON.stringify({ urlProtocol: "vscode-insiders" }) })
      expect(await editorScheme(insiders.host, config(`${app}\\out\\nls.messages.json`))).toBe("vscode-insiders")
    })

    test("is none where the variable, its messages file, the product file or its scheme reads otherwise", async () => {
      const product = "/opt/editor/resources/app/product.json"
      const messages = config("/opt/editor/resources/app/out/nls.messages.json")
      const answering = (urlProtocol: unknown) => filesHost({ [product]: JSON.stringify({ urlProtocol }) }).host

      expect(await editorScheme(answering("vscode"), undefined)).toBeNull()
      expect(await editorScheme(answering("vscode"), "not json")).toBeNull()
      expect(await editorScheme(answering("vscode"), JSON.stringify({ locale: "en" }))).toBeNull()
      expect(await editorScheme(answering("vscode"), config(42))).toBeNull()
      expect(await editorScheme(answering("vscode"), config("/opt/editor/resources/app/nls.messages.json"))).toBeNull()
      expect(await editorScheme(filesHost({}).host, messages)).toBeNull()
      expect(await editorScheme(filesHost({ [product]: "{" }).host, messages)).toBeNull()
      expect(await editorScheme(answering(undefined), messages)).toBeNull()
      expect(await editorScheme(answering("not a scheme://"), messages)).toBeNull()
      expect(await editorScheme(answering(""), messages)).toBeNull()
      expect(await editorScheme(answering("vscode"), messages)).toBe("vscode")
    })
  })

  test("a prompt Claude Code's handler would turn away: over 5,000 characters, or with a control character", () => {
    expect(linkRefusal("a".repeat(5_000))).toBeNull()
    expect(linkRefusal("a".repeat(5_001))).toBe("its command is longer than the 5,000 characters a link may carry")
    expect(linkRefusal("one\ttwo\nthree")).toBeNull()
    expect(linkRefusal("red \u001b[31mfailed")).toBe("its command holds a control character a link may not carry")
  })

  test("opens with the system's own opener", async () => {
    const url = "claude-cli://open?cwd=%2Frepo"
    for (const [system, opener] of [
      ["Darwin", "open"],
      ["Linux", "xdg-open"],
      ["FreeBSD", "xdg-open"],
      ["MINGW64_NT-10.0-22631", "rundll32 url.dll,FileProtocolHandler"],
      ["MSYS_NT-10.0", "rundll32 url.dll,FileProtocolHandler"],
      [null, "rundll32 url.dll,FileProtocolHandler"]
    ] as const) {
      const { host, runs } = fakeHost(system)
      await openLink(host, url)
      // Windows' opener reports success for any link, so the scheme's handler is looked up first.
      const lookup = opener.startsWith("rundll32") ? ["reg query HKCR\\claude-cli"] : []
      expect(runs).toEqual(["uname -s", ...lookup, `${opener} ${url}`])
    }
  })

  test("on Windows, a scheme nothing handles is said before anything opens", async () => {
    const url = "claude://code/new?folder=C%3A%5Crepo"
    const runs: string[] = []
    const host: Host = {
      run: async (argv) => {
        runs.push(argv.join(" "))
        if (argv[0] === "uname") {
          throw new Error("spawn uname ENOENT")
        }

        return {
          exitCode: argv[0] === "reg" ? 1 : 0,
          stdout: "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false
        }
      },
      read: async () => "",
      write: async () => undefined,
      exists: async () => false,
      isLink: async () => false
    }

    await expect(openLink(host, url)).rejects.toThrow("nothing on this machine opens claude:// links")
    expect(runs).toEqual(["uname -s", "reg query HKCR\\claude"])
  })

  test("a link that would not open says why, naming it by its scheme", async () => {
    const url = "claude-cli://open?cwd=%2Frepo&q=x"
    const refused = fakeHost("Darwin", {
      exitCode: 1,
      stderr: `No application knows how to open URL ${url} (Error -10814)\n`
    })
    await expect(openLink(refused.host, url)).rejects.toThrow(
      "No application knows how to open URL claude-cli://open (Error -10814)"
    )

    const silent = fakeHost("Linux", { exitCode: 3 })
    await expect(openLink(silent.host, url)).rejects.toThrow("xdg-open exited with 3")
  })
})

describe("stableButtons", () => {
  const drawn = new Map()
  // A stand-in for the engine's Button: each one built is a new element, as each gets a handle of its own.
  let built = 0
  const Button = ((props: { key?: string; label?: string; onPress: () => void }) => ({
    type: "Button",
    props,
    press: { handle: ++built }
  })) as unknown as Parameters<typeof stableButtons>[2]
  const press = (): void => undefined

  test("a button drawn again as it was is the same element, its first closure kept", () => {
    const first = () => undefined
    const one = stableButtons(drawn, "terminal:a", Button)({ key: "refresh", label: "Refresh", onPress: first })
    const again = stableButtons(drawn, "terminal:a", Button)({ key: "refresh", label: "Refresh", onPress: press })

    expect(again).toBe(one)
    expect((again as unknown as { props: { onPress: unknown } }).props.onPress).toBe(first)
  })

  test("one that looks different, or is drawn at another site, is built afresh", () => {
    const one = stableButtons(drawn, "terminal:b", Button)({ key: "view", label: "Compact", onPress: press })

    expect(stableButtons(drawn, "terminal:b", Button)({ key: "view", label: "Full", onPress: press })).not.toBe(one)
    expect(stableButtons(drawn, "desktop:b", Button)({ key: "view", label: "Compact", onPress: press })).not.toBe(one)
  })

  test("a site keeps only its latest drawing's buttons", () => {
    const one = stableButtons(drawn, "terminal:c", Button)({ key: "review-7", label: "Review", onPress: press })
    stableButtons(drawn, "terminal:c", Button)({ key: "review-8", label: "Review", onPress: press })

    expect(stableButtons(drawn, "terminal:c", Button)({ key: "review-7", label: "Review", onPress: press })).not.toBe(
      one
    )
  })
})

describe("the pull request a skill's arguments name", () => {
  const REPO = { name: "acme/app", host: "github.com" }

  test("the first word past the options the pane adds, before any instructions", () => {
    expect(pullRefIn("7")).toBe("7")
    expect(pullRefIn("  #7 -- focus on the API")).toBe("#7")
    expect(pullRefIn("https://github.com/acme/app/pull/7 since -- only the tests")).toBe(
      "https://github.com/acme/app/pull/7"
    )
    expect(
      pullRefIn('--include-outdated --worktree "/Users/me/My Repos/pr-7" --deps "npm ci failed: \\"x\\"" 7 -- note')
    ).toBe("7")
    expect(pullRefIn("https://github.com/acme/app/pull/7 --include-outdated")).toBe(
      "https://github.com/acme/app/pull/7"
    )
  })

  test("none when only options or instructions are given, as a bare Resolve Comments", () => {
    expect(pullRefIn("")).toBe(null)
    expect(pullRefIn("--include-outdated")).toBe(null)
    expect(pullRefIn("-- only the naming ones")).toBe(null)
  })

  test("read back from every line the pane writes: the pull request it hands a skill, none for Create PR's", () => {
    const url = "https://github.com/acme/app/pull/7"
    const worktree = '/Users/me/My "Repos"/pr-7'
    const note = 'go -- on, "now" 8'
    const full = { worktree, deps: 'npm ci failed: "x" 9', includeOutdated: true, note }

    expect(pullRefIn(skillArgs(url, full))).toBe(url)
    expect(pullRefIn(skillArgs(url, {}))).toBe(url)
    expect(pullRefIn(reviewArgs(url, note))).toBe(url)
    expect(pullRefIn(reviewArgs("7"))).toBe("7")
    expect(pullRefIn(createArgs({ branch: "fix 7", worktree, note }))).toBe(null)
    expect(pullRefIn(createArgs({ branch: "8" }))).toBe(null)
  })

  test("a number, #number, or an address on this repository names its pull request", () => {
    expect(pullNumberOf("7", REPO)).toBe(7)
    expect(pullNumberOf("#7", null)).toBe(7)
    expect(pullNumberOf("https://github.com/acme/app/pull/7", REPO)).toBe(7)
    expect(pullNumberOf("https://GitHub.com/Acme/App/pull/7/files", REPO)).toBe(7)
  })

  test("another repository's or host's address, or an address with no repository known, names none here", () => {
    expect(pullNumberOf("https://github.com/acme/other/pull/7", REPO)).toBe(null)
    expect(pullNumberOf("https://ghe.example.com/acme/app/pull/7", REPO)).toBe(null)
    expect(pullNumberOf("https://github.com/acme/app/pull/7", null)).toBe(null)
    expect(pullNumberOf("menu", REPO)).toBe(null)
  })
})

describe("putting the pane's window back after a question", () => {
  const MARK = "back-to-row"
  const PRESSED = "review-7"
  const TO_MARK = `scroll ${MARK} start`
  const PAUSE = `sleep ${BACK_TO_ROW_PAUSE_MS}`

  // An engine answering each scroll from `answers` in turn, moved once they run out, the person moving the window
  // after `movedAfter` scrolls; what is asked of it, in order.
  function backHost(answers: ({ deny: string } | "throws")[], movedAfter = Infinity, isFocusFailing = false) {
    const calls: string[] = []
    let scrolls = 0
    let isEnded = false
    const host: BackHost = {
      scrollTo: async (key, block) => {
        calls.push(`scroll ${key} ${block}`)
        scrolls++
        const answer = answers.shift() ?? {}
        if (answer === "throws") {
          throw new Error("the pane went")
        }

        return answer
      },
      redraw: () => {
        calls.push("redraw")
      },
      sleep: async (ms) => {
        calls.push(`sleep ${ms}`)
      },
      focus: async (key) => {
        calls.push(`focus ${key}`)
        if (isFocusFailing) {
          throw new Error("the button went")
        }
      },
      isGoingBack: () => !isEnded && scrolls < movedAfter,
      end: () => {
        calls.push("end")
        isEnded = true
      }
    }

    return { host, calls }
  }
  const NOT_FOUND = { deny: "no element of its own is drawn under that key" }

  test("a try that finds no mark asks for a drawing and comes again; one that moved, once more; then the ring on the button", async () => {
    const { host, calls } = backHost([NOT_FOUND, "throws"])
    await goBack(host, MARK, PRESSED)

    expect(calls).toEqual([
      TO_MARK,
      "redraw",
      PAUSE,
      TO_MARK,
      "redraw",
      PAUSE,
      TO_MARK,
      PAUSE,
      TO_MARK,
      "end",
      `focus ${PRESSED}`
    ])
  })

  test("where the mark is never found, the window goes to the button pressed, centred", async () => {
    const { host, calls } = backHost(Array.from({ length: BACK_TO_ROW_TRIES }, () => NOT_FOUND))
    await goBack(host, MARK, PRESSED)

    expect(calls.filter((call) => call === TO_MARK)).toHaveLength(BACK_TO_ROW_TRIES)
    expect(calls.filter((call) => call === "redraw")).toHaveLength(BACK_TO_ROW_TRIES)
    // No pause after the last try.
    expect(calls.filter((call) => call === PAUSE)).toHaveLength(BACK_TO_ROW_TRIES - 1)
    expect(calls.slice(-3)).toEqual([`scroll ${PRESSED} center`, "end", `focus ${PRESSED}`])
  })

  test("where no mark is drawn (a surface that can't place one), the window goes to the button pressed at once", async () => {
    const { host, calls } = backHost([])
    await goBack(host, null, PRESSED)

    expect(calls).toEqual([`scroll ${PRESSED} center`, "end", `focus ${PRESSED}`])
  })

  test("a fallback or a focus the engine refuses ends it all the same", async () => {
    const { host, calls } = backHost(
      [...Array.from({ length: BACK_TO_ROW_TRIES }, () => NOT_FOUND), "throws"],
      Infinity,
      true
    )
    await goBack(host, MARK, PRESSED)

    expect(calls.slice(-3)).toEqual([`scroll ${PRESSED} center`, "end", `focus ${PRESSED}`])
  })

  test("the person's own scroll or keys meanwhile end it where they are: no more tries, no button, the ring left", async () => {
    const { host, calls } = backHost([NOT_FOUND], 1)
    await goBack(host, MARK, PRESSED)

    expect(calls).toEqual([TO_MARK, "redraw", PAUSE, "end"])
  })

  test("the pane closed: opened again, its window starts at the top and goes back nowhere", () => {
    const window = { listOffset: 12, goingBack: { offset: 12 } }
    forgetWindow(window)

    expect(window).toEqual({ listOffset: 0, goingBack: null })
  })

  test("the person's own move ends a window going back; where one over the list lands is kept", async () => {
    const asking = {
      question: {
        header: "Merge",
        subject: "#7 Fix the menu",
        text: "Merge it?",
        detail: null,
        choices: ["Merge", "Cancel"],
        main: "Merge",
        instructions: null
      },
      answer: () => undefined,
      isAnswered: false,
      isInPane: true,
      fieldKey: "answer-text",
      draft: "",
      picks: []
    }
    const window = { listOffset: 3, goingBack: { offset: 3 } as { offset: number } | null, asking: null }

    expect(await windowMoved(window, true, 9, async () => ({}))).toEqual({})
    expect(window).toMatchObject({ listOffset: 9, goingBack: null })

    window.goingBack = { offset: 9 }
    await windowMoved(window, false, 14, async () => ({}))
    expect(window).toMatchObject({ listOffset: 14, goingBack: { offset: 9 } })
    // One the engine refused, or a move over a question, leaves the list's place as it was.
    expect(await windowMoved(window, false, 20, async () => ({ deny: "the pane is not open" }))).toEqual({
      deny: "the pane is not open"
    })
    await windowMoved({ ...window, asking }, false, 30, async () => ({}))
    expect(window.listOffset).toBe(14)
  })

  test("the keyboard moved by the person onto one of the plugin's elements ends a window going back", () => {
    const window = { goingBack: { offset: 5 } as { offset: number } | null }
    focusMoved(window, true, false)
    focusMoved(window, false, true)
    expect(window.goingBack).toEqual({ offset: 5 })

    focusMoved(window, true, true)
    expect(window.goingBack).toBe(null)
  })
})

describe("the store's keys", () => {
  // A server name long enough, with a long repository, to pass the store's 256 characters under any prefix.
  const LONG = { host: `${"h".repeat(120)}.example`, name: `${"o".repeat(39)}/${"r".repeat(100)}` }

  test("an id that fits goes in whole; one longer than the store takes, by its hash", () => {
    const fitting = "x".repeat(256 - "look:".length)

    expect(storeKey("look:", fitting)).toBe(`look:${fitting}`)
    expect(storeKey("look:", `${fitting}x`)).toBe(`look:${shortHash(`${fitting}x`)}`)
    // Under the longest prefix the same id goes under, so its keys end alike.
    expect(storeKey("look:", fitting, "createPr:")).toBe(`look:${shortHash(fitting)}`)
  })

  test("a repository's last look, cleanup notes and Create PR choices on a long server name each fit", () => {
    const id = `${LONG.host}/${LONG.name}`
    const look = lookKey(LONG)
    const choices = choicesKey(id)

    expect(look).toBe(`look:${shortHash(id)}`)
    expect(choices).toBe(`createPr:${shortHash(id)}`)
    expect(lookKey({ ...LONG, name: `${"p".repeat(39)}/${"r".repeat(100)}` })).not.toBe(look)
    for (const key of [look, choices ?? ""]) {
      expect(key.length).toBeLessThanOrEqual(256)
    }
  })
})

describe("the create-pr skill's choices tool", () => {
  // The store as the tool reaches it, in memory; every read and write failing where `fails` says.
  const keptIn = (stored: Record<string, unknown>, fails = false): KeptChoices => ({
    recall: async (key) => {
      if (fails) {
        throw new Error("store unavailable")
      }

      return stored[key]
    },
    keep: async (key, choices) => {
      if (fails) {
        throw new Error("store unavailable")
      }
      stored[key] = choices
    }
  })
  const CHOICES = { isDraft: true, checks: ["npm test"], reviewers: ["ann"] }

  test("a repository named other than <host>/<owner>/<name> is refused, saying how to name it", async () => {
    const deny = "repo names the repository as <host>/<owner>/<name>, as github.com/acme/app."

    expect(await answerChoices(keptIn({}), { repo: "acme/app" })).toEqual({ deny })
    expect(await answerChoices(keptIn({}), {})).toEqual({ deny })
  })

  test("hands over what is kept, or none; keeps what is saved, only whole", async () => {
    const kept = keptIn({})

    expect(await answerChoices(kept, { repo: "github.com/acme/app" })).toEqual({ result: "none" })
    expect(await answerChoices(kept, { repo: "github.com/acme/app", save: { isDraft: "no" } })).toEqual({
      deny: "save takes isDraft (true or false), checks and reviewers (lists of up to 50 texts, each up to 200 characters)."
    })
    expect(await answerChoices(kept, { repo: "github.com/acme/app", save: CHOICES })).toEqual({ result: "saved" })
    expect(await answerChoices(kept, { repo: "github.com/Acme/App" })).toEqual({ result: JSON.stringify(CHOICES) })
  })

  test("a store that fails refuses the call, saying why", async () => {
    expect(await answerChoices(keptIn({}, true), { repo: "github.com/acme/app" })).toEqual({
      deny: "The choices could not be read or kept: store unavailable"
    })
  })
})

describe("linksOf", () => {
  test("the repository's pull requests, and one by number, on its own host", () => {
    const links = linksOf({ host: "git.example.com", name: "acme/app" })

    expect(links.pulls).toBe("https://git.example.com/acme/app/pulls")
    expect(links.pull(7)).toBe("https://git.example.com/acme/app/pull/7")
  })
})

describe("the create-pr skill's kept choices", () => {
  test("kept per repository and server, whatever the case of its name", () => {
    expect(choicesKey("github.com/acme/app")).toBe("createPr:github.com/acme/app")
    expect(choicesKey("git.example.com/Acme/App")).toBe("createPr:git.example.com/acme/app")
    for (const other of ["acme/app", "github.com/acme", "github.com/acme/app/pull", "github.com/acme/my app", ""]) {
      expect(choicesKey(other)).toBeNull()
    }
  })

  test("read back only whole: a draft or not, and lists of text", () => {
    const choices = { isDraft: false, checks: ["npm test"], reviewers: [] }

    expect(readChoices(choices)).toEqual(choices)
    expect(readChoices({ ...choices, extra: 1 })).toEqual(choices)
    for (const broken of [null, "x", { ...choices, isDraft: "no" }, { ...choices, checks: [1] }, { isDraft: true }]) {
      expect(readChoices(broken)).toBeNull()
    }
  })

  test("up to 50 checks or reviewers, each up to 200 characters; more is no choice of a run", () => {
    const most = { isDraft: false, checks: Array(50).fill("c".repeat(200)), reviewers: Array(50).fill("ann") }

    expect(readChoices(most)).toEqual(most)
    expect(readChoices({ ...most, checks: [...most.checks, "npm test"] })).toBeNull()
    expect(readChoices({ ...most, reviewers: ["a".repeat(201)] })).toBeNull()
  })
})

describe("checkingAgain", () => {
  test("in minutes, a minute alone, or whole hours", () => {
    expect([1, 1.5, 3, 90, 60, 120, 1440].map(checkingAgain)).toEqual([
      "Checking again every minute.",
      "Checking again every 1.5 minutes.",
      "Checking again every 3 minutes.",
      "Checking again every 90 minutes.",
      "Checking again every hour.",
      "Checking again every 2 hours.",
      "Checking again every 24 hours."
    ])
  })
})

describe("lookedAt", () => {
  const NOW = new Date(2026, 9, 7, 9, 5).getTime()

  test("the time alone today, then yesterday, then the date", () => {
    expect(lookedAt(new Date(2026, 9, 7, 0, 10).getTime(), NOW)).toBe("00:10")
    expect(lookedAt(new Date(2026, 9, 6, 23, 59).getTime(), NOW)).toBe("yesterday 23:59")
    expect(lookedAt(new Date(2026, 9, 5, 17, 40).getTime(), NOW)).toBe("5 Oct 17:40")
    expect(lookedAt(new Date(2026, 8, 30, 8, 0).getTime(), new Date(2026, 9, 1, 8, 0).getTime())).toBe(
      "yesterday 08:00"
    )
  })
})

describe("/prs report", () => {
  const FACTS: ReportFacts = {
    version: "1.0.0",
    repository: "maturada/gh-prs-monitor",
    claudeCode: "2.1.302",
    system: "macOS 26.4 (Darwin 25.4.0)",
    gh: "2.97.0",
    git: "2.50.1"
  }
  const MANIFEST = JSON.stringify({ version: "1.0.0", repository: "https://github.com/maturada/gh-prs-monitor" })
  const MAC: Record<string, string | null> = {
    "uname -sr": "Darwin 25.4.0",
    "sw_vers -productVersion": "26.4",
    "gh --version": "gh version 2.97.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.97.0",
    "git -c core.hooksPath=/dev/null --version": "git version 2.50.1 (Apple Git-155)"
  }
  const NOTHING_READ: ReportFacts = {
    version: null,
    repository: null,
    claudeCode: null,
    system: null,
    gh: null,
    git: null
  }

  // A machine that answers each command line with its output, or can't start it (null), and the runs it was asked for,
  // with their timeouts.
  function reportHost(answers: Record<string, string | null>, manifest = MANIFEST) {
    const runs: [string, number | undefined][] = []
    const host: ReportHost = {
      run: async (argv, init) => {
        runs.push([argv.join(" "), init?.timeoutMs])
        const answer = answers[argv.join(" ")]
        if (answer === null || answer === undefined) {
          throw new Error(`Executable not found in $PATH: "${argv[0]}"`)
        }

        return { exitCode: 0, stdout: `${answer}\n`, stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
      },
      manifest: async () => manifest,
      engineVersion: async () => "2.1.302"
    }

    return { host, runs }
  }

  test("links a bug report with the versions filled in, an idea, and the issues already open", () => {
    expect(reportText(FACTS)).toBe(
      [
        "gh-prs-monitor 1.0.0 · Claude Code 2.1.302 · macOS 26.4 (Darwin 25.4.0) · gh 2.97.0 · git 2.50.1",
        "",
        "- [Report a bug](https://github.com/maturada/gh-prs-monitor/issues/new?template=bug_report.yml&plugin=1.0.0" +
          "&claude-code=2.1.302&system=macOS+26.4+%28Darwin+25.4.0%29%2C+gh+2.97.0%2C+git+2.50.1), with these " +
          "versions filled in",
        "- [Suggest an idea](https://github.com/maturada/gh-prs-monitor/issues/new?template=feature_request.yml)",
        "- [Issues already open](https://github.com/maturada/gh-prs-monitor/issues), to see whether it is known",
        "",
        "From a terminal: `gh issue create --repo maturada/gh-prs-monitor`. Leave out anything private: tokens, " +
          "private repositories' names, paths."
      ].join("\n")
    )
  })

  test("what could not be read is left out of the line and the link, for the person to fill in", () => {
    const text = reportText({ ...FACTS, claudeCode: null, system: null, gh: null })

    expect(text.split("\n")[0]).toBe("gh-prs-monitor 1.0.0 · git 2.50.1")
    expect(text).toContain("issues/new?template=bug_report.yml&plugin=1.0.0&system=git+2.50.1)")
  })

  test("a copy whose manifest names no github.com repository says so, and links nowhere", () => {
    expect(reportText({ ...FACTS, repository: null })).toBe(
      "gh-prs-monitor 1.0.0 · Claude Code 2.1.302 · macOS 26.4 (Darwin 25.4.0) · gh 2.97.0 · git 2.50.1\n\n" +
        "This copy of gh-prs-monitor names no github.com repository to report to."
    )
    expect(reportText(NOTHING_READ)).toBe("This copy of gh-prs-monitor names no github.com repository to report to.")
  })

  test("the manifest's github.com repository, in the forms a manifest gives one", () => {
    const repository = (named: unknown) =>
      manifestFacts(JSON.stringify({ version: "1.0.0", repository: named })).repository

    expect(manifestFacts(MANIFEST)).toEqual({ version: "1.0.0", repository: "maturada/gh-prs-monitor" })
    expect(
      [
        "https://github.com/ann/prs",
        "https://github.com/ann/prs/",
        "https://www.GitHub.com/ann/prs.git",
        "http://github.com/ann/prs",
        "git+https://github.com/ann/prs.git",
        "ssh://git@github.com/ann/prs.git",
        "git@github.com:ann/prs.git",
        "github:ann/prs",
        "ann/prs"
      ].map(repository)
    ).toEqual(Array(9).fill("ann/prs"))
    expect(
      [
        "https://gitlab.com/ann/prs",
        "https://github.example.com/ann/prs",
        "https://github.com/ann",
        "https://github.com/ann/prs/issues",
        "./ann/prs",
        "",
        undefined,
        { url: "https://github.com/ann/prs" }
      ].map(repository)
    ).toEqual(Array(8).fill(null))
    expect(manifestFacts("not json")).toEqual({ version: null, repository: null })
    expect(manifestFacts("null")).toEqual({ version: null, repository: null })
  })

  test("reads the versions from the manifest, Claude Code and the machine, each command given 10 seconds", async () => {
    const mac = reportHost(MAC)

    expect(await reportFacts(mac.host)).toEqual(FACTS)
    expect(mac.runs.map(([line]) => line).sort()).toEqual(Object.keys(MAC).sort())
    expect(mac.runs.map(([, timeoutMs]) => timeoutMs)).toEqual([10_000, 10_000, 10_000, 10_000])

    const linux = reportHost({ ...MAC, "uname -sr": "Linux 6.8.0-45-generic" })
    expect((await reportFacts(linux.host)).system).toBe("Linux 6.8.0-45-generic")
    expect(linux.runs.map(([line]) => line)).not.toContain("sw_vers -productVersion")

    const noRelease = reportHost({ ...MAC, "sw_vers -productVersion": null })
    expect((await reportFacts(noRelease.host)).system).toBe("macOS (Darwin 25.4.0)")
  })

  test("a command missing, failing or answering otherwise, or a manifest unread, leaves only that out", async () => {
    const { host } = reportHost({ ...MAC, "uname -sr": null, "gh --version": "a wrapper around gh version 2.97.0" })
    const failing: ReportHost = {
      ...host,
      // git prints its version, and fails all the same.
      run: async (argv, init) =>
        argv[0] === "git"
          ? {
              exitCode: 1,
              stdout: "git version 2.50.1\n",
              stderr: "fatal",
              isStdoutTruncated: false,
              isStderrTruncated: false
            }
          : host.run(argv, init),
      manifest: async () => {
        throw new Error("ENOENT")
      },
      engineVersion: async () => {
        throw new Error("no version")
      }
    }

    expect(await reportFacts(failing)).toEqual(NOTHING_READ)
  })
})
