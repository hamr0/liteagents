# Hot Memory — the stash → remember pipeline

This is the one document to read before touching `/stash` or `/remember` (and the
`friction.cjs` sensor that `/remember` runs). It explains what each step does, how they
complement each other, and the design decisions behind the current behaviour so we don't
have to reverse-engineer it again.

---

## 1. What "hot memory" is

**Hot memory** is `.claude/remember/MEMORY.md`, injected into `CLAUDE.md` between
`<!-- MEMORY:START -->` / `<!-- MEMORY:END -->` as `@.claude/remember/MEMORY.md` (an
explicit path — `@`-references resolve relative to the containing file, so a bare
`@MEMORY.md` would point at a nonexistent root file). Claude loads it into
**every future session in the project**. So whatever lands there steers all later work —
which is exactly why the bar for writing to it is deliberately high.

Everything project-local lives in **two dirs, each owned by its command**:

```
.claude/stash/            ← /stash: your deliberate snapshots
.claude/remember/         ← /remember: everything it derives
  MEMORY.md                 hot memory (the render — read as guidance)
  AGENT_RULES.md            standards guide, bootstrapped once — not hot memory
  ledger.json               antigen ledger (the record — checked, never injected)
  report.md                 latest consolidation report
  .processed                stash manifest
  friction/                 transient sensor output, regenerated each run
```

Two project-local commands feed it — and friction runs as a step *inside* `/remember`, not
as a separate command. None call an external service; the whole thing is markdown files in
your repo.

```
/stash  ┐  snapshots you write                          .claude/remember/MEMORY.md
        ├─►  /remember  ──►  Facts / Episodes / Antigens  ──►  @MEMORY.md  ──► HOT
        │     └─ runs friction.cjs first: antigens mined from your logs    (every session)
```

- **`/stash`** — you snapshot a session's context (before compaction, handoff, or a break).
  Once a few unprocessed stashes pile up it nudges you to run `/remember`.
- **`/remember`** — runs the `friction.cjs` sensor first (mining *all* your session logs for
  moments you had to correct the agent), then consolidates stashes + friction antigens into
  `MEMORY.md` and wires up `@MEMORY.md`. On first run only, it also bootstraps a bundled
  `AGENT_RULES.md` standards template into `.claude/remember/` and wires up a second,
  independent section using a plain path pointer, not an `@`-reference — a guide to consult
  when building something new, not hot context (see §2).

The two sources complement each other by **source and trust**: stashes are what *you
deliberately wrote down*; friction is what the agent *did wrong that you reacted to*,
recovered automatically from logs. `/remember` is the step that writes hot memory, and it
treats the two sources differently (below).

---

## 2. What each step does

### `/stash` — deliberate context snapshots
- Writes `.claude/stash/<name>.md` with the active plan, decisions, and findings.
- Use it before compaction, handoffs, or ending complex work.
- **It is a clean-start habit, not a distress signal.** You stash frequently just to start
  fresh. Friction treats a bare stash as a *checkpoint* (ignored) — it only matters when a
  real frustration preceded it.

### friction — the log sensor `/remember` runs
`node friction.cjs <sessions-dir>` (e.g. `~/.claude/projects/`), invoked automatically by
`/remember` against your global sessions root. Two stages, seven output files in
`.claude/remember/friction/`.

**What it is:** the *sensor*. It reads raw session logs (which an LLM can't cheaply do —
hundreds of multi-MB transcripts), detects where you had to correct the agent, and emits
short, evidence-tagged antigen candidates.

**What it is NOT:** a productivity tracker, an engagement meter, or a project-health
dashboard. Its only job is detecting **recurring agent↔user mismatch**. (If a marker
measures activity/volume instead of mismatch, it does not belong in friction.)

**The signal model (the core idea):** trust what the *user* did, not what the *machine*
guessed. An antigen is a **triad**:

```
[agent action + result]  →  [user reaction]  →  [unresolved marker]
   the trigger (#4)          the seed (observed)   stash/abandon/silence (#1/#2)
```

