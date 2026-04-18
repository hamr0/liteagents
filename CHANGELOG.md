# Changelog

All notable changes to liteagents will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Community marketplace submissions
- Additional skills for data analysis
- Enhanced testing capabilities
- Performance optimizations

---

## [2.6.0] - 2026-04-19

### Added
- **live-canvas skill** — Design interview, generates 5 UI variations, collects click-to-annotate feedback from the browser, produces a final implementation plan. Available as a skill in Claude Code and as a command in Droid/Ampcode/Opencode.
  - **Vanilla overlay** (`overlay-vanilla.js`, ~400 lines, zero deps) — framework-agnostic click-to-annotate HUD with pin placement, selector inference (`data-testid` > `id` > class chain, CSS-in-JS hashes filtered), variant detection via `data-variant` attribute, and a v1.0 schema wire-compatible with the upstream React template.
  - **React overlay** (`FeedbackOverlay.tsx`) kept for React/Next/Vite projects.
  - **Demo** (`templates/demo/post-variants.html`) — standalone 5-variant post card playground for review without starting a dev server.
  - **Handholding activation flow** — Phase 0 probes the channel on every invocation and offers `AskUserQuestion` choices: first-time users get the full 4-step setup; returning users who forgot the dev flag get the restart command; channel-up sessions proceed silently.
- **live-canvas-channel plugin** (Claude Code only) — MCP channel server that bridges the overlay's HTTP POSTs into the live session as `notifications/claude/channel` events. Packaged as a Claude Code marketplace under `packages/claude/plugins/live-canvas-marketplace/`.
  - HTTP listener on `127.0.0.1:8788` with `/health` probe and `/feedback` POST endpoint
  - MCP server using `@modelcontextprotocol/sdk` with `experimental: {'claude/channel': {}}` capability
  - `instructions` field added to tell Claude how to act on incoming `<channel source="live-canvas">` tags: acknowledge in chat → locate variant file → edit → confirm
  - `setup.sh` helper that runs `npm install` and prints the 3 remaining manual steps
- **Installer: plugins as first-class category** — `packages/<tool>/plugins/` now discovered, selected per variant, and copied to `<target>/plugins/`, parallel to skills. `node_modules/` excluded during copy and size computation. Manifest generation includes a `plugins` component count, installed-files list, and path entry.
- **Friction report: project attribution in cluster output** — `antigen_review.md` now shows which projects each cluster spans (new "Projects" column in the summary table; new `**Projects:**` line per cluster). Data was always in `session_id`; the previous version dropped it during clustering.

### Changed
- **README restructured for Hot Memory visibility** — new top-level `🧠 Hot Memory` section between Quick Start and What's Included, with pipeline diagram and sample friction output. Manual Skills/Commands list regrouped into named sub-sections (Hot Memory Pipeline, Design, Workflow & analysis). Old duplicated Hot Memory section removed.
- **Command/skill count 22 → 23** per tool across README, subagentic-manual, and per-package `AGENTS.md` / `AGENT.md` / `CLAUDE.md`.
- **opencode.jsonc** — added `live-canvas` entry under `"command"` block.

### Fixed
- **Friction clustering dropped project names** — cluster object converted `{sessionId: true}` dict to a count before rendering, so `antigen_review.md` never surfaced which repos contributed to each pattern. Fix preserves `session_ids[]` and `projects[]` on every cluster.
- **Live Canvas overlay counter flicker in live mode** — counter went 0→1→0 during successful push roundtrip. Rewrote so successful live pushes never enter the pending-batch state; counter stays at 0 unless a push actually fails.

### Notes
- The Claude Code channel plugin is subject to Claude Code's research preview: custom channels require `--dangerously-load-development-channels` at session start, and steps 2-4 of setup (`/plugin marketplace add`, `/plugin install`, session restart) cannot be automated. The skill prints copyable commands and an alias suggestion.
- Droid, Ampcode, and Opencode run live-canvas in batch mode only — channels are Claude-Code-specific.

---

## [2.5.2] - 2026-02-11

