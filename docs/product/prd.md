# Subagent cleanup — lean, focused, dev rules built in (transient PRD)

Date: 2026-11-26. Rewritten each round. Branch: feat/agent-cleanup.

## 1. Problem

Claude spawns liteagents subagents, mostly code-developer and quality-assurance. They do not carry the dev rules, and they are bloated.

- Field evidence: a code-developer helper skipped "reuse before you add" when the orchestrator's brief forgot it. Once its report had to end with `Reused` and `New` lists, the same helper found 3 hidden duplicate copies on the first try (amendment 6, another repo).
- The 10 subagents in `packages/claude/agents/` total 1,621 lines. About 440 (27%) are dot digraphs.
- Several carry `*help` and `*exit` persona menu commands. A spawned helper never uses them.
- Steps repeat three times: as a diagram, as a rule list and as a checklist.
- Almost none carry the dev rules. code-developer only has "search before debug/refactor".
- Some lines contradict the gate rules. code-developer says "run /security after code changes". 3-process-task-list says "Run ALL tests". Gates run the full suite; coding runs targeted tests only.

## 2. Decision

Assumption: liteagents installs together. Every subagent can rely on the skills and on `.claude/remember/AGENT_RULES.md` being present. Source: `packages/claude/skills/remember/AGENT_RULES.md`, its Dev Rules block.

**Remove**
- All digraphs.
- All persona menu commands.
- The orchestrator subagent entirely. Claude already routes.
- Catalog goes 10 -> 9 subagents. Every count must follow, in digits and in words: README, CLAUDE.md, the `package.json` description, tests (including `tests/installer/multi-tool-testing.test.js`) and `subagentic-manual.md`.

**One shape for every remaining subagent, about 50-80 lines**
1. Who I am, 2 lines: good at / not for.
2. Rules: only the AGENT_RULES rules that fit the role, short. A pointer to AGENT_RULES.md as the full source. No full copy.
3. Steps: a short plain list.
4. Report: must-fill lines.
   - Coders: `Reused:` what + file:line. `New:` name + why nothing existing could be extended. `Copies checked:` the grep run. `Proof:` command + exit code.
   - Other roles get their own slots.
5. Hand-offs: which skill to call.

**Role rule picks**
- Coders (code-developer, 3-process-task-list): reuse first, one writer per state, surgical changes, don't patch a patch, targeted tests only, prove it ran.
- quality-assurance: try to break it, a check not run is a fail, N/A needs a reason, report never fix.
- system-architect: simple > clever, no deps by default, POC the riskiest assumption first.
- 1-create-prd, feature-planner, 2-generate-tasks: spec first, out of scope stated, module 0 = go/no-go.
- ui-designer: responsive web mandatory, simple flows.
- market-researcher: a source for every fact.

**Frontmatter**
- It is frozen by `scripts/frontmatter.json` and checked by `scripts/mirror.cjs`.
- Descriptions may be sharpened if the docs show `description` drives delegation. That is an open question (section 6), verified separately before any frontmatter change.

## 3. Go/no-go (module 0)

Rewrite code-developer first. Then a blind A/B: old vs new code-developer, same frozen small task, in a scratch repo with a planted existing function that already does the job.

- Pass: the new one reuses the planted function and lists it under `Reused:`. The old one does not.
- The test can fail: if the old one also reuses it, the task proves nothing. If the new one also misses it, the design is wrong.
- If the new one misses it, stop and redesign. Do not add a patch.

### Result (2026-11-26)

- Ran 2 rounds, old vs new code-developer, 2 runs each, same model (sonnet), blind (role file at a neutral path, task never mentions reuse). Round 1: planted formatCents price helper. Round 2: planted eligible() refund policy that also excludes gift cards, task bait to re-implement in panel HTML.
- Reuse: old 4/4, new 4/4 (all 8 diffs checked by the orchestrator). On a small repo the old helper already reuses, so "new beats old at reuse" cannot be shown here.
- Report block filled: old 0/4, new 4/4. Targeted tests only: old 0/4, new 1/4. Old runs cited its stale "/security, /branch-review after changes" steps; new has none.
- Owner decision: GO. Bar = new is no worse at reuse, and only new emits the must-fill report, the part that caught 3 hidden copies in the field (amendment 6). Real use is the ongoing check. No harder fixture built, to avoid fitting the test to pass.

## 4. Modules

One at a time. Each is reviewed before the next starts.

- M0: code-developer + the A/B.
- M1: quality-assurance.
- M2: 3-process-task-list.
- M3: 2-generate-tasks.
- M4: 1-create-prd.
- M5: feature-planner.
- M6: system-architect.
- M7: ui-designer.
- M8: market-researcher.
- M9: delete orchestrator + count sweep.
- M10: review all 9 for redundancy and overlap, across them and with the skills.
- M10a: frontmatter pass. Merge `when_to_use` text into `description`, drop `when_to_use`, in one pass after all body rewrites (after M10). Re-record `scripts/frontmatter.json` with `shapes --force`. Other kits are checked against their own docs at mirror time.
- M11: only when the owner says all done. Mirror to droid, ampcode and opencode with `node scripts/mirror.cjs`, per `docs/product/INSTALLER_GUIDE.md`.

## 5. Out of scope

- Skills (SKILL.md files), except where they name the orchestrator subagent.
- Mirroring before the owner says all done.
- Changing AGENT_RULES.md itself.

## 6. Open questions

- Does Claude Code use `when_to_use`, or only `description`, to pick a subagent? Answered: `description` only; `when_to_use` is not a documented field. Owner chose: merge its text into `description`, drop it (module M10a).
- Does a spawned subagent see CLAUDE.md? Answered: yes, spawned subagents load CLAUDE.md (source: code.claude.com/docs/en/sub-agents).

## 7. Rules for the work

- `packages/claude` only.
- A sonnet worker writes every edit. The orchestrator reviews.
- Targeted tests while coding. The full suite at gates.
