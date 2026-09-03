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
  real frustration preceded it (see §3, fix #1).

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

## 3. Why it behaves the way it does (design decisions)

The original tool trusted machine proxies and graded whole sessions BAD, which poisoned
memory with noise (on a 253-session corpus, **15 false high-confidence preferences**, all
built from exit-codes and `/stash` false positives — including the `/stash` help text
mistaken for user feedback). The redesign inverts that into a two-barrier funnel:

**Bound facts at the write bar, not by pruning.** Hot memory is loaded into every session, so
size matters far more there than at consolidation time. Two rules do the bounding, and both sit
at *entrance*: a fact must be a one-line rule (≤160 chars), and every run rewrites the whole
section rather than appending to it. Nothing is pruned on age — non-recurrence is ambiguous
(stale vs still-working), so an old rule that still holds must never be dropped for being old.

**Compression is synthesis, not bookkeeping.** Rewriting 300 facts into 200 shorter ones is a
judgement job, which is why it is a model step. Anything mechanical — the episode cap, the
length check — is a counted operation with no model in the loop. This split is deliberate: on
this project, model-driven bookkeeping measured **27%** reliable against **~100%** for the same
work done by a script.

**Guard the signal** → **require reinforcement** before anything becomes a hot antigen:

`observed reaction → agent-directed → corroborated-in-context → recurring → LLM-confirmed → (5+ sessions) hot`

**Precision over recall, on purpose.** A false antigen (a wrong rule applied to *every*
future session) is far costlier than a missed faint one — and a real issue recurs and gets
caught next time. So friction under-detects rather than over-writes.

**The four corrections (from real-usage feedback):**
1. **Stash is context-gated** — a clean-start stash is a checkpoint (weight 0); it only
   counts as friction when a `user_correction`/`user_curse` preceded it.
2. **Abandonment/silence are context-gated** the same way — they're mixed signals (open
   tabs, context-switching), so they're zero unless they follow an unresolved reaction.
3. **Agent-directed vs self-correction** — not every "no, wrong…" is an antigen. "Wrong
   project, abort" is you redirecting yourself; friction flags it `self_suspect` and the LLM
   confirms/drops it. (A plain correction is mild; only a curse, interrupt, or tool error is severe.)
4. **The trigger is kept** — the agent's preceding action + result (often a *claimed* exit-0
   success the user is contradicting) is attached to each reaction, so an antigen carries
   both halves: what the agent did **and** what you said about it.

**Cluster ranking is recurrence-first, intensity-on-ties.** Clusters are ordered by tier
(severity × recurrence), then by how often they recurred, then — only to break a tie — by
median peak friction, so a more intense reaction ranks above a milder one that recurred
equally. Ranking never promotes across the 2×2: a loud one-off stays an episode, it just
sorts ahead of quieter ones. Rarity still gates what becomes a rule; intensity only sorts
within it.

