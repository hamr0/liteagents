---
type: reference
title: branch-review
status: draft
updated: 2026-09-02
---

# branch-review

`/branch-review` is the pre-merge gate. It reads a branch, runs a general review and a
full security audit against it, then tries to break its own findings before reporting
them. It is a **slash command**: `commands/branch-review.md`, no bundled script — every
check is a worker reading, running, and grepping the repo itself, the same shape as
`/security`.

**It never edits code.** Its one write is an append to a fix ledger. Fixing findings is a
separate, separately authorized action, handled by `/refactor` in ledger mode.

```
commit  ──►  /branch-review [target] [level]  ──►  fix ledger + blocking findings
                 ├─ stage 1: general review (effort-governed)
                 ├─ stage 2: security (always full)
                 └─ stage 3: verify (adversarial)
                                                          │
                                        /refactor (no args) ──► fixes, deletes bullets
                                                          │
                                                    /release Phase 0.5
```

---

## 1. What it guarantees

- **Reports, never fixes.** The command may write exactly one file —
  `.claude/remember/fix-ledger.md` — and only by appending. Everything else it finds is
  handed back as a finding. It re-runs `git status --porcelain` before reporting: empty,
  or listing exactly the ledger path, or it says what else changed. That turns "it never
  edits" from a claim into a checked fact, not an assertion.
- **The worker does its own work.** The review subagent must not spawn subagents of its
  own — everything it reports has to be something it personally read, ran, or grepped. A
  relayed "I executed X" from a sub-worker is hearsay, and replacing hearsay with evidence
  is the entire point of the command. `/security` carries the identical rule inside its
  own stage 2.
- **Escalate, never assume.** Anything the worker cannot decide, cannot verify, or that
  the spec doesn't cover goes back to the orchestrator. Never improvise, never widen
  scope, never fix a side issue noticed along the way.

---

## 2. Target resolution

**Before resolving anything, check the tree.** `git status --porcelain` must be empty. Any
modified, staged, or untracked line is a **stop**, and the stop names three things, not
just the first: the tree is dirty (with the paths), `/branch-review` reviews commits, not
the working tree, and the remedy — commit the work, then re-run. It does not fall back to
the staged diff or the working tree, and it does not review a subset. The most expensive
failure this command can have is reviewing 800 committed lines while 200 uncommitted lines
of today's actual work go unread.

With a clean tree, `$ARGUMENTS` is interpreted in order:

| Input | Resolves to |
|---|---|
| empty | current branch vs its merge-base with `main` (`git diff $(git merge-base main HEAD)..HEAD`); empty diff → say so and stop |
| a range (`main..HEAD`, `origin/main...HEAD`) | `git diff <range>` |
| a single ref (branch/tag/SHA, confirmed with `git rev-parse --verify`) | that ref's merge-base against `HEAD` |
| a file or directory path | that target |
| anything else | ask |

The worker records the **HEAD SHA** it reviewed and reports the resolved target (the
literal range or path), so the orchestrator sees what was actually read rather than
assuming.

**Why the tree must be clean first, always:** `/release`'s own precondition is a review at
the current HEAD SHA, and any commit made after the review makes it stale. **The only
correct order is commit → review → release.** A dirty tree reviewed anyway would mean the
recorded SHA can never match what actually ends up on the branch.

### Effort level
`low | medium | high | max`, default **medium**. The level governs **stage 1 only**:

- **low / medium** — fewer findings, only ones the worker is confident in.
- **high / max** — broader coverage; uncertain findings are allowed, but each must be
  labelled uncertain.

**Stage 2 (security) always runs full, at every level.** A shallow security pass is worse
than none — it reads as coverage while missing the class of bug that costs the most.

---

## 3. The three stages

### Stage 1 — General review (effort-governed)
The diff is the subject, but the worker reads the whole file around every hunk — a
hunk-only read can't see that a caller further down the same file is now wrong. For
multi-commit ranges it skims `git log <range>` for intent before judging.

**Commit messages are claims, not evidence.** A message saying a fix was "proven
red→green," a bug reproduced, or a test added is something to re-test, not accept.
Branches are commonly AI-authored now — including the fixes to the fixes — so a review
that trusts the message is reviewing prose. The worker runs the test suite and the
typecheck/build itself and cites the command and its exit code.

What it looks for: bugs needing a fix (logic errors, off-by-one, null paths, races, wrong
defaults); dead code (`git grep` the symbol before flagging — easy to be wrong); loose
ends (TODO/FIXME, half-finished branches, swallowed errors, stub bodies, abandoned feature
flags); correctness (edge cases, error handling, broken invariants); **state ownership**
(two or more functions assigning the same field/flag/view property is a finding on its
own, no failing case required — `git grep` every assignment repo-wide, not just in the
diff, since the second writer is usually in a file the diff never touched; name both
writers with `file:line`, and count a write from a callback/thread/lifecycle event as a
writer too); performance (N+1, blocking calls in hot paths, unbounded loops); test
quality; maintainability (only when material).

