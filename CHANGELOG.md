# Changelog

All notable changes to liteagents will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **`/remember` extraction is parallel and model-agnostic.** Step 2's per-stash extraction
  calls are now spawned as concurrent subagent calls instead of one at a time. Every
  hardcoded `sonnet` mention (steps 2, 3, 4a) is replaced with "the mid-tier model" — a new
  Guardrails note explains the intent (capable of semantic judgment, cheaper/faster than
  your top reasoning tier; Sonnet is the Claude example, not a requirement) so the
  instructions work unmodified across Claude/opencode/ampcode/droid regardless of which
  models each tool has configured. Identical across all four packages.

### Planned
- Community marketplace submissions
- Additional skills for data analysis
- Enhanced testing capabilities
- Performance optimizations

---

## [2.14.0] - 2026-07-10

### Added
- **`/remember` bootstraps a standards-guide template.** A new `AGENT_RULES.md` (an AI
  agent collaboration/coding-standards guide) ships bundled next to `friction.js` in all
  four packages. On first `/remember` run in a project, if `<tool-dir>/remember/AGENT_RULES.md`
  doesn't already exist, it's copied from the bundled template — never overwritten again
  after that, so local edits persist. When present, it's injected into CLAUDE.md/AGENTS.md/
  AGENT.md via its own independent marker pair (`<!-- AGENT_RULES:START/END -->`), separate
  from the MEMORY.md block and framed as a guide to consult when building something new —
  not hot context loaded every session. This repo dogfoods it: its own copy moved from
  `.claude/memory/AGENT_RULES.md` to `.claude/remember/AGENT_RULES.md`. Design + pipeline
  walkthrough: `docs/remember-README.md`.

### Docs
- **Antigen-gate PRD (§10):** deferred entry for a local classifier model as a paraphrase-blocking *proposer* between friction's shingle clustering and `/remember`'s LLM merge (LLM always disposes each shortlisted merge). Un-defer condition: offline measurement on the existing candidate corpus shows shingle-missed paraphrase merges would move at least one class across a recurrence tier.

---

## [2.13.0] - 2026-07-08

### Added
- **Antigen ledger (`/remember` step 4c).** Every behavioral rule now carries an evidence trail in `<tool-dir>/remember/ledger.json`: which mistake-class it targets (`class_hints` dedup key), the evidence that promoted it, and every phrasing ever tried (`attempts` — failed attempts are the rejected-edit buffer, never re-proposed). A class that fires again *while its rule is loaded* increments `recurred_while_hot`: at 2 the phrasing is marked failed and rephrased; after 2 failed phrasings the antigen is **ESCALATED** — removed from hot, recorded as a Fact, flagged for a human decision. Failure detection without statistics; instructions-only (no new code), identical across all four packages. Design + the POC evidence that killed the statistical ON/OFF gate (deferred, un-defer condition named): `docs/antigen-gate-prd.md`.
- **`/remember` writes its run report** to `<tool-dir>/remember/report.md` (latest snapshot, overwritten each run).

### Changed
- **Pipeline consolidated to two dirs, each owned by its command:** `<tool-dir>/stash/` (`/stash`) and `<tool-dir>/remember/` (MEMORY.md, ledger.json, report.md, `.processed`, transient `friction/` output). Was three (`stash/`, `friction/`, `memory/`). `/remember` performs a one-time loud migration: pipeline files move, user-owned files in the old `memory/` stay put, stale friction output is discarded (always regenerated fresh). Validated live on this repo's own memory.
- **Claude's bundled dir joins the naming convention:** `packages/claude/commands/friction/` → `commands/remember/` — a command's helper dir is named after the owning command in **all four** packages now (2.12.1 did the other three).
- **docs: `friction-README.md` → `remember-README.md`** — updated for the new layout + ledger, linked from README as the pipeline explainer.

### Fixed
- **Hot memory was silently not loading in Claude Code.** The managed CLAUDE.md section injected a bare `@MEMORY.md`, which resolves relative to the containing file — i.e. a nonexistent root-level file. Now an explicit `@<tool-dir>/remember/MEMORY.md` path in all four packages' injection instructions.
- **`/remember` step 4b tier ambiguity:** LLM-merged antigen groups now explicitly obey the recurrence tiers (merging consolidates evidence, never elevates it) — surfaced by dogfooding the ledger's first live run.

---

## [2.12.1] - 2026-07-07

### Fixed
- **Non-Claude helper dir renamed `friction/` → `remember/`** (opencode, ampcode, droid). These tools expect a command's bundled directory to share the owning command's name; `friction.js` is run by `/remember`, so it now lives in `remember/friction.js` instead of the mismatched `friction/`. `remember.md`'s bundle-path reference updated to match. Claude keeps `friction/` — its command loader has no such naming constraint. `opencode.jsonc` needed no change (its only `friction` mention is a description string, not a path).

---

## [2.12.0] - 2026-07-07

### Changed
- **Friction cluster ranking now breaks ties by intensity.** Antigen/episode clusters were ordered by tier then recurrence, with equal-recurrence ties left to incidental feed order — so a mild reaction could outrank a far more intense one that recurred equally. Added a final tiebreak on median peak friction (a value already computed), so the more intense reaction ranks first. Ranking-only: it reorders within what recurrence already gated and never promotes across the severity × recurrence 2×2 (a loud one-off stays an episode). Applied identically across all four packages.

### Fixed
- **`validate-packages` failed 0/4 valid on every package.** `validatePackage` demanded a `<name>.md` for each selected command, but a command can legitimately ship as a helper subdirectory with no doc — `commands/friction/friction.js`, run by `/remember` after `/friction` was collapsed into it. The installer already bundles such subdirs; validation now matches that instead of requiring a resurrected `friction.md`. No user-facing command is re-added.

---

## [2.11.1] - 2026-07-03

### Changed
- **`/release` merge step now documents the solo-repo path.** Its "stop and ask the user to approve" guard assumed a second reviewer exists — a dead end on a solo repo, where you cannot approve your own PR. Added: the expected path is then an owner-authorized admin-merge (`gh pr merge --admin`), run only on explicit say-so — a sanctioned owner action, not a silent bypass. Mirrored across all four packages + the global copy. Surfaced by dogfooding `/release` on its own v2.11.0 release.

---

## [2.11.0] - 2026-07-03

### Added
- **`/release` — end-to-end feature-delivery orchestrator, added across all four packages.** A thin orchestrator (it delegates, never re-implements): resolves a feature branch (arg → `git switch` to it; on `main` with no arg → creates `feat/<slug>` and carries the work over; otherwise the current branch), then runs `/ship` + `/security` + `/diff-review` under `/verify-done` discipline — reading each sibling command's real checklist so nothing is hand-waved. A hard gate splits the safe/read-only verify half from the irreversible release half (docs → version bump → commit → push → PR → merge → tag), which confirms each step. It **stops before `npm publish`** — `publish.yml` is manual `workflow_dispatch` by design. Counts: claude commands 8→9; droid/opencode/ampcode 17→18.

