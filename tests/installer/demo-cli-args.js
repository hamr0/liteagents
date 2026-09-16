/**
 * Demo: CLI Command-Line Arguments
 *
 * Demonstrates the new command-line argument parsing features
 */

const colors = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bright: '\x1b[1m',
  reset: '\x1b[0m'
};

console.log(`
${colors.bright}${colors.cyan}CLI Command-Line Arguments Demo${colors.reset}
${colors.cyan}${'='.repeat(60)}${colors.reset}

${colors.bright}New Features in Subtask 5.3:${colors.reset}

${colors.cyan}1. Command-Line Argument Parsing${colors.reset}
   The CLI now supports various flags for non-interactive operation:

   ${colors.green}--help, -h${colors.reset}
   Display usage information and exit
   Example: node installer/cli.js --help

   ${colors.green}--uninstall <tool>${colors.reset}
   Uninstall a specific tool
   Example: node installer/cli.js --uninstall claude

   ${colors.green}--variant <lite|standard|pro>${colors.reset}
   Select package variant for non-interactive installation
   Example: node installer/cli.js --variant standard --tools claude

   ${colors.green}--tools <tool1,tool2,...>${colors.reset}
   Select tools (comma-separated) for non-interactive installation
   Example: node installer/cli.js --tools claude,opencode

   ${colors.green}--path <tool>=<path>${colors.reset}
   Specify custom installation path
   Example: node installer/cli.js --path claude=/custom/path

   ${colors.green}--silent, --non-interactive${colors.reset}
   Run in silent mode (no prompts, use defaults)
   Example: node installer/cli.js --variant lite --tools claude --silent

   ${colors.green}--config <file>${colors.reset}
   Load configuration from JSON file
   Example: node installer/cli.js --config install-config.json

${colors.cyan}2. Uninstall Command Flow${colors.reset}
   ${colors.bright}Features:${colors.reset}
   • Detects installation at default path
   • Prompts for custom path if not found at default location
   • Displays file count and confirmation prompt
   • Creates backup before uninstalling (with timestamp)
   • Shows real-time progress during uninstall
   • Displays detailed results (files/directories removed, backup path)
   • Preserves user-created files not in manifest
   • Lists any warnings or errors encountered

   ${colors.bright}Example workflow:${colors.reset}
   $ node installer/cli.js --uninstall claude

   ${colors.cyan}liteagents Uninstaller${colors.reset}

   ${colors.bright}Tool:${colors.reset} Claude Code
   ${colors.bright}Path:${colors.reset} /home/user/.claude

   ${colors.yellow}This will remove 255 file(s) and create a backup.${colors.reset}

   ${colors.bright}Proceed with uninstallation? (y/N):${colors.reset} y

   ${colors.bright}Uninstalling Claude Code...${colors.reset}

   ${colors.cyan}Progress:${colors.reset} 100% (255/255 files removed)

   ${colors.green}✓ Claude Code uninstalled successfully${colors.reset}
   ${colors.cyan}Files removed:${colors.reset} 255
   ${colors.cyan}Directories removed:${colors.reset} 4
   ${colors.cyan}Backup created:${colors.reset} /home/user/.claude.uninstall-backup.1730649123456

${colors.cyan}3. Non-Interactive Mode${colors.reset}
   ${colors.bright}Features:${colors.reset}
   • Accepts variant and tools from command-line
   • Validates inputs before installation
   • Displays installation summary
   • Runs installation without prompts
   • Supports custom paths via --path flag
   • Perfect for CI/CD and automated deployments

   ${colors.bright}Example workflow:${colors.reset}
   $ node installer/cli.js --variant standard --tools claude,opencode

   ${colors.cyan}liteagents Installer (Non-Interactive Mode)${colors.reset}

   ${colors.bright}Installation Summary:${colors.reset}
   ${colors.cyan}Variant:${colors.reset} Standard (13 agents, 8 skills)
   ${colors.cyan}Tools:${colors.reset} claude, opencode

   ${colors.bright}Claude Code${colors.reset}
     Path: ~/.claude

   ${colors.bright}Opencode${colors.reset}
     Path: ~/.config/opencode

   ${colors.bright}Installing standard package...${colors.reset}

   ${colors.cyan}Performing pre-installation checks...${colors.reset}
   ${colors.green}✓ Pre-installation checks passed${colors.reset}

   [Installation proceeds automatically...]

${colors.cyan}4. Configuration File Support${colors.reset}
   ${colors.bright}Format:${colors.reset} JSON file with installation settings

   ${colors.bright}Example config.json:${colors.reset}
   {
     "variant": "standard",
     "tools": ["claude", "opencode"],
     "paths": {
       "claude": "~/.claude-custom",
       "opencode": "~/.config/opencode-custom"
     },
     "silent": false
   }

   ${colors.bright}Usage:${colors.reset}
   $ node installer/cli.js --config config.json

   ${colors.green}✓ Configuration loaded from config.json${colors.reset}

   [Installation proceeds with config settings...]

${colors.cyan}5. Silent Mode for CI/CD${colors.reset}
   ${colors.bright}Features:${colors.reset}
   • No prompts or confirmations
   • Uses default or specified values
   • Minimal output (progress and results only)
   • Perfect for automation scripts

   ${colors.bright}Example:${colors.reset}
   $ node installer/cli.js --variant lite --tools claude --silent

   [Installation runs without any prompts]

${colors.cyan}${'='.repeat(60)}${colors.reset}

${colors.bright}Implementation Details:${colors.reset}

${colors.cyan}parseCommandLineArgs()${colors.reset}
• Parses process.argv to extract flags and values
• Returns structured object with all parsed arguments
• Handles both long (--flag) and short (-f) forms
• Supports multiple values (e.g., comma-separated tools)
• Parses key=value pairs for custom paths

${colors.cyan}showHelp()${colors.reset}
• Displays comprehensive usage information
• Shows all available options with examples
• Lists all tools and variants
• Provides common usage scenarios

${colors.cyan}runUninstall()${colors.reset}
• Validates tool ID against available tools
• Detects installation at default path
• Prompts for custom path if needed
• Reads manifest to get file count
• Confirms with user (unless --silent)
• Calls InstallationEngine.uninstall()
• Displays progress and results

${colors.cyan}loadConfig()${colors.reset}
• Reads JSON configuration file
• Validates and merges with command-line args
• Applies settings to installer state
• Handles errors gracefully

${colors.cyan}runNonInteractive()${colors.reset}
• Validates variant and tool selections
• Sets up installation without prompts
• Displays summary before installation
• Calls install() method directly

${colors.cyan}${'='.repeat(60)}${colors.reset}

${colors.bright}Testing:${colors.reset}

All 20 tests passing:
• Parse --help, -h flags
• Parse --uninstall, --variant, --tools, --path flags
• Parse --silent, --non-interactive flags
• Parse --config flag
• Parse multiple flags together
• Parse default state (no arguments)
• Verify method existence (runUninstall, loadConfig, runNonInteractive)
• Configuration file format validation

${colors.cyan}${'='.repeat(60)}${colors.reset}

${colors.bright}Usage Examples:${colors.reset}

${colors.yellow}# Display help${colors.reset}
node installer/cli.js --help

${colors.yellow}# Interactive installation (default)${colors.reset}
node installer/cli.js

${colors.yellow}# Non-interactive installation${colors.reset}
node installer/cli.js --variant standard --tools claude

${colors.yellow}# Install with custom path${colors.reset}
node installer/cli.js --variant pro --tools claude --path claude=~/.claude-custom

${colors.yellow}# Silent installation for CI/CD${colors.reset}
node installer/cli.js --variant lite --tools claude --silent

${colors.yellow}# Uninstall a tool${colors.reset}
node installer/cli.js --uninstall claude

${colors.yellow}# Install from config file${colors.reset}
node installer/cli.js --config install-config.json

${colors.yellow}# Install multiple tools with custom paths${colors.reset}
node installer/cli.js --variant pro --tools claude,opencode,ampcode \\
  --path claude=/custom/claude \\
  --path opencode=/custom/opencode \\
  --path ampcode=/custom/ampcode

${colors.cyan}${'='.repeat(60)}${colors.reset}

${colors.green}Subtask 5.3 Complete!${colors.reset}

Next steps (remaining subtasks):
• 5.4: Add --config file support and --yes flag (partially complete)
• 5.5: Add upgradeVariant() method to InstallationEngine
• 5.6: Create comprehensive integration tests

${colors.cyan}${'='.repeat(60)}${colors.reset}
`);
