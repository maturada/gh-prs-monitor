// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { detailsWithTicket, keyLikeIn, readTicketLinks, ticketLink, ticketOf, ticketsKey, withKeyForm } from "./tickets"
import type { NeedsKey, PastedLink, TicketLinks } from "./tickets"

// A link pasted in a repository on github.com.
function pasted(text: string): PastedLink {
  return ticketLink(text, "github.com")
}

describe("a pasted ticket link", () => {
  test("a key in capitals is the first of them, as a title's slug after it may look like one", () => {
    expect(pasted("https://acme.youtrack.cloud/issue/WEB-12/API-2")).toEqual({
      kind: "link",
      prefix: "WEB-",
      address: "https://acme.youtrack.cloud/issue/{key}",
      key: "WEB-12"
    })
  })

  test("a key in lower case after a workspace of its shape is the last of them, as keys come after workspaces", () => {
    expect(pasted("https://tracker.example.com/team-2/issue/web-88")).toEqual({
      kind: "link",
      prefix: "web-",
      address: "https://tracker.example.com/team-2/issue/{key}",
      key: "web-88"
    })
  })

  test("a key in the path becomes the address, what follows it dropped", () => {
    expect(pasted("https://linear.app/acme/issue/WEB-5761/fix-chat-scroll")).toEqual({
      kind: "link",
      prefix: "WEB-",
      address: "https://linear.app/acme/issue/{key}",
      key: "WEB-5761"
    })
    expect(pasted("https://acme.atlassian.net/browse/OPS-12")).toEqual({
      kind: "link",
      prefix: "OPS-",
      address: "https://acme.atlassian.net/browse/{key}",
      key: "OPS-12"
    })
    expect(pasted("  https://acme.youtrack.cloud/issue/APP-42/Login-fails/  ")).toEqual({
      kind: "link",
      prefix: "APP-",
      address: "https://acme.youtrack.cloud/issue/{key}",
      key: "APP-42"
    })
    expect(pasted("https://app.clickup.com/t/9012345/ENG-12")).toEqual({
      kind: "link",
      prefix: "ENG-",
      address: "https://app.clickup.com/t/9012345/{key}",
      key: "ENG-12"
    })
  })

  test("an Atlassian board's link names its ticket in the query, and the ticket's own page is its address", () => {
    expect(pasted("https://acme.atlassian.net/jira/software/projects/WEB/boards/1?selectedIssue=WEB-123")).toEqual({
      kind: "link",
      prefix: "WEB-",
      address: "https://acme.atlassian.net/browse/{key}",
      key: "WEB-123"
    })
  })

  test("a key only in the query of another host asks for the ticket's own page", () => {
    expect(pasted("https://tracker.example.com/board?issue=WEB-5")).toEqual({ kind: "none", reason: "query-only" })
  })

  test("a link with only a number takes the key form its host is known to use", () => {
    expect(pasted("https://app.shortcut.com/acme/story/12345/fix-login")).toEqual({
      kind: "link",
      prefix: "sc-",
      address: "https://app.shortcut.com/acme/story/{number}",
      key: "sc-12345"
    })
    expect(pasted("https://dev.azure.com/acme/web/_workitems/edit/123")).toEqual({
      kind: "link",
      prefix: "AB#",
      address: "https://dev.azure.com/acme/web/_workitems/edit/{number}",
      key: "AB#123"
    })
  })

  test("a number on another host needs the key form, which an example of a key gives", () => {
    const parsed: NeedsKey = {
      kind: "needs-key",
      address: "https://tracker.example.com/tickets/{number}",
      number: "88"
    }
    expect(pasted("https://tracker.example.com/tickets/88")).toEqual(parsed)

    expect(withKeyForm(parsed, "ENG-12")).toEqual({
      kind: "link",
      prefix: "ENG-",
      address: "https://tracker.example.com/tickets/{number}",
      key: "ENG-88"
    })
    expect(withKeyForm(parsed, " eng#3 ")).toEqual({
      kind: "link",
      prefix: "eng#",
      address: "https://tracker.example.com/tickets/{number}",
      key: "eng#88"
    })
    expect(withKeyForm(parsed, "the ENG project")).toBeNull()
  })

  test("only a web address is read", () => {
    expect(pasted("WEB-5761")).toEqual({ kind: "none", reason: "not-a-link" })
    expect(pasted("javascript:alert('WEB-1')")).toEqual({ kind: "none", reason: "not-a-link" })
    expect(pasted("ftp://files.example.com/WEB-1")).toEqual({ kind: "none", reason: "not-a-link" })
    expect(pasted("")).toEqual({ kind: "none", reason: "not-a-link" })
  })

  test("a link to the repository's GitHub says GitHub links its own issues", () => {
    expect(pasted("https://github.com/acme/app/issues/12")).toEqual({ kind: "none", reason: "github" })
    expect(ticketLink("https://GHE.example.com/acme/app/issues/3", "ghe.example.com")).toEqual({
      kind: "none",
      reason: "github"
    })
  })

  test("a key written in capitals wins over a workspace or a slug shaped like one", () => {
    expect(pasted("https://linear.app/acme-2/issue/WEB-5761/fix-chat-scroll-2")).toEqual({
      kind: "link",
      prefix: "WEB-",
      address: "https://linear.app/acme-2/issue/{key}",
      key: "WEB-5761"
    })
    expect(pasted("https://tracker.example.com/issue/web-12")).toMatchObject({ prefix: "web-", key: "web-12" })
  })

  test("the address keeps the port, and leaves out a name and password", () => {
    expect(pasted("https://ann:secret@jira.example.com:8443/browse/WEB-1")).toMatchObject({
      address: "https://jira.example.com:8443/browse/{key}"
    })
  })

  test("braces in a pasted link stay text, never a key's place", () => {
    expect(pasted("https://tracker.example.com/{key}/WEB-1")).toMatchObject({
      address: "https://tracker.example.com/%7Bkey%7D/{key}"
    })
  })

  test("a link with neither a key nor a number says so", () => {
    expect(pasted("https://linear.app/acme/team/WEB/all")).toEqual({ kind: "none", reason: "no-key" })
  })
})

