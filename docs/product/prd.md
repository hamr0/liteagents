# Remaining work — skill shrink series (transient PRD)

Date: 2026-10-01. The standing plan: rewritten each round of changes, committed.

## 1. Where we are

### Released
- liteagents v4.2.0 is on npm. Tag v4.2.0 is main 58284ea (PR #68, merged).
  - /remember trim 641 → 258 lines.
  - friction.cjs `count`: theme naming, decay, escalation.
  - review targets (hash, range).
- agentic-toolkit v3.2.0 is tagged (225e330).
- ~/.claude is synced. Manifest stamp is 4.2.0.

### Branch refactor/branch-review-trim (top of the stack)
- Checkout: /home/hamr/PycharmProjects/liteagents. Stacked on refactor/docs-builder-trim, which is stacked on refactor/live-canvas-trim. All local. NOT pushed.
- One review and one release cover the whole stack: 20 commits over main (`git log --oneline main..HEAD`).
- branch-review trim finished, mirrored to ampcode, droid, opencode:
  - 21bc361 trim 479 → 304 lines (SKILL.md is 307 now).
  - 43563c3 escalate-to-orchestrator bullet restored in the closing block.
  - 51aaa24 merge-after-review loop fix: a merge of origin/main after the review is never forgiven, matching /release.
  - 6c68e6d closing block gains the `proof:` and `liveness:` lines.
- cda6549 /remember runs the friction scan as its own command with a 10-minute timeout (chained, it was killed, exit 137).
- 42292f1 skill-shell RULE_PINS fix (pin was claude-only path).
- 8c637a3 end-of-branch mirror of the above.
- Old-vs-new headless A/B of branch-review: 14 runs (main known-answer plus 6 control scenarios, old and new).
  - Both found the planted docs-builder pageStatus empty-file crash.
  - 5 of 6 controls identical.
  - Control 4 (docs-only merge after review) differs as intended: old forgave it, new re-reviews.
  - No run committed, pushed or merged.

### Branch refactor/docs-builder-trim (middle of the stack)
- HEAD 4c91fdc when written. Stacked on refactor/live-canvas-trim.
- 11 commits over main below the branch-review work:

live-canvas (6):
- 839bf7f server: pins the first origin. One bounded JSON line per record (256KB per record, 5MB file). Messages carry the relaunch and port-busy steps.
- 8a68f94 trim 1099 → 304 lines. Why moves to the README. Live Finish writes feedback.jsonl.
- 468769b cleanup slot says N/A (port not bound).
- a7cb776 slots moved into the messages the model always prints (ready block, final report).
- c498281 end-of-branch mirror to ampcode, droid, opencode.
- 2160f03 overlay: Live Finish opens the Finish box after all comments streamed.
- SKILL.md is 311 lines now (1099 on main).

docs-builder (5):
- 326797c script helpers: `PREVIEW=1 apply-reorg` approval table, default file args, BRANCH / QUESTION / WARN lines, writer brief in each task file.
- 530aae6 drift fix: apply-reorg writes new paths back to the plan. `search` errors on a missing explicit outline.
- 07396a4 trim 1009 → 194 lines.
- aa0edf1 hand-sync to ampcode, droid, opencode. Split slot covers cleanup mode.
- 4c91fdc index rebuild.
- SKILL.md is 194 lines now (1009 on main).

Tests: `npm test` exit 0, 2940 passed, 0 failed at 8c637a3 (2856 at 4c91fdc).

### Validation done
- live-canvas headless A/B (scratch only, not linked here):
  - round 1: output slots missing.
  - fixed by structure (slots moved into always-printed messages).
  - round 2: all six slots present.
- live-canvas real-browser run with the new server and overlay:
  - Save streamed.
  - a page on a second port got 403.
  - Finish wrote one line to feedback.jsonl.
  - it FOUND the overlay Finish bug (2160f03). Headless A/B and tests had not.
- docs-builder A/B on a frozen "multis" corpus (24 docs):
  - first run: moves, index and tree identical, old vs new.
  - drift: old re-asked 24/24, new re-asked 0.
  - split: archived original byte-identical.
  - all 8 slots filled in 3 runs.
  - zero forbidden git commands.

## 2. Release plan

Owner rule: one review and one release for both trims.

- [ ] Owner runs /self-review, then /branch-review, then /release over the whole stack.
- [ ] /release. Expected v4.3.0 (minor):
  - Added: docs-builder script helpers; /branch-review proof: and liveness: lines.
  - Changed: /live-canvas, /docs-builder, /branch-review trims.
  - Fixed: live-canvas server and overlay, docs-builder drift, /branch-review merge-after-review loop, /remember friction scan timeout.
- [ ] Owner authorizes push, PR, merge, tag and publish each by name.
- [ ] Verify live: `npm view` plus the tarball.
- [ ] Sync ~/.claude, INCLUDING the live-canvas plugin server:
  - re-run packages/claude/plugins/live-canvas-marketplace/setup.sh, or copy server.js into ~/.claude/plugins/live-canvas-marketplace.
  - bump the manifest stamp (liteagents_version).
- [ ] agentic-toolkit mirror plus tag.
- [ ] Then come back for the fix-ledger cleanup (/refactor) and the nits in section 3.
- [ ] Run /remember for real once. First live run of the trimmed skill (still pending from last round).
- [ ] One real interactive /live-canvas Live run. The "ready block" slot placement and the full skill flow were only tested headless.

## 3. Open ledger

File: .claude/remember/fix-ledger.md. It has 15 `- ` bullets now: 5 nit, 7 change, 3 idea. Re-count before acting (`grep -c '^- '`).

- The 2 live-canvas server bullets (Origin check, bounded /feedback-jsonl) are fixed in code (839bf7f).
- Several other bullets were fixed last round (stale "committed or not" lines, s2 slot, fail-first, friction skip list).
- Drop them all through /refactor revalidation. Never by hand.

### Nits found this round
- [ ] /branch-review: on a re-review through a merge, the closing `proof:` line said "all on docs:" while the record said `docs: none`. Disagreement (seen in A/B control 4).
- [ ] /remember: the `labels.json` path is never named in the spec. The worker wrote .claude/remember/friction/labels.json, overwriting the prior run's file.
- [ ] /remember: the spec has no format for "episode removed whose lesson is already an existing fact", no tie-break for which episode goes on equal dates, and says "relay verbatim" but count's stdout is a long JSON.
- [ ] docs-builder: SKILL.md line 13 "`docs-builder/docs-builder.cjs`" reads like a subfolder; the script sits beside SKILL.md (wording nit).
- [ ] docs-builder (low priority): gitignored root .md files (TEST_REPORT.md) appear in reorg with no skip. Owner says docs-builder behaved fine (it asked).
- [ ] skill-shell RULE_PINS pinned a claude-only path — the per-kit test went red only after mirroring; pins must use kit-neutral text.

### Parked (so nothing lives only in chat)
- [ ] live-canvas origin pin limit:
  - it pins the first origin.
  - it cannot stop a script on the same origin as the lab.
  - a stray page that connects first blocks the lab until channel close.
  - documented in docs/product/live-canvas-README.md (Origin pinning) and live-canvas-channel-README.md.
- [ ] The overlay Finish fix is pinned only by a source-level test. Behaviour was proven by the browser run. No DOM test harness exists.
- [ ] docs-builder `search`: a query whose first word ends in `.json` is read as the outline path (docs-builder.cjs line 941).
- [ ] Nit: the docs-builder.cjs comment at line 2140 says "ampcode -> AGENT.md". The amp kit is a deliberate mirror of claude (CLAUDE.md) per owner. The comment is the stale part.
- [ ] `expectedTests` floors in tests/run-all-tests.js are far below actual: skill-shell 310 vs 1386, docs-builder 538 vs 735.
- [ ] Unclear: live-canvas interview questions with no options (Location, Key tasks, Feedback).

## 4. Next: more skill trims

Top SKILL.md sizes now (`wc -l packages/claude/skills/*/SKILL.md`):
1. live-canvas 311 (trimmed)
2. branch-review 307 (trimmed)
3. remember 258 (trimmed)
4. release 242
5. root-cause 236
6. refactor 228

Next three to trim: release (242), root-cause (236), refactor (228). One skill per branch, same recipe. docs-builder is 194 (trimmed).

### Recipe
- [ ] Branch from main. Measure `wc -l`.
- [ ] Read-only cut-list worker. Classify every paragraph as STEP / RULE / WHY / JUDGMENT / SLOT-MISSING / DUP, with line ranges. It also reports existing pins, README gaps and contradictions, and what the scripts really do.
- [ ] Owner signs off on a plain-words summary BEFORE any edit.
- [ ] Additive script helpers first, in an existing script. Then the skill (it depends on their exact output).
- [ ] Trim in packages/claude only. No sync. Write a command inventory old → new.
- [ ] Add fail-first tests.
- [ ] Before/after A/B on frozen input.
- [ ] Claude-kit tests green.
- [ ] End mirror, once, at the end of the branch.
- [ ] Full `npm test`.
- [ ] /self-review, then /branch-review, then /release.

## 5. Lessons

From /remember:
- Sign-off before edits. The cut-list and plain summary caught a README that contradicted the skill and a stale claim.
- Model doing arithmetic, dates or naming is a bug waiting. Move counts, dates, thresholds, names and file lists into the existing script.
- The real A/B run found a bug the tests missed. Check real data shapes before writing a rule or a test.
- A/B method that worked:
  - Freeze the live or nondeterministic input once.
  - Copy the repo twice into scratch.
  - Run headless `claude -p "/<skill>"` with an explicit --allowedTools list and a short appended test note.
  - Swap the installed SKILL.md temporarily. Keep a backup and restore it after.
  - Pass bar: script outputs byte-identical. Compare model-written parts by counts, items and filled slots, never by wording.
- Claude first, mirror once at branch end. Briefs must say "packages/claude only, no sync".
- Worktrees are fine for parallel edits. Reviews must run in the main checkout, where the ledger and review record live.
- Every kept rule is one line plus a test pin. Every skippable step gets a must-fill slot line. Every new test is proven red on the old code first.
- Park problems on the ledger, not only in chat.
- A filter or skip list duplicated in two places drifts. Keep one list and one helper.
- Standing rule: a sonnet worker writes every code, spec and doc edit. The orchestrator only decides and verifies.
- Measured: remember 641 → 258 lines.

From live-canvas and docs-builder:
- Slots printed mid-run get skipped. Put them in messages the model always prints, plus one final report block. Round 1 of the live-canvas A/B had slots missing; round 2 had all six.
- A real browser run found a bug that headless A/B and tests could not: the overlay Finish guard (2160f03). Run the real thing once.
- Spot-check the cut-list's claims. It over-stated "skips inline code spans". Running the script gave the true rule.
- Additive script helpers first, skill second. The skill depends on exact script output.
- Stacking two skill trims on one branch means one review and one release.
- A cleanup command using `pkill -f <pattern>` can kill the session's own plugin. Match by pid file instead.
- Measured: live-canvas 1099 → 311 lines, docs-builder 1009 → 194 lines, branch-review 479 → 307 lines.

## Verified on write

Checked 2026-10-01 with git, wc, grep, gh, npm view and a fresh `npm test`. Branch-review round facts re-checked at 8c637a3.

- Confirmed (branch-review round): branch refactor/branch-review-trim, `git rev-list --count main..HEAD` is 20, commit hashes above from `git log`. `npm test` exit 0, 2940 passed, 0 failed; `mirror.cjs check` exit 0. branch-review SKILL.md is 307 lines. fix-ledger.md has 15 `- ` bullets.
- Not checked (branch-review round): the A/B results are the coordinator's report, not re-read here; the nits come from the coordinator's report.
- The items below were checked at 4c91fdc and are not re-checked, except where restated above.

- Confirmed: branch is refactor/docs-builder-trim, HEAD 4c91fdc, tree clean (before and after `npm test`). `git log --oneline main..HEAD` lists exactly 11 commits, all hashes above.
- Confirmed: `npm view liteagents version` is 4.2.0. v4.2.0 tag and main are both 58284ea. PR #68 is MERGED with merge commit 58284eaf.
- Confirmed: agentic-toolkit tag v3.2.0 is 225e330 (local clone, sibling dir).
- Confirmed: ~/.claude/manifest.json liteagents_version is 4.2.0.
- Confirmed: `npm test` exit 0, Passed 2856, Failed 0 (fresh run at 4c91fdc).
- Confirmed: SKILL.md lines. live-canvas 1099 on main, 311 now. docs-builder 1009 on main, 194 now. branch-review 479, release 242, root-cause 236, refactor 228.
- Confirmed: floors. skill-shell floor 310, actual 1386. docs-builder floor 538, actual 735.
- Confirmed: fix-ledger.md has 15 `- ` bullets: 5 nit, 7 change, 3 idea.
- Confirmed: origin-pin limit is documented in docs/product/live-canvas-README.md and live-canvas-channel-README.md.
- Confirmed: docs-builder.cjs line 941 reads a first arg ending `.json` as the outline path. Line 2140 comment says "ampcode -> AGENT.md".
- Corrected: the live-canvas trim commit message says 304 lines; the file is 311 now (later fixes added lines).
- Corrected: the plan said "top 5" next; the top 5 includes live-canvas and remember, which are already trimmed. Listed the next four untrimmed.
- Not checked: the A/B results (scratch files, not read by this write); the real-browser run details (403, feedback.jsonl line); the 256KB / 5MB server limits (not re-read in server.js); the tarball content of v4.2.0; the claim that the 2 server bullets and "several" others are fixed (not re-run through /refactor); whether ~/.claude plugin server.js matches the repo.
