# Subagentic Manual

A quick reference for the agent kits: what ships, what each thing does, and where it lands.

Liteagents started as scaffolding for early LLMs that needed to be told everything. It isn't
that anymore. Models got smarter, so the toolkit got thinner: specialists you call by name or
that trigger themselves on domain, wide lanes instead of tight rails, constraints on *what*
rather than scripts for *how*.

It is actively challenged, pruned and rewritten — things get renamed, added, and deleted as
models improve. That churn is the point.

---

## Quick Start

```bash
npx liteagents          # interactive installer, auto-updates
```

Or copy a kit manually:

| Platform | Installation | What lands there |
|----------|--------------|------------------|
| **Claude Code** | `cp -r packages/claude/* ~/.claude/` | 10 subagents + 13 skills + live-canvas-channel plugin |
| **Droid** | `cp -r packages/droid/* ~/.factory/` | 10 subagents + 13 commands |
| **Ampcode** | `cp -r packages/ampcode/* ~/.config/amp/` | 10 subagents + 13 skills |
| **OpenCode** | `cp -r packages/opencode/* ~/.config/opencode/` | 10 subagents + 13 commands |

All four ship the same 10 subagents and the same 13 capabilities. Claude Code and
Amp ship all 13 as skills; Droid and OpenCode expose all 13 as commands.

---

## Subagents

Invoke with `@name` (Claude Code / OpenCode / Amp) or `invoke droid name`.

**Workflow agents (3)** — the sequence: PRD → Tasks → Iterative implementation → Review.

| Agent | What it's for |
|---|---|
| `1-create-prd` | Define scope as a PRD — a portal into the work, not a spec to obey |
| `2-generate-tasks` | Break a PRD into granular, actionable tasks |
| `3-process-task-list` | Execute tasks one at a time with review checkpoints |

**Specialist agents (7)**

| Agent | What it's for |
|---|---|
| `orchestrator` | Read intent, route to the right agent sequence |
| `code-developer` | Implementation, debugging, refactoring |
| `quality-assurance` | Test architecture, quality gates, risk assessment |
| `feature-planner` | Epics, user stories, prioritization, backlog |
| `market-researcher` | Market and competitive analysis, project discovery |
| `system-architect` | System design, tech selection, API design, scale |
| `ui-designer` | UI/UX, wireframes, prototypes, design systems |

---

## Commands & skills

13 capabilities. On Claude Code and Amp all 13 are skills — Claude merged
commands into skills, Amp removed commands outright. On Droid and OpenCode all
13 are commands.

| Command | What it's for |
|---|---|
| `/stash` | Snapshot this session's context before compaction or handoff |
| `/remember` | Fold stashes + friction into hot project memory |
| `/docs-builder` | Reorg, index, and split a docs corpus so search actually finds things |
| `/branch-review` | Full pre-merge review — blockers reported, nits to the fix ledger |
| `/release` | Docs sweep, version bump, local commit, then hand back the merge sequence |
| `/refactor` | Clear the fix ledger; with args, refactor and optimize a named area |
| `/security` | Standalone vulnerability audit (also stage 2 of `/branch-review`) |
| `/ship` | Mechanical pre-deploy gate — tests, build, tree state, pass/fail only |
| `/test-generate` | Generate a test suite and verify each test exercises real code |
| `/brainstorming` | Turn a rough idea into a formed design by questioning |
| `/root-cause` | Find the cause before changing code — evidence, backward trace, one hypothesis, fix at the source |
| `/live-canvas` | UI variations with click-to-annotate feedback in the browser |
| `/skill-creator` | Build a new skill |

<sub>`/live-canvas` runs in batch mode on Droid / OpenCode / Ampcode — the MCP channel
plugin is Claude Code specific.</sub>

**By category** — Development & testing (2): test-generate, root-cause ·
Code operations (5): refactor, branch-review, security, ship, release ·
Session & memory (5): brainstorming, skill-creator, docs-builder, stash, remember ·
Design (1): live-canvas.

---

## The ones that carry the load

### `AGENT_RULES.md` — the architect behind every project

One lightweight, generic, model-agnostic rules doc. It sets **what** matters and leaves
wide room on **how**: simple over clever, every line has a purpose, surgical changes,
exhaust the stdlib before reaching for a dependency, POC before you design.

With smarter models a PRD is a **portal, not a deliverable** — the start of a
conversation. You discover it module by module, reviewing, changing and deleting as
experience arrives, instead of pinning everything down up front.

It is loaded every session, linked from the agent config, and `/remember` keeps it fresh —
each run byte-compares your copy against the template that shipped with your install.

| your copy | what happens |
|---|---|
| identical | nothing — no write, no output |
| missing | copied in |
| different | moved to `AGENT_RULES.md.bak`, template copied in, both reported |

Edits are never destroyed, but they aren't preserved in place either. `.bak` is a
*single* file the next update overwrites — a customised body survives one release, not two.

### `/stash` → `/remember` — the daily driver

**`/stash`** is project-local: one session, one feature or scope or goal. Start fresh on
delivery, or when context hits ~30% (never past 40%). The stash is the clean handoff to the
next session.

