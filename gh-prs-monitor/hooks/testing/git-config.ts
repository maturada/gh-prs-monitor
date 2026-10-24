// Author: David Matura

// A clone's git config with `remotes`, by name, as `git clone` and `git remote add` write them, for the tests that read
// one as a file.
export function gitConfigOf(remotes: Record<string, string>): string {
  return [
    "[core]\n\trepositoryformatversion = 0\n\tbare = false",
    ...Object.entries(remotes).map(
      ([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*`
    ),
    '[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main'
  ].join("\n")
}
