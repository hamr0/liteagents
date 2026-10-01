---
description: Verify what you delivered since the last self-review with real runs, and review its structure
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about everything since the last self-review — committed or not — before
`/branch-review`. The orchestrator resolves the range and hands off; a
spawned worker tries to break it.

## Guardrails
- **Spawn a worker, mid tier stated explicitly** (omitted inherits the
  parent's, not the balanced one; not cheapest/fastest either — judgment
  degrades there; never a vendor model name — this spec names the tier,
  you translate it to whatever your spawn tool calls its mid tier), and hand
  it this file's path — a worker has no skill text of its own. **No
  delegation, no sub-spawning** — every command the worker cites is one it
  ran itself.
- **Ask and surface only. Never fixes anything.** The user picks.

## 1. Orchestrator — resolve the range, then hand off
The bookmark is one line, `self-review-sha:`, in `/branch-review`'s record
(`/self-review` is its only writer):
```
grep '^self-review-sha:' .opencode/remember/last-review.md || grep '^debrief-sha:' .opencode/remember/last-review.md
```
No `self-review-sha:` line → the old `debrief-sha:` name, once (that is what
the `||` does; the new name wins if both exist). Fails either check, or
starts with `-` → **no bookmark** (no branch check needed — ancestry alone
proves it belongs to this history):
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
Range empty **and** tree clean → "nothing new since the last self-review," stop,
no worker spawned. Otherwise hand off — what was done, claims made (works /
tested / done), files changed, loose ends only you can know (a peer session
not told, a silent open question, unshipped state) — and spawn one
mid-tier worker. **Overlap accepted:** uncommitted work seen again once
committed is over-work, never a miss.

## 2. Worker — try to break it, not confirm it
Real runs, not re-assertion, scoped to the range for structure/glossed/
underspecced — the regression check is always the **FULL** suite, never
scoped:
- **Does it work?** Run the thing/tests now; cite the command and numbers.
- **No regression?** Run the FULL suite, cite totals vs. before — no run
  behind a claim counts as not checked.
- **Structure?** Speculative code, an abstraction for one caller, redundant
  tests. Dead code — grep the symbol repo-wide before flagging. State
  ownership — two or more functions assigning the same field: name both
  writers with `file:line`, grep every assignment repo-wide, not just the
  diff; a write from a callback, thread or lifecycle event counts (one app
  writer racing a framework one is still two). Reuse — a new function, class,
  file or name duplicating an existing one: name the existing one. Changed
  lines that trace to no request. Complexity, naming, duplication only when
  material. Performance (N+1, blocking calls in hot paths, unbounded loops)
  only with evidence.
- **Glossed over?** Tradeoffs not flagged, claims untested as shipped, the
  handoff's loose ends verified, not just repeated.
- **Underspecced?** What should have been part of this and is missing.

**Report opens with two lines, always filled:**
```
works: <command> exit <code> <totals> | NOT RUN: <reason>
full-suite: <command> exit <code> <totals> vs before <totals> | NOT RUN: <reason>
```

**The bar — Fix now and Later alike:** every item needs one concrete failure
sentence — specific input/state → what breaks. "Will mislead the next
reader" is not one: no input, no state, no break named. Can't write it →
drop it, count only (`dropped: N`). **Carve-out:** a Structure item may
replace the failure sentence with the rule it breaks plus the `file:line`(s)
that prove it; Structure items always go in **Later**, never **Fix now**,
unless they do carry a real failure sentence. Each item is one kind, counted
in one cap only. Max 5 failure-sentence items and max 5 Structure items, ranked,
in two piles: **Fix now** (changes
whether you ship) and **Later**.

## 3. Orchestrator — relay as-is, then ledger
**"As-is":** same items, order, piles, and the worker's `works:` and
`full-suite:` lines; each failure sentence and cited
commands/numbers preserved. Reworded for the user's output style: fine.
Added, dropped, merged, re-ranked, or weakened: not — your own
recommendation is allowed only marked as yours, separate from the worker's
items. When you relay the report, the **orchestrator** (worker's turn is over
by then) appends **every anchorable** item, both piles, to `.opencode/remember/fix-ledger.md`
right away, `/branch-review`'s format, tagged `nit`/`change`/`idea` (Underspecced
items → `idea`: missing, an option not debt), bullet text verbatim. Then ask
which, if any, to remove: no answer → they all stay; remove only on the
user's explicit say-so naming the items. Items the user fixes now are not
removed by hand — `/refactor`'s revalidation drops them once the finding no
longer holds.
Dedupe with plain `grep -F "<snippet>" .opencode/remember/fix-ledger.md`
(never `git grep` — gitignored). **Anchor rule:** a verbatim snippet `grep
-F` can find; missing (usually an `idea`) → anchor where it should go; no line to name → no
ledger entry, report it as "your call" instead — the anchor rule wins over
"every". Relay one line, filled (A + D + Y = N), so a dropped append shows:
`ledger: <N> items → <A> appended, <D> already there, <Y> your call`

**Last act — rewrite only the bookmark line**, never another line in the file.
Write it when you relay the report — it records what was checked and does not
wait for the user's pick.
It also drops any old `debrief-sha:` line:
```
F=.opencode/remember/last-review.md
mkdir -p .opencode/remember
touch "$F"
grep -vE '^(self-review|debrief)-sha:' "$F" > "$F.tmp"
echo "self-review-sha: <full HEAD sha>" >> "$F.tmp"
mv "$F.tmp" "$F"
```

**Loop guard:** re-run after fixes until zero **Fix now** remain — **Later**
never counts; fixing a Later item anyway is new uncommitted work the next
run checks like any other, not a re-run trigger. A third round with new
Fix-now caused by the previous fix → stop: "redesign, don't patch again."
**Not a gate:** `/branch-review` and `/release` don't require this to have
run — close with "commit, then `/branch-review`," a sentence to **say**, never
run.
