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
  independent `@`-reference — a guide to consult when building something new, not hot
  context (see §2).

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
`uuid` are the same conversation, reported under a single canonical id (the
lexicographically smallest). Measured on a real 3,158-session corpus: 6 such groups exist,
and of ~5M possible session pairs only **9** share any `uuid` at all — every one a genuine
duplicate, so the rule never merges independent sessions.

**A cluster with no user text is dropped.** If the matched context window holds no real
words, there is nothing to classify and nothing to quote as evidence. Worse, an
empty-context cluster short-circuits the self-correction filter (there is nothing to test),
so a lone `user_correction` would auto-qualify as severe on no evidence at all. These are
dropped outright, not downgraded — measured at 3 of 68 clusters on the real corpus, and
nothing carrying real text was affected.

**Outputs (`.claude/remember/friction/`):**
| file | contents |
|---|---|
| `antigen_clusters.json` | **the contract `/remember` reads** — clusters with `theme`, `suggested_artifact`, `confidence`, `severity`, `sessions`, `projects`, `contexts` (verbatim quotes), `preceding` (trigger), `self_suspect` |
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
- **Episodes: keep the 10 most recent; older ones are folded, then deleted.** An aging episode's
  *lesson* is handed to the fact rewrite; the narrative is removed. There is no episode archive —
  git already holds the history, and an archive that is never loaded is not memory.
- **A mechanical length check runs at the end** — a one-line `awk` over the written file that
  names every fact over the cap. It reports, it never fails the run and never edits by hand.
- Reads `.claude/remember/friction/antigen_clusters.json` → **Antigens** (step 4):
  1. **Classify target** — sonnet decides agent-directed vs self-correction; drops the latter.
  2. **Semantic-merge** — sonnet groups same-complaint-different-words quotes friction left split.
  3. **Tier by recurrence** — High (5+ sessions, *loads hot*), Medium (3-4, recorded), Low (<3, episode).
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
  Division of labor: **MEMORY.md is the render (read as guidance); the ledger is the
  record (checked, never injected).** Design + the POC evidence that shaped it:
  `docs/product/antigen-gate-prd.md`.
- Writes `MEMORY.md` (Facts / Episodes / Antigens), injects `@.claude/remember/MEMORY.md`
  into `CLAUDE.md`, and writes the run report to `.claude/remember/report.md`.
- **Bootstraps `AGENT_RULES.md` once.** If `.claude/remember/AGENT_RULES.md` doesn't exist,
  it's copied from the bundled template next to `friction.cjs`; if it already exists, it's
  left alone — user-owned from that point on. When present, `/remember` injects a second,
  independent `<!-- AGENT_RULES:START -->…<!-- AGENT_RULES:END -->` section into CLAUDE.md
  (`@.claude/remember/AGENT_RULES.md`), framed as a standards guide for new-feature work —
  not hot context loaded every session like MEMORY.md.

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
   confirms/drops it. (Friction stopped auto-marking every correction severe.)
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
but cannot merge paraphrases ("nothing landed" vs "says pushed but none got it") — that's a
semantic judgment. So the split is: **friction detects + cheaply pre-groups (precise); the
LLM in `/remember` does the final merge + target-classification (on the short quotes only).**
This keeps friction dependency-free and fast, and puts the semantic call where an LLM
already runs.

---

## 4. Status (as of 2026-08-24)

- **Session identity is content-based (2026-08-24).** Friction now collapses forked/resumed
  session files into one conversation before clustering (shared message `uuid`), and drops
  clusters that carry no user text. Both land in all four packages, covered by the repo's
  first friction test suite (`tests/friction/friction.test.js`), written to fail against the
  pre-fix script and observed doing so. A declared `forkedFrom` field exists and was tried
  first — it catches only 5 of the 6 real duplicate groups (17% miss), so detection is by
  content overlap instead. Threshold is one shared `uuid`: across ~5M possible session pairs
  only 9 share any uuid at all, and every one is a genuine duplicate.

  **It was corrective, not merely preventative.** Validated by running `/remember` on
  bareloop, whose corpus holds 4 of the 6 duplicate groups. That run found a live false
  promotion already sitting in loaded memory: `ag-014` ("confirm a project publishes to npm")
  rendered as **3 sessions** under Medium, but its evidence is a single reaction —
  `no npm for this` — from ONE agentic-toolkit conversation that had been forked into three
  session files and counted three times. The ledger had it right at 1 the whole time; the
  render was the inflated copy. Post-fix friction emits only the canonical id, and the entry
  now sits in Low at 1 session.

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
