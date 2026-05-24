#!/usr/bin/env node

/**
 * Package Validation Script for Agentic Kit v1.2.0+
 *
 * Validates the multi-tool installer structure with:
 * - Multiple tool packages (claude, opencode, ampcode, droid)
 * - Variant configurations (variants.json)
 * - Installer system components
 * - Documentation
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

let errorCount = 0;
let warningCount = 0;

function error(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
  errorCount++;
}

function warn(message) {
  console.warn(`${colors.yellow}⚠ WARNING:${colors.reset} ${message}`);
  warningCount++;
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function info(message) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function validateJsonFile(filePath, label) {
  if (!fileExists(filePath)) {
    error(`${label} not found: ${filePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    success(`${label} is valid`);
    return parsed;
  } catch (err) {
    error(`${label} has invalid JSON: ${err.message}`);
    return null;
  }
}

function validatePackageJson() {
  info('\nValidating package.json...');

  const pkg = validateJsonFile('./package.json', 'package.json');
  if (!pkg) {
    return null;
  }

  // Check required fields
  const requiredFields = ['name', 'version', 'description'];
  requiredFields.forEach(field => {
    if (!pkg[field]) {
      error(`Missing required field '${field}' in package.json`);
    } else {
      success(`package.json has '${field}' field`);
    }
  });

  // Check version format
  if (pkg.version && !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    warn(`Version format should be semver (x.y.z): ${pkg.version}`);
  }

  // Validate files field includes critical paths
  if (pkg.files) {
    const criticalPaths = ['packages/', 'installer/', 'README.md'];
    const missing = criticalPaths.filter(p => !pkg.files.some(f => f.includes(p) || p.includes(f)));
    if (missing.length > 0) {
      warn(`package.json files field may be missing: ${missing.join(', ')}`);
    } else {
      success('package.json files field includes critical paths');
    }
  }

  // Check for repository URL
  if (pkg.repository && pkg.repository.url) {
    success('repository URL is configured');
  } else {
    warn('Missing repository URL in package.json');
  }

  // Check for author
  if (pkg.author) {
    success('author field is configured');
  } else {
    warn('Missing author in package.json');
  }

  return pkg;
}

function validateRequiredFiles() {
  info('\nValidating required files...');

  const requiredFiles = [
    { path: './README.md', label: 'README' },
    { path: './CHANGELOG.md', label: 'CHANGELOG' },
    { path: './package.json', label: 'package.json' }
  ];

  requiredFiles.forEach(({ path: filePath, label }) => {
    if (!fileExists(filePath)) {
      error(`${label} not found: ${filePath}`);
    } else {
      success(`${label} exists`);
    }
  });
}

function validateInstallerSystem() {
  info('\nValidating installer system...');

  const installerFiles = [
    'installer/cli.js',
    'installer/package-manager.js',
    'installer/installation-engine.js',
    'installer/path-manager.js',
    'installer/verification-system.js',
    'installer/report-template.js'
  ];

  installerFiles.forEach(file => {
    if (!fileExists(file)) {
      error(`Installer component missing: ${file}`);
    } else {
      success(`${path.basename(file)} exists`);
    }
  });

  // Check if cli.js has shebang
  if (fileExists('installer/cli.js')) {
    const content = fs.readFileSync('installer/cli.js', 'utf8');
    if (content.startsWith('#!/usr/bin/env node')) {
      success('installer/cli.js has correct shebang');
    } else {
      error('installer/cli.js missing shebang');
    }
  }
}

function validateToolPackages() {
  info('\nValidating tool packages...');

  // Define tool-specific directory mappings
  const toolConfigs = {
    claude: {
      agents: 'agents',
      skills: 'skills'
    },
    opencode: {
      agents: 'agent',
      skills: 'command'
    },
    ampcode: {
      agents: 'agents',
      skills: 'commands'
    },
    droid: {
      agents: 'droids',
      skills: 'commands'
    }
  };

  const tools = Object.keys(toolConfigs);
  const packagesDir = './packages';

  if (!fileExists(packagesDir)) {
    error('packages/ directory not found');
    return;
  }

  tools.forEach(tool => {
    const toolDir = path.join(packagesDir, tool);
    const config = toolConfigs[tool];

    if (!fileExists(toolDir)) {
      error(`Tool package missing: ${tool}`);
      return;
    }

    // Check for variants.json
    const variantsPath = path.join(toolDir, 'variants.json');
    const variants = validateJsonFile(variantsPath, `${tool} variants.json`);

    if (variants) {
      // Validate variant structure
      const requiredVariants = ['pro'];
      requiredVariants.forEach(variant => {
        if (!variants[variant]) {
          error(`${tool}: Missing '${variant}' variant configuration`);
        } else {
          // Validate variant has required fields
          const v = variants[variant];
          const requiredFields = ['name', 'description', 'agents'];

          // Check for skills or commands field (tools have different field names)
          // Claude uses 'skills' + 'commands', others use just 'commands'
          const hasSkillsOrCommands = v.skills !== undefined || v.commands !== undefined;
          if (!hasSkillsOrCommands) {
            error(`${tool}/${variant}: Missing 'skills' or 'commands' field`);
          }

          requiredFields.forEach(field => {
            if (v[field] === undefined) {
              error(`${tool}/${variant}: Missing field '${field}'`);
            }
          });
        }
      });

      if (requiredVariants.every(v => variants[v])) {
        success(`${tool} has all required variants`);
      }
    }

    // Check for core directories using tool-specific mapping
    const coreDirs = [
      { key: 'agents', dir: config.agents },
      { key: 'skills', dir: config.skills }
    ];

    coreDirs.forEach(({ key, dir }) => {
      const dirPath = path.join(toolDir, dir);
      if (!fileExists(dirPath)) {
        error(`${tool}: Missing ${dir}/ directory`);
      } else {
        success(`${tool}: ${dir}/ directory exists`);
      }
    });
  });

  success(`Validated ${tools.length} tool packages`);
}

function validateDocumentation() {
  info('\nValidating documentation...');

  const docs = [
    'docs/INSTALLER_GUIDE.md',
    'docs/PRIVACY.md',
    'docs/SECURITY.md',
    'docs/MIGRATION.md'
  ];

  docs.forEach(doc => {
    if (!fileExists(doc)) {
      warn(`Documentation missing: ${doc}`);
    } else {
      success(`${path.basename(doc)} exists`);
    }
  });
}

function validateTests() {
  info('\nValidating tests...');

  const testDirs = [
    'tests/installer',
    'tests/validation-test.js'
  ];

  let testCount = 0;
  testDirs.forEach(testPath => {
    if (fileExists(testPath)) {
      success(`Tests exist: ${testPath}`);
      testCount++;
    }
  });

  if (testCount === 0) {
    warn('No test files found');
  }
}

function main() {
  console.log(`\n${colors.bright}${colors.cyan}=== Agentic Kit Package Validation ===${colors.reset}\n`);
  console.log(`${colors.cyan}Multi-Tool Installer Structure (v1.2.0+)${colors.reset}\n`);

  // Run all validations
  const pkg = validatePackageJson();
  validateRequiredFiles();
  validateInstallerSystem();
  validateToolPackages();
  validateDocumentation();
  validateTests();

  // Print summary
  console.log(`\n${colors.bright}${colors.cyan}=== Validation Summary ===${colors.reset}\n`);

  if (pkg) {
    console.log(`${colors.cyan}Package:${colors.reset} ${pkg.name}@${pkg.version}`);
  }

  if (errorCount === 0 && warningCount === 0) {
    console.log(`${colors.green}${colors.bright}✓ All validations passed!${colors.reset}`);
    console.log(`${colors.green}Package is ready for publication.${colors.reset}\n`);
    process.exit(0);
  } else {
    if (errorCount > 0) {
      console.log(`${colors.red}${colors.bright}✗ ${errorCount} error(s) found${colors.reset}`);
    }
    if (warningCount > 0) {
      console.log(`${colors.yellow}⚠ ${warningCount} warning(s) found${colors.reset}`);
    }

    if (errorCount > 0) {
      console.log(`\n${colors.red}${colors.bright}Package validation failed. Please fix errors before publishing.${colors.reset}\n`);
      process.exit(1);
    } else {
      console.log(`\n${colors.yellow}Package has warnings but can be published. Consider addressing warnings.${colors.reset}\n`);
      process.exit(0);
    }
  }
}

// Run validation
main();
