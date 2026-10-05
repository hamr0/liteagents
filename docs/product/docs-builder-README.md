---
type: reference
title: docs-builder
status: current
updated: 2026-10-01
---

# docs-builder

`/docs-builder` splits a documentation file once it outgrows its row in `docs/index.md`,
keeps the resulting pages current, and generates an index so they can be found. The
instructions are `skills/docs-builder/SKILL.md` on Claude and Amp (`commands/docs-builder.md`
on Droid, `command/docs-builder.md` on opencode), with the bundled `docs-builder.cjs`
(vanilla Node, zero deps, fourteen subcommands) in the `docs-builder/` directory beside it —
the same shape as `/remember`.

It ships in all four packages. `docs-builder.cjs` hardcodes no tool-specific paths, so it
is **byte-identical** across `claude`, `droid`, `opencode`, and `ampcode` (a test pins the
four copies). The instruction doc differs per package in more than one line: its
frontmatter, and the config file the docs pointer goes to (`CLAUDE.md` / `AGENTS.md`). This
is a stronger guarantee than `friction.cjs`, which does bake in tool paths and therefore has
to be maintained as four near-copies.

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
REPO=<repo> node docs-builder.cjs scan docs/BIG.md   # -> docs/.docs-builder/outline.json
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
node docs-builder.cjs validate   # outline.json + labels.json default to docs/.docs-builder/
```

**4. Plan (script)** — writes `task-<theme>.json` per page and prints the estimated write
cost.

```bash
node docs-builder.cjs plan   # -> docs/.docs-builder/tasks/
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
REPO=<repo> node docs-builder.cjs lint $(git ls-files 'docs/*.md')   # -> docs/.docs-builder/lint.json
```

---

## How you invoke it

**The script lives next to the command, not in your repo.** Every `node
docs-builder/docs-builder.cjs …` in the spec is relative to the command's own directory
(`~/.claude/skills/` once installed); the target repo is whatever `REPO=` names, defaulting
to the cwd. The skill says so up front — before it did, a run on an external repo searched
the target tree for the script, found nothing, and refused.

**Bare `/docs-builder` never guesses.** It runs `due` for context, then asks — two
options, no recommendation, no third:

| Option | What it does | Cost |
|---|---|---|
| **First run** | sort every `.md` into product/wiki/logs/archive, then split anything too big | spends model budget |
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
has the model fill `bucket` (`product`/`wiki`/`logs`/`archive`) for every row, and only then is
the full table shown for approval via `AskUserQuestion` (approve all / correct specific
rows / abort) — that stop guards **correctness**: `apply-reorg` refuses outright to run
while any row's `bucket` is still empty, so nothing moves on an unreviewed plan. After the
moves, the oversized-file list is printed with line counts (`cleanup` itself prints the
estimated cost for the one file you pick) and you choose which to split — that stop guards **cost** (~$0.39 per 1,000 source lines). Never
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
| `/docs-builder reorg` (discover, classification interview, confirm, then apply-reorg) | *First run*, steps 1-3 | classify a WHOLE corpus into product/wiki/logs/archive | no (moves are `git mv`, plan classified and reviewed first) |
| `/docs-builder cleanup <file.md>` | *First run*, step 3's split question | measure ONE named oversized doc (cost, scan, heading shape) → **stops for the interview** | no (measure-only; original preserved) |
| `/docs-builder reorg` (bare `docs-builder.cjs reorg`) | *Docs drift* | `due`'s drift summary (if a ledger stamp exists) + discover → (stops here if any row has no `bucket`) → apply-reorg → lint, whole corpus | no |
| `/docs-builder search <query words...>` | *(none — explicit-argument mode only, never in the bare picker)* | BM25-rank sections of `docs/.docs-builder/outline.json` against the query, read-only | no |

`reorg` and `cleanup` solve different problems and compose: `reorg` sorts a whole messy
`docs/` tree into the product/wiki/logs/archive layout in one pass and **never splits anything
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
standalone `validate` and `index-flat` subcommands, unchanged, still runnable by hand once
a `labels.json` exists. (The themed `index` subcommand was removed on 2026-08-24.) The old `archive-cleanup` command (pruning `docs/archive/`) was
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
                       Three sections: ## Product, ## Logs (grouped by subdir), ## Archive.
  log.md               append-only:  ## [DATE] operation | description — written by
                       `archive`, `apply-reorg`, `validate`, `reorg`, `index-flat` (so
                       `cleanup-apply` too); not by read-only commands (`due`, `search`,
                       `discover`).
  product/            docs ABOUT THE PRODUCT ITSELF — the default. FLAT, no subdirs.
                       `apply-reorg` MOVES files here (`git mv`); content is never rewritten.
                       Re-checked every reorg (only archive/ stays frozen).
  wiki/                GENERIC, not-product-specific knowledge — conventions, how-tos,
                       standards, reference. FLAT, no subdirs. Also where Mode 1
                       (`cleanup`)'s page writers put synthesised pages. Re-checked every
                       reorg, same as product/.
  logs/                ONE-TIME, timely knowledge — POCs, experiments, investigations,
                       incident/session write-ups, reports. Same MOVE discipline as
                       product/wiki/archive, but the ONLY bucket that may nest, ONE level:
                       the group is the file's FIRST path segment under docs/ (a special
                       subfolder like docs/fwd/ is one group, however deep a file sits
                       inside it), unless that segment is itself a bucket name. A
                       `discover <dir>` scan outside docs/ uses the file's own path:
                       `discover src` puts src/x.md and src/a/b.md in docs/logs/src/.
                       See "Why `logs/` exists" below.
  archive/             what got cleaned up: self-declared dead. FROZEN — never re-checked.
                       Originals are BYTE-FROZEN —
                       never a rewrite target, so a doc lands byte-identical to what it
                       carried in. Links elsewhere pointing AT it are still repaired.
                       Pruning is the user's own call (`git rm`) — nothing here does it
                       automatically.
  .docs-builder/       machine-only state: ledger.json, outline.json, cleanup-shape.json,
                       labels.json, reorg-plan.json, validate.json, failures.json,
                       lint.json, tasks/, commit-add.txt, commit-files.txt, commit-dirty.txt
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
problem, so it was **removed outright on 2026-08-24**.

**Never moved — enforced in code, not just documented.** Two guards in `docs-builder.cjs`:

- `PROTECTED_NAMES`, matched **case-insensitively at any depth**: `README.md`, `index.md`,
  `log.md`, `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `AGENT.md` (so `readme.md`/`Claude.md` are
  protected too, not just their exact-case forms). Bare `LICENSE`/`NOTICE` carry no `.md`
  extension, so the walker never sees them.
