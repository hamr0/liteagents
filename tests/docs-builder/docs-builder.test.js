#!/usr/bin/env node

/**
 * docs-builder behavioural tests
 *
 * Why this file exists: docs-builder is ~1200 lines that had shipped four rounds of bug
 * fixes with ZERO tests in the repo. Every bug was found by a human running it by hand, and
 * the same defect kept coming back because nothing could catch it. The only suite that
 * existed lived in a scratchpad /tmp path, depended on four external repos, and had already
 * rotted without anyone noticing.
 *
 * Two rules this file holds to:
 *   1. Self-contained. Every fixture is an ephemeral git repo built here, in os.tmpdir().
 *      No dependency on any repo outside this one, so it cannot rot silently.
 *   2. Invariants, not magic numbers. The old suite asserted "86 records, 5669 lines,
 *      $1.96" against one document in someone else's repo. Those are measurements — they
 *      belong in the spec, not in a gate. Here we assert properties that hold on ANY
 *      corpus, so an edit to a doc cannot turn a green suite red for no reason.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB = path.join(__dirname, '..', '..', 'packages', 'claude', 'commands',
  'docs-builder', 'docs-builder.cjs');

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

const GIT = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], GIT).trim();

/** A throwaway git repo with a docs/ tree. Files is a { relpath: contents } map. */
function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  git(dir, ['init', '-q', '.']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  write(dir, files);
  if (Object.keys(files).length) { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'init']); }
  return dir;
}
function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

/** Run docs-builder. Never throws — returns { out, code } so a test can assert on failure.
 *  `out` is stdout+stderr combined: a WARN/SKIP written to stderr on an otherwise-clean exit
 *  is invisible to any assertion that only looks at stdout. execFileSync's return value only
 *  ever carries stdout on a clean exit (stderr is available solely on the thrown error), so
 *  this uses spawnSync instead, which gives both back on every exit code. */
function db(cwd, args, env = {}) {
  const r = spawnSync('node', [DB, ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, REPO: '.', ...env } });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status == null ? -1 : r.status };
}
const artifact = (dir, name) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'docs/.docs-builder', name), 'utf8'));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

const DOC = (h1, h2 = 'Section One', body = 'words words words') =>
  `# ${h1}\n\nintro line\n\n## ${h2}\n\n${body}\n`;

// ---------------------------------------------------------------- 1. negative controls

/**
 * Every suite needs proof it can produce the negative. A fixture authored to contain the
 * phenomenon can only ever confirm it. These four assert the FAILING side of gates that
 * later tests assert the passing side of — if these ever go green-by-default, the rest of
 * this file is decoration.
 */