### Fixed
- **Doc count drift corrected while adding `/release`.** `packages/ampcode/AGENT.md` had mis-filed `live-canvas` (a skill) under its Commands table, leaving Skills at 8 rows beneath a "9 total" header; moved it to Skills so both tables reconcile at 9. README's "Commands/Skills" section still listed a standalone `/friction` bullet (collapsed into `/remember` back in 2.9.0) — removed, and the section total corrected to match "9 skills + 9 commands".

---

## [2.10.0] - 2026-06-16

### Changed
- **`/friction` collapsed into `/remember`; the hot-memory pipeline is now two commands (`/stash → /remember`), down from three.** `/remember` now runs `friction.js` itself as a best-effort first step before consolidating — so the antigen data is always fresh and friction can't be forgotten. Friction targets the tool's **global sessions root** (all projects, since behavioral patterns are cross-project), resolved from an editable, never-prompt probe list baked into `remember.md` (Claude Code, Droid/Factory, Amp, opencode, plus Codex and Antigravity roots; add your own at the top). A no-sessions miss is surfaced **loudly** and degrades to stash-only — never a silent skip. The standalone `/friction` command was removed across all four packages (the `friction.js` script stays, directly runnable for inspection). Counts: claude commands 9→8, droid/opencode/ampcode 17 each.
- **`/stash` now nudges toward consolidation.** After saving, it derives the unprocessed backlog (`stash files − .processed manifest entries`) and, at ≥5, emits a one-line prompt to run `/remember`. No counter is stored — the count is derived from ground truth, and running `/remember` clears it. The nudge is informational; `/remember` never runs automatically.

### Fixed
- **`friction.js` no longer crashes on a single malformed JSONL line.** The four mirrored copies parsed session logs and `friction_raw.jsonl` with bare `.map(line => JSON.parse(line))` — one corrupt line aborted the whole run. A new `parseJsonl(raw, source)` helper skips bad lines with a one-line stderr warning (line number + source) and keeps the good records; the whole-file `friction_analysis.json` read is now wrapped in a try/catch that reports the file and bails with exit 1 instead of throwing. Mirrored identically (modulo `.claude`/`.factory`/`.opencode`/`.amp` branding) across all four tool packages.
- **`packages/subagentic-manual.md` restored after a range-sed corrupted ~310 lines.** A `sed '/start/,/end/{s/.../...}'` earlier this session had `test-generate$` as the end pattern; the range matched far past its intended scope (later occurrences in tree diagrams and category bullets), overwriting the entire tail of the document — Subagents reference, Commands reference, Hot Memory, Usage Patterns, Platform Architecture, Frontmatter Architecture, Contributing — with ~310 duplicate copies of the "Simple Commands" bullet. Restored from the pre-corruption snapshot and re-applied all the renames + count updates that should have happened cleanly. Same fix mirrored to `agentic-toolkit/ai/subagentic/subagentic-manual.md`.