- `walkMd` skips every dot-dir (`.git/`, `.github/`, `.claude/`, `.factory/`, `.opencode/`,
  `.amp/`, `.docs-builder/`) and `node_modules/`, plus the dirs reorg itself owns
  (`product/`, `logs/`, `archive/`, `wiki/`) so a second run is idempotent — **except**
  the bare, no-directory `discover`/`reorg` call, which re-enters `product/`, `wiki/`, and
  `logs/` on purpose to re-check their residents every run; only `archive/` stays skipped
  there too.

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

**`discover` no longer classifies — it enriches and proposes.** With no directory named,
the scan scope is root-level `.md` files (non-recursive) plus everything under `docs/`
(recursive); `discover <dir>` / `reorg <dir>` scope to exactly that one directory instead.
Within `docs/`, `product/`, `wiki/`, and `logs/` are re-checked every run — only
`archive/` stays frozen and skipped, along with `.docs-builder/` and the protected
entry-point docs. Gitignored `.md` files (generated output such as a `TEST_REPORT.md`) are skipped
in both scopes; untracked-but-not-ignored files are still offered. For every file in scope it writes a row carrying `h1`, a short `snip`, an `oversized`
**boolean** (over `OVERSIZED_LINES`, default 500 — size decides *splittable*, never
*sorted*), and a mechanical `suggested` bucket + `reason`: a
PRIOR the classification interview is shown, never an authority over it. `bucket` itself
starts **empty on every row** — that's the field the interview fills, and the only field
`apply-reorg` reads to decide where a file goes. `review` no longer exists as a bucket: a
no-H1 file with no strong signal is just an ordinary unclassified row, same as any other,
that the interview decides like everything else.

