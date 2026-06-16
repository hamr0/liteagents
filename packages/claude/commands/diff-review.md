---
name: diff-review
description: Review diff [file, branch, or range]
usage: /diff-review
argument-hint: [file, branch (e.g. main), range (main..HEAD), or empty]
allowed-tools: Read, Edit, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(git grep:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(rg:*)
---
Review $ARGUMENTS. Interpret in this order:
1. **Empty** → staged diff (`git diff --staged`); if empty, working-tree diff
   (`git diff`).
2. **A range** like `main..HEAD` or `origin/main...HEAD` → `git diff <range>`.
3. **A single ref** (branch / tag / SHA — confirm with `git rev-parse
   --verify`) → diff that ref's merge-base against `HEAD` (i.e. everything on
   the current branch since it diverged: `git diff $(git merge-base <ref>
   HEAD)..HEAD`). This is the common "review my branch before merging" path.
4. **A file or directory path** → that target.
5. Otherwise → ask.

The diff is the subject; widen to surrounding code only as needed to judge a
hunk. For multi-commit ranges, also skim `git log <range>` to understand
intent before judging.

## Check For
- **Bugs needing a fix.** Logic errors, off-by-one, null/undefined paths,
  races, wrong defaults, broken edge cases. Concrete failure modes only — not
  vibes.
- **Dead code.** Unreferenced functions / vars / imports / params, unreachable
  branches, commented-out blocks, legacy paths the diff just obsoleted.
  `git grep` the symbol before flagging — easy to be wrong.
- **Loose ends.** TODO / FIXME / XXX added by this diff, half-finished
  branches, silently swallowed errors, stub bodies, mocked-out paths,
  "temporary" names, abandoned feature flags.
- **Correctness.** Edge cases, error handling, type / contract violations,
  broken invariants.
- **Security.** OWASP Top 10, auth, data exposure. (`/security` for depth.)
- **Performance.** N+1, blocking calls in hot paths, unbounded loops, indexes
  the diff actually touches.
- **Maintainability.** Complexity, naming, duplication — only when material.

## Output Format
### 🚨 Critical (blocks merge)
### ⚠️ Warnings (should fix)
### 💡 Suggestions (nice to have)

Each finding: **Location** (`file:line`), **What's wrong**, **Why it matters**,
**Concrete fix** — not "consider improving".

## After the review — verify, then fix

Findings are claims, not facts. Validate before acting; validate again after.

**Verify each claim.** Re-read the cited `file:line` in context. For
dead-code or unused-symbol claims, `git grep` the name across the repo before
trusting it. Mark each **confirmed**, **false positive** (with reason), or
**uncertain**.

**Fix what's confirmed and unambiguous** — minimal shape, one obvious way, no
change to a public API / response / caller contract. Apply directly. After
each edit, re-read the changed region and confirm it does what you intended
without breaking nearby logic. A fix isn't done until you've grounded it the
same way you grounded the claim.

**Stop and ask** when any of these hold (HITL gates — not all the time, only
here):
- the finding is **uncertain** after grounding,
- the fix has **multiple reasonable shapes** (e.g. delete-vs-keep-behind-flag,
  extract-vs-inline, patch-vs-rewrite) — present options with tradeoffs, not a
  chosen path,
- it **affects downstream** (signatures, response shape, schema, any caller
  contract) or removes a public/exported symbol, or
- the "dead code" looks intentionally kept (stub for upcoming work, framework
  hook, documented extension point) — confirm before deleting.

Final report: **confirmed-and-fixed** · **confirmed-but-asking** (why +
options) · **false-positive** (why) · **uncertain** (what's needed to decide).

End with a one-line verdict: **Ready to merge? Yes / No / With fixes** — and
the reason in a sentence.