### Added
- **friction command** — Analyze session logs for failure patterns, behavioral signals, and antigen clusters
  - 14 weighted signals (user_intervention, false_success, tool_loop, etc.)
  - Session scoring and quality classification (BAD/FRICTION/ROUGH/OK)
  - Candidate clustering by (anchor_signal, tool_sequence) for 3-4x compression
  - Context noise filtering and dedup in clusters
  - Bundled `friction.js` (2157 lines) with absolute search paths per platform
- **remember command** — Consolidate stashes and friction output into persistent project memory
  - Extracts facts and episodes from session stashes via sonnet
  - Distills friction clusters into behavioral preferences with confidence tiers
  - Writes unified `.claude/memory/MEMORY.md` (or platform equivalent)
  - Injects `@MEMORY.md` reference into instruction file (CLAUDE.md/AGENTS.md/AGENT.md)
- **Hot Memory pipeline** — Lightweight session memory: `/stash` -> `/friction` -> `/remember`
  - Documented in README and subagentic-manual
- **Platform-specific paths** across all 4 packages (claude, droid, opencode, ampcode)
  - Each package uses correct instruction file, project path, and global install path
- **.gitignore** — Added `.claude/`, `.factory/`, `.opencode/`, `.amp/` project data directories

### Changed
- **context-builder** — Updated per platform with correct instruction file, project/global paths, tool name, and `@MEMORY.md` discovery
- **docs-builder** — Synced blueprint.md section and templates across all packages
- **opencode.jsonc** — Registered friction and remember commands
- **AGENTS.md/AGENT.md** — Command counts updated 10 -> 12 across all packages
- **package.json** — Description updated to 22 commands
- **installer banner** — Updated to v2.5.2 with 22 commands

---

## [2.4.7] - 2026-02-02

### Changed
- **docs-builder skill** - Enhanced with reorganization capabilities
  - Added Fresh vs Existing mode detection (auto-detects if `/docs` already has content)
  - New archive tier (`/docs/archive/`) for old/unclear documentation
  - Categorization workflow: KEEP, CONSOLIDATE, or ARCHIVE existing files
  - Heuristics for automatic categorization based on filename patterns and content
  - Consolidation logic for merging duplicate content
  - Updated across all packages (claude, opencode, ampcode, droid)

---

## [2.4.1] - 2026-01-24

### Changed - Package Rebranding
- **BREAKING:** Package renamed from `@hamr0/agentic-kit` to `liteagents` (unscoped)
  - Better reflects lightweight, CLI-focused nature
  - Easier installation: `npm install -g liteagents`
  - Commands: `liteagents` and `liteag` (shorthand)
- **Repository:** Renamed from `agentic-kit` to `liteagents` on GitHub
  - New URL: https://github.com/hamr0/liteagents
  - Old URLs redirect automatically

### Removed
- GitHub Packages support completely removed
  - No GitHub Packages were published (0 downloads)
  - Simplified to npm-only publishing
  - Removed `.npmrc`, `GITHUB_SETUP.md`, `GITHUB_PACKAGES.md`, `DUAL_PUBLISH_SUMMARY.md`
  - Removed `publish:github` and `publish:both` npm scripts

### Updated
- All documentation updated to reference `liteagents`
  - Updated 9 docs files and all root files
  - README: New "LITEAGENTS" ASCII logo
  - All npm badges and links updated
- Publishing workflow simplified
  - `scripts/publish.sh` reduced from 195 to 69 lines
  - Now npm-only, no GitHub token management needed
  - `docs/PUBLISHING.md` simplified to focus on npm

### Migration Guide
For users of `@hamr0/agentic-kit`:
```bash
# Uninstall old package
npm uninstall -g @hamr0/agentic-kit

# Install new package
npm install -g liteagents

# Use new commands
liteagents  # or 'liteag' for shorthand
```

Old package `@hamr0/agentic-kit` will be deprecated with migration message.

---

## [2.3.0] - 2026-01-22