const LINKS: TicketLinks = {
  "WEB-": "https://linear.app/acme/issue/{key}",
  "OPS-": "https://acme.atlassian.net/browse/{key}",
  "sc-": "https://app.shortcut.com/acme/story/{number}",
  "AB#": "https://dev.azure.com/acme/web/_workitems/edit/{number}"
}

describe("a pull request's ticket", () => {
  test("the branch is read first, then the title", () => {
    expect(ticketOf({ branch: "feature/WEB-5761-chat-fixes", title: "OPS-12: Fix the menu" }, LINKS)).toEqual({
      key: "WEB-5761",
      url: "https://linear.app/acme/issue/WEB-5761"
    })
    expect(ticketOf({ branch: "fix-menu", title: "[OPS-12] Fix the menu" }, LINKS)).toEqual({
      key: "OPS-12",
      url: "https://acme.atlassian.net/browse/OPS-12"
    })
  })

  test("a key matches in any case and reads in its saved form", () => {
    expect(ticketOf({ branch: "web-5761/fix", title: "" }, LINKS)).toEqual({
      key: "WEB-5761",
      url: "https://linear.app/acme/issue/WEB-5761"
    })
  })

  test("an address that takes the number gets the number alone", () => {
    expect(ticketOf({ branch: "ann/sc-12345/login", title: "" }, LINKS)).toEqual({
      key: "sc-12345",
      url: "https://app.shortcut.com/acme/story/12345"
    })
    expect(ticketOf({ branch: "", title: "AB#123 Fix the export" }, LINKS)).toEqual({
      key: "AB#123",
      url: "https://dev.azure.com/acme/web/_workitems/edit/123"
    })
  })

  test("only the saved prefixes match, each at the start of a word", () => {
    expect(ticketOf({ branch: "utf-8-names", title: "UTF-8 names and SHA-256 sums" }, LINKS)).toBeNull()
    expect(ticketOf({ branch: "XWEB-12", title: "WEB- without a number" }, LINKS)).toBeNull()
  })

  // Unicode's case folding makes ſ an s and the Kelvin sign a K: such a branch reads as the saved key, and breaks
  // nothing.
  test("a letter that folds to a saved prefix's reads as that prefix", () => {
    expect(ticketOf({ branch: "ann/ſc-12/login", title: "" }, LINKS)).toEqual({
      key: "sc-12",
      url: "https://app.shortcut.com/acme/story/12"
    })
    expect(
      ticketOf({ branch: "\u212AAN-4", title: "" }, { "KAN-": "https://acme.atlassian.net/browse/{key}" })
    ).toEqual({
      key: "KAN-4",
      url: "https://acme.atlassian.net/browse/KAN-4"
    })
  })

  // A `#` left as it is would start the address's fragment, and the tracker would open another page.
  test("an address that takes the whole key gets it encoded", () => {
    expect(
      ticketOf({ branch: "", title: "AB#7 Fix the export" }, { "AB#": "https://tracker.example.com/{key}" })
    ).toEqual({
      key: "AB#7",
      url: "https://tracker.example.com/AB%237"
    })
  })

  test("the first key in a text is its ticket", () => {
    expect(ticketOf({ branch: "", title: "WEB-1 and WEB-2" }, LINKS)?.key).toBe("WEB-1")
  })

  test("with no links saved there is none", () => {
    expect(ticketOf({ branch: "feature/WEB-5761", title: "" }, {})).toBeNull()
  })
})

