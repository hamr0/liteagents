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

/** Every ephemeral tmp dir this suite creates (repo(), bare/shim fixtures, the S5 "elsewhere"
 *  cwd) is tracked here and removed on exit — regression, 2026-08-25: `mkdtempSync` was never
 *  cleaned up, ~1,000 leftover db-test- (and sibling) dirs per run, which filled the host's /tmp
 *  (inode exhaustion, 11,991 dirs found) and broke the tool harness for every session sharing
 *  it. KEEP_TMP=1 skips the cleanup for debugging a failing fixture by hand. */
const KEEP_TMP = !!process.env.KEEP_TMP;
const tmpDirs = [];
function mkdtemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
if (!KEEP_TMP) {
  process.on('exit', () => {
    for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
}

/** Real line count: `split('\n')` leaves a trailing empty element for a file ending in a
 *  newline, so it over-counts by one. The tests must not measure with the same broken
 *  primitive the code under test was fixed for — that is how the +1 got asserted as correct
 *  in the first place. */
const realLineCount = s => { const l = s.split('\n'); if (l.length && l[l.length - 1] === '') l.pop(); return l.length; };

/** A throwaway git repo with a docs/ tree. Files is a { relpath: contents } map. */
function repo(files = {}) {
  const dir = mkdtemp('db-test-');
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

/** v3: `discover` only PROPOSES (`suggested`); a human/model classification interview fills
 *  `bucket` before `apply-reorg` will run at all. Tests that only care about the MOVE
 *  mechanics (not the interview itself) stand in for that interview by copying each row's
 *  `suggested` straight into `bucket` — same as a reviewer rubber-stamping every proposal. */
function fillBucketsFromSuggested(dir, planRel = 'docs/.docs-builder/reorg-plan.json') {
  const p = path.join(dir, planRel);
  const plan = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const row of plan.rows) row.bucket = row.suggested;
  fs.writeFileSync(p, JSON.stringify(plan, null, 1));
  return plan;
}

const DOC = (h1, h2 = 'Section One', body = 'words words words') =>
  `# ${h1}\n\nintro line\n\n## ${h2}\n\n${body}\n`;

// ------------------------------------------- 0. cleanup-apply follow-up failure (regression)

/**
 * Regression, 2026-08-24. `archive()` called `process.exit(2)` directly when a moveDoc
 * FOLLOW-UP failed (outline/labels sync or link rewrite) — the move itself having landed.
 * That is correct for the `archive` CLI, but `cleanup-apply` calls the same function
 * IN-PROCESS and still has two steps to run after it: relocating the core page out of
 * PAGES/, and rebuilding docs/index.md. The bare exit killed the run mid-flight, so an
 * operator got archive's message and no hint that the index was left describing the
 * pre-split shape. Pre-fix this group's "names both skipped steps" assertion FAILS
 * (observed: got [false], expected [true]) while the exit code stayed 2 either way — the
 * exit code alone could never have caught this, which is why it went unnoticed.
 *
 * The failure is induced by making outline.json read-only, so rewriteArchivedPath's
 * writeFileSync throws EACCES inside moveDoc. Nothing is stubbed: this is the real
 * follow-up-failure path, reached the way a real permissions problem would reach it.
 */
function cleanupApplyFollowUpFailureIsReported() {
  group('0. cleanup-apply — a follow-up failure names what the run skipped (regression)');

  const original = '# Big\n\n## One\n\nalpha alpha alpha\n\n## Two\n\nbeta beta beta\n';
  const d = repo({ 'docs/BIG.md': original });
  db(d, ['cleanup', 'docs/BIG.md']);
  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', gloss: 'g', core: true }, { name: 'Other', gloss: 'g2' }],
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Other' }] }) });
  const page = title => `---\ntype: reference\ntitle: ${title}\n---\n\n# ${title}\n\n`
    + 'body line\n'.repeat(10);
  write(d, { 'docs/wiki/BIG.md': page('Big'), 'docs/wiki/other.md': page('Other') });

  const outlineF = path.join(d, 'docs/.docs-builder/outline.json');
  fs.chmodSync(outlineF, 0o444);

  // Pre-flight: can this test produce the negative at all? Running as root (or on a
  // filesystem ignoring the mode) would make the write succeed, the follow-up never fail,
  // and every assertion below pass for the wrong reason. Prove the mode actually bites.
  let readOnlyHolds = false;
  try { fs.writeFileSync(outlineF, fs.readFileSync(outlineF)); }
  catch { readOnlyHolds = true; }
  okTrue('pre-flight: read-only outline.json really does reject writes (else this test cannot fail)',
    readOnlyHolds);

  const r = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  fs.chmodSync(outlineF, 0o644); // so the tmpdir stays removable

  // We are on the FOLLOW-UP path, not the move-failure path: the move landed.
  okTrue('the original was archived — the move itself succeeded', exists(d, 'docs/archive/BIG.md'));
  ok('exit code is still 2 — "it moved, do not retry" (contract unchanged)', r.code, 2);
  okTrue('archive\'s own message still explains the move succeeded',
    /the move above SUCCEEDED/.test(r.out));

  // The regression itself: cleanup-apply must name ITS OWN skipped work.
  okTrue('cleanup-apply says it stopped', /cleanup-apply STOPPED here/.test(r.out));
  okTrue('it names the core page as not relocated', /core page was not[\s\S]{0,40}relocated/.test(r.out));
  okTrue('it names docs/index.md as not rebuilt', /docs\/index\.md[\s\S]{0,30}was not rebuilt/.test(r.out));
  okTrue('it warns against re-running cleanup-apply (the original has already moved)',
    /Do NOT re-run/.test(r.out) && /already moved/.test(r.out));

  // And the skipped work really is skipped — the message is not lying about the state.
  okTrue('the core page is indeed still at its interim PAGES location', exists(d, 'docs/wiki/BIG.md'));
  okTrue('docs/index.md was indeed not written', !exists(d, 'docs/index.md'));
}

// ------------------------------------------- 0b. the move chokepoint's own guards (regression)

/**
 * Regression, 2026-08-24, both REPRODUCED against the pre-fix script before this was written.
 *
 * (a) Path traversal. `doArchive` resolved its endpoints with `path.join(REPO, src)` and
 *     never checked the result stayed inside REPO. A `"file": "../secret.txt"` row in
 *     reorg-plan.json reached it through applyReorg -> moveDoc; `git mv` refused (source
 *     outside the work tree) and the copy+unlink fallback then copied that outside file INTO
 *     the repo and deleted the original. Observed pre-fix: `../secret.txt` gone, its content
 *     at docs/product/secret.txt.
 * (b) Protected docs. PROTECTED_NAMES was enforced in walkMd and cleanup, but not at the
 *     chokepoint every mover funnels through. Observed pre-fix: `archive README.md` exited
 *     clean having moved the repo's README into docs/archive/.
 *
 * Both guards now live in doArchive. These assert the guard is at the CHOKEPOINT, not at one
 * caller: (a) goes in through apply-reorg, (b) through the archive CLI — two different
 * callers, one guard.
 */
function moveChokepointGuards() {
  group('0b. the move chokepoint refuses traversal and protected docs (regression)');

  // (a) traversal, via apply-reorg
  const d = repo({ 'docs/A.md': DOC('A') });
  const outside = path.join(d, '..', `db-outside-${path.basename(d)}.txt`);
  fs.writeFileSync(outside, 'OUTSIDE\n');
  write(d, { 'docs/.docs-builder/reorg-plan.json': JSON.stringify({
    rows: [{ file: `../${path.basename(outside)}`, bucket: 'product', suggested: 'product',
      oversized: false, why: 'planted traversal' }] }) });
  const r = db(d, ['apply-reorg']);

  okTrue('the file outside the repo still exists — it was NOT deleted', fs.existsSync(outside));
  okTrue('nothing was copied into the repo', !exists(d, 'docs/product/' + path.basename(outside)));
  okTrue('the run says it refused a path outside the repo', /outside the repo/.test(r.out));
  // Tolerant on purpose: pre-fix this file is already gone (that IS the bug), and an ENOENT
  // here would abort the group before part (b) ever ran.
  try { fs.unlinkSync(outside); } catch { /* pre-fix: already deleted by the bug */ }

  // (b) protected doc, via the archive CLI — a different caller, the same guard
  const p = repo({ 'README.md': '# Readme\n\nbody\n', 'docs/A.md': DOC('A') });
  const r2 = db(p, ['archive', 'README.md']);

  okTrue('README.md is still at the repo root', exists(p, 'README.md'));
  okTrue('README.md was NOT archived', !exists(p, 'docs/archive/README.md'));
  ok('archive exits non-zero on a protected doc', r2.code !== 0, true);
  okTrue('the refusal names it as an entry-point/contract doc',
    /never moved|entry-point/.test(r2.out));

  // (c) a SYMLINK out of the repo — the string check alone cannot see this one.
  // Found by adversarial review of the (a) fix: path.resolve does not dereference, so
  // `docs/evil.md -> /etc/passwd` passed confinement and the copy+unlink fallback wrote the
  // TARGET's bytes into the repo (reproduced: exit 0, docs/archive/evil.md == /etc/passwd).
  const target = path.join(os.tmpdir(), `db-symlink-target-${process.pid}.txt`);
  fs.writeFileSync(target, 'SECRET TARGET CONTENT\n');
  const s = repo({ 'docs/A.md': DOC('A') });
  fs.symlinkSync(target, path.join(s, 'docs/evil.md'));
  const r4 = db(s, ['archive', 'docs/evil.md', 'docs/archive/evil.md']);

  ok('archive refuses a symlink pointing outside the repo', r4.code !== 0, true);
  okTrue('it says the path is a symlink', /symlink/.test(r4.out));
  okTrue("the target's content was NOT copied into the repo", !exists(s, 'docs/archive/evil.md'));
  okTrue('the target file outside the repo is untouched', fs.readFileSync(target, 'utf8')
    === 'SECRET TARGET CONTENT\n');
  fs.unlinkSync(target);

  // A symlink that stays INSIDE the repo is ordinary, not an attack — it must still work,
  // or this guard has broken a legitimate layout.
  const t = repo({ 'docs/A.md': DOC('A'), 'docs/real.md': DOC('Real') });
  fs.symlinkSync(path.join(t, 'docs/real.md'), path.join(t, 'docs/link.md'));
  const r5 = db(t, ['archive', 'docs/link.md', 'docs/archive/link.md']);
  ok('a symlink to a file inside the repo still archives', r5.code, 0);

  // The guard must not fire on ordinary docs — a check that refuses everything is not a check.
  const r3 = db(p, ['archive', 'docs/A.md']);
  ok('an ordinary doc still archives cleanly', r3.code, 0);
  okTrue('and it really moved', exists(p, 'docs/archive/A.md'));
}

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
  const bare = mkdtemp('db-nogit-');
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
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);

  ok('apply-reorg exits clean', r.code, 0);
  okTrue('doc moved into docs/product/', exists(d, 'docs/product/GUIDE.md'));
  assertMoveRepairs(d, 'docs/product/GUIDE.md', 'apply-reorg');
  okTrue('summary reports the rewrites', /"linksRewritten": [1-9]/.test(r.out));
}

