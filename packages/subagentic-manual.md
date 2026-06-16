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
| **Claude Code** | `cp -r claude/* ~/.claude/` | 11 subagents + 9 skills + 9 commands + live-canvas-channel plugin |
| **Droid** | `cp -r droid/* ~/.factory/` | 18 commands (subagent references) |
| **Ampcode** | `cp -r ampcode/* ~/.config/amp/` | 11 subagents + 9 skills + 9 commands |
| **OpenCode** | `cp -r opencode/* ~/.config/opencode/` | 18 commands (subagent references) |

**Key Difference**:
- **Claude Code / Ampcode** implement full subagent system with orchestrator
- **Droid/OpenCode** provide commands only + reference documentation for subagents

---

## What's Included

### Claude Code / Ampcode (Full System)

**11 Subagents** - Expert personas with specialized knowledge
- 3 Workflow Agents (PRD, Tasks, Implementation)
- 8 Specialist Agents (UX, QA, Architecture, Product, Development, etc.)

**10 Skills** - Auto-triggering + manual workflow components
- tdd-flow, test-traps, verify-done (auto-trigger)
- brainstorming, debug-method, docs-builder, live-canvas, etc.

**9 Commands** - Simple workflow helpers
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
- friction, optimize, refactor, remember, review, security, ship, stash, test-generate
