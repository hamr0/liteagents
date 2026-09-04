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
| **Claude Code** | `cp -r claude/* ~/.claude/` | 10 subagents + 8 skills + 10 commands + live-canvas-channel plugin |
| **Droid** | `cp -r droid/* ~/.factory/` | 10 subagents + 18 commands |
| **Ampcode** | `cp -r ampcode/* ~/.config/amp/` | 10 subagents + 18 commands |
| **OpenCode** | `cp -r opencode/* ~/.config/opencode/` | 10 subagents + 18 commands |

**Key Difference**:
- All four platforms ship the same 10 subagents and the same 18 capabilities
- **Claude Code** splits them into 8 skills (3 auto-trigger) + 10 commands
- **Droid / OpenCode / Ampcode** expose all 18 as commands — no auto-triggering

---

## What's Included

### Claude Code (skills + commands)

**10 Subagents** - Expert personas with specialized knowledge
- 3 Workflow Agents (PRD, Tasks, Implementation)
- 7 Specialist Agents (orchestration, UX, QA, architecture, product, development, research)

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

**10 Subagents** - the same personas, referenced from the platform's config file

**18 Commands** - All workflow capabilities in command form
- Combines Claude's skills + commands into one unified command set
- Same functionality, different invocation model (no auto-triggering)

**No Orchestrator** - Direct command invocation only

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

18 capabilities. On Claude Code they split into 8 skills and 10 commands, and three of the
skills fire on their own when the situation matches. On Droid / OpenCode / Ampcode the same
18 are all commands, with no auto-triggering.

| Command | What it's for |
|---|---|
| `/stash` | Snapshot this session's context before compaction or handoff |
| `/remember` | Fold stashes + friction into hot project memory |
| `/docs-builder` | Reorg, index, and split a docs corpus so search actually finds things |
| `/branch-review` | Full pre-merge review — blockers reported, nits to the fix ledger |
| `/release` | Docs sweep, version bump, local commit, then hand back the merge sequence |
| `/refactor` | Clear the fix ledger; with args, refactor a named area |
| `/security` | Standalone vulnerability audit (also stage 2 of `/branch-review`) |
| `/ship` | Mechanical pre-deploy gate — tests, build, tree state, pass/fail only |
| `/test-generate` | Generate a test suite and verify each test exercises real code |
| `/optimize` | Performance analysis on a named target |
| `/brainstorming` | Turn a rough idea into a formed design by questioning |
| `/debug-method` | Four-phase debugging — root cause before any fix |
| `/trace-back` | Walk a deep error backward to its original trigger |
| `/live-canvas` | UI variations with click-to-annotate feedback in the browser |
| `/skill-creator` | Build a new skill |
| `/tdd-flow` ⚡ | Test first, watch it fail, then minimal code |
| `/test-traps` ⚡ | Stop mocking anti-patterns and test-only production code |
| `/verify-done` ⚡ | No "it works" claim without a command run behind it |

<sub>⚡ = auto-triggering, Claude Code only. `/live-canvas` runs in batch mode on
Droid / OpenCode / Ampcode — the MCP channel plugin is Claude Code specific.</sub>

**By category** — Development & testing (6): tdd-flow, test-traps, test-generate,
debug-method, trace-back, verify-done · Code operations (6): refactor, optimize,
branch-review, security, ship, release · Session & memory (5): brainstorming,
skill-creator, docs-builder, stash, remember · Design (1): live-canvas.

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
- **Instant Expertise** - Access 10 specialist agents without hiring
- **Consistent Quality** - Best practices built into every agent
- **Faster Iteration** - Systematic workflows reduce trial-and-error
- **Learning Tool** - Observe expert patterns and decision-making

### For Teams
- **Standardized Processes** - Shared agent definitions ensure consistency
- **Onboarding Acceleration** - New members learn patterns through agent interactions
- **Documentation Culture** - docs-builder promotes knowledge capture
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
├── agents/             # 10 subagent implementations (*.md)
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
├── agents/             # 10 subagent implementations (*.md)
└── commands/           # 18 commands (*.md)
```

**Features**:
- Full subagent system with orchestrator
- All capabilities as commands (no auto-triggering)

### Droid
```
~/.factory/
├── AGENTS.md           # Reference doc (subagents + commands)
├── droids/             # 10 subagent implementations (*.md)
└── commands/           # 18 commands (*.md)
```

**Features**:
- Reference table for subagents
- Direct command invocation (no auto-triggering)

### OpenCode
```
~/.config/opencode/
├── AGENTS.md           # Reference doc (subagents + commands)
├── agent/              # 10 subagent implementations (*.md)
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
