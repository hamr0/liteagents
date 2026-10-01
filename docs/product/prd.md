# Remaining work — skill shrink series (transient PRD)

Date: 2026-10-01. The standing plan: rewritten each round of changes, committed.

## 1. Where we are

### Released
- liteagents v4.1.0 is on npm. Tag v4.1.0 is main 4028b95.
- agentic-toolkit v3.1.0 is tagged (4925920).
- ~/.claude is synced. Manifest stamp is 4.1.0.

### Branch fix/review-targets
- Checkout: /home/hamr/PycharmProjects/liteagents. Tree is clean.
- /self-review and /branch-review now take a target:
  - none: committed work on the branch. A dirty tree stops. On main with no target it stops.
  - one or more hashes.
  - a range a..b: exactly those commits. No review record, bookmark untouched, Stage 4 skipped.
- Field fixes on the same branch:
  - fail-first mutation run when most reds are load failures.
  - s2 result slot: `ran: … → clean | finding: file:line`.
  - merged-branch bookmark is ignored.
  - baseline totals go in the handoff.
  - one path/snippet per ledger bullet.
  - self-review-sha is always carried forward.
  - stale "committed or not" lines fixed.
- State: /self-review clean (2 rounds). Mirrored. /branch-review READY at 5d6d416, plus docs commit ac3109f.
- NOT released.

### Branch refactor/remember-trim
- Checked out in /home/hamr/PycharmProjects/liteagents (the worktree is gone).
- a980bf7: trim 641 → 258 lines. Why moves to docs/product/remember-README.md. Rules are one line plus a pin. 13 new step-8 slots.
- ebfbfd2: friction.cjs `count` owns theme naming (first two words), decay (56 days) and escalation detection. The model keeps only the rephrase wording.
- ecd5364: friction.cjs treats helper reports and cross-session messages as machine text. This removed a false 9-session cluster.
- Before/after A/B on frozen input passed. All script outputs were byte-identical.
- 617367b: end-of-branch mirror of friction.cjs to the 3 kits. Done.
- 7696019: `count` re-lists a hot entry whose last attempt is failed and not yet redrafted. Adds the 56-day decay boundary test.
- NOT yet done: /branch-review READY, then the combine with fix/review-targets.

## 2. Release plan

Owner rule: the remember branch AND the review-skills branch are both clean before ONE release.

- [ ] remember branch: end mirror. Run `node scripts/mirror.cjs diff`, then `sync`, then `check`. Need 0 non-path diffs.
- [ ] remember branch: full `npm test`.
- [ ] remember branch: remove the worktree. Check the branch out in the main checkout.
  - Reviews must run there. The ledger and last-review.md live in its gitignored .claude/remember/.
- [ ] remember branch: /self-review until zero Fix-now.
- [ ] remember branch: /branch-review reaches READY.
- [ ] Combine: merge fix/review-targets into refactor/remember-trim (or a release branch).
- [ ] Re-run /branch-review on the combined branch. A merge after review makes the record stale.
- [ ] /release. Expected v4.2.0:
  - Added: review targets.
  - Changed: /remember trim and script moves.
  - Fixed: friction machine text.
- [ ] Owner authorizes push, PR, merge, tag and publish each by name.
- [ ] Verify live: `npm view` plus the tarball.
- [ ] Sync ~/.claude, including the manifest stamp (liteagents_version).
- [ ] agentic-toolkit mirror v3.2.0 plus tag.
- [ ] Run /remember for real once released. This is the first live run of the trimmed skill.

## 3. Open ledger

File: .claude/remember/fix-ledger.md. It had 12 bullets at write time. Re-count before acting.

### Real, still open
- [ ] live-canvas server: no Origin check. Any loopback port can POST.
- [ ] live-canvas server: /feedback-jsonl is unbounded and stores raw lines.
  - Fold both items into the live-canvas branch.
- [ ] Idea: /release s2 gate passes `ran: … → finding:`.
  - First check whether the verdict/coverage already blocks it. Only then consider a rule.
- [ ] Nit: branch-review-README says "whole branch (`main..HEAD`)". It should say merge-base.

### To drop through /refactor revalidation
- 5 bullets whose anchors are gone (fixed in 9e1409f).
- 2 bullets fixed on fix/review-targets: fail-first mutation, s2 result slot.
- The friction.cjs skip-list bullet. ecd5364 fixes it. Drop it after the merge.
- Never delete a ledger bullet by hand.

### Parked or dropped (do not re-raise without new evidence)
- Concurrent test suites from other repos.
- CI-mode test runs.
- A one-off false "package-lock tracked" record claim.

## 4. Next: live-canvas, then docs-builder

- live-canvas SKILL.md: 1099 lines.
- docs-builder SKILL.md: 1009 lines.
- One skill per branch. Each is reviewed and released before the next starts.

