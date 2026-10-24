// Author: David Matura

import { describe, expect, test } from "claude-code/testing"

import { homeShort, typedPath } from "./paths"

describe("a folder's path as typed", () => {
  test("~ alone or before a slash is the home folder; relative paths are from the session's; . and .. worked out", () => {
    expect(typedPath("~", "/Users/me", "/repo")).toBe("/Users/me")
    expect(typedPath("~/code/web/", "/Users/me", "/repo")).toBe("/Users/me/code/web")
    expect(typedPath("~bob/code", "/Users/me", "/repo")).toBe("/repo/~bob/code")
    expect(typedPath(".", "/Users/me", "/repo")).toBe("/repo")
    expect(typedPath("../web/./src", "/Users/me", "/code/app")).toBe("/code/web/src")
    expect(typedPath("/code/web/../api", "/Users/me", "/repo")).toBe("/code/api")
    // With no home folder known, ~ is no folder of its own.
    expect(typedPath("~/code", null, "/repo")).toBe("/repo/~/code")
  })

  test("on Windows, a drive and backslashes as Windows writes them", () => {
    expect(typedPath("C:\\code\\web\\", "C:\\Users\\me", "C:\\repo")).toBe("C:/code/web")
    expect(typedPath("..\\web", "C:\\Users\\me", "C:\\code\\app")).toBe("C:/code/web")
    expect(typedPath("~\\code\\web", "C:\\Users\\me", "C:\\repo")).toBe("C:/Users/me/code/web")
    expect(typedPath("D:\\", "C:\\Users\\me", "C:\\repo")).toBe("D:/")
  })
})

describe("a folder's path as shown", () => {
  test("from ~ in the home folder, whole elsewhere or with no home folder known", () => {
    expect(homeShort("/Users/me/code/web", "/Users/me")).toBe("~/code/web")
    expect(homeShort("/Users/me", "/Users/me")).toBe("~")
    expect(homeShort("/Users/meg/code", "/Users/me")).toBe("/Users/meg/code")
    expect(homeShort("/code/web", "/Users/me")).toBe("/code/web")
    expect(homeShort("/Users/me/code/web", null)).toBe("/Users/me/code/web")
  })

  test("on Windows, the home folder as Windows writes it, the path as git does", () => {
    expect(homeShort("C:/Users/me/code/web", "C:\\Users\\me")).toBe("~/code/web")
    expect(homeShort("C:/Users/meg/code", "C:\\Users\\me")).toBe("C:/Users/meg/code")
    // Letter case tells no folders apart there; elsewhere it does.
    expect(homeShort("c:/Users/Me/code/web", "C:\\Users\\me")).toBe("~/code/web")
    expect(homeShort("/users/me/code", "/Users/me")).toBe("/users/me/code")
  })

  test("a home folder written with a slash at its end is the same folder", () => {
    expect(homeShort("/Users/me/code/web", "/Users/me/")).toBe("~/code/web")
    expect(homeShort("C:/Users/me/code/web", "C:\\Users\\me\\")).toBe("~/code/web")
  })
})
