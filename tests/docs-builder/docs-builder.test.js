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

  ok('README.md is never listed', bucket('docs/README.md'), 'ABSENT');
  ok('CLAUDE.md is never listed, at any depth', bucket('docs/deep/CLAUDE.md'), 'ABSENT');
  ok('CHANGELOG.md is never listed, at any depth', bucket('docs/deep/CHANGELOG.md'), 'ABSENT');
  ok('node_modules/ is never walked', bucket('docs/node_modules/pkg/DOC.md'), 'ABSENT');
  ok('dot-dirs are never walked', bucket('docs/.hidden/SECRET.md'), 'ABSENT');

  db(d, ['apply-reorg']);
  okTrue('protected files stayed put after apply-reorg',
    exists(d, 'docs/README.md') && exists(d, 'docs/deep/CLAUDE.md'));
  okTrue('an oversized doc is never auto-split or moved', exists(d, 'docs/BIG.md'));
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
    ledgerAndDue, search, reconcileMode, archiveCleanup, packageParity];

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
