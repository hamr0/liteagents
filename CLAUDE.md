# liteagents

AI development toolkit with 11 specialized agents and 20 commands per tool. Supports Claude, Opencode, Ampcode, and Droid.

## Documentation
See `README.md` for usage and `docs/INSTALLER_GUIDE.md` for installation details.

## Dev Rules (mandatory — full source: `.claude/memory/AGENT_RULES.md`)

**Simple > clever.** Readable code a junior can follow beats elegant code that needs a PhD to debug. Be the Simplicity Advocate: call out overcomplications and suggest simpler alternatives BEFORE building, not after.

**Every line must have a purpose.** No speculative code, no "might need this later", no abstractions for one use case. If you split one file into N similar files, stop and check whether N=1 with a few extra lines is clearer.

**Surgical changes only.** Touch what the task requires; nothing else. Don't "improve" adjacent code, comments, or formatting. Match existing style.

**Dependency hierarchy — exhaust simpler first:** vanilla language → standard library → external (only when stdlib can't do it in <100 lines). External deps must be maintained, lightweight, widely adopted. Exception: always use vetted libraries for security-critical code.

**Lightweight over complex.** Vanilla over frameworks. Express over NestJS, Flask over Django, plain JS over React if the project doesn't genuinely need it. Open-source only, no vendor lock-in.

**Responsive web UI is mandatory.** User builds web apps consumed on phones — fluid layouts, viewport meta, no horizontal scroll. Test in DevTools device emulation before claiming a UI task is done.

**POC first.** Validate logic with ~15min proof-of-concept before designing properly. Never ship the POC — rewrite it.

For full standards (testing, twelve-factor, deployment), see `.claude/memory/AGENT_RULES.md`.

<!-- MEMORY:START -->
@MEMORY.md
<!-- MEMORY:END -->
