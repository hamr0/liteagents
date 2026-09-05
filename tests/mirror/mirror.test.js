#!/usr/bin/env node

/**
 * mirror.cjs behavioural tests — frontmatter freeze and orphan detection.
 *
 * Why this file exists: mirror.cjs's `shapes` subcommand used to derive
 * required/optional frontmatter keys from the files' own content and `check`
 * judged those same files against it, so dropping a key from EVERY file of a
 * kit and re-running `shapes` made the key silently stop being required — a
 * circular check. And `check` only ever walked packages/claude (sources()),
 * so a capability removed there left a stale copy behind in droid/opencode/
 * ampcode that nothing ever reported (a hand cleanup of 33 files in a
 * downstream mirror). scripts/frontmatter.json now freezes a shape that
 * `shapes` refuses to overwrite without --force, and `check` walks every
 * kit's own dirs looking for files with no matching packages/claude source.
 * These tests prove both: a weakened shape is refused and named, and an
 * orphaned file is reported no matter where it hides.
 *
 * Conventions follow tests/sync-rules/sync-rules.test.js: self-contained,
 * ephemeral tmpdirs, negative controls so the suite can prove it can FAIL.
 *
 * mirror.cjs resolves ROOT as path.resolve(__dirname, '..'), so every test
 * builds a miniature fake repo in a tmpdir (its own scripts/mirror.cjs,
 * scripts/frontmatter.json, packages/*) rather than touching this repo's
 * real packages/ tree — sync writes files, and check/shapes must never be
 * pointed at the real ROOT during a test run.
 *
 * Set MIRROR_SCRIPT to point at a different mirror.cjs (used to run this same
 * suite against the pre-freeze/pre-orphan commit as a failing-first proof).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = process.env.MIRROR_SCRIPT
  || path.join(__dirname, '..', '..', 'scripts', 'mirror.cjs');

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

// ---------------------------------------------------------------------------
// Fake-repo builders
// ---------------------------------------------------------------------------

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function copyRecursive(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dest, entry));
  } else {
    fs.copyFileSync(src, dest);
  }
}

const fm = (lines) => `---\n${lines.join('\n')}\n---\n`;

/** The 8 dirs mirror.cjs's DIRS map expects to exist (empty is fine). */
function emptyKitDirs(repo) {
  for (const d of [
    'packages/claude/agents', 'packages/claude/skills',
    'packages/droid/droids', 'packages/droid/commands',
    'packages/ampcode/agents', 'packages/ampcode/skills',
    'packages/opencode/agent', 'packages/opencode/command',
  ]) fs.mkdirSync(path.join(repo, d), { recursive: true });
}

/** A fresh fake repo with mirror.cjs copied in and the 8 shape dirs present. */
function newRepo(prefix) {
  const repo = tmpDir(prefix);
  writeFile(path.join(repo, 'scripts', 'mirror.cjs'), fs.readFileSync(SCRIPT));
  emptyKitDirs(repo);
  return repo;
}

function run(repo, mode, extraArgs = []) {
  const r = spawnSync(process.execPath,
    [path.join(repo, 'scripts', 'mirror.cjs'), mode, ...extraArgs],
    { encoding: 'utf8', timeout: 20000 });
  return { status: r.status, stdout: (r.stdout || ''), stderr: (r.stderr || '') };
}

/**
 * A fully self-consistent mirrored repo: one agent (foo) and one skill (bar,
 * with a bundled helper.cjs) present in all four kits, bodies matching after
 * substitution, frontmatter satisfying each kit's own shape, and a
 * frontmatter.json frozen to match — `check` should report nothing at all.
 */
