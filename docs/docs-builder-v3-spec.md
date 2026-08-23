# docs-builder v3 — index-first

**Status:** DRAFT — spec only, no code written.
**Date:** 2026-08-23
**Supersedes the mode layout in** `docs/docs-builder-v2-spec.md`. The v2 mechanics
(scan/validate/plan/index/search, script-does-bookkeeping) are unchanged and carried forward.

## Why v3

v2 was validated on a real corpus (bareloop, 37 docs, 22,550 lines) on 2026-08-23. It worked:
12 oversized docs split into 65 pages, `validate` PASS, 0 dead links, 0 invented keys.

It also cost roughly $9 and hit usage limits twice, for a benefit the tool's own honest label
already disclaims: **splitting does not make docs cheaper to read** (measured four ways in v2;
best case is a tie).

Meanwhile the cheap half — a coarse index plus BM25 `search` over `outline.json` — returns
`file + line range + H2` against the *unsplit* originals, for zero model calls. On the same
corpus, `search "budget cap enforcement"` returned `docs/archive/FINDINGS.md:49-58` and
`docs/archive/PRD.md:1017-1041` as its top hits.

v3's thesis: **the index and search are the product; the split is an opt-in luxury.**

## Scope

| mode | does | model | destructive |
|---|---|---|---|
| `reorg` | scan -> move into `product/`/`archive/` -> write `docs/index.md` and `docs/archive/index.md` -> **propose** stale files | none by default; `--themes` = 1 cheap-tier call | no (`git mv`) |
| `cleanup <file>` | split ONE named file into themed pages under `wiki/`, archive the original | mid tier, one agent per page | no (original preserved in `archive/`) |
| `search <query>` | BM25 over `outline.json` -> file + line range + H2 | none | no |

### Cut

- **`archive-cleanup` is removed entirely.** It was the only destructive command in the
  pipeline and needed a bespoke per-run confirmation ritual to be safe. Nothing auto-deletes;
  pruning the archive is `git rm`, and it is the user's responsibility. Removing it deletes
  code and risk in the same stroke.

### Folded

- **`reconcile` and `due` fold into `reorg`.** "First run" and "since last time" are the same
  job with different starting state; two commands only made users guess which to run. `reorg`
  detects whether a ledger stamp exists and reports accordingly. `/remember`'s step-7 nudge
  keeps reading the ledger, unchanged.

## The three rules that do not bend

1. **`reorg` never splits.** Splitting spends real model budget, so it only ever happens on a
   file the user named, with the estimated cost printed first. `reorg` lists oversized files
   as a suggestion and stops.

2. **Archiving is mechanical. A model may propose; only a rule may move.**
   A doc is archived when it declares a SHOUTED status word about *itself*
   (`CLOSED|DEPRECATED|SUPERSEDED|WITHDRAWN|RETRACTED|REFUTED|ARCHIVAL|ARCHIVED`) or already
   sits under an archive-shaped path. Everything else is `product`.

   This is not conservatism for its own sake — it is paid for. `FROZEN` was in that list until
   2026-08-23, when it produced **10 false archives out of 12** on bareloop, where `FROZEN`
   means "locked and live", not "retired". A false archive is the one failure that makes a user
   stop trusting the tool; a miss just leaves one extra file in `product/`, which is harmless.

   A model reading only index rows (a title and a line count) has strictly *less* evidence than
   the rule that already failed. So `reorg` may print a "these look stale, and why" proposal
   list, and the user answers per file. The model does the noticing; the human keeps the verdict.

3. **`index.md` is a map, not the content.** One row per file. The section-grain detail stays in
   `outline.json`, where `search` reads it. Measured in v2: **16 rows fine, 97 rows won, 364 rows
   lost** — a section-grain reader index was the worst arm tested. bareloop's outline is 358
   records, i.e. exactly the losing size. The detail must remain reachable-on-demand, never pasted
   into the index.

## The index

**One index, two sections.** `docs/index.md`:

```
  ## Product   — one row per file under product/, plus wiki/ pages if any exist
  ## Archive   — one row per file under archive/
```

An earlier draft called for a second, separate `docs/archive/index.md`. Dropped: `search` reads
`outline.json`, never `index.md`, so the index is purely a human/agent map — and one map beats
two files that can drift out of step with each other.

Row format is the existing `index-flat` output — H1 title, relative link, line count:

```
- [N1 — job/close schema + validator: design record](product/2026-07-12-n1-job-close-schema-design.md) — 120 lines
```

