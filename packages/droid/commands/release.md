---
description: Verify, write the CHANGELOG, cut a version — then hand the release sequence back
---
Release **preparation** orchestrator for the **current branch**. It runs your
existing pre-deploy gate, writes the CHANGELOG, bumps the version and
commits — then **stops and reports**. It never pushes, opens a PR, merges,
tags, or publishes: those are yours to authorize by name. The general docs
sweep runs earlier, in `/branch-review`.

It does not re-implement checks, and it does not review code. Review is a
separate command that must have run first.

## Guardrails
- **Spawn a worker and explicitly select your tool's mid tier.** State the
  tier on the spawn — do not omit it and rely on a default. An omitted tier
  inherits the *parent's* tier, which is not the same thing as the balanced
  one. Pick the judgment-capable tier that is cheaper and faster than your top
  reasoning tier. **Not the cheapest/fastest tier**: on judgment work it
  measurably degrades (misclassification rates several times higher). Choose by
  tier, not by a vendor model name copied from this file — names drift, and
  this command ships to several tools. Fall back to running inline if your tool
  has no subagent mechanism.
- **Escalate, never assume.** Anything you cannot decide, cannot verify, or
  that this spec does not cover → **stop and report it to the orchestrator**
  (the main session). Never improvise, never widen scope, never fix a finding
  you noticed along the way.
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
  `/branch-review`, then re-run `/release`." Committing here would create a
  commit *after* the review and so fail Phase 0.5 by its own rule on the very
  next step; a phase that guarantees the next phase fails is not a phase.
- `git fetch origin`; the release diff is `origin/main...HEAD`. Empty →
  **stop**, nothing to release.
