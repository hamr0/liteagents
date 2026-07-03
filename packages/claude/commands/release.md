---
name: release
description: Deliver a feature end-to-end — verify, docs, merge, tag (publish stays manual)
usage: /release [branch]
argument-hint: [branch — new or existing; else current]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(pnpm:*), Bash(yarn:*), Bash(pytest:*), Bash(python:*), Bash(go:*), Bash(cargo:*), Bash(make:*)
---
End-to-end feature-delivery **orchestrator**. It does **not** re-implement
checks — it runs your existing gates (`/ship`, `/security`, `/diff-review`)
under `/verify-done` discipline, then performs the release actions. Two halves
split by a hard gate: everything **before** the gate is safe and read-only;
everything **after** rewrites history and is confirmed step by step.

**A feature branch is required — `main` is only the merge target.** `$ARGUMENTS`
names the branch to release. Omit it only if you are already on a feature
branch. If you are on `main` with nothing named, a branch is created for you —
but you should be releasing a deliberately-named feature branch.

## Phase 0 — Preflight (resolve a feature branch — never `main`)
- **Resolve the release branch** — whatever gets merged into `main`:
  - `$ARGUMENTS` given → `git switch` to it (create it if it does not exist).
  - else not on `main` → release the **current** branch.
  - else on `main` with no arg → **create** `feat/<slug>` (named for the
    change) and carry your working changes onto it. **Never release `main`.**
- **Land the feature on the branch** — if the working tree still has
  uncommitted feature changes, commit them now; the gates must review a real
  diff, not a dirty tree.
- `git fetch origin`; the release diff is `origin/main...HEAD` (now guaranteed
  to be the resolved branch). If it is empty, **stop** — nothing to release.
- Print a one-line plan: branch · commit count · files changed.

## Phase 1 — VERIFY (delegate; no hand-waving)
**First, load the real checklists.** Locate and **read** the sibling command
definitions so you apply their exact checks, not an approximation — glob your
installed commands/skills for `ship.md`, `security.md`, `diff-review.md`, and
`verify-done` (a skill or command). If one cannot be found, run that check from
its name and **flag that its full checklist was unavailable** — never pretend
it passed.

Then run each gate and capture **fresh evidence** — the exact command, its exit
code, and the result. Per `/verify-done`: a check you did **not** actually run
is a **FAIL**, never an assumed pass.
- **`/ship`** — pre-deploy gate (tests, lint, build, secrets, authz, rate
  limit, data scope, migrations, docs-sync).
- **`/security`** — on the changed files.
- **`/diff-review`** — on `origin/main...HEAD`.

Emit a coverage table, one row per gate: `ran? ✓/✗` · evidence · verdict. If
any row is ✗ (could not run), the run is **Blocked 🛑** — do not continue.

## 🚦 Gate
- **Any Critical** (failing tests/build, a Critical security or diff-review
  finding) → **stop**, report, ask how to proceed. Touch no history.
- **Warnings, or anything you cannot confidently decide** → **stop**,
  summarize, ask.
- **All clean** → continue to Phase 2.

## Phase 2 — DOCS (only what the feature changed)
Update as needed, matching each file's existing format; touch nothing
unrelated. If a doc needs no change, **say so** rather than editing for its
own sake.
- **CHANGELOG.md** — new entry.
- **PRD** — the feature's PRD entry / status.
- **context / guide** — the project's context or guide doc.
- **README.md** — only if user-facing usage changed.

## Phase 3 — RELEASE (irreversible — confirm each step)
1. **Version bump** — pick the semver level from the change (patch / minor /
   major; ask if ambiguous) and update `package.json`.
2. **Commit** — `release: vX.Y.Z — <summary>`, including the docs + bump.
3. **Push** the branch.
4. **Open PR** — `gh pr create` into `main` (main is PR-protected: 1 approving
   review).
5. **Merge** — `gh pr merge --delete-branch`. If the review requirement blocks
   it, **stop** and ask — never force or silently bypass. On a **solo repo** you
   cannot approve your own PR, so the expected path is an owner-authorized
   admin-merge (`gh pr merge --admin`), run only on the user's explicit say-so.
6. **Tag** — after the merge, `git tag vX.Y.Z` on `main` and push it. Keep
   cut→tag tight — one frozen step.

## Stop here — publish is your call
Do **not** publish. `publish.yml` is manual `workflow_dispatch` **by design**.
Print the handoff:
> Merged, branch deleted, tagged **vX.Y.Z**. To publish, run it yourself:
> `gh workflow run publish.yml`
> Then confirm the version is actually live (`npm view <pkg> versions`) and
> validate the **installed** artifact, not the working tree.

Final report: **Delivered ✅ (vX.Y.Z — publish pending)** or **Blocked 🛑**
with the specific reason.
