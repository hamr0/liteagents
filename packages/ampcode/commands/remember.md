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

**What it does**

Reads all raw material (`.amp/stash/*.md` + `.amp/friction/antigen_clusters.json`), extracts durable facts, episodes, and behavioral antigens into a single `.amp/memory/MEMORY.md`, then injects a managed memory section into `AGENT.md`.

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
     `.amp/friction/` in the current project.
   - **On any miss — loud, never silent.** If no root resolves, or friction errors, or it
     finds no usable sessions, print this and continue with stash-only consolidation:
     > ⚠️ Friction didn't run — no sessions found. To enable it, open this command file
     > (`remember.md`) and add your tool's **global** sessions root to the TOP of the probe
     > list in step 0, then re-run `/remember`. Consolidating stashes only this time.

1. **Gather sources**
   - Read all `.amp/stash/*.md` files in the current project
   - Read friction output written in step 0: `.amp/friction/antigen_clusters.json` (preferred) or `.amp/friction/antigen_review.md` (fallback)
   - Read existing `.amp/memory/MEMORY.md` if it exists — create dir if missing
   - Read processed manifest at `.amp/memory/.processed` — skip already-processed stashes
   - If no unprocessed stashes AND friction produced no new antigens, report "nothing to consolidate" and stop

2. **Extract from unprocessed stashes** (use Task tool with sonnet model for each)
   - For each unprocessed stash, call sonnet to extract:
     - **FACTS** (atomic, one-line): stable preferences, decisions, corrections, explicit "remember this"
     - **EPISODE** (3-5 bullet narrative): what was the goal, what was tried, outcome, lesson
     - **SKIP**: code details, file paths, errors, mechanical steps, LLM responses
   - Collect all new facts and episodes

3. **Merge into MEMORY.md**
   - Read existing `.amp/memory/MEMORY.md` and parse its sections (## Facts, ## Episodes, ## Antigens)
   - **Facts section**: call sonnet with existing facts + newly extracted facts
     - Rules: new updates replace old, contradictions keep new version, duplicates dropped
     - Keep facts atomic, one line each
   - **Episodes section**: append new episode entries (append-only, timestamped, no dedup)
   - **Antigens section**: only update from friction output (step 4)
   - Write merged result to `.amp/memory/MEMORY.md` in the format under step 6.

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

   - Read `.amp/friction/antigen_clusters.json`.
   - **4a. Classify target, then semantically consolidate** (the parts lexical matching can't do).
     Call sonnet with the cluster quotes + their `preceding`/`projects`/`sessions`/`self_suspect`
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
   - **Never auto-promote.** Only High-confidence (5+ sessions) antigens load hot. A
     single dramatic correction is an Episode, not an antigen.
   - Update the Antigens section in MEMORY.md (promote/demote based on new recurrence).

5. **Inject memory reference into AGENT.md**
   - Compose the section between `<!-- MEMORY:START -->` and `<!-- MEMORY:END -->` markers:
     ```
     <!-- MEMORY:START -->
     @MEMORY.md
     <!-- MEMORY:END -->
     ```
   - The `@MEMORY.md` reference points to `.amp/memory/MEMORY.md` — Claude loads the full file directly, so no inline duplication is needed
   - If AGENT.md already has MEMORY markers, replace the section between them
   - If AGENT.md has no MEMORY markers, append the section at the end
   - If no AGENT.md exists, create one with just the memory section

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
   - Append paths of newly processed stashes to `.amp/memory/.processed`

7. **Report to user**
   - Number of stashes processed
   - Facts count (total, new)
   - Episodes count (total, new)
   - Antigens count by confidence tier, with how many newly promoted to hot
   - Confirm MEMORY.md and AGENT.md updated

**File locations (all project-local)**
- Memory file: `.amp/memory/MEMORY.md` (single source of truth, referenced as @MEMORY.md)
- Stash files: `.amp/stash/*.md`
- Friction output: `.amp/friction/antigen_clusters.json` (observed-reaction clusters: theme, suggested_artifact, confidence, severity, sessions, projects, contexts)
- Friction fallback: `.amp/friction/antigen_review.md` (human-readable clusters)
- Processed manifest: `.amp/memory/.processed`
- Output: `AGENT.md` (managed MEMORY section with @MEMORY.md reference)