**Test quality is proven, not reasoned about.** For every test the diff adds or changes,
the worker establishes it can actually fail — by reverting the source, not the test: pull
the pre-change file with `git show <base-sha>:<path>` to a temp location *outside* the
repo (the tree must stay clean at exit), run the test against that old version, and watch
it go red. A test that passes against both the buggy and the fixed source is a tautology
and proves nothing; every one found is flagged, and the report says explicitly when tests
are the branch's only evidence for its own claims.

### Stage 2 — Security (always full)
`/branch-review` doesn't reimplement a checklist; it delegates. It locates and reads the
installed `security.md` and runs its actual checks — the recurring six (secrets in the
repo *and in git history*, data-access authorization / tenant isolation, rate limiting,
unhappy-path error handling, authorization beyond authentication, inefficient data access)
plus injection, auth/session, and trust boundaries. If `security.md` can't be found, it
runs what it can from that list and flags the gap — never reports the full checklist as
passed.

This stage is **repo- and history-scoped, not diff-scoped**: a key committed forty commits
ago, an unbounded route the diff never touched, or a missing row policy on a table the new
code now reads are all in scope, because a shallow scan that only reads the diff would
miss exactly the class of bug that costs the most.

`/security` also runs standalone, outside `/branch-review`; it's the same command, same
checks, same verify pass — only the report's destination differs (to the orchestrator as
a stage, to the caller when run directly).

### Stage 3 — Verify (adversarial)
Findings are claims, not facts. The worker tries to **break** each one, not confirm it — a
pass that sets out to confirm reliably misses what an adversarial pass finds.

- Re-read the cited `file:line` in full context.
- `git grep` the name across the repo before trusting any dead-code or unused-symbol claim.
- Mark each **confirmed**, **false positive** (with the reason), or **uncertain** (with
  what would settle it).

**Every surviving finding must carry a concrete failure scenario**: specific inputs or
state → the wrong output, crash, or exposure that results. If the worker can't write that
sentence, the finding isn't ready — drop it or mark it uncertain. No vibes.

---

## 4. Severity — what blocks, and what doesn't

Only **Critical** and **High** findings block the merge, and only for a **reproduced**
failure: a failing test, a broken build, a security exposure, or a bug with a written
failure scenario confirmed in stage 3.

- **Prose and style findings never block.** A finding about a spec's or doc's own
  wording, structure, or formatting is never a blocker, regardless of severity label.
- **A finding already dismissed with evidence can't come back at a higher severity
  without new evidence.** The worker checks this project's stash or memory before
  escalating something that was already grounded and rejected.
- Everything below Critical/High — medium and low — never appears in the blocking report.
  It goes straight to the fix ledger instead (§5). "Style, wording or structure" is
  the actual exemption, not "prose": where the deliverable *is* a specification, a
  normative requirement stated two incompatible ways is a reproduced defect, because
  two conforming implementations built from it diverge. The test is whether a
  behaviour changes, not whether the file holds code.

The report opens with the one-line verdict **before any section**: *Ready to merge? Yes /
No / Not until these are fixed.* A report that opens with "Critical: none found" reads as
a pass at a glance even when the verdict isn't one, so the verdict is stated up front and
repeated at the end. Each blocking finding then carries **Location** (`file:line`),
**What's wrong**, **Failure scenario**, **Why it matters**, **Suggested fix** (described,
never applied), and **Verdict** (confirmed / uncertain).

The report closes with a coverage line (stage 1 at level `<level>`, stage 2 full, stage
3 — each `ran ✓/✗` with its evidence; a stage not actually run is a ✗, never an assumed
pass), the reviewed SHA and branch and resolved target, tree-clean state, and the ledger
count.

---

## 5. The fix ledger

