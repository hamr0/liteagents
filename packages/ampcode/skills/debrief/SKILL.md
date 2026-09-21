---
name: debrief
description: Verify what you delivered before commit — real runs, not re-assertion
allowed-tools: Read, Grep, Glob, Edit, Bash(npm test:*), Bash(npx jest:*), Bash(npx vitest:*), Bash(pnpm test:*), Bash(yarn test:*), Bash(pytest:*), Bash(python:*), Bash(go test:*), Bash(cargo test:*), Bash(make test:*), Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git grep:*)
disable-model-invocation: true
---
Answer "verify what you delivered, what did you gloss over, what did I miss?"
about the work just done — **before** commit, before `/branch-review`. The
author of the work (this session) answers it directly; no subagent. It never
fixes anything — ask and surface only, the user picks.

## Run it for real
Every claim below needs a command you ran **now**, not a restatement of what
you believe already happened.
- **Does it work?** Run the thing, or its tests, now. Paste the command and
  the numbers.
- **No regression?** Run the FULL suite now, paste totals, compare to before
  the change. A claim with no run behind it counts as not checked.
- **Bloat?** Anything added that the task didn't need — speculative code,
  redundant tests, an abstraction for one caller.
- **Glossed over?** Tradeoffs introduced but not flagged, things claimed but
  not tested as shipped, loose ends (a peer session not told, an open
  question left silent), unshipped state (uncommitted / unreviewed /
  unreleased branch).
- **Underspecced?** What should have been part of this work and is missing.
- **Docs?** Which docs now describe something untrue. Surface only — Stage 4
  of `/branch-review` is what writes them.

## The bar
Every item needs one concrete failure sentence: specific input/state → what
breaks. Can't write that sentence → it's a nit-of-a-nit: drop it and report
only the count (`dropped: N`) so the user can see it looked.

## Report
Max 5 items, ranked, in two piles:
- **Fix now** — would change whether you ship.
- **Later** — wouldn't.

The user chooses. Whatever they do **not** choose to fix now goes to
`.amp/remember/fix-ledger.md`, in the exact format `/branch-review` writes
(see that skill), tagged `nit` or `change` — the size of the fix, not its
severity. Dedupe first with plain `grep -F "<snippet>" .amp/remember/fix-ledger.md`
(never `git grep` — the ledger is normally gitignored); already there → skip.

**Anchor rule.** A ledger bullet needs a verbatim snippet `grep -F` can find.
For something *missing*, anchor on the existing line where it should go. If
no line can be named, it does not go in the ledger — `/refactor` deletes a
bullet whose anchor has no hit, so an anchor-less bullet is dead on arrival.
Instead leave it in this report as "this is a feature — your call."

## Loop guard
Re-run `/debrief` after fixes until zero **Fix now** items remain — Later
items never count toward this. If a third round still finds new Fix-now
items *caused by the previous round's own fix*, stop and say: "redesign,
don't patch again," instead of running a fourth round.

## Not a gate
`/branch-review` and `/release` do not require this to have run. Close with:
"commit, then `/branch-review`" — a sentence to **say**, never a sequence to
run yourself.
