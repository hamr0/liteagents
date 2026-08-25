#!/usr/bin/env node

/**
 * friction.cjs behavioural tests
 *
 * Why this file exists: friction.cjs identifies a session by
 * path.basename(sessionFile, '.jsonl').slice(0, 8) — but one conversation can
 * exist as several session files (forks/resumes), each with its own uuid, so
 * one user reaction gets counted as N distinct sessions and can falsely
 * promote an antigen (recurrence gates promotion). Separately, a cluster with
 * no real user text bypasses the self-suspect filter and auto-qualifies as
 * severe. Both are fixed by (1) content-based session dedup — sessions that
 * share >=1 message uuid collapse to one canonical session — and (2) dropping
 * clusters whose joined contexts have fewer than 5 non-whitespace characters.
 *
 * Conventions follow tests/docs-builder/docs-builder.test.js:
 *   1. Self-contained. Every fixture is an ephemeral directory tree built
 *      here, in os.tmpdir(). No dependency on ~/.claude or any external repo.
 *   2. Negative controls included, so the suite can prove it can FAIL: a
 *      no-shared-uuid pair must NOT collapse, and a cluster with real text
 *      must NOT be dropped.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRICTION = path.join(__dirname, '..', '..', 'packages', 'claude', 'commands',
  'remember', 'friction.cjs');

// mkdtempSync wrapper that tracks every dir it creates so they can be swept
// up on exit — otherwise each test run leaks temp dirs into os.tmpdir().
const tmpDirs = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => {
  if (process.env.KEEP_TMP) return;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bright: '\x1b[1m' };

let passed = 0, failed = 0;
const failures = [];

function ok(label, actual, expected) {
  const a = String(actual), e = String(expected);
  if (a === e) { passed++; console.log(`  ${colors.green}PASS${colors.reset}  ${label}`); }
  else {
    failed++; failures.push(`${label}: expected [${e}] got [${a}]`);
    console.log(`  ${colors.red}FAIL${colors.reset}  ${label} — expected [${e}] got [${a}]`);
  }
}
const okTrue = (label, cond) => ok(label, !!cond, true);
const group = t => console.log(`\n${colors.bright}${colors.yellow}== ${t} ==${colors.reset}`);

// ---------------------------------------------------------------- harness

/** Run friction.cjs against sessionsDir, with cwd (where it writes its
 *  .claude/remember/friction/ output) pinned to an ephemeral directory. */
function run(cwd, sessionsDir) {
  const r = spawnSync('node', [FRICTION, sessionsDir], { cwd, encoding: 'utf8' });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status == null ? -1 : r.status };
}

function clustersOf(cwd) {
  const p = path.join(cwd, '.claude', 'remember', 'friction', 'antigen_clusters.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Find the cluster whose top_keywords/theme contain a given marker word — the
 *  fixtures below each carry a distinctive keyword so clusters are unambiguous. */
function findCluster(clusters, marker) {
  return clusters.find(c =>
    (c.theme || '').includes(marker) || (c.top_keywords || []).includes(marker));
}

const BASE_TS = Date.parse('2026-01-01T00:00:00.000Z');
const tsAt = mins => new Date(BASE_TS + mins * 60000).toISOString();

function userEvent(text, mins, uuid, parentUuid) {
  return {
    type: 'user', message: { role: 'user', content: text }, timestamp: tsAt(mins),
    uuid, parentUuid: parentUuid || null, sessionId: 'fixture', cwd: '/tmp/fixture',
    gitBranch: 'main', userType: 'external', version: '1.0.0',
  };
}
function assistantEvent(text, mins, uuid, parentUuid) {
  return {
    type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] },
    timestamp: tsAt(mins), uuid, parentUuid: parentUuid || null, sessionId: 'fixture',
  };
}
// An assistant turn that ran a tool and hit a real error — used by fixture
// (f) to give a terse-text session genuine machine corroboration (errors)
// without any usable quoted user text.
function assistantErrorToolEvent(mins, uuid, parentUuid) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_result', content: 'Exit code 1\nTests failed' },
    ] },
    timestamp: tsAt(mins), uuid, parentUuid: parentUuid || null, sessionId: 'fixture',
  };
}

