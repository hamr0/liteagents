# Global Opencode CLI

Opencode is a lightweight CLI tool that provides workflow automation commands.

## Opencode Subagents (Reference)

These subagents are available when using Claude Code CLI. Opencode can reference them but doesn't implement them directly.

### Subagents (10 total)

| ID | Title | When To Use |
|---|---|---|
| 1-create-prd | 1-Create PRD | Define Scope - use to clearly outline what needs to be built with a Product Requirement Document (PRD) |
| 2-generate-tasks | 2-Generate Tasks | Detailed Planning - use to break down the PRD into a granular, actionable task list |
| 3-process-task-list | 3-Process Task List | Iterative Implementation - use to guide the AI to tackle one task at a time, allowing you to review and approve each change |
| code-developer | Full Stack Developer | Use for code implementation, debugging, refactoring, and development best practices |
| feature-planner | Product Manager | Use for creating epics and user stories, prioritization, backlog navigation, story refinement, and retrospectives |
| market-researcher | Business Analyst | Use for market research, brainstorming, competitive analysis, project briefs, and initial project discovery |
| orchestrator | Master Orchestrator | Use for workflow coordination, multi-agent tasks, role switching guidance, and when unsure which specialist to consult |
| quality-assurance | Test Architect & Quality Advisor | Use for comprehensive test architecture review, quality gate decisions, and code improvement. Provides thorough analysis including requirements traceability, risk assessment, and test strategy. Advisory only - teams choose their quality bar |
| system-architect | Architect | Use for system design, architecture documents, technology selection, API design, and infrastructure planning |
| ui-designer | UX Expert | Use for UI/UX design, wireframes, prototypes, front-end specifications, and user experience optimization |

## Opencode Commands (14 total)

| ID | Description | Usage |
|---|---|---|
| brainstorming | Refines rough ideas into fully-formed designs through collaborative questioning | /brainstorming <session-type> <topic> |
| docs-builder | Reorg a docs corpus, split an oversized doc, search it, keep pages current, index them | /docs-builder [reorg \| cleanup <file.md>] |
| live-canvas | Design UI variations and collect click-to-annotate feedback from the browser (batch mode only on Opencode) | /live-canvas |
| optimize | Analyze and optimize performance issues | /optimize <target-area> | - |
| refactor | Refactor code while maintaining behavior and tests | /refactor <code-section> | - |
| remember | Consolidate stashes + friction into project memory | /remember | - |
| branch-review | Pre-merge review: general review + full security audit, verify pass, no fixes | /branch-review [target] [level] | - |
| root-cause | Find the cause before changing code - evidence, backward trace, one hypothesis, fix at the source | /root-cause <bug-or-error-description> |
| security | Security audit — recurring six, injection, auth, trust boundaries; reports, never fixes | /security [target] | - |
| ship | Mechanical pre-deploy gate — tests, build, tree state | /ship | - |
| release | Verify, sweep docs, cut a version — then hand back the merge/tag/publish sequence | /release | - |
| skill-creator | Guide for creating effective skills and extending Claude capabilities | /skill-creator <skill-type> <skill-description> |
| stash | Save session context for compaction recovery or handoffs | /stash ["optional-name"] | - |
| test-generate | Generate tests, run them, verify each one actually exercises the code | /test-generate <file> | - |

All resources are auto-discovered from frontmatter in their respective directories:
- **Agents**: `./agent/*.md`
- **Commands**: `./command/*.md`
