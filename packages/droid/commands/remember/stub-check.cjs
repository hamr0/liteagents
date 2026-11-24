#!/usr/bin/env node
'use strict';

/**
 * stub-check.cjs — asserts the two managed blocks in the tool config carry the
 * CURRENT stub shape, and repairs the shape when it is wrong.
 *
 * Shape, not content. The blocks' prose is user-owned — step 5 writes it once
 * and never re-imposes it, because users trim it deliberately. What this script
 * touches is only the mechanism:
 *
 *   MEMORY block       @<PROJECT_DIR>/remember/MEMORY.md   — an @-include.
 *                      A bare `@MEMORY.md` resolves relative to the file that
 *                      contains it, so in a repo root it names a file that does
 *                      not exist and hot memory silently never loads.
 *
 *   AGENT_RULES block  <PROJECT_DIR>/remember/AGENT_RULES.md — a PLAIN pointer.
 *                      v2.19 demoted it from an @-include on purpose: it is a
 *                      standards guide to consult when building something new,
 *                      not hot context, and @-including it loads ~300 lines into
 *                      every session. Measured 2026-09-03: 21 of 37 local repos
 *                      still carried the pre-v2.19 @-include.
 *
 * Two deliberate limits:
 *
 *   - It only edits INSIDE a marker pair. A pointer elsewhere in the config is
 *     the user's prose and is left alone.
 *   - It never repoints the MEMORY include at a file that does not exist. An
 *     un-migrated `.factory/memory/` repo has a live MEMORY.md at the old path;
 *     rewriting it to the new one would break a working include to satisfy a
 *     naming convention. That case is reported, not repaired.
 *
 * Third block, DEV_RULES, is the one exception to "shape, not content": its
 * content is NOT user-owned. It is replaced byte-for-byte with the block
 * between the same markers in the installed AGENT_RULES.md, so every repo
 * carries the one current wording instead of a stale copy. If the config has
 * no DEV_RULES pair, the block is inserted just before MEMORY:START (appended
 * when there is none). A differing block is replaced only after the config is
 * copied to <config>.bak (single file, overwritten, like sync-rules.cjs). An
 * unmanaged `## Dev Rules` section outside the markers (heading up to the next
 * `## ` heading, a marker, or EOF) is replaced by the managed block, same
 * .bak; if a managed block already exists it is only reported. Only this
 * script writes the block.
 *
 * Missing MEMORY / AGENT_RULES marker pairs are not this script's business —
 * step 5 creates them.
 */

const fs = require('fs');
const path = require('path');

// The ONE pair of lines that differs across packages.
const PROJECT_DIR = '.factory';
const CONFIG_FILE = 'AGENTS.md';

const MEM = { start: '<!-- MEMORY:START -->', end: '<!-- MEMORY:END -->' };
const RULES = { start: '<!-- AGENT_RULES:START -->', end: '<!-- AGENT_RULES:END -->' };

const DEV = { start: '<!-- DEV_RULES:START -->', end: '<!-- DEV_RULES:END -->' };

const MEMORY_REL = `${PROJECT_DIR}/remember/MEMORY.md`;
const RULES_REL = `${PROJECT_DIR}/remember/AGENT_RULES.md`;

/** lstat, not existsSync: existsSync follows links, so a DANGLING link reads
 *  as absent and gets walked straight past. */
function lexists(p) {
  try { fs.lstatSync(p); return true; } catch (e) { return false; }
}

/**
 * True when writing to `target` would land outside `repo`.
 *
 * There are two ways out and a guard on only one of them is false safety:
 * `target` may itself be a symlink — including a dangling one, which reads as
 * "the file is absent" and is still followed on write — or any parent
 * directory may be a link pointing elsewhere. This runs across a whole fleet
 * of repos, so a relative link only has to reach a sibling checkout.
 *
 * A link that stays INSIDE the repo is not an escape: a repo that keeps its
 * rules or its config behind an in-repo symlink is an ordinary setup, and
 * refusing it would strand that repo forever. So the leaf is followed by hand
 * with readlink — which works on a dangling link, where realpath cannot — and
 * each hop re-resolves the parents, because the file a link points at can sit
 * behind a linked directory of its own.
 */
