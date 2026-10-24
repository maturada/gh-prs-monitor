// Author: David Matura
//
// A folder as a session notes it (mainRoot, run in it) and as a visit checks it (readClone and checkClone, its git
// config read as a file, nothing run in it), against real git.
// usage: bun run harness/clones.ts note <session folder>
//        bun run harness/clones.ts check <folder> <owner/name>
//        bun run harness/clones.ts folder <folder typed>
import { mainRoot } from "../plugin/hooks/checkout"
import { checkClone, readClone, readFolder } from "../plugin/hooks/clones"
import { realHost } from "./real-host"

const [mode, folder, name] = process.argv.slice(2) as [string, string, string | undefined]
const log: string[] = []
const host = realHost(
  () => folder,
  (argv) => ({ exitCode: 1, stdout: "", stderr: `unexpected gh call: ${argv.join(" ")}`, isStdoutTruncated: false, isStderrTruncated: false }),
  log
)
if (mode === "note") {
  console.log(`noted: ${await mainRoot(host)}`)
} else if (mode === "folder") {
  const named = ((await readFolder(host, folder)) ?? []).map((each) => `${each.host} ${each.name}`).join(", ")
  const ran = log.filter((line) => !line.startsWith("  ->")).length
  console.log(`typed: [${named}] | commands run: ${ran}`)
} else {
  const repo = { host: "github.com", name: name ?? "acme/app" }
  const named = (await readClone(host, folder)).map((each) => `${each.host} ${each.name}`).join(", ")
  const ran = log.filter((line) => !line.startsWith("  ->")).length
  console.log(`remotes: [${named}] | offered: ${(await checkClone(host, { root: folder, repo })) ? "yes" : "no"} | commands run: ${ran}`)
}
