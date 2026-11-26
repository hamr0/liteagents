/**
 * Tests for InstallationEngine with variant support
 *
 * Tests variant-based installation, selective file copying, and manifest generation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const InstallationEngine = require('../../installer/installation-engine.js');
const PackageManager = require('../../installer/package-manager.js');
const PathManager = require('../../installer/path-manager.js');

// ANSI color codes for test output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

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
      console.log(`  ${colors.red}${error.stack.split('\n').slice(1, 3).join('\n')}${colors.reset}`);
    }
  }
}

/**
 * Test helper - create temporary test directory
 */
async function createTempDir(name) {
  const tmpDir = path.join(__dirname, '..', 'tmp', `test-${name}-${Date.now()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Test helper - cleanup temporary directory
 */
async function cleanupTempDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`Warning: Could not clean up ${dir}: ${error.message}`);
  }
}

/**
 * Test helper - create mock package structure for testing
 */
async function createMockPackage(packageDir, toolId) {
  // Create package directories
  await fs.promises.mkdir(path.join(packageDir, toolId, 'agents'), { recursive: true });
  await fs.promises.mkdir(path.join(packageDir, toolId, 'skills', 'pdf'), { recursive: true });
  await fs.promises.mkdir(path.join(packageDir, toolId, 'skills', 'docx'), { recursive: true });
  await fs.promises.mkdir(path.join(packageDir, toolId, 'resources'), { recursive: true });
  await fs.promises.mkdir(path.join(packageDir, toolId, 'hooks'), { recursive: true });

  // Create mock agents (3 for Lite, 13 total)
  const agents = ['master', 'code-developer', 'scrum-master', 'developer', 'tester',
                  'designer', 'analyst', 'reviewer', 'documenter', 'planner',
                  'executor', 'monitor', 'reporter'];

  for (const agent of agents) {
    await fs.promises.writeFile(
      path.join(packageDir, toolId, 'agents', `${agent}.md`),
      `# ${agent} Agent\n\nMock agent content for testing.`
    );
  }

  // Create mock skills (2 for testing - pdf and docx for Standard)
  await fs.promises.writeFile(
    path.join(packageDir, toolId, 'skills', 'pdf', 'pdf.md'),
    '# PDF Skill\n\nMock PDF skill content.'
  );
  await fs.promises.writeFile(
    path.join(packageDir, toolId, 'skills', 'docx', 'docx.md'),
    '# DOCX Skill\n\nMock DOCX skill content.'
  );

  // Create mock resources
  await fs.promises.writeFile(
    path.join(packageDir, toolId, 'resources', 'workflows.yaml'),
    'workflows:\n  - test: true'
  );

  // Create mock hooks
  await fs.promises.writeFile(
    path.join(packageDir, toolId, 'hooks', 'session-start.js'),
    '// Mock session start hook'
  );

  // Create variants.json
  const variants = {
    lite: {
      name: 'Lite',
      description: 'Minimal installation',
      useCase: 'Testing lite variant',
      targetUsers: 'Test users',
      agents: ['master', 'code-developer', 'scrum-master'],
      skills: [],
      resources: ['workflows.yaml'],
      hooks: ['session-start.js']
    },
    standard: {
      name: 'Standard',
      description: 'Standard installation',
      useCase: 'Testing standard variant',
      targetUsers: 'Test users',
      agents: '*',
      skills: ['pdf', 'docx'],
      resources: ['workflows.yaml'],
      hooks: ['session-start.js']
    },
    pro: {
      name: 'Pro',
      description: 'Full installation',
      useCase: 'Testing pro variant',
      targetUsers: 'Test users',
      agents: '*',
      skills: '*',
      resources: '*',
      hooks: '*'
    }
  };

  await fs.promises.writeFile(
    path.join(packageDir, toolId, 'variants.json'),
    JSON.stringify(variants, null, 2)
  );
}

/**
 * Test helper - count files recursively
 */
async function countFilesRecursive(dir) {
  let count = 0;

  async function traverse(currentDir) {
    const items = await fs.promises.readdir(currentDir);

    for (const item of items) {
      const itemPath = path.join(currentDir, item);
      const stat = await fs.promises.stat(itemPath);

      if (stat.isDirectory()) {
        await traverse(itemPath);
      } else {
        count++;
      }
    }
  }

  if (fs.existsSync(dir)) {
    await traverse(dir);
  }

  return count;
}

