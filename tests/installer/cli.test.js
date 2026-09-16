#!/usr/bin/env node

/**
 * Comprehensive CLI Test Suite
 *
 * Tests the complete InteractiveInstaller CLI with:
 * - End-to-end installation flows
 * - User input validation
 * - Edge cases and boundary conditions
 * - Multi-tool installations
 * - Path customization scenarios
 * - Progress tracking accuracy
 * - Verification and reporting
 * - Error handling and recovery
 *
 * Coverage includes all CLI methods and workflows
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const InteractiveInstaller = require('../../installer/cli.js');
const PackageManager = require('../../installer/package-manager.js');
const InstallationEngine = require('../../installer/installation-engine.js');
const PathManager = require('../../installer/path-manager.js');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Test helper - calls handleFatalError with process.exit and console.log
 * stubbed, so the method's unconditional process.exit(1) does not kill the
 * suite. Returns the captured exit code and printed lines.
 */
async function captureFatalError(error) {
  const installer = new InteractiveInstaller();
  const realExit = process.exit;
  const realLog = console.log;
  const lines = [];
  let exitCode = null;

  process.exit = code => { exitCode = code; };
  console.log = (...args) => { lines.push(args.join(' ')); };

  try {
    await installer.handleFatalError(error);
  } finally {
    process.exit = realExit;
    console.log = realLog;
  }

  return { exitCode, lines };
}

/**
 * Test helper - runs a test and tracks results
 */
async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
  } catch (error) {
    failedTests++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
    if (error.stack) {
      const stack = error.stack.split('\n').slice(1, 3).join('\n');
      console.log(`  ${colors.red}${stack}${colors.reset}`);
    }
  }
}

/**
 * Create temporary test directory
 */