### Archive growth flag

`archive-cleanup` is gone, so nothing prunes the archive; it only grows. Row count is a measured
variable, not a preference: **16 rows fine, 97 rows won, 364 rows lost.** A swelling archive
section will eventually drown the live docs in the one file they share.

So `index` counts the archive rows every run and **flags** when the section crosses a threshold
(starting default 100 rows — a stated default, not a measured one):

```
WARN: archive/ is 118 rows and growing — nothing prunes it automatically.
      Review docs/index.md ## Archive and `git rm` what you no longer need.
```

It only ever warns. It never prunes, never collapses the section silently, and never deletes —
consistent with rule 2 and with dropping `archive-cleanup` in the first place.

### One scan, after the move

`scan` runs **once, after `apply-reorg`**, over the whole corpus — `product/` and `archive/`
both. Not before: moving changes paths, not content, so a pre-move scan would only have to be
redone. Not partially: scanning only the split-bound files is exactly the bug found on bareloop,
where `outline.json` held 12 files out of 37 and `search` was blind to every `product/` doc.

```
discover     classify (light read: H1, line count, status word)
apply-reorg  git mv
scan         outline.json over EVERYTHING
index        write docs/index.md from the outline
```

## What this changes for the user

A `reorg` on bareloop goes from ~$9 and two usage-limit hits to **~free**. The split is still
available and unchanged; it is simply aimed by hand, one file at a time, with the cost shown
before it runs.

## `/remember` step 7 — must be updated with v3

`/remember`'s step 7 calls `due` (detect-only, crash-isolated) and, when due, prints exactly:

```
docs: 7 changed since 991f72d3 — run /docs-builder reconcile
```

**v3 removes `reconcile`** (folded into `reorg`), so that line will name a command that no
longer exists. `packages/claude/commands/remember.md` around line 263 must change to
`run /docs-builder reorg`, in all four packages.

**Deletions already count, and must keep counting.** `due` derives its number from
`rows.length`, and a doc the ledger knew that is gone from the tree is a `deleted` row like any
other — so `git rm`-ing archive files (now the only way the archive shrinks, since
`archive-cleanup` is gone) advances the nudge on exactly the same mechanism as an edit. Proved
on a scratch repo 2026-08-23: deleting 3 of 6 archived docs printed
`3 doc(s) changed since 1c8a11fd (threshold 5). Not due yet.`, and deleting 5 printed
`5 docs changed since 1c8a11fd (threshold 5) — RECONCILE IS DUE.` No code change needed here;
only the word `RECONCILE` in that message changes with the rename.

Verified 2026-08-23 that `due` itself still runs clean after the v2 fix commits (bareloop,
no ledger stamped: `no ledger yet — run \`docs-builder.cjs ledger\` to start tracking. NOT due.`,
exit 0). The break is the nudge text, not the mechanism.

## `cleanup` — settled 2026-08-23

Three open questions on this operation are closed. The answers are the user's.

### The original always goes to archive

`docs/01-product/PRD.md` moves to `docs/archive/PRD.md` — `git mv`, byte-identical, history
intact, never edited, never deleted. This is unchanged from v2 and is the safety floor: whatever
the split produces, the document it came from is still there in full.

An earlier draft of this section said the core file must never be archived and must stay at its
original path. That is superseded. It also implied `cleanup` would rewrite a source document in
place, which raised a real safety problem — every existing operation in this pipeline only
reads, moves, or writes new files. The settled answer removes that problem entirely rather than
solving it.

### Everything cleanup produces is a new file

The core is written out as a **new file carrying the name**, alongside the themed pages for the
rest. Nothing is edited in place. So the pipeline keeps its existing property — read, move, or
write new — and `cleanup` needs no new safety story, because it introduces no new class of
write.

"Keep the core" therefore means: the core survives as its own document under its own name, and
the original that produced it survives in `archive/`. Two copies of the thing that matters, one
of them untouched.

### The proposal comes from a read, and the verdict comes from the user

The cheapest tier reads the document and proposes what it is:

- weighted to the **opening**, where a document states its intent and what it is for;
- but reading the rest too, so it can name the other themes actually present.

It answers in the shape: **"this document is mainly X; other themes present: Y, Z."**

The script supplies the exact shape — section count, line distribution — so the numbers under
the proposal are measured, not estimated. bareloop's `PRD.md`, for instance: 11 spec sections
holding 193 lines, 75 `Addendum v1.xx` sections holding 5,476.

