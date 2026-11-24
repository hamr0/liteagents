# One full test run per code change — gates run it, coding does not (transient PRD)

Date: 2026-11-24. Rewritten each round. Branch: feat/test-reuse.

## 1. Problem

The owner's rule: one full suite run per code change. The field does not follow it.

- Field tests in beeperbox counted 2-4 full runs per code change. Later runs hit 2 at the same sha: `/self-review`'s `works:` step re-ran the full suite although the decider said `REUSE`.
- This branch has 5 fix commits for it: the `green:` line, `/refactor` writes `green:`, commit-first, decider prints its reason, then an unfixed `works:` re-run. Each added prose. A worker skipped each one next time.
- Root cause: the full suite has many owners. Workers, orchestrators, `/refactor` and normal coding all run it, and any of them writes `green:`. That breaks "one writer per piece of state". Five patches on one spot breaks "don't patch a patch".
- Separate: a worker-side ledger anchor check (`grep -cF` = 1) in `/self-review` was half-followed. The orchestrator's identical check worked every time.

## 2. Decision (the owner's design)

The full suite is a review-gate matter. Gates run it. Coding does not.

- **Coding** (workers, orchestrators, `/refactor`, normal work) runs targeted tests only, for what changed. It never runs the full suite and never writes the proof line. Targeted runs are never recorded and never count as proof.
- **The 3 gates** (`/self-review`, `/branch-review`, `/release`) each run the existing decider one-liner, unchanged. It prints `REUSE` if the recorded sha is an ancestor of HEAD and only docs changed since (regex `^(docs/|[^/]+\.md$)`), else `RUN (<reason>)`.
  - `REUSE`: cite the proof. Run nothing. That includes no `works:` re-run of the full suite.
  - `RUN`: run the FULL suite once on the clean committed tree (every gate stops on a dirty tree). Then write the proof line `green: <full sha> <cmd> exit 0 <totals>` to `.claude/remember/last-review.md`.
- Testing starts at `/self-review`. `/branch-review`: docs only since the proof, no run; code changed, full run #2 and a new proof. `/release`: same check; it runs tests only if something changed between the gates, else it skips and uses the last proof. Docs are excluded.
- Several writers is fine. All writers are gates following one rule, stated once.
- **Where the rule lives:** one place, the DEV_RULES block in `AGENT_RULES.md` (loaded in every repo). The POC-first sentence becomes "Gates run the full suite; coding runs targeted tests only". The 3 gate skills and `/refactor` point to it. They keep only their must-fill output slot and the decider line.
- The ledger anchor uniqueness check stays with the orchestrator. The worker-side copy in `/self-review` goes.
- Plain sh + git, works in bash and zsh. No new script. No node dependency. Language-agnostic and cross-CLI.

## 3. Go/no-go (module 0)

A field run in beeperbox: `/self-review` → a code commit → `/branch-review` → `/release`. Count full-suite runs per code change.

- Pass: exactly 1 full run per code change. All by gates. 0 by coding work. 0 duplicates at the same sha.
- The test can fail: the baseline was 2-4 runs. Any coding-side full run, or a second run at one sha, is a fail.
- Run it on a pre-change snapshot first to confirm the count is really 2-4 there. Do not clone after the fix commit.
- If it fails, the design is wrong. Do not add a sixth patch. Stop and redesign.

## 4. Out of scope

- "Affected tests only" and test-impact selection for multi-hour suites. Solo-dev scope. "If we get asked we change."
- A new script or helper for the proof line. A node dependency.
- Changing the decider one-liner or the docs regex.
- Recording or counting targeted runs.
- Enforcing "coding never runs the full suite" mechanically. It is a rule in DEV_RULES. A hook is a different feature.

## 5. Modules (build order)

0. Go/no-go field run, before and after (section 3). The after-run closes the branch.
1. **DEV_RULES rewrite.** One sentence replaces the POC-first "One full test run per code change…" sentence in `AGENT_RULES.md`. Claude package first.
2. **Gate skills point to it.** `/self-review`, `/branch-review`, `/release` delete their duplicated prose, keep the slot and the decider line. `/self-review`'s `works:` is targeted checks only, never the full suite (decision 4). `/release` writes the proof on `RUN`, as `/branch-review` does (decision 2).
3. **`/refactor`: targeted only.** Delete the post-commit full run and the `green: written` slot (decision 3).
4. **Delete the worker-side anchor check** in `/self-review`. The orchestrator's check stays.
5. **Tests.** Update pins in `tests/skill-shell/test-reuse.test.js`. Remove or invert the pin of each deleted rule. Fail-first proof: run each new pin against the old text and see it fail.
6. **End of branch.** `node scripts/mirror.cjs diff`, then `sync && check`, to droid, ampcode, opencode. Restore the two loosened cross-kit pins in `tests/skill-shell/skill-shell.test.js` (~976 and ~1429) to full text. Sweep the new `AGENT_RULES.md` to all project copies (45 per the owner; the 2026-09-18 sweep counted 49). Bump `~/.claude` and its manifest stamp.

## 6. What gets deleted (build checklist)

