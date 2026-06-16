---
name: refactor
description: Refactor [code]
usage: /refactor <code-section>
argument-hint: [file-or-function]
allowed-tools: Read, Edit, Grep, Glob, Bash(npm test *), Bash(npx jest *), Bash(npx vitest *), Bash(pnpm test *), Bash(yarn test *), Bash(pytest *), Bash(python *), Bash(go test *), Bash(cargo test *), Bash(make test *), Bash(git diff *)
---
Refactor $ARGUMENTS.

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
