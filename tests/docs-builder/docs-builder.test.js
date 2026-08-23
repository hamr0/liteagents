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
  okTrue('apply-reorg does NOT hint at index-flat while a doc is still oversized',
    !/index-flat/.test(applied.out));
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
  okTrue('apply-reorg hints at index-flat when nothing is oversized',
    /index-flat/.test(r.out));
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
  okTrue('due nudges at the threshold', /RECONCILE IS DUE|reconcile/i.test(out));
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

// ---------------------------------------------------------------- 11. reconcile

function reconcileMode() {
  group('11. reconcile — a subcommand, not a prose rulebook');

  const d = repo({ 'docs/product/ONE.md': DOC('One'), 'docs/archive/OLD.md': DOC('Old') });
  const r = db(d, ['reconcile']);
  ok('reconcile exits clean', r.code, 0);
  okTrue('it scans', /== scan ==/.test(r.out));
  okTrue('it lints', /== lint ==/.test(r.out));
  // validate + index need a theme assignment only a model can write. With none present it
  // must say so out loud rather than invent labels or quietly pass.
  okTrue('missing labels.json is a LOUD-SKIP, never a silent pass',
    /LOUD-SKIP/.test(r.out));
  okTrue('archived docs are excluded from the corpus',
    !artifact(d, 'outline.json').files.some(f => f.startsWith('docs/archive/')));
  okTrue('log.md records the reconcile', /reconcile \|/.test(read(d, 'docs/log.md')));
}

// ---------------------------------------------------------------- 12. archive-cleanup

function archiveCleanup() {
  group('12. archive-cleanup — destructive, default keep');

  const base = () => ({
    'docs/product/LIVE.md': `# Live\n\n## S\n\nsee [old](docs/archive/CITED.md)\n`,
    'docs/archive/CITED.md': DOC('Cited'),
    'docs/archive/UNCITED.md': DOC('Uncited'),
  });

  const d = repo(base());
  const report = db(d, ['archive-cleanup']);
  ok('bare run exits clean', report.code, 0);
  okTrue('it reports the uncited candidate', /UNCITED\.md/.test(report.out));
  okTrue('it says plainly that uncited is not deletable',
    /UNCITED IS NOT DELETABLE/.test(report.out));
  okTrue('a bare run removes NOTHING',
    exists(d, 'docs/archive/CITED.md') && exists(d, 'docs/archive/UNCITED.md'));

  ok('--apply with no files is refused (there is no --all)',
    db(d, ['archive-cleanup', '--apply']).code, 1);

  const cited = db(d, ['archive-cleanup', '--apply', 'docs/archive/CITED.md']);
  okTrue('a still-referenced file is refused (SKIP)', /SKIP/.test(cited.out));
  okTrue('the referenced file survives', exists(d, 'docs/archive/CITED.md'));

  const dirty = repo(base());
  write(dirty, { 'uncommitted.txt': 'dirt\n' });
  ok('a dirty tree is refused',
    db(dirty, ['archive-cleanup', '--apply', 'docs/archive/UNCITED.md']).code, 1);
  okTrue('nothing pruned from a dirty tree', exists(dirty, 'docs/archive/UNCITED.md'));

  // Tracked uncited file: --apply deletes it from the working tree via `git rm`, which is
  // "destructive" and "never deletes forever" at once — gone from the tree, still in history.
  const clean = repo(base());
  const done = db(clean, ['archive-cleanup', '--apply', 'docs/archive/UNCITED.md']);
  ok('a tracked uncited file on a clean tree is deleted', done.code, 0);
  okTrue('it is gone from the working tree', !exists(clean, 'docs/archive/UNCITED.md'));
  okTrue('it is still recoverable from git history',
    git(clean, ['cat-file', '-t', 'HEAD:docs/archive/UNCITED.md']) === 'blob');
  okTrue('log.md records the delete', /archive-cleanup \|/.test(read(clean, 'docs/log.md')));

  // Untracked archived file: never committed, so there is no history to fall back to. The
  // command must still see it (walkMd skips any dir literally named `archive`, so this can't
  // reuse that helper), delete it, and say plainly that it is not recoverable.
  const untr = repo(base());
  write(untr, { 'docs/archive/STRAY.md': DOC('Stray') });
  const reportUntr = db(untr, ['archive-cleanup']);
  okTrue('an untracked archived file is reported too', /STRAY\.md/.test(reportUntr.out));
  const doneUntr = db(untr, ['archive-cleanup', '--apply', 'docs/archive/STRAY.md']);
  ok('an untracked uncited file on a clean tree is deleted', doneUntr.code, 0);
  okTrue('it is gone from the working tree', !exists(untr, 'docs/archive/STRAY.md'));
  okTrue('output flags it as NOT recoverable',
    /UNTRACKED.*no history|NOT recoverable/.test(doneUntr.out));

  // The dirty-tree gate must not be bypassable by naming an arbitrary untracked path on the
  // command line. Naming `unrelated-scratch.txt` alongside a real, legitimately-deletable
  // tracked candidate must NOT excuse that file's `??` porcelain line and let the run proceed
  // — the whole point of the gate is that ANY uncommitted state blocks the only destructive
  // command in the pipeline, not just state unrelated to what's named.
  const bypass = repo(base());
  write(bypass, { 'unrelated-scratch.txt': 'scratch\n' });
  const bypassRun = db(bypass, ['archive-cleanup', '--apply',
    'docs/archive/UNCITED.md', 'unrelated-scratch.txt']);
  ok('an unrelated untracked file named on --apply still counts as dirty', bypassRun.code, 1);
  okTrue('the real candidate is NOT deleted just because an unrelated path was also named',
    exists(bypass, 'docs/archive/UNCITED.md'));
}

