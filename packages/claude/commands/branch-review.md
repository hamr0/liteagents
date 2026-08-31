---
name: branch-review
description: Review a branch before merge [target] [level]
usage: /branch-review [target] [low|medium|high|max]
argument-hint: [file, branch (e.g. main), range (main..HEAD), or empty] [effort level]
allowed-tools: Read, Grep, Glob, Agent, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(git grep:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(rg:*)
---
Pre-merge review gate. Two stages — **general review** then a **full security
audit** — followed by an adversarial verify pass. It **never edits code**: it
reports findings and hands them back. Fixing is a separate, separately
authorized action.

Run this **before** `/release`. `/release` will refuse to run without a review
at the current HEAD SHA.

## Guardrails
- **Spawn a worker on a mid-tier model, not hardcoded.** The review runs in a
  subagent on your tool's balanced default tier — judgment-capable, cheaper and
  faster than your top reasoning tier. **Not the cheapest/fastest tier**: on
  judgment work it measurably degrades (misclassification rates several times
  higher). Never hardcode a vendor-specific model name. Fall back to running
  inline if your tool has no subagent mechanism.
- **Escalate, never assume.** Anything you cannot decide, cannot verify, or
  that this spec does not cover → **stop and report it to the orchestrator**
  (the main session). Never improvise, never widen scope, never fix a side
  issue you noticed along the way.
- **No edits.** You have no authorization to change code, even for a finding
  you are certain about. Report it.

## Target — interpret `$ARGUMENTS` in this order
1. **Empty** → the current branch vs its merge-base with `main`
   (`git diff $(git merge-base main HEAD)..HEAD`). If that is empty, the
   staged diff; if that is empty too, the working tree.
2. **A range** like `main..HEAD` or `origin/main...HEAD` → `git diff <range>`.
3. **A single ref** (branch / tag / SHA — confirm with `git rev-parse
   --verify`) → that ref's merge-base against `HEAD`.
4. **A file or directory path** → that target.
5. Otherwise → ask.

Record the **HEAD SHA** you reviewed. `/release` checks it, and any commit
made after the review makes the review stale.

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
- **Performance.** N+1, blocking calls in hot paths, unbounded loops, indexes
  the diff actually touches.
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
Order findings most severe first.

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
- **Reviewed at HEAD `<sha>` on `<branch>`.**
- One-line verdict: **Ready to merge? Yes / No / Not until these are fixed.**
- **Escalate to the orchestrator** with the findings. It decides what gets
  fixed and by whom. Say plainly what you could not verify.
