/**
 * Package Manager for Agentic Kit Installer
 * 
 * Manages tool-specific variant packages and content selection
 */

const fs = require('fs');
const path = require('path');

class PackageManager {
  constructor() {
    this.packagesDir = path.join(__dirname, '..', 'packages');
    this.variants = ['pro'];
    this.tools = ['claude', 'opencode', 'ampcode', 'droid'];
    this.variantConfigCache = {}; // Cache for loaded variant configurations
  }

  /**
   * Load and parse variants.json for a specific tool
   * @param {string} toolId - Tool identifier (claude, opencode, ampcode, droid)
   * @returns {Promise<Object>} Parsed variant configuration
   * @throws {Error} If file not found, invalid JSON, or missing required variants
   */
  async loadVariantConfig(toolId) {
    // Return cached configuration if available
    if (this.variantConfigCache[toolId]) {
      return this.variantConfigCache[toolId];
    }

    const variantsFilePath = path.join(this.packagesDir, toolId, 'variants.json');

    // Check if variants.json exists
    if (!fs.existsSync(variantsFilePath)) {
      throw new Error(`Variants file not found for tool: ${toolId}`);
    }

    // Read and parse JSON with security checks
    let config;
    try {
      // Check file size before reading (max 1MB to prevent DoS)
      const stats = await fs.promises.stat(variantsFilePath);
      const maxSize = 1024 * 1024; // 1MB
      if (stats.size > maxSize) {
        throw new Error(`Variants file for tool ${toolId} is too large (${stats.size} bytes, max ${maxSize} bytes)`);
      }

      const fileContent = await fs.promises.readFile(variantsFilePath, 'utf8');

      // Check for null bytes (security risk)
      if (fileContent.includes('\0')) {
        throw new Error(`Variants file for tool ${toolId} contains null bytes (security risk)`);
      }

      config = JSON.parse(fileContent);

      // Validate config is an object (not array or primitive)
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new Error(`Variants file for tool ${toolId} must contain a JSON object`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in variants.json for tool ${toolId}: ${error.message}`);
      }
      throw error;
    }

    // Validate required variants exist
    const requiredVariants = ['pro'];
    for (const variant of requiredVariants) {
      if (!config[variant]) {
        throw new Error(`Required variant '${variant}' not found in variants.json for tool ${toolId}`);
      }
    }

    // Validate each variant has required fields
    // Note: 'skills', 'commands', 'resources', 'hooks' are optional
    for (const variant of requiredVariants) {
      const variantConfig = config[variant];
      const requiredFields = ['name', 'description', 'agents'];

      for (const field of requiredFields) {
        if (variantConfig[field] === undefined) {
          throw new Error(`Required field '${field}' missing in '${variant}' variant for tool ${toolId}`);
        }
      }
    }

    // Cache the configuration
    this.variantConfigCache[toolId] = config;

    return config;
  }

  /**
   * Get metadata for a specific variant
   * @param {string} toolId - Tool identifier
   * @param {string} variant - Variant name (lite, standard, pro)
   * @returns {Promise<Object>} Variant metadata (name, description, useCase, targetUsers)
   * @throws {Error} If variant not found
   */
  async getVariantMetadata(toolId, variant) {
    const config = await this.loadVariantConfig(toolId);

    if (!config[variant]) {
      throw new Error(`Variant '${variant}' not found for tool ${toolId}`);
    }

    const variantConfig = config[variant];

    return {
      name: variantConfig.name,
      description: variantConfig.description,
      useCase: variantConfig.useCase,
      targetUsers: variantConfig.targetUsers
    };
  }

  /**
   * Select content based on variant configuration
   * @param {string} toolId - Tool identifier (claude, opencode, ampcode, droid)
   * @param {string} variant - Variant name (lite, standard, pro)
   * @param {Object} availableContent - Object with arrays of available agents, skills, resources, hooks
   * @returns {Promise<Object>} Object with filtered arrays of selected content
   * @throws {Error} If variant not found or specified items don't exist
   */
  async selectVariantContent(toolId, variant, availableContent) {
    // Load variant configuration
    const config = await this.loadVariantConfig(toolId);

    if (!config[variant]) {
      throw new Error(`Variant '${variant}' not found for tool ${toolId}`);
    }

    const variantConfig = config[variant];
    const selected = {
      agents: [],
      skills: [],
      commands: [],
      resources: [],
      hooks: [],
      plugins: []
    };

    // Helper function to process each content category
    const selectItems = (category, variantSelection, availableItems, skipMissing = false) => {
      // Handle wildcard: "*" expands to all available items
      if (variantSelection === '*') {
        return [...availableItems];
      }

      // Handle array selection (specific items or empty array)
      if (Array.isArray(variantSelection)) {
        // Empty array [] means no items selected
        if (variantSelection.length === 0) {
          return [];
        }

        // Specific selection: validate all items exist (unless skipMissing)
        const selectedItems = [];
        for (const item of variantSelection) {
          if (!availableItems.includes(item)) {
            if (skipMissing) {
              // Skip missing items silently (e.g., removed commands like subagent-spawning)
              continue;
            }
            throw new Error(
              `Item '${item}' specified in ${variant} variant ${category} not found in available content. ` +
              `Available ${category}: ${availableItems.join(', ')}`
            );
          }
          selectedItems.push(item);
        }
        return selectedItems;
      }

      // If neither wildcard nor array, treat as empty selection
      return [];
    };

    // Process each content category
    selected.agents = selectItems('agents', variantConfig.agents, availableContent.agents || []);
    selected.skills = selectItems('skills', variantConfig.skills, availableContent.skills || []);
    selected.commands = selectItems('commands', variantConfig.commands, availableContent.commands || [], true);
    selected.resources = selectItems('resources', variantConfig.resources, availableContent.resources || []);
    selected.hooks = selectItems('hooks', variantConfig.hooks, availableContent.hooks || []);
    selected.plugins = selectItems('plugins', variantConfig.plugins, availableContent.plugins || []);

    return selected;
  }

  /**
   * Get available variants for a tool
   */
  getAvailableVariants(toolId) {
    const toolDir = path.join(this.packagesDir, toolId);
    
    if (!fs.existsSync(toolDir)) {
      return [];
    }
    
    return this.variants.filter(variant => {
      const variantDir = path.join(toolDir, variant);
      return fs.existsSync(variantDir);
    });
  }
  
  /**
   * Get package contents for a specific tool and variant
   * Uses variant filtering to return only selected content based on variants.json
   */
  async getPackageContents(toolId, variant) {
    // Use base package directory (not variant-specific)
    const packageDir = path.join(this.packagesDir, toolId);

    if (!fs.existsSync(packageDir)) {
      throw new Error(`Package not found: ${toolId}`);
    }

    // Get all available content from the package (includes dynamic directory names)
    const availableContent = await this.getAvailableContent(packageDir);

    // Use selectVariantContent to filter based on variant configuration
    const selectedContent = await this.selectVariantContent(toolId, variant, availableContent);

    // Get file paths for selected content
    const contents = {
      agents: [],
      skills: [],
      commands: [],
      resources: [],
      hooks: [],
      plugins: [],
      totalFiles: 0,
      totalSize: 0
    };

    // Build file paths for selected agents (use dynamic directory name)
    const agentsDirName = availableContent.agentsDir || 'agents';
    const agentsDir = path.join(packageDir, agentsDirName);
    if (fs.existsSync(agentsDir)) {
      for (const agent of selectedContent.agents) {
        const agentPath = path.join(agentsDir, `${agent}.md`);
        if (fs.existsSync(agentPath)) {
          contents.agents.push(agentPath);
        }
      }
    }

    // Build directory paths for selected skills (skills are directories)
    const skillsDir = path.join(packageDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      for (const skill of selectedContent.skills) {
        const skillPath = path.join(skillsDir, skill);
        if (fs.existsSync(skillPath)) {
          // Store the skill directory path (not individual files within it)
          // The installation engine will handle copying the entire directory
          contents.skills.push(skillPath);
        }
      }
    }

    // Build file paths for selected commands (use dynamic directory name)
    const commandsDirName = availableContent.commandsDir || 'commands';
    const commandsDir = path.join(packageDir, commandsDirName);
    if (fs.existsSync(commandsDir) && selectedContent.commands) {
      for (const command of selectedContent.commands) {
        const commandPath = path.join(commandsDir, `${command}.md`);
        if (fs.existsSync(commandPath)) {
          contents.commands.push(commandPath);
        }
        // Also check for command subdirectories (like docs-builder/templates.md)
        const commandSubDir = path.join(commandsDir, command);
        if (fs.existsSync(commandSubDir) && fs.statSync(commandSubDir).isDirectory()) {
          contents.commands.push(commandSubDir);
        }
      }
    }

    // Build file paths for selected resources
    const resourcesDir = path.join(packageDir, 'resources');
    if (fs.existsSync(resourcesDir)) {
      for (const resource of selectedContent.resources) {
        const resourcePath = path.join(resourcesDir, resource);
        if (fs.existsSync(resourcePath)) {
          contents.resources.push(resourcePath);
        }
      }
    }

    // Build file paths for selected hooks
    const hooksDir = path.join(packageDir, 'hooks');
    if (fs.existsSync(hooksDir)) {
      for (const hook of selectedContent.hooks) {
        const hookPath = path.join(hooksDir, hook);
        if (fs.existsSync(hookPath)) {
          contents.hooks.push(hookPath);
        }
      }
    }

    // Build directory paths for selected plugins (plugins are directories, like skills)
    const pluginsDir = path.join(packageDir, 'plugins');
    if (fs.existsSync(pluginsDir)) {
      for (const plugin of (selectedContent.plugins || [])) {
        const pluginPath = path.join(pluginsDir, plugin);
        if (fs.existsSync(pluginPath)) {
          contents.plugins.push(pluginPath);
        }
      }
    }

    // Calculate total files
    contents.totalFiles = contents.agents.length +
                         contents.skills.length +
                         contents.commands.length +
                         contents.resources.length +
                         contents.hooks.length +
                         contents.plugins.length;

    return contents;
  }

  /**
   * Get all available content from a package directory
   * Helper method for getPackageContents
   */
  async getAvailableContent(packageDir) {
    const getItemsInDir = async (dir, isAgentDir = false) => {
      if (!fs.existsSync(dir)) return { items: [], dirName: null };
      const items = await fs.promises.readdir(dir);
      const result = [];

      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = await fs.promises.stat(itemPath);

        if (stat.isFile()) {
          // For agents, strip the .md extension
          if (isAgentDir) {
            result.push(item.replace('.md', ''));
          } else if (dir.includes('resources') || dir.includes('hooks')) {
            // For resources and hooks, keep the full filename
            result.push(item);
          }
          // For skills directory, ignore files (only directories are skills)
        } else if (stat.isDirectory()) {
          // For skills (which are directories), include the directory name
          result.push(item);
        }
      }

      return { items: result, dirName: path.basename(dir) };
    };

    // Check for both plural and singular directory names
    const agentsDir = fs.existsSync(path.join(packageDir, 'agents')) ? 'agents' :
                      fs.existsSync(path.join(packageDir, 'agent')) ? 'agent' :
                      fs.existsSync(path.join(packageDir, 'droids')) ? 'droids' : 'agents';
    const commandsDir = fs.existsSync(path.join(packageDir, 'commands')) ? 'commands' :
                        fs.existsSync(path.join(packageDir, 'command')) ? 'command' : 'commands';

    const agentsResult = await getItemsInDir(path.join(packageDir, agentsDir), true);
    const skillsResult = await getItemsInDir(path.join(packageDir, 'skills'));
    const commandsResult = await getItemsInDir(path.join(packageDir, commandsDir), true);
    const resourcesResult = await getItemsInDir(path.join(packageDir, 'resources'));
    const hooksResult = await getItemsInDir(path.join(packageDir, 'hooks'));
    const pluginsResult = await getItemsInDir(path.join(packageDir, 'plugins'));

    return {
      agents: agentsResult.items,
      agentsDir: agentsDir,
      skills: skillsResult.items,
      commands: commandsResult.items,
      commandsDir: commandsDir,
      resources: resourcesResult.items,
      hooks: hooksResult.items,
      plugins: pluginsResult.items
    };
  }
  
  /**
   * Count files in a directory recursively
   */
  async countFiles(dir) {
    const files = [];
    
    async function traverse(currentDir) {
      const items = await fs.promises.readdir(currentDir);
      
      for (const item of items) {
        const itemPath = path.join(currentDir, item);
        const stat = await fs.promises.stat(itemPath);
        
        if (stat.isDirectory()) {
          await traverse(itemPath);
        } else {
          files.push(itemPath);
        }
      }
    }
    
    await traverse(dir);
    return files;
  }
  
  /**
   * Get package size information based on variant-filtered content
   * @param {string} toolId - Tool identifier (claude, opencode, ampcode, droid)
   * @param {string} variant - Variant name (lite, standard, pro)
   * @returns {Promise<Object>} Object with size (bytes) and formattedSize
   */
  async getPackageSize(toolId, variant) {
    // Get variant-filtered package contents
    const contents = await this.getPackageContents(toolId, variant);

    let totalSize = 0;

    // Helper function to calculate size of a file or directory recursively
    // Skips node_modules directories (plugins may have local installs)
    const calculatePathSize = async (itemPath) => {
      try {
        const stat = await fs.promises.stat(itemPath);

        if (stat.isFile()) {
          return stat.size;
        } else if (stat.isDirectory()) {
          // Skip node_modules to avoid bundling local dependencies
          if (path.basename(itemPath) === 'node_modules') {
            return 0;
          }

          // Recursively calculate directory size
          let dirSize = 0;
          const items = await fs.promises.readdir(itemPath);

          for (const item of items) {
            const subPath = path.join(itemPath, item);
            dirSize += await calculatePathSize(subPath);
          }

          return dirSize;
        }
      } catch (error) {
        // Skip files that don't exist or can't be accessed
        return 0;
      }

      return 0;
    };

    // Calculate size for all selected agents (files)
    for (const agentPath of contents.agents) {
      totalSize += await calculatePathSize(agentPath);
    }

    // Calculate size for all selected skills (directories)
    for (const skillPath of contents.skills) {
      totalSize += await calculatePathSize(skillPath);
    }

    // Calculate size for all selected resources (files)
    for (const resourcePath of contents.resources) {
      totalSize += await calculatePathSize(resourcePath);
    }

    // Calculate size for all selected hooks (files)
    for (const hookPath of contents.hooks) {
      totalSize += await calculatePathSize(hookPath);
    }

    // Calculate size for all selected plugins (directories, excluding node_modules)
    for (const pluginPath of (contents.plugins || [])) {
      totalSize += await calculatePathSize(pluginPath);
    }

    return {
      size: totalSize,
      formattedSize: this.formatBytes(totalSize)
    };
  }
  
  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Validate package integrity with variant support
   * Checks variants.json exists and is valid, and validates that variant-selected content exists
   * @param {string} toolId - Tool identifier (claude, opencode, ampcode, droid)
   * @param {string} variant - Variant name (lite, standard, pro)
   * @returns {Promise<Object>} Validation result with detailed information
   */
  async validatePackage(toolId, variant) {
    const packageDir = path.join(this.packagesDir, toolId);
    const issues = [];
    let checkedFiles = 0;
    let missingFiles = 0;

    // Check 1: Package directory exists
    if (!fs.existsSync(packageDir)) {
      return {
        valid: false,
        error: 'Package directory not found',
        issues: [`Package directory not found: ${packageDir}`],
        checkedFiles: 0,
        missingFiles: 0
      };
    }

    // Check 2: variants.json exists
    const variantsFilePath = path.join(packageDir, 'variants.json');
    if (!fs.existsSync(variantsFilePath)) {
      return {
        valid: false,
        error: 'variants.json file not found',
        issues: [`variants.json file not found in package: ${toolId}`],
        checkedFiles: 0,
        missingFiles: 0
      };
    }

    // Check 3: variants.json is valid JSON
    let config;
    try {
      config = await this.loadVariantConfig(toolId);
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        issues: [`Invalid variants.json: ${error.message}`],
        checkedFiles: 0,
        missingFiles: 0
      };
    }

    // Check 4: Required variant is present (pro)
    const requiredVariants = ['pro'];
    for (const reqVariant of requiredVariants) {
      if (!config[reqVariant]) {
        return {
          valid: false,
          error: `Required variant '${reqVariant}' not found`,
          issues: [`Required variant '${reqVariant}' not found in variants.json`],
          checkedFiles: 0,
          missingFiles: 0
        };
      }
    }

    // Check 5: Each variant has required fields
    // Note: 'skills', 'commands', 'resources', 'hooks' are optional
    const requiredFields = ['name', 'description', 'agents'];
    for (const reqVariant of requiredVariants) {
      const variantConfig = config[reqVariant];
      for (const field of requiredFields) {
        if (variantConfig[field] === undefined) {
          return {
            valid: false,
            error: `Required field '${field}' missing in '${reqVariant}' variant`,
            issues: [`Required field '${field}' missing in '${reqVariant}' variant`],
            checkedFiles: 0,
            missingFiles: 0
          };
        }
      }
    }

    // Check 6: Validate that variant-selected content actually exists
    try {
      // Get available content
      const availableContent = await this.getAvailableContent(packageDir);

      // Get selected content for the specified variant
      const selectedContent = await this.selectVariantContent(toolId, variant, availableContent);

      // Helper function to check if file/directory exists
      const checkContentExists = async (category, items, dirName, addExtension = false) => {
        const categoryDir = path.join(packageDir, dirName);

        // If directory doesn't exist but items are expected, that's an issue
        if (items.length > 0 && !fs.existsSync(categoryDir)) {
          issues.push(`Directory '${dirName}' not found but ${category} are selected in ${variant} variant`);
          missingFiles += items.length;
          checkedFiles += items.length;
          return;
        }

        // Check each item
        for (const item of items) {
          checkedFiles++;
          let itemPath;

          if (addExtension) {
            // For agents, add .md extension
            itemPath = path.join(categoryDir, `${item}.md`);
          } else if (dirName === 'skills') {
            // For skills, check directory exists
            itemPath = path.join(categoryDir, item);
          } else {
            // For resources and hooks, use filename as-is
            itemPath = path.join(categoryDir, item);
          }

          if (!fs.existsSync(itemPath)) {
            const displayPath = addExtension ? `${item}.md` : item;
            issues.push(`${category.slice(0, -1)} '${displayPath}' not found in ${dirName}/ (required by ${variant} variant)`);
            missingFiles++;
          }
        }
      };

      // Validate agents (use dynamic directory name)
      const agentsDirName = availableContent.agentsDir || 'agents';
      await checkContentExists('agents', selectedContent.agents, agentsDirName, true);

      // Validate skills (directories)
      await checkContentExists('skills', selectedContent.skills || [], 'skills', false);

      // Validate commands (use dynamic directory name)
      const commandsDirName = availableContent.commandsDir || 'commands';
      await checkContentExists('commands', selectedContent.commands || [], commandsDirName, true);

      // Validate plugins (directories, like skills)
      await checkContentExists('plugins', selectedContent.plugins || [], 'plugins', false);

    } catch (error) {
      return {
        valid: false,
        error: error.message,
        issues: [`Content validation failed: ${error.message}`],
        checkedFiles,
        missingFiles
      };
    }

    // Final result
    const valid = issues.length === 0;

    return {
      valid,
      issues,
      checkedFiles,
      missingFiles,
      ...(valid ? {} : { error: `Package validation failed: ${issues.length} issue(s) found` })
    };
  }
  
  /**
   * Get tool-specific manifest template
   */
  getManifestTemplate(toolId) {
    const templatePath = path.join(__dirname, '..', 'tools', toolId, 'manifest-template.json');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Manifest template not found for tool: ${toolId}`);
    }
    
    return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  }
}

module.exports = PackageManager;