// ---------------------------------------------------------------- 14. chokepoint fixes

/**
 * Four functions used to do work AND call `process.exit` (directly or via `die()`), which is
 * fatal once another in-process caller invokes them: `process.exit` cannot be caught by a
 * `try/catch`. `validate` killed `reconcile` mid-sequence — on PASS as well as FAIL — so
 * `index`, `lint` and reconcile's own log line silently never ran. This group pins the fix:
 * a throwing/returning core (`doValidate`) plus a thin CLI wrapper (`validate`), the same
 * split this file already used for `doArchive`/`archive` and `gitOrThrow`/`git`.
 */
function reconcileChokepoints() {
  group('14. reconcile / validate / archive — the exit-mid-pipeline chokepoint');

  // reconcile WITH labels.json present must run index + lint, not stop dead inside validate.
  const d = repo({ 'docs/product/A.md': DOC('A') });
  db(d, ['scan', 'docs/product/A.md']);
  const key = artifact(d, 'outline.json').records[0].key;
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }], labels: [{ key, theme: 't' }] }) });
  const r = db(d, ['reconcile']);
  ok('reconcile with labels.json exits clean on PASS', r.code, 0);
  // docs/index.md, not cwd-relative index.md — must match checkLinks()'s own `INDEX` default,
  // or the file `index` writes and the file `validate`'s link check reads are never the same
  // file (MEASURED: with no env vars set, exactly how `reconcile` calls this, they used to
  // disagree — validate could only ever LOUD-SKIP or check a stale index from an earlier run).
  okTrue('index.md gets written to docs/index.md (where validate\'s link check looks)',
    exists(d, 'docs/index.md'));
  okTrue('index.md is NOT written to the cwd root instead', !exists(d, 'index.md'));
  okTrue('lint.json gets written', exists(d, 'docs/.docs-builder/lint.json'));
  okTrue('log.md records BOTH the validate line and the reconcile line',
    /validate \|/.test(read(d, 'docs/log.md')) && /reconcile \|/.test(read(d, 'docs/log.md')));

  // A FAILING validate must NOT abort reconcile: lint still runs, and reconcile still exits
  // non-zero at the very end (decision: reconcile reports the FAIL loudly and keeps going).
  const d2 = repo({ 'docs/product/B.md': DOC('B') });
  db(d2, ['scan', 'docs/product/B.md']);
  write(d2, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }],
    labels: [{ key: 'docs/product/B.md :: Not A Real Heading', theme: 't' }] }) });
  const r2 = db(d2, ['reconcile']);
  ok('reconcile still exits non-zero when validate FAILs', r2.code, 1);
  okTrue('lint still ran despite the FAIL', /== lint ==/.test(r2.out));
  okTrue('lint.json still gets written on a FAIL', exists(d2, 'docs/.docs-builder/lint.json'));

  // reconcile's OUTPUT (docs/wiki/) must not be pulled back into its own scan corpus.
  const d3 = repo({ 'docs/product/C.md': DOC('C'), 'docs/wiki/synth.md': DOC('Synth') });
  db(d3, ['reconcile']);
  okTrue('docs/wiki/ pages are excluded from the reconcile corpus',
    !artifact(d3, 'outline.json').files.some(f => f.startsWith('docs/wiki/')));

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
 * `archiveCleanup` had two unwrapped `gitOrThrow` calls — a git failure inside either one
 * dumped a raw Node stack trace instead of the guarded one-line message every other git
 * failure in this file produces. Both are exercised via a PATH shim that fails one specific
 * git subcommand while passing everything else through to the real binary.
 */
