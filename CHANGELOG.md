# Changelog

All notable changes to liteagents will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.0.0] - 2026-09-05

### Breaking
- **Every capability is a skill on Claude Code and Amp.** Claude Code merged
  custom commands into skills (`.claude/commands/deploy.md` and
  `.claude/skills/deploy/SKILL.md` both create `/deploy`, and skills are the
  recommended form), and Amp removed custom commands outright. So
  `packages/claude/commands/` and `packages/ampcode/commands/` are gone, and
  all 13 capabilities ship as `skills/<name>/SKILL.md` in both. The nine that
  are deliberate actions — branch-review, docs-builder, refactor, release,
  remember, security, ship, stash, test-generate — carry
  `disable-model-invocation: true`, so Claude runs them only when you type
  them; the four advisory ones stay auto-loadable. Bundled scripts move with
  their skill. Droid and opencode are unchanged and still use flat commands;
  the mirror converts for them. **Migration:** reinstall; the installer already
  handles a `skills/` directory, and `variants.json` drops its `commands` key
  for those two packages.
- **The ampcode package ships skills, not commands.** Amp removed custom slash
  commands in favour of skills, so all 13 capabilities now live at
  `packages/ampcode/skills/<name>/SKILL.md` — the same shape Claude Code uses.
  `packages/ampcode/commands/` is gone. **Migration:** reinstall the ampcode
  package; the installer already handles a `skills/` directory.
- **`/optimize` is removed; `/refactor` absorbs it — catalog goes 14 -> 13.**
  It duplicated `/refactor`'s job shape (a named target, changed in place, no
  behaviour change) and this repo's history shows it was never once used. A
  targeted `/refactor` now runs a performance pass by default: complexity, N+1
  queries, I/O in a loop, repeated recomputation. The grounding rule survives
  the move — findings are always reported, but only *fixed* with real evidence
  (a profile, a log line, or an obviously hot path); everything else is
  reported as "uncertain, needs profiling data" and the code is left alone.
  `/optimize`'s HITL gates move across too: multiple fix shapes, correctness
  traded for speed, concurrency primitives, schema or response-shape changes.
  **Migration:** use `/refactor <target>`; no flag needed.
- **`trace-back` is merged into `debug-method`, renamed `/root-cause` —
  15 -> 14.** The backward walk is now Phase 1 step 5 of one skill rather than
  a second skill you had to know to reach for. 468 lines across two files
  became 220 in one. `find-polluter.sh` still ships.
- **`tdd-flow`, `test-traps` and `verify-done` are removed — 18 -> 15.** The
  repo's own history showed the rules they carried were already being followed
  without them; they cost context on every session to restate it.

### Added
- **`scripts/mirror.cjs` — the kit packages are generated, not hand-copied.**
  `packages/claude` owns every body; each target file keeps its own
  frontmatter byte-for-byte (that is where the per-kit shape lives — `tools`
  arrays vs permission maps, `Bash(x:*)` vs `Bash(x *)`); the script owns the
  path substitutions between them. `check` runs first in `npm test`, so a
  partial sync can no longer ship. Modes: `check`, `diff`, `sync`, `shapes`.
