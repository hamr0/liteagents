---
name: live-canvas
description: Conduct design interviews, generate UI variations, and collect live click-to-annotate feedback that streams into the session so edits land without leaving the browser. Use when the user wants rapid iterative UI refinement, not just batched feedback.
---

# Live Canvas Skill

This skill implements a complete design exploration workflow: interview, generate variations, collect feedback, refine, preview, and finalize.

## CRITICAL: Cleanup Behavior

**All temporary files MUST be deleted when the process ends, whether by:**
- User confirms final design → cleanup, then generate plan
- User aborts/cancels → cleanup immediately, no plan generated

**Never leave `.claude-design/` or `__live_canvas` routes behind.** If the user says "cancel", "abort", "stop", or "nevermind" at any point, confirm and then delete all temporary artifacts.

---

## Feedback Modes — always ask the user

Live Canvas supports two feedback transports. **The user picks every time** — never auto-select.

- **Live channel (Claude Code only):** the overlay POSTs each Save to a local MCP channel server; feedback arrives in the active session as a `<channel source="live-canvas" ...>` tag. Requires the session was launched with `live-claude` (or `claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace`) — channels are still an experimental Claude Code feature and a plain `claude` session silently drops the notifications. Any qualifying session can claim the channel by calling `mcp__live-canvas__channel_open`; only one holds it at a time.
- **JSON file (universal):** each Save accumulates locally; Submit writes `.claude-design/feedback.jsonl` (or downloads the JSON). User says "check" or pastes the file when ready. Works in any host.

### Host detection — do this first

This SKILL.md is the Claude Code variant of the skill. Same content is mirrored as docs for Droid/Amp/Opencode under `packages/<tool>/commands/live-canvas/`, but those tools don't support the MCP channel.

**If running under Droid, Amp, or Opencode (not Claude Code):**
- Skip the mode question entirely.
- Announce: `📝 JSON mode (Live channel requires Claude Code)`.
- Proceed to Phase 1 with `channelUrl` omitted in the overlay init.
- Never mention the channel plugin.

How to tell which host you're in: the environment variable `CLAUDECODE=1` is set by Claude Code. If unset, assume non-Claude and go straight to JSON.

### Mode selection (Claude Code only)

Always ask, never auto-detect. Use `AskUserQuestion`:

> **Question: Pick a feedback mode**
> - **Live channel** — overlay streams each Save straight into this Claude session. **Requires this session to have been started with `live-claude`** (sets the `--dangerously-load-development-channels` flag). If you started with plain `claude`, pick JSON instead — Live mode will refuse to start and tell you to open a new `live-claude` terminal.
> - **JSON file** — overlay writes feedback to a local JSON file; tell me "check" when ready. Works in any session, plain `claude` included.

**If the user picks JSON**, try to bind the batch endpoint so submissions write to disk instead of triggering a browser download. Call `mcp__live-canvas__batch_open`:

| Tool result | What to do |
|---|---|
| Tool not available (no MCP) | Announce `📝 JSON mode — overlay will offer JSON download on Submit`. Proceed to Phase 1 with both `channelUrl` and `batchEndpoint` omitted. |
| `{status: "opened", ...}` or `{status: "already_listening", ...}` | Announce `📝 JSON mode — submissions write to .claude-design/feedback.jsonl`. Proceed to Phase 1 with `batchEndpoint: 'http://localhost:8788/feedback-jsonl'` and `channelUrl` omitted. |
| `{status: "in_use", ...}` | Announce `📝 JSON mode — overlay will offer JSON download on Submit (another session holds the port)`. Proceed to Phase 1 with both `channelUrl` and `batchEndpoint` omitted. |

Call `mcp__live-canvas__channel_close` on cleanup/abort to release the port (same teardown as Live mode).

**If the user picks Live**, claim the channel by calling the MCP tool `mcp__live-canvas__channel_open`. Branch on the result:

| Tool result | What to do |
|---|---|
| Tool not available (no such tool / MCP error) | **Case C: First-time setup needed.** Print the install block (below) and STOP. |
| `{status: "opened", ...}` (no `took_over`) | **Case A: Ready.** Announce `✨ Live mode — feedback streams into this session`. Proceed to Phase 1 with `channelUrl: 'http://localhost:8788'`. |
| `{status: "opened", took_over: <pid>, ...}` | **Case A (takeover): Ready.** Announce `✨ Live mode — feedback streams into this session (took over channel from prior live-canvas session pid <pid>)`. Proceed to Phase 1 the same as plain Case A. The prior session's MCP was a sibling instance of this plugin (same user); its `/live-canvas` workflow there is now over, but the lab files on disk are untouched. |
| `{status: "already_listening", ...}` | **Case A: Ready.** Announce `✨ Live mode — feedback streams into this session`. Proceed to Phase 1 with `channelUrl: 'http://localhost:8788'`. |
| `{status: "in_use", holder_pid, message, ...}` | **Case B: Foreign process holds the port.** A non-live-canvas process is using port 8788 (e.g., a dev server on the wrong port). Print the busy block (below) and STOP — the plugin won't kill processes it doesn't own. |
| `{status: "no_channel_capability", message, ...}` | **Case D: Session lacks the channels flag.** Print the relaunch block (below) and STOP. Do NOT proceed to Live mode — notifications would be silently dropped. |