function escapesRepo(repo, target) {
  let root;
  try { root = fs.realpathSync(repo); } catch (e) { return true; }

  let p = path.resolve(target);
  for (let hop = 0; hop < 40; hop++) {
    // Resolve the existing part of the path. Walk up to the deepest ancestor
    // that exists; anything below it cannot be a link yet.
    const tail = [];
    let dir = path.dirname(p);
    while (!lexists(dir)) {
      tail.unshift(path.basename(dir));
      const up = path.dirname(dir);
      if (up === dir) return true;                  // walked off the filesystem root
      dir = up;
    }
    try { p = path.join(fs.realpathSync(dir), ...tail, path.basename(p)); }
    catch (e) { return true; }                      // an ancestor is a dangling link

    let to;
    try { to = fs.readlinkSync(p); } catch (e) {
      return p !== root && !p.startsWith(root + path.sep);   // not a link: decide here
    }
    p = path.resolve(path.dirname(p), to);
  }
  return true;                                      // a link cycle: refuse
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return null; }
}

/** Index range of the lines strictly between a marker pair, or null. */
function blockRange(lines, markers) {
  const s = lines.findIndex((l) => l.trim() === markers.start);
  if (s === -1) return null;
  const e = lines.findIndex((l, i) => i > s && l.trim() === markers.end);
  if (e === -1) return null;
  return { from: s + 1, to: e };            // [from, to)
}

/**
 * @returns {{fixes:string[], notes:string[], changed:boolean}}
 *   fixes  — repairs written to disk
 *   notes  — wrong shapes deliberately left alone, with the reason
 */
