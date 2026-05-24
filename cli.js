#!/usr/bin/env node

/**
 * `liteag` — short alias for the `liteagents` installer.
 *
 * Forwards all arguments to the interactive installer (installer/cli.js),
 * which checks for existing installs, backs up, installs to each tool's
 * path, and uninstalls. This wrapper adds no behavior of its own.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const installer = path.join(__dirname, 'installer', 'cli.js');
const result = spawnSync(process.execPath, [installer, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

// Mirror the installer's exit code; treat signal termination as failure.
process.exit(result.status === null ? 1 : result.status);
