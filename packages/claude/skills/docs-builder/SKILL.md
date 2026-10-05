---
name: docs-builder
description: Reorg a docs corpus, split an oversized doc, search it, keep pages current, index them
argument-hint: [reorg | cleanup <file.md> | search <query words...> — empty asks first run vs. drift]
allowed-tools: Read, Write, Edit, Grep, Glob, Task, AskUserQuestion, Bash(node:*), Bash(git:*), Bash(rg:*)
disable-model-invocation: true
---

# docs-builder

Keep project docs **current, complete and findable**, and split a file when it outgrows its row in `docs/index.md`. Why it works this way, measured numbers and history: `docs/product/docs-builder-README.md`.

**This does NOT make docs cheaper to read — never sell it as a token saving.** Every mechanical step is the `docs-builder.cjs` script beside this file, the `$DB` path below (vanilla Node, zero deps). A model does two things only: classify and propose themes, and write pages.

- **Heavy model work always spawns a worker, tier stated explicitly** (an omitted tier inherits the parent's). Never name a vendor model. Hand the worker its inputs — it has no skill text of its own — and it does the work itself, no sub-spawning. Anything that asks the user stays in the main session. Fall back to inline only if your tool cannot spawn.

## Setup

`docs-builder.cjs` sits next to this file in `docs-builder/`, installed or run from the package. Never search the target repo for it, never reconstruct it from this spec; if it exists nowhere, say so and stop. Set `DB` to its ABSOLUTE path, then `cd` to the target repo root:

```
DB=<absolute path to docs-builder.cjs>
cd <target repo root>
```

Every command below is `node $DB …`. Everything the script writes (`docs/.docs-builder/*` state, `docs/index.md`, `docs/log.md`, the ledger, the config pointer) lands under the target repo; `REPO=` is only needed when not running from its root.

## Hard rules

- **Only `.md` files are ever opened, read, edited or listed** — a non-`.md` file is never touched, not even to report a mention.
- **Never moved, enforced in code:** `README.md`, `index.md`, `log.md`, `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `AGENT.md` (case-insensitive, any depth), every dot-dir, `node_modules/`.
- **Nothing moves before the user approves the table.** Only after approval does `apply-reorg` run; it refuses while any row's `bucket` is empty.
- **Never split N files in one shot on a list the user has not seen.**
- **`reorg` never splits.** `cleanup <file.md>` is the ONLY entry to the split pipeline: exactly one `.md` file, refuses a missing or protected one.
- **`cleanup-apply` refuses without a `labels.json` that has exactly one `core: true` theme.**
- **The original is always archived byte-identical** (`git mv` into `docs/archive/`); every cleanup output is a new file, nothing edits a source doc.
- **`docs/index.md` has exactly one writer: `index-flat`** — never hand-edit it.
- **Never rewrite `CHANGELOG.md` or `log.md` links (any depth).** Nothing under `docs/archive/` is ever a rewrite target; links elsewhere that point at an archived file are still repaired.
- **Commit only through the printed pathspec recipe; never `git add -A`, `git add -u` or `git commit -a`.**

## Invocation

**With an argument** (`reorg [dir]`, `cleanup <file>`, `search <query words...>`) run that mode directly, no question.

**Bare `/docs-builder` — ALWAYS ask, never auto-detect.** Run `node $DB due` first and put its one-line verdict in the question text. Then `AskUserQuestion`, one question, header `Mode`, exactly these two options:

> **Question: What should docs-builder do?**
>
> - **First run** — sort root-level `.md` files and everything under `docs/` into
>   product/wiki/logs/archive, then split anything too big into pages and index them. Use
>   when docs are a pile of loose files, or docs-builder has never run here.
> - **Docs drift** — docs moved on since the last run: report what changed, rebuild the
>   index, re-run lint. Nothing is restructured and nothing is split.

Do not offer a third option and do not recommend one. If `due` cannot run, say so plainly and ask anyway.

**`search` is explicit-argument only, never a third picker option:** `/docs-builder search <query words...>` runs `node $DB search <query words...>` (BM25 over `docs/.docs-builder/outline.json`, `N=` sets the result count, default 10; a first argument ending in `.json` is read as the outline path). Read-only, no model, nothing moves.

| Choice | Runs |
|---|---|
| First run | Reorg steps 1-3, then Finish; split each file the user picks (Cleanup), then Finish again |
| Docs drift | `node $DB reorg`, then Finish |
| `reorg [dir]` / `cleanup <file>` | those steps directly |

## Buckets

- `product` — docs about the product itself: specs, PRDs, designs. Flat.
- `wiki` — generic knowledge: conventions, how-tos, standards. Flat; also where split pages go.
- `logs` — one-time, timely records: POCs, experiments, incident write-ups, reports. The only bucket that nests, one level: `docs/logs/<group>/`.
- `archive` — self-declared dead. Frozen: never re-checked.
- `docs/.docs-builder/` is machine state (plan, outline, labels, tasks, ledger, `commit-*.txt`); never hand-edit it.

## Reorg — a whole corpus

**1. Discover** — nothing moves, nothing is classified:

```
node $DB discover
```

Scope with no argument: `.md` files at the repo root (top level only) plus everything under `docs/` (recursive; `product/`, `wiki/`, `logs/` re-checked every run, `docs/archive/` skipped; gitignored files are skipped). `node $DB discover <dir>` scopes to exactly `<dir>` instead. Writes `reorg-plan.json`: per file `h1`, `snip`, `lines`, an `oversized` boolean, and a mechanical `suggested` bucket + `reason`. `suggested` is a PRIOR, never a verdict. `bucket` is empty on every row discover has not classified before; files already in `product/`, `wiki/` or `logs/` are real rows and need a bucket too. `apply-reorg` reads only `bucket`.

**2. Classification interview — the model's judgment, behind the approval gate.** Classify it yourself (no spawn), in one pass over the WHOLE plan table (`file`, `h1`, `snip`, `lines`, `suggested`+`reason`): fill `bucket` (`product`/`wiki`/`logs`/`archive`) on every row where it is empty and keep a one-line reason per row. Write only `bucket` into `reorg-plan.json`. A SHOUTED self-declared status (`**Status: CLOSED**`) is near-conclusive for `archive`; `suggested` never overrides the model. Then run:

```
PREVIEW=1 node $DB apply-reorg
```

It prints `approval table — N row(s), sorted by destination`, one line per row `from <file> to <dest> · <lines> lines[ (oversized)] · <bucket>`, then `preview only — nothing moved, nothing written.` (exit 1 if a row is still unclassified). Show the user the rows in a normal chat message, in printed order, each as printed plus ` · why: <your one-line reason>`. Then ask via `AskUserQuestion` only "Approve these N moves?" — approve all / correct specific rows / abort. A correction changes `bucket` in the plan, then re-run the preview. Abort moves nothing.

**3. Apply:**

```
node $DB apply-reorg
```

Moves every row, oversized included (size decides splittable, not sorted); collisions get `-2`, `-3`; emptied source dirs are removed; moves are STAGED, never committed for you. It rebuilds `docs/index.md` and `outline.json`, writes the `<!-- DOCS_INDEX:START -->` pointer block into `CONFIG` (default `CLAUDE.md`; this package uses `CONFIG=CLAUDE.md`), and records each moved file's new path and bucket in the plan. Every move repairs inbound links to the old path (`.md` files only, relative and repo-rooted, own links re-based; fenced code blocks are never rewritten; a backticked exact path in prose IS rewritten, a link-shaped string inside an inline code span is not) and logs to `docs/log.md`.

It then prints the oversized docs it just moved, `cleanup <NEW path>  (N lines)`, `logs/` last. If none, say so and skip the split question; otherwise show the list and ask which to split (any, all, none), then run Cleanup on each chosen file.

**Docs drift.** Bare `node $DB reorg` prints the `due` summary first (if a ledger stamp exists), runs `discover`, and **stops only for rows with no bucket** (new files, or files moved since). After a first sort the plan keeps each file's new path and approved bucket, so edited files do not re-ask. On a stop, run step 2 for the empty rows and then `apply-reorg`. Fully classified, it runs `apply-reorg` then `lint` and continues. `OUT` is ignored by `reorg`. `reorg <dir>` passes `<dir>` to discover.

## Finish — after every run that moved or wrote files

`apply-reorg`, `archive` and `cleanup-apply` print a closing advisory and never commit. Its last lines are:

- `BRANCH: <name>` — on `main`/`master` it reads `do NOT commit`: obey it, tell the user the files are ready and to switch to a branch first.
- `QUESTION: Commit these N files now?` (plus a note naming files that already carried the user's own uncommitted edits) — relay that line via `AskUserQuestion`, header `Commit`: **Commit** (run the printed recipe) / **Leave uncommitted** (say what is pending; nothing this run did gets undone).
- `WARN: docs/.docs-builder/ is not gitignored — …` — act on it: add `docs/.docs-builder/` to `.gitignore` before the first commit (machine state; this script never edits it).

On **Commit**, run the printed recipe line EXACTLY as printed, never hand-edited, staged by hand, or scoped to `docs/` alone (a `.md` outside `docs/` can carry a repaired link):

```
git add --pathspec-from-file=docs/.docs-builder/commit-add.txt && git commit -m "docs: reorg" --pathspec-from-file=docs/.docs-builder/commit-files.txt
```

(When `REPO` is not the shell's cwd it prints `git -C '<REPO>' …` — run that form unmodified.) If it errors or names a missing path that is a BUG: stop and report it, do not silently hand-repair.

After a successful commit run `node $DB ledger` to stamp the consolidation. Without the stamp `due` stays NOT due and `/remember`'s docs nudge never fires.

## Cleanup — split one oversized file

`node $DB cleanup docs/BIG.md` (use the file's current path) prints its size and estimated write cost, scans, prints a heading-shape table, writes `cleanup-shape.json`, then **STOPS**. Nothing past it runs — no archive, no page, no model call — until the interview below is answered.

**Interview.** Spawn one cheapest-tier worker to read the document (weighted to the opening, enough of the rest to name the other themes); it returns the "mainly" theme and the other themes, and the MAIN session asks the user via `AskUserQuestion`, one question, exactly this shape:

> **Question: Is this split right?**
>
> <the shape table `cleanup` printed>
>
> This document is mainly: **\<your read of the dominant theme>**.
> Other themes present: **\<theme>**, **\<theme>**, ...
>
> Is that right, and are those the themes you want split out?

Options at minimum **Confirm** (proceed with the themes exactly as stated) and **Correct** (the user names what the document is actually mainly about, and/or edits the other-themes list). A correction must change what gets built: the corrected "mainly" theme is the one marked `core: true`, the edited list is the fixed list proposed against. Never auto-detect and call it an interview.

**2a. Propose (spawn one cheapest-tier worker, ONE call over ALL headings).** Feed every `records[].key` plus its `snip` and the interview answer. Ask for a fixed theme list with a one-line gloss each; the interview's "mainly" theme is the core, exactly one; aim for no theme above ~30% of the lines. Its page carries the original's basename.

**2b. Assign (spawn cheapest-tier workers, chunks of ~20 sections).** Each section gets a theme from that list. Never emit a positional index. Echo `records[].key` back verbatim, delimited in the prompt:

```
<<<KEY>>>the exact key text<<<END>>>
snippet text on the following lines
```

Propose globally before assigning; validate before use. Write `docs/.docs-builder/labels.json` as `{ "themes": [{name, gloss, core?}], "labels": [{key, theme}] }`, `core: true` on exactly the one interview theme.

**3. Validate** — hard gate, exits 1 on FAIL; do not proceed on FAIL, re-run the failing chunk:

```
node $DB validate
```

It checks every key exists once and none is invented or off-list, every outline source file still exists (`paths`), every relative `.md` link in `INDEX` (default `docs/index.md`) resolves (`links`), and every page citation lands in its own task's ranges (`citations`; uncited sections are reported, never block). `REPO=` must be the repo `scan` used.

**4. Plan + apply:**

```
node $DB cleanup-apply docs/BIG.md
```

Refuses before doing anything if `labels.json` is missing or has no `core: true` theme. Otherwise it runs `plan` (one `docs/.docs-builder/tasks/task-<theme>.json` per page, estimated cost for pages still to write) and, if any page is missing, stops. Re-run the same command after step 5: once every page exists it archives the original, relocates the core page to the original's directory under its original basename, restores inbound links from the archive to that core page (the split pages keep their archive citations), and rebuilds `docs/index.md`. `node $DB plan` alone re-reports what is left (a theme whose page exists in `docs/wiki/`, override `PAGES=`, is `done`).

**5. Write pages (spawn one mid-tier worker per page).** Hand each writer agent its `task-<theme>.json`: the writer brief is inside it. A page counts as written only with YAML frontmatter and at least 10 lines; shorter is `PARTIAL` and is rewritten. Each agent reads only its own line ranges, every claim cited `(<file>:<start>-<end>)` inside those ranges, 250 lines a ceiling. Write the core page under `docs/wiki/` like the rest; `cleanup-apply` relocates it. Launch 3 at a time. Exit condition is a command: re-run `node $DB plan` and read it; step 5 is done only when it prints `all pages written` with no page listed `PARTIAL` (and no `page(s) exist but are not a finished page` WARN).

**6. Archive** — run for you by `cleanup-apply`; standalone `node $DB archive docs/BIG.md` is a verified move (hash, `git mv`, hash). Exit codes are not interchangeable:

| exit | meaning | what to do |
|---|---|---|
| `0` | moved, all follow-ups succeeded | nothing |
| `1` | the move failed — **nothing moved** | fix and re-run |
| `2` | the file **moved**, but a follow-up failed (`archive`: outline/labels sync or link rewrite; `cleanup-apply`: core page not relocated, index not rebuilt) | fix by hand; do **NOT** re-run; for `cleanup-apply` finish with `node $DB index-flat` |

Pruning the archive is the user's own `git rm`; nothing here deletes.

## Other commands

- **`node $DB index-flat`** rewrites `docs/index.md`: `## Product`, `## Logs` (grouped), `## Archive`, each row an H1, a line count, a link, plus one `(Lstart–end)` line per H2. It prints a console-only WARN past 100 archive rows. Run it by hand after a `git rm` of archived docs.
- **`node $DB lint <file.md...>`** → `lint.json`, declared-only. Act on `supersession` declared in a heading; everything else (`supersessionInBody`, `uncited`, `redundant`) is read or proposed to the user, never acted on. Observed beats inferred.
- **`node $DB ledger`** stamps the consolidation; **`node $DB due`** prints what changed since (kinds `new`, `moved`, `moved+changed`, `changed`, `deleted`) and says `REORG IS DUE` at 5 changed docs. `due` only prints. Its output is a contract `/remember` reads: `no ledger yet … NOT due.`, `docs unchanged since <sha>. NOT due.`, the row table, `<n> docs changed since <sha> (threshold 5) — REORG IS DUE.`. `/remember` also runs `index-flat` on any drift; `/docs-builder` owns the ledger, `/remember` only reads it.

## Final report

**The final message ends with these eight lines, in this order, filled from what you did** (a run that ends without them did not finish). A line for a step this run did not take says `N/A (<why>)`; `validate:` is the Cleanup step-3 gate, so a run without a split says `NOT RUN: no split`.

```
mode: first-run | drift | reorg <dir> | cleanup <file> | search · asked: yes | N/A (argument given)
due: <one-line verdict> | NOT RUN: <reason>
classify: <N> rows · approved | corrected <K> | aborted | N/A (nothing unclassified)
split: <N> oversized offered · chose <files | none> | N/A (none oversized | cleanup mode: not offered)
cleanup: interview confirm | correct · pages <done>/<total> · PARTIAL 0 · archive exit <0|1|2> | N/A
gitignore: ignored | added | NOT ignored: <reason>
validate: PASS exit 0 | FAIL | NOT RUN: <reason>
finish: committed <sha> | left uncommitted (N files) · ledger stamped @ <sha> | NOT stamped: <reason>
```
