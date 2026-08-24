---
name: remember
description: Consolidate stashes + friction into project memory
usage: /remember
---

Run friction analysis, then consolidate session stashes + friction antigens into a single project-local MEMORY.md, and inject into CLAUDE.md. Friction runs automatically (best-effort) — there is no separate `/friction` command. A docs reconcile check runs at the end, detect-only.

**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- **Precision over recall for hot memory.** A false antigen loaded into `@MEMORY.md` steers every future session. When unsure, record as a low-confidence episode — do not promote.
- **Mid-tier model, not hardcoded.** Steps 2/3/4a delegate to a mid-tier model — capable of
  semantic judgment, cheaper/faster than your top reasoning tier (e.g. Claude's Sonnet vs
  Opus). Use whatever your tool designates as that balanced default; never hardcode a
  vendor-specific model name.
- **Batch stashes, don't fan out.** Step 2 gives each extraction agent **up to 5 stashes**
  and uses as few agents as possible (3 stashes → 1 agent, 7 → 2). One agent reading several
  sessions sees the same lesson recur and writes it once; one agent per stash writes it once
  per stash and leaves the merge to catch the duplicates. If more than one agent is needed,
  run them concurrently.
- **Hot memory is short snippets, not prose.** A fact is one line, target 160 characters,
  hard stop 180, stating a rule the agent should follow next time. Events, history, and
  narrative are not facts.

**What it does**

Reads all raw material (`.claude/stash/*.md` + `.claude/remember/friction/antigen_clusters.json`), extracts durable facts, episodes, and behavioral antigens into a single `.claude/remember/MEMORY.md`, then injects a managed memory section into `CLAUDE.md`.

**Steps**

0. **Run friction first** (best-effort — friction analyzes ALL your usage, not just this repo)

   Friction's signal is *global*: recurring corrections and frustrations across every
   project are behavioral lessons worth keeping everywhere. So point it at the tool's
   **global sessions root** (all projects), not a per-project directory.

   - **Locate `friction.cjs`** — it is bundled next to this command at `remember/friction.cjs`
     (the same directory as `remember.md`, whether installed or run from the package). If it
     exists nowhere, skip to step 1 (stash-only) and tell the user friction.cjs is missing.
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
     > Note: `friction.cjs` parses Claude Code's session schema. The Codex/Antigravity roots
     > will resolve but yield no signals until friction learns their formats — open an issue
     > to request one: https://github.com/hamr0/liteagents/issues
   - **Run** `node <friction.cjs> "<resolved-root>"`. friction writes its output to
     `.claude/remember/friction/` in the current project.
   - **On any miss — loud, never silent.** If no root resolves, or friction errors, or it
     finds no usable sessions, print this and continue with stash-only consolidation:
     > ⚠️ Friction didn't run — no sessions found. To enable it, open this command file
     > (`remember.md`) and add your tool's **global** sessions root to the TOP of the probe
     > list in step 0, then re-run `/remember`. Consolidating stashes only this time.