The classification interview: feed the model the whole plan table (file, h1, snip, lines,
suggested+reason) in **one call**, have it fill `bucket` (`product`/`wiki`/`logs`/`archive`) with
a one-line reason per row, write the answers into `reorg-plan.json`, then show the user the
rows in chat, then ask `AskUserQuestion` — approve all / correct specific rows / abort. The
approval list has a mandated shape: **one line per row**, `from <file> to <dest> · <lines>
lines · <bucket>` plus ` · why: <reason>`, shown in a normal chat message (a multi-column table
renders malformed inside the question). `<dest>` is the row's **full destination path**
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
starts unclassified. `apply-reorg` records each moved file's NEW path and its bucket in the
plan (it is the only command that changes a path), so after a first sort the next bare
`reorg` matches every file again and stops only for rows with no bucket (new files, or files
moved since). Before 2026-10-01 the plan kept the OLD paths, so the first drift run after a
sort re-asked for every file. Carry-forward only accepts a currently-valid bucket — a legacy pre-v3
value (`oversized`, `review`) is dropped rather than carried, so that row starts
unclassified instead of making `apply-reorg` refuse the whole plan as stale schema.

**`apply-reorg` now writes a docs pointer into the repo's own agent config file.** A
marker-wrapped `<!-- DOCS_INDEX:START -->`/`<!-- DOCS_INDEX:END -->` block naming
`docs/index.md` as a **plain path, never an `@`-reference** — hot-loading a large index into
every session is exactly what this avoids — plus the same search hint `index.md` itself
carries. `CONFIG=` picks the target (default `CLAUDE.md`), because the script is
byte-identical across all four packages but their config filenames differ (`CLAUDE.md` /
`AGENTS.md`; the ampcode kit uses `CLAUDE.md`). Idempotent: an existing block is replaced in place, never
duplicated; the rest of the file is left alone.

**A commit advisory now closes both `apply-reorg` and `archive`.** `git mv` stages a rename
immediately — nothing in this tool's output ever said so, and it was confirmed twice, in two
different repos, where another session's `git add -A` silently folded the staged renames into
an unrelated commit. The advisory names the staged rename count, the unstaged link-rewrite
count, and the number of `.md` files with link rewrites, then prints a one-line recipe (`git add --pathspec-from-file=docs/.docs-builder/commit-add.txt && git
commit -m "docs: reorg" --pathspec-from-file=docs/.docs-builder/commit-files.txt`) that
captures both in ONE commit — exactly this run's files, renames kept, and nothing else the
user has staged or edited. It is deliberately never scoped to `docs` alone, since the link
rewrites the moves trigger reach outside `docs/` too (`src/`, `scripts/`, `tests/`,
`README.md`) and a `docs`-scoped commit would ship moved files with their inbound links
unrepaired. A listed file that already carried the user's own uncommitted edits is named in
`commit-dirty.txt`, and the skill asks before committing. Nothing is ever auto-committed.

A move command that moved nothing but still rewrote `docs/index.md` (or the pointer block) prints a
fresh recipe too, so the lists never carry an earlier run's files; `reorg` stopping for the
classification interview writes only `docs/log.md` and prints none.

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

## Why the skill works this way

`packages/claude/skills/docs-builder/SKILL.md` holds the steps, the exact menu and
interview text, the hard rules (one line each, each pinned in
`tests/skill-shell/skill-shell.test.js`) and one final report block. Everything below is the
reasoning and the evidence behind them, moved out of the skill so it can stay short.