`.claude/remember/fix-ledger.md` — a local, persistent, cumulative, non-blocking findings
list, living beside `MEMORY.md` in `.claude/remember/`. It accumulates across review runs
and is cleared bullet-by-bullet by `/refactor` (§6). It is not necessarily tracked by
git: in a repo whose `.gitignore` excludes `.claude/` (as this one's does), the ledger is
untracked, the same as its neighbours `MEMORY.md`, `AGENT_RULES.md`, and `ledger.json` —
it persists on disk across sessions regardless of git status. Every medium/low finding
from a review run lands here as one bullet:

```
# Fix ledger
> Non-blocking review findings. One bullet per item. Delete the bullet when
> fixed, or when its anchor no longer exists. Written by /branch-review;
> consumed by /refactor (ledger mode).
>
> A bullet's path may be a glob when the same finding exists in every kit —
> `git grep -F "<snippet>" -- <path>` accepts one.

- `path/file.js` · "verbatim snippet from the line" · what's wrong · failure
  scenario · YYYY-MM-DD @ <short sha>
```

**The anchor is a path plus a verbatim snippet — 20–60 characters — never a line number or
a function name.** A line number rots the moment an unrelated edit shifts the file by one
line; a function name survives a rename or a merge, or matches the wrong overload. The
snippet is what `git grep -F` can still find after the surrounding code has moved, and —
deliberately — it does double duty: the same string that anchors the bullet is also the
**staleness test**. If `git grep -F` for it comes back empty, the finding's context is
gone and the bullet is dead weight; if it hits, the finding might still be live and is
worth a second look. One string serves both jobs instead of the ledger needing a separate
validity check.

A bullet's failure scenario is subject to stage 3 like any other finding. Ledger items
skip the report, which makes them easy to skip verifying, and an unverified consequence
written in the bullet's voice reads as established fact to whoever fixes it later — a
real field run produced exactly that, a true finding whose stated consequence was false.
Either confirm the scenario or prefix it with `UNVERIFIED:`, which tells `/refactor` to
retest before acting.

Before appending, `/branch-review` greps the ledger itself for the snippet — a duplicate
is skipped rather than appended twice. That one grep must be plain `grep -F`, never `git
grep`: `git grep` searches tracked content only, and the ledger is normally gitignored, so
it would answer "not found" for a snippet that is present and the dedupe would silently
pass on every run. The anchor lookups against source files above are `git grep`, correctly
— those files are tracked. Same flag, two different targets, only one of them in git.

### One writer per operation
`/branch-review` **only appends** to the ledger; it never rewrites or deletes an existing
bullet. `/refactor` in ledger mode **only deletes** — it revalidates and removes bullets as
their fixes land or their anchors go stale, but it never adds one. Each command has
exactly one write shape on this file. That split matters because it makes the ledger
readable as a log: an append is always new evidence from a review, a deletion is always a
closed or invalidated item, and neither command can silently second-guess what the other
recorded. If both could edit freely, a bug in either command could corrupt the other's
half of the record with no way to tell which write did it.

---

## 6. `/refactor` with no arguments — ledger mode

Bare `/refactor` (no code-section argument) works through the ledger instead of taking a
target from the user:

1. **Tree must be clean and not on `main`.** A dirty tree stops with what's uncommitted;
   on `main` it switches to `chore/fix-ledger`.
2. **Ledger missing or has zero bullets** → say so and stop. Nothing to do.
3. **Revalidate every bullet first, fix nothing yet.** For each: `git grep -F "<snippet>"
   -- <path>`. No hit → delete the bullet, list it as "cleaned by other work" (the anchor
   is gone, so whatever it pointed at no longer exists in that shape). A hit → re-read the
   surrounding code; if the finding no longer holds, delete it with a one-line reason.
   What survives this pass is the actual work list.
4. **Fix the survivors, one bullet per change**, under `/refactor`'s ordinary constraints
   (no behavior changes, public API intact, existing tests pass). **Delete each bullet as
   its fix lands** — the fix commit becomes the done record for that bullet; there's no
   separate "mark complete" step to forget.
5. Run the tests, then report fixed / dropped / left, with the reason per left item, and
   the remaining bullet count.
6. Say plainly: commit, then run `/branch-review` on this branch — ledger mode is a fixer,
   not a review, and its own diff gets the ordinary gate like any other change.

---

## 7. The nudge, not the invocation

`/branch-review` ends its report with the open bullet count, and when it's greater than
zero: *"N fixes waiting — run `/refactor` between features."* **It never invokes
`/refactor` itself.** This deliberately mirrors `/stash`, which counts the unprocessed
backlog and nudges `/remember` rather than running it.

The separation exists for the same reason in both places: fixing (like consolidating) is
its own unit of work with its own review gate — `/refactor`'s diff, once it lands, gets
reviewed like any other change. Auto-chaining review straight into a fixer would collapse
"report a finding" and "apply a fix" into one uninterruptible action, removing the human
decision point about whether, when, and how to fix. A command that only reports stays
composable with whatever the orchestrator decides to do next; a command that also acts
on its own report isn't.

---

## 8. Convergence — re-review without re-judging the whole branch

**Re-review after fixes passes the range `<previously-reviewed-sha>..HEAD`.** Stage 1 then
reads only the fix commits; stage 3 re-verifies the prior report's blockers (fixed /
unfixed / dismissed, with reason); the rest of the branch is **not** re-judged. The range
form still ends at HEAD, so `/release`'s precondition is still satisfied.

