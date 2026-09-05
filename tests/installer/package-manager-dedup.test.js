#!/usr/bin/env node

/**
 * installer/package-manager.js getAvailableContent dedup tests
 *
 * Why this file exists: a capability may ship both `<name>.md` and a
 * same-named `<name>/` directory of bundled assets — `remember.md` plus
 * `remember/friction.cjs` is the live case. getItemsInDir walks a directory
 * and pushes the file (minus `.md`) and the directory under the same name,
 * so without a dedup the capability is listed twice, the installer copies it
 * twice and the progress count is inflated. `[...new Set(result)]` closes it.
 *
 * Why not tests/installer/package-manager.test.js: that file is deliberately
 * not wired into tests/run-all-tests.js (see the comment above `testSuites`)
 * and currently fails 22 of its own tests against a removed 3-variant
 * installer. A regression test parked there would never run, which is worse
 * than none — it reads as protection while guarding nothing.
 *
 * Conventions follow tests/installer/closing-note.test.js: self-contained,
 * no network/TTY, isolated tmpdirs, and a negative control so the suite can
 * prove it is able to FAIL rather than passing vacuously.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PackageManager = require(path.join(__dirname, '..', '..', 'installer', 'package-manager.js'));

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

// KEEP_TMP=1 leaves the fixture behind for debugging; otherwise every run
// cleans up, since leftover mkdtemp dirs exhaust inodes rather than bytes.
async function withFixture(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pm-dedup-'));
  try {
    return await fn(dir);
  } finally {
    if (!process.env.KEEP_TMP) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * A capability that ships both forms: `<name>.md` beside `<name>/`.
 */
async function writePairedCapability(parent, name) {
  await fs.promises.mkdir(path.join(parent, name), { recursive: true });
  await fs.promises.writeFile(path.join(parent, `${name}.md`), `# ${name}\n`);
  await fs.promises.writeFile(path.join(parent, name, 'asset.cjs'), '// bundled asset\n');
}

async function main() {
  const pm = new PackageManager();

  console.log(`${colors.bright}${colors.cyan}getAvailableContent dedup${colors.reset}\n`);

  // 1. The live shape: commands/remember.md beside commands/remember/.
  await withFixture(async (dir) => {
    const commands = path.join(dir, 'commands');
    await writePairedCapability(commands, 'remember');
    const content = await pm.getAvailableContent(dir);
    check('paired command is listed once, not twice',
      content.commands.length === 1 && content.commands[0] === 'remember',
      `expected ['remember'], got ${JSON.stringify(content.commands)}`);
  });

  // 2. Negative control. This is the pre-fix mapping, applied by hand to the
  // same fixture: readdir yields both entries and both collapse to the same
  // name once `.md` is stripped. If this stops holding, the fixture no longer
  // reproduces the bug and check 1 above would pass vacuously.
  await withFixture(async (dir) => {
    const commands = path.join(dir, 'commands');
    await writePairedCapability(commands, 'remember');
    const raw = await fs.promises.readdir(commands);
    const preFix = raw.map((e) => e.replace('.md', ''));
    check('negative control: fixture really does yield a duplicate pre-dedup',
      preFix.length === 2 && preFix[0] === 'remember' && preFix[1] === 'remember',
      `pre-fix mapping produced ${JSON.stringify(preFix)}; the fixture no longer reproduces the bug`);
  });

  // 3. opencode installs to the singular `command/`, which getAvailableContent
  // resolves separately — the dedup has to hold on that path too.
  await withFixture(async (dir) => {
    const command = path.join(dir, 'command');
    await writePairedCapability(command, 'docs-builder');
    const content = await pm.getAvailableContent(dir);
    check('dedup holds for the singular command/ directory',
      content.commandsDir === 'command' && content.commands.length === 1,
      `commandsDir=${content.commandsDir}, commands=${JSON.stringify(content.commands)}`);
  });

  // 4. Agents are read with the same helper and the same `.md` stripping.
  await withFixture(async (dir) => {
    const agents = path.join(dir, 'agents');
    await writePairedCapability(agents, 'orchestrator');
    const content = await pm.getAvailableContent(dir);
    check('paired agent is listed once, not twice',
      content.agents.length === 1 && content.agents[0] === 'orchestrator',
      `expected ['orchestrator'], got ${JSON.stringify(content.agents)}`);
  });

  // 5. The dedup must not collapse genuinely distinct capabilities.
  await withFixture(async (dir) => {
    const commands = path.join(dir, 'commands');
    await writePairedCapability(commands, 'remember');
    await fs.promises.writeFile(path.join(commands, 'ship.md'), '# ship\n');
    const content = await pm.getAvailableContent(dir);
    const sorted = [...content.commands].sort();
    check('distinct capabilities are both kept',
      sorted.length === 2 && sorted[0] === 'remember' && sorted[1] === 'ship',
      `expected ['remember','ship'], got ${JSON.stringify(sorted)}`);
  });

  // 6. Skills are directories only; a stray .md beside them is ignored, so a
  // paired name there must still resolve to one entry.
  await withFixture(async (dir) => {
    const skills = path.join(dir, 'skills');
    await writePairedCapability(skills, 'security');
    const content = await pm.getAvailableContent(dir);
    check('paired skill is listed once (files ignored in skills/)',
      content.skills.length === 1 && content.skills[0] === 'security',
      `expected ['security'], got ${JSON.stringify(content.skills)}`);
  });

  // 7. The tmpdir is cleaned up unless KEEP_TMP is set.
  {
    let leaked = null;
    await withFixture(async (dir) => { leaked = dir; });
    check('fixture tmpdir is removed on exit',
      process.env.KEEP_TMP ? fs.existsSync(leaked) : !fs.existsSync(leaked),
      `${leaked} still exists after the fixture closed`);
  }
}

main().then(() => {
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
}).catch((err) => {
  console.error(`${colors.red}Suite crashed:${colors.reset} ${err && err.stack || err}`);
  console.log(`\nTotal tests: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed + 1}`);
  process.exit(1);
});