1. **Gather sources**
   - **Legacy layout migration (one-time, loud).** Older versions used `.claude/memory/` and
     `.claude/friction/`. If either exists: move the pipeline files
     `.claude/memory/{MEMORY.md,ledger.json,.processed}` → `.claude/remember/`, and **discard**
     the old `.claude/friction/` contents entirely — friction regenerates all of its output
     fresh every run (step 0 has already rebuilt it in `.claude/remember/friction/` by the time
     migration runs; stale copies carry no unique information and moving them would overwrite
     fresh output). **Move only those pipeline files** — anything else in `.claude/memory/`
     (e.g. user-owned rule files) stays where it is. Remove the old dirs only if empty, update the managed MEMORY section in CLAUDE.md to
     the new reference (step 5), and tell the user exactly what moved.
   - **Bootstrap `AGENT_RULES.md` (one-time, silent-if-present).** If
     `.claude/remember/AGENT_RULES.md` does not exist, copy it from the bundled template next
     to this command (`remember/AGENT_RULES.md`, same directory as `friction.cjs`). If it
     already exists, leave it untouched — never overwrite, even if the bundled template
     changes in a later version; it becomes user-owned the moment it lands in the project.
   - Read all `.claude/stash/*.md` files in the current project
   - Read friction output written in step 0: `.claude/remember/friction/antigen_clusters.json` (preferred) or `.claude/remember/friction/antigen_review.md` (fallback)
   - Read existing `.claude/remember/MEMORY.md` if it exists — create dir if missing
   - Read processed manifest at `.claude/remember/.processed` — skip already-processed stashes
   - If no unprocessed stashes AND friction produced no new antigens, run the step-8 mechanical
     length check (the same awk: over 180 chars with no >100-char backtick literal) against the
     existing `.claude/remember/MEMORY.md`. If it returns 0 lines, report "nothing to
     consolidate" and stop. If it returns any lines, "no new input" is not a reason to leave
     gate debt in place — do NOT stop: proceed to step 3 and run the Facts rewrite + pre-write
     gate on the existing content with no new input, then continue through step 8 as normal.

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
   - Read existing `.claude/remember/MEMORY.md` and parse its sections (## Facts, ## Episodes, ## Antigens)
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
       exempted under the 100-char backtick rule) is written to `.claude/remember/MEMORY.md`.
   - **Episodes section**: append new episode entries, keep only the **10 most recent**.
     Every older episode is **folded, then deleted**: its lesson becomes a fact (handed to
     the rewrite above); the narrative is removed. No archive — git has the history.
   - **Antigens section**: only update from friction output (step 4)
   - Write merged result to `.claude/remember/MEMORY.md` in the format under step 6.

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

   - Read `.claude/remember/friction/antigen_clusters.json`.
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
   - **4c. Update the antigen ledger** (`.claude/remember/ledger.json`) — the evidence trail
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
       "evidence": { "sessions": 0, "session_ids": [{ "id": "<project-label>/<MMDD-HHMM>-<hash>", "seen": "YYYY-MM-DD" }], "projects": [], "quotes": [], "last_seen": "YYYY-MM-DD" },
       "recurred_while_hot": 0,
       "history": [{ "date": "YYYY-MM-DD", "event": "<transition>" }] }
     ```

     **Evidence merges by session identity, not by re-counting a re-scan.** Friction re-scans
     the entire corpus every run, so the same old session matches its cluster again on every
     run; without an identity check, that re-detection would masquerade as new recurrence and
     could promote a one-off to hot — the exact false-preference failure the observed-signal
     redesign exists to prevent. Friction's clusters already carry `session_ids`. Identity is
     the **trailing 8-char hash** — the part after the last `-` in the id — because project
     labels can be renamed while the hash, derived from the session filename, is stable. Two
     ids with the same hash are the same session, full stop.

     Two ids with DIFFERENT hashes can also be one session. A fork or resume writes the same
     conversation to a second session file with its own filename, so the hash alone would
     count one reaction twice. `friction.cjs` collapses these before it emits clusters —
     sessions sharing at least one message `uuid` are one conversation, and the group is
     reported under a single canonical id (the lexicographically smallest). So the ids
     reaching this step are already canonical; do not attempt to re-derive fork identity
     here. Measured on a real 3,158-session corpus: 6 such groups exist, and of ~5M possible
     session pairs only 9 share any uuid at all — every one a genuine duplicate.

     **Migration (one-time, grandfathered): SEED, DO NOT COUNT.** Existing entries predate
     `session_ids` and carry only a bare `sessions` count with an empty `session_ids` set. This
     is mechanical — do not resolve it by judgment. On the run that first populates such an
     entry's `session_ids` (i.e. `session_ids` is empty going in), do exactly these two things
     and nothing else:
     1. Write `session_ids` to this run's matched ids (NOT an empty set — the empty set is the
        pre-migration state you are migrating FROM, not what you write).
     2. Append the history line "identity migration — legacy count grandfathered, growth
        requires new hashes".

     Change NOTHING else on this run — not `sessions`, not `last_seen`, not
     `recurred_while_hot`, not `status`. In particular, do NOT apply the "no hashes present →
     new conversation" rule here: `session_ids` was empty, so every hash looks absent, and
     counting would treat the entry's own already-counted history as fresh recurrence — on a
     `hot` entry that also fires `recurred_while_hot`, which at 2 marks the phrasing failed and
     rewrites a rule that never actually failed. Counting resumes on the NEXT run, once
     `session_ids` is non-empty and an absent hash set is genuinely new evidence.

     Observed for real: bareloop's first migration run carried two `hot` entries, each already
     at `recurred_while_hot: 1`. Counting on migration would have taken both to 2 and force-
     rephrased two working rules from re-detected pre-existing sessions. Two separate runs
     avoided it only because whoever ran them noticed and overrode the text — which is the
     definition of a rule that needs to be mechanical rather than prose.

     For each surviving antigen from 4a/4b, match against existing entries by `class_hints`
     (the mistake class, not the rule wording — rules change, the class doesn't). A matched
     cluster represents exactly ONE conversation, no matter how many hashes its `session_ids`
     holds — a fork/resume group deliberately carries every member file's hash so the cluster
     can be matched under any of the conversation's filenames.

     **`sessions` is the authoritative conversation count. `session_ids` is evidence detail —
     a list of the FILES one conversation was written to. NEVER derive a count from
     `len(session_ids)`; a fork or resume makes that number larger than the conversation
     count.** This is mechanical — do not resolve it by judgment. Compare the cluster's hashes
     against the entry's stored hash set as a set, not one at a time, and count per
     conversation, never per hash:
     - **None of the cluster's hashes present** → a genuinely new conversation: add ALL of the
       cluster's hashes to `session_ids`, increment `sessions` by exactly 1 (never by the
       number of hashes in the cluster), refresh `last_seen` to today's run date (session ids
       carry no year), and count it once toward the 4b promotion threshold.
     - **Any of the cluster's hashes already present** → this conversation is already counted:
       add whichever of its hashes are still missing from `session_ids` (they are aliases of
       the same conversation, and storing them keeps future matching robust under any of its
       filenames), but change NOTHING else — not `sessions`, not `last_seen`, not history, not
       `recurred_while_hot`. It is a re-scan re-detecting a conversation already counted, not
       new evidence.
     - **No match, cluster `sessions` >= 2** → new entry, `status: "observing"`, attempt 1,
       history "candidate (N sessions)".
     - **No match, cluster `sessions` == 1** → do NOT create a ledger entry. The ledger tracks
       recurrence, and a single occurrence has no recurrence to track yet — seeding singletons
       grows the ledger by dozens of never-recurring entries per run. Friction re-scans every
       session log on every run, so if this mistake recurs, a later run will match it back to
       2+ sessions and seed it then. This does not change the Match bullets below — a
       1-session cluster can still merge into an EXISTING entry; that is recurrence.
     - **Match, `observing`** → apply the new-conversation / already-counted rule above
       (sessions, session_ids, quotes, projects, last_seen). Crosses the 4b hot threshold on a
       genuinely new conversation → `status: "hot"`, history "promoted to hot (N sessions)".
     - **Match, `hot`** → the mistake happened *while its rule was loaded*, and only when the
       match is a genuinely new conversation (per the rule above, not a re-scan of an
       already-present hash): `recurred_while_hot += 1` once per conversation, merge evidence,
       history "recurred while hot (count)".
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

5. **Inject memory + rules references into CLAUDE.md**
   - Compose the section between `<!-- MEMORY:START -->` and `<!-- MEMORY:END -->` markers:
     ```
     <!-- MEMORY:START -->
     @.claude/remember/MEMORY.md
     <!-- MEMORY:END -->
     ```
   - The reference is an **explicit path** (`@.claude/remember/MEMORY.md`) — `@`-references
     resolve relative to the file containing them, so a bare `@MEMORY.md` in the project root
     would point at a nonexistent root-level file. Claude loads the full file directly, so no
     inline duplication is needed
   - If `.claude/remember/AGENT_RULES.md` exists (bootstrapped in step 1), compose a second,
     independent section between `<!-- AGENT_RULES:START -->` and `<!-- AGENT_RULES:END -->`
     markers:
     ```
     <!-- AGENT_RULES:START -->
     Consult when building something new or adding a feature — a standards guide, not hot
     context like MEMORY.md above:
     @.claude/remember/AGENT_RULES.md
     <!-- AGENT_RULES:END -->
     ```
   - Each marker pair is independent: if CLAUDE.md already has a given pair, replace the
     section between them; if not, append it at the end; if no CLAUDE.md exists, create one
     containing whichever section(s) apply

   ```markdown
   # Project Memory
   > Auto-generated by /remember. Do not edit manually.

   ## Facts
   - [one-line rule, target 160 chars, hard stop 180]

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
   The Medium/Low lists render only entries whose ledger `status` is `observing` (or `hot`
   for High) — an entry marked `expired` by the decay rule (step 4c) is skipped here even
   though it stays in `ledger.json`.

