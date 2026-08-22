---
name: docs-builder
description: Reorg a docs corpus, split an oversized doc, keep pages current, index them
usage: /docs-builder [reorg | reconcile | archive-cleanup | <file.md>]
argument-hint: [reorg | reconcile | archive-cleanup | <file.md> — empty asks first run / drift / archive]
allowed-tools: Read, Write, Edit, Grep, Glob, Task, AskUserQuestion, Bash(node:*), Bash(git:*), Bash(rg:*)
---

# docs-builder

Keep project docs **current, complete and findable**, and split a file when it outgrows
its row in `docs/README.md`.

> **The honest label: this does NOT make docs cheaper to read.**
> Measured four ways; best case is a tie with doing nothing. Cost tracks *findings*, not
> structure — better navigation raises how thorough an agent is willing to be, it does not
> cut reading. The winning arm wins because **synthesis caps cost**: the pages already did
> the reading. Never sell this as a token saving.

Every mechanical step is `docs-builder/docs-builder.cjs` (vanilla Node, zero deps). A model is used for
exactly **two** things: proposing themes, and writing pages. Bookkeeping done by a script is
100% correct; done by a model it was 27%.

### Model tiers — never hardcode a vendor model name

| step | tier | why |
|---|---|---|
| propose + assign themes | **cheapest tier** | structured labelling against a fixed list; no synthesis |
| write pages | **mid tier** | semantic synthesis, cheaper/faster than your top reasoning tier |

Use whatever your tool designates as that tier. The measured numbers below were taken on
Claude's Haiku 4.5 (cheap) and Sonnet 5 (mid) in August 2026 — the *ratios and shapes*
carry over, the absolute prices do not.

---

## Invocation

**With an argument** (`reorg`, `reconcile`, `archive-cleanup`, or a file path) — run that
mode directly, no question asked.

**Bare `/docs-builder`, no argument — ALWAYS ask, never auto-detect.** Run `due` first and
put its one-line verdict in the question text so the choice is informed. Then use
`AskUserQuestion`, one question, header `Mode`, exactly these three options:

> **Question: What should docs-builder do?**
>
> - **First run** — sort every `.md` in `docs/` into product / archive, then split anything
>   too big into pages and index them. Use when docs are a pile of loose files, or
>   docs-builder has never run here.
> - **Docs drift** — docs moved on since the last run: rebuild the index, re-run lint,
>   report what changed. Nothing is restructured and nothing is split.
> - **Clean archive** — prune `docs/archive/`. **Destructive**; needs a clean git tree.

Do not offer a fourth option and do not recommend one. If `due` cannot run, say so plainly
and ask anyway — never guess the mode on the user's behalf.

Auto-detecting was considered and rejected: the three differ in cost and destructiveness,
and a wrong guess is expensive in one direction and irreversible in the other.

### What each option runs

**First run** — two steps, with a stop in between:

1. `discover` (Mode 0). Nothing moves. Print its table, then **confirm** before running
   `apply-reorg`. Moves are `git mv`, so they are reversible — but a file landing in the
   wrong bucket is still worth catching before it happens, and anything bucketed `review`
   (no H1) is an outright guess.
2. `apply-reorg` moves product/archive. **Oversized docs are left where they are.**
3. Print the oversized list with line counts and the estimated split cost, then **ask which
   to split** (any, all, none). Only then run Mode 1 on each chosen file.

The two stops are deliberate and different. Step 1 guards *correctness* — is this file
really archive? Step 3 guards *cost* — splitting is ~$0.39 per 1,000 source lines, and the
user has seen neither the file list nor the number when they pick "First run". Never split
N files in one shot on an unseen list.

**Docs drift** — `due`, then Mode 2 reconcile (scan → validate → index → lint). Read-only
against `product/`; owns `wiki/`. This is the common, cheap case. `due` only reports drift —
changed, new, moved, deleted docs since the last ledger stamp. It knows nothing about file
size; that is `discover`'s job, under **First run**.

**Clean archive** — Mode 3. Destructive, opt-in, default keep, moves rather than deletes.

---

## Modes

