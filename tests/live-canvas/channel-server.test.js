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

// Tool call on the main server (ids 100+). Returns the parsed tool result.
let nextId = 100;
async function tool(name) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ id, method: 'tools/call', params: { name, arguments: {} } }) + '\n');
  const line = await waitFor(() => stdoutLines.find(l => l.startsWith(`{"id":${id},`)));
  return JSON.parse(JSON.parse(line).result.content[0].text);
}
const reopen = async () => { await tool('channel_close'); return tool('batch_open'); };

// A second, throwaway server. withFlag=true launches it under a parent whose argv carries
// --dangerously-load-development-channels, which is what channel_open checks for.
const MID = `const { spawn } = require('child_process');
spawn(process.execPath, [process.env.LC_SERVER], { stdio: 'inherit' });`;
function boot(port, withFlag) {
  const env = { ...process.env, NODE_PATH: STUB, LIVE_CANVAS_PORT: String(port), LC_SERVER: SERVER };
  const midFile = path.join(cwd, 'mid.js');
  fs.writeFileSync(midFile, MID);
  const args = withFlag ? [midFile, '--dangerously-load-development-channels'] : [SERVER];
  const c = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; let b = '';
  c.stdout.on('data', d => { b += d; const p = b.split('\n'); b = p.pop(); lines.push(...p.filter(Boolean)); });
  c.stderr.on('data', () => {});
  extra.push(c);
  return {
    c,
    async tool(name) {
      const id = nextId++;
      c.stdin.write(JSON.stringify({ id, method: 'tools/call', params: { name, arguments: {} } }) + '\n');
      const line = await waitFor(() => lines.find(l => l.startsWith(`{"id":${id},`)), 5000);
      return JSON.parse(JSON.parse(line).result.content[0].text);
    },
  };
}
const extra = [];
process.on('exit', () => extra.forEach(c => c.kill('SIGKILL')));