**Where the LLM lives:** lexical matching catches verbatim repetition ("wrong project" ×3)
but cannot judge which existing class a paraphrase belongs to ("nothing landed" vs "says
pushed but none got it") — that's a semantic judgment. So the split is: **friction detects +
cheaply pre-groups (precise); the LLM in `/remember` makes one classification judgment per
cluster (`drop` / existing `ag-NNN` / `new:<theme>`, on the short quotes only) — no merging,
no arithmetic. `friction.cjs count` then owns hash union, dedup, and promotion mechanically.**
This keeps friction dependency-free and fast, and puts the one semantic call where an LLM
already runs while everything mechanical lives in code.

---

## 4. Status (as of 2026-08-25)

- **Severity is intensity, not existence (2026-08-25).** Friction's severe test accepted the
  same three signals that seed a cluster, so every cluster it had ever emitted was severe —
  measured 69/69 on the real corpus (3,170 sessions, 77 projects), 66/66 on the privcloud
  fixture. The recurrence × severity grid was a 1×2 on recurrence alone: `fact` and `drop`
  had never fired, and a `/remember` run saw 68 "severe episodes" from ordinary one-off
  corrections. Severe now means a curse, an interrupt cascade, or a tool error corroborating
  the reaction; a plain correction is mild. Same corpus after: 69 → 31 clusters, every one of
  the 38 dropped correction-only. Fixture (i) and a new assertion on (h) (13 plain
  corrections → `fact`, not `antigen`) were observed failing on the pre-fix script; `expectedTests`
  raised to 248. The bug dated from ledger v1 (v2.13.0) — the two rules landed in the same
  commit — and was found by a session that counted the severity distribution instead of
  trusting the labels.

  Two spec contradictions fell out of the same review. Step 4b routed a one-off severe cluster
  to "an Episode" — a section that is stash-fed and capped at 10, which 4c's own no-singleton
  rule already made unreachable; 4b now says a one-off is written nowhere until it recurs. And
  step 8's "facts should not grow by the number of new facts" was measured false at steady
  state (bareloop: 273 facts, mean 131 chars, 0 near-duplicates — the compressor correctly
  shortened nothing) and reworded so it cannot invite forced merges.

  A second review pass the same day, spec against script, found more of the same shape. friction:
  when analyze found no sessions it fell through to extract on the PREVIOUS run's
  `friction_analysis.json` — exit 0, `antigen_clusters.json` clobbered to empty; the no-input
  path now returns a distinct exit code (2 — 1 was already the verdict) and stops. Spec: step 7
  called `docs-builder.cjs` by a cwd-relative path (fails in every repo but this one) and relayed
  `due`'s "run ledger" advice that step 7 itself forbids; the `antigen_review.md` fallback carries
  no `session_ids`, so 4c would have counted every re-scan as recurrence — no counting on that
  path now; the migration clause re-fired every run on an entry that matched nothing (ag-007/008
  live); the early-stop condition depended on 4c's own output; step 5 rendered legacy 1-session
  `observing` entries the no-singleton rule says have nothing to show; three step cross-references
  pointed at the wrong step; "recursively" was two levels. Decided and kept: a friction `fact`
  (3+ sessions, mild) files straight into Facts at 3 while an antigen needs 5 — facts are not
  rules, and the compressor bounds them.

- **Session identity is content-based (2026-08-24).** Friction now collapses forked/resumed
  session files into one conversation before clustering (shared message `uuid`), and bars a
  cluster carrying no user text from the severe path. Both land in all four packages, covered
  by the repo's first friction test suite (`tests/friction/friction.test.js`), written to fail
  against the pre-fix script and observed doing so. A declared `forkedFrom` field exists and
  was tried first — it catches only 5 of the 6 real duplicate groups (17% miss), so detection
  is by content overlap instead. Threshold is one shared `uuid`, and every uuid overlap on the
  real corpus was a genuine duplicate.

  A review of the first cut found the collapse was only half done: the *session count* merged
  but both files' reactions still reached the cluster, so `signals` kept double-counting.
  Reactions are now deduped on (conversation, anchor timestamp, anchor signal). Two further
  defects were found the same way and fixed — a `uuid` was accepted as any string, so a log
  format emitting `""` or a constant would have unioned the whole corpus into one session and
  frozen every recurrence count at 1 (now guarded on length and per-uuid fan-out; measured max
  fan-out on the real corpus is 5); and the empty-context rule was deleting clusters rather
  than downgrading them, which killed the file-referent fallback outright.

  **It was corrective, not merely preventative.** Validated by running `/remember` on
  bareloop, whose corpus holds 4 of the duplicate groups. That run found a live false
  promotion already sitting in loaded memory: `ag-014` ("confirm a project publishes to npm")
  rendered as **3 sessions** under Medium, but its evidence is a single reaction —
  `no npm for this` — from ONE agentic-toolkit conversation that had been forked into three
  session files and counted three times. The ledger had it right at 1 the whole time; the
  render was the inflated copy. Traced at the time to friction's session accounting — but the
  same shape of bug recurred on a later live run after this fix, and turned out to sit one
  layer downstream, in the ledger's own hash counting (see "The ledger counted files, not
  conversations" below).

- **The ledger migration is "seed, do not count" (2026-08-24).** A defect found by the same
  bareloop run. The migration clause said to start `session_ids` empty; the matching rules
  said an absent hash is new evidence and increments `sessions`. On the one run where the set
  IS empty those two are contradictory — every entry's own history reads as fresh recurrence,
  and on a `hot` entry that also drives `recurred_while_hot`, which at 2 rewrites a rule that
  never failed. bareloop carried two hot entries already at 1, so counting would have
  force-rephrased both. Two separate runs avoided it only because the operator noticed and
  overrode the text, which is the definition of a rule that must be mechanical. `remember.md`
  now carries an explicit override: on the run that first populates `session_ids`, write the
  ids and change nothing else — not `sessions`, not `last_seen`, not `recurred_while_hot`,
  not `status`. Counting resumes on the next run.

- **The ledger counted files, not conversations (2026-08-24).** Fork dedup made a cluster
  carry every member file's hash in `session_ids`, but step 4c still looped per hash and
  incremented `sessions` once per hash — turning fork dedup's own fix into file-counting one
  layer down. Caught live, not by review: a real `/remember` run rendered "no npm for this" as
  3 sessions and promoted it to Medium; friction had it right at `sessions:1` with three
  hashes, and the spec inflated it downstream (2 of 66 clusters affected). Counting is now
  stated as mechanical rather than judgement (see §2, "Updates the antigen ledger").

- **Mechanical-only length gate (2026-08-24).** The pre-write gate's judgement exemption
  ("cannot be shortened without losing meaning") let a real run exempt 91 of 94 fact lines
  (longest 1290 chars) as "established style"; replaced with the single mechanical exemption —
  a >100-char backtick literal (see §2). Re-run for real on the same corpus: 0 of 100 over,
  no exemptions claimed, 54 KB → 29 KB.

- **First regression net for the spec layer (2026-08-24).** `remember.md` is prose a model
  executes, which the JS suite couldn't previously see — three spec defects (signals
  double-counted, the ledger fix above, the length gate above) shipped silently in one day
  before this existed. See "Regression net" below.