### Model tiers

| step | tier | why |
|---|---|---|
| propose + assign themes, read a doc for the interview | **cheapest tier** | structured labelling against a fixed list; no synthesis |
| write pages | **mid tier** | semantic synthesis, cheaper and faster than the top reasoning tier |

The skill never names a vendor model: names drift, and an omitted tier silently inherits the
parent's, so the skill says to state the tier explicitly. The numbers below were measured on
Claude Haiku 4.5 (cheap) and Sonnet 5 (mid) in August 2026 — the ratios and shapes carry over,
the absolute prices do not.

### The script owns the mechanics

Bookkeeping done by a script is 100% correct; done by a model it measured 27%. So the model
is used for exactly two things and the script does the rest. The same reasoning keeps moving
hand-built output into the script: the approval table's destination column (collision
suffixes, the `logs/` group, sort order) was the riskiest thing the model computed by hand.

What the script prints for the model to relay, so it never composes them:

- `PREVIEW=1 node $DB apply-reorg` — `approval table — N row(s), sorted by destination`, one line
  per row `from <file> to <dest> · <lines> lines[ (oversized)] · <bucket>`, then `preview only
  — nothing moved, nothing written.`; exit 1 on an unclassified plan. It shares
  `destinationsFor()` with the real run, so the preview can never disagree with the move. It
  prints no `why`: the reason is the model's judgment, appended when it shows the rows.
- The commit advisory tail — `BRANCH: <name>` (on `main`/`master`: `do NOT commit`),
  `QUESTION: Commit these N files now?` (naming files that already carried the operator's own
  edits), and `WARN: docs/.docs-builder/ is not gitignored — …` via `git check-ignore`. The
  script never edits `.gitignore` (it only ever writes `.md` files plus its own state).
- Every task file carries a `brief` field with the page-writer rules (frontmatter, at least
  10 lines, citations, 250-line ceiling). Before it existed the criterion was told to the
  writers only if the orchestrator remembered; a bareagent field run documented it only in
  the lint section, so the first wave produced `PARTIAL` pages and had to be redone.
- `validate`, `plan`, `cleanup-apply` default their outline and labels to
  `docs/.docs-builder/outline.json` and `labels.json`; `search` defaults its outline the same
  way (a first argument ending in `.json` is the outline path, so a typo errors instead of
  becoming a query word). That made the five multi-line, brace-expanded commands single-line.

### Why bare `/docs-builder` always asks

Auto-detecting the mode was considered and rejected: the two options differ in cost (an
unreviewed first-run plan versus a cheap drift check), and a wrong guess on the first one is
expensive to unwind. `search` is deliberately not a third picker option: it is read-only and
costs nothing, so it is not a decision that needs a recommendation.

### The two stops in First run

Step 2 (the interview and approval) guards correctness. The split question after
`apply-reorg` guards cost: splitting is about $0.39 per 1,000 source lines and the user has
seen neither the list nor the number when picking "First run". Never split N files in one
shot on an unseen list.

### Drift

Bare `reorg` composes `discover` and `apply-reorg`. Discover carries a row's `bucket` forward
by file path. Until 2026-10-01 `apply-reorg` left each moved row at its OLD path, so the
first drift run after a sort printed "N of N row(s) still need classification" and stopped.
Now `apply-reorg` writes each moved row's new path (and bucket) back into the plan, so a bare
`reorg` stops only for rows with no bucket. `/remember` also runs `index-flat` on any drift
(not only when a reorg is due), which is why `docs/index.md` and `docs/log.md` can change
under a `/remember` run.

### `suggested` — the mechanical prior

First match wins:

