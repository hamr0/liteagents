/**
 * Installation Engine for Agentic Kit Installer
 *
 * Handles file operations, installation progress, and rollback functionality
 */

const fs = require('fs');
const path = require('path');

// Same single source of truth as installer/cli.js: UPDATE_VERSION.sh bumps
// only package.json. Stamped into every manifest so version-check.cjs can read
// the installed version without shelling out to `npm ls -g` (~500ms per run).
const LITEAGENTS_VERSION = require('../package.json').version;

class InstallationEngine {
  constructor(pathManager, packageManager) {
    this.pathManager = pathManager;
    this.packageManager = packageManager;
    this.installationLog = [];
    this.backupLog = [];
    this.rollbackLog = [];
    this.sessionLog = {
      installedFiles: [],
      targetPath: null,
      tool: null
    };
  }
  
  /**
   * Install multiple tools with state management for resume capability
   *
   * @param {string} variant - Variant name ('lite', 'standard', 'pro')
   * @param {Array<string>} tools - Array of tool IDs to install
   * @param {Object} paths - Map of tool IDs to installation paths
   * @param {function} progressCallback - Optional callback for progress updates
   * @param {boolean} resume - Whether this is resuming a previous installation
   * @returns {Object} - Installation result summary
   */
  async installMultipleTools(variant, tools, paths, progressCallback = null, resume = false) {
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    // Initialize or load state
    if (!resume) {
      this.stateManager.initializeState(variant, tools, paths);
      await this.stateManager.saveState({ stage: 'initializing' });
    }

    const state = this.stateManager.getState();
    if (!state) {
      throw new Error('Failed to initialize installation state');
    }

    try {
      // Process each tool
      for (const toolId of tools) {
        // Skip if already completed
        if (state.completedTools.includes(toolId)) {
          console.log(`Skipping ${toolId} (already completed)`);
          results.skipped.push(toolId);
          continue;
        }

        // Skip if previously failed (don't retry automatically)
        if (state.failedTools.some(f => f.toolId === toolId)) {
          console.log(`Skipping ${toolId} (previously failed)`);
          results.skipped.push(toolId);
          continue;
        }

        try {
          // Install this tool
          await this.installPackage(toolId, variant, paths[toolId], progressCallback);

          // Mark tool as completed in state
          await this.stateManager.completeCurrentTool();

          results.successful.push(toolId);

        } catch (error) {
          console.error(`Failed to install ${toolId}: ${error.message}`);

          // Mark tool as failed in state
          await this.stateManager.failCurrentTool(error);

          results.failed.push({
            toolId: toolId,
            error: error.message
          });

          // Continue with next tool (don't stop entire installation)
        }
      }

      // All tools processed - clear state if all successful
      if (results.failed.length === 0) {
        await this.stateManager.clearState();
      }

      return results;

    } catch (error) {
      console.error(`Installation process failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Install package for a specific tool and variant
   * Uses variant-aware PackageManager methods to install only selected content
   *
   * @param {string} toolId - Tool identifier (e.g., 'claude', 'opencode')
   * @param {string} variant - Variant name ('lite', 'standard', 'pro')
   * @param {string} targetPath - Installation target path
   * @param {function} progressCallback - Optional callback for progress updates
   */
  async installPackage(toolId, variant, targetPath, progressCallback = null) {
    // Use base package directory from PackageManager (not variant-specific)
    const sourceDir = path.join(this.packageManager.packagesDir, toolId);
    const expandedTargetPath = this.pathManager.expandPath(targetPath);

    // Initialize session log for this installation
    this.sessionLog = {
      installedFiles: [],
      targetPath: expandedTargetPath,
      tool: toolId
    };

    try {
      // Validate source package with variant support
      const validation = await this.packageManager.validatePackage(toolId, variant);
      if (!validation.valid) {
        throw new Error(`Invalid package: ${validation.error}`);
      }

      // Check for existing installation
      const existing = await this.pathManager.checkExistingInstallation(targetPath);
      if (existing.exists) {
        await this.createBackup(expandedTargetPath);
      }

      // Create target directory
      await fs.promises.mkdir(expandedTargetPath, { recursive: true });

      // Get variant-selected content from PackageManager
      const packageContents = await this.packageManager.getPackageContents(toolId, variant);

      // Copy only variant-selected files (not entire directory)
      await this.copySelectedFiles(sourceDir, expandedTargetPath, packageContents, progressCallback);

      // Generate manifest with variant information
      await this.generateManifest(toolId, variant, expandedTargetPath);

      // Log installation
      this.installationLog.push({
        tool: toolId,
        variant,
        source: sourceDir,
        target: expandedTargetPath,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error(`✗ Failed to install ${toolId}: ${error.message}`);

      // Attempt rollback
      await this.rollbackInstallation(toolId, expandedTargetPath);

      throw error;
    }
  }
  
  /**
   * Copy only variant-selected files to target directory
   * Maintains directory structure for each component category
   * Calls progress callback with real-time progress information
   *
   * @param {string} sourceBase - Base source directory
   * @param {string} targetPath - Target installation path
   * @param {object} packageContents - Variant-selected content from PackageManager
   * @param {function} progressCallback - Optional callback for progress updates
   */
  async copySelectedFiles(sourceBase, targetPath, packageContents, progressCallback = null) {
    // Calculate total file count and total bytes for all content
    let totalFiles = 0;
    let totalBytes = 0;
    const filesToCopy = [];

    // Helper function to get file size
    const getFileSize = async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        return stat.size;
      } catch (error) {
        return 0;
      }
    };

    // Helper function to recursively collect all files in a directory.
    // Skips node_modules directories (callers may set skipNodeModules=true for plugins).
    const collectDirectoryFiles = async (dirPath, relativePath = '', skipNodeModules = false) => {
      const items = await fs.promises.readdir(dirPath);
      const filesInDir = [];

      for (const item of items) {
        if (skipNodeModules && item === 'node_modules') {
          continue;
        }

        const itemPath = path.join(dirPath, item);
        const itemRelativePath = path.join(relativePath, item);
        const stat = await fs.promises.stat(itemPath);

        if (stat.isDirectory()) {
          const subFiles = await collectDirectoryFiles(itemPath, itemRelativePath, skipNodeModules);
          filesInDir.push(...subFiles);
        } else {
          filesInDir.push({
            sourcePath: itemPath,
            relativePath: itemRelativePath,
            size: stat.size
          });
        }
      }

      return filesInDir;
    };

    // Collect all agent files
    for (const agentPath of packageContents.agents) {
      const relativePath = path.relative(sourceBase, agentPath);
      const size = await getFileSize(agentPath);
      filesToCopy.push({
        sourcePath: agentPath,
        relativePath: relativePath,
        size: size,
        type: 'agent'
      });
      totalFiles++;
      totalBytes += size;
    }

    // Collect all skill files (skills are directories, need to traverse)
    for (const skillPath of packageContents.skills) {
      const baseRelativePath = path.relative(sourceBase, skillPath);
      const skillFiles = await collectDirectoryFiles(skillPath, baseRelativePath);

      for (const file of skillFiles) {
        filesToCopy.push({
          sourcePath: file.sourcePath,
          relativePath: file.relativePath,
          size: file.size,
          type: 'skill'
        });
        totalFiles++;
        totalBytes += file.size;
      }
    }

    // Collect all command files (for opencode/droid which use commands instead of skills)
    for (const commandPath of (packageContents.commands || [])) {
      const stat = await fs.promises.stat(commandPath);
      if (stat.isDirectory()) {
        // Command subdirectory (like docs-builder/)
        const baseRelativePath = path.relative(sourceBase, commandPath);
        const commandFiles = await collectDirectoryFiles(commandPath, baseRelativePath);
        for (const file of commandFiles) {
          filesToCopy.push({
            sourcePath: file.sourcePath,
            relativePath: file.relativePath,
            size: file.size,
            type: 'command'
          });
          totalFiles++;
          totalBytes += file.size;
        }
      } else {
        // Single command file
        const relativePath = path.relative(sourceBase, commandPath);
        const size = await getFileSize(commandPath);
        filesToCopy.push({
          sourcePath: commandPath,
          relativePath: relativePath,
          size: size,
          type: 'command'
        });
        totalFiles++;
        totalBytes += size;
      }
    }

    // Collect all resource files
    for (const resourcePath of packageContents.resources) {
      const relativePath = path.relative(sourceBase, resourcePath);
      const size = await getFileSize(resourcePath);
      filesToCopy.push({
        sourcePath: resourcePath,
        relativePath: relativePath,
        size: size,
        type: 'resource'
      });
      totalFiles++;
      totalBytes += size;
    }

    // Collect all hook files
    for (const hookPath of packageContents.hooks) {
      const relativePath = path.relative(sourceBase, hookPath);
      const size = await getFileSize(hookPath);
      filesToCopy.push({
        sourcePath: hookPath,
        relativePath: relativePath,
        size: size,
        type: 'hook'
      });
      totalFiles++;
      totalBytes += size;
    }

    // Collect all plugin files (plugins are directories like skills; skip node_modules)
    for (const pluginPath of (packageContents.plugins || [])) {
      const baseRelativePath = path.relative(sourceBase, pluginPath);
      const pluginFiles = await collectDirectoryFiles(pluginPath, baseRelativePath, true);

      for (const file of pluginFiles) {
        filesToCopy.push({
          sourcePath: file.sourcePath,
          relativePath: file.relativePath,
          size: file.size,
          type: 'plugin'
        });
        totalFiles++;
        totalBytes += file.size;
      }
    }

    // Now copy all files with progress tracking
    let filesCompleted = 0;
    let bytesTransferred = 0;

    for (const file of filesToCopy) {
      // Copy the file
      const targetFilePath = path.join(targetPath, file.relativePath);
      const targetDir = path.dirname(targetFilePath);

      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.copyFile(file.sourcePath, targetFilePath);

      // Track installed file for rollback
      this.sessionLog.installedFiles.push(targetFilePath);

      // Update progress
      filesCompleted++;
      bytesTransferred += file.size;

      // Save state after each file (for resume capability)
      if (this.stateManager && this.stateManager.getState()) {
        await this.stateManager.updateFileProgress(
          file.relativePath,
          file.size,
          totalFiles,
          totalBytes
        );
      }

      // Call progress callback if provided
      if (progressCallback) {
        const percentage = Math.round((filesCompleted / totalFiles) * 100);

        progressCallback({
          currentFile: file.relativePath,
          filesCompleted: filesCompleted,
          totalFiles: totalFiles,
          percentage: percentage,
          bytesTransferred: bytesTransferred,
          totalBytes: totalBytes
        });
      }
    }
  }

  /**
   * Copy directory recursively with progress tracking
   * (Legacy method - kept for backup/restore functionality)
   */
  async copyDirectory(source, target) {
    await fs.promises.mkdir(target, { recursive: true });
    const items = await fs.promises.readdir(source);

    for (const item of items) {
      // Skip node_modules - callers (plugins, backups) should never ship bundled deps
      if (item === 'node_modules') {
        continue;
      }

      const sourcePath = path.join(source, item);
      const targetPath = path.join(target, item);

      try {
        const stat = await fs.promises.lstat(sourcePath); // Use lstat to detect symlinks

        if (stat.isSymbolicLink()) {
          // Skip symlinks during backup
          continue;
        }

        if (stat.isDirectory()) {
          await this.copyDirectory(sourcePath, targetPath);
        } else if (stat.isFile()) {
          await fs.promises.copyFile(sourcePath, targetPath);
        }
      } catch (error) {
        // Skip files that can't be copied (permissions, special files, etc.)
        continue;
      }
    }
  }
  
  /**
   * Generate installation manifest with variant information
   *
   * Creates a comprehensive manifest including:
   * - Variant metadata (description, useCase, targetUsers)
   * - Lists of installed components by category
   * - Component counts and size information
   *
   * @param {string} toolId - Tool identifier
   * @param {string} variant - Variant name
   * @param {string} targetPath - Installation target path
   */
  async generateManifest(toolId, variant, targetPath) {
    const template = this.packageManager.getManifestTemplate(toolId);
    const contents = await this.packageManager.getPackageContents(toolId, variant);
    const size = await this.packageManager.getPackageSize(toolId, variant);
    const variantMetadata = await this.packageManager.getVariantMetadata(toolId, variant);

    // Extract filenames/directory names from paths for cleaner manifest
    // For agents: remove .md extension (e.g., "master.md" -> "master")
    // For skills: just basename (e.g., "pdf" directory)
    // For resources/hooks: keep full filename with extension
    const extractAgentName = (fullPath) => {
      const basename = path.basename(fullPath);
      return basename.replace(/\.md$/, '');
    };

    const extractSkillName = (fullPath) => {
      return path.basename(fullPath);
    };

    const manifest = {
      ...template,
      variant,
      // `version` is the MANIFEST SCHEMA version and always has been; the
      // liteagents release that wrote it is a separate field. Do not merge them.
      version: '1.1.0',
      liteagents_version: LITEAGENTS_VERSION,
      installed_at: new Date().toISOString(),
      variantInfo: {
        name: variantMetadata.name,
        description: variantMetadata.description,
        useCase: variantMetadata.useCase,
        targetUsers: variantMetadata.targetUsers
      },
      components: {
        agents: contents.agents.length,
        skills: contents.skills.length,
        resources: contents.resources.length,
        hooks: contents.hooks.length,
        plugins: (contents.plugins || []).length
      },
      installedFiles: {
        agents: contents.agents.map(extractAgentName),
        skills: contents.skills.map(extractSkillName),
        resources: contents.resources.map(p => path.basename(p)),
        hooks: contents.hooks.map(p => path.basename(p)),
        plugins: (contents.plugins || []).map(extractSkillName)
      },
      paths: {
        agents: path.join(targetPath, 'agents'),
        skills: path.join(targetPath, 'skills'),
        resources: path.join(targetPath, 'resources'),
        hooks: path.join(targetPath, 'hooks'),
        plugins: path.join(targetPath, 'plugins')
      },
      files: {
        total: contents.totalFiles,
        size: size.formattedSize
      }
    };

    const manifestPath = path.join(targetPath, 'manifest.json');
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2)
    );

    // Track manifest file for rollback
    if (this.sessionLog && this.sessionLog.installedFiles) {
      this.sessionLog.installedFiles.push(manifestPath);
    }
  }
  
  /**
   * Create backup of existing installation
   */
  async createBackup(targetPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${targetPath}.backup.${timestamp}`;
    
    try {
      await this.copyDirectory(targetPath, backupPath);

      this.backupLog.push({
        original: targetPath,
        backup: backupPath,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Silently continue if backup fails (e.g., special files, symlinks)
    }
  }
  
  /**
   * Rollback installation on failure
   * Enhanced to remove only installed files (not entire directory)
   * Preserves user-created files and restores from backup if available
   *
   * @param {string} toolId - Tool identifier
   * @param {string} targetPath - Installation target path
   */
  async rollbackInstallation(toolId, targetPath) {
    console.log(`Rolling back ${toolId} installation...`);

    let filesRemoved = 0;
    const errors = [];

    try {
      // Strategy 1: Remove files tracked in session log (most accurate)
      if (this.sessionLog &&
          this.sessionLog.installedFiles &&
          this.sessionLog.installedFiles.length > 0 &&
          this.sessionLog.targetPath === targetPath) {

        console.log(`Removing ${this.sessionLog.installedFiles.length} tracked files...`);

        // Remove files in reverse order (manifest first, then files)
        for (let i = this.sessionLog.installedFiles.length - 1; i >= 0; i--) {
          const filePath = this.sessionLog.installedFiles[i];

          try {
            if (fs.existsSync(filePath)) {
              await fs.promises.unlink(filePath);
              filesRemoved++;
            }
          } catch (error) {
            errors.push(`Failed to remove ${filePath}: ${error.message}`);
          }
        }

        // Clean up empty directories
        await this.cleanupEmptyDirectories(targetPath);

      }
      // Strategy 2: If no session log, try to read manifest and remove those files
      else {
        const manifestPath = path.join(targetPath, 'manifest.json');

        if (fs.existsSync(manifestPath)) {
          console.log(`Using manifest to determine files to remove...`);

          try {
            const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

            // Remove files listed in manifest
            if (manifest.installedFiles) {
              for (const category of ['agents', 'skills', 'resources', 'hooks', 'plugins']) {
                if (manifest.installedFiles[category] && manifest.paths && manifest.paths[category]) {
                  const categoryPath = manifest.paths[category];

                  for (const item of manifest.installedFiles[category]) {
                    let itemPath;

                    if (category === 'agents') {
                      // Agents have .md extension
                      itemPath = path.join(categoryPath, `${item}.md`);
                    } else if (category === 'skills' || category === 'plugins') {
                      // Skills and plugins are directories
                      itemPath = path.join(categoryPath, item);
                    } else {
                      // Resources and hooks have their full names
                      itemPath = path.join(categoryPath, item);
                    }

                    try {
                      if (fs.existsSync(itemPath)) {
                        const stat = await fs.promises.stat(itemPath);

                        if (stat.isDirectory()) {
                          // Remove directory recursively
                          await fs.promises.rm(itemPath, { recursive: true, force: true });
                          filesRemoved++;
                        } else {
                          // Remove file
                          await fs.promises.unlink(itemPath);
                          filesRemoved++;
                        }
                      }
                    } catch (error) {
                      errors.push(`Failed to remove ${itemPath}: ${error.message}`);
                    }
                  }
                }
              }
            }

            // Remove manifest
            try {
              await fs.promises.unlink(manifestPath);
              filesRemoved++;
            } catch (error) {
              errors.push(`Failed to remove manifest: ${error.message}`);
            }

            // Clean up empty directories
            await this.cleanupEmptyDirectories(targetPath);

          } catch (error) {
            console.warn(`Could not read manifest for rollback: ${error.message}`);
            // Fall back to Strategy 3
          }
        }

        // Strategy 3: If no manifest, restore from backup (legacy behavior)
        if (filesRemoved === 0) {
          const backup = this.backupLog.find(b => b.original === targetPath);

          if (backup && fs.existsSync(backup.backup)) {
            console.log(`Restoring from backup: ${backup.backup}`);

            // Remove current installation
            if (fs.existsSync(targetPath)) {
              await fs.promises.rm(targetPath, { recursive: true, force: true });
            }

            // Restore from backup
            await this.copyDirectory(backup.backup, targetPath);
            console.log(`Restored from backup: ${backup.backup}`);
          } else {
            console.warn(`No backup available and no manifest found. Cannot perform granular rollback.`);
          }
        }
      }

      // Log rollback action
      this.rollbackLog.push({
        tool: toolId,
        targetPath: targetPath,
        filesRemoved: filesRemoved,
        errors: errors,
        timestamp: new Date().toISOString()
      });

      if (errors.length > 0) {
        console.warn(`Rollback completed with ${errors.length} errors`);
      } else {
        console.log(`Rollback completed successfully. Removed ${filesRemoved} files.`);
      }

    } catch (error) {
      console.error(`Rollback failed: ${error.message}`);
      this.rollbackLog.push({
        tool: toolId,
        targetPath: targetPath,
        filesRemoved: filesRemoved,
        errors: [...errors, error.message],
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Clean up empty directories after file removal
   * Recursively removes empty subdirectories
   *
   * @param {string} targetPath - Base installation path
   */
  async cleanupEmptyDirectories(targetPath) {
    const categories = ['agents', 'skills', 'resources', 'hooks', 'plugins'];

    for (const category of categories) {
      const categoryPath = path.join(targetPath, category);

      if (fs.existsSync(categoryPath)) {
        await this.removeEmptyDirectoriesRecursive(categoryPath);

        // If category directory itself is now empty, remove it
        try {
          const items = await fs.promises.readdir(categoryPath);
          if (items.length === 0) {
            await fs.promises.rmdir(categoryPath);
          }
        } catch (error) {
          // Ignore errors (directory might not be empty or might not exist)
        }
      }
    }

    // If target path is now completely empty, remove it
    try {
      if (fs.existsSync(targetPath)) {
        const items = await fs.promises.readdir(targetPath);
        if (items.length === 0) {
          await fs.promises.rmdir(targetPath);
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Recursively remove empty directories
   *
   * @param {string} dirPath - Directory to check and clean
   */
  async removeEmptyDirectoriesRecursive(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const items = await fs.promises.readdir(dirPath);

    // Process subdirectories first
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = await fs.promises.stat(itemPath);

      if (stat.isDirectory()) {
        await this.removeEmptyDirectoriesRecursive(itemPath);

        // Check if subdirectory is now empty and remove it
        try {
          const subItems = await fs.promises.readdir(itemPath);
          if (subItems.length === 0) {
            await fs.promises.rmdir(itemPath);
          }
        } catch (error) {
          // Ignore errors
        }
      }
    }
  }
  
  /**
   * Get installation summary
   */
  getInstallationSummary() {
    return {
      installations: this.installationLog,
      backups: this.backupLog,
      totalTools: this.installationLog.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get session log (files installed in current session)
   */
  getSessionLog() {
    return this.sessionLog;
  }

  /**
   * Get rollback log (all rollback actions)
   */
  getRollbackLog() {
    return this.rollbackLog;
  }
  
  /**
   * Verify installation integrity
   * Performs comprehensive verification of installed files and directories
   *
   * @param {string} toolId - Tool identifier
   * @param {string} targetPath - Installation target path
   * @returns {object} Verification result with detailed status and issues
   */
  async verifyInstallation(toolId, targetPath) {
    const result = {
      valid: true,
      toolId: toolId,
      targetPath: targetPath,
      manifest: null,
      issues: [],
      warnings: [],
      components: {
        agents: { expected: 0, found: 0, missing: [] },
        skills: { expected: 0, found: 0, missing: [] },
        resources: { expected: 0, found: 0, missing: [] },
        hooks: { expected: 0, found: 0, missing: [] },
        plugins: { expected: 0, found: 0, missing: [] }
      },
      timestamp: new Date().toISOString()
    };

    const manifestPath = path.join(targetPath, 'manifest.json');

    // Check if manifest exists
    if (!fs.existsSync(manifestPath)) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        message: 'Manifest file not found',
        component: 'manifest'
      });
      return result;
    }

    try {
      // Read and parse manifest
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      result.manifest = manifest;

      // Verify all required directories exist (skip categories with 0 expected items)
      for (const [component, componentPath] of Object.entries(manifest.paths || {})) {
        const expectedCount = (manifest.installedFiles && Array.isArray(manifest.installedFiles[component]))
          ? manifest.installedFiles[component].length
          : 0;

        if (expectedCount === 0) {
          continue;
        }

        if (!fs.existsSync(componentPath)) {
          result.valid = false;
          result.issues.push({
            severity: 'error',
            message: `Missing component directory: ${component}`,
            component: component,
            path: componentPath
          });
        }
      }

      // Verify installed files for each component category
      for (const category of ['agents', 'skills', 'resources', 'hooks', 'plugins']) {
        if (manifest.installedFiles && manifest.installedFiles[category]) {
          const expectedFiles = manifest.installedFiles[category];
          result.components[category].expected = expectedFiles.length;

          const categoryPath = manifest.paths[category];

          for (const item of expectedFiles) {
            let itemPath;

            // Construct full path based on category
            if (category === 'agents') {
              itemPath = path.join(categoryPath, `${item}.md`);
            } else if (category === 'skills' || category === 'plugins') {
              itemPath = path.join(categoryPath, item);
            } else {
              itemPath = path.join(categoryPath, item);
            }

            // Check if file/directory exists
            if (fs.existsSync(itemPath)) {
              result.components[category].found++;
            } else {
              result.components[category].missing.push(item);
              result.issues.push({
                severity: 'error',
                message: `Missing ${category.slice(0, -1)}: ${item}`,
                component: category,
                item: item,
                path: itemPath
              });
              result.valid = false;
            }
          }
        }
      }

      // Check for extra warnings
      if (manifest.variant) {
        result.variant = manifest.variant;
      }

      if (manifest.version) {
        result.version = manifest.version;
      }

      // Verify file counts match
      if (manifest.components) {
        for (const category of ['agents', 'skills', 'resources', 'hooks', 'plugins']) {
          if (manifest.components[category] !== undefined) {
            const expectedCount = manifest.components[category];
            const foundCount = result.components[category].found;

            if (expectedCount !== foundCount) {
              result.warnings.push({
                severity: 'warning',
                message: `${category} count mismatch: expected ${expectedCount}, found ${foundCount}`,
                component: category
              });
            }
          }
        }
      }

      // Add overall summary
      result.summary = {
        totalExpected: Object.values(result.components).reduce((sum, c) => sum + c.expected, 0),
        totalFound: Object.values(result.components).reduce((sum, c) => sum + c.found, 0),
        totalMissing: Object.values(result.components).reduce((sum, c) => sum + c.missing.length, 0),
        issueCount: result.issues.length,
        warningCount: result.warnings.length
      };

      return result;

    } catch (error) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        message: `Manifest parsing error: ${error.message}`,
        component: 'manifest'
      });
      return result;
    }
  }

  /**
   * Get state manager (stub - state management removed)
   * @returns {Object} - Stub state manager
   */
  getStateManager() {
    return {
      initializeState: () => {},
      saveState: async () => {},
      getState: () => null,
      completeCurrentTool: async () => {},
      failCurrentTool: async () => {},
      clearState: async () => {},
      updateFileProgress: async () => {}
    };
  }

  /**
   * Check for interrupted installation (stub - always returns false)
   * @returns {Promise<boolean>}
   */
  async hasInterruptedInstallation() {
    return false;
  }

  /**
   * Get resume summary (stub - always returns null)
   * @returns {Promise<null>}
   */
  async getResumeSummary() {
    return null;
  }

  /**
   * Uninstall a tool by reading its manifest and removing installed files
   *
   * This method:
   * - Reads the manifest.json from the target path
   * - Prompts user for confirmation with file counts
   * - Creates a backup before uninstalling
   * - Removes all files listed in the manifest
   * - Cleans up empty directories
   * - Preserves user-created files not in the manifest
   * - Provides progress feedback during uninstall
   * - Returns a detailed uninstall report
   *
   * @param {string} toolId - Tool identifier (e.g., 'claude', 'opencode')
   * @param {string} targetPath - Installation target path
   * @param {function} confirmCallback - Async callback for user confirmation (returns boolean)
   * @param {function} progressCallback - Optional callback for progress updates
   * @returns {Object} - Uninstall result summary
   */
  async uninstall(toolId, targetPath, confirmCallback = null, progressCallback = null) {
    const expandedTargetPath = this.pathManager.expandPath(targetPath);
    const manifestPath = path.join(expandedTargetPath, 'manifest.json');

    const result = {
      success: false,
      toolId: toolId,
      targetPath: expandedTargetPath,
      filesRemoved: 0,
      directoriesRemoved: 0,
      backupPath: null,
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Step 1: Check if manifest exists
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`No installation found at ${expandedTargetPath}. Manifest file is missing.`);
      }

      // Step 2: Read and parse manifest
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));

      // Step 3: Calculate total files to remove
      let totalFiles = 0;
      const filesToRemove = [];

      // Collect all files from manifest
      if (manifest.installedFiles) {
        for (const category of ['agents', 'skills', 'resources', 'hooks', 'plugins']) {
          if (manifest.installedFiles[category] && manifest.paths && manifest.paths[category]) {
            const categoryPath = manifest.paths[category];

            for (const item of manifest.installedFiles[category]) {
              let itemPath;

              if (category === 'agents') {
                // Agents have .md extension
                itemPath = path.join(categoryPath, `${item}.md`);
              } else if (category === 'skills' || category === 'plugins') {
                // Skills and plugins are directories - need to count all files inside
                itemPath = path.join(categoryPath, item);
              } else {
                // Resources and hooks have their full names
                itemPath = path.join(categoryPath, item);
              }

              filesToRemove.push({
                path: itemPath,
                category: category,
                name: item,
                isDirectory: category === 'skills' || category === 'plugins'
              });
            }
          }
        }
      }

      // Count files (including files inside skill directories)
      for (const item of filesToRemove) {
        if (item.isDirectory && fs.existsSync(item.path)) {
          const fileCount = await this.countFilesInDirectory(item.path);
          totalFiles += fileCount;
        } else if (fs.existsSync(item.path)) {
          totalFiles += 1;
        }
      }

      // Add manifest itself
      totalFiles += 1;

      // Step 4: Prompt user for confirmation
      if (confirmCallback) {
        const confirmed = await confirmCallback({
          toolId: toolId,
          targetPath: expandedTargetPath,
          fileCount: totalFiles,
          variant: manifest.variant || 'unknown',
          components: manifest.components || {}
        });

        if (!confirmed) {
          result.success = false;
          result.warnings.push('Uninstall cancelled by user');
          return result;
        }
      }

      // Step 5: Create backup before uninstalling
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${expandedTargetPath}.uninstall-backup.${timestamp}`;

      try {
        await this.copyDirectory(expandedTargetPath, backupPath);
        result.backupPath = backupPath;
        console.log(`Backup created: ${backupPath}`);
      } catch (error) {
        // Silently continue if backup fails
      }

      // Step 6: Remove files with progress tracking
      let filesRemoved = 0;
      let directoriesRemoved = 0;

      for (const item of filesToRemove) {
        try {
          if (!fs.existsSync(item.path)) {
            result.warnings.push(`File not found: ${item.path}`);
            continue;
          }

          const stat = await fs.promises.stat(item.path);

          if (stat.isDirectory()) {
            // Remove directory recursively and track files
            const fileCount = await this.countFilesInDirectory(item.path);
            await fs.promises.rm(item.path, { recursive: true, force: true });
            filesRemoved += fileCount;
            directoriesRemoved += 1;

            // Report progress
            if (progressCallback) {
              progressCallback({
                type: 'removing',
                category: item.category,
                name: item.name,
                filesRemoved: filesRemoved,
                totalFiles: totalFiles,
                percentage: Math.round((filesRemoved / totalFiles) * 100)
              });
            }

            console.log(`Removing: ${item.category}/${item.name} (directory)`);

          } else {
            // Remove single file
            await fs.promises.unlink(item.path);
            filesRemoved += 1;

            // Report progress
            if (progressCallback) {
              progressCallback({
                type: 'removing',
                category: item.category,
                name: item.name,
                filesRemoved: filesRemoved,
                totalFiles: totalFiles,
                percentage: Math.round((filesRemoved / totalFiles) * 100)
              });
            }

            console.log(`Removing: ${item.category}/${item.name}`);
          }

        } catch (error) {
          result.errors.push(`Failed to remove ${item.path}: ${error.message}`);
        }
      }

      // Step 7: Remove manifest file
      try {
        await fs.promises.unlink(manifestPath);
        filesRemoved += 1;
        console.log(`Removing: manifest.json`);

        // Report final progress
        if (progressCallback) {
          progressCallback({
            type: 'removing',
            category: 'manifest',
            name: 'manifest.json',
            filesRemoved: filesRemoved,
            totalFiles: totalFiles,
            percentage: 100
          });
        }

      } catch (error) {
        result.errors.push(`Failed to remove manifest: ${error.message}`);
      }

      // Step 8: Clean up empty directories
      await this.cleanupEmptyDirectories(expandedTargetPath);

      // Count directories removed during cleanup
      const dirsRemoved = await this.countRemovedDirectories(expandedTargetPath);
      directoriesRemoved += dirsRemoved;

      // Step 9: Update result
      result.success = result.errors.length === 0;
      result.filesRemoved = filesRemoved;
      result.directoriesRemoved = directoriesRemoved;

      // Step 10: Display summary
      console.log(`\n✓ ${toolId} uninstalled successfully`);
      console.log(`  Files removed: ${filesRemoved}`);
      console.log(`  Directories removed: ${directoriesRemoved}`);
      if (result.backupPath) {
        console.log(`  Backup: ${result.backupPath}`);
      }

      if (result.errors.length > 0) {
        console.log(`\n⚠ Uninstall completed with ${result.errors.length} errors:`);
        result.errors.forEach(err => console.log(`  - ${err}`));
      }

      if (result.warnings.length > 0) {
        console.log(`\n⚠ Warnings:`);
        result.warnings.forEach(warn => console.log(`  - ${warn}`));
      }

      return result;

    } catch (error) {
      result.success = false;
      result.errors.push(error.message);
      console.error(`✗ Failed to uninstall ${toolId}: ${error.message}`);
      return result;
    }
  }

  /**
   * Count total files in a directory recursively
   *
   * @param {string} dirPath - Directory path
   * @returns {Promise<number>} - Total file count
   */
  async countFilesInDirectory(dirPath) {
    let count = 0;

    const items = await fs.promises.readdir(dirPath);

    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = await fs.promises.stat(itemPath);

      if (stat.isDirectory()) {
        count += await this.countFilesInDirectory(itemPath);
      } else {
        count += 1;
      }
    }

    return count;
  }

  /**
   * Count directories removed during cleanup
   * (Checks which category directories no longer exist)
   *
   * @param {string} targetPath - Base installation path
   * @returns {Promise<number>} - Number of directories removed
   */
  async countRemovedDirectories(targetPath) {
    let count = 0;
    const categories = ['agents', 'skills', 'resources', 'hooks'];

    for (const category of categories) {
      const categoryPath = path.join(targetPath, category);
      if (!fs.existsSync(categoryPath)) {
        count += 1;
      }
    }

    return count;
  }

  /**
   * Upgrade or downgrade variant of an installed tool
   *
   * Compares current and new variants, adds/removes files as needed,
   * creates backup, and verifies the result.
   *
   * @param {string} toolId - Tool identifier (claude, opencode, etc.)
   * @param {string} newVariant - Target variant (lite, standard, pro)
   * @param {string} targetPath - Installation directory path
   * @param {function} confirmCallback - Optional callback to confirm upgrade (receives summary, returns boolean)
   * @param {function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} - Upgrade result with success status, file counts, backup path
   */
  async upgradeVariant(toolId, newVariant, targetPath, confirmCallback = null, progressCallback = null) {
    const result = {
      success: false,
      fromVariant: null,
      toVariant: newVariant,
      filesAdded: 0,
      filesRemoved: 0,
      backupPath: null,
      verification: null,
      error: null
    };

    try {
      // Step 1: Read existing manifest to get current variant
      const manifestPath = path.join(targetPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        result.error = 'No installation found at target path (manifest.json missing)';
        return result;
      }

      const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);
      const currentVariant = manifest.variant;
      result.fromVariant = currentVariant;

      if (progressCallback) {
        progressCallback({ stage: 'reading_manifest', variant: currentVariant });
      }

      // Step 2: Check if same variant (no-op)
      if (currentVariant === newVariant) {
        result.success = true;
        result.verification = { valid: true, issues: [] };
        return result;
      }

      // Step 3: Get current and new variant contents
      const currentContents = await this.packageManager.getPackageContents(toolId, currentVariant);
      const newContents = await this.packageManager.getPackageContents(toolId, newVariant);

      if (progressCallback) {
        progressCallback({ stage: 'comparing_variants', from: currentVariant, to: newVariant });
      }

      // Step 4: Determine files to add and remove
      const changes = this._compareVariantContents(currentContents, newContents);

      // Step 5: Call confirm callback if provided
      if (confirmCallback) {
        const confirmData = {
          fromVariant: currentVariant,
          toVariant: newVariant,
          filesAdded: changes.toAdd.length,
          filesRemoved: changes.toRemove.length,
          filesToAdd: changes.toAdd,
          filesToRemove: changes.toRemove
        };

        const confirmed = confirmCallback(confirmData);
        if (!confirmed) {
          result.error = 'Upgrade cancelled by user';
          return result;
        }
      }

      // Step 6: Create backup before changes
      if (progressCallback) {
        progressCallback({ stage: 'creating_backup' });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${targetPath}.upgrade-backup.${timestamp}`;
      await this.copyDirectory(targetPath, backupPath);
      result.backupPath = backupPath;

      // Step 7: Remove files (for downgrade)
      if (changes.toRemove.length > 0) {
        if (progressCallback) {
          progressCallback({ stage: 'removing_files', count: changes.toRemove.length });
        }

        await this._removeVariantFiles(targetPath, changes.toRemove, manifest, progressCallback);
        result.filesRemoved = changes.toRemove.length;
      }

      // Step 8: Add files (for upgrade)
      if (changes.toAdd.length > 0) {
        if (progressCallback) {
          progressCallback({ stage: 'adding_files', count: changes.toAdd.length });
        }

        const sourceBase = path.join(this.packageManager.packagesDir, toolId);
        await this._addVariantFiles(sourceBase, targetPath, changes.toAdd, progressCallback);
        result.filesAdded = changes.toAdd.length;
      }

      // Step 9: Ensure all category directories exist (even if empty)
      const categories = ['agents', 'skills', 'resources', 'hooks'];
      for (const category of categories) {
        const categoryPath = path.join(targetPath, category);
        if (!fs.existsSync(categoryPath)) {
          await fs.promises.mkdir(categoryPath, { recursive: true });
        }
      }

      // Step 10: Update manifest with new variant information
      if (progressCallback) {
        progressCallback({ stage: 'updating_manifest' });
      }

      await this.generateManifest(toolId, newVariant, targetPath);

      // Step 11: Verify the upgraded installation
      if (progressCallback) {
        progressCallback({ stage: 'verifying' });
      }

      const verification = await this.verifyInstallation(toolId, targetPath);
      result.verification = verification;

      if (!verification.valid) {
        result.error = 'Verification failed after upgrade';
        result.success = false;
        return result;
      }

      result.success = true;

      if (progressCallback) {
        progressCallback({ stage: 'complete', success: true });
      }

      return result;

    } catch (error) {
      result.error = error.message;
      result.success = false;
      return result;
    }
  }

  /**
   * Compare two variant contents to determine what files need to be added or removed
   * @private
   */
  _compareVariantContents(currentContents, newContents) {
    const toAdd = [];
    const toRemove = [];

    // Helper to extract basenames for comparison
    const getBasename = (filePath) => path.basename(filePath).replace(/\.md$/, '');

    // Compare agents
    const currentAgents = new Set(currentContents.agents.map(getBasename));
    const newAgents = new Set(newContents.agents.map(getBasename));

    for (const agent of newContents.agents) {
      const basename = getBasename(agent);
      if (!currentAgents.has(basename)) {
        // Agent files have .md extension
        toAdd.push({ type: 'agent', source: agent, name: path.basename(agent) });
      }
    }

    for (const agent of currentContents.agents) {
      const basename = getBasename(agent);
      if (!newAgents.has(basename)) {
        toRemove.push({ type: 'agent', name: path.basename(agent), category: 'agents' });
      }
    }

    // Compare skills (directories)
    const currentSkills = new Set(currentContents.skills.map(p => path.basename(p)));
    const newSkills = new Set(newContents.skills.map(p => path.basename(p)));

    for (const skill of newContents.skills) {
      const basename = path.basename(skill);
      if (!currentSkills.has(basename)) {
        toAdd.push({ type: 'skill', source: skill, name: basename });
      }
    }

    for (const skill of currentContents.skills) {
      const basename = path.basename(skill);
      if (!newSkills.has(basename)) {
        toRemove.push({ type: 'skill', name: basename, category: 'skills' });
      }
    }

    // Compare resources
    const currentResources = new Set(currentContents.resources.map(p => path.basename(p)));
    const newResources = new Set(newContents.resources.map(p => path.basename(p)));

    for (const resource of newContents.resources) {
      const basename = path.basename(resource);
      if (!currentResources.has(basename)) {
        toAdd.push({ type: 'resource', source: resource, name: basename });
      }
    }

    for (const resource of currentContents.resources) {
      const basename = path.basename(resource);
      if (!newResources.has(basename)) {
        toRemove.push({ type: 'resource', name: basename, category: 'resources' });
      }
    }

    // Compare hooks
    const currentHooks = new Set(currentContents.hooks.map(p => path.basename(p)));
    const newHooks = new Set(newContents.hooks.map(p => path.basename(p)));

    for (const hook of newContents.hooks) {
      const basename = path.basename(hook);
      if (!currentHooks.has(basename)) {
        toAdd.push({ type: 'hook', source: hook, name: basename });
      }
    }

    for (const hook of currentContents.hooks) {
      const basename = path.basename(hook);
      if (!newHooks.has(basename)) {
        toRemove.push({ type: 'hook', name: basename, category: 'hooks' });
      }
    }

    // Compare plugins (directories, like skills)
    const currentPluginsList = currentContents.plugins || [];
    const newPluginsList = newContents.plugins || [];
    const currentPlugins = new Set(currentPluginsList.map(p => path.basename(p)));
    const newPlugins = new Set(newPluginsList.map(p => path.basename(p)));

    for (const plugin of newPluginsList) {
      const basename = path.basename(plugin);
      if (!currentPlugins.has(basename)) {
        toAdd.push({ type: 'plugin', source: plugin, name: basename });
      }
    }

    for (const plugin of currentPluginsList) {
      const basename = path.basename(plugin);
      if (!newPlugins.has(basename)) {
        toRemove.push({ type: 'plugin', name: basename, category: 'plugins' });
      }
    }

    return { toAdd, toRemove };
  }

  /**
   * Remove files during variant downgrade
   * Only removes files that are in the manifest (never removes user-created files)
   * @private
   */
  async _removeVariantFiles(targetPath, filesToRemove, manifest, progressCallback = null) {
    const manifestFiles = {
      agents: new Set(manifest.installedFiles.agents),
      skills: new Set(manifest.installedFiles.skills),
      resources: new Set(manifest.installedFiles.resources),
      hooks: new Set(manifest.installedFiles.hooks),
      plugins: new Set(manifest.installedFiles.plugins || [])
    };

    for (const file of filesToRemove) {
      // Only remove if it's in the manifest (not user-created)
      const fileNameWithoutExt = file.name.replace(/\.md$/, '');
      const isInManifest = manifestFiles[file.category] &&
                          (manifestFiles[file.category].has(file.name) ||
                           manifestFiles[file.category].has(fileNameWithoutExt));

      if (!isInManifest) {
        // Skip user-created files
        continue;
      }

      const filePath = path.join(targetPath, file.category, file.name);

      if (fs.existsSync(filePath)) {
        const stat = await fs.promises.stat(filePath);

        if (stat.isDirectory()) {
          // Remove directory and all contents
          await fs.promises.rm(filePath, { recursive: true, force: true });
        } else {
          // Remove file
          await fs.promises.unlink(filePath);
        }

        if (progressCallback) {
          progressCallback({ stage: 'removing_file', file: file.name, category: file.category });
        }
      }
    }

    // Clean up empty directories
    await this.cleanupEmptyDirectories(targetPath);
  }

  /**
   * Add files during variant upgrade
   * @private
   */
  async _addVariantFiles(sourceBase, targetPath, filesToAdd, progressCallback = null) {
    for (const file of filesToAdd) {
      const sourcePath = file.source;
      const targetCategory = file.type === 'agent' ? 'agents' :
                            file.type === 'skill' ? 'skills' :
                            file.type === 'resource' ? 'resources' :
                            file.type === 'plugin' ? 'plugins' : 'hooks';

      const targetDir = path.join(targetPath, targetCategory);

      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true });
      }

      const targetFilePath = path.join(targetDir, file.name);

      // Check if it's a directory (skills are directories)
      const sourceStat = await fs.promises.stat(sourcePath);

      if (sourceStat.isDirectory()) {
        // Create target directory first, then copy contents
        await fs.promises.mkdir(targetFilePath, { recursive: true });
        await this.copyDirectory(sourcePath, targetFilePath);
      } else {
        // Copy single file
        await fs.promises.copyFile(sourcePath, targetFilePath);
      }

      if (progressCallback) {
        progressCallback({ stage: 'adding_file', file: file.name, category: targetCategory });
      }
    }
  }
}

module.exports = InstallationEngine;