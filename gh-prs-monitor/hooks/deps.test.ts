// Author: David Matura

import type { ProcessRunResult } from "claude-code"
import { describe, expect, test } from "claude-code/testing"

import { ensureDependencies, installersIn, MOST_INSTALLS, NOTHING_TO_INSTALL, projectsOf } from "./deps"
import { fakeHost, PATH } from "./testing/git-host"

type Answer = [string, Partial<ProcessRunResult> | ((line: string) => Partial<ProcessRunResult>)]

// git's list of the files that name a project, as `git ls-files -z` gives it.
const tracked = (...paths: string[]): Answer => [
  "git ls-files -z --",
  { stdout: paths.map((path) => `${path}\0`).join("") }
]

// The lockfiles' hashes, one line each, in the order asked.
const hashed = (...hashes: string[]): Answer => [
  "git hash-object --",
  { stdout: hashes.map((hash) => `${hash}\n`).join("") }
]

describe("the installs of one folder's projects", () => {
  const only = (files: string[], isFlutter = false) =>
    installersIn(files, isFlutter).map((installer) => [installer.lockfile, installer.argv.join(" ")])

  test("each lockfile names its package manager's frozen install", () => {
    expect(only(["package.json", "package-lock.json"])).toEqual([["package-lock.json", "npm ci"]])
    expect(only(["npm-shrinkwrap.json"])).toEqual([["npm-shrinkwrap.json", "npm ci"]])
    expect(only(["pnpm-lock.yaml"])).toEqual([["pnpm-lock.yaml", "pnpm install --frozen-lockfile"]])
    expect(only(["bun.lockb"])).toEqual([["bun.lockb", "bun install --frozen-lockfile"]])
    expect(only(["bun.lock", "bun.lockb"])).toEqual([["bun.lock", "bun install --frozen-lockfile"]])
    expect(only(["yarn.lock"])).toEqual([["yarn.lock", "yarn install --frozen-lockfile"]])
    expect(only(["yarn.lock", ".yarnrc.yml"])).toEqual([["yarn.lock", "yarn install --immutable"]])
    expect(only(["pubspec.lock"])).toEqual([["pubspec.lock", "dart pub get --enforce-lockfile"]])
    expect(only(["pubspec.lock"], true)).toEqual([["pubspec.lock", "flutter pub get --enforce-lockfile"]])
    expect(only(["uv.lock"])).toEqual([["uv.lock", "uv sync --frozen"]])
    expect(only(["poetry.lock"])).toEqual([["poetry.lock", "poetry install --no-interaction"]])
    expect(only(["Pipfile.lock"])).toEqual([["Pipfile.lock", "pipenv sync"]])
    expect(only(["Gemfile.lock"])).toEqual([["Gemfile.lock", "bundle install"]])
    expect(only(["composer.lock"])).toEqual([["composer.lock", "composer install --no-interaction"]])
    expect(only(["packages.lock.json"])).toEqual([["packages.lock.json", "dotnet restore --locked-mode"]])
    expect(only(["Podfile", "Podfile.lock"])).toEqual([["Podfile.lock", "pod install --deployment"]])
  })

  test("one install per kind of project, the JavaScript one first; Bundler held to its lockfile", () => {
    expect(only(["pnpm-lock.yaml", "package-lock.json", "Gemfile.lock", "uv.lock", "poetry.lock"])).toEqual([
      ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
      ["uv.lock", "uv sync --frozen"],
      ["Gemfile.lock", "bundle install"]
    ])
    expect(installersIn(["Gemfile.lock"])[0]?.env).toEqual({ BUNDLE_FROZEN: "true" })
  })

  test("nothing for a Podfile.lock without its Podfile, or files no install reads", () => {
    expect(only(["Podfile.lock"])).toEqual([])
    expect(only(["package.json", "go.mod", "requirements.txt"])).toEqual([])
  })
})

