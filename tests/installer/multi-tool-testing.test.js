#!/usr/bin/env node

/**
 * Multi-Tool Installation Testing Suite
 * Tests simultaneous installation of multiple tools with isolation verification
 * and a content-integrity check: each tool must deliver exactly the expected
 * number of agents, commands, skills, and plugins — no more, no less.
 *
 * The installer ships a single package per tool (variants.json holds one
 * 'pro' variant: all agents, skills, and commands). Each tool has its own
 * layout, captured in LAYOUT below.
 *
 * ── Updating counts ──────────────────────────────────────────────────────
 * If you add or remove a command/skill/agent/plugin, the matching assertion
 * fails (e.g. "commands: expected 8, got 7"). Bump the number in EXPECTED
 * to lock in the new, intended contents. Claude has native skills (own dir),
 * so it ships 10 commands + 8 skills; opencode/ampcode/droid fold those 8 skills
 * into commands as .md files, hence 18 (10 + 8).
 *
 * Tests:
 * - Claude + Opencode simultaneous installation
 * - All 4 tools simultaneous installation
 * - Delivered content counts match EXPECTED (catches accidental add/removal)
 * - Tool isolation (no file conflicts)
 * - Correct paths for each tool
 */

const fs = require('fs');
const path = require('path');
const { createTempDir, removeDirRecursive } = require('../fixtures/helpers/test-helpers');

const VARIANT = 'pro';

// Per-tool directory names for each content category (tools differ in layout).
const LAYOUT = {
  claude:   { agents: 'agents', commands: 'commands', skills: 'skills', plugins: 'plugins' },
  opencode: { agents: 'agent',  commands: 'command' },
  ampcode:  { agents: 'agents', commands: 'commands' },
  droid:    { agents: 'droids', commands: 'commands' }
};

// How each category is counted: 'md' = top-level *.md files (one per
// command/agent), 'dir' = subdirectories (one per skill/plugin bundle).
const COUNT_BY = { agents: 'md', commands: 'md', skills: 'dir', plugins: 'dir' };

// Expected delivered counts per tool. Update deliberately when content changes.
const EXPECTED = {
  claude:   { agents: 11, commands: 10, skills: 8, plugins: 1 },
  opencode: { agents: 11, commands: 18 },
  ampcode:  { agents: 11, commands: 18 },
  droid:    { agents: 11, commands: 18 }
};

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Log test result
 */
