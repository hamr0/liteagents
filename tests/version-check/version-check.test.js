#!/usr/bin/env node

/**
 * version-check.cjs behavioural tests
 *
 * Why this file exists: /remember gains a step-0 nudge telling the user their
 * liteagents install is behind the registry. The nudge is worthless if it can
 * ever block, crash, or hang the memory run it rides along with, so the
 * failure paths are the point of this suite, not the happy path.
 *
 * A POC (2026-09-03) found the defect these tests pin: req.setTimeout is a
 * socket-INACTIVITY timeout and does not bound connect time. Against an
 * unroutable host a 2000ms budget overran to 5146ms. Only an explicit deadline
 * bounds it.
 *
 * Conventions follow tests/friction/friction.test.js:
 *   1. Self-contained. HOME is redirected into an ephemeral tmpdir and the
 *      registry is a local http server, so no test touches the real network,
 *      the real ~/.claude, or the real npm registry. A suite that reaches the
 *      network is a suite that fails on a plane.
 *   2. Negative controls included, so the suite can prove it can FAIL.
 */

const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'packages', 'claude', 'skills',
  'remember', 'version-check.cjs');

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

// --- harness -------------------------------------------------------------

// A local registry stub. It MUST run in its own process: the parent drives the
// script under test with spawnSync, which blocks this event loop, so an
// in-process server could never answer the child's request.
const SERVER_SRC = `
const http = require('http');
const fs = require('fs');
const v = process.env.STUB_VERSION;
const srv = http.createServer((req, res) => {
  if (v === '') { res.writeHead(500); res.end('{}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ name: 'liteagents', version: v }));
});
srv.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.env.STUB_PORT_FILE, String(srv.address().port));
});
`;

function sleepSync(ms) {
  const ia = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(ia, 0, 0, ms);
}

// version === null means "always 500"
function startRegistry(version) {
  const dir = tmpDir('vc-stub-');
  const portFile = path.join(dir, 'port');
  const child = require('child_process').spawn(
    process.execPath, ['-e', SERVER_SRC],
    { env: Object.assign({}, process.env, {
        STUB_VERSION: version === null ? '' : version,
        STUB_PORT_FILE: portFile,
      }), stdio: 'ignore' }
  );
  const started = Date.now();
  let port = null;
  while (Date.now() - started < 5000) {
    try { port = fs.readFileSync(portFile, 'utf8').trim(); } catch (e) { /* not yet */ }
    if (port) break;
    sleepSync(25);
  }
  if (!port) { child.kill('SIGKILL'); throw new Error('registry stub failed to bind'); }
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => { try { child.kill('SIGKILL'); } catch (e) { /* */ } },
  };
}

// Run the script with HOME redirected and a chosen registry + installed version.
function run({ home, registry, installed, extraEnv = {}, script = SCRIPT }) {
  const env = Object.assign({}, process.env, {
    HOME: home,
    LITEAGENTS_INSTALLED_VERSION: installed,
    npm_config_registry: registry,
  }, extraEnv);
  const started = Date.now();
  const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 30000 });
  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    elapsed: Date.now() - started,
  };
}

function cachePath(home) {
  return path.join(home, '.claude', '.liteagents-version.json');
}

// --- tests ---------------------------------------------------------------

console.log(`\n${colors.bright}${colors.cyan}version-check.cjs${colors.reset}\n`);

