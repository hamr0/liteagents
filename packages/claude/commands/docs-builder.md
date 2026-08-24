---
name: docs-builder
description: Reorg a docs corpus, split an oversized doc, search it, keep pages current, index them
usage: /docs-builder [reorg | cleanup <file.md> | search <query words...>]
argument-hint: [reorg | cleanup <file.md> | search <query words...> — empty asks first run vs. drift]
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

**With an argument** (`reorg`, `cleanup <file>`, or `search <query words...>`) — run that mode
directly, no question asked.

**Bare `/docs-builder`, no argument — ALWAYS ask, never auto-detect.** Run `due` first and
put its one-line verdict in the question text so the choice is informed. Then use
`AskUserQuestion`, one question, header `Mode`, exactly these two options:

> **Question: What should docs-builder do?**
>
> - **First run** — sort every `.md` in `docs/` into product / archive, then split anything
>   too big into pages and index them. Use when docs are a pile of loose files, or
>   docs-builder has never run here.
> - **Docs drift** — docs moved on since the last run: report what changed, rebuild the
>   index, re-run lint. Nothing is restructured and nothing is split.

Do not offer a third option and do not recommend one. If `due` cannot run, say so plainly
and ask anyway — never guess the mode on the user's behalf.

Auto-detecting was considered and rejected: the two differ in cost (an unreviewed first-run
plan vs. a cheap drift check), and a wrong guess on the first one is expensive to unwind.

**`search` is a separate, explicit-argument-only mode — it is NOT a third bare-invocation
option.** The picker above stays at exactly two; do not add `search` to it. Typing
`/docs-builder search <query words...>` runs the mode directly (same rule as `reorg` and
`cleanup` above): it defaults the outline path to `docs/.docs-builder/outline.json` so the
user need only supply query words, and `N=` overrides the result count (default 10). It is
read-only — no model cost, no interview, nothing moves.

### What each option runs

**First run** — three steps, with the classification interview and a stop in between:

1. `discover` (Mode 0). Nothing moves. It writes `reorg-plan.json` — one row per file, each
   carrying a mechanical **`suggested`** bucket + `reason` (a PRIOR, not a verdict), plus `h1`
   and a short content `snip`, plus an `oversized` boolean (size no longer decides the
   bucket). `bucket` itself starts **empty** on every row.
2. **The classification interview.** Feed the model the WHOLE plan table (file, h1, snip,
   lines, suggested+reason) in one call and have it fill `bucket` for every row —
   `product`/`logs`/`archive` — with a one-line reason: honour that a SHOUTED self-declared
   status is near-conclusive for `archive` and that `suggested` is a prior, not an authority.
   The model writes its answers straight into `reorg-plan.json`. Then show the user the full
   resulting table via `AskUserQuestion` (approve all / correct specific rows / abort) — a
   correction changes the plan file before anything moves.
3. `apply-reorg` moves every row, **oversized included** — size only decides whether a doc is
   *splittable*, not whether it gets sorted. It refuses outright if any row's `bucket` is
   still empty. Afterward it prints the oversized docs it just moved as a follow-up list,
   `cleanup <NEW path>  (N lines)`, `logs/` entries last. Show that list, then **ask which to
   split** (any, all, none). Only then run `cleanup <file>` (Mode 1) on each chosen file —
   `cleanup` itself prints the estimated split cost for that one file, then a mechanical
   shape report, then stops for its own interview (Mode 1, step 1b) before anything else runs.

The two stops are deliberate and different. Step 2 guards *correctness* — the interview and
the user's approval, before a single file moves. Step 3's follow-up guards *cost* — splitting
is ~$0.39 per 1,000 source lines, and the user has seen neither the file list nor the number
when they pick "First run". Never split N files in one shot on an unseen list.

**Docs drift** — run bare `reorg` (Mode 2, below): its own `due`-style drift summary prints
first, if a ledger stamp exists, then it runs `discover`. If any row's `bucket` is still
empty (true on a genuine first run, or when new files appeared since the last classification),
`reorg` **stops right there** and prints what to do next — it never silently proceeds past an
unclassified plan. Once the plan is fully classified (an already-sorted corpus's re-run
carries its prior classifications forward automatically — see "Discover is idempotent"
below), `reorg` continues straight through `apply-reorg` → `lint`, no further stop, so
`index.md` and `lint.json` stay current. This is the common, cheap case for a corpus that is
already sorted: nothing new to classify, so the interview gate never fires.

---

## Modes

| Mode | Menu option | Does | Destructive |
|---|---|---|---|
| `/docs-builder reorg` (discover, classification interview, confirm, then apply-reorg) | *First run*, steps 1-3 | classify a WHOLE corpus into product/logs/archive | no (moves are `git mv`, plan classified and reviewed first) |
| `/docs-builder cleanup <file>` | *First run*, step 4 | measure ONE named oversized doc (cost, scan, heading shape) → **stops for the interview** | no (measure-only; original preserved) |
| `/docs-builder reorg` (bare `docs-builder.cjs reorg`) | *Docs drift* | due's drift summary (if a ledger stamp exists) + discover → (stops here if anything is still unclassified) → apply-reorg → lint, whole corpus | no |
| `/docs-builder search <query words...>` | *(none — explicit-argument mode only, never offered in the bare picker)* | BM25-rank sections of `docs/.docs-builder/outline.json` against the query, read-only | no |