function logTest(testName, passed, message = '') {
  const status = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${status}\x1b[0m ${testName}${message ? ': ' + message : ''}`);

  results.tests.push({ name: testName, passed, message });
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
  }
}

/**
 * Install a tool's package into the test directory.
 * Copies the tool's real package tree (minus the installer's own variants.json).
 */
function installToolPackage(tool, baseDir) {
  const packageDir = path.join(__dirname, '../../packages', tool);
  const variantsFile = path.join(packageDir, 'variants.json');

  if (!fs.existsSync(variantsFile)) {
    throw new Error(`variants.json not found for tool: ${tool}`);
  }

  const variants = JSON.parse(fs.readFileSync(variantsFile, 'utf8'));
  if (!variants[VARIANT]) {
    throw new Error(`Variant '${VARIANT}' not found for tool ${tool}`);
  }

  // Copy the whole package tree into a tool-specific directory, skipping the
  // installer's variants.json (config, not installed content).
  const toolDir = path.join(baseDir, tool);
  fs.mkdirSync(toolDir, { recursive: true });
  for (const entry of fs.readdirSync(packageDir)) {
    if (entry === 'variants.json') continue;
    const src = path.join(packageDir, entry);
    const dest = path.join(toolDir, entry);
    if (fs.statSync(src).isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  return toolDir;
}

/**
 * Count delivered units per category for an installed tool directory.
 */
function countDelivered(toolDir, tool) {
  const counts = {};
  for (const [category, dirName] of Object.entries(LAYOUT[tool])) {
    const dir = path.join(toolDir, dirName);
    if (!fs.existsSync(dir)) {
      counts[category] = 0;
      continue;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    counts[category] = COUNT_BY[category] === 'dir'
      ? entries.filter(e => e.isDirectory()).length
      : entries.filter(e => e.isFile() && e.name.endsWith('.md')).length;
  }
  return counts;
}

/**
 * Helper function to copy directory recursively
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Verify tool isolation - ensure no overlapping files
 */
function verifyToolIsolation(baseDir, tools) {
  const allPaths = new Set();
  let hasConflicts = false;
  const conflicts = [];

  for (const tool of tools) {
    const toolDir = path.join(baseDir, tool);
    if (!fs.existsSync(toolDir)) continue;

    // Recursively get all file paths
    const getFilePaths = (dir, relativeTo) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let paths = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(relativeTo, fullPath);

        if (entry.isDirectory()) {
          paths = paths.concat(getFilePaths(fullPath, relativeTo));
        } else {
          paths.push(relativePath);
        }
      }

      return paths;
    };

    const toolPaths = getFilePaths(toolDir, baseDir);

    for (const p of toolPaths) {
      if (allPaths.has(p)) {
        hasConflicts = true;
        conflicts.push(p);
      }
      allPaths.add(p);
    }
  }

  return { isolated: !hasConflicts, conflicts };
}

/**
 * Test multi-tool installation
 */
function testMultiToolInstallation(testConfig) {
  const { name, tools } = testConfig;
  console.log(`\nTesting: ${name}`);
  console.log('─'.repeat(60));

  let testDir;
  try {
    // Create temporary test directory
    testDir = createTempDir(`multi-tool-test-`);
    logTest(`${name}: Create temp directory`, true, testDir);

    // Install each tool, then verify it delivered exactly the expected content
    for (const tool of tools) {
      const toolDir = installToolPackage(tool, testDir);
      const counts = countDelivered(toolDir, tool);

      for (const [category, expected] of Object.entries(EXPECTED[tool])) {
        const actual = counts[category];
        logTest(`${name}: ${tool} ${category} count`, actual === expected,
          actual === expected ? `${actual}` : `expected ${expected}, got ${actual}`);
      }
    }

    // Verify tool isolation
    const isolation = verifyToolIsolation(testDir, tools);
    if (!isolation.isolated) {
      logTest(`${name}: Verify tool isolation`, false,
        `File conflicts detected: ${isolation.conflicts.join(', ')}`);
    } else {
      logTest(`${name}: Verify tool isolation`, true);
    }

    // Verify each tool has correct path
    for (const tool of tools) {
      const toolPath = path.join(testDir, tool);
      const pathExists = fs.existsSync(toolPath);
      logTest(`${name}: Verify ${tool} path`, pathExists, toolPath);
    }

    // Cleanup
    removeDirRecursive(testDir);
    logTest(`${name}: Cleanup`, true);

  } catch (error) {
    logTest(`${name}: Error`, false, error.message);
    console.error(error);

    // Cleanup on error
    if (testDir && fs.existsSync(testDir)) {
      removeDirRecursive(testDir);
    }
  }
}

/**
 * Run all multi-tool tests
 */
function runAllTests() {
  console.log('\x1b[1m\x1b[36m');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Multi-Tool Installation Testing Suite               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const testConfigs = [
    { name: 'Claude only', tools: ['claude'] },
    { name: 'Claude + Opencode', tools: ['claude', 'opencode'] },
    { name: 'All 4 tools', tools: ['claude', 'opencode', 'ampcode', 'droid'] }
  ];

  console.log(`Running ${testConfigs.length} multi-tool test scenarios\n`);

  for (const config of testConfigs) {
    testMultiToolInstallation(config);
  }

  // Print summary
  console.log('\n\x1b[1m\x1b[36m');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      Test Summary                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const total = results.passed + results.failed;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : '0.0';

  console.log(`Total tests:  ${total}`);
  console.log(`\x1b[32mPassed:       ${results.passed}\x1b[0m`);
  console.log(`\x1b[31mFailed:       ${results.failed}\x1b[0m`);
  console.log(`Pass rate:    ${passRate}%\n`);

  if (results.failed > 0) {
    console.log('\x1b[31mFailed tests:\x1b[0m');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`  ✗ ${t.name}: ${t.message}`);
    });
    console.log('');
  }

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testMultiToolInstallation,
  runAllTests,
  EXPECTED
};
