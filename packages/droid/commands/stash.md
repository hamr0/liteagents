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

**What it does**
1. Captures current conversation context and key decisions
2. Records active work in progress
3. Stores important findings and insights
4. Creates stash file in `.factory/stash/`
5. Enables context restoration after compaction
6. **Consolidation nudge** — after saving, count the unprocessed backlog:
   `unprocessed = (files in .factory/stash/*.md) − (entries in .factory/remember/.processed)`
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
ls .factory/stash/

# Restore from stash
cat .factory/stash/<name>.md
```

**Reference**
- Stashes stored in `.factory/stash/` (project-local)
- Automatically includes: timestamp, active plan, recent decisions
- Maximum context retention with minimal token usage