You must call `mcp__live-canvas__channel_close` later — see Phase 8 (Cleanup) and Abort Handling. The MCP plugin also auto-releases the port on session disconnect as a safety net, but explicit close is cleaner.

**Case B — busy block (foreign holder):**

Substitute the actual `holder_pid` from the tool response into the message below.

```
Port 8788 is held by pid <holder_pid>, which is NOT a live-canvas server
(it's some other process). I won't kill processes I don't own.

To use Live mode:
  • Find what it is:  ps -fp <holder_pid>
  • Stop it if it's safe to stop (e.g. a stray dev server on the wrong port).
  • Then re-run /live-canvas in this session and pick Live.

Or pick JSON now — JSON mode does not require port 8788.
```

**Case D — relaunch block (no channels flag):**

```
This Claude session is plain `claude` — it can't receive Live-mode feedback.
Live mode needs a session started with `live-claude` (which sets the
experimental --dangerously-load-development-channels flag). Without it,
your browser Saves would POST 200 but never appear in chat.

To use Live mode:

  1. Open a NEW terminal (you can keep this one running; it's fine to have
     both). Do NOT --continue this session — start fresh in the project.
  2. cd to your project directory.
  3. Run:  live-claude
       (if the command isn't found: run `source ~/.zshrc` first, or re-run
       packages/claude/plugins/live-canvas-marketplace/setup.sh)
       (literal form: claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace)
  4. In that NEW session, run /live-canvas and pick Live.

The lab files are written to disk in the project's `.claude-design/lab/`,
so any session in the right cwd can pick up where another left off.

Or pick JSON now to stay in this session — feedback gets written to a file
you paste back here. No relaunch needed.
```

**Case C — first-time setup block:**

```
Live mode needs a one-time install. Two steps:

  1. From this repo's root (or wherever liteagents lives):
       bash packages/claude/plugins/live-canvas-marketplace/setup.sh
     This copies the marketplace into ~/.claude/plugins/ and runs npm install.

  2. In any Claude session, register and install the plugin:
       /plugin marketplace add ~/.claude/plugins/live-canvas-marketplace
       /plugin install live-canvas-channel@live-canvas-marketplace

That's it — once the plugin is installed, /live-canvas in any session can
claim the channel. Re-run /live-canvas and pick Live.
```

Do not try to run any of these commands yourself. Three reasons:
1. The `/plugin` steps are Claude Code slash commands — not doable from inside a running session.
2. Accepting the research-preview safety prompt must be the user's explicit act.
3. If something goes wrong mid-install, the user needs to see each step's output to diagnose.

The user always executes these manually. Your job is to make the sequence obvious and copyable.

---

## Phase 0: Preflight Detection

Before starting the interview, automatically detect:

### Package Manager
Check for lock files in the project root:
- `pnpm-lock.yaml` → use `pnpm`
- `yarn.lock` → use `yarn`
- `package-lock.json` → use `npm`
- `bun.lockb` → use `bun`

### Framework Detection
Check for config files:
- `next.config.js` or `next.config.mjs` or `next.config.ts` → **Next.js**
  - Check for `app/` directory → App Router
  - Check for `pages/` directory → Pages Router
- `vite.config.js` or `vite.config.ts` → **Vite**
- `remix.config.js` → **Remix**
- `nuxt.config.js` or `nuxt.config.ts` → **Nuxt**
- `astro.config.mjs` → **Astro**

### Styling System Detection
Check `package.json` dependencies and config files:
- `tailwind.config.js` or `tailwind.config.ts` → **Tailwind CSS**
- `@mui/material` in dependencies → **Material UI**
- `@chakra-ui/react` in dependencies → **Chakra UI**
- `antd` in dependencies → **Ant Design**
- `styled-components` in dependencies → **styled-components**
- `@emotion/react` in dependencies → **Emotion**
- `.css` or `.module.css` files → **CSS Modules**

### Design Memory Check
Look for existing Design Memory file:
- `docs/design-memory.md`
- `DESIGN_MEMORY.md`
- `.claude-design/design-memory.md`

If found, read it and use to prefill defaults and skip redundant questions.

### Visual Style Inference (CRITICAL)

**DO NOT use generic/predefined styles. Extract visual language from the project:**

**If Tailwind detected**, read `tailwind.config.js` or `tailwind.config.ts`:
```javascript
// Extract and use:
theme.colors      // Color palette
theme.spacing     // Spacing scale
theme.borderRadius // Radius values
theme.fontFamily  // Typography
theme.boxShadow   // Elevation system
```