- **Seeds (observed, high-trust):** `user_correction` ("no, wrong…"), `user_curse`,
  `interrupt_cascade`. Only these can create an antigen candidate.
- **Corroboration (inferred, low-trust):** exit codes, `false_success`, `user_intervention`
  (`/stash`), `session_abandoned`, `long_silence`. These never seed — they only add context
  or escalate, and only when they actually surround a real reaction.

**One conversation counts once.** Recurrence is what promotes a rule, so a session has to
mean a *conversation*, not a *file*. A fork or resume writes the same conversation to a
second session file with its own name, and friction identifies a session by its filename —
so without a guard, one reaction gets counted N times and can trip the promotion gate on
its own. Friction collapses these before clustering: sessions sharing at least one message
`uuid` are the same conversation. The cluster then carries **every** member's hash in
`session_ids`, so the ledger matches the conversation under any of its filenames — a single
canonical id would not survive, because the id's timestamp prefix falls back to file mtime
and so re-sorts when a member is touched or ages out of retention. Each distinct reaction is
counted once, deduped on (conversation, anchor timestamp, anchor signal); a reaction made
after a fork diverges is a different timestamp, so genuinely separate reactions both survive.
Measured on a real 4,937-file corpus: 9 such groups exist, covering 23 files (largest group
5), and every uuid overlap found was a genuine duplicate — the rule never merged independent
sessions.

Finding the groups means parsing session files, so the pass is restricted to sessions that
actually carry an anchor signal; one without an anchor can never produce a candidate. On the
same corpus that is 84.1s → 53.0s per run with identical clustering. The cost: a fork sibling
holding no anchor of its own is not discovered, so its hash is absent from `session_ids`
(3 of 66 clusters). It could not have contributed evidence anyway, and it gains a hash the
moment it gains a reaction.

**Severity is intensity, not existence.** A cluster only exists because the user visibly
reacted (correction, curse, interrupt), so a plain `user_correction` cannot also be what
makes it *severe* — otherwise every cluster friction can emit is severe by construction.
That is exactly what happened until 2026-08-25: measured 69/69 severe on the real corpus,
which collapsed the recurrence × severity grid into recurrence alone (`fact` and `drop`
were unreachable; every one-off "no, do X instead" became an "episode"). Severe now means a
curse, an interrupt cascade, or a real tool error corroborating the reaction; a bare
correction is mild and falls out through the ordinary routing (one-off → drop, recurring →
fact). A cluster whose every quote is a self-correction ("wrong repo") is never severe. A
cluster with no user text at all is not dropped outright — that was tried first and silently
killed the file-referent fallback, whose whole purpose is to describe a session too terse to
quote.

