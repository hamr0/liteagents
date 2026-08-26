# antigen gate ("sleep") — PRD

> Validation-gated hot memory for the liteagents `/stash → /remember` pipeline. No rule
> reaches always-loaded memory except through measured consequences — **similarity/reflection
> proposes, consequence disposes.** This is SkillOpt's validation-gate idea (arXiv/microsoft
> SkillOpt, 2026) ported to the one domain where the reward cannot be replayed offline: the
> user's own future sessions.
>
> **Governing rules:** AGENT_RULES.md (POC-first, vanilla → stdlib → external, simple > clever,
> surgical changes). friction's own doctrine applies throughout: **precision over recall** — a
> false hot rule loaded into every future session costs more than a missed faint one.
>
> Status legend: **DECIDED** (settled) · **POC-GATED** (build only after the named POC passes) ·
> **DEFERRED** (post-v1; names the exact un-defer condition) · **NON-GOAL** (out of scope).

---

## 0. TL;DR

- **Problem:** hot memory (`MEMORY.md`) has an evidence-based way *in* (friction recurrence)
  but no way to know whether a written rule **works**. Rules are written and hoped at. There is
  no 1-1 consolidation, no effectiveness measure — a blob.
- **Fix:** a candidate-rule **lifecycle with a prospective gate**. New behavioral rules enter a
  marked *trial* section of `MEMORY.md`; a background **sleep** step (spawned by `/remember`)
  toggles them ON/OFF across epochs and counts whether their antigen-class recurrence drops
  during ON epochs. Strict improvement → promoted to permanent memory. No effect → rejected
  into a buffer that prevents re-proposal.
- **Reward = event counts, never sentiment.** A `user_correction` is fuzzy in wording but
  discrete as an event. friction already detects these with high precision; sleep just tallies
  them per epoch. Language is the sensor; the count is the reward.
- **Portable by construction:** the gate mechanism is *file content toggling* in `MEMORY.md`,
  which all four packages (claude/droid/opencode/amp) already inject. Zero per-tool code, no
  hooks in the core design.
- **Verification is outcome-level, not usage-level:** sleep never knows if a rule was *read*
  (unknowable without hooks); it knows if the mistake *stopped happening*. Effect, not attention.
- **⚠️ POC outcome (2026-07-08): the ON/OFF gate is DEFERRED — signal density fails (§9).**
  v1 ships the ledger + rejected-edit buffer + lifecycle only; the epoch-toggling design above
  is preserved for the day the un-defer condition is met.

---

## 1. Why this exists

The `/stash → /remember` pipeline works — hot memory demonstrably carries repo knowledge and
behavioral lessons into every session. Its residual weaknesses, in the user's own words:

1. **No 1-1 consolidation or effectiveness measure** — `MEMORY.md` is a blob; nothing links a
   written rule to whether the mistake it targets still recurs.
2. **Loaded ≠ applied** — a rule in context is passive text; the agent skims. Some rules land,
   some are ignored, and today there is no way to tell which is which.
3. **Write-and-hope** — promotion into hot memory is one-way. Nothing ever leaves, and nothing
   confirms a rule earned its always-loaded slot.

SkillOpt demonstrated the missing piece for skill documents: *"a candidate edit is accepted
only when it strictly improves a held-out validation score."* But SkillOpt's gate closes
offline because its reward (a benchmark score) is replayable. **The user cannot be replayed.**
A past session can't be re-run with a new rule to see if the correction would have vanished.
So the gate here must be **prospective** — measured on real future sessions.

## 2. Scope (DECIDED)

**In scope:** behavioral antigen-class rules — the cross-project "how the agent should behave"
lessons friction mines (e.g. "don't commit per change", "do the literal scoped ask"). These
are the rules whose effectiveness is measurable as recurrence.