**If CSS Variables exist**, read `globals.css`, `variables.css`, or `:root` definitions:
```css
:root {
  --color-*     /* Color tokens */
  --spacing-*   /* Spacing tokens */
  --font-*      /* Typography tokens */
  --radius-*    /* Border radius tokens */
}
```

**If UI library detected** (MUI, Chakra, Ant), read the theme configuration:
- MUI: `theme.ts` or `createTheme()` call
- Chakra: `theme/index.ts` or `extendTheme()` call
- Ant: `ConfigProvider` theme prop

**Always scan existing components** to understand patterns:
- Find 2-3 existing buttons → note their styling patterns
- Find 2-3 existing cards → note padding, borders, shadows
- Find existing forms → note input styles, label placement
- Find existing typography → note heading sizes, body text

**Store inferred styles in the Design Brief** for consistent use across all variants.

---

## Phase 1: Interview

Use the **AskUserQuestion** tool for all interview steps. Adapt questions based on Design Memory if it exists.

### Step 1.1: Scope & Target

Ask these questions (can combine into single AskUserQuestion with multiple questions):

**Question 1: Scope**
- Header: "Scope"
- Question: "Are we designing a single component or a full page?"
- Options:
  - "Component" - A reusable UI element (button, card, form, modal, etc.)
  - "Page" - A complete page or screen layout

**Question 2: New or Redesign**
- Header: "Type"
- Question: "Is this a new design or a redesign of something existing?"
- Options:
  - "New" - Creating something from scratch
  - "Redesign" - Improving an existing component/page

If "Redesign" selected, ask:
**Question 3: Existing Path**
- Header: "Location"
- Question: "What is the file path or route of the existing UI?"
- Options: (let user provide via "Other")

If target is unclear, propose a name based on repo patterns and confirm.

### Step 1.2: Pain Points & Inspiration

**Question 1: Pain Points**
- Header: "Problems"
- Question: "What are the top pain points with the current design (or what should this new design avoid)?"
- Options:
  - "Too cluttered/dense" - Information overload, hard to scan
  - "Unclear hierarchy" - Primary actions aren't obvious
  - "Poor mobile experience" - Doesn't work well on small screens
  - "Outdated look" - Feels old or inconsistent with brand
- multiSelect: true

**Question 2: Visual Inspiration**
- Header: "Visual style"
- Question: "What products or brands should I reference for visual inspiration?"
- Options:
  - "Stripe" - Clean, minimal, trustworthy
  - "Linear" - Dense, keyboard-first, developer-focused
  - "Notion" - Flexible, content-focused, playful
  - "Apple" - Premium, spacious, refined
- multiSelect: true

**Question 3: Functional Inspiration**
- Header: "Interactions"
- Question: "What interaction patterns should I emulate?"
- Options:
  - "Inline editing" - Edit in place without modals
  - "Progressive disclosure" - Show more as needed
  - "Optimistic updates" - Instant feedback, sync in background
  - "Keyboard shortcuts" - Power user efficiency

### Step 1.3: Brand & Style Direction

**Question 1: Brand Adjectives**
- Header: "Brand tone"
- Question: "What 3-5 adjectives describe the desired brand feel?"
- Options:
  - "Minimal" - Clean, simple, uncluttered
  - "Premium" - High-end, polished, refined
  - "Playful" - Fun, friendly, approachable
  - "Utilitarian" - Functional, efficient, no-nonsense
- multiSelect: true

**Question 2: Density**
- Header: "Density"
- Question: "What information density do you prefer?"
- Options:
  - "Compact" - More information visible, tighter spacing
  - "Comfortable" - Balanced spacing, easy scanning
  - "Spacious" - Generous whitespace, focused attention

**Question 3: Dark Mode**
- Header: "Dark mode"
- Question: "Is dark mode required?"
- Options:
  - "Yes" - Must support dark mode
  - "No" - Light mode only
  - "Nice to have" - Support if easy, not required

### Step 1.4: Persona & Jobs-to-be-Done

**Question 1: Primary User**
- Header: "User"
- Question: "Who is the primary end user?"
- Options:
  - "Developer" - Technical, keyboard-oriented
  - "Designer" - Visual, detail-oriented
  - "Business user" - Efficiency-focused, less technical
  - "End consumer" - General public, varied technical ability

**Question 2: Context**
- Header: "Context"
- Question: "What's the primary usage context?"
- Options:
  - "Desktop-first" - Primarily used on larger screens
  - "Mobile-first" - Primarily used on phones
  - "Both equally" - Must work well on all devices

**Question 3: Key Tasks**
- Header: "Key tasks"
- Question: "What are the top 3 tasks users must complete?"
- (Let user provide via "Other" - this is open-ended)

### Step 1.5: Constraints

**Question 1: Must-Keep Elements**
- Header: "Keep"
- Question: "Are there elements that must be preserved?"
- Options:
  - "Existing copy/labels" - Keep current text
  - "Current fields/inputs" - Keep form structure
  - "Navigation structure" - Keep current nav
  - "None" - Free to change everything

