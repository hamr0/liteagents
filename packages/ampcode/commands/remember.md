---
name: remember
description: Consolidate stashes + friction into project memory
usage: /remember
---

Run friction analysis, then consolidate session stashes + friction antigens into a single project-local MEMORY.md, and inject into AGENT.md. Friction runs automatically (best-effort) — there is no separate `/friction` command.

**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- **Precision over recall for hot memory.** A false antigen loaded into `@MEMORY.md` steers every future session. When unsure, record as a low-confidence episode — do not promote.
- **Mid-tier model, not hardcoded.** Steps 2/3/4a delegate to a mid-tier model — capable of
  semantic judgment, cheaper/faster than your top reasoning tier (e.g. Claude's Sonnet vs
  Opus). Use whatever your tool designates as that balanced default; never hardcode a
  vendor-specific model name.
- **Batch independent subagent calls.** Step 2's per-stash extractions are independent of
  each other — spawn them concurrently (parallel/background subagent calls in one turn)
  where your tool supports it, instead of processing stashes one at a time.

**What it does**

Reads all raw material (`.amp/stash/*.md` + `.amp/remember/friction/antigen_clusters.json`), extracts durable facts, episodes, and behavioral antigens into a single `.amp/remember/MEMORY.md`, then injects a managed memory section into `AGENT.md`.

**Steps**

0. **Run friction first** (best-effort — friction analyzes ALL your usage, not just this repo)

   Friction's signal is *global*: recurring corrections and frustrations across every
   project are behavioral lessons worth keeping everywhere. So point it at the tool's
   **global sessions root** (all projects), not a per-project directory.

   - **Locate `friction.js`** — it is bundled next to this command at `remember/friction.js`
     (the same directory as `remember.md`, whether installed or run from the package). If it
     exists nowhere, skip to step 1 (stash-only) and tell the user friction.js is missing.
   - **Resolve the global sessions root** — probe this list top-to-bottom, use the first that
     exists and contains `.jsonl` files (recursively). **Never prompt the user.**
     ```
     # ── Add your own global sessions root at the TOP so it is checked first ──
     ~/.claude/projects/                 # Claude Code
     ~/.factory/projects/                # Droid / Factory
     ~/.config/amp/projects/             # Amp
     ~/.config/opencode/projects/        # opencode
     ~/.codex/sessions/                  # Codex CLI  (use $CODEX_HOME/sessions/ if set)
     ~/.gemini/antigravity-cli/brain/    # Antigravity
     ```
     > Note: `friction.js` parses Claude Code's session schema. The Codex/Antigravity roots
     > will resolve but yield no signals until friction learns their formats — open an issue
     > to request one: https://github.com/hamr0/liteagents/issues
   - **Run** `node <friction.js> "<resolved-root>"`. friction writes its output to
     `.amp/remember/friction/` in the current project.
   - **On any miss — loud, never silent.** If no root resolves, or friction errors, or it
     finds no usable sessions, print this and continue with stash-only consolidation:
     > ⚠️ Friction didn't run — no sessions found. To enable it, open this command file
     > (`remember.md`) and add your tool's **global** sessions root to the TOP of the probe
     > list in step 0, then re-run `/remember`. Consolidating stashes only this time.

1. **Gather sources**
   - **Legacy layout migration (one-time, loud).** Older versions used `.amp/memory/` and
     `.amp/friction/`. If either exists: move the pipeline files
     `.amp/memory/{MEMORY.md,ledger.json,.processed}` → `.amp/remember/`, and **discard**
     the old `.amp/friction/` contents entirely — friction regenerates all of its output
     fresh every run (step 0 has already rebuilt it in `.amp/remember/friction/` by the time
     migration runs; stale copies carry no unique information and moving them would overwrite
     fresh output). **Move only those pipeline files** — anything else in `.amp/memory/`
     (e.g. user-owned rule files) stays where it is. Remove the old dirs only if empty, update the managed MEMORY section in AGENT.md to
     the new reference (step 5), and tell the user exactly what moved.
   - **Bootstrap `AGENT_RULES.md` (one-time, silent-if-present).** If
     `.amp/remember/AGENT_RULES.md` does not exist, copy it from the bundled template next
     to this command (`remember/AGENT_RULES.md`, same directory as `friction.js`). If it
     already exists, leave it untouched — never overwrite, even if the bundled template
     changes in a later version; it becomes user-owned the moment it lands in the project.
   - Read all `.amp/stash/*.md` files in the current project
   - Read friction output written in step 0: `.amp/remember/friction/antigen_clusters.json` (preferred) or `.amp/remember/friction/antigen_review.md` (fallback)
   - Read existing `.amp/remember/MEMORY.md` if it exists — create dir if missing
   - Read processed manifest at `.amp/remember/.processed` — skip already-processed stashes
   - If no unprocessed stashes AND friction produced no new antigens, report "nothing to consolidate" and stop

