---
name: refactor
description: Refactor [code]
usage: /refactor <code-section> | /refactor (no args = fix-ledger mode)
argument-hint: [file-or-function, or empty for the fix ledger]
allowed-tools: Read, Edit, Grep, Glob, Bash(npm test:*), Bash(npx jest:*), Bash(npx vitest:*), Bash(pnpm test:*), Bash(yarn test:*), Bash(pytest:*), Bash(python:*), Bash(go test:*), Bash(cargo test:*), Bash(make test:*), Bash(git diff:*), Bash(git grep:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git switch:*)
---
Refactor $ARGUMENTS.

## Ledger mode — `$ARGUMENTS` empty
Work through `.claude/remember/fix-ledger.md`, the non-blocking findings
`/branch-review` has accumulated. Everything below (goals, constraints,
verification, HITL gates) still applies; this section only says what to
refactor and how to close each item.

1. **Tree must be clean and not on `main`.** `git status --porcelain` non-empty
   → stop, say what is uncommitted. On `main` → `git switch -c chore/fix-ledger`.
2. **Ledger missing or has zero bullets** → say so and stop. Nothing to do.
3. **Revalidate every bullet first, fix nothing yet.** For each: `git grep -F
   "<snippet>" -- <path>`. **No hit → delete the bullet** and list it as
   "cleaned by other work". Hit → re-read the surrounding code; if the finding
   no longer holds, delete the bullet with a one-line reason. What survives is
   the work list.
4. **Fix the survivors, one bullet per change**, under the constraints below.
   Delete each bullet as its fix lands. A fix that turns out to need a
   behaviour change is not a refactor — leave the bullet, note it in the report.
5. Run the tests as described below. Then report: **fixed / dropped / left**
   with the reason per left item, and the remaining bullet count.
6. Say plainly: **commit, then run `/branch-review`** on this branch — ledger
   mode is a fixer, not a review, and its diff gets the ordinary gate.

## Goals
- Reduce complexity
- Improve readability
- Apply DRY
- Better naming
- Smaller functions (single responsibility)

## Constraints
- **NO behavior changes**
- Keep public API intact
- Existing tests must pass

Explain each change.

## After the refactor — verify it didn't break anything

"Existing tests must pass" is the load-bearing constraint, and the only
honest way to know is to run them.

1. **Detect the project's test command** (look for `package.json`
   scripts, `pytest.ini` / `pyproject.toml`, `go.mod`, `Cargo.toml`,
   `Makefile`). If none is found, **stop and ask** before claiming the
   refactor is done — silent green isn't acceptable.
2. **Run the tests.** Scope to the affected area when possible (`-t`,
   `--testPathPattern`, `pytest path/`, `go test ./pkg`); otherwise run
   the suite.
3. **Report** pass / fail counts and any failure's name + `file:line`.

**Stop and ask** when (HITL gates — not all the time, only here):
- a test **fails** after the refactor. Don't auto-revert (destroys
  work-in-progress) and don't push forward (the no-behavior-change
  constraint is broken). Present the failure and the options:
  **revert**, **patch the refactor**, or **update the test** (with
  reasoning).
- the refactor crossed a **public API boundary** that callers depend
  on — even if tests pass, downstream consumers may break.
- the change is **bigger than the user asked for** (scope creep —
  unrelated cleanups, formatting, comment edits). Confirm before
  applying.

Final report:
- **refactor done, tests N pass / 0 fail** — ready, OR
- **refactor done, but K tests fail** — awaiting direction (revert /
  patch / update test).
