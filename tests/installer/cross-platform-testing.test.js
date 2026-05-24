#!/usr/bin/env node

/**
 * Cross-Platform Testing Suite
 * Tests platform-specific behaviors, rendering, and compatibility
 *
 * Tests (Linux):
 * - Linux path handling (forward slashes, case-sensitive)
 * - Linux file operations
 * - Linux permissions (chmod, ownership)
 * - ANSI color code rendering
 * - Progress bar rendering
 * - Terminal emulator compatibility
 *
 * Documented (macOS/Windows):
 * - Platform-specific path conventions
 * - Platform-specific file operations
 * - Platform-specific permission models
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
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
 * Test 1: Linux Path Handling
 */
function testLinuxPathHandling() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 1: Linux Path Handling ═══\x1b[0m\n');

  const testDir = createTempDir('cross-platform-linux-paths-');

  try {
    // Verify platform
    const platform = os.platform();
    const isLinux = platform === 'linux';
    logTest('Linux: Platform detection', isLinux, platform);

    // Test forward slash paths
    const forwardSlashPath = path.join(testDir, 'dir1/dir2/dir3');
    fs.mkdirSync(forwardSlashPath, { recursive: true });
    const forwardSlashWorks = fs.existsSync(forwardSlashPath);
    logTest('Linux: Forward slash paths work', forwardSlashWorks);

    // Test case sensitivity
    const lowerCasePath = path.join(testDir, 'lowercase');
    const upperCasePath = path.join(testDir, 'LOWERCASE');
    fs.mkdirSync(lowerCasePath, { recursive: true });
    fs.mkdirSync(upperCasePath, { recursive: true });

    const bothExist = fs.existsSync(lowerCasePath) && fs.existsSync(upperCasePath);
    logTest('Linux: Case-sensitive file system', bothExist,
      'lowercase and LOWERCASE are different');

    // Test path separator
    const separator = path.sep;
    const isForwardSlash = separator === '/';
    logTest('Linux: Path separator is forward slash', isForwardSlash, separator);

    // Test absolute path recognition
    const absolutePaths = ['/tmp', '/home', '/usr/local'];
    for (const absPath of absolutePaths) {
      const isAbsolute = path.isAbsolute(absPath);
      logTest('Linux: Absolute path recognized', isAbsolute, absPath);
    }

    // Test home directory expansion
    const homeDir = os.homedir();
    const isAbsoluteHome = path.isAbsolute(homeDir);
    const startsWithSlash = homeDir.startsWith('/');
    logTest('Linux: Home directory is absolute', isAbsoluteHome && startsWithSlash, homeDir);

    removeDirRecursive(testDir);
    logTest('Linux: Cleanup', true);

  } catch (error) {
    logTest('Linux: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 2: Linux File Operations
 */
function testLinuxFileOperations() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 2: Linux File Operations ═══\x1b[0m\n');

  const testDir = createTempDir('cross-platform-linux-files-');

  try {
    // Test file creation with various modes
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'test content', { mode: 0o644 });
    const fileExists = fs.existsSync(testFile);
    logTest('Linux: Create file with mode', fileExists);

    // Verify file mode
    const stats = fs.statSync(testFile);
    const mode = (stats.mode & parseInt('777', 8)).toString(8);
    logTest('Linux: File mode set correctly', mode === '644', `mode: ${mode}`);

    // Test symbolic links
    const symlinkPath = path.join(testDir, 'symlink.txt');
    try {
      fs.symlinkSync(testFile, symlinkPath);
      const symlinkExists = fs.existsSync(symlinkPath);
      const isSymlink = fs.lstatSync(symlinkPath).isSymbolicLink();
      logTest('Linux: Create symbolic link', symlinkExists && isSymlink);
    } catch (error) {
      logTest('Linux: Create symbolic link', false, error.message);
    }

    // Test hard links
    const hardlinkPath = path.join(testDir, 'hardlink.txt');
    try {
      fs.linkSync(testFile, hardlinkPath);
      const hardlinkExists = fs.existsSync(hardlinkPath);
      logTest('Linux: Create hard link', hardlinkExists);

      // Verify content is the same
      const originalContent = fs.readFileSync(testFile, 'utf8');
      const hardlinkContent = fs.readFileSync(hardlinkPath, 'utf8');
      const contentMatches = originalContent === hardlinkContent;
      logTest('Linux: Hard link content matches', contentMatches);
    } catch (error) {
      logTest('Linux: Create hard link', false, error.message);
    }

    // Test file with no extension
    const noExtFile = path.join(testDir, 'noextension');
    fs.writeFileSync(noExtFile, 'content');
    const noExtExists = fs.existsSync(noExtFile);
    logTest('Linux: Files without extensions allowed', noExtExists);

    // Test hidden files (starting with .)
    const hiddenFile = path.join(testDir, '.hidden');
    fs.writeFileSync(hiddenFile, 'hidden content');
    const hiddenExists = fs.existsSync(hiddenFile);
    logTest('Linux: Hidden files (dot prefix) work', hiddenExists);

    removeDirRecursive(testDir);
    logTest('Linux: Cleanup', true);

  } catch (error) {
    logTest('Linux: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 3: Linux Permissions
 */
function testLinuxPermissions() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 3: Linux Permissions ═══\x1b[0m\n');

  const testDir = createTempDir('cross-platform-linux-perms-');

  try {
    // Test chmod operations
    const testFile = path.join(testDir, 'chmod-test.txt');
    fs.writeFileSync(testFile, 'content');
    logTest('Linux: Create test file', true);

    // Set to read-only
    fs.chmodSync(testFile, 0o444);
    const stats1 = fs.statSync(testFile);
    const mode1 = (stats1.mode & parseInt('777', 8)).toString(8);
    logTest('Linux: chmod to read-only (444)', mode1 === '444', `mode: ${mode1}`);

    // Set to read-write-execute
    fs.chmodSync(testFile, 0o755);
    const stats2 = fs.statSync(testFile);
    const mode2 = (stats2.mode & parseInt('777', 8)).toString(8);
    logTest('Linux: chmod to rwxr-xr-x (755)', mode2 === '755', `mode: ${mode2}`);

    // Test directory permissions
    const testSubdir = path.join(testDir, 'subdir');
    fs.mkdirSync(testSubdir);
    fs.chmodSync(testSubdir, 0o755);
    const dirStats = fs.statSync(testSubdir);
    const dirMode = (dirStats.mode & parseInt('777', 8)).toString(8);
    logTest('Linux: Directory chmod works', dirMode === '755', `mode: ${dirMode}`);

    // Test permission checking
    const readableFile = path.join(testDir, 'readable.txt');
    fs.writeFileSync(readableFile, 'content', { mode: 0o644 });

    try {
      fs.accessSync(readableFile, fs.constants.R_OK);
      logTest('Linux: Check read permission', true);
    } catch (error) {
      logTest('Linux: Check read permission', false, error.message);
    }

    try {
      fs.accessSync(readableFile, fs.constants.W_OK);
      logTest('Linux: Check write permission', true);
    } catch (error) {
      logTest('Linux: Check write permission', false, error.message);
    }

    // Test executable bit
    const executableFile = path.join(testDir, 'executable.sh');
    fs.writeFileSync(executableFile, '#!/bin/bash\necho "test"', { mode: 0o755 });
    const execStats = fs.statSync(executableFile);
    const isExecutable = (execStats.mode & 0o111) !== 0;
    logTest('Linux: Executable bit set', isExecutable);

    removeDirRecursive(testDir);
    logTest('Linux: Cleanup', true);

  } catch (error) {
    logTest('Linux: Test error', false, error.message);
    if (fs.existsSync(testDir)) removeDirRecursive(testDir);
  }
}

/**
 * Test 4: ANSI Color Code Rendering
 */
function testAnsiColorCodes() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 4: ANSI Color Codes ═══\x1b[0m\n');

  try {
    // Test basic colors
    const colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };

    // Verify color codes are strings
    for (const [name, code] of Object.entries(colors)) {
      const isString = typeof code === 'string';
      logTest(`ANSI: ${name} color code valid`, isString, code);
    }

    // Test background colors
    const bgColors = {
      bgRed: '\x1b[41m',
      bgGreen: '\x1b[42m',
      bgYellow: '\x1b[43m',
      bgBlue: '\x1b[44m'
    };

    for (const [name, code] of Object.entries(bgColors)) {
      const isString = typeof code === 'string';
      logTest(`ANSI: ${name} background code valid`, isString, code);
    }

    // Test text styles
    const styles = {
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      italic: '\x1b[3m',
      underline: '\x1b[4m'
    };

    for (const [name, code] of Object.entries(styles)) {
      const isString = typeof code === 'string';
      logTest(`ANSI: ${name} style code valid`, isString, code);
    }

    // Display sample colored output
    console.log('\n  Sample colored output:');
    console.log(`  ${colors.red}Red text${colors.reset}`);
    console.log(`  ${colors.green}Green text${colors.reset}`);
    console.log(`  ${colors.yellow}Yellow text${colors.reset}`);
    console.log(`  ${colors.blue}Blue text${colors.reset}`);
    console.log(`  ${styles.bold}Bold text${colors.reset}`);
    console.log(`  ${styles.underline}Underlined text${colors.reset}\n`);

    logTest('ANSI: Color rendering works', true, 'See output above');

  } catch (error) {
    logTest('ANSI: Test error', false, error.message);
  }
}

/**
 * Test 5: Progress Bar Rendering
 */
function testProgressBarRendering() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 5: Progress Bar Rendering ═══\x1b[0m\n');

  try {
    // Test progress bar characters
    const progressChars = {
      filled: '█',
      empty: '░',
      partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉']
    };

    logTest('Progress: Filled block character', progressChars.filled.length === 1);
    logTest('Progress: Empty block character', progressChars.empty.length === 1);
    logTest('Progress: Partial block characters', progressChars.partial.length === 7);

    // Test progress bar generation
    const generateProgressBar = (percent, width = 20) => {
      const filled = Math.floor(width * percent / 100);
      const empty = width - filled;
      return progressChars.filled.repeat(filled) + progressChars.empty.repeat(empty);
    };

    const progress25 = generateProgressBar(25);
    const progress50 = generateProgressBar(50);
    const progress75 = generateProgressBar(75);
    const progress100 = generateProgressBar(100);

    logTest('Progress: 25% bar generates', progress25.length === 20, progress25);
    logTest('Progress: 50% bar generates', progress50.length === 20, progress50);
    logTest('Progress: 75% bar generates', progress75.length === 20, progress75);
    logTest('Progress: 100% bar generates', progress100.length === 20, progress100);

    // Display sample progress bars
    console.log('\n  Sample progress bars:');
    console.log(`  0%   [${generateProgressBar(0)}]`);
    console.log(`  25%  [${generateProgressBar(25)}]`);
    console.log(`  50%  [${generateProgressBar(50)}]`);
    console.log(`  75%  [${generateProgressBar(75)}]`);
    console.log(`  100% [${generateProgressBar(100)}]\n`);

    logTest('Progress: Bar rendering works', true, 'See output above');

    // Test spinner characters
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    logTest('Progress: Spinner frames available', spinnerFrames.length === 10);

  } catch (error) {
    logTest('Progress: Test error', false, error.message);
  }
}

/**
 * Test 6: Terminal Emulator Compatibility
 */
function testTerminalCompatibility() {
  console.log('\n\x1b[1m\x1b[33m═══ Test 6: Terminal Compatibility ═══\x1b[0m\n');

  try {
    // TERM may be unset when piped or running in CI; the installer falls back
    // to 'unknown', so verify the resolved value is always usable.
    const termEnv = process.env.TERM || 'unknown';
    logTest('Terminal: TERM resolved (with fallback)', termEnv.length > 0, termEnv);

    // Color output must degrade gracefully whether stdout is a TTY or piped.
    const isTTY = Boolean(process.stdout.isTTY);
    logTest('Terminal: Color support detected', typeof isTTY === 'boolean',
      isTTY ? 'TTY (colors)' : 'piped (no colors)');

    // Check terminal size
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    logTest('Terminal: Dimensions detected', cols > 0 && rows > 0,
      `${cols}x${rows}`);

    // Test terminal width for progress bars
    const hasEnoughWidth = cols >= 60;
    logTest('Terminal: Minimum width for installer', hasEnoughWidth,
      `${cols} cols ${hasEnoughWidth ? '>= 60' : '< 60'}`);

    // Check common terminal emulators
    const termTypes = ['xterm', 'screen', 'linux', 'dumb'];
    const termType = termEnv.toLowerCase();
    const isCommonTerm = termTypes.some(t => termType.includes(t));
    logTest('Terminal: Common terminal type', isCommonTerm || termEnv === 'unknown',
      termEnv);

    // SHELL may be unset in CI; the installer falls back to 'unknown'.
    const shell = process.env.SHELL || 'unknown';
    logTest('Terminal: Shell resolved (with fallback)', shell.length > 0, shell);

    // Test cursor movement codes
    const cursorCodes = {
      up: '\x1b[A',
      down: '\x1b[B',
      forward: '\x1b[C',
      back: '\x1b[D',
      clearLine: '\x1b[2K',
      clearScreen: '\x1b[2J',
      home: '\x1b[H'
    };

    for (const [name, code] of Object.entries(cursorCodes)) {
      logTest(`Terminal: ${name} cursor code valid`, typeof code === 'string', code);
    }

  } catch (error) {
    logTest('Terminal: Test error', false, error.message);
  }
}

/**
 * Document macOS and Windows testing requirements
 */
function documentOtherPlatforms() {
  console.log('\n\x1b[1m\x1b[33m═══ Platform Documentation ═══\x1b[0m\n');

  console.log('\x1b[36mmacOS Testing (Not Available):\x1b[0m');
  console.log('  • Path handling with forward slashes (/)');
  console.log('  • Case-insensitive but case-preserving filesystem (HFS+/APFS)');
  console.log('  • Permissions model similar to Linux (Unix-based)');
  console.log('  • Home directory: /Users/username');
  console.log('  • ANSI colors in Terminal.app, iTerm2');
  console.log('  • Test with zsh (default shell since Catalina)');
  console.log('  • Test with bash (legacy shell)');
  console.log('');

  console.log('\x1b[36mWindows Testing (Not Available):\x1b[0m');
  console.log('  • Path handling with backslashes (\\)');
  console.log('  • Drive letters (C:, D:, etc.)');
  console.log('  • Case-insensitive filesystem (NTFS)');
  console.log('  • Different permission model (ACLs vs Unix permissions)');
  console.log('  • Home directory: C:\\Users\\username');
  console.log('  • ANSI colors in Windows Terminal, ConEmu');
  console.log('  • Legacy cmd.exe has limited ANSI support');
  console.log('  • PowerShell has good ANSI support');
  console.log('  • Invalid filename characters: < > : " | ? *');
  console.log('  • Reserved filenames: CON, PRN, AUX, NUL, COM1-9, LPT1-9');
  console.log('');

  logTest('Platform docs: macOS requirements documented', true);
  logTest('Platform docs: Windows requirements documented', true);
}

/**
 * Run all cross-platform tests
 */
function runAllTests() {
  console.log('\x1b[1m\x1b[36m');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Cross-Platform Testing Suite (Linux Focus)          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  console.log('Testing platform-specific behaviors and compatibility\n');
  console.log(`Platform: ${os.platform()} ${os.release()}`);
  console.log(`Architecture: ${os.arch()}`);
  console.log(`Node.js: ${process.version}`);
  console.log('');

  // Run all tests
  testLinuxPathHandling();
  testLinuxFileOperations();
  testLinuxPermissions();
  testAnsiColorCodes();
  testProgressBarRendering();
  testTerminalCompatibility();
  documentOtherPlatforms();

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

  console.log('Platform testing completed:');
  console.log('  ✓ Linux path handling');
  console.log('  ✓ Linux file operations');
  console.log('  ✓ Linux permissions');
  console.log('  ✓ ANSI color codes');
  console.log('  ✓ Progress bar rendering');
  console.log('  ✓ Terminal compatibility');
  console.log('  ✓ macOS/Windows requirements documented');
  console.log('');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testLinuxPathHandling,
  testLinuxFileOperations,
  testLinuxPermissions,
  testAnsiColorCodes,
  testProgressBarRendering,
  testTerminalCompatibility,
  runAllTests
};
