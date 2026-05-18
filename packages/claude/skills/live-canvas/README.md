# Live Canvas

Click-to-annotate UI design tool for Claude Code. Renders N variants of a component or page in your browser, you click an element and type what to change, and Claude edits the variant file while you watch in the browser. No window switching, no pasted JSON.

Ships as a Claude Code skill plus an MCP channel plugin. Works in every tool liteagents supports (Claude, Droid, Amp, Opencode), but **Live mode only works in Claude Code** — other tools run in JSON mode only (see modes below).

---

## How it works

```
 ┌──────────────────────┐      POST /feedback        ┌─────────────────────┐
 │ Overlay in browser   │ ─────────────────────────► │ live-canvas-channel │
 │ (vanilla JS, ~500 lines)│                            │ (Node MCP server)   │
 └──────────────────────┘                            └──────────┬──────────┘
           ▲                                                     │
           │ dev server hot-reloads the page                     │ notifications/
           │ after Claude edits the variant                      │ claude/channel
           │                                                     ▼
 ┌──────────────────────┐                            ┌─────────────────────┐
 │ Dev server (yours)   │ ◄──── Claude edits ─────── │ Claude Code session │
 │ e.g. pnpm dev :3000  │        variant file        │ (with --dangerously-│
 └──────────────────────┘                            │ load-development-   │
                                                     │ channels flag)      │
                                                     └─────────────────────┘
```

Each Save in the overlay streams into the Claude session as a `<channel>` tag with the variant, element selector, and user comment. Claude edits the corresponding `.claude-design/lab/variants/Variant<X>.tsx` file. Your dev server hot-reloads. You never leave the browser.

---

## Modes

The skill asks you which mode you want every time `/live-canvas` runs.

| Mode | Use when | What happens per Save |
|---|---|---|
| **Live** | You launched the session with `live-claude` (sets `--dangerously-load-development-channels`) | Comment streams into Claude's context; Claude edits the file; dev server hot-reloads. Toast: "Pushed to Claude ✨". |
| **JSON** | Any session, any tool (Claude, Droid, Amp, Opencode) | Comment stays local. On Submit it POSTs to a `/feedback-jsonl` route on the channel server, which writes to `<project>/.claude-design/feedback.jsonl`. Falls back to browser download only when the MCP isn't running (e.g. Droid/Amp/Opencode users). |

If you pick Live but the session lacks the channels flag, `channel_open` returns `no_channel_capability` and the skill prints the exact relaunch command — it never silently downgrades to JSON. If another live-canvas session is already holding port 8788, `channel_open` takes over (same plugin + same user = safe) and announces it. Foreign processes on 8788 (e.g. a stray dev server) are refused with the holder's pid so you know what to investigate.

---

## One-time setup (Live mode, Claude Code only)

Run this once per machine. Without it, the skill still works in JSON mode.

### 1. Run the installer

```bash
bash packages/claude/plugins/live-canvas-marketplace/setup.sh
```

The installer:
- copies the marketplace into `~/.claude/plugins/live-canvas-marketplace/` (overwrites any prior install)
- runs `npm install` inside the channel plugin
- adds a `live-claude` shell function to `~/.zshrc` and `~/.bashrc` (idempotent — re-runs replace in place)

### 2. Register the marketplace in Claude Code

```
/plugin marketplace add ~/.claude/plugins/live-canvas-marketplace
```

### 3. Install the plugin

```
/plugin install live-canvas-channel@live-canvas-marketplace
```

### 4. Open a fresh shell

`live-claude` is now available. Use plain `claude` for everything else; use `live-claude` when you want Live mode for this skill.

---

## Everyday use

### Start a session

Either `claude` (JSON only) or `live-claude` (Live available).

### Invoke the skill in a project

```
/live-canvas
```

Phase 0 always asks which mode you want — Live channel or JSON file — then calls the MCP tool that binds (or refuses) port 8788:

