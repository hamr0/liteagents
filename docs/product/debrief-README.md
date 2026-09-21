---
type: reference
title: debrief
status: draft
updated: 2026-09-21
---

# debrief

`/debrief` answers the owner's habitual question: **"verify what you delivered, what
did you gloss over, what did I miss?"** It covers everything since the last debrief —
committed or not — before `/branch-review`.

```
work  ──►  /debrief  ──►  commit  ──►  /branch-review  ──►  /release
```

**It is not a gate.** `/branch-review` and `/release` do not require it to have run.
Its own closing line — "commit, then `/branch-review`" — is a sentence to *say*, never
a sequence the command runs itself.

---

## 1. Who runs it, and why not the author

Two parties, one spawn:

1. **The orchestrator** (the main session that just did the work) writes a short
   **handoff**: what was done, the claims made to the user (works / tested / done),
   files changed, and the loose ends only it can know — a peer session never told, an
   open question left silent, unshipped state.
2. It **spawns one mid-tier worker** with that handoff — explicitly, never the
   cheapest/fastest tier and never inheriting a default, the same rule every other
   worker-spawning command in this toolkit follows. The worker does the whole debrief
   itself; it must not spawn subagents of its own.

The main session never grades its own work, and the spawn is never the high tier
either — **the author has an incentive to say it's clean**, and a bigger model asked
to confirm its own claims tends to do exactly that. A fresh mid-tier worker, handed
only the facts and told to try to break them, doesn't carry that incentive.

---

## 2. The range — since the last debrief

The range covers everything since the last debrief, committed or not: a
committed-only range would miss today's uncommitted edits, and an
uncommitted-only range would miss work already committed earlier in the
session. Neither alone is what "verify what I just did" means.

This works via a **bookmark**: one line, `debrief-sha:`, living inside
`.claude/remember/last-review.md` — the same record `/branch-review` writes.
`/debrief` is its only writer; `/branch-review` only carries it forward,
unread and unedited, each time it overwrites that file.

At the start of every run the orchestrator validates the bookmark exactly the
way `/branch-review` validates its own record (`git rev-parse --verify`, then
`git merge-base --is-ancestor … HEAD`) — no branch check, since ancestry alone
proves the bookmarked commit belongs to this history. Valid → the range is
`<bookmark>..HEAD`. No bookmark, or one that fails either check → the whole
branch, `$(git merge-base main HEAD)..HEAD`. Either way, uncommitted changes
and untracked files are added on top. Range empty **and** the tree clean →
"nothing new since the last debrief," and no worker is spawned.

**Accepted overlap:** work debriefed while still uncommitted, then committed
later, gets seen once more on the next run. That's over-work, never a miss —
the design trades a little redundancy for never silently skipping something.

At the end of every run the orchestrator rewrites the bookmark to the current
HEAD, touching only that one line — every other line in `last-review.md`
(`sha:`, `branch:`, `verdict:`, `blockers:`, …) is left exactly as it was.

---

## 3. The six questions

The worker runs real commands — the thing itself, or its tests, now — and asks:

- **Does it work?** The command and the numbers, not a restatement.
- **No regression?** The full suite, now, compared to before.
- **Bloat?** Anything the task didn't need — speculative code, redundant tests, an
  abstraction for one caller.
- **Glossed over?** Tradeoffs not flagged, claims not tested as shipped, the
  handoff's loose ends — verified, not just repeated.
- **Underspecced?** What should have been part of this work and isn't.
- **Docs?** What now reads untrue — surfaced only; `/branch-review` Stage 4 writes
  the fix.

## 4. The bar — Fix now and Later alike

Every item, in **either** pile, needs one concrete failure sentence: specific
input/state → what breaks. Later is not a lower bar — it's a deferral, not an
excuse to skip the sentence. "Will mislead the next reader" is a real example
that got through in the field and shouldn't have: no input named, no state
named, no break named. Can't write the sentence → it's a nit-of-a-nit: dropped,
and only the count (`dropped: N`) is reported, so the user can see it looked
rather than skipped.

Surviving items: **max 5, ranked**, in two piles — **Fix now** (changes whether you
ship) and **Later**.

---

## 5. Relay as-is, then ledger

**"As-is" means:** same items, same order, same piles, and each item's failure
sentence and cited commands/numbers preserved exactly. Rewording to fit the
user's own output style is fine — a field run under a "plain wording" style
correctly kept everything else identical while reflowing the sentences.
Adding, dropping, merging, re-ranking, or weakening an item is **not** "as-is,"
regardless of how it's justified. The orchestrator may add its own
recommendation on top, but only clearly marked as its own, separate from the
worker's items — never blended into them.

The orchestrator relays the worker's report **as-is**, and the user picks what to
fix now.

Whatever the user does **not** pick goes to `.claude/remember/fix-ledger.md`, in the
same format `/branch-review` writes: tagged `nit` (a refactor-sized fix) or `change`
(needs a behaviour change or redesign) — the size of the fix, not its severity. The
**orchestrator** writes this append, not the worker: the worker's own turn is already
over by the time the user picks, so the entity present when the ledger entry needs
writing is the one holding the conversation.

**Anchor rule.** A bullet needs a verbatim snippet `grep -F` can still find. For
something *missing*, that's the existing line where it should go. No line can be
named → it doesn't go in the ledger at all — `/refactor` deletes any bullet whose
anchor has no hit, so an anchor-less one would just die there — and it stays in the
report instead as "this is a feature — your call."

## 6. Consuming the tags

`/branch-review`'s closing line and `/refactor`'s ledger-mode report both count the
same file the same way: every bullet ending `· change` is a `change`, everything else
is a `nit` — **N nits, K changes**. `/refactor` (no arguments) fixes surviving `nit`
bullets only; a `change` bullet is left for a real refactor pass, or retagged in place
if a `nit` turns out to need one.

## 7. Loop guard

Re-run `/debrief` after fixes until zero **Fix now** items remain — **Later** items
never count toward that. If a third round still turns up new Fix-now items *caused by
the previous round's own fix*, stop: "redesign, don't patch again," instead of
patching a fourth time.

---

## Worked example

The first real run of `/debrief` on this toolkit's own catalog-count sweep is why
the six questions exist: an earlier pass had already swept every *digit* count (13 →
14) across READMEs and kit configs, and reported done. `/debrief`'s worker re-ran the
diff and grepped for count language a digit-only sweep can't see — and found
`packages/claude/CLAUDE.md` still saying **"The nine that are deliberate actions"**,
spelled as a word, one line the earlier pass's search had no way to catch. One
concrete failure sentence, one `grep`, caught by *running* the check rather than
re-asserting the sweep was complete.
