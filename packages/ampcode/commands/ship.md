---
name: ship
description: Check pre-deployment
usage: /ship
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(npm *), Bash(pnpm *), Bash(yarn *), Bash(pytest *), Bash(python *), Bash(go *), Bash(cargo *), Bash(make *)
---
Pre-deploy / pre-merge gate. **Detect the stack first** (look for
`package.json`, `pyproject.toml`/`setup.cfg`, `go.mod`, `Cargo.toml`,
`Makefile`) and run only the checks that actually exist — never assume a
script (`lint`, `build`, `migrate`) is present. Report each item as
**pass / fail / N/A**.

## Checklist
- [ ] **Tests pass** — run the project's real test command (`npm test`,
      `pytest`, `go test ./...`, `cargo test`, `make test`).
- [ ] **Lint / format clean** — only if a linter or formatter is configured.
- [ ] **Build succeeds** — only if the project has a build step.
- [ ] **No debug leftovers** — stray `console.log` / `print` / `debugger` /
      `dbg!` / commented-out blocks / blocker `TODO`s in the changed files.
- [ ] **No hardcoded secrets** — scan the diff. Secrets load from env / a
      secret store; `.env` is gitignored and only a value-less `.env.example`
      is tracked.
- [ ] **Error handling complete** — every new IO / network / DB call has a
      failure path; nothing fails silently; no internal detail leaks to clients.
- [ ] **Authorization** — new endpoints/actions check **ownership + role**,
      not just authentication (no IDOR via id-swapping).
- [ ] **Rate limiting** — new externally reachable routes, including
      authenticated writes, are bounded.
- [ ] **Data access scoped & scales** — new queries are constrained to the
      requesting principal (no cross-tenant leak) and avoid obvious N+1 /
      unindexed scans on hot paths.
- [ ] **Migrations ready** — only if the project has a schema / migrations.
- [ ] **Docs & config in sync** — `.env.example`, README, and any
      threat-model / PRD updated for new config or new attack surface.
- [ ] **Clean tree, correct branch, in sync with `origin`.**

For any security-sensitive change in the diff, run **`/security`** on the
changed files before shipping.

Report: **Ready 🚀** or **Blocked 🛑** with the specific failing items.
