---
type: reference
title: docs-builder
status: draft
updated: 2026-08-24
---

# docs-builder

`/docs-builder` splits a documentation file once it outgrows its row in `docs/README.md`,
keeps the resulting pages current, and generates an index so they can be found. It is a
**slash command**, not a skill: `commands/docs-builder.md` plus a bundled
`commands/docs-builder/docs-builder.cjs` (vanilla Node, zero deps, fifteen subcommands) —
the same shape as `/remember`.

It ships in all four packages. `docs-builder.cjs` hardcodes no tool-specific paths, so it
is **byte-identical** across `claude`, `droid`, `opencode`, and `ampcode`; only the command
doc differs, by the one line naming the tool's config file (`CLAUDE.md` / `AGENTS.md` /
`AGENT.md`). This is a stronger guarantee than `friction.cjs`, which does bake in tool paths
and therefore has to be maintained as four near-copies.

---

## What it is, and what it is not

> **docs-builder makes docs current, complete and findable.
> It does not make them cheaper to read.**

That is the honest label from the spec (`docs/archive/docs-builder-v2-spec.md` §16). It was measured
four ways, on real navigation questions against real docs, and the best case for
docs-builder's output was a **tie with doing nothing**. Do not sell this tool as a token
saving or a reading-time saving. It is not one.

### So what does it actually buy you

The measured law (spec §9):

> **Cost tracks findings, not structure.** Better navigation does not reduce reading — it
> raises how thorough an agent is willing to be. Every address you add is an invitation to
> read more.

A finer index does not make an agent read less; it makes the agent trust that reading more
is worth it, so it reads more. The one arm that *did* win — wiki pages plus a coarse index —
won for a different reason entirely:

> **Synthesis caps cost.** The pages had already done the reading, so there was nothing
> left to re-derive. The index just told the agent where to stop.

The value is not helping an agent find things faster — it's that raw findings are already
synthesized, so an agent doesn't re-derive the same conclusions from scratch each visit.
The index's job is narrow: say "stop here," not "help you search."

---

## How it works — the flow

This is Mode 1's pipeline — what runs, model steps included, once `cleanup <file>`'s own
interview has approved a theme split for one named file (see Mode 1 below). Mode 0
(`reorg`, whole-corpus sorting) is a different, simpler pipeline — see "The three modes and
the docs/ layout".

```
1. SCAN      script   headings -> outline.json (h1, h2, h3, line ranges, snippet)
2a. PROPOSE  cheap    ONE call, ALL headings  -> fixed theme list + one-line glosses
2b. ASSIGN   cheap    chunks of ~20 sections  -> each section gets a theme FROM that list
3. VALIDATE  script   every key exists, appears once, none invented, none off-list
4. PLAN      script   task-<theme>.json per page + estimated write cost
5. WRITE     mid   one agent per page, reads ONLY its own line ranges
6. ARCHIVE   script   original -> docs/archive/ via verified `git mv`
7. INDEX     script   docs/wiki-index.md — the THEMED view of THIS split only. The
                       whole-corpus map, docs/index.md, is a different file with a
                       different single writer (`index-flat`) — see "Two index files,
                       two writers" below.
   LINT      script   supersession (act) / uncited + redundant (propose only)
```

**Steps 1, 3, 4, 6, 7 and lint are pure script — zero cost, zero model calls.** Only 2 and 5
touch a model: step 2 is cheap tier, step 5 is mid tier. This split is not incidental — it is the
central design decision, and it is measured, not assumed (§11):

> Bookkeeping done by a script is 100% correct; done by a model, it was 27%.

The LLM-wiki source project this borrowed from diagnosed the problem right — "the tedious
part is not the reading, it's the bookkeeping" — but assigned the wrong worker to it.
Bookkeeping (counting, matching keys, checking a list) is mechanical. A script does it
perfectly. A model asked to do the same bookkeeping in POC A (§6a) dropped a section, shifted
41 IDs by one, and duplicated a heading — 70,294 tokens of confident, wrong output.

### Walkthrough with the real commands

**1. Scan** — one JSON record per H2, each carrying the doc's H1 identity, a two-line
snippet, and every H3 with its own start/end line so a page writer can pull a sub-section
alone.

```bash
REPO=<repo> OUT=outline.json node docs-builder.cjs scan docs/BIG.md
```

**2a. Propose themes (cheap tier, one call over everything)** — feed every `records[].key` plus
its snippet, ask for a fixed list of themes with one-line glosses, aim for no theme holding
more than ~30% of the lines. **This pass is load-bearing** — see §C6 below for why skipping
it fails even with perfect key accuracy.