| Mode | Menu option | Does | Destructive |
|---|---|---|---|
| `/docs-builder reorg` | *First run*, step 1 | classify a WHOLE corpus into product/archive | no (moves are `git mv`, plan reviewed first) |
| `/docs-builder <file>` | *First run*, step 3 | split ONE oversized doc → pages + index | no (original preserved) |
| `/docs-builder reconcile` | *Docs drift* | rebuild index, run lint, propose fixes | no |
| `/docs-builder archive-cleanup` | *Clean archive* | prune | **yes** — separate invocation, default keep, requires git |

`reorg` and the single-file split solve different problems and compose: `reorg` sorts an
entire messy `docs/` tree into the three-bucket structure below in one pass; anything it
tags `oversized` still needs a human to run the split flow on it individually (below),
because that step spends real model budget and should never fire without a look first.

## Layout

```
docs/
  README.md          entry point, referenced from AGENT.md
  index.md           GENERATED by script. never hand-edited. READER-FACING.
  log.md             append-only:  ## [DATE] operation | description — written by
                     `archive`, `apply-reorg`, and `validate` (one line per verdict); NOT
                     written by read-only commands (`due`, `search`, `discover`).
  product/           specs. reconcile READS, never writes.
  wiki/              synthesised pages. reconcile OWNS these.
  archive/           what got cleaned up: originals, byte-identical, history preserved
                     via `git mv`. Pruning them is a separate, opt-in invocation.
  .docs-builder/     machine-only working state. Never hand-edited, never read by a human.
    ledger.json        last consolidation SHA + per-doc line counts
    outline.json       Layer 1 scan
    labels.json        the model's theme assignment
    validate.json      the gate's verdict
    failures.json      LIVE count of current `validate` gate failures, keyed
                       `<check>:<target>` — incremented on failure, DELETED the moment that
                       exact key passes again. Not a history; at 3+ recurrences `validate`
                       adds a STRUCTURAL warning line (message only, never the exit code).
    lint.json          latest lint proposals
    tasks/             one task-<theme>.json per page
```

**`index.md` deliberately stays visible.** It is the thing a reader (or an agent) opens
first — the measured winning arm is *pages + a coarse index*. Hiding it under a dot-dir
would break the one mechanism that works. Only machine state goes in `.docs-builder/`.

**Never moved — enforced in code, not just documented** (`PROTECTED_NAMES` / `walkMd`):