**The problem this solves:** a full re-read of an already-reviewed branch produces a fresh
nit list every single run — different findings, or the same findings under new phrasing —
because a review at this level of judgment is not perfectly deterministic. If `/release`'s
gate required "zero findings on a full re-review," and every full re-review manufactures
new low-severity nits, the branch would never converge: HEAD keeps moving (each round of
fixes is itself a commit), and each new HEAD invites another full read that finds
something new to flag. Scoping re-review to just the delta since the last reviewed SHA
means the parts of the branch that were already read and judged aren't read and judged
again — only the actual fix commits are, plus a check that the previously-raised blockers
are actually gone. That's what lets the loop terminate instead of running forever.

---

## 9. How `/release` Phase 0.5 fits

`/release` refuses to run past its own Phase 0.5 without a review at the *current* HEAD
SHA. It does not ask the orchestrator whether a review happened — asking puts the question
to the one party with an incentive to say yes. Instead it runs `git rev-parse HEAD` and
compares that string, mechanically, against the `sha:` line in
`.claude/remember/last-review.md`, the five-line record `/branch-review` overwrites at the
end of every run. That record exists because a SHA quoted in a chat message is the same
claim in another costume: it does not survive a compaction or a handover, and what remains
is the orchestrator's word, which this gate exists precisely not to take.
**The SHA comparison is the gate** — it is what
makes "this branch was reviewed" a checked fact instead of a claim, independent of
whatever state the ledger file happens to be in.

- **No record file, or no `sha:` line in it** → no review, full stop: *"No review at
  `<sha>`. Run `/branch-review medium` (or `/code-review medium`) first."*
- **Recorded SHA ≠ current HEAD** (commits landed after the review, including fix
  commits) → **stale**, stop and ask for a re-review.
- **The fix ledger is not an exception.** Where `.claude/` is gitignored (as here), an
  append never reaches a commit, HEAD does not move, and the recorded SHA still matches —
  so the question never arises. A repo that tracks `.claude/` instead will see a ledger
  commit land after the review and make it stale. That is the gate working as designed,
  not a case to special-case: re-review, or leave the ledger uncommitted until the
  release is cut. One rule, no branches in it.
- **Reviewed at this SHA with findings still outstanding** → stop; findings are resolved
  before a release is cut.

This is the only thing guaranteeing the branch was reviewed *and* security-scanned before
release, so a missing answer is always treated as a stop, never as a pass.

---

## 10. Worked example — two features through the full loop

**Feature A lands.**
1. Work is committed to `feat/a`. `/branch-review` runs with a clean tree, resolves the
   empty-argument target to `main..HEAD`, and records `HEAD abc123`.
2. Stage 1 finds one High (a null path with a written failure scenario) and three
   low-severity nits. Stage 2 runs full and comes back clean. Stage 3 confirms the High
   and drops one of the three nits as a false positive.
3. Report: **Ready to merge? Not until these are fixed** — the High blocks. The two
   surviving low findings are appended to `fix-ledger.md`. Ledger: 2 open, 2 added.
4. The High is fixed by hand (or by a targeted `/refactor <file>`), committed, and
   `/branch-review abc123..HEAD` re-reviews just that fix commit. Stage 3 confirms the
   prior High is now fixed. Recorded SHA moves to `def456`.
5. `/release` runs. Phase 0.5 compares `def456` to `HEAD` — match — and finds no findings
   outstanding at that SHA. It proceeds through `/ship`, docs, version bump, and stops with
   the push/PR/merge/tag/publish sequence for a human to authorize.

**Feature B lands later, on top of the merged A.**
1. `feat/b` is committed. `/branch-review` (empty target) resolves against the new
   merge-base and reviews only B's diff — A's history isn't re-read, because it was
   already reviewed and merged.
2. Stage 1 finds nothing blocking, but two more low-severity findings. Ledger now has
   2 (carried, unrelated to A or B) + 2 new = 4 open. Report ends: *"4 fixes waiting — run
   `/refactor` between features."*
3. Before starting a third feature, `/refactor` (no arguments) runs: tree is clean, not on
   main, so it switches to `chore/fix-ledger`. It revalidates all 4 bullets — one anchor no
   longer greps (cleaned by an unrelated change), one no longer holds on re-read, two
   survive and get fixed one at a time, each deleting its own bullet as it lands.
4. The fix commit is reported (2 fixed, 2 dropped, 0 left), then `/branch-review` reviews
   the `chore/fix-ledger` branch like any ordinary change before it merges.

---

## Sources

`packages/claude/commands/branch-review.md` (the command spec — target resolution, the
three stages, severity rules, ledger format, report shape), `packages/claude/commands/
refactor.md` (ledger mode), `packages/claude/commands/release.md` (Phase 0.5, the
SHA gate), `packages/claude/commands/security.md` (stage 2 delegation),
`packages/claude/commands/stash.md` (the nudge pattern `/branch-review`'s own nudge
mirrors).