**2b. Assign (cheap tier, chunks of ~20 sections)** — each section gets a theme from that fixed
list, echoing `records[].key` back verbatim. Never re-derive or prettify the key; the script
already guaranteed it's unique.

**3. Validate (script, hard gate)** — exits 1 on failure. Do not proceed on FAIL; re-run the
failing chunk.

```bash
node docs-builder.cjs validate outline.json labels.json
```

**4. Plan (script)** — writes `task-<theme>.json` per page and prints the estimated write
cost using the measured cost law (§E).

```bash
OUT=tasks node docs-builder.cjs plan outline.json labels.json
```

**5. Write pages (mid tier, one agent per page)** — each agent reads only its own line ranges.
The value is context isolation, not speed. 250 lines is a ceiling, never a target; every
measured page came in under it unprompted. Launch 3 at a time, checkpoint each finished page
so a cleanup that dies partway can resume instead of restarting.

**6. Preserve (script)** — copies the original byte-identical, verifies by sha256, refuses
to overwrite. That guarantee now holds past the copy too: `docs/archive/` is frozen, so
nothing resident there is ever a rewrite target again, no matter what a later row's own
link-repair sweep does in the same run (see *History*).

```bash
REPO=<repo> node docs-builder/docs-builder.cjs archive docs/BIG.md
```

**7. Index (script)** — coarse, points at the synthesized pages, 10–100 rows. Defaults to
`docs/wiki-index.md`, deliberately a different file from the whole-corpus map
(`docs/index.md`) — see "Two index files, two writers" below. Run by hand once
`labels.json` exists, or automatically as the last step of `cleanup-apply`.
`apply-reorg`/`reorg` cover the whole-corpus map on their own via `index-flat` instead
(see Mode 2 below), so a stale themed index is never mistaken for a current one.

```bash
node docs-builder.cjs index outline.json labels.json     # -> docs/wiki-index.md (default)
```

**Lint (script)** — declared-only checks, see §D and §C.

```bash
REPO=<repo> OUT=lint.json node docs-builder.cjs lint $(git ls-files 'docs/*.md')
```

---

## How you invoke it

**Bare `/docs-builder` never guesses.** It runs `due` for context, then asks — two
options, no recommendation, no third:

| Option | What it does | Cost |
|---|---|---|
| **First run** | sort every `.md` into product/logs/archive, then split anything too big | spends model budget |
| **Docs drift** | rebuild the index, re-run lint, report what changed. Nothing moves, nothing splits | cheap — the common case |

Pass an argument (`reorg` or `cleanup <file.md>`) and it skips the question, so the flow
stays scriptable.

Auto-detecting the mode from repo state was considered and rejected — the two differ in
cost, so a wrong guess on the more expensive one is expensive to unwind. Same call
`live-canvas` made.

**`search` is a third mode, but explicit-argument only — it is never offered as a picker
option.** `/docs-builder search <query words...>` BM25-ranks sections of
`docs/.docs-builder/outline.json` against the query and points at a file/line range; it moves
nothing and calls no model. It defaults the outline path so the invocation needs only query
words, and `N=` overrides the result count (default 10). The bare-invocation picker above
stays at exactly two options on purpose — `search` isn't a cost decision that needs a
recommendation, so it doesn't get a third slot in a question designed around exactly that
distinction.

**"First run" has two stops, and they guard different things.** `discover` writes a plan
where every row carries a mechanical `suggested` bucket + `reason` (a PRIOR, never a
verdict) but an **empty** `bucket` — nothing moves yet. The classification interview then
has the model fill `bucket` (`product`/`logs`/`archive`) for every row, and only then is
the full table shown for approval via `AskUserQuestion` (approve all / correct specific
rows / abort) — that stop guards **correctness**: `apply-reorg` refuses outright to run
while any row's `bucket` is still empty, so nothing moves on an unreviewed plan. After the
moves, the oversized-file list is printed with line counts and an estimated cost and you
pick which to split — that stop guards **cost** (~$0.39 per 1,000 source lines). Never
split N files in one shot on a list you haven't seen. Oversized files are sorted into a
bucket like every other file — size only decides whether a doc is *splittable*, it no
longer decides where a doc is filed.

**One asymmetry worth internalising:** `due` measures *drift* (what changed since the last
ledger stamp) and knows nothing about file size. `discover` measures *size* and knows
nothing about drift. A doc can be huge and untouched, or tiny and churning — neither
predicts the other, which is why "Docs drift" will never surface an oversized file and
"First run" is what you want when docs have simply grown.