| suggested | rule |
|---|---|
| `archive` | path already under `archive/old/reports/phases`, **or** the doc's own opening declares a SHOUTED status word (`CLOSED`, `DEPRECATED`, `SUPERSEDED`, `WITHDRAWN`, `RETRACTED`, `REFUTED`, `ARCHIVAL`, `ARCHIVED`), **or** the filename has an archive-shaped prefix (`REPORT`, `STATUS`, `SUMMARY`, `FIX_`, `PHASE_`, `SPRINT_`, `DRAFT`, `WIP`, `OLD`, `TEMP` + `-`/`_`, case-insensitive) |
| `logs` | filename carries an experiment-record token — `PREREG`, `LEARNINGS`, `REPORT`, `RESULTS`, `POSTMORTEM`, `RETRO` (case-sensitive, word-boundary, checked only after the archive rules) |
| *(residency)* | already under `docs/product/`, `docs/wiki/` or `docs/logs/` — its own bucket is its prior; a stronger signal above can override |
| `archive`/`logs`/`wiki` | a weaker, case-insensitive prior from the H1 + first 3 H2s ("Postmortem"/"Retrospective"/"Investigation" → `logs`; "deprecated"/"retired"/"superseded" → `archive`; "Conventions"/"How-to"/"Style Guide"/"Glossary" → `wiki`). Bare "guide"/"reference" were tried and dropped after false-positiving |
| `product` | has an H1 and no other signal (the default) |
| `product` | no H1 but an include stub (≤3 lines of include directives and/or links) — a live pointer, not an unknown doc (uv's `docs/reference/contributing.md`) |
| `product` | no H1, not a stub — no signal either way; the interview decides |

### Why classification is the model's job, behind a gate

The FROZEN incident (below) is usually read as proof a model must not classify. The failure
was a mechanical rule that moved files with no gate at all: the silent move, not the
judgement. The approval gate is the safety property and it is strictly stronger than a rule
that moves files unreviewed.

### Why the status check wants SHOUTED caps, case-sensitively

Tried case-insensitive first, against a real, uncrafted corpus. It false-positived three ways:
`"Supersedes **nothing**"` (negation), `"this rung BUILDS three frozen records"` (an input
being described), `"archived spines"` (data the doc references). Restricting to ALL-CAPS fixed
all three, because that corpus's own convention SHOUTS a real self-declaration
(`**Status: CLOSED**`). `FROZEN` was in the list until 2026-08-23: on bareloop's real docs
(37 files) 10 of its 12 `archive` calls were false positives (`"design FROZEN... build follows
this record"` means locked and still current). It was dropped with no replacement, trading 2
real misses (`"Frozen 2026-07-26"`) for precision; a miss lands the doc in `product`, one
bucket short of ideal, never mis-archived. A dated filename as a staleness signal was also
dropped: `2026-07-28-p-palette-design.md` is a current, locked spec.

### Why `logs/` exists

On bareloop's real `product/` (27 files) 11 were experiment records (8 `*-PREREG`, 2
`*-LEARNINGS`, others) next to 14 real specs: 41% of the bucket was run history, which made
it useless for finding specs. `logs/` is history that still matters; `archive/` is history
that is done.

### One index, one writer

A second, themed per-split index once existed beside `docs/index.md`. Running a PRD split
after a reorg overwrote the 37-row whole-corpus map with that split's 7-row view: 30 files
vanished from a file that still claimed completeness. Separating them into two files only
moved the problem (it then clobbered `outline.json` across concurrent splits), so the themed
index was removed outright on 2026-08-24. `index.md` deliberately stays visible, outside
`.docs-builder/`: the measured winning arm is pages plus a coarse index.

### After a move: what is repaired

All moves go through one function, `moveDoc`, so no follow-up can be added to one mover and
missed by the other (that exact miss shipped three times). It throws only if the move failed;
a failed follow-up is collected so a moved file is never reported as needing a re-move.

- **Pipeline artifacts:** `rewriteArchivedPath` syncs `outline.json` / `labels.json`
  (`records[].file` and the `<file> :: ` key prefix).
