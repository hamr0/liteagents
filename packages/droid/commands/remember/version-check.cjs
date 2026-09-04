#!/usr/bin/env node
'use strict';

/**
 * version-check.cjs — tells the user their liteagents install is behind the
 * registry, and nothing else.
 *
 * Run as step 0 of /remember, alongside friction.cjs. It rides along with a
 * memory consolidation run, so the only hard requirement is that it can never
 * cost that run anything: it exits 0 on every path, prints at most one line,
 * writes nothing but its own cache, and is bounded in wall-clock time.
 *
 * Deliberately NOT part of friction.cjs: that file mines friction signals, and
 * a registry lookup is an unrelated concern.
 *
 * A POC (2026-09-03) found the one non-obvious defect guarded here:
 * req.setTimeout is a socket-INACTIVITY timeout and does not bound connect
 * time. Against an unroutable host a 2000ms budget overran to 5146ms. Only an
 * explicit deadline bounds the total, so both are set.
 *
 * Environment:
 *   npm_config_registry            registry base (npm sets this; mirrors work)
 *   LITEAGENTS_INSTALLED_VERSION   skip local version discovery
 *   LITEAGENTS_SKIP_NPM_LOOKUP     skip the `npm ls -g` fallback (it is slow)
 *
 * Installed version is resolved in cost order: the installer's manifest stamp
 * (a file read), then our own package.json when run from a checkout, then
 * `npm ls -g` as a last resort. The last one costs ~500ms on EVERY run, which
 * is why the installer stamps the manifest at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG = 'liteagents';
// Per-kit config dir. This is the ONE line that differs across packages.
const CONFIG_DIR = '.factory';
const TTL_MS = 24 * 60 * 60 * 1000;
const DEADLINE_MS = 2000;
const NPM_LOOKUP_MS = 3000;

// --- version comparison --------------------------------------------------

/**
 * Is `b` a newer release than `a`? Numeric per component, so 2.9.0 < 2.10.0 —
 * a string compare gets that backwards. A prerelease suffix is stripped, so
 * 2.24.2-beta.1 counts as newer than 2.24.1: it is still a later release, and
 * a user on it does not need advice about 2.24.1.
 */
function isNewer(a, b) {
  const parse = (v) => String(v).trim().replace(/^v/, '').split('-')[0]
    .split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const d = (y[i] || 0) - (x[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// --- installed version ---------------------------------------------------

// Walk up from this file looking for our own package.json. Finds it when
// running from a checkout; finds nothing when installed into ~/.factory, which
// is why the npm fallback exists.
function versionFromPackageJson() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg && pkg.name === PKG && pkg.version) return String(pkg.version);
    } catch (e) { /* keep walking */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// The installer stamps the release it wrote into <install root>/manifest.json.
// version-check.cjs sits at <root>/<skills|commands|command>/remember/, so the root
// two levels up. This is the fast path: reading a file beats spawning npm.
function versionFromManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'manifest.json'), 'utf8'));
    // NOT m.version -- that is the manifest schema version, a different thing.
    return m && m.liteagents_version ? String(m.liteagents_version) : null;
  } catch (e) { return null; }
}

function versionFromNpm() {
  if (process.env.LITEAGENTS_SKIP_NPM_LOOKUP) return null;
  try {
    const r = require('child_process').spawnSync(
      'npm', ['ls', '-g', PKG, '--depth=0', '--json'],
      { encoding: 'utf8', timeout: NPM_LOOKUP_MS }
    );
    if (!r.stdout) return null;
    const deps = JSON.parse(r.stdout).dependencies || {};
    return deps[PKG] && deps[PKG].version ? String(deps[PKG].version) : null;
  } catch (e) { return null; }
}

function installedVersion() {
  const env = (process.env.LITEAGENTS_INSTALLED_VERSION || '').trim();
  if (env) return env;
  return versionFromManifest() || versionFromPackageJson() || versionFromNpm();
}

// --- cache ---------------------------------------------------------------

// Home-scoped, not per-repo: it describes the global install, so a per-repo
// cache would make every repo fetch the same answer.
function cachePath() {
  return path.join(os.homedir(), CONFIG_DIR, `.${PKG}-version.json`);
}

function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (typeof c.checked_at !== 'number' || typeof c.latest !== 'string') return null;
    if (Date.now() - c.checked_at > TTL_MS) return null;
    return c.latest;
  } catch (e) { return null; }
}

// Best effort. An unwritable cache dir means we re-fetch next run, never that
// we withhold the advice we already have.
function writeCache(latest) {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify({ checked_at: Date.now(), latest }));
  } catch (e) { /* not worth a word */ }
}

// --- registry ------------------------------------------------------------

function fetchLatest(cb) {
  let base = process.env.npm_config_registry || 'https://registry.npmjs.org/';
  if (!/\/$/.test(base)) base += '/';
  const url = `${base}${PKG}/latest`;

  let mod;
  try { mod = url.startsWith('http://') ? require('http') : require('https'); }
  catch (e) { return cb(null); }

  let settled = false;
  let req = null;
  const finish = (v) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    if (v === null && req) { try { req.destroy(); } catch (e) { /* */ } }
    cb(v);
  };

  // The hard bound. req.setTimeout below does not cover connect time.
  const deadline = setTimeout(() => finish(null), DEADLINE_MS);

  try {
    req = mod.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 1e6) finish(null); // a packument this big is not ours
      });
      res.on('end', () => {
        try {
          const v = JSON.parse(body).version;
          finish(typeof v === 'string' && v ? v : null);
        } catch (e) { finish(null); }
      });
      res.on('error', () => finish(null));
    });
    req.setTimeout(DEADLINE_MS, () => finish(null));
    req.on('error', () => finish(null));
  } catch (e) { finish(null); }
}

// --- main ----------------------------------------------------------------

function advise(installed, latest) {
  if (!installed || !latest) return;            // never guess
  if (!isNewer(installed, latest)) return;      // current, or ahead of the registry
  process.stdout.write(
    `liteagents ${installed} -> ${latest} available: `
    + `npm i -g ${PKG}@latest && ${PKG}\n`
  );
}

function main() {
  const installed = installedVersion();

  const cached = readCache();
  if (cached) return advise(installed, cached);

  fetchLatest((latest) => {
    if (!latest) return;                        // offline, slow, or broken: silent
    writeCache(latest);
    advise(installed, latest);
  });
}

if (require.main === module) {
  // Every failure is silent by contract. This command is a passenger; it does
  // not get to fail the run it is riding in.
  try { main(); } catch (e) { /* silent */ }
} 

module.exports = { isNewer };
