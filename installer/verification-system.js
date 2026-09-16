/**
 * Verification System for liteagents Installer
 * 
 * Validates installations, checks dependencies, and ensures system integrity
 */

const fs = require('fs');
const path = require('path');

class VerificationSystem {
  constructor(pathManager, packageManager) {
    this.pathManager = pathManager;
    this.packageManager = packageManager;
    this.verificationResults = [];
  }
  
  /**
   * Verify complete installation
   */
  async verifyInstallation(toolId, variant, targetPath) {
    const result = {
      tool: toolId,
      variant,
      targetPath,
      valid: true,
      errors: [],
      warnings: [],
      checks: {}
    };
    
    try {
      // Check manifest exists and is valid
      result.checks.manifest = await this.verifyManifest(targetPath);
      if (!result.checks.manifest.valid) {
        result.valid = false;
        result.errors.push(`Manifest: ${result.checks.manifest.error}`);
      }
      
      // Check directory structure
      result.checks.structure = await this.verifyDirectoryStructure(targetPath);
      if (!result.checks.structure.valid) {
        result.valid = false;
        result.errors.push(`Structure: ${result.checks.structure.error}`);
      }
      
      // Check file integrity
      result.checks.files = await this.verifyFileIntegrity(toolId, variant, targetPath);
      if (!result.checks.files.valid) {
        result.valid = false;
        result.errors.push(`Files: ${result.checks.files.error}`);
      }
      
      // Check permissions
      result.checks.permissions = await this.verifyPermissions(targetPath);
      if (!result.checks.permissions.valid) {
        result.warnings.push(`Permissions: ${result.checks.permissions.error}`);
      }
      
      // Check tool compatibility
      result.checks.compatibility = await this.verifyToolCompatibility(toolId, targetPath);
      if (!result.checks.compatibility.valid) {
        result.warnings.push(`Compatibility: ${result.checks.compatibility.error}`);
      }
      
    } catch (error) {
      result.valid = false;
      result.errors.push(`Verification error: ${error.message}`);
    }
    
    this.verificationResults.push(result);
    return result;
  }
  
  /**
   * Verify manifest file
   */
  async verifyManifest(targetPath) {
    const manifestPath = path.join(targetPath, 'manifest.json');
    
    try {
      if (!fs.existsSync(manifestPath)) {
        return { valid: false, error: 'Manifest file not found' };
      }
      
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      
      // Required fields
      const requiredFields = ['tool', 'variant', 'version', 'installed_at', 'components'];
      for (const field of requiredFields) {
        if (!manifest[field]) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }
      
      // Validate components
      if (typeof manifest.components !== 'object') {
        return { valid: false, error: 'Invalid components format' };
      }
      
      return { valid: true, manifest };
      
    } catch (error) {
      return { valid: false, error: `Manifest parsing error: ${error.message}` };
    }
  }
  
  /**
   * Verify directory structure
   */
  async verifyDirectoryStructure(targetPath) {
    const requiredDirs = ['agents'];
    const optionalDirs = ['skills', 'resources', 'hooks'];
    
    try {
      // Check target directory exists
      if (!fs.existsSync(targetPath)) {
        return { valid: false, error: 'Target directory not found' };
      }
      
      // Check required directories
      for (const dir of requiredDirs) {
        const dirPath = path.join(targetPath, dir);
        if (!fs.existsSync(dirPath)) {
          return { valid: false, error: `Required directory missing: ${dir}` };
        }
      }
      
      // Check agents directory has content
      const agentsDir = path.join(targetPath, 'agents');
      const agentFiles = await fs.promises.readdir(agentsDir);
      
      if (agentFiles.length === 0) {
        return { valid: false, error: 'Agents directory is empty' };
      }
      
      return { valid: true };
      
    } catch (error) {
      return { valid: false, error: `Structure check error: ${error.message}` };
    }
  }
  
  /**
   * Verify file integrity
   */
  async verifyFileIntegrity(toolId, variant, targetPath) {
    try {
      const expectedContents = await this.packageManager.getPackageContents(toolId, variant);
      const actualContents = await this.countFilesInDirectory(targetPath);
      
      // Check if we have approximately the right number of files
      const tolerance = 5; // Allow some variance for manifest files
      if (Math.abs(actualContents.total - expectedContents.totalFiles) > tolerance) {
        return { 
          valid: false, 
          error: `File count mismatch: expected ~${expectedContents.totalFiles}, found ${actualContents.total}` 
        };
      }
      
      return { valid: true };
      
    } catch (error) {
      return { valid: false, error: `File integrity error: ${error.message}` };
    }
  }
  
  /**
   * Verify file permissions
   */
  async verifyPermissions(targetPath) {
    try {
      // Test read access
      await fs.promises.access(targetPath, fs.constants.R_OK);
      
      // Test write access
      await fs.promises.access(targetPath, fs.constants.W_OK);
      
      // Test file creation in target directory
      const testFile = path.join(targetPath, '.permission-test');
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
      
      return { valid: true };
      
    } catch (error) {
      return { valid: false, error: `Permission error: ${error.message}` };
    }
  }
  
  /**
   * Verify tool compatibility
   */
  async verifyToolCompatibility(toolId, targetPath) {
    try {
      const manifestPath = path.join(targetPath, 'manifest.json');
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      
      // Check if manifest tool matches expected tool
      if (manifest.tool !== toolId) {
        return { 
          valid: false, 
          error: `Tool mismatch: expected ${toolId}, found ${manifest.tool}` 
        };
      }
      
      // Check optimization settings
      if (!manifest.optimization) {
        return { 
          valid: false, 
          error: 'Missing optimization settings' 
        };
      }
      
      return { valid: true };
      
    } catch (error) {
      return { valid: false, error: `Compatibility check error: ${error.message}` };
    }
  }
  
  /**
   * Count files in directory recursively
   */
  async countFilesInDirectory(dir) {
    let total = 0;
    
    async function traverse(currentDir) {
      const items = await fs.promises.readdir(currentDir);
      
      for (const item of items) {
        const itemPath = path.join(currentDir, item);
        const stat = await fs.promises.stat(itemPath);
        
        if (stat.isDirectory()) {
          await traverse(itemPath);
        } else {
          total++;
        }
      }
    }
    
    await traverse(dir);
    return { total };
  }
  
  /**
   * Generate verification report
   */
  generateReport() {
    const valid = this.verificationResults.every(r => r.valid);
    const totalErrors = this.verificationResults.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = this.verificationResults.reduce((sum, r) => sum + r.warnings.length, 0);
    
    return {
      valid,
      summary: {
        totalInstallations: this.verificationResults.length,
        validInstallations: this.verificationResults.filter(r => r.valid).length,
        totalErrors,
        totalWarnings
      },
      details: this.verificationResults
    };
  }
  
  /**
   * Clear verification results
   */
  clearResults() {
    this.verificationResults = [];
  }
}

module.exports = VerificationSystem;