let PORT;
function request(method, urlPath, { origin, body, type } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin !== undefined) headers.Origin = origin;
    if (body !== undefined) { headers['Content-Type'] = type; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
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
    await reopen(); // the first loopback origin is pinned, so start each from a fresh pin
    r = await request('GET', '/health', { origin });
    check(`${origin} -> 200`, r.status === 200, r.status);
    check(`${origin} echoed back`, r.headers['access-control-allow-origin'] === origin,
      r.headers['access-control-allow-origin']);
    check(`${origin} gets Vary: Origin`, /origin/i.test(r.headers.vary || ''), r.headers.vary);
  }
  await reopen();
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

  console.log('\n== origin pinning ==');
  await reopen();
  r = await request('GET', '/health', { origin: 'http://localhost:3000' });
  check('first loopback origin is accepted (pinned)', r.status === 200, r.status);
  const nBefore = notifications().length;
  r = await request('POST', '/feedback', { origin: 'http://localhost:4000', body: feedback('other'), type: 'text/plain' });
  check('a different loopback origin -> 403', r.status === 403, r.status);
  r = await request('POST', '/feedback-jsonl', { origin: 'http://localhost:4000', body: '{"a":1}', type: 'text/plain' });
  check('a different loopback origin cannot write /feedback-jsonl -> 403', r.status === 403, r.status);
  await sleep(150);
  check('no notification and nothing written for the other origin',
    notifications().length === nBefore && !fs.existsSync(path.join(cwd, '.claude-design', 'feedback.jsonl')));
  r = await request('GET', '/health', { origin: 'http://localhost:3000' });
  check('the pinned origin still works', r.status === 200, r.status);
  r = await request('GET', '/health');
  check('no Origin still passes while pinned', r.status === 200, r.status);
  await reopen();
  r = await request('GET', '/health', { origin: 'http://localhost:4000' });
  check('pin resets when the channel is closed', r.status === 200, r.status);

  console.log('\n== /feedback-jsonl: one line per record, bounded ==');
  await reopen();
  const jl = path.join(cwd, '.claude-design', 'feedback.jsonl');
  r = await request('POST', '/feedback-jsonl', { body: '{\n  "a": 1,\n  "b": [\n 2 ]\n}\n', type: 'text/plain' });
  check('multi-line JSON body -> 200', r.status === 200, r.status);
  r = await request('POST', '/feedback-jsonl', { body: '{"c":3}', type: 'text/plain' });
  const lines = fs.readFileSync(jl, 'utf8').split('\n');
  check('each POST is exactly one line', lines.length === 3 && lines[2] === '' && lines[0] === '{"a":1,"b":[2]}' && lines[1] === '{"c":3}',
    JSON.stringify(lines));
  r = await request('POST', '/feedback-jsonl', { body: '{not json', type: 'text/plain' });
  check('unparseable body -> 400', r.status === 400, r.status);
  r = await request('POST', '/feedback-jsonl', { body: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }), type: 'text/plain' });
  check('300KB body -> 413', r.status === 413, r.status);
  check('rejected posts wrote nothing', fs.readFileSync(jl, 'utf8').split('\n').length === 3);
  // fill the file to just under the 5MB total cap, then one more record must be refused
  fs.writeFileSync(jl, ('x'.repeat(1023) + '\n').repeat(5 * 1024 - 1));
  const sizeBefore = fs.statSync(jl).size;
  r = await request('POST', '/feedback-jsonl', { body: JSON.stringify({ pad: 'y'.repeat(2000) }), type: 'text/plain' });
  check('over the total cap -> 413 with a clear message', r.status === 413 && /full|cap/i.test(r.body), `${r.status} ${r.body}`);
  check('file did not grow past the cap', fs.statSync(jl).size === sizeBefore);

  console.log('\n== live channel: /feedback-jsonl works while the channel is open ==');
  const livePort = await freePort();
  const live = boot(livePort, true);
  const op = await live.tool('channel_open');
  check('channel_open (flag present) -> opened', op.status === 'opened', JSON.stringify(op));
  PORT = livePort;
  r = await request('POST', '/feedback-jsonl', { body: '{"live":true}', type: 'text/plain' });
  check('POST /feedback-jsonl while channel is open -> 200', r.status === 200, r.status);

  console.log('\n== messages the skill prints ==');
  const plain = boot(await freePort(), false);
  const nc = await plain.tool('channel_open');
  check('no flag -> no_channel_capability', nc.status === 'no_channel_capability', JSON.stringify(nc));
  check('relaunch message carries the full steps',
    /NEW terminal/.test(nc.message) && /live-claude/.test(nc.message) && /\/live-canvas/.test(nc.message) && /JSON/.test(nc.message), nc.message);
  const busyPort = await freePort();
  const blocker = net.createServer(); await new Promise(res => blocker.listen(busyPort, '127.0.0.1', res));
  const busy = boot(busyPort, true);
  const bz = await busy.tool('channel_open');
  blocker.close();
  check('busy port -> in_use', bz.status === 'in_use', JSON.stringify(bz));
  check('busy message carries the steps (stop it, re-run /live-canvas, or pick JSON)',
    /re-run \/live-canvas/.test(bz.message) && /JSON/.test(bz.message), bz.message);

  console.log('\n== overlay: Finish box opens in Live mode (source pin, not a browser run) ==');
  const overlay = fs.readFileSync(path.join(__dirname, '..', '..', 'packages', 'claude', 'skills',
    'live-canvas', 'templates', 'overlay-vanilla.js'), 'utf8');
  const guard = overlay.split('\n').find(l => l.includes("showToast('No feedback yet')") || /if \(.*state\.comments\.length === 0\) \{/.test(l));
  check('"No feedback yet" guard exempts live mode',
    !!guard && /!isLive\s*&&/.test(guard), guard);
  check('overlay doc points batchEndpoint at the channel server',
    overlay.includes("batchEndpoint: 'http://localhost:8788/feedback-jsonl'"));
}

main().catch(e => { failed++; failures.push(`crashed: ${e.stack || e}`); console.log(e); }).then(() => {
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`Total tests: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failed ? 1 : 0);
});
