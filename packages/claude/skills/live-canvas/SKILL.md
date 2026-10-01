---
name: live-canvas
description: Conduct design interviews, generate UI variations, and collect live click-to-annotate feedback that streams into the session so edits land without leaving the browser. Use when the user wants rapid iterative UI refinement, not just batched feedback.
allowed-tools: Read, Grep, Glob
---

# Live Canvas Skill

Interview, generate variants, collect feedback, refine, preview, finalize. Why each rule exists: `docs/product/live-canvas-README.md`.

**Rules**
- **Always ask the feedback mode** with `AskUserQuestion` (Live vs JSON), every run. Never auto-select or auto-detect it.
- **Never run the install or relaunch commands yourself.** Print them; the user runs them.
- **Never start the dev server,** check ports, open a browser or wait for one.
- **The overlay is always wired:** copy `overlay-vanilla.js`, call `LiveCanvas.init` once, put `data-variant` on every variant container. Never generate a lab without it.
- **Only delete what this skill created,** inside `.claude-design/` or listed in `routes:` / `overlay:`. Never a user-authored file; verify each path first.
- **Temp files never outlive the run.** On finish and on abort, clean up (Phase 8.1).
- Never use generic or predefined visual styles; infer them from the project (Phase 0).

---

## Feedback mode

Tool names (plugin-namespaced): `mcp__plugin_live-canvas-channel_live-canvas__channel_open`, `mcp__plugin_live-canvas-channel_live-canvas__batch_open`, `mcp__plugin_live-canvas-channel_live-canvas__channel_close`. Every tool returns JSON `{status, port, message?, ...}`.

**Host:** run `test "$CLAUDECODE" = 1`. If not Claude Code (Droid, Amp, Opencode), skip the question, announce `📝 JSON mode (Live channel requires Claude Code)`, omit `channelUrl` and `batchEndpoint` in the overlay init, never mention the channel plugin, and go to Phase 0.

**Claude Code:** ask with `AskUserQuestion`:

| Header | Question | Options |
|---|---|---|
| Feedback mode | Pick a feedback mode | **Live channel** — overlay streams each Save into this session; requires a session started with `live-claude`, else Live refuses to start. **JSON file** — overlay writes feedback to `.claude-design/feedback.jsonl`; tell me "done" when ready; works in any session. |

**If JSON:** call `mcp__plugin_live-canvas-channel_live-canvas__batch_open`.

| Result | Do |
|---|---|
| Tool not available | Announce `📝 JSON mode — overlay will offer JSON download on Submit`. Init with `channelUrl` and `batchEndpoint` omitted. |
| `opened` or `already_listening` | Announce `📝 JSON mode — submissions write to .claude-design/feedback.jsonl`. Init with `batchEndpoint: 'http://localhost:8788/feedback-jsonl'`, `channelUrl` omitted. |
| `in_use` | Announce `📝 JSON mode — overlay will offer JSON download on Submit (another session holds the port)`. Init with both omitted. |

**If Live:** call `mcp__plugin_live-canvas-channel_live-canvas__channel_open`.

| Result | Do |
|---|---|
| Tool not available | First-time setup: print the install block below and STOP. |
| `opened` | Announce `✨ Live mode — feedback streams into this session`. Init with `channelUrl: 'http://localhost:8788'` and `batchEndpoint: 'http://localhost:8788/feedback-jsonl'`. |
| `opened` + `took_over: <pid>` | Same, announce `✨ Live mode — feedback streams into this session (took over channel from prior live-canvas session pid <pid>)`. |
| `already_listening` | Same as `opened`. |
| `no_channel_capability` | Print the result's `message` verbatim and STOP. Do not proceed to Live. |
| `in_use` | Print the result's `message` verbatim and STOP (a foreign process holds 8788; never kill it). |

<!-- mirror:literal:start — Live mode is the Claude Code MCP plugin; these are
     Claude's real paths in every kit, because no other tool can install it -->
**Install block (tool not available):**

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
<!-- mirror:literal:end -->

Print the mode result as one line, filled now: `mode: live | json | json (non-Claude host) · asked: yes | N/A`.

---

## Phase 0: Preflight detection