function negativeControls() {
  group('1. negative controls — can these tests FAIL?');

  const d = repo({ 'docs/A.md': DOC('A') });
  db(d, ['scan', 'docs/A.md']);

  // validate with a labels file that has no themes[] must NOT self-disable into a PASS.
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({ labels: [] }) });
  const noThemes = db(d, ['validate', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json']);
  ok('validate rejects labels.json with no themes[]', noThemes.code, 1);

  // A key that was never in the outline must be reported as invented, not silently accepted.
  write(d, { 'docs/.docs-builder/bad.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }],
    labels: [{ key: 'docs/A.md :: Not A Real Heading', theme: 't' }] }) });
  const invented = db(d, ['validate', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/bad.json']);
  ok('validate rejects an invented key', invented.code, 1);

  // A non-git directory must produce the guarded message, never a Node stack trace.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'db-nogit-'));
  fs.mkdirSync(path.join(bare, 'docs'), { recursive: true });
  const nogit = db(bare, ['ledger']);
  okTrue('non-git repo gives a clean error, not a stack trace',
    /git failed while/.test(nogit.out) && !/at Object\.<anonymous>/.test(nogit.out));

  // The link check used later must be able to see a dead link, or it proves nothing.
  const d2 = repo({ 'docs/A.md': DOC('A'), 'README.md': '[a](docs/A.md)\n' });
  okTrue('link check sees a LIVE link before any move', exists(d2, 'docs/A.md'));
  fs.unlinkSync(path.join(d2, 'docs/A.md'));
  okTrue('link check sees a DEAD link once the target is gone', !exists(d2, 'docs/A.md'));
}

// ---------------------------------------------------------------- 2. scan + key contract

function scanContract() {
  group('2. scan — the key contract');

  const d = repo({
    'docs/A.md': DOC('Doc A', 'Shared Heading'),
    'docs/sub/B.md': DOC('Doc B', 'Shared Heading'),
  });
  db(d, ['scan', 'docs/A.md', 'docs/sub/B.md']);
  const o = artifact(d, 'outline.json');

  ok('scan records every H2', o.records.length, 2);

  // The `<file> :: ` prefix is unconditional. It used to be dropped for a single-file scan,
  // so the same heading keyed differently depending on batch size and a labels.json silently
  // stopped matching after a rescan.
  okTrue('keys carry the <file> :: prefix',
    o.records.every(r => r.key.startsWith(`${r.file} :: `)));

  // Two docs sharing a heading must still key distinctly, or validate's uniqueness check
  // cannot tell them apart.
  ok('same heading in two files -> distinct keys', new Set(o.records.map(r => r.key)).size, 2);

  // A key truncated onto a trailing space is a key no model can echo back. This cost a
  // failed gate on a real run; keys are trimmed at the source.
  okTrue('no key has leading or trailing whitespace',
    o.records.every(r => r.key === r.key.trim()));

  // Single-file scan must produce the SAME key as the batch scan above.
  const d2 = repo({ 'docs/A.md': DOC('Doc A', 'Shared Heading') });
  db(d2, ['scan', 'docs/A.md']);
  ok('single-file scan keys identically to a batch scan',
    artifact(d2, 'outline.json').records[0].key,
    o.records.find(r => r.file === 'docs/A.md').key);
}

// ---------------------------------------------------------------- 3. slug collision

/**
 * The theme-slug collision shipped as silent data loss: `plan` reported two pages and wrote
 * one task file. The old suite "covered" this with a test that re-implemented the slug
 * function inline and checked THAT collided — proving the precondition exists while never
 * touching the code under test. This drives the real CLI and counts what lands on disk.
 */
function slugCollision() {
  group('3. slug collision — two themes must never become one page');

  const d = repo({ 'docs/A.md': `# A\n\n## One\n\nx\n\n## Two\n\ny\n` });
  db(d, ['scan', 'docs/A.md']);
  const o = artifact(d, 'outline.json');
  ok('two sections scanned', o.records.length, 2);

  // "A/B x" and "A-B x" slugify to the same string unless disambiguated.
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'A/B x', gloss: 'first' }, { name: 'A-B x', gloss: 'second' }],
    labels: [{ key: o.records[0].key, theme: 'A/B x' },
             { key: o.records[1].key, theme: 'A-B x' }] }) });

  const p = db(d, ['plan', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { OUT: 'docs/.docs-builder/tasks' });
  const tasks = fs.readdirSync(path.join(d, 'docs/.docs-builder/tasks'))
    .filter(f => f.endsWith('.json'));
  ok('two colliding theme names produce two task files, not one', tasks.length, 2);
  okTrue('plan did not crash on the collision', p.code === 0);

  const idx = db(d, ['index', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { OUT: 'docs/index.md' });
  okTrue('index also survives the collision', idx.code === 0);
}

// ---------------------------------------------------------------- 4. a doc move

/**
 * The recurring defect: a move breaks two kinds of path, and the repairs kept being added to
 * one caller and missed by the other. Both movers now go through moveDoc, so both of these
 * groups assert the SAME follow-ups. If a future follow-up is added to one path only, one of
 * these two groups goes red.
 */
const MOVE_FIXTURE = () => ({
  'docs/GUIDE.md': DOC('Guide'),
  'README.md': [
    '# Root',
    'link form:     [Guide](docs/GUIDE.md)',
    'backtick form: `docs/GUIDE.md`',
    'sentence end:  see docs/GUIDE.md.',
    '',
  ].join('\n'),
  'TRAPS.md': [
    'prefix:   xdocs/GUIDE.md',
    'dotslash: ./docs/GUIDE.md',
    'suffix:   docs/GUIDE.md.bak',
    'dash:     docs/GUIDE.md-old',
    '',
  ].join('\n'),
  'CHANGELOG.md': '- historical: docs/GUIDE.md was added here\n',
  'tool.js': "const required = ['docs/GUIDE.md'];\n",
});

function assertMoveRepairs(d, newPath, label) {
  ok(`${label}: outline.json files[] follows the move`,
    artifact(d, 'outline.json').files[0], newPath);
  okTrue(`${label}: outline.json keys follow the move`,
    artifact(d, 'outline.json').records.every(r => r.key.startsWith(`${newPath} :: `)));

  const readme = read(d, 'README.md');
  ok(`${label}: markdown link rewritten`, readme.includes(`[Guide](${newPath})`), true);
  ok(`${label}: backtick mention rewritten`, readme.includes(`\`${newPath}\``), true);
  ok(`${label}: sentence-final mention rewritten`, readme.includes(`see ${newPath}.`), true);
  ok(`${label}: no dead reference left in README`, readme.includes('docs/GUIDE.md'), false);
  ok(`${label}: non-markdown referrer rewritten`,
    read(d, 'tool.js').includes(newPath), true);

  const traps = read(d, 'TRAPS.md');
  okTrue(`${label}: prefix trap xdocs/ untouched`, traps.includes('xdocs/GUIDE.md'));
  okTrue(`${label}: ./docs/ trap untouched`, traps.includes('./docs/GUIDE.md'));
  okTrue(`${label}: .bak suffix trap untouched`, traps.includes('docs/GUIDE.md.bak'));
  okTrue(`${label}: -old suffix trap untouched`, traps.includes('docs/GUIDE.md-old'));

  okTrue(`${label}: CHANGELOG.md left alone (history, not a broken link)`,
    read(d, 'CHANGELOG.md').includes('docs/GUIDE.md was added'));
}

function moveViaArchive() {
  group('4. archive — the move repairs artifacts AND links');
  const d = repo(MOVE_FIXTURE());
  db(d, ['scan', 'docs/GUIDE.md']);
  const r = db(d, ['archive', 'docs/GUIDE.md']);

  ok('archive exits clean', r.code, 0);
  okTrue('original is gone from its old path', !exists(d, 'docs/GUIDE.md'));
  okTrue('original landed in docs/archive/', exists(d, 'docs/archive/GUIDE.md'));
  assertMoveRepairs(d, 'docs/archive/GUIDE.md', 'archive');

  okTrue('log.md records the archive', /archive \|/.test(read(d, 'docs/log.md')));
  // git mv, so history follows the file rather than showing an add+delete pair.
  git(d, ['add', '-A']); git(d, ['commit', '-qm', 'move']);
  okTrue('git recorded a rename, not add+delete',
    /R\d*\s+docs\/GUIDE\.md\s+docs\/archive\/GUIDE\.md/
      .test(git(d, ['show', '--name-status', '-M', '--format=', 'HEAD'])));
}

function moveViaApplyReorg() {
  group('5. apply-reorg — the same repairs, via the other caller');
  const d = repo(MOVE_FIXTURE());
  db(d, ['scan', 'docs/GUIDE.md']);
  db(d, ['discover']);
  const r = db(d, ['apply-reorg']);

  ok('apply-reorg exits clean', r.code, 0);
  okTrue('doc moved into docs/product/', exists(d, 'docs/product/GUIDE.md'));
  assertMoveRepairs(d, 'docs/product/GUIDE.md', 'apply-reorg');
  okTrue('summary reports the rewrites', /"linksRewritten": [1-9]/.test(r.out));
}

function moveFailureIsolation() {
  group('6. a failed follow-up must not look like a failed move');

  // A git that fails ONLY on ls-files: the move succeeds, the link repair cannot run.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'db-shim-'));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], GIT).trim();
  fs.writeFileSync(path.join(shim, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = "ls-files" ] && { echo "fatal: simulated" >&2; exit 1; }; done\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const d = repo({ 'docs/A.md': DOC('A'), 'docs/B.md': DOC('B'),
    'README.md': 'see docs/A.md and docs/B.md\n' });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg'], { PATH: `${shim}:${process.env.PATH}` });

  // die() calls process.exit, which no try/catch can intercept. Before the throwing-core
  // split, this killed the run after the FIRST file moved: the second never moved, no
  // summary, no log line.
  okTrue('every file still moved', exists(d, 'docs/product/A.md') && exists(d, 'docs/product/B.md'));
  okTrue('the failure was reported, not swallowed', /WARN/.test(r.out));
  okTrue('the file is reported as MOVED, not skipped', /"skipped": 0/.test(r.out));
  okTrue('the summary still printed', /"moved": 2/.test(r.out));
  okTrue('log.md was still written', exists(d, 'docs/log.md'));
}

// ---------------------------------------------------------------- 7. discover / protected

function discoverBuckets() {
  group('7. discover — classification and the never-move list');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
    'docs/lower.md': '# Lower\n\nthis doc supersedes nothing and is closed in spirit\n\n## S\n\nx\n',
    // FROZEN means locked-and-current in this corpus's convention, not retired — dropped
    // from the archive status words after 10/12 false archives on bareloop's real corpus.
    'docs/FROZEN.md': '# Frozen\n\n**Status: FROZEN** — build follows this record.\n\n## S\n\nx\n',
    'docs/REPORT_old.md': DOC('Report'),
    'docs/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
    // Protected at depth — the never-move list is enforced in code, not just documented.
    'docs/README.md': DOC('Readme'),
    'docs/deep/CLAUDE.md': DOC('Claude'),
    'docs/deep/CHANGELOG.md': DOC('Changelog'),
    // Must never be walked into at all.
    'docs/node_modules/pkg/DOC.md': DOC('Vendor'),
    'docs/.hidden/SECRET.md': DOC('Secret'),
    // A live mkdocs snippet-include pointer (uv's docs/reference/contributing.md, real-world
    // miss) — no H1, but its only content is an include directive, not an unknown doc.
    'docs/reference/contributing.md': '--8<-- "CONTRIBUTING.md"\n',
    // Negative control: no H1, but genuine unclassifiable prose — must stay `review`.
    'docs/reference/mystery.md': 'just some prose with no heading and no include directive.\n',
  });
  const r = db(d, ['discover']);
  ok('discover exits clean', r.code, 0);
  const rows = JSON.parse(fs.readFileSync(
    path.join(d, 'docs/.docs-builder/reorg-plan.json'), 'utf8')).rows;
  const bucket = f => (rows.find(x => x.file === f) || {}).bucket || 'ABSENT';

  ok('a clean current doc is product', bucket('docs/CLEAN.md'), 'product');
  ok('a SHOUTED status word is archive', bucket('docs/CLOSED.md'), 'archive');
  // Case-sensitivity is deliberate: lowercase "closed"/"supersedes" in prose false-positived
  // three ways on a real corpus, so only the ALL-CAPS self-declaration counts.
  ok('lowercase status prose is NOT archived', bucket('docs/lower.md'), 'product');
  ok('FROZEN (locked-and-live, not retired) is NOT archived', bucket('docs/FROZEN.md'), 'product');
  ok('an archive-shaped filename is archive', bucket('docs/REPORT_old.md'), 'archive');
  ok('an over-ceiling doc is oversized', bucket('docs/BIG.md'), 'oversized');
  ok('a no-H1 mkdocs include stub is product, not review',
    bucket('docs/reference/contributing.md'), 'product');
  ok('a no-H1 file with real unclassifiable prose stays review',
    bucket('docs/reference/mystery.md'), 'review');

  ok('README.md is never listed', bucket('docs/README.md'), 'ABSENT');
  ok('CLAUDE.md is never listed, at any depth', bucket('docs/deep/CLAUDE.md'), 'ABSENT');
  ok('CHANGELOG.md is never listed, at any depth', bucket('docs/deep/CHANGELOG.md'), 'ABSENT');
  ok('node_modules/ is never walked', bucket('docs/node_modules/pkg/DOC.md'), 'ABSENT');
  ok('dot-dirs are never walked', bucket('docs/.hidden/SECRET.md'), 'ABSENT');

  const applied = db(d, ['apply-reorg']);
  okTrue('protected files stayed put after apply-reorg',
    exists(d, 'docs/README.md') && exists(d, 'docs/deep/CLAUDE.md'));
  okTrue('an oversized doc is never auto-split or moved', exists(d, 'docs/BIG.md'));
  // v3: apply-reorg always writes the index itself (no more hint-only path) — even with an
  // oversized doc left in place, since that doc still gets an in-place row under ## Product.
  okTrue('the oversized-in-place doc still ends up indexed under ## Product',
    read(d, 'docs/index.md').includes('[Big]'));
}