describe("the projects in a checkout", () => {
  test("root first, then folder by folder down, each with its folder and its lockfile's path", () => {
    const projects = projectsOf([
      "apps/web/yarn.lock",
      "ios/Podfile",
      "ios/Podfile.lock",
      "package-lock.json",
      "zeta/uv.lock"
    ])

    expect(projects.installers.map((installer) => [installer.folder, installer.lockfile, installer.argv[0]])).toEqual([
      ["", "package-lock.json", "npm"],
      ["ios", "ios/Podfile.lock", "pod"],
      ["zeta", "zeta/uv.lock", "uv"],
      ["apps/web", "apps/web/yarn.lock", "yarn"]
    ])
  })

  test("not deeper than three folders, nor in installed code, examples or test data", () => {
    const projects = projectsOf([
      "apps/mobile/ios/Podfile",
      "apps/mobile/ios/Podfile.lock",
      "a/b/c/d/package-lock.json",
      "node_modules/x/package-lock.json",
      "packages/ui/example/pubspec.lock",
      "test/fixtures/yarn.lock",
      "vendor/acme/composer.lock"
    ])

    expect(projects.installers.map((installer) => installer.lockfile)).toEqual(["apps/mobile/ios/Podfile.lock"])
  })

  test("a tool that fetches on build is named once, for its topmost folder", () => {
    const projects = projectsOf([
      "android/settings.gradle.kts",
      "android/app/build.gradle.kts",
      "android/gradlew",
      "go.mod",
      "tools/go.mod",
      "Cargo.lock"
    ])

    expect(projects.onBuild).toEqual([
      { folder: "", tool: "Go" },
      { folder: "", tool: "Cargo" },
      { folder: "android", tool: "Gradle" }
    ])
    expect(projects.installers).toEqual([])
  })

  test("Flutter's folders get flutter's pub", () => {
    const projects = projectsOf(["pubspec.lock", "packages/core/pubspec.lock"], new Set([""]))

    expect(projects.installers.map((installer) => installer.argv[0])).toEqual(["flutter", "dart"])
  })
})