### Changed
- **Root `package.json` `engines.node` bumped `>=14.0.0` → `>=18.0.0`.** Node 14 has been EOL since 2023-04; the floor now matches the bundled `live-canvas-channel` plugin (`>=18`) and sits well under what CI publishes on (Node 22). As a minimum it excludes no one currently on a supported runtime.
- **`/review` renamed to `/diff-review` across all four tool packages.** Avoids the name collision with the Anthropic-official `code-review` plugin (which also ships a skill named `review` that operates on PRs). `/diff-review` is more accurate to what the command does — it operates on a diff (staged, working tree, branch range, or against a ref), not on a remote PR. Mirrored into `~/.claude/commands/` and all docs/agents/`opencode.jsonc` references swept.
- **`/diff-review` absorbed `/code-review`; collapsed to a single command across all four tool packages.** `/diff-review` now accepts a file, a branch (`/diff-review main` diffs `merge-base(main, HEAD)..HEAD` — the common "review my branch before merging" path), or an explicit range (`main..HEAD`). It bakes in the user's standing review focus: bugs needing a fix, dead code, loose ends (added TODO/FIXME, swallowed errors, stubs, abandoned flags), correctness, security, performance, maintainability.
- **`/diff-review` and `/security` now verify findings, selectively auto-fix, and stop to ask only when needed.** After listing findings, each cited `file:line` is re-grounded in context (and `git grep`'d for dead-code claims) and marked confirmed / false-positive / uncertain. Confirmed + unambiguous + no-contract-change fixes apply directly; the changed region is re-read after the edit. HITL gates fire only for: uncertain findings, multiple reasonable fix shapes, downstream-affecting changes (signatures / response shape / schema / public symbol removal), security primitives (auth / crypto / session / token), or "dead code" that looks intentionally kept. `/diff-review` ends with a one-line **Ready to merge? Yes / No / With fixes** verdict.
- **Skills renamed to short 2-word slugs (round 2).** `testing-anti-patterns` → **`test-traps`** (now includes timing/polling as AP6 after the fold). `test-driven-development` → **`tdd-flow`** (slug short, H1 short, `TDD` prose preserved as the industry term). `verification-before-completion` → **`verify-done`** (rhythmically mirrors `test-first`). Round 2 paired with round 1 (`systematic-debugging` → `debug-method`, `root-cause-tracing` → `trace-back`) gives a scannable cluster: `tdd-flow / test-generate / test-traps` and `debug-method / trace-back / verify-done`. All references swept across docs, agent files, opencode.jsonc, and the debug-method skill's cross-refs.
- **Skills renamed to short 2-word slugs (round 1).** `systematic-debugging` → **`debug-method`** (the 4-phase framework with its 4 pressure-test scenarios + creation log preserved). `root-cause-tracing` → **`trace-back`** (the backward-tracing technique with its `find-polluter.sh` bisection helper preserved). Names are shorter, cluster alphabetically under `debug-`, and the "method vs technique" split is now obvious at a glance. All references swept across docs, agent files, and the debug-method skill's internal cross-refs to trace-back.
- **`/test-generate` rewritten as a generate-and-verify loop, not just a generator.** New flow: discover the existing test framework (refuses to add a new runner) → mirror nearby tests for style/fixtures → generate happy / edge / error cases → **run the new tests** with the project's real test command → **verify each test bites** (mentally swap a broken impl — does the assertion catch it?). Superficial tests (`expect(true).toBe(true)`, mock-asserting-itself, setup-masked passes) count as a failure to ship. Same claim → verify → report shape as `/diff-review` and `/security`. HITL gates: a meaningful test would require a non-obvious design change in production code, ambiguous existing test patterns, or a mock style the project doesn't currently use.
- **`/optimize` now verifies bottleneck claims before optimizing.** Each cited `file:line` must have at least one of: a profile / benchmark / log line showing call frequency or duration, an obvious hot loop / per-request handler, or user-provided evidence. Unverified claims are marked **uncertain — don't optimize on speculation**. Auto-fixes only when confirmed + unambiguous + no behavior/API change. HITL gates: uncertain (no profile), multiple reasonable shapes (cache vs precompute vs batch vs paginate vs index), public-API / response / schema changes, correctness-for-speed trades, or concurrency primitives.
- **`/refactor` now runs the tests after the edit.** The "existing tests must pass" constraint was load-bearing but unverified — `/refactor` now detects the project's test command (`package.json` scripts, `pytest`, `go test`, `cargo test`, `Makefile`), runs it scoped to the affected area when possible, and reports pass/fail. If tests fail it **stops and asks** with three options (revert / patch the refactor / update the test with reasoning) rather than auto-reverting (destroys work) or pushing forward (breaks the invariant). Also stops on scope creep and public-API-boundary changes.
- **`condition-based-waiting` folded into `test-traps` as Anti-Pattern 6: Timeout-Based Waiting.** The two skills covered the same domain (test quality) but only one auto-triggered; folding promotes the timing/polling guidance to auto-trigger coverage. The `example.ts` helper (domain-specific `waitForEvent` / `waitForEventCount` / `waitForEventMatch`) moves with it and is referenced from AP6. Counts: claude skills 10 → 9; droid/opencode/ampcode commands 19 → 18.
- **CI:** the publish workflow now polls the npm registry for ~2 min (was ~15s; `--prefer-online` skips npm's view cache) and accepts an `exit 0` publish even if the registry hasn't reflected it yet, so a successful-but-slow-to-reflect publish no longer reports a false failure.
- **`publish.yml` is now manual-only (`workflow_dispatch`) — npm OIDC trusted publishing with provenance, idempotent, and verifies the registry end-state.**
- **`publish.yml` install step `npm ci` → `npm install`.** This toolkit is dependency-free (no `package-lock.json`), so `npm ci` failed with `EUSAGE`; `npm install` is a fast no-op here and still works if deps are ever added. Removed the superseded manual `scripts/publish.sh` (NPM_TOKEN-via-`pass` flow) — publishing now goes solely through the `publish.yml` GitHub Actions workflow.

### Removed
- `/code-review` (was: workflow ceremony about *when* to request a review, mostly overlapping `/diff-review`'s purpose). Use `/diff-review` instead — `/diff-review main` for branch-vs-main, `/diff-review` with no args for staged/working-tree.
- **`/debug`** — was a thin 17-line echo of the `systematic-debugging` skill. The skill (now `debug-method`) carries the real workflow with its pressure-test scenarios; the command added nothing.
- **`/explain`** — was 11 lines of "explain this code" with no real constraints or workflow. The model does this naturally from a plain prompt.
- **`/git-commit`** — Claude Code has built-in commit handling and the other three tools don't need a thin wrapper around `git diff --staged` + a templated message either. Use natural-language prompts instead.

---

## [2.9.0] - 2026-05-26

Redesign of the `/friction` → `/remember` memory pipeline so friction stops poisoning hot memory and antigens come from what the user actually said. Applied identically across all four tool packages (claude, opencode, ampcode, droid).

### Changed
- **`/friction` now seeds antigens from observed user reactions, not machine proxies.** Antigen candidates are anchored only on real user reactions (corrections, curses, interrupts); inferred signals survive only as corroborating severity. Clustering is by what the user *said* (content/phrase overlap) instead of `(signal, tool_pattern)`, and recurrence × severity drives a `suggested_artifact` — only patterns recurring across 5+ sessions are meant to load into hot memory. On a 253-session corpus this took false hot preferences from 15 → 0.
- **`/remember` rewritten to consolidate from friction's short quotes, never raw logs.** It classifies each reaction's target (agent vs. self), drops self-corrections, semantically merges paraphrases that lexical clustering left split, and tiers antigens by recurrence. The generated `MEMORY.md` section is renamed `Preferences` → `Antigens` (High loads hot / Medium recorded / Low = episode).

### Fixed
- **Terminal pastes are no longer mistaken for friction.** Pasted SSH/shell dumps (prompt lines like `> sudo …` and `root@host:~#`, command output) were captured as user reactions, polluting antigen keywords with shell vocabulary (`postconf`, `qemu`). They are now detected and excluded from both signal detection and keyword extraction, while genuine short corrections that merely mention a command are preserved.
- **Profanity only counts when it's aimed at the agent.** Narrative/rhetorical curses ("does anyone search any shit?", a pasted reddit story) no longer raise a `user_curse` signal; a curse is kept only in a short reaction turn or when an agent-directed word sits next to it.
- **Self-corrections are now surfaced to the consolidation step.** The `self_suspect` hint ("wrong project", "nevermind") is propagated from candidate to cluster and rendered in `antigen_review.md`, so `/remember` is told to confirm agent-vs-self target before treating a cluster as an antigen.

### Removed
- Dead scaffolding left over from the redesign in `friction.js`: the unused `overlap()` helper, the `MIN_KW`/`MIN_INTER` constants, the unread `selfCount` counter (superseded by the `anySelf` flag), and the always-empty `top_files` field with its unreachable renderer block.

---

## [2.8.3] - 2026-05-24

### Security
- **Path containment uses a boundary match.** `installer/path-manager.js` confined installs to the home directory via `startsWith(homeDir)`, which would also accept a sibling like `${homeDir}-evil`. Now matches on a path separator (`=== homeDir || startsWith(homeDir + path.sep)`), and likewise for the temp dir. Defense-in-depth for a local installer; verified install/backup/uninstall still work.

### Changed
- **`docs/INSTALLER_GUIDE.md` custom-path docs now match the installer.** It advertised `/opt/...`, `/mnt/...`, and team/external locations, but the installer confines paths to the home directory (or temp dir). Documented the real rule and corrected the examples.
- Removed decorative emoji from `README.md` headings (kept the friction traffic-light indicators).
- CI: bumped `actions/checkout` and `actions/setup-node` to v6 (Node 24) ahead of the June 2026 Node 20 deprecation.

---

## [2.8.2] - 2026-05-24

Maintenance release: removes the last of the legacy 3-variant system, fixes the broken `liteag` alias and post-install message, and trims the shipped documentation down to the README plus an accurate installer guide. No changes to the installed agents/commands/skills.

### Fixed
- **`npm test` (the CI publish gate) was failing, blocking releases.** The installer test suites still assumed the removed 3-variant system (Lite/Standard/Pro). The multi-tool suite has been rewritten for the single-variant installer (one `pro` package per tool), and the cross-platform suite's terminal checks no longer assert raw environment presence (`stdout` TTY, `TERM`, `SHELL`) — those failed whenever output is piped (i.e. always under the runner and in CI). They now verify the installer's graceful fallback instead. `npm test` passes 138/138, including under a minimal CI environment.
- **The `liteag` short alias was broken.** Its `cli.js` was a leftover 3-variant wrapper that defaulted to a non-existent `standard` variant, looked for a `.claude-plugin/plugin-standard.json` that no longer exists, and exited 1. It now simply forwards all arguments to the real interactive installer (`installer/cli.js`), so `liteag` and `liteagents` behave identically (check existing installs, backup, install, uninstall). The actual installer was not modified.
- **`postinstall` pointed at a command that doesn't exist.** The post-install message told users to run `$ agentic-kit`; the published bin is `liteagents`. Corrected.

### Added
- **Content-integrity check in the multi-tool test suite.** It now pins the expected per-tool counts of agents, commands, skills, and plugins (counting `.md` dispatch entries and skill/plugin directories, not raw files). Accidentally adding or removing a command/skill/agent fails the publish gate with the exact delta until the expected number is updated deliberately — so the CI gate now protects what actually ships, not just installer plumbing.

### Changed
- **Rewrote `docs/INSTALLER_GUIDE.md` to match the actual installer** (1586 → ~430 lines). Removed the entire fictional "Command-Line Flags" section (the installer takes no flags — it is interactive only), the Lite/Standard/Pro variant system, invented agent lists and component counts, and corrected the default install paths (`~/.config/opencode`, `~/.config/amp`, `~/.factory` — the old guide listed `~/.opencode`/`~/.ampcode`/`~/.droid`, none of which the installer uses). Added an accurate interactive walkthrough and an Uninstalling section, and dropped links to deleted/nonexistent docs.

### Removed
- **Trimmed `docs/` to one guide.** Removed 20 internal/maintainer/stale docs (~7,500 lines) that shipped to users — implementation notes, QA/test reports, `pass`/publishing guides, the variant-era `MIGRATION.md`/`RELEASE_NOTES_1.2.0.md`, `KNOWLEDGE_BASE.md`, `CONTRIBUTING.md`, `PRIVACY.md` (telemetry is a no-op stub), `SECURITY.md`, etc. The README plus the rewritten `docs/INSTALLER_GUIDE.md` are the documentation now.
- **Stopped shipping `docs/` in the npm package** (dropped from `package.json` `files`, along with the broken root `QUICK-START.md`/`TROUBLESHOOTING.md` entries that never existed). End users get the README; the installer guide lives in the repo. Fixed the README's broken doc links and pointed `CLAUDE.md` and the package validator at the surviving guide.
- Stale `variant-system` npm keyword — there is one package per tool, not a variant matrix.
- Dead 3-variant migration code in `installer/path-manager.js` (`detectLegacyInstallation`, `countLegacyComponents`, `classifyVariantFromComponents`, `createManifestForLegacy`). These classified pre-1.2.0 installs into lite/standard/pro by counting `resources`/`hooks` dirs that no longer exist, and nothing in the installer ever called them. Verified the installer still installs, backs up, and uninstalls correctly after removal; `npm test` 138/138 and the installation-engine suite 60/60 still pass.
- Obsolete documentation describing removed features: `docs/VARIANT_CONFIGURATION.md`, `docs/UPDATED_VARIANT_CONFIGURATION.md` (the 3-variant matrix), `docs/SILENT_MODE_GUIDE.md` and `docs/INSTALLATION_DEMO.md` (a `--variant`/`--tools`/`--silent` flag CLI the installer never had — it is interactive only). Dropped the stale `VARIANT_CONFIGURATION.md` entry from `scripts/validate-package.js`.

---

## [2.8.1] - 2026-05-22

### Changed
- **`/security` and `/ship` rewritten across all four tools (claude, opencode, ampcode, droid).** Both were thin stubs; they're now substantive, stack-agnostic gates that apply to libraries, CLIs, web apps, and services alike.
  - `/security` leads with the six failure classes that recur in nearly every quickly-built app — secrets committed to the repo, data-access / tenant isolation, rate limiting (including authenticated write routes), error handling past the happy path, authorization-beyond-authentication (IDOR / privilege), and N+1 / unindexed data access — plus a trust-boundary pass (spoofable headers like `X-Forwarded-For`, services bound to `0.0.0.0`, unvalidated untrusted input) and severity-ranked, coverage-auditable output.
  - `/ship` is now stack-adaptive: it detects the toolchain (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`) and runs only the checks that exist instead of assuming `npm run lint`/`build`/`migrate`, and adds gates for authorization, rate limiting, data-access scoping, error handling, and secret-scanning before deploy.

### Fixed
- **`allowed-tools` permission syntax normalized to the canonical colon form** (`Bash(git:*)`) in the claude package's `ship.md`, `security.md`, and `git-commit.md` — the space form (`Bash(git *)`) is not a valid Claude Code permission wildcard. The opencode/ampcode/droid packages retain their existing space-form syntax (their runners parse `allowed-tools` differently, if at all), so there is no behavior change there.

---

## [2.8.0] - 2026-05-18

### Added
- **live-canvas channel: lazy port binding via MCP tools** — `server.js` (v0.5.0) now exposes `channel_open`, `channel_close`, and `batch_open` tools and only binds port 8788 when the skill explicitly calls one. Plain Claude sessions stay idle by default; multiple sessions can have the plugin loaded with `/mcp` green without racing for the port.
- **live-canvas channel: automatic sibling takeover** — when `channel_open` finds port 8788 held by another instance of the live-canvas plugin running as the same uid, it takes over (SIGTERM the sibling, rebind, SIGKILL fallback if needed). The taken-over pid is returned as `took_over` in the response so the skill can surface it to the user. Foreign processes are still refused with `{status: "in_use", holder_pid, ...}` — the plugin won't kill anything it doesn't own. Removes the dead-end "port busy, go close it yourself in some other terminal" prompt the user was hitting on every second `/live-canvas`.
- **live-canvas JSON mode: writes to disk instead of browser download** — channel server gains a `POST /feedback-jsonl` route that appends submissions to `<parent claude cwd>/.claude-design/feedback.jsonl`. The skill calls a new `batch_open` MCP tool (no flag gate — JSON mode doesn't use channels) and sets the overlay's `batchEndpoint` to `/feedback-jsonl`. Falls back to the legacy browser-download path only when the MCP isn't available or another session holds the port.
- **live-canvas channel: parent-flag capability gate** — `channel_open` inspects the parent `claude` process's command line and refuses to bind if `--dangerously-load-development-channels` is missing, returning `{status: "no_channel_capability", message: ...}`. Without this, plain `claude` sessions could win the port race and silently drop every notification (POST 200, no `<channel>` tag — the "nothing landed" black hole).
- **Cross-platform parent-cmdline detection** — Linux reads `/proc/<ppid>/cmdline` (fast, no subprocess); macOS/BSD falls back to `ps -p <ppid> -o args=`; Windows falls back to `wmic process where processid=<ppid> get commandline`. If none work the gate fails closed.
- **SKILL.md Case D — explicit relaunch block** — when `channel_open` returns `no_channel_capability`, the skill prints the exact `live-claude --continue` command (and the literal `--dangerously-load-development-channels` long form) and stops, instead of proceeding into a non-functional Live mode.

### Changed
- **SKILL.md mode-selection: replaced `curl /health` probe with the `mcp__live-canvas__channel_open` tool call.** The tool's structured result (`opened` / `already_listening` / `in_use` / `no_channel_capability`) is authoritative — no more curl-vs-marketplace-dir branch table. Mirrors in `packages/{droid,ampcode,opencode}/commands/live-canvas.md` synced.

### Fixed
- **live-canvas: silent channel black-hole when a plain `claude` won the port race.** Before, the first session to start (often a plain `claude` without the experimental channels flag) would bind 8788 first; subsequent `live-claude` sessions hit EADDRINUSE and the user's browser feedback would POST 200 into a session that silently discarded notifications. The capability gate + lazy bind together eliminate this: only flagged sessions can claim the port.

---

## [2.7.0] - 2026-05-17

### Added
- **live-canvas: one-shot installer** — `setup.sh` now copies the marketplace to `~/.claude/plugins/`, runs `npm install`, and writes a `live-claude` shell function to `~/.zshrc` and `~/.bashrc` so the user can launch a Live-mode session with one command. Idempotent.
- **live-canvas: collapsible overlay** — a "−" button next to "Add Feedback" hides the bar to a 36px corner bubble (sessionStorage-persisted). Mobile-friendly: comment popup goes full-width below 640px.
- **live-canvas: lab banner** — generated lab pages now include a "this is a temporary review surface" banner template (`templates/lab-banner.html`), mode-agnostic, paste-once.
- **live-canvas: explicit mode pick** — the skill asks Live vs JSON every run via `AskUserQuestion` instead of silently auto-detecting. If Live is unreachable, the skill diagnoses (installed-but-not-Live vs first-time setup) and prints targeted next steps instead of failing opaquely.
- **CLAUDE.md inline dev rules** — must-know rules from `.claude/memory/AGENT_RULES.md` (Simple > clever, surgical changes, dependency hierarchy, mobile-first UI, POC-first) are now inlined in CLAUDE.md so every agent session sees them.
- **Installer banner reads `package.json`** — the ASCII logo's version string is no longer hardcoded; `UPDATE_VERSION.sh` only needs to touch `package.json` to keep it current. README version badge already auto-pulled from `package.json` via shields.io.

### Changed
- **live-canvas: vanilla overlay everywhere** — deleted the React-specific overlay (`templates/feedback-react/`, 5 files, ~2300 lines). `overlay-vanilla.js` (one file, plain DOM, zero deps) now works in every supported framework, including React/Next.js/Vite via a `<script>` tag + `useEffect`.
- **live-canvas: user-facing rename "Batch" → "JSON"** — the non-Live mode is now called "JSON mode" everywhere user-facing.
- **live-canvas: demo moved to `dev/`** — `templates/demo/post-variants.html` was never copied during real runs. Relocated to `dev/post-variants.html` at the skill root.

### Fixed
- **live-canvas channel server: shutdown race** — `server.js` held port 8788 indefinitely after the MCP host disconnected because `server.close()` is async but `process.exit()` was called synchronously. Stale process broke `/reload-plugins` and second sessions. Now uses a `closing` guard and lets `server.close()` callback drive exit (with a 500ms unref'd ceiling).
- **live-canvas overlay: mode badge stale on re-expand** — collapsing and re-expanding the overlay used to show "BATCH mode" (now "JSON mode") even after a runtime live→batch fallback. Badge text now refreshes from `state.mode` on every re-expand.
- **live-canvas setup.sh: sudo guard** — bails early when run with `sudo` instead of silently installing into `/root/.claude/plugins/`.
- **live-canvas docs: stale tails** — README ASCII diagram still labeled the overlay "(vanilla JS or React)"; troubleshooting referenced the old `/demo/` URL prefix; SKILL.md JSX-translation note for the lab banner was too thin (kebab-case CSS properties would produce invalid JSX).

### Removed
- **`templates/feedback-react/`** — React-specific overlay and supporting modules (`FeedbackOverlay.tsx`, `selector-utils.ts`, `format-utils.ts`, `types.ts`, `index.ts`).
- **`INTEGRATION_NOTES.md`** — stale draft predating the channel implementation; recommendations all completed.
- **3-case probe tree from Phase 0** — replaced by an explicit mode prompt + targeted diagnostic block when Live is picked but unreachable.

---

## [2.6.1] - 2026-05-09

### Security
- **fast-uri 3.1.0 → 3.1.2** (GHSA-q3j6-qgpj-74h6 / CVE-2026-6321, CVSS 7.5 high) — patches path-traversal via percent-encoded dot segments in `normalize()`/`equal()`. Transitive dep via `@modelcontextprotocol/sdk` → `ajv` in the `live-canvas-channel` plugin. Lockfile-only update; existing `^3.0.1` range already permitted the patched version.

---

## [2.6.0] - 2026-04-19

### Added
- **live-canvas skill** — Design interview, generates 5 UI variations, collects click-to-annotate feedback from the browser, produces a final implementation plan. Available as a skill in Claude Code and as a command in Droid/Ampcode/Opencode.
  - **Vanilla overlay** (`overlay-vanilla.js`, ~400 lines, zero deps) — framework-agnostic click-to-annotate HUD with pin placement, selector inference (`data-testid` > `id` > class chain, CSS-in-JS hashes filtered), variant detection via `data-variant` attribute, and a v1.0 schema wire-compatible with the upstream React template.
  - **React overlay** (`FeedbackOverlay.tsx`) kept for React/Next/Vite projects.
  - **Demo** (`templates/demo/post-variants.html`) — standalone 5-variant post card playground for review without starting a dev server.
  - **Handholding activation flow** — Phase 0 probes the channel on every invocation and offers `AskUserQuestion` choices: first-time users get the full 4-step setup; returning users who forgot the dev flag get the restart command; channel-up sessions proceed silently.
- **live-canvas-channel plugin** (Claude Code only) — MCP channel server that bridges the overlay's HTTP POSTs into the live session as `notifications/claude/channel` events. Packaged as a Claude Code marketplace under `packages/claude/plugins/live-canvas-marketplace/`.
  - HTTP listener on `127.0.0.1:8788` with `/health` probe and `/feedback` POST endpoint
  - MCP server using `@modelcontextprotocol/sdk` with `experimental: {'claude/channel': {}}` capability
  - `instructions` field added to tell Claude how to act on incoming `<channel source="live-canvas">` tags: acknowledge in chat → locate variant file → edit → confirm
  - `setup.sh` helper that runs `npm install` and prints the 3 remaining manual steps
- **Installer: plugins as first-class category** — `packages/<tool>/plugins/` now discovered, selected per variant, and copied to `<target>/plugins/`, parallel to skills. `node_modules/` excluded during copy and size computation. Manifest generation includes a `plugins` component count, installed-files list, and path entry.
- **Friction report: project attribution in cluster output** — `antigen_review.md` now shows which projects each cluster spans (new "Projects" column in the summary table; new `**Projects:**` line per cluster). Data was always in `session_id`; the previous version dropped it during clustering.

### Changed
- **README restructured for Hot Memory visibility** — new top-level `🧠 Hot Memory` section between Quick Start and What's Included, with pipeline diagram and sample friction output. Manual Skills/Commands list regrouped into named sub-sections (Hot Memory Pipeline, Design, Workflow & analysis). Old duplicated Hot Memory section removed.
- **Command/skill count 22 → 23** per tool across README, subagentic-manual, and per-package `AGENTS.md` / `AGENT.md` / `CLAUDE.md`.
- **opencode.jsonc** — added `live-canvas` entry under `"command"` block.

### Fixed
- **Friction clustering dropped project names** — cluster object converted `{sessionId: true}` dict to a count before rendering, so `antigen_review.md` never surfaced which repos contributed to each pattern. Fix preserves `session_ids[]` and `projects[]` on every cluster.
- **Live Canvas overlay counter flicker in live mode** — counter went 0→1→0 during successful push roundtrip. Rewrote so successful live pushes never enter the pending-batch state; counter stays at 0 unless a push actually fails.

### Notes
- The Claude Code channel plugin is subject to Claude Code's research preview: custom channels require `--dangerously-load-development-channels` at session start, and steps 2-4 of setup (`/plugin marketplace add`, `/plugin install`, session restart) cannot be automated. The skill prints copyable commands and an alias suggestion.
- Droid, Ampcode, and Opencode run live-canvas in batch mode only — channels are Claude-Code-specific.

---

## [2.5.2] - 2026-02-11

### Added
- **friction command** — Analyze session logs for failure patterns, behavioral signals, and antigen clusters
  - 14 weighted signals (user_intervention, false_success, tool_loop, etc.)
  - Session scoring and quality classification (BAD/FRICTION/ROUGH/OK)
  - Candidate clustering by (anchor_signal, tool_sequence) for 3-4x compression
  - Context noise filtering and dedup in clusters
  - Bundled `friction.js` (2157 lines) with absolute search paths per platform
- **remember command** — Consolidate stashes and friction output into persistent project memory
  - Extracts facts and episodes from session stashes via sonnet
  - Distills friction clusters into behavioral preferences with confidence tiers
  - Writes unified `.claude/memory/MEMORY.md` (or platform equivalent)
  - Injects `@MEMORY.md` reference into instruction file (CLAUDE.md/AGENTS.md/AGENT.md)
- **Hot Memory pipeline** — Lightweight session memory: `/stash` -> `/friction` -> `/remember`
  - Documented in README and subagentic-manual
- **Platform-specific paths** across all 4 packages (claude, droid, opencode, ampcode)
  - Each package uses correct instruction file, project path, and global install path
- **.gitignore** — Added `.claude/`, `.factory/`, `.opencode/`, `.amp/` project data directories

### Changed
- **context-builder** — Updated per platform with correct instruction file, project/global paths, tool name, and `@MEMORY.md` discovery
- **docs-builder** — Synced blueprint.md section and templates across all packages
- **opencode.jsonc** — Registered friction and remember commands
- **AGENTS.md/AGENT.md** — Command counts updated 10 -> 12 across all packages
- **package.json** — Description updated to 22 commands
- **installer banner** — Updated to v2.5.2 with 22 commands

---

## [2.4.7] - 2026-02-02

### Changed
- **docs-builder skill** - Enhanced with reorganization capabilities
  - Added Fresh vs Existing mode detection (auto-detects if `/docs` already has content)
  - New archive tier (`/docs/archive/`) for old/unclear documentation
  - Categorization workflow: KEEP, CONSOLIDATE, or ARCHIVE existing files
  - Heuristics for automatic categorization based on filename patterns and content
  - Consolidation logic for merging duplicate content
  - Updated across all packages (claude, opencode, ampcode, droid)

---

## [2.4.1] - 2026-01-24

### Changed - Package Rebranding
- **BREAKING:** Package renamed from `@hamr0/agentic-kit` to `liteagents` (unscoped)
  - Better reflects lightweight, CLI-focused nature
  - Easier installation: `npm install -g liteagents`
  - Commands: `liteagents` and `liteag` (shorthand)
- **Repository:** Renamed from `agentic-kit` to `liteagents` on GitHub
  - New URL: https://github.com/hamr0/liteagents
  - Old URLs redirect automatically

### Removed
- GitHub Packages support completely removed
  - No GitHub Packages were published (0 downloads)
  - Simplified to npm-only publishing
  - Removed `.npmrc`, `GITHUB_SETUP.md`, `GITHUB_PACKAGES.md`, `DUAL_PUBLISH_SUMMARY.md`
  - Removed `publish:github` and `publish:both` npm scripts

### Updated
- All documentation updated to reference `liteagents`
  - Updated 9 docs files and all root files
  - README: New "LITEAGENTS" ASCII logo
  - All npm badges and links updated
- Publishing workflow simplified
  - `scripts/publish.sh` reduced from 195 to 69 lines
  - Now npm-only, no GitHub token management needed
  - `docs/PUBLISHING.md` simplified to focus on npm

### Migration Guide
For users of `@hamr0/agentic-kit`:
```bash
# Uninstall old package
npm uninstall -g @hamr0/agentic-kit

# Install new package
npm install -g liteagents

# Use new commands
liteagents  # or 'liteag' for shorthand
```

Old package `@hamr0/agentic-kit` will be deprecated with migration message.

---

## [2.3.0] - 2026-01-22

### Removed
- Removed `subagent-spawning` skill (functionality integrated into agents)

### Changed
- Updated command/skill count from 21 to 20 across all documentation
- README.md: Updated command counts and removed subagent-spawning from skill list
- installer/cli.js: Updated welcome banner to reflect 20 commands
- package.json: Updated description to reflect 20 commands
- packages/subagentic-manual.md: Updated command counts

---

## [1.11.1] - 2026-01-20

### Fixed
- Added missing command definitions to `packages/opencode/opencode.jsonc` (debug, explain, git-commit, optimize, refactor, review, security, ship, stash, test-generate, subagent-spawning)

---

## [1.11.0] - 2026-01-20

### Added
- `/stash` command for saving session context for compaction recovery or handoffs (added to all packages: claude, opencode, ampcode, droid)

### Changed
- Updated command count from 20 to 21 across all documentation
- README.md: Updated command counts and added stash to command list
- installer/cli.js: Updated welcome banner to reflect 21 commands
- package.json: Updated description to reflect 21 commands

### Fixed
- package.json: Fixed validate script path to point to scripts/validate-package.js

---

## [1.2.1] - 2025-11-05

### Changed

**Package Optimization:**
- Optimized npm package structure by excluding development-only files
- Updated `package.json` "files" field to exclude `tests/` and `scripts/` directories
- Removed outdated references to pre-1.2.0 structure (`.claude-plugin/`, root `agents/`, `skills/`, `hooks/`)
- Added cleanup npm scripts: `npm run clean` and `npm run clean:git`
- Updated `prepublishOnly` script to auto-clean test artifacts before validation

**Repository Cleanup:**
- Removed 916 temporary test artifacts (22 MB reduction)
- Updated `.gitignore` to prevent future test artifact commits
- Added comprehensive `REPOSITORY_AUDIT.md` with detailed analysis

**Results:**
- Repository size reduced: 70 MB → 49 MB (30% reduction)
- File count reduced: 2,727 → 1,812 files (33% reduction)
- Tests directory optimized: 959 → 43 files (96% cleanup)
- npm package size: 38.4 MB unpacked (1,385 files only)
- Published package now contains only essential user-facing files
- 35% faster installation for end users

---

## [1.2.0] - 2025-11-05

### Added

**Interactive Multi-Tool Installer:**
- `installer/cli.js` - Interactive CLI with 4-step installation process
- `installer/package-manager.js` - Variant-based package management
- `installer/installation-engine.js` - File copying with rollback capability
- `installer/verification-system.js` - Post-installation validation
- `installer/path-manager.js` - Path resolution and validation
- `installer/state-manager.js` - Resume capability for interrupted installations
- Command-line interface supporting 4 tools: Claude, Opencode, Ampcode, Droid
- Real-time progress tracking with ANSI progress bars
- Variant selection (Lite: 510 KB, Standard: 8.4 MB, Pro: 9 MB)
- Multi-tool installation (install all 4 tools simultaneously)
- Silent mode for CI/CD (`--silent --variant=standard --tools=claude`)
- Custom path configuration with validation
- Automatic rollback on installation failure
- Resume capability for interrupted installations
- Uninstall functionality (`--uninstall --tools=claude`)
- Upgrade/downgrade between variants

**Installation Reporting & Telemetry (Phase 9.2-9.3):**
- `installer/report-template.js` - Comprehensive installation report generation
  - Summary with success/failure status, variant, tool count, total files, installation time
  - Detailed per-tool information (components, paths, verification status)
  - System information (Node.js version, platform, architecture)
  - Errors and warnings sections
  - Reports saved to `~/.liteagents-install.log`
- `installer/telemetry.js` - Anonymous usage statistics (opt-in only)
  - User consent prompt with clear data collection policy
  - `--no-telemetry` flag to disable telemetry
  - Collects: variant, tool count, installation time, success/failure, OS type
  - Does NOT collect: file paths, personal information, specific tool names
  - Local storage only (not sent to servers)
  - Easy opt-out via config file or command flag
- `docs/PRIVACY.md` - Transparent privacy policy (250+ lines)
  - Detailed explanation of data collection
  - What we collect vs. what we don't collect
  - How to manage consent and opt-out
  - View and delete collected data

**Security Hardening (Phase 9.4):**
- `docs/SECURITY.md` - Comprehensive security documentation (380+ lines)
  - Security principles and implemented measures
  - Path traversal prevention with `PathManager.sanitizePath()`
  - Symlink attack mitigation with real path resolution
  - Input validation for all user inputs (tool names, variants, paths)
  - File size limits (1MB max) to prevent DoS attacks
  - Null byte detection in paths and file content
  - Secure file permissions (0600) for sensitive files
  - No command injection vulnerabilities (no shell execution of user input)
- Enhanced `PathManager` with security checks:
  - Validates paths are within home directory
  - Checks for suspicious system directories
  - Resolves and validates symlinks
  - Prevents null byte injection
- Enhanced `PackageManager` with JSON validation:
  - File size limits before parsing
  - Null byte detection
  - Structure validation (must be object)
  - Safe error handling

**Legacy Migration Support (Phase 9.5):**
- `docs/MIGRATION.md` - Complete migration guide (400+ lines)
  - Automatic and manual migration procedures
  - Variant classification from legacy installations
  - Troubleshooting and rollback instructions
  - FAQ and version compatibility matrix
- `PathManager.detectLegacyInstallation()` - Automatic detection of pre-1.2.0 installations
- `PathManager.countLegacyComponents()` - Component counting for variant classification
- `PathManager.classifyVariantFromComponents()` - Smart variant classification
- `PathManager.createManifestForLegacy()` - Manifest generation for legacy installations
- Preserves user customizations during migration

**Tool-Specific Packages:**
- `packages/claude/` - Conversational AI optimization (markdown-first)
- `packages/opencode/` - CLI-optimized code generation (terminal-first)
- `packages/ampcode/` - Amplified development (maximum velocity)
- `packages/droid/` - Android-first mobile development
- Tool-specific hooks with optimization flags
- Consistent structure: 13 agents, 22 skills (8 core + 14 advanced)
- Variant configuration via `variants.json` for each tool

**Comprehensive Testing:**
- `tests/installer/variants-parsing.test.js` - 88 tests for variant parsing
- `tests/installer/package-manager.test.js` - 44 tests for package management
- `tests/installer/installation-engine.test.js` - 35 tests for installation
- `tests/installer/integration.test.js` - 40 comprehensive integration tests
- `tests/installer/path-confirmation.test.js` - 34 tests for path validation
- `tests/installer/summary-display.test.js` - 13 tests for summary display
- `tests/validation-test.js` - 9 core module validation tests (Phase 9.6)
  - Package Manager, Path Manager, Installation Engine initialization
  - Variant configuration loading
  - Path sanitization and security (path traversal protection)
  - Report generation, telemetry, legacy detection, state management
- Total: 263 passing tests with zero failures
- 100% validation success rate across all packages

**Documentation:**
- `docs/INSTALLER_GUIDE.md` - Comprehensive installation guide (850+ lines)
  - Step-by-step installation process
  - Variant selection guide with use cases
  - Tool selection guide (when to use each tool)
  - Custom path configuration
  - 7 common installation scenarios
  - Command-line flags reference
  - Troubleshooting (7 common issues with solutions)
  - FAQ (40+ questions)
- `docs/VARIANT_CONFIGURATION.md` - Variant system documentation (440 lines)
  - Variant philosophy and design principles
  - Detailed rationale for 8 core skills
  - Explanation of 14 advanced skills (Pro only)
  - Tool-specific optimizations
  - Usage recommendations
- `docs/PACKAGE_BASELINE.md` - Package structure reference (557 lines)
- `docs/PACKAGE_VALIDATION_REPORT.md` - Quality assurance report (400+ lines)
  - All 12 tool/variant combinations validated
  - Zero errors, zero warnings
  - Production-ready status confirmed

**Scripts:**
- `scripts/validate-all-packages.js` - Automated validation for all packages
- `validation-results.json` - Machine-readable validation results

### Changed

**README.md:**
- Updated from 14 to 22 skills
- Added tool badges (Claude, Opencode, Ampcode, Droid)
- Interactive installer promoted to recommended installation method
- Added "Supported Tools" section
- Added Size column to variants table
- Updated installation options with multi-tool support
- Updated Stats section (22 skills, 4 tools)

**Skills:**
- Expanded from 14 to 22 total skills
- 8 core skills (Standard): pdf, docx, xlsx, pptx, canvas-design, theme-factory, brand-guidelines, internal-comms
- 14 advanced skills (Pro only): video-production, audio-transcription, data-visualization, web-scraping, api-integration, database-query, machine-learning, blockchain-tools, iot-integration, security-audit, performance-profiling, devops-automation, cloud-deployment, code-migration

**Architecture:**
- Multi-tool support with isolated installations
- Each tool has tool-specific optimization flags
- Consistent variant system across all tools
- Centralized package validation

### Fixed

- Package validation for all 12 tool/variant combinations
- Skills directory filtering (excluded README.md from skills list)
- Directory naming consistency (agents/, skills/, resources/, hooks/)
- Path validation with proper tilde expansion
- Integration tests for uninstall, multi-tool, upgrade/downgrade scenarios

### Technical Details

**Installation Capabilities:**
- Average installation time: Lite (10s), Standard (30s), Pro (60s)
- Supports offline installation (no internet required after npm install)
- Atomic operations with full rollback on failure
- Cross-platform support (Linux, macOS, Windows)
- Validation of 486+ files across all packages
- Exit codes for scripting (0=success, 1-6=various errors)

**Package Sizes:**
- Lite: ~510 KB (3 agents, 0 skills, 11 files)
- Standard: ~8.4 MB (13 agents, 8 skills, 29 files)
- Pro: ~9 MB (13 agents, 22 skills, 43 files)

**Command-Line Flags:**
- `--variant` - Specify variant (lite, standard, pro)
- `--tools` - Specify tools (claude, opencode, ampcode, droid, all)
- `--path` - Custom installation path
- `--silent` / `--yes` - Non-interactive mode
- `--config` - Load configuration from file
- `--uninstall` - Remove installed tools
- `--upgrade` - Upgrade to different variant

---

## [1.1.0] - 2025-11-02

### Added

**Session Persistence:**
- `session-start.js` hook - Auto-loads skills on every Claude Code session start
- Startup banner showing loaded agents and skills
- Persistent skills across sessions (inspired by superpowers)

**Documentation:**
- `KNOWLEDGE_BASE.md` - Comprehensive reference (consolidated from 4 files)
- `PUBLISHING.md` - Complete publishing guide
- `UPDATE_VERSION.sh` - Automated version management
- Streamlined `README.md` (70% shorter, focused on quick start)
- Organized all docs under `docs/` directory

**Infrastructure:**
- `.claude-plugin/marketplace.json` - Official marketplace catalog
- npm version badge in README

### Changed
- Agent invocation syntax to lowercase with hyphens (`@feature-planner:` not `@ProductManager:`)
- npx clarification - Clearly states it runs temporarily without installing
- README structure - Now quick start focused, links to detailed docs in `docs/`

### Fixed
- Skill count - Corrected Pro variant from 16 to 14 skills
- Repository URLs - Updated to `github.com/hamr0/liteagents`
- Author info - Updated to `hamr0 <avoidaccess@msn.com>`
- All variant manifests - Added session-start hook

### Removed
- Consolidated `AGENTS.md`, `ARCHITECTURE.md`, `SKILLS.md` into `KNOWLEDGE_BASE.md`

---

## [1.0.0] - 2025-11-02

### Added - Initial Release

**Core Features:**
- 13 specialized agents (Master, Orchestrator, Product Manager, etc.)
- 14 powerful skills (PDF, DOCX, Canvas Design, MCP Builder, etc.)
- 3 variants: Lite (3 agents), Standard (13 agents, 8 skills), Pro (13 agents, 14 skills)

**Distribution:**
- npm package: `liteagents`
- GitHub: `github.com/hamr0/liteagents`
- Direct install: `/plugin add github:hamr0/liteagents`
- npx support: `npx liteagents` or `npx agkit`

**Infrastructure:**
- Plugin manifests for each variant
- Auto-discovery via `register-agents.js` hook
- Variant isolation
- Validation scripts (`validate-package.js`, `validate-references.sh`)

**Documentation:**
- README, QUICK-START, AGENTS, SKILLS, VARIANTS, TROUBLESHOOTING, CONTRIBUTING

---

## Upgrade Guide

### From 1.2.1 to 1.11.0

**No breaking changes.** Added new `/stash` command for session context management.

**New:**
- `/stash` command for saving session context
- Updated command count from 20 to 21

**Action Required:**
- None for existing installations - upgrade is seamless

**To Upgrade:**
```bash
# Via npm
npm install -g liteagents@latest

# Run installer
liteagents
```

---

### From 1.1.0 to 1.2.0

**No breaking changes.** Major new feature: Interactive Multi-Tool Installer.

**New:**
- Interactive installer for Claude, Opencode, Ampcode, and Droid
- 22 total skills (expanded from 14)
- Multi-tool support with isolated installations
- Comprehensive testing suite (254 tests)
- Extensive documentation (INSTALLER_GUIDE.md, VARIANT_CONFIGURATION.md)
- Package validation system

**Action Required:**
- None for existing installations - upgrade is seamless
- **New users**: Use interactive installer (`npm install -g liteagents && liteagents install`)
- **Existing users**: Continue using existing installation methods

**To Upgrade:**
```bash
# Via GitHub
/plugin update github:hamr0/liteagents

# Via npm
npm update liteagents

# Via npx (always latest)
npx liteagents

# New: Interactive installer
npm install -g liteagents
liteagents install
```

**What's Different:**
- Skills count: 14 → 22 (8 core + 14 advanced in Pro)
- Installation methods: Now supports 4 tools (Claude, Opencode, Ampcode, Droid)
- Variant sizes documented: Lite (510 KB), Standard (8.4 MB), Pro (9 MB)

---

### From 1.0.0 to 1.1.0

**No breaking changes.** Features and documentation improvements only.

**New:**
- Skills auto-load on session start
- Consolidated documentation in `docs/` directory
- marketplace.json for distribution

**Action Required:**
- None - upgrade is seamless
- Optional: Use lowercase agent syntax (`@master:` instead of `@Master:`)

**To Upgrade:**
```bash
# Via GitHub
/plugin update github:hamr0/liteagents

# Via npm
npm update liteagents

# Via npx (always latest)
npx liteagents
```

---

## Version History

| Version | Date | Key Features |
|---------|------|--------------|
| **2.4.7** | 2026-02-02 | Enhanced docs-builder skill with reorganization capabilities |
| **2.3.0** | 2026-01-22 | Removed subagent-spawning skill (20 commands) |
| **1.11.1** | 2026-01-20 | Fixed missing commands in opencode.jsonc |
| **1.11.0** | 2026-01-20 | Added /stash command (21 total commands) |
| **1.2.1** | 2025-11-05 | Package optimization, repository cleanup |
| **1.2.0** | 2025-11-05 | Interactive multi-tool installer, 22 skills, 4 tools support, 254 tests |
| **1.1.0** | 2025-11-02 | Session persistence, docs consolidation, marketplace catalog |
| **1.0.0** | 2025-11-02 | Initial release: 13 agents, 14 skills, 3 variants |

---

## Links

- **GitHub**: https://github.com/hamr0/liteagents
- **npm**: https://www.npmjs.com/package/liteagents
- **Issues**: https://github.com/hamr0/liteagents/issues
- **Releases**: https://github.com/hamr0/liteagents/releases

---

**Maintained by**: hamr0
**License**: MIT
