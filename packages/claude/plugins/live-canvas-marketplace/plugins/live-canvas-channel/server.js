#!/usr/bin/env node
/**
 * live-canvas-channel — MCP channel server for Claude Code.
 *
 * Two concurrent duties:
 *   1. HTTP listener (LIVE_CANVAS_PORT, default 8788) — accepts feedback
 *      POSTs from the Live Canvas overlay running in the browser. The
 *      overlay probes GET /health to decide Live vs Batch mode.
 *   2. MCP stdio server — declares the `experimental: claude/channel`
 *      capability and, on each valid POST, emits a
 *      `notifications/claude/channel` notification so the feedback lands
 *      in the active Claude turn.
 *
 * Protocol reference: https://code.claude.com/docs/en/channels-reference
 */

'use strict';

const http = require('http');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const PORT = Number(process.env.LIVE_CANVAS_PORT || 8788);
const SERVER_NAME = 'live-canvas';
const SERVER_VERSION = '0.1.0';

// ---------- MCP server ----------

const mcp = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: [
      'Events from the live-canvas channel arrive as <channel source="live-canvas" ...> tags.',
      'Each event is a single click-to-annotate comment made by the user on a UI variant in their browser.',
      'Tag attributes: target (component name), variant (A-F), selector (CSS selector of the clicked element),',
      'tagName (HTML tag), commentId (unique id). The body is the user\'s feedback text.',
      'When one arrives: acknowledge the feedback briefly, then edit the corresponding variant file',
      'in .claude-design/lab/ using the selector to locate the element. This is a one-way channel —',
      'no reply tool; respond to the user in chat as you would any normal message.',
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

// Human-readable body the assistant will see inside the Claude turn.
function formatContent(target, comment) {
  const { variant, element, text } = comment;
  const label = element.textContent ? `, ${element.tagName} with "${element.textContent}"` : '';
  return [
    `[LIVE-CANVAS ${variant} · ${target}] ${text}`,
    `  selector: \`${element.selector}\`${label}`,
    `  comment_id: ${comment.id}`,
  ].join('\n');
}

// All values in `meta` must be strings per the claude/channel contract.
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

// ---------- HTTP server ----------

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel: SERVER_NAME, port: PORT }));
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
        // MCP transport not yet connected or closed — still ack the HTTP
        // caller so the overlay doesn't false-negative.
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`[live-canvas] port ${PORT} in use — another session likely owns it; exiting.\n`);
    process.exit(0);
  }
  process.stderr.write(`[live-canvas] http error: ${err}\n`);
  process.exit(1);
});

// ---------- startup ----------

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  server.listen(PORT, '127.0.0.1', () => {
    process.stderr.write(`[live-canvas] listening on 127.0.0.1:${PORT}\n`);
  });
}

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });

main().catch((err) => {
  process.stderr.write(`[live-canvas] fatal: ${err}\n`);
  process.exit(1);
});