/** Write one session file: events is an array of {type, text, mins, uuid}. */
function writeSession(dir, filename, events) {
  fs.mkdirSync(dir, { recursive: true });
  let prev = null;
  const lines = events.map(e => {
    let rec;
    if (e.type === 'user') rec = userEvent(e.text, e.mins, e.uuid, prev);
    else if (e.type === 'assistant-error') rec = assistantErrorToolEvent(e.mins, e.uuid, prev);
    else rec = assistantEvent(e.text, e.mins, e.uuid, prev);
    prev = e.uuid;
    return JSON.stringify(rec);
  });
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n');
}

// A 3-turn conversation: ask -> claimed-done -> real correction. isInteractive
// requires >1 user text turn, and the correction message must start with a
// no/wrong/stop-style token to trip the user_correction signal.
function correctionTurns(askText, correctionText, uuids) {
  return [
    { type: 'user', text: askText, mins: 0, uuid: uuids[0] },
    { type: 'assistant', text: 'Done! Fixed it.', mins: 1, uuid: uuids[1] },
    { type: 'user', text: correctionText, mins: 2, uuid: uuids[2] },
  ];
}

// ---------------------------------------------------------------- fixture build

function buildFixture(root) {
  const sessionsDir = path.join(root, 'sessions');

  // (a) DEDUP POSITIVE — two session FILES that are a physical duplicate
  // (forked/resumed session): same messages, same uuids, different filenames.
  // A real session dedup rule must collapse this cluster's `sessions` to 1.
  // Uuids are >=8 chars (like real session uuids) — computeCanonicalSessionIds
  // ignores shorter ones as a degenerate-uuid guard (see FIX E / fixture (g)).
  const dupEvents = correctionTurns(
    'please fix the database migration script',
    'no that is not right, the database migration still broke everything, damn it',
    ['dup-uuid-0001', 'dup-uuid-0002', 'dup-uuid-0003']);
  writeSession(path.join(sessionsDir, 'projA'), '11111111-aaaa-forkA.jsonl', dupEvents);
  writeSession(path.join(sessionsDir, 'projA'), '22222222-aaaa-forkB.jsonl', dupEvents);

  // (b) DEDUP NEGATIVE CONTROL — two INDEPENDENT sessions that happen to
  // describe the same kind of correction (so they land in the SAME content
  // cluster) but share NO uuids at all. The dedup rule must NOT merge these:
  // the cluster must still count 2 sessions.
  writeSession(path.join(sessionsDir, 'projB'), '33333333-bbbb-real1.jsonl',
    correctionTurns(
      'please check the payment gateway',
      'no that is not right, the payment gateway timeout is still happening, damn it',
      ['b1-u1', 'b1-u2', 'b1-u3']));
  writeSession(path.join(sessionsDir, 'projB'), '44444444-bbbb-real2.jsonl',
    correctionTurns(
      'please check the payment gateway',
      'no that is not right, the payment gateway timeout is still happening, damn it',
      ['b2-u1', 'b2-u2', 'b2-u3']));

  // (c) EMPTY-CONTEXT CLUSTER — both user turns are <=2 chars ("hi" / "no").
  // "no" fires the user_correction signal (isInteractive only needs >1 user
  // turn, regardless of length) and both turns survive into
  // candidate.user_context (analyzeBadSession only drops empty/paste/
  // interrupted text), but clusterCandidates' own session-text aggregation
  // requires `m.length > 2` before pooling text into a session's texts — so
  // neither 2-char turn ever becomes cluster context. The resulting cluster
  // has contexts == [] and (pre-fix) still auto-qualifies as severe/episode,
  // bypassing the self-suspect filter entirely.
  writeSession(path.join(sessionsDir, 'projC'), '55555555-cccc-empty.jsonl',
    correctionTurns('hi', 'no', ['c-u1', 'c-u2', 'c-u3']));

  // (d) KEPT CONTROL — a normal single-session correction with real text.
  // Must survive the empty-context drop (contexts.length > 0).
  writeSession(path.join(sessionsDir, 'projD'), '66666666-dddd-real.jsonl',
    correctionTurns(
      'please clean up the report generator',
      'no that is not right, the report generator still crashes on export, damn it',
      ['d-u1', 'd-u2', 'd-u3']));

  // (e) PARTIAL OVERLAP — pins the threshold at ">=1 shared uuid". A real fork
  // diverges after the fork point, so the two files share only their COMMON
  // PREFIX, not every uuid: measured on the real corpus, genuine duplicate
  // pairs overlapped between 27% and 100%. Without this case the suite would
  // still pass if someone tightened the rule to "all uuids must match", since
  // fixture (a) is a 100% duplicate. Here only the FIRST uuid is shared.
  writeSession(path.join(sessionsDir, 'projE'), '77777777-eeee-forkA.jsonl',
    correctionTurns(
      'please rebuild the search indexer',
      'no that is not right, the search indexer skips half the files, damn it',
      ['e-shared-u1', 'eA-u2', 'eA-u3']));
  writeSession(path.join(sessionsDir, 'projE'), '88888888-eeee-forkB.jsonl',
    correctionTurns(
      'please rebuild the search indexer',
      'no that is not right, the search indexer skips half the files, damn it',
      ['e-shared-u1', 'eB-u2', 'eB-u3']));

  // (f) 0-CONTEXT WITH MACHINE CORROBORATION — both user turns are terse
  // ("hi" / "no", like fixture (c)) so no real quoted text survives into
  // cluster contexts, but the window also contains a genuine tool error
  // (Exit code 1). A 0-context cluster must not be hard-dropped when it has
  // real corroboration — it should survive as severe (via the error, not via
  // the terse user_correction) with contexts == [].
  writeSession(path.join(sessionsDir, 'projF'), '99999999-ffff-terse.jsonl', [
    { type: 'user', text: 'hi', mins: 0, uuid: 'f-u1' },
    { type: 'assistant-error', mins: 1, uuid: 'f-a1' },
    { type: 'user', text: 'no', mins: 2, uuid: 'f-u2' },
  ]);

  // (g) DEGENERATE UUID — three UNRELATED sessions (different projects,
  // different corrections, deliberately worded with no shared phrase so the
  // CONTENT clusterer alone would never merge them) whose events all share
  // the SAME constant uuid "" (simulating a tool/log emitter that never
  // assigns a real per-message uuid). Without a length guard,
  // computeCanonicalSessionIds would union all three into one canonical
  // session, collapsing 3 real distinct corrections down to sessions:1 and
  // destroying recurrence counting.
  const degenerateUuid = '';
  for (const [proj, file, ask, correction] of [
    ['projG', 'g1111111-gggg-one.jsonl', 'please refactor the login handler', 'wrong, the login handler crashes on submit, damn it'],
    ['projG', 'g2222222-gggg-two.jsonl', 'please optimize the export pipeline', 'stop, the export pipeline is far too slow, damn it'],
    ['projG', 'g3333333-gggg-three.jsonl', 'please redesign the upload widget', 'revert, the upload widget rejects large files, damn it'],
  ]) {
    writeSession(path.join(sessionsDir, proj), file, [
      { type: 'user', text: ask, mins: 0, uuid: degenerateUuid },
      { type: 'assistant', text: 'Done! Fixed it.', mins: 1, uuid: degenerateUuid },
      { type: 'user', text: correction, mins: 2, uuid: degenerateUuid },
    ]);
  }

  // (h) UUID CAP OVERFLOW — 13 distinct sessions (one more than
  // MAX_SESSIONS_PER_UUID=12) whose events all share one constant, real-length
  // uuid ("h-shared-uuid-cap", >=8 chars so it isn't caught by the (g)
  // degenerate-uuid length guard instead). This must NOT union into one
  // canonical session (same protection as (g), for an implausibly-large
  // sharing count rather than a too-short uuid) AND must emit a stderr
  // warning so the cap firing is visible, not silent.
  const capUuid = 'h-shared-uuid-cap';
  for (let i = 1; i <= 13; i++) {
    const n = String(i).padStart(2, '0');
    writeSession(path.join(sessionsDir, 'projH'), `h${n}111111-hhhh-cap.jsonl`, [
      { type: 'user', text: `please review capfile number ${n}`, mins: 0, uuid: capUuid },
      { type: 'assistant', text: 'Done! Fixed it.', mins: 1, uuid: capUuid },
      { type: 'user', text: `wrong, capfile ${n} review is still incomplete`, mins: 2, uuid: capUuid },
    ]);
  }

  // (i) SEVERITY IS INTENSITY, NOT EXISTENCE — two one-off sessions. The
  // first is a plain correction with real text and no curse, interrupt, or
  // tool error: one-off + mild → 'drop', so it must NOT appear in the output
  // at all. The second is the same shape plus a curse: one-off + severe →
  // 'episode', kept. Pre-fix, a plain user_correction with context was
  // auto-severe, so every cluster friction could ever emit was severe and the
  // fact/drop quadrants of the recurrence × severity grid were unreachable
  // (measured 69/69 severe on the real corpus).
  writeSession(path.join(sessionsDir, 'projI'), 'i1111111-iiii-mild.jsonl',
    correctionTurns(
      'please warm the lookup cachewarmer on boot',
      'no that is not right, the cachewarmer still misses half the keys',
      ['i1-u1', 'i1-u2', 'i1-u3']));
  writeSession(path.join(sessionsDir, 'projI'), 'i2222222-iiii-severe.jsonl',
    correctionTurns(
      'please fix the cron dispatcher',
      'no that is not right, the dispatcher still double-fires, damn it',
      ['i2-u1', 'i2-u2', 'i2-u3']));

  return sessionsDir;
}