- **Quiet runs still pay gate debt (2026-08-24).** The "nothing to consolidate" early exit sat
  above the Facts rewrite, so a run with no new stashes and no new antigens never reached the
  length gate — a restored pre-fix `MEMORY.md` with 90 over-length lines went through `/remember`
  untouched. The exit now requires the step-8 mechanical check to return 0 lines against the
  existing file first; any lines over means the rewrite runs anyway, on existing content with no
  new input.

- **The ledger seeds only on recurrence (2026-08-24).** "No match → new entry" seeded a row for
  every unmatched cluster, and nearly every cluster is a 1-session one-off — three runs of the
  rule produced 30, 0, and 10 new entries. A new entry now needs cluster `sessions` >= 2; a
  1-session cluster is not recorded, since friction re-scans every log each run and seeds it once
  it recurs. Merging a 1-session cluster into an existing entry is unchanged — that is recurrence.

- **Facts are compressed, not accumulated (2026-08-23).** `/remember` now rewrites the whole
  Facts section every run under a one-line/≤160-char bar, keeps the 10 most recent episodes and
  folds-then-deletes the rest, batches stashes ≤5 per agent, and runs a mechanical length check
  in its report. Measured on this toolkit's own bareloop corpus: `MEMORY.md` **168 KB → 48 KB**
  (348 facts averaging 254 chars → 249 averaging ~130; 73 episodes → 10), which is roughly
  **30k tokens off every session in that project**. Antigens and the 10 hot episodes came
  through byte-identical.

- **`AGENT_RULES.md` bootstrap shipped.** A standards-guide template ships bundled next to
  `friction.cjs` in all four packages; `/remember` copies it into `.claude/remember/` on
  first run only (never overwritten again) and injects it into CLAUDE.md via its own marker
  pair, separate from the MEMORY.md block. This repo dogfoods it: its own copy moved from
  the old `.claude/memory/AGENT_RULES.md` location.
- **Antigen ledger shipped (v1)** — `/remember` step 4c maintains
  `.claude/remember/ledger.json` in all four packages: per-class evidence trail,
  rejected-phrasing buffer, recurrence-while-hot lifecycle, ESCALATED lane. The prospective
  ON/OFF validation gate was POC'd against real data and **deferred** — signal density is
  ~an order of magnitude too thin (37 correction events across 681 sessions; every antigen
  class a singleton). Numbers and the un-defer condition: `docs/product/antigen-gate-prd.md` §9.
- **Directory cleanup** — three dirs (`stash/`, `friction/`, `memory/`) consolidated to two
  (`stash/`, `remember/`); friction output moved under `remember/friction/`. `/remember`
  performs a one-time loud migration of legacy layouts (pipeline files only — user-owned
  files in old `memory/` are left in place).
- **Injection fix** — the managed CLAUDE.md section now uses the explicit
  `@.claude/remember/MEMORY.md` path; the previous bare `@MEMORY.md` resolved to a
  nonexistent root-level file, so hot memory was silently not loading in Claude Code.

### Regression net (2026-08-24)

