# AGENT_RULES freshness — PRD

> Status: DRAFT, not started. Written 2026-09-03 from a design conversation.
> A portal, not a deliverable — every POC below updates this file.
>
> §5 records the designs considered and rejected. They are limitations we chose,
> not oversights, and each names the signal that would reopen it.

## 1. Problem & goal

`AGENT_RULES.md` is the standing rules doc that primes every session. It ships
inside the npm package at `packages/<kit>/commands/remember/AGENT_RULES.md` (all
four kits, next to `friction.cjs`), the installer copies it into `~/.claude` and
the other tool dirs, and `/remember` copies *that* into each repo's
`.claude/remember/`.

**Nothing ever refreshes the repo copy.** `remember.md:75-77` bootstraps it only
if absent and never overwrites afterwards. The result, measured 2026-09-03
across the local fleet:

| gap | count |
|---|---|
| stale `AGENT_RULES.md` bodies (`1acd0ee6` vs canonical `ce98678a`) | 35 |
| pre-v2.19 `@`-include stubs (~300 lines hot-loaded per session) | 21 |
| repos on the pre-rename `.claude/memory/` layout | 4, all archived |

Only `liteagents` and `agentic-toolkit` are current. Three hand sweeps have been
done and the drift returned each time, which is the actual signal: a rule
enforced by remembering to sweep is not enforced.

**Goal.** Every repo you actually work in converges on the current rules by
itself, nothing is ever destroyed without a recoverable copy, and no fourth hand
sweep is needed.

### The three copies

| # | path | written by | refreshed today? |
|---|---|---|---|
| 1 | `packages/<kit>/commands/remember/AGENT_RULES.md` | the npm package | n/a — it is the source |
| 2 | `~/.claude/commands/remember/AGENT_RULES.md` (and `~/.factory`, `~/.config/amp`, …) | the installer | **yes** — overwritten every run, with `.backup.<timestamp>` (`installer/cli.js:129`) |
| 3 | `<repo>/.claude/remember/AGENT_RULES.md` | `/remember`, once | **no — never** |

Copy 2 is fine and always has been. **Copy 3 is the entire problem**, and it is
the one the installer cannot reach: `installer/cli.js` is home-scoped, resolving
against `os.homedir()` (`:124`, `:611`) and never calling `process.cwd()`. It
does not know a user's repos exist. `/remember` is the only component that runs
inside a repo, and it already owns writing that file.

## 2. Go / no-go

**The riskiest assumption: overwriting copy 3 on every run is safe.** The design
makes it safe by never destroying anything — a differing file is backed up
before it is replaced, exactly as the installer already does for copy 2.

**Go if** a customised repo file survives a `/remember` run as a recoverable
`.backup.<timestamp>` beside it, proven on a real repo.
**No-go if** any path can replace a differing body without leaving a copy.

That is a correctness bar, not a measurement. It is the only thing the feature
stands or falls on.

## 3. Out of scope

- **Auto-running `npm install`.** `/remember` prints the command; the user runs
  it. Updating the package stays their call.
- **GitHub as a source.** Adds a network dependency, a rate limit, and a second
  source of truth that can disagree with the installed package.
- **Fleet propagation.** Updating all 35 repos at once needs repo discovery —
  a filesystem scan or a path registry — in four packages, for an unknown and
  probably small user count. Each repo self-heals on its next `/remember`.
- **Hash stamps, `AGENT_RULES_NEW.md`, historical hash matching.** See §5.
- **Refreshing `~/.claude` commands and skills.** The installer's job; it
  already works, with backups.

## 4. Modules

Built in order; module N+1 does not start while N is unproven.

### Module 1 — Version check in `/remember` step 0 — **BUILT 2026-09-03**