| Choice | `channel_open` / `batch_open` result | Skill behavior |
|---|---|---|
| Live | `opened` | ✨ Live mode — announces it, starts the interview |
| Live | `opened` + `took_over: <pid>` | ✨ Live mode — announces it and that it took over a sibling live-canvas server (your prior session) |
| Live | `no_channel_capability` | Stops. Prints the exact `live-claude --continue` command for relaunch |
| Live | `in_use` (foreign holder) | Stops. Prints the holder pid + `ps -fp <pid>` so you can investigate |
| JSON | `opened` / `already_listening` | 📝 JSON mode — Submit writes to `.claude-design/feedback.jsonl` |
| JSON | `in_use` / MCP unavailable | 📝 JSON mode — Submit downloads a JSON file you paste back |

### Interview & generation

Skill asks 5 short questions (scope, pain points, inspiration, persona, constraints). Then generates 5 variants in `.claude-design/lab/variants/` and wires a route at `/__live_canvas` in your app.

### Iterate in the browser

Open `http://localhost:<dev-port>/__live_canvas`. Click **Add Feedback** (bottom right), click any element in any variant, type a one-liner, Save.

- Live mode: toast says "Pushed to Claude ✨", Claude acknowledges and edits the file, dev server hot-reloads.
- JSON mode: toast says "Saved — submit when ready", pin stays on the element, counter in the Submit button ticks up.

Need the page back? The overlay has a "−" button next to **Add Feedback** that collapses everything to a small circle in the corner — tap to expand again. Useful on mobile where the bar can cover what's underneath.

Keep clicking until a winner emerges.

### Finish

Click the pink **Finish** (Live) or **Submit** (JSON) button:

1. Type the overall direction: e.g. *"Go with B's layout, A's button styling"*
2. Click Finish

Skill then:
- Generates `DESIGN_PLAN.md` in project root (winner, files to change, component API, states, a11y checklist)
- Updates or creates `DESIGN_MEMORY.md` with the patterns it learned
- Deletes `.claude-design/` and the `/__live_canvas` route

Done.

---

## Files and where they live

### In this repo (source)

```
packages/claude/
├── skills/live-canvas/
│   ├── SKILL.md                           # Skill instructions (phases, flow)
│   ├── DESIGN_PRINCIPLES.md               # UX/a11y/motion reference
│   ├── README.md                          # This file
│   ├── dev/post-variants.html             # Standalone demo for local QA of the overlay
│   └── templates/
│       ├── overlay-vanilla.js             # Framework-agnostic overlay (~500 lines)
│       └── lab-banner.html                # "This is a temp lab" notice snippet
└── plugins/
    └── live-canvas-marketplace/
        ├── .claude-plugin/marketplace.json
        ├── setup.sh                       # Runs npm install and prints manual steps
        └── plugins/live-canvas-channel/
            ├── .claude-plugin/plugin.json
            ├── server.js                  # MCP server + HTTP listener on :8788
            ├── schema.json                # Feedback payload schema (v1.0)
            ├── package.json               # @modelcontextprotocol/sdk dep
            └── README.md                  # Plugin-specific docs (protocol, debug)
```

### On the user's disk after liteagents install

```
~/.claude/
├── skills/live-canvas/                    # Copied from packages/claude/skills/
└── plugins/live-canvas-marketplace/       # Copied from packages/claude/plugins/
```

`node_modules/` is NOT copied — `setup.sh` creates it locally via `npm install`.

### After `/plugin install` (Claude Code's own register step)

```
~/.claude/plugins/cache/live-canvas-marketplace/  # Claude Code's registered copy
```

Two different dirs:
- `~/.claude/plugins/live-canvas-marketplace/` — where liteagents puts the source
- `~/.claude/plugins/cache/live-canvas-marketplace/` — where Claude Code puts its own registered copy after `/plugin install`

The skill checks the cache dir to tell first-time vs returning users apart.

### Per-project, during a session

```
<project-root>/
└── .claude-design/
    ├── lab/variants/VariantA.tsx … VariantE.tsx
    ├── overlay-vanilla.js (copied into the project's public/static dir)
    ├── design-brief.json                  # Structured output from the interview
    └── feedback.jsonl                     # JSON mode only; deleted on Finish
```

Plus a temporary route (e.g. `app/__live_canvas/page.tsx` for Next.js App Router). Everything under `.claude-design/` and the temporary route is deleted on Finish or Abort.

### What survives after Finish

```
<project-root>/
├── DESIGN_PLAN.md         # Winner + implementation steps
└── DESIGN_MEMORY.md       # Accumulated design-system patterns
```

