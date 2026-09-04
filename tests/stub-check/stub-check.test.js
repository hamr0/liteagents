#!/usr/bin/env node

/**
 * stub-check.cjs behavioural tests
 *
 * Why this file exists: 21 of 37 measured local repos carried the pre-v2.19
 * `@`-include of AGENT_RULES.md, hot-loading ~300 lines into every session.
 * stub-check repairs that shape in place — so it EDITS a user-owned config
 * file, and the tests that matter are the ones proving it edits nothing but
 * the one line it claims, and never repoints an include at a missing file.
 *
 * Conventions follow tests/sync-rules/sync-rules.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'packages', 'claude', 'commands',
  'remember', 'stub-check.cjs');

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
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ${colors.green}PASS${colors.reset} ${name}`); }
  else {
    failed++; failures.push({ name, detail });
    console.log(`  ${colors.red}FAIL${colors.reset} ${name}`);
    if (detail) console.log(`       ${colors.yellow}${detail}${colors.reset}`);
  }
}

function run(repo) {
  const r = spawnSync(process.execPath, [SCRIPT, repo], { encoding: 'utf8', timeout: 20000 });
  return { status: r.status, stdout: (r.stdout || '').trim() };
}

const CFG = (repo) => path.join(repo, 'CLAUDE.md');
const read = (repo) => fs.readFileSync(CFG(repo), 'utf8');

/** A repo with a CLAUDE.md body; `withMemory` creates the file an include needs. */
function repoWith(body, { withMemory = true } = {}) {
  const repo = tmpDir('sc-');
  fs.writeFileSync(CFG(repo), body);
  if (withMemory) {
    fs.mkdirSync(path.join(repo, '.claude', 'remember'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'remember', 'MEMORY.md'), '# mem\n');
  }
  return repo;
}

// The shape as v2.19+ writes it. Kept verbatim so a drift in the real spec
// shows up here as a failing test rather than as silent divergence.
const CURRENT = `# proj

<!-- MEMORY:START -->
@.claude/remember/MEMORY.md
<!-- MEMORY:END -->

<!-- AGENT_RULES:START -->
**One writer per piece of state.** blah.

Standards guide (read when designing/building something new, not hot context):
.claude/remember/AGENT_RULES.md
<!-- AGENT_RULES:END -->
`;

const PRE_V219 = CURRENT.replace(
  '\n.claude/remember/AGENT_RULES.md', '\n@.claude/remember/AGENT_RULES.md');

console.log(`\n${colors.bright}${colors.cyan}stub-check.cjs${colors.reset}\n`);