### Removed
- Removed `subagent-spawning` skill (functionality integrated into agents)

### Changed
- Updated command/skill count from 21 to 20 across all documentation
- README.md: Updated command counts and removed subagent-spawning from skill list
- installer/cli.js: Updated welcome banner to reflect 20 commands
- package.json: Updated description to reflect 20 commands
- packages/subagentic-manual.md: Updated command counts

---

## [1.11.1] - 2026-01-20

### Fixed
- Added missing command definitions to `packages/opencode/opencode.jsonc` (debug, explain, git-commit, optimize, refactor, review, security, ship, stash, test-generate, subagent-spawning)

---

## [1.11.0] - 2026-01-20

### Added
- `/stash` command for saving session context for compaction recovery or handoffs (added to all packages: claude, opencode, ampcode, droid)

### Changed
- Updated command count from 20 to 21 across all documentation
- README.md: Updated command counts and added stash to command list
- installer/cli.js: Updated welcome banner to reflect 21 commands
- package.json: Updated description to reflect 21 commands

### Fixed
- package.json: Fixed validate script path to point to scripts/validate-package.js

---

## [1.2.1] - 2025-11-05

### Changed

**Package Optimization:**
- Optimized npm package structure by excluding development-only files
- Updated `package.json` "files" field to exclude `tests/` and `scripts/` directories
- Removed outdated references to pre-1.2.0 structure (`.claude-plugin/`, root `agents/`, `skills/`, `hooks/`)
- Added cleanup npm scripts: `npm run clean` and `npm run clean:git`
- Updated `prepublishOnly` script to auto-clean test artifacts before validation

**Repository Cleanup:**
- Removed 916 temporary test artifacts (22 MB reduction)
- Updated `.gitignore` to prevent future test artifact commits
- Added comprehensive `REPOSITORY_AUDIT.md` with detailed analysis

**Results:**
- Repository size reduced: 70 MB → 49 MB (30% reduction)
- File count reduced: 2,727 → 1,812 files (33% reduction)
- Tests directory optimized: 959 → 43 files (96% cleanup)
- npm package size: 38.4 MB unpacked (1,385 files only)
- Published package now contains only essential user-facing files
- 35% faster installation for end users

---

## [1.2.0] - 2025-11-05

### Added

**Interactive Multi-Tool Installer:**
- `installer/cli.js` - Interactive CLI with 4-step installation process
- `installer/package-manager.js` - Variant-based package management
- `installer/installation-engine.js` - File copying with rollback capability
- `installer/verification-system.js` - Post-installation validation
- `installer/path-manager.js` - Path resolution and validation
- `installer/state-manager.js` - Resume capability for interrupted installations
- Command-line interface supporting 4 tools: Claude, Opencode, Ampcode, Droid
- Real-time progress tracking with ANSI progress bars
- Variant selection (Lite: 510 KB, Standard: 8.4 MB, Pro: 9 MB)
- Multi-tool installation (install all 4 tools simultaneously)
- Silent mode for CI/CD (`--silent --variant=standard --tools=claude`)
- Custom path configuration with validation
- Automatic rollback on installation failure
- Resume capability for interrupted installations
- Uninstall functionality (`--uninstall --tools=claude`)
- Upgrade/downgrade between variants

**Installation Reporting & Telemetry (Phase 9.2-9.3):**
- `installer/report-template.js` - Comprehensive installation report generation
  - Summary with success/failure status, variant, tool count, total files, installation time
  - Detailed per-tool information (components, paths, verification status)
  - System information (Node.js version, platform, architecture)
  - Errors and warnings sections
  - Reports saved to `~/.liteagents-install.log`
- `installer/telemetry.js` - Anonymous usage statistics (opt-in only)
  - User consent prompt with clear data collection policy
  - `--no-telemetry` flag to disable telemetry
  - Collects: variant, tool count, installation time, success/failure, OS type
  - Does NOT collect: file paths, personal information, specific tool names
  - Local storage only (not sent to servers)
  - Easy opt-out via config file or command flag
