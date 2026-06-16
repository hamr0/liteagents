---
name: test-generate
description: Generate and run tests [file]
usage: /test-generate <file>
argument-hint: [file or symbol to test]
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(npm test *), Bash(npx jest *), Bash(npx vitest *), Bash(pnpm test *), Bash(yarn test *), Bash(pytest *), Bash(python *), Bash(go test *), Bash(cargo test *), Bash(make test *)
---
Generate tests for $ARGUMENTS, then run them. This is a generate → run →
verify loop, not just file generation.

## 1. Discover
- Detect the test framework already in use (look for `jest.config*`,
  `vitest.config*`, `pytest.ini` / `pyproject.toml [tool.pytest]`, Go's
  `_test.go` convention, `Cargo.toml [dev-dependencies]`, etc.). **Never
  add a new framework or runner.**
- Skim 1–2 existing test files near the target to mirror style, fixtures,
  setup/teardown, assertion style, and naming convention.

## 2. Generate
Cover:
- **Happy path** (expected usage)
- **Edges** (empty / null / boundary / malformed)
- **Errors** (invalid input, IO / network / DB failures)

Match existing patterns:
- Same framework, same fixture style, same naming convention.
- Reuse existing setup/teardown helpers; do **not** add new mock libraries
  or new test-runner config.
- Do **not** add test-only public methods or exports to production code to
  make a test possible — if the test wants a hook the prod code doesn't
  expose, stop and ask (`test-traps` territory).

## 3. Run
Execute the project's real test command, scoped to just the new tests
(`-t <name>`, `--testPathPattern`, `pytest path/to/test.py`, `go test
./pkg`, etc.). Report:
- Pass / fail counts.
- Any failure with the assertion message and `file:line`.

## 4. Verify the tests BITE
A test that passes is not the same as a test that **exercises** the code.
For each new test, confirm:
- It would fail if the function under test returned the wrong value.
  Mentally swap a broken impl — does the assertion actually catch it?
- It isn't `expect(true).toBe(true)`, `expect(fn).toBeDefined()`, or a
  mock asserting itself.
- It isn't passing only because the setup masked the real call.

Mark each new test **biting** or **superficial** (with reason).
Superficial tests count as a failure to ship — either fix or delete.

## 5. Report
- Files added / modified.
- Pass / fail.
- Biting vs superficial breakdown.
- What was deliberately **not** tested, and why (third-party shims,
  trivial getters/setters, generated code). Documented gaps beat fake
  coverage.

**Stop and ask** when:
- A meaningful test would require a non-obvious design change to
  production code (don't pollute prod to make tests pass — present the
  options instead).
- The existing test setup has multiple reasonable patterns and it's
  unclear which to mirror.
- An existing dependency would need to be mocked in a way the project
  doesn't currently do (introducing a new mock style is a design choice).