// 1. behind -> prints advice
{
  const home = tmpDir('vc-behind-');
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  check('behind: prints the advice line',
    r.status === 0 && /2\.24\.1/.test(r.stdout) && /2\.25\.0/.test(r.stdout)
      && /npm i -g liteagents@latest/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 2. current -> silent (negative control for test 1)
{
  const home = tmpDir('vc-current-');
  const srv = startRegistry('2.24.1');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  check('current: prints nothing',
    r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 3. ahead of registry -> silent (local build newer than published)
{
  const home = tmpDir('vc-ahead-');
  const srv = startRegistry('2.24.1');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.25.0' });
  srv.close();
  check('ahead of registry: prints nothing',
    r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 4. writes a cache
{
  const home = tmpDir('vc-cache-write-');
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cachePath(home), 'utf8')); } catch (e) { /* */ }
  check('writes the version cache',
    cached && cached.latest === '2.25.0' && typeof cached.checked_at === 'number',
    `cache=${JSON.stringify(cached)}`);
}

// 5. warm cache is used with the registry DOWN -- proves no network on the warm path
{
  const home = tmpDir('vc-cache-use-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(cachePath(home),
    JSON.stringify({ checked_at: Date.now(), latest: '2.99.0' }));
  // port 9 is discard; nothing listens. If it fetches, it cannot get 2.99.0.
  const r = run({ home, registry: 'http://127.0.0.1:9/', installed: '2.24.1' });
  check('warm cache: used without any network call',
    r.status === 0 && /2\.99\.0/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)} elapsed=${r.elapsed}ms`);
}

// 6. stale cache (>24h) is refetched
{
  const home = tmpDir('vc-cache-stale-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(cachePath(home),
    JSON.stringify({ checked_at: Date.now() - 25 * 3600 * 1000, latest: '2.99.0' }));
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  check('stale cache: refetched, not reused',
    r.status === 0 && /2\.25\.0/.test(r.stdout) && !/2\.99\.0/.test(r.stdout),
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 7. corrupt cache does not crash
{
  const home = tmpDir('vc-cache-corrupt-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(cachePath(home), 'not json{{{');
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  check('corrupt cache: recovers, exit 0',
    r.status === 0 && /2\.25\.0/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 8. registry 500 -> silent, exit 0
{
  const home = tmpDir('vc-500-');
  const srv = startRegistry(null); // always 500
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  check('registry error: silent, exit 0',
    r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 9. THE POC DEFECT: unroutable host must be bounded by the deadline.
//    192.0.2.1 is TEST-NET-1 (RFC 5737) and is guaranteed unroutable.
//    Pre-fix this took 5146ms against a 2000ms budget.
{
  const home = tmpDir('vc-unroutable-');
  const r = run({ home, registry: 'http://192.0.2.1/', installed: '2.24.1' });
  check('unroutable host: silent, exit 0',
    r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  check('unroutable host: bounded under 3.5s (deadline, not socket timeout)',
    r.elapsed < 3500,
    `elapsed=${r.elapsed}ms -- req.setTimeout alone overran to 5146ms in the POC`);
}

// 10. unknown installed version -> silent, never guesses.
//     Exercises the real INSTALLED layout: a copy with no package.json above
//     it, so the walk-up finds nothing, and the slow npm lookup disabled.
{
  const home = tmpDir('vc-unknown-');
  const isolated = tmpDir('vc-isolated-');
  const copy = path.join(isolated, 'version-check.cjs');
  fs.copyFileSync(SCRIPT, copy);
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '', script: copy,
    extraEnv: { LITEAGENTS_SKIP_NPM_LOOKUP: '1' } });
  srv.close();
  check('unknown installed version: silent, exit 0',
    r.status === 0 && r.stdout === '',
    `status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}

// 10b. the installer's manifest stamp is the fast path, and is PREFERRED over
//      the slow `npm ls -g` fallback. Laid out like a real install:
//      <root>/manifest.json + <root>/commands/remember/version-check.cjs
{
  const home = tmpDir('vc-manifest-');
  const root = tmpDir('vc-root-');
  const dir = path.join(root, 'commands', 'remember');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'version-check.cjs'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    tool: 'claude',
    version: '1.1.0',            // manifest SCHEMA version -- must be ignored
    liteagents_version: '2.20.0' // the one that counts
  }));
  const srv = startRegistry('2.25.0');
  const r = run({ home, registry: srv.url, installed: '',
    script: path.join(dir, 'version-check.cjs') });
  srv.close();
  check('manifest stamp: read as the installed version',
    r.status === 0 && /2\.20\.0/.test(r.stdout) && /2\.25\.0/.test(r.stdout),
    `stdout=${JSON.stringify(r.stdout)}`);
  check('manifest stamp: schema `version` is NOT mistaken for it',
    !/1\.1\.0/.test(r.stdout),
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 10c. a manifest without the stamp falls through rather than guessing
{
  const home = tmpDir('vc-manifest-none-');
  const root = tmpDir('vc-root-none-');
  const dir = path.join(root, 'commands', 'remember');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'version-check.cjs'));
  fs.writeFileSync(path.join(root, 'manifest.json'),
    JSON.stringify({ tool: 'claude', version: '1.1.0' })); // pre-stamp manifest
  const srv = startRegistry('2.25.0');
  const r = run({ home, registry: srv.url, installed: '',
    script: path.join(dir, 'version-check.cjs'),
    extraEnv: { LITEAGENTS_SKIP_NPM_LOOKUP: '1' } });
  srv.close();
  check('manifest without the stamp: silent, never guesses',
    r.status === 0 && r.stdout === '',
    `stdout=${JSON.stringify(r.stdout)}`);
}

// 11. unwritable cache dir must not crash the run
{
  const home = tmpDir('vc-nocache-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.chmodSync(path.join(home, '.claude'), 0o500); // read+execute, no write
  const srv = startRegistry('2.25.0');
  const reg = srv.url;
  const r = run({ home, registry: reg, installed: '2.24.1' });
  srv.close();
  fs.chmodSync(path.join(home, '.claude'), 0o700); // restore so cleanup works
  check('unwritable cache: still advises, exit 0',
    r.status === 0 && /2\.25\.0/.test(r.stdout),
    `status=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
}

// 12. semver comparison, exported for direct testing
{
  let isNewer = null;
  try { ({ isNewer } = require(SCRIPT)); } catch (e) { /* not built yet */ }
  const cases = [
    ['2.24.1', '2.24.1', false],
    ['2.24.1', '2.24.2', true],
    ['2.24.1', '2.25.0', true],
    ['2.24.1', '3.0.0', true],
    ['2.25.0', '2.24.1', false],
    ['2.9.0', '2.10.0', true],   // string compare gets this wrong
    ['2.10.0', '2.9.0', false],  // negative control for the above
    ['2.24.1', '2.24.2-beta.1', true],
  ];
  if (typeof isNewer !== 'function') {
    check('isNewer is exported', false, 'module does not export isNewer');
  } else {
    const bad = cases.filter(([a, b, exp]) => isNewer(a, b) !== exp);
    check('isNewer: 8/8 including 2.9.0 -> 2.10.0',
      bad.length === 0,
      bad.map(([a, b, e]) => `${a}->${b} expected ${e}`).join('; '));
  }
}

// --- summary -------------------------------------------------------------

// Summary format is a contract with tests/run-all-tests.js, which parses
// /Total tests:\s+(\d+)/, /Passed:\s+(\d+)/ and /Failed:\s+(\d+)/. Emit
// anything else and the runner reads 0 tests and fails the count floor.
console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
console.log(`Total tests: ${passed + failed}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
if (failed) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
process.exit(failed ? 1 : 0);