- `docs/PRIVACY.md` - Transparent privacy policy (250+ lines)
  - Detailed explanation of data collection
  - What we collect vs. what we don't collect
  - How to manage consent and opt-out
  - View and delete collected data

**Security Hardening (Phase 9.4):**
- `docs/SECURITY.md` - Comprehensive security documentation (380+ lines)
  - Security principles and implemented measures
  - Path traversal prevention with `PathManager.sanitizePath()`
  - Symlink attack mitigation with real path resolution
  - Input validation for all user inputs (tool names, variants, paths)
  - File size limits (1MB max) to prevent DoS attacks
  - Null byte detection in paths and file content
  - Secure file permissions (0600) for sensitive files
  - No command injection vulnerabilities (no shell execution of user input)
- Enhanced `PathManager` with security checks:
  - Validates paths are within home directory
  - Checks for suspicious system directories
  - Resolves and validates symlinks
  - Prevents null byte injection
- Enhanced `PackageManager` with JSON validation:
  - File size limits before parsing
  - Null byte detection
  - Structure validation (must be object)
  - Safe error handling

**Legacy Migration Support (Phase 9.5):**
- `docs/MIGRATION.md` - Complete migration guide (400+ lines)
  - Automatic and manual migration procedures
  - Variant classification from legacy installations
  - Troubleshooting and rollback instructions
  - FAQ and version compatibility matrix
- `PathManager.detectLegacyInstallation()` - Automatic detection of pre-1.2.0 installations
- `PathManager.countLegacyComponents()` - Component counting for variant classification
- `PathManager.classifyVariantFromComponents()` - Smart variant classification
- `PathManager.createManifestForLegacy()` - Manifest generation for legacy installations
- Preserves user customizations during migration

**Tool-Specific Packages:**
- `packages/claude/` - Conversational AI optimization (markdown-first)
- `packages/opencode/` - CLI-optimized code generation (terminal-first)
- `packages/ampcode/` - Amplified development (maximum velocity)
- `packages/droid/` - Android-first mobile development
- Tool-specific hooks with optimization flags
- Consistent structure: 13 agents, 22 skills (8 core + 14 advanced)
- Variant configuration via `variants.json` for each tool

**Comprehensive Testing:**
- `tests/installer/variants-parsing.test.js` - 88 tests for variant parsing
- `tests/installer/package-manager.test.js` - 44 tests for package management
- `tests/installer/installation-engine.test.js` - 35 tests for installation
- `tests/installer/integration.test.js` - 40 comprehensive integration tests
- `tests/installer/path-confirmation.test.js` - 34 tests for path validation
- `tests/installer/summary-display.test.js` - 13 tests for summary display
- `tests/validation-test.js` - 9 core module validation tests (Phase 9.6)
  - Package Manager, Path Manager, Installation Engine initialization
  - Variant configuration loading
  - Path sanitization and security (path traversal protection)
  - Report generation, telemetry, legacy detection, state management
- Total: 263 passing tests with zero failures
- 100% validation success rate across all packages

**Documentation:**
- `docs/INSTALLER_GUIDE.md` - Comprehensive installation guide (850+ lines)
  - Step-by-step installation process
  - Variant selection guide with use cases
  - Tool selection guide (when to use each tool)
  - Custom path configuration
  - 7 common installation scenarios
  - Command-line flags reference
  - Troubleshooting (7 common issues with solutions)
  - FAQ (40+ questions)
- `docs/VARIANT_CONFIGURATION.md` - Variant system documentation (440 lines)
  - Variant philosophy and design principles
  - Detailed rationale for 8 core skills
  - Explanation of 14 advanced skills (Pro only)
  - Tool-specific optimizations
  - Usage recommendations
- `docs/PACKAGE_BASELINE.md` - Package structure reference (557 lines)
- `docs/PACKAGE_VALIDATION_REPORT.md` - Quality assurance report (400+ lines)
  - All 12 tool/variant combinations validated
  - Zero errors, zero warnings
  - Production-ready status confirmed

