# Subagentic Manual

Production-ready AI agent framework providing specialized subagents, workflow commands, and development skills for **Claude Code**, **OpenCode**, **Ampcode**, and **Droid**. Deploy expert AI personas instantly with zero configuration.

---

## Why Subagentic?

**The Challenge**: Generic AI assistants lack specialized expertise and systematic workflows, leading to inconsistent results and context overload.

**The Solution**: Subagentic provides:
- **Role-Specialized Agents** - Expert personas (architect, QA, product manager) with domain-specific knowledge
- **Systematic Workflows** - Proven development patterns (PRD → Tasks → Implementation)
- **Orchestrator-First Routing** - Automatic workflow matching based on user intent
- **Frontmatter-Based Discovery** - All resources self-describe via YAML frontmatter
- **Platform Agnostic** - Works across Claude Code, OpenCode, Ampcode, and Droid

**The Result**: Predictable, high-quality outputs from specialized agents following best practices, without manually switching contexts or crafting complex prompts.

---

## Quick Start

Clone the toolkit:
```bash
git clone https://github.com/hamr0/agentic-toolkit
cd agentic-toolkit/ai/subagentic
```

Install for your platform:

| Platform | Installation | What's Included |
|----------|--------------|-----------------|
| **Claude Code** | `cp -r claude/* ~/.claude/` | 11 subagents + 8 skills + 10 commands + live-canvas-channel plugin |
| **Droid** | `cp -r droid/* ~/.factory/` | 11 subagents + 18 commands |
| **Ampcode** | `cp -r ampcode/* ~/.config/amp/` | 11 subagents + 18 commands |
| **OpenCode** | `cp -r opencode/* ~/.config/opencode/` | 11 subagents + 18 commands |

**Key Difference**:
- All four platforms ship the same 11 subagents and the same 18 capabilities
- **Claude Code** splits them into 8 skills (3 auto-trigger) + 10 commands
- **Droid / OpenCode / Ampcode** expose all 18 as commands — no auto-triggering

---

## What's Included

### Claude Code (skills + commands)

**11 Subagents** - Expert personas with specialized knowledge
- 3 Workflow Agents (PRD, Tasks, Implementation)
- 8 Specialist Agents (UX, QA, Architecture, Product, Development, etc.)

**8 Skills** - Auto-triggering + manual workflow components
- tdd-flow, test-traps, verify-done (auto-trigger)
- brainstorming, debug-method, live-canvas, skill-creator, trace-back

**10 Commands** - Workflow helpers
- docs-builder, optimize, refactor, remember, branch-review, security, ship, release, stash, test-generate

**Orchestration System**
- Automatic intent matching to 9 workflow patterns
- Conditional decision points with user approval gates
- Selective context injection

### Droid / OpenCode / Ampcode (commands only)

**11 Subagents** - the same personas, referenced from the platform's config file

**18 Commands** - All workflow capabilities in command form
- Combines Claude's skills + commands into one unified command set
- Same functionality, different invocation model (no auto-triggering)

**No Orchestrator** - Direct command invocation only

---

## Subagents

### Workflow Agents (3)

| Agent | Purpose |
|-------|---------|
| **1-create-prd** | Define scope with structured Product Requirement Documents |
| **2-generate-tasks** | Break PRDs into granular, actionable task lists |
| **3-process-task-list** | Execute tasks iteratively with progress tracking and review checkpoints |

**Pattern**: PRD → Tasks → Iterative Implementation → Review → Complete

### Specialist Agents (8)

| Agent | Purpose |
|-------|---------|
| **orchestrator** | Analyze intent, coordinate workflows, route to optimal agent sequences |
| **ui-designer** | UI/UX design, wireframes, prototypes, accessibility, design systems |
| **code-developer** | Implementation, debugging, refactoring, code best practices |
| **quality-assurance** | Test architecture, quality gates, requirements traceability, risk assessment |
| **system-architect** | System design, technology selection, API design, scalability planning |
| **feature-planner** | Epics, user stories, prioritization, backlog management, retrospectives |
| **market-researcher** | Market analysis, competitive research, project discovery, brainstorming |
| **context-builder** | Initialize project context, discover documentation, create knowledge bases |

---

## Commands Reference

### Claude Code: 18 Total (8 Skills + 10 Commands)

**Auto-Triggering Skills (3)**
- `tdd-flow` - Write test first, watch fail, minimal passing code
- `test-traps` - Prevent mocking anti-patterns and test pollution
- `verify-done` - Run verification before claiming done

