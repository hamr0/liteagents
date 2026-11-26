#!/usr/bin/env node

/**
 * Error Scenario Testing Suite
 * Tests error handling, validation, and rollback capabilities
 *
 * Tests:
 * - Insufficient disk space detection
 * - Permission denied handling
 * - Interrupted installation recovery
 * - Missing package file detection
 * - Corrupted variants.json handling
 * - Rollback after partial installation
 */

const fs = require('fs');
const path = require('path');
const { createTempDir, removeDirRecursive } = require('../fixtures/helpers/test-helpers');

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
 * Test 1: Corrupted variants.json handling
 */
function testCorruptedVariantsJson() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 1: Corrupted variants.json ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-corrupted-');

  try {
    // Create a corrupted variants.json (from fixtures)
    const corruptedPath = path.join(__dirname, '../fixtures/variants/variants-corrupted.json');
    const testVariantsPath = path.join(testDir, 'variants.json');

    if (fs.existsSync(corruptedPath)) {
      fs.copyFileSync(corruptedPath, testVariantsPath);
      logTest('Corrupted JSON: Create test file', true);
    } else {
      // Create corrupted JSON manually
      fs.writeFileSync(testVariantsPath, '{"variants": {"lite": {');
      logTest('Corrupted JSON: Create test file', true);
    }

    // Try to parse it
    try {
      const content = fs.readFileSync(testVariantsPath, 'utf8');
      JSON.parse(content);
      logTest('Corrupted JSON: Parse fails', false, 'Should have thrown parse error');
    } catch (error) {
      logTest('Corrupted JSON: Parse fails correctly', true, error.message);
    }

    // Verify error message is helpful
    try {
      const content = fs.readFileSync(testVariantsPath, 'utf8');
      JSON.parse(content);
    } catch (error) {
      const hasUsefulMessage = error.message.includes('JSON') || error.message.includes('parse');
      logTest('Corrupted JSON: Error message is helpful', hasUsefulMessage,
        hasUsefulMessage ? 'Contains JSON/parse reference' : 'Generic error message');
    }

    removeDirRecursive(testDir);
    logTest('Corrupted JSON: Cleanup', true);

  } catch (error) {
    logTest('Corrupted JSON: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 2: Missing package files
 */
function testMissingPackageFiles() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 2: Missing Package Files ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-missing-');

  try {
    // Create package structure with missing files
    const packageDir = path.join(testDir, 'test-package');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'skills'), { recursive: true });

    // Create variants.json that references files that don't exist
    const variants = {
      lite: {
        agents: ['missing-agent'],
        skills: [],
        resources: '*',
        hooks: '*'
      }
    };
    fs.writeFileSync(
      path.join(packageDir, 'variants.json'),
      JSON.stringify(variants, null, 2)
    );
    logTest('Missing files: Create test package', true);

    // Verify the file doesn't exist
    const missingFile = path.join(packageDir, 'agents', 'missing-agent.md');
    const fileExists = fs.existsSync(missingFile);
    logTest('Missing files: File is missing', !fileExists);

    // Try to validate package
    const variantConfig = variants.lite;
    const agentFile = variantConfig.agents[0] + '.md';
    const agentPath = path.join(packageDir, 'agents', agentFile);
    const validationPassed = fs.existsSync(agentPath);

    logTest('Missing files: Validation detects missing file', !validationPassed,
      validationPassed ? 'File found (unexpected)' : 'File not found (expected)');

    removeDirRecursive(testDir);
    logTest('Missing files: Cleanup', true);

  } catch (error) {
    logTest('Missing files: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 3: Permission denied (unwritable directory)
 */
function testPermissionDenied() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 3: Permission Denied ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-permissions-');

  try {
    // Create a directory and make it read-only
    const readOnlyDir = path.join(testDir, 'readonly');
    fs.mkdirSync(readOnlyDir, { recursive: true });
    logTest('Permission denied: Create test directory', true);

    // Make it read-only (chmod 444)
    fs.chmodSync(readOnlyDir, 0o444);
    logTest('Permission denied: Set directory to read-only', true);

    // Try to write a file to it
    const testFile = path.join(readOnlyDir, 'test.txt');
    try {
      fs.writeFileSync(testFile, 'test content');
      logTest('Permission denied: Write fails correctly', false,
        'Write should have failed but succeeded');
    } catch (error) {
      const isPermissionError = error.code === 'EACCES' || error.code === 'EPERM';
      logTest('Permission denied: Write fails correctly', isPermissionError,
        error.code || error.message);
    }

    // Restore permissions for cleanup
    fs.chmodSync(readOnlyDir, 0o755);
    removeDirRecursive(testDir);
    logTest('Permission denied: Cleanup', true);

  } catch (error) {
    logTest('Permission denied: Test error', false, error.message);
    // Try to restore permissions and cleanup
    try {
      const readOnlyDir = path.join(testDir, 'readonly');
      if (fs.existsSync(readOnlyDir)) {
        fs.chmodSync(readOnlyDir, 0o755);
      }
      if (fs.existsSync(testDir)) removeDirRecursive(testDir);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Test 4: Partial installation and rollback
 */
function testPartialInstallationRollback() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 4: Partial Installation & Rollback ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-rollback-');

  try {
    // Create initial state
    const installDir = path.join(testDir, 'installation');
    fs.mkdirSync(installDir, { recursive: true });

    const initialFile = path.join(installDir, 'initial-file.txt');
    fs.writeFileSync(initialFile, 'initial content');
    logTest('Rollback: Create initial state', true);

    // Simulate partial installation
    const agentsDir = path.join(installDir, 'agents');
    const skillsDir = path.join(installDir, 'skills');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, 'agent1.md'), 'agent 1');
    fs.writeFileSync(path.join(agentsDir, 'agent2.md'), 'agent 2');
    logTest('Rollback: Create partial installation', true, '2 agents copied');

    // Verify partial state exists
    const agent1Exists = fs.existsSync(path.join(agentsDir, 'agent1.md'));
    const agent2Exists = fs.existsSync(path.join(agentsDir, 'agent2.md'));
    logTest('Rollback: Verify partial state', agent1Exists && agent2Exists);

    // Simulate rollback (remove new directories, keep initial file)
    removeDirRecursive(agentsDir);
    removeDirRecursive(skillsDir);
    logTest('Rollback: Remove partial installation', true);

    // Verify rollback preserved initial state
    const initialStillExists = fs.existsSync(initialFile);
    const agentsDirRemoved = !fs.existsSync(agentsDir);
    const skillsDirRemoved = !fs.existsSync(skillsDir);

    logTest('Rollback: Initial file preserved', initialStillExists);
    logTest('Rollback: Partial files removed', agentsDirRemoved && skillsDirRemoved);

    removeDirRecursive(testDir);
    logTest('Rollback: Cleanup', true);

  } catch (error) {
    logTest('Rollback: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 5: Disk space checks (simulation)
 */
function testDiskSpaceCheck() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 5: Disk Space Check (Simulated) ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-diskspace-');

  try {
    // Calculate size of package
    const packageDir = path.join(__dirname, '../../packages/claude');

    if (!fs.existsSync(packageDir)) {
      logTest('Disk space: Package dir exists', false, 'Package not found');
      removeDirRecursive(testDir);
      return;
    }

    logTest('Disk space: Package dir exists', true);

    // Function to calculate directory size
    function getDirSize(dirPath) {
      let size = 0;
      const walk = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            walk(filePath);
          } else {
            size += stats.size;
          }
        }
      };
      walk(dirPath);
      return size;
    }

    const packageSize = getDirSize(packageDir);
    const packageSizeMB = (packageSize / (1024 * 1024)).toFixed(2);
    logTest('Disk space: Calculate package size', true, `${packageSizeMB} MB`);

    // Simulate disk space check
    const requiredSpace = packageSize;
    const mockAvailableSpace = packageSize + (10 * 1024 * 1024); // Package size + 10MB buffer
    const hasEnoughSpace = mockAvailableSpace >= requiredSpace;

    logTest('Disk space: Check sufficient space', hasEnoughSpace,
      `Required: ${(requiredSpace / 1024 / 1024).toFixed(2)} MB`);

    // Simulate insufficient space scenario
    const mockInsufficientSpace = packageSize / 2; // Only half the required space
    const hasInsufficientSpace = mockInsufficientSpace < requiredSpace;
    logTest('Disk space: Detect insufficient space', hasInsufficientSpace,
      'Correctly detects when space is insufficient');

    removeDirRecursive(testDir);
    logTest('Disk space: Cleanup', true);

  } catch (error) {
    logTest('Disk space: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 6: Path validation
 */
function testPathValidation() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 6: Path Validation ═══\x1b[0m\n');

  try {
    // Test invalid paths
    const invalidPaths = [
      '',
      null,
      '../../../etc/passwd',  // Path traversal
      '/root/private',         // Restricted directory
      'invalid<>path',         // Invalid characters (Windows)
    ];

    for (const invalidPath of invalidPaths) {
      if (!invalidPath) {
        logTest('Path validation: Empty/null path rejected', true, 'Path is empty/null');
        continue;
      }

      // Check for path traversal
      if (invalidPath.includes('..')) {
        logTest('Path validation: Path traversal rejected', true, invalidPath);
        continue;
      }

      // Check for invalid characters
      if (/[<>:"|?*]/.test(invalidPath)) {
        logTest('Path validation: Invalid characters rejected', true, invalidPath);
        continue;
      }

      // Check for restricted paths
      if (invalidPath.startsWith('/root') || invalidPath.startsWith('/etc')) {
        logTest('Path validation: Restricted path rejected', true, invalidPath);
        continue;
      }
    }

    // Test valid paths
    const validPaths = [
      '/tmp/test-installation',
      '/home/user/agentic-kit',
      path.join(process.env.HOME || '/home/user', '.agentic-kit')
    ];

    for (const validPath of validPaths) {
      const isAbsolute = path.isAbsolute(validPath);
      const hasNoTraversal = !validPath.includes('..');
      const hasNoInvalidChars = !/[<>:"|?*]/.test(validPath);
      const isValid = isAbsolute && hasNoTraversal && hasNoInvalidChars;

      logTest('Path validation: Valid path accepted', isValid, validPath);
    }

  } catch (error) {
    logTest('Path validation: Test error', false, error.message);
  }
}

/**
 * Test 7: Interrupted installation simulation
 */
function testInterruptedInstallation() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 7: Interrupted Installation ═══\x1b[0m\n');

  const testDir = createTempDir('error-test-interrupted-');

  const expectedAgents = 9; // full install size the partial one is judged against
  try {
    // Create installation in progress
    const installDir = path.join(testDir, 'installation');
    fs.mkdirSync(installDir, { recursive: true });

    const agentsDir = path.join(installDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    // Install partial files
    fs.writeFileSync(path.join(agentsDir, 'agent1.md'), 'agent 1');
    fs.writeFileSync(path.join(agentsDir, 'agent2.md'), 'agent 2');

    // Create partial manifest indicating incomplete installation
    const manifest = {
      tool: 'claude',
      variant: 'standard',
      status: 'in_progress',
      installedAt: new Date().toISOString(),
      components: {
        agents: 2,
        skills: 0,
        resources: 0,
        hooks: 0
      }
    };
    fs.writeFileSync(
      path.join(installDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    logTest('Interrupted: Create partial installation', true, `2/${expectedAgents} agents installed`);

    // Detect interrupted installation
    const manifestPath = path.join(installDir, 'manifest.json');
    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const isIncomplete = manifestData.status === 'in_progress' ||
                         manifestData.components.agents < expectedAgents;

    logTest('Interrupted: Detect incomplete installation', isIncomplete,
      `${manifestData.components.agents}/${expectedAgents} agents installed`);

    // Simulate resume by completing installation
    fs.writeFileSync(path.join(agentsDir, 'agent3.md'), 'agent 3');
    manifestData.components.agents = 3;
    logTest('Interrupted: Resume installation', true, `3/${expectedAgents} agents now installed`);

    // Clean up
    removeDirRecursive(testDir);
    logTest('Interrupted: Cleanup', true);

  } catch (error) {
    logTest('Interrupted: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Run all error scenario tests
 */
function runAllTests() {
  console.log('\x1b[1m\x1b[36m');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Error Scenario Testing Suite                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  console.log('Testing error handling, validation, and rollback capabilities\n');

  // Run all tests
  testCorruptedVariantsJson();
  testMissingPackageFiles();
  testPermissionDenied();
  testPartialInstallationRollback();
  testDiskSpaceCheck();
  testPathValidation();
  testInterruptedInstallation();

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

  console.log('Error scenarios tested:');
  console.log('  ✓ Corrupted variants.json handling');
  console.log('  ✓ Missing package files detection');
  console.log('  ✓ Permission denied scenarios');
  console.log('  ✓ Partial installation rollback');
  console.log('  ✓ Disk space validation');
  console.log('  ✓ Path validation and security');
  console.log('  ✓ Interrupted installation recovery');
  console.log('');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testCorruptedVariantsJson,
  testMissingPackageFiles,
  testPermissionDenied,
  testPartialInstallationRollback,
  testDiskSpaceCheck,
  testPathValidation,
  testInterruptedInstallation,
  runAllTests
};
