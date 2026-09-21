---
name: debrief
description: Verify what you delivered since the last debrief — real runs, not re-assertion
allowed-tools: Read, Grep, Glob, Edit, Write, Agent, Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git merge-base:*)
disable-model-invocation: true
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about everything since the last debrief — committed or not — before
`/branch-review`. The orchestrator resolves the range and hands off; a
spawned worker tries to break it.

## Guardrails
- **Spawn a worker, mid tier stated explicitly** (omitted inherits the
  parent's, not the balanced one; not cheapest/fastest either — judgment
  degrades there; never a vendor model name). **No delegation, no
  sub-spawning** — every command the worker cites is one it ran itself.
- **Ask and surface only. Never fixes anything.** The user picks.

## 1. Orchestrator — resolve the range, then hand off
The bookmark is one line, `debrief-sha:`, in `/branch-review`'s record
(`/debrief` is its only writer):
```
grep '^debrief-sha:' .claude/remember/last-review.md
```
Fails either check, or starts with `-` → **no bookmark** (no branch check
needed — ancestry alone proves it belongs to this history):
```
git rev-parse --verify <sha>
git merge-base --is-ancestor <sha> HEAD
```
Valid → range `<sha>..HEAD`. No bookmark → whole branch, that commit's
`..HEAD` (`git merge-base main HEAD`). Either way add uncommitted changes:
```
git diff HEAD
git status --porcelain
```
Range empty **and** tree clean → "nothing new since the last debrief," stop,
no worker spawned. Otherwise hand off — what was done, claims made (works /
tested / done), files changed, loose ends only you can know (a peer session
not told, a silent open question, unshipped state) — and spawn one
mid-tier worker. **Overlap accepted:** uncommitted work seen again once
committed is over-work, never a miss.

## 2. Worker — try to break it, not confirm it
Real runs, not re-assertion, scoped to the range for bloat/glossed/
underspecced/docs — the regression check is always the **FULL** suite, never
scoped:
- **Does it work?** Run the thing/tests now; cite the command and numbers.
- **No regression?** Run the FULL suite, cite totals vs. before — no run
  behind a claim counts as not checked.
- **Bloat?** Speculative code, redundant tests, an abstraction for one caller.
- **Glossed over?** Tradeoffs not flagged, claims untested as shipped, the
  handoff's loose ends verified, not just repeated.
- **Underspecced?** What should have been part of this and is missing.
- **Docs?** What now reads untrue — surface only; `/branch-review` writes it.

**The bar — Fix now and Later alike:** every item needs one concrete failure
sentence — specific input/state → what breaks. "Will mislead the next
reader" is not one: no input, no state, no break named. Can't write it →
drop it, count only (`dropped: N`). Max 5 items, ranked, in two piles:
**Fix now** (changes whether you ship) and **Later**.

## 3. Orchestrator — relay as-is, then ledger
**"As-is":** same items, order, piles; each failure sentence and cited
commands/numbers preserved. Reworded for the user's output style: fine.
Added, dropped, merged, re-ranked, or weakened: not — your own
recommendation is allowed only marked as yours, separate from the worker's
items. User picks what to fix now; whatever they don't, the **orchestrator**
(worker's turn is over by then) appends to `.claude/remember/fix-ledger.md`,
`/branch-review`'s format, tagged `nit`/`change`, bullet text verbatim.
Dedupe with plain `grep -F "<snippet>" .claude/remember/fix-ledger.md`
(never `git grep` — gitignored). **Anchor rule:** a verbatim snippet `grep
-F` can find; missing → anchor where it should go; no line to name → no
ledger entry, report it as "your call" instead.

**Last act — rewrite only the bookmark line**, never another line in the file:
```
F=.claude/remember/last-review.md
mkdir -p .claude/remember
touch "$F"
grep -v '^debrief-sha:' "$F" > "$F.tmp"
echo "debrief-sha: <full HEAD sha>" >> "$F.tmp"
mv "$F.tmp" "$F"
```

**Loop guard:** re-run after fixes until zero **Fix now** remain — **Later**
never counts. A third round with new Fix-now caused by the previous fix →
stop: "redesign, don't patch again." **Not a gate:** `/branch-review` and
`/release` don't require this to have run — close with "commit, then
`/branch-review`," a sentence to **say**, never run.
