---
description: Review a branch before merge [target] [level]
argument-hint: [file, branch (e.g. main), range (main..HEAD), or empty] [effort level]
---
Pre-merge review gate. Two stages — **general review** then a **full security
audit** — followed by an adversarial verify pass. It **never edits code**: it
reports findings and hands them back. Fixing is a separate, separately
authorized action.

Only **Critical** and **High** findings block the merge. Everything else is
appended to the **fix ledger** (`.factory/remember/fix-ledger.md`) — a local,
cumulative list, living beside `MEMORY.md`, that `/refactor` (no arguments)
works through between features. Like its neighbours it is a private working
artifact, usually gitignored; it persists across reviews, it is not a
deliverable. The report is blockers plus the ledger count, so a review
converges instead of surfacing fresh nits every run. This command never runs
`/refactor` itself — it nudges, the way `/stash` nudges `/remember`.

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
- **No edits — two exceptions.** You have no authorization to change code,
  even for a finding you are certain about. Report it. The only files you may
  write are `.factory/remember/fix-ledger.md` (append bullets; never rewrite or
  delete) and `.factory/remember/last-review.md` (overwrite; the review record
  described at the end of this file).
- **Prove it with two checks, because neither sees what the other does.**
  `git status --porcelain`, at start and again before you report, proves no
  **tracked** file changed — that is the "never edits code" guarantee, and it
  is the one that matters. It cannot police your own two writes: `.factory/`
  is normally gitignored, so porcelain stays empty whether you wrote the
  allowed files, wrote nothing, or overwrote `MEMORY.md`. `git status
  --ignored` does not close it either — it collapses to `!! .factory/`, the
  directory, not the files. So also take `md5sum .factory/remember/*` before
  you start and again before you report, and show the comparison: only
  `fix-ledger.md` and `last-review.md` may differ.

## Target — check the tree first, then interpret `$ARGUMENTS`

**The orchestrator runs this check before spawning anyone**, so a dirty tree
costs no worker; the worker then re-runs it as its own first act, because a
review that takes the tree's state on trust is the thing this command exists
not to do. Both, not either.

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

**Re-review after fixes: read `.factory/remember/last-review.md` first.** Its
`sha:` line is the previously-reviewed commit and its `blockers:` list is what
you owe an answer on — take both from the file, never from the orchestrator's
recollection, for the same reason `/release` does. Then:

- **First, check the record belongs to this branch.** There is one record file
  per repo, not one per branch. Validate `<that sha>` first with
  `git rev-parse --verify <that sha>` — a value that fails this (e.g. a
  corrupted or hand-edited record, or one starting with `-`, which git would
  otherwise parse as an option) is a malformed record; treat it exactly as
  **No file** below. If it validates, and its `branch:` line differs from the
  current branch, or `git merge-base --is-ancestor <that sha> HEAD` exits
  non-zero, the record describes a different or rewritten history — treat it
  exactly as **No file** below and review the whole branch. Skipping this
  resolves `<that sha>..HEAD` against a merged, renamed, or rebased sha, which
  is not a subset of this branch but a range that never existed. Check both:
  the branch name catches a switch, the ancestry check catches a rebase or
  squash under the same name. Otherwise:

- **`sha:` ≠ HEAD** → this is a re-review. Target the range
  `<that sha>..HEAD`. Stage 1 reads only the commits since, and stage 3
  re-verifies each recorded blocker as fixed, unfixed, or dismissed with a
  reason. The rest of the branch is **not** re-judged: a full re-read of an
  already-reviewed branch produces fresh findings every run and never
  converges. The range still ends at HEAD, so `/release`'s precondition is
  satisfied and the new record replaces the old one.
- **`sha:` = HEAD** → nothing has changed since the last review. Say so and
  stop; re-running against an identical tree can only produce noise. If the
  recorded verdict was `blocked`, its blockers are still unfixed by
  definition — repeat them rather than re-deriving them.
- **No file** → no prior review to build on. Review the whole branch.

**On a re-review, sweep the open ledger bullets for liveness first.** Their
anchors may sit in the part of the branch you are no longer reading, and the
fix commits you *are* reading can invalidate them. `grep -F` each open
snippet against its path; report any whose anchor is gone so `/refactor` can
drop them. Cheap, and it stops dead bullets accumulating unseen.

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
its exit code. Read that code off the bare command (`cmd > /tmp/out 2>&1;
e=$?`), never off a pipeline — `$?` after a pipe is the last element's
status, so piping into `tail` reports `0` for a suite that failed. `/ship`
carries the reproduction.

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

### 🚨 Critical / High (blocks merge)
A **reproduced** failure only: a failing test, a broken build, a security
exposure, or a bug with a written failure scenario you confirmed in stage 3.
A finding about **style, wording or structure** is **never** a blocker —
including in a doc or spec. But prose is not automatically harmless: in a repo
whose deliverable *is* a specification, a **normative requirement stated two
incompatible ways** is a reproduced defect, because two conforming
implementations built from it diverge. Judge by whether a behaviour changes,
not by whether the file holds code — and judge it **per finding, not per
repo**, since a diff mixing code and specification is the normal case. A finding already dismissed with evidence in this project's stash
or memory cannot come back at a higher severity without **new** evidence —
check before escalating.