describe("a row's details with its ticket", () => {
  const row = {
    headRefName: "feature/WEB-5761-menu",
    title: "Fix the menu",
    details: [{ text: "CI ✓", tone: "success" as const }]
  }

  // A no-break space keeps the mark with the key where a narrow pane wraps the details.
  test("the ticket comes first, as a link, its mark saying it opens elsewhere", () => {
    expect(detailsWithTicket(row, LINKS)).toEqual([
      { text: "WEB-5761\u00a0⧉", tone: "neutral", href: "https://linear.app/acme/issue/WEB-5761" },
      { text: "CI ✓", tone: "success" }
    ])
  })

  test("without links, or a key, the details are as they were", () => {
    expect(detailsWithTicket(row, null)).toBe(row.details)
    expect(detailsWithTicket({ ...row, headRefName: "fix/menu" }, LINKS)).toBe(row.details)
  })
})

describe("a key-like word in a branch, before links are set up", () => {
  test("found at the start of a branch's part, in capitals, as Linear's and Jira's branches write it", () => {
    expect(keyLikeIn("feature/WEB-5785-menu")).toBe("WEB-5785")
    expect(keyLikeIn("david/web-5785-fix-login")).toBe("WEB-5785")
    expect(keyLikeIn("APP-12")).toBe("APP-12")
  })

  test("not inside a part, nor a word that names a version or an encoding", () => {
    expect(keyLikeIn("upgrade-node-20")).toBeNull()
    expect(keyLikeIn("chore/node-20-upgrade")).toBeNull()
    expect(keyLikeIn("fix/utf-8-names")).toBeNull()
    expect(keyLikeIn("release-2024-q1")).toBeNull()
    expect(keyLikeIn("fix/menu")).toBeNull()
    expect(keyLikeIn("v-2")).toBeNull()
  })
})

describe("ticket links as the store keeps them", () => {
  test("a repository's links read back, or off", () => {
    expect(readTicketLinks(LINKS)).toEqual(LINKS)
    expect(readTicketLinks("off")).toBe("off")
  })

  test("an entry that isn't a prefix and a web address with its key's place is left out", () => {
    expect(
      readTicketLinks({
        "WEB-": "https://linear.app/acme/issue/{key}",
        "OPS-": "javascript:alert('{key}')",
        bad: "https://example.com/{key}",
        "APP-": 3,
        "ENG-": "https://example.com/no-place"
      })
    ).toEqual({ "WEB-": "https://linear.app/acme/issue/{key}" })
  })

  test("an address with control characters, or its key's place outside its path, is left out", () => {
    expect(
      readTicketLinks({
        "WEB-": "https://linear.app/acme/issue/\u001b]8;;{key}",
        "OPS-": "https://{key}.example.com/browse",
        "APP-": "https://{key}@example.com/browse",
        "ENG-": "https://example.com:{number}/browse"
      })
    ).toBeNull()
  })

  test("anything else is none", () => {
    expect(readTicketLinks(undefined)).toBeNull()
    expect(readTicketLinks({})).toBeNull()
    expect(readTicketLinks(["WEB-"])).toBeNull()
    expect(readTicketLinks("on")).toBeNull()
  })

  test("they are kept under the repository, in lower case, as GitHub's names hold no case", () => {
    expect(ticketsKey({ host: "github.com", name: "Acme/Web" })).toBe("tickets:github.com/acme/web")
    expect(ticketsKey({ host: "GHE.example.com", name: "Acme/Web" })).toBe("tickets:ghe.example.com/acme/web")
  })
})
