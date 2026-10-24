// Author: David Matura

import type { ProcessRunResult } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import { copyIncluded, firstNotInMain } from "./include"
import { fakeHost, PATH } from "./testing/git-host"

type Answer = [string, Partial<ProcessRunResult> | ((line: string, stdin: string) => Partial<ProcessRunResult>)]

const ROOT = "/repo"
const INCLUDE = `${ROOT}/.worktreeinclude`
const names = (...paths: string[]) => ({ stdout: paths.map((path) => `${path}\0`).join("") })
// git's lists in the main checkout: what it ignores, folders whole; and of those, what the include file names.
const IGNORED = "git ls-files -z --others --ignored --exclude-standard --directory"
const MATCHED = `git ls-files -z --others --ignored --exclude-from=${INCLUDE} --`
const ignoredAre = (...paths: string[]): Answer => [IGNORED, names(...paths)]
const matchedAre = (...paths: string[]): Answer => [MATCHED, names(...paths)]
// The new worktree's git, asked which of the files it ignores too: all of them, or all but those given.
const CHECK_IGNORE = "git check-ignore --stdin -z"
const ignoredThereBut = (...others: string[]): Answer => [
  CHECK_IGNORE,
  (_, stdin) => names(...stdin.split("\0").filter((path) => path !== "" && !others.includes(path)))
]
const copies = (calls: { argv: string }[]) =>
  calls.filter((call) => call.argv.startsWith("cp ")).map((call) => call.argv)
const NONE = { copied: [], failed: [] }
const copied = (...files: string[]) => ({ copied: files, failed: [] })

