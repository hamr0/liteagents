#!/usr/bin/env node

/**
 * skill-shell.test.js — behavioural tests for the literal shell commands
 * shipped inside skill/command markdown (branch-review, refactor, release,
 * self-review), across all 4 kits.
 *
 * Why this file exists: nothing under tests/ ever ran the commands these
 * specs tell a worker to type. A /self-review worker proved the old ledger
 * count command (`grep -c '^[- ].*· change$'`) miscounts a wrapped bullet
 * whose first physical line's prose happens to end in "· change" but whose
 * real trailing tag (last line) is `· nit`. This suite:
 *   1. EXTRACTS the commands from the SHIPPED markdown files (never
 *      re-types them), so a future wrap or typo in the markdown fails the
 *      test instead of passing silently.
 *   2. Covers the ledger count regex (branch-review + refactor, all 4
 *      kits), the docs-only classifier grep (release + branch-review, all
 *      4 kits), and /self-review's bookmark-rewrite script (all 4 kits, each
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

// Extract a fenced ``` ... ``` block whose body contains `marker`. By default
// only a bare, unindented ``` opener matches and lines come back as-is. With
// `indented`, any line starting with ``` (indented, or with a language tag like
// ```bash) opens the block and lines come back trimmed — the stash markdown
// nests its fence inside a numbered list item.
function extractFence(content, marker, indented = false) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const opens = indented ? lines[i].trim().startsWith('```') : lines[i].trim() === '```';
    if (!opens) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '```') j++;
    const block = lines.slice(i + 1, j).map(l => indented ? l.trim() : l);
    if (block.some(l => l.includes(marker))) return block;
  }
  throw new Error(`no fenced block found containing "${marker}"`);
}

const KITS = [
  { name: 'claude', dir: '.claude',
    branchReview: 'packages/claude/skills/branch-review/SKILL.md',
    refactor: 'packages/claude/skills/refactor/SKILL.md',
    release: 'packages/claude/skills/release/SKILL.md',
    selfReview: 'packages/claude/skills/self-review/SKILL.md',
    stash: 'packages/claude/skills/stash/SKILL.md',
    security: 'packages/claude/skills/security/SKILL.md' },
  { name: 'ampcode', dir: '.amp',
    branchReview: 'packages/ampcode/skills/branch-review/SKILL.md',
    refactor: 'packages/ampcode/skills/refactor/SKILL.md',
    release: 'packages/ampcode/skills/release/SKILL.md',
    selfReview: 'packages/ampcode/skills/self-review/SKILL.md',
    stash: 'packages/ampcode/skills/stash/SKILL.md',
    security: 'packages/ampcode/skills/security/SKILL.md' },
  { name: 'droid', dir: '.factory',
    branchReview: 'packages/droid/commands/branch-review.md',
    refactor: 'packages/droid/commands/refactor.md',
    release: 'packages/droid/commands/release.md',
    selfReview: 'packages/droid/commands/self-review.md',
    stash: 'packages/droid/commands/stash.md',
    security: 'packages/droid/commands/security.md' },
  { name: 'opencode', dir: '.opencode',
    branchReview: 'packages/opencode/command/branch-review.md',
    refactor: 'packages/opencode/command/refactor.md',
    release: 'packages/opencode/command/release.md',
    selfReview: 'packages/opencode/command/self-review.md',
    stash: 'packages/opencode/command/stash.md',
    security: 'packages/opencode/command/security.md' },
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

// Extract exactly 3 ledger count commands (total, then K, then I) from a shipped
// file. Throws on anything else — including 0 (command deleted), 1 (one of
// the pair missing), or >2 (an extra line that also matches the shape) —
// but ever throw is caught at the call site, never left to crash the suite.
function extractLedgerCommands(content, label) {
  const lines = content.split('\n').filter(l => LEDGER_LINE_RE.test(l));
  if (lines.length !== 3) {
    throw new Error(`${label}: expected exactly 3 ledger count commands (total, K, I), found ${lines.length}`);
  }
  return { totalCmd: lines[0].trim(), kCmd: lines[1].trim(), iCmd: lines[2].trim() };
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
    check(`${kit.name}/${label}: I command targets ${kit.dir}`, cmds.iCmd.includes(`${kit.dir}/remember/fix-ledger.md`), cmds.iCmd);
    extractedLedgerCmds.push({
      label: `${kit.name}/${label}`,
      totalCmd: cmds.totalCmd.replace(`${kit.dir}/remember/fix-ledger.md`, 'LEDGER'),
      kCmd: cmds.kCmd.replace(`${kit.dir}/remember/fix-ledger.md`, 'LEDGER'),
      iCmd: cmds.iCmd.replace(`${kit.dir}/remember/fix-ledger.md`, 'LEDGER'),
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
    name: 'one-line idea is not a nit',
    content: `- \`x.js\` ${dot} "snip" ${dot} desc ${dot} scenario ${dot} 2026-09-21 @ abc1234 ${dot} idea\n`,
    total: 1, k: 0, i: 1,
  },
  {
    name: 'wrapped bullet, first line prose ends "· idea", real tag (last line) is nit',
    content: `- Scenario: not really an ${dot} idea\n`
      + `  after all ${dot} 2026-09-21 @ abc1234 ${dot} nit\n`,
    total: 1, k: 0, i: 0,
  },
  {
    name: 'mixed ledger: nit + untagged + change + idea',
    content: `- \`a.js\` ${dot} "s" ${dot} d ${dot} f ${dot} 2026-09-21 @ abc1234 ${dot} nit\n`
      + `- \`b.js\` ${dot} "s" ${dot} d ${dot} f ${dot} 2026-09-21 @ abc1234\n`
      + `- \`c.js\` ${dot} "s" ${dot} d ${dot} f ${dot} 2026-09-21 @ abc1234 ${dot} change\n`
      + `- \`d.js\` ${dot} "s" ${dot} d ${dot} f ${dot} 2026-09-21 @ abc1234 ${dot} idea\n`,
    total: 4, k: 1, i: 1, n: 2,
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
        const iCmd = entry.iCmd.replace('LEDGER', f);
        const totalOut = sh(shell.bin, totalCmd).stdout.trim();
        const kOut = sh(shell.bin, kCmd).stdout.trim();
        check(`[${shell.name}] ${entry.label} ${c.name}: total=${c.total}`, totalOut === String(c.total), `got ${totalOut}`);
        check(`[${shell.name}] ${entry.label} ${c.name}: K=${c.k}`, kOut === String(c.k), `got ${kOut}`);
        const iOut = sh(shell.bin, iCmd).stdout.trim();
        const wantI = c.i || 0;
        check(`[${shell.name}] ${entry.label} ${c.name}: I=${wantI}`, iOut === String(wantI), `got ${iOut}`);
        const wantN = c.n !== undefined ? c.n : c.total - c.k - wantI;
        check(`[${shell.name}] ${entry.label} ${c.name}: N=total-K-I=${wantN}`,
          Number(totalOut) - Number(kOut) - Number(iOut) === wantN, `got ${Number(totalOut) - Number(kOut) - Number(iOut)}`);
      }
    }
  }
}

// Phrase pins for the idea-tag rules (honest where the rule is a sentence, not
// a command): /self-review appends every item at relay time; /refactor never
// builds change/idea bullets in ledger mode.
for (const kit of KITS) {
  const flat = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
  check(`${kit.name}/self-review: appends every item to the ledger at relay time`,
    flat(kit.selfReview).includes('appends **every** item'));
  const ref = flat(kit.refactor);
  check(`${kit.name}/refactor: change/idea get keep/drop/spec-it, never built in ledger mode`,
    ref.includes('**keep**') && ref.includes('**drop**') && ref.includes('**spec it**') && ref.includes('never built in ledger mode'));
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
// c. /self-review bookmark script — extracted per kit, run against that kit's
//    own config-dir layout.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- self-review bookmark script --${colors.reset}`);

function bookmarkScript(kit) {
  const content = fs.readFileSync(path.join(ROOT, kit.selfReview), 'utf8');
  const block = extractFence(content, 'mkdir -p');
  check(`${kit.name}/self-review: bookmark fence targets ${kit.dir}`,
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
    check(`${kit.name}/self-review: bookmark script extracted`, false, e.message);
    continue;
  }
  for (const shell of SHELLS) {
    // c1. no config dir -> creates dir + file with exactly one self-review-sha line.
    {
      const cwd = tmpDir('skill-shell-bm-fresh-');
      const sha1 = 'a'.repeat(40);
      runBookmark(shell, script, cwd, sha1);
      const recordPath = path.join(cwd, kit.dir, 'remember', 'last-review.md');
      const exists = fs.existsSync(recordPath);
      check(`[${shell.name}] ${kit.name}: fresh run creates ${kit.dir}/remember/last-review.md`, exists);
      if (exists) {
        const body = fs.readFileSync(recordPath, 'utf8');
        const dsLines = body.split('\n').filter(l => l.startsWith('self-review-sha:'));
        check(`[${shell.name}] ${kit.name}: fresh run — exactly one self-review-sha line`, dsLines.length === 1, body);
        check(`[${shell.name}] ${kit.name}: fresh run — holds the sha`, dsLines[0] === `self-review-sha: ${sha1}`, dsLines[0]);
      }
    }

    // c2. existing multi-line record (2-item blockers list + a ledger line) ->
    //     every other line byte-identical; run twice with different shas ->
    //     exactly one self-review-sha line holding the SECOND sha.
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
      const dsLines = bodyLines.filter(l => l.startsWith('self-review-sha:'));
      const otherLines = bodyLines.filter(l => !l.startsWith('self-review-sha:'));

      check(`[${shell.name}] ${kit.name}: existing record — run twice, exactly one self-review-sha line`,
        dsLines.length === 1, `lines: ${JSON.stringify(dsLines)}`);
      check(`[${shell.name}] ${kit.name}: existing record — holds the SECOND sha`,
        dsLines[0] === `self-review-sha: ${sha2}`, dsLines[0]);
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
      const glued = /ledger: noneself-review-sha:/.test(body);
      check(`[${shell.name}] ${kit.name}: no-trailing-newline record — bookmark NOT glued onto the previous line`,
        !glued, JSON.stringify(body));
      const dsLines = body.split('\n').filter(l => l.startsWith('self-review-sha:'));
      check(`[${shell.name}] ${kit.name}: no-trailing-newline record — bookmark still lands as its own line`,
        dsLines.length === 1 && dsLines[0] === `self-review-sha: ${sha1}`, JSON.stringify(body));
    }
  }
}

// ---------------------------------------------------------------------------
// c4. old `debrief-sha:` bookmark is honoured once, then rewritten under the
//     new name. Commands run AS PRINTED in each kit's self-review markdown.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- self-review old-bookmark fallback --${colors.reset}`);

for (const kit of KITS) {
  let script, readCmd;
  try {
    const content = fs.readFileSync(path.join(ROOT, kit.selfReview), 'utf8');
    script = extractFence(content, 'mkdir -p').join('\n');
    readCmd = extractFence(content, "grep '^self-review-sha:'").join('\n');
  } catch (e) {
    check(`${kit.name}/self-review: old-bookmark commands extracted`, false, e.message);
    continue;
  }
  const oldSha = 'e'.repeat(40), newSha = 'f'.repeat(40);
  const setup = (prefix, body) => {
    const cwd = tmpDir(prefix);
    const d = path.join(cwd, kit.dir, 'remember');
    fs.mkdirSync(d, { recursive: true });
    const rec = path.join(d, 'last-review.md');
    fs.writeFileSync(rec, body);
    return { cwd, rec };
  };
  // the read command prints the bookmark line; the sha is what follows "<name>-sha: "
  const readSha = (shell, cwd) => sh(shell.bin, readCmd, { cwd }).stdout.trim().replace(/^[a-z-]+-sha: /, '');

  for (const shell of SHELLS) {
    const t = `[${shell.name}] ${kit.name}`;
    // (1) only the old line -> its sha is read.
    const only = setup('skill-shell-bm-old-', `sha: ${'1'.repeat(40)}\ndebrief-sha: ${oldSha}\n`);
    check(`${t}: old debrief-sha only — read command yields the old sha`,
      readSha(shell, only.cwd) === oldSha, readSha(shell, only.cwd));
    // (2) both lines -> the new name wins.
    const both = setup('skill-shell-bm-both-', `debrief-sha: ${oldSha}\nself-review-sha: ${newSha}\n`);
    check(`${t}: both lines — read command yields the self-review-sha one`,
      readSha(shell, both.cwd) === newSha, readSha(shell, both.cwd));
    // (3) rewrite drops debrief-sha, leaves one self-review-sha, other lines byte-unchanged.
    const others = ['sha: ' + '1'.repeat(40), 'verdict: ready', 'ledger: none'];
    const rw = setup('skill-shell-bm-rw-', others.slice(0, 2).join('\n') + `\ndebrief-sha: ${oldSha}\n` + others[2]);
    runBookmark(shell, script, rw.cwd, newSha);
    const lines = fs.readFileSync(rw.rec, 'utf8').split('\n').filter(l => l.length > 0);
    check(`${t}: rewrite drops debrief-sha, keeps exactly one self-review-sha`,
      lines.filter(l => l.startsWith('debrief-sha:')).length === 0 &&
      lines.filter(l => l === `self-review-sha: ${newSha}`).length === 1, JSON.stringify(lines));
    check(`${t}: rewrite leaves every other line byte-unchanged`,
      JSON.stringify(lines.filter(l => !l.endsWith(`-sha: ${newSha}`))) === JSON.stringify(others), JSON.stringify(lines));
  }
}

// ---------------------------------------------------------------------------
// c5. /branch-review's "hash the record dir" command: must exit 0 and hash
//     only the regular files even when the dir holds a subdirectory (the old
//     `md5sum .claude/remember/*` exited non-zero on `friction/`).
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- branch-review record-dir hash command --${colors.reset}`);

for (const kit of KITS) {
  for (const [label, file] of [['branch-review', kit.branchReview], ['refactor', kit.refactor]]) {
  let cmd;
  try {
    cmd = extractFence(fs.readFileSync(path.join(ROOT, file), 'utf8'), '-maxdepth 1', true).join('\n');
  } catch (e) {
    check(`${kit.name}/${label}: record-dir hash command extracted`, false, e.message);
    continue;
  }
  for (const shell of SHELLS) {
    const cwd = tmpDir('skill-shell-md5-');
    const d = path.join(cwd, kit.dir, 'remember');
    fs.mkdirSync(path.join(d, 'friction'), { recursive: true });
    fs.writeFileSync(path.join(d, 'fix-ledger.md'), 'a\n');
    fs.writeFileSync(path.join(d, 'last-review.md'), 'b\n');
    const r = sh(shell.bin, cmd, { cwd });
    const hashLines = r.stdout.split('\n').filter(l => /^[0-9a-f]{32}\s/.test(l));
    check(`[${shell.name}] ${kit.name}/${label}: record-dir hash — exit 0, exactly two hash lines despite a subdirectory`,
      r.status === 0 && hashLines.length === 2, `status ${r.status}, lines ${JSON.stringify(hashLines)}, stderr ${r.stderr}`);
  }
  }
}

// ---------------------------------------------------------------------------
// d. /stash total + processed counts — extracted per kit from stash markdown.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- stash total/processed counts --${colors.reset}`);

// Extraction is marker-based (trailing "# total" / "# processed" comments),
// not a single-line regex: the OLD processed command (pre-958f71e) was a
// backslash-continued two-PHYSICAL-line statement ("test -f ... \" then
// "&& grep -c ... || echo 0"), and the proof step below temporarily swaps
// that old form back into the shipped file. A line-anchored regex would
// just fail to find it; this extracts by comment marker so both the old and
// new shapes come back as one runnable command string, and a regression
// shows up as a BEHAVIORAL failure instead of a silent extraction skip.
function extractStashCommands(content, label) {
  const block = extractFence(content, '# total', true);
  const totalIdx = block.findIndex(l => l.includes('# total'));
  const procIdx = block.findIndex(l => l.includes('# processed'));
  const totalMarkers = block.filter(l => l.includes('# total')).length;
  const procMarkers = block.filter(l => l.includes('# processed')).length;
  if (totalIdx === -1 || procIdx === -1 || procIdx <= totalIdx || totalMarkers !== 1 || procMarkers !== 1) {
    throw new Error(`${label}: expected exactly one "# total" line followed by exactly one "# processed" line, found total=${totalMarkers} processed=${procMarkers}`);
  }
  const totalCmd = block.slice(0, totalIdx + 1).join('\n').replace(/#\s*total\s*$/, '').trim();
  const processedCmd = block.slice(totalIdx + 1, procIdx + 1).join('\n').replace(/#\s*processed\s*$/, '').trim();
  return { totalCmd, processedCmd };
}

// Regression proof: extraction must throw (loud failure), not silently pass,
// when neither marker is present.
{
  let threw = false;
  try { extractStashCommands('```bash\necho nothing here\n```\n', 'missing-case'); }
  catch (e) { threw = true; }
  check('extractStashCommands throws when the commands are absent (loud failure, not silent pass)', threw);
}

const extractedStashCmds = [];
for (const kit of KITS) {
  const content = fs.readFileSync(path.join(ROOT, kit.stash), 'utf8');
  let cmds;
  try {
    cmds = extractStashCommands(content, `${kit.name}/stash`);
  } catch (e) {
    check(`${kit.name}/stash: total + processed commands present, unwrapped`, false, e.message);
    continue;
  }
  check(`${kit.name}/stash: total + processed commands present, unwrapped`, true);
  check(`${kit.name}/stash: total command targets ${kit.dir}`, cmds.totalCmd.includes(`${kit.dir}/stash`), cmds.totalCmd);
  check(`${kit.name}/stash: processed command targets ${kit.dir}`, cmds.processedCmd.includes(`${kit.dir}/remember/.processed`), cmds.processedCmd);
  extractedStashCmds.push({ name: kit.name, dir: kit.dir, totalCmd: cmds.totalCmd, processedCmd: cmds.processedCmd });
}

// Run `cmd` with $ROOT bound to `rootDir`, returning trimmed stdout/stderr.
function runStash(shell, cmd, rootDir) {
  return sh(shell.bin, cmd, { env: Object.assign({}, process.env, { ROOT: rootDir }) });
}

const TOTAL_CASES = [
  {
    name: '2 visible .md files',
    setup: (stashDir) => {
      fs.mkdirSync(stashDir, { recursive: true });
      fs.writeFileSync(path.join(stashDir, 'a.md'), 'a');
      fs.writeFileSync(path.join(stashDir, 'b.md'), 'b');
    },
    total: 2,
  },
  {
    name: '2 visible .md + 1 hidden .md',
    setup: (stashDir) => {
      fs.mkdirSync(stashDir, { recursive: true });
      fs.writeFileSync(path.join(stashDir, 'a.md'), 'a');
      fs.writeFileSync(path.join(stashDir, 'b.md'), 'b');
      fs.writeFileSync(path.join(stashDir, '.hidden.md'), 'h');
    },
    total: 2,
  },
  {
    name: '2 visible .md + 1 non-.md file ignored',
    setup: (stashDir) => {
      fs.mkdirSync(stashDir, { recursive: true });
      fs.writeFileSync(path.join(stashDir, 'a.md'), 'a');
      fs.writeFileSync(path.join(stashDir, 'b.md'), 'b');
      fs.writeFileSync(path.join(stashDir, 'notes.txt'), 'n');
    },
    total: 2,
  },
  {
    name: 'empty stash dir',
    setup: (stashDir) => { fs.mkdirSync(stashDir, { recursive: true }); },
    total: 0,
    stderrEmpty: true,
  },
  {
    name: 'missing stash dir',
    setup: () => {},
    total: 0,
    stderrEmpty: true,
  },
  {
    name: 'stash dir is a symlink to a dir with 2 .md files',
    setup: (stashDir) => {
      const real = stashDir + '-real';
      fs.mkdirSync(real, { recursive: true });
      fs.writeFileSync(path.join(real, 'a.md'), 'a');
      fs.writeFileSync(path.join(real, 'b.md'), 'b');
      fs.symlinkSync(real, stashDir);
    },
    total: 2,
  },
];

const PROCESSED_CASES = [
  {
    name: 'missing .processed',
    setup: () => {},
    processed: 0,
  },
  {
    name: 'empty .processed',
    setup: (f) => { fs.writeFileSync(f, ''); },
    processed: 0,
  },
  {
    name: '3 lines, no trailing newline',
    setup: (f) => { fs.writeFileSync(f, 'a\nb\nc'); },
    processed: 3,
  },
  {
    name: '3 lines, trailing newline',
    setup: (f) => { fs.writeFileSync(f, 'a\nb\nc\n'); },
    processed: 3,
  },
];

if (extractedStashCmds.length === 0) {
  check('stash fixture matrix: skipped — could not extract any commands', false,
    'see the extraction FAIL above for the reason');
} else {
  for (const shell of SHELLS) {
    for (const entry of extractedStashCmds) {
      for (const c of TOTAL_CASES) {
        const rootDir = tmpDir('skill-shell-stash-total-');
        const stashDir = path.join(rootDir, entry.dir, 'stash');
        c.setup(stashDir);
        const r = runStash(shell, entry.totalCmd, rootDir);
        const out = r.stdout.trim();
        check(`[${shell.name}] ${entry.name}/stash total: ${c.name}`, out === String(c.total), `got ${JSON.stringify(out)}`);
        if (c.stderrEmpty) {
          check(`[${shell.name}] ${entry.name}/stash total: ${c.name} — empty stderr`, r.stderr === '', JSON.stringify(r.stderr));
        }
      }
      for (const c of PROCESSED_CASES) {
        const rootDir = tmpDir('skill-shell-stash-processed-');
        const remDir = path.join(rootDir, entry.dir, 'remember');
        fs.mkdirSync(remDir, { recursive: true });
        const f = path.join(remDir, '.processed');
        c.setup(f);
        const r = runStash(shell, entry.processedCmd, rootDir);
        const lines = r.stdout.split('\n').filter(l => l.length > 0);
        check(`[${shell.name}] ${entry.name}/stash processed: ${c.name} — exactly one line`, lines.length === 1, JSON.stringify(r.stdout));
        check(`[${shell.name}] ${entry.name}/stash processed: ${c.name} — value ${c.processed}`, lines[0] === String(c.processed), JSON.stringify(r.stdout));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// e. Spec rules pinned by phrase — the `tests:` record line (writer vs
//    reader) and the /branch-review + /self-review rules shipped in v4.0.0.
//    These pin that the rule text is still in the shipped spec, scoped to the
//    section it belongs to (whitespace-collapsed, so a re-wrap cannot break
//    them); they do not prove a worker obeys it.
// ---------------------------------------------------------------------------
console.log(`\n${colors.bright}-- spec rules pinned by phrase --${colors.reset}`);

const flat = s => s.replace(/\s+/g, ' ');
// The text between two markers, whitespace-collapsed; throws if either is missing.
function section(content, from, to) {
  const text = flat(content);
  const a = text.indexOf(from), b = text.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error(`section "${from}" .. "${to}" not found`);
  return text.slice(a, b);
}
// check() whose failure to even read the spec is a FAIL, not a crash.
function specCheck(name, fn) {
  try { const r = fn(); check(name, r === true, r === true ? undefined : String(r)); }
  catch (e) { check(name, false, e.message); }
}
const has = (text, phrase) => text.includes(phrase) || `missing: ${phrase}`;
const allOf = (...rs) => rs.find(r => r !== true) || true;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

for (const kit of KITS) {
  const br = read(kit.branchReview);

  // `tests:` line: /branch-review writes it, /release reads it.
  specCheck(`${kit.name}: tests: record line — writer template and /release reader agree`, () => {
    const writer = br.split('\n').filter(l => l.startsWith('tests: '));
    if (writer.length !== 1) return `expected exactly 1 "tests: " template line in branch-review, found ${writer.length}`;
    const alts = writer[0].match(/build N\/A: <reason>|NOT RUN: <reason>/g) || [];
    if (alts.length !== 2) return `writer line lost its N/A / NOT RUN alternatives: ${writer[0]}`;
    if (!/^tests: <command> exit <code>; build <command> exit <code> \|/.test(writer[0])) return `writer line shape changed: ${writer[0]}`;
    const rel = flat(read(kit.release));
    return allOf(
      has(rel, '`tests:` line'),
      has(rel, 'tests exit 0 **and** build exit 0 or `N/A: <reason>`'),
      has(rel, '`NOT RUN`'));
  });

  // (a) Stage 2 holds no second copy of the security checklist.
  specCheck(`${kit.name}: branch-review stage 2 keeps no copy of the security checklist`, () => {
    const stage2 = section(br, '## Stage 2', '## Stage 3');
    const titles = read(kit.security).split('\n')
      .map(l => l.match(/^\d+\. \*\*([^*]+?)\.\*\*/)).filter(Boolean)
      .map(m => m[1].replace(/ \(.*$/, '').toLowerCase());
    if (titles.length !== 6) return `expected 6 numbered items in the ${kit.name} security spec, found ${titles.length}`;
    // the spec-missing fallback may name a few of them; nothing else may
    const rest = stage2.replace(/Fallback, spec missing only:.*?as passed\./, '').toLowerCase();
    const copied = titles.filter(t => rest.includes(t));
    return copied.length === 0 || `stage 2 restates security items: ${copied.join('; ')}`;
  });
  specCheck(`${kit.name}: branch-review stage 2 says the security spec is the only list, one line per item or stage2 NOT RUN`, () => {
    const stage2 = section(br, '## Stage 2', '## Stage 3');
    const cov = section(br, 'Stage 2\'s evidence is', 'Then a `checks:` line');
    return allOf(
      has(stage2, 'that spec is the only list'),
      has(cov, 'one line per item of the security spec'),
      has(cov, '`coverage:` says `stage2 ran` only when every item has its line; otherwise `stage2 NOT RUN`'));
  });

  // (b) N/A must hold for the repo, not the diff.
  specCheck(`${kit.name}: branch-review N/A reason must hold for the repo, not the diff`, () =>
    has(section(br, 'Stage 2\'s evidence is', 'Then a `checks:` line'),
      'N/A must hold for the repo, not the diff: "the diff doesn\'t touch it" is no reason.'));

  // (c) fail-first M counts every changed test file, says assertion vs load failure.
  specCheck(`${kit.name}: branch-review fail-first M counts every test file, assertion vs load failure`, () => {
    const ff = section(br, 'Count them as `fail-first N/M files`', 'Structure (dead code');
    return allOf(
      has(ff, 'M is every test file the diff adds or changes, no exclusions'),
      has(ff, '`12/15`, never `12/12`'),
      has(ff, 'Say whether each red was a failed assertion or the test failing to load'));
  });

  // (d) a `sha:` = HEAD stop writes no record.
  specCheck(`${kit.name}: branch-review sha: = HEAD stop writes no record`, () => {
    const bullet = section(br, '- **`sha:` = HEAD**', '- **No file**');
    const write = flat(br).match(/Write it at the end of every run, unconditionally\*\* \([^)]*\)/);
    return allOf(
      has(bullet, '**Write no record**: the existing one stands.'),
      write ? has(write[0], '`sha:` = HEAD stop, which writes nothing') : 'unconditional-write sentence not found');
  });

  // (e) the orchestrator hands the worker the spec's path.
  for (const [label, file] of [['branch-review', kit.branchReview], ['self-review', kit.selfReview]]) {
    specCheck(`${kit.name}: ${label} orchestrator hands the worker this spec's path`, () =>
      has(section(read(file), '## Guardrails', ' ## '), 'hand it this file\'s path — a worker has no skill text of its own'));
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
