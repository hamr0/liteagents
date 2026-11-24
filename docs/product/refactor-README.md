---
type: reference
title: refactor
status: draft
updated: 2026-11-24
---

# refactor

`/refactor` changes how code is built without changing what it does. Three modes: a named
target (with the performance pass on by default), **ledger mode** (no arguments — works the
fix ledger `/self-review` and `/branch-review` fill), and **duplicates mode** (`duplicates
[path]` — merges functions doing the same job). The spec is `skills/refactor/SKILL.md`; this
page holds the reasons the spec leaves out.

## Why the rules read the way they do

- **Scope is the picked item.** One ledger bullet or one duplicate group per change. A second
  finding noticed on the way past goes back to the orchestrator as a new bullet, never into
  the same diff — the diff has to stay checkable against the item that asked for it.
- **Two checks for the blast radius.** `git status --porcelain` proves only the named files
  changed, but `.claude/` is normally gitignored, so porcelain stays empty whether a fixed
  bullet was deleted, nothing was written, or `MEMORY.md` was overwritten. Hashing
  `.claude/remember` before and after covers that. `last-review.md` is `/branch-review`'s to
  write: a fixer that touched it would forge the gate that judges its own work.
- **HITL gates belong to the orchestrator.** A subagent cannot hold a conversation, so a gate
  that ends in "stop and ask" cannot run inside it. A worker that picked revert / patch /
  update-test on the user's behalf would have answered a question it was never allowed to ask.
- **No delegation inside the worker.** The command's whole output is the claim "a change
  landed and the tests still pass". A fix that delegates its work is a report about a report.
- **Hand back, never chain.** Ledger mode is a fixer, not a review; its diff gets the ordinary
  `/branch-review` gate. Observed in the field: a run chained the review onto the owner's
  "commit" and the owner objected, so "commit" authorizes the commit and nothing after it.
- **Duplicates mode never merges members whose behaviour differs.** A merge there is a
  behaviour change, which ledger mode refuses. A new duplicate introduced by a diff is not
  this mode's job: it is `/self-review`'s `reuse:` finding.

## Goals

- **Shrink the interface, not the pieces.** Splitting one messy function into five that the
  caller must now sequence itself is the same complexity spread thinner behind a bigger
  surface. Complexity goes inward.
- **Churn decides where to start on a broad target.** A refactor is an investment in the
  *next* change to that code, so code nobody edits pays the worst return.

## Performance pass

Performance claims are easy to invent, so a finding counts only with a profile, a hot-loop
argument or user-supplied evidence. Speculative optimisation is scope creep with a stopwatch,
and a perf change that quietly alters semantics is the worst kind — hence the re-read of the
changed region after every such edit.

## Verification

"Existing tests must pass" is the load-bearing constraint, and the only honest way to know is
to run them; a refactor with no detectable test command stops and asks rather than reporting a
silent green.
