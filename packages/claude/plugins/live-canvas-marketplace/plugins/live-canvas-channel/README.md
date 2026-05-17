# live-canvas-channel

Claude Code channel plugin that bridges the Live Canvas browser overlay to a running Claude session. Each Save in the overlay becomes a `notifications/claude/channel` event — Claude reacts immediately without the user leaving the browser.

## How it fits

```
┌──────────────────┐   POST /feedback    ┌───────────────────┐   MCP stdio  ┌──────────────┐
│ Overlay in page  │ ──────────────────▶ │ live-canvas-      │ ──────────▶  │ Claude Code  │
│ (any framework)  │ ◀── 200/ok ────────│ channel (node)    │              │ session      │
└──────────────────┘                    └───────────────────┘              └──────────────┘
```

- HTTP listener: `127.0.0.1:8788` (override with `LIVE_CANVAS_PORT`)
- `GET /health` — overlay probes this to confirm Live mode is reachable
- `POST /feedback` — wire-compatible with the overlay's v1.0 schema
- stdio: MCP protocol using `@modelcontextprotocol/sdk`

## Install (local dev)

```bash
# Point Claude at this marketplace (one-time)
claude /plugin marketplace add /absolute/path/to/live-canvas-marketplace

# Install the plugin from it
claude /plugin install live-canvas-channel@live-canvas-marketplace
```

The marketplace directory is the parent that contains `.claude-plugin/marketplace.json`.

## Activate the channel on a session

**Channels are in research preview and custom channels aren't on the approved allowlist.** `/plugin install` spawns the MCP server but does NOT auto-subscribe the session. To receive channel events, start a fresh Claude session with the development flag:

```bash
claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace
```

You'll see a confirmation prompt the first time. After confirming, channel events arrive in the assistant's context wrapped as `<channel source="live-canvas" ...>...</channel>` tags.

Requirements: Claude Code v2.1.80+, claude.ai login (not API key or Console auth). On Team/Enterprise, channels must be explicitly enabled by the admin.

## First run

```bash
cd /path/to/live-canvas-marketplace/plugins/live-canvas-channel
npm install
```

This installs `@modelcontextprotocol/sdk`. After that, `/plugin install` can launch `server.js` on demand.

## Debugging standalone

The process expects stdio to be held open (Claude Code does this; the shell doesn't unless you trick it):

```bash
LIVE_CANVAS_PORT=8788 tail -f /dev/null | node server.js
```

Then in another terminal:

```bash
curl http://localhost:8788/health
curl -X POST http://localhost:8788/feedback \
  -H 'content-type: application/json' \
  -d '{"version":"1.0","target":"PostCard","comment":{"id":"test","variant":"A","element":{"selector":"button","tagName":"button","textContent":"Like"},"text":"too small"}}'
```

## Protocol emitted

| Method | When | Params |
|---|---|---|
| `notifications/claude/channel` | Valid feedback POST | `{ content: string, meta: Record<string,string> }` |

**content** — human-readable text delivered to the active Claude turn:

```
[LIVE-CANVAS A · PostCard] too small
  selector: `button`, button with "Like"
  comment_id: test
```

**meta** — machine-structured fields the assistant can parse: `source`, `target`, `variant`, `selector`, `tagName`, `commentId`.

## Failure modes

- **Port in use** — another Claude session owns 8788. Logs to stderr and exits; overlay health probe fails; overlay falls back to JSON mode silently. The skill itself never silently degrades — it stops and asks the user.
- **Invalid payload** — HTTP 400 with reason; no notification emitted.
- **MCP transport not connected** — HTTP call still returns 200 (so the overlay shows "pushed"), but stderr logs the drop. Avoids false-negative toasts.
