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
  ['no last-review.md -> RUN (no green: line)', () => repo(), w => w === 'RUN (no green: line)'],
  ['green at HEAD -> REUSE', () => { const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`); return d; },
    w => w === 'REUSE green: ' + w.split('green: ')[1] && w.includes('npm test exit 0 10 passed')],
  ['green, then docs/ + root README.md commit -> REUSE', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'docs/x.md', 'd'); commit(d, 'README.md', 'r'); return d; }, w => w.startsWith('REUSE ')],
  ['green, then src/x.js commit -> RUN', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'src/x.js', 'x'); return d; }, w => /^RUN \(green [0-9a-f]{7}, changed: src\/x\.js\)$/.test(w)],
  ['green, docs commit, then src commit -> RUN', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'docs/x.md', 'd'); commit(d, 'src/x.js', 'x'); return d; }, w => /^RUN \(green [0-9a-f]{7}, changed: src\/x\.js\)$/.test(w)],
  ['green, two src commits + docs commit -> reason lists only the non-docs files, space-separated', () => {
    const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    commit(d, 'src/b.js', 'b'); commit(d, 'src/c.js', 'c'); commit(d, 'docs/x.md', 'd'); commit(d, 'README.md', 'r'); return d; },
    w => /^RUN \(green [0-9a-f]{7}, changed: src\/b\.js src\/c\.js\)$/.test(w)],
  ['green sha not an ancestor (after reset) -> RUN', () => {
    const d = repo(); commit(d, 'docs/y.md', 'y'); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')} npm test exit 0 10 passed`);
    git(d, 'reset', '-q', '--hard', 'HEAD~1'); return d; }, w => /^RUN \(green [0-9a-f]{7} not an ancestor of HEAD\)$/.test(w)],
  ['malformed green (short sha) -> RUN', () => { const d = repo(); writeGreen(d, 'green: abc123 npm test exit 0 1 passed'); return d; }, w => w === 'RUN (no green: line)'],
  ['malformed green (no command) -> RUN', () => { const d = repo(); writeGreen(d, `green: ${git(d, 'rev-parse', 'HEAD')}`); return d; }, w => w === 'RUN (no green: line)'],
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
check('release: reused-vs-RUN cross-check stops, against the Phase 0 line', /says `reused`\s+but the Phase 0 line starts `RUN \(` → \*\*stop\*\*/.test(read(SPECS['release'])));

