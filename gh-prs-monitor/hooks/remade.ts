// Author: David Matura

// What git ignores in a worktree that tools make again, so its removal loses nothing: installed dependencies, build
// output and caches, and the files installs generate.

import { MARKER_NAME } from "./deps"

// Installed dependencies (the install marker among them), build output and caches, in the common languages' usual
// folders, which git lists as the folder itself; a file it lists apart, as one in a tracked `build` folder, is not one
// of them, unless it is a cache file of its own, or one Flutter, CocoaPods or Yarn's Plug'n'Play install generates.
// Within `node_modules` everything is installed.
const REMADE_FOLDERS: ReadonlySet<string> = new Set([
  ...["node_modules", "bower_components", ".venv", "venv", "vendor", "Pods", ".dart_tool", ".symlinks", "ephemeral"],
  ...["target", "build", "dist", "obj", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".gradle"],
  ...["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis"],
  ...["coverage", ".nyc_output", ".ipynb_checkpoints"]
])

const REMADE_FILES =
  /(^|\/)(\.DS_Store|Thumbs\.db|\.eslintcache|\.coverage|[^/]*\.tsbuildinfo|[^/]*\.py[co]|\.flutter-plugins(-dependencies)?|Generated\.xcconfig|flutter_export_environment\.sh|\.pnp\.(c?js|loader\.mjs|data\.json)|\.yarn\/(cache|unplugged)(\/.+)?|\.yarn\/(install-state\.gz|build-state\.yml))$/

// An entry as git lists it: a folder with a slash at its end. The install marker is one wherever an install put it, as
// in `.yarn` for Plug'n'Play.
export function isRemade(path: string): boolean {
  const name = path.replace(/\/$/, "")
  const isFolder = path.endsWith("/")

  return (
    name.split("/").includes("node_modules") ||
    (isFolder && REMADE_FOLDERS.has(name.split("/").at(-1) ?? "")) ||
    REMADE_FILES.test(name) ||
    (!isFolder && name.split("/").at(-1) === MARKER_NAME)
  )
}

// The outermost folder tools make again that a path git lists lies in or is, with a slash at its end (`build/` for
// `build/x/` and `build/x/a.json`, `node_modules/` for `node_modules/pkg/build/`); null for none. A folder entry with a
// slash at its end counts its own name.
export function remadeFolderOf(path: string): string | null {
  const folders = path
    .replace(/\/$/, "")
    .split("/")
    .slice(0, path.endsWith("/") ? undefined : -1)
  const index = folders.findIndex((name) => name === "node_modules" || REMADE_FOLDERS.has(name))

  return index === -1 ? null : `${folders.slice(0, index + 1).join("/")}/`
}

// Android's `local.properties`, which the SDK tools and Flutter's `pub get` write and the person may add keys to: told
// apart by what it holds (`isRemadeText`).
export function isJudgedByText(path: string): boolean {
  return /(^|\/)local\.properties$/.test(path)
}

// Such a file as the tools write it: the machine's SDK paths and Flutter's build settings, and comments. One holding
// anything else, as a key of the person's, is theirs.
export function isRemadeText(text: string): boolean {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .every(
      (line) => line === "" || /^[#!]/.test(line) || /^(sdk\.dir|ndk\.dir|cmake\.dir|flutter\.\w+)\s*[=:]/.test(line)
    )
}
