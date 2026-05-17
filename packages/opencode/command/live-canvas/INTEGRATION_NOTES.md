# Design Lab — integration notes

**Status:** draft for later revision
**Context:** These are notes from a real design-lab session on vanilla-Node gitdone.
Capture what worked, what needs adaptation, and the path to a truly live feedback
loop. Rewrite properly when you sit down to tidy this.

---

## What Design Lab is (and what it isn't)

**Is:** a Claude Code skill that generates N UI variations side-by-side with an
in-page `FeedbackOverlay`, collects click-to-annotate feedback on elements,
synthesizes a winner, finalizes with `DESIGN_PLAN.md` + cleanup.

**Isn't:** a live push bridge. The overlay writes feedback to disk. Claude only
sees that file when the user types a message — it can't be woken by a Save click.

---

## Adaptation points (upstream assumes React)

The shipped skill (`SKILL.md`) generates React/Next.js/Vite templates and uses
`FeedbackOverlay.tsx` (React + portals). Any project not in that stack needs
adaptation. Patterns observed:

### Vanilla Node http / template-literal projects

- **Variants:** CommonJS modules at `.claude-design/lab/variants/variant-[a-f].js`
  - Each exports `{ id, rationale, render(stepsCount) }`
  - `render()` returns an HTML string; root element carries `data-variant-root="X"`
  - Inline `<style>` per variant, CSS class prefix per variant (`.va-`, `.vb-`, etc.)
    to avoid cross-variant bleed

- **Overlay:** port `FeedbackOverlay.tsx` → vanilla JS. A working port exists
  from the gitdone session — consider moving it to
  `design-lab/templates/overlay-vanilla.js` upstream so it's reusable.

- **Server integration:** a `/__design_lab` GET route that loads all variant
  modules and renders them in a CSS grid + injects the vanilla overlay as an
  inline `<script>`. Feedback POSTs to `/__design_lab/feedback` → appends JSONL
  to `.claude-design/feedback.jsonl`. Echo a highlighted summary to stderr.

### Other stacks

- **Next.js App Router** — skill's default; no adaptation needed
- **Vite React** — skill's default; minor route wiring
- **Plain HTML static** — variants served from filesystem; small fetch POST for
  feedback; no server integration (no real-time auto-reload)
- **Server-rendered (Rails, Django, Phoenix)** — one route that concatenates
  rendered variants; overlay via CDN / inline script

---

## The live-feedback problem

Design Lab today: batched feedback. User collects comments + writes overall
direction + clicks "Submit all" → one JSONL entry with the batch. Fine for
first-pass iteration; slow for rapid tweaks.

Ideal (what user described as "rapid miniscule changes"):

1. User clicks element
2. Types comment
3. Save → Claude is pushed the event AT THAT MOMENT
4. Claude edits the source file
5. Browser auto-reloads via SSE (already working via our dev HUD)
6. User sees the change without ever leaving the browser

Step 3 is the missing piece. Design Lab can't do it today because skills don't
push events — channels do.

---

## Three integration paths (cheapest → proper)

### Path 1: Poll-on-next-message (today's behavior)

- Overlay writes JSONL on Submit
- Claude reads JSONL on next user message
- User says "check" / "k" / anything to trigger

**Cost:** 0 min. **UX:** one message per feedback batch. **Good for:**
thoughtful batched feedback, not rapid tweaks.

### Path 2: Fakechat bridge (15 min, runs on top of the skill)

Modify `overlay.js` to add a "live mode" toggle:

- When ON, each individual **Save** (not just batch Submit) POSTs to
  `http://localhost:8787/api/send` formatted as a Fakechat-compatible message:

  ```json
  {"text": "[DESIGN-LAB F / button \"Create event\"] too cramped\n\nselector: section:nth-of-type(1) > form > button\noutline_html: <button class=\"vf-submit\">Create event</button>"}
  ```

- Launch Claude with:

  ```bash
  claude --channels plugin:fakechat@claude-plugins-official
  ```

- Each Save pushes the payload into the live Claude session as a channel event
- Claude reacts immediately (edit file, confirm back in Fakechat UI)
- SSE reload in the dev HUD shows the change in the design-lab page

