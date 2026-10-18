## What and why

<!-- What changes, and why: the problem, and how this solves it. -->

<!-- Link its issue: "Closes #12" when this resolves it, "Refs #12" when it is part of it. A small fix without one:
"No issue:" and why. -->
Closes #

## Checks

- [ ] The branch is `feature/<what>` or `fix/<what>`
- [ ] `maintenance/check.sh` passes
- [ ] A test for what changed; for a fix, one that fails without it
- [ ] The deeper checks this change needs (CONTRIBUTING.md, "Deeper checks"), and what they showed:
- [ ] `gh-prs-monitor/README.md` and `gh-prs-monitor/docs/` say what changed, and `python3 maintenance/readme.py` ran

The maintainer sets the version and the CHANGELOG line before merging.