```
cleanup docs/01-product/PRD.md

  5,680 lines. 86 sections.
    §1-§11 (spec sections)      11 sections,   193 lines   (3%)
    "Addendum v1.xx"            75 sections, 5,476 lines  (97%)

  This document is mainly: a product spec.
  Other themes present: a dated decision log; evidence and findings.

  Is that right, and are those the themes you want split out?
```

**`cleanup` does nothing until the user answers.** Not the archive move, not a page, not a
model call beyond the proposing read. The goal of the interview is not to classify the document
— it is to make sure the proposed themes are correct before any budget is spent on them.

This keeps the division of labour the rest of the pipeline uses and rule 2 requires: the script
measures, the model proposes, the user decides. It is also the same explicit-choice-over-auto-
detect rule `live-canvas` settled on. The failure mode to guard against is the interview
degenerating into auto-detect wearing a costume — a proposal the user is expected to wave
through. The proposal must be answerable with a correction, and a correction must change what
gets built.

## Open

1. **Unmeasured: do the 65 synthesized pages actually beat `search` over the originals?**
   Nobody has tested this. bareloop's `docs-reorg-test` branch now holds both artifacts — the
   pages *and* the archived originals with a working outline — so the head-to-head is cheap to
   run: ask the same 5 questions each way, compare answers and tokens. Until that runs,
   whether `cleanup` earns its place at all is an open question, not a settled one.
2. **`--themes` quality is unvalidated.** No cheap-tier grouping over bare H1 titles has been
   run yet; it may produce headings no better than alphabetical.
3. **The 500-line oversized ceiling is still a stated default, not a measured one.** Carried
   over unchanged from v2.
4. **The `CLOSED`-in-prose miss remains.** bareloop's `REUSE-PREPROBE-PREREG.md` was archived
   because line 8 says another programme "is CLOSED" — the doc describing something else, not
   itself. 1 miss in 37, reversible with one `git mv`. A fix would restrict the status match to
   the first few lines; untested.

## Measured 2026-08-23: split vs search, head to head

Ran on bareloop's `docs-reorg-test` branch, which holds both artifacts. Two sonnet agents,
same three questions, each walled off from the other's source.

| | A: 65 wiki pages | B: BM25 search over the unsplit originals |
|---|---|---|
| answered | 3/3 | 3/3 |
| tokens | 73,007 | 72,170 |
| files read | 9 | 3 |
| lines read | ~470 | ~520 |

**Cost is a tie.** Reading was ~20K tokens for both arms; the remaining ~50K was the agent
reasoning and writing. Same questions produce the same reasoning regardless of how the corpus
is stored, so restructuring cannot move the number that dominates the bill. This confirms v2's
own honest label on new, independent data.

`search` behaved correctly: arm B read 520 lines, not the 6,755 lines of the files it drew
from. It never loaded a whole document.

Splitting did buy something real but narrow: on the verdict-classes question, arm A named five
classes plus the review door, while arm B found two. Synthesis had already gathered material
that was scattered across the source. That is a recall benefit on split material only — it is
not a cost benefit, and it does not extend to anything that was never split.

### Search coverage — the actual gap (open)

The best source for question 1 was `docs/product/2026-07-13-forbidden-zone-audit-spec.md`, 175
lines, whose title names the query term exactly. **Neither arm found it.** Arm A could not (it
was never split, so no page covers it). Arm B could not either — and the reason is not ranking.

`outline.json` on bareloop holds **12 files. The corpus has 37.** The only files in it are the
12 that were split; all 24 `product/` files are absent. The forbidden-zone doc scores nothing
because it has no records at all. Search cannot rank what was never scanned.

An earlier draft of this section blamed BM25 length bias — that was asserted without checking
and is wrong. The ranker is already length-normalised (`b = 0.75`) and scores H2 *sections*, not
whole files, so a long document does not accumulate score. Checked directly: querying
"forbidden zone" returns `F17 - the forbidden zone was reachable` at rank 3, correct behaviour
over the subset it can see.

Fix: **`reorg` runs `scan` over the whole corpus** - `product/` and `archive/` both - not only
over files headed for a split. It is one script step, no model call, and it makes `search` cover
everything rather than a third of it.

This also means the head-to-head above understated arm B: search was competing on 12 of 37 files
and still tied on cost and answers. Full coverage weakens the case for splitting further, not
less.
