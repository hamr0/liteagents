# AI Agent Collaboration Guide

## Table of Contents
1. [Operating Flow](#operating-flow)
2. [Communication Protocol](#communication-protocol)
3. [Development Standards](#development-standards)
4. [Testing Standards](#testing-standards)
5. [Security & Robustness Invariants](#security--robustness-invariants)
6. [Environment](#environment)
7. [Development Workflow](#development-workflow)
8. [Twelve-Factor Checklist](#twelve-factor-checklist)
9. [CLAUDE.md Stub](#claudemd-stub)

---

## Operating Flow

Every task runs through three layers. Do not skip ahead to code.

1. **Spec — the interview must happen; its shape is yours.** Before touching anything, surface the *decision I'm actually making*, not the literal task I typed. Ask what you need to know — no more; how you ask is your call. Restate what you heard and get my explicit sign-off on the load-bearing decisions *before* you execute. A wrong assumption caught here costs a sentence; caught after building costs the build.

   Write the outcome down as a **PRD**. A PRD is a portal, not a deliverable — where the conversation starts and the doc every POC refines. Minimum content, whatever the form:
   - **Problem & goal** — what we're solving and why now
   - **Go / no-go** — the 1–2 capabilities the product stands or falls on; usually module 0's riskiest assumption (e.g. "can a phone camera read the ID?"). Fails → stop
   - **Out of scope** — what we're explicitly not doing
   - **Modules** — the pieces to build, in order (see [*One module at a time*](#validate-before-you-build))
   - **Open questions** — unknowns that don't block; never silently assumed

   Every POC result updates the PRD; one that flips the go/no-go or a module's assumption is a spec change, not a footnote.
2. **Verify — define "good" up front, then prove it.** Write down what success looks like *before* changing code. Prove with measurement and tests, not assertion (see [*Prove, don't assert*](#validate-before-you-build)). When the work is done, propose `/branch-review` — a general review plus a full `/security` audit, which reports findings and never fixes them — and then `/release`, which runs `/ship` as the mechanical pre-deploy gate. You never merge or release on your own (see [Required Safeguards](#required-safeguards-always--ask--never)). External signal — a real test run, a real deploy, a gold-standard reference — beats a confident paragraph every time.
3. **Environment — the standing context.** This file primes every session. Critical-path protections (secrets, auth, schema, CI) are stated as **Always / Ask / Never** below and bind you as written. Where your tool offers a permission allow/ask/deny list, mirror them there so they are enforced and not merely requested.

**Execution order — work the way a program runs, in this order, nothing skipped:**
1. **Sequence** — do the PRD's modules in the order listed; never start module N+1 while module N is unproven.
2. **Selection** — every POC is a branch: pass → next module, fail → back to the PRD as a spec change.
3. **Iteration** — repeat POC → update PRD → next POC until the go/no-go is answered; the loop invariant is *everything built so far still works on its own*.
4. **Verify** — assert before you move: a step is done when you ran the proof and saw it pass, not when you wrote that it did.

> The model is brilliant at execution and blind to intent. You can outsource the typing; you cannot outsource the understanding. Surface assumptions — don't bury them.

---

## Communication Protocol

### Core Rules
- **Spec first, then checkpoint**: see [Operating Flow §1](#operating-flow). Never run ahead on an unverified assumption — flag it and stop
- **Fact-Based**: Base all recommendations on verified, current information. Prefer external signal (a real run, a real source) over a confident guess
- **Simplicity Advocate**: Call out overcomplications and suggest simpler alternatives

### User Profile
- **Technical Level**: Non-coder but technically savvy
- **Learning Style**: Understands concepts, needs executable instructions
- **Expects**: Step-by-step guidance, ready-to-run commands, and the *why* behind each recommendation
- **Comfortable with**: Command-line operations and scripts
- **Builds a lot of web apps** — assume any UI work will be consumed on phones as well as desktop

### Required Safeguards (Always / Ask / Never)

Not courtesies. These bind you as written, whether or not your tool enforces them.

- **Always** identify affected files before making changes, and explain what will change and why
- **Ask first** — stop and get explicit sign-off — before modifying authentication systems, database schema or migrations, CI workflows, or `.claude/settings.json`
- **Never** write secrets into the tree (`.env`/`*.env`, keys, credentials). They load from the environment at runtime; only a value-less `.env.example` is committed
- **Never** commit to `main`. Commit to a new branch (name doesn't matter), then propose `/branch-review` followed by `/release`; merging and releasing are my call, made by name — "approve", "good", or "go" on a draft is not that call

---

## Development Standards

### Validate Before You Build

- **POC everything first.** Before committing to a design, build a quick proof-of-concept (~15 min) that validates the core logic. Keep it stupidly simple — manual steps are fine, hardcoded values are fine, no tests needed yet
- **Graduation criteria:** POC validates logic and covers most common scenarios → stop, design properly, then build with structure, tests, and error handling. Never ship the POC — rewrite it
- **Aim the POC at the load-bearing claim — not the easy part.** Cover the happy path and 2-3 common edges, but name the riskiest assumption first (does the cheap path actually run cheap? does the library really do X? does the perf hold?), then point the spike straight at *that*. A POC that confirms the happy-path shape while hand-waving the risky mechanism is theater. If you catch yourself writing "production would do X" instead of *doing* X in the spike, the POC has not validated X — go do X
- **Prove, don't assert — a POC's output is evidence you ran, not prose you wrote.** Every claim the design rests on must be something the spike actually exercised and you actually observed. **Measure anything you call "cheap," "fast," "constant," or "negligible"** — never state a cost you didn't time; a guessed number is a bug with a confident voice. State conclusions only at the confidence the evidence supports: if you didn't test it, say so plainly instead of rounding up to "it works." Better a small honest finding than a big-mouthed claim that measurement later falsifies
- **The test must be able to FAIL — pre-flight check, not an afterthought.** Before trusting a POC's numbers, confirm three things: **(1) Can the test produce the negative?** A fixture you authored to contain the phenomenon you're testing can only confirm it — prefer real, uncrafted data over synthetic inputs; if synthetic is unavoidable, construct it so it *could* show no effect. **(2) Is the harness free of confounds?** A surprising or degenerate result is often an artifact of the setup, not a real finding — when output looks wrong, debug the test before believing it. **(3) Did the test actually exercise the variable?** If two conditions that should differ produce identical output, the variable isn't wired in — that's a finding, not noise. Run this checklist every time, especially when a result confirms what you hoped
- **One module at a time.** Build the PRD's modules in order, never several at once. Each module gets its own POC aimed at *its* riskiest assumption (module 0's is the go/no-go). A module is done when **(1)** it works on its own and **(2)** it connects to what's already built and the whole still works — both proven, not assumed. Only then start the next
- **No fitting to pass.** Never narrow the input, move the threshold, or shrink the scope until a POC goes green. Report the failure and take it back to the PRD

### Dependency Hierarchy

Always exhaust the simpler option before reaching for the next:

1. **Vanilla language** — Write it yourself using only language primitives. If it's <50 lines and not security-critical, this is the answer
2. **Standard library** — Use built-in modules (`os`, `json`, `pathlib`, `http`, `fs`, `crypto`). The stdlib is tested, maintained, and has zero supply chain risk
3. **External library** — Only when both vanilla and stdlib are insufficient. Must pass the checklist below

### External Dependency Checklist

Before adding any external dependency, all of these must be true:
- **Necessity:** Can't reasonably implement this with stdlib in <100 lines
- **Maintained:** Active commits in the last 6 months, responsive maintainer
- **Lightweight:** Few transitive dependencies (check the dep tree, not just the top-level)
- **Established:** Widely used, not a single-maintainer hobby project for production-critical code
- **Security-aware:** For security-critical domains (crypto, auth, sanitization, parsing untrusted input), a vetted library is *required* — never roll your own

### Language Selection

- **Use widely-adopted languages only** — Python, JavaScript/TypeScript, Go, Rust. No niche languages unless the domain demands it
- **Pick the lightest language that fits the domain:** shell scripts for automation, Python for data/backend/CLI, TypeScript for web, Go for systems/infra, Rust for performance-critical
- **Minimize the polyglot tax.** Every language in the stack adds CI config, tooling, and onboarding friction. Do not add a new language for one microservice — use what's already in the stack unless there's a compelling reason
- **Vanilla over frameworks.** Express over NestJS, Flask over Django, unless the project genuinely needs the framework's structure. Structure can always be added later; removing a framework is painful

### Build Rules

- **Open-source only.** Always use open-source solutions. No vendor lock-in
- **Lightweight over complex.** If two solutions solve the same problem, use the one with fewer moving parts, fewer dependencies, and less configuration
- **Every line earns its place.** If you can't say what breaks when it's deleted, delete it. No speculative code, no "might need this later", no abstractions for one use case. One function, one concern, one owner — small blocks beat spaghetti
- **Simple > clever.** Readable code that a junior can follow beats elegant code that requires a PhD to debug
- **One writer per piece of state.** One function assigns each field; everything else calls it. Grep who writes it before you write it. Ownership says *where*, not *when* — if a write can land from a callback, thread, or lifecycle, the reader must tell stale from fresh
- **Split the decision from the machinery.** A branch whose outcome matters, tangled with a framework, IO, or UI object, moves into a pure function; the framework class applies the result. Extract to pin a branch, not to raise coverage — a one-line delegation in its own file buys a test that cannot fail
- **Claims in comments must be checkable.** "The only place that writes X" is a claim — run the grep first, and expect the next reader to re-run it. A name search proves an edge exists, never that one doesn't
- **Containerize only when necessary.** Start with a virtualenv or bare metal. Docker adds value for deployment parity and isolation — not for running a script
- **Responsive web UI is mandatory in dev projects.** Any web UI must be usable on mobile by default — fluid layouts, viewport meta tag, breakpoints for narrow screens, no horizontal scroll. Test in DevTools device emulation before declaring a UI task done. POCs are exempt (validate the idea first), but the moment a POC graduates to a real project this becomes a hard requirement
- **Surgical changes only.** Touch what the task requires; nothing else. Don't "improve" adjacent code, comments, or formatting. Match existing style even if you'd do it differently. Only clean up orphans your own change created. Dead code, nits, bugs you pass on the way: if it's inside or affects the code you're already changing, and the fix changes no behavior, fix it and say so. Otherwise report it — say what it costs to leave it. "It would be nicer" is not a cost. Every changed line traces to the request or to a fix you named

### Red Flags — Stop and Flag These
- Over-engineering simple problems
- Adding external dependencies for trivial operations
- Frameworks where a library or stdlib would suffice
- Vendor-specific implementations when open alternatives exist
- Skipping POC validation for unproven ideas
- POC-ing only the easy part while hand-waving the risky mechanism, or claiming a cost ("cheap"/"fast"/"constant") you never measured
- Authoring a fixture/corpus that *guarantees* the result (a test that can't return the negative), or trusting a degenerate-looking number without auditing the harness for confounds — use real uncrafted data; the test must be able to fail
- Fitting a POC to pass (narrowed input, moved threshold, shrunk scope) instead of reporting the failure; starting module N+1 while module N is unproven

A problem you see and don't fix goes in the report, never in a comment. Comments are where findings go to be forgotten.

---

## Testing Standards

Principles, not a framework. Whatever the language, follow its ecosystem's conventions for
runner, layout and fixtures — these rules govern what a test must *do*, never how a
particular toolchain spells it.

### What a test is for

**Test behavior, not implementation.** A suite must give you confidence to refactor freely. If changing internal code without changing behavior breaks tests, those tests are liabilities, not assets.

**Shape — the Testing Trophy, not the Pyramid:** static analysis catches the cheapest bugs; few unit tests, for pure logic and algorithms; many integration tests, the sweet spot, real components working together; some end-to-end tests over the critical journeys. Target roughly 20% unit, 60% integration, 15% E2E, 5% manual.

### When to write them

- **After the design stabilizes, not during exploration.** Do not test a prototype — you will write tests for code you delete tomorrow. First make it work (POC), then make it right (tests), then make it fast
- **Tests first when you already know the contract.** Pure functions, algorithms, parsers, validators, data transformations — write the test, watch it fail, then implement. When you are still discovering the interface, that same discipline produces churn and false confidence
- **Write tests for bugs.** Every fix ships a regression test that fails before the fix and passes after — the highest-value test there is
- **Write tests before refactoring.** Characterization tests lock in current behavior first, then change the code
- **Write tests when the code has users.** Called by other modules or exposed externally means it needs tests; a helper serving one caller does not need its own file
- **Do not test glue code.** Something that only wires A to B to C is covered at the integration level

### What makes a good test

- **Tests real behavior.** Call the public interface, assert on observable output. Never reach into internals
- **Fails for the right reason.** It breaks when the feature breaks, not when the implementation moves
- **Reads like a spec.** Someone new to the code should learn what the feature does by reading it
- **Self-contained.** Sets up its own state, runs, cleans up. No ordering dependencies, and no reliance on project directories, user config, or ambient environment
- **Deterministic.** Flaky tests erode trust. A dependency on timing, network, or global state is a defect in the test
- **Never sleep for a condition — poll for it.** Sleeping then asserting is wrong at every value: too short and it flakes under load, too long and the suite drags, and a real async bug looks identical to a guess that was too short. Wait on the condition itself, re-reading the state *inside* the loop, with a timeout that names what it was waiting for. A fixed delay is only correct once you have waited for the triggering condition, the delay comes from a documented interval rather than a guess, and a comment says why

### Anti-patterns

- **Mocking most of the test.** If mock setup outweighs the logic, you are testing mocks. Prefer the real thing against a temporary directory, an in-memory store, or a disposable container
- **Partial mocks.** Mirror the complete structure the real thing returns, not only the fields this test reads. A mock missing a field downstream code consumes passes here and fails in production
- **Smoke tests.** Asserting a result merely exists proves nothing. Assert on specific values, structure, or side effects
- **Testing private internals.** If it needs its own test, it should be part of the public interface; otherwise the public tests should reach it
- **Mirroring implementation.** A test that restates the source line by line breaks on every refactor and catches nothing
- **Test-only production code.** Never add a method, flag, or branch to production solely for tests. Inject the dependency instead
- **Chasing a coverage number.** 80% of meaningless tests is worse than 40% of behavioural ones. Coverage tells you what is *not* tested, never that what is covered is correct. Cover the critical path first — data, auth, money, core logic — before helpers

### Organization

- **Mirror the source structure**, at whatever level the ecosystem puts tests. One test file per module, not per function, and never a second file covering a module that already has one
- **Separate by cost so CI gets a fast signal.** Keep quick isolated tests apart from ones needing real IO or a full workflow, and let the slow ones — long runtimes, heavy optional dependencies, live external APIs — be excluded from the gate that runs on every push and included in the full run
- **Fixtures live near what uses them**, shared upward only when genuinely shared. Build test data with factories or builders, never a constructor taking fifteen positional arguments
- **Delete tests that never catch anything.** A test that has only ever failed during refactors is a maintenance cost, not a safety net

---

## Security & Robustness Invariants

These are the failure classes that show up in nearly every quickly-built app, regardless of stack or language. Treat them as **build-time invariants** — satisfy them as you write the code, not as a cleanup pass. Apply each where it fits the thing you're building (a library has no endpoints; a CLI has no tenant isolation) — skip what genuinely doesn't apply, never skip what does.

Throwaway POCs are exempt while you validate logic (per **POC first** above) — hardcoded values and missing error handling are fine in a 15-minute spike. The moment a POC graduates to a real build, every applicable invariant becomes mandatory. The one item that holds even for a POC: never commit a real secret.

1. **No secrets in the repo.** Keys, tokens, and credentials load from the environment / a secret store at runtime — never hardcoded, never logged. `.env` is gitignored; only a value-less `.env.example` is committed. Scan history before trusting a repo. One leaked key is a breached database or a runaway bill.
2. **Scope every data access to its owner.** Each record read or written is constrained to the requesting principal — via DB-level rules (RLS / row policies) and/or an application-layer ownership check. Never trust a client-supplied id without a gate. If the storage layer offers row-level policies, enabling them is not optional, and "on but too broad" still fails.
3. **Bound every reachable endpoint.** Rate-limit public routes AND authenticated mutation/write routes AND abuse-prone inbound paths (mail, webhooks). An unbounded route is a free DoS and bill amplifier — a script in a loop should not be able to take the service down.
4. **Handle the unhappy path.** Every IO / network / DB / third-party call has an explicit failure path. Nothing fails silently. Internal detail (stack traces, queries, secrets) never reaches the client. Async/background work carries its own catch.
5. **Authorization is not authentication.** "Logged in" never implies "allowed". Every state-changing or privileged action checks ownership AND role/permission. If swapping an id in a request would expose or mutate someone else's data, it's a bug — return 403.
6. **Data access scales.** No queries inside loops, no per-render repeated round-trips, indexes on every filtered/joined column. Code that's fine at 10 users and collapses at 1,000 is a latent outage.

Also hold the line on: input validation at every trust boundary (untrusted uploads, inbound mail, webhooks, and spoofable headers like `X-Forwarded-For` — trust them only behind a vetted proxy); parameterized queries (never string-built SQL); vetted libraries for crypto / auth / sanitization (never roll your own); and least-privilege binding (loopback, not `0.0.0.0`, unless the port is deliberately public).

**Verify at two moments, not one.**
- **While building** — this list shapes the code as it's written.
- **Before deploy/merge** — run **`/branch-review`**, whose second stage runs **`/security`** in full; `/release` then runs **`/ship`** as the mechanical pre-deploy gate. A Critical/High finding blocks the ship; lower-severity findings get logged and triaged, not silently shipped. Proactively remind the user to run them whenever a change touches auth, data access, endpoints, secrets, or untrusted input.

---

## Environment

- **OS**: Fedora Linux (use `dnf` for packages, `systemctl` for services)
- **Testing**: pytest (Python), Jest/Vitest (JS/TS), Playwright (browser automation)

---

## Development Workflow

### Environments
- **Development**: Local machines
- **Staging**: VPS with isolated database
- **Production**: VPS with containerized setup

### Deployment Strategy

**Simple Projects:** `Local → GitHub → VPS (direct deployment)`

**Complex Projects:** `Local → GitHub → GHCR → VPS (containerized)`

---

## Twelve-Factor Checklist

The [Twelve-Factor App](https://12factor.net) methodology for modern, scalable applications:

| # | Factor | Rule |
|---|--------|------|
| 1 | Codebase | One repo per app, multiple deploys from same codebase |
| 2 | Dependencies | Explicitly declare and isolate all dependencies |
| 3 | Config | Store config in environment variables, never in code |
| 4 | Backing Services | Treat databases, caches, queues as attached resources |
| 5 | Build, Release, Run | Strict separation between build, release, and run stages |
| 6 | Processes | Run as stateless processes, persist state externally |
| 7 | Port Binding | Apps are self-contained, export services via port binding |
| 8 | Concurrency | Scale out via the process model, not bigger instances |
| 9 | Disposability | Fast startup, graceful shutdown, idempotent operations |
| 10 | Dev/Prod Parity | Keep dev, staging, and production as similar as possible |
| 11 | Logs | Treat logs as event streams to stdout |
| 12 | Admin Processes | Run admin/maintenance tasks as one-off processes |

---

## CLAUDE.md Stub

Copy this to any project's CLAUDE.md. These are mandatory rules, not suggestions.

```markdown
## Dev Rules

**Spec first.** Interview to find the decision, not the task; write a PRD with problem/goal, go/no-go, out-of-scope, modules, open questions. POCs refine it.

**POC first, one module at a time.** Each module's POC targets its riskiest assumption (module 0 = go/no-go); the test must be able to fail; prove, don't assert — measure anything you call cheap/fast/constant. No fitting to pass. A module works on its own, then connects to what's built, before the next starts. Never ship the POC.

**Dependency hierarchy — follow strictly:** vanilla language → standard library → external (only when stdlib can't do it in <100 lines). External deps must be maintained, lightweight, and widely adopted. Exception: always use vetted libraries for security-critical code (crypto, auth, sanitization).

**Lightweight over complex.** Fewer moving parts, fewer deps, less config. Express over NestJS, Flask over Django, unless the project genuinely needs the framework. Simple > clever. Readable > elegant.

**Open-source only.** No vendor lock-in. Every line of code earns its place — if you can't say what breaks when it's deleted, delete it. No speculative code, no premature abstractions.

**One writer per piece of state.** One function assigns each field; everything else calls it. Grep who writes it before you write it — and if a write can land from a callback, thread, or lifecycle, the reader must tell stale from fresh.

**Surgical changes only.** Touch what the task requires. Dead code, nits, bugs you pass: if it's inside or affects the code you're already changing and the fix changes no behavior, fix it and say so — otherwise report it and say what it costs to leave it. A problem you don't fix goes in the report, never in a comment.

**Responsive web UI is mandatory.** Any web UI must work on mobile by default — fluid layouts, viewport meta, breakpoints, no horizontal scroll. Verify in DevTools device emulation before claiming a UI task is done. POCs exempt; real projects are not.

For full development and testing standards, see `.claude/remember/AGENT_RULES.md`.
```
