---
name: remember
description: Consolidate stashes + friction into project memory
usage: /remember
---

Run friction analysis, then consolidate session stashes + friction antigens into a single project-local MEMORY.md, and inject into AGENTS.md. Friction runs automatically (best-effort) — there is no separate `/friction` command. A docs reconcile check runs at the end, detect-only.

**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- **Precision over recall for hot memory.** A false antigen loaded into `@MEMORY.md` steers every future session. When unsure, do not promote — leave it to recurrence (a ledger `observing` entry at 2 sessions, nothing at 1).
- **Mid-tier model, not hardcoded.** Steps 2/3/4a delegate to your tool's balanced default
  tier — judgment-capable, cheaper and faster than your top reasoning tier. **Not the
  cheapest/fastest tier**: on judgment work it measurably degrades (misclassification rates
  several times higher). Never hardcode a vendor-specific model name.
- **Batch stashes, don't fan out.** Step 2 gives each extraction agent **up to 5 stashes**
  and uses as few agents as possible (3 stashes → 1 agent, 7 → 2). One agent reading several
  sessions sees the same lesson recur and writes it once; one agent per stash writes it once
  per stash and leaves the merge to catch the duplicates. If more than one agent is needed,
  run them concurrently.
- **Hot memory is short snippets, not prose.** A fact is one line, target 160 characters,
  hard stop 180, stating a rule the agent should follow next time. Events, history, and
  narrative are not facts.

**What it does**

Reads all raw material (`.opencode/stash/*.md` + `.opencode/remember/friction/antigen_clusters.json`), extracts durable facts, episodes, and behavioral antigens into a single `.opencode/remember/MEMORY.md`, then injects a managed memory section into `AGENTS.md`.

**Steps**

0. **Run friction first** (best-effort — friction analyzes ALL your usage, not just this repo)

   Friction's signal is *global*: recurring corrections and frustrations across every
   project are behavioral lessons worth keeping everywhere. So point it at the tool's
   **global sessions root** (all projects), not a per-project directory.

   - **Locate `friction.cjs`** — it is bundled next to this command at `remember/friction.cjs`
     (the same directory as `remember.md`, whether installed or run from the package). If it
     exists nowhere, skip to step 1 (stash-only) and tell the user friction.cjs is missing.
   - **Resolve the global sessions root** — probe this list top-to-bottom, use the first that
     exists and contains `.jsonl` files directly, or one level down in per-project
     subdirectories (friction.cjs scans exactly those two levels, not a deep recursive walk).
     **Never prompt the user.**
     ```
     # ── Add your own global sessions root at the TOP so it is checked first ──
     ~/.claude/projects/                 # Claude Code
     ~/.factory/projects/                # Droid / Factory
     ~/.config/amp/projects/             # Amp
     ~/.config/opencode/projects/        # opencode
     ~/.codex/sessions/                  # Codex CLI  (use $CODEX_HOME/sessions/ if set)
     ~/.gemini/antigravity-cli/brain/    # Antigravity
     ```
     > Note: `friction.cjs` parses Claude Code's session schema. The Codex/Antigravity roots
     > will resolve but yield no signals until friction learns their formats — open an issue
     > to request one: https://github.com/hamr0/liteagents/issues
   - **Run** `node <friction.cjs> "<resolved-root>"`. friction writes its output to
     `.opencode/remember/friction/` in the current project.
   - **On any miss — loud, never silent.** If no root resolves, or friction errors, or it
     finds no usable sessions, print this and continue with stash-only consolidation:
     > ⚠️ Friction didn't run — no sessions found. To enable it, open this command file
     > (`remember.md`) and add your tool's **global** sessions root to the TOP of the probe
     > list in step 0, then re-run `/remember`. Consolidating stashes only this time.

