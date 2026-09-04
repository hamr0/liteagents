#!/usr/bin/env node

/**
 * sync-rules.cjs behavioural tests
 *
 * Why this file exists: AGENT_RULES.md was bootstrapped once and never
 * refreshed, so 35 measured repos drifted many releases behind. sync-rules
 * refreshes it on every /remember run, which means it OVERWRITES a file users
 * may have edited — so the tests that matter are the ones proving nothing is
 * destroyed without a recoverable copy.
 *
 * Conventions follow tests/friction/friction.test.js: self-contained,
 * ephemeral tmpdirs, negative controls so the suite can prove it can FAIL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'packages', 'claude', 'skills',
  'remember', 'sync-rules.cjs');
const TEMPLATE = path.join(__dirname, '..', '..', 'packages', 'claude', 'skills',
  'remember', 'AGENT_RULES.md');

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

// Build an isolated copy of the script + its template, so tests never depend on
// the repo's own .claude/ and a template edit here cannot touch the real one.
function isolatedScript(templateBody) {
  const dir = tmpDir('sr-kit-');
  fs.copyFileSync(SCRIPT, path.join(dir, 'sync-rules.cjs'));
  fs.writeFileSync(path.join(dir, 'AGENT_RULES.md'), templateBody);
  return path.join(dir, 'sync-rules.cjs');
}

function run(script, repo) {
  const r = spawnSync(process.execPath, [script, repo], { encoding: 'utf8', timeout: 20000 });
  return { status: r.status, stdout: (r.stdout || '').trim() };
}

const P = (repo, ...rest) => path.join(repo, '.claude', 'remember', ...rest);

console.log(`\n${colors.bright}${colors.cyan}sync-rules.cjs${colors.reset}\n`);

// 1. absent -> bootstrapped
{
  const script = isolatedScript('RULES v2\n');
  const repo = tmpDir('sr-fresh-');
  const r = run(script, repo);
  check('absent: creates the file from the template',
    r.status === 0 && fs.existsSync(P(repo, 'AGENT_RULES.md'))
      && fs.readFileSync(P(repo, 'AGENT_RULES.md'), 'utf8') === 'RULES v2\n'
      && /created/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('absent: no backup is written for a file that never existed',
    !fs.existsSync(P(repo, 'AGENT_RULES.md.bak')));
}

// 2. identical -> nothing at all (negative control for tests 1 and 3)
{
  const script = isolatedScript('RULES v2\n');
  const repo = tmpDir('sr-same-');
  fs.mkdirSync(P(repo), { recursive: true });
  fs.writeFileSync(P(repo, 'AGENT_RULES.md'), 'RULES v2\n');
  const before = fs.statSync(P(repo, 'AGENT_RULES.md')).mtimeMs;
  const r = run(script, repo);
  const after = fs.statSync(P(repo, 'AGENT_RULES.md')).mtimeMs;
  check('identical: silent, no output',
    r.status === 0 && r.stdout === '', `stdout=${JSON.stringify(r.stdout)}`);
  check('identical: file is not rewritten (mtime unchanged)', before === after,
    `before=${before} after=${after}`);
  check('identical: no backup file appears',
    !fs.existsSync(P(repo, 'AGENT_RULES.md.bak')));
}

// 3. differs -> old body preserved byte-identical, new body in place
{
  const script = isolatedScript('RULES v3\n');
  const repo = tmpDir('sr-diff-');
  fs.mkdirSync(P(repo), { recursive: true });
  const mine = 'MY OWN RULES, hand written\nwith a second line\n';
  fs.writeFileSync(P(repo, 'AGENT_RULES.md'), mine);
  const r = run(script, repo);
  check('differs: new template is in place',
    fs.readFileSync(P(repo, 'AGENT_RULES.md'), 'utf8') === 'RULES v3\n');
  check('differs: previous body preserved BYTE-IDENTICAL in the backup',
    fs.existsSync(P(repo, 'AGENT_RULES.md.bak'))
      && fs.readFileSync(P(repo, 'AGENT_RULES.md.bak'), 'utf8') === mine,
    `bak=${JSON.stringify(fs.existsSync(P(repo, 'AGENT_RULES.md.bak'))
      ? fs.readFileSync(P(repo, 'AGENT_RULES.md.bak'), 'utf8') : null)}`);
  check('differs: says so, and names the backup',
    /updated/.test(r.stdout) && /AGENT_RULES\.md\.bak/.test(r.stdout),
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 4. THE ACCEPTED TRADE, pinned: the single backup is overwritten, so a
//    customised body survives exactly ONE update. Asserted so the limitation is
//    executable rather than prose, and so changing it is a deliberate act.
{
  const repo = tmpDir('sr-trade-');
  fs.mkdirSync(P(repo), { recursive: true });
  const mine = 'MY OWN RULES\n';
  fs.writeFileSync(P(repo, 'AGENT_RULES.md'), mine);

  run(isolatedScript('RULES v3\n'), repo);     // release 1
  check('single backup: after one update it holds the user body',
    fs.readFileSync(P(repo, 'AGENT_RULES.md.bak'), 'utf8') === mine);

  run(isolatedScript('RULES v4\n'), repo);     // release 2
  check('single backup: after a SECOND update it holds v3, not the user body '
      + '(accepted trade, PRD §5)',
    fs.readFileSync(P(repo, 'AGENT_RULES.md.bak'), 'utf8') === 'RULES v3\n',
    `bak=${JSON.stringify(fs.readFileSync(P(repo, 'AGENT_RULES.md.bak'), 'utf8'))}`);
}

// 5. missing template -> loud, never silent, exit 0
{
  const dir = tmpDir('sr-notpl-');
  fs.copyFileSync(SCRIPT, path.join(dir, 'sync-rules.cjs'));  // no AGENT_RULES.md beside it
  const repo = tmpDir('sr-notpl-repo-');
  const r = run(path.join(dir, 'sync-rules.cjs'), repo);
  check('missing template: reported loudly, exit 0',
    r.status === 0 && /not synced/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('missing template: writes nothing',
    !fs.existsSync(P(repo, 'AGENT_RULES.md')));
}

// 6. unwritable target -> reported, exit 0, original untouched
{
  const script = isolatedScript('RULES v3\n');
  const repo = tmpDir('sr-ro-');
  fs.mkdirSync(P(repo), { recursive: true });
  fs.writeFileSync(P(repo, 'AGENT_RULES.md'), 'MINE\n');
  fs.chmodSync(P(repo), 0o500);
  const r = run(script, repo);
  fs.chmodSync(P(repo), 0o700);
  check('unwritable dir: reported, exit 0',
    r.status === 0 && /not synced/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('unwritable dir: original left intact',
    fs.readFileSync(P(repo, 'AGENT_RULES.md'), 'utf8') === 'MINE\n');
}

// 7. the real shipped template is what a real repo would receive
{
  const repo = tmpDir('sr-real-');
  const r = run(SCRIPT, repo);
  check('real template: syncs the shipped AGENT_RULES.md byte-identically',
    r.status === 0
      && fs.readFileSync(P(repo, 'AGENT_RULES.md')).equals(fs.readFileSync(TEMPLATE)),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 8. a symlinked target is refused, never followed. Three routes out, and a
//    guard on only one of them is false safety:
//      a) the target is a DANGLING link — reads as "absent", still followed
//      b) a parent directory is a link pointing outside the repo
//      c) the target is a live link to a file outside the repo
//    /remember runs across a whole fleet, so a relative link only has to reach
//    a sibling checkout to make this repo's run write into another one.
{
  const script = isolatedScript('RULES v9\n');
  const outside = tmpDir('sr-outside-');

  // a) dangling link
  {
    const repo = tmpDir('sr-dangle-');
    fs.mkdirSync(P(repo), { recursive: true });
    fs.symlinkSync(path.join(outside, 'planted.md'), P(repo, 'AGENT_RULES.md'));
    const r = run(script, repo);
    check('dangling target link: nothing created outside the repo',
      !fs.existsSync(path.join(outside, 'planted.md')),
      `created ${path.join(outside, 'planted.md')}`);
    check('dangling target link: refused loudly, exit 0',
      r.status === 0 && /leaves the repo via a symlink/.test(r.stdout),
      `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  }

  // b) parent directory link
  {
    const repo = tmpDir('sr-pdir-');
    const away = tmpDir('sr-away-');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.symlinkSync(away, path.join(repo, '.claude', 'remember'));
    const r = run(script, repo);
    check('parent dir link: nothing written through it',
      !fs.existsSync(path.join(away, 'AGENT_RULES.md')),
      `wrote ${path.join(away, 'AGENT_RULES.md')}`);
    check('parent dir link: refused loudly',
      /leaves the repo via a symlink/.test(r.stdout), JSON.stringify(r.stdout));
  }

  // c) live link to an existing file outside the repo
  {
    const repo = tmpDir('sr-live-');
    const victim = path.join(outside, 'victim.md');
    fs.writeFileSync(victim, 'SOMEONE ELSE\n');
    fs.mkdirSync(P(repo), { recursive: true });
    fs.symlinkSync(victim, P(repo, 'AGENT_RULES.md'));
    run(script, repo);
    check('live link out: the target file is left byte-identical',
      fs.readFileSync(victim, 'utf8') === 'SOMEONE ELSE\n',
      fs.readFileSync(victim, 'utf8').slice(0, 40));
  }
}

// 9. negative control — the guard must not refuse an ordinary repo, nor one
//    merely REACHED through a symlinked path, which is a normal setup.
{
  const script = isolatedScript('RULES v9\n');
  const real = tmpDir('sr-real2-');
  const link = path.join(path.dirname(real), path.basename(real) + '-link');
  fs.symlinkSync(real, link);
  const r = run(script, link);
  check('repo reached via a symlinked path is still synced',
    r.status === 0 && fs.readFileSync(P(real, 'AGENT_RULES.md'), 'utf8') === 'RULES v9\n',
    `stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(link, { force: true });
}

// 10. an in-repo symlink is NOT an escape. The first guard refused any link at
//     the leaf regardless of where it pointed, so a repo keeping its rules
//     behind an in-repo symlink was stranded forever and told, wrongly, that
//     the path "leaves the repo".
{
  const script = isolatedScript('RULES v10\n');
  const repo = tmpDir('sr-inrepo-');
  fs.mkdirSync(path.join(repo, 'shared'), { recursive: true });
  fs.mkdirSync(P(repo), { recursive: true });
  fs.writeFileSync(path.join(repo, 'shared', 'rules.md'), 'MINE\n');
  fs.symlinkSync('../../shared/rules.md', P(repo, 'AGENT_RULES.md'));

  const r = run(script, repo);
  check('in-repo symlink: not refused as an escape',
    !/leaves the repo/.test(r.stdout), JSON.stringify(r.stdout));
  check('in-repo symlink: the repo ends up with the current rules',
    fs.readFileSync(P(repo, 'AGENT_RULES.md'), 'utf8') === 'RULES v10\n',
    fs.readFileSync(P(repo, 'AGENT_RULES.md'), 'utf8').slice(0, 40));
  // readlinkSync inside a try: pre-fix the run refuses, so no backup exists at
  // all, and an unguarded lstat would THROW and abort the whole suite instead of
  // failing this one check.
  let bakTarget = null;
  try { bakTarget = fs.readlinkSync(P(repo, 'AGENT_RULES.md.bak')); } catch (e) { /* absent */ }
  check('in-repo symlink: the user link is preserved as the backup',
    bakTarget === '../../shared/rules.md', `bak -> ${bakTarget}`);
  check('in-repo symlink: the file it pointed at is untouched',
    fs.readFileSync(path.join(repo, 'shared', 'rules.md'), 'utf8') === 'MINE\n');
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
