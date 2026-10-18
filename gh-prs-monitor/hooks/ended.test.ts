// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { addStates, closedQuery, numbersToAsk, readClosed } from "./ended"
import type { ClosedState } from "./ended"

describe("merged and closed lookup", () => {
  test("asks after each number in one request", () => {
    const query = closedQuery([12, 3.5, -1, 40])

    expect(query).toContain("p12: pullRequest(number: 12)")
    expect(query).toContain("p40: pullRequest(number: 40)")
    expect(query).not.toContain("3.5")
    expect(query).not.toContain("-1")
  })

  test("merged with who merged it, closed with who closed it, open as it is, each with its last commit", () => {
    const json = JSON.stringify({
      data: {
        repository: {
          p1: {
            number: 1,
            state: "MERGED",
            headRefOid: "c1",
            headRefName: "fix/menu",
            isCrossRepository: false,
            mergedBy: { login: "ann" },
            timelineItems: { nodes: [] }
          },
          p2: {
            number: 2,
            state: "CLOSED",
            headRefName: "pr-2",
            isCrossRepository: true,
            headRepository: { nameWithOwner: "bob/app" },
            mergedBy: null,
            timelineItems: { nodes: [{ actor: { login: "bob" } }] }
          },
          p3: { number: 3, state: "OPEN", mergedBy: null, timelineItems: { nodes: [] } },
          p4: null
        }
      },
      errors: [{ message: "Could not resolve to a PullRequest with the number of 4." }]
    })

    expect(readClosed(json)).toEqual([
      {
        number: 1,
        state: "MERGED",
        by: "ann",
        head: "c1",
        branch: "fix/menu",
        isCrossRepository: false,
        headRepo: null
      },
      {
        number: 2,
        state: "CLOSED",
        by: "bob",
        head: null,
        branch: "pr-2",
        isCrossRepository: true,
        headRepo: "bob/app"
      },
      { number: 3, state: "OPEN", by: null, head: null, branch: null, isCrossRepository: false, headRepo: null }
    ])
  })

  test("an answer with none to read, as to a request GitHub refused, is none", () => {
    expect(readClosed("not json")).toBeNull()
    expect(readClosed(JSON.stringify({ errors: [{ message: "API rate limit exceeded" }] }))).toBeNull()
    expect(readClosed(JSON.stringify({ data: { repository: null } }))).toBeNull()
    expect(readClosed(JSON.stringify({ data: { repository: { p4: null } } }))).toEqual([])
  })
})

describe("what a cleanup asks GitHub", () => {
  const state = (number: number, value: ClosedState["state"]): ClosedState => ({
    number,
    state: value,
    by: null,
    head: `head-${number}`,
    branch: null,
    isCrossRepository: false,
    headRepo: null
  })

  test("only of the pull requests the loads did not find how they ended", () => {
    expect(numbersToAsk([9, 11, 12], [state(9, "MERGED"), state(12, "OPEN")])).toEqual([11])
    expect(numbersToAsk([9], [])).toEqual([9])
  })

  test("what the loads found adds up, a pull request found again by its latest", () => {
    expect(addStates([state(9, "OPEN"), state(11, "MERGED")], [state(9, "CLOSED"), state(12, "MERGED")])).toEqual([
      state(11, "MERGED"),
      state(9, "CLOSED"),
      state(12, "MERGED")
    ])
    expect(addStates([state(9, "MERGED")], [])).toEqual([state(9, "MERGED")])
  })
})
