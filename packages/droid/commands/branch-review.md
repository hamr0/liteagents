---
name: branch-review
description: Review a branch before merge [target] [level]
usage: /branch-review [target] [low|medium|high|max]
argument-hint: [file, branch (e.g. main), range (main..HEAD), or empty] [effort level]
allowed-tools: Read, Grep, Glob, Agent, Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git status *), Bash(git grep *), Bash(git rev-parse *), Bash(git merge-base *), Bash(rg *)
---
Pre-merge review gate. Two stages — **general review** then a **full security
audit** — followed by an adversarial verify pass. It **never edits code**: it
reports findings and hands them back. Fixing is a separate, separately
authorized action.

Run this **before** `/release`. `/release` will refuse to run without a review
at the current HEAD SHA.

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
- **The worker does the work itself — no delegation.** The review subagent
  must **not** spawn subagents of its own. Everything it reports has to be
  something it read, ran, or grepped with its own tool calls: a relayed "I
  executed X" from a sub-worker is hearsay, and replacing hearsay with evidence
  is the entire point of this command. A review that delegates its work is a
  review of a report. (Same rule `/security` carries inside stage 2.)
- **No edits.** You have no authorization to change code, even for a finding
  you are certain about. Report it. Re-run `git status --porcelain` before you
  report and confirm it is still empty — if it is not, say what changed. That
  turns "it never edits" from a claim into a checked fact.

## Target — check the tree first, then interpret `$ARGUMENTS`

**Before resolving anything, run `git status --porcelain`.** If it prints any
line — modified, staged, or untracked — **stop and report it**. Say all three
things, not just the first: (a) the tree is dirty, listing the uncommitted
paths; (b) `/branch-review` reviews commits, not the working tree; (c) **commit
the work to the branch, then re-run `/branch-review`.** A stop that names the
problem without the remedy invites the orchestrator to stash the changes or
hand-review the working tree instead. Do not review a subset and do not fall
back to the staged diff or the working tree. A dirty
tree is an **error**, never a silent partial review — the most expensive
failure this command can have is reviewing 800 committed lines while 200
uncommitted lines of today's actual work go unread.

This is forced by the design, not a preference: `/release`'s precondition is a
review at the current HEAD SHA, and any commit made after the review makes it
stale. **The only correct order is commit → review → release.**

With a clean tree, interpret `$ARGUMENTS` in this order:
1. **Empty** → the current branch vs its merge-base with `main`
   (`git diff $(git merge-base main HEAD)..HEAD`). If that is empty there is
   nothing committed to review — say so and stop.
2. **A range** like `main..HEAD` or `origin/main...HEAD` → `git diff <range>`.
3. **A single ref** (branch / tag / SHA — confirm with `git rev-parse
   --verify`) → that ref's merge-base against `HEAD`.
4. **A file or directory path** → that target.
5. Otherwise → ask.

Record the **HEAD SHA** you reviewed, and **report the target you resolved**
(the literal range or path) in your output, so the orchestrator can see what
was actually read rather than assuming.

## Effort level
`low | medium | high | max` — default **medium** if not given. The level
governs **stage 1 only**:
- **low / medium** — fewer findings, only ones you are confident in.
- **high / max** — broader coverage; uncertain findings are allowed, but each
  must be labelled uncertain.

**Stage 2 (security) always runs full, at every level.** A shallow security
pass is worse than none — it reads as coverage while missing the class of bug
that costs the most.

## Stage 1 — General review
The diff is the subject, but **read the whole file around every hunk** — a
hunk-only read cannot see that a caller further down the same file is now
wrong. For multi-commit ranges, skim `git log <range>` for intent before
judging.

**Commit messages are claims, not evidence.** A message saying a fix was
"proven red→green", a bug reproduced, or a test added is something to re-test,
not a fact to accept. Branches are commonly AI-authored now — including the
fixes to the fixes — so a review that trusts the message is reviewing prose.
Run the test suite and the typecheck/build yourself and cite the command and
its exit code.

- **Bugs needing a fix.** Logic errors, off-by-one, null/undefined paths,
  races, wrong defaults, broken edge cases.
