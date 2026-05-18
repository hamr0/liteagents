#!/usr/bin/env node
/**
 * live-canvas-channel — MCP channel server for Claude Code.
 *
 * Three duties:
 *   1. MCP stdio server — connects at startup so `/mcp` shows green in
 *      every Claude session, even sessions that never touch live-canvas.
 *   2. Tools `channel_open` / `channel_close` — lazily bind/release the
 *      HTTP listener on LIVE_CANVAS_PORT (default 8788). Only the session
 *      that calls `channel_open` owns the port; other sessions stay idle.
 *   3. HTTP listener (only while open) — accepts feedback POSTs from the
 *      browser overlay and emits a `notifications/claude/channel`
 *      notification into the owning session's turn.
 *
 * Protocol reference: https://code.claude.com/docs/en/channels-reference
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const PORT = Number(process.env.LIVE_CANVAS_PORT || 8788);
const SERVER_NAME = 'live-canvas';
const SERVER_VERSION = '0.5.0';

// ---------- MCP server ----------

const mcp = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: [
      'Events from the live-canvas channel arrive as <channel source="live-canvas" ...> tags.',
      'Each event is a single click-to-annotate comment made by the user on a UI variant in their browser.',
      'Tag attributes: target (component name), variant (A-F), selector (CSS selector of the clicked element),',
      'tagName (HTML tag), commentId (unique id). The body is the user\'s feedback text.',
      'When one arrives: acknowledge the feedback briefly, then edit the corresponding variant file',
      'in .claude-design/lab/ using the selector to locate the element. This is a one-way channel —',
      'no reply tool; respond to the user in chat as you would any normal message.',
      'Before entering Live mode, call the channel_open tool; on exit or abort, call channel_close.',
    ].join(' '),
  }
);

async function emitChannel(content, meta) {
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta },
  });
}

// ---------- HTTP helpers ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { req.destroy(); reject(new Error('payload too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function validate(payload) {
  if (!payload || payload.version !== '1.0') return 'version must be "1.0"';
  if (typeof payload.target !== 'string') return 'target required';
  const c = payload.comment;
  if (!c || typeof c !== 'object') return 'comment required';
  if (!c.variant || !/^[A-F]$/.test(c.variant)) return 'invalid variant';
  if (!c.element || typeof c.element.selector !== 'string') return 'element.selector required';
  if (typeof c.text !== 'string') return 'comment.text required';
  return null;
}

function formatContent(target, comment) {
  const { variant, element, text } = comment;
  const label = element.textContent ? `, ${element.tagName} with "${element.textContent}"` : '';
  return [
    `[LIVE-CANVAS ${variant} · ${target}] ${text}`,
    `  selector: \`${element.selector}\`${label}`,
    `  comment_id: ${comment.id}`,
  ].join('\n');
}

function buildMeta(target, comment) {
  return {
    source: 'live-canvas',
    target,
    variant: comment.variant,
    selector: comment.element.selector,
    tagName: comment.element.tagName,
    commentId: comment.id,
  };
}

// ---------- HTTP server (created but not bound) ----------

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel: SERVER_NAME, port: PORT }));
    return;
  }

  if (req.method === 'POST' && req.url === '/feedback-jsonl') {
    // JSON-mode batch endpoint: appends the submitted payload to
    // <parent claude cwd>/.claude-design/feedback.jsonl so the user doesn't
    // have to download a file and paste. No capability gate — JSON mode
    // doesn't depend on the experimental channels flag.
    try {
      const raw = await readBody(req);
      JSON.parse(raw); // validate JSON only — schema is overlay-defined
      const dir = path.join(process.cwd(), '.claude-design');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'feedback.jsonl');
      fs.appendFileSync(file, raw.trim() + '\n');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: file }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/feedback') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);
      const err = validate(payload);
      if (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err }));
        return;
      }

      try {
        await emitChannel(
          formatContent(payload.target, payload.comment),
          buildMeta(payload.target, payload.comment)
        );
      } catch (e) {
        process.stderr.write(`[live-canvas] notify failed: ${e.message || e}\n`);
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  res.writeHead(404); res.end();
});

// ---------- channel capability check ----------

// Channels are still an experimental Claude Code feature. They only deliver
// `<channel>` tags into sessions launched with --dangerously-load-development-channels.
// Without that flag, a plain `claude` session can still load the MCP and bind the
// port, but every notification we emit is silently dropped — producing the
// "POST 200, but nothing landed" black hole. Detect by inspecting the parent
// claude's command-line; refuse to bind from non-qualifying sessions.
const RELAUNCH_HINT = 'Restart this session with: live-claude  (or: claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace)';

function parentHasChannelsFlag() {
  const FLAG = '--dangerously-load-development-channels';
  const ppid = process.ppid;

  // Linux: /proc/<pid>/cmdline is NUL-separated argv. Fast, no subprocess.
  try {
    const raw = require('fs').readFileSync(`/proc/${ppid}/cmdline`, 'utf8');
    return raw.split('\0').some((arg) => arg === FLAG);
  } catch { /* fall through */ }

  // macOS / BSD / any POSIX without /proc: `ps -p <pid> -o args=` prints the
  // full command line. Whitespace splits are fine here — the flag is a single
  // token with no quoting needed.
  if (process.platform !== 'win32') {
    try {
      const out = require('child_process')
        .execFileSync('ps', ['-p', String(ppid), '-o', 'args='], { encoding: 'utf8', timeout: 1000 });
      return out.split(/\s+/).some((arg) => arg === FLAG);
    } catch { /* fall through */ }
  }

  // Windows: `wmic process where processid=<pid> get commandline /value`
  // emits "CommandLine=<full string>". We split on whitespace then match.
  if (process.platform === 'win32') {
    try {
      const out = require('child_process')
        .execFileSync('wmic', ['process', 'where', `processid=${ppid}`, 'get', 'commandline', '/value'], { encoding: 'utf8', timeout: 1500 });
      return out.split(/\s+/).some((arg) => arg === FLAG);
    } catch { /* fall through */ }
  }

  // Couldn't determine — fail closed. Better a wrong "no_channel_capability"
  // error than a silent black hole. User can read the message and rerun.
  return false;
}