---

## The install pipeline, end to end

1. **Liteagents installer** copies the skill:
   - `packages/claude/skills/live-canvas/` → `~/.claude/skills/live-canvas/`
2. **User, once:** runs `bash packages/claude/plugins/live-canvas-marketplace/setup.sh` → copies marketplace to `~/.claude/plugins/`, runs `npm install`, adds `live-claude` function to `~/.zshrc` and `~/.bashrc`
3. **User, once:** in a Claude session, runs `/plugin marketplace add ~/.claude/plugins/live-canvas-marketplace` + `/plugin install live-canvas-channel@live-canvas-marketplace`
4. **User, every session that wants Live mode:** runs `live-claude` (function installed by step 2)
5. **User, whenever:** `/live-canvas` in any project

Steps 1, 2, 3 are truly one-time. Step 4 is per-session. Step 5 is per-project-use.

---

## Troubleshooting

### Port 8788 stuck from a prior session

You shouldn't hit this — `channel_open` now detects sibling live-canvas servers (same uid, same plugin) and takes them over automatically. If you do see `{status: "in_use", holder_pid: <pid>}` from the tool, that means the holder is **not** a live-canvas server (the plugin refuses to kill anything it doesn't own). Investigate with:

```bash
ps -fp <pid>     # what is it
kill <pid>       # only if it's safe to stop
```

Then re-run `/live-canvas`.

### Skill says `no_channel_capability` and refuses Live mode

The session was started with plain `claude`, which can't receive channel notifications (notifications would be silently dropped). Open a fresh terminal and run `live-claude` — the function added to your shellrc by `setup.sh` runs `claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace`. Then `/live-canvas` in the new session works.

### Skill says `/mcp` shows the plugin as failed

The plugin subprocess died on startup (usually a node/dep error). In the session, run `/mcp` — "Failed to connect" means look at `~/.claude/debug/<session-id>.txt` for the stderr. Common fix: re-run `setup.sh` so `npm install` runs again inside the plugin dir.

### Overlay loads in the browser but no pills appear

The overlay script didn't load. Most common cause: you started a static file server inside the wrong directory so the relative `overlay-vanilla.js` path couldn't resolve. Start the server from the directory containing the lab's `index.html` (or `__live_canvas` route).

### "Pushed to Claude ✨" toast appears but nothing lands in the terminal

This shouldn't happen with v0.3.0+ — the flag gate refuses bind from plain-claude sessions so the silent black-hole case is impossible. If you do see it, one of:
- You're on an old plugin (v0.2.0 or earlier). Run `/reload-plugins` in the session; the new in-memory MCP will be v0.5.0+.
- You're typing in the wrong session. Channel notifications go to whichever Claude session's MCP bound port 8788 — check `ss -lntp | grep 8788`, walk up the parent pid until you find the `claude` process, and switch terminals to that one.

### I want to uninstall

1. Remove the plugin from Claude Code: `/plugin uninstall live-canvas-channel`
2. Delete the marketplace: `/plugin marketplace remove live-canvas-marketplace`
3. Remove the dev flag from your alias/shortcut
4. Rerun liteagents installer in remove mode (or delete `~/.claude/skills/live-canvas/` and `~/.claude/plugins/live-canvas-marketplace/` by hand)

---

## Why the multi-step setup can't be hidden

The `--dangerously-load-development-channels` flag is a per-session startup argument of Claude Code itself. A running session can't promote itself to channel-enabled mid-flight; only the next session launched with the flag gets it. Same reason a skill can't silently do `/plugin install` on your behalf — the plugin system needs explicit user consent for research-preview plugins.

Until channels leave research preview and custom channels are allowlisted, step 4 is the irreducible friction. The alias removes the retyping cost.

---

## Pointers

- Plugin details: [`~/.claude/plugins/live-canvas-marketplace/plugins/live-canvas-channel/README.md`](../../plugins/live-canvas-marketplace/plugins/live-canvas-channel/README.md)
- Skill flow: [`SKILL.md`](./SKILL.md)
- Design principles reference: [`DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md)
- Channels reference (upstream): <https://code.claude.com/docs/en/channels-reference>