6. **Update processed manifest**
   - Append paths of newly processed stashes to `.claude/remember/.processed`

7. **Docs reconcile check — DETECT ONLY** (best-effort, crash-isolated like step 0)

   `/remember` never reconciles docs, never writes frontmatter, never edits a page. It
   prints at most one nudge line. Wrapped so any failure here can never block the memory
   write that already happened in steps 3-6.

   - **Locate `docs-builder.cjs`** — bundled next to this command at
     `docs-builder/docs-builder.cjs` (same convention as `remember/friction.cjs`).
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
     node docs-builder/docs-builder.cjs due
     ```
     `due` compares `docs/` against the SHA stamped in `docs/.docs-builder/ledger.json`
     using `git diff --numstat -M`, classifying each doc as new / moved / moved+changed /
     changed (with the line delta and rough percentage) / deleted. It is **due at >=5
     changed docs** — the same derived-not-counted shape as `/stash`'s nudge.
   - If DUE, end with one line and nothing more:
     ```
     docs: 7 changed since 991f72d3 — run /docs-builder reorg
     ```

8. **Report to user** — print it AND write the same content to `.claude/remember/report.md`
   (overwritten each run; the ledger keeps history — the report is just the latest snapshot)
   - Number of stashes processed
   - Facts count (before → after the rewrite; the number should not grow by the number of new facts)
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
     }' .claude/remember/MEMORY.md
     ```
     Print every line it returns and the count. Zero is the target; non-zero means a gate miss
     — every remaining overrun already had its chance to be exempted (100-char backtick
     literal) inside the step-3 gate, so anything printed here should not exist.
   - Episodes count (new, kept hot, folded + deleted)
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
   - Confirm MEMORY.md and CLAUDE.md updated

**File locations (all project-local — two dirs: `/stash` owns `.claude/stash/`, `/remember` owns `.claude/remember/`)**
- Stash files: `.claude/stash/*.md`
- Memory file: `.claude/remember/MEMORY.md` (single source of truth, referenced as `@.claude/remember/MEMORY.md`)
- Rules template: `.claude/remember/AGENT_RULES.md` (bootstrapped once from the bundled package template on first `/remember` run, never overwritten again — user-owned after that; referenced as `@.claude/remember/AGENT_RULES.md`)
- Antigen ledger: `.claude/remember/ledger.json` (per-rule evidence trail: class, status, attempts/rejected-buffer, recurrence-while-hot)
- Consolidation report: `.claude/remember/report.md` (latest step-7 report, overwritten each run)
- Processed manifest: `.claude/remember/.processed`
- Docs ledger (READ ONLY from here — owned by `/docs-builder`): `docs/.docs-builder/ledger.json`
- Friction output (transient, regenerated each run): `.claude/remember/friction/` — `antigen_clusters.json` (preferred input), `antigen_review.md` (fallback), plus raw analysis files
- Output: `CLAUDE.md` (managed MEMORY section, plus an AGENT_RULES section once bootstrapped)
