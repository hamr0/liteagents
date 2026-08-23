#!/usr/bin/env node

/**
 * Unified Test Runner
 * Consolidates the installer test suites and generates comprehensive reports
 *
 * Test Suites:
 * 1. Multi-Tool Installation Testing
 * 2. Error Scenario Testing
 * 3. Cross-Platform Testing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test suite definitions. These reflect the single-variant installer (one
// 'pro' package per tool). The legacy Variant and Path Handling suites were
// removed with the 3-variant system; other tests/installer/*.test.js files
// are not wired in here.
const testSuites = [
  {
    name: 'Multi-Tool Installation',
    file: 'installer/multi-tool-testing.test.js',
    description: 'Tests simultaneous installation of multiple tools',
    expectedTests: 36
  },
  {
    name: 'Error Scenario Testing',
    file: 'installer/error-scenario-testing.test.js',
    description: 'Tests error handling, validation, and rollback',
    expectedTests: 36
  },
  {
    name: 'Cross-Platform Testing',
    file: 'installer/cross-platform-testing.test.js',
    description: 'Tests platform-specific behaviors (Linux)',
    expectedTests: 66
  },
  {
    name: 'docs-builder',
    file: 'docs-builder/docs-builder.test.js',
    description: 'Tests docs-builder.cjs behaviour end-to-end in throwaway git repos',
    expectedTests: 354
  }
];

// Results tracker
const results = {
  suites: [],
  totalTests: 0,
  totalPassed: 0,
  totalFailed: 0,
  duration: 0,
  timestamp: new Date().toISOString()
};

/**
 * Print header
 */
function printHeader() {
  console.log(colors.bright + colors.cyan);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        Agentic Kit Installer - Unified Test Runner        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  console.log('');
  console.log(`Running ${testSuites.length} test suites...`);
  console.log(`Timestamp: ${results.timestamp}`);
  console.log('');
}

/**
 * Run a single test suite
 */
