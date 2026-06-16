#!/usr/bin/env node

/**
 * Interactive CLI Installer for Agentic Kit
 * 
 * Provides 4-step installation process:
 * 1. Package variant selection (Lite/Standard/Pro)
 * 2. Tool selection (Claude/Opencode/Ampcode/Droid)
 * 3. Path configuration with confirmation
 * 4. Installation summary and execution
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Single source of truth for version; UPDATE_VERSION.sh bumps only package.json.
const PACKAGE_VERSION = require('../package.json').version;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  red: '\x1b[31m'
};

class InteractiveInstaller {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.selections = {
      tools: [],
      paths: {}
    };

    // Initialize PackageManager for accessing package information
    const PackageManager = require('./package-manager');
    this.packageManager = new PackageManager();

    this.tools = [
      {
        id: 'claude',
        name: 'Claude Code',
        path: '~/.claude',
        description: 'AI-powered development assistant'
      },
      {
        id: 'opencode',
        name: 'Opencode',
        path: '~/.config/opencode',
        description: 'CLI-optimized AI codegen tool'
      },
      {
        id: 'ampcode',
        name: 'Ampcode',
        path: '~/.config/amp',
        description: 'Amplified AI development accelerator'
      },
      {
        id: 'droid',
        name: 'Droid',
        path: '~/.factory',
        description: 'Android-focused AI development companion'
      }
    ];
  }

  async askInstallOrUninstall() {
    console.log('\nWhat would you like to do?\n');
    console.log('  1. Install tools');
    console.log('  2. Uninstall tools');
    console.log('  3. Exit\n');

    const choice = await this.askQuestion('Enter choice (1-3): ', '1');
    if (choice === '3') {
      console.log('\nGoodbye!\n');
      process.exit(0);
    }
    return choice === '2' ? 'uninstall' : 'install';
  }


  async run() {
    try {
      this.showWelcome();

      const action = await this.askInstallOrUninstall();

      if (action === 'uninstall') {
        await this.runUninstall();
      } else {
        await this.selectTools();
        this.setDefaultPaths();
        await this.install();
      }
    } catch (error) {
      await this.handleFatalError(error);
    } finally {
      this.rl.close();
    }
  }

  async runUninstall() {
    console.log('\nDetecting installed tools...\n');

    const os = require('os');

    // Detect installed tools by checking if paths exist
    const installedTools = [];
    for (const tool of this.tools) {
      const targetPath = tool.path.startsWith('~')
        ? path.join(os.homedir(), tool.path.slice(1))
        : path.resolve(tool.path);

      if (fs.existsSync(targetPath)) {
        // Check for backups
        const backups = this.findBackups(targetPath);
        installedTools.push({
          ...tool,
          expandedPath: targetPath,
          hasBackup: backups.length > 0,
          latestBackup: backups.sort().reverse()[0]
        });
      }
    }

    if (installedTools.length === 0) {
      console.log('No tools are currently installed.\n');
      return;
    }

    // Show installed tools
    console.log('Installed tools:\n');
    installedTools.forEach((tool, index) => {
      const backupStatus = tool.hasBackup ? '(has backup)' : '(no backup)';
      console.log(`  ${index + 1}. ${tool.name} - ${tool.path} ${backupStatus}`);
    });

    // Select tools to uninstall
    console.log('\nSelect tools to uninstall:');
    const selectedIndices = await this.selectToolsCheckbox(installedTools);

    if (selectedIndices.length === 0) {
      console.log('No tools selected. Cancelled.\n');
      return;
    }

    // Uninstall each selected tool
    for (const index of selectedIndices) {
      const tool = installedTools[index];
      console.log(`\nUninstalling ${tool.name}...`);

      try {
        if (tool.hasBackup) {
          // Backup current, then restore from previous backup
          const currentBackup = `${tool.expandedPath}.uninstall-backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
          fs.renameSync(tool.expandedPath, currentBackup);
          console.log(`Current installation backed up: ${tool.path}.uninstall-backup.${new Date().toISOString().replace(/[:.]/g, '-')}`);

          // Restore from latest backup
          fs.renameSync(tool.latestBackup, tool.expandedPath);
          console.log(`✓ Restored previous installation from: ${path.basename(tool.latestBackup)}`);
        } else {
          // No backup, just delete
          const rimraf = (dir) => {
            if (fs.existsSync(dir)) {
              fs.readdirSync(dir).forEach((file) => {
                const curPath = path.join(dir, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                  rimraf(curPath);
                } else {
                  fs.unlinkSync(curPath);
                }
              });
              fs.rmdirSync(dir);
            }
          };
          rimraf(tool.expandedPath);
          console.log(`✓ Deleted installation from: ${tool.path}`);
        }
      } catch (error) {
        console.log(`✗ Failed to uninstall ${tool.name}: ${error.message}`);
      }
    }

    console.log('\nDone!');
  }

  findBackups(targetPath) {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const pattern = `${base}.backup.`;

    try {
      return fs.readdirSync(dir)
        .filter(f => f.startsWith(pattern))
        .map(f => path.join(dir, f));
    } catch (error) {
      return [];
    }
  }

  async selectToolsCheckbox(tools) {
    const selected = new Set();
    let currentIndex = 0;

    const renderList = () => {
      // Move cursor up and clear each line individually
      for (let i = 0; i <= tools.length; i++) {
        process.stdout.write('\x1b[1A'); // Move up one line
        process.stdout.write('\r'); // Carriage return to start of line
        process.stdout.write('\x1b[2K'); // Clear entire line
      }

      tools.forEach((tool, index) => {
        const isSelected = selected.has(index);
        const isCurrent = index === currentIndex;
        const checkbox = isSelected ? '[x]' : '[ ]';
        const pointer = isCurrent ? '»' : ' ';
        const paddedName = tool.name.padEnd(20);

        console.log(`${pointer} ${checkbox} ${paddedName} - ${tool.description || ''}`);
      });
      console.log(''); // Empty line at bottom
    };

    // Initial render
    tools.forEach((tool, index) => {
      const isSelected = selected.has(index);
      const isCurrent = index === currentIndex;
      const checkbox = isSelected ? '[x]' : '[ ]';
      const pointer = isCurrent ? '»' : ' ';
      const paddedName = tool.name.padEnd(20);

      console.log(`${pointer} ${checkbox} ${paddedName} - ${tool.description || ''}`);
    });
    console.log('');

    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onKeypress = (key) => {
        if (key === '\u0003' || key === '\u001b') { // Ctrl+C or ESC
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(0);
        } else if (key === '\r' || key === '\n') { // Enter
          stdin.setRawMode(false);
          stdin.removeListener('data', onKeypress);
          resolve(Array.from(selected));
        } else if (key === ' ') { // Space - toggle
          if (selected.has(currentIndex)) {
            selected.delete(currentIndex);
          } else {
            selected.add(currentIndex);
          }
          renderList();
        } else if (key === '\u001b[A') { // Up arrow
          currentIndex = currentIndex > 0 ? currentIndex - 1 : tools.length - 1;
          renderList();
        } else if (key === '\u001b[B') { // Down arrow
          currentIndex = currentIndex < tools.length - 1 ? currentIndex + 1 : 0;
          renderList();
        }
      };

      stdin.on('data', onKeypress);
    });
  }

  /**
   * Run upgrade/downgrade command for a specific tool
   * Changes the variant of an installed tool
   *
   * @param {string} toolId - Tool to upgrade (claude, opencode, ampcode, droid)
   * @param {string} newVariant - Target variant (lite, standard, pro)
   */
  /**
   * Load configuration from JSON file
   * Used with --config flag
   *
   * @param {string} configPath - Path to configuration file
   */
  /**
   * Run non-interactive installation
   * Uses command-line arguments instead of prompts
   */
  /**
   * Handle fatal errors with detailed error messages and actionable advice
   * Categorizes errors and provides specific guidance for each type
   *
   * @param {Error} error - The error that occurred
   */
  async handleFatalError(error) {
    console.log(''); // Add spacing

    // Categorize the error and provide appropriate guidance
    const errorInfo = this.categorizeError(error);

    console.log(`${colors.red}Error: ${error.message}${colors.reset}`);

    if (errorInfo.advice.length > 0 && errorInfo.advice.length <= 3) {
      errorInfo.advice.forEach(advice => {
        console.log(`  - ${advice}`);
      });
      console.log('');
    }

    // Exit with error code
    process.exit(1);
  }

  /**
   * Categorize errors and provide actionable advice
   *
   * @param {Error} error - The error to categorize
   * @returns {object} Object with type, advice array, and technical details
   */
  categorizeError(error) {
    const message = error.message.toLowerCase();
    const code = error.code;

    // Permission errors
    if (code === 'EACCES' || code === 'EPERM' || message.includes('permission denied')) {
      return {
        type: 'Permission Error',
        advice: [
          'Try: sudo node installer/cli.js',
          'Or choose a different installation directory'
        ],
        technicalDetails: `Error code: ${code || 'EACCES'}`
      };
    }

    // Disk space errors
    if (code === 'ENOSPC' || message.includes('no space') || message.includes('disk space')) {
      return {
        type: 'Disk Space Error',
        advice: [
          'Free up disk space',
          'Check: df -h'
        ],
        technicalDetails: 'Installation requires approximately 10MB per tool'
      };
    }

    // Network errors (if applicable)
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || message.includes('network') || message.includes('connection')) {
      return {
        type: 'Network Error',
        advice: [
          'Check internet connection',
          'Try again later'
        ],
        technicalDetails: `Network error code: ${code || 'UNKNOWN'}`
      };
    }

    // File not found / missing package errors
    if (code === 'ENOENT' || message.includes('no such file') || message.includes('not found') || message.includes('invalid package')) {
      return {
        type: 'Missing Package Error',
        advice: [
          'Run: npm install -g liteagents',
          'Check: packages directory exists'
        ],
        technicalDetails: `Missing file or package validation failed`
      };
    }

    // Path validation errors (check before invalid input errors)
    if (message.includes('path') && (message.includes('invalid') || message.includes('absolute') || message.includes('must be absolute'))) {
      return {
        type: 'Path Validation Error',
        advice: [
          'Path must be absolute (starts with / or ~)',
          'Check parent directory exists'
        ],
        technicalDetails: 'Paths must be absolute and writable'
      };
    }

    // Invalid input errors
    if (message.includes('invalid') || message.includes('must be') || message.includes('required')) {
      return {
        type: 'Invalid Input Error',
        advice: [
          'Check your selections',
          'Restart installer and try again'
        ],
        technicalDetails: error.message
      };
    }

    // Installation failures (general)
    if (message.includes('install') || message.includes('copy') || message.includes('failed')) {
      return {
        type: 'Installation Error',
        advice: [
          'Check disk space: df -h',
          'Verify write permissions',
          'Try different location'
        ],
        technicalDetails: 'Installation process encountered an error during file operations'
      };
    }

    // Generic error
    return {
      type: 'Unknown Error',
      advice: [
        'Try running installer again',
        'Report at: https://github.com/amrhas82/liteagents/issues'
      ],
      technicalDetails: error.stack ? error.stack.split('\n')[1] : 'No additional details'
    };
  }

  /**
   * Offer recovery options when an installation fails
   * Allows user to continue with remaining tools or cancel
   *
   * @param {string} failedTool - Name of the tool that failed
   * @param {number} currentIndex - Current tool index (1-based)
   * @param {number} totalTools - Total number of tools
   * @returns {Promise<boolean>} True to continue, false to cancel
   */
  /**
   * Prompt user to resume interrupted installation
   * Shows summary of previous installation progress
   *
   * @param {InstallationEngine} installationEngine - Installation engine instance
   * @returns {Promise<boolean>} - True if user wants to resume, false otherwise
   */
  /**
   * Resume interrupted installation
   * Uses saved state to continue from where it left off
   *
   * @param {InstallationEngine} installationEngine - Installation engine instance with loaded state
   */
  showWelcome() {
    console.clear();
    console.log(`
${colors.bright}${colors.cyan} █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗ ██████╗    ██╗  ██╗██╗████████╗${colors.reset}
${colors.bright}${colors.cyan}██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██╔════╝    ██║ ██╔╝██║╚══██╔══╝${colors.reset}
${colors.bright}${colors.cyan}███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║         █████╔╝ ██║   ██║${colors.reset}
${colors.bright}${colors.cyan}██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║         ██╔═██╗ ██║   ██║${colors.reset}
${colors.bright}${colors.cyan}██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║╚██████╗    ██║  ██╗██║   ██║${colors.reset}
${colors.bright}${colors.cyan}╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚═════╝    ╚═╝  ╚═╝╚═╝   ╚═╝${colors.reset}

${colors.bright}v${PACKAGE_VERSION} | 11 agents + 18 commands per tool${colors.reset}
    `);
  }

  async selectTools() {
    console.log(`\n${colors.bright}Select tools to install${colors.reset}\n`);
    console.log(`${colors.cyan}(↑↓ navigate, space=toggle, a=all, enter=confirm)${colors.reset}\n`);

    // Interactive checkbox selection
    const selected = new Set(['claude']); // Default to claude
    let currentIndex = 0;

    const renderList = () => {
      // Move cursor up and clear each line individually
      for (let i = 0; i <= this.tools.length; i++) {
        process.stdout.write('\x1b[1A'); // Move up one line
        process.stdout.write('\r'); // Carriage return to start of line
        process.stdout.write('\x1b[2K'); // Clear entire line
      }

      this.tools.forEach((tool, index) => {
        const isSelected = selected.has(tool.id);
        const isCurrent = index === currentIndex;
        const checkbox = isSelected ? '[x]' : '[ ]';
        const pointer = isCurrent ? '»' : ' ';
        const paddedName = tool.name.padEnd(20);

        console.log(`${pointer} ${checkbox} ${paddedName} - ${tool.description}`);
      });
      console.log(''); // Empty line at bottom
    };

    // Initial render
    this.tools.forEach((tool, index) => {
      const isSelected = selected.has(tool.id);
      const isCurrent = index === currentIndex;
      const checkbox = isSelected ? '[x]' : '[ ]';
      const pointer = isCurrent ? '»' : ' ';
      const paddedName = tool.name.padEnd(20);

      console.log(`${pointer} ${checkbox} ${paddedName} - ${tool.description}`);
    });
    console.log('');

    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onKeypress = (key) => {
        if (key === '\u0003' || key === '\u001b') { // Ctrl+C or ESC
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(0);
        } else if (key === '\r' || key === '\n') { // Enter
          stdin.setRawMode(false);
          stdin.removeListener('data', onKeypress);

          this.selections.tools = Array.from(selected);

          // Show selection summary
          console.log(`${colors.green}Installing ${this.selections.tools.length} tool(s)${colors.reset}\n`);

          resolve();
        } else if (key === ' ') { // Space - toggle
          const toolId = this.tools[currentIndex].id;
          if (selected.has(toolId)) {
            selected.delete(toolId);
          } else {
            selected.add(toolId);
          }
          renderList();
        } else if (key === 'a' || key === 'A') { // Select all
          this.tools.forEach(tool => selected.add(tool.id));
          renderList();
        } else if (key === '\u001b[A') { // Up arrow
          currentIndex = currentIndex > 0 ? currentIndex - 1 : this.tools.length - 1;
          renderList();
        } else if (key === '\u001b[B') { // Down arrow
          currentIndex = currentIndex < this.tools.length - 1 ? currentIndex + 1 : 0;
          renderList();
        }
      };

      stdin.on('data', onKeypress);
    });
  }

  async setDefaultPaths() {
    // Automatically use default paths for all selected tools
    for (const toolId of this.selections.tools) {
      const tool = this.tools.find(t => t.id === toolId);
      this.selections.paths[toolId] = tool.path;
    }
  }
  
  /**
   * Format bytes to human-readable size (helper method for summary display)
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size string (e.g., "8.39 MB")
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get PackageManager instance (for testing and internal use)
   * @returns {PackageManager} Package manager instance
   */
  getPackageManager() {
    return this.packageManager;
  }

  /**
   * Perform pre-installation checks to catch potential issues early
   * Validates packages, paths, permissions, and disk space
   *
   * @returns {Promise<object>} Object with success flag, errors array, and warnings array
   */
  async install() {
    // Initialize InstallationEngine
    const PathManager = require('./path-manager');
    const InstallationEngine = require('./installation-engine');
    const os = require('os');

    const pathManager = new PathManager();
    const installationEngine = new InstallationEngine(pathManager, this.packageManager);

    // Install each selected tool
    for (let i = 0; i < this.selections.tools.length; i++) {
      const toolId = this.selections.tools[i];
      const tool = this.tools.find(t => t.id === toolId);
      const targetPath = this.selections.paths[toolId];

      console.log(`\n${colors.bright}${colors.cyan}Installing ${tool.name}...${colors.reset}`);

      try {
        const expandedPath = targetPath.startsWith('~')
          ? path.join(os.homedir(), targetPath.slice(1))
          : path.resolve(targetPath);

        // Start spinner
        const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let spinnerIndex = 0;
        const spinner = setInterval(() => {
          process.stdout.write(`\r  ${colors.cyan}${spinnerFrames[spinnerIndex]}${colors.reset} Installing...`);
          spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        }, 80);

        // Install
        await installationEngine.installPackage(
          toolId,
          'pro', // Always pro variant
          targetPath,
          null // No progress callback
        );

        // Stop spinner
        clearInterval(spinner);
        process.stdout.write('\r\x1b[2K'); // Clear spinner line

        // Get backup info from installation engine
        const lastBackup = installationEngine.backupLog.length > 0
          ? installationEngine.backupLog[installationEngine.backupLog.length - 1]
          : null;

        // Count actual installed components by checking directories
        const countItems = (dir) => {
          try {
            if (fs.existsSync(dir)) {
              return fs.readdirSync(dir).filter(f => !f.startsWith('.')).length;
            }
          } catch (e) {}
          return 0;
        };

        // Count only .md files in a directory
        const countMdFiles = (dir) => {
          try {
            if (fs.existsSync(dir)) {
              return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length;
            }
          } catch (e) {}
          return 0;
        };

        // Check for agents (agents, agent, or droids)
        let agentsCount = countItems(path.join(expandedPath, 'agents')) ||
                         countItems(path.join(expandedPath, 'agent')) ||
                         countItems(path.join(expandedPath, 'droids'));
        let agentDir = 'agents';
        if (fs.existsSync(path.join(expandedPath, 'agents'))) {
          agentDir = 'agents';
        } else if (fs.existsSync(path.join(expandedPath, 'agent'))) {
          agentDir = 'agent';
        } else if (fs.existsSync(path.join(expandedPath, 'droids'))) {
          agentDir = 'droids';
        }

        // Check for skills (count directories)
        const skillsCount = countItems(path.join(expandedPath, 'skills'));

        // Check for commands (count only .md files, both singular and plural)
        const commandsCount = countMdFiles(path.join(expandedPath, 'commands')) ||
                             countMdFiles(path.join(expandedPath, 'command'));
        const cmdDir = fs.existsSync(path.join(expandedPath, 'commands')) ? 'commands' : 'command';

        // Show backup info if it was created
        if (lastBackup && lastBackup.original === expandedPath) {
          const backupShortPath = lastBackup.backup.replace(os.homedir(), '~');
          console.log(`  ${colors.yellow}Backup:${colors.reset} ${backupShortPath}`);
        }

        // Show components with color
        if (agentsCount > 0) {
          console.log(`  ${colors.green}✓${colors.reset} ${agentsCount} agents   → ${targetPath}/${agentDir}`);
        }
        if (skillsCount > 0) {
          console.log(`  ${colors.green}✓${colors.reset} ${skillsCount} skills   → ${targetPath}/skills`);
        }
        if (commandsCount > 0) {
          console.log(`  ${colors.green}✓${colors.reset} ${commandsCount} commands → ${targetPath}/${cmdDir}`);
        }

      } catch (error) {
        // On ANY error, show it and exit immediately
        throw error; // Will be caught by run() and handled by handleFatalError()
      }
    }

    console.log(`\n${colors.bright}${colors.green}Done!${colors.reset}`);
  }

  /**
   * Draw progress bar for current tool installation
   * Updates in place without scrolling using ANSI escape codes
   */
  drawProgressBar(filesCompleted, totalFiles, percentage, currentFile) {
    const barWidth = 40;
    const filledWidth = Math.round((percentage / 100) * barWidth);
    const bar = '#'.repeat(filledWidth) + '-'.repeat(barWidth - filledWidth);

    // Single line, update in place
    process.stdout.write(`\r[${bar}] ${percentage}% (${filesCompleted}/${totalFiles} files)`);
  }

  
  askQuestion(prompt, defaultValue = '') {
    return new Promise(resolve => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  /**
   * Display verification report for a single tool
   * Shows verification status, component counts, and any issues/warnings
   *
   * @param {object} verification - Verification result from InstallationEngine
   * @param {string} toolName - Display name of the tool
   */
  /**
   * Generate and save installation report to ~/.liteagents-install.log
   * Creates a detailed log of the installation session
   *
   * @param {array} successfulInstalls - Array of successful installation objects
   * @param {array} failedInstalls - Array of failed installation objects
   * @param {array} verificationResults - Array of verification result objects
   * @param {number} totalElapsedMs - Total elapsed time in milliseconds
   */
  /**
   * Prompt user for telemetry consent
   * Only prompts if consent hasn't been set before and --no-telemetry flag not present
   *
   * @returns {Promise<void>}
   */
  /**
   * Collect and send telemetry data for installation
   *
   * @param {boolean} success - Installation success status
   * @param {number} toolCount - Number of tools installed
   * @param {number} errorCount - Number of errors encountered
   * @param {number} warningCount - Number of warnings encountered
   * @param {number} installationTime - Installation time in milliseconds
   * @returns {Promise<void>}
   */
}

// Run installer if called directly
if (require.main === module) {
  const installer = new InteractiveInstaller();
  installer.run().catch(console.error);
}

module.exports = InteractiveInstaller;