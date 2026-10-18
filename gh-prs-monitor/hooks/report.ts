// Author: David Matura

// `/prs report`: where to report a bug or suggest an idea, and the versions a bug report asks for, filled into its link.
// The repository is the one the plugin's manifest names, so a copy whose manifest names another reports there. Nothing
// of the person's goes in, no repository, path or account: only the versions and the system.

import { firstLine } from "./gh"
import { GIT } from "./machine"
import type { Host } from "./machine"

export type ReportHost = Pick<Host, "run"> & {
  // The plugin's manifest, `.claude-plugin/plugin.json`, as text.
  manifest: () => Promise<string>
  // Claude Code's version, as `claude --version` prints it.
  engineVersion: () => Promise<string>
}

// Each null where it could not be read.
export type ReportFacts = {
  version: string | null
  // The GitHub repository the manifest names, as `owner/name`.
  repository: string | null
  claudeCode: string | null
  system: string | null
  gh: string | null
  git: string | null
}

export async function reportFacts(host: ReportHost): Promise<ReportFacts> {
  const [manifest, claudeCode, system, gh, git] = await Promise.all([
    host.manifest().then(manifestFacts, () => manifestFacts("")),
    host.engineVersion().then(
      (version) => version.trim() || null,
      () => null
    ),
    systemOf(host),
    versionOf(host, ["gh", "--version"], /^gh version (\S+)/),
    versionOf(host, [...GIT, "--version"], /^git version (\S+)/)
  ])

  return { ...manifest, claudeCode, system, gh, git }
}

// A github.com repository in the forms a manifest's `repository` gives one: an https or ssh address,
// `git@github.com:owner/name`, `github:owner/name` or `owner/name`, with or without `.git`.
const GITHUB_REPOSITORY =
  /^(?:git\+)?(?:(?:https?|ssh):\/\/(?:git@)?(?:www\.)?github\.com\/|git@github\.com:|github:)?([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/i

// The manifest's version, and the github.com repository it names.
export function manifestFacts(text: string): Pick<ReportFacts, "version" | "repository"> {
  let manifest: unknown = null
  try {
    manifest = JSON.parse(text)
  } catch {
    // Read as no manifest.
  }
  if (typeof manifest !== "object" || manifest === null) {
    return { version: null, repository: null }
  }
  const { version, repository } = manifest as { version?: unknown; repository?: unknown }

  return {
    version: typeof version === "string" ? version : null,
    repository: typeof repository === "string" ? (GITHUB_REPOSITORY.exec(repository.trim())?.[1] ?? null) : null
  }
}

// `uname -sr`, and on macOS its own version as well (`sw_vers`), which the kernel's doesn't tell. Windows has no
// `uname`, so there it is null unless a POSIX layer such as Git Bash answers.
async function systemOf(host: ReportHost): Promise<string | null> {
  const kernel = await ranLine(host, ["uname", "-sr"])
  if (kernel === null || !kernel.startsWith("Darwin ")) {
    return kernel
  }
  const release = await ranLine(host, ["sw_vers", "-productVersion"])

  return release === null ? `macOS (${kernel})` : `macOS ${release} (${kernel})`
}

async function versionOf(host: ReportHost, argv: readonly string[], pattern: RegExp): Promise<string | null> {
  const answer = await ranLine(host, argv)

  return answer === null ? null : (pattern.exec(answer)?.[1] ?? null)
}

// The first line a command printed, or null where it is missing, failed, or printed nothing.
async function ranLine(host: ReportHost, argv: readonly string[]): Promise<string | null> {
  try {
    const ran = await host.run(argv, { timeoutMs: 10_000 })

    return ran.exitCode === 0 ? firstLine(ran.stdout) || null : null
  } catch {
    return null
  }
}

export function reportText(facts: ReportFacts): string {
  const versions = [
    facts.version && `gh-prs-monitor ${facts.version}`,
    facts.claudeCode && `Claude Code ${facts.claudeCode}`,
    facts.system,
    facts.gh && `gh ${facts.gh}`,
    facts.git && `git ${facts.git}`
  ]
    .filter(Boolean)
    .join(" · ")
  if (facts.repository === null) {
    return [versions, "This copy of gh-prs-monitor names no github.com repository to report to."]
      .filter(Boolean)
      .join("\n\n")
  }
  const issues = `https://github.com/${facts.repository}/issues`

  return [
    versions,
    [
      `- [Report a bug](${bugReportLink(issues, facts)}), with these versions filled in`,
      `- [Suggest an idea](${issues}/new?template=feature_request.yml)`,
      `- [Issues already open](${issues}), to see whether it is known`
    ].join("\n"),
    `From a terminal: \`gh issue create --repo ${facts.repository}\`. Leave out anything private: tokens, private ` +
      "repositories' names, paths."
  ]
    .filter(Boolean)
    .join("\n\n")
}

// The bug report form, its text fields filled in by their ids (`.github/ISSUE_TEMPLATE/bug_report.yml`); GitHub fills
// a form's text fields from the link, and leaves its dropdowns to the person.
function bugReportLink(issues: string, facts: ReportFacts): string {
  const query = new URLSearchParams({ template: "bug_report.yml" })
  if (facts.version) {
    query.set("plugin", facts.version)
  }
  if (facts.claudeCode) {
    query.set("claude-code", facts.claudeCode)
  }
  const system = [facts.system, facts.gh && `gh ${facts.gh}`, facts.git && `git ${facts.git}`].filter(Boolean)
  if (system.length > 0) {
    query.set("system", system.join(", "))
  }

  return `${issues}/new?${query}`
}
