#!/usr/bin/env node

/**
 * live-canvas channel server: origin check behavioural tests
 *
 * Boots the REAL server.js (HTTP handler, routing and the origin check are all the real
 * file) with a tiny stand-in for @modelcontextprotocol/sdk (tests/live-canvas/sdk-stub,
 * found through NODE_PATH) because the plugin's node_modules are not installed in this repo.
 * Only the MCP stdio transport is faked. The server runs in `batch_open` mode, which has no
 * channels-flag gate; /feedback still emits a channel notification there (the stub writes it
 * to stdout), so "no notification" is a real assertion, with a positive control at the end.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', '..', 'packages', 'claude', 'plugins',
  'live-canvas-marketplace', 'plugins', 'live-canvas-channel', 'server.js');
const STUB = path.join(__dirname, 'sdk-stub');

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bright: '\x1b[1m' };
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ${colors.green}PASS${colors.reset} ${name}`); }
  else {
    failed++; failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  ${colors.red}FAIL${colors.reset} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-channel-'));
let child;
process.on('exit', () => {
  if (child) child.kill('SIGKILL');
  if (!process.env.KEEP_TMP) fs.rmSync(cwd, { recursive: true, force: true });
});

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let stdoutLines = [];
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  return null;
}

let PORT;
function request(method, urlPath, { origin, body, type } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin !== undefined) headers.Origin = origin;
    if (body !== undefined) { headers['Content-Type'] = type; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const feedback = id => JSON.stringify({
  version: '1.0', target: 'Card',
  comment: { id, variant: 'A', text: 'hi', element: { selector: '#x', tagName: 'DIV' } },
});
const notifications = () => stdoutLines.filter(l => l.includes('notifications/claude/channel'));

async function main() {
  PORT = await freePort();
  child = spawn(process.execPath, [SERVER], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_PATH: STUB, LIVE_CANVAS_PORT: String(PORT) },
  });
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    const parts = buf.split('\n'); buf = parts.pop();
    stdoutLines.push(...parts.filter(Boolean));
  });
  child.stderr.on('data', () => {});
  child.stdin.write(JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'batch_open', arguments: {} } }) + '\n');
  const opened = await waitFor(() => stdoutLines.find(l => l.startsWith('{"id":1')));
  check('batch_open binds the server', !!opened && /opened/.test(opened), String(opened));
  if (!opened) return;

  console.log('\n== foreign origins are refused ==');
  const before = notifications().length;
  let r = await request('POST', '/feedback', { origin: 'http://evil.example', body: feedback('foreign'), type: 'text/plain' });
  check('foreign-origin POST /feedback (text/plain) -> 403', r.status === 403, r.status);
  check('403 carries no Access-Control-Allow-Origin', r.headers['access-control-allow-origin'] === undefined);
  r = await request('POST', '/feedback', { origin: 'null', body: feedback('null'), type: 'text/plain' });
  check('Origin: null -> 403', r.status === 403, r.status);
  r = await request('POST', '/feedback', { origin: 'http://localhost.evil.example', body: feedback('suffix'), type: 'text/plain' });
  check('http://localhost.evil.example -> 403', r.status === 403, r.status);
  r = await request('OPTIONS', '/feedback', { origin: 'http://evil.example' });
  check('foreign OPTIONS preflight -> 403', r.status === 403, r.status);
  r = await request('GET', '/health', { origin: 'http://evil.example' });
  check('foreign GET /health -> 403', r.status === 403, r.status);
  r = await request('POST', '/feedback-jsonl', { origin: 'http://evil.example', body: '{"a":1}', type: 'text/plain' });
  check('foreign POST /feedback-jsonl -> 403', r.status === 403, r.status);
  check('no .claude-design/feedback.jsonl was written',
    !fs.existsSync(path.join(cwd, '.claude-design', 'feedback.jsonl')));

  console.log('\n== loopback origins and no Origin pass ==');
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:8080']) {
    r = await request('GET', '/health', { origin });
    check(`${origin} -> 200`, r.status === 200, r.status);
    check(`${origin} echoed back`, r.headers['access-control-allow-origin'] === origin,
      r.headers['access-control-allow-origin']);
    check(`${origin} gets Vary: Origin`, /origin/i.test(r.headers.vary || ''), r.headers.vary);
  }
  r = await request('OPTIONS', '/feedback', { origin: 'http://localhost:3000' });
  check('loopback OPTIONS preflight -> 204 with Allow-Headers',
    r.status === 204 && /content-type/i.test(r.headers['access-control-allow-headers'] || ''), r.status);
  r = await request('GET', '/health');
  check('no Origin -> 200', r.status === 200, r.status);
  check('no Origin -> no Access-Control-Allow-Origin', r.headers['access-control-allow-origin'] === undefined);

  console.log('\n== no channel notification from the refused POST ==');
  // Positive control first: a valid loopback POST must emit exactly one notification, so an
  // empty list for the refused one means something.
  r = await request('POST', '/feedback', { origin: 'http://localhost:3000', body: feedback('control'), type: 'text/plain' });
  check('loopback POST /feedback -> 200', r.status === 200, r.status);
  await waitFor(() => notifications().length > before);
  const n = notifications();
  check('exactly one notification, and it is the loopback control (not the foreign POST)',
    n.length === before + 1 && n[n.length - 1].includes('control') && !n.some(l => l.includes('foreign')),
    JSON.stringify(n));
}

main().catch(e => { failed++; failures.push(`crashed: ${e.stack || e}`); console.log(e); }).then(() => {
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`Total tests: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failed ? 1 : 0);
});
