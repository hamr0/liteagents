#!/usr/bin/env node

/**
 * installer/cli.js closing-note behavioural tests
 *
 * Why this file exists: on reinstall the installer moves an existing tool
 * install aside into a timestamped backup, which can silently contain a
 * user-edited AGENT_RULES.md. installer/cli.js prints a closing note after
 * `Done!` pointing at any such backups. The note must stay silent on a fresh
 * install (empty backupLog) and must never hardcode `commands/remember` —
 * opencode installs to the singular `command/`, so a path built that way
 * would be wrong for 3 of the 4 tools.
 *
 * The note is rendered inline in the interactive `install()` TTY flow, so
 * per this repo's own test-shape convention (see
 * tests/version-check/version-check.test.js #12), the rendering was pulled
 * out into a pure, exported function (`formatBackupClosingNote`) and tested
 * directly rather than driving the interactive CLI.
 *
 * Conventions follow tests/version-check/version-check.test.js and
 * tests/sync-rules/sync-rules.test.js: self-contained, no network/TTY,
 * negative controls so the suite can prove it can FAIL.
 */

const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'installer', 'cli.js');

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

let formatBackupClosingNote = null;
try {
  ({ formatBackupClosingNote } = require(CLI));
} catch (e) {
  // handled below by the "is exported" check
}

if (typeof formatBackupClosingNote !== 'function') {
  check('formatBackupClosingNote is exported from installer/cli.js', false,
    'require(installer/cli.js).formatBackupClosingNote is not a function');
} else {
  const os = require('os');
  const home = os.homedir();

  // 1. Empty backupLog (fresh install) renders nothing.
  {
    const note = formatBackupClosingNote([]);
    check('empty backupLog renders nothing', note === '',
      `expected '' got ${JSON.stringify(note)}`);
  }

  // 1b. Same for the no-arg / null case, since a fresh install's backupLog
  // could plausibly be undefined depending on call site.
  {
    const note = formatBackupClosingNote(null);
    check('null backupLog renders nothing', note === '',
      `expected '' got ${JSON.stringify(note)}`);
  }

  // 2. One backup renders the path with ~ substitution.
  {
    const backupPath = path.join(home, '.claude.backup.2026-09-04T00-00-00-000Z');
    const note = formatBackupClosingNote([{ original: path.join(home, '.claude'), backup: backupPath }]);
    const shortPath = backupPath.replace(home, '~');
    check('one backup: note is non-empty', note !== '', `got ${JSON.stringify(note)}`);
    check('one backup: contains ~ substituted path', note.includes(shortPath),
      `expected note to include ${shortPath}, got ${JSON.stringify(note)}`);
    check('one backup: does not leak the real homedir', !note.includes(home),
      `note still contains raw homedir ${home}: ${JSON.stringify(note)}`);
  }

  // 3. Two backups render both.
  {
    const backupA = path.join(home, '.claude.backup.A');
    const backupB = path.join(home, '.opencode.backup.B');
    const note = formatBackupClosingNote([
      { original: path.join(home, '.claude'), backup: backupA },
      { original: path.join(home, '.opencode'), backup: backupB }
    ]);
    const shortA = backupA.replace(home, '~');
    const shortB = backupB.replace(home, '~');
    check('two backups: both paths present', note.includes(shortA) && note.includes(shortB),
      `expected both ${shortA} and ${shortB} in ${JSON.stringify(note)}`);
  }

  // 4. Never hardcodes commands/remember (the claude-specific parent dir) —
  // opencode's backups hold command/remember (singular), not commands/.
  {
    const note = formatBackupClosingNote([
      { original: path.join(home, '.claude'), backup: path.join(home, '.claude.backup.X') }
    ]);
    check('note never hardcodes commands/remember', !note.includes('commands/remember'),
      `note contains the hardcoded claude-only path: ${JSON.stringify(note)}`);
  }
}

// --- summary -------------------------------------------------------------

// Summary format is a contract with tests/run-all-tests.js, which parses
// /Total tests:\s+(\d+)/, /Passed:\s+(\d+)/ and /Failed:\s+(\d+)/. Emit
// anything else and the runner reads 0 tests and fails the count floor.
console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
console.log(`Total tests: ${passed + failed}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
if (failed) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
process.exit(failed ? 1 : 0);