// Rules 1-4 pins. Claude kit only: widen to all kits at mirror time.
const BR = read(SPECS['branch-review']), SR = read(SPECS['self-review']), RE = read(SPECS['release']);
const RF = read('packages/claude/skills/refactor/SKILL.md');
check('branch-review: owns the green: write rule (on RUN, after one full run, rev-parse, replace, no other line; never on REUSE)',
  /On `RUN`, write `green:`.*replace the record's `green:` line.*git rev-parse HEAD.*never touch another line.*Never write it on `REUSE`/s.test(BR));
check('self-review and release point to the branch-review write rule, no copy',
  SR.includes('("On `RUN`, write `green:`")') && RE.includes('write `green:` per `/branch-review` Stage 1') && !/grep -v '\^green: '/.test(SR + RE));
check('release: writes green: on RUN (gate rule), runs the full suite', /run the full suite once[\s\S]*on exit 0 write `green:`/.test(RE));
check('refactor: no green: slot, no post-commit full run, tests line is scoped only',
  !RF.includes('green: written') && !RF.includes('Who writes `green:`') && !RF.includes('then one full run') && !RF.includes('Never run it before the commit') && RF.includes('(scoped) | NOT RUN: <reason>') && !RF.includes('(scoped | full)'));
check('refactor: free-text args = ledger mode', /## Ledger mode — `\$ARGUMENTS` empty or plain-text guidance/.test(RF) && RF.includes('pass the text to the\nworker as guidance'));
check('self-review: worker-side snippet check gone, orchestrator Anchor rule kept', !/Before reporting an anchorable item/.test(SR) && SR.includes('**Anchor rule:**'));
check('self-review: works: is targeted only, never the full suite; no FULL-never-scoped header', /Run the thing and targeted checks[\s\S]*never the full suite/.test(SR) && !SR.includes('never\nscoped'));
check('branch-review: Who-writes / commit-first paragraph gone', !BR.includes('Who writes `green:`') && !BR.includes('Commit first, one full run after') && !BR.includes('without re-running'));

// Scoped-coding pins (claude kit only: widen to all kits at mirror time).
check('refactor: worker runs scoped tests only, never the full suite', /Worker: run scoped tests only[\s\S]*never the full suite/.test(RF));
check('refactor: tests line is reported scoped by the worker', RF.includes('The worker reports `tests:` as `scoped`'));

// Decider-reason, dev-rule and clarification pins (claude kit only: widen to all kits at mirror time).
check('decider prints its own reason; one line (no newline), REUSE and docs regex unchanged',
  DECIDER.includes('echo "RUN (no green: line)"') && DECIDER.includes("grep -vE '^(docs/|[^/]+\\.md$)'") && !DECIDER.includes('\n') && DECIDER.includes('echo "REUSE $(grep \'^green: \' "$f")"'));
for (const [k, rel] of Object.entries(SPECS)) {
  check(`${k}: tells the worker to copy the decider's reason into its line`,
    /copy the printed reason into the `(full-suite|tests):` line/.test(read(rel)));
}
check('self-review: full-suite slot allows unverified baseline', SR.includes('vs before <totals | unknown | unverified>') && SR.includes('`unverified` when the baseline is from an older sha'));
const AR = read('packages/claude/skills/remember/AGENT_RULES.md');
const DEV = AR.slice(AR.indexOf('<!-- DEV_RULES:START -->'), AR.indexOf('<!-- DEV_RULES:END -->'));
check('DEV_RULES: gates run the full suite, coding runs targeted tests only, docs-only skips',
  DEV.includes('Gates (/self-review, /branch-review, /release) run the full suite; coding runs targeted tests only — a gate skips the run and cites the last proof when only docs changed since.') && !DEV.includes('One full test run per code change') && (DEV.match(/full suite/g) || []).length === 1);

// Decide upfront: the orchestrator runs the decider after the dirty-tree check, before the worker section; the worker uses the line from its brief.
const ORDER = {
  'self-review': ['Dirty tree first', '## 2. Worker'],
  'branch-review': ['Before resolving anything, run `git status --porcelain`', '## Stage 1'],
  'release': ['The tree must be clean', '## Phase 0.5'],
};
for (const [k, [before, after]] of Object.entries(ORDER)) {
  const t = read(SPECS[k]), d = t.indexOf(lines[k] || '\0'), a = t.indexOf(before), b = t.indexOf(after);
  check(`${k}: decider block is after the dirty-tree check and before the worker section`, a >= 0 && b >= 0 && d > a && d < b, `dirty ${a} decider ${d} worker ${b}`);
  check(`${k}: exactly one decider block`, t.split(lines[k] || '\0').length === 2);
}
check('self-review: worker uses the decider line from its brief, never runs it', /decider line the orchestrator passed in your brief; never run the decider yourself, never decide/.test(SR) && SR.includes('Pass that exact output line to the worker in its brief'));
check('branch-review: worker uses the decider line from its brief, never runs it', /decider line the orchestrator passed in your brief \(never run the decider yourself, never decide\)/.test(BR) && BR.includes('Pass that exact output line to the worker in its brief'));
check('release: Phase 0.5 uses the Phase 0 line, never re-runs it', RE.includes('use the decider line printed in Phase 0 (never re-run it') && RE.includes('Pass that\n  exact line to any worker'));

console.log(`\nTotal tests: ${passed + failed}\nPassed: ${passed}\nFailed: ${failed}`);
process.exit(failed ? 1 : 0);