function reorgCollision() {
  group('8. apply-reorg — a collision must not stop the run');

  const d = repo({
    'docs/a/SAME.md': DOC('One'),
    'docs/b/SAME.md': DOC('Two'),
    'docs/OK.md': DOC('Ok'),
    'docs/product/TAKEN.md': 'pre-existing, must not be overwritten\n',
    'docs/TAKEN.md': DOC('Taken'),
  });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg']);

  okTrue('same-basename collision is disambiguated, both survive',
    exists(d, 'docs/product/SAME.md') && exists(d, 'docs/product/SAME-2.md'));
  okTrue('a destination that already exists is skipped', /"skipped": 1/.test(r.out));
  ok('the pre-existing file was not overwritten',
    read(d, 'docs/product/TAKEN.md'), 'pre-existing, must not be overwritten\n');
  okTrue('unrelated files still moved', exists(d, 'docs/product/OK.md'));
  // v3: apply-reorg no longer just hints at index-flat — it runs it itself.
  okTrue('apply-reorg writes docs/index.md itself when nothing is oversized',
    exists(d, 'docs/index.md'));
}

// ---------------------------------------------------------------- 9. ledger / due

function ledgerAndDue() {
  group('9. ledger + due — git is the diff engine');

  const files = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) files[`docs/${n}.md`] = DOC(n);
  const d = repo(files);
  ok('ledger stamps clean', db(d, ['ledger']).code, 0);
  // Real wording: `docs unchanged since <sha>. NOT due.` — the sha varies per run.
  ok('nothing changed yet -> no drift', /docs unchanged since \w+\. NOT due\./
    .test(db(d, ['due']).out), true);

  write(d, { 'docs/NEW.md': DOC('New') });
  git(d, ['add', '-A']);
  git(d, ['mv', 'docs/A.md', 'docs/A2.md']);
  write(d, { 'docs/B.md': DOC('B', 'Section One', 'edited body\n'.repeat(20)) });
  git(d, ['rm', '-q', 'docs/C.md']);
  git(d, ['mv', 'docs/D.md', 'docs/D2.md']);
  write(d, { 'docs/D2.md': DOC('D', 'Section One', 'also edited\n'.repeat(20)) });
  git(d, ['add', '-A']); git(d, ['commit', '-qm', 'churn']);

  const out = db(d, ['due']).out;
  for (const kind of ['new', 'moved', 'changed', 'deleted']) {
    okTrue(`due classifies ${kind}`, out.includes(kind));
  }
  // The git rename form `docs/{a.md => b.md}` does not end in .md; an endsWith filter once
  // dropped every move from this report.
  okTrue('due did not lose renames to an endsWith filter', /A2\.md|=>/.test(out));
  okTrue('due nudges at the threshold', /REORG IS DUE|reorg/i.test(out));
}

/**
 * v3 explicitly keeps `due` working standalone with its output UNCHANGED — `/remember` step 7
 * shells out to it directly and step 5 (updating that call site) has not landed yet, so this
 * pins the exact three messages `due` can print, plus the standing claim that deletions alone
 * (not just edits) advance the count `rows.length` uses for the threshold check.
 */
function dueOutputContract() {
  group('9b. due — standalone output contract (no ledger / below / at threshold)');

  // No ledger yet.
  const fresh = repo({ 'docs/A.md': DOC('A') });
  const noLedger = db(fresh, ['due']);
  ok('no-ledger run exits clean', noLedger.code, 0);
  okTrue('no-ledger message is pinned exactly',
    noLedger.out.includes('no ledger yet — run `docs-builder.cjs ledger` to start tracking. NOT due.'));

  // (e) deletions alone advance the due count — 5 deleted archive docs => DUE, at the exact
  // DUE_THRESHOLD=5 boundary, with nothing edited or added.
  const files = {};
  for (let i = 0; i < 6; i++) files[`docs/archive/F${i}.md`] = DOC(`F${i}`);
  const d = repo(files);
  db(d, ['ledger']);

  // Below threshold: delete 3 of 6, nothing else changed.
  for (let i = 0; i < 3; i++) git(d, ['rm', '-q', `docs/archive/F${i}.md`]);
  git(d, ['commit', '-qm', 'delete 3']);
  const below = db(d, ['due']);
  ok('below-threshold run exits clean', below.code, 0);
  okTrue('below-threshold message is pinned exactly (3 deletions, threshold 5)',
    /^3 doc\(s\) changed since \w+ \(threshold 5\)\. Not due yet\.$/m.test(below.out));
  okTrue('all 3 deletions are classified as `deleted`, not silently dropped',
    (below.out.match(/deleted/g) || []).length >= 3);

  // At threshold: delete 2 more (5 of 6 total) — no edits, no adds, deletions alone reach it.
  for (let i = 3; i < 5; i++) git(d, ['rm', '-q', `docs/archive/F${i}.md`]);
  git(d, ['commit', '-qm', 'delete 2 more']);
  const atThreshold = db(d, ['due']);
  ok('at-threshold run exits clean', atThreshold.code, 0);
  okTrue('at-threshold message is pinned exactly (5 deletions, threshold 5) — REORG IS DUE',
    /^5 docs changed since \w+ \(threshold 5\) — REORG IS DUE\.$/m.test(atThreshold.out));
}

// ---------------------------------------------------------------- 10. search

/** An entire subcommand with zero coverage until now. */
function search() {
  group('10. search — BM25 over the scanned sections');

  const d = repo({
    'docs/A.md': '# A\n\n## Widgets\n\nwidget widget widget assembly\n\n## Sprockets\n\nsprocket tooling\n',
  });
  db(d, ['scan', 'docs/A.md']);
  const r = db(d, ['search', 'docs/.docs-builder/outline.json', 'widget']);
  ok('search exits clean', r.code, 0);
  okTrue('the matching section ranks', /Widgets/.test(r.out));

  // A source file that vanished after the scan must warn, not crash the ranker.
  fs.unlinkSync(path.join(d, 'docs/A.md'));
  const gone = db(d, ['search', 'docs/.docs-builder/outline.json', 'widget']);
  okTrue('a missing source file does not crash search',
    gone.code === 0 && !/at Object\.<anonymous>/.test(gone.out));
}

// ---------------------------------------------------------------- 11. reorg

/**
 * v3 folds `reconcile` and `due` into one front door: `reorg` runs discover -> apply-reorg
 * (which already scans the WHOLE corpus and writes docs/index.md itself) -> lint, in one
 * invocation — "first run" and "since last time" are the same job with different starting
 * state. `due` stays individually runnable and unchanged (see reorgDueUnaffected below); reorg
 * only calls it in-process, additively, when a ledger stamp already exists.
 */
function reorgCmd() {
  group('11. reorg — the single front door (discover + apply-reorg + lint [+ due])');

  // (b) a fresh corpus, no ledger stamp: one invocation does discover + apply-reorg + lint,
  // and ends with both a moved corpus AND an index.md on disk.
  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
  });
  const r = db(d, ['reorg']);
  ok('reorg exits clean', r.code, 0);
  okTrue('it discovers', /== discover ==/.test(r.out));
  okTrue('it applies the reorg', /== apply-reorg ==/.test(r.out));
  okTrue('it lints', /== lint ==/.test(r.out));
  okTrue('the corpus actually moved (product/)', exists(d, 'docs/product/CLEAN.md'));
  okTrue('the corpus actually moved (archive/)', exists(d, 'docs/archive/CLOSED.md'));
  okTrue('docs/index.md was written in the same invocation', exists(d, 'docs/index.md'));
  okTrue('lint.json was written', exists(d, 'docs/.docs-builder/lint.json'));
  okTrue('log.md records the reorg', /reorg \|/.test(read(d, 'docs/log.md')));
  okTrue('no ledger yet -> no drift summary is fabricated',
    !/== due/.test(r.out));

  // (c) a corpus WITH a ledger stamp: reorg additionally reports the due-style drift summary.
  const d2 = repo({ 'docs/CLEAN.md': DOC('Clean') });
  db(d2, ['ledger']);
  write(d2, { 'docs/NEW.md': DOC('New') });
  git(d2, ['add', '-A']);
  git(d2, ['commit', '-qm', 'add NEW']);
  const r2 = db(d2, ['reorg']);
  ok('reorg with a ledger stamp still exits clean', r2.code, 0);
  okTrue('it additionally reports the drift summary', /== due/.test(r2.out));
  okTrue('the drift summary classifies the real change', /\bnew\b/.test(r2.out));
}