`tests/friction/friction.test.js` runs five invariants over **real captured outputs** in
`tests/friction/fixtures/` — the first test the spec layer has ever had. `remember.md` is
prose a model executes, so the JS suite couldn't previously see it: fact lines ≤180 chars with
the one mechanical backtick exemption (I1), episodes ≤10 (I2), ledger `sessions` ≤ distinct
conversation prefixes in `session_ids` (I3), `sessions` ≤ evidence count (I4), and cluster
`sessions` == distinct conversations (I5). Known-bad fixtures are **detection** tests asserting
the exact violation count — bareagent 90 of 94 facts over cap, privcloud's 181-char line,
privcloud's `ag-006` counted as 2 sessions for one resumed conversation (99 shared message
`uuid`s); the fixed run's output (`bareagent-fixed`, 0 of 100 over) is the **conformance** half
of the same pair. Each detection path was watched failing under a tampered fixture before being
trusted. The test runner's per-suite `expectedTests` is now a hard floor — fewer than declared
fails the run — raised to 238 for friction (248 as of 2026-08-25).

### Earlier (2026-06-16)

- The redesign is **shipped** in all four packages (`packages/{claude,opencode,ampcode,
  droid}/commands/remember/friction.cjs`). Validation on 253 sessions: false hot
  preferences **15 → 0**, antigen candidates now **100% observed user reactions** (was 100%
  machine-inferred).
- **`/friction` is no longer a standalone command.** It was collapsed into `/remember`,
  which runs `friction.cjs` automatically (best-effort) against the global sessions root
  before consolidating. Rationale: friction was a thin script-wrapper rarely run on its own,
  and bundling guarantees the antigen data is fresh — without silently skipping (a no-sessions
  miss is surfaced loudly). The script is still directly runnable for inspection (§5).
- The per-session dashboard (`report.md` / `friction_summary.json`, the BAD-rate) is
  intentionally unchanged — it's a separate concern from the antigen pipeline.
- Full design history: `.claude/stash/2026-05-25-friction-redesign-experiment.md` and
  `.claude/stash/2026-06-16-command-consolidation-shipped.md`.

## 5. Reproduce / inspect

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

## 6. Known limitations

These are structural, not bugs on a backlog. Each one is a place where closing the
gap costs more than the gap does — recorded here so the next person does not spend a
session rediscovering that.

### Matching semantics and evidence are the same channel

A ledger entry's `class_hints` **are** fragments of the quotes that proved it. `ag-001`
carries `"did you ground your check"` and `"fucking validate this after correction"`.
Step 4a then hands the classifier `class_hints` + `rule` + `evidence.quotes` and asks
whether a new cluster is that same mistake class. So an entry's *identity* — what
distinguishes it from every other entry — is made of the same strings as its *evidence*
that the mistake recurs. The two are coupled by construction.

Two consequences follow, and they pull in opposite directions:

- **Tautological matching.** A cluster can match an entry on the strength of the very
  quotes that seeded it, which is a match against itself rather than against a new
  occurrence. Session-hash dedup neutralises the common case — the same session cannot
  be counted twice — but the identity is per session, not per quote, so it bounds the
  damage rather than removing the cause.