`reorg` and `cleanup` solve different problems and compose: `reorg` sorts an entire messy
`docs/` tree into the four-bucket structure below in one pass and **never splits anything
itself**; an oversized file still moves into its bucket like everything else, but still needs
a human to run `cleanup <file>` individually (below), one named file per invocation, because
that step spends real model budget and should never fire without a look first. `cleanup` is
the ONLY entry point to the
split pipeline — it refuses more than one file at a time, refuses a missing/non-`.md`/
protected file, prints its cost estimate, then STOPS for an interview once the shape is
measured (Mode 1, step 1b); `cleanup-apply` (Mode 1, step 4) is the only door back in, and it
refuses to run until that interview has produced a `labels.json` with exactly one theme
marked `core: true`.

## Layout

```
docs/
  README.md          entry point, referenced from CLAUDE.md
  index.md           GENERATED by index-flat/apply-reorg/cleanup-apply. never hand-edited.
                     READER-FACING. The WHOLE-CORPUS map — the only file with a completeness
                     guarantee. ## Product, ## Logs, ## Archive.
  log.md             append-only:  ## [DATE] operation | description — written by
                     `archive`, `apply-reorg`, `validate`, and `reorg`; NOT written by
                     read-only commands (`due`, `search`, `discover`).
  product/           specs, designs, plans — the default. `apply-reorg` MOVES files here
                     (`git mv`); content is never rewritten.
  logs/              pre-registrations, results, learnings, reports — historical, still
                     relevant. Same MOVE discipline as product/archive.
  wiki/              synthesised pages, written by Mode 1 (`cleanup`)'s page writers.
  archive/           what got cleaned up: self-declared dead. Originals are BYTE-FROZEN:
                     nothing under here is ever a rewrite target, so a doc lands byte-identical
                     to what it carried in (a clean R100 rename) and stays that way. Links
                     elsewhere POINTING AT it are still repaired. History via `git mv`.
                     Pruning is `git rm`, the user's own
                     call — nothing here does it automatically.
  .docs-builder/     machine-only working state. Never hand-edited, never read by a human.
    ledger.json        last consolidation SHA + per-doc line counts
    outline.json       Layer 1 scan
    cleanup-shape.json `cleanup`'s mechanical heading-shape report — the interview's proposal
                       is built from this, never a model guess at what a section is "about"
    labels.json        the model's theme assignment (`core: true` on exactly one theme)
    reorg-plan.json    `discover`'s plan (Mode 0): `suggested`+`reason` per row (the script's
                       mechanical PRIOR) plus `bucket` (empty until the classification
                       interview fills it — `apply-reorg` refuses to run while it's empty)
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

**`index.md` has exactly one writer: `index-flat`** (called directly, or from
`apply-reorg`/`reorg`/`cleanup-apply`), and it is the corpus's ONLY index. This is
load-bearing, not a style choice — a real defect on bareloop is why: a second, themed
per-split index used to exist alongside it, and running a PRD split after a reorg silently
overwrote the 37-row whole-corpus map with that split's own 7-row view — 30 files vanished
from a file that still claimed completeness. Splitting the two apart into two files only
moved the problem (it then clobbered `outline.json` across concurrent splits instead), so
**the themed index was removed outright, 2026-08-24**. One index, rebuilt on every reorg and
after every split, is the whole design.

**Never moved — enforced in code, not just documented** (`PROTECTED_NAMES` / `walkMd`):

- **Files, at any depth:** `README.md`, `index.md`, `log.md`, `CHANGELOG.md`, `LICENSE.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `AGENT.md`.
  Bare `LICENSE`/`NOTICE` have no `.md` extension, so the walker never sees them.
- **Directories:** every dot-dir (`.git/`, `.github/`, `.claude/`, `.factory/`, `.opencode/`,
  `.amp/`, `.docs-builder/`) plus `node_modules/`, and the dirs reorg itself owns
  (`product/`, `logs/`, `archive/`, `wiki/`) so a second run is idempotent.

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

### 1. Discover (script) — enriches and PROPOSES, never classifies, never moves

```bash
REPO=<repo> node docs-builder/docs-builder.cjs discover        # defaults to docs/
```

Recursively finds every `*.md` under the root (skipping `wiki/`, `logs/`, `archive/`,
`product/`, `.docs-builder/`, and the protected files), and for each one writes a row with:

- `h1` and a short `snip` (first ~200 chars of body, fence-masked) — reused straight from the
  same `headings()`/`snippet()`/`fenceMask()` parsers `scan` uses, no second extraction path.
- `oversized` — a plain **boolean** (over the line ceiling, `OVERSIZED_LINES`, default 500 —
  an UNMEASURED starting point). Size decides whether a doc is *splittable*, not whether it's
  *sorted* — it is no longer a bucket.
- `suggested` + `reason` — a mechanical PRIOR, never a verdict:

