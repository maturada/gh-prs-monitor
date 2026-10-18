// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import type { PullRow } from "../types"
import { GH_MISSING } from "./gh"
import {
  currentPull,
  failedRuns,
  GhFailure,
  ghWrite,
  mergeOutcome,
  mergeStacked,
  problemOf,
  pullStates,
  queryPulls,
  stackOf,
  viewRepo
} from "./github"
import { pullsQuery } from "./pulls"
import { REPO, snapshotOf } from "./testing/fixtures"
import { hostAnswering } from "./testing/git-host"

function rowOf(number: number, headOid = `head-${number}`): PullRow {
  return snapshotOf({ mine: [{ number, headRefOid: headOid }] }).mine[0]!
}

function cannotStart(): never {
  throw new Error("spawn gh ENOENT")
}

describe("the requests' commands", () => {
  test("the lists ask about the repository by owner and name, with each search, the query last", async () => {
    const host = hostAnswering(() => ({ exitCode: 0, stdout: "{}" }))
    await queryPulls(host, REPO, true)

    const scope = "repo:acme/app is:pr is:open sort:updated-desc"
    expect(host.runs).toEqual([
      {
        argv: [
          ...["gh", "api", "graphql", "--hostname", "github.com", "-f", "owner=acme", "-f", "name=app"],
          ...["-f", `mine=${scope} author:@me`, "-f", `requested=${scope} review-requested:@me`],
          ...["-f", `commented=${scope} commenter:@me -author:@me`],
          ...["-f", `reviewed=${scope} reviewed-by:@me -author:@me`],
          ...["-f", `mentioned=${scope} mentions:@me -author:@me`],
          ...["-f", `query=${pullsQuery(true)}`]
        ],
        timeoutMs: 30_000
      }
    ])
  })

  test("a pull request's number goes as a number, on the repository's own host", async () => {
    const host = hostAnswering(() => ({ exitCode: 0, stdout: "{}" }))
    await mergeOutcome(host, { name: "acme/app", host: "git.acme.dev" }, 7)
    await failedRuns(host, REPO, 7)

    expect(host.runs.map(({ argv }) => argv.slice(0, 11))).toEqual(
      ["git.acme.dev", "github.com"].map((hostName) => [
        ...["gh", "api", "graphql", "--hostname", hostName, "-f", "owner=acme", "-f", "name=app"],
        ...["-F", "number=7"]
      ])
    )
    expect(host.runs.map(({ timeoutMs }) => timeoutMs)).toEqual([30_000, 30_000])
    expect(host.runs.map(({ argv }) => argv.slice(11).map((arg) => arg.slice(0, 6)))).toEqual([
      ["-f", "query="],
      ["-f", "query="]
    ])
  })
})

describe("the repository", () => {
  test("is found from the git remote", async () => {
    const host = hostAnswering(() => ({ exitCode: 0, stdout: "acme/app https://git.acme.dev/acme/app\n" }))

    expect(await viewRepo(host)).toEqual({ repo: { name: "acme/app", host: "git.acme.dev" } })
    expect(host.runs.map(({ timeoutMs }) => timeoutMs)).toEqual([30_000])
  })

  test("what gh says when it can't find one is the problem", async () => {
    const host = hostAnswering(() => ({ exitCode: 1, stderr: "fatal: not a git repository (or any parent)" }))

    expect(await viewRepo(host)).toEqual({
      problem: { message: "This folder is not a git repository, so it has no GitHub project.", isPermanent: true }
    })
  })

  test("gh that cannot start is missing; one that starts but did not finish is said so", async () => {
    expect(await viewRepo(hostAnswering(cannotStart))).toEqual({ problem: GH_MISSING })

    const slow = hostAnswering((argv) => (argv[1] === "--version" ? { exitCode: 0 } : cannotStart()))
    expect(await viewRepo(slow)).toEqual({
      problem: { message: "The GitHub CLI did not finish (spawn gh ENOENT).", isPermanent: false }
    })
    expect(slow.runs.map(({ argv, timeoutMs }) => [argv[1], timeoutMs])).toEqual([
      ["repo", 30_000],
      ["--version", 10_000]
    ])
  })

  test("gh that only runs out of time is not missing: a passing problem, the checks going on", async () => {
    const stalled = hostAnswering(() => {
      throw new Error("timed out after 10000 ms")
    })

    expect(await viewRepo(stalled)).toEqual({
      problem: { message: "The GitHub CLI did not finish (timed out after 10000 ms).", isPermanent: false }
    })
  })
})