/** reorg composes discover+apply-reorg+lint+due, each of which honours OUT for its OWN
 *  artifact — same OUT-clobbering trap the old `reconcile` guard existed to catch, now on
 *  reorg's own composition. */
function reorgOutIgnored() {
  group('18. reorg — OUT is a per-step override; reorg is not a step');

  const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
  const outFile = path.join(os.tmpdir(), `db-reorg-out-${process.pid}.json`);
  const r = db(d, ['reorg'], { OUT: outFile });
  ok('reorg exits clean', r.code, 0);
  okTrue('reorg WARNs that OUT is ignored', r.out.includes(`ignoring OUT=${outFile}`));
  okTrue('reorg-plan.json still lands at the default artifacts path',
    exists(d, 'docs/.docs-builder/reorg-plan.json'));
  okTrue('docs/index.md still lands at the default path', exists(d, 'docs/index.md'));
  okTrue('OUT\'s own path was never written to', !fs.existsSync(outFile));
}

/** Repeated `reorg` runs must be stable: docs/index.md and docs/log.md are the pipeline's OWN
 *  generated output, and discover's PROTECTED_NAMES already keeps them out of the corpus it
 *  classifies — but that has to hold up across MULTIPLE reorg runs, not just the first one,
 *  or the outline grows a phantom record every time reorg is re-run (the exact defect the old
 *  `reconcile` shipped once, fixed here at the front door that replaces it). */
function reorgCorpusStability() {
  group('16. reorg — repeated runs must not scan their own generated output');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/index.md': '## [theme](wiki/x.md)\n\nsome row\n',
    'docs/log.md': '## 2026-01-01 archive | prior op\n\nsome body\n',
  });

  const counts = [];
  for (let i = 0; i < 3; i++) {
    const r = db(d, ['reorg']);
    ok(`reorg run ${i + 1} exits clean`, r.code, 0);
    counts.push(artifact(d, 'outline.json').records.length);
  }
  ok('outline record count identical after run 1 vs run 2', counts[0], counts[1]);
  ok('outline record count identical after run 2 vs run 3', counts[1], counts[2]);
  okTrue('docs/index.md is excluded from its own corpus',
    !artifact(d, 'outline.json').files.includes('docs/index.md'));
  okTrue('docs/log.md is excluded from its own corpus',
    !artifact(d, 'outline.json').files.includes('docs/log.md'));
}

// ---------------------------------------------------------------- 12. archive-cleanup is gone

/**
 * `archive-cleanup` was removed outright — the only destructive command in the pipeline, and
 * pruning is just `git rm`, the user's own call (docs-builder-v3-spec.md, "Cut"). Pinned two
 * ways: invoking it fails like any other unknown subcommand, and the string itself is gone
 * from the script, so it cannot be reintroduced by accident (e.g. a stray dispatch case that
 * forgot to also drop the help text).
 */
function archiveCleanupRemoved() {
  group('12. archive-cleanup — removed entirely');

  const d = repo({ 'docs/archive/OLD.md': DOC('Old') });
  const r = db(d, ['archive-cleanup']);
  ok('archive-cleanup is an unknown subcommand now', r.code, 1);
  okTrue('the failure is the ordinary usage error, not a crash',
    /usage: docs-builder\.cjs/.test(r.out));
  okTrue('nothing under docs/archive/ was touched', exists(d, 'docs/archive/OLD.md'));

  const src = fs.readFileSync(DB, 'utf8');
  okTrue('the string "archive-cleanup" does not appear anywhere in the script',
    !src.includes('archive-cleanup'));
}

// ---------------------------------------------------------------- 14. chokepoint fixes

/**
 * Two functions used to do work AND call `process.exit` (directly or via `die()`), which is
 * fatal once an in-process caller invokes them: `process.exit` cannot be caught by a
 * `try/catch`. This group pins the fix: a throwing/returning core (`doValidate`) plus a thin
 * CLI wrapper (`validate`), the same split this file already used for `doArchive`/`archive`
 * and `gitOrThrow`/`git`.
 */
