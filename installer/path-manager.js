/**
 * Path Manager for Agentic Kit Installer
 * 
 * Handles path validation, permissions, and tool-specific path management
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class PathManager {
  constructor() {
    this.homeDir = os.homedir();
    this.defaultPaths = {
      claude: path.join(this.homeDir, '.claude'),
      opencode: path.join(this.homeDir, '.config', 'opencode'),
      ampcode: path.join(this.homeDir, '.amp'),
      droid: path.join(this.homeDir, '.factory')
    };
  }
  
  /**
   * Expand user home path (~) to full path
   * Includes security checks for path traversal
   */
  expandPath(pathStr) {
    if (pathStr.startsWith('~')) {
      return path.join(this.homeDir, pathStr.slice(1));
    }
    return pathStr;
  }

  /**
   * Sanitize and validate path for security
   * Prevents path traversal attacks and validates path safety
   *
   * @param {string} pathStr - Path to sanitize
   * @returns {Object} Result with sanitized path or error
   */
  sanitizePath(pathStr) {
    try {
      // Expand tilde first
      let sanitized = this.expandPath(pathStr);

      // Resolve to absolute path (normalizes .. and .)
      sanitized = path.resolve(sanitized);

      // Check for null bytes (security risk)
      if (sanitized.includes('\0')) {
        return {
          valid: false,
          error: 'Path contains null bytes (security risk)'
        };
      }

      // Ensure path is within user's home directory or /tmp for safety
      // This prevents writing to system directories
      const homeDir = this.homeDir;
      const tmpDir = os.tmpdir();

      // Match on a path boundary so a sibling like `${homeDir}-evil` can't pass.
      const isInHome = sanitized === homeDir || sanitized.startsWith(homeDir + path.sep);
      const isInTmp = sanitized === tmpDir || sanitized.startsWith(tmpDir + path.sep);

      if (!isInHome && !isInTmp) {
        return {
          valid: false,
          error: `Path must be within home directory (${homeDir}) for security`
        };
      }

      // Check for suspicious patterns
      const suspiciousPatterns = [
        '/etc/', '/var/', '/usr/', '/bin/', '/sbin/',
        '/root/', '/boot/', '/dev/', '/proc/', '/sys/'
      ];

      for (const pattern of suspiciousPatterns) {
        if (sanitized.includes(pattern)) {
          return {
            valid: false,
            error: `Path contains suspicious directory: ${pattern}`
          };
        }
      }

      return {
        valid: true,
        path: sanitized
      };
    } catch (error) {
      return {
        valid: false,
        error: `Path sanitization failed: ${error.message}`
      };
    }
  }
  
  /**
   * Validate if a path is writable
   * Includes security checks via sanitizePath
   */
  async validatePath(pathStr) {
    // First, sanitize the path for security
    const sanitizeResult = this.sanitizePath(pathStr);
    if (!sanitizeResult.valid) {
      return {
        valid: false,
        path: pathStr,
        error: sanitizeResult.error
      };
    }

    const fullPath = sanitizeResult.path;

    try {
      // Resolve symlinks to real path
      let realPath;
      try {
        realPath = await fs.promises.realpath(fullPath);
      } catch (error) {
        // Path doesn't exist yet, use parent directory
        const parentDir = path.dirname(fullPath);
        try {
          const parentReal = await fs.promises.realpath(parentDir);
          realPath = path.join(parentReal, path.basename(fullPath));
        } catch (parentError) {
          // Parent doesn't exist either, will be created
          realPath = fullPath;
        }
      }

      // Verify real path is still safe after symlink resolution
      const realPathCheck = this.sanitizePath(realPath);
      if (!realPathCheck.valid) {
        return {
          valid: false,
          path: fullPath,
          error: `Resolved path is unsafe: ${realPathCheck.error}`
        };
      }

      // Check if parent directory exists and is writable
      const parentDir = path.dirname(fullPath);
      await fs.promises.access(parentDir, fs.constants.W_OK);

      // Try to create the directory if it doesn't exist
      await fs.promises.mkdir(fullPath, { recursive: true });

      // Test write access
      const testFile = path.join(fullPath, '.install-test');
      await fs.promises.writeFile(testFile, 'test', { mode: 0o600 });
      await fs.promises.unlink(testFile);

      return { valid: true, path: fullPath };
    } catch (error) {
      return {
        valid: false,
        path: fullPath,
        error: error.message
      };
    }
  }
  
  /**
   * Get disk space information for a path
   */
  async getDiskSpace(pathStr) {
    const fullPath = this.expandPath(pathStr);
    
    try {
      const stats = await fs.promises.statfs(fullPath);
      return {
        total: stats.bavail * stats.bsize,
        available: stats.bavail * stats.bsize,
        path: fullPath
      };
    } catch (error) {
      return { error: error.message };
    }
  }
  
  /**
   * Check if path exists and has existing installation
   */
  async checkExistingInstallation(pathStr) {
    const fullPath = this.expandPath(pathStr);
    
    try {
      const manifestPath = path.join(fullPath, 'manifest.json');
      await fs.promises.access(manifestPath);
      
      const manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, 'utf8')
      );
      
      return {
        exists: true,
        manifest,
        path: fullPath
      };
    } catch (error) {
      return { exists: false, path: fullPath };
    }
  }
  
  /**
   * Get default path for a tool
   */
  getDefaultPath(toolId) {
    return this.defaultPaths[toolId] || null;
  }
  
  /**
   * Normalize path for display
   */
  normalizePathForDisplay(pathStr) {
    const fullPath = this.expandPath(pathStr);

    if (fullPath.startsWith(this.homeDir)) {
      return '~' + fullPath.slice(this.homeDir.length);
    }

    return fullPath;
  }

}

module.exports = PathManager;