// ---------- lazy bind / release ----------

// Resolve who's holding `port`. Tries `ss` first (fast on Linux), then `lsof`
// (cross-platform). Returns null if we can't tell.
function findPortHolder(port) {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('ss', ['-lntpH', `sport = :${port}`], { encoding: 'utf8', timeout: 800 });
    const m = out.match(/pid=(\d+)/);
    if (m) return Number(m[1]);
  } catch { /* not Linux or ss unavailable */ }
  try {
    const out = execFileSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 800 });
    const first = out.trim().split('\n')[0];
    const pid = Number(first);
    if (pid > 0) return pid;
  } catch { /* lsof missing */ }
  return null;
}

// True iff `pid` is another instance of THIS server.js running as the same uid.
// "Same plugin binary + same user" is the criterion for safe takeover — it can
// only be another /live-canvas in another of this user's Claude sessions.
function isMyPluginServer(pid) {
  if (!pid || pid === process.pid) return false;
  const myUid = (typeof process.getuid === 'function') ? process.getuid() : null;

  // Linux: read /proc/<pid>/cmdline + /proc/<pid>/status
  try {
    const cmdline = require('fs').readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (!cmdline.split('\0').includes(__filename)) return false;
    if (myUid !== null) {
      const status = require('fs').readFileSync(`/proc/${pid}/status`, 'utf8');
      const m = status.match(/^Uid:\s+(\d+)/m);
      if (m && Number(m[1]) !== myUid) return false;
    }
    return true;
  } catch { /* fall through */ }

  // macOS / BSD: ps args + ps user
  try {
    const { execFileSync } = require('child_process');
    const args = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 800 });
    if (!args.includes(__filename)) return false;
    if (myUid !== null) {
      const uidOut = execFileSync('ps', ['-p', String(pid), '-o', 'uid='], { encoding: 'utf8', timeout: 800 });
      if (Number(uidOut.trim()) !== myUid) return false;
    }
    return true;
  } catch { /* fall through */ }

  return false;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// One bind attempt. Resolves on success/EADDRINUSE; rejects on other errors.
function tryBind() {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE') resolve(false);
      else reject(err);
    };
    server.once('error', onError);
    server.listen(PORT, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(true);
    });
  });
}

