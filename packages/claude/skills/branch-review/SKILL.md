---
name: branch-review
description: Review a branch before merge [target] [level]
argument-hint: [file, branch (e.g. main), range (main..HEAD), or empty] [effort level]
allowed-tools: Read, Grep, Glob, Agent, Edit, Write, Bash(git add:*), Bash(git commit:*), Bash(git diff:*), Bash(git fetch:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(git grep:*), Bash(git rev-list:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(rg:*)
disable-model-invocation: true
---
Pre-merge review gate. **General review**, then a **full security audit**,
then an adversarial verify pass, then a **docs sweep**. It **never edits
code**: findings are reported and handed back, and fixing is a separate,
separately authorized action. The docs sweep is the one stage that writes,
and only to docs — it updates the project's docs for what this branch
changed and commits exactly that.

Only **Critical** and **High** findings block the merge. Everything else is
appended to the **fix ledger** (`.claude/remember/fix-ledger.md`) — a local,
cumulative list, living beside `MEMORY.md`, that `/refactor` (no arguments)
works through between features. Like its neighbours it is a private working
artifact, usually gitignored; it persists across reviews, it is not a
deliverable. The report is blockers plus the ledger count, so a review
converges instead of surfacing fresh nits every run. This command never runs
`/refactor` itself — it nudges, the way `/stash` nudges `/remember`.

Run this **before** `/release`. `/release` will refuse to run without a review
at the current HEAD SHA.

## Guardrails
- **Spawn a worker, mid tier stated explicitly** (omitted inherits the
  parent's, not the balanced one; not cheapest/fastest either — judgment
  degrades there; never a vendor model name), and hand it this file's path — a
  worker has no skill text of its own. Fall back to running inline if your
  tool has no subagent mechanism.
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
- **No edits — three exceptions.** You have no authorization to change code,
  even for a finding you are certain about. Report it. The only files you may
  write are `.claude/remember/fix-ledger.md` (append bullets; never rewrite or
  delete), `.claude/remember/last-review.md` (overwrite; the review record
  described at the end of this file), and the doc files Stage 4 touches —
  edited and then committed by that stage alone, never for code, skills,
  config, or tests.
- **Prove it with two checks, because neither sees what the other does.**
  `git status --porcelain`, at start and again before you report, proves the
  tree is clean — no code or config changed, and, when Stage 4 ran (review
  settled), that its doc edits landed as the last act before you report. It
  cannot police your own two `.claude/` writes:
  `.claude/` is normally gitignored, so porcelain stays empty whether you
  wrote the allowed files, wrote nothing, or overwrote `MEMORY.md`. `git
  status --ignored` does not close it either — it collapses to `!!
  .claude/`, the directory, not the files. So also hash the files there before
  you start and again before you report:
  ```
  find .claude/remember -maxdepth 1 -type f -exec md5sum {} + | sort -k2
  ```
  and show the comparison: only `fix-ledger.md` and `last-review.md` may differ. And
  run `git diff --name-only <reviewed sha>..HEAD` before you report: it must
  list only the files on the record's `docs:` line — anything else means an
  edit escaped Stage 4's scope.

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

**Then check the branch is not behind `main`.** Run `git fetch origin`, then
`git merge-base --is-ancestor origin/main HEAD`. Non-zero → **stop** and say
all three things: (a) the branch is behind `origin/main` by N commits
(`git rev-list --count HEAD..origin/main`); (b) reviewing now is wasted,
because syncing afterwards makes the review stale; (c) merge `origin/main`
into the branch (or rebase), then re-run `/branch-review`. A never-pushed
branch passes; no `origin` remote or no `origin/main` → skip the check and say
so. The orchestrator runs it before spawning, the worker re-runs it.

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

**Re-review after fixes: read `.claude/remember/last-review.md` first.** Its
`sha:` line (never `self-review-sha:`) is the previously-reviewed commit, its
`blockers:` list what you owe an answer on — take both from the file, never
the orchestrator's recollection, for the same reason `/release` does. Then:

- **First, check the record belongs to this branch.** There is one record
  file per repo, not one per branch. No `sha:` line at all (e.g. a file
  holding only `self-review-sha:`) is the same as **No file** below. Otherwise
  validate `<that sha>` with `git rev-parse --verify <that sha>` — a value
  that fails this (e.g. a corrupted or hand-edited record, or one starting
  with `-`, which git would otherwise parse as an option) is a malformed
  record; treat it exactly as **No file** below. If it validates, and its
  `branch:` line differs from the current branch, or
  `git merge-base --is-ancestor <that sha> HEAD` exits non-zero, the record
  describes a different or rewritten history — treat it exactly as **No
  file** below and review the whole branch. Skipping this resolves
  `<that sha>..HEAD` against a merged, renamed, or rebased sha, which is not
  a subset of this branch but a range that never existed. Check both: the
  branch name catches a switch, the ancestry check catches a rebase or
  squash under the same name. Otherwise:

- **`sha:` ≠ HEAD, but forgiven** (docs/, root `*.md`, or `docs:` —
  `/release` Phase 0.5's rule):
  `git diff --name-only <that sha>..HEAD | grep -vE '^(docs/|[^/]+\.md$)'`
  — every path must also be on `docs:`, else fall through, else `sha:`=HEAD.
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
  definition — repeat them rather than re-deriving them. **Write no record**:
  the existing one stands.
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

**No shortcuts.** The level decides how many findings you report, never which
checks you run. Every check this file calls required runs at every level —
never cut or sample one "given the effort level", the branch size, or time. If
a check truly cannot run, write `NOT RUN: <reason>` for it on the `checks:`
line of the report and the review record. That is a visible gap, not a
blocker and not a pass.

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
status, so piping into `tail` reports `0` for a suite that failed. A suite that
can outlast your tool's default command timeout needs a longer timeout (or a
background run waited on to exit); a timed-out run is not a pass, and cite the
suite's totals with the exit code. The result
goes on the record's `tests:` line — the build part is required (`build N/A: <reason>`
if none).

- **Bugs needing a fix.** Logic errors, off-by-one, null/undefined paths,
  races, wrong defaults, broken edge cases.
- **Loose ends.** TODO / FIXME / XXX added by this diff, half-finished
  branches, silently swallowed errors, stub bodies, mocked-out paths,
  "temporary" names, abandoned feature flags, commented-out blocks, debug
  leftovers (stray `console.log` / `print` / `debugger` / `dbg!`).
- **Correctness.** Edge cases, error handling, type / contract violations,
  broken invariants.
- **Test quality, not just test presence.** For every test the diff adds or
  changes, establish that it **can actually fail**. Reasoning about
  falsifiability does not work; executing it does. **Revert the source, not the
  test:** take the pre-change version of the file under test with `git show
  <base-sha>:<path>`, run the test against that copy, and watch it go red. Do
  this **without dirtying the branch** — write the old version to a temp
  location outside the repo; the tree must still be clean at exit. A test that
  passes against both the buggy and the fixed source is a tautology and proves
  nothing. Flag every one you find, and say so explicitly when the tests are
  the branch's only evidence for its claims. **Required, every test file the
  diff adds or changes — one red run per file is enough; checking a sample of
  the files is a skip.** Count them as `fail-first N/M files` on the
  `checks:` line. M is every test file the diff adds or changes, no exclusions;
  a file that cannot go red (e.g. comment-only) still counts in M, named with
  its reason — `12/15`, never `12/12`. Say whether each red was a failed
  assertion or the test failing to load against the old source (missing
  import/export), which is weaker proof.

Structure (dead code, state ownership, naming, duplication, performance) is
not this stage's job — `/self-review` surfaces it.

## Stage 2 — Security (always full)
**Delegate; do not re-implement.** Locate and **read** the installed
`security` spec (`security/SKILL.md` or `security.md`, whichever the tool
ships) and run its actual checklist: every numbered item of its recurring
six and every bullet under "Also scan for" — that spec is the only list.
Fallback, spec missing only: every `s2` line of the record reads `NOT RUN:
security spec unavailable`, so `coverage:` says `stage2 NOT RUN` — **flag that
the full checklist was unavailable**, never report it as passed.

This stage is repo- and history-scoped, not diff-scoped: a key committed forty
commits ago, an unbounded route the diff never touched, or a missing row
policy on a table the new code now reads are all in scope. **The review range
never narrows this stage** — even when you were handed `main..HEAD`, the
secrets scan covers every commit on every branch (the security spec's item 1
has the command).

## Stage 3 — Verify (adversarial)
Findings are claims, not facts. **Try to break each one, not to confirm it** —
a pass that sets out to confirm reliably misses what an adversarial pass
finds.

- Re-read the cited `file:line` in full context.
- Mark each **confirmed**, **false positive** (with the reason), or
  **uncertain** (with what would settle it).

**Every surviving finding must carry a concrete failure scenario**: specific
inputs or state → the wrong output, crash, or exposure that results. If you
cannot write that sentence, the finding is not ready — drop it or mark it
uncertain. No vibes.

## Stage 4 — Docs sweep (settled reviews only, whole branch)
Runs **once, at the end**, only when **settled** (`ready`, or every open
blocker pushed-through by name — never assumed, never changes `blocked`).
Else **unsettled**, deferred — always the whole branch, not `<recorded sha>..HEAD`.

1. **List the changes.** Read the commit bodies (not just subjects) and the
   diff, plus the newest one or two notes in `.claude/stash/`, for every
   user-visible change — feature, command, flag, behaviour, fix, dependency
   bump.
2. **Place each change in the docs.** For every change from step 1, find
   where the project's guide/context doc — and the PRD, README, `.env.example`, or
   findings/learnings doc when the change touches them — describes it now.
   Check every place the topic comes up, not just the first. "This branch
   already edited that doc" is not checked. Nothing describes it → add it.
   Something says otherwise, including text written earlier on this branch →
   fix it.
3. **Not this stage's job:** the CHANGELOG. `/release` writes that entry,
   with the version. If this stage corrects a line that a fix-ledger bullet
   also names, that is ordinary sweep work — the doc changed with the
   feature, so it was already yours to update — but **do not delete the
   bullet**. Only `/refactor` (revalidation, or the user's "drop") and `/self-review`
   (a removal the user names) delete bullets; revalidation drops this one once
   the finding no longer holds.
4. **Commit what you touched.** Doc files only — never code, skills, config,
   or tests. Stage the exact paths you edited by name (never `git add
   -A`/`-u`) and commit `docs: sweep for <short sha range>`. Nothing changed
   → no commit. **On `main`/`master` → make no edits at all**; report what the
   sweep would change instead of writing it, so the tree stays clean. This is
   the last act before you write the review record.

Report one row per change: change · doc `file:line` · added / fixed / already
correct.

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
`.claude/remember/fix-ledger.md` (header below if missing), tagged `nit` or
`change` (never `idea` — that is `/self-review`'s) — fix size, not severity, most `nit`; pushed-through blockers too (Stage 4).

```
# Fix ledger
> Non-blocking review findings. One bullet per item. Delete the bullet when
> fixed, or when its anchor no longer exists — only /refactor (revalidation,
> or the user's "drop") and /self-review (a removal the user names) delete.
> Written by /branch-review and /self-review; consumed by /refactor (ledger mode).
>
> A bullet's path may be a glob when the same finding exists in every kit —
> `git grep -F "<snippet>" -- <path>` accepts one. Trailing tag = fix size,
> not severity; untagged counts as `nit`; tail unwrapped on the last line.
> `nit` = small fix, no behaviour change. `change` = something that exists is
> wrong; needs a behaviour fix or redesign. `idea` = something missing that
> might be worth building; an option, not debt.
> Always appended at the end. A /self-review Structure item puts the rule it
> breaks in the failure-scenario slot.

- `path/file.js` · "verbatim snippet from the line" · what's wrong · failure
  scenario · YYYY-MM-DD @ <short sha> · nit
```

**A ledger bullet's failure scenario is subject to stage 3 like any other.**
Ledger items skip the report, so an unverified consequence in the bullet's
voice reads as fact to whoever fixes it later. Either confirm it, or prefix
the scenario with `UNVERIFIED:` so `/refactor` retests before acting.

The **snippet is the anchor**: 20–60 verbatim characters from the line,
unique enough for `git grep -F` to find it after lines shift. No line
numbers, no TODO comments in code — the ledger is the single writer. Before
appending, dedupe with **plain `grep -F "<snippet>" .claude/remember/fix-ledger.md`**;
if it is already there, skip it. Do not touch existing bullets.

**A bullet you disprove is deleted, not annotated** — if an existing bullet's
finding no longer holds, or never did, remove the line and say why in your
report (the one case a reviewer may remove a line; same judgement as
`/refactor`'s revalidation). Use plain `grep`, never `git grep`, on the
ledger: it is gitignored, so `git grep` reports "not found" and the dedupe
passes every time.

Each blocking finding: **Location** (`file:line`) · **What's wrong** ·
**Failure scenario** (inputs/state → result) · **Why it matters** ·
**Suggested fix** (described, not applied) · **Verdict** (confirmed /
uncertain).

Then a coverage line: stage 1 at level `<level>`, stage 2 full, stage 3 —
each `ran ✓/✗` with its evidence. A stage you did not actually run is a **✗**, never an
assumed pass. Stage 2's evidence is the coverage block at the end of the security spec's
Output — copy its lines into the record as the `s2` lines (below).
N/A must hold for the repo, not the diff: "the diff doesn't touch it" is no
reason. `coverage:` says `stage2 ran` only when all 11 `s2` lines are present
and none says `NOT RUN`; otherwise `stage2 NOT RUN`. Then a
`checks:` line for the two checks most often cut short:
`fail-first N/M files` and `secrets-history all-branches` (or `NOT RUN:
<reason>` for either). An N below M, or a NOT RUN, is reported as-is — it
does not block.

**Write the review record** to `.claude/remember/last-review.md`, overwriting
it. `/release` reads this file — a chat-only SHA is gone after a compaction
or handover, and the orchestrator is the only other source (one this command
already refuses to trust). **Write it at the end of every run,
unconditionally** (bar the `sha:` = HEAD stop, which writes nothing), not after
someone decides what to do — it earns its keep
by surviving a compaction, an abandoned session, or an unseen handover.

**Derive `ledger:` before filling the template** — no ledger file → `ledger:
none`; otherwise run all three (total, K, I):
```
grep -c '^- ' .claude/remember/fix-ledger.md
grep -cE '@ [0-9a-f]{7,40} · change$' .claude/remember/fix-ledger.md
grep -cE '@ [0-9a-f]{7,40} · idea$' .claude/remember/fix-ledger.md
```
N = total − K − I, M = bullets appended this run. **Carry `self-review-sha:` forward
first** (`/self-review`'s bookmark, never set here), verbatim, as the last line
— or, if the record has no `self-review-sha:` but has an old `debrief-sha:`, that line:
```
sha: <full HEAD sha>
branch: <branch>
target: <resolved range or path>
level: <low | medium | high | max>
verdict: <ready | blocked>
date: <YYYY-MM-DD>
coverage: stage1 <ran|NOT RUN>, stage2 <ran|NOT RUN>, stage3 <ran|NOT RUN>
s2 secrets: <ran: … | N/A: … | NOT RUN: …>
s2 tenant-isolation: <ran: … | N/A: … | NOT RUN: …>
s2 rate-limiting: <ran: … | N/A: … | NOT RUN: …>
s2 error-handling: <ran: … | N/A: … | NOT RUN: …>
s2 authorization: <ran: … | N/A: … | NOT RUN: …>
s2 data-access: <ran: … | N/A: … | NOT RUN: …>
s2 injection: <ran: … | N/A: … | NOT RUN: …>
s2 auth-session: <ran: … | N/A: … | NOT RUN: …>
s2 trust-boundaries: <ran: … | N/A: … | NOT RUN: …>
s2 config: <ran: … | N/A: … | NOT RUN: …>
s2 dependencies: <ran: … | N/A: … | NOT RUN: …>
checks: fail-first <N/M files|NOT RUN: reason>, secrets-history <all-branches|NOT RUN: reason>
tests: <command> exit <code>; build <command> exit <code> | build N/A: <reason> | NOT RUN: <reason>
docs-commit: <full sha | none>
docs: <space-separated paths the sweep changed | none — never prose>
sweep: <ran: N changes — A added, F fixed, C already correct | deferred: unsettled | main: no edits>
ledger: <N> nits, <K> changes, <I> ideas, <M> added
blockers:
- <file:line> · <one-sentence claim, no scenario, no suggested fix>
self-review-sha: <carried forward verbatim (or the old debrief-sha: line), or omitted if absent>
```

Fill each `s2` line, and `sweep:`, by keeping one alternative and deleting the
rest — `s2 secrets: ran: <command, N hits>`; `sweep: ran: 3 changes — 2 added,
1 fixed, 0 already correct`. `/release` reads them mechanically: a line left as
the template, or `NOT RUN`, fails it. `docs: none` alone cannot tell a sweep
that found nothing from one that never ran; `sweep:` can.

An old `debrief-sha:` line is carried verbatim, name unchanged; `/self-review`
reads both names and writes `self-review-sha:` on its next run.

`sha:` is the HEAD stages 1-3 reviewed — **before** Stage 4's docs commit, if
it made one. `docs:` is repo-relative **paths only**, space-separated, or
`none` — never prose, never reasons; `docs-commit: none` means `docs: none`.
The per-change sweep table (change · doc `file:line` · added/fixed/already
correct) belongs in the **report**, never the record. `/release` still
compares this SHA to `HEAD`; its relaxed stale rule (see `/release`) lets a
docs-only commit sit between the two without forcing a re-review.

`blockers: none` when ready; otherwise one line per blocker, nothing more —
reasoning goes in the report, non-blocking findings in the ledger. `coverage`
is recorded so a `ready` with security not run is distinguishable. `/release`
reads the `tests:` line instead of re-running the suite on the same commit.

**There is no override field, no `verdict: overridden`** — releasing over
`blocked` is a live decision at `/release`'s hand-back, in conversation.

**Nothing clears this file.** Overwritten whole next run; the `sha:` line
expires it (fix and commit → *stale*, not *blocked*).

End with:
- **Reviewed at HEAD `<sha>` on `<branch>`, target `<range or path>`; tree
  clean at start, at exit clean or only the two `.claude/remember/` paths.**
- **Fix ledger:** the same N/K/I/M as the record's `ledger:` line (`ledger:
  none` → **Fix ledger: none**); N + K > 0 → add "N + K fixes waiting — run
  `/refactor` between features"; I > 0 → add "I ideas to triage" (ideas are
  not fixes waiting).
- **Docs sweep: N changes documented, commit `<sha|none>`**, or **deferred — unsettled**.
- One-line verdict: **Ready to merge? Yes / No / Not until these are fixed.**
- **A run that produces no record is not a review.** Dying mid-flight — a rate
  limit, a crash, a cancelled turn — leaves no report and no `last-review.md`;
  silence is never a pass. `/release` already treats a missing record as no
  review; say so here too, so nobody fills the gap from memory.
- **Escalate to the orchestrator** with the findings. It decides what gets
  fixed and by whom. Say plainly what you could not verify.