function check(repo) {
  const config = path.join(repo, CONFIG_FILE);
  const fixes = [];
  const notes = [];

  // Checked before the read, not just before the write: a repair decided
  // from a followed link is already the wrong decision.
  if (escapesRepo(repo, config)) {
    return { fixes, notes: [`${CONFIG_FILE} not checked: it leaves the repo via a symlink`], changed: false };
  }

  let text;
  try { text = fs.readFileSync(config, 'utf8'); } catch (e) {
    return { fixes, notes, changed: false };  // no config: step 5 will create one
  }

  const lines = text.split('\n');
  let changed = false;

  // ── MEMORY block: must be an @-include naming the explicit path ────────────
  const mem = blockRange(lines, MEM);
  if (mem) {
    const i = lines.findIndex(
      (l, n) => n >= mem.from && n < mem.to && /^@\S*MEMORY\.md\s*$/.test(l.trim()));
    if (i === -1) {
      notes.push(`${CONFIG_FILE}: MEMORY block has no @-include — hot memory does not load`);
    } else {
      const want = `@${MEMORY_REL}`;
      const have = lines[i].trim();
      if (have !== want) {
        if (fs.existsSync(path.join(repo, MEMORY_REL))) {
          lines[i] = want;
          changed = true;
          fixes.push(`${CONFIG_FILE}: MEMORY include repaired, ${have} → ${want}`);
        } else {
          // The old path may be the only one with a file behind it.
          notes.push(
            `${CONFIG_FILE}: MEMORY include is ${have}, not ${want} — left as is, `
            + `${MEMORY_REL} does not exist yet`);
        }
      }
    }
  }

  // ── AGENT_RULES block: must be a PLAIN pointer, never an @-include ─────────
  const rules = blockRange(lines, RULES);
  if (rules) {
    const i = lines.findIndex(
      (l, n) => n >= rules.from && n < rules.to && /^@\S*AGENT_RULES\.md\s*$/.test(l.trim()));
    if (i !== -1) {
      // Demote in place. The path is kept as written — only the @ is dropped,
      // because the @ is the defect and the path may be a deliberate variant.
      const had = lines[i].trim();
      lines[i] = had.slice(1);
      changed = true;
      fixes.push(
        `${CONFIG_FILE}: AGENT_RULES pointer demoted from an @-include (${had} → ${had.slice(1)}) `
        + `— it is a standards guide, not hot context`);
    } else {
      const hasPointer = lines
        .slice(rules.from, rules.to)
        .some((l) => /AGENT_RULES\.md/.test(l));
      if (!hasPointer) {
        notes.push(`${CONFIG_FILE}: AGENT_RULES block has no path pointer — nothing points at the rules`);
      }
    }
  }

  // ── DEV_RULES block: content synced from the installed AGENT_RULES.md ──────
  let backup = false;
  const rulesFile = path.join(repo, RULES_REL);
  const srcLines = escapesRepo(repo, rulesFile) ? null : readLines(rulesFile);
  const src = srcLines && blockRange(srcLines, DEV);
  if (src) {
    const want = srcLines.slice(src.from, src.to);
    const dev = blockRange(lines, DEV);
    const outside = lines.findIndex(
      (l, n) => /^##\s+Dev Rules\b/i.test(l) && !(dev && n >= dev.from && n < dev.to));
    if (outside !== -1 && dev) {
      notes.push(
        `${CONFIG_FILE}: unmanaged "${lines[outside].trim()}" (line ${outside + 1}) is outside the `
        + `DEV_RULES markers and a managed block already exists — delete the unmanaged one`);
    }
    if (dev) {
      if (lines.slice(dev.from, dev.to).join('\n') !== want.join('\n')) {
        lines.splice(dev.from, dev.to - dev.from, ...want);
        backup = true;
        changed = true;
        fixes.push(`${CONFIG_FILE}: DEV_RULES block replaced from ${RULES_REL} (previous config kept as ${CONFIG_FILE}.bak)`);
      }
    } else if (outside !== -1) {
      // The unmanaged section runs to the next `## ` heading, a marker, or EOF.
      let end = lines.findIndex((l, n) => n > outside && (/^## /.test(l) || /^<!--\s*\S+:START\s*-->$/.test(l.trim())));
      if (end === -1) end = lines.length;
      while (end > outside + 1 && lines[end - 1].trim() === '') end--;   // keep the blank lines before what follows
      const head = lines[outside].trim();
      lines.splice(outside, end - outside, DEV.start, ...want, DEV.end);
      backup = true;
      changed = true;
      fixes.push(`${CONFIG_FILE}: unmanaged "${head}" (lines ${outside + 1}-${end}) replaced by the DEV_RULES block (previous config kept as ${CONFIG_FILE}.bak)`);
    } else {
      const at = lines.findIndex((l) => l.trim() === MEM.start);
      const block = [DEV.start, ...want, DEV.end, ''];
      if (at === -1) {
        if (lines[lines.length - 1] !== '') lines.push('');
        lines.push(...block.slice(0, -1), '');
      } else {
        lines.splice(at, 0, ...block);
      }
      changed = true;
      fixes.push(`${CONFIG_FILE}: DEV_RULES block inserted from ${RULES_REL}`);
    }
  }

  if (changed) {
    try {
      if (backup) {
        const bak = `${config}.bak`;
        if (escapesRepo(repo, bak)) throw new Error(`${CONFIG_FILE}.bak leaves the repo via a symlink`);
        fs.copyFileSync(config, bak);
      }
      fs.writeFileSync(config, lines.join('\n'));
    } catch (e) {
      return { fixes: [], notes: [`${CONFIG_FILE} not repaired: ${e.message}`], changed: false };
    }
  }

  return { fixes, notes, changed };
}

function main() {
  const repo = process.argv[2] || process.cwd();
  const r = check(repo);
  for (const line of r.fixes) process.stdout.write(`${line}\n`);
  for (const line of r.notes) process.stdout.write(`${line}\n`);
  // Silent when the shape is already current — the common case.
}

if (require.main === module) {
  // A passenger on /remember, like version-check.cjs and sync-rules.cjs: it
  // never gets to fail the run it rides in.
  try { main(); } catch (e) { /* silent */ }
}

module.exports = { check, PROJECT_DIR, CONFIG_FILE, MEMORY_REL, RULES_REL };
