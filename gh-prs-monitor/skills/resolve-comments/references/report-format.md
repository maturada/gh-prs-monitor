# Phase 4 report format

The layout `resolve-comments` prints when it presents unresolved threads for approval.

### Format

~~~markdown
| # | File | Status |
|---|------|--------|
| 1 | `src/components/Foo.tsx:42` | 🔴 NEEDS FIX · 💡 HAS SUGGESTION |
| 2 | `src/utils/helpers.ts` | 🟡 DEBATABLE · RESPONDED |
| 3 | `src/api/client.ts:77` | ✅ ALREADY FIXED |

**Summary:** 3 comments — 1 🔴 NEEDS FIX · 1 🟡 DEBATABLE · 1 ✅ ALREADY FIXED

---

### #1 · `src/components/Foo.tsx:42` · 🔴 NEEDS FIX · 💡 HAS SUGGESTION

💬 **[@username](https://github.com/OWNER/REPO/pull/N#discussion_r123):** *"The null check here will fail when items is empty..."*

Line 42 still accesses `.length` without checking for null/undefined.

**Suggested fix:**
```ts
if (items?.length) {
  ...
}
```

---

### #2 · `src/utils/helpers.ts` · 🟡 DEBATABLE · RESPONDED

💬 **[@username](https://github.com/OWNER/REPO/pull/N#discussion_r124):** *"Consider extracting this into a shared utility..."*

**You replied:** *"Will follow up in a separate PR — out of scope here."*

Refactor suggestion — already addressed by your reply, no further action.

---

### #3 · `src/api/client.ts:77` · ✅ ALREADY FIXED

💬 **[@username](https://github.com/OWNER/REPO/pull/N#discussion_r125):** *"Missing error handling in the fetch block..."*

try/catch added at lines 74-80 in the current branch.

---

**Answered since:** [@ann's review summary](https://github.com/OWNER/REPO/pull/N#pullrequestreview-201), [@bob's comment](https://github.com/OWNER/REPO/pull/N#issuecomment-301)

**Reply with:** numbers (e.g. `1, 3`) · `all` (every NEEDS FIX, and DEBATABLE not RESPONDED) · `needs fix` (only red) · `apply suggestions` (auto-apply suggestion blocks, on the threads `all` covers) · `none`
~~~

**Formatting notes:**
- Reviewer attribution uses 💬 bubble emoji + bold linked username + italic comment in quotes, all on one line — keeps it compact and scannable
- The single-line reason / explanation goes below the attribution, plain paragraph
- `code` formatting for file paths in the table (helps the eye separate file from status)
- Wrap inline code (function names, identifiers, file refs) in backticks consistently
- For threads with a `suggestion`: add `· 💡 HAS SUGGESTION` to the status, and render the suggestion in a fenced code block under `**Suggested fix:**`
- For threads already answered: add `· RESPONDED` to the status, and render the reply under `**You replied:** *"…"*` so the user can see what was said without leaving the chat. When the PR author wrote it on someone else's PR, the label is `**@<author> replied:**`
- Review summaries and general comments answered since (Phase 2) go on the one `**Answered since:**` line before **Reply with:**, each linked to its `url`. Leave the line out when there are none
- For outdated threads (only with `--include-outdated`): add `· OUTDATED` to the status, show the location as `path (was :<original_line>)` when `line` is null, and start the explanation with *Outdated — the code this points at has changed since the comment*, followed by where that code is now