function buildCleanRepo(prefix) {
  const repo = newRepo(prefix);
  const P = (...p) => path.join(repo, ...p);

  writeFile(P('packages/claude/agents/foo.md'),
    fm(['name: foo', 'description: Foo agent', 'model: sonnet', 'color: blue',
      'when_to_use: Use for foo things']) + 'Foo body text.\n');
  writeFile(P('packages/claude/skills/bar/SKILL.md'),
    fm(['name: bar', 'description: Bar skill', 'allowed-tools: Bash(git diff:*)']) + 'Bar body text.\n');
  const helperSrc = "// helper script\nconsole.log('hi');\n";
  writeFile(P('packages/claude/skills/bar/helper.cjs'), helperSrc);

  writeFile(P('packages/droid/droids/foo.md'),
    fm(['name: foo', 'description: Foo agent', 'model: sonnet', 'tools: Read, Write']) + 'Foo body text.\n');
  writeFile(P('packages/droid/commands/bar.md'),
    fm(['description: Bar skill']) + 'Bar body text.\n');
  writeFile(P('packages/droid/commands/bar/helper.cjs'), helperSrc);

  writeFile(P('packages/ampcode/agents/foo.md'),
    fm(['name: foo', 'description: Foo agent', 'model: sonnet', 'color: blue',
      'when_to_use: Use for foo things']) + 'Foo body text.\n');
  writeFile(P('packages/ampcode/skills/bar/SKILL.md'),
    fm(['name: bar', 'description: Bar skill', 'allowed-tools: Bash(git diff:*)']) + 'Bar body text.\n');
  writeFile(P('packages/ampcode/skills/bar/helper.cjs'), helperSrc);

  writeFile(P('packages/opencode/agent/foo.md'),
    fm(['name: foo', 'description: Foo agent', 'mode: subagent', 'temperature: 0.2',
      'tools: read, write', 'when_to_use: Use for foo things']) + 'Foo body text.\n');
  writeFile(P('packages/opencode/command/bar.md'),
    fm(['description: Bar skill']) + 'Bar body text.\n');
  writeFile(P('packages/opencode/command/bar/helper.cjs'), helperSrc);

  const shape = {
    frozen: '2026-01-01',
    subagent: {
      claude: { required: ['color', 'description', 'model', 'name', 'when_to_use'], optional: [], bashStyle: null },
      droid: { required: ['description', 'model', 'name', 'tools'], optional: [], bashStyle: null },
      ampcode: { required: ['color', 'description', 'model', 'name', 'when_to_use'], optional: [], bashStyle: null },
      opencode: { required: ['description', 'mode', 'name', 'temperature', 'tools', 'when_to_use'], optional: [], bashStyle: null },
    },
    command: {
      droid: { required: ['description'], optional: [], bashStyle: null },
      opencode: { required: ['description'], optional: [], bashStyle: null },
    },
    skill: {
      claude: { required: ['allowed-tools', 'description', 'name'], optional: [], bashStyle: 'colon' },
      ampcode: { required: ['allowed-tools', 'description', 'name'], optional: [], bashStyle: 'colon' },
    },
  };
  writeFile(P('scripts/frontmatter.json'), `${JSON.stringify(shape, null, 2)}\n`);
  return repo;
}

const orphanLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('ORPHAN'));

console.log(`\n${colors.bright}${colors.cyan}mirror.cjs${colors.reset}`);
console.log(`${colors.cyan}(against ${path.relative(process.cwd(), SCRIPT)})${colors.reset}\n`);

// ===========================================================================
// FREEZE (`shapes` subcommand)
// ===========================================================================

// 1. no existing frontmatter.json -> shapes writes one, with a frozen date.
{
  const repo = newRepo('mir-boot-');
  const shapeFile = path.join(repo, 'scripts', 'frontmatter.json');
  const r = run(repo, 'shapes');
  check('bootstrap: shapes exits 0', r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  const parsed = fs.existsSync(shapeFile) ? JSON.parse(fs.readFileSync(shapeFile, 'utf8')) : null;
  check('bootstrap: frontmatter.json is created and carries a frozen date',
    !!parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed.frozen),
    `parsed=${JSON.stringify(parsed)}`);
  check('bootstrap: stdout says it wrote the file', /wrote/.test(r.stdout), `stdout=${JSON.stringify(r.stdout)}`);
}

// A shared repo for tests 2-6: two agent files (foo, baz) with an identical
// key set, so removing a key from BOTH is a shape-wide weakening.
const AGENT_KEYS = ['name: %s', 'description: %s agent', 'model: sonnet', 'color: blue', 'when_to_use: Use for %s things'];
function writeAgentPair(repo, keys) {
  for (const name of ['foo', 'baz']) {
    writeFile(path.join(repo, 'packages/claude/agents', `${name}.md`),
      fm(keys.map((k) => k.replace(/%s/g, name))) + `${name} body.\n`);
  }
}

