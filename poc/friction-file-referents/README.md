# POC — file referents as a second matching channel

**Date:** 2026-09-03 · **Outcome:** SHELVED, do not build · **Branch:** `feat/friction-ledger-referents`

Everything needed to re-run or audit this is in the directory. Nothing here was shipped.

---

## 1. What happened, and why this exists

`/remember` matches an incoming friction cluster against ledger entries at step 4a. A
ledger entry's `class_hints` **are** fragments of the quotes that proved it, so an
entry's *identity* and its *evidence of recurrence* are the same strings. That is one
channel, and it cannot be tightened without losing recall — documented as a known
limitation in `docs/product/remember-README.md` §6.

The proposal was a second channel independent of the quotes: the **file paths** touched
around the reaction. v2.24.0 shipped half of it — `friction.cjs` now unions `files` per
cluster (capped 8, sorted). The other half — storing `files` on ledger entries and
showing them to the classifier — is what this POC evaluated.

The docs said the remaining half was "gated on an exact-label agreement measurement,"
which read as *justified and merely queued*. This POC checked the premise first, then
ran the measurement anyway at the user's direction.

## 2. What the POC covers

Two independent investigations:

**(a) A mechanical study** — no LLM. Does the channel carry information at the level it
would actually be used? Collision rates, document frequency, and within-class vs
across-class similarity, computed from a frozen corpus.

**(b) An LLM experiment** — 12 independent sonnet runs across 4 arms (3 runs each),
classifying 20 real clusters against the real 13-entry ledger, varying what the
classifier is shown.

| arm | ledger side | cluster side |
|---|---|---|
| A | quotes + class_hints + rule (**production today**) | quotes + keywords + preceding |
| B | + `files` | + `files` |
| C | rule + `files` only (quotes removed) | quotes + keywords + `files` + preceding |
| D | rule + `files` only | `files` + preceding + errors (**no quotes anywhere**) |

## 3. Results

### Finding 1 — the harm this was meant to prevent has never occurred

The failure mode is a false match inflating an entry until a `hot` entry reaches
`recurred_while_hot >= 2` and its rule is **rewritten**. `ag-001` is the only `hot`
entry; it sits at **1** against a threshold of **2**. Never fired. Its two `attempts`
are a deliberate August rephrasing, not a false-match rewrite.

The one observed false-match incident (zkagent) measured as a *model-tier* problem —
haiku 4/10 wrong, sonnet 0/10 — already closed by requiring sonnet-class. And `Open
item 2`'s own proposed mitigation, a negative example on generic entries, is already in
the 4a prompt.

### Finding 2 — the naive ledger design fails on its own terms

| level | collision |
|---|---|
| cluster union (what v2.24.0 ships) | **1.8%** |
| entry union (the proposed design) | **38.1%** |

A cluster spans 1–3 sessions and holds 2–8 paths. An *entry* accumulates across every
session it ever matched — `ag-001` piles up 35. 100 of 117 paths (85%) appear in exactly
one cluster, so the distribution is a long tail of distinctive paths with a head of pure
boilerplate (`README.md` 5/29, `CLAUDE.md` 5/29, `loop.js` 4/29). Small cluster unions
sample the tail; large entry unions always include the head. **All 8 colliding entry
pairs collide on boilerplate; none on a distinctive path.**

A document-frequency filter repairs it — 38.1% → 9.5% at `df<=2` — while barely shrinking
the sets (35 → 31). Mechanical, so it preserves the "no LLM distillation" property. But
repairing a fix for a problem that is not occurring is not a reason to ship.

### Finding 3 — files separate classes better than text, which is why the idea was attractive

On raw distinctness the **text wins** (98/101 populated, 96 distinct, 0.0% collision vs
files at 74/101, 71, 0.1%). But distinctness is the wrong metric — a perfect hash scores
100% distinct and never matches anything. The test that matters is within-class vs
across-class similarity:

| channel | within-class | across-class | separation |
|---|---|---|---|
| `user_context` text | 0.053 | 0.043 | **+0.010** |
| file referents | 0.045 | 0.005 | **+0.040** |

Files separate **4× better**. And the bias runs the other way: ledger entries were built
by matching on quotes, so within-class text similarity is inflated by construction, and
text still only managed +0.010.

Plainly: *the text says how angry you were; the files say what you were angry at.*

### Finding 4 — but the LLM experiment does not support shipping it

| arm | exact agr. | decision agr. | mean `ag-NNN` matches | mean drops | unstable |
|---|---|---|---|---|---|
| A (today) | 0.867 | 0.867 | 6.0 | 12.0 | 4/20 |
| B | 0.833 | 0.833 | 7.3 | 11.0 | 5/20 |
| C | 0.783 | 0.900 | 8.0 | 8.3 | 6/20 |
| D | **0.900** | **0.900** | 5.3 | 12.7 | **3/20** |