| suggested | rule |
|---|---|
| `archive` | path already under `archive/old/reports/phases`, **or** the doc's own opening declares a SHOUTED status word (`CLOSED`, `DEPRECATED`, `SUPERSEDED`, `WITHDRAWN`, `RETRACTED`, `REFUTED`, `ARCHIVAL`, `ARCHIVED`), **or** the filename matches an archive-shaped prefix (`REPORT`, `STATUS`, `SUMMARY`, `FIX_`, `PHASE_`, `SPRINT_`, `DRAFT`, `WIP`, `OLD`, `TEMP` followed by `-` or `_`) |
| `logs` | filename carries an experiment-record token — `PREREG`, `LEARNINGS`, `REPORT`, `RESULTS`, `POSTMORTEM`, `RETRO` (case-sensitive, word-boundary, checked ONLY after the archive rules above, so a `REPORT-old.md` still reads as archive, not logs) |
| `product` | has an H1, no archive/logs signal — the default when nothing else applies |
| `product` | no H1, but an **include stub** — its whole non-blank content (≤3 lines) is nothing but include directives (mkdocs `--8<--`, `{% include %}`, `{{ .. }}`, `<!-- include -->`) and/or markdown links | a live pointer, not an unknown doc — real-world miss: uv's `docs/reference/contributing.md` |
| `product` | no H1 at all, and not an include stub — no strong signal either way; the interview decides, same as any other row |

- `bucket` — **empty on any row discover has not classified before** (see carry-forward
  below; a re-run keeps a bucket the interview already set). This is the field the
  classification interview (step 2) fills, and the ONLY field `apply-reorg` reads to decide
  where a file goes. It is shown in the printed table, so a re-run confirms on screen that an
  earlier classification is still in place.

**Discover is idempotent across re-runs, but not blind to prior work.** Re-running `discover`
carries an already-classified row's `bucket` FORWARD for any file it still sees at the same
path — it does not re-litigate a decision the interview already made. Only a file discover
has never classified before (new since the last run, or reappeared after a manual revert)
starts unclassified. `suggested`/`h1`/`snip`/`lines`/`oversized` are always freshly
recomputed, so the plan stays current even when `bucket` doesn't move. This is why bare
`reorg` (Mode 2) can compose discover with apply-reorg without a stop on an already-sorted
corpus: nothing new to classify, so its own gate never fires.

**Measured, why `logs` exists.** Run on bareloop's real `product/` (27 files): 11 were
experiment records (8 `*-PREREG`, 2 `*-LEARNINGS`, others) sitting alongside 14 actual specs
and designs — 41% of the bucket was run history, not product, which made the bucket useless
for finding specs. `logs/` is history that still matters (a prereg or a results doc), distinct
from `archive/`, which is history that is done.

**Why the status check requires SHOUTED caps, case-sensitively.** Tried case-insensitive
first, against a real, uncrafted corpus (not a fixture built to pass). It false-positived
three separate ways on real files: `"Supersedes **nothing**"` (negation), `"this rung
BUILDS three frozen records"` (an input being described, not the doc itself), `"archived
spines"` (data the doc references, not the doc). Same failure species as the lint fix
above — a word that means one thing in isolation matches unrelated prose. Restricting to
the ALL-CAPS form fixed every one of those, because this corpus's own writing convention
(observed, not designed around) SHOUTS a genuine self-declaration — `**Status: CLOSED**`,
`(ARCHIVAL 2026-07-25, before any number)` — while narrative mentions of the same word stay
lowercase or Title Case. `FROZEN` was in this list too, until 2026-08-23: measured against
bareloop's real docs corpus (37 files), 10 of its 12 `archive` calls were false positives,
all from `FROZEN` — e.g. `2026-08-01-layer-3-reuse-design.md` says "design FROZEN... build
follows this record" and `TYPES-PREREG.md` says "FROZEN before any model token is spent" —
in that corpus's own convention FROZEN means "locked, do not edit, still current," not
"retired." That's the one failure this design promises never to make, so the word was
dropped with no replacement heuristic. Traded away: 2 real misses (`"Frozen 2026-07-26"`,
`"job #4 ... (frozen)"`) — consistent with precision-over-recall. Neither miss is
dangerous: a miss just lands the doc in `product`, one bucket short of ideal, not
mis-archived.

