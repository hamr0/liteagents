<div align="center">

```
         ██╗     ██╗████████╗███████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗
         ██║     ██║╚══██╔══╝██╔════╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝
         ██║     ██║   ██║   █████╗  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗
         ██║     ██║   ██║   ██╔══╝  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
         ███████╗██║   ██║   ███████╗██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║
         ╚══════╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
```

**AI development toolkit with 11 specialized agents and 23 commands per tool**

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

- **Claude Code** - 11 subagents + 11 skills + 12 commands (+ optional live-canvas channel plugin)
- **Opencode** - 11 agent references + 23 commands
- **Ampcode** - 11 subagents + 23 commands
- **Droid** - 11 agent references + 23 commands

**Key Difference:**
- **Claude Code**: Full subagent system with orchestrator + skills (auto-triggering)
- **Opencode / Droid / Ampcode**: Commands only + agent reference documentation

### Start Using

```bash
# Claude Code examples
@orchestrator help
@1-create-prd Create a PRD for a task management app
/brainstorming Explore authentication approaches
/test-driven-development Implement user login

# Opencode/Ampcode/Droid examples
/1-create-prd Create a PRD for a task management app
/brainstorming Explore authentication approaches
/test-driven-development Implement user login
```

---

## Hot Memory — project-local learning from your own sessions

Liteagents ships a three-command pipeline that turns Claude Code's session logs into project-local memory. No databases, no external services, just markdown files the assistant reads via `@MEMORY.md`.

```
/stash  →  /friction  →  /remember
capture    analyze        consolidate
```

- **`/stash`** — snapshot the current session's context before compaction or handoff
- **`/friction`** — mine JSONL session logs for frustration signals, failed flows, and abandonment patterns; cluster them into antigen candidates per project
- **`/remember`** — consolidate stashes + friction antigens into `.claude/memory/MEMORY.md`; auto-injected into `CLAUDE.md` via `@MEMORY.md` so every future session in the project benefits

What you get is a memory that *learns from your own mistakes and interventions*, grows quietly in your repo, and works anywhere Claude Code runs. The friction analyzer alone scans all your projects and gives you a per-repo reliability verdict:

```
Per-Project:
  my-app         56% BAD (40/72)  median: 16.0  🔴
  api-service    40% BAD (2/5)    median:  0.5  🟡
  web-client      0% BAD (0/1)    median:  0.0  ✅

WORST: my-app/0203-1630-11eb903a  peak=225  turns=127
BEST:  web-client/0202-2121-8d8608e1  peak=0  turns=4

Verdict: USEFUL    Intervention predictability: 93%
```

Results land in `.claude/friction/antigen_review.md` with projects, error patterns, and offending tool sequences called out per cluster — so `/remember` can pick them up and encode them as rules the next session sees.

> This is the thing in liteagents that nothing else ships. Normal skill bundles give you instructions. The hot-memory pipeline gives you instructions the assistant wrote for itself, from your own logs.

---

## What's Included

### 11 Agents

**Workflow Agents (3):**
- **1-create-prd** - Define scope with structured Product Requirement Documents
- **2-generate-tasks** - Break PRDs into granular, actionable task lists
- **3-process-task-list** - Execute tasks iteratively with progress tracking and review checkpoints

**Specialist Agents (8):**
- **orchestrator** - Analyze intent, coordinate workflows, route to optimal agent sequences
- **code-developer** - Implementation, debugging, refactoring, code best practices
- **quality-assurance** - Test architecture, quality gates, requirements traceability, risk assessment
- **context-builder** - Initialize project context, discover documentation, create knowledge bases
- **feature-planner** - Epics, user stories, prioritization, backlog management, retrospectives
- **market-researcher** - Market analysis, competitive research, project discovery, brainstorming
- **system-architect** - System design, technology selection, API design, scalability planning
- **ui-designer** - UI/UX design, wireframes, prototypes, accessibility, design systems

### 23 Commands/Skills

**Auto-Triggering Skills (3)** - Claude Code only:
- **test-driven-development** - Write test first, watch fail, minimal passing code
- **testing-anti-patterns** - Prevent mocking anti-patterns
- **verification-before-completion** - Verify before claiming done

**Manual Skills/Commands (20):**

*Hot Memory Pipeline (3)* — see the [Hot Memory](#hot-memory--project-local-learning-from-your-own-sessions) section above for the full walkthrough:
- **stash** - Snapshot session context to `.claude/stash/` before compaction, handoff, or ending complex work
- **friction** - Analyze all JSONL sessions for frustration signals, cluster failures per project, surface antigens
- **remember** - Consolidate stashes + friction antigens into `.claude/memory/MEMORY.md`; auto-injected via `@MEMORY.md`

*Design*:
- **live-canvas** - Design UI variations with click-to-annotate feedback in the browser; ships a companion MCP channel plugin for Claude Code so Saves stream into the session in real time. Other tools use batch mode.

*Workflow & analysis*:
- **brainstorming** - Structured brainstorming sessions
- **code-review** - Implementation review against requirements
- **condition-based-waiting** - Replace timeouts with condition polling
- **docs-builder** - Project documentation generation
- **root-cause-tracing** - Trace bugs backward through call stack
- **skill-creator** - Guide for creating new skills
- **systematic-debugging** - Four-phase debugging framework
- **debug** - Systematic issue investigation
- **explain** - Explain code for newcomers
- **git-commit** - Intelligent commit creation
- **optimize** - Performance analysis
- **refactor** - Safe refactoring with behavior preservation
- **review** - Comprehensive code review
- **security** - Vulnerability scanning
- **ship** - Pre-deployment checklist
- **test-generate** - Generate test suites

> **Claude-only plugin:** `live-canvas-channel` is a bundled Claude Code MCP channel plugin that ships under `~/.claude/plugins/live-canvas-marketplace/`. One-time `/plugin install` + a session started with `--dangerously-load-development-channels` unlocks live mode. Skill probes for the channel on each invocation and handholds setup when missing. See [`packages/claude/skills/live-canvas/README.md`](packages/claude/skills/live-canvas/README.md) for the full walkthrough.

---

## Documentation

| Document | Description |
|----------|-------------|
| **[INSTALLER_GUIDE.md](docs/INSTALLER_GUIDE.md)** | Complete installation guide, troubleshooting, and FAQ |
| **[subagentic-manual.md](packages/subagentic-manual.md)** | Detailed agent/command reference |

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
/code-review Check security and performance
/systematic-debugging Investigate this race condition
```

**Architecture & Design:**
```
@system-architect Design microservices architecture
@ui-designer Create wireframes for mobile checkout
```

---

## Stats

- **11** Specialized Agents
- **22** Workflow Commands & Skills
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

**Need help?** See the [Installer Guide](docs/INSTALLER_GUIDE.md) or [open an issue](https://github.com/hamr0/liteagents/issues)