## The three modes and the docs/ layout

| Mode | Menu option | Does | Destructive |
|---|---|---|---|
| `/docs-builder reorg` (discover, classification interview, confirm, then apply-reorg) | *First run*, steps 1-3 | classify a WHOLE corpus into product/logs/archive | no (moves are `git mv`, plan classified and reviewed first) |
| `/docs-builder cleanup <file.md>` | *First run*, step 4 | measure ONE named oversized doc (cost, scan, heading shape) → **stops for the interview** | no (measure-only; original preserved) |
| `/docs-builder reorg` (bare `docs-builder.cjs reorg`) | *Docs drift* | `due`'s drift summary (if a ledger stamp exists) + discover → (stops here if anything is still unclassified) → apply-reorg → lint, whole corpus | no |

`reorg` and `cleanup` solve different problems and compose: `reorg` sorts a whole messy
`docs/` tree into the product/logs/archive layout in one pass and **never splits anything
itself**; an oversized file still moves into its bucket like everything else, but still
needs a human to run `cleanup <file>` on it individually, one named file per invocation,
since that step spends real model money and should never fire without a look first.
`cleanup` is the ONLY entry point to the split pipeline — it refuses more than one file at a
time, refuses a missing/non-`.md`/protected file, prints its cost estimate, scans the file,
then prints a mechanical heading-shape report and **STOPS for its own interview** before
anything else runs. `cleanup-apply` is the only door back in, and it refuses until
`labels.json` exists with exactly one theme marked `core: true`.

v3 folded the old `reconcile` and `due` commands into `reorg`: "first run" (nothing sorted
yet) and "since last time" (a ledger stamp already exists) turned out to be the same job with
different starting state. What `reconcile`'s `validate`/`index` steps did has no home in
`reorg`, and that is not a loss — those two need a theme assignment (`labels.json`) that only
the model's grouping step produces, and `reorg` never calls a model by default and never
splits anything. That capability didn't move; it stayed exactly where it already lived — the
standalone `validate` and themed `index` subcommands, unchanged, still runnable by hand once
a `labels.json` exists. The old `archive-cleanup` command (pruning `docs/archive/`) was
removed outright, not renamed — pruning `docs/archive/` is now the user's own call via
`git rm`; nothing in the pipeline does it automatically. `index-flat`'s archive-row count
grows a console-only `WARN` past `ARCHIVE_WARN_ROWS` (default 100) as the only remaining
nudge.

```
docs/
  README.md          entry point, referenced from CLAUDE.md
  index.md            GENERATED, and ONLY by `index-flat` (called directly, or from
                       `apply-reorg`/`reorg`/`cleanup-apply`). Never hand-edited. The
                       WHOLE-CORPUS map — the only file with a completeness guarantee.
                       Three sections: ## Product, ## Logs, ## Archive.
  wiki-index.md        GENERATED, and ONLY by the themed `index` step, once labels.json
                       exists. A DIFFERENT file from index.md, on purpose — see "Two index
                       files, two writers" below. The themed view of ONE split only.
  log.md               append-only:  ## [DATE] operation | description — written by
                       `archive`, `apply-reorg`, `validate`, `reorg`; not by read-only
                       commands (`due`, `search`, `discover`).
  product/            specs, designs, plans — the default. `apply-reorg` MOVES files here
                       (`git mv`); content is never rewritten.
  logs/                pre-registrations, results, learnings, reports — historical, still
                       relevant. Same MOVE discipline as product/archive. See "Why `logs/`
                       exists" below.
  wiki/                synthesised pages, written by Mode 1 (`cleanup`)'s page writers.
  archive/             what got cleaned up: self-declared dead. Originals are BYTE-FROZEN —
                       never a rewrite target, so a doc lands byte-identical to what it
                       carried in. Links elsewhere pointing AT it are still repaired.
                       Pruning is the user's own call (`git rm`) — nothing here does it
                       automatically.
  .docs-builder/       machine-only state: ledger.json, outline.json, cleanup-shape.json,
                       labels.json, reorg-plan.json, validate.json, failures.json,
                       lint.json, tasks/
```

**`index.md` deliberately stays visible.** It is the thing a reader (or an agent) opens
first — the measured winning arm is *pages + a coarse index*. Hiding it under a dot-dir
would break the one mechanism that works. Only machine state goes in `.docs-builder/`.

