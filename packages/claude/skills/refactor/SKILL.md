---
name: refactor
description: Refactor and optimize [code]
argument-hint: [file-or-function, or empty for the fix ledger]
allowed-tools: Read, Edit, Grep, Glob, Bash(npm test:*), Bash(npx jest:*), Bash(npx vitest:*), Bash(pnpm test:*), Bash(yarn test:*), Bash(pytest:*), Bash(python:*), Bash(go test:*), Bash(cargo test:*), Bash(make test:*), Bash(git diff:*), Bash(git grep:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git switch:*)
disable-model-invocation: true
---
Refactor $ARGUMENTS. A targeted refactor includes the performance pass
below — it is on by default, not a separate command.

## Guardrails
- **Spawn a worker and explicitly select your tool's mid tier.** State the
  tier on the spawn — do not omit it and rely on a default. An omitted tier
  inherits the *parent's* tier, which is not the same thing as the balanced
  one. Pick the judgment-capable tier that is cheaper and faster than your top
  reasoning tier. **Not the cheapest/fastest tier**: on judgment work it
  measurably degrades (misclassification rates several times higher). Choose by
  tier, not by a vendor model name copied from this file — names drift, and
  this command ships to several tools. Fall back to running inline if your tool
  has no subagent mechanism.
- **Escalate, never assume.** Anything you cannot decide, cannot verify, or
  that this spec does not cover → **stop and report it to the orchestrator**
  (the main session). Never improvise, never widen scope, never fix a side
  issue you noticed along the way.
- **The worker does the work itself — no delegation.** The fixer must **not**
  spawn subagents of its own. Every edit it reports, and every test run it
  cites, has to be one it made or ran with its own tool calls: a relayed "I
  fixed it and the suite is green" from a sub-worker is hearsay, and this
  command's whole output is the claim that a change landed and the tests still
  pass. A fix that delegates its work is a report about a report.
- **The HITL gates below belong to the orchestrator, not the worker.** A
  subagent cannot hold a conversation with the user, so it cannot run a gate
  that ends in *stop and ask*. When one trips — a failing test, a crossed
  public API boundary, a change bigger than the bullet asked for — the worker
  **stops there and hands the situation back**, with the options and its
  reasoning but no choice made. The orchestrator asks. A worker that picks
  revert / patch / update-test on the user's behalf has answered a question it
  was never allowed to ask.
- **Edit only what a surviving bullet names.** Ledger mode's scope is the
  bullets that survive revalidation, one change per bullet — not the
  neighbouring code, not the formatting, not a second finding noticed on the
  way past. Anything else goes back to the orchestrator to become a new
  bullet.
- **Prove the blast radius with two checks, because neither sees what the
  other does.** `git status --porcelain` at exit must list only files a
  surviving bullet named — that is this command's scope guarantee, and unlike
  `/branch-review` it is not expected to be empty. It cannot police the
  memory directory: `.claude/` is normally gitignored, so porcelain stays
  empty whether you deleted a fixed bullet, wrote nothing, or overwrote
  `MEMORY.md`. So also take `md5sum .claude/remember/*` before you start and
  again before you report, and show the comparison: only `fix-ledger.md` may
  differ. `last-review.md` in particular is `/branch-review`'s to write —
  a fixer that touches it forges the gate that judges its own work.

## Ledger mode — `$ARGUMENTS` empty
Work through `.claude/remember/fix-ledger.md`, the non-blocking findings
`/branch-review` has accumulated. Everything below (goals, constraints,
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
4. **Fix the survivors, one bullet per change**, under the constraints below.
   Delete each bullet as its fix lands. A fix that turns out to need a
   behaviour change is not a refactor — leave the bullet, note it in the report.
5. Run the tests as described below. Then report: **fixed / dropped / left**
   with the reason per left item, and the remaining bullet count.
6. **Hand it back; do not chain it.** Say plainly: **commit, then run
   `/branch-review`** on this branch — ledger mode is a fixer, not a review,
   and its diff gets the ordinary gate. That is a sentence you *say*, not a
   sequence you *run*. They are two separate calls and both are the user's:
   an answer of "commit", "yes" or "go" authorizes the commit and nothing
   after it. Never start `/branch-review` off the back of it. Observed in the
   field: a run chained the review onto the owner's "commit" and the owner
   objected.

## Goals
- Reduce complexity
- Improve readability
- Apply DRY
- Better naming
- Smaller functions (single responsibility)
- Remove needless work — the performance pass below

## Performance — part of every targeted refactor
When `$ARGUMENTS` names a target, look for wasted work as well as messy
work: time and space complexity, N+1 queries, I/O inside a loop, needless
allocations, the same value recomputed repeatedly.

**Ground every finding before you touch it.** Performance claims are easy
to invent. A finding counts as **confirmed** only with at least one of:
- a profile, benchmark or log line showing call frequency or duration,
- the path sits on an obvious hot loop or per-request handler with real
  volume,
- the user supplied evidence in the request.

Without one of those it is **uncertain — report it, do not optimise it.**
Speculative optimisation is scope creep with a stopwatch.

Fix confirmed findings under the same constraints as any other refactor:
minimal change, one obvious shape, no behaviour change, no API change.
After each such edit, re-read the changed region and confirm it still
computes the same answer — a perf change that quietly alters semantics is
the worst kind. Report per finding: **location** (`file:line`), **cost**
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

"Existing tests must pass" is the load-bearing constraint, and the only
honest way to know is to run them.

1. **Detect the project's test command** (look for `package.json`
   scripts, `pytest.ini` / `pyproject.toml`, `go.mod`, `Cargo.toml`,
   `Makefile`). If none is found, **stop and ask** before claiming the
   refactor is done — silent green isn't acceptable.
2. **Run the tests.** Scope to the affected area when possible (`-t`,
   `--testPathPattern`, `pytest path/`, `go test ./pkg`); otherwise run
   the suite.
3. **Report** pass / fail counts and any failure's name + `file:line`.

**Stop and ask** when (HITL gates — not all the time, only here):
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
- **refactor done, tests N pass / 0 fail** — ready, OR
- **refactor done, but K tests fail** — awaiting direction (revert /
  patch / update test).

Plus the performance pass: **confirmed-and-fixed** · **confirmed-but-asking**
(why + options) · **uncertain** (what profiling or data would settle it) ·
**none found**.
