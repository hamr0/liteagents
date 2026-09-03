# AGENT_RULES freshness — PRD

> Status: DRAFT, not started. Written 2026-09-03 from a design conversation.
> A portal, not a deliverable — every POC below updates this file.

## 1. Problem & goal

`AGENT_RULES.md` is the standing rules doc that primes every session. It ships
inside the npm package at `packages/<kit>/commands/remember/AGENT_RULES.md` (all
four kits, next to `friction.cjs`) and `/remember` bootstraps a copy into each
repo's `.claude/remember/`.

**Nothing ever refreshes that copy.** `remember.md` bootstraps it only if absent
and never overwrites afterwards — deliberately, because the file is one users are
expected to customise. The result, measured 2026-09-03 across the local fleet:

| gap | count |
|---|---|
| stale `AGENT_RULES.md` bodies (`1acd0ee6` vs canonical `ce98678a`) | 35 |
| pre-v2.19 `@`-include stubs (~300 lines hot-loaded per session) | 21 |
| dead `.claude/memory/` pointers | 15 |

Only `liteagents` and `agentic-toolkit` are current. Three hand sweeps have been
done and the drift returned each time, which is the actual signal: a rule
enforced by remembering to sweep is not enforced.

**Goal.** A repo learns it is behind and gets current, without ever silently
destroying a user's own edits, and without a fourth hand sweep.

### Why the obvious fixes don't work

- **A content hash alone can't decide anything.** It proves two files differ; it
  cannot say which is newer, so "differs" is ambiguous between *stale* and
  *customised*. Overwrite on mismatch and you destroy user edits.
- **`npm i -g liteagents@latest` does not fix it.** npm replaces the package in
  the global prefix. `postinstall.js` only prints a message. The repo copy is a
  copy made at bootstrap, not a link — every one of the 35 would still be stale.
- **The installer cannot do it either.** `installer/cli.js` is home-scoped: it
  resolves against `os.homedir()` (`installer/cli.js:124`, `:611`) and never
  calls `process.cwd()`. It installs kits into `~/.claude`, `~/.config/amp` and
  friends, and has no knowledge that the user has 35 repos.

`/remember` is the only component that runs *inside* a repo and already owns
writing this file. The work belongs there.

### Three stages, refreshed independently

| stage | what updates it | backed up? |
|---|---|---|
| the npm package | `npm i -g liteagents@latest` | n/a — package replace |
| `~/.claude/` commands + skills | re-run `liteagents` | yes — installer's own `.backup.<timestamp>` (`installer/cli.js:129`) |
| repo `.claude/remember/AGENT_RULES.md` | **nothing, ever** | no — never written after bootstrap |

Row two already covers command/skill churn; users just re-run the installer.
Row three is the entire drift problem.

## 2. Go / no-go

**The riskiest assumption: unedited-ness is detectable on repos that have no
stamp yet.** Every one of the 35 existing repos predates any stamp this PRD
introduces, so on first run they are all "unknown". If unknown must be treated
as customised, then 100% of the fleet takes the noisy path instead of the
intended ~1%, and the feature ships as an annoyance.

The proposed answer: compare a repo's body against **every AGENT_RULES body ever
shipped**, recoverable from git tags. An exact match with any past release
proves the file is untouched, whatever its age.

**Go if** that historical match clears a large majority of the 35 (target: ≥ 30
of 35 resolve to a known shipped body, leaving ≤ 5 genuinely customised).
**No-go if** a large share match nothing — that would mean the fleet is full of
small local edits, the silent-replace path is unsafe in general, and this PRD
needs rethinking around a diff-and-confirm flow instead.

This is measurable today against real repos, before any code is written. It is
module 0.

## 3. Out of scope

- **Auto-running `npm install`.** `/remember` prints the command; the user runs
  it. Updating the package stays their call.
- **GitHub as the source of AGENT_RULES.** Adds a network dependency, a rate
  limit, and a second source of truth that can disagree with the installed
  package. The installed package is already on disk, already versioned, and
  already what users are told to update.
- **Three-way merge of a customised file.** We do not know which of a user's
  edits matter. We keep theirs and hand them the new one.
- **Refreshing `~/.claude/` commands and skills.** That is the installer's job
  and it already works, with its own backup.
- **A per-file manifest for every installed artifact.** Exactly one file is
  plausibly hand-edited. One stamp, not a manifest.

## 4. Modules

Built in order; module N+1 does not start while N is unproven.

### Module 0 — Measure historical-match coverage (the go/no-go)