2. **Extract from unprocessed stashes** (spawn one subagent per stash, in parallel — see Guardrails)
   - For each unprocessed stash, call the mid-tier model (see Guardrails) to extract:
     - **FACTS** (atomic, one-line): stable preferences, decisions, corrections, explicit "remember this"
     - **EPISODE** (3-5 bullet narrative): what was the goal, what was tried, outcome, lesson
     - **SKIP**: code details, file paths, errors, mechanical steps, LLM responses
   - Collect all new facts and episodes

3. **Merge into MEMORY.md**
   - Read existing `.amp/remember/MEMORY.md` and parse its sections (## Facts, ## Episodes, ## Antigens)
   - **Facts section**: call the mid-tier model with existing facts + newly extracted facts
     - Rules: new updates replace old, contradictions keep new version, duplicates dropped
     - Keep facts atomic, one line each
   - **Episodes section**: append new episode entries (append-only, timestamped, no dedup)
   - **Antigens section**: only update from friction output (step 4)
   - Write merged result to `.amp/remember/MEMORY.md` in the format under step 6.

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

   - Read `.amp/remember/friction/antigen_clusters.json`.
   - **4a. Classify target, then semantically consolidate** (the parts lexical matching can't do).
     Call the mid-tier model with the cluster quotes + their `preceding`/`projects`/`sessions`/`self_suspect`
     (NOT the logs), and have it:
     1. **Decide the target of each reaction — agent or self.** Drop *self/context*
        corrections where the user redirected themselves ("wrong project", "wrong window",
        "nevermind") — the agent did nothing wrong. `self_suspect` and an empty `preceding`
        (no agent action) are strong cues. Keep only **agent-directed** reactions.
     2. **Merge same-complaint paraphrases** that friction left split because they share no
        words (e.g. "nothing landed, fuck you" + "it says pushed but none got it" → one antigen).
     Output one object per surviving antigen:
     ```json
     {
       "rule": "Verify the artifact is actually live after publish; a clean exit code ≠ done",
       "target": "agent",
       "evidence": ["both say pushed... none got it", "notng landed in live-claude, fuck you"],
       "errors": ["Exit code 0 (claimed success)"],
       "sessions": 2,
       "confidence": "medium"
     }
     ```
   - **4b. Route + tier by recurrence.** For each cluster and each LLM-merged group:
     - `suggested_artifact: antigen` (recurring + severe) or an LLM-merged group → an
       **antigen** (a "do/don't" behavioral rule), with its verbatim evidence quotes.
     - `suggested_artifact: fact` (recurring + mild) → a **Fact**.
     - `suggested_artifact: episode` that did **not** merge into a recurring group → an
       **Episode** (one-off; recorded, not a rule).
     - Confidence by distinct-session recurrence:
       - **High** (5+ sessions) → loaded hot via `@MEMORY.md`
       - **Medium** (3-4 sessions) → recorded under Antigens, *not* loaded hot
       - **Low** (<3 sessions) → keep as Episode only
   - **Recurrence tiers bind everything, including LLM-merged groups:** merging consolidates
     evidence, it never elevates it — a merged group's tier comes from its combined
     distinct-session count (e.g. a 2-session merged group is still Low → Episode + ledger
     `observing`, not an antigen entry in MEMORY.md).
   - **Never auto-promote.** Only High-confidence (5+ sessions) antigens load hot. A
     single dramatic correction is an Episode, not an antigen.
   - Update the Antigens section in MEMORY.md (promote/demote based on new recurrence).
   - **4c. Update the antigen ledger** (`.amp/remember/ledger.json`) — the evidence trail
     linking each rule to the mistake it targets and whether it is working. Create it as
     `{"version": 1, "entries": []}` if missing. It is JSON for exact matching — bookkeeping
     only, never injected into context as guidance (MEMORY.md is what gets read; the ledger
     is what gets checked).

     Entry shape:
     ```json
     { "id": "ag-001", "class": "claimed-done-not-verified",
       "class_hints": ["says pushed but", "none got it"],
       "status": "observing|hot|rejected|escalated",
       "rule": "<current phrasing>",
       "attempts": [{ "n": 1, "rule": "<phrasing>", "adopted": "YYYY-MM-DD", "outcome": "active|failed" }],
       "evidence": { "sessions": 0, "projects": [], "quotes": [], "last_seen": "YYYY-MM-DD" },
       "recurred_while_hot": 0,
       "history": [{ "date": "YYYY-MM-DD", "event": "<transition>" }] }
     ```

     For each surviving antigen from 4a/4b, match against existing entries by `class_hints`
     (the mistake class, not the rule wording — rules change, the class doesn't):
     - **No match** → new entry, `status: "observing"`, attempt 1, history "candidate (N sessions)".
     - **Match, `observing`** → merge evidence (sessions, quotes, projects, last_seen).
       Crosses the 4b hot threshold → `status: "hot"`, history "promoted to hot (N sessions)".
     - **Match, `hot`** → the mistake happened *while its rule was loaded*:
       `recurred_while_hot += 1`, merge evidence, history "recurred while hot (count)".
       - At `recurred_while_hot >= 2`: the phrasing failed. Mark the current attempt
         `outcome: "failed"`, draft attempt n+1 — it must differ from **every** prior
         attempt's text in this entry (failed attempts are the rejected-edit buffer: never
         re-propose one verbatim) — replace `rule`, update MEMORY.md's Antigens section,
         reset `recurred_while_hot` to 0.
       - If 2 attempts have already failed and the antigen persists → `status: "escalated"`:
         remove the rule from MEMORY.md's hot section, record a Fact instead ("persistent
         failure mode: <class> — no phrasing reduces it"), and flag it in the step-7 report.
         **Flag, don't act** — the user decides: enforcement (a hook, where the tool has
         them) or accepted limit.
     - **Match, `escalated`/`rejected`** (rejected = user veto) → merge evidence only; never re-propose.

     Consistency: MEMORY.md's Antigens section is the render; the ledger is the record —
     after 4c every hot antigen in MEMORY.md has a matching `hot` ledger entry. Mutations
     are append-friendly: merge evidence and change status, never delete entries or history
     lines. If ledger.json is malformed, say so loudly, move it aside as
     `ledger.json.bad-<date>`, and start fresh — never silently overwrite.

5. **Inject memory + rules references into AGENT.md**
   - Compose the section between `<!-- MEMORY:START -->` and `<!-- MEMORY:END -->` markers:
     ```
     <!-- MEMORY:START -->
     @.amp/remember/MEMORY.md
     <!-- MEMORY:END -->
     ```
   - The reference is an **explicit path** (`@.amp/remember/MEMORY.md`) — `@`-references
     resolve relative to the file containing them, so a bare `@MEMORY.md` in the project root
     would point at a nonexistent root-level file. Claude loads the full file directly, so no
     inline duplication is needed
   - If `.amp/remember/AGENT_RULES.md` exists (bootstrapped in step 1), compose a second,
     independent section between `<!-- AGENT_RULES:START -->` and `<!-- AGENT_RULES:END -->`
     markers:
     ```
     <!-- AGENT_RULES:START -->
     Consult when building something new or adding a feature — a standards guide, not hot
     context like MEMORY.md above:
     @.amp/remember/AGENT_RULES.md
     <!-- AGENT_RULES:END -->
     ```
   - Each marker pair is independent: if AGENT.md already has a given pair, replace the
     section between them; if not, append it at the end; if no AGENT.md exists, create one
     containing whichever section(s) apply

   ```markdown
   # Project Memory
   > Auto-generated by /remember. Do not edit manually.

   ## Facts
   - [atomic fact 1]

   ## Episodes
   ### YYYY-MM-DD - [title]
   - [bullet narrative]

   ## Antigens
   ### High Confidence (loaded — applies every session)
   - [behavioral rule] (evidence: [N] sessions — "[verbatim quote]")

   ### Medium Confidence (observing — not loaded)
   - [behavioral rule] (evidence: [N] sessions)

   ### Low Confidence (needs more data)
   - [pattern] (evidence: [N] sessions)
   ```

6. **Update processed manifest**
   - Append paths of newly processed stashes to `.amp/remember/.processed`

7. **Report to user** — print it AND write the same content to `.amp/remember/report.md`
   (overwritten each run; the ledger keeps history — the report is just the latest snapshot)
   - Number of stashes processed
   - Facts count (total, new)
   - Episodes count (total, new)
   - Antigens count by confidence tier, with how many newly promoted to hot
   - Ledger lines — one per non-observing entry: id, short rule, status, recurrences since
     adoption. Highlight rephrased (RECURRED) and ESCALATED entries; escalations need a
     user decision, e.g.:
     ```
     ledger: ag-001 "verify live after publish"  hot, 0 recurrences since 2026-07-10
     ledger: ag-003 "don't commit per change"    RECURRED while hot (2/2) → rephrased, attempt 2
     ledger: ag-002 "literal scoped ask"         ESCALATED → Fact; 2 phrasings failed. Hook or accept?
     ```
   - If AGENT_RULES.md was bootstrapped this run, say so (one line)
   - Confirm MEMORY.md and AGENT.md updated

**File locations (all project-local — two dirs: `/stash` owns `.amp/stash/`, `/remember` owns `.amp/remember/`)**
- Stash files: `.amp/stash/*.md`
- Memory file: `.amp/remember/MEMORY.md` (single source of truth, referenced as `@.amp/remember/MEMORY.md`)
- Rules template: `.amp/remember/AGENT_RULES.md` (bootstrapped once from the bundled package template on first `/remember` run, never overwritten again — user-owned after that; referenced as `@.amp/remember/AGENT_RULES.md`)
- Antigen ledger: `.amp/remember/ledger.json` (per-rule evidence trail: class, status, attempts/rejected-buffer, recurrence-while-hot)
- Consolidation report: `.amp/remember/report.md` (latest step-7 report, overwritten each run)
- Processed manifest: `.amp/remember/.processed`
- Friction output (transient, regenerated each run): `.amp/remember/friction/` — `antigen_clusters.json` (preferred input), `antigen_review.md` (fallback), plus raw analysis files
- Output: `AGENT.md` (managed MEMORY section, plus an AGENT_RULES section once bootstrapped)