- **Files, at any depth:** `README.md`, `index.md`, `log.md`, `CHANGELOG.md`, `LICENSE.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `AGENT.md`.
  Bare `LICENSE`/`NOTICE` have no `.md` extension, so the walker never sees them.
- **Directories:** every dot-dir (`.git/`, `.github/`, `.claude/`, `.factory/`, `.opencode/`,
  `.amp/`, `.docs-builder/`) plus `node_modules/`, and the dirs reorg itself owns
  (`product/`, `archive/`, `wiki/`) so a second run is idempotent.

---

## Mode 0 — reorg (a whole corpus, not one file)

The old skill (v1) did this job by handing an agent a file list and a prose rulebook
("KEEP/CONSOLIDATE/ARCHIVE", "when uncertain → ARCHIVE") and letting it read, judge and
`mv` every file itself — the exact shape that measured 27% correct on bookkeeping elsewhere
in this pipeline. `reorg` does the same JOB with the same discipline as everything else
here: classification is **mechanical and script-run**; nothing is guessed; nothing moves
until a plan has been written and reviewed.

**Not rebuilt:** v1's CONSOLIDATE (merging two docs' content into one). That rewrites
content, a different and higher-risk operation than anything measured so far. Descoped on
purpose, not silently dropped.

### 1. Discover (script) — classifies, never moves

```bash
REPO=<repo> node docs-builder/docs-builder.cjs discover        # defaults to docs/
```

Recursively finds every `*.md` under the root (skipping `wiki/`, `archive/`, `product/`,
`.docs-builder/`, and the three protected files), and sorts each into one bucket:

| bucket | rule | precision |
|---|---|---|
| `archive` | path already under `archive/old/reports/phases`, **or** the doc's own opening declares a SHOUTED status word (`CLOSED`, `FROZEN`, `DEPRECATED`, `SUPERSEDED`, `WITHDRAWN`, `RETRACTED`, `REFUTED`, `ARCHIVAL`, `ARCHIVED`), **or** the filename matches an archive-shaped prefix (`REPORT_`, `STATUS_`, `PHASE_`, `DRAFT`, `WIP`, `OLD`, `TEMP`, …) | see below |
| `oversized` | over the line ceiling (`OVERSIZED_LINES`, default 500 — an UNMEASURED starting point) and no archive signal | needs the split flow, per file |
| `product` | has an H1, current size, no archive signal | default when nothing else applies |
| `review` | no H1 at all — cannot tell what the doc even is | shown separately; `apply-reorg` treats it as an archive candidate |

**Why the status check requires SHOUTED caps, case-sensitively.** Tried case-insensitive
first, against a real, uncrafted corpus (not a fixture built to pass). It false-positived
three separate ways on real files: `"Supersedes **nothing**"` (negation), `"this rung
BUILDS three frozen records"` (an input being described, not the doc itself), `"archived
spines"` (data the doc references, not the doc). Same failure species as the lint fix
above — a word that means one thing in isolation matches unrelated prose. Restricting to
the ALL-CAPS form fixed every one of those, because this corpus's own writing convention
(observed, not designed around) SHOUTS a genuine self-declaration — `**Status: CLOSED**`,
`(FROZEN 2026-07-25, before any number; archival)` — while narrative mentions of the same
word stay lowercase or Title Case. Traded away: 2 real misses (`"Frozen 2026-07-26"`,
`"job #4 ... (frozen)"`) — consistent with precision-over-recall. Neither miss is
dangerous: a miss just lands the doc in `product`, one bucket short of ideal, not
mis-archived.

**Also dropped from v1's own heuristics, on the same evidence standard:** "filename has a
date → likely stale." Tested against a real corpus and wrong — `2026-07-28-p-palette-
design.md` is a current, locked, actively-built spec, not a stale report. A dated filename
alone proves nothing.

Output: `docs/.docs-builder/reorg-plan.json`, plus a printed table. **Nothing has moved
yet.**

### 2. Review the plan

Read the table. Anything under `review` (no H1) needs a human glance before `apply-reorg`
runs — it defaults to archive, which is reversible (`git mv`), but it's still a guess.

### 3. Apply (script) — verified moves, survives a bad file

```bash
node docs-builder/docs-builder.cjs apply-reorg      # defaults to the plan above
```

- `product` → verified `git mv` to `docs/product/<basename>`
- `archive` and `review` → verified `git mv` to `docs/archive/<basename>`
- `oversized` → **left in place.** Printed as a follow-up list — run Mode 1 below on each,
  by hand. Auto-splitting N unknown files in one shot would spend real model money with no
  confirmation; the pipeline never does that unprompted.
- A basename collision (two files, same name, different original folders) is
  disambiguated (`-2`, `-3`, …); a collision with a **file that already exists at the
  destination** is skipped, logged, and does not stop the rest of the run.

**After each move it repairs the paths that move just broke** — the whole point of doing this
in a script. Both movers (`apply-reorg` and `archive`) go through ONE function, `moveDoc`, so
the follow-up list cannot be added to one and missed by the other; that exact miss shipped
three times. `moveDoc` prints nothing — each caller reports in its own format — and it throws
only if the MOVE failed. A failed follow-up is collected instead, so a moved file is never
reported as a file that needs re-moving. Two follow-ups:

1. **Pipeline artifacts** — `rewriteArchivedPath` syncs `outline.json` / `labels.json`
   (`records[].file`, and the `<file> :: ` prefix inside every key). This is the same
   function `archive` calls; `apply-reorg` used to bypass it, which silently invalidated
   every key of every file it moved. Both now reach it through `moveDoc`.
2. **Inbound links** — every git-tracked `.md`/`.js`/`.cjs`/`.mjs`/`.json`/`.yml` file that
   points at the old path is rewritten to the new one. Reported per file, counted in the
   summary, and recorded in `log.md`.

**Why rewriting is safe here when the dangling-reference *lint* was cut outright.** That lint
had to **infer** whether `P95` was a reference (1/27 precision). This infers nothing:
`apply-reorg` is holding the old path and the new path in a variable at the instant it breaks
the link. The match is exact and anchored — a lookbehind rejects `xdocs/A.md` and
`./docs/A.md`, a lookahead rejects `docs/A.md.bak` and `docs/A.md-old`, while a sentence-final
`docs/A.md.` still matches. A plain substring replace corrupts all four.

**Never rewritten:** `CHANGELOG.md` and `docs/log.md`. Both are append-only history — a record
of where a file *was* is not a broken link. `docs/.docs-builder/` is excluded too; item 1 owns it.

---

## Mode 1 — cleanup

### 1. Scan (script)

```bash
REPO=<repo> OUT=docs/.docs-builder/outline.json \
  node docs-builder/docs-builder.cjs scan docs/BIG.md
