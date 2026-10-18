# Author: David Matura
#
# A pull request's branch name and description, as CONTRIBUTING.md asks for them: a `feature/<what>` or `fix/<what>`
# branch, a description that says what changes and why, and its issue linked (`Closes #12`, `Fixes #12`, `Refs #12`,
# or the issue's URL after one of those words), or `No issue:` and why for a small fix. Dependabot's pull requests are
# its own, told by their author, as anyone can name a branch. CI runs it on pull requests.
# Usage: AUTHOR=<login> BRANCH=<head branch> BODY=<description> python3 maintenance/pr-check.py
import os, re, sys

author = os.environ.get("AUTHOR", "")
branch = os.environ.get("BRANCH", "")
body = re.sub(r"<!--.*?-->", "", os.environ.get("BODY") or "", flags=re.S).replace("\r\n", "\n").replace("\r", "\n")

if author == "dependabot[bot]":
    print("A Dependabot pull request: its own name and description.")
    sys.exit(0)

KEYWORDS = r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)"
ISSUE = r"(?:#\d+|https://github\.com/[\w.-]+/[\w.-]+/issues/\d+)"
LINK = rf"^[ \t]*{KEYWORDS}[ \t]+{ISSUE}[ \t.]*$"
NO_ISSUE = r"^[ \t]*No issue:[ \t]*\S.*$"

problems = []
if not re.fullmatch(r"(feature|fix)/[a-z0-9][a-z0-9._-]*", branch):
    problems.append(f"Name the branch feature/<what> or fix/<what>, lowercase with hyphens (it is `{branch}`).")

why = re.search(r"^##[ \t]+What and why[ \t]*\n(.*?)(?=^## |\Z)", body, re.M | re.S | re.I)
told = re.sub(rf"{LINK}|{NO_ISSUE}", "", why.group(1), flags=re.M | re.I) if why else ""
if len(" ".join(told.split())) < 20:
    problems.append("Say under `## What and why` what changes and why.")

if not re.search(rf"{LINK}|{NO_ISSUE}", body, re.M | re.I):
    problems.append(
        "Link the issue on a line of its own (`Closes #12`, `Fixes #12`, `Resolves #12` or `Refs #12`, or the issue's "
        "URL after one of those words), or write `No issue:` and why."
    )

if problems:
    sys.exit("\n".join(problems))
print("Branch name and description in order.")