**Outputs (`.claude/remember/friction/`):**
| file | contents |
|---|---|
| `antigen_clusters.json` | **the contract `/remember` reads** — clusters with `theme`, `suggested_artifact`, `confidence`, `severity`, `sessions`, `session_ids` (all member files of a conversation; count from `sessions`, never from this list's length), `projects`, `contexts` (verbatim quotes), `preceding` (trigger), `self_suspect` |
| `antigen_review.md` | human-readable version of the clusters |
| `antigen_candidates.json` | raw per-reaction candidates before clustering |
| `friction_raw.jsonl` | every detected signal |
| `friction_analysis.json` / `friction_summary.json` / `report.md` | per-session texture + aggregate dashboard (kept, but **not** the antigen pipeline) |

### `/remember` — run friction, then consolidate into hot memory
- **Runs `friction.cjs` first** (best-effort) against the global sessions root, regenerating
  `.claude/remember/friction/` so the antigen data below is always fresh. If no sessions root
  resolves it says so out loud and consolidates stashes only — never silently skips.
- Reads `.claude/stash/*.md` → **Facts** + **Episodes** (via sonnet, skipping already-processed stashes).
  Stashes are handed out in **batches of up to 5 per agent, using as few agents as possible** —
  one agent reading several sessions sees a lesson recur and writes it once, where one agent
  per stash writes it once per stash and leaves the merge to catch the duplicates.
- **Facts are rewritten and compressed on every run, never appended to.** The merge step gets
  the existing facts + the new ones + the lessons of any episodes aging out, and returns the
  **whole section rewritten**: new replaces old, near-duplicates fold into one line, and every
  fact that can be shorter is made shorter. The output is normally *shorter* than the input.
  A fact is **one line, ≤160 chars, stating a rule that changes future behaviour** — current
  truth only, no version history, no `supersedes`, no narrative. Events are episodes, not facts.
- **Episodes: dedup before appending, keep the 10 most recent; older ones are folded, then
  deleted.** A new episode covering the same work as one already in the section (same goal or
  session, judged by content not title) merges into the existing entry instead of appending a
  second copy — re-processing an already-filed stash must not create a near-duplicate pair. An
  aging episode's *lesson* is handed to the fact rewrite; the narrative is removed. There is no
  episode archive — git already holds the history, and an archive that is never loaded is not
  memory.
- **A pre-write length gate runs BEFORE `MEMORY.md` is written, not after** — a check that
  only runs post-write can merely describe damage already on disk. Every line in the draft
  Facts section must be ≤180 chars, including lines carried over unchanged from the previous
  file (the whole section is rewritten every run, so every line is this run's output). Over
  180 must be shortened and re-checked. The only exemption is mechanical: a line whose single
  longest backtick-quoted literal is itself over 100 chars. No judgement exemption exists —
  the earlier version let a line stand if it "cannot be shortened without losing meaning," and
  on a real run the model used that to exempt 91 of 94 fact lines (longest 1290 chars) as the
  file's "established style." After the fix, the same corpus re-run for real came out 0 of 100
  over, no exemptions claimed, 54 KB → 29 KB. Step 8 then runs the identical rule as a one-line
  `awk` over the written file — a report, not a second gate — so the two counts can never
  disagree.
- **A quiet run still pays gate debt.** A run with no new stashes and no new antigens does not
  skip straight to "nothing to consolidate" — it first runs the step-8 mechanical check against
  the existing `MEMORY.md`. Only a 0-line result earns the early exit; any over-length line means
  the exit is skipped and the Facts rewrite runs on the existing content with no new input. The
  early exit used to sit above the rewrite, so a restored pre-fix file with 90 over-length lines
  went through `/remember` untouched on a quiet run.
- Reads `.claude/remember/friction/antigen_clusters.json` → **Antigens** (step 4):
  1. **4a. Classify** — sonnet labels each cluster once: `drop` (self-directed), an
     existing ledger id (same mistake class), or `new:<theme>` (theme derived
     mechanically from the cluster's own top keywords, not freeform prose) plus a
     one-line, classifier-authored `rule` for that theme — the only LLM-authored field
     here. No merging, no arithmetic — that's 4c.
  2. **4b. Route + tier** — recurring + severe → antigen; recurring + mild → Fact;
     one-off (<2 sessions) → nothing yet, re-surfaces next run. Tier is driven by
     `friction.cjs count`'s distinct-session count: High (5+, loads hot), Medium (3-4,
     recorded), Low (2, ledger `observing` only).
  3. **4c. Count** — `friction.cjs count` is a deterministic script, not the LLM: session
     identity, promotion (`observing`→`hot` at sessions >= 5, which appends a history line
     and re-stamps `attempts[last].adopted` to the run date), the adopted-date gate, and
     decay all happen mechanically against `ledger.json`.
- Step 5 renders the Antigens section with `friction.cjs render` — byte-for-byte from the
  ledger, no LLM paraphrase. `friction.cjs check` validates the ledger/MEMORY.md invariants
  (I6-new, I7); `friction.cjs migrate-attempts` is a one-time fixer for hand-drifted `rule`
  text.
- It works **only from friction's short quotes — never the raw logs.**
- **Updates the antigen ledger** (`.claude/remember/ledger.json`, step 4c) — the evidence
  trail behind the Antigens section. One entry per mistake-class: which rule targets it,
  the evidence that promoted it, every phrasing ever tried. Two things it buys:
  1. **Failure detection without statistics** — if a class fires again *while its rule is
     loaded* (`recurred_while_hot`), the phrasing demonstrably failed: at 2 recurrences the
     rule is rephrased (never reusing a failed phrasing — the `attempts` list is the
     rejected-edit buffer); after 2 failed phrasings the antigen is **ESCALATED**: removed
     from hot, recorded as a Fact ("no phrasing fixes this"), and flagged for a human
     decision — enforcement (a hook) or accepted limit.
  2. **No duplicate rules** — new corrections are matched to existing classes by
     `class_hints` before anything new is minted.
  3. **Counting is per conversation, never per file.** `sessions` is the authoritative
     conversation count; `session_ids` only lists the FILES one conversation was written to
     (a fork/resume carries every member's hash), and a count is never derived from
     `session_ids.length`. None of a cluster's hashes present → a genuinely new conversation,
     `sessions` += 1. Any hash already present → already counted — store the missing aliases,
     change nothing else. Found live, not by review: a real `/remember` run rendered "no npm
     for this" as 3 sessions for one conversation forked into three files, and a second entry
     (2 files, 99 shared message `uuid`s) was inflated the same way — the loop had been
     incrementing `sessions` once per hash instead of once per conversation. A nested
     `session_ids` shape (`{id, seen}` per hash) was measured and rejected: the ledger already
     stores that shape, so the trap would move, not close.
  4. **A new entry needs `sessions` >= 2.** No match on a cluster with `sessions == 1` does not
     seed a ledger row — a single occurrence has no recurrence to track yet, and seeding
     singletons grows the ledger by dozens of never-recurring entries per run (three runs of the
     old "no match → new entry" rule produced 30, 0, and 10 new entries). Friction re-scans every
     session log on every run, so a mistake that recurs is seeded once it reaches 2. Merging a
     1-session cluster into an EXISTING entry is unchanged — that is recurrence.
  Division of labor: **MEMORY.md is the render (read as guidance); the ledger is the
  record (checked, never injected).** Design + the POC evidence that shaped it:
  `docs/product/antigen-gate-prd.md`.
- Writes `MEMORY.md` (Facts / Episodes / Antigens), injects `@.claude/remember/MEMORY.md`
  into `CLAUDE.md`, and writes the run report to `.claude/remember/report.md`.
- **Bootstraps `AGENT_RULES.md` once.** If `.claude/remember/AGENT_RULES.md` doesn't exist,
  it's copied from the bundled template next to `friction.cjs`; if it already exists, it's
  left alone — user-owned from that point on. When present, `/remember` injects a second,
  independent `<!-- AGENT_RULES:START -->…<!-- AGENT_RULES:END -->` section into CLAUDE.md as
  a plain path pointer (not `@`-referenced — it's a standards guide read when designing
  something new, not hot context loaded every session like MEMORY.md).
- **Step 7: docs reconcile check.** Best-effort, crash-isolated: runs `docs-builder.cjs due`
  against `docs/.docs-builder/ledger.json`, and on ANY drift it prints (new/moved/changed/
  deleted, not just crossing the >=5-doc DUE threshold) it also re-runs `index-flat` right
  there — script-only, no model call — so `docs/index.md` self-heals every `/remember` run
  instead of waiting for the next full `/docs-builder reorg`.

---

## 3. Reproduce / inspect

`/remember` runs friction automatically, but you can invoke the sensor directly to inspect
its output without consolidating:

```bash
# run friction over all projects (what /remember does for you)
node friction.cjs ~/.claude/projects/
# the antigen contract /remember consumes:
cat .claude/remember/friction/antigen_clusters.json
# human-readable:
cat .claude/remember/friction/antigen_review.md
```
