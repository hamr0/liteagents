---
name: remember
description: Consolidate stashes + friction into project memory
allowed-tools: Read, Grep, Glob
disable-model-invocation: true
---

Run friction analysis, then consolidate `.claude/stash/*.md` + friction antigens into one project-local `.claude/remember/MEMORY.md` and inject it into `CLAUDE.md`. Friction runs automatically (best-effort) — there is no separate `/friction` command. A detect-only docs check runs at the end. Why each rule exists: `docs/product/remember-README.md`.

**Rules**
- Simple and scoped: minimal implementation, only the requested outcome.
- **Scripts:** call every bundled script (`friction.cjs`, `version-check.cjs`, `sync-rules.cjs`, `stub-check.cjs`, `docs-builder.cjs`) by its **absolute path** — the cwd is the target repo, not this package, so a cwd-relative path fails.
- **Precision over recall:** a false antigen loaded via `@.claude/remember/MEMORY.md` steers every future session — unsure → do not promote; leave it to recurrence.
- **Mid-tier model:** steps 2, 3 and 4a use your tool's balanced mid tier — never the cheapest tier, never a vendor model name.
- **Batch stashes:** up to 5 stashes per extraction agent, as few agents as possible (3 → 1 agent, 7 → 2); if more than one, run them concurrently.
- **Facts are short rules, not prose:** one line, target 160 chars, hard stop 180, stating a rule that changes future behaviour. Events and history are not facts.
- **Never re-read session logs:** work from the quotes in `antigen_clusters.json`.
- **Never hand-compute counts:** `friction.cjs count` does them.
- **Relay script output verbatim,** never re-worded (a paraphrase loses the filename the user needs).
- **Tiers (defined once):** High = 5+ distinct sessions → loaded hot via `@MEMORY.md`; Medium = 3-4 → recorded under Antigens, not loaded; Low = under 3 → ledger `observing` at 2 sessions, nothing at 1. Grouping consolidates evidence, never elevates it. Never auto-promote below High.

**Steps**

