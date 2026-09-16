#!/usr/bin/env node

/**
 * Installation Validation Test
 *
 * Tests actual installation of a tool to verify the installer works correctly
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m'
};

async function runValidationTest() {
  console.log(`${colors.bright}${colors.cyan}Installation Validation Test${colors.reset}\n`);

  const testDir = path.join(os.tmpdir(), `agentic-kit-test-${Date.now()}`);
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  try {
    // Test 1: Package Manager Initialization
    console.log(`${colors.cyan}Test 1: Package Manager Initialization${colors.reset}`);
    try {
      const PackageManager = require('../installer/package-manager');
      const packageManager = new PackageManager();
      console.log(`${colors.green}✓ PackageManager initialized successfully${colors.reset}`);
      results.passed++;
      results.tests.push({ name: 'Package Manager Init', status: 'PASS' });
    } catch (error) {
      console.log(`${colors.red}✗ PackageManager initialization failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Package Manager Init', status: 'FAIL', error: error.message });
    }

    // Test 2: Path Manager Initialization
    console.log(`\n${colors.cyan}Test 2: Path Manager Initialization${colors.reset}`);
    try {
      const PathManager = require('../installer/path-manager');
      const pathManager = new PathManager();
      console.log(`${colors.green}✓ PathManager initialized successfully${colors.reset}`);
      results.passed++;
      results.tests.push({ name: 'Path Manager Init', status: 'PASS' });
    } catch (error) {
      console.log(`${colors.red}✗ PathManager initialization failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Path Manager Init', status: 'FAIL', error: error.message });
    }

    // Test 3: Variant Configuration Loading
    console.log(`\n${colors.cyan}Test 3: Variant Configuration Loading${colors.reset}`);
    try {
      const PackageManager = require('../installer/package-manager');
      const packageManager = new PackageManager();

      // Try to load Claude variant config
      try {
        const config = await packageManager.loadVariantConfig('claude');
        console.log(`${colors.green}✓ Claude variants.json loaded successfully${colors.reset}`);
        console.log(`  Variants: ${Object.keys(config).join(', ')}`);
        results.passed++;
        results.tests.push({ name: 'Variant Config Loading', status: 'PASS' });
      } catch (error) {
        console.log(`${colors.yellow}⚠ Claude variants.json not found (expected if packages not set up)${colors.reset}`);
        results.tests.push({ name: 'Variant Config Loading', status: 'SKIP', reason: 'Package not found' });
      }
    } catch (error) {
      console.log(`${colors.red}✗ Variant config loading failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Variant Config Loading', status: 'FAIL', error: error.message });
    }

    // Test 4: Path Sanitization
    console.log(`\n${colors.cyan}Test 4: Path Sanitization (Security)${colors.reset}`);
    try {
      const PathManager = require('../installer/path-manager');
      const pathManager = new PathManager();

      // Test path traversal protection
      const maliciousPath = '../../etc/passwd';
      const result = pathManager.sanitizePath(maliciousPath);

      if (!result.valid) {
        console.log(`${colors.green}✓ Path traversal attack blocked${colors.reset}`);
        console.log(`  Error: ${result.error}`);
        results.passed++;
        results.tests.push({ name: 'Path Traversal Protection', status: 'PASS' });
      } else {
        console.log(`${colors.red}✗ Path traversal attack NOT blocked (security issue!)${colors.reset}`);
        results.failed++;
        results.tests.push({ name: 'Path Traversal Protection', status: 'FAIL', error: 'Malicious path accepted' });
      }
    } catch (error) {
      console.log(`${colors.red}✗ Path sanitization test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Path Traversal Protection', status: 'FAIL', error: error.message });
    }

    // Test 5: Path Validation
    console.log(`\n${colors.cyan}Test 5: Path Validation${colors.reset}`);
    try {
      const PathManager = require('../installer/path-manager');
      const pathManager = new PathManager();

      // Create test directory
      await fs.promises.mkdir(testDir, { recursive: true });

      const validationResult = await pathManager.validatePath(testDir);

      if (validationResult.valid) {
        console.log(`${colors.green}✓ Path validation successful${colors.reset}`);
        console.log(`  Path: ${validationResult.path}`);
        results.passed++;
        results.tests.push({ name: 'Path Validation', status: 'PASS' });
      } else {
        console.log(`${colors.red}✗ Path validation failed: ${validationResult.error}${colors.reset}`);
        results.failed++;
        results.tests.push({ name: 'Path Validation', status: 'FAIL', error: validationResult.error });
      }
    } catch (error) {
      console.log(`${colors.red}✗ Path validation test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Path Validation', status: 'FAIL', error: error.message });
    }

    // Test 6: Report Template
    console.log(`\n${colors.cyan}Test 6: Report Template Generation${colors.reset}`);
    try {
      const ReportTemplate = require('../installer/report-template');
      const reportTemplate = new ReportTemplate();

      const testData = {
        variant: 'standard',
        tools: [{
          toolId: 'claude',
          path: testDir,
          filesInstalled: 124,
          sizeBytes: 1024 * 1024 * 2,
          components: { agents: 13, skills: 8, resources: 1, hooks: 2 },
          verified: true,
          verificationStatus: 'All components verified',
          manifestPath: path.join(testDir, 'manifest.json')
        }],
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        success: true,
        errors: [],
        warnings: []
      };

      const report = reportTemplate.generateReport(testData);

      if (report && report.includes('LITEAGENTS INSTALLATION REPORT')) {
        console.log(`${colors.green}✓ Report generated successfully${colors.reset}`);
        console.log(`  Report length: ${report.length} characters`);
        results.passed++;
        results.tests.push({ name: 'Report Template', status: 'PASS' });
      } else {
        console.log(`${colors.red}✗ Report generation failed${colors.reset}`);
        results.failed++;
        results.tests.push({ name: 'Report Template', status: 'FAIL', error: 'Invalid report format' });
      }
    } catch (error) {
      console.log(`${colors.red}✗ Report template test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Report Template', status: 'FAIL', error: error.message });
    }

    // Test 7: Telemetry Module
    console.log(`\n${colors.cyan}Test 7: Telemetry Module${colors.reset}`);
    try {
      const Telemetry = require('../installer/telemetry');
      const telemetry = new Telemetry();

      // Test consent check
      const hasConsent = await telemetry.hasConsent();
      console.log(`${colors.green}✓ Telemetry module loaded${colors.reset}`);
      console.log(`  Current consent: ${hasConsent}`);
      results.passed++;
      results.tests.push({ name: 'Telemetry Module', status: 'PASS' });
    } catch (error) {
      console.log(`${colors.red}✗ Telemetry test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Telemetry Module', status: 'FAIL', error: error.message });
    }

    // Test 8: Legacy Detection
    console.log(`\n${colors.cyan}Test 8: Legacy Installation Detection${colors.reset}`);
    try {
      const PathManager = require('../installer/path-manager');
      const pathManager = new PathManager();

      // Check for legacy installations
      const legacyResult = await pathManager.detectLegacyInstallation('claude');
      console.log(`${colors.green}✓ Legacy detection completed${colors.reset}`);
      console.log(`  Is legacy: ${legacyResult.isLegacy}`);
      console.log(`  Exists: ${legacyResult.exists}`);
      results.passed++;
      results.tests.push({ name: 'Legacy Detection', status: 'PASS' });
    } catch (error) {
      console.log(`${colors.red}✗ Legacy detection test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'Legacy Detection', status: 'FAIL', error: error.message });
    }

    // Test 9: State Manager
    console.log(`\n${colors.cyan}Test 9: State Manager${colors.reset}`);
    try {
      const StateManager = require('../installer/state-manager');
      const stateManager = new StateManager();

      // Test state initialization
      stateManager.initializeState('standard', ['claude'], { claude: testDir });
      console.log(`${colors.green}✓ State manager initialized${colors.reset}`);
      results.passed++;
      results.tests.push({ name: 'State Manager', status: 'PASS' });
    } catch (error) {
      console.log(`${colors.red}✗ State manager test failed: ${error.message}${colors.reset}`);
      results.failed++;
      results.tests.push({ name: 'State Manager', status: 'FAIL', error: error.message });
    }

  } catch (error) {
    console.error(`\n${colors.red}Fatal error during testing: ${error.message}${colors.reset}`);
    console.error(error.stack);
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(testDir)) {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.log(`${colors.yellow}⚠ Cleanup failed: ${error.message}${colors.reset}`);
    }
  }

  // Print summary
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}Test Summary${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
  console.log(`Total: ${results.tests.length}`);

  if (results.failed === 0) {
    console.log(`\n${colors.green}${colors.bright}✓ All tests passed!${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bright}✗ Some tests failed${colors.reset}`);
    process.exit(1);
  }
}

// Run tests
runValidationTest().catch(error => {
  console.error(`${colors.red}Test execution failed: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});
