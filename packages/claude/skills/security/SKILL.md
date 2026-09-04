---
name: security
description: Security audit — recurring six, injection, auth, trust boundaries
argument-hint: [file, directory, or leave empty for full scan]
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git grep:*), Bash(rg:*)
disable-model-invocation: true
---
Audit $ARGUMENTS for security vulnerabilities. **Reports, never edits** — it
verifies every claim, then hands the findings to whoever asked.

**Runs identically standalone or as stage 2 of `/branch-review`.** The only
difference is where the report goes: to the orchestrator when called as a
stage, to you when you run it directly. Same checks, same verify pass, same
escalation. It does **not** spawn a worker of its own — run it inline; when
`/branch-review` calls it, it is already inside that command's worker.

Adapt scope to what the target actually is — a library, CLI, web app, and service won't all have every
category. Skip what genuinely doesn't apply; never invent findings to fill a
section.

## The recurring six (check every project, where applicable)
These show up in nearly every quickly-built app regardless of stack:

1. **Secrets in the repo.** Tokens / API keys / `.env` files committed to
   tracked files or anywhere in git history. Verify `.env` is gitignored and
   only a value-less `.env.example` is tracked; scan history (`git log -p`,
   `git grep`) for leaked keys. Secrets must load from env / a secret store at
   runtime — never hardcoded, never logged.
2. **Data-access authorization (tenant isolation).** Every record read or
   written must be scoped to the requesting principal — via DB-level rules
   (RLS / row policies) and/or application-layer ownership checks. Flag any
   query that trusts a client-supplied id without an ownership or role gate,
   and any table/collection with a policy that's too broad or missing.
3. **Rate limiting.** Every externally reachable endpoint and abuse-prone
   inbound path is bounded — including **authenticated mutation/write routes**,
   not just the obvious public GETs. Note any unbounded route.
4. **Error handling past the happy path.** Third-party / IO / DB failures are
   caught; nothing fails silently; no internal detail (stack traces, queries,
   secrets) leaks to the client. Background/async work has its own catch.
5. **Authorization beyond authentication (IDOR / privilege).** "Logged in" is
   not "allowed to do this". Confirm ownership AND role/permission checks on
   every state-changing or privileged action. Mentally swap an id in a request
   — does it return 403, or does it leak/modify another user's data?
6. **Inefficient data access (N+1 / unindexed).** Queries inside loops,
   per-render repeated calls, missing indexes on filtered/joined columns.
   Correct but falls over under load — a real availability risk.

## Also scan for
- **Injection:** SQL, command, XSS, template, path traversal.
- **Auth/session:** weak token handling, CSRF, session fixation, predictable ids.
- **Trust boundaries:** spoofable headers (e.g. `X-Forwarded-For`) trusted
  without a vetted proxy; unvalidated untrusted input (uploads, inbound mail,
  webhooks); services bound to `0.0.0.0` that should be loopback-only.
- **Config:** debug mode on in prod, default creds, missing security headers,
  permissive CORS.
- **Dependencies:** known CVEs; unmaintained or single-maintainer deps in
  security-critical paths.

## Output
Severity-ranked findings (Critical → High → Medium → Low), each with:
- **Location** (`file:line`)
- **Risk** — what an attacker actually gains
- **Remediation** — concrete, minimal fix

End with: which of the six classes were checked and found **clean**, and any
marked **N/A** for this target — so the scan's coverage is auditable, not just
its hits.

## After the scan — verify, then escalate

Findings are claims, not facts. Validate every one before reporting it; an
unverified finding wastes more time than a missed one.

**Verify each claim — adversarially.** Re-read the cited `file:line` in full
context and **try to break the claim, not to confirm it**: is there a gate
upstream, a framework default, a caller that already validates? A pass that
sets out to confirm reliably misses what an adversarial pass finds. Mark each
**confirmed**, **false positive** (with reason), or **uncertain** (with what
would settle it).

**Never fix.** Not even a confirmed, one-line, obvious fix. Describe the
minimal remediation and hand it back — applying it is a separate, separately
authorized action.

**Flag these explicitly** — they need a human decision, not a recommendation:
- the finding is **uncertain** after grounding (you'd need info you don't have),
- the fix has **multiple reasonable shapes** (e.g. reject-vs-sanitize,
  index-vs-paginate) — present options with tradeoffs, not a chosen path,
- it **affects downstream** (function signatures, response shape, DB schema,
  any caller contract), or
- it touches **auth / crypto / session / token** primitives — even an "obvious"
  fix here warrants confirmation.

Final report: **confirmed** (with remediation described) · **needs a decision**
(why + the options and their tradeoffs) · **false positive** (why) ·
**uncertain** (what is needed to decide).

**Escalate, never assume.** Anything you cannot decide, cannot verify, or that
this spec does not cover → say so plainly in the report rather than guessing.
When running as a stage of `/branch-review`, that report goes to the
orchestrator; standalone, it goes to the user. Never widen scope, never fix a
side issue you noticed along the way.
