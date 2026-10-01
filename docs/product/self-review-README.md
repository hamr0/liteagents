---
type: reference
title: self-review
status: draft
updated: 2026-09-21
---

# self-review

`/self-review` answers the owner's habitual question: **"verify what you delivered, what
did you gloss over, what did I miss?"** It covers everything since the last self-review —
committed or not — before `/branch-review`.

```
work  ──►  /self-review  ──►  commit  ──►  /branch-review  ──►  /release
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
2. It **spawns one mid-tier worker** with that handoff and this spec's path (a worker
   has no skill text of its own) — explicitly, never the
   cheapest/fastest tier and never inheriting a default, the same rule every other
   worker-spawning command in this toolkit follows. The worker does the whole self-review
   itself; it must not spawn subagents of its own.

The main session never grades its own work, and the spawn is never the high tier
either — **the author has an incentive to say it's clean**, and a bigger model asked
to confirm its own claims tends to do exactly that. A fresh mid-tier worker, handed
only the facts and told to try to break them, doesn't carry that incentive.

---

## 2. The range — since the last self-review

The range covers everything since the last self-review, committed or not: a
committed-only range would miss today's uncommitted edits, and an
uncommitted-only range would miss work already committed earlier in the
session. Neither alone is what "verify what I just did" means.

This works via a **bookmark**: one line, `self-review-sha:`, living inside
`.claude/remember/last-review.md` — the same record `/branch-review` writes.
`/self-review` is its only writer; `/branch-review` only carries it forward,
unedited, each time it overwrites that file. Before the rename to `/self-review`
the line was called `debrief-sha:`; an old record holding only that name is
honoured once (read as the bookmark when there is no `self-review-sha:` line —
the new name wins if both exist) and `/branch-review` carries it forward verbatim
until `/self-review` next runs and rewrites it.

At the start of every run the orchestrator validates the bookmark exactly the
way `/branch-review` validates its own record (`git rev-parse --verify`, then
`git merge-base --is-ancestor … HEAD`) — no branch check, since ancestry alone
proves the bookmarked commit belongs to this history. Valid → the range is
`<bookmark>..HEAD`. No bookmark, or one that fails either check → the whole
branch, `$(git merge-base main HEAD)..HEAD`. Either way, uncommitted changes
and untracked files are added on top. Range empty **and** the tree clean →
"nothing new since the last self-review," and no worker is spawned.

**Accepted overlap:** work self-reviewed while still uncommitted, then committed
later, gets seen once more on the next run. That's over-work, never a miss —
the design trades a little redundancy for never silently skipping something.

At the end of every run the orchestrator rewrites the bookmark to the current
HEAD, touching only that one line (and dropping any old `debrief-sha:` line) —
every other line in `last-review.md` (`sha:`, `branch:`, `verdict:`,
`blockers:`, …) is left exactly as it was. The rewrite happens when the report
is relayed, not after the user's Fix now / Later pick: it records what was
checked; the ledger append follows whenever the pick arrives.

---

## 3. The questions

The worker runs real commands — the thing itself, or its tests, now — and asks:

- **Does it work?** The command and the numbers, not a restatement.
- **No regression?** The full suite, now, compared to before.
- **Cleanup?** The code-structure checks this command owns (`/branch-review` no
  longer runs them): speculative code, an abstraction for one caller, redundant tests;
  dead code; state ownership (two or more functions assigning the same field — both
  writers named with `file:line`); reuse (a new thing duplicating an existing one);
  changed lines that trace to no request; complexity, naming, duplication when
  material; performance, only with evidence.
- **Glossed over?** Tradeoffs not flagged, claims not tested as shipped, the
  handoff's loose ends — verified, not just repeated.
- **Underspecced?** What should have been part of this work and isn't.

## 4. The bar — Fix now and Later alike

Every item, in **either** pile, needs one concrete failure sentence: specific
input/state → what breaks. **Carve-out:** a Cleanup item may give the rule it
breaks plus the `file:line`(s) that prove it instead — and goes in **Later**, never
**Fix now**, unless it does carry a real failure sentence. Later is not a lower bar — it's a deferral, not an
excuse to skip the sentence. "Will mislead the next reader" is a real example
that got through in the field and shouldn't have: no input named, no state
named, no break named. Can't write the sentence → it's a nit-of-a-nit: dropped,
and only the count (`dropped: N`) is reported, so the user can see it looked
rather than skipped.

Each item is exactly one kind (failure-sentence or Cleanup), counted in one cap only.
Surviving items: **max 5 failure-sentence items and max 5 Cleanup items, ranked**,
in two piles — **Fix now** (changes whether you
ship) and **Later**.

---

## 5. Relay as-is, then ledger

**"As-is" means:** same items, same order, same piles, and each item's failure
sentence and cited commands/numbers preserved exactly; the worker's four report
lines (`works:`, `full-suite:`, `underspecced:`, `cleanup:`) are relayed too, and
every relayed item keeps its `nit`/`change`/`idea` tag and its `file:line`. The
two added lines read `<N> items` or `none found: <what was checked>`, so "checked,
found nothing" never looks like "skipped". Rewording to fit the
user's own output style is fine — a field run under a "plain wording" style
correctly kept everything else identical while reflowing the sentences.
Adding, dropping, merging, re-ranking, or weakening an item is **not** "as-is,"
regardless of how it's justified. The orchestrator may add its own
recommendation on top, but only clearly marked as its own, separate from the
worker's items — never blended into them.

The orchestrator relays the worker's report **as-is**, and the user picks what to
fix now.

When it relays the report, the orchestrator appends **every** item, both piles, to
`.claude/remember/fix-ledger.md` right away, in the same format `/branch-review`
writes: tagged `nit` (a refactor-sized fix), `change` (needs a behaviour change or
redesign) or `idea` (Underspecced items: something missing that might be worth
building — an option, not debt). The tag is the size of the fix, not its severity. The
**orchestrator** writes this append, not the worker: the worker's own turn is already
over by then, so the entity present when the ledger entry needs writing is the one
holding the conversation. It then asks which items, if any, to remove; no answer means
they all stay, and removal happens only on the user's explicit say-so naming the items.
Items the user fixes now are not removed by hand — `/refactor`'s next revalidation
drops them once the finding no longer holds. The bullet shape is inlined in the spec,
and a stale ledger header (no `idea` definition) is replaced with `/branch-review`'s
current one, bullets untouched — `/branch-review` applies the same rule.

**Anchor rule.** A bullet needs a verbatim snippet `grep -F` can still find. For
something *missing* (usually an `idea`), that's the existing line where it should go. No line can be
named → it doesn't go in the ledger at all — `/refactor` deletes any bullet whose
anchor has no hit, so an anchor-less one would just die there — and it stays in the
report instead as "this is a feature — your call."

## 6. Consuming the tags

`/branch-review`'s closing line and `/refactor`'s ledger-mode report both count the
same file the same way: every bullet ending `· change` is a `change`, every one ending
`· idea` is an `idea`, everything else is a `nit` — **N nits, K changes, I ideas**.
`/refactor` (no arguments) fixes surviving `nit` bullets only; `change` and `idea`
bullets are listed, and the orchestrator asks the user per item: keep, drop, or spec it
(its own task on its own branch after the run). A `nit` that turns out to need a
behaviour change is retagged `change` in place.

## 7. Loop guard

Re-run `/self-review` after fixes until zero **Fix now** items remain — **Later** items
never count toward that, and fixing a Later item anyway is just new uncommitted work
the next run checks like any other, not a reason to re-run. If a third round
still turns up new Fix-now items *caused by
the previous round's own fix*, stop: "redesign, don't patch again," instead of
patching a fourth time.

---

## Worked example

The first real run of `/self-review` on this toolkit's own catalog-count sweep is why
the questions exist: an earlier pass had already swept every *digit* count (13 →
14) across READMEs and kit configs, and reported done. `/self-review`'s worker re-ran the
diff and grepped for count language a digit-only sweep can't see — and found
`packages/claude/CLAUDE.md` still saying **"The nine that are deliberate actions"**,
spelled as a word, one line the earlier pass's search had no way to catch. One
concrete failure sentence, one `grep`, caught by *running* the check rather than
re-asserting the sweep was complete.
