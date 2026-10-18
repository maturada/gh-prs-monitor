# H8: the behaviour differential

H8 runs two versions of the plugin through the same randomised scripted sessions and compares what each did, event by
event, in the order it happened. A refactor that keeps behaviour gives 0 tests differing; a behaviour change shows
exactly where it differs.

What is traced: every gh and git command run, store reads, writes, deletes and key listings, state writes, toasts,
the status line, logs (debug too), sounds, pane open, close and list, commands run, and the questions asked in Claude
Code's dialog.

The scenarios (`scn.tmpl`): 70 random steps per test (GitHub's answers changing, sign-outs and network failures, the
pane opened, closed and pressed, surfaces attached and detached, branches switched, a broken store, turns starting and
ending), over three refresh modes, three poll intervals and 25 seeds: 225 tests per variant. Variant letters combine:
L rows and branches leave, A closed alerts off, O cleanup off, S slow closed lookup, X dead closed lookup, P typed
create-pr, Y reopened pull requests, M mentions, W turns with ids, typed skills, answers to questions, the pane behind
another, two presses in one instant. The usual set is `N LYMW LSPW LXAW LOW` (1,125 tests).

## Running it

From the repository root, with B a copy of the version before (a checkout of the previous tag) and C the one after:

```
zsh maintenance/h8/build.sh <B folder> <C folder>     # .work/h8/B and .work/h8/C
zsh maintenance/h8/run.sh                             # about four minutes a side
python3 maintenance/h8/compare.py 5                   # in order
python3 maintenance/h8/compare.py 5 --sorted          # as multisets
```

## Reading the result

- **Clean:** `tests differing: 0 of 1125` in order. Run B against B once to see the machine's own noise: it should
  be 0.
- A difference in order only (0 sorted) comes from an `await` added or removed: the same work, interleaved
  differently.
- A difference in time only (the same events, one landing a clock step later) is timing; run it again before it counts.
- Anything else is a behaviour change: it must be one the change meant.
- `trace-world.py` stops the build when a test-machine handler it anchors on (in `hooks/testing/world.ts`) is gone:
  update its anchor list with the handler's new text.
- A test cut short by the kit's 5 s leaves work running into the next one, which makes traces differ by wall-clock
  time: each scenario may take 60 s, and the sides run one after the other at low priority.
