# liteagents

AI development toolkit with 10 specialized agents and 12 commands and skills per tool. Supports Claude, Opencode, Ampcode, and Droid.

## Documentation
See `README.md` for usage and `docs/product/INSTALLER_GUIDE.md` for installation details.

**Editing a command, skill or subagent?** Read
`docs/product/INSTALLER_GUIDE.md` (its *Changing a command, skill or
subagent* section) first. Short version: edit
`packages/claude` only, then `node scripts/mirror.cjs sync && node
scripts/mirror.cjs check`. Never hand-edit a droid/ampcode/opencode file.

<!-- DEV_RULES:START -->
## Dev Rules

**Spec first.** Interview for the decision, not the task. Ask in batched rounds — only questions whose prerequisites are settled, each with your recommended answer; look up facts yourself, ask me only the choices that are mine. Pin module 0, ask what is out of scope, write a PRD (problem, go/no-go, out of scope, modules, open questions). One round is not an interview; never build on an assumed prerequisite.

**Reuse before you add.** Before adding a function, class, file, or dependency, search for the one that already does it, and report what you reused. A near-duplicate needs a stated reason the original couldn't be extended. One thing, one name, repo-wide.

**Don't patch a patch.** A third fix on the same spot means the design is wrong — stop and propose the redesign. A new layer must hide more than its interface costs; otherwise inline it.

**POC first, one module at a time.** Aim each POC at its riskiest assumption (module 0 = go/no-go); the test must be able to fail. Prove, don't assert — measure anything you call cheap or fast. No fitting to pass. A module works alone, then connects to what's built, before the next starts. Never ship the POC.

**Dependencies, simplest first.** Vanilla language → standard library → external, only when stdlib can't do it in <100 lines. External deps must be maintained, lightweight, widely adopted; security-critical code always gets a vetted library. Open-source only, no vendor lock-in.

**Simple > clever.** Fewer moving parts, fewer deps, less config; readable by a junior beats elegant. Call out overcomplication before building. Express over NestJS, Flask over Django, unless the project needs the framework.

**Every line earns its place.** If you can't say what breaks when it's deleted, delete it. No speculative code, no abstraction for one use case.

**One writer per piece of state.** One function assigns each field; everything else calls it. Grep who writes it before you write it — and if a write can land from a callback, thread, or lifecycle, the reader must tell stale from fresh.

**Surgical changes only.** Touch what the task requires; match existing style. Dead code, nits, bugs you pass: if it's inside or affects the code you're already changing and the fix changes no behavior, fix it and say so — otherwise report it and say what it costs to leave it. A problem you don't fix goes in the report, never in a comment.

**Responsive web UI is mandatory.** Any web UI must work on mobile by default — fluid layouts, viewport meta, breakpoints, no horizontal scroll. Verify in DevTools device emulation before claiming a UI task is done. POCs exempt; real projects are not.
<!-- DEV_RULES:END -->

<!-- MEMORY:START -->
@.claude/remember/MEMORY.md
<!-- MEMORY:END -->

<!-- AGENT_RULES:START -->
Consult when building something new or adding a feature — a standards guide, not hot
context like MEMORY.md above:
.claude/remember/AGENT_RULES.md
<!-- AGENT_RULES:END -->

<!-- DOCS_INDEX:START -->
Docs map: `docs/index.md` — every doc in this project, with line counts.
Search this corpus instead of reading it whole: `/docs-builder search <query words>`
<!-- DOCS_INDEX:END -->
