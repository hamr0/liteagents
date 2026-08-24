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
    'no that is not right, the database migration still broke everything',
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
      'no that is not right, the payment gateway timeout is still happening',
      ['b1-u1', 'b1-u2', 'b1-u3']));
  writeSession(path.join(sessionsDir, 'projB'), '44444444-bbbb-real2.jsonl',
    correctionTurns(
      'please check the payment gateway',
      'no that is not right, the payment gateway timeout is still happening',
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
      'no that is not right, the report generator still crashes on export',
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
      'no that is not right, the search indexer skips half the files',
      ['e-shared-u1', 'eA-u2', 'eA-u3']));
  writeSession(path.join(sessionsDir, 'projE'), '88888888-eeee-forkB.jsonl',
    correctionTurns(
      'please rebuild the search indexer',
      'no that is not right, the search indexer skips half the files',
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
    ['projG', 'g1111111-gggg-one.jsonl', 'please refactor the login handler', 'wrong, the login handler crashes on submit'],
    ['projG', 'g2222222-gggg-two.jsonl', 'please optimize the export pipeline', 'stop, the export pipeline is far too slow'],
    ['projG', 'g3333333-gggg-three.jsonl', 'please redesign the upload widget', 'revert, the upload widget rejects large files'],
  ]) {
    writeSession(path.join(sessionsDir, proj), file, [
      { type: 'user', text: ask, mins: 0, uuid: degenerateUuid },
      { type: 'assistant', text: 'Done! Fixed it.', mins: 1, uuid: degenerateUuid },
      { type: 'user', text: correction, mins: 2, uuid: degenerateUuid },
    ]);
  }

  return sessionsDir;
}

// ---------------------------------------------------------------- test

function main() {
  group('friction.cjs — session dedup + empty-context cluster drop');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friction-test-'));
  const sessionsDir = buildFixture(root);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'friction-cwd-'));

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