```

One record per H2, each carrying the doc's H1 identity, a 2-line snippet, every H3 **with
its own start/end** (so a page writer can read a sub-section alone), and a `key`.

**Key format is always `<file> :: <heading>`, regardless of how many files were scanned
together.** It used to drop the `<file> ::` prefix when scanning a single file, so the same
heading keyed differently depending on scan batch size — a `labels.json` made from a
single-doc cleanup silently stopped matching once the file was rescanned as part of a
corpus-wide reconcile. Fixed; this is a **one-time breaking change** — any `labels.json`
made under the old bare-key format (no `<file> ::` prefix) will no longer match and must be
regenerated.

### 2a. Propose themes — **cheapest tier, ONE call over ALL headings**

Feed every `records[].key` plus its `snip`. Ask for a fixed list of themes with a one-line
gloss each. Aim for a list that leaves no theme holding more than ~30% of the lines.

**This pass is load-bearing.** Skipping it and assigning directly gave 68 themes for 86
sections, 57 of them singletons — perfect key accuracy, useless grouping. Chunking fixes
misalignment; only *global sight* fixes convergence. They are two different jobs.

### 2b. Assign — **cheapest tier, chunks of ~20 sections**

Each section gets a theme **from that fixed list**. Five rules, all paid for:

1. **Never emit a positional index.** One call over 97 sections keyed on `{index, id}`
   dropped 1 section, shifted 41 IDs from #55 on, and emitted one heading twice.
2. **Echo `records[].key` back verbatim** — and **delimit it explicitly in the prompt** so
   the model can see where the key ends:

   ```
   <<<KEY>>>the exact key text<<<END>>>
   snippet text on the following lines
   ```

   Measured the hard way: a bare `KEY: <text>` line followed by the snippet made the model
   glue snippet text onto 6 of 86 keys, because a key truncated mid-sentence has no visible
   end. The script also trims the key, because a truncation landing on a space produces a
   trailing space no model will echo back (5 more failures). Never ask a model to reproduce
   a boundary it cannot see.
3. **Chunk to ~20.** (40–50 may be cheaper — untested, see Open.)
4. **Validate before use** (step 3). Script, not model.
5. **Propose globally before assigning** (2a).

Write the result as `{ "themes": [{name, gloss}], "labels": [{key, theme}] }`.

### 3. Validate (script) — **hard gate, exits 1 on failure**

```bash
REPO=<repo> node docs-builder/docs-builder.cjs validate \
  docs/.docs-builder/{outline,labels}.json