**Also dropped from v1's own heuristics, on the same evidence standard:** "filename has a
date → likely stale." Tested against a real corpus and wrong — `2026-07-28-p-palette-
design.md` is a current, locked, actively-built spec, not a stale report. A dated filename
alone proves nothing.

Output: `docs/.docs-builder/reorg-plan.json`, plus a printed table. **Nothing has moved
yet, and nothing has been classified yet either.**

### 2. The classification interview — the model classifies, behind an approval gate

This is deliberately the model's job, not a rule's. The FROZEN incident (above) is usually
read as proof a model must not classify — that's the wrong lesson. FROZEN was a *mechanical
rule*, and it did damage precisely because it moved files with no gate at all. The failure
was the silent move, not the judgement.

1. Read `docs/.docs-builder/reorg-plan.json`. Feed the model the WHOLE table — `file`, `h1`,
   `snip`, `lines`, `suggested`+`reason` — **in one call**, and have it fill `bucket` for
   every row (`product`/`logs`/`archive`) with a one-line reason. `suggested` is a PRIOR the
   model is shown, never an authority over it — but a SHOUTED self-declared status
   (`**Status: CLOSED**`) is near-conclusive for `archive` regardless of what the mechanical
   prior says.
2. Have the model write its answers straight into `reorg-plan.json`'s `bucket` fields.
3. Show the user the full resulting table via `AskUserQuestion` — approve all / correct
   specific rows / abort. A correction changes the plan file.

   **Show EXACTLY these four columns, in this order.** No extras, no prose padding — the
   operator is scanning for a row that looks wrong, and every extra column hides it:

   | file | lines | → destination | why |

   - **`file`** — the doc's CURRENT path.
   - **`lines`** — the plan's line count. Append `(oversized)` when the row is oversized.
   - **`→ destination`** — the **full destination PATH** this row will move to, e.g.
     `docs/archive/PRD.md` — **never the bare bucket word** (`archive`). A wrong destination
     is obvious in a path and easy to skim past in a single word. This is the column the
     operator is actually approving.
   - **`why`** — the model's one-line reason, trimmed to one line.

   **Sort the rows by destination**, so all `archive` rows sit together, then `logs`, then
   `product`. A misfiled doc is easiest to spot against its neighbours; scattered through a
   path-sorted list it reads as normal.

Only after approval does `apply-reorg` run. The approval gate, not the classifier's
mechanism, is the safety property here — and it is strictly stronger than a rule that moves
files with no gate at all.

### 3. Apply (script) — an ALREADY-CLASSIFIED plan, verified moves, survives a bad file

```bash
node docs-builder/docs-builder.cjs apply-reorg      # defaults to the plan above
```

**Refuses outright if any row's `bucket` is still empty** — the interview-has-not-happened
message, not a crash — so nothing can move on an unreviewed plan. A plan from before this
version (`bucket: 'oversized'` or `'review'`, both gone from the schema) is refused too, with
a pointer to re-run `discover`.

- `product` → verified `git mv` to `docs/product/<basename>`
- `logs` → verified `git mv` to `docs/logs/<basename>`
- `archive` → verified `git mv` to `docs/archive/<basename>`
- **Oversized files move too — size decides splittable, not sorted.** No bucket is exempt.
  After the move, every oversized row is printed as a follow-up list at its NEW path, one
  `cleanup <path>  (N lines)` line per file — run `cleanup` (Mode 1, below) on each, by hand,
  one file at a time. The list is **ordered, `logs/` entries last**: a pre-registration is a
  legitimate split target but rarely the best NEXT one — a prereg is a record of one
  experiment, meant to be read whole. Auto-splitting N unknown files in one shot would spend
  real model money with no confirmation; the pipeline never does that unprompted, and
  `cleanup` itself refuses to run on more than one file.
- **After the scan, `apply-reorg` writes `docs/index.md` itself** — it calls `index-flat`
  (see below) automatically, so a reorg-only corpus ends up indexed without a second command.
  Runs every time, unconditionally.
- **`apply-reorg` also writes the docs pointer into `CLAUDE.md`** — a marker-wrapped
  `<!-- DOCS_INDEX:START -->`/`<!-- DOCS_INDEX:END -->` block naming `docs/index.md` as a
  **plain path, never an `@`-reference**: hot-loading a 100-row index into every session is
  exactly what this avoids. The block also carries the `/docs-builder search` hint, and is
  static — it never varies with row count, so a re-run rewrites identical bytes. Idempotent:
  an existing block is replaced in place, never duplicated; other content is left alone.
  The target is `CONFIG=` (default `CLAUDE.md`); this package uses `CONFIG=CLAUDE.md`.
- **The moves land STAGED in your git index — commit them promptly.** `git mv` stages each
  rename immediately (that is what preserves history), so when `apply-reorg` returns the repo
  is holding N staged renames. Any other session's `git add -A` or `git commit -a` will absorb
  them into an unrelated commit — OBSERVED TWICE, in two different repos. `apply-reorg` prints
  a closing advisory naming the counts and a copy-pasteable recipe. **Run that recipe
  VERBATIM. Do NOT hand-edit it, and do NOT stage by hand instead.** If it looks incomplete
  or names a path that errors, that is a BUG in the recipe — stop and report it to the user;
  do not silently repair it and move on. OBSERVED, real (privcloud first field run): the
  recipe omitted `docs/log.md`, the operator quietly added it by hand, and the bug only
  surfaced because they were later asked for near-misses — a silent repair is a lost bug
  report. Do NOT scope the commit to `docs` alone either: the renames are staged, but the
  inbound-link rewrites are UNSTAGED and reach outside `docs/` (`src/`, `scripts/`, `tests/`,
  `README.md`). Both belong in ONE commit, or you ship moved files whose links were never
  repaired. The tool never auto-commits, by design.
- A basename collision (two files, same name, different original folders) is
  disambiguated (`-2`, `-3`, …); a collision with a **file that already exists at the
  destination** is skipped, logged, and does not stop the rest of the run.
- **Emptied source directories are removed.** Once a directory the run itself moved files
  OUT of is genuinely empty (no stray files, no dotfiles), it's removed — depth-first, so a
  nested empty (`docs/00-context/sub/`, then `docs/00-context/` once `sub/` is gone) collapses
  in the same pass. A directory that still holds ANYTHING — even a file reorg never
  touches — is never removed. Only directories THIS run emptied are candidates; a dir that
  happened to already be empty before this run started is not this tool's to remove.
- **After every move, `apply-reorg` re-scans the whole corpus** — `docs/product/`,
  `docs/logs/`, and `docs/archive/` all — straight into `outline.json`, the database `search`
  reads. Not a hint, not opt-in: it runs every time, even when nothing moved this run (e.g.
  re-running on a corpus already sorted from a previous pass). Measured bug this closes: on a
  real 37-doc corpus, `outline.json` used to hold records for only the 12 files a split had
  happened to touch — all 24 `docs/product/` files had zero records, so `search` was
  structurally blind to them. Runs after the move, not before (moving changes paths, not
  content, so a pre-move scan would just be redone), and reuses the same `scan` used
  everywhere else in this pipeline — no second scanner, no second outline format.

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
   points at the old path (repo-rooted, e.g. `docs/GUIDE.md`) is rewritten to the new one.
   In `.md` files specifically, a RELATIVE link is also caught: inside actual markdown link
   syntax only (`[text](../concepts/x.md)` or a reference-style `[label]: ./tools.md`), never
   bare prose, the target is resolved against the SCANNING file's own directory, and — if it
   points at the file that just moved — rewritten to the correct relative path to its new
   location, with `#fragment` preserved and a `./` prefix kept only if the original had one.
   This is what fixes real corpora (e.g. astral-sh/uv) that cross-link with `../x.md`-style
   paths instead of repo-rooted ones. The file that just moved also gets its OWN relative
   links re-based from its new directory, so a link whose SOURCE and TARGET both move in the
   same `apply-reorg` run still resolves regardless of which one moves first. Reported per
   file, counted in the summary, and recorded in `log.md`.

