<div align="center">

```
         ██╗     ██╗████████╗███████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗
         ██║     ██║╚══██╔══╝██╔════╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝
         ██║     ██║   ██║   █████╗  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗
         ██║     ██║   ██║   ██╔══╝  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
         ███████╗██║   ██║   ███████╗██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║
         ╚══════╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
```

**10 specialized agents · 15 commands & skills · Claude · Opencode · Ampcode · Droid**

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/liteagents?label=version&color=2a4f8c" alt="version">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
</p>

</div>

Liteagents started as scaffolding for early LLMs that needed to be told everything.
It isn't that anymore. Models got smarter, so the toolkit got thinner: specialists you
call by name or that trigger themselves on domain, wide lanes instead of tight rails,
constraints on *what* rather than scripts for *how*.

It is actively challenged, pruned and rewritten — things get renamed, added, and
deleted as models improve. That churn is the point.

```bash
npx liteagents          # recommended
# or: npm install -g liteagents && liteagents   (never sudo)
```

<sub>Permission errors? `mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'`, then add `~/.npm-global/bin` to your `PATH`.</sub>

---

## The catalog

**Agents** — invoke with `@name` (Claude Code) or `/name`.

| Agent | What it's for |
|---|---|
| `1-create-prd` | Define scope as a PRD — a portal into the work, not a spec to obey |
| `2-generate-tasks` | Break a PRD into granular, actionable tasks |
| `3-process-task-list` | Execute tasks one at a time with review checkpoints |
| `orchestrator` | Read intent, route to the right agent sequence |
| `code-developer` | Implementation, debugging, refactoring |
| `quality-assurance` | Test architecture, quality gates, risk assessment |
| `feature-planner` | Epics, user stories, prioritization, backlog |
| `market-researcher` | Market and competitive analysis, project discovery |
| `system-architect` | System design, tech selection, API design, scale |
| `ui-designer` | UI/UX, wireframes, prototypes, design systems |

**Commands & skills** — `/name`.

| Command | What it's for |
|---|---|
| `/stash` | Snapshot this session's context before compaction or handoff |
| `/remember` | Fold stashes + friction into hot project memory |
| `/docs-builder` | Reorg, index, and split a docs corpus so search actually finds things |
| `/branch-review` | Full pre-merge review — blockers reported, nits to the fix ledger |
| `/refactor` | Clear the fix ledger; with args, refactor a named area |
| `/release` | Docs sweep, version bump, local commit, then hand back the merge sequence |
| `/security` | Standalone vulnerability audit (also stage 2 of `/branch-review`) |
| `/ship` | Mechanical pre-deploy gate — tests, build, tree state, pass/fail only |
| `/test-generate` | Generate a test suite and verify each test exercises real code |
| `/optimize` | Performance analysis on a named target |
| `/brainstorming` | Turn a rough idea into a formed design by questioning |
| `/debug-method` | Four-phase debugging — root cause before any fix |
| `/trace-back` | Walk a deep error backward to its original trigger |
| `/live-canvas` | UI variations with click-to-annotate feedback in the browser |
| `/skill-creator` | Build a new skill |

<sub>Claude Code splits these into 5 skills and 10 commands; Opencode, Ampcode and Droid expose all 15 as commands, plus agent reference docs.</sub>

---

## The ones that carry the load

### `AGENT_RULES.md` — the architect behind every project

One lightweight, generic, model-agnostic rules doc. It sets **what** matters and leaves
wide room on **how**: simple over clever, every line has a purpose, surgical changes,
exhaust the stdlib before reaching for a dependency, POC before you design.

With smarter models a PRD is a **portal, not a deliverable** — the start of a
conversation. You discover it module by module, reviewing, changing and deleting as
experience arrives, instead of pinning everything down up front.

It is loaded every session, linked from `CLAUDE.md`, and `/remember` keeps it fresh —
each run byte-compares your copy against the template that shipped with your install.

| your copy | what happens |
|---|---|
| identical | nothing — no write, no output |
| missing | copied in |
| different | moved to `AGENT_RULES.md.bak`, template copied in, both reported |

