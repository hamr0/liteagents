---
description: Verify, write the CHANGELOG, cut a version — then hand the release sequence back
---
Release **preparation** orchestrator for the **current branch**. It runs its own
short mechanical checks, writes the CHANGELOG, bumps the version and
commits — then **stops and reports**. It never pushes, opens a PR, merges,
tags, or publishes: those are yours to authorize by name.

It does not review code. Review is a separate command that must have run
first.

## Guardrails
- **Spawn a worker, mid tier stated explicitly** (an omitted tier inherits the
  parent's; never a vendor model name). Run inline if your tool has no
  subagent mechanism.
- **Escalate, never assume.** Anything you cannot decide, cannot verify, or
  that this spec does not cover → **stop and report it to the orchestrator**.
  Never improvise, never widen scope, never fix a finding you noticed (for
  workers this overrides the Surgical dev rule).
- **The worker does the work itself — no sub-spawning.** Every command it cites
  is one it ran with its own tool calls.
- **Nothing leaves the machine.** No `git push`, no `gh`, no `npm publish`,
  under any circumstance — not even if every gate is green. You report the
  sequence; a human authorizes it.

## Phase 0 — Preflight (current branch, always)
- **Release the branch you are on.** No branch argument, no branch creation.
- **On `main` → stop and ask** what should be released. `main` is only ever
  the merge target; never release it, never commit to it.
- **The tree must be clean — do not commit for the user.** Run `git status
  --porcelain`. Any line at all — modified, staged, or untracked — is a
  **stop**: list the paths and say "commit this to the branch, re-run
  `/branch-review`, then re-run `/release`."
- **Decide REUSE or RUN now, once** (the orchestrator, before any worker): run
  this line as printed and print its output; it stays valid for the whole run
  (this command commits only the CHANGELOG/version, after the tests). Pass that
  exact line to any worker that runs Phase 1 in its brief.
  ```
  f=.opencode/remember/last-review.md; g=$(sed -n 's/^green: \([0-9a-f]\{40\}\) .*/\1/p' "$f" 2>/dev/null); c=$(git diff --name-only "$g" HEAD 2>/dev/null | grep -vE '^(docs/|[^/]+\.md$)'); if [ -z "$g" ]; then echo "RUN (no green: line)"; elif ! git merge-base --is-ancestor "$g" HEAD 2>/dev/null; then echo "RUN (green $(printf %s "$g" | cut -c1-7) not an ancestor of HEAD)"; elif [ -z "$c" ]; then echo "REUSE $(grep '^green: ' "$f")"; else echo "RUN (green $(printf %s "$g" | cut -c1-7), changed: $(printf '%s\n' "$c" | paste -sd' ' - | cut -c1-200))"; fi
  ```
- `git fetch origin`; the release diff is `origin/main...HEAD`. Empty →
  **stop**, nothing to release.
- **Record both version numbers.** Read the **local** version (`package.json`
  or this project's equivalent) and, if the project has a publish path, the
  **published** one (`npm view <pkg> version`, or the registry equivalent).
  Report them side by side. Local *ahead* of published means a version was cut
  and never published; Phase 3 needs that gap.
- Print a one-line plan: branch · commit count · files changed · HEAD SHA ·
  local version → published version.

## Phase 0.5 — Review precondition (do not skip)
A review must have run on this branch **at the current HEAD SHA**.

**Compare the SHAs yourself.** Run `git rev-parse HEAD` and compare it against
the `sha:` line (starting exactly `sha:` — never `self-review-sha:`) in
`.opencode/remember/last-review.md`, which `/branch-review` writes. The
orchestrator's word, or a SHA quoted from chat, is not evidence. Read the file;
match the two strings.
**No such file, or no `sha:` line in it = no review**, never a pass.

- **No review**, or no recorded SHA obtainable → **stop**: "No review at
  `<sha>`. Run `/branch-review medium` first."
- **Stale** — recorded SHA ≠ `git rev-parse HEAD` → **stop** and ask for a
  re-review, **unless every file**
  in `git diff --name-only <recorded sha>..HEAD` is forgiven. **This overrides
  that:** a merge or rebase of `origin/main` after the review is never forgiven,
  even when it brings only docs. A file is forgiven
  if it's under `docs/`, a `*.md`
  at the repo root, **or** on the record's `docs:` line — Stage 4 legitimately
  writes docs outside `docs/`/root too (`packages/subagentic-manual.md`,
  `packages/claude/AGENTS.md`, and siblings), and its own commit is what put
  them on that line. Run this and read what it prints — every printed path
  must also be on `docs:`, or it's **stale**, stop, re-review; no output means
  every file was under `docs/` or root already, also not stale:
  ```
  git diff --name-only <recorded sha>..HEAD | grep -vE '^(docs/|[^/]+\.md$)'
  ```
  Do not take "it's just docs" on trust.
  **No exceptions beyond the three forgiven shapes above.** In a repo that
  tracks `.opencode/`, a ledger commit after the review makes it stale
  (`fix-ledger.md` is never on `docs:`): re-review, or leave the ledger
  uncommitted until after the release.
- **`tests:` line** — use the decider line printed in Phase 0 (never re-run it,
  never decide a different way). `REUSE …` → covered, do not re-run (a record `tests:` line with no build part → run the build only, not the suite);
  `RUN (…)` → run the full suite once, and build if there is one, in Phase 1,
  cite command + exit code, copy the printed reason into the `tests:` line,
  and on exit 0 replace the record's `green:` line with
  `green: <full HEAD sha> <cmd> exit 0 <totals>`, touching no other line; any non-zero exit
  → **stop**; a failure that passes when run alone
  is re-run alone before it is called real. The record says `reused`
  but the Phase 0 line starts `RUN (` → **stop**, unsafe.
- **`coverage:` naming any stage `NOT RUN`** → **stop**. A `ready` from a run
  that skipped the security stage is not the same fact as one that did not,
  and this line is the only place the difference is visible to you.
- **Stage-2 and sweep evidence** — run this one line and read its exit code;
  nonzero → **stop**: "review record lacks stage-2 evidence — re-run
  `/branch-review`". It needs all 11 `s2 <key>:` lines (each `ran:` or `N/A:`,
  never `NOT RUN` or an unfilled template) and a `sweep:` line that is not
  `deferred`.
  ```
  f=.opencode/remember/last-review.md; ok=1; for k in secrets tenant-isolation rate-limiting error-handling authorization data-access injection auth-session trust-boundaries config dependencies; do grep -qE "^s2 ${k}: (ran|N/A):" "$f" || ok=0; done; [ "$ok" = 1 ] && grep -qE '^sweep: (ran|main):' "$f"
  ```
- **`verdict: blocked` in the record** → **stop**, even when the SHA matches.
  Read that line as mechanically as the `sha:` one. Only `verdict: ready` with
  a matching SHA is a pass.
- **Reviewed at this SHA with findings outstanding** → **stop**. Findings are
  resolved before a release is cut.

Report this block, every field filled from what you ran (never "all checks
passed"):
```
sha: <recorded> vs <HEAD> match yes|no · verdict: <value> · coverage: <line> · s2-check: exit <code> · tests: REUSE|RUN · covered (reused <sha> <totals>) | ran <cmd> exit <code> <totals> · stale-grep: <output | empty>
```
`stale-grep` is the output of the `git diff --name-only <sha>..HEAD | grep -vE …`
check above, or `empty` when it printed nothing.

A missing answer is a **stop**, never a pass.

## Phase 1 — Verify
Detect the stack first (`package.json`, `pyproject.toml`, `go.mod`,
`Cargo.toml`, `Makefile`) and run only what exists. Report each item **pass /
fail / N/A** with the exact command and exit code; a check not run is a
**fail**; N/A needs a stated reason. **Every exit code in this file, the
hand-back sequence included, is read off the bare command**
(`cmd > /tmp/out 2>&1; e=$?`), never a pipeline — `$?` after a pipe is the
last element's status. A test command that can outlast your tool's default
timeout gets a longer one; a timed-out run is not a pass, and the report cites
the suite's totals as well as the exit code. Emit a coverage row: `ran? ✓/✗` · evidence · verdict.
A ✗ is **Blocked 🛑**.

- **Lint / format clean** — only if a linter or formatter is configured.
- **Migrations ready** — only if the project has a schema / migrations: they
  apply cleanly and are ordered.
- **In sync with `origin`** — not behind `origin/main`; a never-pushed branch
  passes.
- **Tests / build** — only per the `tests:` bullet in Phase 0.5.

Security is **not** re-run here — it is stage 2 of the review, already
confirmed in Phase 0.5.

## 🚦 Gate
- **Any Critical** (failing tests, broken build) → **stop**, report, escalate.
- **Warnings, or anything you cannot confidently decide** → **stop**,
  summarize, escalate. Do not weigh it yourself.
- **All clean** → continue.

## Phase 2 — CHANGELOG
The general docs sweep (guide/context doc, PRD, README, findings/learnings)
happens in `/branch-review` (Stage 4), already covered by Phase 0.5. This
phase only writes `CHANGELOG.md`: an entry covering every user-visible
change in `origin/main..HEAD`, read from the commit bodies (not just
subjects), under the headings the file already uses. If the file already has
a `## [Unreleased]` section, that is this release's draft: check it against
the commits, add anything missing, and retitle it `## [X.Y.Z] - YYYY-MM-DD`.
Otherwise write a new entry under that title. Never leave both. An Added
entry means at least a minor bump. Past entries are history — leave them.

**Locate the heading safely — the bare string is not a safe anchor.** Anchor on the full heading with its
surrounding newlines (`"\n## [Unreleased]\n"`) — only the real heading has
both. Count matches before writing: exactly one is required; zero or more
than one is a **stop** — report it, do not guess which one is real. After
writing, verify every other occurrence of the bare string is byte-identical
to before, and that the previous version's heading and `---` separators
survived.

**This is the worker's job, start to finish.** The orchestrator checks the
entry; it does not redo or patch it.

## Phase 3 — Cut (local only)
1. **Version bump** — pick the semver level from the change (patch / minor /
   major; **ask if ambiguous**) and update `package.json`. The local-vs-
   published gap you recorded in Phase 0 **is** an ambiguity: if local is ahead
   of published, a version was cut and never published, so ask whether to
   publish that number or bump past it. Never silently re-cut a version that
   already exists locally. The bump must land
   on the branch, before any merge — a version committed to `main` directly,
   or added after the merge, breaks the tag/package match.
2. **Commit** — `release: vX.Y.Z — <summary>`, including the CHANGELOG and
   the bump.

Then **stop.** Nothing else.

The release commit touches `package.json`, which Phase 0.5 does not forgive, so
it moves HEAD past the reviewed SHA by design: running `/release` twice without
a re-review stops as stale.

## Report — the sequence, for a human to authorize
Print the evidence, then hand back the exact remaining steps so the
orchestrator can run them on the user's named go:

> **Cut ✅ vX.Y.Z on `<branch>`** — checks green, CHANGELOG updated, release
> commit made locally. Reviewed at `<sha>`.
> Ready when you are:
> 1. `git push -u origin <branch>`
> 2. `gh pr create` into `main`
> 3. `gh pr checks <pr> --watch` — **merge only on green.** Red → stop, fix, re-review, and start again.
> 4. `gh pr merge --admin --merge --delete-branch` (main is PR-protected;
>    owner-authorized admin merge on a solo repo). **Keep `--merge`** — `gh`
>    requires an explicit merge-method flag (`--squash` / `--merge` /
>    `--rebase`), and a release PR lands as a merge commit so the branch's own
>    commits stay on main.
> 5. `git tag vX.Y.Z` on `main` and push the tag
> 6. Publish **if this project has a publish path** (e.g.
>    `gh workflow run publish.yml`) — manual by design
> 7. Verify it is actually live (`npm view <pkg> version`, and the published
>    tarball's contents), not the working tree

Final line: **Cut ✅ (vX.Y.Z — ready to push)** or **Blocked 🛑** with the
specific reason.