async function openChannel() {
  const cap = parentHasChannelsFlag();
  if (cap === false) {
    return {
      status: 'no_channel_capability',
      port: PORT,
      message: `This Claude session was launched without --dangerously-load-development-channels — channel notifications would be silently dropped. ${RELAUNCH_HINT}`,
    };
  }
  if (server.listening) return { status: 'already_listening', port: PORT };

  if (await tryBind()) {
    process.stderr.write(`[live-canvas] listening on 127.0.0.1:${PORT}\n`);
    return { status: 'opened', port: PORT };
  }

  // Port busy. If the holder is another instance of this same plugin running
  // as the same uid, take it over — same user, same binary, definitionally
  // safe. (The flag gate above already authorized this caller for channels.)
  const holder = findPortHolder(PORT);
  if (holder && isMyPluginServer(holder)) {
    process.stderr.write(`[live-canvas] taking over port ${PORT} from sibling pid ${holder}\n`);
    try { process.kill(holder, 'SIGTERM'); } catch { /* already gone */ }

    // Poll for the port to free (the sibling's shutdown closes its listener).
    for (let i = 0; i < 15; i++) {
      await sleep(100);
      if (await tryBind()) {
        process.stderr.write(`[live-canvas] listening on 127.0.0.1:${PORT} (took over from pid ${holder})\n`);
        return { status: 'opened', port: PORT, took_over: holder };
      }
    }
    // Last resort — SIGKILL the holdout, one more try.
    try { process.kill(holder, 'SIGKILL'); } catch {}
    await sleep(200);
    if (await tryBind()) {
      process.stderr.write(`[live-canvas] listening on 127.0.0.1:${PORT} (force-killed pid ${holder})\n`);
      return { status: 'opened', port: PORT, took_over: holder, force_killed: true };
    }
    return {
      status: 'in_use',
      port: PORT,
      holder_pid: holder,
      message: `Tried to take over port ${PORT} from sibling pid ${holder} but it wouldn't release. Manual cleanup needed: kill -9 ${holder}`,
    };
  }

  // Held by something else (different plugin, different user, or unknown).
  return {
    status: 'in_use',
    port: PORT,
    holder_pid: holder,
    message: holder
      ? `Port ${PORT} is held by pid ${holder} (not a live-canvas server). Stop that process or pick JSON mode. To inspect: ps -fp ${holder}`
      : `Port ${PORT} is held by an unknown process. Find it with: ss -lntp | grep ${PORT}`,
  };
}

function closeChannel() {
  if (!server.listening) {
    return Promise.resolve({ status: 'not_listening', port: PORT });
  }
  return new Promise((resolve) => {
    server.close(() => {
      process.stderr.write(`[live-canvas] released port ${PORT}\n`);
      resolve({ status: 'closed', port: PORT });
    });
  });
}

// JSON-mode bind. No flag gate — channels aren't used, only /feedback-jsonl.
// Lets a plain `claude` session bind the port so overlay submissions write
// straight to <cwd>/.claude-design/feedback.jsonl instead of triggering a
// browser download.
function openBatch() {
  if (server.listening) {
    return Promise.resolve({ status: 'already_listening', port: PORT });
  }
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE') {
        resolve({
          status: 'in_use',
          port: PORT,
          message: `Port ${PORT} is held by another live-canvas session. JSON-mode submissions in this session will fall back to browser download instead of writing to .claude-design/feedback.jsonl.`,
        });
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(PORT, '127.0.0.1', () => {
      server.off('error', onError);
      process.stderr.write(`[live-canvas] listening on 127.0.0.1:${PORT} (batch-only, no channels)\n`);
      resolve({ status: 'opened', port: PORT });
    });
  });
}

// ---------- tools ----------

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'channel_open',
      description: 'Bind the live-canvas HTTP listener on port 8788 so the browser overlay can POST feedback into this session. Call once when entering Live mode. Returns {status, port, message?, took_over?, holder_pid?}. status: "opened" (bound, possibly after taking over a sibling live-canvas server — `took_over` is set to the prior pid if so), "already_listening" (we already had it), "in_use" (held by something that is NOT another live-canvas; `holder_pid` and `message` describe it), or "no_channel_capability" (this session lacks --dangerously-load-development-channels — show the user the message and stop, do not proceed to Live mode).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'channel_close',
      description: 'Release the live-canvas HTTP listener so another session can claim it. Call on /live-canvas cleanup, abort, or when the user is done with Live mode. Returns {status: "closed" | "not_listening", port}.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'batch_open',
      description: 'Bind the live-canvas HTTP listener on port 8788 for JSON mode only (no channel notifications, no flag required). Call this in JSON mode so the browser overlay can POST submissions to /feedback-jsonl which writes to <cwd>/.claude-design/feedback.jsonl. Returns {status: "opened" | "already_listening" | "in_use", port, message?}. If status is "in_use", JSON submissions fall back to browser download.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  let result;
  if (name === 'channel_open') {
    result = await openChannel();
  } else if (name === 'channel_close') {
    result = await closeChannel();
  } else if (name === 'batch_open') {
    result = await openBatch();
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ---------- startup / shutdown ----------

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  // When the MCP host disconnects (session closed, /reload-plugins), release
  // the port if we were holding it. Without this the next bind hits EADDRINUSE.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    if (server.listening) {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    } else {
      process.exit(0);
    }
  };
  transport.onclose = shutdown;
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
}

process.on('SIGTERM', () => {
  if (server.listening) server.close(() => process.exit(0));
  else process.exit(0);
});
process.on('SIGINT', () => {
  if (server.listening) server.close(() => process.exit(0));
  else process.exit(0);
});

main().catch((err) => {
  process.stderr.write(`[live-canvas] fatal: ${err}\n`);
  process.exit(1);
});