Extract every AGENT_RULES body from git tags, hash each, and match the 35 real
repo copies against that set. Output: how many resolve to a known shipped
release, how many match nothing.

Answers the go/no-go. No production code.

### Module 1 — Version check in `/remember` step 0

Compare the installed `liteagents` version against the registry's latest. On a
gap, print one line:

```
liteagents 2.24.1 → 2.25.0 available: npm i -g liteagents@latest && liteagents
```

Constraints, all load-bearing:
- Runs inside the existing crash-isolated step 0 alongside `friction.cjs`.
- Result cached with a ~24h TTL; the common path does no network call.
- **Any failure — timeout, DNS, offline — is a silent skip.** A memory command
  that hangs on a network call is worse than one that misses a nudge.
- Heads-up only. Never writes, never runs the install.

### Module 2 — Stub shape assertion and repair

`/remember` asserts the tool config (`CLAUDE.md` / `AGENTS.md` / `AGENT.md`)
carries the current stub shape, and repairs it when missing:

- `MEMORY.md` `@`-included as `@.claude/remember/MEMORY.md` — a bare
  `@MEMORY.md` resolves to a nonexistent root file and fails silently.
- `AGENT_RULES.md` as a **plain pointer, not an `@`-include** — v2.19 demoted it
  deliberately; an `@`-include hot-loads ~300 lines every session.

This repairs shape, not merely presence, and closes the 21 pre-v2.19 stubs.

### Module 3 — Stamp the bootstrap write

At bootstrap, `/remember` records what it wrote, next to the file it describes:

```
.claude/remember/.agent-rules.json  →  { "version": "2.24.1", "sha": "ce98678a…" }
```

One writer, one piece of state. Not in `MEMORY.md`, not in `ledger.json`.

### Module 4 — The update path

On each run, compare the on-disk body against the stamp:

| state | meaning | action |
|---|---|---|
| sha **matches** stamp | untouched since bootstrap | replace silently with the packaged version; restamp |
| sha **differs** | user customised it | write `AGENT_RULES_NEW.md`; leave theirs untouched; say so loudly at the end of the run |

`AGENT_RULES_NEW.md` is always overwritten, so it cannot accumulate, and is
**never** `@`-included — a stub pointing at it would double hot context every
session for exactly the users who customised.

Nothing is enforced and nothing is destroyed. We do not know which of their
edits matter, so we do not guess.

### Module 5 — Migration for unstamped repos

For a repo with no `.agent-rules.json`, use module 0's shipped-body set: an
exact match with any past release is proof of untouched, so treat it as module
4's match case and stamp it. No match → customised → module 4's `_NEW` path.

Clears most of the 35 without asking anyone anything.

## 5. Open questions

Unknowns that do not block. None is silently assumed.

- **Where the version-check cache lives.** A dotfile under `.claude/remember/`
  is the obvious home, but the check is about a *global* install, so a per-repo
  cache means N repos each make the call. A home-scoped cache is better and
  crosses a boundary `/remember` otherwise respects.
- **A user who folds `_NEW` in and deletes it** gets a fresh `_NEW` on the next
  release, because their merged body matches no shipped sha. Believed correct —
  the file is customised from then on — but it means the 1% see this every
  update. Accepted unless it proves annoying in practice.
- **Whether `_NEW` should be gitignored.** It lives in `.claude/remember/`,
  which is gitignored in some repos and tracked in others. Leaving it visible is
  the current lean.
- **Multi-kit repos.** Module 2's stub check must handle `CLAUDE.md`,
  `AGENTS.md` and `AGENT.md`, and a repo may carry more than one.
- **The 15 dead `.claude/memory/` pointers** are a separate defect from stub
  shape. Whether module 2 also repairs those, or they get their own pass, is
  undecided.
- **Whether the historical-body set should ship in the package.** Module 5 needs
  the hashes of past releases; reading them from git tags works in a checkout
  but not in an arbitrary user repo. Shipping a small list of known-good hashes
  is the likely answer and needs sizing.

## 6. Verification

Success is defined before code, per AGENT_RULES:

- Module 0 answers the go/no-go with a real count over the 35 real repos, not a
  fixture.
- Module 1's failure rule is proven by running `/remember` with the network
  unreachable and observing it complete normally.
- Module 4's two branches are each proven on a real repo: one untouched copy
  silently updated, one customised copy left byte-identical with `_NEW` beside
  it.
- Module 5 is proven by running it against an unstamped repo from the 35 and
  confirming the resulting classification matches what module 0 measured.

A step is done when the proof ran and was seen to pass.