// ---------------------------------------------------------------- test

function main() {
  group('friction.cjs — session dedup + empty-context cluster drop');

  const root = tmpDir('friction-test-');
  const sessionsDir = buildFixture(root);
  const cwd = tmpDir('friction-cwd-');

  const result = run(cwd, sessionsDir);
  ok('friction.cjs ran without crashing', result.code, 0);

  let clusters = [];
  let readOk = true;
  try { clusters = clustersOf(cwd); } catch (e) { readOk = false; console.log(`  ${colors.red}could not read antigen_clusters.json: ${e.message}${colors.reset}`); }
  okTrue('antigen_clusters.json was produced', readOk);

  if (readOk) {
    // (a) two physically-duplicate session files (shared uuids) must collapse
    // to ONE counted session, and both fork member hashes must still be
    // exposed in session_ids (the canonical pick is only a grouping key —
    // /remember must be able to match on ANY member hash).
    const dupCluster = findCluster(clusters, 'database');
    okTrue('(a) dup-uuid cluster found', !!dupCluster);
    if (dupCluster) {
      ok('(a) dup-uuid sessions collapse to 1', dupCluster.sessions, 1);
      ok('(a) dup-uuid cluster carries both fork member hashes', (dupCluster.session_ids || []).length, 2);
      // one shared conversation's reaction must count once, not once per file
      ok('(a) dup-uuid signals count once (not once per file)', dupCluster.signals.user_correction, 1);
    }

    // (b) NEGATIVE CONTROL — two independent sessions with no shared uuid
    // must stay 2 counted sessions, proving the rule does not over-merge, and
    // must keep counting 2 reactions (proves the (a) dedupe above isn't just
    // silently halving every cluster's signal count).
    const noDupCluster = findCluster(clusters, 'payment');
    okTrue('(b) no-shared-uuid cluster found', !!noDupCluster);
    if (noDupCluster) {
      ok('(b) no-shared-uuid sessions stay 2', noDupCluster.sessions, 2);
      ok('(b) no-shared-uuid signals stay 2', noDupCluster.signals.user_correction, 2);
    }

    // (c) a cluster whose only correction text is a filtered terminal paste
    // (contexts == []) must be DROPPED outright, not merely downgraded.
    const emptyCluster = clusters.find(c => (c.contexts || []).length === 0 && c.errors.length === 0);
    okTrue('(c) empty-context, no-corroboration cluster is dropped', !emptyCluster);

    // (d) KEPT CONTROL — a cluster with real correction text must survive,
    // and must report the single reaction it actually saw.
    const realCluster = findCluster(clusters, 'report');
    okTrue('(d) real-text cluster found', !!realCluster);
    if (realCluster) {
      okTrue('(d) real-text cluster keeps its contexts', (realCluster.contexts || []).length > 0);
      ok('(d) real-text cluster signals count', realCluster.signals.user_correction, 1);
    }

    // (e) PARTIAL OVERLAP — sharing only ONE uuid is still the same
    // conversation. Pins the threshold at >=1; a stricter rule fails here.
    // Both fork member hashes must survive into session_ids, and the shared
    // reaction (identical anchor timestamp in both files) must count once.
    const partialCluster = findCluster(clusters, 'indexer');
    okTrue('(e) partial-overlap cluster found', !!partialCluster);
    if (partialCluster) {
      ok('(e) partial-overlap (1 shared uuid) collapses to 1', partialCluster.sessions, 1);
      ok('(e) partial-overlap cluster carries both fork member hashes', (partialCluster.session_ids || []).length, 2);
      ok('(e) partial-overlap signals count once (not once per file)', partialCluster.signals.user_correction, 1);
    }

    // (f) 0-CONTEXT WITH MACHINE CORROBORATION — a terse-text session (no
    // usable quoted text) that also hit a real tool error must NOT be
    // hard-dropped: it should survive as a severe episode via the error,
    // with contexts == [] (proves the hard content-length drop was replaced
    // by a severity downgrade, not deleted wholesale).
    const terseErrorCluster = clusters.find(c =>
      (c.contexts || []).length === 0 && (c.errors || []).length > 0);
    okTrue('(f) 0-context cluster with a real error is kept, not dropped', !!terseErrorCluster);
    if (terseErrorCluster) {
      ok('(f) 0-context+error cluster is severe', terseErrorCluster.severity, 'severe');
      ok('(f) 0-context+error cluster keeps its error', terseErrorCluster.errors[0], 'Exit code 1');
    }

    // (g) DEGENERATE UUID — three unrelated sessions whose events all share
    // the same constant uuid "" must NOT collapse into one canonical
    // session: each distinct correction must still count as its own session.
    const loginCluster = findCluster(clusters, 'login');
    const exportCluster = findCluster(clusters, 'export');
    const uploadCluster = findCluster(clusters, 'widget');
    okTrue('(g) degenerate-uuid login cluster found', !!loginCluster);
    okTrue('(g) degenerate-uuid export cluster found', !!exportCluster);
    okTrue('(g) degenerate-uuid widget cluster found', !!uploadCluster);
    if (loginCluster) ok('(g) degenerate-uuid login session stays its own', loginCluster.sessions, 1);
    if (exportCluster) ok('(g) degenerate-uuid export session stays its own', exportCluster.sessions, 1);
    if (uploadCluster) ok('(g) degenerate-uuid widget session stays its own', uploadCluster.sessions, 1);

    // (i) SEVERITY IS INTENSITY — a one-off plain correction (no curse,
    // interrupt, or error) is mild and must be dropped from the output; the
    // same shape with a curse is severe and survives as an episode. Every
    // cluster that IS emitted must carry a curse, interrupt, or error — the
    // property that makes the fact/drop quadrants reachable at all.
    const mildCluster = findCluster(clusters, 'cachewarmer');
    okTrue('(i) one-off plain correction (mild) is dropped', !mildCluster);
    const severeCluster = findCluster(clusters, 'dispatcher');
    okTrue('(i) one-off correction + curse (severe) is kept', !!severeCluster);
    if (severeCluster) {
      ok('(i) one-off curse cluster is severe', severeCluster.severity, 'severe');
      ok('(i) one-off curse cluster routes to episode', severeCluster.suggested_artifact, 'episode');
    }
    const hasIntensity = c => Object.keys(c.signals || {}).some(s => s === 'user_curse' || s === 'interrupt_cascade')
      || (c.errors || []).length > 0;
    okTrue('(i) every emitted ONE-OFF cluster carries a curse, interrupt, or error',
      clusters.filter(c => c.sessions < 3).every(hasIntensity));

    // (h) UUID CAP OVERFLOW — 13 sessions sharing one real-length uuid (one
    // over MAX_SESSIONS_PER_UUID=12) must NOT union into a single canonical
    // session, and the cap firing must be visible on stderr, not silent.
    const capCluster = clusters.find(c => (c.top_keywords || []).includes('capfile'));
    okTrue('(h) uuid-cap-overflow cluster found', !!capCluster);
    if (capCluster) {
      okTrue('(h) uuid-cap-overflow sessions do NOT collapse to 1 (13 distinct)', capCluster.sessions > 1);
      // 13 plain corrections, no curse/interrupt/error: recurring + mild →
      // 'fact'. Pre-fix this was 'antigen' (auto-severe) — the fact quadrant
      // was unreachable.
      ok('(h)/(i) recurring plain-correction cluster is mild', capCluster.severity, 'mild');
      ok('(h)/(i) recurring plain-correction cluster routes to fact', capCluster.suggested_artifact, 'fact');
    }
    okTrue('(h) uuid-cap-overflow emits a stderr warning when the cap fires',
      result.out.includes('warn: uuid shared by 13 sessions'));
  }

  // ---------------------------------------------------------------- S6: empty-dir second run
  // /remember always runs friction from the same project cwd, so after the first real run
  // .claude/remember/friction/friction_analysis.json is always already on disk. A later run
  // against a sessions dir with no sessions (moved root, typo, empty mount) must not silently
  // reuse that leftover file and report success — /remember relies on a non-zero exit to
  // loud-skip. Reuses this file's own fixture (a real run) as the "good" first run, then a
  // second run in the SAME cwd against an empty directory.
  group('friction.cjs — empty sessions dir on a second run must not report success');
  {
    const cwd2 = tmpDir('friction-cwd2-');
    const goodResult = run(cwd2, sessionsDir);
    ok('(S6) first run (real sessions) exits 0', goodResult.code, 0);

    const emptyDir = tmpDir('friction-empty-');
    const badResult = run(cwd2, emptyDir);
    okTrue('(S6) second run (empty dir, same cwd) does NOT report success',
      badResult.code !== 0);
  }

  // ---------------------------------------------------------------- /remember output regression fixtures
  // Real, uncrafted MEMORY.md / ledger.json / antigen_clusters.json captured from live
  // /remember runs on three other repos (bareagent, privcloud, zkagent), copied read-only
  // into tests/friction/fixtures/. These assert hard invariants the spec makes about
  // /remember's own OUTPUT files — the first regression coverage that layer has ever had.
  // Pure file parsing; no dependency on friction.cjs, ~/.claude, or any live repo.
  group('/remember output fixtures — regression invariants (I1-I6)');

  const FIXTURES = path.join(__dirname, 'fixtures');

  // A known-bad fixture is a DETECTION test: assert the checker reports the exact
  // known violation count/set (so the suite proves the checker catches it). A
  // known-good fixture is a CONFORMANCE test: assert zero violations. When a
  // fixture is regenerated from a run where the underlying bug is fixed, flip its
  // assertion from DETECTS-N to ==0 (or from a non-empty set to the empty set).

  // ---- I1: known-bad violation counts, captured from real /remember runs.
  // bareagent: length gate bypassed, 91 raw lines >180 chars, 1 exempted by a
  // >100-char backtick literal -> 90 net violations. privcloud: a single 181-char
  // line overruns the 180 cap by 1 char, no exemption applies.
  const I1_EXPECTED = { bareagent: 90, privcloud: 1, 'bareagent-fixed': 0 };

  // 'bareagent-fixed' is a CONFORMANCE pair for 'bareagent': the same corpus,
  // re-captured from a live /remember run AFTER the length-gate bug was fixed.
  // It carries no ledger.json (byte-identical to fixtures/bareagent/ledger.json,
  // not duplicated here) or antigen_clusters.json, so I3/I4/I5 are skipped for
  // it below via fs.existsSync — there is no existing absent-file skip
  // mechanism elsewhere in this loop to reuse.
  for (const proj of ['bareagent', 'bareagent-fixed', 'privcloud']) {
    // ---- I1: fact line length. Between "## Facts" and "## Episodes", every "- " line
    // must be <=180 chars, EXCEPT when its longest backtick-quoted literal is >100 chars.
    const memoryText = fs.readFileSync(path.join(FIXTURES, proj, 'MEMORY.md'), 'utf8');
    const factsStart = memoryText.indexOf('## Facts');
    const episodesStart = memoryText.indexOf('## Episodes');
    const factsSection = memoryText.slice(factsStart, episodesStart);
    const factLines = factsSection.split('\n').filter(l => l.startsWith('- '));
    let factViolations = 0, rawViolations = 0;
    for (const line of factLines) {
      const backtickLens = [...line.matchAll(/`([^`]*)`/g)].map(m => m[1].length);
      const exempt = backtickLens.length > 0 && Math.max(...backtickLens) > 100;
      if (line.length > 180) rawViolations++;
      if (line.length > 180 && !exempt) factViolations++;
    }
    if (proj === 'bareagent') {
      ok(`I1 DETECTS bareagent length-gate bypass (90 of 94 facts over 180; ` +
        `raw ${rawViolations} before backtick exemption, net ${factViolations} after)`,
        factViolations, I1_EXPECTED[proj]);
    } else if (proj === 'bareagent-fixed') {
      ok(`I1 bareagent-fixed: same corpus after gate fix, ${factViolations} of ${factLines.length} facts over 180`,
        factViolations, I1_EXPECTED[proj]);
    } else {
      ok(`I1 DETECTS privcloud 1-char overrun (181 chars, ${factViolations} of ${factLines.length} facts)`,
        factViolations, I1_EXPECTED[proj]);
    }

    // ---- I2: episode cap. "### " entries under "## Episodes" (before "## Antigens") <= 10.
    const antigensStart = memoryText.indexOf('## Antigens');
    const episodesSection = memoryText.slice(episodesStart, antigensStart);
    const episodeCount = (episodesSection.match(/^### /gm) || []).length;
    okTrue(`I2 (${proj}) episode count <= 10 (found ${episodeCount})`, episodeCount <= 10);

    // ---- I3/I4: ledger session accounting. I3 DETECTS the known-bad set of
    // inflated entries (verified real: privcloud ag-006's two session_ids share
    // conversation prefix 0821-1747 and the two files share 99 message uuids —
    // sessions:2 is inflated, should be 1); every other entry is a CONFORMANCE
    // check that stays green. Skipped for bareagent-fixed: no ledger.json fixture.
    const ledgerPath = path.join(FIXTURES, proj, 'ledger.json');
    if (fs.existsSync(ledgerPath)) {
      const I3_KNOWN_BAD = { bareagent: [], privcloud: ['ag-006'] };
      const knownBad = new Set(I3_KNOWN_BAD[proj]);
      const flagged = [];
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      for (const entry of ledger.entries) {
        const rawIds = entry.evidence.session_ids || [];
        const ids = rawIds.map(x => (typeof x === 'string' ? x : x.id));
        // strip trailing "-<8 hex>" to get the conversation prefix (files of one forked
        // conversation share that prefix); an id with no such suffix is its own prefix.
        const prefixes = new Set(ids.map(id => id.replace(/-[0-9a-f]{8}$/, '')));
        const sessions = entry.evidence.sessions;
        const violates = sessions > prefixes.size;
        if (violates) flagged.push(entry.id);
        if (!knownBad.has(entry.id)) {
          okTrue(`I3 (${proj} ${entry.id}) sessions (${sessions}) <= distinct conversation prefixes (${prefixes.size})`,
            !violates);
        }
        okTrue(`I4 (${proj} ${entry.id}) sessions (${sessions}) <= session_ids.length (${ids.length})`,
          sessions <= ids.length);
      }
      if (proj === 'bareagent') {
        ok('I3 bareagent ledger has no inflated entries', JSON.stringify(flagged), JSON.stringify([]));
      } else {
        ok('I3 DETECTS privcloud inflated entries == [ag-006]',
          JSON.stringify(flagged), JSON.stringify([...knownBad]));
      }
    }
  }

  // ---- I5: cluster contract (privcloud antigen_clusters.json only — the only fixture
  // that has one). sessions <= session_ids.length, and sessions == distinct prefixes.
  const privClusters = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'privcloud', 'antigen_clusters.json'), 'utf8'));
  let multiFileClusters = 0;
  for (const c of privClusters) {
    const ids = c.session_ids || [];
    okTrue(`I5 (privcloud) sessions (${c.sessions}) <= session_ids.length (${ids.length}) — ${c.theme}`,
      c.sessions <= ids.length);
    const prefixes = new Set(ids.map(id => id.replace(/-[0-9a-f]{8}$/, '')));
    okTrue(`I5 (privcloud) sessions (${c.sessions}) == distinct conversation prefixes (${prefixes.size}) — ${c.theme}`,
      c.sessions === prefixes.size);
    if (ids.length > c.sessions) multiFileClusters++;
  }
  // KNOWN: exactly 2 clusters have session_ids.length > sessions ("no npm for this" with 3
  // ids, "change docs to Gists" with 2) — characterizes the fixture's correct multi-file shape.
  ok('I5 (privcloud) multi-file clusters (session_ids.length > sessions) count', multiFileClusters, 2);

  // ---- I6: ledger status <-> session-count consistency (4b/4c contradiction fix), plus
  // MEMORY.md High Confidence id <-> ledger "hot" cross-check where an id is present.
  // Violation triad matches the spec: hot with sessions<5, observing with sessions>=5,
  // expired with sessions>=5 (privcloud has several observing entries at sessions:1,
  // pre-dating this fix and out of scope -- they are not part of the triad, so they
  // stay green). zkagent (captured 2026-08-25) is the fixture that motivated this: ag-001
  // was born hot at 6 sessions on its very first /remember run for a fresh ledger.
  // None of the three fixtures' MEMORY.md High Confidence bullets actually carry an
  // "ag-NNN" id (grep confirms 0 "ag-[0-9]" matches in all three, zkagent included) --
  // that id-suffix format appears only in this repo's own live .claude/remember/MEMORY.md,
  // not in any captured fixture -- so the id-matching half below currently checks 0 ids
  // per fixture (vacuously passes) but is real code, exercised the moment a fixture with
  // ids is captured.
  function checkLedgerStatus(ledger) {
    const bad = [];
    for (const entry of ledger.entries) {
      const n = entry.evidence.sessions;
      const s = entry.status;
      const violates = (s === 'hot' && n < 5) || (s === 'observing' && n >= 5) ||
        (s === 'expired' && n >= 5);
      if (violates) bad.push(entry.id);
    }
    return bad;
  }

  for (const proj of ['bareagent', 'privcloud', 'zkagent']) {
    const ledgerPath = path.join(FIXTURES, proj, 'ledger.json');
    if (!fs.existsSync(ledgerPath)) continue;
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    const bad = checkLedgerStatus(ledger);
    ok(`I6 (${proj}) ledger status <-> session count consistent (hot>=5, observing/expired<5)`,
      JSON.stringify(bad), JSON.stringify([]));

    const memText = fs.readFileSync(path.join(FIXTURES, proj, 'MEMORY.md'), 'utf8');
    const hcStart = memText.indexOf('### High Confidence');
    const hcEnd = memText.indexOf('### ', hcStart + 1);
    const hcSection = memText.slice(hcStart, hcEnd === -1 ? undefined : hcEnd);
    const ids = [...hcSection.matchAll(/—\s*(ag-\d+)\s*$/gm)].map(m => m[1]);
    for (const id of ids) {
      const entry = ledger.entries.find(e => e.id === id);
      okTrue(`I6 (${proj}) MEMORY.md High Confidence id ${id} is a hot ledger entry with sessions>=5`,
        !!entry && entry.status === 'hot' && entry.evidence.sessions >= 5);
    }
  }

  // ---- I6 DETECTION: tamper an in-memory copy of zkagent's ledger (ag-001, born hot at
  // 6 sessions on 2026-08-25 -- the case that surfaced the 4b/4c contradiction) by flipping
  // status to "observing" without touching its session count, and confirm checkLedgerStatus
  // flags exactly that id. Proves the checker can fail, not just pass.
  {
    const zkLedger = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'zkagent', 'ledger.json'), 'utf8'));
    const tampered = JSON.parse(JSON.stringify(zkLedger));
    tampered.entries.find(e => e.id === 'ag-001').status = 'observing';
    const bad = checkLedgerStatus(tampered);
    ok('I6 DETECTS tampered zkagent ag-001 (flipped to observing at 6 sessions)',
      JSON.stringify(bad), JSON.stringify(['ag-001']));
  }

  // ---------------------------------------------------------------- summary
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`Total tests: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  if (failures.length > 0) {
    console.log(`\n${colors.red}Failures:${colors.reset}`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