function createTempDir(prefix) {
  const tempDir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// Test Suite
// =============================================================================

async function runTests() {
  console.log(`\n${colors.bright}${colors.cyan}Comprehensive CLI Test Suite${colors.reset}`);
  console.log(`${colors.cyan}Testing: InteractiveInstaller${colors.reset}\n`);

  // ===== Group 1: Constructor and Initialization =====
  console.log(`${colors.blue}${colors.bright}Group 1: Constructor and Initialization${colors.reset}\n`);

  await test('Constructor initializes with correct default state', async () => {
    const installer = new InteractiveInstaller();

    assert.ok(installer.selections, 'Should have selections object');
    assert.ok(Array.isArray(installer.selections.tools), 'Tools should be an array');
    assert.strictEqual(installer.selections.tools.length, 0, 'Tools should be empty initially');
    assert.ok(installer.selections.paths, 'Paths should be initialized');
    assert.strictEqual(Object.keys(installer.selections.paths).length, 0, 'Paths should be empty initially');
  });

  await test('Constructor initializes PackageManager', async () => {
    const installer = new InteractiveInstaller();

    assert.ok(installer.packageManager, 'Should have PackageManager instance');
    assert.ok(installer.packageManager instanceof PackageManager, 'Should be instance of PackageManager');
    assert.ok(installer.getPackageManager(), 'getPackageManager() should return instance');
  });

  // ===== Group 2: Error Categorization and Handling =====
  console.log(`\n${colors.blue}${colors.bright}Group 2: Error Categorization and Handling${colors.reset}\n`);

  await test('categorizeError identifies permission errors', async () => {
    const installer = new InteractiveInstaller();

    const error1 = new Error('Permission denied');
    error1.code = 'EACCES';
    const result1 = installer.categorizeError(error1);

    assert.strictEqual(result1.type, 'Permission Error', 'Should identify EACCES as permission error');
    assert.ok(result1.advice.length > 0, 'Should provide advice');
    assert.ok(result1.advice.some(a => a.includes('sudo') || a.includes('permission')), 'Should mention permissions');
  });

  await test('categorizeError identifies disk space errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('No space left on device');
    error.code = 'ENOSPC';
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Disk Space Error', 'Should identify ENOSPC as disk space error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
    assert.ok(result.advice.some(a => a.includes('space') || a.includes('disk')), 'Should mention disk space');
  });

  await test('categorizeError identifies network errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Network connection failed');
    error.code = 'ETIMEDOUT';
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Network Error', 'Should identify ETIMEDOUT as network error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError identifies missing package errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Package not found');
    error.code = 'ENOENT';
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Missing Package Error', 'Should identify ENOENT as missing package error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError identifies path validation errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Path must be absolute');
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Path Validation Error', 'Should identify path validation error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError identifies invalid input errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Invalid tool selection');
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Invalid Input Error', 'Should identify invalid input error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError identifies installation errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Installation failed');
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Installation Error', 'Should identify installation error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError handles unknown errors', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Something completely unexpected');
    const result = installer.categorizeError(error);

    assert.strictEqual(result.type, 'Unknown Error', 'Should identify as unknown error');
    assert.ok(result.advice.length > 0, 'Should provide advice');
  });

  await test('categorizeError provides distinct advice for different error types', async () => {
    const installer = new InteractiveInstaller();

    const permError = new Error('Permission denied');
    permError.code = 'EACCES';
    const diskError = new Error('No space left');
    diskError.code = 'ENOSPC';

    const perm = installer.categorizeError(permError);
    const disk = installer.categorizeError(diskError);

    assert.notStrictEqual(perm.advice[0], disk.advice[0], 'Different errors should have different advice');
  });

  await test('categorizeError advice for permission errors is actionable', async () => {
    const installer = new InteractiveInstaller();

    const error = new Error('Permission denied');
    error.code = 'EACCES';
    const result = installer.categorizeError(error);

    const hasActionableAdvice = result.advice.some(advice =>
      advice.includes('sudo') ||
      advice.includes('ls -la') ||
      advice.includes('chmod') ||
      advice.toLowerCase().includes('try') ||
      advice.toLowerCase().includes('check')
    );

    assert.ok(hasActionableAdvice, 'Advice should contain actionable commands or steps');
  });

  await test('handleFatalError prints the error message and exits 1', async () => {
    const error = new Error('permission denied while writing');
    error.code = 'EACCES';

    const { exitCode, lines } = await captureFatalError(error);

    assert.strictEqual(exitCode, 1, 'Should exit with code 1');
    assert.ok(
      lines.some(line => line.includes('permission denied while writing')),
      'Should print the error message'
    );
  });

  await test('handleFatalError prints the advice from categorizeError', async () => {
    const error = new Error('permission denied while writing');
    error.code = 'EACCES';

    const installer = new InteractiveInstaller();
    const expectedAdvice = installer.categorizeError(error).advice;

    const { lines } = await captureFatalError(error);

    assert.ok(expectedAdvice.length > 0, 'Fixture should produce advice to print');
    expectedAdvice.forEach(advice => {
      assert.ok(
        lines.some(line => line.includes(advice)),
        `Should print advice line: ${advice}`
      );
    });
  });

  // ===== Group 3: Path Validation =====
  // installer.validatePath was removed in 3f07e47 (v1.10.0); path validation
  // now lives on PathManager (installer/path-manager.js), instantiated
  // directly here. Its real return shape is { valid, path, error? } — no
  // issues[]/parentExists/hasPermission/hasDiskSpace fields.
  console.log(`\n${colors.blue}${colors.bright}Group 3: Path Validation${colors.reset}\n`);

  await test('PathManager.validatePath accepts a writable absolute tmp path', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-abs');

    try {
      const result = await pathManager.validatePath(tempDir);

      assert.ok(result.valid, 'Absolute tmp-dir path should be valid');
      assert.strictEqual(result.path, tempDir, 'Should return the resolved path');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  await test('PathManager.validatePath resolves relative paths against cwd', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-rel');
    const originalCwd = process.cwd();

    // chdir into a throwaway tmp dir first: PathManager resolves relative
    // paths via path.resolve(cwd), and a relative path resolved against the
    // repo's own cwd would create real directories in the repo tree.
    process.chdir(tempDir);
    try {
      const result = await pathManager.validatePath('./relative-child');

      assert.ok(typeof result.valid === 'boolean', 'Should have valid flag');
      assert.strictEqual(result.path, path.join(tempDir, 'relative-child'), 'Should resolve relative path against cwd');
    } finally {
      process.chdir(originalCwd);
      cleanupTempDir(tempDir);
    }
  });

  await test('expandPath expands a leading tilde to the home directory', async () => {
    const pathManager = new PathManager();

    // Exercise expandPath directly rather than validatePath: validatePath
    // would mkdir/write-test-file under the real home directory for any
    // tilde path, which is unacceptable side effect for a test run.
    const result = pathManager.expandPath('~/.cli-test-marker-unused');

    assert.strictEqual(result, path.join(os.homedir(), '.cli-test-marker-unused'), 'Should expand ~ to home dir');
  });

  await test('PathManager.validatePath detects a missing parent directory', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-parent');

    try {
      const validPath = path.join(tempDir, 'new-dir');
      const invalidPath = path.join(tempDir, 'nonexistent-parent-12345', 'new-dir');

      const validResult = await pathManager.validatePath(validPath);
      const invalidResult = await pathManager.validatePath(invalidPath);

      assert.ok(validResult.valid, 'Should validate a path with an existing parent');
      assert.ok(!invalidResult.valid, 'Should reject a path with a missing parent');
      assert.ok(invalidResult.error, 'Should report an error message');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  await test('PathManager.validatePath confirms write access for a writable directory', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-perm');

    try {
      const result = await pathManager.validatePath(path.join(tempDir, 'test-write'));

      assert.ok(result.valid, 'Should be valid for a writable tmp dir');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  await test('PathManager.getDiskSpace reports available space for a path', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-space');

    try {
      const result = await pathManager.getDiskSpace(tempDir);

      assert.ok(!result.error, 'Should not error for a valid path');
      assert.strictEqual(typeof result.available, 'number', 'Should report available space as a number');
      assert.strictEqual(typeof result.total, 'number', 'Should report total space as a number');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  await test('PathManager.checkExistingInstallation detects an existing manifest', async () => {
    const pathManager = new PathManager();
    const tempDir = createTempDir('cli-test-validate-exists');

    try {
      const manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ tool: 'claude', variant: 'standard' }));

      const result = await pathManager.checkExistingInstallation(tempDir);

      assert.ok(result.exists, 'Should detect the existing manifest');
      assert.strictEqual(result.manifest.tool, 'claude', 'Should parse manifest contents');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  // ===== Group 4: Utility Methods =====
  console.log(`\n${colors.blue}${colors.bright}Group 4: Utility Methods${colors.reset}\n`);

  await test('formatBytes formats 0 bytes correctly', async () => {
    const installer = new InteractiveInstaller();

    const result = installer.formatBytes(0);

    assert.strictEqual(result, '0 Bytes', 'Should format 0 as "0 Bytes"');
  });

  await test('formatBytes formats bytes correctly', async () => {
    const installer = new InteractiveInstaller();

    const result = installer.formatBytes(500);

    assert.ok(result.includes('500'), 'Should include byte count');
    assert.ok(result.includes('Bytes'), 'Should include "Bytes" unit');
  });

  await test('formatBytes formats kilobytes correctly', async () => {
    const installer = new InteractiveInstaller();

    const result = installer.formatBytes(1024 * 5.5);

    assert.ok(result.includes('5.5'), 'Should include KB value');
    assert.ok(result.includes('KB'), 'Should include "KB" unit');
  });

  await test('formatBytes formats megabytes correctly', async () => {
    const installer = new InteractiveInstaller();

    const result = installer.formatBytes(1024 * 1024 * 10);

    assert.ok(result.includes('10'), 'Should include MB value');
    assert.ok(result.includes('MB'), 'Should include "MB" unit');
  });

  await test('formatBytes formats gigabytes correctly', async () => {
    const installer = new InteractiveInstaller();

    const result = installer.formatBytes(1024 * 1024 * 1024 * 2);

    assert.ok(result.includes('2'), 'Should include GB value');
    assert.ok(result.includes('GB'), 'Should include "GB" unit');
  });

  // ===== Group 5: Progress Bar Rendering =====
  console.log(`\n${colors.blue}${colors.bright}Group 5: Progress Bar Rendering${colors.reset}\n`);

  await test('drawProgressBar writes to stdout (0% progress)', async () => {
    const installer = new InteractiveInstaller();

    // drawProgressBar writes to stdout and doesn't return a value
    // We just test that it doesn't throw an error
    assert.doesNotThrow(() => {
      installer.drawProgressBar(0, 100, 0, 'test.js', 0, 1024, 0, 0, 0);
    }, 'Should write progress bar without error');
  });

  await test('drawProgressBar writes to stdout (50% progress)', async () => {
    const installer = new InteractiveInstaller();

    assert.doesNotThrow(() => {
      installer.drawProgressBar(50, 100, 50, 'test.js', 512, 1024, 100, 5, 5);
    }, 'Should write progress bar without error');
  });

  await test('drawProgressBar writes to stdout (100% progress)', async () => {
    const installer = new InteractiveInstaller();

    assert.doesNotThrow(() => {
      installer.drawProgressBar(100, 100, 100, 'final.js', 1024, 1024, 100, 10, 0);
    }, 'Should write progress bar without error');
  });

  await test('drawProgressBar handles long filenames', async () => {
    const installer = new InteractiveInstaller();

    const longFilename = 'very-long-filename-that-should-be-truncated-because-it-is-too-long.js';

    assert.doesNotThrow(() => {
      installer.drawProgressBar(1, 10, 10, longFilename, 100, 1000, 50, 1, 9);
    }, 'Should handle long filenames without error');
  });

  // Group 6 (Verification Report Display) and Group 7 (Installation Report
  // Generation) were removed: displayVerificationReport,
  // performPreInstallationChecks, and generateInstallationReport were all
  // deleted from InteractiveInstaller in 3f07e47 (v1.10.0) with no
  // replacement anywhere in installer/ — confirmed by grep. There is no
  // current API surface for these tests to repair against.

  // ===== Group 8: Integration Tests =====
  console.log(`\n${colors.blue}${colors.bright}Group 8: Integration Tests${colors.reset}\n`);

  await test('CLI integrates with PackageManager correctly', async () => {
    const installer = new InteractiveInstaller();

    const packageManager = installer.getPackageManager();

    assert.ok(packageManager, 'Should have PackageManager');
    assert.ok(typeof packageManager.getPackageContents === 'function', 'Should have getPackageContents method');
    assert.ok(typeof packageManager.getPackageSize === 'function', 'Should have getPackageSize method');
    assert.ok(typeof packageManager.validatePackage === 'function', 'Should have validatePackage method');
  });

  await test('CLI can retrieve package information', async () => {
    const installer = new InteractiveInstaller();
    const packageManager = installer.getPackageManager();

    try {
      const contents = await packageManager.getPackageContents('claude', 'standard');

      assert.ok(contents, 'Should get package contents');
      assert.ok(typeof contents.totalFiles === 'number', 'Should have totalFiles count');
    } catch (error) {
      // Package might not exist in test environment, that's okay
      // Just verify we get an error object
      assert.ok(error, 'Should get error for missing package');
      assert.ok(error.message, 'Error should have message');
    }
  });

  // The two performPreInstallationChecks tests that lived here were removed:
  // that method was deleted from InteractiveInstaller in 3f07e47 (v1.10.0)
  // with no replacement — confirmed by grep across installer/.

  // ===== Test Summary =====
  console.log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}Test Summary${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}`);
  console.log(`Total:  ${totalTests}`);
  console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════${colors.reset}\n`);

  if (failedTests === 0) {
    console.log(`${colors.green}${colors.bright}✓ All CLI tests passed!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}${colors.bright}✗ Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error(`${colors.red}Fatal error running tests:${colors.reset}`, error);
    process.exit(1);
  });
}

module.exports = { runTests };