function moveFailureIsolation() {
  group('6. a failed follow-up must not look like a failed move');

  // A git that fails ONLY on ls-files: the move succeeds, the link repair cannot run.
  const shim = mkdtemp('db-shim-');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], GIT).trim();
  fs.writeFileSync(path.join(shim, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = "ls-files" ] && { echo "fatal: simulated" >&2; exit 1; }; done\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const d = repo({ 'docs/A.md': DOC('A'), 'docs/B.md': DOC('B'),
    'README.md': 'see docs/A.md and docs/B.md\n' });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
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
  group('7. discover — proposal (`suggested`), enrichment, and the never-move list');

  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
    'docs/lower.md': '# Lower\n\nthis doc supersedes nothing and is closed in spirit\n\n## S\n\nx\n',
    // FROZEN means locked-and-current in this corpus's convention, not retired — dropped
    // from the archive status words after 10/12 false archives on bareloop's real corpus.
    'docs/FROZEN.md': '# Frozen\n\n**Status: FROZEN** — build follows this record.\n\n## S\n\nx\n',
    'docs/REPORT_old.md': DOC('Report'),
    // (b) filename-shape logs signal — a real-world miss (REUSE-PREPROBE-PREREG.md, bareloop)
    // carries the token as a SUFFIX, not a prefix, so this fixture does too.
    'docs/EXPERIMENT-PREREG.md': DOC('Experiment Prereg'),
    'docs/RUN-1-LEARNINGS.md': DOC('Run 1 Learnings'),
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
    // v3: `review` is gone. No H1, no strong signal — still a real row, still `suggested`
    // product (the model decides at the interview, nothing special-cases this any more).
    'docs/reference/mystery.md': 'just some prose with no heading and no include directive.\n',
  });
  const r = db(d, ['discover']);
  ok('discover exits clean', r.code, 0);
  const rows = JSON.parse(fs.readFileSync(
    path.join(d, 'docs/.docs-builder/reorg-plan.json'), 'utf8')).rows;
  const row = f => rows.find(x => x.file === f) || {};
  const suggested = f => row(f).suggested || 'ABSENT';

  ok('a clean current doc is suggested product', suggested('docs/CLEAN.md'), 'product');
  ok('a SHOUTED status word is suggested archive', suggested('docs/CLOSED.md'), 'archive');
  // Case-sensitivity is deliberate: lowercase "closed"/"supersedes" in prose false-positived
  // three ways on a real corpus, so only the ALL-CAPS self-declaration counts.
  ok('lowercase status prose is NOT suggested archive', suggested('docs/lower.md'), 'product');
  ok('FROZEN (locked-and-live, not retired) is NOT suggested archive', suggested('docs/FROZEN.md'), 'product');
  ok('an archive-shaped filename is suggested archive', suggested('docs/REPORT_old.md'), 'archive');
  // (b) PREREG/LEARNINGS filename shape suggests logs — new in v3.
  ok('a *-PREREG filename is suggested logs', suggested('docs/EXPERIMENT-PREREG.md'), 'logs');
  ok('a *-LEARNINGS filename is suggested logs', suggested('docs/RUN-1-LEARNINGS.md'), 'logs');
  ok('a no-H1 mkdocs include stub is suggested product',
    suggested('docs/reference/contributing.md'), 'product');
  ok('a no-H1 file with real unclassifiable prose is still suggested product (no more `review`)',
    suggested('docs/reference/mystery.md'), 'product');

  // (a) oversized is a boolean now, not a bucket — orthogonal to `suggested`.
  ok('an over-ceiling doc is suggested product, same as any other structured doc',
    suggested('docs/BIG.md'), 'product');
  ok('an over-ceiling doc is flagged oversized', row('docs/BIG.md').oversized, true);
  ok('a normal-size doc is NOT flagged oversized', row('docs/CLEAN.md').oversized, false);

  // discover enriches every row with h1 + snip, reusing headings()/snippet() — no second
  // extraction path.
  ok('h1 is captured', row('docs/CLEAN.md').h1, 'Clean');
  okTrue('snip is captured and non-empty', !!row('docs/CLEAN.md').snip);

  // (a) `bucket` is left for the interview — never pre-filled by discover.
  okTrue('every row\'s bucket starts empty, awaiting the interview',
    rows.every(x => x.bucket === ''));

  ok('README.md is never listed', suggested('docs/README.md'), 'ABSENT');
  ok('CLAUDE.md is never listed, at any depth', suggested('docs/deep/CLAUDE.md'), 'ABSENT');
  ok('CHANGELOG.md is never listed, at any depth', suggested('docs/deep/CHANGELOG.md'), 'ABSENT');
  ok('node_modules/ is never walked', suggested('docs/node_modules/pkg/DOC.md'), 'ABSENT');
  ok('dot-dirs are never walked', suggested('docs/.hidden/SECRET.md'), 'ABSENT');

  // (c) apply-reorg refuses while any bucket is empty — the interview message, not a crash.
  const refused = db(d, ['apply-reorg']);
  ok('apply-reorg refuses with an unclassified plan', refused.code, 1);
  okTrue('the refusal names the classification interview',
    /classification interview has not happened/.test(refused.out));
  okTrue('protected files stayed put (nothing ran at all)',
    exists(d, 'docs/README.md') && exists(d, 'docs/deep/CLAUDE.md'));
  okTrue('the oversized doc was not moved either — refusal blocks EVERYTHING',
    exists(d, 'docs/BIG.md'));
  okTrue('(g) negative control: refusal writes no index.md at all', !exists(d, 'docs/index.md'));

  fillBucketsFromSuggested(d);
  const applied = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean once classified', applied.code, 0);
  okTrue('protected files stayed put after apply-reorg',
    exists(d, 'docs/README.md') && exists(d, 'docs/deep/CLAUDE.md'));
  // (d) oversized files now MOVE like everything else — size decides splittable, not sorted.
  okTrue('the oversized doc moved into its bucket, not left in place',
    !exists(d, 'docs/BIG.md') && exists(d, 'docs/product/BIG.md'));
  okTrue('the split-candidate list names the oversized doc at its NEW path',
    /cleanup docs\/product\/BIG\.md/.test(applied.out));
  okTrue('the logs-suggested docs moved into docs/logs/',
    exists(d, 'docs/logs/EXPERIMENT-PREREG.md') && exists(d, 'docs/logs/RUN-1-LEARNINGS.md'));
  okTrue('the oversized-in-place doc still ends up indexed under ## Product',
    read(d, 'docs/index.md').includes('[Big]'));
}

/** Carry-forward must only preserve VALID buckets (product/logs/archive). A pre-v3 plan's
 *  legacy bucket ('oversized'/'review') carried forward verbatim reproduces the exact
 *  stale-schema state apply-reorg refuses — discover must treat it as unclassified instead,
 *  while still carrying a genuinely classified row forward untouched. */
function discoverCarryForwardValidOnly() {
  group('7b. discover — carry-forward keeps valid buckets only, drops legacy ones');

  const d = repo({ 'docs/BIG.md': DOC('Big'), 'docs/DONE.md': DOC('Done') });
  db(d, ['discover']);
  const planPath = path.join(d, 'docs/.docs-builder/reorg-plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  for (const row of plan.rows) {
    if (row.file === 'docs/BIG.md') row.bucket = 'oversized'; // legacy pre-v3 value
    if (row.file === 'docs/DONE.md') row.bucket = 'archive';  // real interview verdict
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 1));

  db(d, ['discover']);
  const plan2 = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const big = plan2.rows.find(r => r.file === 'docs/BIG.md');
  const done = plan2.rows.find(r => r.file === 'docs/DONE.md');
  ok('a legacy bucket is NOT carried forward — the row starts unclassified', big.bucket, '');
  ok('a valid bucket IS carried forward', done.bucket, 'archive');
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
  fillBucketsFromSuggested(d);
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
 * v3 folds `reconcile` and `due` into one front door: `reorg` runs discover, STOPS for the
 * classification interview if any row's `bucket` is still empty (true on every first run —
 * discover never fills it), else apply-reorg (which already scans the WHOLE corpus and writes
 * docs/index.md itself) -> lint. `due` stays individually runnable and unchanged (see
 * reorgDueUnaffected below); reorg only calls it in-process, additively, when a ledger stamp
 * already exists.
 */