`packages/claude/skills/remember/AGENT_RULES.md`, DEV_RULES, POC-first bullet:
- "One full test run per code change: before committing run only the tests for what you changed, commit, then run the full suite once on the clean tree — review skills reuse that run, and a full run on a dirty tree is wasted." Replace with "Gates run the full suite; coding runs targeted tests only."

`branch-review/SKILL.md`, Stage 1:
- Replace the "Run the typecheck/build yourself, and the test suite once per code change by running this line as printed — `REUSE` → … `RUN (…)` → …" sentence with a pointer plus the decider line. Keep "copy the printed reason into the `tests:` line". Keep the timeout and exit-code advice only if DEV_RULES does not carry it.
- The whole "**Who writes `green:`:**" paragraph: "any full-suite run that exits 0 on a clean tree at HEAD — a worker's, or the orchestrator's own re-run …", "When the passing run was a worker's, the orchestrator writes `green:` from that run's cited command and totals, without re-running", and "**Commit first, one full run after:** a worker that changes code runs only scoped tests…". Replace with the gate-only rule: on `RUN`, write `green:` after the one full run. Keep "Replace the old `green:` line (`grep -v '^green: ' …`), never touch another line".
- Record template line "`green: <this run's suite …> — written by /self-review or /branch-review, whichever last ran a green full suite`": reword to "written by the gate that ran the suite".

`self-review/SKILL.md`:
- Worker header: "the regression check is always the **FULL** suite, never scoped". Rewrite: the worker runs the decider; the gate rule says what to do.
- "**Does it work?** Run the thing/tests now; cite the command and numbers." Make it targeted only, and never a full run on `REUSE`.
- "Same rule as `/branch-review` Stage 1: `REUSE` → cite the green sha and totals; `RUN (…)` → run the FULL suite once, copy the printed reason into the `full-suite:` line…, and a failure that passes when run alone is re-run alone…": cut to a pointer to DEV_RULES. Keep the decider line and the `full-suite:` slot.
- "Before reporting an anchorable item, run its snippet's `grep -cF` check (§3 Anchor rule) and see 1; else pick a longer snippet or a nearby unique line." Delete (worker side). Keep §3's orchestrator "**Anchor rule:** a verbatim snippet `grep -F` finds exactly once…".
- "`green:` is written per `/branch-review` Stage 1 ("Who writes `green:`") by any passing full run, not only this one": rewrite to: this gate writes it after its own `RUN`.

`release/SKILL.md`, `tests:` line:
- "run the project's real test command once, … in Phase 1": point to DEV_RULES. Add the proof write on `RUN`. Keep the `reused` vs `RUN (` stop and the `ran` vs `REUSE` warning.

`refactor/SKILL.md`, "After the refactor":
- Step 4, "**Orchestrator: review, commit, then one full run.** … run the full suite once on the clean tree at HEAD — it verifies the worker and writes `green:` per `/branch-review` Stage 1 … Never run it before the commit." Delete the step.
- Step 2: keep "scoped tests only … never the full suite", but cite DEV_RULES instead of restating.
- Report slot `green: written <sha> | not written: <reason>` and the paragraph "The `green:` line is filled by the orchestrator from its post-commit full run … `not written: uncommitted`, and whoever commits then follows that rule." Delete.
- `tests: <cmd> exit <code> <totals> (scoped | full)`: drop `| full`.

`tests/skill-shell/test-reuse.test.js`:
- Line ~127 pin "Who writes `green:`…any full-suite run…". Replace with the gate-only rule.
- Line ~130 pin `green: written <sha> | not written: <reason>` and "Who writes `green:`" in `/refactor`. Invert: must be absent.
- Line ~132 pin "self-review: worker checks snippet uniqueness". Invert: must be absent.
- Line ~136 pin "Commit first, one full run after…". Delete or replace.
- Line ~138 pin "Orchestrator: review, commit, then one full run" and "Never run it before the commit". Invert.
- Line ~149 pin "the orchestrator writes `green:` from that run's cited command and totals, without re-running". Delete.
- Line ~154 pin on the DEV_RULES "One full test run per code change…" sentence. Replace with the new sentence.

`tests/skill-shell/skill-shell.test.js` (cross-kit pins):
- ~976: `works:` / `full-suite:` slot pins and the relay-rule pin. Restore to full text after the edits.
- ~1429: "Same rule as `/branch-review` Stage 1: `REUSE` → cite the green sha and totals; `RUN" and the `/release` twin. Update to the new pointer wording, restored to full text.

## 7. Decisions

The owner settled the open questions: "self-review runs tests, branch-review runs tests, release runs tests if any changes between them, else skipped and use last tests, docs are excluded."

1. **Name stays `green:`.** The decider is unchanged. A rename is churn in 4 kits and every field record.
2. **All 3 gates follow the same rule:** run the decider; `REUSE` skips and cites the last proof; `RUN` runs the full suite once and writes the proof line. `/release` now writes `green:` on `RUN`, like the others.
3. **`/refactor`:** the `green: written` slot is deleted. Only `tests: ... (scoped)` stays.
4. **`/self-review` `works:`** may run targeted checks on `REUSE`, never the full suite.
5. **Dirty tree:** dropped. `/self-review` already stops on a dirty tree ("Dirty tree first"), so every gate runs on a clean committed tree.