Adding files did **not** improve stability — B (0.833) is worse than A (0.867). And every
arm that adds files matches **more** (6.0 → 7.3 → 8.0) while dropping less. This project's
stated posture is precision over recall, because a false match is what inflates a hot
entry toward the rule rewrite. The channel meant to prevent false matches produced more
of them.

**The load-bearing case — cluster [17]:**

| arm | labels across 3 runs |
|---|---|
| A | ag-011, ag-011, drop |
| B | **ag-001, ag-001**, drop |
| C | ag-011, ag-011, ag-011 |

Cluster [17]'s own `files` list is **empty**. Adding files to the *ledger* side alone
moved it off `ag-011` onto `ag-001` — the generic hot entry carrying the largest file
set. Boilerplate attraction, reproduced end to end. *A signal that changes a decision it
has no data for is a bias, not a signal.*

It appears twice: cluster [9] is a **cross-session machine message**, not the user
speaking (`preceding.error` records `one-off without curse/interrupt/error: 0`). A and B
dropped it 3/3; C matched it to `ag-004` once, on boilerplate files alone.

### Finding 5 — the pre-registered metric is broken, and this is the most transferable result

**Arm D scored best on every stability number and is plainly the worst arm.**

- It **misses matches everything else agrees on**. Clusters [6]→`ag-012`, [16]→`ag-007`,
  [18]→`ag-001` were unanimous across all 9 runs of A, B and C. D unanimously dropped all
  three.
- Its themes are **garbage**: `new:aeacf23d4128-3d59a7ec2cc9` — a session hash as a
  mistake name — plus `new:fuck-branches-merge-cleanly` on a cluster every other arm
  dropped 3/3.
- Two of its three runs are **byte-identical**, inflating its own agreement score.

D achieves stability by having almost nothing to go on, so it defaults to `drop` (12.7 of
20). **High agreement on "I don't know" is not quality.** The metric rewards removing
information — the same degenerate shape as the severity axis that was seeded and rated on
the same signal.

So the un-shelve gate named in the PRD ("a measured improvement in exact-label
agreement") **is gameable and must not be used as written.** It needs a human-labelled
gold set.

### Finding 6 — the user's quotes are load-bearing

Strip them (arm D) and the classifier stops recognising three mistakes it otherwise
catches unanimously, and starts naming antigens after hash fragments. Files are neither
necessary nor sufficient on their own.

## 4. Verdict

**Do not build the ledger half.** Keep the incoming half that v2.24.0 shipped — it costs
nothing, adds no LLM step, and accumulates evidence for free.

**Un-shelve trigger** (checkable, not a judgement call):
- a false match observed under a **sonnet-class** classifier, **or**
- `ag-001` reaching `recurred_while_hot = 2` on evidence unrelated to validation.

If it is un-shelved, the gate must be a **human-labelled gold set**, not label agreement.
Finding 5 shows why.

## 5. Caveats — do not quote the numbers without these

- **3 runs per arm**, not the 5 the `top_keywords` precedent used. Differences around
  0.03 are ~2 comparisons out of 60 — noise. The load-bearing findings are the match-rate
  *direction*, the empty-files case, and arm D's degeneracy, not the agreement deltas.
- **No ground truth anywhere.** Every number is stability or rate, never correctness.
  Which labels are *right* remains unmeasured.
- Entry-level `files` are reconstructed by session-id linkage, not stored by production
  code — a faithful simulation of the proposed design, not the design itself. Only 8 of
  13 entries link; 7 carry files.
- `df` is corpus-dependent. Computed over this 34-cluster scan; a path's df changes with
  the next scan, so a df filter would need df stored or recomputed — an unresolved design
  question.
- `df==1` is near-circular ("keep only what is unique" cannot collide by construction).
  The `df<=2` row is the honest one.
- Small sample throughout: 20 clusters, 13 entries, 6 testable classes, 21 entry pairs.

## 6. Contents

| path | what |
|---|---|
| `clusters.json` | the 20 clusters classified (from the frozen 09-02 corpus, 34 clusters / 101 candidates) |
| `ledger.json` | the real 13-entry ledger used as the matching target |
| `prompts/prompt_{A,B,C,D}.txt` | exactly what each arm's classifier was shown |
| `results/{A,B,C,D}{1,2,3}.json` | raw labels from all 12 runs |
| `score.py` | agreement scorer — `python3 score.py` reproduces the tables above |

Related: `docs/product/antigen-gate-prd.md` §13 · `docs/product/remember-README.md` §6