// 1. Already current -> nothing at all. The common case: it must be silent and
//    must not rewrite the file (a rewrite would churn mtime for no reason).
{
  const repo = repoWith(CURRENT);
  const before = fs.statSync(CFG(repo)).mtimeMs;
  const r = run(repo);
  check('current shape: silent, exit 0', r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('current shape: file untouched byte-for-byte', read(repo) === CURRENT);
  check('current shape: not rewritten at all', fs.statSync(CFG(repo)).mtimeMs === before);
}

// 2. THE REPAIR THIS EXISTS FOR: the pre-v2.19 @-include is demoted.
{
  const repo = repoWith(PRE_V219);
  const r = run(repo);
  check('pre-v2.19 stub: reports the demotion',
    r.status === 0 && /AGENT_RULES pointer demoted/.test(r.stdout),
    `stdout=${JSON.stringify(r.stdout)}`);
  check('pre-v2.19 stub: repaired to exactly the current shape',
    read(repo) === CURRENT,
    JSON.stringify(read(repo)));
}

// 3. Only that one character changes. Proven by diffing line-by-line rather
//    than by trusting the report, because the risk here is collateral damage
//    to a user-owned file, not a missed repair.
{
  const repo = repoWith(PRE_V219);
  run(repo);
  const before = PRE_V219.split('\n');
  const after = read(repo).split('\n');
  const differing = before.map((l, i) => [i, l, after[i]]).filter(([, a, b]) => a !== b);
  check('repair touches exactly one line',
    before.length === after.length && differing.length === 1
      && differing[0][1] === '@.claude/remember/AGENT_RULES.md'
      && differing[0][2] === '.claude/remember/AGENT_RULES.md',
    JSON.stringify(differing));
}

// 4. Idempotent: a second run finds nothing to do. If this fails the script is
//    fighting itself and every /remember run would report a repair forever.
{
  const repo = repoWith(PRE_V219);
  run(repo);
  const r2 = run(repo);
  check('second run: silent and no further change',
    r2.stdout === '' && read(repo) === CURRENT,
    `stdout=${JSON.stringify(r2.stdout)}`);
}

// 5. Marker-scoped: an @-include of AGENT_RULES OUTSIDE the block is the user's
//    own prose and must survive untouched.
{
  const body = `@.claude/remember/AGENT_RULES.md\n\n${CURRENT}`;
  const repo = repoWith(body);
  const r = run(repo);
  check('outside the markers: left alone, silent',
    r.stdout === '' && read(repo) === body,
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 6. A bare @MEMORY.md resolves relative to its own file, so in a repo root it
//    names a file that does not exist and hot memory silently never loads.
{
  const repo = repoWith(CURRENT.replace('@.claude/remember/MEMORY.md', '@MEMORY.md'));
  const r = run(repo);
  check('bare @MEMORY.md: repaired to the explicit path',
    /MEMORY include repaired/.test(r.stdout) && read(repo) === CURRENT,
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 7. THE GUARD: never repoint an include at a file that is not there. An
//    un-migrated .claude/memory/ repo has a live MEMORY.md at the old path;
//    "fixing" the path would break a working include to satisfy a convention.
{
  const body = CURRENT.replace('@.claude/remember/MEMORY.md', '@.claude/memory/MEMORY.md');
  const repo = repoWith(body, { withMemory: false });
  const r = run(repo);
  check('missing target: reported, NOT repaired',
    /left as is/.test(r.stdout) && read(repo) === body,
    `stdout=${JSON.stringify(r.stdout)}`);
}
{
  // Same body, but the new path now exists -> the repair is safe and happens.
  const body = CURRENT.replace('@.claude/remember/MEMORY.md', '@.claude/memory/MEMORY.md');
  const repo = repoWith(body, { withMemory: true });
  const r = run(repo);
  check('target exists: repaired',
    /MEMORY include repaired/.test(r.stdout) && read(repo) === CURRENT,
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 8. Report-only shapes: a block that exists but carries no pointer at all.
{
  const repo = repoWith(
    '<!-- MEMORY:START -->\nsee memory\n<!-- MEMORY:END -->\n');
  const r = run(repo);
  check('MEMORY block with no include: reported, file unchanged',
    /no @-include/.test(r.stdout)
      && read(repo) === '<!-- MEMORY:START -->\nsee memory\n<!-- MEMORY:END -->\n',
    `stdout=${JSON.stringify(r.stdout)}`);
}
{
  const repo = repoWith(
    '<!-- AGENT_RULES:START -->\njust prose\n<!-- AGENT_RULES:END -->\n');
  const r = run(repo);
  check('AGENT_RULES block with no pointer: reported',
    /no path pointer/.test(r.stdout), `stdout=${JSON.stringify(r.stdout)}`);
}

// 9. Missing markers are step 5's business, not this script's.
{
  const repo = repoWith('# just a readme\n');
  const r = run(repo);
  check('no markers: silent, unchanged',
    r.stdout === '' && read(repo) === '# just a readme\n',
    `stdout=${JSON.stringify(r.stdout)}`);
}
{
  // An unterminated pair is not a block. Editing it would mean guessing where
  // it ends, and a guess in a user-owned file is worse than doing nothing.
  const repo = repoWith(
    '<!-- AGENT_RULES:START -->\n@.claude/remember/AGENT_RULES.md\n');
  const r = run(repo);
  check('unterminated block: not edited',
    r.stdout === '' && /^@/m.test(read(repo)),
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 10. No config file at all: silent, exit 0 (step 5 creates one).
{
  const repo = tmpDir('sc-none-');
  const r = run(repo);
  check('no CLAUDE.md: silent, exit 0', r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 11. Unwritable config: reported, exit 0, original intact. Like sync-rules,
//     this rides on /remember and must never fail the run it rides in.
{
  const repo = repoWith(PRE_V219);
  fs.chmodSync(CFG(repo), 0o400);
  const r = run(repo);
  fs.chmodSync(CFG(repo), 0o600);
  check('unwritable config: reported, exit 0',
    r.status === 0 && /not repaired/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('unwritable config: original intact', read(repo) === PRE_V219);
}

// 12. Both defects in one file are both repaired in one pass.
{
  const body = CURRENT
    .replace('@.claude/remember/MEMORY.md', '@MEMORY.md')
    .replace('\n.claude/remember/AGENT_RULES.md', '\n@.claude/remember/AGENT_RULES.md');
  const repo = repoWith(body);
  const r = run(repo);
  check('both defects: both repaired, both reported',
    /MEMORY include repaired/.test(r.stdout) && /demoted/.test(r.stdout)
      && read(repo) === CURRENT,
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 13. a symlinked config is reported, never repaired through. Writing through
//     it would edit a file belonging to another repo — the user's projects sit
//     side by side, so a relative link is a short hop.
{
  const outside = tmpDir('sc-outside-');
  const victim = path.join(outside, 'victim.md');
  fs.writeFileSync(victim, PRE_V219);

  const repo = tmpDir('sc-link-');
  fs.mkdirSync(path.join(repo, '.claude', 'remember'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'remember', 'MEMORY.md'), '# mem\n');
  fs.symlinkSync(victim, CFG(repo));

  const r = run(repo);
  check('symlinked config: the file it points at is left byte-identical',
    fs.readFileSync(victim, 'utf8') === PRE_V219,
    fs.readFileSync(victim, 'utf8').slice(0, 60));
  check('symlinked config: reported, not silently skipped, exit 0',
    r.status === 0 && /leaves the repo via a symlink/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 14. negative control — a repo reached through a symlinked PATH is still
//     repaired; only a symlinked config file itself is refused.
{
  const real = repoWith(PRE_V219);
  const link = path.join(path.dirname(real), path.basename(real) + '-link');
  fs.symlinkSync(real, link);
  const r = run(link);
  check('repo reached via a symlinked path is still repaired',
    read(real) === CURRENT, `stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(link, { force: true });
}

// 15. an in-repo symlinked config is repaired, not refused. Same defect as
//     sync-rules test 10: only a link that actually leaves the repo is an escape.
{
  const repo = tmpDir('sc-inrepo-');
  fs.mkdirSync(path.join(repo, 'cfg'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.claude', 'remember'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'remember', 'MEMORY.md'), '# mem\n');
  fs.writeFileSync(path.join(repo, 'cfg', 'real.md'), PRE_V219);
  fs.symlinkSync('cfg/real.md', CFG(repo));

  const r = run(repo);
  check('in-repo symlinked config: not refused as an escape',
    !/leaves the repo/.test(r.stdout), JSON.stringify(r.stdout));
  check('in-repo symlinked config: repaired through the link',
    fs.readFileSync(path.join(repo, 'cfg', 'real.md'), 'utf8') === CURRENT,
    fs.readFileSync(path.join(repo, 'cfg', 'real.md'), 'utf8').slice(0, 60));
}

console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
console.log(`Total tests: ${passed + failed}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
if (failed) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
process.exit(failed ? 1 : 0);