describe("how pull requests ended", () => {
  test("the answers GitHub gave are read even where it could not find one of them", async () => {
    const answer = {
      data: {
        repository: { p4: null, p5: { number: 5, state: "MERGED", headRefOid: "abc", mergedBy: { login: "ann" } } }
      }
    }
    const host = hostAnswering(() => ({ exitCode: 1, stdout: JSON.stringify(answer), stderr: "Could not resolve" }))

    const states = await pullStates(host, REPO, [4, 5])

    expect(states).toEqual([
      { number: 5, state: "MERGED", by: "ann", head: "abc", branch: null, isCrossRepository: false, headRepo: null }
    ])
    expect(host.runs.map(({ timeoutMs }) => timeoutMs)).toEqual([30_000])
  })

  test("none where GitHub found none of them, and rejects where it sent no answer", async () => {
    const none = hostAnswering(() => ({ exitCode: 0, stdout: JSON.stringify({ data: { repository: {} } }) }))
    expect(await pullStates(none, REPO, [4])).toEqual([])

    const refused = hostAnswering(() => ({
      exitCode: 1,
      stdout: JSON.stringify({ message: "Server Error" }),
      stderr: "gh: Server Error (HTTP 502)\n"
    }))
    await expect(pullStates(refused, REPO, [4])).rejects.toThrow("gh: Server Error (HTTP 502)")
    const errors = hostAnswering(() => ({ exitCode: 0, stdout: JSON.stringify({ errors: [{ message: "nope" }] }) }))
    await expect(pullStates(errors, REPO, [4])).rejects.toThrow("GitHub sent no answer")
  })
})

describe("lookups a press makes", () => {
  test("a pull request or a stack GitHub didn't answer about is none", async () => {
    const failing = hostAnswering(() => ({ exitCode: 1, stderr: "HTTP 404" }))
    const rejecting = hostAnswering(cannotStart)

    for (const host of [failing, rejecting]) {
      expect(await stackOf(host, REPO, 7, 3)).toBeNull()
      expect(await mergeOutcome(host, REPO, 7)).toBe("unknown")
      expect(host.runs.map(({ timeoutMs }) => timeoutMs)).toEqual([30_000, 30_000])
    }
  })

  test("a pull request GitHub didn't answer about comes with why: gh's words, or gh missing", async () => {
    const signedOut = hostAnswering(() => ({
      exitCode: 4,
      stderr: "To get started with GitHub CLI, please run:  gh auth login"
    }))
    const missing = hostAnswering(cannotStart)

    expect(await currentPull(signedOut, REPO, 7)).toEqual({
      problem: { message: "The GitHub CLI is not signed in. Run: gh auth login", isPermanent: false, needsSetup: true }
    })
    expect(await currentPull(missing, REPO, 7)).toEqual({ problem: GH_MISSING })
    expect(missing.runs.map(({ argv }) => argv.slice(0, 2).join(" "))).toEqual(["gh api", "gh --version"])
  })

  test("how far behind its base a pull request is, asked only where wanted, by comparing the two; unknown where GitHub can't say", async () => {
    const pull = JSON.stringify({ state: "open", head: { sha: "abc" }, base: { ref: "release/2.0 #1" } })
    const answering = (behind: { exitCode: number; stdout?: string }) =>
      hostAnswering((argv) => (argv.includes("--jq") ? behind : { exitCode: 0, stdout: pull }))

    const plain = answering({ exitCode: 0, stdout: "3\n" })
    expect(await currentPull(plain, REPO, 7)).toMatchObject({ pull: { behindBase: null } })
    expect(plain.runs).toHaveLength(1)

    const behind = answering({ exitCode: 0, stdout: "3\n" })
    expect(await currentPull(behind, REPO, 7, { withBase: true })).toMatchObject({ pull: { behindBase: 3 } })
    // The base's name as a path, each part of it encoded.
    expect(behind.runs[1]?.argv).toEqual([
      ...["gh", "api", "repos/acme/app/compare/release/2.0%20%231...abc", "--hostname", "github.com"],
      ...["--jq", ".behind_by"]
    ])
    const upToDate = answering({ exitCode: 0, stdout: "0\n" })
    expect(await currentPull(upToDate, REPO, 7, { withBase: true })).toMatchObject({ pull: { behindBase: 0 } })
    for (const unanswered of [{ exitCode: 1 }, { exitCode: 0, stdout: "" }, { exitCode: 0, stdout: "null\n" }]) {
      const host = answering(unanswered)
      expect(await currentPull(host, REPO, 7, { withBase: true })).toMatchObject({ pull: { behindBase: null } })
    }
  })

  test("failed runs GitHub can't be asked about reject with the problem, worded for the person, and gh's words", async () => {
    const host = hostAnswering(() => ({ exitCode: 1, stderr: "HTTP 401: Bad credentials" }))
    const rejection = await failedRuns(host, REPO, 7).catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(GhFailure)
    expect(problemOf(rejection)).toEqual({
      message: "The GitHub CLI is not signed in. Run: gh auth login",
      isPermanent: false,
      needsSetup: true
    })
    expect((rejection as Error).message).toBe("HTTP 401: Bad credentials")
    expect(problemOf(new Error("spawn git ENOENT"))).toEqual({ message: "spawn git ENOENT", isPermanent: false })
  })

  test("gh that cannot start rejects a lookup with gh missing, and the reason the run rejected", async () => {
    const rejection = await failedRuns(hostAnswering(cannotStart), REPO, 7).catch((error: unknown) => error)

    expect(problemOf(rejection)).toEqual(GH_MISSING)
    expect((rejection as Error).message).toBe("spawn gh ENOENT")
  })
})