**Question 2: Technical Constraints**
- Header: "Constraints"
- Question: "Any technical constraints?"
- Options:
  - "No new dependencies" - Use existing libraries only
  - "Use existing components" - Build on current design system
  - "Must be accessible (WCAG)" - Strict accessibility requirements
  - "None" - No special constraints
- multiSelect: true

---

## Phase 2: Generate Design Brief

After the interview, create a structured Design Brief as JSON and save to `.claude-design/design-brief.json`:

```json
{
  "scope": "component|page",
  "isRedesign": true|false,
  "targetPath": "src/components/Example.tsx",
  "targetName": "Example",
  "painPoints": ["Too dense", "Primary action unclear"],
  "inspiration": {
    "visual": ["Stripe", "Linear"],
    "functional": ["Inline validation"]
  },
  "brand": {
    "adjectives": ["minimal", "trustworthy"],
    "density": "comfortable",
    "darkMode": true
  },
  "persona": {
    "primary": "Developer",
    "context": "desktop-first",
    "keyTasks": ["Complete checkout", "Review order", "Apply discount"]
  },
  "constraints": {
    "mustKeep": ["existing fields"],
    "technical": ["no new dependencies", "WCAG accessible"]
  },
  "framework": "nextjs-app",
  "packageManager": "pnpm",
  "stylingSystem": "tailwind"
}
```

Display a summary to the user before proceeding.

---

## Phase 3: Generate Live Canvas

### Directory Structure

Create all files under `.claude-design/`:

```
.claude-design/
├── lab/
│   ├── page.tsx                 # Main lab page (framework-specific)
│   ├── variants/
│   │   ├── VariantA.tsx
│   │   ├── VariantB.tsx
│   │   ├── VariantC.tsx
│   │   ├── VariantD.tsx
│   │   └── VariantE.tsx
│   ├── components/
│   │   └── LabShell.tsx         # Lab layout wrapper
│   └── data/
│       └── fixtures.ts          # Shared mock data
├── design-brief.json
└── run-log.md
```

### Feedback System Setup (CRITICAL - NEVER SKIP)

**The overlay is the PRIMARY feature of Live Canvas.** Without it, users cannot provide interactive feedback. NEVER generate a lab without the overlay.

### The overlay

**One template, every framework:** `~/.claude/skills/live-canvas/templates/overlay-vanilla.js`. Single file, zero dependencies, plain DOM. Works in vanilla JS, Vue, Svelte, Rails, Django, Phoenix, plain HTML, Next.js, Vite-React, Remix — anywhere a `<script>` tag runs.

Copy it into a directory served by the dev server (e.g. `public/overlay-vanilla.js` for Next.js, `static/overlay-vanilla.js` for Vite, the public dir for Rails/Django). Reference it from the lab page.

### Wiring the overlay

The overlay needs one `init()` call with `target`, `channelUrl` (Live only), and optionally `batchEndpoint`.

**Server-rendered / vanilla HTML:**

```html
<script src="/overlay-vanilla.js"></script>
<script>
  LiveCanvas.init({
    target: '<ComponentOrPageName>',
    // Only include channelUrl when the user picked Live and the probe succeeded.
    // In JSON mode, OMIT channelUrl so the overlay skips the probe.
    channelUrl: 'http://localhost:8788',
    // Optional: where to POST JSON payloads when channelUrl is missing.
    // When omitted, Submit downloads a JSON file instead.
    batchEndpoint: '/__live_canvas/feedback',
  });
</script>
```

**React / Next.js / Vite-React:** load the script with the framework's mechanism and init in a `useEffect`:

```tsx
import Script from 'next/script';
import { useEffect } from 'react';

export default function Lab() {
  useEffect(() => {
    (window as any).LiveCanvas?.init({
      target: 'PostCard',
      channelUrl: 'http://localhost:8788', // omit in JSON mode
    });
  }, []);
  return (<>
    <Script src="/overlay-vanilla.js" strategy="afterInteractive" />
    {/* variants ... */}
  </>);
}
```

Vite-React: use `<script>` in `index.html` or `useEffect` with a dynamic `import()`. Same `LiveCanvas.init({...})` call.

### Why the templates live in the route directory

- `.claude-design/` paths can fail due to bundler configurations
- Relative imports from the same directory always work
- The route directory gets deleted during cleanup anyway

### Route Integration

**Next.js App Router:**
Create `app/__live_canvas/page.tsx` that imports from `.claude-design/lab/`

**Next.js Pages Router:**
Create `pages/__live_canvas.tsx` that imports from `.claude-design/lab/`

**Vite React:**
- If React Router exists: add route to `/__live_canvas`
- If no router: create a conditional render in `App.tsx` based on `?live_canvas=true` query param

**Other frameworks:**
Create the most appropriate temporary route for the detected framework.

### Variant Generation Guidelines

**IMPORTANT:** Read `DESIGN_PRINCIPLES.md` for UX, interaction, and motion best practices. But **DO NOT use predefined visual styles**—infer them from the project.