0. **Run friction first** (best-effort — friction analyzes ALL your usage, so point it at the tool's **global sessions root**, not a per-project directory)

   - **Locate `friction.cjs`** — bundled at `remember/friction.cjs` beside this file (installed or run from the package). If it exists nowhere, skip to step 1 (stash-only) and tell the user it is missing.
   - **Check for a newer liteagents** (best-effort, one line, never blocking):
     ```bash
     node ~/.claude/skills/remember/version-check.cjs
     ```
     If that path does not exist, use the directory you resolved for `friction.cjs` (the two ship side by side). It prints one advice line if the install is behind the registry, else nothing; it exits 0 always, caches 24h, and is bounded to ~2s. If it prints a line, relay it verbatim in the final report; never act on it, never run the install yourself.
   - **Script missing from both locations → say so** (one line). A failed *check* (offline, registry down, timeout) stays silent by design; a missing *script* means an incomplete install.
   - **Resolve the global sessions root** — probe top-to-bottom, use the first that exists and holds `.jsonl` files directly or one level down in per-project subdirectories (friction scans exactly those two levels). **Never prompt the user.**
     <!-- mirror:literal:start — every tool's real path, identical in all four kits -->
     ```
     # ── Add your own global sessions root at the TOP so it is checked first ──
     ~/.claude/projects/                 # Claude Code
     ~/.factory/projects/                # Droid / Factory
     ~/.config/amp/projects/             # Amp
     ~/.config/opencode/projects/        # opencode
     ~/.codex/sessions/                  # Codex CLI  (use $CODEX_HOME/sessions/ if set)
     ~/.gemini/antigravity-cli/brain/    # Antigravity
     ```
     <!-- mirror:literal:end -->
     > Note: `friction.cjs` parses Claude Code's session schema. The Codex/Antigravity roots
     > will resolve but yield no signals until friction learns their formats — open an issue
     > to request one: https://github.com/hamr0/liteagents/issues
   - **Run** `node <friction.cjs> "<resolved-root>"`. It writes to `.claude/remember/friction/` in the current project. Run it as its own command — nothing chained before or after it — with a 10-minute tool timeout: it scans the whole sessions root and can take a minute or more.
   - **On any miss — loud, never silent.** If no root resolves, friction errors, or it finds no usable sessions, print this and continue stash-only:
     > ⚠️ Friction didn't run — no sessions found. To enable it, open this skill's own file
     > and add your tool's **global** sessions root to the TOP of the probe
     > list in step 0, then re-run `/remember`. Consolidating stashes only this time.

1. **Gather sources**
   - **Legacy layout migration (one-time, loud).** Older versions used `.claude/memory/` and `.claude/friction/`. If either exists: move only `.claude/memory/{MEMORY.md,ledger.json,.processed}` → `.claude/remember/` (anything else there, e.g. user-owned rule files, stays), **discard** the old `.claude/friction/` contents (step 0 already regenerated them fresh), remove the old dirs only if empty, update the managed MEMORY section in CLAUDE.md (step 5), and tell the user exactly what moved.
   - **Sync `AGENT_RULES.md` from the installed template:**
     ```bash
     node ~/.claude/skills/remember/sync-rules.cjs
     ```
     The script does the whole decision (a byte compare, never yours): absent → copies it in; identical → no write, no output; differs → old body to `AGENT_RULES.md.bak`, new one copied in, both reported. Relay what it prints in the step-8 report.
   - Read all `.claude/stash/*.md`, and skip stashes already listed in `.claude/remember/.processed`.
   - Read friction output: `.claude/remember/friction/antigen_clusters.json` (preferred) or `antigen_review.md` (fallback). **The fallback path does no counting:** merge quotes into matching entries only; never change `sessions`, `last_seen` or `recurred_while_hot`.
   - Read existing `.claude/remember/MEMORY.md` if it exists; create the dir if missing.
   - **No unprocessed stashes → skip steps 2-3 entirely; facts are never rewritten with zero new input**, not even to clear length-gate debt. Steps 4-5 still run whenever friction produced output. If there is also no friction output, report "nothing to consolidate" and stop after step 1 — **but run step 5's `stub-check.cjs` before you stop** (quiet run); `sync-rules.cjs` already ran above.

2. **Extract from unprocessed stashes** (batches per Rules)
   - Each agent reads its batch together and calls the mid-tier model to extract:
     - **FACTS** (one line each, target 160, hard stop 180): stable preferences, decisions, corrections, explicit "remember this" — a **rule that changes future behaviour**, written as current truth, not an event. A lesson recurring across the batch is written **once**.
     - **EPISODE** (one per stash, 3-5 bullets): goal, what was tried, outcome, lesson
     - **SKIP**: code details, file paths, errors, mechanical steps, LLM responses
   - Collect all new facts and episodes.

3. **Merge into MEMORY.md**
   - Parse the existing `.claude/remember/MEMORY.md` sections (## Facts, ## Episodes, ## Antigens).
   - **Facts — rewrite and compress, every run (that has new input).** Call the mid-tier model with the existing facts + new facts + the lessons of any episodes aging out, and have it return the **whole section rewritten**, not the old list with lines added: new replaces old, contradictions keep the new version, duplicates fold into one line, shorten every fact that can be shorter (output normally shorter than input), current truth only — no "supersedes", no version history.
   - **Pre-write length gate — BEFORE `MEMORY.md` is written, on EVERY line of the draft Facts section, including lines carried over unchanged** (the whole section is this run's output). 161-180 chars passes silently; over 180 MUST be shortened and re-checked. The ONLY exemption: a line whose single longest backtick-quoted literal is itself longer than 100 characters — kept verbatim and listed as an exemption in the step-8 report. No other reason exempts a line (not established style, not pre-existing, not load-bearing); a line long because it holds several sentences is split into several facts or loses its history. Only a draft that passes is written.
   - **Episodes:** append new entries, keep only the **10 most recent**. **Dedup before appending:** a new episode covering the same work as an existing one (judge by content, not title) merges into it instead of appending a second copy. Every older episode is **folded, then deleted**: its lesson goes to the fact rewrite, the narrative is removed, no archive. Keep-10 is the one rule; derive the set to remove from it, never supply a second delete list alongside. State the count before and after and name each episode removed. **No episode is removed whose lesson isn't folded into a fact first**; removed-but-not-folded is a defect to report.
   - **Antigens:** only update from friction output (step 4).
   - Write the merged result to `.claude/remember/MEMORY.md` in the format under step 5.

4. **Distill friction into antigens** (only if friction output exists)

   Each cluster in `antigen_clusters.json` carries `theme`, `suggested_artifact`, `confidence`, `severity`, `sessions`, `projects`, `signals`, `contexts` (verbatim user quotes), `preceding` (agent action + result just before the reaction — the trigger) and `self_suspect` (friction's guess the user was correcting *themselves*). Friction's grouping and flags are hints, not the verdict.

   - **4a. Classify** (the LLM classifies only — no merging, no arithmetic). Call the mid-tier model once per cluster batch with each cluster's `contexts`, `preceding`, `errors`, `self_suspect`, `projects`, `sessions`, `top_keywords`, and the ledger's existing entries (`id`, `class_hints`, `rule`, `evidence.quotes`). For EACH cluster output exactly one label:
     - `drop` — self-directed correction, agent's own prose captured as context, or a real reaction too short/ambiguous to name a specific mistake (`self_suspect` and an empty `preceding` are strong self-directed cues). Don't force a match on one overlapping word.
     - an existing ledger id (`ag-NNN`) — only if the cluster is narrowly the SAME mistake class as that entry's `class_hints`+`rule`+`evidence.quotes`, not just similar sentiment. State the entry's specific claim precisely in the prompt and give the classifier a negative example, e.g. for ag-001 (validate, don't assert): "did you test it?" matches; "we're burning money, why is it failing?" does NOT.
     - `new` — a real, agent-directed mistake matching no existing entry. Write no theme: `count` names the entry from the first two words of the cluster's own `top_keywords`. Also output a `rule`: one line stating the behavioural rule the evidence supports, same do/don't imperative style as an existing entry's `rule` — the only LLM-authored field here; `friction.cjs count` requires it whenever the cluster's own `sessions >= 2`. Each `new` cluster stands alone, never merged with another.

     Output `{cluster_index: label}` for `drop`/`ag-NNN`; for `new`, `{cluster_index: {label: "new", rule: "<one-line rule>"}}`.
   - **4b. Route by recurrence** (tier from the distinct-conversation count `friction.cjs count` computes, per Rules):
     - `suggested_artifact: antigen` (recurring + severe) or a same-label group → an **antigen** (do/don't rule) with verbatim evidence quotes.
     - `suggested_artifact: fact` (recurring + mild) → a **Fact**.
     - `suggested_artifact: episode` not in a recurring group → **not an Episode, and at 1 session written nowhere** (the Episodes section is stash-fed and capped; friction re-scans every run, so it resurfaces until it recurs, then lands as a ledger `observing` entry). `suggested_artifact` is a structural proposal, not a filing decision.
   - **4c. Count** (`.claude/remember/ledger.json` — the evidence trail linking each rule to the mistake it targets; JSON bookkeeping, never injected as guidance). **A literal command you run, not a description you reason from.** Create `ledger.json` as `{"version": 1, "entries": []}` if missing. Entry shape:
     ```json
     { "id": "ag-001", "class": "claimed-done-not-verified",
       "class_hints": ["says pushed but", "none got it"],
       "status": "observing|hot|rejected|escalated|expired",
       "rule": "<current phrasing>",
       "attempts": [{ "n": 1, "rule": "<phrasing>", "adopted": "YYYY-MM-DD", "outcome": "active|failed" }],
       "evidence": { "sessions": 0, "session_ids": [{ "id": "<project-label>/<MMDD-HHMM>-<hash>", "seen": "YYYY-MM-DD" }], "projects": [], "quotes": [], "last_seen": "YYYY-MM-DD" },
       "recurred_while_hot": 0,
       "history": [{ "date": "YYYY-MM-DD", "event": "<transition>" }] }
     ```
     Immediately after 4a produces `.claude/remember/friction/labels.json` (the `<labels.json>` below), run these as real shell invocations, in order. First (a no-op on a consistent ledger — always run it; it records hand-drifted `rule` text as a new attempt so I7, `rule` == last attempt's `rule`, holds):
     ```bash
     node <path-to-friction.cjs> migrate-attempts .claude/remember/ledger.json .claude/remember/ledger.json
     ```
     Then:
     ```bash
     node <path-to-friction.cjs> count <labels.json> <ledger.json> <clusters.json> <today's-date> <ledger.json>.new .claude/remember/friction/count_report.json
     ```
     Then **overwrite `ledger.json` with `<ledger.json>.new`** (e.g. `mv ledger.json.new ledger.json`). Producing labels is not the deliverable of this step. `count` handles identity, seeding, promotion and the adopted-date gate; never redo it by hand. It also writes `count_report.json`, which step 8 reads back.

     **After `count` returns** (read `count_report.json`):
     - **Escalation.** `count` marks failed attempts, resets `recurred_while_hot`, and lists ids in `count_report.json`: `needs_rephrase` and `escalated`. For each `needs_rephrase` id, draft attempt n+1 — it must differ from **every** prior attempt's text in that entry (failed attempts are the rejected-edit buffer; never re-propose one verbatim) — append `{n+1, rule, adopted: <today>, outcome: "active"}` to `attempts`, replace `rule`, and update MEMORY.md's Antigens section (step 5). For each `escalated` id (status already set), record a Fact ("persistent failure mode: <class> — no phrasing reduces it") and flag it in the step-8 report. Fill the `escalation:` slot from these two lists. **Flag, don't act** — the user decides: enforcement (a hook, where the tool has them) or accepted limit.
     - **`escalated`/`rejected` entries** (rejected = user veto) get no new attempt, count run or not.
     - **Decay.** `count` expires and reactivates entries; fill the `decay:` slot from `count_report.json`'s `decay.expired` and `decay.reactivated`.
     - Mutations are append-friendly: merge evidence and change status, never delete entries or history lines. Every hot antigen in MEMORY.md must have a matching `hot` ledger entry. **If `ledger.json` is malformed, say so loudly, move it aside as `ledger.json.bad-<date>`, and start fresh — never silently overwrite.**

5. **Inject memory + rules references into CLAUDE.md**
   - Compose the MEMORY section (explicit path — a bare `@MEMORY.md` would resolve to a nonexistent root file):
     ```
     <!-- MEMORY:START -->
     @.claude/remember/MEMORY.md
     <!-- MEMORY:END -->
     ```
   - If `.claude/remember/AGENT_RULES.md` exists, compose a second, independent section. The file itself is **never `@`-referenced** (a standards guide, not hot context); the section is a path pointer plus the two inline rules that change what you TYPE. Write it verbatim:
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
     .claude/remember/AGENT_RULES.md
     <!-- AGENT_RULES:END -->
     ```
   - Each marker pair is independent: if CLAUDE.md lacks a pair, append it at the end; if present, replace its content in place; if no CLAUDE.md exists, create one with whichever section(s) apply.
   - **An existing AGENT_RULES pair is never rewritten** — users trim it deliberately; the block above is for creating it. If an existing pair's **path pointer** is missing or wrong, **report it and stop**; do not rewrite around it. (The FILE `AGENT_RULES.md` is different: `sync-rules.cjs` refreshes it every run. Only this CLAUDE.md block is create-once.)
   - **Then assert the stub SHAPE mechanically:**
     ```bash
     node ~/.claude/skills/remember/stub-check.cjs
     ```
     It edits only inside the marker pairs: repairs a MEMORY include that is not `@.claude/remember/MEMORY.md`, demotes an `@`-include of `AGENT_RULES.md` to a plain pointer, never touches user prose, and will not repoint a MEMORY include at a file that does not exist (report it instead). Silent when current; relay what it prints in the step-8 report.

   MEMORY.md format:
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
   **The `## Antigens` section is rendered, never hand-written.** After 4c has overwritten `ledger.json`, run as a literal command:
   ```bash
   node <path-to-friction.cjs> render <ledger.json>
   ```
   Paste its stdout **verbatim** over MEMORY.md's entire `## Antigens` section (from that line to the next `## ` heading, or end of file). Then `node <path-to-friction.cjs> check <ledger.json> <MEMORY.md>` must report `I6-new: EQUAL`; if not, something was hand-edited — redo from the script's stdout, never patch MEMORY.md manually.

6. **Update processed manifest** — append paths of newly processed stashes to `.claude/remember/.processed`.

7. **Docs reconcile check + auto re-index** (best-effort, crash-isolated like step 0; the only write is the generated `docs/index.md` via the deterministic `index-flat` script, never a model call; it never reconciles doc content or edits a page; a failure here never blocks the memory write already done)

   - **Locate `docs-builder.cjs`** — in the `docs-builder/` directory beside this one (under `skills/` on Claude Code and Amp, `commands/` on Droid and opencode), called by absolute path.
   - **No `docs/` directory → stay silent** (the step-8 `docs: N/A (no docs/)` line records it).
   - **`docs/` exists but cannot run** (script missing, `git` fails, command errors) → print one line saying why. Never fail silently.
   - **Not set up** — no `docs/.docs-builder/` directory (docs-builder never ran), or `due` prints "no ledger yet": print one line telling the user to run `/docs-builder reorg`. Never tell them to run `ledger` — it would stamp an unsorted pile as correct and `due` would report NOT due forever.
   - Otherwise run it and pass through its verdict (it is due at >=5 changed docs):
     ```bash
     node <docs-builder.cjs> due
     ```
   - **Auto re-index on any drift:** if `due`'s output was NOT `docs unchanged since <sha>. NOT due.` (it printed a row table, whether or not the >=5 threshold was crossed), run — script only, no model, in addition to the DUE advisory:
     ```bash
     node <docs-builder.cjs> index-flat
     ```
     Note in the step-8 report that `docs/index.md` (and `docs/log.md` if touched) were regenerated, so they are staged with this run.
   - If DUE (>=5), ALSO end with one line:
     ```
     docs: 7 changed since 991f72d3 — run /docs-builder reorg
     ```

8. **Report to user** — print it AND write the same content to `.claude/remember/report.md` (overwritten each run)
   - **Step-check lines — always printed, never omitted.** One line each, filled with the result (real exit codes) or `NOT RUN: <reason>`; a missing line is a skipped step. Scripts stay silent when nothing changed; the line tells "ran, nothing to do" from "skipped". If a script wrote or moved a file and its output is not in its line, that is a defect.
     ```
     version-check: exit <code> <unchanged | its output> | NOT RUN: <reason>
     legacy-migration: moved <files> | none found | NOT RUN: <reason>
     sync-rules: exit <code> <unchanged | its output> | NOT RUN: <reason>
     friction: exit <code>, <N> clusters | skipped: <reason>
     stashes: <N> processed in <K> agents (batches of <=5) | none unprocessed
     facts: B → A, <M> merged or shortened
     length-gate: <N> lines >180 after awk (target 0); exemptions: <lines | none>
     episodes: B → A; removed: <titles> → folded into fact "<first words>" | none
     classify: <N> clusters -> drop <d>, existing <e>, new <n>
     migrate-attempts: exit <code> | NOT RUN: <reason>
     count: exit <code>, ledger replaced yes | NOT RUN: <reason>
     decay: <N> expired, <M> reactivated | NOT RUN: <reason>
     antigens: High <h> (+<p> promoted), Medium <m>, Low <l>
     escalation: <ag-id rephrased | ESCALATED | none>
     render: pasted verbatim yes | NOT RUN: <reason>
     I6-new: <check output, must be EQUAL> | NOT RUN: <reason>
     claude-md: MEMORY block <created | replaced | unchanged>; AGENT_RULES block <created | left alone | pointer wrong: STOPPED>
     stub-check: exit <code> <unchanged | its output> | NOT RUN: <reason>
     processed: +N entries (before B → after A lines)
     docs: N/A (no docs/) | due: <verdict> | index-flat: ran | not needed | NOT RUN: <reason>
     regenerated: docs/index.md [docs/log.md] | none
     nothing to consolidate: stub-check ran exit <code>
     ```
     `facts:` at steady state (lines already <=160, no near-duplicates) may grow by exactly its new facts and shorten nothing — say so rather than forcing merges. `antigens:` is read from `count_report.json`, not recomputed. `nothing to consolidate:` prints only on the quiet run.
   - **Mechanical length check** — run, don't estimate. It applies the SAME exemption as the step-3 gate (longest backtick literal over 100 chars is not flagged), so the two counts cannot disagree:
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
     Print every line it returns and the count. Zero is the target; non-zero is a gate miss.
   - **Ledger lines** — one per non-observing entry: id, short rule, status, recurrences since adoption. Highlight rephrased (RECURRED) and ESCALATED entries (escalations need a user decision):
     ```
     ledger: ag-001 "verify live after publish"  hot, 0 recurrences since 2026-07-10
     ledger: ag-003 "don't commit per change"    RECURRED while hot (2/2) → rephrased, attempt 2
     ledger: ag-002 "literal scoped ask"         ESCALATED → Fact; 2 phrasings failed. Hook or accept?
     ```
   - If step 7 ran the auto re-index, name the regenerated files (`docs/index.md`, plus `docs/log.md` if touched).
   - Confirm MEMORY.md and CLAUDE.md updated.

**File locations (all project-local — two dirs: `/stash` owns `.claude/stash/`, `/remember` owns `.claude/remember/`)**

| Path | What |
|---|---|
| `.claude/stash/*.md` | stash files |
| `.claude/remember/MEMORY.md` | hot memory, referenced as `@.claude/remember/MEMORY.md` |
| `.claude/remember/AGENT_RULES.md` (+ `.bak`) | standards guide, synced each run by `sync-rules.cjs`; single `.bak` written only when the body differs; plain-path pointer, never `@` |
| `.claude/remember/ledger.json` | antigen ledger (per-rule evidence trail) |
| `.claude/remember/report.md`, `.processed` | latest step-8 report; processed-stash manifest |
| `.claude/remember/friction/` | transient, regenerated each run: `antigen_clusters.json` (preferred), `antigen_review.md` (fallback), raw files |
| `docs/.docs-builder/ledger.json` | READ ONLY here — owned by `/docs-builder` |
| `CLAUDE.md` | managed MEMORY section, plus the AGENT_RULES section once created |