- **`scripts/frontmatter.json` — the recorded per-kit frontmatter shape.**
  Frontmatter is meant to differ per kit, so it cannot be verified by diffing.
  It is checked against this file instead: required keys, allowed keys, and
  the kit's `Bash()` style. Generated from the real files by `mirror.cjs
  shapes`, never hand-written.
- **`docs/product/INSTALLER_GUIDE.md` gained the order of operations** for
  changing a command, skill or subagent, from validating the bug through the
  mirror, the three checks, the docs sweep and the release calls. Root
  `CLAUDE.md` points at it.

### Fixed
- **Test-count floors realigned.** The Multi-Tool Installation floor was
  lowered 36 -> 33 to match the capability cut (Claude has no `commands/`
  directory now, so the suite counts three categories per scenario, not four),
  and four floors that had drifted below their suites' actual counts were
  raised to match: docs-builder 497 -> 538, friction 254 -> 323, sync-rules
  15 -> 25, stub-check 19 -> 24. Each floor was verified to still fail when
  set one above actual.
- **Command frontmatter was largely invented.** Checked against each tool's own
  docs: `usage:` is not a field in any of the four. Droid commands support only
  `description` and `argument-hint` (tool scoping is explicitly unavailable for
  commands); opencode commands support only `description`, `agent`, `model` and
  `subtask`, and take their name from the filename; Claude Code command files
  ignore `name`. Every unsupported key is removed, so the `allowed-tools` those
  files carried — which did nothing on droid or opencode — is gone. Droid
  subagents lose `when_to_use`, which is not a Factory field; its text is
  folded into `description`, which is what Factory reads for routing.
  `scripts/frontmatter.json` now records the real per-kit schemas and
  `mirror.cjs check` enforces them.
- **Three kits were sending users to the wrong memory directory.**
  `/branch-review`, `/refactor` and `/release` told droid, ampcode and
  opencode users to look in `.claude/remember/` instead of their own
  `.factory/`, `.amp/` or `.opencode/`. Found by the new mirror check.
- **`1-create-prd.md` had silently lost five checklist lines in droid only**,
  from an earlier partial hand-mirror. 22 drifted or missing files were
  restored in total, including `skill-creator/LICENSE.txt`, which its own
  frontmatter cites and which was absent from all three kits.
- **`docs-builder.md` carried claude's `Bash(node:*)` syntax in all three
  other kits**, where the correct form is `Bash(node *)`.
- **Only a symlink that actually leaves the repo counts as an escape.** The
  previous check flagged in-repo links too; mirrored to all four kits.

### Changed
- Six commands and skills that had no `allowed-tools` at all — `remember`,
  `stash`, `brainstorming`, `live-canvas`, `root-cause`, `skill-creator` — now
  declare a `Read, Grep, Glob` floor, so those calls stop prompting. Subagents
  are deliberately untouched: claude and ampcode omit `tools` and so inherit
  everything, droid already lists all three, and opencode's `tools` is a
  write/edit/bash permission map where they are not expressible.
- README and `packages/subagentic-manual.md` rewritten to lead with the
  catalog rather than a pitch.
- Command READMEs live in `docs/product/` and no longer ship inside the
  packages; the live-canvas-channel README moved out too.
- `AGENT_RULES.md` testing standards are stated as principles rather than as
  pytest specifics.

## [3.0.0] - 2026-09-04

### Breaking
- **The `context-builder` subagent is removed — catalog goes 11 -> 10 agents.**
  `docs-builder` supersedes its Tier 2/3 work (creating/splitting `docs/*.md`,
  validated on real corpora; `docs/index.md` via `index-flat` is the sole index,
  same reason `docs/wiki-index.md` was already deleted). Tier 1 (author
  `CLAUDE.md`) was the only unique part, and its one load-bearing invariant —
  `CLAUDE.md` must `@`-include `.claude/remember/MEMORY.md` and nothing else —
  is now a mechanical gate in `stub-check.cjs`, run every `/remember`; a prose
  rule inside a subagent was always the weaker enforcement. **Migration:** for
  the doc-authoring work `context-builder` did, use `/docs-builder`; for a
  cold-start `CLAUDE.md` on a brand-new project, use Claude Code's own `/init`.
  Orchestrator routing's Brownfield workflow now starts at `system-architect`.

### Security
- **`sync-rules.cjs` and `stub-check.cjs` no longer write through a symlink out
  of the repo they were invoked on.** `/remember` runs across a fleet of sibling
  checkouts, so a relative link only has to reach a neighbor. Three routes were
  reproduced and closed: a dangling link at the write target (followed by
  `writeFileSync` as if the file were merely absent), a symlinked parent
  directory (invisible to a leaf-only `lstat` guard), and a symlinked
  `CLAUDE.md` that `stub-check.cjs` rewrote in place with no rename-away step.
  `escapesRepo()` resolves the deepest existing ancestor with `realpath` and
  confirms the write still lands inside the repo, `lstat`-ing the leaf for the
  dangling case; refusal is loud (an `escapes` action / a skip message), never
  silent. Mirrored to all four kits.

### Added
- **`AGENT_RULES.md` is now kept current in every repo, instead of written once and
  forgotten.** `remember/sync-rules.cjs` byte-compares the repo copy against the
  template shipped beside it on every `/remember` run: identical does nothing at all,
  absent copies it in, and a differing body is moved to a single `AGENT_RULES.md.bak`
  before the new one lands. The `.bak` is one file, deliberately — a customised body
  survives exactly one release, so fold your changes in before the next update. This
  replaced a bootstrap-once rule that had left a measured 35 local repos many releases
  behind, after three hand sweeps failed to hold.
- **`remember/stub-check.cjs` asserts the config stub's SHAPE and repairs it.** v2.19
  demoted `AGENT_RULES.md` from an `@`-include to a plain pointer — an `@`-include
  hot-loads ~300 lines into every session — but nothing enforced it, and 21 of 37
  measured repos had drifted back. It also repairs a MEMORY include that is not
  `@<dir>/remember/MEMORY.md`, since a bare `@MEMORY.md` resolves to a nonexistent
  root file and hot memory then silently never loads. It edits only *inside* the
  marker pairs and only the mechanism; the prose in those blocks stays user-owned.
  It will **not** repoint a MEMORY include at a file that does not exist — a repo
  still on the pre-rename `.claude/memory/` layout has a live file at the old path,
  and breaking a working include to satisfy a naming convention is worse than saying
  so.
- **`remember/version-check.cjs` nudges when the installed liteagents is behind.**
  One line in `/remember` step 0, advice only — it never installs. Any failure
  (offline, DNS, timeout) is a silent skip, because a memory command that hangs on a
  network call is worse than one that misses a nudge. The installer now stamps
  `liteagents_version` into its manifest so the check does not shell out to
  `npm ls -g` on every run (measured 502ms -> 113ms warm).
- **The installer says where your backup went.** On a reinstall it now closes with the
  path of every install it moved aside, and notes that an edited `AGENT_RULES.md` is
  preserved in the backup's `remember/` folder. A fresh install's output is unchanged.

### Changed
- **`/remember` reports every write verbatim.** Step 8 relays exactly what
  `version-check.cjs`, `sync-rules.cjs` and `stub-check.cjs` printed, and nothing when
  they printed nothing. Paraphrasing could drop the `AGENT_RULES.md.bak` filename,
  which is the one thing someone who just lost their edits needs.
- **The stub check survives a quiet run.** Step 1's guard stops the run when there are
  no unprocessed stashes and no friction output — which is exactly the state of a
  stale, unattended repo. `stub-check.cjs` now runs before that stop; skipping it on
  quiet runs is how a repo with nothing to remember stayed broken forever.
- **`/refactor` hands the review back instead of chaining it.** Step 6's "commit, then
  run `/branch-review`" read as a sequence to execute; a field run started the review
  off the owner's "commit" and the owner objected. It now states that this is a
  sentence to say, that both are the user's separate calls, and that "commit"/"yes"/"go"
  authorizes the commit and nothing after it.

### Fixed
- Four places stated the memory-include mechanism using the broken bare `@MEMORY.md`
  form, including an anti-pattern table an agent reads before writing the config.
- `poc/friction-file-referents/README.md` claimed everything needed to audit it was in
  the directory. `score.py` reproduces only the LLM-experiment table (Findings 4-6);
  the mechanical-study numbers (Findings 2-3) come from a run whose script was never
  committed. Now stated precisely.

---

## [2.24.1] - 2026-09-03

### Changed
- **The file-referent ledger half is SHELVED — no demonstrated problem.** The v2.24.0
  entry below says shipping the ledger side is "gated on a future exact-label-agreement
  measurement," which implied the work was justified and merely queued. That premise was
  never checked, and it is wrong. The harm this channel prevents — a false match
  inflating an entry's count until a `hot` entry hits `recurred_while_hot >= 2` and has
  its rule rewritten — has never occurred: `ag-001` is the only `hot` entry, its
  `recurred_while_hot` is 1 against a threshold of 2, and its two `attempts` are a
  deliberate August rephrasing rather than a false-match rewrite. A POC also established
  the naive ledger design would not have worked: cluster-level unions collide at 1.8%,
  but entry-level unions collide at **38%**, because an entry accumulates paths across
  every session it matches and inevitably collects `README.md` / `CLAUDE.md`. A
  document-frequency filter repairs it (9.5% at df<=2), but repairing a fix for a problem
  that is not occurring is not a reason to ship. **The incoming half is kept** — it costs
  nothing, adds no LLM step, and accumulates evidence for free.
- **The un-shelve trigger is now checkable rather than a judgement call:** a false match
  observed under a sonnet-class classifier, OR `ag-001` reaching `recurred_while_hot = 2`
  on evidence that is not about validation.
- **And that trigger must NOT be exact-label agreement.** A fourth POC arm with the
  user's quotes stripped from both sides scored best on every stability measure (0.900
  exact agreement, 3/20 unstable) and is plainly the worst arm: it unanimously dropped
  three clusters (`ag-012`, `ag-007`, `ag-001`) that all nine quote-carrying runs matched
  unanimously, and named antigens after session hashes. It wins by having nothing to go
  on and defaulting to `drop`. High agreement on "I don't know" is not quality — the same
  degenerate shape as the severity axis that was seeded and rated on the same signal. A
  re-attempt needs a human-labelled gold set.

### Added
- `poc/friction-file-referents/` — the corpus, all four arm prompts, raw labels from 12
  runs, and `score.py`, which reproduces every table above. Kept so a re-attempt starts
  from the numbers. Outside `package.json`'s `files` allowlist; not published.

---

## [2.24.0] - 2026-09-03

### Added
- **Friction clusters carry file referents through as a second matching signature.**
  `friction.cjs` already computed a `files` list per candidate (74/101 populated on a
  frozen 34-cluster / 101-candidate corpus) but silently dropped it at clustering, so no
  cluster ever saw it. It is now unioned per cluster and capped at 8 sorted paths. Measured
  before building: `preceding` (tool-name sequence + result) gave 13 distinct signatures
  over 34 clusters at 19.3% collision, `tool_sequence` gave 10 at 25.8% — both close to the
  coin flip the existing quote channel already is. File basenames gave 28 at 3.7% on a
  per-candidate join; the per-cluster union does better still: 30 distinct signatures over
  34 clusters at 1.8% collision, 29/34 populated, a 10× reduction against `preceding`. A
  prediction from the design notes turned out wrong in the favourable direction: paths are
  real strings, not a distillation, so the channel needed no LLM judgement step to add.
  **This channel is carried on the incoming side only.** No ledger entry stores `files` and
  step 4a is not shown it, so ledger matching still runs on the single quote channel it
  always has — shipping that half is gated on a future exact-label-agreement measurement,
  documented in `docs/product/antigen-gate-prd.md` §13 and
  `docs/product/remember-README.md` §6.

### Fixed
- **Friction's `preceding.result` read the wrong signal — text-matched `'Exit code 0'`
  instead of the `is_error` boolean.** The text match hit 1 of 2623 sampled result blocks;
  `is_error` is present on 2065 of 2624. Before the fix, `preceding.result` was `unknown`
  on 31 of 34 clusters; after, 18 claimed-success, 4 error, 12 unknown. Cluster hashes are
  unchanged — this only corrects a field that was already there.
- **`docs-builder`'s cleanup output named counts ambiguously.** The advisory now says "N
  file(s) with link rewrites" and the restore step says "restored N inbound reference(s)" —
  the advisory counts files touched, the restore counts the references inside them, and the
  two numbers are not the same unit.
- **`docs-builder` inbound references follow the core page back out of the archive.**
  `cleanup-apply` archives the source, then relocates the core page back to its original
  path. The archive step had already rewritten every inbound reference to point at
  `docs/archive/` — correct at that moment, since the archive was briefly the only copy —
  but nothing walked them back once the core page reoccupied the original path, leaving the
  corpus telling readers the doc lived in the archive while the live page sat unreferenced.
  A third restore step now walks them back. What must *not* be restored is the point of the
  design rather than an edge case: the split's own pages cite the original by line number,
  so their `sources:` and citations stay pinned to the frozen archive copy. Field-reported
  from a real PRD split (33 references across 15 files), reproduced failing-first.

### Security
- **`fast-uri` bumped 3.1.5 → 3.1.7 and `qs` bumped 6.15.2 → 6.16.0** in the
  live-canvas-channel plugin lockfile (Dependabot #43/#44, folded into one commit since
  both edit the same lockfile). `fast-uri` 3.1.7 closes five high-severity advisories:
  authority injection via an unvalidated port in `serialize()` (GHSA-qw65-cvwx-89v3), host
  confusion via unbalanced IP-literal brackets (GHSA-58mr-gqgx-xq4g) and skipped IDN
  canonicalization (GHSA-5jgf-p345-68v8), and SSRF via repeated hostname percent-decoding
  (GHSA-fph4-wmhf-6fwf) and malformed IPv6 normalization (GHSA-f65p-4m7j-42xc). Both
  packages are transitive dependencies of `@modelcontextprotocol/sdk`.

## [2.23.0] - 2026-09-02

### Added
- **`/refactor` gains a no-argument ledger mode.** Bare `/refactor` works through
  `.claude/remember/fix-ledger.md` instead of taking a target: it requires a clean tree and
  a non-`main` branch, revalidates every bullet before fixing anything, drops the ones
  whose anchor no longer resolves, fixes the survivors one at a time under the existing
  no-behaviour-change constraints, and deletes each bullet as its fix lands — so the fix
  commit is the done record and there is no second place to keep it in sync.
- **`/branch-review` gains State ownership as a stage-1 finding category.** Two or more
  functions assigning the same field, flag or view property is a finding on its own, with
  no failing case required. Both writers must be named with `file:line`, since an unnamed
  second writer is a hunch. Ordering counts as well as writers: a write arriving from a
  callback, thread or lifecycle event is the dangerous one, and one app writer racing a
  framework writer still counts as two.
- **`AGENT_RULES.md` — four Build Rules, each naming something observable.** One writer per
  piece of state; split the decision from the machinery, extracting a branch into a pure
  function to pin it with a test rather than to raise coverage; claims in comments must be
  checkable, because a name search proves an edge exists and never that one does not; and
  every line earns its place, meaning if you cannot say what breaks when it is deleted,
  delete it. "Surgical changes only" was rewritten to say what to do with a problem you
  pass on the way: fix it if it is in the code you are already changing and the fix changes
  no behaviour, otherwise report it with what it costs to leave. A problem you do not fix
  goes in the report, never in a comment.
- **`/remember` writes two hot rules inline into the `AGENT_RULES.md` section.** The file
  stays a plain pointer and is never `@`-referenced, since that hot-loads roughly 300 lines
  of standards guide into every session. The section now carries the path plus exactly the
  two rules that change what you type — the ones you cannot look up because you do not know
  you need them.
- **`docs/product/branch-review-README.md`** — reference for the pre-merge gate: the three
  stages, what blocks a merge, the ledger's anchor design, and the review → ledger →
  `/refactor` loop. Follows the existing `remember` and `docs-builder` product-doc pattern.
- **`/refactor` gains a `## Guardrails` block, ported from `/branch-review`.** Spawn a
  worker at your tool's mid tier, stated explicitly on the spawn; escalate anything you
  cannot decide rather than assuming; the worker never sub-delegates; edit only what a
  surviving ledger bullet names, one change per bullet. The three parts that do not
  transfer verbatim were rewritten: "no edits" inverts into a scope rule since `/refactor`
  edits by design, and **the three HITL gates belong to the orchestrator, not the
  worker** — a subagent cannot hold a conversation, so it stops and hands back the options
  with no choice made rather than picking revert/patch/update-test on the user's behalf.
  The blast-radius proof is now two checks: `git status --porcelain` at exit must list
  only bullet-named files, and `md5sum .claude/remember/*` must show only `fix-ledger.md`
  differing — `last-review.md` is off-limits to the fixer, since writing it would forge
  the gate that judges its own work.
- **`docs/product/remember-README.md`** gains a `## 6. Known limitations` section.
  Matching semantics and evidence are the same channel — an entry's `class_hints` are
  fragments of the quotes that proved it, so its identity and its proof of recurrence are
  the same strings — with two consequences pulling in opposite directions: tautological
  matching (bounded, not removed, by session-hash dedup) and over-matching on thin
  ledgers (`Open item 2`). Separately: a run cannot tell that its own work invalidated a
  standing fact, since detecting that would mean re-checking every fact against the
  working tree on every run, which trades a stale fact for a confidently wrong one.

### Changed
- **`/branch-review` writes a durable review record; `/release` reads it.** The reviewed
  SHA previously existed only as prose in a chat message, so `/release`'s Phase 0.5
  precondition resolved to the orchestrator's word — the one party the same paragraph
  declares inadmissible — and vanished on a compaction or a handover. The review now
  overwrites `.claude/remember/last-review.md` with sha/branch/target/verdict/date, and
  Phase 0.5 matches against its `sha:` line. No record, or no `sha:` line, is no review.

  **Migration:** a branch reviewed before this change has no record file, so the new
  Phase 0.5 will correctly refuse it. That is migration, not a bug. Re-run
  `/branch-review`; do **not** hand-write the record, which would turn the durable
  artifact back into the unverified claim it exists to replace.

- **Only reproduced Critical/High failures block a merge.** Everything else is appended
  to a local fix ledger at `.claude/remember/fix-ledger.md`, consumed by bare `/refactor`.
  Re-review after fixes reads `<previously-reviewed-sha>..HEAD` rather than re-judging the
  whole branch, which is what makes a review converge instead of surfacing a fresh nit
  list every run. Style, wording and structure never block; a normative requirement stated
  two incompatible ways still does, since conforming implementations built from it diverge.

- **`/release` Phase 0.5 is the SHA comparison alone.** A ledger-only exception was removed
  rather than kept and narrowed: the ledger is gitignored, so it never reaches a commit
  diff, and scoping a rule to a condition that cannot occur is how dead branches survive
  review. A repo that does track `.claude/` will see a ledger commit make the review stale,
  which is the gate working — re-review, or leave the ledger uncommitted until the release
  is cut.

### Fixed
- **`/branch-review` — a disproved ledger bullet is deleted, and a dead run is not a
  pass.** The append-only rule left nowhere to record that a bullet's stated consequence
  was wrong: editing it broke the rule, and a second bullet read as a second finding. A
  field session hit this and invented an indented sub-bullet. Disproof now deletes the
  line, with the reason going in the report — the ledger is a work list, not an archive.
  Separately, a review that dies mid-flight writes no record, and nothing said whether that
  silence counted as a pass; it does not.
- **`/branch-review` — the review record carries blockers, level and coverage.** Five lines
  proved that a review ran and what it concluded, but not *what* was blocked, so a session
  inheriting a `blocked` verdict had to re-review the branch to rediscover why — the
  non-convergence this command exists to stop, displaced one level up. The record now lists
  one line per blocker (claim only; scenarios stay in the report, non-blocking findings stay
  in the ledger), the effort level, and per-stage coverage. `/release` stops on any stage
  marked `NOT RUN`, since a `ready` from a run that skipped the security stage is a
  different fact. Deliberately absent: any override field — a hash is checkable by anyone
  and consent is not, so a consent line would be forgeable by whatever writes the file, and
  a persisted override would silently cover the next release too.
- **`/release` Phase 0.5 wrote a `verdict:` line nobody read.** The record carried the
  review's conclusion, but the gate compared only the `sha:` line, so a record saying
  `verdict: blocked` passed the mechanical check whenever the hash still matched — leaving
  the conclusion to the orchestrator's recollection, which is the unverified claim the
  record was created to replace. Both lines are now read mechanically; only `ready` plus a
  matching hash is a pass.
- **`/release` — the handoff sequence went from `gh pr create` straight to `gh pr merge`,
  with no wait for CI.** Every gate in the chain runs on one machine: `/branch-review`
  reviews locally, `/ship` runs the suite locally, and `/release` never pushes. CI is the
  only differently-configured instrument, and under this flow it sees the branch for the
  first time *after* both gates have passed. Found in the field: a release merged and
  tagged on green local gates, then failed CI on a test asserting against a path that
  exists only on the author's machine, leaving a tag cut but never published — the exact
  "local ahead of published" state Phase 0 warns about. The sequence now has a
  `gh pr checks --watch` step between create and merge, and merges only on green.
- **`/release` — the exit-code rule applies to the orchestrator's own shell too.** `/ship`
  carried it for the worker, but the handoff steps are typed by hand and were not covered.
  In the same field run, `gh run watch --exit-status | tail -2; echo $?` printed `0` for a
  failed run, turning a red CI into a green reading.
- **`/release` — the docs sweep may fix a line a ledger bullet names, but must not delete
  the bullet.** Calling the sweep the place to "close" a doc-only item made `/release` a
  second deleter of state with exactly one owner, contradicting both the ledger's
  one-append-one-delete split and the one-writer-per-state build rule this release adds.
  The sweep still fixes the line; `/refactor`'s next revalidation drops the bullet.
- **`/branch-review` — the exit-cleanliness check could not see its own target.** The
  guardrail said porcelain must be empty or list only the two allowed paths, but `.claude/`
  is gitignored, so porcelain is empty whether the reviewer wrote those files, wrote
  nothing, or overwrote `MEMORY.md`. `git status --ignored` does not close it either — it
  collapses to the directory, not the files. Porcelain keeps its real job (no tracked file
  changed); an `md5sum` comparison over `.claude/remember/` now covers the two writes.
- **`/ship` and `/branch-review` — exit codes must be read off the bare command, not a
  pipeline.** `$?` after a pipe is the last element's status, so the natural multi-suite
  shape `out=$(cmd 2>&1 | tail -1); echo "exit=$?"` records `tail`'s success for a suite
  that exited non-zero. Found in the field: a check printing "exit 2: prerequisites
  missing" entered the gate as a pass. `${PIPESTATUS[0]}` does not rescue it inside a
  command substitution either.
- **`/branch-review` — ledger dedupe uses plain `grep`, not `git grep`.** The ledger is
  deliberately gitignored and `git grep` searches tracked content only, so the dedupe
  check reported "not found" for snippets sitting in the file and would have re-appended
  every finding on every run.
- **`/branch-review` — ledger bullets are subject to stage 3.** A field run produced a true
  finding whose stated consequence was false. Bullets must now be verified or carry an
  `UNVERIFIED:` prefix so `/refactor` retests before acting.
- **`/remember` — a marker pair already present in `CLAUDE.md` had no rule.** The clause
  covered a missing pair (append it) and the AGENT_RULES exception (leave it alone) but
  said nothing for an already-present MEMORY pair, which is the common case on every run
  after the first. Now: replace its content in place; the AGENT_RULES bootstrap-once
  exception directly below still overrides.
- **`docs/product/branch-review-README.md`** — dropped a stale "five-line record" count.
  The record stopped being five lines once level, coverage and blockers were added.
- **`/refactor` — ledger mode's step 1 caught a dirty tree only after a worker already
  existed.** Step 1 now documents the split: the orchestrator runs the tree check before
  spawning, and the worker re-runs it as its own first act, matching `/branch-review`'s
  Target section.

## [2.22.1] - 2026-09-01

### Fixed
- **`/docs-builder` — the trailing-newline phantom line is dropped from every line count.**
  `text.split('\n')` returns a trailing empty element for any file ending in a newline, so
  `lines.length` was one over the real count. That phantom line reached the index row's "N
  lines" (every row +1), the last H2's line range (one line past EOF), `scan`'s outline.json
  `s`/`e`/`lines`, the ledger's per-file line count, the cleanup cost estimate, and the PARTIAL
  guard (a page one line short of `MIN_PAGE_LINES` passed as complete). Fixed with a
  `splitLines()` helper applied at the 7 counting/bounding sites, deliberately not at the sites
  that map-and-rejoin file text. `docs/index.md` regenerated. Mirrored across all four kits.
- **`/docs-builder` — an empty page now reports PARTIAL instead of crashing `plan`.** A
  regression from the fix above: `splitLines()` returns `[]` for a 0-byte file where the raw
  split returned `['']`, so `pageStatus`'s unguarded `lines[0].trim()` threw a `TypeError` and
  took `plan` down with it. An empty `.md` page is reachable (a touched placeholder, or
  page-writing interrupted). Fixed at the indexing site — 0 lines is the correct count for an
  empty file — so `pageStatus` guards on `lines.length` instead. Mirrored across all four kits.

## [2.22.0] - 2026-09-01

### Fixed
- **`/branch-review` — dirty tree is now a hard stop, not a silent partial review.** The
  staged/working-tree fallback only fired when the earlier step was empty, so a branch with
  both committed and uncommitted changes reviewed the commits and silently skipped the
  uncommitted lines. It now reports the resolved review target and re-checks
  `git status --porcelain` at exit as well as at start, in all four kits.
- **`/release` — Phase 0 no longer commits a dirty tree for the user.** Committing on the
  user's behalf produced a commit made *after* the review, which Phase 0.5 then had no way to
  accept — a dirty tree is now a stop, with the fix pushed back to the user
  (`git add`/`git commit`, re-run `/branch-review`, then `/release`), in all four kits.
- **`/release` Phase 0.5 compares SHAs mechanically instead of asking the orchestrator to
  judge it.** The worker now runs `git rev-parse HEAD` itself and compares it against the
  review's recorded SHA — no recorded SHA, or a mismatch, is a stop, never a "looks close
  enough" pass.

### Changed
- **`/branch-review` — test quality is a stage-1 item.** A test's ability to fail is proven by
  reverting the *source* change outside the repo, not by reverting the test itself; commit
  messages are treated as claims to re-verify, never as evidence on their own.
- **`/branch-review` — the review worker may not spawn sub-workers**, and the verdict line is
  now printed at both the top and the bottom of the report.
- **`/release` — records local vs. published version in Phase 0**, and Phase 3 treats a gap
  between them as the ask-if-ambiguous trigger for picking a version. The release commit made
  in Phase 3 is documented as the one commit `/release` is permitted to make post-review.
  Documents that `gh pr merge` requires an explicit merge-method flag (`--squash` /
  `--merge` / `--rebase`) or it will not merge.
- **`/branch-review`, `/release`, `/stash` — tier guidance no longer self-contradicts.**
  "Balanced default tier" plus "never hardcode a vendor name" resolved, in practice, to
  whatever tier the parent session happened to be running at. All three now say: explicitly
  select your tool's mid tier and state it on the spawn.

## [2.21.1] - 2026-08-30

### Changed
- **`AGENT_RULES.md` template points at `/branch-review`, in all four kits.** Three sites
  still described the pre-2.21.0 topology: Operating Flow §2 and the Security invariants both
  told the agent to run `/security` separately and lean on `/ship` as the security gate, and
  the never-commit-to-`main` safeguard named `/code-review`. They now say: propose
  `/branch-review` (general review plus a full `/security` audit, reports and never fixes),
  then `/release` (which runs `/ship` as the mechanical pre-deploy gate).

## [2.21.0] - 2026-08-30

### Changed
- **`/diff-review` renamed to `/branch-review`, in all four kits.** The command's subject is
  the branch, not a diff — it reads whole files around each hunk, skims `git log` for intent,
  and now runs a repo- and history-scoped security audit — so the old name described neither
  its input nor its output. No command-count change; `/code-review` (Anthropic's plugin
  skill) is untouched.
- **`/branch-review` gains effort levels and a second stage.** `low | medium | high | max`
  (default `medium`) governs the general review's breadth. Stage 2 delegates to `/security`
  and **always runs it in full at every level** — a shallow security pass reads as coverage
  while missing the class of bug that costs the most. Stage 3 verifies adversarially (try to
  break each claim, not confirm it), and **every surviving finding must carry a concrete
  failure scenario** — inputs/state → wrong output, crash, or exposure — or it is dropped.
- **`/branch-review` and `/security` never edit code.** Both previously applied "confirmed and
  unambiguous" fixes directly, which contradicted the gate they are meant to be; `/security`
  also lost `Edit` from its tool list. They report and escalate; fixing is a separate,
  separately authorized action. `/security` behaves identically standalone or as stage 2 —
  only the report's recipient changes.
- **`/release` no longer reviews, and no longer touches the remote.** Review moved out
  entirely (anything that returns a work-list forks into fix→re-review and does not belong
  inside a linear release run). It now gates on a **review precondition**: a review must have
  run at the current HEAD SHA, which makes "all findings fixed" mechanically checkable, since
  a fix commit moves HEAD and staleness forces a re-review. It releases the **current branch**
  only — no branch argument, no branch creation, and on `main` it stops and asks. It runs
  `/ship`, sweeps the docs, bumps the version, commits locally, then **stops and reports the
  remaining push → PR → merge → tag → publish sequence** for a human to authorize.
- **`/ship` is now purely mechanical.** Every item is answerable by running a command and
  reading an exit code. Dropped four code-judgment checks (error handling, authorization,
  rate limiting, data-access scoping) that duplicated `/security` in weaker form, plus the
  "run `/security` before shipping" line. The secrets grep stays, deliberately and with the
  reason stated inline. New evidence rule: record the exact command and exit code; a check you
  did not run is a fail, and **N/A requires a stated reason**.
- **Worker guardrails, in `/branch-review`, `/release`, `/stash` and `/remember`.** The
  mid-tier model rule no longer names vendor models (they drift, and these kits ship to four
  tools); it now says "your tool's balanced default tier" and explicitly excludes the
  cheapest/fastest tier, which measurably degrades on judgment work. All four also carry an
  "escalate, never assume" rule, and `/stash` gains a "write only what the brief contains"
  rule — its subagent expands a brief, which is exactly where fabrication happens.

### Fixed
- `/stash` carried two guardrails about writing minimal code, in a command that writes one
  markdown file.

### Planned
- Community marketplace submissions
- Additional skills for data analysis
- Enhanced testing capabilities
- Performance optimizations

## [2.20.0] - 2026-08-29

### Changed
- **`AGENT_RULES.md` template (all 4 kits): the spec layer now requires the interview to
  happen but leaves its shape free.** PRD is defined as a portal with 5 minimum fields
  (problem & goal, go/no-go, out of scope, modules, open questions) that every POC refines.
- **Four one-sentence execution-order rules (Sequence / Selection / Iteration / Verify) added
  to Operating Flow.**
- **"Build incrementally" replaced by "One module at a time"** (works alone, then connects,
  both proven) and a separate "No fitting to pass" rule, with a matching Red Flag.
- **New safeguard: never commit to `main`** — branch, then propose `/code-review` followed by
  `/release`; merge/release only on a named go.
- **Removed restated content**: the "AI Agent Instructions" section, the "Safety First"
  bullet, the "POC scope" bullet, and duplicated spec/POC prose in the Communication Protocol
  and the CLAUDE.md stub.

## [2.19.0] - 2026-08-26

### Changed
- **`docs/index.md` rows now list each doc's H2 headings, one per line, with a line range.**
  The index is meant to let an agent find and slice-read a section without opening the doc —
  previously each row carried only an H1, a line count, and a link, so an agent still had to
  open the file to find anything inside it. Each H2 line reuses the exact `headings()` +
  `fenceMask()` boundaries `scan` already writes to `outline.json` (no second parser), so a
  heading inside a fenced code block still never appears. Archive rows stay H1-only — an
  archived doc is frozen history, not a live section to route into.
- **`/remember` step 7 self-heals `docs/index.md` every run, not just at reorg time.** Any
  drift `due` reports (new/moved/changed/deleted, not only the >=5-doc DUE threshold) now
  also re-runs `index-flat` — script-only, no model call — so the index stays current between
  full `/docs-builder reorg` passes instead of silently drifting until the next one.
- **`AGENT_RULES.md` demoted from an `@`-include to a plain path pointer.** It was wired into
  CLAUDE.md as `@.claude/remember/AGENT_RULES.md`, which hot-loads the whole file into every
  session even though it's documented as "not hot context" — measured at ~6.5k tokens/session
  of standards prose loaded despite the file's own claim otherwise. `MEMORY.md` stays
  `@`-referenced (it is hot); `AGENT_RULES.md` is now a plain path line, read only when
  designing or building something new.

## [2.18.0] - 2026-08-26

### Changed
- **`/remember`'s antigen step redesigned to classify-then-count.** A 15-repo audit found
  MEMORY.md's Antigens section hand-drifted from the ledger in 14/15 repos and rule-text
  disagreement in 22 entries, root-caused to the model writing the same rule text in three
  places and doing hash/dedup arithmetic in prose. Narrowed the LLM to one classification
  judgment per cluster (`drop` | existing `ag-NNN` | `new:<theme>`); moved everything else —
  hash union, dedup, promotion, rendering, and checking — into deterministic code
  (`friction.cjs count`/`render`/`check`/`migrate-attempts`). Added invariants I6-new
  (render(ledger) byte-equal to MEMORY.md's Antigens section) and I7 (`rule` ==
  `attempts[last].rule`), Guard B (`new:` clusters never merge with each other in the same
  classify batch), and an adopted-date gate so pre-fix evidence can't count toward
  `recurred_while_hot`. `remember.md` rewritten as literal commands to run, not prose to
  interpret. Validated live on 3 real repos; 947 tests passing, mirrored to all
  four packages with 0 non-path diffs.

### Fixed
- **`friction.cjs check` exited 0 when I6-new was NOT EQUAL** — only I7 could fail it, so an
  automated caller saw a pass while MEMORY.md was hand-drifted from the ledger. Now exits 1 on
  either invariant failing. Validated on real backups (zkagent NOT EQUAL → 1, bareloop 8 I7
  mismatches → 1, liteagents EQUAL → 0).
- **`observing`→`hot` promotion in `friction.cjs count` wrote no history line and left
  `attempts[last].adopted` at the candidate date**, so on the next run a conversation from
  before the rule went hot counted toward `recurred_while_hot` — the adopted-date gate was
  comparing against the wrong date. Promotion now appends `promoted to hot (N sessions)` and
  re-stamps `adopted` to the run date. Reproduced and fixed on liteagents' real ag-003
  (unfixed: rwh=1; fixed: rwh=0, gated).
- **`/remember` could append near-duplicate episodes when re-processing already-filed
  stashes.** The Episodes section only ever appended; nothing checked whether a new episode
  covered the same work as one already in the section. Step 4b's episode rule now dedups
  before appending — merge into the existing entry (judged by content, not title) instead of
  adding a second copy. Validated on the exact data that surfaced it: with the old rule, 4/5
  duplicate pairs survived across 5 isolated runs; with dedup, 0/5, and the 10-most-recent cap
  still held. All four packages.
- **A newly-created antigen entry's `rule` text was a literal placeholder string,
  not real content.** `friction.cjs count` wrote
  a hardcoded placeholder string into `rule` and
  `attempts[0].rule` for any brand-new `ag-NNN` entry, and `render` printed it verbatim into
  MEMORY.md — so the placeholder could land in a user's actual memory file. The 4a classifier
  now emits the one-line rule text alongside a `new:<theme>` label in the same judgment (no
  new LLM pass): `{cluster_index: {label: "new:<theme>", rule: "..."}}`. `count` accepts both
  this shape and the old bare-string shape (bare stays valid for `drop`/`ag-NNN`, and for
  `new:` clusters with `sessions < 2`, which never create an entry). A `new:` cluster with
  `sessions >= 2` and no rule is reported as malformed and creates nothing — never falls back
  to placeholder text. All four packages; 947 tests passing.
- **friction's severity axis was degenerate — every cluster it ever emitted was severe.**
  Clusters are seeded only on an observed reaction (`user_correction`, `user_curse`,
  `interrupt_cascade`), and the severe test accepted all three of those same signals, so the
  thing required for a cluster to exist also made it severe. Measured 69/69 severe on the real
  corpus (3170 sessions, 77 projects) and 66/66 on the privcloud fixture. The documented
  recurrence × severity 2×2 was therefore a 1×2 on recurrence alone: `fact` (recurring + mild)
  and `drop` (one-off + mild) had never once fired, and every one-off "no, do X instead" was
  labelled an `episode` — 68 of them in a single `/remember` run. Severe now means intensity:
  a curse, an interrupt cascade, or a tool error corroborating the reaction; a plain
  correction is mild. Re-run on the same corpus: 69 → 31 clusters, all 38 dropped were
  correction-only with no curse/interrupt/error. Regression fixture (i) plus a new assertion
  on (h) (13 plain corrections → `fact`, not `antigen`) observed failing on pre-fix code;
  five dedup fixtures gained a curse word so they stay observable. All four packages.
- **Review of both specs against their scripts found 24 more defects; each was reproduced,
  approved, and then fixed one at a time by a delegated agent with a failing-first test.**
  docs-builder script: `apply-reorg` wrote a config pointer to a `docs/index.md` that
  `index-flat` had just declined to write (now skipped with a message); its results JSON
  reported `claudeMdUpdated: false` because it printed before the flag was set; `discover` on
  an already-sorted corpus told the operator to run a classification interview on a 0-row
  plan; the usage string omitted `cleanup-apply`; and JSON state (`docs/.docs-builder/*`)
  resolved against the cwd while `index.md`/ledger/config resolved against `REPO`, splitting
  the state when run from anywhere but the root — `ARTIFACTS` now resolves under `REPO` at
  the one chokepoint, explicit `OUT=`/path args unchanged. friction: when analyze found no
  sessions it fell through to extract on the PREVIOUS run's `friction_analysis.json`, exit 0,
  clobbering `antigen_clusters.json` to empty — the no-input case now returns a distinct code
  (2; 1 was already the verdict) and stops. docs-builder spec: commands now `cd` to the target
  root and call the script by absolute path (`$DB`), every `REPO=<repo>` prefix dropped (they
  also never matched `allowed-tools: Bash(node:*)`); neither picker flow ever stamped the
  ledger, so `due` said NOT due forever — both end with `ledger` after the commit; Modes table
  pointed at a nonexistent "step 4"; empty follow-up list had no instruction; two stale
  `docs/README.md` refs and "fifteen subcommands" (fourteen). remember spec: step 7 called
  `docs-builder.cjs` cwd-relative (MODULE_NOT_FOUND on every repo but this one) and relayed
  `due`'s "run ledger" advice that step 7 itself forbids; the `antigen_review.md` fallback has
  no `session_ids`, so 4c would have counted every re-scan as recurrence (no counting on that
  path now); the migration clause re-fired every run on an entry that matched nothing; the
  early-stop condition depended on 4c's own output; step 5 rendered legacy 1-session
  `observing` entries; three wrong step cross-references; "recursively" was two levels.
  Also: both test suites leaked every `mkdtemp` dir (~1,000 per docs-builder run) until
  `/tmp` ran out of inodes mid-session — both now remove them on exit (`KEEP_TMP=1` keeps).
  Not changed, flagged as a design call: a friction `fact` (3+ sessions, mild) writes straight
  into hot Facts with no ledger stage while an antigen needs 5 — reachable for the first time
  since the severity fix.
- **`/docs-builder` could not find its own script outside this repo.** `docs-builder.md` wrote
  every command as `node docs-builder/docs-builder.cjs …` without saying that path is
  relative to the command's own directory (`~/.claude/commands/`), so on an external repo the
  model searched the target tree, found nothing, and refused to run. Added the same "locate
  the script first" step `remember.md` already has for `friction.cjs`. All four packages.

- **`/remember` step 4b routed a one-off severe friction cluster to "an Episode" that has no
  home.** The Episodes section is stash-fed and capped at 10, and 4c already refuses a ledger
  entry for a 1-session cluster — so the instruction contradicted the rest of the command and,
  post-severity-fix, would have asked for ~30 cross-project one-offs to flush the stash
  episodes. 4b now says what 4c already implied: a one-off is written nowhere; friction
  re-surfaces it every run until it recurs, and at 2 sessions it gets a ledger `observing`
  entry. Step 8's "facts should not grow by the number of new facts" expectation was reworded
  too — measured on bareloop at steady state (273 facts, mean 131 chars, 0 near-duplicates)
  the compressor correctly shortens nothing, and the old wording invited forced merges.
  All four packages.

## [2.17.1] - 2026-08-25

### Fixed
- **`AGENT_RULES.md`'s table of contents linked to an anchor that does not exist** in the
  droid, opencode and ampcode kits. Entry 9 pointed at `#claudemd-stub` while the heading it
  names is `## AGENTS.md Stub` / `## AGENT.md Stub` — anchors `#agentsmd-stub` /
  `#agentmd-stub`. The per-tool rename substituted the visible heading text and the link
  label and left the anchor on the claude spelling, so the link was dead in three of four
  kits. Claude's was correct and is untouched. Cosmetic, but it is the mention-form this repo
  already has a rule about: a rename sweep must cover every form, and an anchor is one. Every
  TOC anchor in all four copies was audited against every heading; this was the only
  mismatch. Found while diffing the agentic-toolkit mirror, which carried the correct anchor
  and the *wrong* settings path — each side right about a different line.

## [2.17.0] - 2026-08-24

### Added
- **docs-builder v3 — the model sorts a corpus into four buckets, behind an approval gate.**
  v2 could only move a file a mechanical rule already recognised; everything else stayed put.
  v3 has `discover` *propose* a bucket per file (`product` / `logs` / `archive`, with
  `oversized` as a separate boolean flag, not a bucket) and stop — a classification interview
  fills in `bucket`, and only then does `apply-reorg` move anything. The risk was never the
  model's judgement, it was a silent move; so the gate is the fix, not a better heuristic.
  `reconcile`, `due` and `archive-cleanup` folded into the `reorg` front door — `due`'s output
  contract is preserved because `/remember` step 7 reads it.
- **`cleanup <file>` — splitting is opt-in and per-file.** It measures, prints the cost, and
  stops for an interview; `cleanup-apply` runs only after `labels.json` exists with exactly
  one `core:true` theme. The core page keeps the original basename and lands back in the
  original document's own directory; only non-core theme pages stay under `docs/wiki/`. The
  original is always archived byte-identical (sha verified before and after), never edited.
- **`search`** — zero-dependency BM25 over the corpus. Measured against reading the split
  corpus whole on real data: a **tie** (~73K tokens either way), so splitting is justified by
  recall, not by cost — the README says so rather than implying a saving that isn't there.
- **The first behavioural test suite this tool has ever had** — 472 tests in throwaway git
  repos, including negative controls that assert the gates can actually fail. It was written
  after four rounds of hand-found bugs kept recurring with nothing in the repo able to catch
  them. `tests/run-all-tests.js` now treats `expectedTests` as an enforced floor: a breach
  exits 1 (it used to print the number and pass regardless).

### Fixed
- **One chokepoint for a doc move, and all three of its guards now live there.** `moveDoc` is
  the single path a doc changes location through. Three defects, each reproduced against the
  shipped script before being fixed: a plan row containing `../` could move — and **delete** —
  a file from outside the repo via the copy+unlink fallback; `archive README.md` archived the
  README because `PROTECTED_NAMES` was enforced at two call sites but not at the chokepoint;
  and `cleanup-apply` died mid-split because `archive()` called `process.exit(2)` on a
  follow-up failure while running in-process, leaving the original archived, the core page
  stranded, and no index — silently. Path confinement and the protected-name check now sit in
  `doArchive`; `archive` split into `archiveOrThrow` plus a CLI wrapper.
- **One index.** The themed per-split index used to write the same path as the whole-corpus
  map: on a real corpus a split's index step overwrote a 37-row map with its own 7 rows, and
  the file still claimed completeness. `index-flat` is now the sole writer of `docs/index.md`;
  the themed variant was removed outright.
- **`FROZEN` dropped from the archive trigger words** — on a real 37-file corpus it caused
  ~10 of 12 archive calls to be false positives, because in that corpus `FROZEN` means
  "locked, still current". Precision over recall, with no replacement heuristic.
- **Relative links are rewritten when a file moves**, fence-aware *and* inline-code-span-aware
  for the relative passes (a `` `map[key](arg)` `` span was being corrupted into a link), and
  inbound-link repair now covers untracked-but-not-ignored files — a split's brand-new pages
  were invisible to it before.
- **The commit advisory prints one recipe per run that actually runs.** It used to name files
  at their pre-move paths (`git add` is atomic — one stale pathspec exits 128 and stages
  *nothing*), print once per internal step, and omit files the run itself generated, including
  `docs/log.md`. Found on a cold field run where the operator quietly hand-repaired it.
- **`/remember`: one conversation counts once.** A fork or resume writes the same conversation
  to several session files, and the ledger was counting files — an antigen rendered "3
  sessions" that was really one conversation. Sessions are now unioned on shared message
  uuids (`sessions` is authoritative; `session_ids` is evidence), reactions deduped on
  (conversation, anchor timestamp, anchor signal), and the scan restricted to anchor-bearing
  sessions — 84.1s → 53.0s per run on the real corpus with identical clustering.
- **`/remember`: the ledger seeds only on recurrence.** New entries are minted at `sessions
  >= 2`; three prior runs had produced 30 / 0 / 10 singleton entries. Quiet runs now also run
  the length-gate check before the "nothing to consolidate" exit, and that gate's exemption is
  mechanical (a >100-char backtick literal) rather than a judgement call the model could talk
  itself past.
- **`friction.cjs` skips task-notification blocks** in both signal detection and context
  capture — their boilerplate was matching as false curses/corrections — and warns on stderr
  when a uuid's fan-out exceeds the cap instead of dropping the union silently.

### Changed
- **`/remember` now compresses hot memory instead of accumulating it.** `MEMORY.md` is loaded
  into every session, so its size is the cost that matters — and both Facts and Episodes were
  append-only, so it only ever grew. Four changes, all in the command spec (no script):
  - **Facts are rewritten every run, not appended to.** The merge step returns the whole
    section rewritten — new replaces old, near-duplicates fold into one line, and anything
    that can be shorter is made shorter. A fact is now **one line, ≤160 chars, stating a rule
    that changes future behaviour**: current truth only, no version history, no `supersedes`,
    no narrative. Events belong in episodes. Nothing is pruned on age — an old rule that still
    holds must never be dropped for being old; the bar sits at *entrance*, not on a timer.
  - **Episodes keep the 10 most recent; older ones are folded, then deleted.** An aging
    episode's *lesson* is handed to the fact rewrite, then the narrative is removed. No
    archive file: git holds the history, and a file that is never loaded is not memory.
  - **Stashes are batched, ≤5 per agent, using as few agents as possible.** One agent reading
    several sessions sees a lesson recur and writes it once; one agent per stash writes it
    once per stash and leaves the merge to catch the duplicates. Fewer agents, better
    extraction, less to dedup downstream.
  - **A mechanical length check runs in the report** — a one-line `awk` naming every fact over
    the cap. It reports; it never fails the run and never hand-edits. Counting is a script's
    job, compression is the model's: on this project model-driven bookkeeping measured **27%**
    reliable against **~100%** for the same work done mechanically.

  Measured on this toolkit's own bareloop corpus: `MEMORY.md` **168 KB → 48 KB** — 348 facts
  averaging 254 chars became 249 averaging ~130, and 73 episodes became 10. Roughly **30k
  tokens off every session** in that project. Antigens and the 10 retained episodes came
  through byte-identical.

  Mirrored across all four packages; `docs/product/remember-README.md` updated to match.

## [2.16.0] - 2026-08-22

### Added
- **`/docs-builder` with no argument now asks instead of guessing.** It runs `due` for
  context, then offers exactly three options via `AskUserQuestion` — **First run** (sort the
  whole corpus, then split what's too big), **Docs drift** (rebuild index, re-run lint,
  nothing moves), **Clean archive** (destructive prune). Passing an argument skips the
  question, so the flow stays scriptable. Same explicit-over-auto-detect call `live-canvas`
  made: the three modes differ in cost and destructiveness, so a wrong guess is expensive in
  one direction and irreversible in the other. "First run" carries two stops — one guarding
  correctness (review the classification before anything is `git mv`'d), one guarding cost
  (see the oversized list and its price before any split runs).
- **docs-builder v2** — rebuilt so the *script* does the bookkeeping and the model does only
  synthesis. New `docs-builder.cjs` with `scan`/`propose`/`assign`/`validate`/`plan`/`write`/
  `index`/`search`/`archive`/`lint`/`ledger`/`due` subcommands, plus **Mode 0 reorg**
  (`discover` / `apply-reorg`) that classifies a whole corpus into product / archive /
  oversized instead of one file at a time.
- **`/remember` step 7 — docs reconcile check (detect only).** Runs `docs-builder.cjs due`,
  crash-isolated like the friction step; nudges at >=5 changed docs and never edits a page.
  Now present in all four packages.
- **`search`** — BM25 ranking over the doc corpus, with `N` result clamping.

### Changed
- **docs-builder moved from a Claude skill to a Claude command** — Claude Code is now
  11 subagents + **8 skills + 10 commands** (was 9 + 9). The other three tools keep 18
  commands; only the docs-builder entry's description and usage changed.
- **docs-builder v2 mirrored to droid / opencode / ampcode.** `docs-builder.cjs` hardcodes
  no tool paths, so it is byte-identical across all four packages; only the command doc's
  config-file reference differs. (`friction.cjs`, by contrast, does hardcode tool paths and
  stays per-package.)
- **Per-tool config filename swept through the non-Claude packages.** `CLAUDE.md` ->
  `AGENT.md` (ampcode) / `AGENTS.md` (droid, opencode) in the `quality-assurance` agent, the
  `context-builder` catalog row, the `AGENT_RULES.md` stub section, and `friction.cjs`'s
  recommendation output. The `docs-builder` never-move list still names all three on purpose
  — the code protects every variant regardless of which tool is running.
- Removed the stale v1 `docs-builder/templates.md` from the three non-Claude packages.

### Fixed
- **Reorg could move files it promised never to move.** The never-move list is now enforced
  in code (`PROTECTED_NAMES`), matched at **any depth** rather than only at the top of
  `docs/`: `README.md`, `index.md`, `log.md`, `CHANGELOG.md`, `LICENSE.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`,
  `AGENT.md`. Previously a `README.md` one directory down was a move candidate.
- **Reorg walked into dot-dirs and `node_modules/`.** `walkMd` now skips every dot-dir
  (`.git/`, `.github/`, `.claude/`, `.factory/`, `.opencode/`, `.amp/`, `.docs-builder/`)
  and `node_modules/`, matching what the command doc already claimed.
- **`REPO` vs cwd path split (8 fixes).** `rewriteArchivedPath`, `checkCitations`' tasks dir,
  `failures.json`, and `applyReorg`'s plan path all resolved against `REPO` while their
  writers wrote cwd-relative. Running from outside the repo silently no-opped the archive
  key-sync, LOUD-SKIPped the citations gate (so `validate` returned PASS on bad citations),
  split the failure ledger across two directories, and made `apply-reorg` die right after a
  successful `discover`. All now resolve cwd-relative.
- `logOp` creates `docs/` before appending to `log.md` (was ENOENT, masked only by call order).
- `bm25Rank` skips and warns on a missing source file instead of dying with a raw ENOENT.
- `search` clamps `N` to a positive integer (`N=-3` silently dropped the last 3 results).
- `friction.js` -> `friction.cjs` in all four packages — a `.js` file fails to load via
  `require()` in any repo whose `package.json` declares `"type": "module"`.
- Command-doc examples for `validate`, `plan`, and `search` now include `REPO=<repo>`.
- **`/docs-builder` showed no argument hint.** Its frontmatter had `usage:` but not
  `argument-hint:` — the key Claude Code actually renders — and no `allowed-tools:`, while
  every sibling command had both. Added in all four packages, with `AskUserQuestion` in the
  tool list so the new mode picker can run.
- **`/docs-builder` did not load on opencode at all.** `opencode.jsonc` registered it as
  `./command/docs-builder/SKILL.md` — a path that never existed in that package (opencode
  uses a flat `docs-builder.md`, like every other command). Now points at the real file, with
  the v2 description.
- Removed a stale `subagent-spawning` entry from `opencode.jsonc` — the command file was
  deleted long ago but stayed registered. opencode.jsonc now registers exactly the 18
  commands and 11 agents that exist on disk.
- `AGENT_RULES.md` footer pointed at `.claude/memory/AGENT_RULES.md`, a location that no
  longer exists (the dir was renamed to `remember/`). Now the correct per-tool path in each
  package. Only affects newly bootstrapped copies — an existing project-local
  `AGENT_RULES.md` is user-owned and never overwritten.

### Removed
- **Guardrails section dropped from `AGENT_RULES.md`** (all four packages). It documented a
  `PreToolUse` hook and pointed at `.claude/hooks/guardrails.py` as "ships in this repo" —
  the file never shipped here. The section was also Claude-Code-only: droid, opencode, and
  ampcode have no hook system, so it was unusable guidance in three of four packages. The
  Always / Ask / Never rules it justified stay, restated as binding prose plus a pointer to
  mirror them into whatever allow/ask/deny list your tool provides.

### Documentation
- `subagentic-manual.md` catalog corrected — it claimed Ampcode shipped a `skills/` directory
  (it does not) and under-counted Droid/OpenCode at 17 commands. All four platforms ship
  11 subagents; only Claude Code splits capabilities into skills + commands.
- `package.json` description 17 -> 18 commands (drives the installer banner), root
  `CLAUDE.md` 20 -> 18.

---

## [2.15.3] - 2026-08-04

### Security
- Merges Dependabot #29/#28: hono 4.13.0 (closes residual moderate ReDoS,
  GHSA-8j4g-w8fx-2239), ip-address 10.4.0 (3 high SSRF/trust-boundary
  advisories). Also applies `npm audit fix` for fast-uri 3.1.5 (high,
  GHSA-7p8r-x3mc-p8w7) — flagged by audit but not yet proposed as a
  separate Dependabot PR. Transitive deps of the bundled live-canvas-channel
  plugin's MCP SDK; unreachable in its stdio server. Plugin audit: 3 → 0
  vulnerabilities. 138 root tests green.

## [2.15.2] - 2026-07-24

### Security

- **Cleared the last plugin audit finding via an `overrides` pin: `@hono/node-server` → 2.0.11.** The advisory [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) (moderate, Windows-only serve-static path traversal) is patched only in `@hono/node-server@2.0.5`+ — a **major** bump. The plugin's `@modelcontextprotocol/sdk@1.29.0` (latest) pins `@hono/node-server: ^1.19.9`, a `1.x` range that can never resolve to the fix, so `npm audit fix` couldn't clear it (upstream tracked in [modelcontextprotocol/typescript-sdk#2531](https://github.com/modelcontextprotocol/typescript-sdk/issues/2531), still open). Added the community-confirmed `overrides` block to the plugin's `package.json` forcing `@hono/node-server` to `^2.0.11` within the SDK subtree. Plugin `npm audit` is now **0 findings**. The path was already unreachable here (stdio server, no `@hono/node-server`/HTTP-transport usage); this just removes the audit noise. Note: `@hono/node-server@2.x` needs Node 20+, but the plugin never loads it, so its own `>=18` runtime floor is unchanged. 138 root tests green; remove the override once the SDK widens its range.

## [2.15.1] - 2026-07-24

### Security

- **Bumped the bundled `live-canvas-channel` plugin's transitive deps to patched versions.** `fast-uri` 3.1.2 → 3.1.4 (clears a **high**-severity host-confusion advisory), `body-parser` 2.2.2 → 2.3.0 (DoS via a silently-disabled size limit), and `hono` 4.12.25 → 4.12.31 (moderate). These come in via the plugin's `@modelcontextprotocol/sdk` and ship in the tarball's `package-lock.json`. All sit on unused transport paths — the plugin server is stdio (`StdioServerTransport`) + raw `node:http`, with no `@hono/node-server`/express/Streamable-HTTP surface — so this is defense-in-depth hardening of the bundled lockfile, not a runtime fix. `npm audit` in the plugin drops from 4 findings (incl. 1 high) to 1 residual moderate (`@hono/node-server` serve-static), which is gated on the MCP SDK's own dependency range and has no upstream fix yet. 138 root tests green.

### Fixed

- **Publish workflow pinned to `npm@11` — npm 12.0.0's `npm publish --provenance` is broken.** The job ran `npm install -g npm@latest`, which started resolving to npm 12.0.0 (released 2026-07-09) on the Node 22 runner. npm 12's `libnpmpublish` provenance code does `require('sigstore')`, but the tarball bundles only the `@sigstore/*` scoped packages — so `--provenance` dies with `MODULE_NOT_FOUND` and the publish fails outright. npm@11 bundles `sigstore` and publishes fine. Pinned to the major rather than floating on `@latest`. Revisit once npm ships a provenance fix. CI only — no runtime or published-artifact change.

### Changed

- **Agent/IDE scratch is gitignored and de-tracked (`.claude/`, `.litectx/`, `.idea/`).** Per-machine agent and IDE state is no part of the package — it regenerates locally and only added noise and churn. Now ignored, and any already-committed copies removed from tracking (local files kept on disk). Functional dot-paths (`.github/`, `.gitignore`, `.npmignore`, `.mcp.json`) stay tracked. Repo hygiene only.

---

## [2.15.0] - 2026-07-13

### Changed
- `/stash` delegates the write-up to a mid-tier-model subagent, dispatched in the background
  where the tool supports it, instead of writing inline on the top-tier session model —
  drafting stays inline (only the running session has conversation context), but formatting
  and file I/O move off the main turn. Falls back to inline writing if subagent/background
  dispatch isn't available.

---

## [2.14.1] - 2026-07-10

### Changed
- **`/remember` extraction is parallel and model-agnostic.** Step 2's per-stash extraction
  calls are now spawned as concurrent subagent calls instead of one at a time. Every
  hardcoded `sonnet` mention (steps 2, 3, 4a) is replaced with "the mid-tier model" — a new
  Guardrails note explains the intent (capable of semantic judgment, cheaper/faster than
  your top reasoning tier; Sonnet is the Claude example, not a requirement) so the
  instructions work unmodified across Claude/opencode/ampcode/droid regardless of which
  models each tool has configured. Identical across all four packages.

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
