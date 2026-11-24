---
description: Verify what you delivered since the last self-review with real runs, and review its structure
argument-hint: [commit hashes | from..to | blank = since last self-review]
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about committed work since the last self-review, before `/branch-review`. The
orchestrator resolves the range and hands off; a spawned worker tries to
break it.

## Guardrails
- **Spawn one worker, mid tier stated explicitly** (an omitted tier inherits the
  parent's; never a vendor model name), and hand it this file's path — a
  worker has no skill text of its own. It does the work itself: **no
  sub-spawning**, every command it cites is one it ran. **Escalate, never
  assume.**
- **Ask and surface only. Never fixes anything.** The user picks.

## 1. Orchestrator — resolve the range, then hand off
**Dirty tree first:** `git status --porcelain` prints any line → stop: the
tree is dirty (list the paths), `/self-review` reviews commits not the working
tree, commit then re-run. No worker spawned.

**Decide REUSE or RUN now, once:** run this line as printed and print its
output; it stays valid for the whole run (this command commits nothing). Pass that exact output line to the worker in its brief.
```
f=.factory/remember/last-review.md; g=$(sed -n 's/^green: \([0-9a-f]\{40\}\) .*/\1/p' "$f" 2>/dev/null); c=$(git diff --name-only "$g" HEAD 2>/dev/null | grep -vE '^(docs/|[^/]+\.md$)'); if [ -z "$g" ]; then echo "RUN (no green: line)"; elif ! git merge-base --is-ancestor "$g" HEAD 2>/dev/null; then echo "RUN (green $(printf %s "$g" | cut -c1-7) not an ancestor of HEAD)"; elif [ -z "$c" ]; then echo "REUSE $(grep '^green: ' "$f")"; else echo "RUN (green $(printf %s "$g" | cut -c1-7), changed: $(printf '%s\n' "$c" | paste -sd' ' - | cut -c1-200))"; fi
```

**Hashes or a range given** (`$ARGUMENTS`: one or more hashes, or `<a>..<b>`)
→ review exactly those commits, nothing else, on any branch: each hash via
`git show <sha>`, a range via `git log <a>..<b>` and `git diff <a>..<b>`.
Validate each hash, and both ends of a range, with
`git rev-parse --verify <x>^{commit}`; reject anything starting with `-`.
Hash/range mode never rewrites `self-review-sha:`.

**Neither** → on `main`/`master`, stop and ask for hashes or a range.
Otherwise the bookmark is one line, `self-review-sha:`, in `/branch-review`'s
record (`/self-review` is its only writer):
```
grep '^self-review-sha:' .factory/remember/last-review.md || grep '^debrief-sha:' .factory/remember/last-review.md
```
No `self-review-sha:` line → the old `debrief-sha:` name, once; the new name
wins if both exist. Fails either check, starts
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
the decider line above, what was done, claims made (works / tested / done), files changed, the
baseline suite totals if known (`unverified` when the baseline is from an older sha that was not re-run), loose ends only you can know (a peer session
not told, a silent open question, unshipped state) — and spawn one mid-tier
worker.

## 2. Worker — try to break it, not confirm it
Real runs, not re-assertion, scoped to the range for cleanup/glossed/
underspecced:
- **Does it work?** Run the thing and targeted checks for what changed now,
  never the full suite; cite the command and numbers.
- Run tests bare, never piped: `<test command> > /tmp/out 2>&1; echo "exit $?"` — read the code from that line, then the totals from /tmp/out.
- **No regression?** Use the decider line the orchestrator passed in your brief; never run the decider yourself, never decide. Gate rule per `DEV_RULES`:
  `REUSE …` → cite it (green sha and totals), no full run; `RUN (…)` →
  run the FULL suite once, copy the printed reason into the `full-suite:` line (never write your own), cite totals vs. the handoff baseline, and a failure that passes when
  run alone is re-run alone before it is called real. No run behind a claim
  counts as not checked.
- **Cleanup?** Check the diff against the `DEV_RULES` block in the repo's
  agent config file; cite the rule each finding breaks, with `file:line`.
  Repo rules win; skip anything a linter or test already enforces; a smell is
  labelled "possible …", never a hard violation. Smells: middle man (a
  function that only forwards to another), shotgun surgery (one change
  scattered over many files — a missing shared piece), mysterious name. Copied
  or duplicate code is a `reuse:` item, not middle man. Dead
  code — grep the symbol repo-wide before flagging. Reuse: every new function or
  class gets a `reuse:` entry. An old duplicate the diff didn't introduce →
  suggest `/refactor duplicates`; a reuse item whose fix is a merge goes there
  too, never to ledger mode (it refuses behaviour changes). Performance (N+1,
  blocking calls in hot paths, unbounded loops) only with evidence.
- **Glossed over?** Tradeoffs not flagged, claims untested as shipped, the
  handoff's loose ends verified, not just repeated.
- **Underspecced?** What should have been part of this and is missing. If a
  PRD/issue/spec exists (e.g. `docs/product/prd.md`, issue refs in commit
  messages), quote its line for each missing requirement or scope creep.

**Report opens with five lines, always filled**; tag every item
`nit`/`change`/`idea`:
```
works: <command> exit <code> <totals> | NOT RUN: <reason>
full-suite: REUSE|RUN · reused <sha> (docs only since) <totals> | ran <command> exit <code> <totals> vs before <totals | unknown | unverified> | NOT RUN: <reason>
underspecced: <N> items | none found: <what was checked, one phrase>
cleanup: <N> items | none found: <what was checked, one phrase> · smells: middle man <N|none> · shotgun <N|none> · name <N|none>
reuse: <N new functions/classes> · <name> → <search command> → <existing name | none> … | none added
```

**The bar — Fix now and Later alike:** every item needs one concrete failure
sentence — specific input/state → what breaks. Can't write it → drop it,
count only (`dropped: N`). **Carve-out:** a Cleanup item may
replace the failure sentence with the rule it breaks plus the `file:line`(s)
that prove it; Cleanup items always go in **Later**, never **Fix now**,
unless they do carry a real failure sentence. Each item is one kind, counted
in one cap only. Max 5 failure-sentence items and max 5 Cleanup items, ranked,
in two piles: **Fix now** (changes
whether you ship) and **Later**.

## 3. Orchestrator — relay as-is, then ledger
**"As-is":** same items, order, piles, and the worker's five report lines
(`works:`, `full-suite:`, `underspecced:`, `cleanup:`, `reuse:`); each failure sentence and cited
commands/numbers preserved; **every relayed item keeps its tag
(`nit`/`change`/`idea`) and its `file:line`**. Reworded for the user's output style: fine.
Added, dropped, merged, re-ranked, or weakened: not — your own
recommendation is allowed only marked as yours, separate from the worker's
items. When you relay the report, the **orchestrator** (worker's turn is over
by then) appends **every anchorable** item, both piles, to `.factory/remember/fix-ledger.md`
right away, `/branch-review`'s format (header: the block under `### Ledger` in its SKILL.md) and its dedupe rule, tagged `nit`/`change`/`idea` (Underspecced
items → `idea`), bullet text verbatim. Bullet shape:
```
- `path/file.js` · "verbatim snippet from the line" · what's wrong · failure scenario · YYYY-MM-DD @ <short sha> · nit
```
**Stale header:** if ``grep -F '`idea` =' .factory/remember/fix-ledger.md`` finds nothing, replace the header block with the current one from the block under `### Ledger` in `/branch-review`'s SKILL.md; bullets are never touched. Then ask
which, if any, to remove: no answer → they all stay; remove only on the
user's explicit say-so naming the items. Items the user fixes now are not
removed by hand; `/refactor` drops them.
**One path per bullet:** anchor the first file, name the others in the
scenario slot. **One snippet per item** (a second item on the same line
anchors a different nearby line). A corrected `file:line` is noted as
"corrected" in the relay.
**Anchor rule:** a verbatim snippet `grep
-F` finds exactly once in its file (`grep -cF '<snippet>' <file>` prints 1; else a longer snippet or a nearby unique line); missing (usually an `idea`) → anchor where it should go; no line to name → no
ledger entry, report it as "your call" instead — the anchor rule wins over
"every". Relay one line, filled (A + D + Y = N), so a dropped append shows:
`ledger: <N> items → <A> appended, <D> already there, <Y> your call`

**Last act (no-hash mode only; hash/range mode leaves the bookmark) — rewrite only
the bookmark and `green:` lines**, never another line in the file. Write it when you relay the report, not after the user's pick.
It also drops any old `debrief-sha:` line:
```
F=.factory/remember/last-review.md
mkdir -p .factory/remember
touch "$F"
grep -vE '^(self-review|debrief)-sha:' "$F" > "$F.tmp"
echo "self-review-sha: <full HEAD sha>" >> "$F.tmp"
mv "$F.tmp" "$F"
```

No-hash mode only: after a `RUN` that exited 0, write `green:` per `/branch-review` Stage 1
("On `RUN`, write `green:`"):
`green: <full HEAD sha> <command> exit 0 <totals>`

**Loop guard:** re-run after fixes until zero **Fix now** remain — **Later**
never counts. A third round with new
Fix-now caused by the previous fix → stop: "redesign, don't patch again."
**Not required:** `/branch-review` and `/release` don't require this to have
run — close with "commit, then `/branch-review`," a sentence to **say**, never
run.