**Scripts:**
- `scripts/validate-all-packages.js` - Automated validation for all packages
- `validation-results.json` - Machine-readable validation results

### Changed

**README.md:**
- Updated from 14 to 22 skills
- Added tool badges (Claude, Opencode, Ampcode, Droid)
- Interactive installer promoted to recommended installation method
- Added "Supported Tools" section
- Added Size column to variants table
- Updated installation options with multi-tool support
- Updated Stats section (22 skills, 4 tools)

**Skills:**
- Expanded from 14 to 22 total skills
- 8 core skills (Standard): pdf, docx, xlsx, pptx, canvas-design, theme-factory, brand-guidelines, internal-comms
- 14 advanced skills (Pro only): video-production, audio-transcription, data-visualization, web-scraping, api-integration, database-query, machine-learning, blockchain-tools, iot-integration, security-audit, performance-profiling, devops-automation, cloud-deployment, code-migration

**Architecture:**
- Multi-tool support with isolated installations
- Each tool has tool-specific optimization flags
- Consistent variant system across all tools
- Centralized package validation

### Fixed

- Package validation for all 12 tool/variant combinations
- Skills directory filtering (excluded README.md from skills list)
- Directory naming consistency (agents/, skills/, resources/, hooks/)
- Path validation with proper tilde expansion
- Integration tests for uninstall, multi-tool, upgrade/downgrade scenarios

### Technical Details

**Installation Capabilities:**
- Average installation time: Lite (10s), Standard (30s), Pro (60s)
- Supports offline installation (no internet required after npm install)
- Atomic operations with full rollback on failure
- Cross-platform support (Linux, macOS, Windows)
- Validation of 486+ files across all packages
- Exit codes for scripting (0=success, 1-6=various errors)

**Package Sizes:**
- Lite: ~510 KB (3 agents, 0 skills, 11 files)
- Standard: ~8.4 MB (13 agents, 8 skills, 29 files)
- Pro: ~9 MB (13 agents, 22 skills, 43 files)

**Command-Line Flags:**
- `--variant` - Specify variant (lite, standard, pro)
- `--tools` - Specify tools (claude, opencode, ampcode, droid, all)
- `--path` - Custom installation path
- `--silent` / `--yes` - Non-interactive mode
- `--config` - Load configuration from file
- `--uninstall` - Remove installed tools
- `--upgrade` - Upgrade to different variant

---

## [1.1.0] - 2025-11-02

### Added

**Session Persistence:**
- `session-start.js` hook - Auto-loads skills on every Claude Code session start
- Startup banner showing loaded agents and skills
- Persistent skills across sessions (inspired by superpowers)

**Documentation:**
- `KNOWLEDGE_BASE.md` - Comprehensive reference (consolidated from 4 files)
- `PUBLISHING.md` - Complete publishing guide
- `UPDATE_VERSION.sh` - Automated version management
- Streamlined `README.md` (70% shorter, focused on quick start)
- Organized all docs under `docs/` directory

**Infrastructure:**
- `.claude-plugin/marketplace.json` - Official marketplace catalog
- npm version badge in README

### Changed
- Agent invocation syntax to lowercase with hyphens (`@feature-planner:` not `@ProductManager:`)
- npx clarification - Clearly states it runs temporarily without installing
- README structure - Now quick start focused, links to detailed docs in `docs/`

### Fixed
- Skill count - Corrected Pro variant from 16 to 14 skills
- Repository URLs - Updated to `github.com/hamr0/liteagents`
- Author info - Updated to `hamr0 <avoidaccess@msn.com>`
- All variant manifests - Added session-start hook

### Removed
- Consolidated `AGENTS.md`, `ARCHITECTURE.md`, `SKILLS.md` into `KNOWLEDGE_BASE.md`

---

## [1.0.0] - 2025-11-02

### Added - Initial Release

**Core Features:**
- 13 specialized agents (Master, Orchestrator, Product Manager, etc.)
- 14 powerful skills (PDF, DOCX, Canvas Design, MCP Builder, etc.)
- 3 variants: Lite (3 agents), Standard (13 agents, 8 skills), Pro (13 agents, 14 skills)