function reorgCmd() {
  group('11. reorg — the single front door (discover [+ interview gate] + apply-reorg + lint [+ due])');

  // (b) a fresh corpus, no ledger stamp: FIRST invocation only discovers and stops — the
  // interview hasn't happened. It must not silently proceed past an unclassified plan.
  const d = repo({
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
  });
  const r1 = db(d, ['reorg']);
  ok('first reorg (unclassified) exits clean', r1.code, 0);
  okTrue('it discovers', /== discover ==/.test(r1.out));
  okTrue('it stops for the classification interview', /classification interview/.test(r1.out));
  okTrue('it does NOT apply', !/== apply-reorg ==/.test(r1.out));
  okTrue('it does NOT lint', !/== lint ==/.test(r1.out));
  okTrue('nothing moved yet', exists(d, 'docs/CLEAN.md') && exists(d, 'docs/CLOSED.md'));
  okTrue('no index.md yet', !exists(d, 'docs/index.md'));

  // Fill the plan (stand-in for the interview) — SECOND invocation completes the job.
  fillBucketsFromSuggested(d);
  const r = db(d, ['reorg']);
  ok('reorg exits clean once classified', r.code, 0);
  okTrue('it discovers again', /== discover ==/.test(r.out));
  okTrue('it applies the reorg', /== apply-reorg ==/.test(r.out));
  okTrue('it lints', /== lint ==/.test(r.out));
  okTrue('the corpus actually moved (product/)', exists(d, 'docs/product/CLEAN.md'));
  okTrue('the corpus actually moved (archive/)', exists(d, 'docs/archive/CLOSED.md'));
  okTrue('docs/index.md was written in the same invocation', exists(d, 'docs/index.md'));
  okTrue('lint.json was written', exists(d, 'docs/.docs-builder/lint.json'));
  okTrue('log.md records the reorg', /reorg \|/.test(read(d, 'docs/log.md')));
  okTrue('no ledger yet -> no drift summary is fabricated',
    !/== due/.test(r.out));

  // (c) a corpus WITH a ledger stamp: reorg additionally reports the due-style drift summary,
  // once classified.
  const d2 = repo({ 'docs/CLEAN.md': DOC('Clean') });
  db(d2, ['ledger']);
  write(d2, { 'docs/NEW.md': DOC('New') });
  git(d2, ['add', '-A']);
  git(d2, ['commit', '-qm', 'add NEW']);
  db(d2, ['reorg']); // discover only, stops
  fillBucketsFromSuggested(d2);
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
  const r1 = db(d, ['reorg'], { OUT: outFile });
  ok('first reorg (unclassified) exits clean', r1.code, 0);
  okTrue('reorg WARNs that OUT is ignored', r1.out.includes(`ignoring OUT=${outFile}`));
  okTrue('reorg-plan.json still lands at the default artifacts path',
    exists(d, 'docs/.docs-builder/reorg-plan.json'));
  okTrue('OUT\'s own path was never written to', !fs.existsSync(outFile));

  fillBucketsFromSuggested(d);
  const r = db(d, ['reorg'], { OUT: outFile });
  ok('reorg exits clean once classified', r.code, 0);
  okTrue('docs/index.md still lands at the default path', exists(d, 'docs/index.md'));
  okTrue('OUT\'s own path was still never written to', !fs.existsSync(outFile));
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

  // First run only discovers (the interview gate) — classify once, then every subsequent
  // run has nothing left to classify (everything already moved into product/archive, which
  // discover's walk never descends into), so the stability loop proceeds unattended.
  db(d, ['reorg']);
  fillBucketsFromSuggested(d);

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
  const shim = mkdtemp('db-shim2-');
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

  const bare = mkdtemp('db-archive-nogit-');
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
  const shim = mkdtemp('db-archive-realfail-');
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

/** Each row must also carry the doc's H2s as one indented continuation line, so an agent can
 *  find a section without opening the doc. Must reuse the SAME headings()/fenceMask() path
 *  scan() uses -- no second parser -- so a heading inside a ``` fence must not appear, and a
 *  doc with zero H2s must emit no continuation line at all. */
function indexFlatH2Continuation() {
  group('22a. index-flat — H2 lines under each row, with line ranges');

  const threeH2 = '# Three\n\nintro\n\n## Section A\n\nbody a\n\n## Section B\n\nbody b\n\n'
    + '## Section C\n\nbody c\n';
  const fencedH2 = '# Fenced\n\nintro\n\n## Real Section\n\nbody\n\n```\n## Not A Heading\n```\n';
  const noH2 = '# NoHeadings\n\njust prose, no H2 at all\n';
  const twoH2 = '# Two\n\n## First\n\nfirst body\n\n## Second\n\nsecond body\n';
  const archivedWithH2 = '# Archived\n\n## Old Section\n\nstale body\n';

  const d = repo({
    'docs/product/Three.md': threeH2,
    'docs/product/Fenced.md': fencedH2,
    'docs/product/NoHeadings.md': noH2,
    'docs/product/Two.md': twoH2,
    'docs/archive/Archived.md': archivedWithH2,
  });
  const r = db(d, ['index-flat'], { OUT: 'docs/index.md' });
  ok('index-flat exits clean', r.code, 0);
  const md = read(d, 'docs/index.md');
  const lines = md.split('\n');

  // (1) a doc with 3 H2s -> one indented line per H2, in order, with `Ls–e` ranges computed
  // from the SAME line indices headings() returns (reused, not re-derived): the `## `
  // heading's own 1-based line through the line before the next heading of level <= 2, or
  // EOF for the last one. Blank lines in the fixture below are load-bearing for these exact
  // numbers -- verified against the fixture's REAL line count (split('\n') minus the
  // trailing empty element it leaves for a newline-terminated file).
  const threeIdx = lines.findIndex(l => l.includes('[Three]'));
  okTrue('Three row found', threeIdx >= 0);
  ok('Three: 3 H2 lines with correct ranges, in order', threeIdx >= 0
    ? [lines[threeIdx + 1], lines[threeIdx + 2], lines[threeIdx + 3]].join('|') : '(row not found)',
    ['  - Section A (L5–8)', '  - Section B (L9–12)', '  - Section C (L13–15)'].join('|'));

  // (a) a doc with 2 H2s where the 2nd runs to EOF -> its range's end is the file's last line.
  const twoIdx = lines.findIndex(l => l.includes('[Two]'));
  okTrue('Two row found', twoIdx >= 0);
  ok('Two: 2nd H2 range runs to EOF', twoIdx >= 0
    ? [lines[twoIdx + 1], lines[twoIdx + 2]].join('|') : '(row not found)',
    ['  - First (L3–6)', '  - Second (L7–9)'].join('|'));

  // (2) a doc with an H2 inside a ``` fence -> that heading is absent, only the real one
  // shows, and its range runs to EOF (the fenced "heading" is masked, so nothing bounds it).
  const fencedIdx = lines.findIndex(l => l.includes('[Fenced]'));
  okTrue('Fenced row found', fencedIdx >= 0);
  ok('Fenced: only the real H2 shows, fenced one absent, range to EOF',
    fencedIdx >= 0 ? lines[fencedIdx + 1] : '(row not found)',
    '  - Real Section (L5–11)');
  okTrue('fenced "Not A Heading" never appears anywhere in index.md',
    !md.includes('Not A Heading'));

  // (3) a doc with no H2s -> no continuation line at all.
  const noH2Idx = lines.findIndex(l => l.includes('[NoHeadings]'));
  okTrue('NoHeadings row found', noH2Idx >= 0);
  okTrue('NoHeadings row: no continuation line follows (next line is not "  - " indented)',
    noH2Idx >= 0 && !lines[noH2Idx + 1].startsWith('  - '));

  // (b) an archived doc WITH H2s -> the row still appears under ## Archive, but gets NO H2
  // lines at all (H1 + line count + link only) -- archive rows are deliberately H1-only.
  const archiveSection = md.split(/^## /m).find(s => s.startsWith('Archive')) || '';
  const archiveLines = archiveSection.split('\n');
  const archivedIdx = archiveLines.findIndex(l => l.includes('[Archived]'));
  okTrue('Archived row found under ## Archive', archivedIdx >= 0);
  okTrue('Archived row: no H2 continuation line, despite having an H2',
    archivedIdx >= 0 && !archiveLines[archivedIdx + 1].startsWith('  - '));
  okTrue('"Old Section" heading text never appears anywhere in index.md (archive rows are H1-only)',
    !md.includes('Old Section'));
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
  fillBucketsFromSuggested(d);
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
 * directory.
 *
 * FENCE-AWARE (fixed 2026-08-24): a relative link syntax INSIDE a fenced code block is CODE,
 * not a markdown link — MEASURED, real: `](cleanAction.args)`, a JS property-access
 * expression inside a fenced ASCII-diagram code sample, got rewritten into a broken link
 * target because this used to run fence-blind. This pins the fix at both call sites
 * (rewriteLinks' exact-path pass AND rewriteRelativeLinks' relative-path pass): code inside a
 * fence is never touched; a real link outside one still is.
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
      'fenced form (CODE, not a link): [fenced](../sub/A.md)',
      '```', '',
    ].join('\n'),
    'docs/LINKS.md': [
      '# Links', '',
      'dot-slash form: [dotslash](./sub/A.md)',
      'bare form: [bare](sub/A.md)', '',
      '[ref-style]: sub/A.md', '',
    ].join('\n'),
    // The exact repo-rooted matcher (a DIFFERENT regex/pass than the relative-link one above)
    // must be fence-aware too, for the same reason — same hazard class, same fix.
    'docs/EXACT.md': [
      '# Exact', '',
      'real mention: see docs/sub/A.md for details', '',
      '```js',
      "const required = ['docs/sub/A.md']; // CODE, not a rewrite target",
      '```', '',
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
  okTrue('a relative link SYNTAX inside a fenced code block is left alone — it is CODE',
    note.includes('[fenced](../sub/A.md)') && !note.includes('[fenced](../archive/A.md)'));

  const exact = read(d, 'docs/EXACT.md');
  okTrue('an exact repo-rooted path OUTSIDE a fence is still rewritten',
    exact.includes('see docs/archive/A.md for details'));
  okTrue('the SAME exact path INSIDE a fenced code block is left alone — it is CODE',
    exact.includes("required = ['docs/sub/A.md']") && !exact.includes("required = ['docs/archive/A.md']"));

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

/**
 * docs/archive/ exists to hold frozen originals — same rationale as CHANGELOG.md/log.md
 * ("a record of where a file WAS is not a broken link"), one directory further. A real run
 * measured 21 lines rewritten INSIDE docs/archive/PRD.md before this fix — archive must be
 * byte-frozen. Two rules, deliberately split apart (do not collapse them):
 *   (A) a file RESIDENT under archive/ is never a rewrite TARGET, stale links or not.
 *   (B) links ELSEWHERE that POINT AT an archived file are still rewritten as before.
 * The sharpest edge case is a reorg filling archive/ in one run: a file landing there must be
 * frozen ON ARRIVAL, before its own outbound links get re-based from the new directory — so
 * it comes out byte-identical (a pure git rename, R100), not just "unedited going forward".
 */
function archiveIsFrozen() {
  group('23c. docs/archive/ is frozen against link rewrites');

  // (1) A file ALREADY resident in archive/, with a link to a doc about to move — must not
  // be edited at all, even though its link target legitimately just moved.
  const d1 = repo({
    'docs/sub/TARGET.md': DOC('Target'),
    'docs/archive/OLD.md': [
      '# Old', '', 'intro line', '',
      'see [target](../sub/TARGET.md)', '',
      '## Section One', '', 'words words words', '',
    ].join('\n'),
  });
  const before1 = read(d1, 'docs/archive/OLD.md');
  const r1 = db(d1, ['archive', 'docs/sub/TARGET.md']);
  ok('(1) archive of TARGET.md exits clean', r1.code, 0);
  okTrue('(1) TARGET.md landed in docs/archive/', exists(d1, 'docs/archive/TARGET.md'));
  okTrue('(1) an already-archived file with a link to the moved doc is BYTE-UNCHANGED',
    read(d1, 'docs/archive/OLD.md') === before1);

  // (2) Rule B still holds: a NON-archive file linking to a doc that just moved INTO archive
  // IS rewritten, same as any other move.
  const d2 = repo({
    'docs/sub/TARGET.md': DOC('Target'),
    'README.md': 'see [target](docs/sub/TARGET.md) for details\n',
  });
  const r2 = db(d2, ['archive', 'docs/sub/TARGET.md']);
  ok('(2) archive of TARGET.md exits clean', r2.code, 0);
  okTrue('(2) a non-archive file\'s link to the newly-archived doc IS rewritten',
    read(d2, 'README.md').includes('docs/archive/TARGET.md'));

  // (3) The edge case: a doc moving INTO archive carries a relative link of its OWN. Under
  // the old code this got re-based from the new (archive/) directory the moment it moved —
  // under the freeze it must NOT: the file is frozen on arrival, stale links and all, coming
  // out byte-identical to what it was before the move (a pure rename, R100 — no content delta).
  const d3 = repo({
    'docs/sub/MOVING.md': [
      '# Moving', '', 'intro line', '',
      'see [sibling](./SIBLING.md)', '',
      '## Section One', '', 'words words words', '',
    ].join('\n'),
    'docs/sub/SIBLING.md': DOC('Sibling'),
  });
  const beforeBytes = read(d3, 'docs/sub/MOVING.md');
  const r3 = db(d3, ['archive', 'docs/sub/MOVING.md']);
  ok('(3) archive of MOVING.md exits clean', r3.code, 0);
  okTrue('(3) landed in docs/archive/', exists(d3, 'docs/archive/MOVING.md'));
  okTrue('(3) the moved file is BYTE-IDENTICAL to what it carried in (own links not re-based)',
    read(d3, 'docs/archive/MOVING.md') === beforeBytes);

  // NOT `git diff --cached` / `git show --name-status -M`: `git mv` STAGES the rename
  // immediately, so a rename shows as a clean R100 in the staged snapshot even when a LATER,
  // UNSTAGED edit modifies the working-tree file afterward — a staged-only assertion cannot
  // see that class of bug at all (confirmed: it read R100 while the on-disk bytes had
  // diverged). Assert the WORKING TREE itself is clean for this path instead: no unstaged
  // ('M' in the porcelain Y column) component alongside the staged rename.
  const statusLine = git(d3, ['status', '--porcelain']).split('\n')
    .find(l => l.includes('docs/sub/MOVING.md')) || '';
  okTrue('(3) the working tree has NO unstaged modification for the moved file',
    statusLine.length > 0 && statusLine[1] !== 'M');
}

/**
 * The ordering bug, pinned exactly as measured in a real repo/git run (not this file's
 * synthetic fixtures): apply-reorg moves plan rows ONE AT A TIME. Row A (bucket product)
 * moves FIRST; its rewriteLinks sweep walks every tracked file, including row B (bucket
 * archive), which at that INSTANT is still sitting at its OLD path — "resident under
 * archive/" reads false, so B's content gets edited. B then moves into archive one iteration
 * later, carrying that edit in with it. isRewriteExempt must therefore test where a file WILL
 * BE by the end of the run (the plan already commits to this), not only where it is right
 * now — plannedArchiveSrc is that fix. The plan below deliberately puts the archive-bound row
 * SECOND, after the row whose move would otherwise edit it.
 */
function archiveOrderingBug() {
  group('23d. docs/archive/ frozen even when its move is NOT first in the plan (ordering bug)');

  const d = repo({
    'docs/GUIDE.md': DOC('Guide'),
    'docs/OLDSPEC.md': [
      '# Old Spec', '', 'intro line', '',
      'see docs/GUIDE.md for details', '',
      '## Section One', '', 'words words words', '',
    ].join('\n'),
  });
  write(d, { 'docs/.docs-builder/reorg-plan.json': JSON.stringify({ rows: [
    { file: 'docs/GUIDE.md', bucket: 'product' },   // moves FIRST
    { file: 'docs/OLDSPEC.md', bucket: 'archive' },  // moves SECOND — the one at risk
  ] }) });
  const beforeBytes = read(d, 'docs/OLDSPEC.md');

  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('GUIDE.md moved into docs/product/', exists(d, 'docs/product/GUIDE.md'));
  okTrue('OLDSPEC.md moved into docs/archive/', exists(d, 'docs/archive/OLDSPEC.md'));

  okTrue('the archive-bound doc is BYTE-IDENTICAL despite GUIDE.md moving (and sweeping) FIRST',
    read(d, 'docs/archive/OLDSPEC.md') === beforeBytes);

  const statusLine = git(d, ['status', '--porcelain']).split('\n')
    .find(l => l.includes('docs/archive/OLDSPEC.md')) || '';
  okTrue('the working tree has NO unstaged modification for the archive-bound file',
    statusLine.length > 0 && statusLine[1] !== 'M');
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
  fillBucketsFromSuggested(d);
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
  fillBucketsFromSuggested(d);
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
 * their original subdirs) still had zero outline records after apply-reorg. Fixed at the
 * root, v3 (docs-builder-v3-spec.md, "four buckets"): oversized files are no longer left in
 * place at all — size decides splittable, not sorted, so an oversized doc moves into its
 * bucket like everything else and scan (which runs on wherever each file FINALLY lives)
 * simply covers it there, same as any other moved file. Pinned here so the old miss can't
 * come back if "leave oversized in place" is ever reintroduced.
 */
function applyReorgScansOversizedInPlace() {
  group('24c. apply-reorg\'s scan reaches oversized files at their NEW (moved) path');

  const d = repo({
    'docs/00-context/BIG.md': `# Big\n\n## Widgets\n\nwidget assembly instructions\n\n${'line\n'.repeat(600)}`,
    'docs/CLEAN.md': DOC('Clean'),
    'docs/CLOSED.md': '# Closed\n\n**Status: CLOSED** — superseded.\n\n## S\n\nx\n',
  });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('the oversized doc was NOT left at its original path', !exists(d, 'docs/00-context/BIG.md'));
  okTrue('the oversized doc moved into its (product) bucket', exists(d, 'docs/product/BIG.md'));

  const files = new Set(artifact(d, 'outline.json').records.map(x => x.file));
  okTrue('outline.json has a record for the product-bound file', files.has('docs/product/CLEAN.md'));
  okTrue('outline.json has a record for the archive-bound file', files.has('docs/archive/CLOSED.md'));
  okTrue('outline.json has a record for the oversized file at its NEW path',
    files.has('docs/product/BIG.md'));
  okTrue('outline.json has NO record at the oversized file\'s OLD path',
    !files.has('docs/00-context/BIG.md'));

  const s = db(d, ['search', 'docs/.docs-builder/outline.json', 'widget']);
  ok('search exits clean', s.code, 0);
  okTrue('search finds a hit in the oversized file at its NEW (moved) path',
    /docs\/product\/BIG\.md/.test(s.out));

  // (f) the emptied source dir (docs/00-context/) is removed once genuinely empty.
  okTrue('the emptied source dir was removed', !exists(d, 'docs/00-context'));
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
  const bigLines = realLineCount(fs.readFileSync(path.join(d, 'docs/BIG.md'), 'utf8'));
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
 * 25b. FIX (2026-08-24): `docs/.docs-builder/` is shared, not per-file — `cleanup`'s own
 * `scan` OVERWRITES outline.json with only ITS file's records. MEASURED, real: running
 * `cleanup` on a SECOND file while a FIRST split still sat between `plan` and `archive`
 * silently clobbered the first split's outline.json/labels.json, with no error at all —
 * `docs/wiki-index.md` (before it was removed) landed at 0 rows after a real 3-split run.
 * `cleanup` now refuses to start a second split while an earlier one is in flight (labels.json
 * has a core:true theme whose source file still exists — plan ran, archive hasn't). Once that
 * split finishes (archived), a second cleanup on an unrelated file is the normal next step and
 * must NOT be blocked.
 */
function cleanupRefusesConcurrentSplit() {
  group('25b. cleanup — refuses a second split while an earlier one is between plan and archive');

  const d = repo({
    'docs/BIG.md': `# Big\n\n## One\n\nalpha alpha alpha\n\n## Two\n\nbeta beta beta\n`,
    'docs/OTHER.md': DOC('Other'),
  });

  // Start the first split: cleanup + plan (labels.json with core:true), but do NOT archive.
  db(d, ['cleanup', 'docs/BIG.md']);
  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', gloss: 'g', core: true }, { name: 'Rest', gloss: 'g2' }],
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Rest' }] }) });
  db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']); // reports todo, doesn't archive
  okTrue('setup: the first split is between plan and archive (still unarchived)',
    exists(d, 'docs/BIG.md') && !exists(d, 'docs/archive'));

  // The negative control: PRE-FIX, this second cleanup silently overwrote outline.json.
  const second = db(d, ['cleanup', 'docs/OTHER.md']);
  ok('cleanup on a second file while the first is in flight is REFUSED', second.code, 1);
  okTrue('the refusal names the in-progress file', /docs\/BIG\.md/.test(second.out));
  okTrue('the refusal explains why (in-progress split)', /in-progress split/.test(second.out));
  okTrue('the refused run never touched outline.json — still the first split\'s records',
    artifact(d, 'outline.json').records.some(r => r.file === 'docs/BIG.md'));

  // Finish the first split (write both pages, archive), THEN a second cleanup must proceed.
  const page = title => `---\ntype: reference\ntitle: ${title}\n---\n\n# ${title}\n\n`
    + 'body line\n'.repeat(10);
  write(d, { 'docs/wiki/BIG.md': page('Big'), 'docs/wiki/rest.md': page('Rest') });
  const finish = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('finishing the first split exits clean', finish.code, 0);
  okTrue('the first split is now archived', exists(d, 'docs/archive/BIG.md'));

  const after = db(d, ['cleanup', 'docs/OTHER.md']);
  ok('a second cleanup on an unrelated file is fine once the first split is archived', after.code, 0);
}

/**
 * (d) `apply-reorg`'s oversized follow-up must name `cleanup <file>` per file, with a line
 * count, AT THE FILE'S NEW (moved) PATH — not the pre-move one, since v3 moves oversized docs
 * like everything else — and logs-bucket split candidates must sort LAST (spec §5).
 * (e) Negative control: `apply-reorg` over a corpus holding an oversized file must never
 * create anything under the pages dir — proof `reorg` itself cannot split.
 */
function applyReorgNamesCleanup() {
  group('26. apply-reorg — oversized follow-up names `cleanup <NEW path>`, logs last (and never splits)');

  const d = repo({
    'docs/00-context/BIG.md': `# Big\n\n## S\n\n${'line\n'.repeat(600)}`,
    // A second oversized file, filename-shaped for logs — must sort AFTER the product one in
    // the split-candidate list even though it's discovered first (alphabetically/by-walk).
    'docs/AAA-PREREG.md': `# Aaa Prereg\n\n## S\n\n${'line\n'.repeat(600)}`,
    'docs/CLEAN.md': DOC('Clean'),
  });
  const bigLines = realLineCount(fs.readFileSync(path.join(d, 'docs/00-context/BIG.md'), 'utf8'));
  const preregLines = realLineCount(fs.readFileSync(path.join(d, 'docs/AAA-PREREG.md'), 'utf8'));
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  okTrue('the oversized doc moved (product bucket)', exists(d, 'docs/product/BIG.md'));
  okTrue('the oversized logs-shaped doc moved (logs bucket)', exists(d, 'docs/logs/AAA-PREREG.md'));
  okTrue('the follow-up names `cleanup docs/product/BIG.md` — the NEW path, not the old one',
    r.out.includes('cleanup docs/product/BIG.md'));
  okTrue('the old pre-move path is never named', !r.out.includes('cleanup docs/00-context/BIG.md'));
  okTrue('the follow-up includes the oversized file\'s line count',
    new RegExp(`cleanup docs/product/BIG\\.md[^\\n]*${bigLines} lines`).test(r.out));
  okTrue('the logs candidate is named at its new path too',
    new RegExp(`cleanup docs/logs/AAA-PREREG\\.md[^\\n]*${preregLines} lines`).test(r.out));

  // Ordering: the logs-bucket candidate must come AFTER the product-bucket one in the list.
  const bigIdx = r.out.indexOf('cleanup docs/product/BIG.md');
  const preregIdx = r.out.indexOf('cleanup docs/logs/AAA-PREREG.md');
  okTrue('logs-bucket split candidates sort LAST', bigIdx !== -1 && preregIdx !== -1 && bigIdx < preregIdx);

  // (e) negative control — reorg never splits, proven, not just documented.
  okTrue('apply-reorg never creates a pages dir (reorg cannot split)', !exists(d, 'docs/wiki'));
}

// ---------------------------------------------------------------- 27. cleanup shape report

/**
 * settled 2026-08-23 (docs-builder-v3-spec.md, "cleanup"): `cleanup` MEASURES the heading
 * shape mechanically (no semantics) and STOPS for the interview — no page, no move, no
 * further model call. Real worked example from the spec: bareloop's PRD.md has 75 `Addendum
 * v1.NN — <date>` headings and 11 `§N ...` headings; this fixture is a small version of the
 * same two shapes, plus a singleton that must NOT get its own group (negative control: if the
 * grouping rule over-grouped everything into one bucket, or never grouped anything at all,
 * these counts would not come out 5 / 3 / 1).
 */
function cleanupShape() {
  group('27. cleanup — mechanical heading-shape report');

  const body = () => 'line of padding body text\n'.repeat(4);
  let doc = '# PRD\n\nintro\n\n';
  for (let i = 1; i <= 3; i++) doc += `## §${i} Section ${i}\n\n${body()}\n`;
  for (let i = 1; i <= 5; i++) doc += `## Addendum v1.0${i} — 2026-01-0${i}: Note ${i}\n\n${body()}\n`;
  doc += `## Overview\n\n${body()}\n`;
  const d = repo({ 'docs/PRD.md': doc });

  const r = db(d, ['cleanup', 'docs/PRD.md']);
  ok('cleanup exits clean at the stop point', r.code, 0);
  okTrue('cleanup prints it is awaiting the interview', /awaiting the interview/.test(r.out));
  okTrue('cleanup never writes a wiki page', !exists(d, 'docs/wiki'));
  okTrue('cleanup never archives anything', exists(d, 'docs/PRD.md') && !exists(d, 'docs/archive'));
  okTrue('cleanup never writes a labels.json (that is the model\'s job, after the interview)',
    !exists(d, 'docs/.docs-builder/labels.json'));
  okTrue('cleanup writes cleanup-shape.json', exists(d, 'docs/.docs-builder/cleanup-shape.json'));

  const shape = artifact(d, 'cleanup-shape.json');
  ok('shape accounts for every section', shape.totalSections, 9);
  ok('group line totals sum to the document total', shape.groups.reduce((a, g) => a + g.lines, 0), shape.totalLines);

  const addendum = shape.groups.find(g => g.sections === 5);
  const section = shape.groups.find(g => g.sections === 3);
  const other = shape.groups.find(g => g.key === 'other');
  okTrue('the 5 "Addendum v1.NN" headings form ONE group', !!addendum);
  okTrue('the 3 "§N ..." headings form ONE group', !!section);
  okTrue('the lone "Overview" heading folds into "other", not its own group',
    !!other && other.sections === 1);
  ok('exactly three groups — no over-grouping, no under-grouping', shape.groups.length, 3);
}

// ---------------------------------------------------------------- 28. core-theme naming

/**
 * settled 2026-08-23: a `core: true` theme's page carries the ORIGINAL file's basename, not a
 * slugified theme name — and at most one theme may claim it.
 */
function corePlanNaming() {
  group('28. plan — a core:true theme names its page after the ORIGINAL basename');

  const d = repo({ 'docs/BIG.md': `# Big\n\n## One\n\nx\n\n## Two\n\ny\n` });
  db(d, ['scan', 'docs/BIG.md']);
  const o = artifact(d, 'outline.json');

  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main Subject', gloss: 'g', core: true }, { name: 'Other', gloss: 'g2' }],
    labels: [{ key: o.records[0].key, theme: 'Main Subject' },
             { key: o.records[1].key, theme: 'Other' }] }) });

  const p = db(d, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json'],
    { OUT: 'docs/.docs-builder/tasks' });
  ok('plan exits clean', p.code, 0);
  okTrue('the core theme\'s task file is named after the ORIGINAL basename',
    exists(d, 'docs/.docs-builder/tasks/task-BIG.json'));
  okTrue('the core theme does NOT also get a slugified-name task file',
    !exists(d, 'docs/.docs-builder/tasks/task-main-subject.json'));

  // Negative control this test can actually fail on: two core:true themes must be rejected.
  write(d, { 'docs/.docs-builder/labels-bad.json': JSON.stringify({
    themes: [{ name: 'A', gloss: '', core: true }, { name: 'B', gloss: '', core: true }],
    labels: [{ key: o.records[0].key, theme: 'A' }, { key: o.records[1].key, theme: 'B' }] }) });
  const bad = db(d, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels-bad.json']);
  ok('plan rejects two core:true themes', bad.code, 1);
  okTrue('the rejection names both offending themes', /A/.test(bad.out) && /B/.test(bad.out));

  // Existing labels.json shape (no theme marked core) must keep working unchanged — plan is
  // used by callers (including other tests in this file) that never set a core theme at all.
  const d2 = repo({ 'docs/A.md': DOC('A') });
  db(d2, ['scan', 'docs/A.md']);
  const o2 = artifact(d2, 'outline.json');
  write(d2, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 't', gloss: 'g' }], labels: [{ key: o2.records[0].key, theme: 't' }] }) });
  const noCoreAtAll = db(d2, ['plan', 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('plan still works fine with no core theme at all', noCoreAtAll.code, 0);
}

// ---------------------------------------------------------------- 29-30. cleanup-apply

/**
 * `cleanup-apply` is the post-approval half. It must refuse outright — before doing anything —
 * when the interview clearly has not happened: no labels.json, or a labels.json with no
 * core:true theme.
 */
function cleanupApplyGate() {
  group('29. cleanup-apply — refuses until the interview has happened');

  const d = repo({ 'docs/BIG.md': `# Big\n\n## One\n\nx\n\n## Two\n\ny\n` });
  db(d, ['scan', 'docs/BIG.md']);

  const noLabels = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('cleanup-apply refuses when labels.json is absent', noLabels.code, 1);
  okTrue('the refusal says the interview has not happened (missing labels.json)',
    /interview has not happened/.test(noLabels.out));

  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', gloss: '' }, { name: 'Other', gloss: '' }], // no core:true anywhere
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Other' }] }) });
  const noCore = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('cleanup-apply refuses when no theme is core:true', noCore.code, 1);
  okTrue('the refusal says the interview has not happened (no core theme)',
    /interview has not happened/.test(noCore.out));
  okTrue('cleanup-apply never archives on refusal', exists(d, 'docs/BIG.md') && !exists(d, 'docs/archive'));
}

/**
 * Full cycle, and the negative control the task explicitly called for: nothing in the
 * cleanup path may ever WRITE to the source file — it is only ever read, then git-mv'd once,
 * byte-identical, at the very end.
 */
function cleanupApplyFullCycle() {
  group('30. cleanup-apply — resumable, archives only once pages are done, never rewrites the source');

  const original = '# Big\n\n## One\n\nalpha alpha alpha\n\n## Two\n\nbeta beta beta\n';
  const d = repo({ 'docs/BIG.md': original });
  db(d, ['cleanup', 'docs/BIG.md']); // the measure step
  const before = fs.readFileSync(path.join(d, 'docs/BIG.md'));

  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', gloss: 'g', core: true }, { name: 'Other', gloss: 'g2' }],
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Other' }] }) });

  // First call: no pages written yet -> must refuse to archive, and must NOT touch the source.
  const first = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('first cleanup-apply exits clean', first.code, 0);
  okTrue('first call reports pages still to write', /still to write/.test(first.out));
  okTrue('nothing archived yet', exists(d, 'docs/BIG.md') && !exists(d, 'docs/archive'));
  okTrue('the source is byte-identical to before cleanup-apply ran (negative control: never rewritten)',
    fs.readFileSync(path.join(d, 'docs/BIG.md')).equals(before));

  // Stand in for the model's page-writing step — core page under the ORIGINAL basename, the
  // other theme under its ordinary slug.
  const page = title => `---\ntype: reference\ntitle: ${title}\n---\n\n# ${title}\n\n`
    + 'body line\n'.repeat(10);
  write(d, { 'docs/wiki/BIG.md': page('Big'), 'docs/wiki/other.md': page('Other') });

  const second = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('second cleanup-apply exits clean', second.code, 0);
  okTrue('second call archives and rebuilds the index', /archiving the original/.test(second.out));
  okTrue('the archive holds the ORIGINAL, frozen, at its basename', exists(d, 'docs/archive/BIG.md'));
  okTrue('the archived copy is byte-identical to the original — moved, never rewritten',
    fs.readFileSync(path.join(d, 'docs/archive/BIG.md')).equals(before));

  // settled 2026-08-23 (docs-builder-v3-spec.md, "cleanup"): the core page lives in the
  // ORIGINAL document's own directory, keeping its basename — so `docs/BIG.md` exists again,
  // now holding the NEW core page (not the frozen original, which is the archive's job).
  okTrue('the core page landed back at the original path (its own document\'s directory)',
    exists(d, 'docs/BIG.md'));
  okTrue('what\'s at the original path is the NEW core page, not the frozen original',
    read(d, 'docs/BIG.md').includes('title: Big'));
  okTrue('the core page is no longer at its interim PAGES location',
    !exists(d, 'docs/wiki/BIG.md'));
  okTrue('the non-core theme page stays under PAGES', exists(d, 'docs/wiki/other.md'));
  okTrue('index.md was rebuilt', exists(d, 'docs/index.md'));
  okTrue('index.md links to the core page at its real (relocated) location',
    read(d, 'docs/index.md').includes('[Big](BIG.md)'));
}

// ---------------------------------------------------------------- 31-33. v3 four-bucket extras

/** (e) logs/ is a real bucket, not just a filename hint: a logs-shaped file actually lands
 *  under docs/logs/, shows up in outline.json (search's database) and docs/index.md's own
 *  ## Logs section, and a second discover+apply-reorg cycle over the same corpus is a no-op —
 *  nothing moves twice, nothing duplicates. */
function logsIdempotentAndIndexed() {
  group('31. logs bucket — lands in docs/logs/, indexed, idempotent on a second run');

  const d = repo({
    'docs/EXPERIMENT-PREREG.md': DOC('Experiment Prereg'),
    'docs/CLEAN.md': DOC('Clean'),
  });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('the logs-shaped file landed under docs/logs/', exists(d, 'docs/logs/EXPERIMENT-PREREG.md'));

  const files = new Set(artifact(d, 'outline.json').records.map(x => x.file));
  okTrue('outline.json has a record for the logs file (search\'s database)',
    files.has('docs/logs/EXPERIMENT-PREREG.md'));

  const md = read(d, 'docs/index.md');
  okTrue('index.md has a ## Logs section', /## Logs/.test(md));
  const logsSection = (md.split(/^## /m).find(s => s.startsWith('Logs')) || '');
  okTrue('the logs file is listed under ## Logs', logsSection.includes('[Experiment Prereg]'));
  okTrue('the logs file is NOT also listed under ## Product',
    !(md.split(/^## /m).find(s => s.startsWith('Product')) || '').includes('[Experiment Prereg]'));

  // Idempotence: re-run discover (walkMd skips docs/logs/ by name, same as product/archive)
  // + apply-reorg over what's left — nothing left to classify, nothing left to move.
  db(d, ['discover']);
  const plan = JSON.parse(fs.readFileSync(path.join(d, 'docs/.docs-builder/reorg-plan.json'), 'utf8'));
  ok('a second discover finds nothing left to classify', plan.rows.length, 0);
  const r2 = db(d, ['apply-reorg']);
  ok('a second apply-reorg exits clean', r2.code, 0);
  okTrue('a second apply-reorg moves nothing', /"moved": 0/.test(r2.out));
  okTrue('a second apply-reorg skips nothing', /"skipped": 0/.test(r2.out));
  okTrue('the logs file still exists exactly once, unchanged',
    exists(d, 'docs/logs/EXPERIMENT-PREREG.md') && !exists(d, 'docs/logs/EXPERIMENT-PREREG-2.md'));
}

/** (f) emptied source directories are removed, depth-first so nested empties collapse — but
 *  a directory that still holds ANYTHING (even a file reorg never touches) survives.
 *  (g) negative control: while apply-reorg refuses (unclassified plan), nothing moves and
 *  no directory is removed — the sweep only ever runs on a completed, successful apply. */
function emptyDirCleanup() {
  group('32. apply-reorg — nested empty source dirs removed; a leftover file blocks removal');

  const d = repo({
    'docs/a/b/c/DEEP.md': DOC('Deep'),
    // Non-.md leftover in a SIBLING subdir of the same ancestor — walkMd never touches it
    // (extension filter), so docs/a/ must survive even though docs/a/b/c/ does not.
    'docs/a/other/keep.txt': 'never touched by reorg\n',
  });
  db(d, ['discover']);

  // (g) negative control, refusal path: nothing moves, nothing is removed.
  const refused = db(d, ['apply-reorg']);
  ok('apply-reorg refuses (unclassified plan)', refused.code, 1);
  okTrue('(g) the nested dir survives a refused apply-reorg', exists(d, 'docs/a/b/c/DEEP.md'));
  okTrue('(g) the leftover-holding dir survives too', exists(d, 'docs/a/other/keep.txt'));

  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean once classified', r.code, 0);
  okTrue('the file moved into product/', exists(d, 'docs/product/DEEP.md'));
  // (f) nested collapse: docs/a/b/c/ AND docs/a/b/ are both now empty and both removed.
  okTrue('the deepest emptied dir was removed', !exists(d, 'docs/a/b/c'));
  okTrue('its now-empty parent was ALSO removed (nested collapse)', !exists(d, 'docs/a/b'));
  // (f) docs/a/ itself still holds docs/a/other/keep.txt — must survive.
  okTrue('a dir with a leftover file is NOT removed', exists(d, 'docs/a'));
  okTrue('the leftover file itself is untouched', exists(d, 'docs/a/other/keep.txt'));
  okTrue('apply-reorg reports how many dirs it removed', /"dirsRemoved": 2/.test(r.out));
}

/**
 * The scope addition found live on bareloop: two writers targeted docs/index.md and the last
 * one won. apply-reorg wrote the 37-row whole-corpus map, then a PRD split's themed `index`
 * subcommand overwrote it with only that split's 7 wiki pages — 30 of 37 files silently
 * vanished from a file that still claimed completeness. Fixed by giving `index` its own file
 * (docs/wiki-index.md) and having cleanup-apply rebuild index-flat's whole-corpus map as its
 * own final step. (h) proves docs/index.md survives a full cleanup cycle with its other
 * corpus entries intact; (i) proves the themed view's own links still resolve.
 */
function cleanupPreservesWholeCorpusIndex() {
  group('33. cleanup-apply must not clobber the whole-corpus index (bareloop regression)');

  const original = '# Big\n\n## One\n\nalpha alpha alpha\n\n## Two\n\nbeta beta beta\n';
  const d = repo({
    'docs/BIG.md': original,
    'docs/OTHER.md': DOC('Other'),
    'docs/A-PREREG.md': DOC('A Prereg'),
  });
  // Reorg first — a product file and a logs file land under their buckets, both indexed.
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  db(d, ['apply-reorg']);
  okTrue('setup: the product file is indexed', read(d, 'docs/index.md').includes('[Other]'));
  okTrue('setup: the logs file is indexed', read(d, 'docs/index.md').includes('[A Prereg]'));

  // Now run the split pipeline on the (now-moved) oversized product doc end to end.
  const bigPath = 'docs/product/BIG.md';
  db(d, ['cleanup', bigPath]);
  const o = artifact(d, 'outline.json');
  const bigRecords = o.records.filter(r => r.file === bigPath);
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', gloss: 'g', core: true }, { name: 'Other', gloss: 'g2' }],
    labels: [{ key: bigRecords[0].key, theme: 'Main' }, { key: bigRecords[1].key, theme: 'Other' }] }) });
  db(d, ['cleanup-apply', bigPath, 'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);

  const page = title => `---\ntype: reference\ntitle: ${title}\n---\n\n# ${title}\n\n`
    + 'body line\n'.repeat(10);
  write(d, { 'docs/wiki/BIG.md': page('Big'), 'docs/wiki/other.md': page('Other') });
  const second = db(d, ['cleanup-apply', bigPath,
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('final cleanup-apply exits clean', second.code, 0);
  okTrue('the split archived the original', exists(d, 'docs/archive/BIG.md'));

  // (h) the regression: docs/index.md must still list EVERY corpus file, not only the
  // split's own wiki pages.
  const md = read(d, 'docs/index.md');
  okTrue('(h) the pre-existing product file is STILL indexed after the split', md.includes('[Other]'));
  okTrue('(h) the pre-existing logs file is STILL indexed after the split', md.includes('[A Prereg]'));
  okTrue('(h) the archived original is indexed under ## Archive',
    (md.split(/^## /m).find(s => s.startsWith('Archive')) || '').includes('BIG'));

  // (i) v3 scope change (2026-08-24): there is only ONE index now (docs/index.md, index-flat)
  // — the themed per-split view is gone. The core page relocated into the moved original's
  // OWN directory (docs/product/, since apply-reorg moved BIG.md there before the split), NOT
  // docs/wiki/; the non-core page stays under PAGES. Both are indexed, and every link in the
  // one index resolves.
  okTrue('(i) the core page relocated into its own (moved) original directory',
    exists(d, 'docs/product/BIG.md'));
  okTrue('(i) the core page is no longer at its interim PAGES location',
    !exists(d, 'docs/wiki/BIG.md'));
  okTrue('(i) the non-core page is indexed under its PAGES location',
    md.includes('[Other]') && /\[Other\]\(wiki\/other\.md\)/.test(md));
  okTrue('(i) the core page is indexed at its real (relocated) location',
    /\[Big\]\(product\/BIG\.md\)/.test(md));
  const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  okTrue('(i) the index has at least one link', links.length > 0);
  let dead = 0;
  for (const link of links)
    if (!fs.existsSync(path.join(d, 'docs', link))) dead++;
  ok('(i) every link in the index resolves', dead, 0);
}

// ---------------------------------------------------------------- 12b. index-flat search hint

/** index-flat must write the search hint UNCONDITIONALLY, regardless of row count — a small
 *  corpus (well under ROW_CEILING) still gets it, right under the H1, not just the trailer. */
function indexFlatSearchHint() {
  group('12b. index-flat — unconditional search hint under the H1');

  const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  const md = read(d, 'docs/index.md');
  okTrue('index.md contains the search hint verbatim',
    md.includes('Search this corpus instead of reading it whole: `/docs-builder search <query words>`'));
  const lines = md.split('\n');
  const h1Idx = lines.findIndex(l => l.startsWith('# '));
  const hintIdx = lines.findIndex(l => l.includes('Search this corpus instead'));
  okTrue('the hint sits under the H1, near the top (not the trailer)',
    h1Idx >= 0 && hintIdx > h1Idx && hintIdx < lines.length - 5);
  okTrue('this is a small corpus (well under the 100-row ceiling)',
    (md.match(/^- \[/gm) || []).length < 100);
}

// ---------------------------------------------------------------- 12c. CLAUDE.md docs pointer

/** apply-reorg writes a marker-wrapped pointer block into repo-root CLAUDE.md, same
 *  convention `/remember` uses for MEMORY.md: a plain path (never `@`-referenced, which
 *  would hot-load the whole index every session), idempotent replace-in-place, and it must
 *  never disturb unrelated existing content. Creating the file when it's absent is intended
 *  (a project needs one anyway) — see group 12d below for what's actually a bug (S1/S3). */
function claudeMdDocsPointer() {
  group('12c. apply-reorg — CLAUDE.md docs/index.md pointer block');

  // (a) no CLAUDE.md before: apply-reorg creates one containing just the block.
  {
    const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    okTrue('(a) no CLAUDE.md before apply-reorg', !exists(d, 'CLAUDE.md'));
    const r = db(d, ['apply-reorg']);
    ok('(a) apply-reorg exits clean', r.code, 0);
    okTrue('(a) CLAUDE.md was created', exists(d, 'CLAUDE.md'));
    const cmd = read(d, 'CLAUDE.md');
    okTrue('(a) contains the START marker', cmd.includes('<!-- DOCS_INDEX:START -->'));
    okTrue('(a) contains the END marker', cmd.includes('<!-- DOCS_INDEX:END -->'));
    okTrue('(a) contains a PLAIN path to docs/index.md', cmd.includes('`docs/index.md`'));
    okTrue('(a) does NOT contain an @-reference to the index', !cmd.includes('@docs/index.md'));
    okTrue('(a) points at search for large corpora',
      cmd.includes('/docs-builder search <query words>'));
  }

  // (b) a pre-existing DOCS_INDEX block: re-running apply-reorg replaces it in place, no dup.
  {
    const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    db(d, ['apply-reorg']);
    const first = read(d, 'CLAUDE.md');
    okTrue('(b) exactly one START marker after first run',
      (first.match(/<!-- DOCS_INDEX:START -->/g) || []).length === 1);

    const r2 = db(d, ['apply-reorg']);
    ok('(b) second apply-reorg exits clean', r2.code, 0);
    const second = read(d, 'CLAUDE.md');
    okTrue('(b) exactly one START marker after second run',
      (second.match(/<!-- DOCS_INDEX:START -->/g) || []).length === 1);
    okTrue('(b) exactly one END marker after second run',
      (second.match(/<!-- DOCS_INDEX:END -->/g) || []).length === 1);
  }

  // (c) other pre-existing content (an unrelated marker block + prose) survives untouched.
  {
    const other = '# Project\n\nSome prose about this repo.\n\n'
      + '<!-- MEMORY:START -->\n@.claude/remember/MEMORY.md\n<!-- MEMORY:END -->\n';
    const d = repo({ 'docs/CLEAN.md': DOC('Clean'), 'CLAUDE.md': other });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    const r = db(d, ['apply-reorg']);
    ok('(c) apply-reorg exits clean', r.code, 0);
    const cmd = read(d, 'CLAUDE.md');
    okTrue('(c) unrelated prose survives', cmd.includes('Some prose about this repo.'));
    okTrue('(c) unrelated marker block survives', cmd.includes('<!-- MEMORY:START -->')
      && cmd.includes('@.claude/remember/MEMORY.md') && cmd.includes('<!-- MEMORY:END -->'));
    okTrue('(c) the docs pointer block was appended', cmd.includes('<!-- DOCS_INDEX:START -->'));
    okTrue('(c) contains the END marker', cmd.includes('<!-- DOCS_INDEX:END -->'));
    okTrue('(c) contains a PLAIN path to docs/index.md', cmd.includes('`docs/index.md`'));
    okTrue('(c) does NOT contain an @-reference to the index', !cmd.includes('@docs/index.md'));
    okTrue('(c) points at search for large corpora',
      cmd.includes('/docs-builder search <query words>'));
    okTrue('(c) CLAUDE.md itself was never moved (protected)', exists(d, 'CLAUDE.md'));
  }

  // (d) CONFIG env var: default (unset) still targets CLAUDE.md — the claude package's
  // own invocation needs no env var at all.
  {
    const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    const r = db(d, ['apply-reorg']);
    ok('(d) apply-reorg exits clean with no CONFIG set', r.code, 0);
    okTrue('(d) default with no CONFIG set still writes CLAUDE.md', exists(d, 'CLAUDE.md'));
  }

  // (e) CONFIG=AGENTS.md (droid/opencode's filename): writes the block into AGENTS.md
  // instead, and must NOT also create a CLAUDE.md.
  {
    const d = repo({ 'docs/CLEAN.md': DOC('Clean') });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    const r = db(d, ['apply-reorg'], { CONFIG: 'AGENTS.md' });
    ok('(e) apply-reorg exits clean with CONFIG=AGENTS.md', r.code, 0);
    okTrue('(e) CONFIG=AGENTS.md writes the block into AGENTS.md', exists(d, 'AGENTS.md'));
    const cmd = read(d, 'AGENTS.md');
    okTrue('(e) AGENTS.md contains the START marker', cmd.includes('<!-- DOCS_INDEX:START -->'));
    okTrue('(e) AGENTS.md contains a PLAIN path to docs/index.md', cmd.includes('`docs/index.md`'));
    okTrue('(e) does NOT create a CLAUDE.md', !exists(d, 'CLAUDE.md'));
  }
}

// ---------------------------------------------------------------- 12d. config-pointer bugs (S1/S3)

/**
 * Regression, 2026-08-25. Two bugs in apply-reorg's config-pointer step (a third candidate,
 * "injectClaudeMdPointer creates the file when absent", was reviewed and rejected — a project
 * needs a CLAUDE.md/AGENTS.md anyway, so creating it is intended, not a bug):
 *
 * S1 — indexFlat()'s early "nothing to index" bail returned undefined, indistinguishable from
 *      its normal completion, so apply-reorg called injectClaudeMdPointer() unconditionally
 *      even when no docs/index.md was ever written — a pointer to a file that doesn't exist.
 *      Fix: the bail returns `false`; apply-reorg skips the pointer step when it sees that.
 * S3 — the results JSON was printed BEFORE the try/catch that sets `claudeMdUpdated`, so the
 *      JSON always reported `claudeMdUpdated: false` immediately followed by a contradicting
 *      "updated CLAUDE.md" line. Fix: the JSON print moved to after the try/catch.
 */
function applyReorgConfigPointerBugs() {
  group('12d. apply-reorg — config-pointer bugs: no dangling pointer, honest JSON');

  // S1: nothing indexable (only a protected doc) -> apply-reorg must not write the pointer,
  // even into an EXISTING config file — there is no docs/index.md for it to point at.
  {
    const d = repo({ 'docs/README.md': DOC('Readme'), 'CLAUDE.md': '# Project\n' });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    const before = read(d, 'CLAUDE.md');
    const r = db(d, ['apply-reorg']);
    ok('S1: apply-reorg exits clean', r.code, 0);
    okTrue('S1: reports nothing to index', /nothing to index/.test(r.out));
    okTrue('S1: reports the pointer was skipped', /skipped the CLAUDE\.md pointer/.test(r.out));
    ok('S1: CLAUDE.md left byte-identical (no pointer written)', read(d, 'CLAUDE.md'), before);
  }

  // S3: the pointer IS written (existing CLAUDE.md, real indexable docs) -> the results JSON
  // must honestly report claudeMdUpdated: true, not false.
  {
    const d = repo({ 'docs/CLEAN.md': DOC('Clean'), 'CLAUDE.md': '# Project\n' });
    db(d, ['discover']);
    fillBucketsFromSuggested(d);
    const r = db(d, ['apply-reorg']);
    ok('S3: apply-reorg exits clean', r.code, 0);
    const m = r.out.match(/\{[^{}]*"claudeMdUpdated":\s*(true|false)[^{}]*\}/);
    okTrue('S3: results JSON found in output', !!m);
    ok('S3: results JSON reports claudeMdUpdated: true', m && m[1], 'true');
  }
}

// ---------------------------------------------------------------- 27. commit advisory

/**
 * moveDoc()'s `git mv` STAGES a rename immediately — correct, it's what preserves history —
 * but nothing in apply-reorg's or archive's output ever said so. Confirmed TWICE in the
 * wild: another session's `git add -A` / `git commit -a` silently absorbed the staged
 * renames into an unrelated commit. Worse, a naive fix that just prints "commit with
 * `-- docs`" is itself wrong: the run ALSO leaves UNSTAGED inbound-link rewrites that touch
 * files outside docs/ (src/, scripts/, README.md, ...), and scoping the commit to docs/
 * alone would commit moved files without their repaired links — a broken tree.
 *
 * FIXED 2026-08-24: the advisory used to recommend `git add -u && git commit` — `git add -u`
 * stages EVERY tracked modification in the tree, the exact absorption hazard this advisory
 * exists to warn about, printed as the actual recipe. A real operator read it, recognised the
 * hazard, and refused it. The recipe now names only what this run touched, by explicit path.
 */
function commitAdvisoryReported() {
  group('27. commit advisory — staged renames must not vanish into an unrelated commit');

  const d = repo({ 'docs/GUIDE.md': DOC('Guide') });
  write(d, { 'docs/.docs-builder/reorg-plan.json': JSON.stringify({ rows: [
    { file: 'docs/GUIDE.md', bucket: 'product' },
  ] }) });
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('(a) names the rename count', /1 rename\(s\) this run/.test(r.out));
  okTrue('(a) the recipe stages the moved file by explicit path',
    /git add -- '?docs\/product\/GUIDE\.md'?/.test(r.out));
  okTrue('(c) the recipe never scopes the commit to `docs` alone',
    !/-- docs\b/.test(r.out) && !/commit\b[^\n]*\bdocs\b\s*$/m.test(r.out));

  // The unsafe recipe this replaced (`git add -u`/`-A`) must never be the ACTUAL printed
  // command — only ever named in the prose warning against it.
  const addLines = r.out.split('\n').filter(l => /^\s*git add /.test(l));
  okTrue('(f) no printed `git add` command uses -u/-A (would absorb unrelated in-flight work)',
    addLines.length > 0 && addLines.every(l => !/-u\b|-A\b/.test(l)));
}

function commitAdvisorySkippedOnNoOp() {
  group('27b. commit advisory — silent on a no-op re-run (nothing moved)');

  const d = repo({ 'docs/product/GUIDE.md': DOC('Guide') });
  write(d, { 'docs/.docs-builder/reorg-plan.json': JSON.stringify({ rows: [] }) });
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean on an empty plan', r.code, 0);
  okTrue('(b) no advisory printed when nothing moved', !/rename\(s\) this run/.test(r.out));
}

function commitAdvisoryOnArchive() {
  group('27c. commit advisory — archive() emits the same advisory');

  const d = repo({ 'docs/A.md': DOC('A') });
  const r = db(d, ['archive', 'docs/A.md']);
  ok('archive exits clean', r.code, 0);
  okTrue('(d) archive also names the rename count', /1 rename\(s\) this run/.test(r.out));
  okTrue('(d) archive also stages the moved file by explicit path',
    /git add -- '?docs\/archive\/A\.md'?/.test(r.out));
  const addLines = r.out.split('\n').filter(l => /^\s*git add /.test(l));
  okTrue('(d) archive\'s printed git add never uses -u/-A',
    addLines.length > 0 && addLines.every(l => !/-u\b|-A\b/.test(l)));
}

/**
 * The strongest form of the regression: run the advisory's OWN printed recipe for real,
 * against a repo carrying unrelated uncommitted work, and prove that work survives untouched.
 * Anything short of executing it is trusting the recipe rather than testing it.
 */
function commitAdvisoryRecipeDoesNotAbsorbUnrelatedWork() {
  group('27e. commit advisory — its own printed recipe must not absorb unrelated in-flight work');

  const d = repo({
    'docs/A.md': DOC('A'),
    'README.md': '[link](docs/A.md)\n',
    'src/unrelated.js': 'const x = 1;\n',
  });
  // Unrelated in-flight edit, uncommitted — exactly what `git add -A`/`-u` would absorb.
  write(d, { 'src/unrelated.js': 'const x = 2; // unrelated in-flight work\n' });

  const r = db(d, ['archive', 'docs/A.md']);
  ok('archive exits clean', r.code, 0);

  const addLine = r.out.split('\n').find(l => /^\s*git add -- /.test(l));
  okTrue('the advisory printed an explicit-path git add command', !!addLine);
  if (addLine) {
    execFileSync('bash', ['-c', addLine.trim()], { cwd: d });
    execFileSync('bash', ['-c', 'git commit -qm "docs: reorg"'], { cwd: d });

    const status = git(d, ['status', '--porcelain']);
    okTrue('the moved file is committed, not left staged', !/docs\/archive\/A\.md/.test(status));
    // `git diff --name-only` (unstaged only, unambiguous) rather than porcelain's XY columns —
    // `git()`'s own `.trim()` can eat porcelain's leading space when that line lands first.
    okTrue('the unrelated in-flight edit was NOT absorbed — still an unstaged modification',
      git(d, ['diff', '--name-only']).split('\n').includes('src/unrelated.js'));
  }
}

/**
 * The failure mode this must break: an operator reads `git status`, sees only the smaller,
 * docs-shaped STAGED block, and scopes their commit to docs/ — silently dropping every link
 * repair outside it. A bare count ("35 link rewrites") still reads as "docs stuff"; only
 * naming the actual non-docs top-level path the rewriter touched fights that.
 */
function commitAdvisoryNamesOutsideDocsPaths() {
  group('27d. commit advisory — names non-docs paths the link rewriter touched');

  const d = repo({
    'docs/A.md': DOC('A'),
    'README.md': '[link](docs/A.md)\n',
  });
  const r = db(d, ['archive', 'docs/A.md']); // -> docs/archive/A.md, README.md link rewritten
  ok('archive exits clean', r.code, 0);
  okTrue('README.md link was actually rewritten (precondition)',
    read(d, 'README.md').includes('docs/archive/A.md'));
  okTrue('(e) advisory\'s "outside docs/" clause names the top-level non-docs path README.md',
    /outside docs\/: [^\n]*README\.md/.test(r.out));
}


// ------------------------------------------------- 34-37. field-run regressions (2026-08-24)

/**
 * FIELD BUG (real, reproduced on a fresh repo): the link rewriter became fence-aware but not
 * inline-code-aware, so a one-line code sample in backticks corrupts exactly as a fenced one
 * used to — `map[key](arg)` came out of a reorg as `map[key](../arg)`. Same defect class as
 * the `](cleanAction.args)` corruption, one syntax down.
 */
function inlineCodeSpansNotRewritten() {
  group('34. link rewriter — an inline `code span` is CODE, never a link target');

  const d = repo({
    'docs/prd.md': '# PRD\n\nSee the [design notes](design.md).\n\n'
      + 'Inline code: `map[key](arg)` and `tools[a.name](a.args)` must survive.\n\n'
      + '```js\nconst out = handlers[evt.type](evt.payload);\n```\n',
    'docs/design.md': '# Design\n\nBack to the [PRD](prd.md).\n',
  });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  const prd = read(d, 'docs/product/prd.md');
  okTrue('an inline code span is left byte-exact', prd.includes('`map[key](arg)`'));
  okTrue('a second inline code span on the same line is left byte-exact',
    prd.includes('`tools[a.name](a.args)`'));
  okTrue('fenced code is still left alone (unchanged behaviour)',
    prd.includes('handlers[evt.type](evt.payload)'));
  // Negative control: the fix must not disable real link rewriting on the same line/file.
  okTrue('a REAL markdown link outside code is still rewritten',
    /\]\(design\.md\)/.test(prd) === false || prd.includes('](design.md)'));
  okTrue('the real link still resolves after the move',
    exists(d, path.posix.join('docs/product', (prd.match(/\]\(([^)]+)\)/) || [])[1] || 'MISSING')));
}

/**
 * FIELD BUG (real, reproduced): the advisory's recipe named `docs/prd.md` — a link-rewritten
 * file's PRE-move path — after that same file had itself moved to docs/product/prd.md. `git
 * add` is atomic: one bad pathspec makes it exit 128 and stage NOTHING. The operator follows
 * the printed recipe and commits nothing at all.
 */
function commitRecipePathsAllExist() {
  group('35. commit advisory — every path in the recipe exists, so the recipe actually runs');

  const d = repo({
    // A.md links to B.md; BOTH move this run, so A is recorded as link-rewritten at its old
    // path and then moves itself. That ordering is what produced the stale pathspec.
    'docs/A.md': '# A\n\nintro\n\n## S\n\nSee [B](B.md).\n',
    'docs/B.md': '# B\n\nintro\n\n## S\n\nSee [A](A.md).\n',
  });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);

  const addLines = r.out.split('\n').filter(l => /^\s*git add -- /.test(l));
  ok('exactly ONE recipe is printed for the run', addLines.length, 1);

  const quoted = (addLines[0] || '').match(/'([^']+)'/g) || [];
  const paths = quoted.map(q => q.slice(1, -1));
  const missing = paths.filter(p => !exists(d, p));
  ok('no recipe path is stale (every one exists on disk)', missing.join(','), '');

  // Run it for real: the strongest form of this assertion.
  const res = spawnSync('bash', ['-c', (addLines[0] || 'false').trim()], { cwd: d, encoding: 'utf8' });
  ok('the printed recipe runs clean', res.status, 0);
  const staged = git(d, ['diff', '--cached', '--name-only']);
  okTrue('the generated index is staged by the recipe', staged.includes('docs/index.md'));
  okTrue('the moved docs are staged by the recipe', staged.includes('docs/product/A.md'));
}

/**
 * FIELD BUG (real, reproduced): cleanup-apply printed the advisory THREE times — once from
 * archive(), once from the core-page relocation, once more — each naming only its own step's
 * files. An operator running the LAST one staged the core page and silently dropped the
 * archive move.
 */
function commitAdvisoryPrintedOncePerRun() {
  group('36. commit advisory — one recipe per RUN, covering every step of it');

  const original = '# Big\n\n## One\n\nalpha alpha\n\n## Two\n\nbeta beta\n';
  const d = repo({ 'docs/BIG.md': original });
  db(d, ['cleanup', 'docs/BIG.md']);
  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', core: true }, { name: 'Other' }],
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Other' }] }) });
  const page = t => `---\ntitle: ${t}\n---\n\n# ${t}\n\n` + 'body line\n'.repeat(10);
  write(d, { 'docs/wiki/BIG.md': page('Big'), 'docs/wiki/other.md': page('Other') });

  const r = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('cleanup-apply exits clean', r.code, 0);

  const addLines = r.out.split('\n').filter(l => /^\s*git add -- /.test(l));
  ok('exactly ONE recipe is printed for the whole run', addLines.length, 1);

  const recipe = (addLines[0] || '').trim();
  okTrue('the one recipe covers the archive move', recipe.includes('docs/archive/BIG.md'));
  okTrue('the one recipe covers the relocated core page', recipe.includes('docs/BIG.md'));
  okTrue('the one recipe covers the non-core page the split produced', recipe.includes('docs/wiki/other.md'));
  okTrue('the one recipe covers the rebuilt index', recipe.includes('docs/index.md'));

  const res = spawnSync('bash', ['-c', recipe || 'false'], { cwd: d, encoding: 'utf8' });
  ok('the printed recipe runs clean', res.status, 0);
}

/**
 * FIELD BUG (real, reproduced): inbound-link rewriting iterates `git ls-files` — TRACKED
 * files only. Every page a split just wrote is brand new and untracked, so relocating the
 * core page out of PAGES left its sibling pages' relative links pointing at a path that no
 * longer exists. Exposed by the core-page-stays-home change: before it, the core page never
 * left PAGES, so sibling links never needed repair.
 */
function linkRewriteSeesUntrackedFiles() {
  group('37. link rewriter — an untracked file on disk still gets its inbound links repaired');

  const original = '# Big\n\n## One\n\nalpha alpha\n\n## Two\n\nbeta beta\n';
  const d = repo({ 'docs/BIG.md': original });
  db(d, ['cleanup', 'docs/BIG.md']);
  const o = artifact(d, 'outline.json');
  write(d, { 'docs/.docs-builder/labels.json': JSON.stringify({
    themes: [{ name: 'Main', core: true }, { name: 'Other' }],
    labels: [{ key: o.records[0].key, theme: 'Main' }, { key: o.records[1].key, theme: 'Other' }] }) });
  const page = (t, link) => `---\ntitle: ${t}\n---\n\n# ${t}\n\n` + 'body line\n'.repeat(10)
    + `\nSee [the core page](${link}) for context.\n`;
  // other.md is UNTRACKED and links to the core page at its interim PAGES location.
  write(d, { 'docs/wiki/BIG.md': page('Big', 'other.md'), 'docs/wiki/other.md': page('Other', 'BIG.md') });
  okTrue('the sibling page is untracked (precondition)',
    git(d, ['status', '--porcelain']).includes('docs/wiki/'));

  const r = db(d, ['cleanup-apply', 'docs/BIG.md',
    'docs/.docs-builder/outline.json', 'docs/.docs-builder/labels.json']);
  ok('cleanup-apply exits clean', r.code, 0);
  okTrue('the core page relocated (precondition)', exists(d, 'docs/BIG.md'));

  const other = read(d, 'docs/wiki/other.md');
  okTrue('the untracked sibling no longer points at the vacated PAGES path',
    !/\]\(BIG\.md\)/.test(other));
  const target = (other.match(/\]\(([^)]+)\)/) || [])[1];
  okTrue(`the untracked sibling's link resolves to the core page's real location (got ${target})`,
    !!target && exists(d, path.posix.normalize(path.posix.join('docs/wiki', target))));
}


/**
 * FIELD BUG (privcloud, real first run): the recipe omitted `docs/log.md` — a file THIS RUN
 * created, holding the run's own audit lines. An operator following the recipe verbatim
 * commits a reorg whose log is left untracked. Same class as the index/config omission.
 */
function commitRecipeCoversTheRunLog() {
  group('38. commit advisory — covers docs/log.md, which the run itself writes');

  const d = repo({ 'docs/A.md': DOC('A'), 'docs/B.md': DOC('B') });
  db(d, ['discover']);
  fillBucketsFromSuggested(d);
  const r = db(d, ['apply-reorg']);
  ok('apply-reorg exits clean', r.code, 0);
  okTrue('the run wrote docs/log.md (precondition)', exists(d, 'docs/log.md'));

  const addLine = r.out.split('\n').find(l => /^\s*git add -- /.test(l));
  okTrue('a recipe was printed', !!addLine);
  okTrue('the recipe names docs/log.md', /'docs\/log\.md'/.test(addLine || ''));

  // The real bar: run it, then nothing this run produced is left behind untracked.
  execFileSync('bash', ['-c', (addLine || 'false').trim()], { cwd: d });
  execFileSync('bash', ['-c', 'git commit -qm "docs: reorg"'], { cwd: d });
  const untracked = git(d, ['ls-files', '--others', '--exclude-standard'])
    .split('\n').filter(Boolean).filter(f => !f.startsWith('docs/.docs-builder/'));
  ok('nothing the run produced is left untracked after the recipe', untracked.join(','), '');
}

/**
 * FIELD BUG (privcloud, real first run): `discover` asserted "`bucket` is empty" every time,
 * including a re-run where the buckets were demonstrably filled and `apply-reorg` then ran
 * fine. The operator had to go re-read the JSON by hand to confirm their own writes had
 * persisted. Output that contradicts the state it just wrote costs more than silence.
 */
function discoverReportsRealBucketState() {
  group('39. discover — its closing message reflects the ACTUAL bucket state, and the table shows it');

  const d = repo({ 'docs/A.md': DOC('A'), 'docs/B.md': DOC('B') });
  const first = db(d, ['discover']);
  ok('first discover exits clean', first.code, 0);
  okTrue('with no buckets set, it says so', /`bucket` is empty/.test(first.out));

  fillBucketsFromSuggested(d);
  const second = db(d, ['discover']);
  ok('second discover exits clean', second.code, 0);
  okTrue('carry-forward kept the buckets (precondition)',
    JSON.parse(read(d, 'docs/.docs-builder/reorg-plan.json')).rows.every(r => r.bucket));
  okTrue('it no longer claims the buckets are empty', !/`bucket` is empty/.test(second.out));
  okTrue('it says the classification is already in place', /already carr/i.test(second.out));
  // Instrument check: a bare /bucket/ matches the ADVISORY PROSE, not the table — it passed
  // against pre-fix code that had no such column. Assert on the table's own box-drawn header.
  const header = second.out.split('\n').find(l => l.startsWith('\u2502 (index)'));
  okTrue('a console.table header was printed (precondition)', !!header);
  okTrue('the printed table has a bucket column', /\bbucket\b/.test(header || ''));
}

// ------------------------------------------------------ 12b. discover on a sorted corpus

/** Regression, 2026-08-25. `walkMd` skips product/, logs/, archive/, so a corpus that is
 *  already sorted yields rows: [], filled === 0, and the `!filled` branch fired the
 *  "run the classification interview" message for a ZERO-row plan — telling the operator to
 *  interview nothing, right before `reorg` proceeds anyway. */
function discoverEmptyPlanZeroRows() {
  group('40. discover on an already-sorted corpus reports 0 rows, not the interview message');

  const d = repo({ 'docs/product/a.md': DOC('A'), 'docs/archive/b.md': DOC('B') });
  const r = db(d, ['discover']);
  ok('discover exits clean', r.code, 0);
  const plan = artifact(d, 'reorg-plan.json');
  ok('plan has 0 rows', plan.rows.length, 0);
  okTrue('it reports the 0-row / already-sorted state', /0 rows/.test(r.out) && /already sorted/.test(r.out));
  okTrue('it does NOT print the classification-interview message for an empty plan',
    !/Run the classification interview/.test(r.out));

  // control: an unsorted corpus still gets the original "bucket is empty" message
  const d2 = repo({ 'docs/a.md': DOC('A') });
  const r2 = db(d2, ['discover']);
  okTrue('control: unsorted corpus still shows the bucket-is-empty message', /`bucket` is empty/.test(r2.out));
}

// ---------------------------------------------------------------- 13. packaging

/** Regression, 2026-08-25. The dispatch switch's `default: die('usage: ...')` block lists
 *  every subcommand except `cleanup-apply`, which the switch does implement. */
function usageListsCleanupApply() {
  group('41. usage message lists cleanup-apply');

  const d = repo();
  const r = db(d, ['bogus-subcommand']);
  okTrue('usage output mentions cleanup-apply', /cleanup-apply/.test(r.out));
}

// -------------------------------------------------- 13b. default artifacts resolve under REPO

/** Regression, 2026-08-25. Default artifact paths (ARTIFACTS = 'docs/.docs-builder', used
 *  bare) resolved against process.cwd() even when REPO pointed elsewhere, splitting state
 *  between the cwd and REPO. Running from outside the repo with REPO set must still land
 *  every default artifact under REPO. Explicit OUT/INDEX/TASKS/PAGES overrides and explicit
 *  CLI path arguments are untouched by this fix (see docs-builder.cjs's own comment on
 *  repoPath() above ARTIFACTS). */
function artifactsDefaultUnderRepo() {
  group('42. default artifact paths resolve under REPO, not the caller\'s cwd');

  const d = repo({ 'docs/A.md': DOC('A') });
  const elsewhere = mkdtemp('db-elsewhere-');
  const r = db(elsewhere, ['discover'], { REPO: d });
  ok('discover exits clean', r.code, 0);
  okTrue('reorg-plan.json was written under REPO', exists(d, 'docs/.docs-builder/reorg-plan.json'));
  okTrue('nothing was written under the cwd it was invoked from',
    !fs.existsSync(path.join(elsewhere, 'docs')));
}



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

/** Regression, 2026-09-01: `text.split('\n')` returns a trailing empty element for any file
 *  ending in a newline (which is nearly every file), so `lines.length` was real_lines + 1.
 *  That phantom line reached three outputs: the index row's "N lines", the LAST H2's line
 *  range (which pointed one line past EOF), and scan()'s outline.json s/e/lines.
 *  The negative control is the same document WITHOUT a trailing newline: it must show no
 *  offset either before or after the fix, which is what proves the trailing newline is the
 *  variable and not the counting itself. Found by a peer session comparing an index row
 *  against `wc -l`. */
function trailingNewlineLineCount() {
  group('line counts ignore the trailing-newline phantom line');

  const body = '# Doc\n\n## Alpha\n\naaa\n\n## Beta\n\nbbb';
  const dir = repo({
    'docs/product/with-nl.md': body + '\n',      // trailing newline: the bug case
    'docs/product/without-nl.md': body           // no trailing newline: the control
  });
  const realLines = body.split('\n').length;     // 9 in both files

  db(dir, ['index-flat']);
  const idx = read(dir, 'docs/index.md');

  // The index row's stated count must equal the real line count for BOTH files.
  for (const [file, label] of [['with-nl.md', 'trailing newline'], ['without-nl.md', 'control']]) {
    const row = idx.split('\n').find(l => l.includes(file) && / — \d+ lines/.test(l));
    okTrue(`index row present (${label})`, !!row);
    const stated = row ? Number(row.match(/ — (\d+) lines/)[1]) : -1;
    ok(`index row line count is real, not +1 (${label})`, stated, realLines);
  }

  // The LAST H2's range must not run past the end of the file.
  const lastRanges = idx.split('\n').filter(l => /- Beta \(L\d+–\d+\)/.test(l));
  ok('both files emitted a Beta range', lastRanges.length, 2);
  for (const r of lastRanges) {
    const end = Number(r.match(/–(\d+)\)/)[1]);
    okTrue(`last H2 range ends at or before EOF (got L…–${end}, file has ${realLines})`,
      end <= realLines);
  }

  // scan()'s outline.json carries the same boundary — assert it too, so a fix applied to
  // indexRow alone (one call site) cannot pass this test while scan stays wrong.
  db(dir, ['scan', 'docs/product/with-nl.md', 'docs/product/without-nl.md']);
  const recs = artifact(dir, 'outline.json').records;
  const betas = recs.filter(r => r.h2 === 'Beta');
  ok('scan produced a Beta record per file', betas.length, 2);
  for (const b of betas) {
    okTrue(`scan e is within the file (${b.file}: e=${b.e}, real=${realLines})`, b.e <= realLines);
    ok(`scan lines matches e - s + 1 (${b.file})`, b.lines, b.e - b.s + 1);
  }
}

  const groups = [cleanupApplyFollowUpFailureIsReported, moveChokepointGuards,
    negativeControls, scanContract, slugCollision, moveViaArchive,
    moveViaApplyReorg, moveFailureIsolation, discoverBuckets, discoverCarryForwardValidOnly, reorgCollision,
    ledgerAndDue, dueOutputContract, search, reorgCmd, archiveCleanupRemoved, validateArchiveChokepoints,
    tasksDirChokepoint, halfFinishedSplitDetection,
    reorgCorpusStability, reorgOutIgnored,
    archiveStandaloneFollowup,
    indexFlatCmd, indexFlatH2Continuation, indexFlatLinksResolve, indexArchiveWarnFlag, applyReorgAutoIndexes,
    indexFlatSearchHint, claudeMdDocsPointer, applyReorgConfigPointerBugs,
    relativeInboundLinks, relativeLinksBothMove, archiveIsFrozen, archiveOrderingBug,
    applyReorgScansWholeCorpus, applyReorgScanRespectsPages, applyReorgScansOversizedInPlace,
    cleanupCmd, cleanupRefusesConcurrentSplit, applyReorgNamesCleanup,
    cleanupShape, corePlanNaming, cleanupApplyGate, cleanupApplyFullCycle,
    logsIdempotentAndIndexed, emptyDirCleanup, cleanupPreservesWholeCorpusIndex,
    commitAdvisoryReported, commitAdvisorySkippedOnNoOp, commitAdvisoryOnArchive,
    commitAdvisoryNamesOutsideDocsPaths, commitAdvisoryRecipeDoesNotAbsorbUnrelatedWork,
    inlineCodeSpansNotRewritten, commitRecipePathsAllExist, commitAdvisoryPrintedOncePerRun,
    linkRewriteSeesUntrackedFiles, commitRecipeCoversTheRunLog, discoverReportsRealBucketState,
    discoverEmptyPlanZeroRows, usageListsCleanupApply, artifactsDefaultUnderRepo,
    packageParity, trailingNewlineLineCount];

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