// Matches on the LAST arg only — `docFiles()` already guards its own `ls-files docs/` call
// (via `git()`, the die-based wrapper), so a shim that fails on ANY `ls-files` arg trips
// that call first and never reaches the unwrapped one this test targets. The two calls
// under test end their arg list differently (`ls-files` bare vs. `status --porcelain`),
// so matching the last arg isolates each one precisely.
function shimGitLastArgIs(dir, value) {
  const realGit = execFileSync('sh', ['-c', 'command -v git'], GIT).trim();
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nlast=""\nfor a in "$@"; do last="$a"; done\n`
    + `[ "$last" = "${value}" ] && { echo "fatal: simulated" >&2; exit 1; }\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return { PATH: `${dir}:${process.env.PATH}` };
}

function archiveCleanupGitGuard() {
  group('15b. archive-cleanup guards BOTH its gitOrThrow calls, never a raw stack trace');

  // 1: the referrer-scan `ls-files` call (bare invocation, no --apply).
  const shim1 = fs.mkdtempSync(path.join(os.tmpdir(), 'db-shim-lsfiles-'));
  const d1 = repo({ 'docs/archive/OLD.md': DOC('Old') });
  const r1 = db(d1, ['archive-cleanup'], shimGitLastArgIs(shim1, 'ls-files'));
  okTrue('a git failure during the referrer scan is a guarded message, not a stack trace',
    /git failed while/.test(r1.out) && !/at Object\.<anonymous>/.test(r1.out));
  ok('archive-cleanup exits non-zero on that guarded failure', r1.code, 1);

  // 2: the dirty-tree `status --porcelain` call (--apply path).
  const shim2 = fs.mkdtempSync(path.join(os.tmpdir(), 'db-shim-status-'));
  const d2 = repo({ 'docs/archive/OLD.md': DOC('Old') });
  const r2 = db(d2, ['archive-cleanup', '--apply', 'docs/archive/OLD.md'],
    shimGitLastArgIs(shim2, '--porcelain'));
  okTrue('a git failure during the clean-tree check is a guarded message, not a stack trace',
    /git failed while/.test(r2.out) && !/at Object\.<anonymous>/.test(r2.out));
  ok('archive-cleanup exits non-zero on that guarded failure', r2.code, 1);
  okTrue('nothing was deleted when the guard itself failed', exists(d2, 'docs/archive/OLD.md'));
}

