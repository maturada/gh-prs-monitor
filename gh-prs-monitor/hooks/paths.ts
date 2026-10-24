// Author: David Matura

// A folder's path as the person types it, made whole, and as the pane shows it, from `~` in the home folder; on
// Windows, with its drives and backslashes.

// A folder's path as typed, made whole: `~` alone, or before a slash, is the home folder (`home`); a relative path is
// from `cwd`; `.` and `..` are worked out. On Windows, where the session's folder starts with a drive, a backslash
// separates folders as a slash does.
export function typedPath(path: string, home: string | null, cwd: string): string {
  const isWindows = /^[A-Za-z]:[\\/]/.test(cwd)
  const slashed = (text: string): string => (isWindows ? text.replace(/\\/g, "/") : text)
  const typed = slashed(path)
  const isHome = home !== null && (typed === "~" || typed.startsWith("~/"))

  return normalPath(
    isHome ? `${slashed(home)}${typed.slice(1)}` : isAbsolute(typed) ? typed : `${slashed(cwd)}/${typed}`
  )
}

// A path in the home folder written from `~`, as `typedPath` reads it back. On Windows, the home folder (`USERPROFILE`)
// is written with backslashes, a clone's path, as git gives it, with slashes, and letter case tells no folders apart.
export function homeShort(path: string, home: string | null): string {
  if (!home) {
    return path
  }
  const base = normalPath(/^[A-Za-z]:[\\/]/.test(home) ? home.replace(/\\/g, "/") : home)

  return isInFolder(path, base) ? `~${path.slice(base.length)}` : path
}

// Whether a path, made whole (`typedPath`), is the folder or inside it; on Windows letter case tells no folders apart.
export function isInFolder(path: string, folder: string): boolean {
  const head = path.slice(0, folder.length)
  const isSame = /^[A-Za-z]:\//.test(folder) ? head.toLowerCase() === folder.toLowerCase() : head === folder

  return isSame && (path.length === folder.length || path[folder.length] === "/")
}

// Whether a path starts at a root: `/`, or a Windows drive's (`C:/`).
export function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path)
}

// A path with `.` and `..` worked out and no slash at its end, but a Windows drive's root (`C:/`).
export function normalPath(path: string): string {
  const drive = /^[A-Za-z]:(?=\/|$)/.exec(path)?.[0] ?? ""
  const parts: string[] = []
  for (const part of path.slice(drive.length).split("/")) {
    if (part === "..") {
      parts.pop()
    } else if (part !== "." && part !== "") {
      parts.push(part)
    }
  }

  return `${drive}/${parts.join("/")}`
}