- **Inbound links:** every tracked-or-untracked-not-ignored `.md` file (untracked so a split's
  brand-new pages are fixed too). Repo-rooted exact paths are matched with a lookbehind and
  lookahead (`xdocs/A.md`, `./docs/A.md`, `docs/A.md.bak` are not matches; a sentence-final
  `docs/A.md.` is). Relative markdown links (`[t](../x.md)`, `[l]: ./y.md`) are resolved from
  the scanning file's directory and rewritten with `#fragment` kept; the moved file's own
  relative links are re-based so a link whose source and target both move still resolves.
  **Fence-aware:** a fenced code block is never rewritten by either pass (a path in a snippet
  is something the reader copies verbatim). An inline code span is skipped by the
  relative-link pass (`map[key](arg)` is code, not a link) but NOT by the exact-path pass: a
  backticked `docs/GUIDE.md` in prose is a real reference to the moved file. Earlier versions
  of the skill claimed the rewrite was not fence-aware; that was stale.
- **Why rewriting is safe when the dangling-reference lint was cut:** the lint had to infer
  that `P95` was a reference (1/27 precision); the rewriter holds the old and new path at the
  instant it breaks the link and infers nothing.
- **Never rewritten:** `CHANGELOG.md` and `log.md` at any depth (a record of where a file was
  is not a broken link); anything resident under `docs/archive/` (evaluated on a row's
  destination, since a reorg fills the archive mid-run — otherwise an earlier row's sweep edited
  the doc before it moved in, measured). Links elsewhere that point AT an archived file are
  still repaired.
- **Only `.md` files:** bareloop, 2026-09-10, a version that also scanned `.js`/`.cjs`/`.mjs`/
  `.json`/`.yml` rewrote 6 signed JSON job specs (breaking their hashes), a byte-signed
  `.mjs`, and a code comment that tripped a commit gate.
- **Restore pass:** `cleanup-apply` archives the original (every inbound link now aims at
  `docs/archive/`), then relocates the core page back to the original path, then walks the
  inbound links back from the archive to the core page. The split's own pages are exempt:
  they cite the original by line number, so their `sources:` and citations stay on the frozen
  copy. On a real split that was 33 references across 15 files outside `docs/`.

### Finishing a run

`apply-reorg`/`archive`/`cleanup-apply` never auto-commit; `git mv` stages a rename
immediately, and twice, in two repos, another session's `git add -A` folded the staged renames
into an unrelated commit. The recipe is a pathspec-from-file pair so exactly this run's files
(renames kept) land in one commit. A hand-rolled recipe once omitted `docs/log.md` and the
operator quietly added it (privcloud first field run): a silent repair is a lost bug report,
so a recipe error is reported, not repaired. The ledger stamp must follow the commit or `due`
stays NOT due forever and `/remember`'s nudge never fires. Both picker flows end with it.

### Cleanup