**Why rewriting is safe here when the dangling-reference *lint* was cut outright.** That lint
had to **infer** whether `P95` was a reference (1/27 precision). This infers nothing:
`apply-reorg` is holding the old path and the new path in a variable at the instant it breaks
the link. The match is exact and anchored — a lookbehind rejects `xdocs/A.md` and
`./docs/A.md`, a lookahead rejects `docs/A.md.bak` and `docs/A.md-old`, while a sentence-final
`docs/A.md.` still matches. A plain substring replace corrupts all four.

**Never rewritten:** any file whose BASENAME is `CHANGELOG.md` or `log.md`, at ANY depth — not
only the root `CHANGELOG.md` / `docs/log.md`. Both are append-only history — a record of where
a file *was* is not a broken link.

**Archive is frozen — one rule, two directions.** Nothing resident under `docs/archive/` is
ever a rewrite TARGET (its bytes are never touched, stale links and all), but links ELSEWHERE
that POINT AT an archived file ARE still repaired. Same rationale as `CHANGELOG.md`/`log.md`,
one directory further: an archived doc is a historical record, and a record of where a file
*was* is not a broken link. This is evaluated against a row's **destination**, not its current
location — a reorg fills the archive, so a doc bound for `archive/` is exempt from the run's
FIRST rewrite, not from whenever it happens to move. Without that it would be edited by an
earlier row's sweep and carry the edit in with it (measured: it did). The check lives in one
predicate, `isRewriteExempt`, at one call site. `docs/.docs-builder/` is excluded too; item 1 owns it.

