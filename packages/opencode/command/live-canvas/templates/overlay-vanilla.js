/**
 * Live Canvas — vanilla overlay
 *
 * Framework-free click-to-annotate HUD for UI variant review.
 * Works with any server-rendered page: Node, Python, Ruby, Go, PHP, static HTML.
 *
 * Requirements on the host page:
 *   - Variant containers carry `data-variant="A"` (or B/C/D/E/F)
 *   - This script loaded once, after the variant DOM exists
 *
 * Usage:
 *   <script src="/static/overlay-vanilla.js"></script>
 *   <script>
 *     LiveCanvas.init({
 *       target: 'CheckoutSummary',        // component/page name
 *       channelUrl: 'http://localhost:8788', // optional; omit to force batch
 *       batchEndpoint: '/__live_canvas/feedback', // where batch POSTs go
 *     });
 *   </script>
 *
 * Modes (auto-selected):
 *   Live  — each Save POSTs to {channelUrl}/feedback, streams into Claude session
 *   Batch — saves accumulate locally; Submit All POSTs JSONL to batchEndpoint
 *           (or downloads the file if no endpoint configured)
 *
 * Payload schema: v1.0, compatible with the upstream React FeedbackOverlay.
 */
(function () {
  'use strict';

  const PFX = 'lc';                              // class prefix
  const DATA_OVERLAY = 'data-lc-overlay';        // excludes overlay elements from picker

  const state = {
    target: 'Component',
    mode: 'batch',                               // 'live' | 'batch'
    channelUrl: null,
    batchEndpoint: null,
    active: false,
    picking: false,
    comments: [],                                // Comment[] — only items pending batch submit
    overall: '',
    pinCounts: Object.create(null),              // `${variant}|${selector}` → placed-pin count
  };

  // ---------- utilities ----------

  const uid = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'style') Object.assign(node.style, attrs[k]);
      else if (k === 'on') for (const ev in attrs.on) node.addEventListener(ev, attrs.on[ev]);
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of [].concat(children)) {
      if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    node.setAttribute(DATA_OVERLAY, '');
    return node;
  };

  const isOverlayNode = (n) => !!n.closest(`[${DATA_OVERLAY}]`);

  const findVariant = (n) => {
    const root = n.closest('[data-variant]');
    return root ? root.getAttribute('data-variant') : null;
  };

  // Selector strategy: data-testid > id > tag + class chain (max 3 levels).
  // Skips hashed CSS-in-JS class names (matches /^[a-z]+-[a-z0-9]{5,}$/).
  const hashed = /^[a-z]+-[a-z0-9]{5,}$/i;
  const cleanClasses = (cn) => (cn || '')
    .split(/\s+/).filter(c => c && !hashed.test(c) && !c.startsWith(PFX + '-'));

  const buildSelector = (n) => {
    if (n.dataset && n.dataset.testid) return `[data-testid='${n.dataset.testid}']`;
    if (n.id) return `#${n.id}`;
    const parts = [];
    let cur = n;
    for (let depth = 0; depth < 3 && cur && cur.tagName; depth++) {
      const classes = cleanClasses(cur.className);
      let part = cur.tagName.toLowerCase();
      if (classes.length) part += '.' + classes.slice(0, 2).join('.');
      parts.unshift(part);
      if (cur.id) { parts[0] = '#' + cur.id; break; }
      cur = cur.parentElement;
      if (cur && cur.hasAttribute('data-variant')) break;
    }
    return parts.join(' > ');
  };

  const buildReadablePath = (n) => {
    const parts = [];
    let cur = n;
    while (cur && cur.tagName && !cur.hasAttribute('data-variant')) {
      parts.unshift(cur.tagName.toLowerCase());
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };

  const identify = (n) => {
    const attrs = {};
    for (const a of n.attributes || []) {
      if (a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name === 'id') {
        if (a.name !== DATA_OVERLAY) attrs[a.name] = a.value;
      }
    }
    return {
      selector: buildSelector(n),
      readablePath: buildReadablePath(n),
      tagName: n.tagName.toLowerCase(),
      textContent: (n.textContent || '').trim().slice(0, 50),
      className: cleanClasses(n.className).join(' '),
      attributes: attrs,
    };
  };

  const coordsWithin = (n, clickX, clickY) => {
    const root = n.closest('[data-variant]');
    if (!root) return { x: 0, y: 0 };
    const r = root.getBoundingClientRect();
    return {
      x: Math.round(((clickX - r.left) / r.width) * 100),
      y: Math.round(((clickY - r.top) / r.height) * 100),
    };
  };

  // ---------- styles (scoped via prefix) ----------

  const injectStyles = () => {
    const css = `
      [${DATA_OVERLAY}] { font-family: system-ui, sans-serif; box-sizing: border-box; }
      .${PFX}-bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
        display: flex; gap: 8px; }
      .${PFX}-btn { border: 0; border-radius: 999px; padding: 10px 16px;
        font-weight: 600; font-size: 13px; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.25); font-family: inherit; }
      .${PFX}-toggle { background: #111; color: #fff; }
      .${PFX}-toggle[data-active='1'] { background: #d946ef; }
      .${PFX}-submit { background: #fff; color: #111; border: 1px solid #e4e4e7; }
      .${PFX}-submit:disabled { opacity: .5; cursor: not-allowed; }
      .${PFX}-submit:not(:disabled):hover { background: #fafafa; }
      .${PFX}-submit .${PFX}-count { display: inline-block; background: #d946ef; color: #fff;
        border-radius: 999px; min-width: 18px; padding: 0 6px; margin-left: 6px;
        font-size: 11px; line-height: 18px; text-align: center; }
      .${PFX}-mode { position: fixed; right: 16px; bottom: 60px; z-index: 2147483646;
        background: rgba(0,0,0,.75); color: #fff; font-size: 11px;
        padding: 4px 8px; border-radius: 4px; pointer-events: none; }
      .${PFX}-picking { cursor: crosshair !important; }
      .${PFX}-hover-outline { outline: 2px solid #d946ef !important; outline-offset: 2px; }
      .${PFX}-pin { position: absolute; z-index: 2147483645; width: 24px; height: 24px;
        border-radius: 50%; background: #d946ef; color: #fff; font-weight: 700;
        font-size: 12px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); transform: translate(-50%,-50%); }
      .${PFX}-popup { position: fixed; z-index: 2147483647; width: 320px;
        background: #fff; border: 1px solid #ddd; border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 12px; }
      .${PFX}-popup h4 { margin: 0 0 4px; font-size: 13px; color: #111; }
      .${PFX}-popup code { font-size: 11px; color: #555; word-break: break-all; display: block; margin-bottom: 8px; }
      .${PFX}-popup textarea { width: 100%; min-height: 72px; font-size: 13px;
        padding: 6px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; }
      .${PFX}-popup .${PFX}-row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
      .${PFX}-popup button { padding: 6px 12px; font-size: 12px; border: 0; border-radius: 4px; cursor: pointer; }
      .${PFX}-btn-primary { background: #111; color: #fff; }
      .${PFX}-btn-ghost { background: transparent; color: #555; }
      .${PFX}-submit-modal { position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
      .${PFX}-submit-card { width: 480px; max-width: 90vw; background: #fff;
        border-radius: 12px; padding: 20px; }
      .${PFX}-submit-card h3 { margin: 0 0 8px; }
      .${PFX}-submit-card textarea { width: 100%; min-height: 96px;
        padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
      .${PFX}-toast { position: fixed; bottom: 70px; right: 16px; z-index: 2147483647;
        background: #111; color: #fff; padding: 8px 12px; border-radius: 6px;
        font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: none; }
      .${PFX}-toast[data-show='1'] { opacity: 1; }
    `;
    const style = el('style', { html: css });
    document.head.appendChild(style);
  };

  // ---------- transport ----------

  const probeChannel = async (url) => {
    try {
      const res = await fetch(url + '/health', { method: 'GET', mode: 'cors' });
      return res.ok;
    } catch { return false; }
  };

  const pushLive = async (comment) => {
    try {
      const res = await fetch(state.channelUrl + '/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: '1.0', target: state.target, comment }),
      });
      return res.ok;
    } catch { return false; }
  };

  const submitBatch = async () => {
    // Only send comments that haven't already been delivered over the channel.
    // In live mode after successful pushes, this is usually empty — the submit
    // effectively carries only the overall direction.
    const undelivered = state.comments.filter(c => !c.delivered);
    const payload = {
      version: '1.0',
      target: state.target,
      timestamp: new Date().toISOString(),
      comments: undelivered,
      overall: state.overall,
    };
    if (state.batchEndpoint) {
      try {
        const res = await fetch(state.batchEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return res.ok;
      } catch { /* fall through to download */ }
    }
    // No endpoint or POST failed: download JSON so user can hand it to the CLI.
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'live-canvas-feedback.json' });
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    return true;
  };

  // ---------- UI ----------

  let toggleBtn, submitBtn, modeBadge, toast, popupNode;
  let hoverEl = null;

  const pendingCount = () => state.comments.filter(c => !c.delivered).length;

  const refreshSubmitBtn = () => {
    if (!submitBtn) return;
    const n = pendingCount();
    const label = state.mode === 'live' ? 'Finish' : 'Submit';
    submitBtn.innerHTML = `${label} <span class="${PFX}-count">${n}</span>`;
    submitBtn.setAttribute(DATA_OVERLAY, '');
    // In live mode, the Finish button is always enabled so the user can send
    // an overall direction even after all per-element comments delivered.
    submitBtn.disabled = state.mode === 'batch' && n === 0;
  };

  const showToast = (msg) => {
    toast.textContent = msg;
    toast.setAttribute('data-show', '1');
    setTimeout(() => toast.removeAttribute('data-show'), 1800);
  };

  const setPickingCursor = (on) => {
    document.body.classList.toggle(PFX + '-picking', on);
  };

  const clearHover = () => {
    if (hoverEl) { hoverEl.classList.remove(PFX + '-hover-outline'); hoverEl = null; }
  };

  const onMouseMove = (e) => {
    if (!state.picking) return;
    const n = e.target;
    if (isOverlayNode(n) || !findVariant(n)) { clearHover(); return; }
    if (hoverEl === n) return;
    clearHover();
    hoverEl = n;
    n.classList.add(PFX + '-hover-outline');
  };

  const placePin = (variant, coords, count) => {
    const root = document.querySelector(`[data-variant="${variant}"]`);
    if (!root) return;
    // Pin is absolutely positioned relative to its variant root, which we make
    // position:relative if it isn't already.
    const cs = getComputedStyle(root);
    if (cs.position === 'static') root.style.position = 'relative';
    const pin = el('div', {
      class: `${PFX}-pin`,
      style: { left: coords.x + '%', top: coords.y + '%' },
      on: { click: (ev) => { ev.stopPropagation(); showToast(`${count} comment${count>1?'s':''} on this element`); } },
    }, String(count));
    root.appendChild(pin);
  };

  const closePopup = () => {
    if (popupNode) { popupNode.remove(); popupNode = null; }
  };

  const openCommentPopup = (target, clickX, clickY) => {
    closePopup();
    const variant = findVariant(target);
    if (!variant) { showToast('Click inside one of the variant cards'); return; }
    const ident = identify(target);
    const coords = coordsWithin(target, clickX, clickY);

    const textarea = el('textarea', { placeholder: 'What should change here?' });
    const save = el('button', { class: `${PFX}-btn-primary` }, 'Save');
    const cancel = el('button', { class: `${PFX}-btn-ghost` }, 'Cancel');
    popupNode = el('div', {
      class: `${PFX}-popup`,
      style: { left: Math.min(window.innerWidth - 340, clickX + 12) + 'px',
               top: Math.min(window.innerHeight - 220, clickY + 12) + 'px' },
    }, [
      el('h4', {}, `Variant ${variant} — ${ident.tagName}`),
      el('code', {}, ident.selector),
      textarea,
      el('div', { class: `${PFX}-row` }, [cancel, save]),
    ]);
    document.body.appendChild(popupNode);
    setTimeout(() => textarea.focus(), 0);

    cancel.addEventListener('click', closePopup);
    save.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      const comment = {
        id: uid(), variant, element: ident, coordinates: coords,
        text, timestamp: Date.now(),
      };

      // Pin count is tracked independently of batch state so pins persist
      // visually even when comments have been delivered and removed from batch.
      const pinKey = variant + '|' + ident.selector;
      state.pinCounts[pinKey] = (state.pinCounts[pinKey] || 0) + 1;
      placePin(variant, coords, state.pinCounts[pinKey]);
      closePopup();

      if (state.mode === 'live') {
        const ok = await pushLive(comment);
        if (ok) {
          // Push landed. Nothing goes into state.comments — the comment is
          // already in Claude's hands. Counter stays at 0.
          showToast('Pushed to Claude ✨');
        } else {
          // Push failed. Keep the comment locally as a pending batch item and
          // degrade the overlay to batch mode for the rest of the session.
          comment.delivered = false;
          state.comments.push(comment);
          state.mode = 'batch';
          refreshSubmitBtn();
          showToast('Channel unreachable — kept locally');
        }
      } else {
        comment.delivered = false;
        state.comments.push(comment);
        refreshSubmitBtn();
        showToast('Saved — submit when ready');
      }
    });
  };

  const onClick = (e) => {
    if (!state.picking) return;
    if (isOverlayNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    state.picking = false;
    setPickingCursor(false);
    clearHover();
    toggleBtn.setAttribute('data-active', '0');
    toggleBtn.textContent = 'Add Feedback';
    if (!findVariant(e.target)) return;
    openCommentPopup(e.target, e.clientX, e.clientY);
  };

  const openSubmitModal = () => {
    const pending = pendingCount();
    const isLive = state.mode === 'live';
    // Block only when there's truly nothing to send: no pending comments AND
    // no overall direction so far. In live mode that's the same check.
    if (pending === 0 && !state.overall && state.comments.length === 0) {
      showToast('No feedback yet');
      return;
    }

    const heading = isLive
      ? (pending > 0 ? `Finish: ${pending} pending + overall direction` : 'Finish: add overall direction')
      : `Submit ${pending} comment${pending === 1 ? '' : 's'}`;
    const modeNote = isLive
      ? (pending > 0
          ? `${state.comments.length - pending} comment(s) already streamed; ${pending} pending will go with submit.`
          : `All comments already streamed. Submit sends your overall direction as the wrap-up.`)
      : `Will POST JSONL (or download if no endpoint).`;

    const ta = el('textarea', { placeholder: 'Overall direction (e.g. "Go with B\'s layout, A\'s button styling")' }, state.overall);
    const submit = el('button', { class: `${PFX}-btn-primary` }, isLive ? 'Finish' : 'Submit All');
    const cancel = el('button', { class: `${PFX}-btn-ghost` }, 'Cancel');
    const card = el('div', { class: `${PFX}-submit-card` }, [
      el('h3', {}, heading),
      el('p', { style: { margin: '0 0 8px', fontSize: '12px', color: '#666' } },
         `Mode: ${state.mode.toUpperCase()} — ${modeNote}`),
      ta,
      el('div', { class: `${PFX}-row`, style: { marginTop: '12px' } }, [cancel, submit]),
    ]);
    const modal = el('div', { class: `${PFX}-submit-modal`, on: {
      click: (e) => { if (e.target === modal) modal.remove(); },
    }}, card);
    document.body.appendChild(modal);
    setTimeout(() => ta.focus(), 0);
    cancel.addEventListener('click', () => modal.remove());
    submit.addEventListener('click', async () => {
      state.overall = ta.value.trim();
      if (!state.overall) { ta.focus(); return; }
      const ok = await submitBatch();
      modal.remove();
      if (ok) {
        // Mark any undelivered comments as delivered so they don't re-send on a
        // later Finish/Submit. Keep pins as visual history.
        state.comments.forEach(c => { c.delivered = true; });
        refreshSubmitBtn();
      }
      showToast(ok ? (isLive ? 'Finished ✓' : 'Submitted ✓') : 'Submit failed');
    });
  };

  const onToggleClick = () => {
    // Clicking while picking cancels pick; clicking while idle enters pick OR opens submit on long-press — keep simple: left-click picks, right-click submits.
    if (state.picking) {
      state.picking = false; setPickingCursor(false); clearHover();
      toggleBtn.setAttribute('data-active', '0'); toggleBtn.textContent = 'Add Feedback';
      return;
    }
    state.picking = true;
    setPickingCursor(true);
    toggleBtn.setAttribute('data-active', '1');
    toggleBtn.textContent = 'Cancel pick';
  };

  const buildUI = () => {
    injectStyles();
    toggleBtn = el('button', { class: `${PFX}-btn ${PFX}-toggle`, on: {
      click: onToggleClick,
    }}, 'Add Feedback');
    submitBtn = el('button', { class: `${PFX}-btn ${PFX}-submit`, on: {
      click: openSubmitModal,
    }});
    refreshSubmitBtn();
    const bar = el('div', { class: `${PFX}-bar` }, [submitBtn, toggleBtn]);
    modeBadge = el('div', { class: `${PFX}-mode` }, `${state.mode === 'live' ? 'LIVE' : 'BATCH'} mode`);
    toast = el('div', { class: `${PFX}-toast` });
    document.body.appendChild(bar);
    document.body.appendChild(modeBadge);
    document.body.appendChild(toast);

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
  };

  // ---------- public API ----------

  const LiveCanvas = {
    async init(opts) {
      opts = opts || {};
      state.target = opts.target || 'Component';
      state.channelUrl = opts.channelUrl || null;
      state.batchEndpoint = opts.batchEndpoint || null;

      if (state.channelUrl && await probeChannel(state.channelUrl)) {
        state.mode = 'live';
      } else {
        state.mode = 'batch';
      }
      buildUI();
    },
    getState: () => ({ ...state, comments: [...state.comments] }),
  };

  window.LiveCanvas = LiveCanvas;
})();