- **Over-matching on thin ledgers.** Where `class_hints` are short generic phrases,
  they match ordinary frustration that shares a word. This is `Open item 2` in
  `remember.md`, and it is why 4a requires a negative example ("`we're burning money,
  why is it failing?` does NOT match") rather than the positive claim alone.

**Within a single matching channel, decoupling either way makes the other worse.**
Narrow matching to the `rule` and genuine recurrence phrased differently stops counting
— recall gaps are the failure this pipeline exists to avoid. Widen it back onto the
quotes and generic entries swallow unrelated clusters, which is the failure precision
was chosen over recall to prevent. The negative-example requirement is the mitigation
for that trade.

The qualifier matters, because the trade is a property of having one channel rather
than a law about the problem.

**Open direction — match on the antecedent, not only the reaction.** Measured on a
frozen 34-cluster corpus (2026-09-02), and half-built: the cheap version of this idea
is dead, the real one is carried but not yet used.

The first plan was to store a cluster's `preceding` — the agent action, its result and
any error immediately before the reaction — on the ledger entry, so the stored side
carried an antecedent too. That fails on content, not on plumbing. `preceding.action`
is a tool-*name* sequence (`calls.slice(-2).join(' → ')`); `Bash` or `none` covers 21
of 34 clusters. As a matching signature it gives 13 distinct values over 34 clusters, a
19.3% collision rate — `Bash` against `Bash` is the same coin flip the quote channel
already is. Repairing `preceding.result` first (it read result text for `Exit code 0`
instead of the `is_error` boolean; fixed in `6e4a5e6`) was an honest fix with zero
matching benefit: 14 → 13 distinct, 19.1% → 19.3%, because `result` is nearly
determined by `action`, so the repair renamed the biggest bucket instead of splitting
it. `tool_sequence` is no better: 10 distinct, 25.8%.

The discriminative material is the **file referents** — the paths a cluster's sessions
touched. They were already computed per candidate (74/101 populated) and silently
dropped at clustering, so no cluster ever saw them. `ecf142c` carries them through and
unions them per cluster, capped at 8 sorted. On the same corpus: **30 distinct
signatures over 34 clusters at a 1.8% collision rate, 29/34 populated** — a 10×
reduction against `preceding`, and better than the 28 / 3.7% a candidate-level join
predicted, because the cluster union is richer than any single candidate.

That result also corrects a prediction made here: the trade above assumed a richer
antecedent would have to be *distilled*, reintroducing the LLM judgement 4a was
narrowed to avoid. It does not. File paths are mechanical, so the second channel costs
no judgement step at all.

**What is not done — and is now SHELVED (2026-09-03).** Nothing stores `files` on a
ledger entry and nothing shows it to the classifier at step 4a, so matching today still
runs on the single quote channel described above.

This section previously said the ledger half was "gated on" a label-agreement
measurement, which read as *justified and queued*. Checking the premise instead of the
gate: **the problem it fixes is not occurring.** The harm is a false match inflating an
entry until a `hot` entry hits `recurred_while_hot >= 2` and its rule is rewritten —
`ag-001` is the only `hot` entry, sits at **1** against a threshold of **2**, and has
never triggered it. The one observed false-match incident measured as a model-tier
problem (haiku 4/10 wrong, sonnet 0/10), already closed by requiring sonnet-class. And
`Open item 2`'s own proposed mitigation — a negative example on generic entries — is
already in the 4a prompt.

A POC also showed the obvious ledger design fails on its own terms: cluster unions
collide at 1.8%, entry unions at **38%**, because an entry accumulates paths over every
session it matches and ends up holding `README.md` and `CLAUDE.md`. A rarity filter
repairs that (9.5% at df<=2), but repairing a fix for a non-occurring problem is not a
reason to ship one.

The incoming half stays: it costs nothing, adds no LLM judgement, and accumulates
evidence for free. **Un-shelve trigger:** a false match observed under a sonnet-class
classifier, or `ag-001` reaching `recurred_while_hot = 2` on evidence unrelated to
validation.

One result from that POC generalises past this feature and is worth carrying: an arm
with the user's quotes stripped from both sides scored BEST on exact-label agreement
(0.900) while unanimously dropping three clusters every quote-carrying run matched, and
naming antigens after session hashes. It wins by having nothing to go on and defaulting
to `drop`. **Agreement rewards removing information**, so it cannot be the gate on a
change that adds a channel. The user's own words are load-bearing — files are neither
necessary nor sufficient without them.

Full corpus, prompts, 12 raw runs and a reproducing scorer: `poc/friction-file-referents/`.
See PRD §13 for the numbers.

A related limit sits underneath all of this and is not addressed by any of it: the
seed signal assumes a reaction indicates an agent mistake. In practice a share of them
are over-prompting, thin context, or impatience — mistakes on both sides, in degrees
that are never balanced. Since seed evidence becomes `class_hints`, that noise is what
later matching runs *against*, so it compounds. `self_suspect` and
`preceding.action === 'none'` (a reaction with no agent action before it) are the two
mechanical cues that gesture at this, and both are currently only drop cues, never
attributions. Deliberately so: asking *whether there was an agent action* is
classification and is safe, while asking *whose fault it was* is scoring — and this
pipeline uses the model as a classifier, never a scorer. Severity already degenerated
once by being seeded and rated on the same signal; blame attribution would repeat it.

### A run cannot tell that its own work invalidated a standing fact

`/remember` writes facts from stashes and friction output. It has no way to notice that
work done *in the same session* has just falsified a fact already in `MEMORY.md` — a
fact asserting two files stay tracked survives a commit, in that same session, that
gitignores them. Detecting this would mean re-checking every standing fact against the
working tree on every run, and rewriting facts on that evidence is worse than leaving a
stale one: the heuristic would be confidently wrong about facts it half-understood.
Stale facts are corrected the way they were written — by a human noticing, or by the
next run's extraction contradicting them outright.