**Manual Skills (5)**
- `brainstorming` - Refine rough ideas through collaborative questioning
- `live-canvas` - Design UI variations with click-to-annotate browser feedback. **Claude Code ships a companion MCP channel plugin (`live-canvas-channel`) that enables live mode — each overlay Save streams into the session in real time.** Other tools run in batch mode only. One-time setup required: see `packages/claude/skills/live-canvas/README.md`.
- `trace-back` - Trace bugs backward through call stack
- `skill-creator` - Guide for creating new skills
- `debug-method` - Four-phase debugging framework

**Commands (10)**
- `docs-builder` - Reorg a docs corpus, split an oversized doc, search it, keep pages current, index them
- `optimize` - Performance analysis
- `refactor` - Maintain behavior while improving code
- `remember` - Consolidate stashes + friction into project memory
- `branch-review` - Review a branch + full security audit; verifies findings, reports without fixing
- `security` - Vulnerability scanning
- `ship` - Pre-deployment checklist
- `release` - Prepare a release: verify → docs → bump → commit, then report the merge/tag/publish sequence for you to authorize
- `stash` - Save session context for compaction recovery or handoffs
- `test-generate` - Test suite generation

### Droid / OpenCode / Ampcode: 18 Commands

Same functionality as skills+commands, but:
- All invoked as commands (no auto-triggering)
- Unified command set
- `live-canvas` runs in batch mode only (no channel plugin — that's Claude Code specific)

**Command Categories**:
- **Development & Testing (6)**: tdd-flow, test-traps, test-generate, debug-method, trace-back, verify-done
- **Code Operations (6)**: refactor, optimize, branch-review, security, ship, release
- **Session & Memory (5)**: brainstorming, skill-creator, docs-builder, stash, remember
- **Design (1)**: live-canvas

---

## Hot Memory

Lightweight session memory that learns from your usage patterns across sessions. **`/stash` is
the only command you actively run — it drives the whole pipeline.** Once a few stashes pile up
it nudges you to run `/remember`, which does everything else: friction analysis, consolidation,
and wiring the memory into your agent config file.

```
/stash → (nudge at 5+ unprocessed) → /remember
```

1. **`/stash`** - Snapshot current session context to the tool's `…/stash/`. Use before
   compaction, handoffs, or ending complex work. The session drafts the raw content inline
   (only it holds conversation context), then a mid-tier-model subagent expands and writes the
   file — dispatched in the background where the tool supports it, falling back to writing
   inline otherwise. Whichever actor wrote the file counts the unprocessed backlog
   (`stash files − .processed entries`) and, at 5+, nudges you to run `/remember`. No counter is
   stored; running `/remember` clears the backlog.
2. **`/remember`** - Runs friction analysis first (best-effort — scores sessions across *all* your
   projects from the tool's global sessions root, clusters failures into antigens), then
   consolidates stashes + antigens into `…/remember/MEMORY.md` and injects `@MEMORY.md` into the
   **per-tool agent config — `CLAUDE.md` (Claude Code), `AGENTS.md` (Droid / OpenCode), or
   `AGENT.md` (Ampcode)** — so every future session loads it. Each package writes to its own
   tool's config file; the global probe list only governs which logs friction *reads*. Per-stash
   extraction runs as concurrent subagent calls on a mid-tier model — no vendor-specific model
   name hardcoded, so it works with whatever your tool has configured.
3. **`AGENT_RULES.md` bootstrap** - On first `/remember` run, if `…/remember/AGENT_RULES.md`
   doesn't exist, it's copied from a bundled standards-guide template — never overwritten again
   after that, so local edits persist — and injected into the agent config via its own
   independent marker pair. It's a guide to consult when building something new, separate from
   the MEMORY.md hot-context block above.

**Result:** Project-local memory that accumulates across sessions — no external dependencies, no databases, just markdown.

---

## Usage Patterns

### Claude Code / Ampcode: Orchestrator-First (Recommended)

The orchestrator analyzes your request and routes to optimal workflows automatically.

**How it works**:
1. Make natural requests: "Add login feature", "Review this PR", "Plan next sprint"
2. Orchestrator matches intent to workflow patterns
3. Conditional gates ask for approval before each phase
4. Specialists execute with domain expertise

**Example Flow - Feature Development**:
```
User: "Add authentication feature"
  ↓
Orchestrator: "Research competitive approaches first?" [Yes/No]
  ↓ Yes
Market Researcher: [Gathers auth patterns, OAuth vs JWT tradeoffs]
  ↓
Orchestrator: "Create formal PRD?" [Yes/No]
  ↓ Yes
1-Create-PRD: [Structured requirements document]
  ↓
Orchestrator: "Generate implementation tasks?" [Yes/No]
  ↓ Yes
2-Generate-Tasks: [20 granular tasks with acceptance criteria]
  ↓
Orchestrator: "Start systematic implementation?" [Yes/No]
  ↓ Yes
3-Process-Task-List: [Iterative implementation with review gates]
```

**Bypass Options**:
- Direct agent: `@quality-assurance review this code`
- Role syntax: `As system-architect, design the API layer`
- Skills: `/tdd-flow login-feature`

### 9 Pre-Defined Workflow Patterns

1. **Feature Discovery Flow** - Research → PRD → Tasks → Implementation
2. **Product Definition Flow** - Strategy → Epics/Stories → Technical Assessment
3. **Story Implementation Flow** - Validate → Implement → QA Gate
4. **Architecture Decision Flow** - Constraints → Analysis → Alignment
5. **UI Development Flow** - Design → PRD (optional) → Implement → Validate
6. **Bug Triage Flow** - Investigate → Severity Assessment → Fix/Backlog
7. **Brownfield Discovery Flow** - Context Building → Documentation → Assessment
8. **Quality Validation Flow** - Review → Pass/Concerns/Fail → Remediation
9. **Sprint Planning Flow** - Prioritize → Stories → Criteria → Tasks

Each pattern includes conditional decision points requiring user approval.

### Droid/OpenCode: Direct Command Invocation

No orchestrator - invoke commands directly:
- `/branch-review <file-or-branch> [level]`
- `/refactor <code-section>`
- `/tdd-flow <feature>`

Subagent workflows require manual coordination.

---

## Value Proposition

### For Individual Developers
- **Instant Expertise** - Access 11 specialist agents without hiring
- **Consistent Quality** - Best practices built into every agent
- **Faster Iteration** - Systematic workflows reduce trial-and-error
- **Learning Tool** - Observe expert patterns and decision-making

### For Teams
- **Standardized Processes** - Shared agent definitions ensure consistency
- **Onboarding Acceleration** - New members learn patterns through agent interactions
- **Documentation Culture** - context-builder and docs-builder promote knowledge capture
- **Cross-Functional Collaboration** - Product, design, and engineering agents work together

### For Technical Leaders
- **Scalable Expertise** - Multiply senior-level guidance across projects
- **Quality Gates** - Built-in review and validation checkpoints
- **Architectural Consistency** - system-architect ensures coherent design decisions
- **Reduced Context Switching** - Specialists handle domain-specific work

---

## Platform Architecture

### Claude Code
```
~/.claude/
├── CLAUDE.md           # Registry + orchestrator workflows
├── agents/             # 11 subagent implementations (*.md)
├── skills/             # 8 skills (subdirectories with SKILL.md)
└── commands/           # 10 commands (*.md)
```

**Features**:
- Full subagent system with orchestrator
- Auto-triggering skills
- Workflow pattern matching
- Progressive agent loading

### Ampcode
```
~/.config/amp/
├── AGENT.md            # Reference doc (subagents + commands)
├── agents/             # 11 subagent implementations (*.md)
└── commands/           # 18 commands (*.md)
```

**Features**:
- Full subagent system with orchestrator
- All capabilities as commands (no auto-triggering)

### Droid
```
~/.factory/
├── AGENTS.md           # Reference doc (subagents + commands)
├── droids/             # 11 subagent implementations (*.md)
└── commands/           # 18 commands (*.md)
```

**Features**:
- Reference table for subagents
- Direct command invocation (no auto-triggering)

### OpenCode
```
~/.config/opencode/
├── AGENTS.md           # Reference doc (subagents + commands)
├── agent/              # 11 subagent implementations (*.md)
└── command/            # 18 commands (*.md)
```

**Features**:
- Reference table for subagents
- Direct command invocation (no auto-triggering)

---

## Frontmatter Architecture

All resources are self-describing via YAML frontmatter for auto-discovery:

**Subagents** (`agents/*.md`):
```yaml
---
id: code-developer
title: Full Stack Developer
description: Implement code, debug, refactor
when_to_use: Use for code implementation, debugging, refactoring, and development best practices
model: inherit
color: purple
---
```

**Skills** (`skills/*/SKILL.md`):
```yaml
---
id: tdd-flow
name: tdd-flow
description: Write test first, watch it fail, write minimal code to pass
usage: /tdd-flow <feature-or-behavior-to-test>
auto_trigger: true
---
```

**Commands** (`commands/*.md`):
```yaml
---
id: refactor
name: refactor
description: Refactor code while maintaining behavior and tests
usage: /refactor <code-section>
argument-hint: [file-or-function]
---
```

This enables:
- Dynamic registry building by CLIs
- Single source of truth (no manual registries)
- Consistent metadata across platforms
- Easy extensibility

---

## Contributing

Contributions welcome for:
- New specialist agents for additional domains
- Additional workflow patterns
- Platform-specific optimizations
- Documentation improvements

See repository for contribution guidelines.

---

**License**: [Specify license]
**Repository**: https://github.com/hamr0/agentic-toolkit
**Issues**: https://github.com/hamr0/agentic-toolkit/issues