**Tradeoff:** Fakechat expects plain chat text. We embed the structured
feedback as a preformatted string. Slightly janky — good for "does push work?"
proof-of-concept, not production.

**Bonus:** with Fakechat open at localhost:8787 you also get a chat back-channel
for non-UI notes ("also fix X unrelated thing").

### Path 3: Custom `design-channel` plugin (2-3 hours, the right way)

Dedicated channel plugin that bundles with design-lab:

- Speaks channel protocol to Claude (stdio subprocess like other channels)
- Exposes a local HTTP port (configurable; default 8788)
- Overlay POSTs directly to that port — no Fakechat detour
- Payload shape is the native structured feedback, not wrapped chat text
- Optional back-reply tool so Claude can post comments/confirmations to
  specific pins in the overlay ("done — added padding")

**Implementation sketch:**

```
design-plugin/
├── design-and-refine/
│   ├── skills/design-lab/        # existing
│   └── channels/design-channel/  # NEW
│       ├── manifest.json         # declares claude/channel capability
│       ├── server.js             # HTTP server + stdio channel
│       └── schema.json           # payload schema
```

- `manifest.json` declares channel capability + stdio subprocess entry
- `server.js` runs an HTTP listener AND a stdio channel protocol handler;
  POSTs to HTTP translate to channel.notify events with the payload
- Can either be launched separately (`claude --channels plugin:design-channel`)
  or bundled so Design Lab auto-launches it when active

**Reusable upstream:** this belongs as a PR to
[0xdesign/design-plugin](https://github.com/0xdesign/design-plugin). Benefits
every Design Lab user, not just this project.

### Path 4 (considered, rejected): auto-poll without a channel

Cannot work. Claude Code sessions are turn-based; no mechanism exists to
spontaneously check files between user turns. Hooks fire on Claude Code
events (user-prompt-submit, tool-use, etc.), not on external file changes.
Background tasks complete-notify but don't re-enter mid-generation. Path 2
or 3 are the only real "push" options.

---

## Files that matter

From the gitdone session, preserve these:

| File | Purpose | Reusable |
|---|---|---|
| `overlay.js` (vanilla port) | Click-to-annotate HUD | ✅ save to `design-lab/templates/overlay-vanilla.js` |
| Variant `render()` module pattern | Works for any server-rendered stack | ✅ document in skill |
| `/__design_lab` route shape | Server integration pattern | ✅ document per-stack |
| CSS prefix-per-variant | Prevents cross-variant style bleed | ✅ convention |

---

## Recommended next steps (when you sit down)

1. **Copy** the vanilla `overlay.js` from the gitdone `.claude-design/lab/`
   into `design-lab/templates/overlay-vanilla.js` so future sessions don't
   re-port it.

2. **Append to `SKILL.md`** a "Vanilla adaptation" section right after the
   framework-detection phase: if no React/Vue/Svelte detected → use the
   vanilla templates and CommonJS module pattern.

3. **Decide on channel path:**
   - Path 2 (Fakechat bridge) for the quick win
   - Path 3 (custom channel) for the proper PR upstream

4. **Liteagents bundling:** `./install.sh` already copies skills to
   `~/.claude/skills/`. Consider having it also install Fakechat from
   the plugin registry if the user opts in:

   ```bash
   read -p "Install Fakechat channel (for live Design Lab)? [y/N] " ans
   [[ $ans =~ ^[Yy] ]] && claude /plugin install fakechat@claude-plugins-official
   ```

5. **Open questions worth thinking through:**
   - Should Design Lab auto-launch its channel when active? Or require
     user to pass `--channels` flag at session start?
   - How should channel-received feedback interact with the batch flow?
     (Auto-synthesize after N comments? Synthesize only on explicit request?)
   - Should the overlay show "Claude is editing..." state via a back-reply
     from the channel?

---

## References

- Skill: `~/.claude/skills/design-lab/SKILL.md`
- Upstream: <https://github.com/0xdesign/design-plugin>
- Channels reference: <https://code.claude.com/docs/en/channels-reference>
- Fakechat: `claude /plugin install fakechat@claude-plugins-official`
- Vanilla overlay port (today's session):
  `/home/hamr/PycharmProjects/gitdone/.claude-design/lab/overlay.js`