Edits are never destroyed, but they aren't preserved in place either. `.bak` is a
*single* file the next update overwrites — a customised body survives one release, not two.

### `/stash` → `/remember` — the daily driver

```
/stash  ──►  /remember
capture      consolidate
```

**`/stash`** is project-local: one session, one feature or scope or goal. Start fresh
on delivery, or when context hits ~30% (never past 40%). The stash is the clean handoff
to the next session.

**`/remember`** fires on the nudge every 5 stashes. It folds those 5 in — and it also
reads across *all* your projects, mining session logs for where you and the model
actually collided: corrections, dead ends, abandoned flows. Those become rules, so the
next session is less wrong than this one.

Markdown files, no database, no RAG, always hot in context, and it keeps the nuances of
each project separate. Runs on a mid-tier model.

### `/docs-builder` — the other daily driver

Markdown gets out of hand. A token-hungry agent then can't find the knowledge that
matters. (Its own PRD grew from 500 lines to 3k+ as findings piled in — exactly the
problem it exists to solve.)

It indexes everything under `/docs` in four buckets — `product/`, `logs/`, `wiki/`,
`archive/` — reorganizes, indexes, and splits oversized docs so you don't have to.
Mid-tier model.

### `/live-canvas` — the UI every agent CLI was missing

A terminal agent can't see your screen, and you can't describe "that padding, on that
card, but only on mobile" in words without burning ten minutes.

`/live-canvas` spins up one lightweight localhost page with your UI on it. You **click
the thing that needs changing**, type what you want, and submit. Comment on as many
elements as you like, all in one pass, then send the batch to the agent.

Two ways it comes back:

- **JSON mode** — feedback lands in a file, you tell the agent to read it. Works in any tool.
- **Live mode** — an MCP channel streams each comment straight into the session, so edits
  land while you're still in the browser. Claude Code only.

It also ships with real UI direction baked in, so it can generate variations of a screen
for you to pick from — no more hours spent nudging divs to find out what you actually wanted.

### `/branch-review` → `/release` → `/refactor`

- **`/branch-review`** — the powerhouse. Reviews every change on a branch, medium depth
  by default. Surfaces confirmed blockers only: real bugs, dead and unused code,
  state-ownership breaks, plus a full OWASP-shaped security pass (no leaked keys, no
  injection, trust boundaries checked) that runs at full depth regardless of level.
  Everything non-blocking goes to the fix ledger.
- **`/release`** — does the pre-release chores you'd otherwise do by hand: README,
  CHANGELOG, PRD, findings, version bump, local commit. Then it tells you you're ready
  to merge, and hands the sequence back. It never pushes.
- **`/refactor`** — with no arguments, works the fix ledger. Cumulative by design: nits
  pile up until you choose to clear them, so review and release never drown in them.

---

## Deeper docs

| Document | What's in it |
|---|---|
| [`/remember`](docs/product/remember-README.md) | The `/stash` → `/remember` pipeline, friction sensor, antigen ledger |
| [`/docs-builder`](docs/product/docs-builder-README.md) | Reorg and cleanup modes, measured cost, the drift ledger |
| [`/branch-review`](docs/product/branch-review-README.md) | The three stages, what blocks, the fix-ledger loop |
| [`/live-canvas`](docs/product/live-canvas-README.md) | Both modes, the click-to-annotate overlay, and setup |
| [live-canvas-channel](docs/product/live-canvas-channel-README.md) | The Claude Code MCP channel plugin — install, protocol, debugging |
| [Installer](docs/product/INSTALLER_GUIDE.md) | Install, troubleshooting, FAQ |
| [All agents & commands](packages/subagentic-manual.md) | Full agent and command reference |
| [Doc index](docs/index.md) | Generated index of every doc, rebuilt on each reorg |

---

## Links

- **npm:** https://www.npmjs.com/package/liteagents
- **GitHub:** https://github.com/hamr0/liteagents
- **Issues:** https://github.com/hamr0/liteagents/issues

Apache-2.0 © 2026 hamr0 — see [LICENSE](LICENSE).