### Recipe (same as remember)
- [ ] Branch from main. Measure `wc -l`.
- [ ] Read-only cut-list worker. Classify every paragraph as STEP / RULE / WHY / JUDGMENT / SLOT-MISSING / DUP, with line ranges. It also reports:
  - existing pins,
  - README gaps and contradictions,
  - what the scripts really do.
- [ ] Owner signs off on a plain-words summary BEFORE any edit. The summary lists:
  - what stays,
  - what moves to the README,
  - dups cut,
  - rules cut to one line plus a pin,
  - new slots,
  - behaviour changes.
- [ ] Trim in packages/claude only. No sync. Write a command inventory old → new, so every script or command call is accounted for.
- [ ] Move mechanical judgment into an existing script (no new script file). Add fail-first tests.
- [ ] Before/after A/B on frozen input (see section 5).
- [ ] Claude-kit tests green.
- [ ] End mirror, once, at the end of the branch.
- [ ] Full `npm test`.
- [ ] /self-review, then /branch-review, then /release.

### live-canvas specifics
- Fold in the 2 ledger server items (Origin check, bounded /feedback-jsonl).
- Parts: channel server (port 8788, single binder), overlay-vanilla.js, JSON vs Live mode.
- The mode choice stays an AskUserQuestion. Never auto-detect.
- The A/B needs a way to run without a browser. Design it in the cut-list step.

### docs-builder specifics
- index-flat, due and reorg are already mechanical scripts.
- It edits ONLY .md files.
- A/B on a frozen copy of a docs corpus.
- Its SKILL.md is mirror-exempt. Hand-sync to all 4 kits and verify byte-identical.

## 5. Lessons from /remember (follow on live-canvas and docs-builder)

- Sign-off before edits. The cut-list and plain summary caught a README that contradicted the skill (quiet runs) and a stale claim (decay called "mechanical" when the model did it).
- Model doing arithmetic, dates or naming is a bug waiting. Three such jobs moved into the existing script. Look for the same: counts, dates, thresholds, names, file lists.
- The real A/B run found a bug the tests missed. The model named a theme with 4 words instead of 2, because real `top_keywords` are word PAIRS. Check real data shapes before writing a rule or a test.
- A/B method that worked:
  - Freeze the live or nondeterministic input once (the friction output).
  - Copy the repo twice into scratch.
  - Run headless `claude -p "/<skill>"` with an explicit --allowedTools list and a short appended test note.
  - Swap the installed SKILL.md temporarily. Keep a backup and restore it after.
  - Pass bar: script outputs byte-identical. Compare model-written parts by counts, items and filled slots, never by wording.
- Claude first, mirror once at branch end. Workers synced at every step, which broke things. Briefs must say "packages/claude only, no sync".
- Worktrees are fine for parallel edits. Reviews must run in the main checkout, where the ledger and review record live.
- Every kept rule is one line plus a test pin. Every step that can be skipped gets a must-fill slot line. Every new test is proven red on the old code first.
- Park problems on the ledger, not only in chat. The friction helper-text bug almost got lost.
- A filter or skip list duplicated in two places drifts. Friction had 2 and 7 prefixes. Keep one list and one helper.
- Standing rule: a sonnet worker writes every code, spec and doc edit. The orchestrator only decides and verifies.
- Measured: remember 641 → 258 lines (60% smaller). Its README went 255 → 395 lines.

## Verified on write

Checked 2026-10-01 with git, wc and grep.

- Confirmed: v4.1.0 tag exists. main is 4028b95 (merge of PR #67). fix/review-targets branches from 4028b95.
- Confirmed: HEAD of fix/review-targets is ac3109f. Tree is clean.
- Confirmed: worktree liteagents-wt-remember is on refactor/remember-trim at ecd5364. It has exactly the 3 commits a980bf7, ebfbfd2, ecd5364 over main.
- Confirmed: remember SKILL.md is 641 lines on main and 258 in the worktree.
- Confirmed: fix-ledger.md has 12 `- ` bullet lines.
- Confirmed: ~/.claude/manifest.json liteagents_version is 4.1.0.
- Correction: docs-builder SKILL.md is 1009 lines, not 1008.
- Correction: remember-README is 395 lines in the worktree, not ~378. It is 255 on main.
- Not checked: agentic-toolkit v3.1.0 / 4925920 (other repo). The 5 stale anchors and the 2 fixed ledger bullets were not individually re-verified.
- Side note: a stray local branch `worktree-agent-a56a32cafbf476944` exists. The remote branch origin/feat/ledger-idea-tag also still exists. Neither is in the plan.
- .claude/plans/ did not exist. I created it. It is gitignored (`git check-ignore` confirms).
