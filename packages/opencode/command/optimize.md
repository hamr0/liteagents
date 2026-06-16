---
name: optimize
description: Optimize performance [target]
usage: /optimize <target-area>
argument-hint: [file-or-function]
allowed-tools: Read, Edit, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(git grep *), Bash(rg *)
---
Analyze $ARGUMENTS for performance.

## Examine
- Time complexity (Big O)
- Space complexity
- I/O operations
- Database queries (N+1?)
- Unnecessary allocations

## Output
Per bottleneck:
- **Location** (`file:line`)
- **Cost** — what's slow and by how much. Concrete ("N+1 over ~1k rows on
  every page load"), not vague ("could be faster").
- **Optimization** — specific change.
- **Expected improvement** — order-of-magnitude estimate.
- **Trade-offs** — readability / memory / consistency cost.

## After the analysis — verify, then fix

Performance claims are easy to invent. Validate before acting.

**Verify each bottleneck.** Re-read the cited `file:line` in context.
Confirm the path is **actually hot** — look for at least one of:
- a profile / benchmark / log line showing call frequency or duration,
- the path sits on an obvious hot loop / per-request handler with real
  volume,
- the user provided evidence in the request.

Without one of those, the claim is **uncertain — don't optimize on
speculation.** Mark each finding **confirmed**, **false positive** (with
reason), or **uncertain (needs profiling data)**.

**Fix what's confirmed and unambiguous** — minimal change, one obvious
shape, **no behavior change**, no API change. Apply directly. After
each edit, re-read the changed region and confirm it still computes the
same answer (perf optimizations that quietly change semantics are the
worst kind).

**Stop and ask** when (HITL gates — not all the time, only here):
- the bottleneck is **uncertain** after grounding (no profile / log and
  not obviously hot),
- the fix has **multiple reasonable shapes** (cache vs precompute vs
  batch vs paginate vs index) — present options with tradeoffs, not a
  chosen path,
- it changes **public API / response shape / DB schema / caller contract**,
- it trades **correctness for speed** (lossy approximation, weaker
  consistency, eventual-vs-strict) — even when "obviously" faster, or
- it touches **concurrency primitives** (locks, atomics, ordering) —
  easy to introduce races.

Final report: **confirmed-and-fixed** · **confirmed-but-asking** (why +
options) · **false-positive** (why) · **uncertain** (what profiling /
data is needed to decide).