describe("ensureDependencies", () => {
  const MARKER = `${PATH}/node_modules/.gh-prs-monitor-lock`

  test("no project installs nothing, and says so", async () => {
    const { host, calls } = fakeHost([tracked()])
    const installs: string[] = []

    expect(await ensureDependencies(host, PATH, (command) => installs.push(command))).toBe(NOTHING_TO_INSTALL)
    expect(installs).toEqual([])
    expect(calls.map((call) => call.argv.split(" ").slice(0, 3).join(" "))).toEqual(["git ls-files -z"])
  })

  test("installs from the lockfile and marks what it installed", async () => {
    const { host, calls, written } = fakeHost([tracked("package-lock.json"), hashed("abc123")])
    const installs: string[] = []

    expect(await ensureDependencies(host, PATH, (command) => installs.push(command))).toBe("installed with npm ci")
    expect(installs).toEqual(["npm ci"])
    expect(calls.at(-1)).toEqual({ argv: "npm ci", cwd: PATH })
    expect(written[MARKER]).toBe("npm ci abc123")
  })

  test("skips the install while the marker matches the lockfile", async () => {
    const { host, calls } = fakeHost([tracked("package-lock.json"), hashed("abc123")], {
      [MARKER]: "npm ci abc123\n"
    })
    const installs: string[] = []

    expect(await ensureDependencies(host, PATH, (command) => installs.push(command))).toBe(
      "dependencies already installed (npm ci)"
    )
    expect(installs).toEqual([])
    expect(calls.some((call) => call.argv === "npm ci")).toBe(false)
  })

  test("installs again when the lockfile changed", async () => {
    const { host, written } = fakeHost([tracked("package-lock.json"), hashed("def456")], {
      [MARKER]: "npm ci abc123"
    })

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe("installed with npm ci")
    expect(written[MARKER]).toBe("npm ci def456")
  })

  test("the same lockfile installed by another package manager installs again", async () => {
    const { host } = fakeHost([tracked("pnpm-lock.yaml"), hashed("abc123")], { [MARKER]: "npm ci abc123" })

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe("installed with pnpm install --frozen-lockfile")
  })

  test("no marker where git does not ignore the folder an install fills, so the install runs each time", async () => {
    const { host, written } = fakeHost([
      tracked("ios/Podfile", "ios/Podfile.lock"),
      hashed("abc123"),
      ["git check-ignore", { exitCode: 1 }]
    ])

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe("ios: installed with pod install --deployment")
    expect(written).toEqual({})
  })

  test("each project of a checkout installs in its folder, told part by part, with the tools that fetch on build", async () => {
    const { host, calls, written } = fakeHost([
      tracked("package-lock.json", "ios/Podfile", "ios/Podfile.lock", "backend/Gemfile.lock", "android/gradlew"),
      hashed("h1", "h2", "h3"),
      ["pod install", { exitCode: 1, stderr: "[!] The version of CocoaPods used to generate the lockfile is higher\n" }]
    ])
    const installs: string[] = []

    expect(await ensureDependencies(host, PATH, (command) => installs.push(command))).toBe(
      "installed with npm ci; " +
        "backend: installed with bundle install; " +
        "ios: pod install --deployment failed (exit 1): [!] The version of CocoaPods used to generate the lockfile is higher; " +
        "android: Gradle fetches its dependencies on the first build"
    )
    expect(installs).toEqual(["npm ci", "backend: bundle install", "ios: pod install --deployment"])
    expect(calls.filter((call) => !call.argv.startsWith("git"))).toEqual([
      { argv: "npm ci", cwd: PATH },
      { argv: "bundle install", cwd: `${PATH}/backend`, env: { BUNDLE_FROZEN: "true" } },
      { argv: "pod install --deployment", cwd: `${PATH}/ios` }
    ])
    // Only the finished install is marked.
    expect(written).toEqual({ [MARKER]: "npm ci h1" })
  })

  test("the projects past the most installed at once are named, not installed", async () => {
    const folders = Array.from({ length: MOST_INSTALLS + 2 }, (_, index) => `app${index}`)
    const { host, calls } = fakeHost([
      tracked(...folders.map((folder) => `${folder}/uv.lock`)),
      hashed(...folders.map((_, index) => `h${index}`))
    ])

    const note = await ensureDependencies(host, PATH, () => undefined)

    expect(calls.filter((call) => call.argv === "uv sync --frozen")).toHaveLength(MOST_INSTALLS)
    expect(note.split("; ").slice(-2)).toEqual([
      "app6: not installed, as one go installs 6 projects at most (uv sync --frozen)",
      "app7: not installed, as one go installs 6 projects at most (uv sync --frozen)"
    ])
  })

  test("projects installed already take none of the most installed at once", async () => {
    const folders = Array.from({ length: MOST_INSTALLS + 2 }, (_, index) => `app${index}`)
    const { host, calls } = fakeHost(
      [tracked(...folders.map((folder) => `${folder}/uv.lock`)), hashed(...folders.map((_, index) => `h${index}`))],
      {
        [`${PATH}/app0/.venv/.gh-prs-monitor-lock`]: "uv sync --frozen h0",
        [`${PATH}/app1/.venv/.gh-prs-monitor-lock`]: "uv sync --frozen h1"
      }
    )

    const note = await ensureDependencies(host, PATH, () => undefined)

    expect(calls.filter((call) => call.argv === "uv sync --frozen")).toHaveLength(MOST_INSTALLS)
    expect(note).not.toContain("not installed")
  })

  test("a failed install says why and marks nothing; an old marker is cleared first, and none is made ahead", async () => {
    const failing = (files: Record<string, string>) =>
      fakeHost(
        [
          tracked("package-lock.json"),
          hashed("abc123"),
          ["npm ci", { exitCode: 1, stderr: "npm ERR! code ERESOLVE\nnpm ERR! could not resolve\n" }]
        ],
        files
      )

    const earlier = failing({ [MARKER]: "npm ci old" })
    expect(await ensureDependencies(earlier.host, PATH, () => undefined)).toBe(
      "npm ci failed (exit 1): npm ERR! could not resolve"
    )
    // So a half-done install is never taken for a finished one.
    expect(earlier.written).toEqual({ [MARKER]: "" })
    // Writing one before the install would make the folder ahead of the tool.
    const first = failing({})
    await ensureDependencies(first.host, PATH, () => undefined)
    expect(first.written).toEqual({})
  })

  test("an installer's long last line is cut, so each project's part keeps its room", async () => {
    const { host } = fakeHost([
      tracked("package-lock.json"),
      hashed("abc123"),
      ["npm ci", { exitCode: 1, stderr: `npm ERR! ${"x".repeat(400)}\n` }]
    ])

    const note = await ensureDependencies(host, PATH, () => undefined)

    expect(note.startsWith("npm ci failed (exit 1): npm ERR! xxx")).toBe(true)
    expect(Array.from(note.slice("npm ci failed (exit 1): ".length))).toHaveLength(160)
    expect(note.endsWith("x…")).toBe(true)
  })

  test("a package manager that is not installed", async () => {
    const { host } = fakeHost([
      tracked("pnpm-lock.yaml"),
      hashed("abc123"),
      [
        "pnpm install",
        () => {
          throw new Error("spawn pnpm ENOENT")
        }
      ],
      [
        "cmd /c",
        () => {
          throw new Error("spawn cmd ENOENT")
        }
      ]
    ])

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe(
      "pnpm install --frozen-lockfile could not run: spawn pnpm ENOENT"
    )
  })

  test("an install that ran out of time is not started again", async () => {
    const { host, calls } = fakeHost([
      tracked("package-lock.json"),
      hashed("abc123"),
      [
        "npm ci",
        () => {
          throw new Error("npm ci did not finish within 600000 ms")
        }
      ]
    ])

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe(
      "npm ci did not finish within 10 minutes, so node_modules may be incomplete"
    )
    expect(calls.map((call) => call.argv)).not.toContain("cmd /c npm ci")
  })

  test("on Windows the package manager starts through the command interpreter", async () => {
    const { host, calls } = fakeHost([
      tracked("package-lock.json"),
      hashed("abc123"),
      [
        "npm ci",
        () => {
          throw new Error("spawn npm ENOENT")
        }
      ]
    ])

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe("installed with npm ci")
    expect(calls.at(-1)).toEqual({ argv: "cmd /c npm ci", cwd: PATH })
  })

  test("Flutter is told by its pubspec.yaml", async () => {
    const { host, calls } = fakeHost([tracked("pubspec.lock"), hashed("abc123")], {
      [`${PATH}/pubspec.yaml`]: "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n"
    })

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe(
      "installed with flutter pub get --enforce-lockfile"
    )
    expect(calls.at(-1)).toEqual({ argv: "flutter pub get --enforce-lockfile", cwd: PATH })
    // However YAML lets it be written.
    for (const line of ["sdk: flutter # the SDK", 'sdk: "flutter"', "sdk: 'flutter'"]) {
      const quoted = fakeHost([tracked("pubspec.lock"), hashed("abc123")], {
        [`${PATH}/pubspec.yaml`]: `dependencies:\n  flutter:\n    ${line}\n`
      })
      expect(await ensureDependencies(quoted.host, PATH, () => undefined)).toBe(
        "installed with flutter pub get --enforce-lockfile"
      )
    }
  })

  test("Yarn's flag and the folder its marker goes in come from its lockfile and its settings", async () => {
    const BERRY =
      '# This file is generated by running "yarn install" inside your project.\n\n__metadata:\n  version: 8\n'
    const V1 = "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1\n"
    const installed = async (files: Record<string, string>) => {
      const tracking = Object.keys(files).map((path) => path.slice(`${PATH}/`.length))
      const { host, calls, written } = fakeHost([tracked(...tracking), hashed("abc123")], files)
      await ensureDependencies(host, PATH, () => undefined)

      return { command: calls.at(-1)?.argv, marker: Object.keys(written) }
    }

    // Berry installs Plug'n'Play files unless set otherwise, whatever settings file the folder holds.
    expect(await installed({ [`${PATH}/yarn.lock`]: BERRY })).toEqual({
      command: "yarn install --immutable",
      marker: [`${PATH}/.yarn/.gh-prs-monitor-lock`]
    })
    expect(
      await installed({ [`${PATH}/yarn.lock`]: BERRY, [`${PATH}/.yarnrc.yml`]: "nodeLinker: node-modules\n" })
    ).toEqual({ command: "yarn install --immutable", marker: [`${PATH}/node_modules/.gh-prs-monitor-lock`] })
    // Yarn 1 ignores --immutable, and would rewrite its lockfile.
    expect(await installed({ [`${PATH}/yarn.lock`]: V1, [`${PATH}/.yarnrc.yml`]: "yarnPath: x\n" })).toEqual({
      command: "yarn install --frozen-lockfile",
      marker: [`${PATH}/node_modules/.gh-prs-monitor-lock`]
    })
  })

  test("a folder the install itself makes ignored gets the marker after it", async () => {
    // uv writes .venv/.gitignore as it installs: git ignores the marker's place only afterwards.
    let asked = 0
    const { host, written } = fakeHost([
      tracked("uv.lock"),
      hashed("abc123"),
      ["git check-ignore", () => ({ exitCode: asked++ === 0 ? 1 : 0 })]
    ])

    expect(await ensureDependencies(host, PATH, () => undefined)).toBe("installed with uv sync --frozen")
    expect(written).toEqual({ [`${PATH}/.venv/.gh-prs-monitor-lock`]: "uv sync --frozen abc123" })
  })
})
