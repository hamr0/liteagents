---
name: stash
description: Stash session context [name]
usage: /stash ["optional-name"]
argument-hint: [optional stash name]
---

Save session context for compaction recovery or handoffs.

**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- **Mid-tier model, not hardcoded.** The write-up subagent (step 2) uses a mid-tier model —
  capable of semantic judgment, cheaper/faster than your top reasoning tier (e.g. Claude's
  Sonnet vs Opus). Use whatever your tool designates as that balanced default; never hardcode
  a vendor-specific model name.
- **Background dispatch where supported.** Run the write-up subagent in the background
  (non-blocking) so the session isn't held up waiting on formatting/file I/O. Fall back to
  writing inline (today's behavior) if your tool has no subagent or background-dispatch
  mechanism.

**What it does**
1. Drafts a compact brief of current conversation context, key decisions, active work in
   progress, and findings/insights — done inline, since only the running session holds full
   conversation context
2. Hands the brief to a subagent on the mid-tier model (see Guardrails) to expand into the
   full stash file at `.opencode/stash/<name>.md`, dispatched in the background where the tool
   supports it. Falls back to writing inline if subagent/background dispatch isn't available
3. Enables context restoration after compaction
4. **Consolidation nudge** — whichever actor wrote the file (the subagent, or the session
   itself on the inline fallback) counts the unprocessed backlog after saving:
   `unprocessed = (files in .opencode/stash/*.md) − (entries in .opencode/remember/.processed)`
   (a missing `.processed` manifest means 0 processed). If `unprocessed >= 5`, end with one line:
   > 📝 N stashes since last consolidation — run `/remember` to fold them into memory.

   No counter is stored — the count is derived each time, and running `/remember` updates
   `.processed`, so the backlog drops on its own. Just emit the nudge; never run `/remember` automatically.

**When to use**
- Before long-running tasks that may trigger compaction
- When handing off work to another agent or session
- After completing major investigation or analysis
- Before taking a break from complex multi-step work

**Commands**
```bash
# Stash with auto-generated name
/stash

# Stash with custom name
/stash "feature-auth-investigation"

# List available stashes
ls .opencode/stash/

# Restore from stash
cat .opencode/stash/<name>.md
```

**Reference**
- Stashes stored in `.opencode/stash/` (project-local)
- Automatically includes: timestamp, active plan, recent decisions
- Maximum context retention with minimal token usage
- When dispatched in the background, the "Stashed to X" confirmation and consolidation nudge
  arrive as the subagent's completion notification rather than inline in the same turn