const weakenRepo = newRepo('mir-weaken-');
writeAgentPair(weakenRepo, AGENT_KEYS);
const shapeFile = path.join(weakenRepo, 'scripts', 'frontmatter.json');
run(weakenRepo, 'shapes'); // establish the baseline frozen shape (includes when_to_use)
const baseline = fs.readFileSync(shapeFile);

// 2. computed shape matches frozen -> exit 0, no rewrite.
{
  const before = fs.statSync(shapeFile).mtimeMs;
  const beforeBytes = fs.readFileSync(shapeFile);
  const r = run(weakenRepo, 'shapes');
  const after = fs.statSync(shapeFile).mtimeMs;
  check('matches frozen: exits 0', r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  check('matches frozen: file is not rewritten',
    before === after && beforeBytes.equals(fs.readFileSync(shapeFile)),
    `before=${before} after=${after}`);
  check('matches frozen: says there is nothing to do',
    /nothing to do/.test(r.stdout), `stdout=${JSON.stringify(r.stdout)}`);
}

// Now remove the required key from EVERY file of the kit.
writeAgentPair(weakenRepo, AGENT_KEYS.slice(0, 4)); // drops when_to_use from both

// 3. shapes refuses to silently demote a key that vanished from every file.
{
  const r = run(weakenRepo, 'shapes');
  check('weakening: shapes exits non-zero', r.status !== 0, `status=${r.status}`);
  check('weakening: frontmatter.json is NOT rewritten',
    fs.readFileSync(shapeFile).equals(baseline),
    `unchanged=${fs.readFileSync(shapeFile).equals(baseline)}`);
  check('weakening: stderr names the key and calls it WEAKENING',
    /WEAKENING/.test(r.stderr) && /when_to_use/.test(r.stderr),
    `stderr=${JSON.stringify(r.stderr)}`);
}

// 5. `check` (not shapes) independently catches the same regression, because
//    the frozen file — not today's files — is the judge.
{
  const r = run(weakenRepo, 'check');
  check('check: exits non-zero on a required key missing from every file', r.status !== 0, `status=${r.status}`);
  check("check: stderr reports the missing required key 'when_to_use'",
    /missing required key 'when_to_use'/.test(r.stderr), `stderr=${JSON.stringify(r.stderr)}`);
}

// 4. --force deliberately re-records the weaker shape.
{
  const r = run(weakenRepo, 'shapes', ['--force']);
  check('force: exits 0', r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  const rewritten = fs.readFileSync(shapeFile);
  check('force: frontmatter.json IS rewritten', !rewritten.equals(baseline));
  const parsed = JSON.parse(rewritten.toString('utf8'));
  check('force: new shape stamps a frozen date and drops the vanished key from required',
    /^\d{4}-\d{2}-\d{2}$/.test(parsed.frozen) && !parsed.subagent.claude.required.includes('when_to_use'),
    `parsed=${JSON.stringify(parsed.subagent.claude)}`);
}

// 6. negative control: an ADDED key present in only ONE of the two files is a
//    plain change (optional key added), never WEAKENING.
{
  const postForce = fs.readFileSync(shapeFile);
  writeFile(path.join(weakenRepo, 'packages/claude/agents/foo.md'),
    fm(['name: foo', 'description: foo agent', 'model: sonnet', 'color: blue', 'extra_key: yes']) + 'foo body.\n');
  const r = run(weakenRepo, 'shapes');
  check('added optional key: shapes still refuses without --force (a diff exists)',
    r.status !== 0, `status=${r.status}`);
  check('added optional key: frontmatter.json is NOT rewritten',
    fs.readFileSync(shapeFile).equals(postForce));
  const addedLine = r.stderr.split('\n').find((l) => l.includes("'extra_key' added to optional"));
  check('added optional key: reported as a plain change, not WEAKENING',
    !!addedLine && !addedLine.startsWith('WEAKENING'),
    `line=${JSON.stringify(addedLine)}`);
}

// ===========================================================================
// ORPHANS (`check` subcommand)
// ===========================================================================

// 7. a clean, fully-mirrored repo reports no orphans and exits 0.
{
  const repo = buildCleanRepo('mir-clean-');
  const r = run(repo, 'check');
  check('clean repo: check exits 0', r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  check('clean repo: no ORPHAN lines at all', orphanLines(r.stderr).length === 0, r.stderr);
}

// 8-11: a repo with three planted orphans of different shapes, plus the
// clean repo's own legitimate bundled files, in one run — proving each stray
// is caught and no legitimate file is ever mistaken for one.
{
  const repo = buildCleanRepo('mir-orphans-');
  // 8. a stray top-level command file with no packages/claude source at all.
  writeFile(path.join(repo, 'packages/droid/commands/zzz-orphan.md'), 'stray, no source\n');
  // 9. a stray file living inside an otherwise-legitimate bundled asset dir —
  //    the shape that hid 33 real files in a downstream mirror.
  writeFile(path.join(repo, 'packages/droid/commands/bar/zzz-stale.cjs'), '// stale leftover\n');
  // 10. a whole orphaned skill directory in ampcode.
  writeFile(path.join(repo, 'packages/ampcode/skills/zzz-dead/SKILL.md'), fm(['name: zzz-dead', 'description: dead', 'allowed-tools: Read']) + 'dead\n');

  const r = run(repo, 'check');
  const orphans = orphanLines(r.stderr);
  check('planted orphans: check exits non-zero', r.status !== 0, `status=${r.status}`);
  check('stray top-level file: reported as ORPHAN',
    orphans.some((l) => l.includes('zzz-orphan.md')), r.stderr);
  check('stray file inside a legitimate bundled dir: reported as ORPHAN',
    orphans.some((l) => l.includes(path.join('bar', 'zzz-stale.cjs'))), r.stderr);
  check('orphaned skill directory: reported as ORPHAN',
    orphans.some((l) => l.includes(path.join('zzz-dead', 'SKILL.md'))), r.stderr);
  check('negative control: the legitimate sibling helper.cjs is NOT reported',
    !orphans.some((l) => l.includes(path.join('bar', 'helper.cjs'))), r.stderr);
  check('negative control: none of the genuinely mirrored files (foo.md, bar.md) are reported',
    !orphans.some((l) => /(^|\/)foo\.md:/.test(l) || /(^|\/)bar\.md:/.test(l)), r.stderr);
}

// 12. negative control: an EXEMPT entry's target file is still expected to
//     exist and must never be reported as an orphan (EXEMPT excuses body
//     checking only, per mirror.cjs's own checkOrphans comment).
{
  const repo = buildCleanRepo('mir-exempt-');
  // 'agent:orchestrator.md' is hardcoded EXEMPT in mirror.cjs.
  writeFile(path.join(repo, 'packages/claude/agents/orchestrator.md'),
    fm(['name: orchestrator', 'description: Orchestrator', 'model: sonnet', 'color: blue', 'when_to_use: Route work']) + 'claude-only body.\n');
  writeFile(path.join(repo, 'packages/droid/droids/orchestrator.md'),
    fm(['name: orchestrator', 'description: Orchestrator', 'model: sonnet', 'tools: Read']) + 'droid-only body, deliberately different.\n');
  writeFile(path.join(repo, 'packages/ampcode/agents/orchestrator.md'),
    fm(['name: orchestrator', 'description: Orchestrator', 'model: sonnet', 'color: blue', 'when_to_use: Route work']) + 'ampcode-only body, deliberately different.\n');
  writeFile(path.join(repo, 'packages/opencode/agent/orchestrator.md'),
    fm(['name: orchestrator', 'description: Orchestrator', 'mode: subagent', 'temperature: 0.2', 'tools: read', 'when_to_use: Route work']) + 'opencode-only body, deliberately different.\n');

  const r = run(repo, 'check');
  const orphans = orphanLines(r.stderr);
  check('exempt entry: its target files across all kits are NOT reported as orphans',
    !orphans.some((l) => l.includes('orchestrator.md')), r.stderr);
  check('exempt entry: overall check still exits 0 (bodies differ but are excused)',
    r.status === 0, `status=${r.status} stderr=${r.stderr}`);
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
