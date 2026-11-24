#!/usr/bin/env node

/**
 * test-reuse.test.js — the "one full suite per code change" decider shipped
 * in claude's self-review, branch-review and release specs. Extracts the
 * decider line from each SHIPPED spec, asserts the three are byte-identical,
 * runs it as printed in throwaway git repos under bash (and zsh when
 * present), and pins the slot line shapes.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SPECS = {
  'self-review': 'packages/claude/skills/self-review/SKILL.md',
  'branch-review': 'packages/claude/skills/branch-review/SKILL.md',
  'release': 'packages/claude/skills/release/SKILL.md',
};

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}

const tmpDirs = [];
process.on('exit', () => {
  if (process.env.KEEP_TMP) return;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const SHELLS = ['bash'];
if (spawnSync('which', ['zsh']).status === 0) SHELLS.push('zsh');

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const lines = {};
for (const [k, rel] of Object.entries(SPECS)) {
  const m = read(rel).split('\n').map(l => l.trim()).filter(l => l.startsWith('f=.claude/remember/last-review.md; g=$('));
  lines[k] = m.length === 1 ? m[0] : null;
  check(`${k}: exactly one decider line`, m.length === 1, `found ${m.length}`);
}
check('decider line identical in all three specs',
  lines['self-review'] && lines['self-review'] === lines['branch-review'] && lines['branch-review'] === lines['release']);
const DECIDER = lines['release'] || '';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd, file, msg) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), msg + '\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', msg);
}
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'test-reuse-'));
  tmpDirs.push(d);
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  git(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, '.gitignore'), '.claude/\n'); // the record is normally untracked
  commit(d, 'src/a.js', 'one');
  return d;
}
function writeGreen(d, line) {
  fs.mkdirSync(path.join(d, '.claude/remember'), { recursive: true });
  fs.writeFileSync(path.join(d, '.claude/remember/last-review.md'), line + '\n');
}
function decide(shell, d) {
  return spawnSync(shell, ['-c', DECIDER], { cwd: d, encoding: 'utf8' }).stdout.trim();
}

const cases = [
  ['no last-review.md -> RUN', () => repo(), w => w === 'RUN'],
  ['green at HEAD -> REUSE', () => { const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`); return d; },
    w => w === 'REUSE green: ' + w.split('green: ')[1] && w.includes('npm test exit 0 10 passed')],
  ['green, then docs/ + root README.md commit -> REUSE', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'docs/x.md', 'd'); commit(d, 'README.md', 'r'); return d; }, w => w.startsWith('REUSE ')],
  ['green, then src/x.js commit -> RUN', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'src/x.js', 'x'); return d; }, w => w === 'RUN'],
  ['green, docs commit, then src commit -> RUN', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'docs/x.md', 'd'); commit(d, 'src/x.js', 'x'); return d; }, w => w === 'RUN'],
  ['green sha not an ancestor (after reset) -> RUN', () => {
    const d = repo(); commit(d, 'docs/y.md', 'y'); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    git(d, 'reset', '-q', '--hard', 'HEAD~1'); return d; }, w => w === 'RUN'],
  ['malformed green (short sha) -> RUN', () => { const d = repo(); writeGreen(d, 'green: abc123 npm test exit 0 1 passed'); return d; }, w => w === 'RUN'],
  ['malformed green (no command) -> RUN', () => { const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')}`); return d; }, w => w === 'RUN'],
];
for (const sh of SHELLS) {
  for (const [name, mk, ok] of cases) {
    const d = mk();
    const got = decide(sh, d);
    check(`${sh}: ${name}`, ok(got), `got "${got}"`);
  }
}

// Slot line shapes, pinned in each spec.
const SLOTS = {
  'self-review': 'full-suite: REUSE|RUN · reused <sha> (docs only since) <totals> | ran <command> exit <code> <totals> vs before',
  'branch-review': 'tests: REUSE|RUN · reused <sha> (docs only since) <totals> | ran <command> exit <code> <totals>; build',
  'release': 'tests: REUSE|RUN · covered (reused <sha> <totals>) | ran <cmd> exit <code> <totals> · stale-grep',
};
for (const [k, slot] of Object.entries(SLOTS)) {
  check(`${k}: slot line shape pinned`, read(SPECS[k]).includes(slot));
  check(`${k}: run-alone-before-real sentence`, read(SPECS[k]).includes('is re-run alone before it is called real'));
}
check('branch-review: record template carries green: forward', /^green: <this run's suite .*carried forward verbatim/m.test(read(SPECS['branch-review'])));
check('self-review: writes green: line', read(SPECS['self-review']).includes('`green: <full HEAD sha> <command> exit 0 <totals>`'));
check('release: reused-vs-RUN cross-check stops', /says `reused`\s+but this prints `RUN` → \*\*stop\*\*/.test(read(SPECS['release'])));

// Rules 1-4 pins. Claude kit only: widen to all kits at mirror time.
const BR = read(SPECS['branch-review']), SR = read(SPECS['self-review']), RE = read(SPECS['release']);
const RF = read('packages/claude/skills/refactor/SKILL.md');
check('branch-review: owns the green: writer rule (any passing full run, rev-parse, replace, no other line)',
  /Who writes `green:`.*any full-suite run that exits 0 on a clean tree at HEAD.*git rev-parse HEAD.*Replace the old `green:` line.*never touch another line/s.test(BR));
check('self-review: points to the green: rule instead of copying it', SR.includes('("Who writes `green:`")') && !SR.includes('never on `reused`'));
check('refactor: green: slot + writes per branch-review rule + uncommitted case',
  RF.includes('green: written <sha> | not written: <reason>') && RF.includes('Who writes `green:`') && /uncommitted[\s\S]*whoever commits/.test(RF));
check('refactor: free-text args = ledger mode', /## Ledger mode — `\$ARGUMENTS` empty or plain-text guidance/.test(RF) && RF.includes('pass the text to the\nworker as guidance'));
check('self-review: worker checks snippet uniqueness before reporting', /Before reporting an anchorable item, run its snippet's `grep -cF` check[\s\S]*see 1/.test(SR));

console.log(`\nTotal tests: ${passed + failed}\nPassed: ${passed}\nFailed: ${failed}`);
process.exit(failed ? 1 : 0);