### Ledger (non-blocking — medium / low)
Not in the report. **Append** each one as a single bullet to
`.factory/remember/fix-ledger.md` (create the file with the header below if
missing):

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

**A ledger bullet's failure scenario is subject to stage 3 like any other.**
Ledger items skip the report, so they are easy to skip verifying too, and an
unverified consequence written in the bullet's voice reads as established
fact to whoever fixes it later. Either confirm it, or prefix the scenario
with `UNVERIFIED:` so `/refactor` retests before acting.

The **snippet is the anchor**: 20–60 verbatim characters from the line,
unique enough for `git grep -F` to find it after lines shift. No line
numbers, no TODO comments in code — the ledger is the single writer. Before
appending, dedupe with **plain `grep -F "<snippet>" .factory/remember/fix-ledger.md`**;
if it is already there, skip it. Do not touch existing bullets.

**A bullet you disprove is deleted, not annotated.** If you establish that an
existing bullet's finding no longer holds — or never did — remove the line and
say why in your report. The ledger is a work list, not an archive: an
annotated bullet still reads as work, and a bullet arguing with itself is
worse than none. Deleting on disproof is the one case where a reviewer may
remove a line, and it is the same judgement `/refactor` makes at
revalidation. Use plain
`grep`, never `git grep`, on the ledger: the ledger is normally gitignored,
and `git grep` searches tracked content only, so it reports "not found" for a
snippet that is sitting right there — the dedupe would pass every time and
the same finding would be appended on every run.

Each blocking finding: **Location** (`file:line`) · **What's wrong** ·
**Failure scenario** (inputs/state → result) · **Why it matters** ·
**Suggested fix** (described, not applied) · **Verdict** (confirmed /
uncertain).

Then a coverage line: stage 1 at level `<level>`, stage 2 full, stage 3 —
each `ran ✓/✗` with its evidence. A stage you did not actually run is a **✗**, never an
assumed pass.

**Write the review record** to `.factory/remember/last-review.md`, overwriting
it. `/release` reads this file; a SHA that lives only in a chat message is
gone after a compaction or a handover, and the only remaining source is the
orchestrator — the one party this command already refuses to take a review's
word from. **Write it at the end of every run, unconditionally** — not after
someone decides what to do about it. The information exists now, and the file
earns its keep only by surviving a compaction, an abandoned session, or a
handover to someone who never saw the report.

```
sha: <full HEAD sha>
branch: <branch>
target: <resolved range or path>
level: <low | medium | high | max>
verdict: <ready | blocked>
date: <YYYY-MM-DD>
coverage: stage1 <ran|NOT RUN>, stage2 <ran|NOT RUN>, stage3 <ran|NOT RUN>
blockers:
- <file:line> · <one-sentence claim, no scenario, no suggested fix>
```

`blockers: none` when the verdict is ready. One line per blocker and nothing
more: the reasoning belongs in the report, and the non-blocking findings
belong in the ledger. This exists so a session that never saw the report can
learn *what* is blocked, not just *that* something is — otherwise the next
run rediscovers it by re-reviewing the branch, which is the
non-convergence this command exists to stop.

`coverage` is recorded because a `ready` from a run whose security stage did
not execute is not the same fact as one where it did, and the reader of this
file cannot tell them apart otherwise.

**There is no override field, and no `verdict: overridden`.** A SHA is
checkable by anyone; consent is not, so a consent line in a file is forgeable
by whatever writes the file — and a persisted override is reusable, silently
covering the next release as well as this one. Releasing over a blocked
review is a live decision made at `/release`'s hand-back, in conversation.

**Nothing clears this file.** It is overwritten whole on the next run, and the
`sha:` line is what expires it: fix something, commit, and the recorded hash
no longer matches HEAD, so the gate reports *stale* and asks for a
re-review rather than *blocked*. A blocked verdict can only persist while HEAD
does not move — which means nothing was fixed, which is the correct outcome.

End with:
- **Reviewed at HEAD `<sha>` on `<branch>`, target `<resolved range or path>`,
  tree clean at start; at exit clean or the two `.factory/remember/` paths
  only.**
- **Fix ledger: N open, M added this run** (N = bullet count). When N > 0,
  add: "N fixes waiting — run `/refactor` between features." The ledger is a
  local artifact; in the usual case it is gitignored, so writing it moves
  nothing and leaves HEAD untouched.
- One-line verdict: **Ready to merge? Yes / No / Not until these are fixed.**
- **A run that produces no record is not a review.** If you die mid-flight —
  a rate limit, a crash, a cancelled turn — there is no report and no
  `last-review.md`, and silence must never be read as a pass. `/release`
  already treats a missing record as no review; state it here too so nobody
  fills the gap from memory of a run that never finished.
- **Escalate to the orchestrator** with the findings. It decides what gets
  fixed and by whom. Say plainly what you could not verify.