**`index.md` now carries a search hint unconditionally.** Every regeneration writes a
blockquote under the H1 — "Search this corpus instead of reading it whole:
`/docs-builder search <query words>`" — regardless of row count. Unlike the archive-growth
warning below, which is console-only and fires only past `ARCHIVE_WARN_ROWS`, this one is in
the generated file itself and always present: a reader should reach for `search` on instinct,
not only once the corpus already looks too big to read.

**Two index files, two writers, on purpose.** `docs/index.md` (whole-corpus map,
`index-flat`) and `docs/wiki-index.md` (themed view of one split, `index`) used to be the
SAME file. A real defect on bareloop is why they were split: `apply-reorg` wrote the
37-row whole-corpus map, then a PRD split's `index` step ran afterward and silently
overwrote it with only that split's own 7-row themed view — 30 of 37 files vanished from a
file that still claimed completeness. `index` now defaults to `docs/wiki-index.md`
specifically so the two can never collide again — see "History of things that were wrong".

**Never moved — enforced in code, not just documented.** This used to be prose only, and
the code did not match it (see *History*, below). It is now two guards in `docs-builder.cjs`:

- `PROTECTED_NAMES`, matched at **any depth**: `README.md`, `index.md`, `log.md`,
  `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `CLAUDE.md`, `AGENTS.md`, `AGENT.md`. Bare `LICENSE`/`NOTICE` carry no `.md` extension,
  so the walker never sees them.
- `walkMd` skips every dot-dir (`.git/`, `.github/`, `.claude/`, `.factory/`, `.opencode/`,
  `.amp/`, `.docs-builder/`) and `node_modules/`, plus the dirs reorg itself owns
  (`product/`, `logs/`, `archive/`, `wiki/`) so a second run is idempotent.

---

## Mode 0 — reorg a whole corpus, not just one file

v1 (the old skill) did full-corpus reorg by handing an agent a prose rulebook and letting
it `mv` files by judgement — the exact shape that measured 27% correct on bookkeeping
elsewhere in this pipeline. `reorg` rebuilds v1's scope with the same script-does-
bookkeeping discipline, but **classification itself is the model's job now, behind an
approval gate** (`docs-builder-v3-spec.md`, "four buckets, and the model does the
sorting") — a reversal from the v2 design, where a fixed rule alone decided the bucket.
The reversal is deliberate, not a relapse: the FROZEN incident below is usually read as
proof a model must not classify, but the actual failure was the *silent move with no
gate at all*, not the judgement. The approval gate is the safety property, and it is
strictly stronger than a rule that moves files unreviewed.

**`discover` no longer classifies — it enriches and proposes.** For every `.md` file under
`docs/` (skipping `product/`, `logs/`, `archive/`, `wiki/`, `.docs-builder/`, and the
protected entry-point docs) it writes a row carrying `h1`, a short `snip`, an `oversized`
**boolean** (over `OVERSIZED_LINES`, default 500, an UNMEASURED starting point — size
decides *splittable*, never *sorted*), and a mechanical `suggested` bucket + `reason`: a
PRIOR the classification interview is shown, never an authority over it. `bucket` itself
starts **empty on every row** — that's the field the interview fills, and the only field
`apply-reorg` reads to decide where a file goes. `review` no longer exists as a bucket: a
no-H1 file with no strong signal is just an ordinary unclassified row, same as any other,
that the interview decides like everything else.

The classification interview: feed the model the whole plan table (file, h1, snip, lines,
suggested+reason) in **one call**, have it fill `bucket` (`product`/`logs`/`archive`) with
a one-line reason per row, write the answers into `reorg-plan.json`, then show the user the
full table via `AskUserQuestion` — approve all / correct specific rows / abort. The
approval table has a mandated shape: **exactly four columns**, `file | lines | →
destination | why`, `→ destination` is the row's **full destination path**
(`docs/archive/PRD.md`), never the bare bucket word, and rows are **sorted by
destination** so a misfiled doc stands out against its neighbours instead of scattering
through a path-sorted list. Only after approval does `apply-reorg` run, and it refuses
outright if any row's `bucket` is still empty.

**Why `logs/` exists.** Measured on bareloop's real `product/` after an earlier reorg (27
files): 11 were experiment records (8 `*-PREREG`, 2 `*-LEARNINGS`, others) sitting
alongside 14 actual specs and designs — **41% of the bucket was run history, not
product**, which made the bucket useless for finding specs (`docs-builder-v3-spec.md`,
"four buckets: `logs/` joins the layout"). `logs/` is history that still matters — a
prereg or a results doc — distinct from `archive/`, which is history that is done.

**A prior, three-bucket run, for scale (superseded numbers, kept as a data point, not a
current claim):** run on bareloop's actual `docs/` (35 files, not a fixture) under the
pre-`logs`, pre-interview design: 16 → `product`, 12 → `archive`, 8 → `oversized` (then
still a bucket, left in place with a follow-up list, never auto-split), 0 → `review`. 28
verified moves, 0 skipped, `git status` showed clean renames (`docs-builder-v2-spec.md`
§19c). Neither `oversized` nor `review` are buckets any more, so these counts do not map
onto the current product/logs/archive split — a fresh end-to-end run under the four-bucket
interview-gated design has not been separately totalled in source. **UNMEASURED.**

The classification rule that took two tries: the archive signal ("this doc says it's
CLOSED/DEPRECATED") went case-insensitive first, and false-positived on real files —
"Supersedes **nothing**" (negation), "archived spines" (describing input data, not the doc
itself). Fixed by requiring the SHOUTED all-caps form, which is how this corpus's own
writing convention marks a genuine self-declaration. Two real misses were traded away for
that precision, and neither is dangerous — a miss just leaves a doc classified `product`
instead of `archive`, and nothing moves without a reviewed plan anyway. Full account,
including a process-killing bug the negative-control test caught before it shipped: spec §19.
`FROZEN` was on this word list too, until it was measured against bareloop's real corpus and
found responsible for 10 of 12 `archive` false positives on its own — dropped outright, see
*History* below.

**Discover is idempotent across re-runs, but not blind to prior work.** Re-running
`discover` carries an already-classified row's `bucket` forward for any file it still sees
at the same path — it does not re-litigate a decision the interview already made. Only a
file `discover` has never classified before (new, or reappeared after a manual revert)
starts unclassified. This is why bare `reorg` (Mode 2) can compose `discover` with
`apply-reorg` with no stop on an already-sorted corpus: nothing new to classify, so the
gate never fires. Carry-forward only accepts a currently-valid bucket — a legacy pre-v3
value (`oversized`, `review`) is dropped rather than carried, so that row starts
unclassified instead of making `apply-reorg` refuse the whole plan as stale schema (see
*History*).

**`apply-reorg` now writes a docs pointer into the repo's own agent config file.** A
marker-wrapped `<!-- DOCS_INDEX:START -->`/`<!-- DOCS_INDEX:END -->` block naming
`docs/index.md` as a **plain path, never an `@`-reference** — hot-loading a large index into
every session is exactly what this avoids — plus the same search hint `index.md` itself
carries. `CONFIG=` picks the target (default `CLAUDE.md`), because the script is
byte-identical across all four packages but their config filenames differ (`CLAUDE.md` /
`AGENTS.md` / `AGENT.md`). Idempotent: an existing block is replaced in place, never
duplicated; the rest of the file is left alone.

**A commit advisory now closes both `apply-reorg` and `archive`.** `git mv` stages a rename
immediately — nothing in this tool's output ever said so, and it was confirmed twice, in two
different repos, where another session's `git add -A` silently folded the staged renames into
an unrelated commit. The advisory names the staged rename count, the unstaged link-rewrite
count, and the distinct top-level locations outside `docs/` that were touched, then prints a
one-line recipe (`git add -u && git commit -m "docs: reorg"`) that captures both in ONE
commit — deliberately never scoped to `docs` alone, since the link rewrites the moves trigger
reach outside `docs/` too (`src/`, `scripts/`, `tests/`, `README.md`) and a `docs`-scoped
commit would ship moved files with their inbound links unrepaired. Nothing is ever
auto-committed.

---

## What it is good at

| capability | measured result |
|---|---|
| Byte-identical preservation | sha256 match on copy; refuses to overwrite |
| `validate` catches all four failure classes | 1/1/1/1 caught (missing / dupe / invented / off-theme), exit 1 |
| Key accuracy (with propose-then-assign) | 86/86 keys exact, 0 dupes, 0 invented, 0 missing |
| Line coverage | 5,669 of 5,669 lines covered |
| Citation groundedness | 294 citations, 0 bad, 0 out-of-scope |
| Supersession lint precision | 24/24 (100%) across 4 repos, after a fix (see "History of things that were wrong") |
| Cost prediction accuracy | `plan` estimated $1.96, measured $1.9664 — 0.3% error |
| Fence handling | headings inside code fences excluded; drops 982 false sections on aurora (2,213 → 1,231) |
| Regression suite | 410/410 tests passing |

The **governing rule behind the lint design**, independently re-derived from `/remember`'s
finding on session logs: **observed beats inferred.** Lint only on what a doc *says about
itself* — a declared "superseded" in a heading, never guessed similarity. Declared checks
scored 100%; inferred checks scored 4–25%.

---

## What it costs

Measured end-to-end, no extrapolation: every page was written as a real, individually-billed
`claude -p --model mid tier --output-format json` call, 3 concurrent, cost read from the
reported `total_cost_usd`.

| step | measured cost |
|---|---|
| scan / validate / plan / archive / index / lint / ledger / due | **$0** — pure script |
| group (cheap tier: 1 propose + 5 assign calls) | **$0.23** |
| write (mid tier, 10 pages, 5,669 source lines) | **$1.9664** |
| **total** | **$2.20** |
| **per 1,000 source lines** | **$0.39** |

An earlier extrapolated guess (~$1.60 total / $0.28 per 1,000 lines) was shelved rather than
trusted, and turned out to be wrong — the real number is 38% higher.

### The write cost law (n=10, R² = 0.96)

```
cost = $0.083 per page  +  $0.200 per 1,000 source lines
```

Per-page fixed overhead is **42% of the write bill** — page count matters almost as much as
total size. `docs-builder.cjs plan` prints this estimate before any writer launches; on the
bareloop test doc it predicted $1.96 against a measured $1.9664 (0.3% error). Per-page range
observed: $0.111 (191 lines) up to $0.403 (1,528 lines) — the *smallest* page cost more than
a separately measured 775-line page, which is the fixed term showing up directly.

**This flat/variable shape does not generalise across steps.** Every cheap-tier group call landed
at 35–41K tokens regardless of input size — flat cost. The mid-tier write calls are ~58%
input-driven — variable cost. Cost shape is a property of a step, not of the pipeline as a
whole; do not assume the group step's cost curve applies to the write step, or vice versa.

Pricing used: Haiku 4.5 at $1/$5 per million tokens, Sonnet 5 at $2/$10 per million tokens
(introductory, through 2026-08-31), looked up live. `total_cost_usd` is API-equivalent
cost, not plan billing.

---

## Knowing what changed — the ledger

git is the diff engine. The ledger stores only the one thing git cannot know: **when you
last consolidated.** Nothing is inferred, so the two cannot drift apart.

```bash
node docs-builder/docs-builder.cjs ledger   # stamp the current state
node docs-builder/docs-builder.cjs due      # what changed since, and by how much
```

`due` runs `git diff --numstat -M <sha>..HEAD -- docs/` and answers the three questions
separately — is this a **new** doc, a **moved** one, or an **edited** one, and if edited,
**how much of it** moved:

| kind | means |
|---|---|
| `new` | did not exist at the last consolidation |
| `moved` | same content, different path |
| `moved+changed` | renamed **and** edited, with the line delta |
| `changed` | `+added/-deleted of N lines (~X%)` |
| `deleted` | was in the ledger, gone from the tree |

A reorg is **due at 5 changed docs** — the same threshold and the same
derived-not-counted shape `/stash` uses. `due` only prints; it never runs `reorg` for you.

**Why not borrow OKF's ledger:** OKF contributes the frontmatter conventions (`verified`,
`sources`, `status`, `stale_after`) and those are already adopted. For change detection
there is nothing to borrow — git already records hashes, renames and line deltas. A second
bookkeeping system is just a second thing that can be wrong.

**Wired:** `/remember` runs `due` at the end of its own run (step 7), detect-only and
crash-isolated so it can never block a memory write. It stays silent in a repo with no
`docs/`, says so loudly if `docs/` exists but the check could not run, and otherwise prints
one line when a reorg is due. `/remember` never consolidates — `/docs-builder` owns the
ledger, `/remember` only reads it.

---

## Proven end-to-end

Run on a clone of bareloop (5,679-line PRD, 86 sections) on 2026-08-21: gate PASSED 86/86 at
5,669 of 5,669 lines, 11 pages written, **265 citations with 0 bad and 0 out of scope**,
original preserved byte-identical in `docs/archive/` and removed from its old path, index at
86 rows. **$2.70** for the run (**$2.41** for a clean re-run — one grouping pass was wasted on
a bug it then found). The cost law predicted the write step within **4%**.

It also found three bugs no unit test would have: keys a model cannot echo back, a `.js`
extension that is unloadable in `"type": "module"` projects, and a failed page writer leaving
a stub that made `plan` report "nothing to do" while two themes had no page. All three fixed;
see spec §18.

---

## What needs fixing

1. **The concurrency cap of 3 has no evidence behind it.** Its original justification —
   "launching 10 writers killed 9 of 10 mid-run" — turned out to describe lost per-call
   *cost accounting* (subagents don't itemize cost), not lost pages. All ten pages were
   found complete on disk with 299 citations at 0 bad / 0 out-of-scope. The cap of 3 is an
   untuned precaution with nothing measured behind the specific number 3.

2. **Chunk size (40–50 vs the current ~20) is untested.** Low priority now — the group step
   is $0.23 of a $2.20 bill, so halving it saves under 5% of the total.

3. **Mechanical clustering was cut on n=1 evidence.** tf-idf clustering gave a 42% blob and
   lost to a naive sequential chop (0.733 vs 0.829) — but the test corpus was
   `FINDINGS.md`, an append-only chronological log, where a chop wins *by construction*.
   Doesn't establish anything about non-chronological docs. Only matters if the $0.23 group
   step is ever worth removing.

4. **Page density is unjudged.** Pages from direct `claude -p` calls ran at roughly half the
   prose of the subagent-written pages (1,116 vs 2,251 lines) at the same citation count
   (294 vs 299) — twice the density. Both are fully grounded. Which reads better is
   untested; a reader test is the only thing that would settle it.

5. **`uncited` and `redundant` lint checks are propose-only — they never act, and should
   not be made to.** The distinction matters: **uncited is a fact, deletable is a
   judgement.** bareloop's `O2`, `O3`, `O4` sections are genuinely uncited anywhere in a
   211-file repo sweep — and must NOT be removed. They are the middle of a coherent
   `O1`–`O5` series, and `O1` *is* cited, from `CHANGELOG.md` and `PRD.md`. Reporting
   "uncited" as "delete this" would propose deleting live, correct docs. The check reports
   the fact and stops there, by design.

6. **~~Not replicated to droid, opencode, or ampcode yet.~~ Mostly done.** All four packages
   ship a byte-identical `docs-builder.cjs`; the stale v1 `templates.md` was removed from the
   three non-Claude packages, and `/remember`'s step-7 docs check was mirrored too.
   `~/.claude/` is synced (v1 skill removed — a same-named skill and command would collide).
   **Still outstanding:** the invocation menu and the `argument-hint` frontmatter fix exist
   only in `packages/claude/`; agentic-toolkit not started.

7. **The invocation menu has not been validated by use.** Its frontmatter is verified to
   match sibling commands and the two options are specified, but nobody has run a bare
   `/docs-builder` and taken each option end-to-end. Spec, not evidence — and this document
   is otherwise careful to only claim what was measured.

8. **Two bugs the build caught that the POC did not** — worth watching for the same class:
   - **The key contract.** Full untruncated headings scored against the POC's
     silently-truncated keys produced 55 invented + 55 missing out of 86. Fixed by one
     shared key function, used by both the prompt and the validator, with guaranteed
     uniqueness (not merely assumed).
   - **Path resolution.** Source `.md` paths are repo-relative; pipeline JSON artifacts are
     cwd-relative. Conflating the two made `plan` look for `outline.json` inside the repo
     being documented, instead of the working directory. Four more instances of the same
     conflation were found later, in `archive`, `validate`, and `apply-reorg` — see
     *History*. Any new code touching an artifact path must use the cwd-relative helpers.

---

## History of things that were wrong

The spec is explicit about its own corrections. That is a feature of the document, not an
embarrassment — it marks which claims are load-bearing and which turned out to need
revision.

- **"F105 was invented" → actually duplicated.** POC A's positional-index failure produced
  an `F105` that looked fabricated. It is a real heading (`FINDINGS.md:8150`); the failure
  was positional misalignment duplicating a real key, not fabrication. (`F65`, separately,
  genuinely has no heading — a real numbering gap the model tried to paper over.)

- **"86/86 byte-exact key accuracy" → scored against silently truncated keys.** The POC's
  perfect score was an artifact: the prompt truncated headings at 110 characters, and the
  validator was scored against the same truncation, so both sides agreed by construction.
  Feeding the validator full, untruncated headings produced 55 invented + 55 missing. Fixed
  by an explicit `records[].key` field, guaranteed unique, generated once and echoed back.

- **"10 concurrent writers, 9 of 10 died" → all ten pages were actually fine.** All ten
  `prdpage-*.md` files were found on disk, complete, with 299 citations at 0 bad / 0
  out-of-scope. What was actually lost was per-call *cost accounting* — subagents don't
  itemize their own token cost. The concurrency cap of 3 was set on this now-corrected
  claim, which is why §F1 calls it unevidenced.

- **"Never move CLAUDE.md, .github/, node_modules/" → the code did not enforce any of it.**
  The list existed only as prose in the command doc. `walkMd` protected exactly three names
  (`README.md`, `index.md`, `log.md`) and only at the top level of `docs/`, and it recursed
  into every directory including dot-dirs. On a fixture with the protected files one level
  down, the old code put **5 of 6** into the move plan — `.github/`, `node_modules/`,
  `.claude/`, and a nested `README.md` among them. Now enforced by `PROTECTED_NAMES` plus a
  dot-dir/`node_modules` skip; the same fixture yields 1 candidate, the one real doc.

- **"Path resolution is fixed" → it was fixed in `plan`, and still broken in four other
  places.** A `REPO`-vs-cwd review of the whole file found `rewriteArchivedPath`,
  `checkCitations`' tasks dir, `failures.json`, and `applyReorg`'s plan path all resolving
  against `REPO` while their writers wrote cwd-relative. Run from outside the repo, the
  archive key-sync silently no-opped (the exact failure it was added to prevent), the
  citations gate LOUD-SKIPped so `validate` returned PASS on bad citations, and
  `apply-reorg` died immediately after a successful `discover`. One conflation, five sites —
  fixing the site that hurt first did not fix the class.

- **"Supersession lint is 100% precision" → collapsed to 40%, then fixed back to 100%.**
  24/24 on bareloop alone (n=1 repo). Re-run on three unrelated corpora, precision fell to
  2/5 (40%): the term `invalidat\w*` matched the ordinary heading "Cache Invalidation" three
  times in aurora. Dropping that one term restored 24/24 across all four repos, at a stated
  cost of 2 real bareloop hits no longer caught — explicit, consistent with the project's
  precision-over-recall stance.

- **"Carry-forward keeps a row's classified bucket" → it also carried legacy pre-v3 values.**
  Found on a real run: an old plan's `bucket: "oversized"` was carried forward verbatim on a
  re-run of `discover`, which then made `apply-reorg` refuse the plan as stale schema.
  Carry-forward now accepts only a currently-valid bucket (`product`/`logs`/`archive`); a
  legacy value is dropped so the row starts unclassified and goes through the normal
  interview.

- **"Archive is byte-frozen" → a later row's own sweep could still edit it.** Measured: a real
  reorg run rewrote 21 lines inside an archived PRD. Cause was the exemption testing a file's
  CURRENT location, one row at a time — a file bound for `archive` but not yet moved still
  read as "not resident" the instant an earlier row's link-repair sweep ran, so it absorbed an
  edit before its own move carried it in, arriving in `docs/archive/` already changed. Fixed
  by testing a row's PLANNED destination instead, computed once (`plannedArchiveSrc`) before
  the move loop starts, so an archive-bound doc is exempt from the run's very first rewrite,
  not only from whenever it happens to move. One predicate, `isRewriteExempt`, one call site
  — generalizing the same rule already applied to `CHANGELOG.md`/`log.md`. Links elsewhere
  that point AT an archived file are still repaired; only the archived file's own bytes are
  frozen.

- **"There is one index.md" → there were two writers racing for the same file.** The themed
  `index` subcommand used to default to the same path `apply-reorg`/`index-flat` write.
  Real defect on bareloop: `apply-reorg` wrote the 37-row whole-corpus map, then a PRD
  split's `index` step ran afterward and silently overwrote it with only that split's own
  7-row themed view — 30 of 37 files vanished from a file that still claimed completeness.
  Fixed by giving the themed view its own file, `docs/wiki-index.md`, a sibling in the same
  directory; `docs/index.md` is now `index-flat`'s alone to write.

---

## Sources

`docs/archive/docs-builder-v2-spec.md` (scan/validate/plan/write/archive/index mechanics,
cost law, borrowed mechanics, ledger, the honest label — all still current), `docs/product/
docs-builder-v3-spec.md` (four buckets, the classification interview, oversized-as-boolean,
the two-index split, `reorg`'s current shape — the CURRENT architecture, superseding v2's
mode layout), `docs-builder.cjs`, `docs-builder.md`, `POC-E-RESULT.md`.
