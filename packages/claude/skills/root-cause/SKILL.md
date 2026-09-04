---
name: root-cause
description: Use when any test fails, bug appears, or behaviour surprises you, before proposing a fix - find the cause and prove it, by reading real evidence, tracing bad values back to their origin, comparing against a working case, and testing one hypothesis at a time
usage: /root-cause <bug-or-error-description>
---

# Root Cause

**Find the cause before you change any code.**

## The Law

```
NO FIX WITHOUT A CAUSE YOU CAN POINT AT
```

A fix at the place the error *appeared* is a symptom fix. It is a failure even when
the symptom goes away, because the real cause is still there and will surface
somewhere else, later, with less context.

You cannot propose a fix until Phase 1 is done.

## When to Use

Any technical issue: a failing test, a production bug, unexpected behaviour, a
performance problem, a broken build, an integration that will not talk.

**Especially when it feels like overkill:**
- Under time pressure — emergencies are exactly when guessing is most tempting and most expensive
- "Just one quick fix" looks obvious
- You have already tried a fix and it did not work
- You do not fully understand the issue

Simple bugs have root causes too, and finding one takes minutes. Guess-and-check
takes hours and leaves damage behind.

---

## Phase 1 — Gather Evidence

Do all of this **before** forming any opinion about the fix.

### 1. Read the error completely

Do not skim past it. Read the whole message, the whole stack trace, every warning
above it. Note line numbers, file paths, error codes. The answer is often written
there in full.

### 2. Reproduce it consistently

Can you trigger it on demand? What are the exact steps? Does it happen every time?

If it is not reproducible, gather more data. Do not start guessing — an
intermittent bug you cannot trigger is a bug you cannot prove you fixed.

### 3. Check what changed

Recent commits, the working diff, new dependencies, config edits, environment
differences between the place it works and the place it does not.

Be careful here: the most recent change is the most *available* suspect, not the
most likely one. Recency is a lead to test, never a conclusion.

### 4. Instrument the boundaries (multi-component systems)

When the path crosses components — CI → build → sign, API → service → database,
workflow → script → tool — do not reason about where it breaks. Measure it.

For each boundary, log what goes **in** and what comes **out**, and confirm
configuration and environment actually propagated across it.

```bash
echo "=== layer 1: is the secret present in the workflow? ==="
echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

echo "=== layer 2: did it survive into the build script? ==="
env | grep IDENTITY || echo "IDENTITY not in environment"

echo "=== layer 3: what does the tool actually see? ==="
security find-identity -v
```

Run it **once** to find which boundary fails, then investigate only that
component. This turns "somewhere in the pipeline" into a named layer.

### 5. Trace the bad value back to where it was born

When the error surfaces deep in the call stack, the place it exploded is almost
never the place it went wrong. Walk backwards.

**The chain:**

1. **Observe the symptom** — `git init` ran in the source directory
2. **Find the immediate cause** — the code that directly did it:
   `execFileAsync('git', ['init'], { cwd: projectDir })`
3. **Ask what called this, and with what value** — `projectDir` was `''`, and an
   empty `cwd` silently resolves to the process's own directory
4. **Keep going up** — who passed the empty string? and who gave it to *them*?
5. **Stop at the origin** — the point where a correct value first became wrong

Fix it **there**. Then, if the value is dangerous, validate it at each layer on
the way down as well, so the same mistake cannot recur through a different path.

**When you cannot trace it by reading, instrument it:**

```typescript
async function gitInit(directory: string) {
  console.error('DEBUG git init:', {
    directory,
    cwd: process.cwd(),
    stack: new Error().stack,
  });
  await execFileAsync('git', ['init'], { cwd: directory });
}
```

- Capture the **stack**, not just the value — it names the caller you are looking for
- Log **before** the dangerous operation, not in its failure handler
- Include surrounding context: the directory, the working directory, relevant environment
- In tests, write to standard error directly; a project logger may be suppressed

**When something pollutes a test run but you cannot tell which test:** bisect.
Run the tests one at a time and stop at the first one that leaves the mess behind.
`find-polluter.sh` in this skill's directory does exactly that.

---

## Phase 2 — Compare Against Something That Works

You are looking for a difference, and the fastest way to see one is a side-by-side.

- **Find a working example** — similar code in the same codebase that behaves correctly
- **Read the reference completely** if you are following a pattern. Every line. Skimming a
  reference and adapting "the idea" is how half-understood patterns ship
- **List every difference**, however small. Do not filter by "that can't matter" — that
  judgement is exactly what you do not have yet
- **Check the dependencies**: what config, what environment, what other components does
  the working one have that the broken one does not?

---

## Phase 3 — One Hypothesis, One Variable

- **State it in writing:** "I think X is the cause, because Y." Specific, not vague.
- **Test it with the smallest possible change.** One variable. A controlled test that
  isolates your suspect beats a plausible story about the most recent commit.
- **Read the result honestly.** Confirmed → Phase 4. Not confirmed → form a *new*
  hypothesis. Never stack a second fix on top of an unconfirmed first one.
- **Say when you do not know.** "I don't understand why X happens" is a real state and a
  useful thing to report. Pretending to know produces confident wrong fixes.

---

## Phase 4 — Fix at the Source

### 1. Write the failing test first

The simplest reproduction you can manage — an automated test if there is a suite, a
throwaway script if there is not.

**Run it against the unfixed code and watch it fail, for the reason you expect.** A
test written after the fix, or one that passes both before and after, proves nothing.
This is the step that converts your hypothesis into evidence.

### 2. Make one change

Fix the cause you identified. One change. No "while I'm here" improvements, no bundled
refactoring — those make it impossible to tell what actually worked.

### 3. Verify

Does the new test pass? Does the rest of the suite still pass? Is the original symptom
actually gone — checked, not assumed?

### 4. If the fix did not work, stop and count

Under three attempts: return to Phase 1 with what you just learned. The failed attempt
is evidence.

**Three or more failed fixes means you have the wrong model of the problem.** Do not
attempt a fourth. The pattern to watch for: each fix uncovers a new problem somewhere
else, or each one needs "just a bit of refactoring" to land.

That is an architecture question, not a hypothesis question. Stop and raise it.

---

## Red Flags — Stop and Return to Phase 1

- "Quick fix now, investigate later"
- "Just try changing X and see"
- Several changes at once, then run the tests
- "Skip the test, I'll check it by hand"
- "It's probably X" — probably is not a cause
- "I don't fully understand this, but this might work"
- Listing fixes before tracing where the bad value came from
- "One more attempt" when two have already failed
- Each fix revealing a new problem somewhere else

## Quick Reference

| Phase | You do | Done when |
|---|---|---|
| **1. Evidence** | Read the error, reproduce, check changes, instrument boundaries, trace the value back | You can say what happened and where it started |
| **2. Compare** | Find a working case, read it fully, list every difference | You know what is different |
| **3. Hypothesis** | State one cause, test one variable | Confirmed, or you have a new hypothesis |
| **4. Fix** | Failing test first, one change, verify | The test that failed now passes, and nothing else broke |

## When There Really Is No Root Cause

It happens — a genuine race, an upstream bug, a hardware fault. But roughly nineteen
times in twenty, "no root cause" means the investigation stopped early.

Before you conclude it: can you reproduce it? Did you instrument every boundary? Did
you trace the value to its origin, or only to the last function you recognised?

## Related

- **AGENT_RULES.md → Testing Standards** — what makes the Phase 4 test a real one
- **`/test-generate`** — build out the suite once the cause is fixed