**Apply universal principles (from DESIGN_PRINCIPLES.md):**
- **UX**: Nielsen's heuristics, cognitive load reduction, progressive disclosure
- **Component behavior**: Button states, form anatomy, card structure
- **Interaction**: Feedback patterns, state handling, optimistic updates
- **Motion**: Timing (150-300ms), easing (ease-out entrances, ease-in exits)
- **Accessibility**: Focus states, ARIA patterns, touch targets (44px min)

**Infer visual styles from the project:**
- Colors → from Tailwind config, CSS variables, or existing components
- Typography → from existing headings, body text in the codebase
- Spacing → from the project's spacing scale or existing patterns
- Border radius → from existing cards, buttons, inputs
- Shadows → from existing elevated components

---

Each variant MUST explore a different design axis. Do not create minor variations—make them meaningfully distinct. **Use the project's existing visual language for all variants.**

**Variant A: Information Hierarchy Focus**
- Restructure content hierarchy (what's most important?)
- Apply Gestalt proximity—group related items closer
- One primary action per view
- Use existing typography scale to create clear levels

**Variant B: Layout Model Exploration**
- Try a different layout approach (card vs list vs table vs split-pane)
- Apply card anatomy or table behavior patterns from DESIGN_PRINCIPLES
- Consider responsive behavior at each breakpoint
- Use the project's existing grid/layout system

**Variant C: Density Variation**
- If brief says "comfortable", try a more compact version
- If brief says "compact", try a more spacious version
- Use the project's existing spacing tokens—just apply them differently
- Show the tradeoffs: more visible data vs easier scanning

**Variant D: Interaction Model**
- Different interaction pattern (modal vs inline vs panel vs drawer)
- Apply feedback patterns: immediate → progress → completion
- Implement all required states (loading, error, empty, disabled)
- Consider optimistic updates for non-destructive actions

**Variant E: Expressive Direction**
- Push the brand direction the user described in the interview
- Explore different uses of the project's existing design tokens
- More or less use of shadows, borders, background colors
- Apply motion where it adds meaning (hover, focus, transitions)

### Lab Page Requirements

The Live Canvas page must include:

1. **Header** with:
   - Design Brief summary (target, scope, key requirements)
   - Instructions for reviewing
   - **Lab banner (REQUIRED)** — paste `~/.claude/skills/live-canvas/templates/lab-banner.html` at the top of the lab page. Same text in any mode. For React/TSX labs, translate the inline style to a JS object: camelCase keys, string values. E.g. `style="border-radius:8px; padding:10px 14px; font-size:13px"` → `style={{ borderRadius: '8px', padding: '10px 14px', fontSize: '13px' }}`. Keep the text and `role="note"`.

2. **Variant Grid** with:
   - Clear labels (A, B, C, D, E)
   - Brief rationale for each variant ("Why this exists")
   - The actual rendered variant
   - Notes highlighting key differences
   - **IMPORTANT:** Each variant container must have `data-variant="X"` attribute (where X is A, B, C, D, E, or F). This is required for the feedback system to identify which variant comments belong to.

3. **Responsive behavior**:
   - Desktop: side-by-side grid (2-3 columns)
   - Mobile: horizontal scroll or tabs

4. **Shared Data**:
   - All variants use the same fixture data from `data/fixtures.ts`
   - Ensures fair comparison

5. **Feedback Overlay** (CRITICAL - NEVER OMIT):

   ⚠️ **THIS IS THE MOST IMPORTANT REQUIREMENT** ⚠️

   The overlay (`overlay-vanilla.js`) enables users to click on elements and leave comments. Without it, the Live Canvas is just a static page with no way to collect structured feedback.

   - Copy `~/.claude/skills/live-canvas/templates/overlay-vanilla.js` into a directory served by the dev server (e.g. `public/`, `static/`, or wherever the framework serves static assets).
   - Reference it from the lab page via `<script>` tag and call `LiveCanvas.init({...})` once with `target`, `channelUrl` (Live mode), and optional `batchEndpoint`. See "Wiring the overlay" above for the exact snippets per framework.
   - Every variant container in the lab page MUST have a `data-variant="X"` attribute (A, B, C, D, E, or F). The overlay uses this to route comments to the right variant file.

   **If you forget to wire up the overlay, the user CANNOT provide feedback.** This defeats the entire purpose of the Live Canvas.

### Code Quality

**Conventions:**
- Follow the project's existing code conventions (file naming, imports, etc.)
- Use the detected styling system (Tailwind, CSS modules, etc.)
- Use existing components from the project where appropriate

**Accessibility (from DESIGN_PRINCIPLES):**
- Semantic HTML: `<button>` not `<div onclick>`, `<nav>`, `<main>`, `<section>`
- Keyboard navigation: all interactive elements focusable and operable
- Focus states: visible `:focus-visible` with 2px ring and offset
- Color contrast: 4.5:1 for text, 3:1 for UI elements
- Touch targets: minimum 44x44px
- ARIA only when HTML semantics aren't enough

**States (every component needs):**
- Default, Hover, Focus, Active, Disabled, Loading, Error, Empty
- See DESIGN_PRINCIPLES "State Handling" section

**Motion:**
- Use appropriate timing: 150-200ms for micro-interactions, 200-300ms for transitions
- Use ease-out for entrances, ease-in for exits
- Respect `prefers-reduced-motion`

---

## Phase 4: Present Live Canvas to User

After generating the lab files, **immediately** present the lab to the user. Do NOT attempt to:
- Start the dev server yourself (it runs forever and will block)
- Check if ports are open
- Open a browser
- Wait for any server response

### What to say — mode-dependent

Use the version matching the mode detected in Phase 0.

**If LIVE mode:**

```
✨ Live Canvas ready — Live mode

Variants are at: http://localhost:3000/__live_canvas (adjust to your dev port)

Make sure your dev server is running, then:
  1. Click "Add Feedback" (bottom-right)
  2. Click any element → type → Save
  3. Each Save streams here instantly — I'll acknowledge and edit the corresponding variant
  4. Keep going, or tell me "done" whenever you're ready to synthesize a winner
```

**If JSON mode:**

```
📝 Live Canvas ready — JSON mode

Variants are at: http://localhost:3000/__live_canvas

Click "Add Feedback" (bottom-right), comment on elements, fill "Overall Direction", click Submit.
Then paste the JSON/markdown here, or just tell me your feedback in plain English.

(To use Live mode next time: relaunch with `live-claude` and pick Live when /live-canvas asks.)
```

### Then proceed to Phase 5

Don't wait for the user to confirm they opened the browser — move on so the feedback instructions are queued.

### Why Not Start the Server

Running `pnpm dev` or `npm run dev` starts a long-running process that never exits. If you run it, you'll wait forever. The user likely already has their dev server running, or can start it themselves in another terminal.

---

## Phase 5: Collect Feedback

Behavior depends on the mode detected in Phase 0.

### Live mode — handling streamed channel events

In Live mode, feedback arrives in your context as:

```
<channel source="live-canvas" target="PostCard" variant="B" selector="[data-testid='reply-b']" tagName="button" commentId="c-123...">
make this more prominent
</channel>
```

**For each `<channel>` tag, do all four steps, in this order:**

1. **Acknowledge back to the user in chat** — one short sentence confirming what you received. Examples:
   - `Got it — variant B's Reply button, "make this more prominent". Editing now.`
   - `On it: variant C post card, "add more spacing". Updating.`
   Do not skip this. The user is watching their browser and needs a text signal that the push landed.

2. **Locate the file** — the variant attribute tells you which file (`.claude-design/lab/variants/Variant<X>.tsx`). The selector identifies the element inside it.

3. **Edit the file** — make the change implied by the feedback text. Prefer small, surgical edits over rewrites. If the feedback is ambiguous ("change this"), ask one clarifying question rather than guessing.

4. **Close the loop** — one short reply after the edit: `✅ Done — variant B Reply button is now larger and primary-colored.` Then wait for the next channel event or user message.

If multiple `<channel>` tags arrive together, batch the acknowledgments but do each edit one at a time so the user's dev server hot-reloads visibly between changes.

### JSON mode — interactive or pasted

The Live Canvas includes a Figma-like feedback overlay. When presenting the lab, include these instructions:

```
✅ Live Canvas created!

I've generated 5 design variants in `.claude-design/lab/`

To view and provide feedback:
1. Make sure your dev server is running (run `pnpm dev` if not)
2. Open: http://localhost:3000/__live_canvas

**To add feedback:**
1. Click the "Add Feedback" button (bottom-right corner)
2. Click any element you want to comment on
3. Type your feedback and click "Save"
4. Repeat for all elements you want to comment on
5. Fill in the "Overall Direction" field (required)
6. Click "Submit All Feedback"
7. Paste the copied text here in the terminal

Or just describe your feedback manually below!
```

**When the user pastes feedback**, it will be in this format:

```markdown
## Live Canvas Feedback

**Target:** ComponentName
**Comments:** 3

### Variant A
1. **Button** (`[data-testid='submit']`, button with "Submit")
   "Make this more prominent"

### Variant B
1. **Card** (`.product-card`, div with "Product Name")
   "Love this layout"

### Overall Direction
Go with Variant B's structure. Apply Variant A's button styling.
```

**How to parse and act on this feedback:**

1. **Read the Overall Direction** first - this guides your synthesis
2. **For each comment**, locate the element using:
   - Primary: The CSS selector in backticks (e.g., `[data-testid='submit']`)
   - Secondary: The element description (e.g., "button with 'Submit'")
3. **Apply the feedback** by editing the corresponding variant file

### Fallback: Manual Feedback via AskUserQuestion

If the user prefers not to use the interactive overlay (or pastes manual feedback), use the AskUserQuestion flow below:

### Stage 1: Check for a Winner

**Question 1: Ready to pick?**
- Header: "Decision"
- Question: "Is there one variant you like as is?"
- Options:
  - "Yes - I found one I like" - Ready to select a winner and refine
  - "No - I like parts of different ones" - Need to synthesize a new variant

### Stage 2A: If User Found a Winner

If user said "Yes", ask:

**Question 2a: Which one?**
- Header: "Winner"
- Question: "Which variant do you want to go with?"
- Options:
  - "Variant A" - [brief description of A]
  - "Variant B" - [brief description of B]
  - "Variant C" - [brief description of C]
  - "Variant D" - [brief description of D]
  - "Variant E" - [brief description of E]

**Question 3a: Any tweaks?**
- Header: "Tweaks"
- Question: "Any small changes needed, or is it good as is?"
- Options:
  - "Good as is" - No changes needed, proceed to final preview
  - "Minor tweaks needed" - I'll describe what to adjust

If "Minor tweaks needed", ask user to describe changes via text input.

Then proceed to **Phase 7: Final Preview**.

### Stage 2B: If User Wants to Synthesize

If user said "No - I like parts of different ones", ask:

**Question 2b: What do you like about each?**
- Header: "Feedback"
- Question: "What do you like about each variant? (mention specific elements from A, B, C, D, E)"
- (Let user provide detailed feedback via "Other" text input)

Example response format to guide user:
```
- A: Love the card layout and spacing
- B: The color scheme feels right
- C: The interaction on hover is great
- D: Nothing stands out
- E: The typography hierarchy is clearest
```

Then proceed to **Phase 6: Synthesize New Variant**.

---

## Phase 6: Synthesize New Variant

Based on the user's feedback about what they liked from each variant:

1. **Create a new hybrid variant** (Variant F) that combines:
   - The specific elements the user called out from each
   - The best structural decisions across all variants
   - Any patterns that appeared in multiple variants

2. **Replace the Live Canvas** with a comparison view:
   - Show the new synthesized Variant F prominently
   - Keep 1-2 of the original variants that were closest for comparison
   - Remove variants that had nothing the user liked

3. **Update the `/__live_canvas` route** to show the new arrangement

4. **Ask for feedback again:**

**Question: How's the new variant?**
- Header: "Review"
- Question: "How does the synthesized variant (F) look?"
- Options:
  - "This is it!" - Proceed to final preview
  - "Getting closer" - Need another iteration
  - "Went the wrong direction" - Let me clarify what I want

If "Getting closer" or "Went the wrong direction", gather more specific feedback and iterate. Support multiple synthesis passes until user is satisfied.

Then proceed to **Phase 7: Final Preview**.

---

## Phase 7: Final Preview

Once user is satisfied:

1. Create `.claude-design/preview/` directory:
   ```
   .claude-design/preview/
   ├── page.tsx                    # Preview page
   └── FinalDesign.tsx             # The winning design
   ```

2. Create route at `/__design_preview`

3. For redesigns, include before/after comparison:
   - Toggle switch or split view
   - Show original alongside proposed

4. Ask for final confirmation:

**Question: Confirm final design?**
- Header: "Confirm"
- Question: "Ready to finalize this design?"
- Options:
  - "Yes, finalize it" - Proceed to cleanup and generate implementation plan
  - "No, needs changes" - Tell me what to adjust
  - "Abort - cancel everything" - Delete all temp files, no plan generated

If "No, needs changes": gather feedback and iterate.
If "Abort": proceed to **Abort Handling** below.

---

## Abort Handling

If the user wants to cancel/abort at ANY point during the process (not just final confirmation), they may say things like:
- "cancel"
- "abort"
- "stop"
- "nevermind"
- "forget it"
- "I changed my mind"

When abort is detected:

1. **Confirm the abort:**
   - "Are you sure you want to cancel? This will delete all the Live Canvas files I created."

2. **If confirmed, clean up immediately:**
   - If Live mode was active, call `mcp__live-canvas__channel_close` to release port 8788.
   - Delete `.claude-design/` directory entirely
   - Delete temporary route files (`app/__live_canvas/`, etc.)
   - Do NOT generate any implementation plan
   - Do NOT update Design Memory

3. **Acknowledge:**
   - "Design exploration cancelled. All temporary files have been cleaned up. Let me know if you want to start fresh later."

---

## Phase 8: Finalize

When user confirms (selected "Yes, finalize it"):

### 8.1: Cleanup

If Live mode was active, call `mcp__live-canvas__channel_close` to release port 8788 so another session can claim it.

Delete all temporary files:
- Remove `.claude-design/` directory entirely
- Remove temporary route files:
  - `app/__live_canvas/` (Next.js App Router)
  - `pages/__live_canvas.tsx` (Next.js Pages Router)
  - `app/__design_preview/`
  - `pages/__design_preview.tsx`
  - Revert any `App.tsx` modifications (Vite)

**Safety rules:**
- ONLY delete files inside `.claude-design/`
- ONLY delete route files that the plugin created
- NEVER delete user-authored files
- Verify file paths before deletion

### 8.2: Generate Implementation Plan

Create `DESIGN_PLAN.md` in the project root:

```markdown
# Design Implementation Plan: [TargetName]

## Summary
- **Scope:** [component/page]
- **Target:** [file path]
- **Winner variant:** [A-E]
- **Key improvements:** [from feedback]

## Files to Change
- [ ] `src/components/Example.tsx` - Main component refactor
- [ ] `src/styles/example.css` - Style updates
- [ ] ... (list all affected files)

## Implementation Steps
1. [Specific step with code guidance]
2. [Next step]
3. ...

## Component API
- **Props:**
  - `prop1: type` - description
  - ...
- **State:**
  - Internal state requirements
- **Events:**
  - Callbacks and handlers

## Required UI States
- **Loading:** [description]
- **Empty:** [description]
- **Error:** [description]
- **Disabled:** [description]
- **Validation:** [description]

## Accessibility Checklist
- [ ] Keyboard navigation works
- [ ] Focus states visible
- [ ] Labels and aria-* attributes correct
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader tested

## Testing Checklist
- [ ] Unit tests for logic
- [ ] Component tests for rendering
- [ ] Visual regression tests (if applicable)
- [ ] E2E smoke test (if applicable)

## Design Tokens
- [Any new tokens to add]
- [Existing tokens to use]

---

*Generated by Live Canvas skill*
```

### 8.3: Update Design Memory

Create or update `DESIGN_MEMORY.md`:

If new file:
```markdown
# Design Memory

## Brand Tone
- **Adjectives:** [from interview]
- **Avoid:** [anti-patterns discovered]

## Layout & Spacing
- **Density:** [preference]
- **Grid:** [if established]
- **Corner radius:** [if consistent]
- **Shadows:** [if consistent]

## Typography
- **Headings:** [font, weights used]
- **Body:** [font, size]
- **Emphasis:** [patterns]

## Color
- **Primary:** [color tokens]
- **Secondary:** [color tokens]
- **Neutral strategy:** [approach]
- **Semantic colors:** [error, success, warning]

## Interaction Patterns
- **Forms:** [validation approach, layout]
- **Modals/Drawers:** [when to use which]
- **Tables/Lists:** [preferred patterns]
- **Feedback:** [toast, inline, etc.]

## Accessibility Rules
- **Focus:** [visible focus approach]
- **Labels:** [labeling conventions]
- **Motion:** [reduced motion support]

## Repo Conventions
- **Component structure:** [file organization]
- **Styling approach:** [Tailwind classes, CSS modules, etc.]
- **Existing primitives:** [Button, Input, Card, etc.]

---

*Updated by Live Canvas skill*
```

If updating existing file:
- Append new patterns discovered
- Update any conflicting guidance with latest decisions
- Keep file concise and actionable

---

## Error Handling

### Framework Not Detected
If framework cannot be determined:
- Ask user: "I couldn't detect your framework. What are you using?"
- Provide common options: Next.js, Vite, Create React App, Vue, etc.

### Dev Server Fails
If dev server won't start:
- Check for port conflicts
- Provide manual instructions
- Suggest user starts server themselves

### Route Integration Fails
If can't create temporary route:
- Fall back to creating standalone HTML file
- Provide instructions for manual preview

### Cleanup Interrupted
If cleanup is interrupted:
- Log what was deleted vs remaining
- Provide manual cleanup instructions
- Never leave partial state without informing user

---

## Configuration Options

The plugin supports these optional configurations (via environment or project config):

- `DESIGN_AUTO_IMPLEMENT`: If `true`, implement the plan immediately after confirmation
- `DESIGN_KEEP_LAB`: If `true`, don't delete lab until explicit cleanup command
- `DESIGN_MEMORY_PATH`: Custom path for Design Memory file

---

## Example Session Flow

1. User: `/design-variations:design CheckoutSummary`
2. Plugin detects: Next.js App Router, Tailwind, pnpm
3. Plugin finds: No existing Design Memory
4. Plugin asks: Interview questions (5 steps)
5. Plugin generates: Design Brief summary
6. Plugin creates: `.claude-design/lab/` with 5 variants
7. Plugin creates: `app/__live_canvas/page.tsx`
8. Plugin starts: `pnpm dev`
9. Plugin outputs: "Open http://localhost:3000/__live_canvas"
10. User reviews variants in browser
11. Plugin asks: "Which variant wins?"
12. User: "Variant C, but change X and Y"
13. Plugin refines: Updates Variant C
14. User: "Looks good"
15. Plugin creates: Final preview at `/__design_preview`
16. User: "Confirmed"
17. Plugin: Deletes all temp files
18. Plugin: Generates `DESIGN_PLAN.md`
19. Plugin: Creates `DESIGN_MEMORY.md`
20. Plugin: "Done! See DESIGN_PLAN.md for implementation steps"