Shipped as `packages/<kit>/commands/remember/version-check.cjs` (all four kits,
0 non-path diffs, each verified by running it and confirming it writes its cache
under that kit's own config dir). Wired into step 0 of `remember.md` in all four
kits. 13 tests in `tests/version-check/`, full suite 1012 passing.

**A POC finding changed the implementation.** `req.setTimeout` is a socket-
inactivity timeout and does not bound connect time: against an unroutable host
a 2000ms budget overran to **5146ms**. An explicit deadline was added, and the
regression test was proven falsifiable by removing that deadline and observing
it go red at 5141ms.


Compare the installed `liteagents` version against the registry's latest. On a
gap, print one line:

```
liteagents 2.24.1 → 2.25.0 available: npm i -g liteagents@latest && liteagents
```

Constraints, all load-bearing:
- Runs inside the existing crash-isolated step 0 alongside `friction.cjs`.
- Result cached with a ~24h TTL at `~/.claude/.liteagents-version.json` —
  home-scoped, because it describes the global install; a per-repo cache would
  make N repos each fetch the same answer.
- **Any failure — timeout, DNS, offline — is a silent skip.** A memory command
  that hangs on a network call is worse than one that misses a nudge.
- Advice only. Never writes, never installs.

### Module 2 — Sync AGENT_RULES, backing up first

Every `/remember` run, compare copy 3 against copy 2 byte-for-byte:

| state | action |
|---|---|
| identical | do nothing — no write, no backup, no output |
| differs | `cp` to `AGENT_RULES.md.backup.<timestamp>`, then overwrite from copy 2 |
| absent | copy it in (today's bootstrap behaviour) |

A byte compare, not a stamp: no JSON, no stored hash, no state to keep in sync.
The question is only "am I about to change this file?", which any careful copy
asks anyway.

This is what makes the unanswerable question unnecessary. We do not know whether
users customise this file, or per-project versus globally, and under this design
we do not need to: if they did, their version is beside it as a backup; if they
did not, they never see a backup file at all.

**Scripted, not prompted.** The compare, backup and copy are one operation in
`friction.cjs` — already the mechanical arm of step 0 — never a model
instruction. A model told to "copy the template" can normalise line endings,
re-wrap, or drop a trailing newline, and a byte compare against a re-formatted
copy differs forever, backing up on every single run. Same reasoning that moved
hash arithmetic and promotion out of prose in the classify-then-count redesign.

### Module 3 — Stub shape assertion and repair

Every run, assert the tool config (`CLAUDE.md` / `AGENTS.md` / `AGENT.md`)
carries the current stub shape, and repair it when wrong:

- `MEMORY.md` `@`-included as `@.claude/remember/MEMORY.md` — a bare
  `@MEMORY.md` resolves to a nonexistent root file and fails silently.
- `AGENT_RULES.md` as a **plain pointer, not an `@`-include** — v2.19 demoted it
  deliberately; an `@`-include hot-loads ~300 lines every session.

Repairs shape, not merely presence. Closes the 21 pre-v2.19 stubs.

### Module 4 — Report what happened

`/remember` reports every action it took, as it always does — never a silent
write:

```
AGENT_RULES.md updated (yours backed up: AGENT_RULES.md.backup.2026-09-03T…)
CLAUDE.md stub repaired: AGENT_RULES pointer was an @-include
liteagents 2.24.1 → 2.25.0 available: npm i -g liteagents@latest && liteagents
```

Silence when nothing changed.

### Module 5 — Installer's closing note

At the end of a `liteagents` run, say loudly where the backups went:

```
Previous skills/commands/subagents backed up at ~/.claude/…backup.<timestamp>
If you had a modified AGENT_RULES.md, it is in there.
```

The installer cannot say anything about repos — it does not know they exist.

### Module 6 — Document the behaviour

Note in `README.md` and `docs/product/INSTALLER_GUIDE.md` that `AGENT_RULES.md`
is refreshed from the global copy on every `/remember` run, and that local edits
are backed up rather than preserved in place. Without this, the first person to
customise it is surprised.

## 5. Known limitations — chosen, not overlooked

Each was designed in this conversation and deliberately dropped. Each names what
would reopen it.

### Per-project customisation is not supported

Edit a project's `AGENT_RULES.md` and the next `/remember` reverts it, leaving a
`.backup.<timestamp>` beside it. This is a real trade, taken knowingly: the file
is a shipped standards doc, the user base is small, and we would rather learn
from an issue report than build for a user we are not certain exists.

**Reopens when:** anyone reports losing edits, or asks for per-project rules.
The backups are the detection mechanism — someone accumulating them is the
signal. Module 2 gains a hash stamp at that point; nothing here blocks it.

### No hash stamp (`.agent-rules.json`)

Designed and dropped. A stamp recording what we wrote would distinguish "vanilla
but stale" from "user edited this", allowing a silent update in the first case
and a hands-off warning in the second. It is unnecessary once a backup makes
overwriting non-destructive, and it adds a second piece of state that must stay
in sync with the file it describes.

**Reopens when:** per-project customisation becomes supported.

### No `AGENT_RULES_NEW.md`

Designed and dropped. The idea was to write the new version alongside a
customised one and let the user fold changes in by hand. The backup inverts it
at no cost — the *new* file lands in place and the *old* one is kept — which is
the same information with one fewer concept, and no file that must be explained.

**Reopens when:** users say they would rather keep their file in place and
review the new one.

### No historical hash matching

Designed and dropped. To classify the 35 unstamped repos, we considered matching
each body against every AGENT_RULES ever shipped, recovered from git tags. It
existed only to serve the stamp; with no stamp it has no purpose. Expected yield
was low anyway — the file was hand-placed in many repos before it shipped in the
package, so perhaps ~10 distinct bodies are recoverable and a hand-placed copy
may match none.

**Reopens when:** the stamp does.

### No warning-based flow

Designed and dropped. An alternative kept `/remember` read-only: warn that the
project file differs and let the user act. It fails on the nag — a
deliberately-customised file warns forever, and a permanent warning trains users
to ignore all warnings, including the version one. Warning only when the
*template* changes fixes the nag but reintroduces stored state, which is the
stamp again.

**Reopens when:** overwriting proves unpopular.

### No global customisation point

Considered: make copy 2 the place users edit, so every repo inherits it. Dropped
because per-project is the more natural expectation, and copy 2 is overwritten
by the installer on every run — making it the customisation point would mean
protecting it too, doubling the machinery.

**Reopens when:** someone asks for house rules across all their projects.

### The unanswered question

**How many users change `AGENT_RULES.md`, and if they do, per project or once
for all projects?** No data. The second is judged less likely. The design is
built so that neither answer is needed: nothing is destroyed either way, and
either answer arriving as an issue report is a cheap signal to act on. This is
recorded as an unknown rather than assumed away.

## 6. Open questions

- **Backup accumulation.** Backups only appear when content differs, so a
  vanilla repo never accrues any. A repo customised repeatedly could collect
  several. Whether to prune, and on what rule, is undecided.
- **Multi-kit repos.** Module 3 must handle `CLAUDE.md`, `AGENTS.md` and
  `AGENT.md`, and a repo may carry more than one.
- **Which tool dir is the source for copy 2** when several are installed
  (`~/.claude`, `~/.factory`, `~/.config/amp`, `~/.config/opencode`). They
  should be identical, but "should" is not a check.

## 6.5 Not a live risk — the `.claude/memory/` layout

`.claude/memory/` is the pre-rename name of `.claude/remember/`. Measured
2026-09-03 across 30 local repos with a `.claude/` directory: 4 on the old
layout, 25 on the new, 1 (`bareagent`) carrying both.

Those pointers are **not dead** — `aurora/.claude/memory/` holds a live
`AGENT_RULES.md` and `MEMORY.md` that its CLAUDE.md resolves correctly. They
were simply never migrated.

**Confirmed 2026-09-03: all 4 are archived, not operational.** `/remember` is
not run in them, so nothing is at risk and no migration is needed. Recorded only
so the next reader does not re-derive it — and because the failure shape is
worth knowing if a live repo on the old layout ever turns up:

`/remember` writes `.claude/remember/` unconditionally and repoints CLAUDE.md
there. In an old-layout repo it would create the new directory, repoint the
config, and leave the accumulated `MEMORY.md` in a directory nothing reads
again — reporting success, since nothing is deleted. **If that case appears:**
migrate contents before writing and report it; resolve an existing fork by
reporting the orphan, never by deleting it.

`bareagent`'s leftover `memory/AGENT_RULES.md` is an orphan of that kind —
harmless, except as a decoy a reader might mistake for the live rules.

## 7. Verification

Success is defined before code, per AGENT_RULES:

- Module 1's failure rule is proven by running `/remember` with the network
  unreachable and observing it complete normally.
- Module 2's three branches are each proven on a real repo: identical (no write,
  no backup, no output), differing (backup exists, new content in place, old
  content byte-identical in the backup), absent (copied in).
- Module 2's scripted-copy requirement is proven by running twice in a row: the
  second run must produce no backup. A backup on every run means the copy is
  re-formatting and the byte compare never matches.
- Module 3 is proven against a real pre-v2.19 stub, repaired to current shape.

A step is done when the proof ran and was seen to pass.
