---
description: Verify what you delivered before commit — real runs, not re-assertion
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about the work just done — **before** commit, before `/branch-review`. Two
parts: the orchestrator hands off, a spawned worker tries to break it.

## Guardrails
- **Spawn a worker and explicitly select your tool's mid tier.** State the
  tier on the spawn — do not omit it and rely on a default. An omitted tier
  inherits the *parent's* tier, which is not the same thing as the balanced
  one. Pick the judgment-capable tier that is cheaper and faster than your top
  reasoning tier. **Not the cheapest/fastest tier**: on judgment work it
  measurably degrades (misclassification rates several times higher). Choose by
  tier, not by a vendor model name copied from this file — names drift, and
  this command ships to several tools. Fall back to running inline if your tool
  has no subagent mechanism.
- **The worker does the work itself — no delegation.** It must **not** spawn
  subagents of its own; every command it cites has to be one it ran itself.
- **Ask and surface only. Never fixes anything.** The user picks.

## 1. Orchestrator — write the handoff
Do not judge your own work. Write the worker a short handoff: what was done,
the claims made to the user (works / tested / done), files changed (`git
diff` / `status` / `log`), and loose ends only you can know — a peer session
not told, a silent open question, unshipped state (uncommitted / unreviewed
/ unreleased). Spawn one mid-tier worker with it.

## 2. Worker — try to break it, not confirm it
Real runs, not re-assertion:
- **Does it work?** Run the thing, or its tests, now. Cite the command and
  the numbers.
- **No regression?** Run the FULL suite now, cite totals, compare to before.
  A claim with no run behind it counts as not checked.
- **Bloat?** Anything added the task didn't need — speculative code,
  redundant tests, an abstraction for one caller.
- **Glossed over?** Tradeoffs not flagged, claims not tested as shipped, the
  handoff's loose ends — verify them, don't just repeat them.
- **Underspecced?** What should have been part of this work and is missing.
- **Docs?** Which docs now describe something untrue — surface only, Stage 4
  of `/branch-review` writes them.

**The bar:** every item needs one concrete failure sentence — specific
input/state → what breaks. Can't write that sentence → it's a nit-of-a-nit:
drop it and report only the count (`dropped: N`). Return max 5 items,
ranked, in two piles: **Fix now** (changes whether you ship) and **Later**.

## 3. Orchestrator — relay, then ledger
Relay the worker's report **as-is** — no softening, dropping, or re-ranking.
The user chooses what to fix now. Whatever they do **not** choose, the
**orchestrator** (the worker's own turn is over by then) appends to
`.opencode/remember/fix-ledger.md`, in the exact format `/branch-review`
writes, tagged `nit` or `change`, using the worker's bullet text verbatim.
Dedupe first with plain `grep -F "<snippet>" .opencode/remember/fix-ledger.md`
(never `git grep` — normally gitignored).

**Anchor rule.** Needs a verbatim snippet `grep -F` can find. For something
missing, anchor on the existing line where it should go. No line to name →
it does not go in the ledger (`/refactor` deletes a bullet with no anchor
hit) — leave it in the report as "this is a feature — your call."

## Loop guard
Re-run `/debrief` after fixes until zero **Fix now** items remain — Later
items never count. A third round with new Fix-now items caused by the
previous round's own fix → stop and say: "redesign, don't patch again."

## Not a gate
`/branch-review` and `/release` do not require this to have run. Close with:
"commit, then `/branch-review`" — a sentence to **say**, never a sequence to
run yourself.
