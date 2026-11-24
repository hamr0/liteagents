---
type: reference
title: release
status: draft
updated: 2026-11-24
---

# release

`/release` prepares a release for the **current branch**: it checks the review record, runs a
few mechanical checks, writes the CHANGELOG, bumps the version and commits locally, then stops
and hands back the push / PR / merge / tag / publish sequence for a human to authorize by name.
The spec is `skills/release/SKILL.md`; this page holds the reasons the spec leaves out.

## Why the rules read the way they do

- **A dirty tree is a stop, and `/release` never commits for the user.** A commit made here
  would land *after* the review and so fail Phase 0.5 on the very next step; a phase that
  guarantees the next phase fails is not a phase.
- **Both version numbers are recorded.** A local version ahead of the published one means a
  version was cut on a branch and never published. Phase 3 cannot see that gap unless Phase 0
  records it, and a worker that cannot see it re-cuts a number that already exists.
- **The SHA comparison is done by the command, not asked of anyone.** The orchestrator is the
  one party with an incentive to say "a review ran", so its word is not evidence, and neither
  is a SHA quoted from a chat message — the same claim in another costume, gone after a
  compaction or a handover. The file is read and the two strings matched.
- **`verdict:` is read as mechanically as `sha:`.** A matching SHA proves a review ran here, not
  what it concluded; leaving the conclusion to the orchestrator's recollection restores
  exactly the unverified claim this file replaced.
- **The stage-2 keys are listed literally, not derived.** The security spec is not reliably
  readable from `/release`; a test pins the list to security's.
- **Forgiven files are checked, not trusted.** "It's just docs" is verified by the diff. In a
  repo that tracks `.claude/`, a ledger commit after the review makes it stale because
  `fix-ledger.md` is never on `docs:` — that is the rule working, not a case to carve out.
- **Phase 0.5 runs before anything is written**, so the CHANGELOG-and-bump commit cannot
  invalidate the review it just checked. That commit does touch `package.json`, which the
  forgiveness rule does not cover, so a second `/release` without a re-review correctly stops
  as stale.
- **The CHANGELOG heading is anchored with its newlines.** A CHANGELOG that documents release
  tooling can quote `## [Unreleased]` inside a shipped release note's prose; a blind
  find-and-replace would rewrite history instead of the draft.
- **The version bump lands on the branch before any merge.** A version committed to `main`
  directly, or added after the merge, breaks the tag/package match.
- **Merge only on green CI.** Every gate before it ran on one machine; CI is the only
  differently-configured instrument in the chain and this is the first time it sees the
  branch. A test that passes locally because of a path, a fixture or a tool that exists only on
  your box fails here and nowhere earlier.
- **Exit codes are read off the bare command.** A pipeline reports its last element's status,
  so `gh run watch --exit-status | tail -2; echo $?` prints `0` for a failed run — which has
  already turned a red CI into a green reading in a real release.