**Distribution:**
- npm package: `liteagents`
- GitHub: `github.com/hamr0/liteagents`
- Direct install: `/plugin add github:hamr0/liteagents`
- npx support: `npx liteagents` or `npx agkit`

**Infrastructure:**
- Plugin manifests for each variant
- Auto-discovery via `register-agents.js` hook
- Variant isolation
- Validation scripts (`validate-package.js`, `validate-references.sh`)

**Documentation:**
- README, QUICK-START, AGENTS, SKILLS, VARIANTS, TROUBLESHOOTING, CONTRIBUTING

---

## Upgrade Guide

### From 1.2.1 to 1.11.0

**No breaking changes.** Added new `/stash` command for session context management.

**New:**
- `/stash` command for saving session context
- Updated command count from 20 to 21

**Action Required:**
- None for existing installations - upgrade is seamless

**To Upgrade:**
```bash
# Via npm
npm install -g liteagents@latest

# Run installer
liteagents
```

---

### From 1.1.0 to 1.2.0

**No breaking changes.** Major new feature: Interactive Multi-Tool Installer.

**New:**
- Interactive installer for Claude, Opencode, Ampcode, and Droid
- 22 total skills (expanded from 14)
- Multi-tool support with isolated installations
- Comprehensive testing suite (254 tests)
- Extensive documentation (INSTALLER_GUIDE.md, VARIANT_CONFIGURATION.md)
- Package validation system

**Action Required:**
- None for existing installations - upgrade is seamless
- **New users**: Use interactive installer (`npm install -g liteagents && liteagents install`)
- **Existing users**: Continue using existing installation methods

**To Upgrade:**
```bash
# Via GitHub
/plugin update github:hamr0/liteagents

# Via npm
npm update liteagents

# Via npx (always latest)
npx liteagents

# New: Interactive installer
npm install -g liteagents
liteagents install
```

**What's Different:**
- Skills count: 14 → 22 (8 core + 14 advanced in Pro)
- Installation methods: Now supports 4 tools (Claude, Opencode, Ampcode, Droid)
- Variant sizes documented: Lite (510 KB), Standard (8.4 MB), Pro (9 MB)

---

### From 1.0.0 to 1.1.0

**No breaking changes.** Features and documentation improvements only.

**New:**
- Skills auto-load on session start
- Consolidated documentation in `docs/` directory
- marketplace.json for distribution

**Action Required:**
- None - upgrade is seamless
- Optional: Use lowercase agent syntax (`@master:` instead of `@Master:`)

**To Upgrade:**
```bash
# Via GitHub
/plugin update github:hamr0/liteagents

# Via npm
npm update liteagents

# Via npx (always latest)
npx liteagents
```

---

## Version History

| Version | Date | Key Features |
|---------|------|--------------|
| **2.4.7** | 2026-02-02 | Enhanced docs-builder skill with reorganization capabilities |
| **2.3.0** | 2026-01-22 | Removed subagent-spawning skill (20 commands) |
| **1.11.1** | 2026-01-20 | Fixed missing commands in opencode.jsonc |
| **1.11.0** | 2026-01-20 | Added /stash command (21 total commands) |
| **1.2.1** | 2025-11-05 | Package optimization, repository cleanup |
| **1.2.0** | 2025-11-05 | Interactive multi-tool installer, 22 skills, 4 tools support, 254 tests |
| **1.1.0** | 2025-11-02 | Session persistence, docs consolidation, marketplace catalog |
| **1.0.0** | 2025-11-02 | Initial release: 13 agents, 14 skills, 3 variants |

---

## Links

- **GitHub**: https://github.com/hamr0/liteagents
- **npm**: https://www.npmjs.com/package/liteagents
- **Issues**: https://github.com/hamr0/liteagents/issues
- **Releases**: https://github.com/hamr0/liteagents/releases

---

**Maintained by**: hamr0
**License**: MIT