- **Dead code.** Unreferenced functions / vars / imports / params, unreachable
  branches, commented-out blocks, legacy paths the diff just obsoleted.
  `git grep` the symbol before flagging — easy to be wrong.
- **Loose ends.** TODO / FIXME / XXX added by this diff, half-finished
  branches, silently swallowed errors, stub bodies, mocked-out paths,
  "temporary" names, abandoned feature flags.
- **Correctness.** Edge cases, error handling, type / contract violations,
  broken invariants.
- **State ownership.** Two or more functions assigning the same field, flag, or
  view property. A finding on its own — no failing case required. `git grep`
  every assignment to that name repo-wide, not just in the diff; the second
  writer is usually in a file the diff never touched. Name both writers with
  `file:line` — an unnamed second writer is a hunch, not a finding. Count
  ordering, not just writers: a write arriving from a callback, thread, or
  lifecycle event is the dangerous one, and one app writer racing a framework
  one still counts as two.
- **Performance.** N+1, blocking calls in hot paths, unbounded loops, indexes
  the diff actually touches.
- **Test quality, not just test presence.** For every test the diff adds or
  changes, establish that it **can actually fail**. Reasoning about
  falsifiability does not work; executing it does. **Revert the source, not the
  test:** take the pre-change version of the file under test with `git show
  <base-sha>:<path>`, run the test against that copy, and watch it go red. Do
  this **without dirtying the branch** — write the old version to a temp
  location outside the repo; the tree must still be clean at exit. A test that
  passes against both the buggy and the fixed source is a tautology and proves
  nothing. Flag every one you find, and say so explicitly when the tests are
  the branch's only evidence for its claims.
- **Maintainability.** Complexity, naming, duplication — only when material.

## Stage 2 — Security (always full)
**Delegate; do not re-implement.** Locate and **read** the installed
`security.md` and run its actual checklist — the recurring six (secrets in the
repo *and in git history*, data-access authorization / tenant isolation, rate
limiting, unhappy-path error handling, authorization beyond authentication,
inefficient data access) plus injection, auth/session, and trust boundaries.

If `security.md` cannot be found, run what you can from the list above and
**flag that the full checklist was unavailable** — never report it as passed.

This stage is repo- and history-scoped, not diff-scoped: a key committed forty
commits ago, an unbounded route the diff never touched, or a missing row
policy on a table the new code now reads are all in scope.

## Stage 3 — Verify (adversarial)
Findings are claims, not facts. **Try to break each one, not to confirm it** —
a pass that sets out to confirm reliably misses what an adversarial pass
finds.

- Re-read the cited `file:line` in full context.
- `git grep` the name across the repo before trusting any dead-code or
  unused-symbol claim.
- Mark each **confirmed**, **false positive** (with the reason), or
  **uncertain** (with what would settle it).

**Every surviving finding must carry a concrete failure scenario**: specific
inputs or state → the wrong output, crash, or exposure that results. If you
cannot write that sentence, the finding is not ready — drop it or mark it
uncertain. No vibes.

## Report — then escalate
**Open with the one-line verdict**, before any section: **Ready to merge? Yes /
No / Not until these are fixed.** A report that opens with "Critical: none
found" reads as a pass at a glance even when the verdict is not one — state the
verdict first, then repeat it at the end.

Then the findings, ordered most severe first.

### 🚨 Critical (blocks merge)
### ⚠️ Warnings (should fix)
### 💡 Suggestions (nice to have)

Each finding: **Location** (`file:line`) · **What's wrong** · **Failure
scenario** (inputs/state → result) · **Why it matters** · **Suggested fix**
(described, not applied) · **Verdict** (confirmed / uncertain).

Then a coverage line: stage 1 at level `<level>`, stage 2 full — each `ran ✓/✗`
with its evidence. A stage you did not actually run is a **✗**, never an
assumed pass.

End with:
- **Reviewed at HEAD `<sha>` on `<branch>`, target `<resolved range or path>`,
  tree clean at start and at exit.**
- One-line verdict: **Ready to merge? Yes / No / Not until these are fixed.**
- **Escalate to the orchestrator** with the findings. It decides what gets
  fixed and by whom. Say plainly what you could not verify.