function validateArchiveChokepoints() {
  group('14. validate / archive — the exit-mid-pipeline chokepoint');

  // archive: exit 2 (not 1) when the move succeeded but a follow-up failed — 1 means "nothing
  // moved, retry"; re-running `archive` after a successful move would be actively wrong.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'db-shim2-'));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], GIT).trim();
  fs.writeFileSync(path.join(shim, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = "ls-files" ] && { echo "fatal: simulated" >&2; exit 1; }; done\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  const d4 = repo({ 'docs/A.md': DOC('A') });
  const arch = db(d4, ['archive', 'docs/A.md'], { PATH: `${shim}:${process.env.PATH}` });
  ok('archive exits 2 when the move succeeded but a follow-up failed', arch.code, 2);
  okTrue('the file DID move despite exit 2', exists(d4, 'docs/archive/A.md'));

  const d5 = repo({});
  fs.mkdirSync(path.join(d5, 'docs'), { recursive: true });
  const archFail = db(d5, ['archive', 'docs/NOPE.md']);
  ok('archive still exits 1 when the move itself fails (nothing moved)', archFail.code, 1);

  // A malformed task-*.json (what a crashed page-writer leaves behind) must isolate to its
  // own page: the OTHER page still gets checked, and validate.json still gets written.
  const d6 = repo({ 'docs/A.md': DOC('A') });
  fs.mkdirSync(path.join(d6, 'docs/wiki'), { recursive: true });
  fs.mkdirSync(path.join(d6, 'docs/.docs-builder/tasks'), { recursive: true });
  db(d6, ['scan', 'docs/A.md']);
  const rec6 = artifact(d6, 'outline.json').records[0];
  write(d6, {
    'docs/wiki/good.md': `# Good\n\nbody (docs/A.md:${rec6.s}-${rec6.e})\n`,
    'docs/wiki/bad.md': '# Bad\n\nno citations here\n',
    'docs/.docs-builder/tasks/task-good.json': JSON.stringify({
      sections: [{ file: 'docs/A.md', h2: rec6.h2, s: rec6.s, e: rec6.e }] }),
    'docs/.docs-builder/tasks/task-bad.json': '{ not valid json',
    'docs/.docs-builder/labels.json': JSON.stringify({
      themes: [{ name: 't', gloss: 'g' }], labels: [{ key: rec6.key, theme: 't' }] }),
  });
  db(d6, ['validate', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  const validateJson = read(d6, 'docs/.docs-builder/validate.json');
  okTrue('a malformed task file is recorded as a gate failure, not silently skipped',
    /"page": "bad\.md"/.test(validateJson));
  okTrue('the OTHER page was still checked and reports no violation of its own',
    !/"page": "good\.md"/.test(validateJson));
  okTrue('validate.json is still written despite the malformed file', exists(d6, 'docs/.docs-builder/validate.json'));

  // rewriteLinks: a known, deliberate trade-off, pinned so it stays deliberate rather than
  // accidental. Exact-path match rewrites a historical prose mention too — only CHANGELOG.md
  // and log.md, at any depth, are exempt.
  const d7 = repo({
    'docs/OLD.md': DOC('Old'),
    'NOTE.md': 'this used to live at docs/OLD.md, moved recently\n',
    'CHANGELOG.md': '- docs/OLD.md added\n',
    'log.md': '## note: docs/OLD.md was here\n',
    'sub/CHANGELOG.md': '- also mentions docs/OLD.md, nested\n',
  });
  const r7 = db(d7, ['archive', 'docs/OLD.md']);
  ok('archive of OLD.md exits clean', r7.code, 0);
  okTrue('a historical prose mention in an ordinary file IS rewritten (documented trade-off)',
    read(d7, 'NOTE.md').includes('docs/archive/OLD.md') && !read(d7, 'NOTE.md').includes(' docs/OLD.md'));
  okTrue('CHANGELOG.md at the root is NEVER rewritten', read(d7, 'CHANGELOG.md').includes('docs/OLD.md'));
  okTrue('log.md at the root is NEVER rewritten', read(d7, 'log.md').includes('docs/OLD.md'));
  okTrue('a CHANGELOG.md at ANY depth is also never rewritten', read(d7, 'sub/CHANGELOG.md').includes('docs/OLD.md'));
}

// ---------------------------------------------------------------- 15. move chokepoint fixes

/**
 * checkCitations() used to hardcode `docs/.docs-builder/tasks` while `plan` honoured a
 * custom OUT= for the same directory — so a `plan` run against a non-default tasks dir left
 * checkCitations silently checking whatever stale content happened to still be sitting at
 * the default path. TASKS is checkCitations' own reader-side var (mirroring INDEX/OUT for
 * index.md/checkLinks) — deliberately NOT the same var as `plan`'s OUT, because doValidate
 * already reads OUT for its own `write(res, 'validate.json')`; reusing OUT here would make
 * one `validate` invocation fight itself over what OUT means (MEASURED: `write()` crashes
 * with EISDIR the moment OUT points at an existing directory).
 */
function tasksDirChokepoint() {
  group('15a. checkCitations reads the SAME tasks dir plan wrote to, not a stale default');

  const d = repo({ 'docs/A.md': DOC('A', 'Sec', 'line body text') });
  db(d, ['scan', 'docs/A.md']);
  const key = artifact(d, 'outline.json').records[0].key;
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }], labels: [{ key, theme: 't' }] }) });

  // The REAL task file, written by `plan` into a non-default OUT dir.
  const p = db(d, ['plan', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { OUT: 'real-tasks' });
  okTrue('plan wrote the real task file to the custom OUT dir', exists(d, 'real-tasks/task-t.json'));
  okTrue('plan exits clean', p.code === 0);

  // A STALE task file at the default path, simulating a leftover from an earlier run, with
  // a permissive range the real task does NOT grant.
  write(d, { 'docs/.docs-builder/tasks/task-t.json': JSON.stringify({
    sections: [{ file: 'docs/A.md', h2: 'Sec', s: 1, e: 2 }] }) });
  write(d, { 'docs/wiki/t.md': '# T\n\nbody (docs/A.md:1-2)\n' });

  const r = db(d, ['validate', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { TASKS: 'real-tasks' });
  ok('validate FAILs against the real (TASKS-pointed) task, not the stale default one',
    r.code, 1);
  okTrue('the citation violation names the real task\'s allowed range',
    /outside allowed ranges/.test(r.out));
}

/**
 * Mode 1 (split one oversized doc) ends with the model writing wiki pages and a human
 * running `archive` on the original — six script calls plus two model steps, hand-sequenced.
 * If the model finishes the pages but `archive` never runs, the source doc and its derived
 * pages both exist — "duplication, not cleanup" per the doc's own words — and nothing said
 * so. Detection is derived entirely from existing artifacts (outline.json + labels.json +
 * the same slug/pageStatus logic `plan` already uses to report "done"), never a new state
 * file: it is a WARNING surfaced by `plan`, and never changes its exit code.
 */
function halfFinishedSplitDetection() {
  group('15c. a half-finished split (pages written, archive never run) is flagged');

  const d = repo({ 'docs/A.md': DOC('A', 'Sec', 'line body text') });
  db(d, ['scan', 'docs/A.md']);
  const key = artifact(d, 'outline.json').records[0].key;
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }], labels: [{ key, theme: 't' }] }) });

  // A finished page (frontmatter + enough lines to count as `done`) exists at docs/wiki/t.md,
  // but `archive` was never run: docs/A.md still sits at its original, non-archive path.
  const donePage = ['---', 'type: reference', 'title: t', '---', '', '# T', '',
    'one', 'two', 'three', 'four', 'five', ''].join('\n');
  write(d, { 'docs/wiki/t.md': donePage });

  const p = db(d, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  okTrue('plan warns about the half-finished split, naming the source file',
    /docs\/A\.md/.test(p.out) && /archive/.test(p.out));
  ok('the warning does not change plan\'s exit code', p.code, 0);

  // Once `archive` actually runs, the warning must go away — it is derived from current
  // artifact state, not a stateful flag that could go stale.
  db(d, ['archive', 'docs/A.md']);
  const p2 = db(d, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  okTrue('the warning clears once archive actually runs',
    !/half-finished/i.test(p2.out));
}

// ---------------------------------------------------------------- 16-20. move-chokepoint review fixes
//
// (Groups 16 and 18, formerly reconcile's own corpus-stability and OUT-ignore tests, moved
// above to reorgCorpusStability/reorgOutIgnored — reorg has the same OUT-clobbering trap and
// the same self-scan risk reconcile did, so both got a same-numbered replacement rather than a
// silent drop. Group 17 (reconcile's PAGES-honouring in its own exclusion filter) is NOT
// replaced here: reorg has no exclusion filter of its own to test — its corpus comes entirely
// from wholeCorpusFiles(), which already honours PAGES and is already covered by
// applyReorgScanRespectsPages (24b) below, since reorg calls that same apply-reorg in-process.)

/**
 * `archive` is documented as usable STANDALONE, and doArchive already falls back to
 * copy+unlink outside a git repo — but rewriteLinks called gitOrThrow(['ls-files'])
 * unconditionally, so a fully successful standalone archive printed "the move above
 * SUCCEEDED ... But rewriting inbound links failed: fatal: not a git repository" and exited
 * 2, telling the user to hand-fix something that had never broken. Fixed by catching only
 * "not a git repository" as a SKIP; any other git failure must still surface.
 */
function archiveStandaloneFollowup() {
  group('19. archive — a standalone (non-git) follow-up is a SKIP, never a failure');

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'db-archive-nogit-'));
  fs.mkdirSync(path.join(bare, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'docs/A.md'), DOC('A'));
  const r = db(bare, ['archive', 'docs/A.md']);
  ok('archive exits 0 outside a git repo', r.code, 0);
  okTrue('the file actually moved', exists(bare, 'docs/archive/A.md') && !exists(bare, 'docs/A.md'));
  okTrue('output says nothing is tracked to rewrite',
    r.out.includes('not a git repository — nothing tracked to rewrite'));
  okTrue('the run is never told a follow-up FAILED',
    !r.out.includes('rewriting inbound links failed'));

  // A REAL git failure inside a REAL repo must still surface — the fix narrows the catch to
  // "not a git repository" only; it must not have turned every git error into a silent skip.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'db-archive-realfail-'));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], GIT).trim();
  fs.writeFileSync(path.join(shim, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = "ls-files" ] && { echo "fatal: simulated" >&2; exit 1; }; done\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  const d2 = repo({ 'docs/B.md': DOC('B') });
  const r2 = db(d2, ['archive', 'docs/B.md'], { PATH: `${shim}:${process.env.PATH}` });
  ok('a real (non-"not a git repository") git failure still exits 2', r2.code, 2);
  okTrue('the file still moved despite the follow-up failure', exists(d2, 'docs/archive/B.md'));

  // process.exit(2) used to fire BEFORE logOp — the one case a human most needs to find later
  // (a move that succeeded with a failed follow-up) left no line in docs/log.md at all.
  const logExists = exists(d2, 'docs/log.md');
  okTrue('log.md exists despite the exit-2 follow-up failure', logExists);
  const logContent = logExists ? read(d2, 'docs/log.md') : '';
  okTrue('log.md records the archive line for the failed follow-up too',
    /archive \|/.test(logContent));
  okTrue('log.md records the follow-up failure itself, not just a clean move',
    /FOLLOW-UP FAILED/.test(logContent));
}

/** `index` used to write a `[theme](wiki/<slug>.md)` link for EVERY theme in labels.json,
 *  whether or not that page had actually been written — so a fresh reconcile (scan -> validate
 *  -> index -> lint) on a repo whose pages hadn't been written yet produced an index.md full
 *  of dead links, and the NEXT validate FAILed on links the tool itself manufactured. Fixed:
 *  a theme with no page on disk still gets a row (completeness guarantee), but as plain text
 *  with a pending marker, never a hyperlink to a file that isn't there. */