**Out of scope (stays in today's pipeline unchanged):**
- **Facts and Episodes** — knowledge, not behavior. There is no "recurrence" to gate; they
  keep the existing `/remember` path and go hot directly.
- **Project-specific facts** — same reason.
- The friction sensor itself — unchanged; sleep is a *consumer* of its output.

## 3. The candidate lifecycle (DECIDED)

```
friction mines antigen class
        │
        ▼
/remember drafts a candidate rule (sonnet step, as today)
        │                                   re-propose with new phrasing
        ▼                                   (attempt N+1, buffer-checked)
  CANDIDATE ──► CANARY (trial section, ──► PROMOTED (permanent MEMORY.md)
               ON/OFF epochs)     │
                                  └──────► REJECTED (buffer)
                                              │ antigen persists after ≥2 phrasings
                                              ▼
                                          ESCALATED → recorded as a Fact
                                          ("persistent failure mode X — no phrasing
                                           reduces it") + flagged to the user:
                                          hook-shaped or capability limit.
```

- **CANDIDATE** — drafted by `/remember`'s existing LLM step, exactly as today, but written to
  the ledger + trial section instead of directly into permanent memory.
- **CANARY** — the rule lives in the trial section during ON epochs, is removed during OFF
  epochs (§4). Runs until the decision rule (§5) resolves.
- **PROMOTED** — moved to the permanent Preferences/Antigens section. The ledger keeps its
  evidence (epochs observed, rates, verdict) forever — the 1-1 consolidation that was missing.
- **REJECTED** — into the rejected-edit buffer: `(antigen-class, phrasing, epochs, result)`.
  Never re-proposed verbatim (SkillOpt's rejected-edit buffer).
- **ESCALATED** — the load-bearing insight: if the *lesson* keeps recurring while every
  *phrasing* fails the gate, prose cannot fix it. Recording that as a Fact is itself knowledge,
  and the user decides whether it becomes enforcement (a hook, where available) or is accepted
  as a capability limit. **Flag, don't act.**

## 4. The canary mechanism — epoch toggling, not session arms (DECIDED)

**Rejected design:** per-session A/B arms via a `SessionStart` hook (session-id parity →
inject candidates as extra context). Rejected because **only claude has hooks**; the pipeline
ships identically to claude/droid/opencode/amp, and a core mechanism must not fork per tool
(AGENT_RULES: no per-tool complexity; also: the user observed the design was catering to
claude).

**Chosen design:** **ABAB epoch toggling in the file itself.**

- `MEMORY.md` gains one marked block:
  ```markdown
  <!-- TRIAL:START — managed by sleep; do not edit -->
  ### Trial rules (under evaluation)
  - <candidate rule text>   <!-- id: ag-014 attempt: 1 -->
  <!-- TRIAL:END -->
  ```
- An **epoch** = the window between consecutive `/remember` runs (already naturally paced by
  the ≥5-stash nudge). At each run, sleep flips each canary rule's arm: present during ON
  epochs, absent during OFF epochs, recorded in the ledger with the epoch boundary timestamp.
- **Why this is the right trade:** `MEMORY.md` is already injected into every tool's config
  (`CLAUDE.md`/`AGENTS.md`/`AGENT.md`) — so the trial arms ride the existing injection with
  **zero per-tool code**. The cost is convergence speed: a within-subject ABAB trial needs more
  wall-clock than parallel arms. Accepted — simplicity wins per AGENT_RULES, and memory rules
  are not urgent.
- Epoch boundaries and session membership are recoverable from friction's own per-session
  data (session timestamps vs ledger epoch timestamps) — no new instrumentation.
- **Confound guard:** at most **3 rules in trial at once** (DECIDED, revisable). ABAB with many
  simultaneous toggles muddies attribution; the ledger staggers admissions FIFO.

## 5. The reward and the decision rule (DECIDED mechanism · POC-GATED thresholds)

- **Reward:** for a candidate targeting antigen-class X, the measure is
  `recurrence(X) = observed correction-events of class X ÷ sessions in epoch`, computed from
  friction's existing per-session output. Class membership uses the same classify step (4a)
  `/remember` already runs — **the LLM classifies events; it never scores goodness**
  (judge-as-classifier is safe; judge-as-scorer is the R-S8 self-eval trap).
- **Decision rule (initial, POC-calibrated):** after ≥2 full ON/OFF cycles *and* ≥K sessions
  per arm — **promote** if ON-recurrence is strictly below OFF-recurrence in every cycle;
  **reject** if no cycle shows improvement; otherwise keep trialling up to a max (then reject —
  ambiguity defaults to *not hot*, per precision-over-recall).
- **Zero-recurrence note:** if X simply stops occurring in *both* arms, that is a pass for the
  *lesson* but says nothing about the *rule* — hold until signal returns or a max-epoch cap
  expires, then promote conservatively as a Fact, not a hot rule.
- K and the max-trial cap are set by the POC (§9), not guessed here.

## 6. Where processing runs (DECIDED)

- **`/remember` stays the fast path, unchanged in cost.** Its only new duties: write new
  candidates to the ledger (instead of straight to permanent memory) and render the trial
  block from the ledger's current arm state — both trivial.
- **sleep runs as a background agent spawned by `/remember`** — the same pattern as
  friction-as-step-0: crash-isolated, loud-skip, its failure can never block consolidation.
  No cron, no daemon, no service. It does the slow work: join friction output to ledger
  epochs, update counts, apply the decision rule, flip arms, manage the buffer, emit the
  report (§7).
- Implementation discipline mirrors `friction.js`: **vanilla Node, single file (`sleep.js`),
  dependency-free**, shipped identically to all four packages.

## 7. Reporting (DECIDED)

Sleep's output surfaces at the *next* `/remember` as a short block (flag, don't act):

```
sleep: ag-014 "don't commit per change" PROMOTED (2 cycles, ON 0.1 vs OFF 0.7 corr/session)
sleep: ag-009 "prefer Edit over sed" attempt 2 REJECTED → buffer (no effect, 3 cycles)
sleep: ag-002 "literal scoped ask" ESCALATED → Fact (2 phrasings failed; antigen persists.
       Suggest: hook-shaped (claude) or accept as limit.)
```

Everything is revertible: the ledger is the audit trail; promotion is one entry move; a human
veto is an ordinary edit.

## 8. Bounded growth (DECIDED — SkillOpt borrowables)

1. **Rejected-edit buffer** — never re-propose a buffered phrasing verbatim (§3).
2. **Edit budget** — per `/remember` cycle, permanent-memory growth is capped (a token/line
   budget, the "textual learning rate"). Promotions past the cap queue for the next cycle.
3. **Bounded ops** — every change to the managed sections is an add/delete/replace of a whole
   rule line, individually ledgered and revertible — never a section rewrite.

## 9. POC gate (POC-GATED — build nothing until this passes)

**Riskiest assumption:** *signal density.* Real usage may not produce enough correction-events
per epoch for ON/OFF differences to be readable — if a class fires ~once per 10 sessions and
an epoch spans ~6 sessions, the gate starves.

**POC (~an afternoon, real uncrafted data per AGENT_RULES):** run friction over the existing
global session logs; take the top 3 recurring antigen classes; segment history into synthetic
epochs of realistic size (session counts between actual historical `/remember` runs); compute
per-epoch recurrence and its variance. **Pass:** a real, known-recurring class shows a
recurrence rate whose epoch-to-epoch noise is small enough that a genuine halving would be
distinguishable within ~4 epochs. **Fail:** the gate as specced starves → re-scope (longer
epochs, class pooling, or defer the whole gate and keep only the ledger + buffer, which are
valuable alone).

The POC also sets K (§5) from observed sessions-per-epoch.

### POC result (run 2026-07-08 — real data, all projects) — **FAIL as specced**

Run: friction.js over `~/.claude/projects` (681 sessions, 223 interactive, log window
2026-05-19 → 2026-07-08; older transcripts pruned by Claude Code retention).

- **Density fails by ~an order of magnitude.** REACTION events (correction + curse +
  cascade): 37 all-time ≈ 0.17/interactive-session. Epoch (6 sessions) noise sd = 0.163 vs
  halving signal 0.067 → **SNR 0.41 pooled across all classes**; per-class ~10× worse.
- **No recurring class exists to gate:** friction's antigen clustering yields 33 clusters,
  all singletons, in the observable window.
- **Retrospective before/after is closed by retention:** 38/42 dated `feedback_*` rules
  (Feb–Jul) have zero "before" sessions in the surviving logs; the 4 comparable ones differ
  by 0→1 events (noise). Retention does *not* invalidate a prospective ledger (it persists
  its own counts) — only the retrospective shortcut.
- **Measured rescue option:** widening the reward to include `false_success` (156 events,
  discrete, machine-observed, behavioral) lifts pooled SNR to 1.00 — still ~8 epochs/arm
  for confidence, and only pooled. Adding `repeated_question` *lowers* SNR to 0.74.

**Consequence (per this section's own fail branch):** the per-class ON/OFF gate starves →
re-scope. The ledger + rejected-edit buffer + lifecycle bookkeeping stand on their own (no
statistical power needed) and remain buildable.

### Rescue option validated and rejected (2026-07-08): pooled gate + `false_success`

Per user direction, the pooled-reward variant (gate the whole trial block, reward =
REACTION + `false_success`) was validated before falling back. Three checks, all failed:

1. **Reward precision ~7–15%.** 15 sampled `false_success` events read in context: ~12
   were unrelated non-zero exits after a "Done" message (rejected git push, gpg timeout,
   provider flake, grep exit 1 — one "error" even contained `0 fail … BUILD_OK`); 1 real,
   2 ambiguous. Confirms friction's own label: INFERRED, never seed alone.
2. **False-promote rate 20% (2 cycles) / 8.7% (3 cycles)** on shuffled real epoch data with
   no true change — far above what precision-over-recall tolerates for always-loaded rules.
3. **Power 64% (2 cycles) / 42% (3 cycles)** against a simulated true halving — the
   strictly-lower-every-cycle rule loses power faster than it buys safety as cycles grow.

**DECIDED (2026-07-08): v1 re-scope.** The ON/OFF gate (per-class *and* pooled) is
**DEFERRED** — un-defer condition: observed pooled REACTION rate sustains epoch SNR ≥ 2
over a quarter, or a high-precision behavioral event source appears. v1 ships the
**ledger + rejected-edit buffer + lifecycle bookkeeping** (candidate → hot with evidence
recorded; rejected phrasings never re-proposed; ESCALATED lane intact) — the missing 1-1
consolidation, no statistical power required.

## 10. Deferred / non-goals

- **DEFERRED — per-session hooks (claude only):** parallel-arm canarying and enforcement-tier
  injection via `SessionStart`/`PreToolUse`. Un-defer condition: the epoch gate works but
  converges too slowly on high-value rules, **and** the ESCALATED lane produces rules that are
  hook-shaped (enforcement, not advice). Ships as an optional claude enhancement, never core.
- **DEFERRED — Hebbian / co-retrieval relatedness edges:** relating memories by used-together
  co-occurrence is the **litectx** lane (access-log substrate), not this pipeline. Un-defer
  condition: a density probe of litectx's recall log shows enough cross-session co-retrieval
  to learn edges from. Not before — and never inside sleep (one job: gate rules).
- **DEFERRED — dream-walker** (no-query offline walk proposing cross-domain candidate links):
  only after the gate ships, and its proposals MUST be stamped unverified and gated by later
  use — never injected on proposal (else it is SELECT-with-extra-steps, already falsified at
  ~75% noise). Un-defer condition: the gate is live and a session-confirmation mechanism for
  proposed links exists.
- **DEFERRED — local classifier model as paraphrase-blocking proposer:** a small local
  matching model (proven in ER exploration: ~94% recall at top-20 shortlists, weak at yes/no
  deciding) could sit between friction's shingle clustering and `/remember`'s classify step
  (4a), shortlisting cross-session paraphrase pairs that keyword shingles miss ("did you
  ground your check" ↔ "you will fucking validate this" — same antigen, near-zero token
  overlap). Role is strictly *proposer*: its known failure mode (pulling near-identical-but-
  different items together) is exactly the false-recurrence-inflation → false-promotion
  poisoning the observed-signal redesign killed, so the LLM classify step always disposes
  each shortlisted match. Not now
  because (a) no scale problem — ~63 clusters fit in one LLM pass, which is both proposer and
  a better decider at this N; (b) it adds a weights+runtime dependency against the
  single-file, dependency-free `friction.js` invariant (optional tier at best, never core).
  Un-defer condition: an offline measurement on the existing candidate corpus shows
  paraphrase merges that shingles missed would move at least one class across a recurrence
  tier (i.e. undercounted recurrence is demonstrably suppressing promotions). If no class
  changes tier, it's a dependency for nothing — same verdict as the shelved priority formula.
- **POSTPONED — the full SkillOpt loop on deterministic benches** (optimize a `best_skill.md`
  against litectx/aurora bench scores). Real and probably the highest-ceiling item, but a
  separate effort with real rollout cost. Parked by explicit user decision (2026-07-08).
- **NON-GOAL — sentiment scoring.** Frustration language is never the reward; only discrete
  correction-events are counted. No LLM ever scores rule "goodness."
- **NON-GOAL — usage tracking.** Whether a rule was *read* is unknowable portably; sleep
  measures whether the mistake *stopped*. Effect, not attention.
- **NON-GOAL — gating Facts/Episodes.** Knowledge goes hot as today; only behavioral rules
  are gated.

## 11. Design invariants (the ones to not re-litigate)

1. **Propose-dispose:** no rule reaches permanent hot memory except through the gate.
   Reflection proposes; consequences dispose. (The one move that survives regardless of how
   representations turn out — it doesn't require the representation to be honest.)
2. **Precision over recall, inherited:** ambiguity defaults to *not hot*; a rejected real rule
   recurs and gets another attempt; a false promoted rule poisons every session.
3. **One mechanism, four tools:** anything core must ride the shared `MEMORY.md` injection.
   Tool-specific power (hooks) is an optional tier, never load-bearing.
4. **The ledger is the memory of the memory:** every candidate, arm, count, verdict, and
   buffer entry is on disk and human-readable. Sleep is auditable and fully revertible.
5. **LLM as classifier, never scorer** (R-S8).

## 12. v1 as shipped (2026-07-08)

Implemented as `/remember` step **4c** (instructions-only, identical across all four
packages; no new code, no background agent):

- **Ledger:** `<tool-dir>/remember/ledger.json` — one entry per antigen class: `class_hints`
  (dedup key), `status` (observing → hot → rejected/escalated), `attempts` (every phrasing,
  dated, with outcome — failed attempts ARE the rejected-edit buffer), `evidence`,
  `recurred_while_hot`, append-only `history`.
- **Lifecycle:** promotion thresholds unchanged (5+ sessions → hot). New: a class firing
  while its rule is loaded increments `recurred_while_hot`; at 2 the phrasing is marked
  failed and rephrased (buffer-checked); after 2 failed phrasings → ESCALATED: rule removed
  from hot, recorded as a Fact, flagged in the report. Flag, don't act.
- **Division of labor:** MEMORY.md is the render (read as guidance); the ledger is the
  record (checked, never injected). Malformed ledger → loud, moved aside, fresh start.
- **The ledger is the only cross-window recurrence memory** (found in live validation,
  2026-07-08): session transcripts prune at ~7 weeks, so friction re-counts inside that
  window each run — a class recurring slowly (March, then September) looks like a singleton
  to friction *both times*. Only the ledger's evidence merge accumulates recurrence across
  windows, which makes it the sole path by which slow-recurring antigens can ever reach the
  hot threshold — load-bearing, not just bookkeeping for the deferred gate.

The ON/OFF gate design (§4–5) stays specced here, DEFERRED per §9's POC results.
