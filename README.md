<div align="center">

```
         ██╗     ██╗████████╗███████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗
         ██║     ██║╚══██╔══╝██╔════╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝
         ██║     ██║   ██║   █████╗  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗
         ██║     ██║   ██║   ██╔══╝  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
         ███████╗██║   ██║   ███████╗██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║
         ╚══════╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
```

**AI development toolkit with 10 specialized agents and 18 commands per tool**

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/liteagents?label=version&color=2a4f8c" alt="version (auto from package.json)">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
</p>

**Supported Tools:**
[![Claude](https://img.shields.io/badge/Claude-Supported-blue?logo=anthropic)](https://claude.ai)
[![Opencode](https://img.shields.io/badge/Opencode-Supported-green)](https://github.com/hamr0/opencode)
[![Ampcode](https://img.shields.io/badge/Ampcode-Supported-orange)](https://github.com/hamr0/ampcode)
[![Droid](https://img.shields.io/badge/Droid-Supported-red)](https://github.com/hamr0/droid)

</div>

Specialized AI agents and workflow commands for product management, agile development, and software engineering. Simple installer supports Claude, Opencode, Ampcode, and Droid.

---

## Quick Start

```bash
# Option 1: NPX (recommended)
npx liteagents

# Option 2: Global install (never use sudo)
npm install -g liteagents
liteagents

# If permission errors:
# mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'
# echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc && source ~/.bashrc
```

### Supported Tools

- **Claude Code** - 10 subagents + 8 skills + 10 commands (+ optional live-canvas channel plugin)
- **Opencode** - 10 agent references + 18 commands
- **Ampcode** - 10 subagents + 18 commands
- **Droid** - 10 agent references + 18 commands

**Key Difference:**
- **Claude Code**: Full subagent system with orchestrator + skills (auto-triggering)
- **Opencode / Droid / Ampcode**: Commands only + agent reference documentation

### Start Using

```bash
# Claude Code examples
@orchestrator help
@1-create-prd Create a PRD for a task management app
/brainstorming Explore authentication approaches
/tdd-flow Implement user login

# Opencode/Ampcode/Droid examples
/1-create-prd Create a PRD for a task management app
/brainstorming Explore authentication approaches
/tdd-flow Implement user login
```

---

## Hot Memory — project-local learning from your own sessions

Liteagents ships a two-command pipeline that turns Claude Code's session logs into project-local memory. No databases, no external services, just markdown files the assistant reads via an `@.claude/remember/MEMORY.md` include.

```
/stash  →  /remember
capture    analyze + consolidate
```

- **`/stash`** — snapshot the current session's context before compaction or handoff; nudges you to consolidate once a few stashes pile up. The write-up runs on a mid-tier model, dispatched as a background subagent where your tool supports it, so the session isn't blocked on formatting/file I/O
- **`/remember`** — runs friction analysis automatically (mining JSONL session logs across *all* your projects for frustration signals, failed flows, and abandonment patterns, clustered into antigen candidates), then consolidates stashes + friction antigens into `.claude/remember/MEMORY.md`; auto-injected into `CLAUDE.md` via an explicit `@.claude/remember/MEMORY.md` include so every future session benefits. Per-stash extraction runs as concurrent subagent calls on a mid-tier model — no model name hardcoded, so it works with whatever your tool has configured

### `AGENT_RULES.md` — the standards doc that primes every session

`/remember` installs an `AGENT_RULES.md` coding-standards template into `.claude/remember/` (`.factory/`, `.amp/`, `.opencode/` for the other tools) and references it from `CLAUDE.md` (`AGENT.md` / `AGENTS.md`) as a plain pointer, so the assistant consults it when building something new. It is a static guide — not something the pipeline learns or extracts.

**It is kept current on every `/remember` run**, because a shipped standards doc that never updates is a stale one: 35 local repos were measured drifting many releases behind before this existed. Each run compares your copy against the template that came with your installed liteagents:

| your copy | what happens |
|---|---|
| identical to the template | nothing at all — no write, no output |
| missing | copied in |
| **different** | moved to `AGENT_RULES.md.bak`, new template copied in, both reported |

So **edits are never destroyed, but they are not preserved in place either.** If you have customised your rules, fold your changes into the new `AGENT_RULES.md` after an update — `AGENT_RULES.md.bak` is a *single* file that the next update overwrites, so a customised body survives one release, not two.

To get a newer template in the first place, update the package: `/remember` tells you when your install is behind, and `npm i -g liteagents@latest && liteagents` refreshes it (your previous install is backed up automatically).

What you get is a memory that *learns from your own mistakes and interventions*, grows quietly in your repo, and works anywhere Claude Code runs. The friction pass inside `/remember` scans all your projects and gives you a per-repo reliability verdict:

```
Per-Project:
  my-app         56% BAD (40/72)  median: 16.0  🔴
  api-service    40% BAD (2/5)    median:  0.5  🟡
  web-client      0% BAD (0/1)    median:  0.0  ✅

WORST: my-app/0203-1630-11eb903a  peak=225  turns=127
BEST:  web-client/0202-2121-8d8608e1  peak=0  turns=4

Verdict: USEFUL    Intervention predictability: 93%
```

Results land in `.claude/remember/friction/antigen_review.md` with projects, error patterns, and offending tool sequences called out per cluster — which `/remember` then encodes as rules the next session sees.

> This is the thing in liteagents that nothing else ships. Normal skill bundles give you instructions. The hot-memory pipeline gives you instructions the assistant wrote for itself, from your own logs.

---

## What's Included

### 10 Agents

**Workflow Agents (3):**
- **1-create-prd** - Define scope with structured Product Requirement Documents
- **2-generate-tasks** - Break PRDs into granular, actionable task lists
- **3-process-task-list** - Execute tasks iteratively with progress tracking and review checkpoints

**Specialist Agents (8):**
- **orchestrator** - Analyze intent, coordinate workflows, route to optimal agent sequences
- **code-developer** - Implementation, debugging, refactoring, code best practices
- **quality-assurance** - Test architecture, quality gates, requirements traceability, risk assessment
- **feature-planner** - Epics, user stories, prioritization, backlog management, retrospectives
- **market-researcher** - Market analysis, competitive research, project discovery, brainstorming
- **system-architect** - System design, technology selection, API design, scalability planning
- **ui-designer** - UI/UX design, wireframes, prototypes, accessibility, design systems

### 18 Commands/Skills

**Auto-Triggering Skills (3)** - Claude Code only:
- **tdd-flow** - Write test first, watch fail, minimal passing code
- **test-traps** - Prevent mocking anti-patterns
- **verify-done** - Verify before claiming done

**Manual Skills/Commands (15):**

*Hot Memory Pipeline (2)* — see the [Hot Memory](#hot-memory--project-local-learning-from-your-own-sessions) section above for the full walkthrough:
- **stash** - Snapshot session context to `.claude/stash/` before compaction, handoff, or ending complex work
- **remember** - Consolidate stashes + friction antigens into `.claude/remember/MEMORY.md`; auto-injected via `@.claude/remember/MEMORY.md`

*Design*:
- **live-canvas** - Design UI variations with click-to-annotate feedback in the browser; ships a companion MCP channel plugin for Claude Code so Saves stream into the session in real time. Other tools use batch mode.

*Workflow & analysis*:
- **brainstorming** - Structured brainstorming sessions
- **docs-builder** - Reorg a docs corpus, split an oversized doc, search it, keep pages current, index them
- **trace-back** - Trace bugs backward through call stack
- **skill-creator** - Guide for creating new skills
- **debug-method** - Four-phase debugging framework
- **optimize** - Performance analysis
- **refactor** - Safe refactoring with behavior preservation; with no arguments, works through the fix ledger `/branch-review` accumulated
- **branch-review** - Pre-merge gate that reports and never fixes: general review at a chosen effort level, a full security audit that runs at full depth regardless of level, then an adversarial verify pass. Needs a clean tree. Only reproduced Critical/High failures block; everything else lands in the fix ledger for `/refactor`
- **security** - Standalone vulnerability scan; also runs as stage 2 of `/branch-review`
- **ship** - Mechanical pre-deploy gate: every item is answerable by running a command and reading its exit code, recorded as pass/fail/N/A. A check not run is a fail, and N/A needs a stated reason
- **release** - Prepare a release on the current branch: verify → docs sweep → version bump → local commit, then hand back the merge/tag/publish sequence (never pushes). Refuses without a review recorded at the current HEAD SHA
- **test-generate** - Generate test suites

> **Claude-only plugin:** `live-canvas-channel` is a bundled Claude Code MCP channel plugin that ships under `~/.claude/plugins/live-canvas-marketplace/`. One-time `/plugin install` + a session started with `--dangerously-load-development-channels` unlocks live mode. Skill probes for the channel on each invocation and handholds setup when missing. See [`packages/claude/skills/live-canvas/README.md`](packages/claude/skills/live-canvas/README.md) for the full walkthrough.

---

## Documentation

| Document | Description |
|----------|-------------|
| **[INSTALLER_GUIDE.md](docs/product/INSTALLER_GUIDE.md)** | Complete installation guide, troubleshooting, and FAQ |
| **[subagentic-manual.md](packages/subagentic-manual.md)** | Detailed agent/command reference |
| **[remember-README.md](docs/product/remember-README.md)** | How hot memory works — the `/stash` → `/remember` pipeline, the friction sensor, and the antigen ledger |
| **[docs-builder-README.md](docs/product/docs-builder-README.md)** | How `/docs-builder` works — the reorg/cleanup modes, what it measurably costs, and the ledger that tracks doc drift |
| **[branch-review-README.md](docs/product/branch-review-README.md)** | How the pre-merge gate works — the three stages, what blocks a merge, and the `/branch-review` → fix ledger → `/refactor` loop |
| **[live-canvas/README.md](packages/claude/skills/live-canvas/README.md)** | How `/live-canvas` works — the two modes, the click-to-annotate channel, and the Claude Code plugin setup |
| **[docs/README.md](docs/README.md)** | Entry point for this repo’s own docs — what lives in `product/`, `archive/` and the operation log |
| **[docs/index.md](docs/index.md)** | The generated index of every doc, with heading ranges. Rebuilt by `/docs-builder` on every reorg or split |

---

## Example Workflows

**Feature Development:**
```
@orchestrator I need to add user authentication
# Orchestrator routes to:
# → market-researcher (research approaches)
# → 1-create-prd (requirements)
# → 2-generate-tasks (implementation tasks)
# → 3-process-task-list (execution)
```

**Code Quality:**
```
@quality-assurance Review this PR before merge
/branch-review main medium  # review + security audit; blockers reported, the rest to the fix ledger
/refactor                   # no args: work through the fix ledger branch-review accumulated, between features
/debug-method Investigate this race condition
```

**Architecture & Design:**
```
@system-architect Design microservices architecture
@ui-designer Create wireframes for mobile checkout
```

---

## Stats

- **10** Specialized Agents
- **18** Workflow Commands & Skills
- **4** Supported Tools (Claude, Opencode, Ampcode, Droid)
- **Apache-2.0** License

---

## Links

- **npm:** https://www.npmjs.com/package/liteagents
- **GitHub:** https://github.com/hamr0/liteagents
- **Issues:** https://github.com/hamr0/liteagents/issues

---

## License

Apache-2.0 © 2026 hamr0 — see [LICENSE](LICENSE).

---

**Need help?** See the [Installer Guide](docs/product/INSTALLER_GUIDE.md) or [open an issue](https://github.com/hamr0/liteagents/issues)
