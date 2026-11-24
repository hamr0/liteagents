---
name: refactor
description: Refactor and optimize [code]
argument-hint: [file-or-function, a named area (e.g. "the auth module"), or empty for the fix ledger]
allowed-tools: Read, Edit, Grep, Glob, Bash(npm test:*), Bash(npx jest:*), Bash(npx vitest:*), Bash(pnpm test:*), Bash(yarn test:*), Bash(pytest:*), Bash(python:*), Bash(go test:*), Bash(cargo test:*), Bash(make test:*), Bash(git diff:*), Bash(git grep:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git switch:*)
disable-model-invocation: true
---
Refactor $ARGUMENTS. A targeted refactor includes the performance pass
below — it is on by default, not a separate command.

## Guardrails
- **Spawn a worker, mid tier stated explicitly** (an omitted tier inherits the
  parent's; never a vendor model name). Run inline if your tool has no
  subagent mechanism.
- **Escalate, never assume.** Anything you cannot decide, cannot verify, or
  that this spec does not cover → **stop and report it to the orchestrator**.
  Never improvise, never widen scope, never fix a side issue you noticed (for
  workers this overrides the Surgical dev rule).
- **The worker does the work itself — no sub-spawning.** Every edit it reports
  and every test run it cites is one it made or ran with its own tool calls.
- **The HITL gates below belong to the orchestrator, not the worker.** When one
  trips — a failing test, a crossed public API boundary, a change bigger than
  the bullet asked for — the worker **stops there and hands the situation
  back**, with the options and its reasoning but no choice made. The
  orchestrator asks.
- **Edit only the picked item** (a surviving ledger bullet or a picked
  duplicate group). Ledger mode's scope is the bullets that survive
  revalidation, one change per bullet — not the neighbouring code, not the
  formatting, not a second finding noticed on the way past. Anything else goes
  back to the orchestrator to become a new bullet.
- **Prove the blast radius with two checks, because neither sees what the
  other does.** `git status --porcelain` at exit must list only files the
  picked item named — that is this command's scope guarantee, and unlike
  `/branch-review` it is not expected to be empty. `.claude/` is gitignored, so also
  hash the files there before you start and again before you report:
  ```
  find .claude/remember -maxdepth 1 -type f -exec md5sum {} + | sort -k2
  ```
  and show the comparison: in ledger mode only `fix-ledger.md` may differ; in
  duplicates mode nothing may differ. `last-review.md` is
  `/branch-review`'s to write.

## Ledger mode — `$ARGUMENTS` empty or plain-text guidance
Plain text that is not `duplicates` and names no file, directory or function
(e.g. "fix all nits, nothing on vibes") is ledger mode; pass the text to the
worker as guidance on which surviving bullets to take. Work through `.claude/remember/fix-ledger.md`, the non-blocking findings
`/self-review` and `/branch-review` have accumulated. Everything below (goals, constraints,
verification, HITL gates) still applies; this section only says what to
refactor and how to close each item.

1. **Tree must be clean and not on `main`.** The orchestrator runs this check
   before spawning the worker, so a dirty tree costs no worker; the worker
   then re-runs it as its own first act. `git status --porcelain` non-empty
   → stop, say what is uncommitted. On `main` → `git switch -c chore/fix-ledger`.
2. **Ledger missing or has zero bullets** → say so and stop. Nothing to do.
3. **Revalidate every bullet first, fix nothing yet.** For each: `git grep -F
   "<snippet>" -- <path>`. **No hit → delete the bullet** and list it as
   "cleaned by other work". Hit → re-read the surrounding code; if the finding
   no longer holds, delete the bullet with a one-line reason. What survives is
   the work list.
4. **Fix only surviving `nit` bullets** (tags: `/branch-review`'s ledger
   header; untagged = `nit`), one bullet per change, under the constraints
   below. Delete each bullet as its fix lands. **Surviving `change` and `idea`
   bullets are listed in the report ("left: change" / "left: idea") and left
   untouched** — the worker cannot ask. A `nit` that turns out to need a
   behaviour change is **retagged `change` in place**. The **orchestrator**
   then asks the user, per `change`/`idea` item: **keep** (stays in the
   ledger), **drop** (the orchestrator deletes the bullet) or **spec it** (it
   becomes its own task on its own branch *after* this run — never built in
   ledger mode, whose diff must have NO behavior changes).
5. Run the tests as described below. Then report: **fixed / dropped / left**
   with the reason per left item, ending with **N nits, K changes, I ideas**
   remaining, counted as `/branch-review`'s `ledger:` line is (N = total − K − I):
   ```
   grep -c '^- ' .claude/remember/fix-ledger.md
   grep -cE '@ [0-9a-f]{7,40} · change$' .claude/remember/fix-ledger.md
   grep -cE '@ [0-9a-f]{7,40} · idea$' .claude/remember/fix-ledger.md
   ```
6. **Hand it back; do not chain it.** Say plainly: **commit, then run
   `/branch-review`** on this branch. Say it, never run it: they are two
   separate calls and both are the user's — "commit", "yes" or "go"
   authorizes the commit and nothing after it.

## Duplicates mode — `$ARGUMENTS` is `duplicates [path]`
Merges functions that do the same job. `[path]` bounds the search, else the
repo. Everything else here (constraints, verification, HITL gates) still
applies, and so do ledger mode's step 1 (tree clean, not on `main`) and
step 6 (hand back: commit, then `/branch-review` — say it, never run it).

1. **Find, no edits (worker).** Groups of functions doing the same job: same
   name stem, same signature shape, or near-identical bodies. Grep by name,
   read the bodies. Per group: every member as `file:line`, and whether the
   bodies behave identically — if not, state the difference. Hand the list
   back.
2. **Ask (orchestrator).** Show the groups; the user picks which to merge
   (AskUserQuestion). Only picked groups are edited.
3. **Per picked group, one at a time (worker).** Pick the survivor. Write a
   test pinning the current behaviour of every caller path, and see it fail
   against a deliberate break of the survivor before you trust it. Point every
   caller at the survivor, delete the rest, run the scoped tests (After the refactor, step 2).
4. **Never merge members whose behaviour differs.** Report the difference and
   leave them be.

A new duplicate introduced by a diff is `/self-review`'s `reuse:` finding, not
this mode's.

## Where to look — broad targets only
Skip this in ledger mode (the surviving bullets are the scope) and in `duplicates` mode. When `$ARGUMENTS` names a specific file or function, that is the scope;
skip this too. When it names a whole area ("the auth module", "clean this
up"), let
recent change decide where inside it to start: `git log --oneline -- <path>`
and weight the files that keep coming back. Say which files
you picked and what churn you saw.

**Do not edit yet.** After weighting by churn, list candidates — file(s) ·
what is wrong · the change proposed · strength (strong / worth exploring /
speculative) — then **stop and hand the list back**. The worker cannot ask;
the orchestrator asks the user which to do, and only picked candidates are
edited.

## Goals
- Reduce complexity
- Improve readability
- Apply DRY
- Better naming
- **Shrink the interface, not the pieces.** A caller should have to learn
  *less* after the refactor than before — fewer entry points, fewer
  parameters, fewer ordering rules and error modes to keep in mind. Push
  complexity *inward*; private helpers inside the thing are fine, they are
  not part of what a caller must learn. This targets the surface callers
  *inside the change* see — narrowing something outside callers depend on is an
  API change, which is the public-API gate below, not a free win.
- **Apply the deletion test before you create anything.** Imagine the new
  function, class, file, or wrapper already deleted. If the complexity
  reappears, spread across its callers, it earns its place — create it. If the
  complexity simply vanishes, it was a pass-through: do not create it. Run the
  same test on what is already there; a pass-through you find is a deletion,
  not a refactor target. Deleting one that callers outside this change can see
  is the same public-API gate.
- Remove needless work — the performance pass below

In ledger mode these two are a *filter on the bullet's own fix*, never a licence
to hunt: shape the change a surviving bullet asked for so it shrinks the
interface, and do not create something the deletion test rejects. A
pass-through or fat interface you spot elsewhere goes back to the orchestrator
as a new bullet, exactly like a side perf finding.

## Performance — part of every targeted refactor
When `$ARGUMENTS` names a target, look for wasted work as well as messy
work: time and space complexity, N+1 queries, I/O inside a loop, needless
allocations, the same value recomputed repeatedly.

**Ground every finding before you touch it.** A finding counts as **confirmed** only with at least one of:
- a profile, benchmark or log line showing call frequency or duration,
- the path sits on an obvious hot loop or per-request handler with real
  volume,
- the user supplied evidence in the request.

Without one of those it is **uncertain — report it, do not optimise it.**

Fix confirmed findings under the same constraints as any other refactor:
minimal change, one obvious shape, no behaviour change, no API change.
After each such edit, re-read the changed region and confirm it still
computes the same answer. Report per finding: **location** (`file:line`), **cost**
(concrete — "N+1 over ~1k rows on every page load", not "could be
faster"), **change**, **expected improvement**, **trade-off**
(readability / memory / consistency).

In ledger mode the surviving bullets are the whole scope — do not add
perf findings of your own. One you notice goes back to the orchestrator
as a new bullet, like any other side finding.

## Constraints
- **NO behavior changes**
- Keep public API intact
- Existing tests must pass

Explain each change.

## After the refactor — verify it didn't break anything

1. **Detect the project's test command** (look for `package.json`
   scripts, `pytest.ini` / `pyproject.toml`, `go.mod`, `Cargo.toml`,
   `Makefile`). If none is found, **stop and ask** before claiming the
   refactor is done — silent green isn't acceptable.
2. **Worker: run scoped tests only** — the tests for what it changed
   (`-t`, `--testPathPattern`, `pytest path/`, `go test ./pkg`) plus any
   fail-first proof this spec already requires — **never the full suite**
   (gates run it; see `DEV_RULES`).
   Run tests bare, never piped: `<test command> > /tmp/out 2>&1; echo "exit $?"` — read the code from that line, then the totals from /tmp/out.
   It does not commit. If no scope can be found, stop and hand that back.
3. **Report** pass / fail counts and any failure's name + `file:line`.

**Stop and ask** when (HITL gates — not all the time, only here):
- `$ARGUMENTS` names a whole area — the candidate list above is handed back
  before any edit.
- a test **fails** after the refactor. Don't auto-revert (destroys
  work-in-progress) and don't push forward (the no-behavior-change
  constraint is broken). Present the failure and the options:
  **revert**, **patch the refactor**, or **update the test** (with
  reasoning).
- the refactor crossed a **public API boundary** that callers depend
  on — even if tests pass, downstream consumers may break.
- the change is **bigger than the user asked for** (scope creep —
  unrelated cleanups, formatting, comment edits). Confirm before
  applying.
- a perf fix has **multiple reasonable shapes** (cache vs precompute vs
  batch vs paginate vs index) — present the options with trade-offs, not
  a chosen path.
- a perf fix trades **correctness for speed** (lossy approximation,
  weaker or eventual consistency) — even when it is "obviously" faster.
- a perf fix touches **concurrency primitives** (locks, atomics,
  ordering) — easy to introduce a race.
- a perf fix changes a **DB schema, response shape or caller contract**.

Final report:
- **refactor done** — ready, OR
- **refactor done, but K tests fail** — awaiting direction (revert /
  patch / update test).

Either way the report carries this line, filled from the run:
```
tests: <cmd> exit <code> <totals> (scoped) | NOT RUN: <reason>
```

Plus the performance pass: **confirmed-and-fixed** · **confirmed-but-asking**
(why + options) · **uncertain** (what profiling or data would settle it) ·
**none found**.
