---
name: stash
description: Stash session context [name]
argument-hint: [optional stash name]
allowed-tools: Read, Grep, Glob
disable-model-invocation: true
---

Save session context for compaction recovery or handoffs.

**Guardrails**
- **Write only what the brief contains.** The subagent expands the brief into a file; it does
  not research, re-derive, or infer. Every fact, number, SHA, path, and identifier in the
  stash comes from the brief verbatim — never invent, never round, never fill a gap with a
  plausible guess. Missing detail stays missing.
- **Escalate, never assume.** Anything the subagent cannot do, cannot verify, or that this
  spec does not cover → report it back to the orchestrator (the main session) rather than
  improvising. Never widen scope beyond writing the file and counting the backlog.
- **Explicitly select your tool's mid tier.** State the tier on the spawn — do not omit it
  and rely on a default. An omitted tier inherits the *parent's* tier, which is not the same
  thing as the balanced one. Pick the judgment-capable tier that is cheaper and faster than
  your top reasoning tier. **Not the cheapest/fastest tier**: on judgment work it measurably
  degrades (misclassification rates several times higher). Choose by tier, not by a vendor
  model name copied from this file — names drift, and this command ships to several tools.
- **Background dispatch where supported.** Run the write-up subagent in the background
  (non-blocking) so the session isn't held up waiting on formatting/file I/O. Fall back to
  writing inline (today's behavior) if your tool has no subagent or background-dispatch
  mechanism.

**What it does**
1. Drafts a compact brief of current conversation context, key decisions, active work in
   progress, and findings/insights — done inline, since only the running session holds full
   conversation context
2. Hands the brief to a subagent on the mid-tier model (see Guardrails) to expand into the
   full stash file at `.claude/stash/<name>.md`, dispatched in the background where the tool
   supports it. Falls back to writing inline if subagent/background dispatch isn't available
3. Enables context restoration after compaction
4. **Consolidation nudge** — whichever actor wrote the file (the subagent, or the session
   itself on the inline fallback) counts the unprocessed backlog after saving. `$ROOT` is the
   absolute repo root — the same one the stash file was just written under. Resolve it with
   `git rev-parse --show-toplevel`. Run these two lines verbatim. Do not substitute a
   cwd-relative path (the write-up subagent's cwd is not guaranteed to be the repo root) and
   do not discover the manifest with a `*` glob over the remember dir (`.processed` is a
   dotfile, and globs skip dotfiles):

   ```bash
   find "$ROOT/.claude/stash/" -maxdepth 1 -name '*.md' ! -name '.*' 2>/dev/null | wc -l   # total
   if [ -f "$ROOT/.claude/remember/.processed" ]; then grep -c '' "$ROOT/.claude/remember/.processed"; else echo 0; fi   # processed
   ```

   `unprocessed = total − processed`. Use `grep -c ''`, not `wc -l`: a manifest whose last
   entry has no trailing newline undercounts by one under `wc -l`.

   If `$ROOT` cannot be resolved, report the backlog as **UNKNOWN** and name the path that
   failed — never substitute 0. Substituting 0 maximizes the apparent backlog and fires the
   nudge on every stash. A resolvable `$ROOT` with no `.processed` file is a genuine 0.

   If `unprocessed >= 5`, end with one line, carrying the raw numbers so a miscount is
   visible without re-deriving it:
   > 📝 N unprocessed stashes (T total − P consolidated) — run `/remember` to fold them into memory.

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
ls .claude/stash/

# Restore from stash
cat .claude/stash/<name>.md
```

**Reference**
- Stashes stored in `.claude/stash/` (project-local)
- Automatically includes: timestamp, active plan, recent decisions
- Maximum context retention with minimal token usage
- When dispatched in the background, the "Stashed to X" confirmation and consolidation nudge
  arrive as the subagent's completion notification rather than inline in the same turn