```

`REPO=` must be the SAME repo `scan` used — the new `paths`/`links`/`citations` checks
resolve source files and `docs/wiki/` pages against it, so a mismatched `REPO` fails every
file at once. JSON artifacts stay cwd-relative, as everywhere else in the pipeline.

Checks every key exists, appears exactly once, none invented, none off-list, and reports
lines covered vs total. Also gates on: every outline record's source file still existing
(`paths`), every `wiki/*.md` link inside `index.md` resolving (`links`), and every page
citation landing inside its own task's source ranges (`citations`). **Uncited sections are
reported but never block** — flagged for a human, not a failure. **Do not proceed on FAIL**
— re-run the failing chunk.

### 4. Plan (script)

```bash
REPO=<repo> OUT=docs/.docs-builder/tasks node docs-builder/docs-builder.cjs plan \
  docs/.docs-builder/{outline,labels}.json
```

Writes `docs/.docs-builder/tasks/task-<theme>.json` per page and prints an estimated write
cost for the pages **still to write**.

**`plan` is the resume mechanism.** Any theme whose page already exists in `docs/wiki/`
(override with `PAGES=`) is reported `done` and dropped from the estimate, so re-running
`plan` after a crash relaunches only what is missing. Each finished page is the checkpoint;
there is no separate state file to go stale.

### 5. Write pages — **mid tier, one agent per page**

Each agent reads **only its own line ranges**. The value is context isolation.

- **250 lines is a ceiling, never a target.** Measured: every page came in under it
  unprompted, and agents said padding would be filler.
- **Coherence decides grouping, not size.**
- **Every claim carries a line citation** back to the source file, and never to a line
  outside the page's own ranges. Measured: 294 citations, 0 bad, 0 out of scope.
  Cite as `(<file>:<start>-<end>)` — e.g. `(CYBERNETICS.md:262-268)`. `validate` checks this
  (step 3).
- **Launch 3 at a time.** Each finished page in `docs/wiki/` is its own checkpoint — re-run
  `plan` and it reports what is left. A cleanup that dies halfway and cannot resume is worse
  than a slow one.

### 6. Archive the original (script)

```bash
REPO=<repo> node docs-builder/docs-builder.cjs archive docs/BIG.md
```

A **verified move**, not a copy: hash → `git mv` (so history follows) → hash again →
confirm the old path is empty. The original is never rewritten and never edited, but it
does not stay where it was either — otherwise the same content sits in three places at
once (old path, archive, and the new pages), which is duplication, not cleanup.

Pruning the archive is a **separate, opt-in, destructive** invocation
(`/docs-builder archive-cleanup`). Archiving never deletes.

### 7. Index (script)

```bash
OUT=docs/index.md node docs-builder/docs-builder.cjs index \
  docs/.docs-builder/outline.json docs/.docs-builder/labels.json
```

**Coarse, pointing at synthesised pages, 10–100 rows.** Row count is the variable that
decides whether an index helps or hurts: 16 rows fine, 97 rows won, **364 rows lost**. The
H3-grain outline stays internal — as a reader index it was the worst arm tested. Never
index a monolith as an alternative to splitting; that is worse than both.

The index carries a completeness guarantee and is regenerated every reconcile, so it cannot
drift. A stale index that promises completeness is worse than no index.

**Past the ceiling:** if `index` warns the corpus is over 100 rows, don't read `index.md`
whole — look sections up directly instead:

```bash
REPO=<repo> node docs-builder/docs-builder.cjs search docs/.docs-builder/outline.json <query words...>
```

BM25 over each section's real text (no deps, no separate index to build — it reads
`outline.json` and the source files `scan` already produced). Ranks and points at a
file/line range; it does not read the section for you.

---

## Mode 2 — reconcile

Re-run **scan → validate → index → lint**. Never touches `product/`. Owns `wiki/`.

```bash
REPO=<repo> OUT=docs/.docs-builder/lint.json \
  node docs-builder/docs-builder.cjs lint $(git ls-files 'docs/*.md')
```

| check | precision | how to treat it |
|---|---|---|
| `supersession` (declared in a HEADING) | **24/24 across 4 repos** | act on it |
| `supersessionInBody` | not measured | read, never act |
| `uncited` (repo-wide sweep) | fact, not a verdict | **propose only** |
| `redundant` (shared verbatim sentences) | 1/4 | **propose only** |

**The governing rule: observed beats inferred.** Lint only on what a doc *says about
itself*. Declared scored 100%; inferred scored 4–25%. Dangling-ID and duplicate-ID checks
are **cut entirely** — `P95` is a percentile, not a broken reference.

`uncited` must be **repo-wide**. Scoped to the doc corpus it flagged two live docs that are
cited from a logs file and `CHANGELOG.md`. And uncited ≠ deletable: bareloop's `O2`–`O4`
are genuinely uncited and must stay — they are the middle of a coherent `O1`–`O5` series.

Frontmatter is what makes a low-precision flag safe to ship: a flag is a **proposal**, and
confirmation is recorded in the file itself.

```yaml
type: reference        # the only required field
title: ...
status: draft | stable | deprecated
sources: [...]
verified: {by: "human:hamr", at: 2026-08-21}
stale_after: 2026-12-01   # ONLY when asked and answered. never inferred.
```

### Knowing when reconcile is due

git is the diff engine. The ledger stores only the one thing git cannot know — **when you
last consolidated** — so the two can never drift apart.

```bash
node docs-builder/docs-builder.cjs ledger   # stamp the current state (run after a reconcile)
node docs-builder/docs-builder.cjs due      # what changed since, and by how much
```

`due` classifies every doc against the stamped SHA using `git diff --numstat -M`:

| kind | means |
|---|---|
| `new` | did not exist at the last consolidation |
| `moved` | same content, different path (`-M` rename detection) |
| `moved+changed` | renamed **and** edited, with the line delta |
| `changed` | `+added/-deleted of N lines (~X%)` — how much of the doc actually moved |
| `deleted` | was in the ledger, gone from the tree |

Reconcile is **due at 5 changed docs**, the same threshold and the same derived-not-counted
shape `/stash` uses for its nudge. `due` only ever prints; it never reconciles for you.

`/remember` calls `due` at the end of its run (its step 7), detect-only and crash-isolated.
Silent when the project has no `docs/`; **loud** if `docs/` exists but the check could not
run; one nudge line when it is due. `/remember` never reconciles — `/docs-builder` owns the
ledger, `/remember` only reads it.

---

## Mode 3 — archive-cleanup

Separate invocation, **destructive**. Requires a clean git tree. Default is keep. Move to
`docs/archive/`, never delete. Append one line to `docs/log.md`.

---

## Cost

Measured end-to-end on a 5,669-line doc → 10 pages: **$2.20**, or **$0.39 per 1,000 source
lines**. Group step (cheap tier) $0.23; write step (mid tier) $1.97.

**Write cost law** (n=10, R² = 0.96): `$0.083 per page + $0.200 per 1,000 source lines`.
42% of the write bill is per-page fixed overhead, so page count matters as much as size —
but page count is set by coherence, not by cost.

The cheap-tier group calls were flat at 35–41K tokens regardless of input size. **That
flatness does not generalise** — the mid-tier write calls are ~58% input-driven. Do not
carry a per-step cost shape across steps.

## Open

1. **Chunk 40–50 vs 20** — untested. Now worth <5% of the bill; low priority.
2. **Concurrency cap of 3** is not tuned. Its original justification (10 parallel writers
   "killed 9 of 10") turned out to describe lost *cost accounting*, not lost pages. It may
   still be the right number for a different reason — smaller batches may produce better
   pages — but that is a **quality** hypothesis and it is untested.
3. **Mechanical clustering is CUT** — tf-idf gave a 42% blob and a naive sequential chop
   beat it. But that corpus was an append-only log, where a chop wins by construction. n=1.
4. **Page density is unjudged.** CLI-written pages ran ~half the prose of subagent-written
   ones at the same citation count. Which reads better is untested.
5. **`reorg`'s 500-line oversized ceiling is a stated default, not a measured one.**
   Classification quality (archive/product split) was validated against real, uncrafted
   corpora; the size cutoff itself was not tuned against anything.
6. **`reorg` was validated on ONE real corpus family** (bareloop's docs/, ~35 files). Its
   SHOUTED-caps status rule leans on that corpus's own writing convention; a repo that
   never shouts status in caps will simply get fewer `archive` hits (a recall loss, not a
   false-archive risk) rather than a wrong one — but that's inferred from the design, not
   independently confirmed on a second differently-styled corpus. n=1.
7. **`reorg` has not been run on a repo it doesn't control the content of.** Every corpus
   tested so far was one this session had full visibility into. No adversarial or
   unusually-formatted real-world corpus has been thrown at it yet.