1. **Gather sources**
   - **Legacy layout migration (one-time, loud).** Older versions used `.opencode/memory/` and
     `.opencode/friction/`. If either exists: move the pipeline files
     `.opencode/memory/{MEMORY.md,ledger.json,.processed}` → `.opencode/remember/`, and **discard**
     the old `.opencode/friction/` contents entirely — friction regenerates all of its output
     fresh every run (step 0 has already rebuilt it in `.opencode/remember/friction/` by the time
     migration runs; stale copies carry no unique information and moving them would overwrite
     fresh output). **Move only those pipeline files** — anything else in `.opencode/memory/`
     (e.g. user-owned rule files) stays where it is. Remove the old dirs only if empty, update the managed MEMORY section in AGENTS.md to
     the new reference (step 5), and tell the user exactly what moved.
   - **Bootstrap `AGENT_RULES.md` (one-time, silent-if-present).** If
     `.opencode/remember/AGENT_RULES.md` does not exist, copy it from the bundled template next
     to this command (`remember/AGENT_RULES.md`, same directory as `friction.cjs`). If it
     already exists, leave it untouched — never overwrite, even if the bundled template
     changes in a later version; it becomes user-owned the moment it lands in the project.
   - Read all `.opencode/stash/*.md` files in the current project
   - Read friction output written in step 0: `.opencode/remember/friction/antigen_clusters.json` (preferred) or `.opencode/remember/friction/antigen_review.md` (fallback). On the fallback path, step 4c does NO counting — merge quotes into
     matching entries only; never change `sessions`, `last_seen`, or `recurred_while_hot` (the
     fallback carries no `session_ids`, so identity matching cannot run on it).
   - Read existing `.opencode/remember/MEMORY.md` if it exists — create dir if missing
   - Read processed manifest at `.opencode/remember/.processed` — skip already-processed stashes
   - **No unprocessed stashes → skip steps 2-3 (extraction and the Facts rewrite)
     entirely — facts are never rewritten with zero new input**, not even to clear existing
     length-gate debt on `.opencode/remember/MEMORY.md`. Steps 4-5 (friction → ledger count →
     Antigens render) are stash-independent and still run whenever friction produced output
     (see step 4's own guard). If there is also no friction
     output, report "nothing to consolidate" and stop after step 1.

2. **Extract from unprocessed stashes** (up to 5 stashes per agent, as few agents as possible — see Guardrails)
   - Each agent reads its batch of stashes together and calls the mid-tier model (see Guardrails) to extract:
     - **FACTS** (one line each, target 160 chars, hard stop 180): stable preferences, decisions, corrections,
       explicit "remember this". A fact is a **rule that changes future behaviour**, written
       as the current truth — not an event that happened, not its history. A lesson that
       recurs across the batch is written **once**.
     - **EPISODE** (one per stash, 3-5 bullets): what was the goal, what was tried, outcome, lesson
     - **SKIP**: code details, file paths, errors, mechanical steps, LLM responses
   - Collect all new facts and episodes

3. **Merge into MEMORY.md**
   - Read existing `.opencode/remember/MEMORY.md` and parse its sections (## Facts, ## Episodes, ## Antigens)
   - **Facts section — rewrite and compress, every run.** Call the mid-tier model with the
     existing facts + the new facts + the lessons of any episodes aging out (below), and have
     it return the **whole section rewritten**, not the old list with lines added:
     - New replaces old; contradictions keep the new version; duplicates fold into one line.
     - Shorten every fact that can be shorter. Target 160 chars, one line, current truth only —
       no "supersedes", no version history, no narrative. The output should normally be
       **shorter** than the input.
     - Facts are never append-only: an old fact that a new one refines is rewritten in place.
     - **Pre-write length gate — runs BEFORE MEMORY.md is written, not after.** A check that
       only runs after the write (step 8) can merely describe damage already on disk; the gate
       has to sit inside the merge, before anything hits the file. This applies to **every**
       line in the draft Facts section, including lines carried over unchanged from the
       previous MEMORY.md — the whole section is rewritten every run (see "Shorten every fact
       that can be shorter" above), so every line is this run's output. "Not introduced this
       run" is not a reason to skip a line. After producing the draft, check every line's
       length: 161-180 chars passes silently. Over 180 MUST be shortened and re-checked. The
       ONLY exemption is mechanical: a line whose single longest backtick-quoted literal is
       itself longer than 100 characters (a path, command, or exact phrasing that genuinely
       cannot be split) — that line is kept verbatim and listed as an exemption in the step-8
       report. No other reason exempts a line — not established formatting, not dense by
       convention, not pre-existing, not load-bearing detail. A line that's long because it holds
       several sentences is shortened by splitting it into several facts or dropping the
       history — never exempted. Only a draft that passes the gate (or has its overruns
       exempted under the 100-char backtick rule) is written to `.opencode/remember/MEMORY.md`.
   - **Episodes section**: append new episode entries, keep only the **10 most recent**.
     **Dedup before appending**: if a new episode covers the same work as one already in the
     section (same goal or same session's work under different wording — judge by content, not
     title), merge the new detail into the existing entry instead of appending a second copy.
     Re-processing a stash whose episode is already filed must not create a near-duplicate
     pair. Every older episode is **folded, then deleted**: its lesson becomes a fact (handed
     to the rewrite above); the narrative is removed. No archive — git has the history.
     **Specify the operation once.** The keep-10 rule is the rule; the set to remove is
     *derived* from it, never supplied alongside it as a second list. Given both, an agent
     applies both and removes their union — observed in the field: a run told to keep 10 and
     handed a 5-entry delete list removed 7, and the 2 extras were never folded, so one
     lesson left memory with nothing carrying it. **No episode is removed whose lesson has
     not been folded into a fact first**, and the two sets must match: state the count
     before, the count after, and name each episode removed. Removed-but-not-folded is a
     defect to report, not a tidy-up.
   - **Antigens section**: only update from friction output (step 4)
   - Write merged result to `.opencode/remember/MEMORY.md` in the format under step 5.

4. **Distill friction into antigens** (only if friction output exists)

   > Friction has already done the heavy part: it scanned the raw session logs,
   > kept only **observed user reactions** (corrections, curses, repeated stops),
   > pooled them per session, and lexically pre-grouped the obvious repeats. Each
   > cluster carries `theme`, `suggested_artifact`, `confidence`, `severity`,
   > `sessions` (recurrence count), `projects`, `signals`, `contexts` (the verbatim
   > user quotes), `preceding` (the agent action + result just before the reaction —
   > the trigger), and `self_suspect` (friction's guess that the user was correcting
   > *themselves*). **You work from these short quotes — never re-read the session
   > logs.** Friction's lexical grouping and flags are hints, not the verdict.

   - Read `.opencode/remember/friction/antigen_clusters.json`.
   - **4a. Classify** (the LLM classifies only — no merging, no arithmetic; counting
     and rendering are mechanical, see 4c and step 5). Call the mid-tier model once per
     cluster batch with each cluster's `contexts`, `preceding`, `errors`,
     `self_suspect`, `projects`, `sessions`, `top_keywords`, and the ledger's existing
     entries (`id`, `class_hints`, `rule`, `evidence.quotes`). For EACH cluster, output
     exactly one label — nothing else:
     - `drop` — self-directed correction, agent's own prose captured as context, or a
       real reaction too short/ambiguous to name a specific mistake (`self_suspect` and
       an empty `preceding` — no agent action — are strong self-directed cues). Don't
       force a match on one overlapping word.
     - an existing ledger id (`ag-NNN`) — only if the cluster is narrowly the SAME
       mistake class as that entry's `class_hints`+`rule`+`evidence.quotes`, not just
       similar sentiment. State the entry's specific claim precisely in the prompt (a
       generic one-liner rule is not enough to bound the match — see 4c Open item 2) and
       give the classifier a negative example, not just the positive claim, e.g. for
       ag-001 (validate, don't assert): "did you test it?" matches; "we're burning money,
       why is it failing?" does NOT — cost/outcome complaints are not validation claims.
     - `new:<theme>` — a real, agent-directed mistake matching no existing entry.
       `<theme>` is NOT freeform LLM prose: derive it mechanically from the cluster's
       own `top_keywords[0]` and `top_keywords[1]` (lowercase, hyphen-joined). This
       alone raised measured 5-run exact-label agreement from 0.884 to ~0.97-0.99 by
       removing wording variance as a source of disagreement — the remaining variance
       is genuine classification disagreement (drop vs. new:, or which existing id),
       not paraphrase noise. Also output a `rule`: one line stating the behavioral
       rule this cluster's evidence supports, same do/don't imperative style as an
       existing ledger entry's `rule` (e.g. "Never say work is validated... without an
       actual run behind it"). This is the only LLM-authored field here — `<theme>`
       naming stays mechanical. `friction.cjs count` requires it whenever the cluster's
       own `sessions >= 2` (it will create a ledger entry); below that it's unused.

     Output is `{cluster_index: label}` for `drop`/`ag-NNN`; for `new:<theme>`, output
     `{cluster_index: {label: "new:<theme>", rule: "<one-line rule>"}}`.
   - **4b. Route + tier by recurrence.** For each cluster and each same-label group
     (the clusters 4a gave the same label) — its tier comes from the distinct-
     conversation count `friction.cjs count` (4c) computes for it, the union of the
     group's hashes deduped against the ledger:
     - `suggested_artifact: antigen` (recurring + severe) or a same-label group → an
       **antigen** (a "do/don't" behavioral rule), with its verbatim evidence quotes.
     - `suggested_artifact: fact` (recurring + mild) → a **Fact**.
     - `suggested_artifact: episode` that did **not** land in a recurring group → **not
       an Episode, and at 1 session not written anywhere.** The Episodes section is stash-fed
       and capped at 10; friction's one-offs are cross-project and arrive by the dozen, so
       filing them there would flush the stash episodes. Nothing is lost: friction re-scans
       every session log on every run, so the cluster re-surfaces until it recurs — and at 2
       sessions it gets its home, a ledger `observing` entry (4c), which step 5 renders under
       Low Confidence. `suggested_artifact` is friction's structural proposal, not a filing
       decision; the filing rule is this list.
     - Confidence by distinct-session recurrence:
       - **High** (5+ sessions) → loaded hot via `@MEMORY.md`
       - **Medium** (3-4 sessions) → recorded under Antigens, *not* loaded hot
       - **Low** (<3 sessions) → ledger `observing` only at 2 sessions; nothing at 1
   - **Recurrence tiers bind everything, including same-label groups:** grouping consolidates
     evidence, it never elevates it — a same-label group's tier comes from its combined
     distinct-session count (e.g. a 2-session same-label group is still Low → ledger
     `observing` only, not an antigen entry in MEMORY.md).
   - **Never auto-promote.** Only High-confidence (5+ sessions) antigens load hot. A
     single dramatic correction is recorded nowhere yet, not an antigen.
   - **4c. Count** (`.opencode/remember/ledger.json`, the evidence trail linking each rule
     to the mistake it targets and whether it is working — replaces the old evidence-merge
     arithmetic; a script now does every count, not the LLM). **This is a literal command
     you run, not a description you reason from.** The LLM's job ended at 4a — do not
     hand-compute session counts, do not decide by inspection which entries changed, even
     if you are confident you can do it correctly. Create `ledger.json` as `{"version": 1,
     "entries": []}` if missing. It is JSON for exact matching — bookkeeping only, never
     injected into context as guidance (MEMORY.md is what gets read; the ledger is what
     gets checked).

     Entry shape:
     ```json
     { "id": "ag-001", "class": "claimed-done-not-verified",
       "class_hints": ["says pushed but", "none got it"],
       "status": "observing|hot|rejected|escalated",
       "rule": "<current phrasing>",
       "attempts": [{ "n": 1, "rule": "<phrasing>", "adopted": "YYYY-MM-DD", "outcome": "active|failed" }],
       "evidence": { "sessions": 0, "session_ids": [{ "id": "<project-label>/<MMDD-HHMM>-<hash>", "seen": "YYYY-MM-DD" }], "projects": [], "quotes": [], "last_seen": "YYYY-MM-DD" },
       "recurred_while_hot": 0,
       "history": [{ "date": "YYYY-MM-DD", "event": "<transition>" }] }
     ```

     Immediately after 4a produces `labels.json`, run these exact commands as real shell
     invocations, in order. First:
     ```bash
     node <path-to-friction.cjs> migrate-attempts .opencode/remember/ledger.json .opencode/remember/ledger.json
     ```
     This records any hand-drifted `rule` text as a new attempt so I7 (`rule` == the last
     attempt's `rule`) holds before counting runs; it is a no-op on an already-consistent
     ledger, so always run it regardless of whether drift is suspected. Then:
     ```bash
     node <path-to-friction.cjs> count <labels.json> <ledger.json> <clusters.json> <today's-date> <ledger.json>.new .opencode/remember/friction/count_report.json
     ```
     Then **overwrite `ledger.json` with `<ledger.json>.new`'s contents** (e.g. `mv
     ledger.json.new ledger.json`). Do not stop after `labels.json` — producing labels is
     4a, not the deliverable of this step. `friction.cjs count <labels.json> <ledger.json>
     [clusters.json] [runDate] [outLedgerPath] [reportPath]` is deterministic, no LLM
     involved, so it can't drift between repos or runs; the count report is also written to
     `.opencode/remember/friction/count_report.json` for step 8 to read back. It implements,
     mechanically, everything the old
     prose reasoning here used to require by hand:

     - **Session identity** — the trailing 8-char hash of a session id (stable across
       project-label renames) — with the same fork/resume canonicalization friction.cjs
       already applies before clusters are emitted (sessions sharing >=1 message `uuid`
       collapse to one canonical id; do not re-derive fork identity yourself).
     - **Migration (one-time, grandfathered): SEED, DO NOT COUNT** — an entry whose
       `session_ids` is empty going in AND carries no prior "identity migration" history
       line has that line's first match seed `session_ids` from this run's matches WITHOUT
       incrementing `sessions`/`last_seen`/`recurred_while_hot`. The **migration-fill
       sub-case** — `session_ids` still empty but an "identity migration" line already
       exists — fills `session_ids` on the first post-migration match, still without
       incrementing; counting resumes only once `session_ids` is non-empty.
     - **Counting is per CLUSTER INDEX, never per hash and never once per label-group.**
       For each cluster index in a matched group: if none of that cluster's own hashes are
       already in the entry's stored set, it is one genuinely new conversation — `sessions`
       += 1 (never by hash count), `last_seen` refreshed, and — if the entry is `hot` and
       the session's own date is on/after the current attempt's `adopted` date (the
       **adopted-date gate**: a mistake that predates the rule's current phrasing isn't a
       phrasing failure of it) — `recurred_while_hot` += 1. A gated-out (predates-adopted)
       new conversation still counts as evidence (sessions, hash) but not toward
       `recurred_while_hot`. A hash already present is a re-scan of an already-counted
       conversation: only missing alias hashes are added, nothing else changes.
     - Promotes `observing`→`hot` at `sessions >= 5` (a fresh ledger on a project with
       mature global evidence can hit the hot case on its very first run: new entry born
       `hot` directly if `sessions >= 5` on arrival).
     - **No match, cluster `sessions` == 1** → writes nothing. The ledger tracks
       recurrence; a single occurrence has none to track yet. Friction re-scans every
       session log every run, so a later run matches it back to 2+ sessions and seeds it
       then — this does not change matching against an EXISTING entry, which is recurrence
       regardless of the matching cluster's own session count. **A match is not an
       increment.** Whether it counts as a new conversation is decided in 4c by
       `friction.cjs count`, which is a no-op when that session hash is already stored — so
       several matches against one entry routinely produce zero increments, and that is
       correct, not a miscount.
     - For `new:<theme>` groups with no ledger match: distinct conversations = distinct
       cluster indices in the group (within one classify batch, no two cluster indices
       share a session hash). `sessions < 2` → writes nothing. `sessions >= 2` → new entry,
       `status` follows the same >=5-hot / else-observing rule.

     **Open item 1 — `new:` label collisions: resolved (Guard B).** `new:` clusters never
     merge in-batch, regardless of whether two cluster indices share the same `new:` string
     — each `new:` cluster with `sessions >= 2` creates its own ledger entry, and a genuine
     recurrence of the same new mistake is matched on a later run by `class_hints`, like any
     other entry. Measured against the alternative (merge same-labeled `new:` clusters when
     their `top_keywords` overlap by >=1): a synthetic new entry was correctly re-matched by
     a fresh classifier on 5/5 runs under Guard B, while the keyword-overlap guard wrongly
     merged two real, distinct mistakes on real data (clusters 21/23 — unrelated mistakes
     sharing the generic keyword "fucking validate"). `friction.cjs count` implements Guard
     B: every `new:`-labeled cluster stands alone.

     **Open item 2 — a generic one-line `rule` under-specifies the class for matching:**
     the ledger's `class_hints`+`rule` alone can be too broad for the LLM classifier (4a)
     to reliably tell two different mistakes apart, as the "fucking validate" false-merge
     case above shows. Consider requiring a short negative example ("NOT X, even though it
     sounds similar") on ledger entries whose `class_hints` are single generic words/phrases.

     **After `friction.cjs count` returns**, resume the parts it does not do:
     - **Escalation.** For any `hot` entry the count run left with `recurred_while_hot >=
       2`: the phrasing failed. Mark the current attempt `outcome: "failed"`, draft
       attempt n+1 — it must differ from **every** prior attempt's text in this entry
       (failed attempts are the rejected-edit buffer: never re-propose one verbatim) —
       replace `rule`, update MEMORY.md's Antigens section (step 5), reset
       `recurred_while_hot` to 0. If 2 attempts have already failed and the antigen
       persists → `status: "escalated"`: remove the rule from MEMORY.md's hot section,
       record a Fact instead ("persistent failure mode: <class> — no phrasing reduces
       it"), and flag it in the step-8 report. **Flag, don't act** — the user decides:
       enforcement (a hook, where the tool has them) or accepted limit.
     - **`escalated`/`rejected` entries** (rejected = user veto) never get a new attempt
       proposed, count run or not.

     **Decay (observing only).** Antigens are the fastest-decaying artifact and, until now,
     had no exit. This is meaningful *because* of the identity fix above — without it,
     `last_seen` would refresh on every re-scan and nothing would ever go stale. After the
     matching pass, sweep every `observing` entry: if its `last_seen` is **older than 8
     weeks** (matching the ~7-week transcript retention — evidence that old can no longer be
     re-verified against the source logs), set `status: "expired"` and append a history line
     "expired — no new evidence in 8+ weeks". The ledger entry is **kept**, never deleted
     (append-only doctrine) — it just stops rendering into MEMORY.md. If a later run's new
     session hash matches an `expired` entry's `class_hints`, merge the evidence and set
     `status` back to `"observing"` with history "reactivated". `hot` entries **never expire
     by age** — a loaded rule that stops recurring is the rule working, not staleness; a hot
     entry leaves hot only via the existing `recurred_while_hot` escalation path above.
     `escalated`/`rejected` are untouched by decay.

     Consistency: MEMORY.md's Antigens section is the render; the ledger is the record —
     after 4c every hot antigen in MEMORY.md has a matching `hot` ledger entry. Mutations
     are append-friendly: merge evidence and change status, never delete entries or history
     lines. If ledger.json is malformed, say so loudly, move it aside as
     `ledger.json.bad-<date>`, and start fresh — never silently overwrite.

5. **Inject memory + rules references into AGENTS.md**
   - Compose the section between `<!-- MEMORY:START -->` and `<!-- MEMORY:END -->` markers:
     ```
     <!-- MEMORY:START -->
     @.opencode/remember/MEMORY.md
     <!-- MEMORY:END -->
     ```
   - The reference is an **explicit path** (`@.opencode/remember/MEMORY.md`) — `@`-references
     resolve relative to the file containing them, so a bare `@MEMORY.md` in the project root
     would point at a nonexistent root-level file. Claude loads the full file directly, so no
     inline duplication is needed
   - If `.opencode/remember/AGENT_RULES.md` exists (bootstrapped in step 1), compose a second,
     independent section between `<!-- AGENT_RULES:START -->` and `<!-- AGENT_RULES:END -->`
     markers. Unlike MEMORY.md above, the file itself is **never `@`-referenced** — an
     `@`-reference hot-loads all ~300 lines into every session, and it is a standards guide
     to consult when designing/building something new, not hot context. The section carries
     a path pointer plus exactly two inline rules: the ones that change what you TYPE, which
     you cannot look up because you do not know you need them. Everything else stays behind
     the pointer. Write the section verbatim, rules first:
     ```
     <!-- AGENT_RULES:START -->
     **One writer per piece of state.** One function assigns each field; everything else
     calls it. Grep who writes it before you write it — and if a write can land from a
     callback, thread, or lifecycle, the reader must tell stale from fresh.

     **Surgical changes only.** Touch what the task requires. Dead code, nits, bugs you
     pass: if it's inside or affects the code you're already changing and the fix changes
     no behavior, fix it and say so — otherwise report it and say what it costs to leave
     it. A problem you don't fix goes in the report, never in a comment.

     Standards guide (read when designing/building something new, not hot context):
     .opencode/remember/AGENT_RULES.md
     <!-- AGENT_RULES:END -->
     ```
   - Each marker pair is independent: if AGENTS.md lacks a given pair, append it at the
     end; if no AGENTS.md exists, create one containing whichever section(s) apply.
   - **An existing AGENT_RULES pair is left alone — bootstrap once, never overwrite.** The
     block above is what to write when creating it, not a template to re-impose every run.
     Users trim this section deliberately (a pointer-only variant is common), and rewriting
     it silently re-adds text they removed, on every single run, forever. Observed in the
     field: a run restored the inline rules into a AGENTS.md whose owner had cut them, and
     the edit had to be reverted by hand. This matches how `AGENT_RULES.md` itself is
     handled — bootstrapped once, never overwritten after.
   - If an existing pair is present but its **path pointer** is missing or wrong, that is
     load-bearing: **report it and stop**, do not silently rewrite the section around it.

   ```markdown
   # Project Memory
   > Auto-generated by /remember. Do not edit manually.

   ## Facts
   - [one-line rule, target 160 chars, hard stop 180]

   ## Episodes
   ### YYYY-MM-DD - [title]
   - [bullet narrative]

   ## Antigens
   [rendered — see below, do not hand-write]
   ```
   **The `## Antigens` section is rendered, not hand-written — run this too, as a literal
   command, do not hand-write it even to match the format shown above.** After 4c has
   overwritten `ledger.json`, run:
   ```bash
   node <path-to-friction.cjs> render <ledger.json>
   ```
   Take that command's stdout **verbatim** and replace MEMORY.md's entire `## Antigens`
   section with it (from the `## Antigens` line up to, but not including, the next `## `
   heading, or to end of file if Antigens is the last section — it usually is). This step's
   output IS the correctness check for itself: after replacing, `node
   <path-to-friction.cjs> check <ledger.json> <MEMORY.md>` must report `I6-new: EQUAL` — if
   it doesn't, something was edited by hand instead of pasted from the script's stdout; redo
   it from the script's stdout exactly, never patch MEMORY.md manually to make it match.

   `friction.cjs render` prints the section byte-for-byte, no LLM paraphrase, no manual
   template filling:
   ```
   ## Antigens
   ### High Confidence (loaded — applies every session)
   - [behavioral rule] (evidence: [N] sessions, [P] projects — "[quote1]", "[quote2]") — ag-NNN

   ### Medium Confidence (observing — not loaded)
   - [behavioral rule] (evidence: [N] sessions) — ag-NNN

   ### Low Confidence (needs more data)
   - [pattern] (evidence: [N] sessions) — ag-NNN
   ```
   Tiers: High = `status == "hot" && sessions >= 5` (the only tier that prints quotes — the
   first 2 of `evidence.quotes`, verbatim, capped at 2 — and `evidence.projects.length`).
   Medium = `status == "observing" && 3 <= sessions <= 4`. Low = `status == "observing" &&
   sessions == 2`. `expired`/`escalated`/`rejected`/`sessions < 2` never render, same as
   before — an entry marked `expired` by the decay rule (4c) is skipped here even though it
   stays in `ledger.json`. A legacy 1-session `observing` entry (see 4b) stays in the ledger
   and grows or expires like any other, but is not rendered. An empty tier prints `- (none —
   <why>)`, one line, never an empty section.

6. **Update processed manifest**
   - Append paths of newly processed stashes to `.opencode/remember/.processed`

7. **Docs reconcile check + auto re-index** (best-effort, crash-isolated like step 0)

   `/remember` never reconciles doc CONTENT, never writes frontmatter, never edits a page —
   the only write here is the generated `docs/index.md` itself, via the same deterministic
   `index-flat` script `/docs-builder` already uses, never a model call. Wrapped so any
   failure here can never block the memory write that already happened in steps 3-6.

   - **Locate `docs-builder.cjs`** — bundled next to this command at
     `docs-builder/docs-builder.cjs` (same convention as `remember/friction.cjs`). Call it by
     its **absolute path** in the command below — the cwd here is the target repo, not this
     package, so a cwd-relative path fails everywhere except the liteagents repo itself.
   - **Not applicable, stay silent:** if the project has no `docs/` directory, skip without
     saying anything. Most projects have no doc corpus and a nudge every run is noise.
   - **Applicable but could not run — say so, loudly:** if `docs/` exists but the script is
     missing, `git` fails, or the command errors, print one line explaining why the check
     was skipped. Never fail silently.
   - **`docs/` exists but no `docs/.docs-builder/` directory:** docs-builder has never run
     here — print one line telling the user to run `/docs-builder reorg` to organize and
     index the corpus. Do NOT tell them to run `ledger` instead: `ledger` only stamps
     whatever is currently on disk as the baseline, so on an unsorted pile it would record
     the mess as correct and `due` would then report NOT due forever.
   - **`docs/.docs-builder/ledger.json` exists:** run `due` and pass through its verdict, as
     below.
   - Otherwise run it and pass through its verdict:
     ```bash
     node <docs-builder.cjs> due
     ```
     `due` compares `docs/` against the SHA stamped in `docs/.docs-builder/ledger.json`
     using `git diff --numstat -M`, classifying each doc as new / moved / moved+changed /
     changed (with the line delta and rough percentage) / deleted. It is **due at >=5
     changed docs** — the same derived-not-counted shape as `/stash`'s nudge.
   - If `due` prints "no ledger yet" (no `docs/.docs-builder/ledger.json` to compare against),
     do NOT relay it — print the same `/docs-builder reorg` line as the no-`docs/.docs-builder/`
     case above, for the same reason: `ledger` would stamp an unsorted pile as correct.
   - **Auto re-index — script only, no model, in addition to the DUE advisory below, not a
     replacement for it.** If `due`'s output was NOT `docs unchanged since <sha>. NOT due.`
     (i.e. it printed a row table -- any new/moved/moved+changed/changed/deleted doc, whether
     or not the >=5 threshold below was crossed), the index has drifted and self-heals right
     here, unconditionally:
     ```bash
     node <docs-builder.cjs> index-flat
     ```
     Same script `/docs-builder reorg` already calls, run standalone — no model call, no
     interview, nothing moves. Note in the step-8 report that `docs/index.md` (and
     `docs/log.md`, if `index-flat` touched it) were regenerated, so they are included
     alongside whatever step 3-6 already changed when this run is committed.
   - If DUE (the row count crossed the >=5 threshold), ALSO end with one line:
     ```
     docs: 7 changed since 991f72d3 — run /docs-builder reorg
     ```

8. **Report to user** — print it AND write the same content to `.opencode/remember/report.md`
   (overwritten each run; the ledger keeps history — the report is just the latest snapshot)
   - Number of stashes processed
   - Facts count (before → after the rewrite) plus how many existing lines were merged or
     shortened. At steady state — lines already ≤160, no near-duplicates — a run that grows by
     exactly its new facts and shortens nothing is correct; say so rather than forcing merges
     to hit a number. The bound on facts is the write-bar at entrance, not a count.
   - **Mechanical length check** — run, don't estimate. This confirms the step-3 gate rather
     than being the first check to catch an overrun. It implements the SAME mechanical
     exemption as the gate (a line whose longest backtick literal exceeds 100 chars is not
     flagged), so this count and the gate's count can never disagree:
     ```bash
     awk '
     /^## Facts/{f=1} /^## Episodes/{f=0}
     f && /^- / && length($0)>180 {
       line=$0; maxlen=0
       while (match(line, /`[^`]*`/)) {
         seglen = RLENGTH-2
         if (seglen > maxlen) maxlen = seglen
         line = substr(line, RSTART+RLENGTH)
       }
       if (maxlen <= 100) print
     }' .opencode/remember/MEMORY.md
     ```
     Print every line it returns and the count. Zero is the target; non-zero means a gate miss
     — every remaining overrun already had its chance to be exempted (100-char backtick
     literal) inside the step-3 gate, so anything printed here should not exist.
   - Episodes count (new, kept hot, folded + deleted)
   - Antigens count by confidence tier, with how many newly promoted to hot — sourced
     from `.opencode/remember/friction/count_report.json` (4c's count report), not
     recomputed by hand
   - Ledger lines — one per non-observing entry: id, short rule, status, recurrences since
     adoption. Highlight rephrased (RECURRED) and ESCALATED entries; escalations need a
     user decision, e.g.:
     ```
     ledger: ag-001 "verify live after publish"  hot, 0 recurrences since 2026-07-10
     ledger: ag-003 "don't commit per change"    RECURRED while hot (2/2) → rephrased, attempt 2
     ledger: ag-002 "literal scoped ask"         ESCALATED → Fact; 2 phrasings failed. Hook or accept?
     ```
   - If AGENT_RULES.md was bootstrapped this run, say so (one line)
   - If step 7 ran the auto re-index, say so and name the regenerated files
     (`docs/index.md`, plus `docs/log.md` if touched) so they are staged with this run
   - Confirm MEMORY.md and AGENTS.md updated

**File locations (all project-local — two dirs: `/stash` owns `.opencode/stash/`, `/remember` owns `.opencode/remember/`)**
- Stash files: `.opencode/stash/*.md`
- Memory file: `.opencode/remember/MEMORY.md` (single source of truth, referenced as `@.opencode/remember/MEMORY.md`)
- Rules template: `.opencode/remember/AGENT_RULES.md` (bootstrapped once from the bundled package template on first `/remember` run, never overwritten again — user-owned after that; referenced by a plain path pointer, not `@`-referenced — see step 5)
- Antigen ledger: `.opencode/remember/ledger.json` (per-rule evidence trail: class, status, attempts/rejected-buffer, recurrence-while-hot)
- Consolidation report: `.opencode/remember/report.md` (latest step-8 report, overwritten each run)
- Processed manifest: `.opencode/remember/.processed`
- Docs ledger (READ ONLY from here — owned by `/docs-builder`): `docs/.docs-builder/ledger.json`
- Friction output (transient, regenerated each run): `.opencode/remember/friction/` — `antigen_clusters.json` (preferred input), `antigen_review.md` (fallback), plus raw analysis files
- Output: `AGENTS.md` (managed MEMORY section, plus an AGENT_RULES section once bootstrapped)
