---
description: Mechanical pre-deploy gate — tests, build, tree state
---
Mechanical pre-deploy / pre-merge gate. Every item here is answerable by
**running a command** and reading its exit code — no code judgment. Code
judgment belongs to `/branch-review` (which runs `/security` in full as its
second stage); this gate does not duplicate it.

**Detect the stack first** (look for `package.json`,
`pyproject.toml`/`setup.cfg`, `go.mod`, `Cargo.toml`, `Makefile`) and run only
the checks that actually exist — never assume a script (`lint`, `build`,
`migrate`) is present.

## Evidence rule
Report each item as **pass / fail / N/A**, and record **the exact command and
its exit code**. A check you did not run is a **fail**, never a pass. **N/A
requires a stated reason** ("no build script in `package.json`") — N/A must
never stand in for "didn't get to it."

**Capture the exit code of the command itself, never of a pipeline.** Run the
bare command, then read `$?` on the next line:

```
node "$f" > /tmp/out 2>&1; e=$?
```

`$?` after a pipe is the *last element's* status, so the common shape
`out=$(cmd 2>&1 | tail -1); echo "exit=$?"` reports `tail`'s success — `0` —
for a suite that exited `2`. Reproduced: a check printing "exit 2:
prerequisites missing" was recorded as a pass by exactly that loop. Nor does
`${PIPESTATUS[0]}` rescue it inside a command substitution; it is empty by
the time you read it. This is the rule the whole gate rests on, and the
piped form is the natural way to write a multi-suite loop, so it fails
silently and in the unsafe direction.

## Checklist
- [ ] **Tests pass** — run the project's real test command (`npm test`,
      `pytest`, `go test ./...`, `cargo test`, `make test`).
- [ ] **Lint / format clean** — only if a linter or formatter is configured.
- [ ] **Build succeeds** — only if the project has a build step.
- [ ] **No debug leftovers** — stray `console.log` / `print` / `debugger` /
      `dbg!` / commented-out blocks / blocker `TODO`s in the changed files.
- [ ] **No hardcoded secrets** — grep the diff for keys, tokens, credentials;
      confirm `.env` is gitignored and only a value-less `.env.example` is
      tracked. *This is the one check `/security` also makes, kept
      deliberately: it is a grep with a binary answer, and a leaked key is the
      one failure worth catching twice.*
- [ ] **Migrations ready** — only if the project has a schema / migrations:
      they apply cleanly and are ordered.
- [ ] **Docs & config in sync** — `.env.example`, README, and any PRD /
      context doc updated for new config or new usage.
- [ ] **Clean tree, correct branch, in sync with `origin`** — and never on
      `main`.

Report: **Ready 🚀** or **Blocked 🛑** with the specific failing items and the
command output that proves each one.
