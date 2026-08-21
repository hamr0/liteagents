---
type: reference
title: docs-builder
status: draft
updated: 2026-08-21
---

# docs-builder

The `/docs-builder` skill splits a documentation file once it outgrows its row in
`docs/README.md`, keeps the resulting pages current, and generates an index so they can be
found. It is a **slash command**, not a skill: `packages/claude/commands/docs-builder.md`
plus a bundled `commands/docs-builder/docs-builder.js` (vanilla Node, zero deps, eight
subcommands) — the same shape as `/remember`.

---

## What it is, and what it is not

> **docs-builder makes docs current, complete and findable.
> It does not make them cheaper to read.**

That is the honest label from the spec (`docs/docs-builder-v2-spec.md` §16). It was measured
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

```
1. SCAN      script   headings -> outline.json (h1, h2, h3, line ranges, snippet)
2a. PROPOSE  cheap    ONE call, ALL headings  -> fixed theme list + one-line glosses
2b. ASSIGN   cheap    chunks of ~20 sections  -> each section gets a theme FROM that list
3. VALIDATE  script   every key exists, appears once, none invented, none off-list
4. PLAN      script   task-<theme>.json per page + estimated write cost
5. WRITE     mid   one agent per page, reads ONLY its own line ranges
6. ARCHIVE   script   original -> docs/archive/ via verified `git mv`
7. INDEX     script   docs/index.md, regenerated from steps 1 + 3
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
REPO=<repo> OUT=outline.json node docs-builder.js scan docs/BIG.md
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
node docs-builder.js validate outline.json labels.json
```

**4. Plan (script)** — writes `task-<theme>.json` per page and prints the estimated write
cost using the measured cost law (§E).

```bash
OUT=tasks node docs-builder.js plan outline.json labels.json
```

**5. Write pages (mid tier, one agent per page)** — each agent reads only its own line ranges.
The value is context isolation, not speed. 250 lines is a ceiling, never a target; every
measured page came in under it unprompted. Launch 3 at a time, checkpoint each finished page
so a cleanup that dies partway can resume instead of restarting.

**6. Preserve (script)** — copies the original byte-identical, verifies by sha256, refuses
to overwrite.

```bash
REPO=<repo> node docs-builder/docs-builder.js archive docs/BIG.md
```

**7. Index (script)** — coarse, points at the synthesized pages, 10–100 rows. Regenerated
every reconcile so it cannot drift.

```bash
OUT=docs/index.md node docs-builder.js index outline.json labels.json
```

**Lint (script)** — declared-only checks, see §D and §C.

```bash
REPO=<repo> OUT=lint.json node docs-builder.js lint $(git ls-files 'docs/*.md')
```

---

## The three modes and the docs/ layout

| Mode | Does | Destructive |
|---|---|---|
| `/docs-builder` | first cleanup: big doc → pages + index | no (original preserved) |
| `/docs-builder reconcile` | re-run scan → validate → index → lint, propose fixes | no |
| `/docs-builder archive-cleanup` | prune | **yes** — separate invocation, default keep, requires clean git tree |

`reconcile` never touches `docs/product/`; it owns `docs/wiki/`. `archive-cleanup` moves
files to `docs/archive/`, never deletes, and appends one line to `docs/log.md`.

```
docs/
  README.md          entry point, referenced from CLAUDE.md
  index.md            GENERATED by script. never hand-edited.
  log.md               append-only:  ## [DATE] operation | description
  product/            specs. reconcile READS, never writes.
  wiki/                synthesised pages. reconcile OWNS these.
  archive/             what got cleaned up: originals, moved via `git mv`. Pruning is a
                       separate, opt-in, destructive invocation.
  .docs-builder/       machine-only state: ledger.json, outline.json, labels.json,
                       validate.json, lint.json, tasks/
  archive/             only archive-cleanup touches this.
```

Never moved by any mode: `CLAUDE.md`, `AGENTS.md`, `AGENT.md`, root `README.md`,
`CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE*`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`.github/`, `.claude/`, `node_modules/`, `.git/`.

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
total size. `docs-builder.js plan` prints this estimate before any writer launches; on the
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
node docs-builder/docs-builder.js ledger   # stamp the current state
node docs-builder/docs-builder.js due      # what changed since, and by how much
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

Reconcile is **due at 5 changed docs** — the same threshold and the same
derived-not-counted shape `/stash` uses. `due` only prints; it never reconciles for you.

**Why not borrow OKF's ledger:** OKF contributes the frontmatter conventions (`verified`,
`sources`, `status`, `stale_after`) and those are already adopted. For change detection
there is nothing to borrow — git already records hashes, renames and line deltas. A second
bookkeeping system is just a second thing that can be wrong.

**Wired:** `/remember` runs `due` at the end of its own run (step 7), detect-only and
crash-isolated so it can never block a memory write. It stays silent in a repo with no
`docs/`, says so loudly if `docs/` exists but the check could not run, and otherwise prints
one line when a reconcile is due. It never reconciles for you.

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

6. **Not replicated to droid, opencode, or ampcode yet.** Build order (spec §14) validates
   `packages/claude/` first; the other three packages, `~/.claude/`, agentic-toolkit not started.

7. **Two bugs the build caught that the POC did not** — worth watching for the same class:
   - **The key contract.** Full untruncated headings scored against the POC's
     silently-truncated keys produced 55 invented + 55 missing out of 86. Fixed by one
     shared key function, used by both the prompt and the validator, with guaranteed
     uniqueness (not merely assumed).
   - **Path resolution.** Source `.md` paths are repo-relative; pipeline JSON artifacts are
     cwd-relative. Conflating the two made `plan` look for `outline.json` inside the repo
     being documented, instead of the working directory.

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

- **"Supersession lint is 100% precision" → collapsed to 40%, then fixed back to 100%.**
  24/24 on bareloop alone (n=1 repo). Re-run on three unrelated corpora, precision fell to
  2/5 (40%): the term `invalidat\w*` matched the ordinary heading "Cache Invalidation" three
  times in aurora. Dropping that one term restored 24/24 across all four repos, at a stated
  cost of 2 real bareloop hits no longer caught — explicit, consistent with the project's
  precision-over-recall stance.

---

## Sources

`docs/docs-builder-v2-spec.md`, `SKILL.md`, `docs-builder.js`, `POC-E-RESULT.md`.