**A known, deliberate trade-off: this is a literal exact-path match over raw file bytes, not
fence-aware or context-aware.** It rewrites every exact, word-bounded occurrence of the old path
in every git-tracked `.md`/`.js`/`.cjs`/`.mjs`/`.json`/`.yml` file (except the two exemptions
above) — inside a code fence, inside a sentence describing history ("this used to live at
docs/OLD.md"), anywhere. A prose mention of where a file *used to be* WILL be rewritten to say
where it is now, changing what the sentence says. This is intentional, not an oversight: a dead
link is worse than a reworded sentence, the match is exact rather than inferred (unlike the
dangling-reference *lint*, which infers and was cut outright at 1/27 precision), and every
rewrite is printed per file so it is visible, never silent.

---

## Mode 1 — cleanup

**`cleanup <file.md>` is the ONLY entry point to the split pipeline, and it is a MEASURE step
only.** Settled 2026-08-23 (`docs-builder-v3-spec.md`, "cleanup"): the original always ends
up in `docs/archive/` via `git mv`, **byte-identical** — the archive is frozen and the
link rewriter never edits anything resident there (see "Archive is frozen" below) — and
everything the split
produces is a **new** file, including the core (the theme the document is mainly about, which
keeps the original's basename — see step 2a). Nothing in this mode ever rewrites a source
document in place.

`cleanup` takes exactly one named file — never zero, never more than one — and refuses
cleanly (exit non-zero) if the file doesn't exist, isn't a `.md`, or is one of the protected
entry-point docs (README, CLAUDE.md, etc.). It prints the file's line count and an estimated
write cost (the same cost law `plan` uses in step 4 below, priced as a 1-page floor since the
real page count isn't known until the model groups sections in step 2), runs step 1 (scan)
below for you, then measures the document's heading shape and **stops**:

```bash
REPO=<repo> node docs-builder/docs-builder.cjs cleanup docs/BIG.md
```

**Nothing past this command runs until a human has answered the interview (step 1b) below.**
Not the archive move, not a page, not a model call beyond the scan `cleanup` already ran. The
remaining steps — the interview, proposing/assigning themes, validating, planning, writing
pages, archiving the original, and indexing — are driven by this file, not by the script:
splitting spends real model budget, so nothing past the shape report runs without a human
choosing to continue, and confirming, the themes.

### 1. Scan (script) — run automatically by `cleanup`, shown here for what it produces

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
corpus-wide reorg. Fixed; this is a **one-time breaking change** — any `labels.json`
made under the old bare-key format (no `<file> ::` prefix) will no longer match and must be
regenerated.

### 1b. The interview — a proposal from a read, a verdict from the user

`cleanup` also writes `docs/.docs-builder/cleanup-shape.json` and prints it as a table: the
document's H2 sections grouped **mechanically** by shared heading shape (e.g. `86 sections:
"§N ..." — 11 sections, 193 lines (3%); "Addendum vN.N ..." — 75 sections, 5,476 lines
(97%)`). This is measurement, not a guess — the script groups on heading text alone, never on
what a section is *about*.

Now read the document yourself — the cheapest tier is enough, and the read is weighted to the
**opening**, where a document states its intent and what it is for, but covers enough of the
rest to name the other themes actually present. Then ask, via `AskUserQuestion`, one question,
in exactly this shape:

> **Question: Is this split right?**
>
> <the shape table `cleanup` printed>
>
> This document is mainly: **\<your read of the dominant theme>**.
> Other themes present: **\<theme>**, **\<theme>**, ...
>
> Is that right, and are those the themes you want split out?

At minimum two options: **Confirm** (proceed with the themes exactly as stated) and
**Correct** (the user names what the document is actually mainly about, and/or edits the
other-themes list). **This must not degenerate into auto-detect wearing a costume** — the
failure mode `docs-builder-v3-spec.md` names by name. A correction has to change what gets
built: if the user corrects the "mainly" answer, that theme — not your first guess — is the
one step 2a marks `core: true`; if they edit the other-themes list, that list — not your first
guess — is the fixed list step 2a proposes against. Do not run step 2a until this question is
answered.

### 2a. Propose + assign themes — **cheapest tier, ONE call over ALL headings**

Feed every `records[].key` plus its `snip`, together with the interview's confirmed-or-
corrected answer from step 1b. Ask for a fixed list of themes with a one-line gloss each —
the theme the interview named as "mainly" goes in as the **core** theme, everything else as
an ordinary theme. Aim for a list that leaves no theme holding more than ~30% of the lines.

**Exactly one theme is core**, marked `core: true` in `labels.json` (step 2b below). Its page
will carry the source file's own basename (e.g. splitting `docs/01-product/PRD.md` yields a
core page named `PRD.md`, not a slugified theme name) — `plan` (step 4) enforces this, and
rejects a `labels.json` that marks more than one theme core.

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

Write the result as `{ "themes": [{name, gloss, core?}], "labels": [{key, theme}] }` — `core:
true` on exactly the one theme step 1b's interview settled on as "mainly"; omit it (or leave
it `false`) on every other theme.

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

The `links` check reads `INDEX` (default `docs/index.md`, the one index `index-flat`
writes) rather than a hardcoded path — set it if the index lives somewhere else in this
repo. `TASKS` (default `docs/.docs-builder/tasks`) likewise overrides where the `citations`
check looks for the per-page task files. It checks EVERY relative `.md` link in that index —
product/, logs/, archive/ and pages alike, resolved from `INDEX`'s own directory. (It used to
scope itself to `PAGES`-prefixed links only; that scoping existed for the themed per-split
index, which is gone — on the one whole-corpus index it would silently skip most rows.)

### 4. Plan + apply (script) — `cleanup-apply`, the door back in after the interview

```bash
REPO=<repo> node docs-builder/docs-builder.cjs cleanup-apply docs/BIG.md \
  docs/.docs-builder/outline.json docs/.docs-builder/labels.json
```

This is the first script command allowed to run after step 1b, and it **refuses outright** —
before doing anything — if `labels.json` is missing, or has no theme marked `core: true`: in
both cases it prints that the interview has not happened yet and stops. Once that gate
passes, it runs `plan` (below), which writes `docs/.docs-builder/tasks/task-<theme>.json` per
page (the core theme's task file named after the original basename, per step 2a) and prints
an estimated write cost for the pages **still to write**.

If any page is still to write, `cleanup-apply` **stops there** — go to step 5 and write them,
then re-run the exact same `cleanup-apply` command. It is deliberately re-runnable: a human/
model page-writing step sits between planning and archiving that the script cannot run
itself, so nothing is auto-chained across that gap. Once **every** page exists, that same
re-run archives the original (step 6), relocates the core page into the original document's
own directory, and rebuilds the WHOLE-CORPUS map (step 8, `index-flat` → `docs/index.md`) —
all in one call, no separate `archive`/`index-flat` invocation needed, though both remain
runnable standalone (their own sections below still apply if you ever need to run either by
hand). The rebuild matters: archiving just moved a file, the core page just landed at the
original's path, and the new pages just appeared under `PAGES` — all three are corpus changes
`docs/index.md` must reflect.

`plan` is the underlying resume mechanism, unchanged: any theme whose page already exists in
`docs/wiki/` (override with `PAGES=`) is reported `done` and dropped from the estimate, so a
crash or an early `cleanup-apply` stop relaunches only what is missing. Each finished page is
the checkpoint; there is no separate state file to go stale. It is also still runnable on its
own:

```bash
REPO=<repo> OUT=docs/.docs-builder/tasks node docs-builder/docs-builder.cjs plan \
  docs/.docs-builder/{outline,labels}.json
```

### 5. Write pages — **mid tier, one agent per page**

Each agent reads **only its own line ranges**. The value is context isolation.

- **250 lines is a ceiling, never a target.** Measured: every page came in under it
  unprompted, and agents said padding would be filler.
- **Coherence decides grouping, not size.**
- **Every claim carries a line citation** back to the source file, and never to a line
  outside the page's own ranges. Measured: 294 citations, 0 bad, 0 out of scope.
  Cite as `(<file>:<start>-<end>)` — e.g. `(CYBERNETICS.md:262-268)`. `validate` checks this
  (step 3).
- **A page counts as written only with YAML frontmatter and at least 10 lines.** This is a
  mechanical gate, not a style note: `plan`/`cleanup-apply` call anything short of it
  `PARTIAL` and rewrite it. MEASURED, real (bareagent field run): this criterion was
  documented only in the lint section, never in the brief the page-writing agents actually
  read — so the first wave produced PARTIAL pages and had to be redone. Put it in every
  writer's prompt.
- **The CORE page goes back to the original document's own directory**, keeping the
  original's basename — only non-core theme pages stay under `PAGES`. Write it under `PAGES`
  like the rest (the original still occupies its final path until step 6 archives it);
  `cleanup-apply` relocates it for you once the archive move frees that path.
- **Launch 3 at a time.** Each finished page in `docs/wiki/` is its own checkpoint — re-run
  `plan` and it reports what is left. A cleanup that dies halfway and cannot resume is worse
  than a slow one.
- **Exit condition is a command, not a judgement: re-run `plan` and read its output.** Step 5
  is done ONLY when it prints `all pages written` with **zero** `WARN ... PARTIAL` lines. Any
  PARTIAL page gets rewritten before moving on — do not proceed to `cleanup-apply` past a
  PARTIAL warning, and do not decide by eye that a page "looks done". The criterion above is
  enforced by `pageStatus()`; this re-run is how you invoke that enforcement.

### 6. Archive the original (script) — run for you by `cleanup-apply` once all pages exist

```bash
REPO=<repo> node docs-builder/docs-builder.cjs archive docs/BIG.md
```

A **verified move**, not a copy: hash → `git mv` (so history follows) → hash again →
confirm the old path is empty. The original is never rewritten and never edited, but it
does not stay where it was either — otherwise the same content sits in three places at
once (old path, archive, and the new pages), which is duplication, not cleanup.

Archiving is also what frees the original's path for the **core page**, which `cleanup-apply`
then relocates there from `PAGES` (settled 2026-08-24). Splitting is internal maintenance
bookkeeping: a reader who knows where "the PRD" lives should still find it there afterwards.
MEASURED, real (bareagent): before this, a split left `CLAUDE.md`'s canonical-PRD reference
pointing into `docs/archive/`, which reads as "the canonical spec is archived" — backwards.

**Exit codes are not interchangeable — they mean two opposite outcomes:**

| exit | meaning | what to do |
|---|---|---|
| `0` | move succeeded, all follow-ups (artifact sync, link rewrite) succeeded | nothing |
| `1` | the move itself failed — **nothing moved** | fix the problem and re-run `archive` |
| `2` | the move **succeeded** — the file IS at the new path — but a follow-up (syncing `outline.json`/`labels.json`, or rewriting inbound links) failed | fix the follow-up by hand; do **NOT** re-run `archive` for this file, it has already moved |

A caller branching on exit code must treat 1 and 2 as distinct — retrying `archive` on a `2` is
exactly the mistake the printed message warns against.

Pruning the archive is the user's own call — `git rm` — and nothing in this pipeline does it
automatically. Archiving never deletes.

### 7. Search (script) — look a section up instead of reading the corpus whole

Row count is the variable that decides whether an index helps or hurts: 16 rows fine, 97 rows
won, **364 rows lost**. Past a hundred-odd rows, don't read `docs/index.md` whole — look
sections up directly. (An H3-grain outline as a reader index was the worst arm tested, and
indexing a monolith is never an alternative to splitting it.) The human entry point is the
slash command:

```
/docs-builder search <query words...>
```

which defaults the outline path and takes only the query. The underlying script form still
works directly, and is what the slash command runs:

```bash
REPO=<repo> node docs-builder/docs-builder.cjs search docs/.docs-builder/outline.json <query words...>
```

BM25 over each section's real text (no deps, no separate index to build — it reads
`outline.json` and the source files `scan` already produced). Ranks and points at a
file/line range; it does not read the section for you. Result count is `N` (default 10).

`search` can only rank what has a record — a file `outline.json` never scanned scores nothing
and cannot be found, no matter how well its title matches the query. `apply-reorg` (step 3
above) covers this for you: it re-scans the whole corpus, `docs/product/`, `docs/logs/`, and
`docs/archive/` all, every time it runs, so `search` sees every doc that has gone through the
reorg, not only whichever ones a split happened to touch.

### 8. Index-flat (script) — the WHOLE-CORPUS map, the only writer of `docs/index.md`

`index-flat` writes the corpus's one index — `apply-reorg` (step 3 above) and `cleanup-apply`
(step 4) both call it for you; this is only for re-running it by hand (e.g. after `git rm`-ing
some archived docs).

```bash
REPO=<repo> node docs-builder/docs-builder.cjs index-flat
```

Writes **one** `docs/index.md` covering the whole corpus, in three sections: `## Product`
(one row per file under `docs/product/`, plus any pages under `PAGES` — default `docs/wiki/`
— if they exist, plus any doc still sitting in place elsewhere), `## Logs` (one row per file
under `docs/logs/`), and `## Archive` (one row per file under `docs/archive/`). Each row is
an H1 title, a line count, and a link. No theme grouping, no `labels.json`, no model call.
Default destination `docs/index.md` — **the only writer of that default path** in this whole
pipeline (nothing else writes an index at all).
`search` reads `outline.json`, never `index.md`. Prints the row counts and records a `log.md`
line.

**Archive growth flag.** Every `index-flat` run counts the `## Archive` rows and prints a
console-only `WARN` once the count crosses `ARCHIVE_WARN_ROWS` (default 100, a stated default,
not a measured one). It only ever warns — never prunes, never collapses the section, never
deletes. Review `docs/index.md`'s `## Archive` section and `git rm` what you no longer need —
that is the whole mechanism; nothing in this pipeline prunes the archive for you.

---

## Mode 2 — reorg (the single front door)

v3 folds the old `reconcile` and `due` commands into one: "first run" (nothing sorted yet) and
"since last time" (a ledger stamp already exists) are the same job with different starting
state, and two separate commands only made users guess which one to run.

```bash
REPO=<repo> node docs-builder/docs-builder.cjs reorg
```

If a ledger stamp exists (see "Knowing when reorg is due" below), its `due`-style drift
summary prints FIRST — against whatever the tree looked like coming in, before this run's own
moves can confuse it. It then runs `discover`. **If any row's `bucket` is still empty,
`reorg` STOPS right there** and prints what to do next (run the classification interview,
step 2 above) — it never silently proceeds past an unclassified plan; that would be the exact
failure the approval gate exists to prevent, just moved one layer up. Once the plan is fully
classified — an already-sorted corpus's re-run carries its prior classifications forward
automatically (discover is idempotent, see step 1 above), so this is a genuine no-op on the
common case — it continues straight through: `apply-reorg` (which re-scans the whole corpus
itself and writes `docs/index.md` via `index-flat`) → `lint` over that same whole corpus.
`OUT` is IGNORED here, loudly: `reorg` writes several different artifacts
(`reorg-plan.json`, `outline.json`, `index.md`, `lint.json`) and a single `OUT` would point
them all at one file — set it on an individual subcommand instead.

**What the old `reconcile`'s `validate`/`index` steps did has no home in `reorg`, and that is
not a loss.** Those two needed a theme assignment (`labels.json`) that only the model's
grouping step (2a, above) ever produces — and `reorg` never calls a model by default and never
splits anything (rule: splitting is opt-in, per file, via `cleanup` only). So it never has a
`labels.json` to work from. That capability didn't move; it stayed exactly where it already
lived — the standalone `validate` (step 3) and `index-flat` (step 8) subcommands, unchanged,
still runnable by hand once a `labels.json` exists.

`lint` is also runnable standalone, on any file list, not only as part of `reorg`:

```bash
REPO=<repo> node docs-builder/docs-builder.cjs lint <file.md...>
```

-> `lint.json`. Every check below is declared-only (see the governing rule further down) —
nothing is inferred from similarity.

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
verified: {by: "human:<name>", at: 2026-08-21}
stale_after: 2026-12-01   # ONLY when asked and answered. never inferred.
```

### Knowing when reorg is due

git is the diff engine. The ledger stores only the one thing git cannot know — **when you
last consolidated** — so the two can never drift apart.

```bash
node docs-builder/docs-builder.cjs ledger   # stamp the current state (run after a reorg)
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

A reorg is **due at 5 changed docs**, the same threshold and the same derived-not-counted
shape `/stash` uses for its nudge. `due` only ever prints; it never runs `reorg` for you.

`/remember` calls `due` at the end of its run (its step 7), detect-only and crash-isolated.
Silent when the project has no `docs/`; **loud** if `docs/` exists but the check could not
run; one nudge line when it is due. `/remember` never consolidates — `/docs-builder` owns the
ledger, `/remember` only reads it.

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
