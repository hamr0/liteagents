---
name: security
description: Scan security [target]
usage: /security
argument-hint: [file, directory, or leave empty for full scan]
allowed-tools: Read, Edit, Grep, Glob, Bash(git log *), Bash(git grep *), Bash(rg *)
---
Audit $ARGUMENTS for security vulnerabilities. Adapt scope to what the target
actually is — a library, CLI, web app, and service won't all have every
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

## After the scan — verify, then fix

Findings are claims, not facts. Validate before acting; validate again after.

**Verify each claim.** Re-read the cited `file:line` in context. Confirm the
risk actually holds here — not in the abstract. Mark each **confirmed**, **false
positive** (with reason), or **uncertain**.

**Fix what's confirmed and unambiguous** — minimal shape, one obvious way, no
change to a public API / response / caller contract. Apply directly. After
each edit, re-read the changed region and confirm it closes the gap without
breaking nearby logic. A fix isn't done until you've grounded it the same way
you grounded the claim.

**Stop and ask** when any of these hold (HITL gates — not all the time, only
here):
- the finding is **uncertain** after grounding (you'd need info you don't have),
- the fix has **multiple reasonable shapes** (e.g. reject-vs-sanitize,
  index-vs-paginate) — present options with tradeoffs, not a chosen path,
- it **affects downstream** (function signatures, response shape, DB schema,
  any caller contract), or
- it touches **auth / crypto / session / token** primitives — even an "obvious"
  fix here warrants confirmation.

Final report: **confirmed-and-fixed** · **confirmed-but-asking** (why + options)
· **false-positive** (why) · **uncertain** (what's needed to decide).