describe("writes", () => {
  test("a refused write rejects with gh's first line, or names the command where gh said nothing", async () => {
    const said = hostAnswering(() => ({ exitCode: 1, stderr: "\nHead branch was modified\nhint\n" }))
    await expect(ghWrite(said, ["gh", "pr", "merge", "7"])).rejects.toThrow("Head branch was modified")
    expect(said.runs).toEqual([{ argv: ["gh", "pr", "merge", "7"], timeoutMs: 120_000 }])

    const silent = hostAnswering(() => ({ exitCode: 1 }))
    await expect(ghWrite(silent, ["gh", "pr", "merge", "7"])).rejects.toThrow("gh pr merge failed")
  })

  test("a merge in the background is looked at every few seconds until it ends", async () => {
    let looks = 0
    const host = hostAnswering((argv) => {
      if (argv.includes("PUT")) {
        return { exitCode: 0, stdout: JSON.stringify({ status: "pending", uuid: "u1" }) }
      }
      looks++

      return { exitCode: 0, stdout: JSON.stringify({ status: looks < 3 ? "pending" : "merged" }) }
    })
    let time = 0
    const clock = { now: async () => time, sleep: async (ms: number) => void (time += ms) }

    const merged = await mergeStacked(host, clock, REPO, rowOf(7), "SQUASH")

    expect(merged).toEqual({ status: "merged", uuid: "u1", message: null })
    expect(time).toBe(9_000)
    expect(host.runs.at(-1)!.argv).toEqual([
      "gh",
      "api",
      "repos/acme/app/pulls/7/merge-async/u1",
      "--hostname",
      "github.com"
    ])
  })

  test("a merge GitHub says is under way already is looked at; one it refuses says why; anything else is gh's line", async () => {
    let time = 0
    const clock = { now: async () => time, sleep: async (ms: number) => void (time += ms) }
    // gh exits 1 on GitHub's 409 and 400, printing GitHub's answer and, on its error stream, only the status.
    const refusing = (body: object | null) =>
      hostAnswering((argv) =>
        argv.includes("PUT")
          ? { exitCode: 1, stdout: body ? JSON.stringify(body) : "", stderr: "gh: HTTP 409\n" }
          : { exitCode: 0, stdout: JSON.stringify({ status: "merged" }) }
      )

    const underWay = refusing({ status: "pending", details: { uuid: "u0" } })
    expect(await mergeStacked(underWay, clock, REPO, rowOf(7), "SQUASH")).toEqual({
      status: "merged",
      uuid: "u0",
      message: null
    })
    expect(underWay.runs.at(-1)!.argv).toContain("repos/acme/app/pulls/7/merge-async/u0")
    const refused = refusing({ status: "failed", details: { message: "Pull request is in draft state" } })
    expect(await mergeStacked(refused, clock, REPO, rowOf(7), "SQUASH")).toEqual({
      status: "failed",
      uuid: null,
      message: "Pull request is in draft state"
    })
    await expect(mergeStacked(refusing(null), clock, REPO, rowOf(7), "SQUASH")).rejects.toThrow("gh: HTTP 409")
  })

  test("one pending after a minute is left to GitHub, as are failed looks; no look outlasts the minute", async () => {
    const host = hostAnswering((argv) =>
      argv.includes("PUT") ? { exitCode: 0, stdout: JSON.stringify({ status: "pending", uuid: "u1" }) } : cannotStart()
    )
    let time = 0
    const clock = { now: async () => time, sleep: async (ms: number) => void (time += ms) }

    expect(await mergeStacked(host, clock, REPO, rowOf(7), "SQUASH")).toEqual({
      status: "pending",
      uuid: "u1",
      message: null
    })
    expect(time).toBe(60_000)
    // A look every 3 seconds, each given 30 seconds at most, and no more than the minute has left.
    const lookTimeouts = Array.from({ length: 19 }, (_, index) => Math.min(30_000, 60_000 - 3_000 * (index + 1)))
    expect(host.runs.map(({ timeoutMs }) => timeoutMs)).toEqual([120_000, ...lookTimeouts])
  })
})
