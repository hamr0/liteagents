# Hot Memory — the stash → remember pipeline

This is the one document to read before touching `/stash` or `/remember` (and the
`friction.js` sensor that `/remember` runs). It explains what each step does, how they
complement each other, and the design decisions behind the current behaviour so we don't
have to reverse-engineer it again.

---

## 1. What "hot memory" is

**Hot memory** is `.claude/memory/MEMORY.md`, injected into `CLAUDE.md` between
`<!-- MEMORY:START -->` / `<!-- MEMORY:END -->` as `@MEMORY.md`. Claude loads it into
**every future session in the project**. So whatever lands there steers all later work —
which is exactly why the bar for writing to it is deliberately high.

Two project-local commands feed it — and friction runs as a step *inside* `/remember`, not
as a separate command. None call an external service; the whole thing is markdown files in
your repo.

```
/stash  ┐  snapshots you write                          .claude/memory/MEMORY.md
        ├─►  /remember  ──►  Facts / Episodes / Antigens  ──►  @MEMORY.md  ──► HOT
        │     └─ runs friction.js first: antigens mined from your logs    (every session)
```

- **`/stash`** — you snapshot a session's context (before compaction, handoff, or a break).
  Once a few unprocessed stashes pile up it nudges you to run `/remember`.
- **`/remember`** — runs the `friction.js` sensor first (mining *all* your session logs for
  moments you had to correct the agent), then consolidates stashes + friction antigens into
  `MEMORY.md` and wires up `@MEMORY.md`.

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
`node friction.js <sessions-dir>` (e.g. `~/.claude/projects/`), invoked automatically by
`/remember` against your global sessions root. Two stages, seven output files in
`.claude/friction/`.

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

**Outputs (`.claude/friction/`):**
| file | contents |
|---|---|
| `antigen_clusters.json` | **the contract `/remember` reads** — clusters with `theme`, `suggested_artifact`, `confidence`, `severity`, `sessions`, `projects`, `contexts` (verbatim quotes), `preceding` (trigger), `self_suspect` |
| `antigen_review.md` | human-readable version of the clusters |
| `antigen_candidates.json` | raw per-reaction candidates before clustering |
| `friction_raw.jsonl` | every detected signal |
| `friction_analysis.json` / `friction_summary.json` / `report.md` | per-session texture + aggregate dashboard (kept, but **not** the antigen pipeline) |

### `/remember` — run friction, then consolidate into hot memory
- **Runs `friction.js` first** (best-effort) against the global sessions root, regenerating
  `.claude/friction/` so the antigen data below is always fresh. If no sessions root
  resolves it says so out loud and consolidates stashes only — never silently skips.
- Reads `.claude/stash/*.md` → **Facts** + **Episodes** (via sonnet, skipping already-processed stashes).
- Reads `.claude/friction/antigen_clusters.json` → **Antigens** (step 4):
  1. **Classify target** — sonnet decides agent-directed vs self-correction; drops the latter.
  2. **Semantic-merge** — sonnet groups same-complaint-different-words quotes friction left split.
  3. **Tier by recurrence** — High (5+ sessions, *loads hot*), Medium (3-4, recorded), Low (<3, episode).
- It works **only from friction's short quotes — never the raw logs.**
- Writes `MEMORY.md` (Facts / Episodes / Antigens) and injects `@MEMORY.md` into `CLAUDE.md`.

---

## 3. Why it behaves the way it does (design decisions)

The original tool trusted machine proxies and graded whole sessions BAD, which poisoned
memory with noise (on a 253-session corpus, **15 false high-confidence preferences**, all
built from exit-codes and `/stash` false positives — including the `/stash` help text
mistaken for user feedback). The redesign inverts that into a two-barrier funnel:

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

**Where the LLM lives:** lexical matching catches verbatim repetition ("wrong project" ×3)
but cannot merge paraphrases ("nothing landed" vs "says pushed but none got it") — that's a
semantic judgment. So the split is: **friction detects + cheaply pre-groups (precise); the
LLM in `/remember` does the final merge + target-classification (on the short quotes only).**
This keeps friction dependency-free and fast, and puts the semantic call where an LLM
already runs.

---

## 4. Status (as of 2026-06-16)

- The redesign is **shipped** in all four packages (`packages/{claude,opencode,ampcode,
  droid}/commands/friction/friction.js`). Validation on 253 sessions: false hot
  preferences **15 → 0**, antigen candidates now **100% observed user reactions** (was 100%
  machine-inferred).
- **`/friction` is no longer a standalone command.** It was collapsed into `/remember`,
  which runs `friction.js` automatically (best-effort) against the global sessions root
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
node friction.js ~/.claude/projects/
# the antigen contract /remember consumes:
cat .claude/friction/antigen_clusters.json
# human-readable:
cat .claude/friction/antigen_review.md
```