/**
 * Mode 1 (split one oversized doc) ends with the model writing wiki pages and a human
 * running `archive` on the original — six script calls plus two model steps, hand-sequenced.
 * If the model finishes the pages but `archive` never runs, the source doc and its derived
 * pages both exist — "duplication, not cleanup" per the doc's own words — and nothing said
 * so. Detection is derived entirely from existing artifacts (outline.json + labels.json +
 * the same slug/pageStatus logic `plan` already uses to report "done"), never a new state
 * file: it is a WARNING surfaced by `plan` and `reconcile`, and never changes their exit code.
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

  const r = db(d, ['reconcile']);
  okTrue('reconcile surfaces the same warning',
    /docs\/A\.md/.test(r.out) && /archive/.test(r.out));

  // Once `archive` actually runs, the warning must go away — it is derived from current
  // artifact state, not a stateful flag that could go stale.
  db(d, ['archive', 'docs/A.md']);
  const p2 = db(d, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  okTrue('the warning clears once archive actually runs',
    !/half-finished/i.test(p2.out));
}

// ---------------------------------------------------------------- 16-20. move-chokepoint review fixes

/**
 * reconcile scanned its OWN generated output back into its next run: docs/index.md's
 * `## [theme](wiki/x.md)` rows became outline records, and docs/log.md's one
 * `## [DATE] op | desc` H2 per operation grew a fresh unlabelled record every time. Neither
 * is source material a labels.json could ever cover, so the second reconcile reported a
 * permanent `missing` FAIL and the record count grew forever. Fixed by excluding INDEX and
 * docs/log.md from the scan corpus alongside PAGES/archive.
 */
function reconcileCorpusStability() {
  group('16. reconcile — must not scan its own generated output (index.md / log.md)');

  // docs/index.md and docs/log.md are seeded as already-tracked files (as a real repo would
  // have after one prior reconcile + commit), each containing an H2 of their own — an
  // `## [theme](wiki/x.md)` index row and an `## [DATE] op | desc` log entry — so a corpus
  // scan that fails to exclude them has something concrete to wrongly ingest. No labels.json
  // on purpose: this isolates the corpus-filter fix from the unrelated index/link-check path.
  const d = repo({
    'docs/product/A.md': DOC('A'),
    'docs/index.md': '## [theme](wiki/x.md)\n\nsome row\n',
    'docs/log.md': '## 2026-01-01 archive | prior op\n\nsome body\n',
  });

  const counts = [];
  for (let i = 0; i < 3; i++) {
    const r = db(d, ['reconcile']);
    ok(`reconcile run ${i + 1} exits clean`, r.code, 0);
    counts.push(artifact(d, 'outline.json').records.length);
  }
  ok('outline record count identical after run 1 vs run 2', counts[0], counts[1]);
  ok('outline record count identical after run 2 vs run 3', counts[1], counts[2]);
  okTrue('docs/index.md is excluded from its own corpus',
    !artifact(d, 'outline.json').files.includes('docs/index.md'));
  okTrue('docs/log.md is excluded from its own corpus',
    !artifact(d, 'outline.json').files.includes('docs/log.md'));
}

/** PAGES was honoured everywhere else in this file except reconcile's own exclusion filter,
 *  which hardcoded docs/wiki/ — so a non-default PAGES dir got scanned back in as source. */
function reconcilePagesHonoured() {
  group('17. reconcile — PAGES is honoured in the exclusion filter, not hardcoded to docs/wiki');

  const d = repo({ 'docs/product/A.md': DOC('A'), 'docs/pages/synth.md': DOC('Synth') });
  const r = db(d, ['reconcile'], { PAGES: 'docs/pages' });
  ok('reconcile exits clean', r.code, 0);
  okTrue('the real PAGES dir is excluded from the scan corpus',
    !artifact(d, 'outline.json').files.includes('docs/pages/synth.md'));
  okTrue('the actual source doc is still scanned',
    artifact(d, 'outline.json').files.includes('docs/product/A.md'));
}

/** reconcile drives four steps that each honour OUT for their OWN artifact, but reconcile
 *  itself read outline.json back from the hardcoded default regardless — so OUT= made
 *  reconcile write fresh state to one place and validate a stale file from another. Fixed by
 *  having reconcile loudly ignore OUT for itself (it is not a step). */