function runTestSuite(suite) {
  console.log(colors.bright + colors.yellow + `\n${'═'.repeat(60)}`);
  console.log(`Running: ${suite.name}`);
  console.log('═'.repeat(60) + colors.reset);
  console.log(`Description: ${suite.description}`);
  console.log(`Expected tests: ${suite.expectedTests}`);
  console.log('');

  const startTime = Date.now();
  const testFile = path.join(__dirname, suite.file);

  if (!fs.existsSync(testFile)) {
    console.log(colors.red + `✗ Test file not found: ${suite.file}` + colors.reset);
    return {
      name: suite.name,
      passed: 0,
      failed: 0,
      total: 0,
      passRate: 0,
      duration: 0,
      error: 'Test file not found'
    };
  }

  try {
    // Run the test file and capture output
    const output = execSync(`node "${testFile}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const duration = Date.now() - startTime;

    // Parse output to extract test results
    const passedMatch = output.match(/Passed:\s+(\d+)/);
    const failedMatch = output.match(/Failed:\s+(\d+)/);
    const totalMatch = output.match(/Total tests:\s+(\d+)/);

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    const total = totalMatch ? parseInt(totalMatch[1]) : passed + failed;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    console.log(colors.green + `✓ Test suite completed` + colors.reset);
    console.log(`  Total: ${total} | Passed: ${passed} | Failed: ${failed} | Pass rate: ${passRate}%`);
    console.log(`  Duration: ${duration}ms`);

    return {
      name: suite.name,
      passed,
      failed,
      total,
      passRate: parseFloat(passRate),
      duration,
      output: output.substring(0, 500) // Store first 500 chars
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    // Test suite may have failed, try to parse what we can from stderr
    const stderr = error.stderr ? error.stderr.toString() : '';
    const stdout = error.stdout ? error.stdout.toString() : '';
    const combinedOutput = stdout + stderr;

    const passedMatch = combinedOutput.match(/Passed:\s+(\d+)/);
    const failedMatch = combinedOutput.match(/Failed:\s+(\d+)/);
    const totalMatch = combinedOutput.match(/Total tests:\s+(\d+)/);

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    const total = totalMatch ? parseInt(totalMatch[1]) : passed + failed;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    if (total > 0) {
      console.log(colors.yellow + `⚠ Test suite completed with failures` + colors.reset);
      console.log(`  Total: ${total} | Passed: ${passed} | Failed: ${failed} | Pass rate: ${passRate}%`);
      console.log(`  Duration: ${duration}ms`);
    } else {
      console.log(colors.red + `✗ Test suite failed to run` + colors.reset);
      console.log(`  Error: ${error.message}`);
    }

    return {
      name: suite.name,
      passed,
      failed,
      total,
      passRate: parseFloat(passRate),
      duration,
      error: total > 0 ? null : error.message,
      output: combinedOutput.substring(0, 500)
    };
  }
}

/**
 * Print summary
 */
function printSummary() {
  console.log(colors.bright + colors.cyan + '\n\n' + '═'.repeat(60));
  console.log('                      SUMMARY REPORT');
  console.log('═'.repeat(60) + colors.reset);
  console.log('');

  // Test suite results
  console.log(colors.bright + 'Test Suite Results:' + colors.reset);
  results.suites.forEach((suite, index) => {
    const status = suite.failed === 0 && suite.total > 0
      ? colors.green + '✓'
      : suite.total === 0
        ? colors.red + '✗'
        : colors.yellow + '⚠';

    console.log(`${index + 1}. ${status} ${suite.name}${colors.reset}`);
    console.log(`   Tests: ${suite.total} | Passed: ${suite.passed} | Failed: ${suite.failed} | Pass rate: ${suite.passRate}%`);
    console.log(`   Duration: ${suite.duration}ms`);
    if (suite.error) {
      console.log(`   Error: ${colors.red}${suite.error}${colors.reset}`);
    }
    console.log('');
  });

  // Overall statistics
  console.log(colors.bright + 'Overall Statistics:' + colors.reset);
  console.log(`Total Tests:       ${results.totalTests}`);
  console.log(`${colors.green}Passed:            ${results.totalPassed}${colors.reset}`);
  console.log(`${colors.red}Failed:            ${results.totalFailed}${colors.reset}`);

  const overallPassRate = results.totalTests > 0
    ? ((results.totalPassed / results.totalTests) * 100).toFixed(1)
    : 0;
  console.log(`Pass Rate:         ${overallPassRate}%`);
  console.log(`Total Duration:    ${results.duration}ms (${(results.duration / 1000).toFixed(2)}s)`);
  console.log('');

  // Final status
  if (results.totalFailed === 0 && results.totalTests > 0) {
    console.log(colors.green + colors.bright + '🎉 All tests passed!' + colors.reset);
  } else if (results.totalTests === 0) {
    console.log(colors.red + colors.bright + '❌ No tests were executed!' + colors.reset);
  } else {
    console.log(colors.yellow + colors.bright + `⚠️  ${results.totalFailed} test(s) failed` + colors.reset);
  }
  console.log('');
}

/**
 * Generate JSON report
 */
function generateJsonReport() {
  const report = {
    timestamp: results.timestamp,
    summary: {
      totalTests: results.totalTests,
      totalPassed: results.totalPassed,
      totalFailed: results.totalFailed,
      passRate: results.totalTests > 0 ? ((results.totalPassed / results.totalTests) * 100).toFixed(1) : 0,
      duration: results.duration
    },
    suites: results.suites.map(suite => ({
      name: suite.name,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      passRate: suite.passRate,
      duration: suite.duration,
      error: suite.error || null
    }))
  };

  const reportPath = path.join(__dirname, '../test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`JSON report saved: ${reportPath}`);
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport() {
  let markdown = `# Agentic Kit Installer - Test Report\n\n`;
  markdown += `**Generated**: ${results.timestamp}\n\n`;

  // Summary table
  markdown += `## Summary\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total Tests | ${results.totalTests} |\n`;
  markdown += `| Passed | ${results.totalPassed} |\n`;
  markdown += `| Failed | ${results.totalFailed} |\n`;
  markdown += `| Pass Rate | ${results.totalTests > 0 ? ((results.totalPassed / results.totalTests) * 100).toFixed(1) : 0}% |\n`;
  markdown += `| Duration | ${(results.duration / 1000).toFixed(2)}s |\n\n`;

  // Test suite details
  markdown += `## Test Suite Results\n\n`;
  results.suites.forEach((suite, index) => {
    const status = suite.failed === 0 && suite.total > 0 ? '✅' : suite.total === 0 ? '❌' : '⚠️';
    markdown += `### ${index + 1}. ${status} ${suite.name}\n\n`;
    markdown += `- **Total Tests**: ${suite.total}\n`;
    markdown += `- **Passed**: ${suite.passed}\n`;
    markdown += `- **Failed**: ${suite.failed}\n`;
    markdown += `- **Pass Rate**: ${suite.passRate}%\n`;
    markdown += `- **Duration**: ${suite.duration}ms\n`;
    if (suite.error) {
      markdown += `- **Error**: ${suite.error}\n`;
    }
    markdown += `\n`;
  });

  // Final status
  markdown += `## Final Status\n\n`;
  if (results.totalFailed === 0 && results.totalTests > 0) {
    markdown += `✅ **All tests passed!**\n`;
  } else if (results.totalTests === 0) {
    markdown += `❌ **No tests were executed!**\n`;
  } else {
    markdown += `⚠️ **${results.totalFailed} test(s) failed**\n`;
  }

  const reportPath = path.join(__dirname, '../TEST_REPORT.md');
  fs.writeFileSync(reportPath, markdown);

  console.log(`Markdown report saved: ${reportPath}`);
}

/**
 * Main execution
 */
function main() {
  const startTime = Date.now();

  printHeader();

  // Run all test suites
  for (const suite of testSuites) {
    const result = runTestSuite(suite);
    results.suites.push(result);
    results.totalTests += result.total;
    results.totalPassed += result.passed;
    results.totalFailed += result.failed;
  }

  results.duration = Date.now() - startTime;

  // Print summary
  printSummary();

  // Generate reports
  try {
    generateJsonReport();
    generateMarkdownReport();
  } catch (error) {
    console.error(colors.red + `Failed to generate reports: ${error.message}` + colors.reset);
  }

  console.log('');

  // Exit with appropriate code
  process.exit(results.totalFailed > 0 ? 1 : 0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
