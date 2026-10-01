---
name: self-review
description: Verify what you delivered since the last self-review with real runs, and review its structure
allowed-tools: Read, Grep, Glob, Edit, Write, Agent, Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git merge-base:*)
disable-model-invocation: true
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about committed work since the last self-review, before `/branch-review`. The
orchestrator resolves the range and hands off; a spawned worker tries to
break it.

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
**Dirty tree first:** `git status --porcelain` prints any line → stop: the
tree is dirty (list the paths), `/self-review` reviews commits not the working
tree, commit then re-run. No worker spawned.

**Hashes given** (`$ARGUMENTS`: one or more) → review exactly those commits,
nothing else, each via `git show <sha>`, on any branch. Validate each with
`git rev-parse --verify <sha>^{commit}`; reject anything starting with `-`.
Hash mode never rewrites `self-review-sha:`.

**No hash** → on `main`/`master`, stop and ask for one or more hashes.
Otherwise the bookmark is one line, `self-review-sha:`, in `/branch-review`'s
record (`/self-review` is its only writer):
```
grep '^self-review-sha:' .claude/remember/last-review.md || grep '^debrief-sha:' .claude/remember/last-review.md
```
No `self-review-sha:` line → the old `debrief-sha:` name, once (that is what
the `||` does; the new name wins if both exist). Fails either check, starts
with `-`, or the third exits 0 (an ancestor of `main`'s merge-base is from an
already-merged branch) → **no bookmark**:
```
git rev-parse --verify <sha>
git merge-base --is-ancestor <sha> HEAD
git merge-base --is-ancestor <sha> $(git merge-base main HEAD)
```
Valid (third command exits non-zero) → range `<sha>..HEAD`. No bookmark →
whole branch, `git merge-base main HEAD`..`HEAD`. Range empty → "nothing new
since the last self-review," stop, no worker spawned. Otherwise hand off —
what was done, claims made (works / tested / done), files changed, the
baseline suite totals if known, loose ends only you can know (a peer session
not told, a silent open question, unshipped state) — and spawn one mid-tier
worker.

## 2. Worker — try to break it, not confirm it
Real runs, not re-assertion, scoped to the range for cleanup/glossed/
underspecced — the regression check is always the **FULL** suite, never
scoped:
- **Does it work?** Run the thing/tests now; cite the command and numbers.
- **No regression?** Run the FULL suite, cite totals vs. the handoff baseline — no run
  behind a claim counts as not checked.
- **Cleanup?** Speculative code, an abstraction for one caller, redundant
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

**Report opens with four lines, always filled** (so "checked, found nothing"
never looks like "skipped"); tag every item `nit`/`change`/`idea`:
```
works: <command> exit <code> <totals> | NOT RUN: <reason>
full-suite: <command> exit <code> <totals> vs before <totals | unknown> | NOT RUN: <reason>
underspecced: <N> items | none found: <what was checked, one phrase>
cleanup: <N> items | none found: <what was checked, one phrase>
```

**The bar — Fix now and Later alike:** every item needs one concrete failure
sentence — specific input/state → what breaks. "Will mislead the next
reader" is not one: no input, no state, no break named. Can't write it →
drop it, count only (`dropped: N`). **Carve-out:** a Cleanup item may
replace the failure sentence with the rule it breaks plus the `file:line`(s)
that prove it; Cleanup items always go in **Later**, never **Fix now**,
unless they do carry a real failure sentence. Each item is one kind, counted
in one cap only. Max 5 failure-sentence items and max 5 Cleanup items, ranked,
in two piles: **Fix now** (changes
whether you ship) and **Later**.

## 3. Orchestrator — relay as-is, then ledger
**"As-is":** same items, order, piles, and the worker's four report lines
(`works:`, `full-suite:`, `underspecced:`, `cleanup:`); each failure sentence and cited
commands/numbers preserved; **every relayed item keeps its tag
(`nit`/`change`/`idea`) and its `file:line`**. Reworded for the user's output style: fine.
Added, dropped, merged, re-ranked, or weakened: not — your own
recommendation is allowed only marked as yours, separate from the worker's
items. When you relay the report, the **orchestrator** (worker's turn is over
by then) appends **every anchorable** item, both piles, to `.claude/remember/fix-ledger.md`
right away, `/branch-review`'s format (header: its Ledger section), tagged `nit`/`change`/`idea` (Underspecced
items → `idea`: missing, an option not debt), bullet text verbatim. Bullet shape:
```
- `path/file.js` · "verbatim snippet from the line" · what's wrong · failure scenario · YYYY-MM-DD @ <short sha> · nit
```
**Stale header:** if ``grep -F '`idea` =' .claude/remember/fix-ledger.md`` finds nothing, replace the header block with the current one from `/branch-review`'s Ledger section; bullets are never touched. Then ask
which, if any, to remove: no answer → they all stay; remove only on the
user's explicit say-so naming the items. Items the user fixes now are not
removed by hand — `/refactor`'s revalidation drops them once the finding no
longer holds.
**One path per bullet:** anchor the first file, name the others in the
scenario slot. **One snippet per item** (a second item on the same line
anchors a different nearby line). A corrected `file:line` is noted as
"corrected" in the relay.
Dedupe with plain `grep -F "<snippet>" .claude/remember/fix-ledger.md`
(never `git grep` — gitignored). **Anchor rule:** a verbatim snippet `grep
-F` can find; missing (usually an `idea`) → anchor where it should go; no line to name → no
ledger entry, report it as "your call" instead — the anchor rule wins over
"every". Relay one line, filled (A + D + Y = N), so a dropped append shows:
`ledger: <N> items → <A> appended, <D> already there, <Y> your call`

**Last act (no-hash mode only; hash mode leaves the bookmark) — rewrite only
the bookmark line**, never another line in the file. Write it when you relay the report — it records what was checked and does not
wait for the user's pick.
It also drops any old `debrief-sha:` line:
```
F=.claude/remember/last-review.md
mkdir -p .claude/remember
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