function reconcileOutIgnored() {
  group('18. reconcile — OUT is a per-step override; reconcile is not a step');

  const d = repo({ 'docs/product/A.md': DOC('A') });
  const outFile = path.join(os.tmpdir(), `db-reconcile-out-${process.pid}.json`);
  const r = db(d, ['reconcile'], { OUT: outFile });
  ok('reconcile exits clean', r.code, 0);
  okTrue('reconcile WARNs that OUT is ignored', r.out.includes(`ignoring OUT=${outFile}`));
  okTrue('outline.json still lands at the default artifacts path',
    exists(d, 'docs/.docs-builder/outline.json'));
  okTrue('OUT\'s own path was never written to', !fs.existsSync(outFile));
}

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

/** Naming files on a bare archive-cleanup (no --apply) used to be silently ignored — the full
 *  report printed and the run exited 0, reading exactly like a delete that ran and found
 *  nothing. Fixed with an explicit NOTE that this run is the report and nothing was deleted. */
function archiveCleanupNoteWithoutApply() {
  group('20. archive-cleanup — naming files without --apply is not silently ignored');

  const d = repo({ 'docs/archive/UNCITED.md': DOC('Uncited') });
  const r = db(d, ['archive-cleanup', 'docs/archive/UNCITED.md']);
  ok('archive-cleanup (no --apply) still exits clean', r.code, 0);
  okTrue('a NOTE says nothing was deleted, naming the file count',
    /NOTE: 1 file\(s\) named without --apply/.test(r.out));
  okTrue('nothing was deleted', exists(d, 'docs/archive/UNCITED.md'));
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

/** `index` only ever runs off labels.json, which only the model's theme step produces — so a
 *  reorg-only corpus (apply-reorg moved everything into docs/product/, nothing oversized) never
 *  gets an index at all, and `reconcile` LOUD-SKIPs both validate and index for the same reason.
 *  `index-flat` is the fallback: one row per FILE under docs/product/, no labels, no model. */
function indexFlatCmd() {
  group('22. index-flat — a flat, one-row-per-file fallback index, no labels needed');

  const d = repo({
    'docs/product/A.md': DOC('A'),
    'docs/product/B.md': DOC('B'),
    'docs/product/nested/C.md': DOC('C'),
  });
  const r = db(d, ['index-flat'], { OUT: 'docs/index.md' });
  ok('index-flat exits clean', r.code, 0);
  okTrue('it reports the row count', /wrote .*: 3 rows/.test(r.out));

  const md = read(d, 'docs/index.md');
  for (const title of ['A', 'B', 'C']) {
    const m = md.match(new RegExp(`\\[${title}\\]\\(([^)]+)\\)`));
    okTrue(`row for ${title} has a link`, !!m);
    if (m) okTrue(`row for ${title}'s link resolves on disk`,
      fs.existsSync(path.join(d, 'docs', m[1])));
  }

  // Empty docs/product/ — no non-.md file inside it counts as a doc to index.
  const empty = repo({ 'docs/product/.keep': '' });
  const r2 = db(empty, ['index-flat'], { OUT: 'docs/index.md' });
  ok('empty product dir exits clean', r2.code, 0);
  okTrue('empty product dir gives a clear message', /empty — nothing to index/.test(r2.out));
  okTrue('no index.md is written for an empty product dir', !exists(empty, 'docs/index.md'));

  // No docs/product/ at all — nothing has been reorged yet.
  const missing = repo({ 'docs/A.md': DOC('A') });
  const r3 = db(missing, ['index-flat'], { OUT: 'docs/index.md' });
  ok('a repo with no product dir at all exits clean', r3.code, 0);
  okTrue('missing product dir gives a clear message', /nothing to index/.test(r3.out));
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
    ledgerAndDue, search, reconcileMode, archiveCleanup, reconcileChokepoints,
    tasksDirChokepoint, archiveCleanupGitGuard, halfFinishedSplitDetection,
    reconcileCorpusStability, reconcilePagesHonoured, reconcileOutIgnored,
    archiveStandaloneFollowup, archiveCleanupNoteWithoutApply, indexPendingUnwrittenPages,
    indexFlatCmd, packageParity];

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
