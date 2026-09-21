#!/usr/bin/env node

/**
 * skill-shell.test.js — behavioural tests for the literal shell commands
 * shipped inside skill/command markdown (branch-review, refactor, release,
 * debrief), across all 4 kits.
 *
 * Why this file exists: nothing under tests/ ever ran the commands these
 * specs tell a worker to type. A /debrief worker proved the old ledger
 * count command (`grep -c '^[- ].*· change$'`) miscounts a wrapped bullet
 * whose first physical line's prose happens to end in "· change" but whose
 * real trailing tag (last line) is `· nit`. This suite:
 *   1. EXTRACTS the commands from the SHIPPED markdown files (never
 *      re-types them), so a future wrap or typo in the markdown fails the
 *      test instead of passing silently.
 *   2. Covers the ledger count regex (branch-review + refactor, all 4
 *      kits), the docs-only classifier grep (release + branch-review, all
 *      4 kits), and /debrief's bookmark-rewrite script (all 4 kits, each
 *      run against fixtures laid out under that kit's own config dir).
 *
 * Conventions follow tests/sync-rules/sync-rules.test.js and
 * tests/friction/friction.test.js: self-contained, ephemeral mkdtemp
 * fixtures, cleaned up on exit unless KEEP_TMP is set, negative controls so
 * the suite can prove it can FAIL.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bright: '\x1b[1m' };

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ${colors.green}PASS${colors.reset} ${name}`); }
  else {
    failed++; failures.push({ name, detail });
    console.log(`  ${colors.red}FAIL${colors.reset} ${name}`);
    if (detail) console.log(`       ${colors.yellow}${detail}${colors.reset}`);
  }
}

const tmpDirs = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => {
  if (process.env.KEEP_TMP) return;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// Shells to run every shell-dependent check under. zsh is included only when
// present on this machine — CI/other machines without it just get bash.
const SHELLS = [{ name: 'bash', bin: 'bash' }];
if (spawnSync('which', ['zsh']).status === 0) SHELLS.push({ name: 'zsh', bin: 'zsh' });

function sh(bin, script, opts) {
  return spawnSync(bin, ['-c', script], Object.assign({ encoding: 'utf8' }, opts));
}

// Extract the single line in `content` matching `re`. Throws (loudly, not
// silently) if the count isn't exactly 1 — that's what catches a command
// that got wrapped across two physical lines, or renamed/typo'd away.
function extractLine(content, re, label) {
  const lines = content.split('\n').filter(l => re.test(l));
  if (lines.length !== 1) {
    throw new Error(`${label}: expected exactly 1 matching line, found ${lines.length}`);
  }
  return lines[0].trim();
}

// Extract a fenced ``` ... ``` block whose body contains `marker`.
function extractFence(content, marker) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```') continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '```') j++;
    const block = lines.slice(i + 1, j);
    if (block.some(l => l.includes(marker))) return block;
  }
  throw new Error(`no fenced block found containing "${marker}"`);
}

const KITS = [
  { name: 'claude', dir: '.claude',
    branchReview: 'packages/claude/skills/branch-review/SKILL.md',
    refactor: 'packages/claude/skills/refactor/SKILL.md',
    release: 'packages/claude/skills/release/SKILL.md',
    debrief: 'packages/claude/skills/debrief/SKILL.md' },
  { name: 'ampcode', dir: '.amp',
    branchReview: 'packages/ampcode/skills/branch-review/SKILL.md',
    refactor: 'packages/ampcode/skills/refactor/SKILL.md',
    release: 'packages/ampcode/skills/release/SKILL.md',
    debrief: 'packages/ampcode/skills/debrief/SKILL.md' },
  { name: 'droid', dir: '.factory',
    branchReview: 'packages/droid/commands/branch-review.md',
    refactor: 'packages/droid/commands/refactor.md',
    release: 'packages/droid/commands/release.md',
    debrief: 'packages/droid/commands/debrief.md' },
  { name: 'opencode', dir: '.opencode',
    branchReview: 'packages/opencode/command/branch-review.md',
    refactor: 'packages/opencode/command/refactor.md',
    release: 'packages/opencode/command/release.md',
    debrief: 'packages/opencode/command/debrief.md' },
];

console.log(`\n${colors.bright}${colors.cyan}skill-shell.test.js${colors.reset}\n`);
console.log(`Shells under test: ${SHELLS.map(s => s.name).join(', ')}\n`);

// ---------------------------------------------------------------------------
// a. Ledger count — extracted from branch-review + refactor, all 4 kits.
// ---------------------------------------------------------------------------
console.log(`${colors.bright}-- ledger count --${colors.reset}`);

// Deliberately LOOSE: matches any `grep -c` / `grep -cE` (or similar single
// flag-letter variant) targeting a ledger file, whatever the pattern inside
// the quotes is. This is what makes the test behavioural rather than a text
// pin — the OLD buggy command and the NEW fixed one both match this shape,
// so a regression in the markdown is caught by RUNNING the extracted line
// against the fixtures and getting the wrong count, not by the extraction
// step failing to find text it was told to expect verbatim.
const LEDGER_LINE_RE = /^\s*grep -c\S* '.*' \S+\/remember\/fix-ledger\.md\s*$/;

// Extract exactly 2 ledger count commands (total, then K) from a shipped
// file. Throws on anything else — including 0 (command deleted), 1 (one of
// the pair missing), or >2 (an extra line that also matches the shape) —
// but ever throw is caught at the call site, never left to crash the suite.
function extractLedgerCommands(content, label) {
  const lines = content.split('\n').filter(l => LEDGER_LINE_RE.test(l));
  if (lines.length !== 2) {
    throw new Error(`${label}: expected exactly 2 ledger count commands (total, K), found ${lines.length}`);
  }
  return { totalCmd: lines[0].trim(), kCmd: lines[1].trim() };
}

// One normalized { label, totalCmd, kCmd } per kit/label, path swapped for a
// LEDGER placeholder — the fixture matrix below runs EVERY kit's own command,
// not just claude's, so a per-kit drift in these lines would be caught here
// even on a day mirror.cjs check didn't run.
const extractedLedgerCmds = [];

for (const kit of KITS) {
  for (const [label, relPath] of [['branch-review', kit.branchReview], ['refactor', kit.refactor]]) {
    const content = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    let cmds;
    try {
      cmds = extractLedgerCommands(content, `${kit.name}/${label}`);
    } catch (e) {
      // A missing/wrapped/duplicated command is a FAIL, not a crash — the
      // rest of the suite (every other kit, the docs-only and bookmark
      // sections) still runs and still reports.
      check(`${kit.name}/${label}: ledger commands present, unwrapped`, false, e.message);
      continue;
    }
    check(`${kit.name}/${label}: ledger commands present, unwrapped`, true);
    check(`${kit.name}/${label}: total command targets ${kit.dir}`, cmds.totalCmd.includes(`${kit.dir}/remember/fix-ledger.md`), cmds.totalCmd);
    check(`${kit.name}/${label}: K command targets ${kit.dir}`, cmds.kCmd.includes(`${kit.dir}/remember/fix-ledger.md`), cmds.kCmd);
    extractedLedgerCmds.push({
      label: `${kit.name}/${label}`,
      totalCmd: cmds.totalCmd.replace(`${kit.dir}/remember/fix-ledger.md`, 'LEDGER'),
      kCmd: cmds.kCmd.replace(`${kit.dir}/remember/fix-ledger.md`, 'LEDGER'),
    });
  }
}

// Regression proof: extraction must fail loudly (throw), not silently pass,
// when the commands are missing from a file — otherwise a deleted/renamed
// command would slip through as if nothing changed. The throw itself is
// fine; every call site above already catches it.
{
  let threw = false;
  try { extractLedgerCommands('no such command here\n', 'missing-case'); }
  catch (e) { threw = true; }
  check('extractLedgerCommands throws when the commands are absent (loud failure, not silent pass)', threw);
}

// Fixture-driven behaviour, run under every available shell.
const dot = '·';
const LEDGER_CASES = [
  {
    name: 'wrapped bullet, first line prose ends "· change", real tag (last line) is nit',
    content: `- Scenario five: this fix does not require a behavioural ${dot} change\n`
      + `  contrary to how it first looked, everything here is\n`
      + `  actually just a nit ${dot} 2026-09-21 @ abc1234 ${dot} nit\n`,
    total: 1, k: 0,
  },
  {
    name: 'untagged old-format bullet',
    content: `- \`path/file.js\` ${dot} "verbatim snippet" ${dot} what's wrong ${dot} failure scenario ${dot} 2026-09-21 @ abc1234\n`,
    total: 1, k: 0,
  },
  {
    name: 'one-line nit',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot} scenario ${dot} 2026-09-21 @ abc1234 ${dot} nit\n`,
    total: 1, k: 0,
  },
  {
    name: 'one-line change',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot} scenario ${dot} 2026-09-21 @ abc1234 ${dot} change\n`,
    total: 1, k: 1,
  },
  {
    name: 'wrapped bullet whose LAST line is the real "· change" tag',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot}\n`
      + `  scenario ${dot} 2026-09-21 @ abc1234 ${dot} change\n`,
    total: 1, k: 1,
  },
  {
    name: '"> " header line whose prose contains "· change"',
    content: `> A bullet's path may be a glob when the same finding exists in every kit —\n`
      + `> Trailing tag = fix size, not severity; untagged counts as \`nit\`.\n`
      + `> some line mentioning ${dot} change in prose here\n`,
    total: 0, k: 0,
  },
  {
    name: 'full 40-char sha',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot} scenario ${dot} 2026-09-21 @ 9b0c1774a3f9e2d1c0b8a7f6e5d4c3b2a1908f76 ${dot} change\n`,
    total: 1, k: 1,
  },
  {
    name: 'empty ledger file',
    content: ``,
    total: 0, k: 0,
  },
  {
    name: 'ledger whose last line has no trailing newline',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot} scenario ${dot} 2026-09-21 @ abc1234 ${dot} change`,
    total: 1, k: 1,
  },
];

if (extractedLedgerCmds.length === 0) {
  check('ledger fixture matrix: skipped — could not extract any commands', false,
    'see the extraction FAIL above for the reason');
} else {
  for (const shell of SHELLS) {
    for (const entry of extractedLedgerCmds) {
      const dir = tmpDir('skill-shell-ledger-');
      for (const c of LEDGER_CASES) {
        const f = path.join(dir, 'fix-ledger.md');
        fs.writeFileSync(f, c.content);
        const totalCmd = entry.totalCmd.replace('LEDGER', f);
        const kCmd = entry.kCmd.replace('LEDGER', f);
        const totalOut = sh(shell.bin, totalCmd).stdout.trim();
        const kOut = sh(shell.bin, kCmd).stdout.trim();
        check(`[${shell.name}] ${entry.label} ${c.name}: total=${c.total}`, totalOut === String(c.total), `got ${totalOut}`);
        check(`[${shell.name}] ${entry.label} ${c.name}: K=${c.k}`, kOut === String(c.k), `got ${kOut}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// b. Docs-only classifier — extracted from release + branch-review, all 4 kits.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- docs-only classifier --${colors.reset}`);

// Loose on purpose, like the ledger extraction above: matches any
// `grep -vE '...'` on a single physical line, whatever the pattern inside
// the quotes is, so a broken/typo'd pattern is caught by RUNNING it against
// the fixtures below, not by the extraction step failing to find text it
// was told to expect verbatim.
const DOCS_LINE_RE = /grep -vE '[^']*'/;

function extractDocsGrep(content, label) {
  const lines = content.split('\n').filter(l => DOCS_LINE_RE.test(l));
  if (lines.length !== 1) {
    throw new Error(`${label}: expected exactly 1 docs-only grep line, found ${lines.length}`);
  }
  return lines[0].match(DOCS_LINE_RE)[0];
}

// One { label, cmd } per kit/label — run behaviorally below for every kit,
// not just claude, same rationale as the ledger commands above.
const extractedDocsGreps = [];

for (const kit of KITS) {
  for (const [label, relPath] of [['release', kit.release], ['branch-review', kit.branchReview]]) {
    const content = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    let cmd;
    try {
      cmd = extractDocsGrep(content, `${kit.name}/${label}`);
    } catch (e) {
      check(`${kit.name}/${label}: docs-only grep present exactly once, unwrapped`, false, e.message);
      continue;
    }
    check(`${kit.name}/${label}: docs-only grep present exactly once, unwrapped`, true);
    extractedDocsGreps.push({ label: `${kit.name}/${label}`, cmd });
  }
}

const DOCS_CASES = [
  { name: 'all-docs path list prints nothing', input: 'docs/a.md\nREADME.md\n', expected: '' },
  { name: 'mixed list prints every non-docs path',
    input: 'packages/claude/skills/ship/SKILL.md\nsrc/x.js\nsub/NOTES.md\npackages/subagentic-manual.md\n',
    expected: 'packages/claude/skills/ship/SKILL.md\nsrc/x.js\nsub/NOTES.md\npackages/subagentic-manual.md' },
];

if (extractedDocsGreps.length === 0) {
  check('docs-only fixture matrix: skipped — could not extract any grep', false,
    'see the extraction FAIL above for the reason');
} else {
  for (const shell of SHELLS) {
    for (const entry of extractedDocsGreps) {
      for (const c of DOCS_CASES) {
        const r = sh(shell.bin, entry.cmd, { input: c.input });
        const got = r.stdout.replace(/\n$/, '');
        check(`[${shell.name}] ${entry.label} docs-only: ${c.name}`, got === c.expected, `got ${JSON.stringify(got)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// c. /debrief bookmark script — extracted per kit, run against that kit's
//    own config-dir layout.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- debrief bookmark script --${colors.reset}`);

function bookmarkScript(kit) {
  const content = fs.readFileSync(path.join(ROOT, kit.debrief), 'utf8');
  const block = extractFence(content, 'mkdir -p');
  check(`${kit.name}/debrief: bookmark fence targets ${kit.dir}`,
    block.some(l => l.includes(`${kit.dir}/remember`)), block.join('\\n'));
  return block.join('\n');
}

function runBookmark(shell, script, cwd, sha) {
  const filled = script.replace('<full HEAD sha>', sha);
  return sh(shell.bin, filled, { cwd });
}

for (const kit of KITS) {
  let script;
  try {
    script = bookmarkScript(kit);
  } catch (e) {
    check(`${kit.name}/debrief: bookmark script extracted`, false, e.message);
    continue;
  }
  for (const shell of SHELLS) {
    // c1. no config dir -> creates dir + file with exactly one debrief-sha line.
    {
      const cwd = tmpDir('skill-shell-bm-fresh-');
      const sha1 = 'a'.repeat(40);
      runBookmark(shell, script, cwd, sha1);
      const recordPath = path.join(cwd, kit.dir, 'remember', 'last-review.md');
      const exists = fs.existsSync(recordPath);
      check(`[${shell.name}] ${kit.name}: fresh run creates ${kit.dir}/remember/last-review.md`, exists);
      if (exists) {
        const body = fs.readFileSync(recordPath, 'utf8');
        const dsLines = body.split('\n').filter(l => l.startsWith('debrief-sha:'));
        check(`[${shell.name}] ${kit.name}: fresh run — exactly one debrief-sha line`, dsLines.length === 1, body);
        check(`[${shell.name}] ${kit.name}: fresh run — holds the sha`, dsLines[0] === `debrief-sha: ${sha1}`, dsLines[0]);
      }
    }

    // c2. existing multi-line record (2-item blockers list + a ledger line) ->
    //     every other line byte-identical; run twice with different shas ->
    //     exactly one debrief-sha line holding the SECOND sha.
    {
      const cwd = tmpDir('skill-shell-bm-existing-');
      const recordDir = path.join(cwd, kit.dir, 'remember');
      fs.mkdirSync(recordDir, { recursive: true });
      const recordPath = path.join(recordDir, 'last-review.md');
      const original = [
        'sha: 1111111111111111111111111111111111111111',
        'branch: feat/x',
        'target: main..HEAD',
        'verdict: blocked',
        'ledger: 2 nits, 1 changes, 0 added',
        'blockers:',
        '- a.js:1 · first blocker',
        '- b.js:2 · second blocker',
      ];
      fs.writeFileSync(recordPath, original.join('\n') + '\n');

      const sha1 = 'b'.repeat(40);
      const sha2 = 'c'.repeat(40);
      runBookmark(shell, script, cwd, sha1);
      runBookmark(shell, script, cwd, sha2);

      const body = fs.readFileSync(recordPath, 'utf8');
      const bodyLines = body.split('\n').filter(l => l.length > 0);
      const dsLines = bodyLines.filter(l => l.startsWith('debrief-sha:'));
      const otherLines = bodyLines.filter(l => !l.startsWith('debrief-sha:'));

      check(`[${shell.name}] ${kit.name}: existing record — run twice, exactly one debrief-sha line`,
        dsLines.length === 1, `lines: ${JSON.stringify(dsLines)}`);
      check(`[${shell.name}] ${kit.name}: existing record — holds the SECOND sha`,
        dsLines[0] === `debrief-sha: ${sha2}`, dsLines[0]);
      check(`[${shell.name}] ${kit.name}: existing record — every other line byte-identical`,
        JSON.stringify(otherLines) === JSON.stringify(original), JSON.stringify(otherLines));

      const shaLines = body.split('\n').filter(l => l.startsWith('sha:'));
      check(`[${shell.name}] ${kit.name}: grep '^sha:' still returns exactly one line`,
        shaLines.length === 1 && shaLines[0] === original[0], JSON.stringify(shaLines));
    }

    // c3. existing record whose LAST line has no trailing newline.
    {
      const cwd = tmpDir('skill-shell-bm-nonl-');
      const recordDir = path.join(cwd, kit.dir, 'remember');
      fs.mkdirSync(recordDir, { recursive: true });
      const recordPath = path.join(recordDir, 'last-review.md');
      // no trailing \n after the last line
      fs.writeFileSync(recordPath, 'sha: 2222222222222222222222222222222222222222\nverdict: ready\nledger: none');

      const sha1 = 'd'.repeat(40);
      runBookmark(shell, script, cwd, sha1);

      const body = fs.readFileSync(recordPath, 'utf8');
      const glued = /ledger: nonedebrief-sha:/.test(body);
      check(`[${shell.name}] ${kit.name}: no-trailing-newline record — bookmark NOT glued onto the previous line`,
        !glued, JSON.stringify(body));
      const dsLines = body.split('\n').filter(l => l.startsWith('debrief-sha:'));
      check(`[${shell.name}] ${kit.name}: no-trailing-newline record — bookmark still lands as its own line`,
        dsLines.length === 1 && dsLines[0] === `debrief-sha: ${sha1}`, JSON.stringify(body));
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
console.log(`Total tests: ${passed + failed}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
if (failed) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
process.exit(failed ? 1 : 0);