describe("copying what .worktreeinclude names into a new worktree", () => {
  test("without the file, nothing is copied and git is not asked", async () => {
    const { host, calls } = fakeHost([])

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(NONE)
    expect(calls).toEqual([])
  })

  test("the ignored files it names are copied, in their folders, to the byte", async () => {
    const { host, calls } = fakeHost(
      [
        ignoredAre(".env", "android/local.properties", "node_modules/", ".DS_Store"),
        matchedAre(".env", "android/local.properties"),
        ignoredThereBut()
      ],
      { [INCLUDE]: "# local config\n.env\n\nandroid/local.properties\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied(".env", "android/local.properties"))
    // git matches the files against the include file alone, each path taken as written.
    expect(calls.find((call) => call.argv.startsWith(MATCHED))?.argv).toBe(
      `${MATCHED} :(literal).env :(literal)android/local.properties`
    )
    // Each folder made, then a folder's files copied in one command.
    expect(calls.filter((call) => /^(mkdir|cp) /.test(call.argv)).map((call) => call.argv)).toEqual([
      `mkdir -p -- ${PATH} ${PATH}/android`,
      `cp -p -- ${ROOT}/.env ${PATH}`,
      `cp -p -- ${ROOT}/android/local.properties ${PATH}/android`
    ])
  })

  test("a folder git ignores whole is looked into only where a pattern names a path in it", async () => {
    const { host, calls } = fakeHost(
      [
        ignoredAre("config/secrets/", "node_modules/"),
        [
          "git ls-files -z --others --ignored --exclude-standard -- :(literal)config/secrets/",
          names("config/secrets/app.json")
        ],
        matchedAre("config/secrets/app.json"),
        ignoredThereBut()
      ],
      { [INCLUDE]: "/config/secrets/*.json\n.env\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied("config/secrets/app.json"))
    expect(calls.some((call) => call.argv.includes(":(literal)node_modules/"))).toBe(false)
  })

  test("nothing its branch doesn't ignore, through a link there, from a link, or over a file there", async () => {
    const { host, calls } = fakeHost(
      [
        ignoredAre(".env", "conf/local.json", "shared.env", "kept.env", "new.env", "linked.env"),
        matchedAre(".env", "conf/local.json", "shared.env", "kept.env", "new.env", "linked.env"),
        // The pull request tracks .env itself, and its .gitignore lacks the rule for new.env.
        ignoredThereBut(".env", "new.env")
      ],
      { [INCLUDE]: "*.env\nconf/\n", [`${PATH}/kept.env`]: "" },
      // conf is a link in the pull request's tree, linked.env one there that leads nowhere, shared.env one here.
      new Set([`${PATH}/conf`, `${PATH}/linked.env`, `${ROOT}/shared.env`])
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(NONE)
    expect(copies(calls)).toEqual([])
    // Only what got past the links and the files there is put to the worktree's git, which takes nothing as tracked.
    const asked = calls.find((call) => call.argv.startsWith(CHECK_IGNORE))
    expect(asked).toMatchObject({ cwd: PATH })
  })

  test("a link on the way is found on disk, however long git's listing of the pull request's tree", async () => {
    const { host, calls } = fakeHost(
      [ignoredAre("apps/web/.env.local"), matchedAre("apps/web/.env.local"), ignoredThereBut()],
      { [INCLUDE]: "apps/web/.env.local\n" },
      new Set([`${PATH}/apps/web`])
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(NONE)
    expect(calls.some((call) => call.argv.startsWith("git ls-files -z -- "))).toBe(false)
  })

  test("a folder git ignores whole is looked into where a pattern's last name is the folder's, as **/certs/", async () => {
    const { host, calls } = fakeHost(
      [
        ignoredAre("apps/certs/", "node_modules/", "build/"),
        [`${MATCHED} :(literal)apps/certs/`, names("apps/certs/dev.pem")],
        matchedAre("apps/certs/dev.pem"),
        ignoredThereBut()
      ],
      // Any case, as git ignores it where the file system does.
      { [INCLUDE]: "**/Certs/\n/config/*.json\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied("apps/certs/dev.pem"))
    expect(calls.some((call) => call.argv.includes(":(literal)node_modules/"))).toBe(false)
    expect(calls.some((call) => call.argv.includes(":(literal)build/"))).toBe(false)
  })

  test("a folder git ignores whole is looked into where a pattern matches at any depth, but one tools make again", async () => {
    const walked = async (pattern: string) => {
      const { host, calls } = fakeHost(
        [
          ignoredAre("secrets/", "node_modules/", "vendor/"),
          [`${MATCHED} :(literal)secrets/`, names("secrets/app.env")],
          matchedAre("secrets/app.env"),
          ignoredThereBut()
        ],
        { [INCLUDE]: `${pattern}\n` }
      )
      const result = await copyIncluded(host, ROOT, PATH)
      expect(calls.some((call) => /:\(literal\)(node_modules|vendor)\//.test(call.argv))).toBe(false)

      return result
    }

    for (const pattern of ["*.env", "app.env", "**/secrets/*.env", "*/app.env", "secret?/app.env"]) {
      expect(await walked(pattern)).toEqual(copied("secrets/app.env"))
    }
    // A path spelt out from the top names no other folder; a `!` pattern names none.
    expect(await walked("/config/app.env")).toEqual(NONE)
    expect(await walked("!*.env")).toEqual(NONE)
  })

  test("a file tools make again is copied only where a pattern names its path", async () => {
    const copying = async (include: string, matched: RegExp) => {
      const { host } = fakeHost(
        [
          ignoredAre("ios/Flutter/Generated.xcconfig", "ios/Flutter/Secrets.xcconfig"),
          [
            MATCHED,
            (line) =>
              names(
                ...line
                  .split(" :(literal)")
                  .slice(1)
                  .filter((path) => matched.test(path))
              )
          ],
          ignoredThereBut()
        ],
        { [INCLUDE]: include }
      )

      return copyIncluded(host, ROOT, PATH)
    }

    // Flutter writes Generated.xcconfig with the checkout's own paths: the main checkout's would point a build there.
    expect(await copying("*.xcconfig\n", /\.xcconfig$/)).toEqual(copied("ios/Flutter/Secrets.xcconfig"))
    expect(await copying("/ios/Flutter/Generated.xcconfig\n", /Generated/)).toEqual(
      copied("ios/Flutter/Generated.xcconfig")
    )
  })

  test("a folder a pattern's path or last name names is looked into whatever the case of either", async () => {
    // git is asked for what the include file matches there, not for every file it ignores there.
    const { host, calls } = fakeHost(
      [ignoredAre("Config/secrets/"), matchedAre("Config/secrets/app.json"), ignoredThereBut()],
      { [INCLUDE]: "config/Secrets/*.json\n" }
    )
    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied("Config/secrets/app.json"))
    expect(calls.filter((call) => call.argv.startsWith("git ls-files")).map((call) => call.argv)).toEqual([
      IGNORED,
      `${MATCHED} :(literal)Config/secrets/`
    ])

    // A folder tools make again is looked into only where a pattern names it: as its last name, or as one of its
    // folders spelt out; a wildcard folder names none. git matches what is in it against those patterns alone, so
    // `*.pem` takes nothing there.
    const NAMING = "git ls-files -z --others --ignored --exclude="
    const walking = async (pattern: string) => {
      const { host, calls } = fakeHost(
        [ignoredAre("vendor/", "node_modules/"), [NAMING, names("vendor/creds.json")], ignoredThereBut()],
        { [INCLUDE]: `${pattern}\n*.pem\n` }
      )
      const result = await copyIncluded(host, ROOT, PATH)
      expect(calls.some((call) => call.argv.includes(":(literal)node_modules/"))).toBe(false)
      const asked = calls.filter((call) => call.argv.startsWith(NAMING)).map((call) => call.argv)
      expect(asked).toEqual(result.copied.length > 0 ? [`${NAMING}${pattern} -- :(literal)vendor/`] : [])

      return result
    }
    for (const pattern of ["**/Vendor/", "**/vendor/creds.json", "**/Vendor/*.json", "vendor/creds.json"]) {
      expect(await walking(pattern)).toEqual(copied("vendor/creds.json"))
    }
    for (const pattern of ["*/creds.json", "**/creds.json", "!vendor/creds.json"]) {
      expect(await walking(pattern)).toEqual(NONE)
    }
  })

  test("what tools make in a folder walked for a pattern is left out, unless a pattern names its path", async () => {
    // tools/ is ignored whole and holds a package; certs/ is named whole, and Finder wrote its .DS_Store there; so it
    // did in vendor/, which tools make again and `**/vendor/` names.
    const { host } = fakeHost(
      [
        ignoredAre("tools/", "certs/", "vendor/"),
        [
          `${MATCHED} :(literal)tools/`,
          names("tools/dev.pem", "tools/node_modules/pkg/key.pem", "tools/build/out.pem", "tools/__pycache__/a.pyc")
        ],
        [`${MATCHED} :(literal)certs/`, names("certs/dev.pem", "certs/.DS_Store")],
        [
          "git ls-files -z --others --ignored --exclude=**/vendor/ --exclude=vendor/__pycache__/b.pyc -- :(literal)vendor/",
          names("vendor/creds.json", "vendor/.DS_Store", "vendor/__pycache__/b.pyc")
        ],
        // In tools/, git found tools/__pycache__/a.pyc for `*.pem` or its path: asked again by the patterns naming
        // __pycache__/.
        [
          "git ls-files -z --others --ignored --exclude=tools/__pycache__/a.pyc --exclude=vendor/__pycache__/b.pyc -- :(literal)tools/__pycache__/a.pyc",
          names("tools/__pycache__/a.pyc")
        ],
        ignoredThereBut()
      ],
      { [INCLUDE]: "*.pem\ncerts/\ntools/__pycache__/a.pyc\n**/vendor/\nvendor/__pycache__/b.pyc\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(
      copied(
        "tools/dev.pem",
        "certs/dev.pem",
        "vendor/creds.json",
        "vendor/__pycache__/b.pyc",
        "tools/__pycache__/a.pyc"
      )
    )
  })

  test("in a folder tools make again only the patterns that name it count, listed whole or apart, a `!` in its place", async () => {
    // With `dist/*` ignored, git lists dist/manifest.json apart; vendor/ it lists whole. git matches as it would: in
    // vendor/, `!vendor/prod.pem` takes prod.pem back where it follows the pattern naming it.
    const NAMING = "git ls-files -z --others --ignored --exclude="
    const copying = async (include: string) => {
      const { host, calls } = fakeHost(
        [
          ignoredAre("dist/manifest.json", "vendor/"),
          matchedAre("dist/manifest.json"),
          [
            NAMING,
            (line) =>
              line.endsWith(":(literal)vendor/")
                ? names(
                    "vendor/dev.pem",
                    ...(line.indexOf("--exclude=!vendor/prod.pem") > line.indexOf("--exclude=vendor/*.pem")
                      ? []
                      : ["vendor/prod.pem"])
                  )
                : names("dist/manifest.json")
          ],
          ignoredThereBut()
        ],
        { [INCLUDE]: include }
      )
      const result = await copyIncluded(host, ROOT, PATH)

      return {
        result,
        asked: calls.filter((call) => call.argv.startsWith("git ls-files -z --others --ignored --exclude"))
      }
    }

    // `*.json` names no folder: neither dist/manifest.json nor anything in vendor/ is asked about.
    const anyDepth = await copying("*.json\n")
    expect(anyDepth.result).toEqual(NONE)
    expect(anyDepth.asked.map((call) => call.argv)).toEqual([IGNORED])
    expect((await copying("dist/manifest.json\n")).result).toEqual(copied("dist/manifest.json"))
    expect((await copying("**/dist/\n")).result).toEqual(copied("dist/manifest.json"))
    expect((await copying("vendor/*.pem\n!vendor/prod.pem\n")).result).toEqual(copied("vendor/dev.pem"))
    expect((await copying("!vendor/prod.pem\nvendor/*.pem\n")).result).toEqual(
      copied("vendor/dev.pem", "vendor/prod.pem")
    )
    // A `!` pattern alone names nothing to take.
    expect((await copying("*.pem\n!vendor/prod.pem\n")).result).toEqual(NONE)
  })

  test("a folder tools make again inside another counts as the outer one, so `**/build/` takes nothing from a package", async () => {
    // A vendored package's build output, in a vendor/ git tracks files in.
    const NAMING = "git ls-files -z --others --ignored --exclude="
    const copying = async (include: string) => {
      const { host } = fakeHost(
        [ignoredAre("vendor/pkg/build/"), [NAMING, names("vendor/pkg/build/out.json")], ignoredThereBut()],
        { [INCLUDE]: include }
      )

      return copyIncluded(host, ROOT, PATH)
    }

    expect(await copying("**/build/\n")).toEqual(NONE)
    expect(await copying("vendor/pkg/build/\n")).toEqual(copied("vendor/pkg/build/out.json"))
  })

  test("a file git lists both in a folder and apart is copied once", async () => {
    // With `dist/*` ignored, git lists dist/ and dist/assets/ whole, and dist/manifest.json apart.
    const NAMING = "git ls-files -z --others --ignored --exclude=dist/ --"
    const { host } = fakeHost(
      [
        ignoredAre("dist/", "dist/assets/", "dist/manifest.json"),
        [
          NAMING,
          (line) =>
            line.endsWith(":(literal)dist/")
              ? names("dist/assets/a1.js", "dist/manifest.json")
              : line.endsWith(":(literal)dist/assets/")
                ? names("dist/assets/a1.js")
                : names("dist/manifest.json")
        ],
        ignoredThereBut()
      ],
      { [INCLUDE]: "dist/\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied("dist/assets/a1.js", "dist/manifest.json"))
  })

  test("a folder that can't be made copies nothing into it, and says so; the others are copied", async () => {
    // The pull request's branch holds a file `config`, where the main checkout has an ignored folder: mkdir makes every
    // folder but that one, and fails.
    const { host, calls } = fakeHost(
      [
        ignoredAre(".env", "config/local.json", "android/local.properties"),
        matchedAre(".env", "config/local.json", "android/local.properties"),
        ignoredThereBut(),
        ["mkdir", (line) => ({ exitCode: line.includes(`${PATH}/config`) ? 1 : 0 })]
      ],
      { [INCLUDE]: ".env\nconfig/\nandroid/local.properties\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual({
      copied: [".env", "android/local.properties"],
      failed: ["config/local.json"]
    })
    expect(copies(calls)).toEqual([
      `cp -p -- ${ROOT}/.env ${PATH}`,
      `cp -p -- ${ROOT}/android/local.properties ${PATH}/android`
    ])
  })

  test("many files are copied a folder's two hundred at a time, and those not copied said so", async () => {
    const many = Array.from({ length: 450 }, (_, index) => `data/f${index}`)
    // git matches each path it is asked about.
    const matchedAsked: Answer = [MATCHED, (line) => names(...line.split(" :(literal)").slice(1))]
    const { host, calls } = fakeHost([ignoredAre(...many), matchedAsked, ignoredThereBut()], { [INCLUDE]: "data/\n" })

    expect((await copyIncluded(host, ROOT, PATH)).copied).toHaveLength(450)
    expect(calls.filter((call) => call.argv.startsWith("mkdir ")).map((call) => call.argv)).toEqual([
      `mkdir -p -- ${PATH}/data`
    ])
    expect(copies(calls).map((call) => call.split(" ").length - 4)).toEqual([200, 200, 50])

    // A copy that failed in part: the files not there are said so.
    const partly = fakeHost(
      [ignoredAre(".env", "b.env"), matchedAre(".env", "b.env"), ignoredThereBut(), ["cp ", { exitCode: 1 }]],
      { [INCLUDE]: "*.env\n" }
    )
    expect(await copyIncluded(partly.host, ROOT, PATH)).toEqual({ copied: [], failed: [".env", "b.env"] })
    // A worktree's git that can't say what it ignores: nothing copied, and said so.
    const unasked = fakeHost([ignoredAre(".env"), matchedAre(".env"), [CHECK_IGNORE, { exitCode: 128 }]], {
      [INCLUDE]: ".env\n"
    })
    expect(await copyIncluded(unasked.host, ROOT, PATH)).toEqual({ copied: [], failed: [".env"] })
    expect(copies(unasked.calls)).toEqual([])
    // It ignoring none of them is no failure.
    const none = fakeHost([ignoredAre(".env"), matchedAre(".env"), [CHECK_IGNORE, { exitCode: 1 }]], {
      [INCLUDE]: ".env\n"
    })
    expect(await copyIncluded(none.host, ROOT, PATH)).toEqual(NONE)
  })

  test("on Windows, which has no cp, robocopy, which takes each name as given, with its separators", async () => {
    const enoent = () => {
      throw new Error("spawn mkdir ENOENT")
    }
    const { host, calls } = fakeHost(
      [
        ignoredAre("android/local.properties", "R&D%x%.env"),
        matchedAre("android/local.properties", "R&D%x%.env"),
        ignoredThereBut(),
        ["mkdir", enoent],
        // robocopy exits 1 having copied every file.
        ["robocopy", { exitCode: 1 }]
      ],
      { [INCLUDE]: "android/local.properties\n*.env\n" }
    )

    expect(await copyIncluded(host, ROOT, PATH)).toEqual(copied("android/local.properties", "R&D%x%.env"))
    expect(calls.filter((call) => call.argv.startsWith("robocopy")).map((call) => call.argv)).toEqual([
      "robocopy \\repo\\android \\repo\\.claude\\worktrees\\pr-7\\android local.properties /R:0 /W:0",
      "robocopy \\repo \\repo\\.claude\\worktrees\\pr-7 R&D%x%.env /R:0 /W:0"
    ])
    expect(calls.some((call) => call.argv.startsWith("cmd"))).toBe(false)

    // One that exits otherwise copied what is there now.
    const failing = fakeHost(
      [ignoredAre(".env"), matchedAre(".env"), ignoredThereBut(), ["mkdir", enoent], ["robocopy", { exitCode: 8 }]],
      { [INCLUDE]: ".env\n" }
    )
    expect(await copyIncluded(failing.host, ROOT, PATH)).toEqual({ copied: [], failed: [".env"] })
  })

  test("a list git cuts short or can't give copies nothing, and says so", async () => {
    const lists: Answer[][] = [
      [[IGNORED, { ...names(".env"), isStdoutTruncated: true }], matchedAre(".env")],
      [[IGNORED, { exitCode: 128 }]],
      [ignoredAre(".env"), [MATCHED, { exitCode: 128 }]],
      // In a folder git ignores whole: one a pattern names a path in, one walked for a pattern at any depth, and one
      // tools make again that a pattern names.
      [ignoredAre("config/"), [`${MATCHED} :(literal)config/`, { exitCode: 128 }]],
      [
        ignoredAre("secrets/"),
        [`${MATCHED} :(literal)secrets/`, { ...names("secrets/a.env"), isStdoutTruncated: true }]
      ],
      [ignoredAre("vendor/"), ["git ls-files -z --others --ignored --exclude=vendor/creds.json --", { exitCode: 128 }]]
    ]
    for (const answers of lists) {
      const { host, calls } = fakeHost([...answers, ignoredThereBut()], {
        [INCLUDE]: ".env\n*.env\nconfig/local.json\nvendor/creds.json\n"
      })

      await expect(copyIncluded(host, ROOT, PATH)).rejects.toThrow("git could not list them whole")
      expect(copies(calls)).toEqual([])
    }
  })
})

describe("a worktree's ignored files the main checkout holds the same", () => {
  const hashes = (...lines: string[]): Answer => [
    "git hash-object --",
    () => ({ stdout: lines.map((line) => `${line}\n`).join("") })
  ]

  test("are nothing lost; one it lacks, holds otherwise, or holds as a link is", async () => {
    const same = fakeHost([hashes("h1", "h2")], {
      [`${ROOT}/.env`]: "",
      [`${ROOT}/android/local.properties`]: ""
    })
    expect(await firstNotInMain(same.host, ROOT, PATH, [".env", "android/local.properties"])).toBe(null)

    const lacking = fakeHost([], { [`${ROOT}/.env`]: "" })
    expect(await firstNotInMain(lacking.host, ROOT, PATH, [".env", "notes.local"])).toBe("notes.local")

    let asked = 0
    const differing = fakeHost(
      [["git hash-object --", () => ({ stdout: asked++ === 0 ? "h1\nmine\n" : "h1\ntheirs\n" })]],
      { [`${ROOT}/.env`]: "", [`${ROOT}/local.json`]: "" }
    )
    expect(await firstNotInMain(differing.host, ROOT, PATH, [".env", "local.json"])).toBe("local.json")

    const linked = fakeHost([], { [`${ROOT}/.env`]: "" }, new Set([`${ROOT}/.env`]))
    expect(await firstNotInMain(linked.host, ROOT, PATH, [".env"])).toBe(".env")
    // A folder of the main checkout that is a link could lead into the worktree itself.
    const throughLink = fakeHost([hashes("h1")], { [`${ROOT}/config/app.json`]: "" }, new Set([`${ROOT}/config`]))
    expect(await firstNotInMain(throughLink.host, ROOT, PATH, ["config/app.json"])).toBe("config/app.json")
  })

  test("a folder git lists whole is looked into, what tools make again left out; one it lists nothing in is kept", async () => {
    const LISTING = "git ls-files -z --others --ignored --exclude-standard -- :(literal)config/"
    const inside = fakeHost([[LISTING, names("config/app.json", "config/node_modules/x.js")], hashes("h1")], {
      [`${ROOT}/config/app.json`]: ""
    })
    expect(await firstNotInMain(inside.host, ROOT, PATH, ["config/"])).toBe(null)
    expect(inside.calls.find((call) => call.argv.startsWith("git hash-object"))?.argv).toBe(
      "git hash-object --no-filters -- config/app.json"
    )

    const unread = fakeHost([[LISTING, { exitCode: 128 }]])
    expect(await firstNotInMain(unread.host, ROOT, PATH, ["config/"])).toBe("config/")
    const empty = fakeHost([[LISTING, names()]])
    expect(await firstNotInMain(empty.host, ROOT, PATH, ["config/"])).toBe("config/")
  })

  test("however many there are, each is compared, two hundred at a time", async () => {
    const many = Array.from({ length: 450 }, (_, index) => `data/f${index}`)
    const inMain = Object.fromEntries(many.map((file) => [`${ROOT}/${file}`, ""]))
    // Each file hashes as its name, here and in the main checkout, asked in turn; but `edited` here.
    const hashedAs = (edited: string | null) => {
      let asked = 0

      return fakeHost(
        [
          [
            "git hash-object --no-filters --",
            (line) => {
              const isHere = asked++ % 2 === 0
              const files = line.split(" -- ")[1]!.split(" ")

              return { stdout: files.map((file) => `${isHere && file === edited ? "mine" : file}\n`).join("") }
            }
          ]
        ],
        inMain
      )
    }

    const same = hashedAs(null)
    expect(await firstNotInMain(same.host, ROOT, PATH, many)).toBe(null)
    expect(same.calls.filter((call) => call.argv.startsWith("git hash-object")).map((call) => call.cwd)).toEqual([
      PATH,
      ROOT,
      PATH,
      ROOT,
      PATH,
      ROOT
    ])
    expect(await firstNotInMain(hashedAs("data/f420").host, ROOT, PATH, many)).toBe("data/f420")
  })

  test("a copy the include file names is the person's, even in a folder tools make again", async () => {
    // In the worktree git lists vendor/ whole and .env apart; in vendor/, the one pattern that names a path there
    // matches the copy of vendor/creds.json.
    const NAMED = "git ls-files -z --others --ignored --exclude=vendor/creds.json -- :(literal)vendor/"
    // Hashed here first, then in the main checkout: .env, then vendor/creds.json.
    const worktree = (hereHash: string, include = true) => {
      let asked = 0

      return fakeHost(
        [
          ignoredAre("vendor/", ".env"),
          [NAMED, names("vendor/creds.json")],
          matchedAre(),
          ["git hash-object", () => ({ stdout: asked++ === 0 ? `h0\n${hereHash}\n` : "h0\nh1\n" })]
        ],
        {
          [`${ROOT}/vendor/creds.json`]: "",
          [`${ROOT}/.env`]: "",
          ...(include ? { [INCLUDE]: "vendor/creds.json\n" } : {})
        }
      )
    }

    expect(await firstNotInMain(worktree("h1").host, ROOT, PATH, ["vendor/", ".env"])).toBe(null)
    const edited = worktree("mine")
    expect(await firstNotInMain(edited.host, ROOT, PATH, ["vendor/", ".env"])).toBe("vendor/creds.json")
    expect(edited.calls.find((call) => call.argv === NAMED)).toMatchObject({ cwd: PATH })
    // Without an include file, vendor/ is made again whole.
    const plain = worktree("mine", false)
    expect(await firstNotInMain(plain.host, ROOT, PATH, ["vendor/"])).toBe(null)
    // A list git can't give whole keeps it: the worktree's own, named by its first entry tools don't make again; one of
    // a folder's, by that folder.
    const unread = fakeHost([[IGNORED, { exitCode: 128 }]], { [INCLUDE]: "vendor/creds.json\n" })
    expect(await firstNotInMain(unread.host, ROOT, PATH, ["vendor/", ".env"])).toBe(".env")
    const cut = fakeHost([ignoredAre("vendor/", ".env"), [NAMED, { exitCode: 0, isStdoutTruncated: true }]], {
      [INCLUDE]: "vendor/creds.json\n"
    })
    expect(await firstNotInMain(cut.host, ROOT, PATH, ["node_modules/", "vendor/", ".env"])).toBe("vendor/")
    const walkCut = fakeHost(
      [
        ignoredAre(".env", "config/"),
        ["git ls-files -z --others --ignored --exclude-standard -- :(literal)config/", names("config/a.json")],
        [`${MATCHED} :(literal)config/`, { isStdoutTruncated: true }]
      ],
      { [INCLUDE]: "config/\n" }
    )
    expect(await firstNotInMain(walkCut.host, ROOT, PATH, [".env", "config/"])).toBe("config/")
    // A batch of files listed apart, by its first file.
    const batchCut = fakeHost(
      [
        ignoredAre("notes/", "a.json"),
        ["git ls-files -z --others --ignored --exclude-standard -- :(literal)notes/", names("notes/x.md")],
        [MATCHED, { isStdoutTruncated: true }]
      ],
      { [INCLUDE]: "/a.json\n" }
    )
    expect(await firstNotInMain(batchCut.host, ROOT, PATH, ["notes/", "a.json"])).toBe("a.json")
  })

  test("what tools make again, matched only by a pattern at any depth, is theirs, as no copy was put there", async () => {
    // What git finds in the worktree for the include file's patterns: certifi's bundle in .venv, a package's key in
    // node_modules, Flutter's Generated.xcconfig, the copied .env and vendor/creds.json; the main checkout holds only
    // those two copies, and the same.
    const found: Record<string, string> = {
      "node_modules/": "node_modules/pkg/test/key.pem",
      ".venv/": ".venv/lib/python3.13/site-packages/certifi/cacert.pem",
      "ios/Flutter/Generated.xcconfig": "ios/Flutter/Generated.xcconfig",
      ".env": ".env",
      "vendor/": "vendor/creds.json"
    }
    const NAMING = "git ls-files -z --others --ignored --exclude="
    const inEntries = (line: string) =>
      names(
        ...line
          .split(" :(literal)")
          .slice(1)
          .map((entry) => found[entry]!)
      )
    const worktree = (include: string) =>
      fakeHost(
        [
          ignoredAre(...Object.keys(found)),
          [MATCHED, inEntries],
          [NAMING, inEntries],
          // Each file hashes as its name, here and in the main checkout.
          ["git hash-object", (line) => ({ stdout: `${line.split(" -- ")[1]!.split(" ").join("\n")}\n` })]
        ],
        { [INCLUDE]: include, [`${ROOT}/.env`]: "", [`${ROOT}/vendor/creds.json`]: "" }
      )
    const entries = Object.keys(found)
    const asked = (calls: { argv: string }[], prefix: string) =>
      calls.filter((call) => call.argv.startsWith(prefix)).map((call) => call.argv)

    const anyDepth = worktree("*.pem\n.env*\n*.xcconfig\n*.json\n")
    expect(await firstNotInMain(anyDepth.host, ROOT, PATH, entries)).toBe(null)
    expect(asked(anyDepth.calls, MATCHED)).toEqual([`${MATCHED} :(literal).env`])
    expect(asked(anyDepth.calls, NAMING)).toEqual([])

    // Named by its path, or its folder by name, it is the person's.
    const named = worktree("ios/Flutter/Generated.xcconfig\n**/Vendor/\n")
    expect(await firstNotInMain(named.host, ROOT, PATH, entries)).toBe("ios/Flutter/Generated.xcconfig")
    expect(asked(named.calls, MATCHED)).toEqual([`${MATCHED} :(literal)ios/Flutter/Generated.xcconfig :(literal).env`])
    expect(asked(named.calls, NAMING)).toEqual([`${NAMING}**/Vendor/ -- :(literal)vendor/`])
  })

  test("what tools make in a folder the include file names is theirs; a copy in one git lists apart is the person's", async () => {
    // certs/ is named whole: Finder wrote certs/.DS_Store in the worktree, beside the copy of certs/dev.pem.
    const sameHashes: Answer = [
      "git hash-object",
      (line) => ({ stdout: `${line.split(" -- ")[1]!.split(" ").join("\n")}\n` })
    ]
    const certs = fakeHost(
      [
        ignoredAre("certs/"),
        [
          "git ls-files -z --others --ignored --exclude-standard -- :(literal)certs/",
          names("certs/dev.pem", "certs/.DS_Store")
        ],
        [`${MATCHED} :(literal)certs/`, names("certs/dev.pem", "certs/.DS_Store")],
        sameHashes
      ],
      { [INCLUDE]: "certs/\n", [`${ROOT}/certs/dev.pem`]: "" }
    )
    expect(await firstNotInMain(certs.host, ROOT, PATH, ["certs/"])).toBe(null)

    // With `build/*` ignored, git status lists build/ whole, while git lists build/config.json apart. Named by its
    // path, it is a copy, and changed in the worktree keeps it; named at any depth, as `config.json`, nothing in build/
    // is.
    const build = (include: string) => {
      let asked = 0

      return fakeHost(
        [
          ignoredAre("build/config.json", "build/x/"),
          matchedAre("build/config.json"),
          [
            "git ls-files -z --others --ignored --exclude=build/config.json --",
            (line) => (line.endsWith(":(literal)build/config.json") ? names("build/config.json") : names())
          ],
          ["git hash-object", () => ({ stdout: asked++ === 0 ? "mine\n" : "main\n" })]
        ],
        { [INCLUDE]: include, [`${ROOT}/build/config.json`]: "" }
      )
    }
    expect(await firstNotInMain(build("build/config.json\n").host, ROOT, PATH, ["build/"])).toBe("build/config.json")
    const anyDepth = build("config.json\n")
    expect(await firstNotInMain(anyDepth.host, ROOT, PATH, ["build/"])).toBe(null)
    expect(anyDepth.calls.filter((call) => call.argv.includes(":(literal)build/")).map((call) => call.argv)).toEqual([])
  })

  test("Android's local.properties as the tools write it is made again; with a key of the person's, it is theirs", async () => {
    const holding = (text: string) => fakeHost([], { [`${PATH}/android/local.properties`]: text }, new Set())
    const written =
      "## This file is automatically generated by Android Studio.\n! Do not modify this file.\nsdk.dir=/Users/me/Library/Android/sdk\nflutter.sdk=/opt/flutter\nflutter.buildMode=debug\n"

    expect(await firstNotInMain(holding(written).host, ROOT, PATH, ["android/local.properties"])).toBe(null)
    expect(
      await firstNotInMain(holding(`${written}MAPS_API_KEY=abc\n`).host, ROOT, PATH, ["android/local.properties"])
    ).toBe("android/local.properties")
  })
})
