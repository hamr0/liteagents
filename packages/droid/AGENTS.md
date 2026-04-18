# Global Droid CLI

Droid is a lightweight CLI tool that provides workflow automation commands.

## Droid Subagents (Reference)

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

## Droid Commands (22 total)

| ID | Description | Usage | Auto |
|---|---|---|---|
| brainstorming | Refines rough ideas into fully-formed designs through collaborative questioning | /brainstorming <session-type> <topic> | false |
| code-review | Reviews implementation against plan or requirements before proceeding | /code-review <review-scope> <focus-areas> | false |
| condition-based-waiting | Replaces arbitrary timeouts with condition polling to wait for actual state changes | /condition-based-waiting <condition-type> <timeout-specs> | false |
| debug | Debug an issue systematically using structured investigation techniques | /debug <issue-description> | - |
| docs-builder | Create comprehensive project documentation with structured /docs hierarchy | /docs-builder | false |
| explain | Explain code for someone new to the codebase | /explain <code-section> | - |
| friction | Analyze session logs for failure patterns and behavioral signals | /friction <sessions-path> | - |
| git-commit | Analyze changes and create intelligent git commits | /git-commit | - |
| live-canvas | Design UI variations and collect click-to-annotate feedback from the browser (batch mode only on Droid) | /live-canvas | false |
| optimize | Analyze and optimize performance issues | /optimize <target-area> | - |
| refactor | Refactor code while maintaining behavior and tests | /refactor <code-section> | - |
| remember | Consolidate stashes + friction into project memory | /remember | - |
| review | Comprehensive code review including quality, tests, and architecture | /review | - |
| root-cause-tracing | Systematically traces bugs backward through call stack to identify source | /root-cause-tracing <issue-description> | false |
| security | Security vulnerability scan and analysis | /security | - |
| ship | Pre-deployment verification checklist | /ship | - |
| skill-creator | Guide for creating effective skills and extending Claude capabilities | /skill-creator <skill-type> <skill-description> | false |
| stash | Save session context for compaction recovery or handoffs | /stash ["optional-name"] | - |
| systematic-debugging | Four-phase debugging framework - investigate root cause before any fixes | /systematic-debugging <bug-or-error-description> | false |
| test-driven-development | Write test first, watch it fail, write minimal code to pass | /test-driven-development <feature-or-behavior-to-test> | true |
| test-generate | Generate comprehensive test suites for existing code | /test-generate <code-section> | - |
| testing-anti-patterns | Prevents testing mock behavior and production pollution with test-only methods | /testing-anti-patterns <testing-scenario> | true |
| verification-before-completion | Requires running verification commands before making any success claims | /verification-before-completion <work-to-verify> | true |

All resources are auto-discovered from frontmatter in their respective directories:
- **Agents**: `./droids/*.md`
- **Commands**: `./commands/*.md`