- **Record both version numbers.** Read the **local** version (`package.json`
  or this project's equivalent) and, if the project has a publish path, the
  **published** one (`npm view <pkg> version`, or the registry equivalent).
  Report them side by side. Local *ahead* of published means a version was cut
  on a branch and never published — Phase 3 cannot see that gap unless you
  record it here, and a worker that cannot see it will re-cut a number that
  already exists.
- Print a one-line plan: branch · commit count · files changed · HEAD SHA ·
  local version → published version.

## Phase 0.5 — Review precondition (do not skip)
A review must have run on this branch **at the current HEAD SHA**.

**Compare the SHAs yourself; do not settle for an answer.** Run `git rev-parse
HEAD` and compare it against the `sha:` line in
`.factory/remember/last-review.md`, which `/branch-review` writes. Asking the
orchestrator "did a review run?" puts the question to the one party with an
incentive to say yes, so its word is not evidence — and neither is a SHA
quoted from a chat message, which is the same claim in another costume and is
gone after a compaction or a handover. Read the file; match the two strings.
**No such file, or no `sha:` line in it = no review**, never a pass. A review
that predates this file's introduction has no record, so it does not count.

- **No review**, or no recorded SHA obtainable → **stop**: "No review at
  `<sha>`. Run `/branch-review medium` (or `/code-review medium`) first."
- **Stale** — recorded SHA ≠ `git rev-parse HEAD` → **stop** and ask for a
  re-review, **unless every file** in `git diff --name-only <recorded
  sha>..HEAD` is listed on the record's `docs:` line — `/branch-review`'s own
  docs-sweep commit, and nothing else. Run that diff yourself and report the
  file list you compared against the `docs:` line; do not take "it's just
  docs" on trust. Any file not on that line — including a `README.md`,
  `CHANGELOG.md`, or other `docs/` file the sweep didn't touch — is not a
  docs commit, so its presence anywhere in that list means **stale**, stop,
  re-review. This is what makes "all findings fixed" checkable instead of
  promised.
  **No exceptions beyond the `docs:` line — including the fix ledger.** It is
  normally gitignored, so appending to it moves nothing and this never comes
  up. A repo that tracks `.factory/` instead will see a ledger commit land
  after the review and make it stale. That is the rule working, not a case to
  carve out: re-review, or leave the ledger uncommitted until after the
  release.
- **`coverage:` naming any stage `NOT RUN`** → **stop**. A `ready` from a run
  that skipped the security stage is not the same fact as one that did not,
  and this line is the only place the difference is visible to you.
- **`verdict: blocked` in the record** → **stop**, even when the SHA matches.
  Read that line as mechanically as the `sha:` one. A matching SHA proves a
  review ran here; it says nothing about what the review concluded, and
  leaving the conclusion to the orchestrator's recollection restores exactly
  the unverified claim this file replaced. Only `verdict: ready` with a
  matching SHA is a pass.
- **Reviewed at this SHA with findings outstanding** → **stop**. Findings are
  resolved before a release is cut.

This phase runs **before** `/release` writes anything, so the CHANGELOG-and-
bump commit it makes later cannot invalidate the review it just checked.

Report the comparison you actually ran: recorded `<sha>` vs HEAD `<sha>`,
match yes/no.

This is the only thing guaranteeing the branch was reviewed *and* security
scanned, so treat a missing answer as a **stop**, never as a pass.

## Phase 1 — Verify
**Load the real checklist**: locate and **read** the installed `ship.md` so
you apply its exact checks, not an approximation. If it cannot be found, run
what you can from its name and **flag that the full checklist was
unavailable** — never pretend it passed.

- **`/ship`** — mechanical pre-deploy gate (tests, lint, build, debug
  leftovers, secrets grep, migrations, docs/config sync, tree state).

Capture **fresh evidence**: the exact command, its exit code, and the result.
A check you did not actually run is a **FAIL**, never an assumed pass. Emit a
coverage row: `ran? ✓/✗` · evidence · verdict. A ✗ is **Blocked 🛑**.

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

This release commit is the one commit `/release` itself adds after the
review. It touches `package.json` for the version bump — never a file on the
record's `docs:` line under Phase 0.5's rule — so it moves HEAD past the
reviewed SHA with a file that rule doesn't cover. Running `/release` twice on
the same branch without a re-review therefore still correctly stops as
stale, as it always did.

## Report — the sequence, for a human to authorize
Print the evidence, then hand back the exact remaining steps so the
orchestrator can run them on the user's named go:

> **Cut ✅ vX.Y.Z on `<branch>`** — `/ship` green, CHANGELOG updated, release
> commit made locally. Reviewed at `<sha>`.
> Ready when you are:
> 1. `git push -u origin <branch>`
> 2. `gh pr create` into `main`
> 3. `gh pr checks <pr> --watch` — **merge only on green.** Every gate before
>    this one ran on the same machine; CI is the only differently-configured
>    instrument in the chain, and this is the first time it sees the branch.
>    A test that passes locally because of a path, a fixture, or a tool that
>    exists only on your box fails here and nowhere earlier. Read the exit
>    code off the bare command. Red → stop, fix, re-review, and start again.
> 4. `gh pr merge --admin --squash --delete-branch` (main is PR-protected;
>    owner-authorized admin merge on a solo repo). **Keep `--squash`** — `gh`
>    requires an explicit merge-method flag (`--squash` / `--merge` /
>    `--rebase`); drop it and the command will not squash-merge.
> 5. `git tag vX.Y.Z` on `main` and push the tag
> 6. Publish **if this project has a publish path** (e.g.
>    `gh workflow run publish.yml`) — manual by design
> 7. Verify it is actually live (`npm view <pkg> version`, and the published
>    tarball's contents), not the working tree

**Every exit code in this sequence is read off the bare command, including
the ones you type yourself.** `/ship`'s rule is not just for the worker: a
pipeline reports its last element's status, so `gh run watch --exit-status |
tail -2; echo $?` prints `0` for a failed run. That has already turned a red
CI into a green reading in a real release.

Final line: **Cut ✅ (vX.Y.Z — ready to push)** or **Blocked 🛑** with the
specific reason.
