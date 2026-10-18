// Author: David Matura
//
// How fetch-source.ts reads remote addresses: bun run harness/addresses.ts prints each sample's host and whether it
// names acme/app, and the address made for each host and protocol.
import { addressOf, hostOf, namesRepo } from "../plugin/hooks/fetch-source"
const urls = ["ssh://git@ssh.github.com:443/acme/app.git", "git@github.com:Acme/App.git", "https://www.github.com/acme/app", "org-123@github.com:acme/app.git", "acme@acme.ghe.com:acme/app.git", "https://ghes.corp:8443/acme/app.git", "git@ghes.corp:acme/app.git/", "https://github.com/acme/app.GIT", "/srv/x/acme/app.git", "C:/repos/acme/app"]
for (const u of urls) console.log(u.padEnd(46), "host:", String(hostOf(u)).padEnd(16), "names acme/app:", namesRepo(u, "acme/app"))
for (const [h, p] of [["github.com", "ssh"], ["Acme.GHE.com", "ssh"], ["foo.bar.ghe.com", "ssh"], ["github.localhost", "https"], ["localhost", "https"], ["GHES.corp", "https"]]) console.log(h.padEnd(18), p.padEnd(6), addressOf("ann/app", h, p))