**`/remember`** fires on the nudge every 5 stashes. It folds those 5 in — and it also reads
across *all* your projects, mining session logs for where you and the model actually
collided: corrections, dead ends, abandoned flows. Those become rules, so the next session
is less wrong than this one.

Markdown files, no database, no RAG, always hot in context, and it keeps the nuances of
each project separate. Runs on a mid-tier model.

### `/docs-builder` — the other daily driver

Markdown gets out of hand, and a token-hungry agent then can't find the knowledge that
matters. It indexes everything under `/docs` in four buckets — `product/`, `logs/`,
`wiki/`, `archive/` — reorganizes, indexes, and splits oversized docs so you don't have to.
Mid-tier model.

### `/live-canvas` — the UI every agent CLI was missing

A terminal agent can't see your screen, and you can't describe "that padding, on that card,
but only on mobile" in words without burning ten minutes.

`/live-canvas` spins up one lightweight localhost page with your UI on it. You **click the
thing that needs changing**, type what you want, and submit. Comment on as many elements as
you like, all in one pass, then send the batch to the agent.

- **JSON mode** — feedback lands in a file, you tell the agent to read it. Works in any tool.
- **Live mode** — an MCP channel streams each comment straight into the session, so edits
  land while you're still in the browser. Claude Code only.

It also ships with real UI direction baked in, so it can generate variations of a screen for
you to pick from — no more hours spent nudging divs to find out what you actually wanted.

### `/branch-review` → `/release` → `/refactor`

- **`/branch-review`** — reviews every change on a branch, medium depth by default. Surfaces
  confirmed blockers only: real bugs, dead and unused code, state-ownership breaks, plus a
  full OWASP-shaped security pass (no leaked keys, no injection, trust boundaries checked)
  that runs at full depth regardless of level. Everything non-blocking goes to the fix ledger.
- **`/release`** — does the pre-release chores you'd otherwise do by hand: README, CHANGELOG,
  PRD, findings, version bump, local commit. Then it tells you you're ready to merge, and
  hands the sequence back. It never pushes.
- **`/refactor`** — with no arguments, works the fix ledger. Cumulative by design: nits pile
  up until you choose to clear them, so review and release never drown in them.

---

## Workflow patterns

Predefined multi-agent sequences the orchestrator can run. Ask for one by name, or just
describe the work and let it route.

| Workflow | Sequence | When |
|---|---|---|
| **Greenfield** | market-researcher → feature-planner → 1-create-prd → 2-generate-tasks → 3-process-task-list | New product or feature from scratch |
| **Brownfield** | system-architect → feature-planner | Understand an existing codebase |
| **Feature** | feature-planner → 1-create-prd → 2-generate-tasks → 3-process-task-list | Add a feature to an existing product |
| **Bug Fix** | code-developer → quality-assurance | Fix and verify |
| **Sprint** | feature-planner (*sprint-plan) → 2-generate-tasks | Plan a sprint from the backlog |

Each step is a decision point you approve before it runs. To skip the routing entirely,
call an agent directly (`@quality-assurance review this code`) or run a command
(`/test-generate src/auth.js`). Droid and OpenCode have no orchestrator — invoke commands directly.

---

## Where it lands

| Platform | Root | Config file | Subagents | Commands / skills |
|---|---|---|---|---|
| **Claude Code** | `~/.claude/` | `CLAUDE.md` | `agents/` | `skills/` (13), plus `plugins/` |
| **Ampcode** | `~/.config/amp/` | `AGENT.md` | `agents/` | `skills/` (13) |
| **Droid** | `~/.factory/` | `AGENTS.md` | `droids/` | `commands/` |
| **OpenCode** | `~/.config/opencode/` | `AGENTS.md` | `agent/` | `command/` |

Each kit also carries a `variants.json` and the tool's own settings file. Droid
and OpenCode still use commands, so the mirror converts each skill's `SKILL.md`
into a flat `<name>.md` for them.

---

## Going deeper

These live in the repo, not in the installed kit:

| Doc | What's in it |
|---|---|
| [Installer guide](https://github.com/hamr0/liteagents/blob/main/docs/product/INSTALLER_GUIDE.md) | Install, custom paths, uninstall, troubleshooting, FAQ — and the order of operations for changing a command, skill or subagent |
| [`/remember`](https://github.com/hamr0/liteagents/blob/main/docs/product/remember-README.md) | The `/stash` → `/remember` pipeline, friction sensor, antigen ledger |
| [`/docs-builder`](https://github.com/hamr0/liteagents/blob/main/docs/product/docs-builder-README.md) | Reorg and cleanup modes, measured cost, the drift ledger |
| [`/branch-review`](https://github.com/hamr0/liteagents/blob/main/docs/product/branch-review-README.md) | The three stages, what blocks, the fix-ledger loop |
| [`/live-canvas`](https://github.com/hamr0/liteagents/blob/main/docs/product/live-canvas-README.md) | Both modes, the click-to-annotate overlay, and setup |
| [live-canvas-channel](https://github.com/hamr0/liteagents/blob/main/docs/product/live-canvas-channel-README.md) | The Claude Code MCP channel plugin — install, protocol, debugging |

---

**Repository**: https://github.com/hamr0/liteagents · **Issues**: https://github.com/hamr0/liteagents/issues · Apache-2.0