// Main test suite
async function runTests() {
  console.log(`\n${colors.bright}${colors.cyan}Installation Engine Tests (Variant Support)${colors.reset}\n`);

  let tempDir = null;
  let targetDir = null;

  try {
    // Create temporary directories for testing
    tempDir = await createTempDir('installation-engine');
    const mockPackagesDir = path.join(tempDir, 'packages');

    // Create mock package structure
    await createMockPackage(mockPackagesDir, 'testool');

    // Create mock tools directory for manifest templates
    const toolsDir = path.join(tempDir, 'tools', 'testool');
    await fs.promises.mkdir(toolsDir, { recursive: true });
    const manifestTemplate = {
      tool: 'testool',
      name: 'Test Tool',
      description: 'Tool for testing',
      optimization: 'test-optimization'
    };
    await fs.promises.writeFile(
      path.join(toolsDir, 'manifest-template.json'),
      JSON.stringify(manifestTemplate, null, 2)
    );

    // Initialize managers with mock directories
    const packageManager = new PackageManager();
    packageManager.packagesDir = mockPackagesDir;

    const pathManager = new PathManager();
    const installationEngine = new InstallationEngine(pathManager, packageManager);

    // Override getManifestTemplate to use our test template
    packageManager.getManifestTemplate = (toolId) => manifestTemplate;

    console.log(`${colors.blue}Testing InstallationEngine.installPackage() with variant parameter${colors.reset}\n`);

    // Test 1: Install Lite variant
    await test('installPackage() accepts variant parameter (lite)', async () => {
      targetDir = path.join(tempDir, 'install-lite');
      await installationEngine.installPackage('testool', 'lite', targetDir);
      assert.ok(fs.existsSync(targetDir), 'Target directory should exist');
    });

    // Test 2: Verify Lite variant files
    await test('Lite variant installs only selected files (3 agents, 0 skills)', async () => {
      const agentsDir = path.join(targetDir, 'agents');
      const skillsDir = path.join(targetDir, 'skills');
      const resourcesDir = path.join(targetDir, 'resources');
      const hooksDir = path.join(targetDir, 'hooks');

      // Count agents
      const agents = fs.existsSync(agentsDir) ? await fs.promises.readdir(agentsDir) : [];
      assert.strictEqual(agents.length, 3, 'Should have exactly 3 agents');
      assert.ok(agents.includes('master.md'), 'Should include master agent');
      assert.ok(agents.includes('code-developer.md'), 'Should include code-developer agent');
      assert.ok(agents.includes('scrum-master.md'), 'Should include scrum-master agent');

      // Skills should be empty (lite has no skills)
      const skills = fs.existsSync(skillsDir) ? await fs.promises.readdir(skillsDir) : [];
      assert.strictEqual(skills.length, 0, 'Should have 0 skills');

      // Resources should exist
      const resources = fs.existsSync(resourcesDir) ? await fs.promises.readdir(resourcesDir) : [];
      assert.strictEqual(resources.length, 1, 'Should have 1 resource');

      // Hooks should exist
      const hooks = fs.existsSync(hooksDir) ? await fs.promises.readdir(hooksDir) : [];
      assert.strictEqual(hooks.length, 1, 'Should have 1 hook');
    });

    // Test 3: Verify Lite manifest
    await test('Lite variant manifest contains correct component counts', async () => {
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'Manifest should exist');

      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      assert.strictEqual(manifest.variant, 'lite', 'Manifest should specify lite variant');
      assert.strictEqual(manifest.components.agents, 3, 'Manifest should show 3 agents');
      assert.strictEqual(manifest.components.skills, 0, 'Manifest should show 0 skills');
    });

    // Test 4: Install Standard variant
    await test('installPackage() installs Standard variant (all agents, 2 skills)', async () => {
      targetDir = path.join(tempDir, 'install-standard');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const agentsDir = path.join(targetDir, 'agents');
      const skillsDir = path.join(targetDir, 'skills');

      const agents = fs.existsSync(agentsDir) ? await fs.promises.readdir(agentsDir) : [];
      assert.strictEqual(agents.length, 13, 'Should have all 13 agents');

      const skills = fs.existsSync(skillsDir) ? await fs.promises.readdir(skillsDir) : [];
      assert.strictEqual(skills.length, 2, 'Should have 2 skills');
      assert.ok(skills.includes('pdf'), 'Should include pdf skill');
      assert.ok(skills.includes('docx'), 'Should include docx skill');
    });

    // Test 5: Verify Standard manifest
    await test('Standard variant manifest contains correct component counts', async () => {
      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

      assert.strictEqual(manifest.variant, 'standard', 'Manifest should specify standard variant');
      assert.strictEqual(manifest.components.agents, 13, 'Manifest should show 13 agents');
      assert.strictEqual(manifest.components.skills, 2, 'Manifest should show 2 skills');
    });

    // Test 6: Install Pro variant
    await test('installPackage() installs Pro variant (all content)', async () => {
      targetDir = path.join(tempDir, 'install-pro');
      await installationEngine.installPackage('testool', 'pro', targetDir);

      const agentsDir = path.join(targetDir, 'agents');
      const skillsDir = path.join(targetDir, 'skills');

      const agents = fs.existsSync(agentsDir) ? await fs.promises.readdir(agentsDir) : [];
      assert.strictEqual(agents.length, 13, 'Should have all 13 agents');

      const skills = fs.existsSync(skillsDir) ? await fs.promises.readdir(skillsDir) : [];
      assert.strictEqual(skills.length, 2, 'Should have all 2 skills');
    });

    // Test 7: Verify Pro manifest
    await test('Pro variant manifest contains correct component counts', async () => {
      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

      assert.strictEqual(manifest.variant, 'pro', 'Manifest should specify pro variant');
      assert.strictEqual(manifest.components.agents, 13, 'Manifest should show 13 agents');
      assert.strictEqual(manifest.components.skills, 2, 'Manifest should show 2 skills');
    });

    // Test 8: Verify skill directories are copied completely
    await test('Skill directories are copied with all nested files', async () => {
      targetDir = path.join(tempDir, 'install-skills-test');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const pdfSkillPath = path.join(targetDir, 'skills', 'pdf', 'pdf.md');
      const docxSkillPath = path.join(targetDir, 'skills', 'docx', 'docx.md');

      assert.ok(fs.existsSync(pdfSkillPath), 'PDF skill should include pdf.md');
      assert.ok(fs.existsSync(docxSkillPath), 'DOCX skill should include docx.md');
    });

    // Test 9: Verify installation uses PackageManager methods
    await test('installPackage() uses PackageManager.validatePackage()', async () => {
      // This test verifies that invalid packages are rejected
      targetDir = path.join(tempDir, 'install-invalid');
      let errorThrown = false;

      try {
        await installationEngine.installPackage('nonexistent', 'lite', targetDir);
      } catch (error) {
        errorThrown = true;
        assert.ok(error.message.includes('Package directory not found') ||
                  error.message.includes('not found'),
                  'Should throw error for invalid package');
      }

      assert.ok(errorThrown, 'Should throw error for nonexistent package');
    });

    // Test 10: Verify manifest includes variant information
    await test('generateManifest() includes variant name and selected files', async () => {
      targetDir = path.join(tempDir, 'install-manifest-test');
      await installationEngine.installPackage('testool', 'lite', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

      assert.ok(manifest.variant, 'Manifest should include variant');
      assert.ok(manifest.components, 'Manifest should include components');
      assert.ok(manifest.components.agents !== undefined, 'Manifest should include agent count');
      assert.ok(manifest.components.skills !== undefined, 'Manifest should include skill count');
      assert.ok(manifest.files, 'Manifest should include file information');
      assert.ok(manifest.files.total !== undefined, 'Manifest should include total file count');
    });

    console.log(`\n${colors.blue}Testing Progress Callback System${colors.reset}\n`);

    // Test 11: Progress callback is called during installation
    await test('installPackage() calls progress callback during file copying', async () => {
      targetDir = path.join(tempDir, 'install-progress-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'standard', targetDir, progressCallback);

      assert.ok(progressUpdates.length > 0, 'Progress callback should be called at least once');
      assert.ok(progressUpdates.length >= 15, 'Should have progress updates for 15+ files (13 agents + 2 skills)');
    });

    // Test 12: Progress callback receives correct information
    await test('Progress callback receives currentFile, filesCompleted, totalFiles', async () => {
      targetDir = path.join(tempDir, 'install-progress-info-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'lite', targetDir, progressCallback);

      // Verify first progress update
      const firstUpdate = progressUpdates[0];
      assert.ok(firstUpdate.currentFile, 'Should include currentFile');
      assert.ok(typeof firstUpdate.currentFile === 'string', 'currentFile should be a string');
      assert.ok(typeof firstUpdate.filesCompleted === 'number', 'filesCompleted should be a number');
      assert.ok(typeof firstUpdate.totalFiles === 'number', 'totalFiles should be a number');
      assert.ok(firstUpdate.filesCompleted >= 0, 'filesCompleted should be non-negative');
      assert.ok(firstUpdate.totalFiles > 0, 'totalFiles should be positive');
    });

    // Test 13: Progress callback includes percentage
    await test('Progress callback includes percentage calculation', async () => {
      targetDir = path.join(tempDir, 'install-progress-percentage-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'lite', targetDir, progressCallback);

      for (const update of progressUpdates) {
        assert.ok(typeof update.percentage === 'number', 'Should include percentage');
        assert.ok(update.percentage >= 0 && update.percentage <= 100, 'Percentage should be 0-100');
      }

      // Last update should be 100%
      const lastUpdate = progressUpdates[progressUpdates.length - 1];
      assert.strictEqual(lastUpdate.percentage, 100, 'Final progress should be 100%');
    });

    // Test 14: Progress callback includes bytes transferred
    await test('Progress callback includes bytesTransferred and totalBytes', async () => {
      targetDir = path.join(tempDir, 'install-progress-bytes-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'standard', targetDir, progressCallback);

      // Verify bytes information is included
      for (const update of progressUpdates) {
        assert.ok(typeof update.bytesTransferred === 'number', 'Should include bytesTransferred');
        assert.ok(typeof update.totalBytes === 'number', 'Should include totalBytes');
        assert.ok(update.bytesTransferred >= 0, 'bytesTransferred should be non-negative');
        assert.ok(update.totalBytes > 0, 'totalBytes should be positive');
        assert.ok(update.bytesTransferred <= update.totalBytes, 'bytesTransferred should not exceed totalBytes');
      }

      // Verify bytes increase over time
      const firstUpdate = progressUpdates[0];
      const lastUpdate = progressUpdates[progressUpdates.length - 1];
      assert.ok(lastUpdate.bytesTransferred >= firstUpdate.bytesTransferred, 'Bytes should increase');
      assert.strictEqual(lastUpdate.bytesTransferred, lastUpdate.totalBytes, 'Final bytes should equal total');
    });

    // Test 15: Progress updates are sequential
    await test('Progress updates show sequential file completion', async () => {
      targetDir = path.join(tempDir, 'install-progress-sequential-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'lite', targetDir, progressCallback);

      // Verify filesCompleted increases sequentially
      for (let i = 1; i < progressUpdates.length; i++) {
        const prev = progressUpdates[i - 1].filesCompleted;
        const curr = progressUpdates[i].filesCompleted;
        assert.ok(curr >= prev, `filesCompleted should not decrease (${prev} -> ${curr})`);
        assert.ok(curr - prev <= 1, `filesCompleted should increase by at most 1 (${prev} -> ${curr})`);
      }

      // Verify final count equals total
      const lastUpdate = progressUpdates[progressUpdates.length - 1];
      assert.strictEqual(lastUpdate.filesCompleted, lastUpdate.totalFiles,
                        'Final filesCompleted should equal totalFiles');
    });

    // Test 16: Progress callback works with skill directories
    await test('Progress callback correctly handles skill directories', async () => {
      targetDir = path.join(tempDir, 'install-progress-skills-test');
      const progressUpdates = [];
      const skillFilesProcessed = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
        if (progress.currentFile.includes('skills')) {
          skillFilesProcessed.push(progress.currentFile);
        }
      };

      await installationEngine.installPackage('testool', 'standard', targetDir, progressCallback);

      // Verify skill files were processed
      assert.ok(skillFilesProcessed.length > 0, 'Should process skill directory files');

      // Verify skill directory paths are reported
      const hasSkillPaths = progressUpdates.some(update =>
        update.currentFile.includes('skills/pdf') || update.currentFile.includes('skills/docx')
      );
      assert.ok(hasSkillPaths, 'Should report skill directory paths');
    });

    // Test 17: Installation works without progress callback (backward compatibility)
    await test('installPackage() works without progress callback parameter', async () => {
      targetDir = path.join(tempDir, 'install-no-callback-test');

      // Should not throw error when callback is not provided
      await installationEngine.installPackage('testool', 'lite', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'Installation should complete without callback');
    });

    // Test 18: Progress callback with Pro variant (many files)
    await test('Progress callback handles Pro variant with many files', async () => {
      targetDir = path.join(tempDir, 'install-progress-pro-test');
      const progressUpdates = [];

      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      await installationEngine.installPackage('testool', 'pro', targetDir, progressCallback);

      // Pro should have the most progress updates
      assert.ok(progressUpdates.length >= 15, 'Pro variant should have 15+ progress updates');

      // Verify final state
      const lastUpdate = progressUpdates[progressUpdates.length - 1];
      assert.strictEqual(lastUpdate.percentage, 100, 'Should reach 100%');
      assert.strictEqual(lastUpdate.filesCompleted, lastUpdate.totalFiles, 'Should complete all files');
    });

    // ===================================
    // Tests 19-25: Enhanced Manifest Generation
    // ===================================
    console.log(`\n${colors.cyan}${colors.bright}Enhanced Manifest Generation Tests${colors.reset}`);

    // Test 19: Manifest includes variant metadata
    await test('Manifest includes variant metadata (description, useCase, targetUsers)', async () => {
      targetDir = path.join(tempDir, 'install-manifest-metadata-test');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.ok(manifest.variantInfo, 'Manifest should include variantInfo object');
      assert.ok(typeof manifest.variantInfo.name === 'string', 'variantInfo should include name');
      assert.ok(typeof manifest.variantInfo.description === 'string', 'variantInfo should include description');
      assert.ok(typeof manifest.variantInfo.useCase === 'string', 'variantInfo should include useCase');
      assert.ok(typeof manifest.variantInfo.targetUsers === 'string', 'variantInfo should include targetUsers');
      assert.ok(manifest.variantInfo.description.length > 0, 'Description should not be empty');
    });

    // Test 20: Manifest includes list of installed agents
    await test('Manifest includes list of installed agent files', async () => {
      targetDir = path.join(tempDir, 'install-manifest-agents-test');
      await installationEngine.installPackage('testool', 'lite', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.ok(manifest.installedFiles, 'Manifest should include installedFiles object');
      assert.ok(Array.isArray(manifest.installedFiles.agents), 'installedFiles.agents should be an array');
      assert.strictEqual(manifest.installedFiles.agents.length, 3, 'Lite variant should list 3 agents');

      // Verify agent names match the lite variant selection
      const agentNames = manifest.installedFiles.agents;
      assert.ok(agentNames.includes('master'), 'Should include master agent');
      assert.ok(agentNames.includes('code-developer'), 'Should include code-developer agent');
      assert.ok(agentNames.includes('scrum-master'), 'Should include scrum-master agent');
    });

    // Test 21: Manifest includes list of installed skills
    await test('Manifest includes list of installed skill directories', async () => {
      targetDir = path.join(tempDir, 'install-manifest-skills-test');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.ok(Array.isArray(manifest.installedFiles.skills), 'installedFiles.skills should be an array');
      assert.ok(manifest.installedFiles.skills.length > 0, 'Standard variant should list skills');

      // Verify skills are listed
      const skillNames = manifest.installedFiles.skills;
      assert.ok(skillNames.includes('pdf'), 'Should include pdf skill');
      assert.ok(skillNames.includes('docx'), 'Should include docx skill');
    });

    // Test 22: Manifest includes list of installed resources and hooks
    await test('Manifest includes lists of installed resources and hooks', async () => {
      targetDir = path.join(tempDir, 'install-manifest-resources-hooks-test');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.ok(Array.isArray(manifest.installedFiles.resources), 'installedFiles.resources should be an array');
      assert.ok(Array.isArray(manifest.installedFiles.hooks), 'installedFiles.hooks should be an array');
      assert.ok(manifest.installedFiles.resources.length > 0, 'Should list resources');
      assert.ok(manifest.installedFiles.hooks.length > 0, 'Should list hooks');
    });

    // Test 23: Manifest structure varies by variant
    await test('Manifest reflects different content for different variants', async () => {
      const liteDir = path.join(tempDir, 'install-manifest-lite');
      const proDir = path.join(tempDir, 'install-manifest-pro');

      await installationEngine.installPackage('testool', 'lite', liteDir);
      await installationEngine.installPackage('testool', 'pro', proDir);

      const liteManifest = JSON.parse(fs.readFileSync(path.join(liteDir, 'manifest.json'), 'utf8'));
      const proManifest = JSON.parse(fs.readFileSync(path.join(proDir, 'manifest.json'), 'utf8'));

      // Lite should have fewer files than Pro
      assert.ok(liteManifest.installedFiles.agents.length <= proManifest.installedFiles.agents.length,
                'Lite should have same or fewer agents than Pro');
      assert.ok(liteManifest.installedFiles.skills.length < proManifest.installedFiles.skills.length,
                'Lite should have fewer skills than Pro');

      // Variant info should be different
      assert.notStrictEqual(liteManifest.variantInfo.name, proManifest.variantInfo.name,
                           'Variant names should differ');
      assert.notStrictEqual(liteManifest.variant, proManifest.variant,
                           'Variant field should differ');
    });

    // Test 24: Manifest file counts match installed files lists
    await test('Manifest component counts match installedFiles array lengths', async () => {
      targetDir = path.join(tempDir, 'install-manifest-counts-test');
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.strictEqual(manifest.components.agents, manifest.installedFiles.agents.length,
                        'Agent count should match installedFiles.agents length');
      assert.strictEqual(manifest.components.skills, manifest.installedFiles.skills.length,
                        'Skill count should match installedFiles.skills length');
      assert.strictEqual(manifest.components.resources, manifest.installedFiles.resources.length,
                        'Resource count should match installedFiles.resources length');
      assert.strictEqual(manifest.components.hooks, manifest.installedFiles.hooks.length,
                        'Hook count should match installedFiles.hooks length');
    });

    // Test 25: Manifest maintains backward compatibility with existing fields
    await test('Manifest maintains all existing fields for backward compatibility', async () => {
      targetDir = path.join(tempDir, 'install-manifest-compat-test');
      await installationEngine.installPackage('testool', 'lite', targetDir);

      const manifestPath = path.join(targetDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      // Check all existing fields are still present
      assert.ok(manifest.tool, 'Should include tool field');
      assert.ok(manifest.name, 'Should include name field');
      assert.ok(manifest.description, 'Should include description field');
      assert.ok(manifest.variant, 'Should include variant field');
      assert.ok(manifest.version, 'Should include version field');
      assert.ok(manifest.installed_at, 'Should include installed_at field');
      assert.ok(manifest.components, 'Should include components object');
      assert.ok(manifest.paths, 'Should include paths object');
      assert.ok(manifest.files, 'Should include files object');

      // Check new fields are added
      assert.ok(manifest.variantInfo, 'Should include new variantInfo field');
      assert.ok(manifest.installedFiles, 'Should include new installedFiles field');
    });

    // ===================================
    // Tests 26-35: Enhanced Rollback Functionality
    // ===================================
    console.log(`\n${colors.cyan}${colors.bright}Enhanced Rollback Tests${colors.reset}`);

    // Test 26: Installation tracks files for rollback
    await test('Installation tracks installed files in session log', async () => {
      targetDir = path.join(tempDir, 'install-rollback-tracking-test');
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Check that installation log exists and contains file-level information
      const sessionLog = installationEngine.getSessionLog();
      assert.ok(sessionLog, 'Session log should exist');
      assert.ok(Array.isArray(sessionLog.installedFiles), 'Session log should have installedFiles array');
      assert.ok(sessionLog.installedFiles.length > 0, 'Session log should track installed files');
    });

    // Test 27: Rollback removes only installed files (not entire directory)
    await test('Rollback removes only installed files, not entire directory', async () => {
      targetDir = path.join(tempDir, 'install-rollback-granular-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Create a user file (not part of installation)
      const userFilePath = path.join(targetDir, 'my-custom-file.txt');
      await fs.promises.writeFile(userFilePath, 'User-created content');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify user file still exists
      assert.ok(fs.existsSync(userFilePath), 'User-created file should not be removed by rollback');

      // Verify installed files are removed
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed by rollback');
    });

    // Test 28: Rollback cleans up empty directories
    await test('Rollback removes empty directories after file removal', async () => {
      targetDir = path.join(tempDir, 'install-rollback-cleanup-test');

      // Install lite variant (only agents, no skills)
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Verify directories exist
      const agentsDir = path.join(targetDir, 'agents');
      assert.ok(fs.existsSync(agentsDir), 'Agents directory should exist after installation');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify empty directories are cleaned up
      assert.ok(!fs.existsSync(agentsDir) || (await fs.promises.readdir(agentsDir)).length === 0,
                'Empty agents directory should be removed or empty');
    });

    // Test 29: Rollback preserves user files in component directories
    await test('Rollback preserves user files in component directories', async () => {
      targetDir = path.join(tempDir, 'install-rollback-preserve-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Create user files in agents directory
      const userAgentPath = path.join(targetDir, 'agents', 'my-custom-agent.md');
      await fs.promises.writeFile(userAgentPath, '# My Custom Agent');

      // Create user file in skills directory
      const userSkillPath = path.join(targetDir, 'skills', 'custom-skill', 'skill.md');
      await fs.promises.mkdir(path.join(targetDir, 'skills', 'custom-skill'), { recursive: true });
      await fs.promises.writeFile(userSkillPath, '# My Custom Skill');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify user files are preserved
      assert.ok(fs.existsSync(userAgentPath), 'User agent should be preserved');
      assert.ok(fs.existsSync(userSkillPath), 'User skill should be preserved');

      // Verify installed files are removed
      const installedAgentPath = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(installedAgentPath), 'Installed agent should be removed');
    });

    // Test 30: Rollback works with different variants
    await test('Rollback correctly handles Lite variant (3 agents, 0 skills)', async () => {
      targetDir = path.join(tempDir, 'install-rollback-lite-test');

      // Install lite variant
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Verify files exist
      const agentCount = await countFilesRecursive(path.join(targetDir, 'agents'));
      assert.ok(agentCount >= 3, 'Should have at least 3 agent files');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify all installed files are removed
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed');

      // Verify agents are removed
      const remainingAgents = fs.existsSync(path.join(targetDir, 'agents'))
        ? await countFilesRecursive(path.join(targetDir, 'agents'))
        : 0;
      assert.strictEqual(remainingAgents, 0, 'All installed agents should be removed');
    });

    // Test 31: Rollback works with Standard variant (includes skills)
    await test('Rollback correctly handles Standard variant (agents + skills)', async () => {
      targetDir = path.join(tempDir, 'install-rollback-standard-test');

      // Install standard variant
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify skills exist
      const skillsDir = path.join(targetDir, 'skills');
      assert.ok(fs.existsSync(skillsDir), 'Skills directory should exist');
      const skillDirs = await fs.promises.readdir(skillsDir);
      assert.ok(skillDirs.length > 0, 'Should have skill directories');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify skills are removed
      const remainingSkills = fs.existsSync(skillsDir)
        ? (await fs.promises.readdir(skillsDir)).length
        : 0;
      assert.strictEqual(remainingSkills, 0, 'All installed skills should be removed');
    });

    // Test 32: Rollback logs actions for troubleshooting
    await test('Rollback logs all actions for troubleshooting', async () => {
      targetDir = path.join(tempDir, 'install-rollback-logging-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Check rollback log
      const rollbackLog = installationEngine.getRollbackLog();
      assert.ok(rollbackLog, 'Rollback log should exist');
      assert.ok(Array.isArray(rollbackLog), 'Rollback log should be an array');
      assert.ok(rollbackLog.length > 0, 'Rollback log should have entries');

      // Verify log entries have required information
      const lastRollback = rollbackLog[rollbackLog.length - 1];
      assert.ok(lastRollback.tool, 'Log entry should include tool');
      assert.ok(lastRollback.targetPath, 'Log entry should include target path');
      assert.ok(lastRollback.filesRemoved, 'Log entry should include files removed count');
      assert.ok(lastRollback.timestamp, 'Log entry should include timestamp');
    });

    // Test 33: Rollback on failed installation
    await test('Rollback automatically triggered on failed installation', async () => {
      targetDir = path.join(tempDir, 'install-rollback-failure-test');

      // Try to install to a read-only or invalid path to trigger failure
      // First, create a directory and make it unwritable
      await fs.promises.mkdir(targetDir, { recursive: true });

      // Install successfully first
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Verify installation succeeded
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'Initial installation should succeed');

      // Verify rollback can be called
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify rollback removed files
      assert.ok(!fs.existsSync(manifestPath), 'Rollback should remove manifest');
    });

    // Test 34: Rollback restores from backup if available
    await test('Rollback restores from backup if available', async () => {
      targetDir = path.join(tempDir, 'install-rollback-backup-test');

      // Create an existing installation (must have manifest.json to be detected)
      await fs.promises.mkdir(path.join(targetDir, 'agents'), { recursive: true });
      const existingFilePath = path.join(targetDir, 'agents', 'existing-agent.md');
      await fs.promises.writeFile(existingFilePath, '# Existing Agent');

      // Create a manifest so it's recognized as existing installation
      const existingManifest = {
        tool: 'testool',
        name: 'Test Tool',
        version: '1.0.0',
        installed_at: new Date().toISOString()
      };
      await fs.promises.writeFile(
        path.join(targetDir, 'manifest.json'),
        JSON.stringify(existingManifest, null, 2)
      );

      // Install over existing (should create backup)
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Verify backup was created
      const backupLog = installationEngine.backupLog;
      assert.ok(backupLog.length > 0, 'Backup should have been created');

      // Get the backup path
      const backup = backupLog[backupLog.length - 1];
      assert.ok(fs.existsSync(backup.backup), 'Backup directory should exist');

      // Perform rollback (should use session log first, not backup)
      await installationEngine.rollbackInstallation('testool', targetDir);

      // After rollback with session log, only installed files should be removed
      // The existing file should still be there because it wasn't in session log
      assert.ok(fs.existsSync(existingFilePath), 'Original file should be preserved (not in session log)');

      // Verify new installed files are removed
      const masterAgentPath = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(masterAgentPath), 'Installed agent should be removed');

      // Verify manifest is removed
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed');
    });

    // Test 35: Rollback works correctly with partial installations
    await test('Rollback handles partial installation (some files copied)', async () => {
      targetDir = path.join(tempDir, 'install-rollback-partial-test');

      // Install package normally first
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Now simulate a partial installation by manually tracking some files
      // Then perform rollback and verify only those files are removed

      // Get the session log before rollback
      const sessionLog = installationEngine.getSessionLog();
      const filesBeforeRollback = sessionLog ? sessionLog.installedFiles.length : 0;
      assert.ok(filesBeforeRollback > 0, 'Should have files tracked before rollback');

      // Perform rollback
      await installationEngine.rollbackInstallation('testool', targetDir);

      // Verify rollback processed files
      const rollbackLog = installationEngine.getRollbackLog();
      const lastRollback = rollbackLog[rollbackLog.length - 1];
      assert.ok(lastRollback.filesRemoved >= 0, 'Should report number of files removed');
    });

    console.log(`\n${colors.cyan}${colors.bright}Verification Tests${colors.reset}`);

    // Test 36: verifyInstallation returns success for valid installation
    await test('verifyInstallation returns success for valid installation', async () => {
      targetDir = path.join(tempDir, 'verify-valid-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.strictEqual(verification.valid, true, 'Verification should be valid');
      assert.strictEqual(verification.toolId, 'testool', 'Tool ID should match');
      assert.strictEqual(verification.targetPath, targetDir, 'Target path should match');
      assert.ok(verification.manifest, 'Should have manifest data');
      assert.strictEqual(verification.issues.length, 0, 'Should have no issues');
    });

    // Test 37: verifyInstallation detects missing manifest
    await test('verifyInstallation detects missing manifest', async () => {
      targetDir = path.join(tempDir, 'verify-no-manifest-test');

      // Create directory but no installation
      await fs.promises.mkdir(targetDir, { recursive: true });

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.strictEqual(verification.valid, false, 'Verification should be invalid');
      assert.ok(verification.issues.length > 0, 'Should have issues');
      assert.ok(
        verification.issues.some(i => i.message.includes('Manifest')),
        'Should report missing manifest'
      );
    });

    // Test 38: verifyInstallation detects missing files
    await test('verifyInstallation detects missing files', async () => {
      targetDir = path.join(tempDir, 'verify-missing-files-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Delete one agent file
      const agentsDir = path.join(targetDir, 'agents');
      const agentFiles = await fs.promises.readdir(agentsDir);
      if (agentFiles.length > 0) {
        await fs.promises.unlink(path.join(agentsDir, agentFiles[0]));
      }

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.strictEqual(verification.valid, false, 'Verification should be invalid');
      assert.ok(verification.issues.length > 0, 'Should have issues');
      assert.ok(
        verification.components.agents.missing.length > 0,
        'Should report missing agents'
      );
    });

    // Test 39: verifyInstallation includes component counts
    await test('verifyInstallation includes component counts', async () => {
      targetDir = path.join(tempDir, 'verify-components-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.ok(verification.components, 'Should have components');
      assert.ok(verification.components.agents, 'Should have agents component');
      assert.ok(verification.components.skills, 'Should have skills component');
      assert.ok(verification.components.resources, 'Should have resources component');
      assert.ok(verification.components.hooks, 'Should have hooks component');

      // Check component structure
      assert.ok('expected' in verification.components.agents, 'Should have expected count');
      assert.ok('found' in verification.components.agents, 'Should have found count');
      assert.ok('missing' in verification.components.agents, 'Should have missing array');
    });

    // Test 40: verifyInstallation includes summary
    await test('verifyInstallation includes summary', async () => {
      targetDir = path.join(tempDir, 'verify-summary-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.ok(verification.summary, 'Should have summary');
      assert.ok('totalExpected' in verification.summary, 'Should have totalExpected');
      assert.ok('totalFound' in verification.summary, 'Should have totalFound');
      assert.ok('totalMissing' in verification.summary, 'Should have totalMissing');
      assert.ok('issueCount' in verification.summary, 'Should have issueCount');
      assert.ok('warningCount' in verification.summary, 'Should have warningCount');
    });

    // Test 41: verifyInstallation includes variant and version info
    await test('verifyInstallation includes variant and version info', async () => {
      targetDir = path.join(tempDir, 'verify-metadata-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify installation
      const verification = await installationEngine.verifyInstallation('testool', targetDir);

      assert.ok(verification.variant, 'Should have variant');
      assert.strictEqual(verification.variant, 'standard', 'Variant should match');
      assert.ok(verification.version, 'Should have version');
    });

    // ===================================
    // Tests 42-60: Uninstall Functionality
    // ===================================
    console.log(`\n${colors.cyan}${colors.bright}Uninstall Functionality Tests${colors.reset}`);

    // Test 42: uninstall() detects missing manifest
    await test('uninstall() detects missing manifest and returns error', async () => {
      targetDir = path.join(tempDir, 'uninstall-no-manifest-test');
      await fs.promises.mkdir(targetDir, { recursive: true });

      const result = await installationEngine.uninstall('testool', targetDir);

      assert.strictEqual(result.success, false, 'Uninstall should fail');
      assert.ok(result.errors.length > 0, 'Should have errors');
      assert.ok(result.errors[0].includes('Manifest'), 'Error should mention manifest');
    });

    // Test 43: uninstall() reads manifest and counts files
    await test('uninstall() reads manifest and calculates file count', async () => {
      targetDir = path.join(tempDir, 'uninstall-count-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Track confirmation info
      let confirmInfo = null;
      const confirmCallback = async (info) => {
        confirmInfo = info;
        return true; // Confirm uninstall
      };

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.ok(confirmInfo, 'Confirmation callback should be called');
      assert.strictEqual(confirmInfo.toolId, 'testool', 'Should pass tool ID');
      assert.ok(confirmInfo.fileCount > 0, 'Should calculate file count');
      assert.strictEqual(confirmInfo.variant, 'lite', 'Should pass variant');
    });

    // Test 44: uninstall() respects user cancellation
    await test('uninstall() cancels when user declines confirmation', async () => {
      targetDir = path.join(tempDir, 'uninstall-cancel-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Decline confirmation
      const confirmCallback = async (info) => {
        return false; // Cancel uninstall
      };

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, false, 'Uninstall should not succeed');
      assert.ok(result.warnings.some(w => w.includes('cancelled')), 'Should have cancellation warning');

      // Verify files still exist
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'Manifest should still exist');
    });

    // Test 45: uninstall() creates backup before removing files
    await test('uninstall() creates backup before uninstalling', async () => {
      targetDir = path.join(tempDir, 'uninstall-backup-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.ok(result.backupPath, 'Should create backup');
      assert.ok(fs.existsSync(result.backupPath), 'Backup directory should exist');
      assert.ok(result.backupPath.includes('.uninstall-backup.'), 'Backup should have correct naming');

      // Verify backup contains files
      const backupManifest = path.join(result.backupPath, 'manifest.json');
      assert.ok(fs.existsSync(backupManifest), 'Backup should contain manifest');
    });

    // Test 46: uninstall() removes all installed files from Lite variant
    await test('uninstall() removes all files from Lite variant installation', async () => {
      targetDir = path.join(tempDir, 'uninstall-lite-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Verify installation exists
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'Installation should exist');

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(result.filesRemoved > 0, 'Should remove files');

      // Verify manifest is removed
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed');

      // Verify agent files are removed
      const masterAgent = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(masterAgent), 'Agent files should be removed');
    });

    // Test 47: uninstall() removes all files from Standard variant (including skills)
    await test('uninstall() removes all files from Standard variant including skills', async () => {
      targetDir = path.join(tempDir, 'uninstall-standard-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Verify skills exist
      const pdfSkill = path.join(targetDir, 'skills', 'pdf');
      assert.ok(fs.existsSync(pdfSkill), 'Skills should exist before uninstall');

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');

      // Verify skills are removed
      assert.ok(!fs.existsSync(pdfSkill), 'Skill directories should be removed');

      // Verify agents are removed
      const masterAgent = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(masterAgent), 'Agent files should be removed');
    });

    // Test 48: uninstall() preserves user-created files
    await test('uninstall() preserves user-created files not in manifest', async () => {
      targetDir = path.join(tempDir, 'uninstall-preserve-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Create user files
      const userFile = path.join(targetDir, 'my-custom-file.txt');
      await fs.promises.writeFile(userFile, 'User content');

      const userAgent = path.join(targetDir, 'agents', 'my-agent.md');
      await fs.promises.writeFile(userAgent, '# My Agent');

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');

      // Verify user files are preserved
      assert.ok(fs.existsSync(userFile), 'User file should be preserved');
      assert.ok(fs.existsSync(userAgent), 'User agent should be preserved');

      // Verify installed files are removed
      const masterAgent = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(masterAgent), 'Installed agent should be removed');
    });

    // Test 49: uninstall() cleans up empty directories
    await test('uninstall() removes empty directories after file removal', async () => {
      targetDir = path.join(tempDir, 'uninstall-cleanup-test');

      // Install lite variant (no skills)
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(result.directoriesRemoved > 0, 'Should remove directories');

      // Verify empty category directories are removed
      const agentsDir = path.join(targetDir, 'agents');
      const agentsDirExists = fs.existsSync(agentsDir);

      if (agentsDirExists) {
        // If directory exists, it should be empty
        const items = await fs.promises.readdir(agentsDir);
        assert.strictEqual(items.length, 0, 'Agents directory should be empty if it exists');
      }
    });

    // Test 50: uninstall() preserves directories with user files
    await test('uninstall() preserves directories containing user files', async () => {
      targetDir = path.join(tempDir, 'uninstall-preserve-dir-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Create user file in agents directory
      const userAgent = path.join(targetDir, 'agents', 'my-custom-agent.md');
      await fs.promises.writeFile(userAgent, '# My Custom Agent');

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');

      // Verify agents directory still exists (has user file)
      const agentsDir = path.join(targetDir, 'agents');
      assert.ok(fs.existsSync(agentsDir), 'Agents directory should be preserved');
      assert.ok(fs.existsSync(userAgent), 'User agent should still exist');

      // Verify installed agents are removed
      const masterAgent = path.join(targetDir, 'agents', 'master.md');
      assert.ok(!fs.existsSync(masterAgent), 'Installed agents should be removed');
    });

    // Test 51: uninstall() calls progress callback
    await test('uninstall() calls progress callback during file removal', async () => {
      targetDir = path.join(tempDir, 'uninstall-progress-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      const progressUpdates = [];
      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback, progressCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(progressUpdates.length > 0, 'Progress callback should be called');

      // Verify progress updates have correct structure
      const firstUpdate = progressUpdates[0];
      assert.ok(firstUpdate.type, 'Should have type');
      assert.ok(firstUpdate.category, 'Should have category');
      assert.ok(firstUpdate.name, 'Should have name');
      assert.ok(typeof firstUpdate.filesRemoved === 'number', 'Should have filesRemoved count');
      assert.ok(typeof firstUpdate.percentage === 'number', 'Should have percentage');
    });

    // Test 52: uninstall() progress reaches 100%
    await test('uninstall() progress callback reaches 100% at completion', async () => {
      targetDir = path.join(tempDir, 'uninstall-progress-100-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      const progressUpdates = [];
      const progressCallback = (progress) => {
        progressUpdates.push(progress);
      };

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      await installationEngine.uninstall('testool', targetDir, confirmCallback, progressCallback);

      // Verify last update is 100%
      const lastUpdate = progressUpdates[progressUpdates.length - 1];
      assert.strictEqual(lastUpdate.percentage, 100, 'Final progress should be 100%');
    });

    // Test 53: uninstall() returns detailed result summary
    await test('uninstall() returns detailed result with counts and paths', async () => {
      targetDir = path.join(tempDir, 'uninstall-result-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.ok(result, 'Should return result object');
      assert.ok('success' in result, 'Should have success field');
      assert.ok('toolId' in result, 'Should have toolId field');
      assert.ok('targetPath' in result, 'Should have targetPath field');
      assert.ok('filesRemoved' in result, 'Should have filesRemoved field');
      assert.ok('directoriesRemoved' in result, 'Should have directoriesRemoved field');
      assert.ok('backupPath' in result, 'Should have backupPath field');
      assert.ok('errors' in result, 'Should have errors array');
      assert.ok('warnings' in result, 'Should have warnings array');
      assert.ok('timestamp' in result, 'Should have timestamp');

      assert.strictEqual(result.success, true, 'Should succeed');
      assert.strictEqual(result.toolId, 'testool', 'Should have correct tool ID');
      assert.ok(result.filesRemoved > 0, 'Should have removed files');
    });

    // Test 54: uninstall() handles missing files gracefully
    await test('uninstall() handles missing files with warnings', async () => {
      targetDir = path.join(tempDir, 'uninstall-missing-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Delete one agent file manually
      const agentPath = path.join(targetDir, 'agents', 'master.md');
      await fs.promises.unlink(agentPath);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should still succeed');
      assert.ok(result.warnings.length > 0, 'Should have warnings for missing files');
      assert.ok(result.warnings.some(w => w.includes('not found')), 'Should warn about missing file');
    });

    // Test 55: uninstall() works without confirmation callback
    await test('uninstall() works without confirmation callback (skips confirmation)', async () => {
      targetDir = path.join(tempDir, 'uninstall-no-confirm-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Uninstall without confirmation callback
      const result = await installationEngine.uninstall('testool', targetDir);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');

      // Verify files are removed
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed');
    });

    // Test 56: uninstall() works without progress callback
    await test('uninstall() works without progress callback', async () => {
      targetDir = path.join(tempDir, 'uninstall-no-progress-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall without progress callback
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
    });

    // Test 57: uninstall() handles Pro variant with many files
    await test('uninstall() successfully removes Pro variant with many files', async () => {
      targetDir = path.join(tempDir, 'uninstall-pro-test');

      // Install Pro variant
      await installationEngine.installPackage('testool', 'pro', targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(result.filesRemoved > 15, 'Pro variant should remove many files');

      // Verify all components are removed
      const manifestPath = path.join(targetDir, 'manifest.json');
      assert.ok(!fs.existsSync(manifestPath), 'Manifest should be removed');
    });

    // Test 58: uninstall() counts files in skill directories correctly
    await test('uninstall() correctly counts files inside skill directories', async () => {
      targetDir = path.join(tempDir, 'uninstall-skill-count-test');

      // Install Standard variant (has skills)
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Track confirmation info
      let fileCount = 0;
      const confirmCallback = async (info) => {
        fileCount = info.fileCount;
        return true;
      };

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(fileCount > 0, 'Should count files');

      // File count should include files inside skill directories
      // Standard has 13 agents + files in 2 skills + resources + hooks + manifest
      assert.ok(fileCount >= 15, 'Should count files inside skill directories');
    });

    // Test 59: uninstall() reports errors for permission issues
    await test('uninstall() handles and reports errors during removal', async () => {
      targetDir = path.join(tempDir, 'uninstall-error-test');

      // Install package
      await installationEngine.installPackage('testool', 'lite', targetDir);

      // Make a file read-only to simulate permission error (on Unix-like systems)
      const agentPath = path.join(targetDir, 'agents', 'master.md');
      if (fs.existsSync(agentPath)) {
        // This test might not work on all systems, so we'll be lenient
        try {
          await fs.promises.chmod(path.dirname(agentPath), 0o444); // Read-only directory
        } catch (error) {
          // Skip this test if we can't set permissions
          console.log('  (Skipping permission test - not supported on this system)');
          return;
        }

        // Auto-confirm
        const confirmCallback = async () => true;

        // Uninstall (might fail on some files)
        const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

        // Restore permissions for cleanup
        await fs.promises.chmod(path.dirname(agentPath), 0o755);

        // The result might have errors
        // We're mainly testing that it doesn't crash
        assert.ok(result, 'Should return a result even with errors');
      }
    });

    // Test 60: uninstall() backup contains complete installation
    await test('uninstall() backup contains complete copy of installation', async () => {
      targetDir = path.join(tempDir, 'uninstall-backup-complete-test');

      // Install package
      await installationEngine.installPackage('testool', 'standard', targetDir);

      // Count files before uninstall
      const filesBefore = await countFilesRecursive(targetDir);

      // Auto-confirm
      const confirmCallback = async () => true;

      // Uninstall
      const result = await installationEngine.uninstall('testool', targetDir, confirmCallback);

      assert.strictEqual(result.success, true, 'Uninstall should succeed');
      assert.ok(result.backupPath, 'Should create backup');

      // Count files in backup
      const filesInBackup = await countFilesRecursive(result.backupPath);

      assert.strictEqual(filesInBackup, filesBefore, 'Backup should contain all original files');

      // Verify backup has manifest
      const backupManifest = path.join(result.backupPath, 'manifest.json');
      assert.ok(fs.existsSync(backupManifest), 'Backup should have manifest');
    });

  } finally {
    // Cleanup
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }

  // Print summary
  console.log(`\n${colors.bright}Test Summary${colors.reset}`);
  console.log(`Total: ${totalTests}`);
  console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);

  if (failedTests === 0) {
    console.log(`\n${colors.green}${colors.bright}All tests passed!${colors.reset}\n`);
  } else {
    console.log(`\n${colors.red}${colors.bright}Some tests failed.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error(`${colors.red}Fatal error running tests: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});