The original always ends up in `docs/archive/` byte-identical; everything the split produces
is a new file, the core page included (it takes the original's basename and goes back to the
original's directory, so a reader who knows where "the PRD" lives still finds it — before
that, a split left `CLAUDE.md`'s canonical-PRD reference pointing into the archive). `cleanup`
is a measure step: it prints the shape (`86 sections: "§N ..." — 11 sections, 193 lines (3%);
"Addendum vN.N ..." — 75 sections, 5,476 lines (97%)`) from heading text alone, never from what
a section is about. The interview's "mainly" answer must change what gets built or it is
auto-detect in a costume.

- **Key format** is always `<file> :: <heading>`; it once dropped the prefix for a
  single-file scan, so a `labels.json` from a single-doc cleanup stopped matching after a
  corpus-wide rescan.
- **2a is load-bearing:** assigning directly gave 68 themes for 86 sections, 57 singletons —
  perfect key accuracy, useless grouping. Chunking fixes misalignment; only global sight fixes
  convergence.
- **2b rules, each paid for:** one call over 97 sections keyed on `{index, id}` dropped 1,
  shifted 41 IDs and repeated a heading; a bare `KEY: <text>` line made the model glue snippet
  text onto 6 of 86 keys (a key truncated mid-sentence has no visible end), hence the
  `<<<KEY>>>…<<<END>>>` delimiter; the script also trims keys because a truncation landing on
  a space produced 5 more failures.
- **Pages:** 250 lines is a ceiling; measured, every page came in under it unprompted; 294
  citations, 0 bad. The concurrency cap of 3 is a checkpointing choice, not a measured one.
- **`validate` `links`** checks every relative `.md` link in `INDEX`; it once scoped itself to
  `PAGES` links for the themed index that is gone, which on the whole-corpus index silently
  skipped most rows.
- **Archive exit codes:** 0, 1 (nothing moved), 2 (moved, follow-up failed). `cleanup-apply`
  also exits 2 when the original moved but the core page was not relocated and the index was
  not rebuilt: do not re-run it (the file is gone); relocate the core page and run
  `index-flat`.

### Search

Row count decides whether an index helps or hurts: 16 rows fine, 97 rows won, 364 rows lost
(an H3-grain outline as a reader index was the worst arm). Past about a hundred rows, look
sections up. `search` can only rank what has a record: `apply-reorg` re-scans the whole corpus
into `outline.json` every run. Before that, on a real 37-doc corpus `outline.json` held
records for the 12 files a split had touched and none of the 24 `docs/product/` files, so
search was blind to them. `index-flat` warns on archive growth at 100 rows (`ARCHIVE_WARN_ROWS`,
a hard-coded constant, not an env var; `OVERSIZED_LINES` is an env var).

### Lint

| check | precision | how to treat it |
|---|---|---|
| `supersession` (declared in a HEADING) | 24/24 across 4 repos | act on it |
| `supersessionInBody` | not measured | read, never act |
| `uncited` (repo-wide sweep) | fact, not a verdict | propose only |
| `redundant` (shared verbatim sentences) | 1/4 | propose only |

Observed beats inferred: declared scored 100%, inferred 4–25%. Dangling-ID and duplicate-ID
checks are cut (`P95` is a percentile). `uncited` must be repo-wide (scoped to the corpus it
flagged two live docs cited from a logs file and `CHANGELOG.md`), and uncited is not deletable
(`O2`–`O4` are the middle of a coherent series). Frontmatter makes a low-precision flag safe:
a flag is a proposal and confirmation is recorded in the file (`type` required; `title`,
`status`, `sources`, `verified`, `stale_after` optional, `stale_after` only when asked and
answered).

### Cost

End to end on a 5,669-line doc → 10 pages: $2.20, or $0.39 per 1,000 source lines (group step
$0.23, write step $1.97). The script prints the write law: `$0.083 per page + $0.200 per 1,000
source lines` (n=10, R² 0.96); 42% of the write bill is per-page overhead. Cheap-tier group
calls were flat at 35–41K tokens regardless of input size, which does not generalise: the
mid-tier write calls are ~58% input-driven.

### Open

1. Chunk 40–50 versus 20 is untested (under 5% of the bill).
2. The concurrency cap of 3 is not tuned; its original justification described lost cost
   accounting, not lost pages. A quality hypothesis, untested.
3. Mechanical clustering is cut: tf-idf gave a 42% blob and a naive sequential chop beat it,
   but that corpus was an append-only log. n=1.
4. Page density is unjudged: CLI-written pages ran about half the prose of subagent-written
   ones at the same citation count.
5. The 500-line oversized ceiling is a stated default, not a measured one.
6. `reorg` was validated on one real corpus family (bareloop's `docs/`); the SHOUTED-caps rule
   leans on that corpus's convention. A repo that never shouts status gets fewer `archive`
   hits (recall loss, not false-archive risk). Inferred, n=1.
7. `reorg` has not been run on a repo whose content this project did not control.