Detect before the interview, with file checks (`ls`, `Read`):
- **Package manager** from the lock file: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`.
- **Framework** from config: `next.config.*` (`app/` = App Router, `pages/` = Pages Router), `vite.config.*`, `remix.config.js`, `nuxt.config.*`, `astro.config.mjs`. None found: ask the user which framework.
- **Styling** from `tailwind.config.*`, `package.json` deps (`@mui/material`, `@chakra-ui/react`, `antd`, `styled-components`, `@emotion/react`), or `.css` / `.module.css` files.
- **Design Memory:** read `docs/design-memory.md` or `DESIGN_MEMORY.md` if present; use it to prefill defaults and skip redundant questions.
- **Visual style (infer, never preset):** read the tailwind config, `:root` CSS variables (`globals.css`), or the UI-library theme (MUI `createTheme`, Chakra `extendTheme`, Ant `ConfigProvider`). Scan 2-3 existing buttons, cards, forms and headings for padding, borders, shadows, type scale. Store the result in the brief.

Brief fields `framework`, `packageManager`, `stylingSystem` are always filled (`unknown` allowed) and echoed in the Phase 2 summary.

---

## Phase 1: Interview

Use `AskUserQuestion` for every step (several questions per call is fine). Adapt to Design Memory. Ask every row; `multi` = multiSelect.

| Header | Question | Options (label — meaning) | multi |
|---|---|---|---|
| Scope | Are we designing a single component or a full page? | Component — a reusable UI element; Page — a complete page or screen layout | no |
| Type | Is this a new design or a redesign of something existing? | New — from scratch; Redesign — improving an existing component or page | no |
| Location | What is the file path or route of the existing UI? (only if Redesign) | no options listed in the current spec; the user answers via Other | no |
| Problems | What are the top pain points with the current design (or what should this new design avoid)? | Too cluttered/dense; Unclear hierarchy; Poor mobile experience; Outdated look | yes |
| Visual style | What products or brands should I reference for visual inspiration? | Stripe — clean, minimal, trustworthy; Linear — dense, keyboard-first; Notion — flexible, content-focused; Apple — premium, spacious | yes |
| Interactions | What interaction patterns should I emulate? | Inline editing; Progressive disclosure; Optimistic updates; Keyboard shortcuts | no |
| Brand tone | What 3-5 adjectives describe the desired brand feel? | Minimal; Premium; Playful; Utilitarian | yes |
| Density | What information density do you prefer? | Compact; Comfortable; Spacious | no |
| Dark mode | Is dark mode required? | Yes; No; Nice to have | no |
| User | Who is the primary end user? | Developer; Designer; Business user; End consumer | no |
| Context | What's the primary usage context? | Desktop-first; Mobile-first; Both equally | no |
| Key tasks | What are the top 3 tasks users must complete? | no options listed in the current spec (open-ended); the user answers via Other | no |
| Keep | Are there elements that must be preserved? | Existing copy/labels; Current fields/inputs; Navigation structure; None | no |
| Constraints | Any technical constraints? | No new dependencies; Use existing components; Must be accessible (WCAG); None | yes |

If the target is unclear, propose a name based on repo patterns and confirm.

---

## Phase 2: Design brief

Write `.claude-design/design-brief.json` with every key present: `scope`, `isRedesign`, `targetPath`, `targetName`, `painPoints`, `inspiration` {`visual`, `functional`}, `brand` {`adjectives`, `density`, `darkMode`}, `persona` {`primary`, `context`, `keyTasks`}, `constraints` {`mustKeep`, `technical`}, `framework`, `packageManager`, `stylingSystem`, and:

```json
"inferredStyles": {
  "colors": {}, "spacing": {}, "radius": {}, "typography": {}, "shadows": {},
  "sources": ["tailwind.config.ts", "src/components/Button.tsx"]
}
```

`inferredStyles` is the result of Visual Style Inference, never omitted: the object above, or
`"inferredStyles": "NOT RUN: <why>"`.

Show the user a summary (including the detected framework, package manager and styling system) before proceeding.

---

## Phase 3: Generate the lab

Files go under `.claude-design/`: `lab/page.tsx`, `lab/variants/Variant{A..E}.tsx`, `lab/components/LabShell.tsx`, `lab/data/fixtures.ts`, `design-brief.json`. Variant files are `.tsx` by default; adapt the extension to the framework.

**Overlay.** Copy `~/.claude/skills/live-canvas/templates/overlay-vanilla.js` into the dir the dev server serves statically (`public/` for Next, `static/` or `public/` for Vite, the public dir for Rails/Django). Remember the copy's path: cleanup removes it. One vanilla file works in every framework. Load it with a `<script src="/overlay-vanilla.js">` (in React or Next, via the framework's script loader and a `useEffect` after it loads) and call init once:

```js
LiveCanvas.init({
  target: '<ComponentOrPageName>',
  channelUrl: 'http://localhost:8788',                    // Live mode only
  batchEndpoint: 'http://localhost:8788/feedback-jsonl',  // Live and JSON-with-server modes
});
```

Pass exactly the fields the mode table above gave; omit the rest. With both set, a Live-mode Finish POSTs the overall direction to the server instead of downloading a file.

**Route.** Next App Router: `app/__live_canvas/page.tsx`; Pages Router: `pages/__live_canvas.tsx`; both import from `.claude-design/lab/`. Vite React: a `/__live_canvas` route if React Router exists, else a conditional render in `App.tsx` on `?live_canvas=true`. Other frameworks: the most fitting temporary route. If no route can be created, fall back to a standalone HTML file and tell the user how to preview it. Record every route and edited app file you create; cleanup needs the list.

**Design guidance.** Read `DESIGN_PRINCIPLES.md` (Parts 1, 3, 4, 6) for UX, component, interaction and state patterns; take visuals only from the brief. Follow the project's conventions and styling system; reuse its components. Cover default, hover, focus, active, disabled, loading, error and empty states. Rule: visible `:focus-visible`, 44px touch targets, honour `prefers-reduced-motion`.

**Variants.** Each explores a different axis, using the project's own visual language:
- **A, hierarchy:** restructure content hierarchy, group related items, one primary action per view.
- **B, layout model:** card vs list vs table vs split-pane; check each breakpoint.
- **C, density:** the opposite of the brief's density, using the same spacing tokens.
- **D, interaction model:** modal vs inline vs panel vs drawer; implement all states.
- **E, expressive:** push the interview's brand direction with the existing tokens.

**Lab page.**
- Header with the brief summary and review instructions, plus the **lab banner**: paste `~/.claude/skills/live-canvas/templates/lab-banner.html` at the top (in TSX, translate the inline style to a camelCase object; keep the text and `role="note"`).
- Variant grid: labels A-E, a one-line "why this exists", the rendered variant, key differences. **Every variant container has `data-variant="X"`** (A-F); the overlay routes comments by it.
- Responsive: side-by-side on desktop, tabs or horizontal scroll on mobile. All variants share `data/fixtures.ts`.

Print this line, filled from what you wrote (each part greppable), after generating:

```
lab: variants <list> · data-variant: <N of N> · overlay: <served path> · init: target=<name> channelUrl|batchEndpoint|none · banner: yes · routes: <list>
```

---

## Phase 4: Present

Immediately present the lab. Do not start the dev server, check ports, open a browser or wait. Use the block for the chosen mode.

**Live:**

```
✨ Live Canvas ready — Live mode

