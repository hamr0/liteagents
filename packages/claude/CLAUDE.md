# Global Claude Code CLI

Claude Code is a lightweight CLI tool that provides workflow automation commands.

## Claude Code Subagents (Reference)

These subagents are available when using Claude Code CLI. Droid can reference them but doesn't implement them directly.

### Subagents (11 total)

| ID | Title | When To Use |
|---|---|---|
| 1-create-prd | 1-Create PRD | Define Scope - use to clearly outline what needs to be built with a Product Requirement Document (PRD) |
| 2-generate-tasks | 2-Generate Tasks | Detailed Planning - use to break down the PRD into a granular, actionable task list |
| 3-process-task-list | 3-Process Task List | Iterative Implementation - use to guide the AI to tackle one task at a time, allowing you to review and approve each change |
| code-developer | Full Stack Developer | Use for code implementation, debugging, refactoring, and development best practices |
| context-builder | Context Initializer | Use to initialize project context for new/existing projects, discover and organize documentation, create CLAUDE.md and KNOWLEDGE_BASE.md for optimal token-efficient memory |
| feature-planner | Product Manager | Use for creating epics and user stories, prioritization, backlog navigation, story refinement, and retrospectives |
| market-researcher | Business Analyst | Use for market research, brainstorming, competitive analysis, project briefs, and initial project discovery |
| orchestrator | Master Orchestrator | Use for workflow coordination, multi-agent tasks, role switching guidance, and when unsure which specialist to consult |
| quality-assurance | Test Architect & Quality Advisor | Use for comprehensive test architecture review, quality gate decisions, and code improvement. Provides thorough analysis including requirements traceability, risk assessment, and test strategy. Advisory only - teams choose their quality bar |
| system-architect | Architect | Use for system design, architecture documents, technology selection, API design, and infrastructure planning |
| ui-designer | UX Expert | Use for UI/UX design, wireframes, prototypes, front-end specifications, and user experience optimization |

### Skills (9 total)

| ID | Description | Usage | Auto |
|---|---|---|---|
| brainstorming | Refines rough ideas into fully-formed designs through collaborative questioning | /brainstorming <session-type> <topic> | false |
| docs-builder | Create comprehensive project documentation with structured /docs hierarchy | /docs-builder | false |
| trace-back | Systematically traces bugs backward through call stack to identify source | /trace-back <issue-description> | false |
| live-canvas | Conduct design interviews, generate UI variations, collect live click-to-annotate feedback via a browser overlay that streams into the session | /live-canvas | false |
| skill-creator | Guide for creating effective skills and extending Claude capabilities | /skill-creator <skill-type> <skill-description> | false |
| debug-method | Four-phase debugging framework - investigate root cause before any fixes | /debug-method <bug-or-error-description> | false |
| tdd-flow | Write test first, watch it fail, write minimal code to pass | /tdd-flow <feature-or-behavior-to-test> | true |
| test-traps | Prevents testing mock behavior and production pollution with test-only methods | /test-traps <testing-scenario> | true |
| verify-done | Requires running verification commands before making any success claims | /verify-done <work-to-verify> | true |

### Commands (8 total)

| ID | Description | Usage |
|---|---|---|
| optimize | Analyze and optimize performance issues | /optimize <target-area> |
| refactor | Refactor code while maintaining behavior and tests | /refactor <code-section> |
| remember | Consolidate stashes + friction into project memory | /remember |
| diff-review | Comprehensive code review including quality, tests, and architecture | /diff-review |
| security | Security vulnerability scan and analysis | /security |
| ship | Pre-deployment verification checklist | /ship |
| stash | Save session context for compaction recovery or handoffs | /stash ["optional-name"] |
| test-generate | Generate tests, run them, verify each one actually exercises the code | /test-generate <file> |

All resources are auto-discovered from frontmatter in their respective directories:
- **Agents**: `./agents/*.md`
- **Skills**: `./skills/*/SKILL.md`
- **Commands**: `./commands/*.md`
