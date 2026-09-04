---
type: reference
title: docs-builder
status: draft
updated: 2026-08-24
---

# docs-builder

`/docs-builder` splits a documentation file once it outgrows its row in `docs/index.md`,
keeps the resulting pages current, and generates an index so they can be found. It is a
**slash command**, not a skill: `commands/docs-builder.md` plus a bundled
`commands/docs-builder/docs-builder.cjs` (vanilla Node, zero deps, fourteen subcommands) —
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

Splitting a corpus does not make it cheaper to read. Do not reach for this tool as a token
saving or a reading-time saving — it is not one.

### So what does it actually buy you

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
6. ARCHIVE   script   original -> docs/archive/ via verified `git mv`, which also frees
                       the original's path for the core page cleanup-apply relocates there
7. INDEX-FLAT script   docs/index.md — the ONE index, whole corpus, rebuilt after the split
   LINT      script   supersession (act) / uncited + redundant (propose only)
```

**Steps 1, 3, 4, 6, 7 and lint are pure script — zero cost, zero model calls.** Only 2 and 5
touch a model: step 2 is cheap tier, step 5 is mid tier. That split is the central design
decision. Bookkeeping — counting, matching keys, checking a list — is mechanical, so a
script owns it; the model is only asked to judge and to write.

### Walkthrough with the real commands

**1. Scan** — one JSON record per H2, each carrying the doc's H1 identity, a two-line
snippet, and every H3 with its own start/end line so a page writer can pull a sub-section
alone.

```bash
REPO=<repo> OUT=outline.json node docs-builder.cjs scan docs/BIG.md
```

**2a. Propose themes (cheap tier, one call over everything)** — feed every `records[].key` plus
its snippet, ask for a fixed list of themes with one-line glosses, aim for no theme holding
more than ~30% of the lines. **This pass is load-bearing**: skipping it fails even when
every key is assigned correctly.

**2b. Assign (cheap tier, chunks of ~20 sections)** — each section gets a theme from that fixed
list, echoing `records[].key` back verbatim. Never re-derive or prettify the key; the script
already guaranteed it's unique.

**3. Validate (script, hard gate)** — exits 1 on failure. Do not proceed on FAIL; re-run the
failing chunk.

```bash
node docs-builder.cjs validate outline.json labels.json
```

**4. Plan (script)** — writes `task-<theme>.json` per page and prints the estimated write
cost.

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
link-repair sweep does in the same run.

```bash
REPO=<repo> node docs-builder/docs-builder.cjs archive docs/BIG.md
```

**7. Index-flat (script)** — rebuilds `docs/index.md`, the corpus's one index, so it
captures the split's new shape: the archived original, the core page back at the original's
path, and the remaining pages under `PAGES`. Run automatically as the last step of
`cleanup-apply`; `apply-reorg`/`reorg` call the same thing (see Mode 2 below).

Each row is `[H1](path) — N lines`, followed by one indented line per H2 heading with its
`(L<start>–<end>)` range, so an agent can slice-read a section without opening the doc.
Archive rows stay H1-only (that bucket is frozen and unbounded).

```bash
REPO=<repo> node docs-builder.cjs index-flat                # -> docs/index.md
```

**Lint (script)** — declared-only checks.

```bash
REPO=<repo> OUT=lint.json node docs-builder.cjs lint $(git ls-files 'docs/*.md')
```

---

## How you invoke it

**The script lives next to the command, not in your repo.** Every `node
docs-builder/docs-builder.cjs …` in the spec is relative to the command's own directory
(`~/.claude/commands/` once installed); the target repo is whatever `REPO=` names, defaulting
to the cwd. The spec now says so up front — before it did, a run on an external repo searched
the target tree for the script, found nothing, and refused (see History).

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

**One index, one writer.** `docs/index.md` is written by `index-flat` and nothing else.
There used to be a second, themed per-split index, and it was never asked for: it caused a
corpus-map clobber, an `outline.json` clobber across concurrent splits, and a lowercasing bug
that displayed a real page as "pending". Splitting it into its own file only relocated the
problem, so it was **removed outright on 2026-08-24** — see "History of things that were
wrong".

**Never moved — enforced in code, not just documented.** Two guards in `docs-builder.cjs`:

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
**boolean** (over `OVERSIZED_LINES`, default 500 — size decides *splittable*, never
*sorted*), and a mechanical `suggested` bucket + `reason`: a
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

**Why `logs/` exists.** Without it, experiment records — pregregs, results, learnings —
pile up next to actual specs and designs, and `product/` stops being useful for finding a
spec. `logs/` is history that still matters, distinct from `archive/`, which is history
that is done.

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