Variants are at: http://localhost:3000/__live_canvas (adjust to your dev port)

Make sure your dev server is running, then:
  1. Click "Add Feedback" (bottom-right)
  2. Click any element → type → Save
  3. Each Save streams here instantly — I'll acknowledge and edit the corresponding variant
  4. When you're done, fill "Overall Direction", click Finish, then tell me "done"
```

**JSON:**

```
📝 Live Canvas ready — JSON mode

Variants are at: http://localhost:3000/__live_canvas

Click "Add Feedback" (bottom-right), comment on elements, fill "Overall Direction", click Submit.
Then tell me "done" — I'll read .claude-design/feedback.jsonl. (If the overlay downloaded
live-canvas-feedback.json instead, paste its contents here.)

(To use Live mode next time: relaunch with `live-claude` and pick Live when /live-canvas asks.)
```

Then go straight to Phase 5.

---

## Phase 5: Collect feedback

**Live mode: each `<channel source="live-canvas" target=".." variant=".." selector=".." tagName=".." commentId="..">text</channel>` tag, in this order:**
1. **Acknowledge** in chat, one short sentence (variant, element, what you will do). The user needs a text signal that the push landed.
2. **Locate** `.claude-design/lab/variants/Variant<X>.tsx` from `variant`, the element from `selector`.
3. **Edit** surgically. If the text is ambiguous, ask one clarifying question instead of guessing.
4. **Close the loop** with `✅ Done — <what changed>`.

Several tags together: batch the acknowledgements, edit one at a time so hot-reload shows each change. Print both the acknowledgement and the `✅ Done` line for every event.

**On "done" (Live after Finish, or JSON after Submit):** read `.claude-design/feedback.jsonl` (one JSON record per line; the last line is the latest submit), or the pasted JSON. Each record is `{version, target, timestamp, comments[], overall}`. Read `overall` first: it is the overall direction. Then apply each comment: `element.selector`, `text`, `variant`. Live-mode comments already streamed arrive as channel tags; the Finish record carries only the overall direction and anything undelivered. If the file is missing, ask the user to paste the downloaded JSON or describe the feedback in plain English.

Print: `feedback: read <path | pasted> · comments <N> · overall: yes | no`.

**No overlay feedback, or user prefers questions:**

| Header | Question | Options |
|---|---|---|
| Decision | Is there one variant you like as is? | Yes — I found one I like; No — I like parts of different ones |
| Winner (if Yes) | Which variant do you want to go with? | Variant A, B, C, D, E, each with a brief description |
| Tweaks (if Yes) | Any small changes needed, or is it good as is? | Good as is — go to Phase 7; Minor tweaks needed — user describes them |
| Feedback (if No) | What do you like about each variant? | no options listed in the current spec; user answers via Other (mention elements from A-E); then go to Phase 6 |

---

## Phase 6: Synthesize

Create a hybrid Variant F from the elements the user called out and the best structural decisions across variants. Replace the lab with a comparison view: F prominent, 1-2 closest originals, drop variants nothing was liked in; update the `/__live_canvas` route. Then ask:

| Header | Question | Options |
|---|---|---|
| Review | How does the synthesized variant (F) look? | This is it! — proceed to Phase 7; Getting closer — another iteration; Went the wrong direction — I'll clarify |

Iterate until the user is satisfied, then Phase 7.

---

## Phase 7: Final preview

1. Create `.claude-design/preview/` (`page.tsx`, `FinalDesign.tsx`) and a `/__design_preview` route; add that route to `routes:`.
2. For redesigns, include a before/after toggle or split view.
3. Ask:

| Header | Question | Options |
|---|---|---|
| Confirm | Ready to finalize this design? | Yes, finalize it — cleanup and write the plan; No, needs changes — tell me what to adjust (gather feedback, iterate); Abort - cancel everything — delete all temp files, no plan |

"Abort" goes to Abort handling.

---

## Abort handling

At any point, any cancel intent ("cancel", "abort", "stop", "nevermind", "forget it", "I changed my mind"):
1. Confirm: "Are you sure you want to cancel? This will delete all the Live Canvas files I created."
2. If confirmed: run Phase 8.1 cleanup. Write no `DESIGN_PLAN.md`, do not update Design Memory.
3. Say: "Design exploration cancelled. All temporary files have been cleaned up. Let me know if you want to start fresh later."

---

## Phase 8: Finalize

### 8.1 Cleanup (finish and abort)

If this run bound the port (Live, or JSON with `batch_open` opened), call `mcp__plugin_live-canvas-channel_live-canvas__channel_close` to release 8788 (a no-op if the tool is unavailable).

Delete only what this skill created:
- `.claude-design/` entirely (lab, preview, brief, `feedback.jsonl`).
- The copied overlay file at the path recorded in `overlay:` (e.g. `public/overlay-vanilla.js`).
- Every route in `routes:` (`app/__live_canvas/`, `pages/__live_canvas.tsx`, `app/__design_preview/`, `pages/__design_preview.tsx`, or the Nuxt/Astro/Remix route you made); revert any `App.tsx` edit.

If cleanup is interrupted, say what was deleted and what remains, with manual steps.

**The final message ends with this line, filled from checks run now** (run `test ! -e .claude-design`, then print its result), also after an abort:
```
cleanup: .claude-design/ absent (test ! -e → ok) · routes removed: <list | none> · overlay copy removed: <path | N/A> · App reverted: yes | N/A · channel_close: called | N/A (JSON mode)
```

### 8.2 Implementation plan

Write `DESIGN_PLAN.md` in the project root with these headings: Summary (scope, target, winner variant, key improvements), Files to Change (checklist), Implementation Steps, Component API (props, state, events), Required UI States (loading, empty, error, disabled, validation), Accessibility Checklist, Testing Checklist, Design Tokens.

Print: `plan: DESIGN_PLAN.md written (<N> lines) | N/A (aborted)`.

### 8.3 Design memory

Create or update `DESIGN_MEMORY.md`. New file headings: Brand Tone (adjectives, avoid), Layout & Spacing (density, grid, radius, shadows), Typography, Color (primary, secondary, neutral strategy, semantic), Interaction Patterns (forms, modals/drawers, tables/lists, feedback), Accessibility Rules, Repo Conventions (component structure, styling approach, primitives). Existing file: append new patterns, replace conflicting guidance with the latest decision, keep it concise.

Print: `memory: created | updated | N/A (aborted)`.

---

## Error handling

- **Framework not detected:** ask the user (Next.js, Vite, Create React App, Vue, other).
- **Route integration fails:** standalone HTML file plus manual preview instructions.