function indexPendingUnwrittenPages() {
  group('21. index — an unwritten page is listed, never linked');

  const d = repo({ 'docs/A.md': `# A\n\nintro\n\n## One\n\nx\n\n## Two\n\ny\n` });
  db(d, ['scan', 'docs/A.md']);
  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'alpha', gloss: '' }, { name: 'beta', gloss: '' }],
    labels: [{ key: o.records[0].key, theme: 'alpha' },
             { key: o.records[1].key, theme: 'beta' }] }) });
  // Only beta's page is actually written.
  write(d, { 'docs/wiki/beta.md': '---\ntitle: Beta\n---\n\nwritten content here.\n' });

  const idx = db(d, ['index', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { OUT: 'docs/index.md' });
  ok('index exits clean', idx.code, 0);
  okTrue('index reports how many themes are pending',
    /1 of 2 theme\(s\) have no page yet/.test(idx.out));
  okTrue('index points to `plan` for which pages are pending', /plan/.test(idx.out));

  const md = read(d, 'docs/index.md');
  okTrue('the unwritten theme is present but NOT a resolvable wiki link',
    /## alpha/.test(md) && !/\[alpha\]\(wiki\/alpha\.md\)/.test(md));
  okTrue('the unwritten row carries a visible pending marker', /alpha.*pending/i.test(md));
  okTrue('the written theme still gets a normal link', /\[beta\]\(wiki\/beta\.md\)/.test(md));
  okTrue('the trailer distinguishes pending from written',
    /Total: \d+ rows across 2 pages \(1 pending\)/.test(md));

  const val = db(d, ['validate', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  okTrue('validate no longer reports a bad link for the unwritten page',
    /"badLinks": 0/.test(val.out));
  okTrue('validate\'s links.bad is empty', /"bad": \[\]/.test(val.out));

  // PAGES= must be honoured by BOTH the existence check AND the emitted link text, not a
  // hardcoded docs/wiki. Regression: index's existence check honoured PAGES but the link text
  // it wrote stayed hardcoded to `wiki/<slug>.md`, so with PAGES=docs/pages the emitted link
  // pointed at a file that was never there — validate then FAILed on a link `index` itself
  // wrote, for a page that genuinely existed under the real (custom) PAGES dir.
  const d2 = repo({ 'docs/A.md': `# A\n\nintro\n\n## One\n\nx\n` });
  db(d2, ['scan', 'docs/A.md']);
  const o2 = artifact(d2, 'outline.json');
  write(d2, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'gamma', gloss: '' }],
    labels: [{ key: o2.records[0].key, theme: 'gamma' }] }) });
  write(d2, { 'docs/custom-pages/gamma.md': '---\ntitle: Gamma\n---\n\nwritten.\n' });
  const idx2 = db(d2, ['index', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { OUT: 'docs/index.md', PAGES: 'docs/custom-pages' });
  ok('index (custom PAGES) exits clean', idx2.code, 0);
  const md2 = read(d2, 'docs/index.md');
  okTrue('PAGES= is honoured: no pending marker when the custom-dir page exists',
    !/pending/i.test(md2));
  okTrue('PAGES= is honoured: the emitted link is NOT the hardcoded wiki/ path',
    !/\[gamma\]\(wiki\/gamma\.md\)/.test(md2));
  // The link is read from inside index.md, so it must resolve relative to index.md's own
  // directory (docs/), not the repo root — assert on the actual filesystem target, not on one
  // hardcoded string, so this doesn't just trade one hardcoded expectation for another.
  const linkMatch = md2.match(/## \[gamma\]\(([^)]+)\)/);
  okTrue('PAGES= is honoured: a link was emitted at all for the written page', !!linkMatch);
  if (linkMatch) okTrue('PAGES= is honoured: that link resolves to the real page on disk',
    fs.existsSync(path.join(d2, 'docs', linkMatch[1])));

  const val2 = db(d2, ['validate', 'docs/.docs-builder/outline.json',
    'docs/.docs-builder/labels.json'], { PAGES: 'docs/custom-pages' });
  okTrue('validate reports zero bad links with a custom PAGES dir',
    /"badLinks": 0/.test(val2.out));
}

/** v3: `index-flat` covers the WHOLE corpus, not just docs/product/ — one `docs/index.md`,
 *  sectioned `## Product` (product/ + PAGES pages + anything left in place, e.g. an oversized
 *  doc apply-reorg deliberately didn't move) and `## Archive` (archive/). `search` reads
 *  outline.json, never index.md, so this is the one map — no second index file. */
function indexFlatCmd() {
  group('22. index-flat — one whole-corpus, sectioned index, no labels needed');

  const d = repo({
    'docs/product/A.md': DOC('A'),
    'docs/product/B.md': DOC('B'),
    'docs/product/nested/C.md': DOC('C'),
    'docs/archive/D.md': DOC('D'),
    'docs/wiki/E.md': DOC('E'),
    // An oversized doc apply-reorg deliberately leaves at its original, in-place path.
    'docs/00-context/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
  });
  const r = db(d, ['index-flat'], { OUT: 'docs/index.md' });
  ok('index-flat exits clean', r.code, 0);

  const md = read(d, 'docs/index.md');
  okTrue('index.md has a ## Product section', /## Product/.test(md));
  okTrue('index.md has a ## Archive section', /## Archive/.test(md));

  const sections = md.split(/^## /m);
  const productSection = sections.find(s => s.startsWith('Product')) || '';
  const archiveSection = sections.find(s => s.startsWith('Archive')) || '';

  for (const title of ['A', 'B', 'C', 'E', 'Big']) {
    okTrue(`${title} appears under ## Product`, productSection.includes(`[${title}]`));
  }
  okTrue('the oversized in-place doc is indexed at its ORIGINAL path, not moved',
    /\[Big\]\(00-context\/BIG\.md\)/.test(productSection));
  okTrue('D appears under ## Archive', archiveSection.includes('[D]'));
  okTrue('D does NOT also appear under ## Product', !productSection.includes('[D]'));

  for (const title of ['A', 'B', 'C', 'D', 'E']) {
    const m = md.match(new RegExp(`\\[${title}\\]\\(([^)]+)\\)`));
    okTrue(`row for ${title} has a link`, !!m);
    if (m) okTrue(`row for ${title}'s link resolves on disk`,
      fs.existsSync(path.join(d, 'docs', m[1])));
  }

  // Nothing at all — no product/, no archive/, no stray docs.
  const empty = repo({ 'README.md': 'nothing docs-shaped here\n' });
  const r2 = db(empty, ['index-flat'], { OUT: 'docs/index.md' });
  ok('empty corpus exits clean', r2.code, 0);
  okTrue('empty corpus gives a clear message', /nothing to index/.test(r2.out));
  okTrue('no index.md is written for an empty corpus', !exists(empty, 'docs/index.md'));
}

/** Regression test that matters most: every link index-flat writes must resolve to a real
 *  file on disk, for every section, walked and stat'd — not spot-checked. */
function indexFlatLinksResolve() {
  group('22b. index-flat — every link resolves (walked and stat\'d, not spot-checked)');

  const d = repo({
    'docs/product/A.md': DOC('A'),
    'docs/product/nested/deep/B.md': DOC('B'),
    'docs/archive/C.md': DOC('C'),
    'docs/archive/old/D.md': DOC('D'),
    'docs/wiki/E.md': DOC('E'),
    'docs/00-context/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
  });
  const r = db(d, ['index-flat'], { OUT: 'docs/sub/index.md' });
  ok('index-flat exits clean', r.code, 0);

  const md = read(d, 'docs/sub/index.md');
  const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  okTrue('at least one link was found', links.length >= 6);
  let deadLinks = 0;
  for (const link of links) {
    const target = path.join(d, 'docs/sub', link);
    if (!fs.existsSync(target)) { deadLinks++; console.log(`    dead link: ${link}`); }
  }
  ok('zero dead links across every row', deadLinks, 0);
}

/** Archive growth flag: WARN above the threshold, silent below it — console only, and in
 *  both cases nothing is deleted or altered. */
function indexArchiveWarnFlag() {
  group('22c. index-flat — archive growth WARN, never prunes');

  const below = {};
  for (let i = 0; i < 5; i++) below[`docs/archive/F${i}.md`] = DOC(`F${i}`);
  const dBelow = repo(below);
  const rBelow = db(dBelow, ['index-flat'], { OUT: 'docs/index.md' });
  ok('below-threshold run exits clean', rBelow.code, 0);
  okTrue('no WARN below the threshold', !/WARN: archive\//.test(rBelow.out));
  ok('all 5 archive files still on disk',
    fs.readdirSync(path.join(dBelow, 'docs/archive')).length, 5);

  const above = {};
  for (let i = 0; i < 101; i++) above[`docs/archive/F${i}.md`] = DOC(`F${i}`);
  const dAbove = repo(above);
  const rAbove = db(dAbove, ['index-flat'], { OUT: 'docs/index.md' });
  ok('above-threshold run exits clean', rAbove.code, 0);
  okTrue('WARN fires above the threshold', /WARN: archive\/ is 101 rows and growing/.test(rAbove.out));
  okTrue('WARN never claims to prune', !/prun(e|ing|ed)\b.*archive/i.test(rAbove.out.replace(/nothing prunes it automatically\.?/g, '')));
  ok('all 101 archive files still on disk',
    fs.readdirSync(path.join(dAbove, 'docs/archive')).length, 101);
  const archiveSection = (read(dAbove, 'docs/index.md').split(/^## /m).find(s => s.startsWith('Archive')) || '');
  ok('the ## Archive section itself still lists all 101 rows, uncollapsed',
    (archiveSection.match(/^- \[/gm) || []).length, 101);
}

/** `apply-reorg` calls index-flat itself right after its whole-corpus scan, so a reorg-only
 *  corpus ends up with a docs/index.md without a second command ever being run. */
function applyReorgAutoIndexes() {
  group('22d. apply-reorg — writes docs/index.md itself, no second command');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
  });
  db(d, ['discover']);
  okTrue('no index.md before apply-reorg', !exists(d, 'docs/index.md'));
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('apply-reorg wrote docs/index.md on its own', exists(d, 'docs/index.md'));
  okTrue('apply-reorg reports the index row counts', /wrote .*docs\/index\.md.*rows/.test(r.out));

  const md = read(d, 'docs/index.md');
  okTrue('CLEAN.md indexed under ## Product', md.includes('[Clean]'));
  okTrue('CLOSED.md indexed under ## Archive', md.includes('[Closed]'));
}

// ---------------------------------------------------------------- 23. relative inbound links

/**
 * uv's real docs cross-link with RELATIVE paths (`../concepts/projects.md`, `./tools.md`,
 * `guides/install.md`) — the old repo-rooted exact-path match never saw these, so a real
 * apply-reorg run on a uv clone moved 61 files and reported `linksRewritten: 0`. This pins
 * the fix: for every git-tracked .md file, a link inside `](...)` or a reference-style
 * `]: ...` target is ALSO matched by resolving it relative to the SCANNING file's own
 * directory. Fence-awareness is explicitly NOT part of the fix (documented, not a gap): the
 * existing exact-path matcher was never fence-aware either, and this keeps that trade-off.
 */
function relativeInboundLinks() {
  group('23. relative inbound links — the uv-shaped gap (moveDoc via archive)');

  const d = repo({
    'docs/sub/A.md': DOC('A'),
    'docs/other/A.md': DOC('Decoy'), // same basename, different dir — must survive untouched
    'docs/notes/NOTE.md': [
      '# Note', '',
      'dotdot form: [rel](../sub/A.md)',
      'fragment form: [frag](../sub/A.md#Section-One)',
      'decoy (different file, same basename): [decoy](../other/A.md)', '',
      '```',
      'fenced form: [fenced](../sub/A.md)',
      '```', '',
    ].join('\n'),
    'docs/LINKS.md': [
      '# Links', '',
      'dot-slash form: [dotslash](./sub/A.md)',
      'bare form: [bare](sub/A.md)', '',
      '[ref-style]: sub/A.md', '',
    ].join('\n'),
  });
  const r = db(d, ['archive', 'docs/sub/A.md']); // -> docs/archive/A.md
  ok('archive exits clean', r.code, 0);

  const note = read(d, 'docs/notes/NOTE.md');
  okTrue('../x.md style link rewritten to the new relative path',
    note.includes('[rel](../archive/A.md)'));
  okTrue('#fragment preserved on a rewritten relative link',
    note.includes('[frag](../archive/A.md#Section-One)'));
  okTrue('a link to a DIFFERENT file with the same basename is left alone',
    note.includes('[decoy](../other/A.md)'));
  okTrue('a relative link inside a fenced code block is still rewritten (documented, not fence-aware)',
    note.includes('[fenced](../archive/A.md)'));

  const links = read(d, 'docs/LINKS.md');
  okTrue('./ prefix is kept when the original link had one',
    links.includes('[dotslash](./archive/A.md)'));
  okTrue('no ./ prefix is added when the original link lacked one',
    links.includes('[bare](archive/A.md)'));
  okTrue('reference-style `]: target` link is also rewritten',
    links.includes('[ref-style]: archive/A.md'));

  okTrue('the decoy file itself is untouched', read(d, 'docs/other/A.md') === DOC('Decoy'));
}

/**
 * The scanner runs PER-MOVE, not as one final batch — so when file A links to file B and
 * BOTH move in the same apply-reorg run, whichever moves first must still end up correct.
 * The plan order below is forced (A before B): the harder direction, since A's own outbound
 * link must survive A's OWN move before B has moved too.
 */
function relativeLinksBothMove() {
  group('23b. relative links — scanning file AND target both move in the same run');

  const d = repo({
    'docs/pair/A.md': [
      '# A', '', 'intro line', '',
      '[to B](../pair2/B.md)', '',
      '## Section One', '', 'words words words', '',
    ].join('\n'),
    'docs/pair2/B.md': DOC('B'),
  });
  write(d, { 'docs/.docs-builder/reorg-plan.json': JSON.stringify({ rows: [
    { file: 'docs/pair/A.md', bucket: 'product' },
    { file: 'docs/pair2/B.md', bucket: 'product' },
  ] }) });
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('A moved into docs/product/', exists(d, 'docs/product/A.md'));
  okTrue('B moved into docs/product/', exists(d, 'docs/product/B.md'));

  const a = read(d, 'docs/product/A.md');
  okTrue('the link from A to B still resolves after BOTH moved in the same run',
    a.includes('[to B](B.md)'));
}

// ---------------------------------------------------------------- 24. apply-reorg's own scan

/**
 * The 12-of-37 bug, pinned. Real-corpus measurement: outline.json (the database `search`
 * reads) held records for only the 12 files that had ever been handed to `scan` by hand — on
 * bareloop, that meant all 24 docs/product/ files had ZERO records, so `search` was
 * structurally blind to them. Not a ranking bug: a file with no records at all cannot rank.
 * The fix is `apply-reorg` running one full-corpus `scan` itself, after the move, over BOTH
 * docs/product/ and docs/archive/ — not only whatever a caller happened to scan already.
 */
function applyReorgScansWholeCorpus() {
  group('24. apply-reorg — one full-corpus scan after the move (12-of-37 regression)');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean', 'Widgets', 'widget assembly instructions'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## Sprockets\n\nsprocket tooling\n',
  });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  const o = artifact(d, 'outline.json');
  const files = new Set(o.records.map(x => x.file));

  // (a) the regression test: both buckets must have records, not just whichever file used to
  // be the one a split happened to touch.
  okTrue('outline.json has a record for the product-bound file', files.has('docs/product/CLEAN.md'));
  okTrue('outline.json has a record for the archive-bound file', files.has('docs/archive/CLOSED.md'));

  // (b) generated output must never round-trip back into its own database.
  okTrue('the pages dir never ends up in outline.json',
    ![...files].some(f => f.startsWith('docs/wiki/')));
  okTrue('index.md / log.md / .docs-builder never end up in outline.json',
    ![...files].some(f => f === 'docs/index.md' || f === 'docs/log.md'
      || f.startsWith('docs/.docs-builder/')));

  // (c) end-to-end proof the blindness is gone: search now returns a hit from a product/ file.
  const s = db(d, ['search', 'docs/.docs-builder/outline.json', 'widget']);
  ok('search exits clean', s.code, 0);
  okTrue('search finds a hit in a product/ file after apply-reorg',
    /docs\/product\/CLEAN\.md/.test(s.out));
}

function applyReorgScanRespectsPages() {
  group('24b. apply-reorg\'s scan honours PAGES (also reorg\'s corpus, which composes this)');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/product/custom-pages/SPLIT.md': DOC('Split page — already-written output, not source'),
  });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg'], { PAGES: 'docs/product/custom-pages' });
  ok('apply-reorg exits clean', r.code, 0);

  const files = new Set(artifact(d, 'outline.json').records.map(x => x.file));
  okTrue('a non-default PAGES dir nested under product/ is excluded from the outline',
    ![...files].some(f => f.startsWith('docs/product/custom-pages/')));
  okTrue('the rest of product/ is still scanned', files.has('docs/product/CLEAN.md'));
}

/**
 * The 12-of-37 bug, narrowed but not fixed: after the 24. fix, scanWholeCorpus() only walked
 * docs/product/ and docs/archive/ — the two dirs apply-reorg moves files INTO. But apply-reorg
 * deliberately leaves `oversized` files exactly where discover found them (splitting spends
 * model budget and must never fire unprompted), so on bareloop's real corpus the 12 biggest,
 * most-cited docs (PRD.md, FINDINGS.md, LAYERS.md — all oversized, all left in place under
 * their original subdirs) still had zero outline records after apply-reorg. scan must cover
 * the whole corpus at wherever each file FINALLY lives: product/, archive/, or its original
 * pre-move path for anything left oversized.
 */
function applyReorgScansOversizedInPlace() {
  group('24c. apply-reorg\'s scan reaches oversized files left in place (12-of-37, still not fixed)');

  const d = repo({
    'docs/00-context/BIG.md': `# Big\n\n## Widgets\n\nwidget assembly instructions\n\n${'line\n'.repeat(600)}`,
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
  });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('the oversized doc was left at its original path, not moved',
    exists(d, 'docs/00-context/BIG.md'));

  const files = new Set(artifact(d, 'outline.json').records.map(x => x.file));
  okTrue('outline.json has a record for the product-bound file', files.has('docs/product/CLEAN.md'));
  okTrue('outline.json has a record for the archive-bound file', files.has('docs/archive/CLOSED.md'));
  okTrue('outline.json has a record for the oversized file at its ORIGINAL path',
    files.has('docs/00-context/BIG.md'));

  const s = db(d, ['search', 'docs/.docs-builder/outline.json', 'widget']);
  ok('search exits clean', s.code, 0);
  okTrue('search finds a hit in the oversized file at its original in-place path',
    /docs\/00-context\/BIG\.md/.test(s.out));
}

// ---------------------------------------------------------------- 25-26. cleanup (v3 step 3)

/**
 * v3 rule 1: `reorg` never splits. `cleanup <file.md>` is now the ONLY entry point to the
 * split pipeline — one file, named by hand, refused on anything else, cost printed before
 * any expensive work (page-writing) happens.
 */
function cleanupCmd() {
  group('25. cleanup — the opt-in, per-file split entry point');

  const d = repo({
    'docs/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
    'docs/SMALL.md': DOC('Small'),
  });

  // (a) exactly one file, never more — splitting spends real model budget per invocation.
  const two = db(d, ['cleanup', 'docs/BIG.md', 'docs/SMALL.md']);
  ok('cleanup refuses two files', two.code, 1);
  okTrue('cleanup names both files in the refusal',
    /docs\/BIG\.md/.test(two.out) && /docs\/SMALL\.md/.test(two.out));

  // (b) a missing file.
  const missing = db(d, ['cleanup', 'docs/NOPE.md']);
  ok('cleanup refuses a missing file', missing.code, 1);
  okTrue('missing-file message is clear', /no such file/i.test(missing.out));

  // (b) a non-.md file.
  write(d, { 'docs/notmd.txt': 'hi\n' });
  const notmd = db(d, ['cleanup', 'docs/notmd.txt']);
  ok('cleanup refuses a non-.md file', notmd.code, 1);
  okTrue('non-.md message is clear', /not a \.md file/i.test(notmd.out));

  // (b) a protected name.
  write(d, { 'docs/README.md': DOC('Readme') });
  const protectedRun = db(d, ['cleanup', 'docs/README.md']);
  ok('cleanup refuses a protected file', protectedRun.code, 1);
  okTrue('protected-file message is clear', /protected/i.test(protectedRun.out));

  // (c) a valid oversized file: cost estimate + line count, BEFORE any page-writing work.
  const bigLines = fs.readFileSync(path.join(d, 'docs/BIG.md'), 'utf8').split('\n').length;
  const clean = db(d, ['cleanup', 'docs/BIG.md']);
  ok('cleanup on a valid file exits clean', clean.code, 0);
  okTrue('cleanup prints the file\'s real line count',
    new RegExp(`${bigLines} lines`).test(clean.out));
  okTrue('cleanup prints an estimated cost', /est\. write cost: \$\d/.test(clean.out));
  okTrue('cleanup never writes any wiki page itself (page-writing is a model step, not this script)',
    !exists(d, 'docs/wiki'));
  const costIdx = clean.out.indexOf('est. write cost');
  const scanIdx = clean.out.indexOf('== scan ==');
  okTrue('the cost estimate prints BEFORE the scan step runs',
    costIdx !== -1 && scanIdx !== -1 && costIdx < scanIdx);
  okTrue('cleanup ran scan for the named file', exists(d, 'docs/.docs-builder/outline.json'));
}

/**
 * (d) `reorg`'s oversized follow-up must name `cleanup <file>` per file, with a line count,
 * not a generic "run the split pipeline" description.
 * (e) Negative control: `apply-reorg` over a corpus holding an oversized file must never
 * create anything under the pages dir — proof `reorg` itself cannot split.
 */
function applyReorgNamesCleanup() {
  group('26. apply-reorg — oversized follow-up names `cleanup <path>` (and never splits)');

  const d = repo({
    'docs/00-context/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
    'docs/CLEAN.md': DOC('Clean'),
  });
  db(d, ['discover']);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  const bigLines = fs.readFileSync(path.join(d, 'docs/00-context/BIG.md'), 'utf8').split('\n').length;
  okTrue('the follow-up names `cleanup docs/00-context/BIG.md`',
    r.out.includes('cleanup docs/00-context/BIG.md'));
  okTrue('the follow-up includes the oversized file\'s line count',
    new RegExp(`cleanup docs/00-context/BIG\\.md[^\\n]*${bigLines} lines`).test(r.out));

  // (e) negative control — reorg never splits, proven, not just documented.
  okTrue('apply-reorg never creates a pages dir (reorg cannot split)', !exists(d, 'docs/wiki'));
}

// ---------------------------------------------------------------- 13. packaging

/** docs-builder.cjs ships in four packages; a fix that lands in one is not shipped. */
function packageParity() {
  group('13. package parity');

  const root = path.join(__dirname, '..', '..');
  const copies = [
    'packages/claude/commands/docs-builder/docs-builder.cjs',
    'packages/droid/commands/docs-builder/docs-builder.cjs',
    'packages/ampcode/commands/docs-builder/docs-builder.cjs',
    'packages/opencode/command/docs-builder/docs-builder.cjs',
  ];
  const hashes = new Set();
  for (const c of copies) {
    const p = path.join(root, c);
    okTrue(`${c.split('/')[1]} ships the script`, fs.existsSync(p));
    if (fs.existsSync(p)) hashes.add(require('crypto')
      .createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
  }
  ok('all four copies are byte-identical', hashes.size, 1);

  // .js is unloadable in a "type": "module" project — it must be .cjs everywhere.
  okTrue('the bundled script is .cjs, never .js',
    copies.every(c => c.endsWith('.cjs') && !fs.existsSync(path.join(root, c.replace('.cjs', '.js')))));
}

// ---------------------------------------------------------------- run

function main() {
  console.log(`${colors.bright}${colors.cyan}docs-builder behavioural tests${colors.reset}`);
  console.log(`script under test: ${path.relative(process.cwd(), DB)}`);

  const groups = [negativeControls, scanContract, slugCollision, moveViaArchive,
    moveViaApplyReorg, moveFailureIsolation, discoverBuckets, reorgCollision,
    ledgerAndDue, dueOutputContract, search, reorgCmd, archiveCleanupRemoved, validateArchiveChokepoints,
    tasksDirChokepoint, halfFinishedSplitDetection,
    reorgCorpusStability, reorgOutIgnored,
    archiveStandaloneFollowup, indexPendingUnwrittenPages,
    indexFlatCmd, indexFlatLinksResolve, indexArchiveWarnFlag, applyReorgAutoIndexes,
    relativeInboundLinks, relativeLinksBothMove,
    applyReorgScansWholeCorpus, applyReorgScanRespectsPages, applyReorgScansOversizedInPlace,
    cleanupCmd, applyReorgNamesCleanup,
    packageParity];

  for (const g of groups) {
    try { g(); }
    catch (e) {
      failed++; failures.push(`${g.name} threw: ${e.message}`);
      console.log(`  ${colors.red}FAIL${colors.reset}  ${g.name} threw: ${e.message}`);
    }
  }

  const total = passed + failed;
  console.log(`\n${colors.bright}${'='.repeat(52)}${colors.reset}`);
  console.log(`Total tests: ${total}`);
  console.log(`Passed:      ${passed}`);
  console.log(`Failed:      ${failed}`);
  console.log(`${colors.bright}${'='.repeat(52)}${colors.reset}`);
  if (failures.length) {
    console.log(`\n${colors.red}Failures:${colors.reset}`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { main };
