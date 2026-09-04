#!/usr/bin/env node
'use strict';

/**
 * sync-rules.cjs — keeps a repo's AGENT_RULES.md current with the installed
 * template, without ever destroying what was there.
 *
 * Run every /remember, from the target repo. Before this existed, the rules
 * were bootstrapped once and never refreshed, so a measured 35 local repos
 * drifted to a body many releases old and three hand sweeps failed to hold.
 *
 * Three outcomes, decided by a byte compare — not a stored hash, because the
 * only question is "am I about to change this file?", which any careful copy
 * asks anyway:
 *
 *   absent     copy it in and say so
 *   identical  do nothing at all: no write, no backup, no output
 *   differs    move the old body aside, copy the new one in, say so loudly
 *
 * THE BACKUP IS A SINGLE FILE and is overwritten on each differing run. A
 * customised file therefore survives exactly one update: fold your changes
 * into the new AGENT_RULES.md before the next release, or the next sync
 * replaces the backup with a vanilla body. This is a deliberate trade — see
 * docs/product/agent-rules-freshness-prd.md §5 — chosen over accumulating
 * timestamped backups.
 */

const fs = require('fs');
const path = require('path');

// Per-kit PROJECT dir. NOTE this is not always the global config dir: amp
// installs to ~/.config/amp but writes .amp/ in a repo, and opencode likewise.
// This is the ONE line that differs across packages.
const PROJECT_DIR = '.amp';

const RULES = 'AGENT_RULES.md';
const BACKUP = 'AGENT_RULES.md.bak';   // keeps the origin name; not .md, so doc tooling ignores it

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

function templatePath() {
  // Ships beside this script, so no path guessing and no dependence on where
  // the kit was installed.
  return path.join(__dirname, RULES);
}

function targetPath(repo) {
  return path.join(repo, PROJECT_DIR, 'remember', RULES);
}

/**
 * @returns {{action:string, detail?:string}} action is one of:
 *   'no-template' | 'bootstrapped' | 'unchanged' | 'updated' | 'failed'
 */
function sync(repo) {
  const tpl = templatePath();
  let template;
  try {
    template = fs.readFileSync(tpl);
  } catch (e) {
    return { action: 'no-template', detail: tpl };
  }

  const target = targetPath(repo);
  if (escapesRepo(repo, target)) return { action: 'escapes', detail: target };

  let current = null;
  try { current = fs.readFileSync(target); } catch (e) { /* absent */ }

  // Byte compare. No normalisation on either side: the copy below is a plain
  // byte write, so a mismatch here means the content really differs.
  if (current && current.equals(template)) return { action: 'unchanged' };

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (current) {
      // Single backup, overwritten. rename() is atomic on the same filesystem
      // and cannot leave a half-written backup the way copy+truncate could.
      fs.renameSync(target, path.join(path.dirname(target), BACKUP));
    }
    fs.writeFileSync(target, template);
  } catch (e) {
    return { action: 'failed', detail: e.message };
  }

  return current ? { action: 'updated' } : { action: 'bootstrapped' };
}

function main() {
  const repo = process.argv[2] || process.cwd();
  const r = sync(repo);
  const rel = path.join(PROJECT_DIR, 'remember', RULES);

  switch (r.action) {
    case 'unchanged':
      break;                                  // silent: nothing happened
    case 'bootstrapped':
      process.stdout.write(`${rel} created from the installed template\n`);
      break;
    case 'updated':
      process.stdout.write(
        `${rel} updated from the installed template `
        + `(previous body kept as ${BACKUP} — fold your changes in before the `
        + `next release, it is a single file and the next update replaces it)\n`);
      break;
    case 'escapes':
      // Loud, never repaired: the path is under the repo but does not stay
      // there, so any write lands somewhere the run was not invited.
      process.stdout.write(
        `${rel} not synced: it leaves the repo via a symlink — refusing to `
        + `write through it\n`);
      break;
    case 'no-template':
      // Loud: this means the install is incomplete, not that nothing changed.
      process.stdout.write(
        `AGENT_RULES.md not synced: no template beside this script (${r.detail})\n`);
      break;
    case 'failed':
      process.stdout.write(`AGENT_RULES.md not synced: ${r.detail}\n`);
      break;
  }
}

if (require.main === module) {
  // A passenger on /remember, like version-check.cjs: it never gets to fail
  // the run it rides in.
  try { main(); } catch (e) { /* silent */ }
}

module.exports = { sync, PROJECT_DIR, RULES, BACKUP };
