const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Report Template Generator
 *
 * Generates detailed installation reports with summary and per-tool details.
 * Reports are saved to ~/.liteagents-install.log after each installation.
 */
class ReportTemplate {
  constructor() {
    this.reportPath = path.join(os.homedir(), '.liteagents-install.log');
  }

  /**
   * Generate a comprehensive installation report
   *
   * @param {Object} installationData - Complete installation data
   * @param {string} installationData.variant - Selected variant (lite, standard, pro)
   * @param {Array} installationData.tools - Array of tool installation objects
   * @param {number} installationData.startTime - Installation start timestamp (ms)
   * @param {number} installationData.endTime - Installation end timestamp (ms)
   * @param {boolean} installationData.success - Overall installation success status
   * @param {Array} installationData.errors - Array of error messages
   * @param {Array} installationData.warnings - Array of warning messages
   * @returns {string} Formatted report text
   */
  generateReport(installationData) {
    const {
      variant,
      tools = [],
      startTime,
      endTime,
      success,
      errors = [],
      warnings = []
    } = installationData;

    const duration = this._formatDuration(endTime - startTime);
    const totalFiles = tools.reduce((sum, tool) => sum + (tool.filesInstalled || 0), 0);
    const totalSize = tools.reduce((sum, tool) => sum + (tool.sizeBytes || 0), 0);
    const formattedSize = this._formatSize(totalSize);

    let report = '';

    // Header
    report += this._generateHeader();

    // Summary Section
    report += this._generateSummary({
      success,
      variant,
      toolCount: tools.length,
      totalFiles,
      totalSize: formattedSize,
      duration,
      errors,
      warnings
    });

    // Tool Details Section
    if (tools.length > 0) {
      report += this._generateToolDetails(tools);
    }

    // System Information Section
    report += this._generateSystemInfo();

    // Errors Section (if any)
    if (errors.length > 0) {
      report += this._generateErrorsSection(errors);
    }

    // Warnings Section (if any)
    if (warnings.length > 0) {
      report += this._generateWarningsSection(warnings);
    }

    // Footer
    report += this._generateFooter();

    return report;
  }

  /**
   * Save report to file
   *
   * @param {string} reportContent - Generated report content
   * @returns {Promise<string>} Path where report was saved
   */
  async saveReport(reportContent) {
    try {
      await fs.promises.writeFile(this.reportPath, reportContent, 'utf8');
      return this.reportPath;
    } catch (error) {
      throw new Error(`Failed to save report to ${this.reportPath}: ${error.message}`);
    }
  }

  /**
   * Generate and save installation report
   *
   * @param {Object} installationData - Complete installation data
   * @returns {Promise<string>} Path where report was saved
   */
  async createAndSaveReport(installationData) {
    const reportContent = this.generateReport(installationData);
    const reportPath = await this.saveReport(reportContent);
    return reportPath;
  }

  /**
   * Get report file path
   *
   * @returns {string} Path to report file
   */
  getReportPath() {
    return this.reportPath;
  }

  // Private helper methods

  _generateHeader() {
    const timestamp = new Date().toISOString();
    return `
╔════════════════════════════════════════════════════════════════╗
║           LITEAGENTS INSTALLATION REPORT                       ║
╚════════════════════════════════════════════════════════════════╝

Generated: ${timestamp}

`;
  }

  _generateSummary(summary) {
    const {
      success,
      variant,
      toolCount,
      totalFiles,
      totalSize,
      duration,
      errors,
      warnings
    } = summary;

    const statusIcon = success ? '✓' : '✗';
    const statusText = success ? 'SUCCESS' : 'FAILED';
    const statusLine = `${statusIcon} Installation Status: ${statusText}`;

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${statusLine}

Package Variant:    ${variant || 'N/A'}
Tools Installed:    ${toolCount}
Total Files:        ${totalFiles}
Total Size:         ${totalSize}
Installation Time:  ${duration}
Errors:             ${errors.length}
Warnings:           ${warnings.length}

`;
  }

  _generateToolDetails(tools) {
    let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    tools.forEach((tool, index) => {
      const {
        toolId,
        path: toolPath,
        filesInstalled,
        sizeBytes,
        components = {},
        verified,
        verificationStatus,
        manifestPath
      } = tool;

      const formattedSize = this._formatSize(sizeBytes || 0);
      const verificationIcon = verified ? '✓' : '✗';
      const verificationText = verified ? 'VERIFIED' : 'VERIFICATION FAILED';

      section += `
${index + 1}. ${toolId.toUpperCase()}
   ├─ Installation Path:  ${toolPath}
   ├─ Files Installed:    ${filesInstalled || 0}
   ├─ Size:              ${formattedSize}
   ├─ Components:
   │  ├─ Agents:          ${components.agents || 0}
   │  ├─ Skills:          ${components.skills || 0}
   │  ├─ Resources:       ${components.resources || 0}
   │  └─ Hooks:           ${components.hooks || 0}
   ├─ Verification:      ${verificationIcon} ${verificationText}`;

      if (verificationStatus) {
        section += `
   │  └─ Details:         ${verificationStatus}`;
      }

      section += `
   └─ Manifest:          ${manifestPath || 'N/A'}
`;
    });

    return section;
  }

  _generateSystemInfo() {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYSTEM INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Node.js Version:    ${process.version}
Platform:           ${process.platform}
Architecture:       ${process.arch}
Operating System:   ${os.type()} ${os.release()}
Home Directory:     ${os.homedir()}

`;
  }

  _generateErrorsSection(errors) {
    let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERRORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    errors.forEach((error, index) => {
      section += `${index + 1}. ${error}\n`;
    });

    section += '\n';
    return section;
  }

  _generateWarningsSection(warnings) {
    let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    warnings.forEach((warning, index) => {
      section += `${index + 1}. ${warning}\n`;
    });

    section += '\n';
    return section;
  }

  _generateFooter() {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For support and documentation, visit:
https://github.com/amrhas82/liteagents

Report saved to: ${this.reportPath}

`;
  }

  _formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }

  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

module.exports = ReportTemplate;
