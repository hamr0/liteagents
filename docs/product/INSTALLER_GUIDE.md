# liteagents Installer Guide

**Version**: 2.8.1
**Last Updated**: 2026-05-24

A guide to installing and managing liteagents across the supported AI development tools using the interactive multi-tool installer.

> **The installer is interactive.** It does not take command-line flags — you run it and answer prompts. There is one package per tool (all agents, commands, and skills); there are no Lite/Standard/Pro variants.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation Process](#installation-process)
3. [Tools](#tools)
4. [Custom Path Configuration](#custom-path-configuration)
5. [Common Scenarios](#common-scenarios)
6. [Uninstalling](#uninstalling)
7. [Updating and `AGENT_RULES.md`](#updating-and-agent_rulesmd)
8. [Troubleshooting](#troubleshooting)
9. [FAQ](#faq)

---

## Quick Start

### Prerequisites

- **Node.js**: Version 14.0.0 or higher
- **npm**: Version 6.0.0 or higher
- **Disk Space**: At least 50 MB free
- **Permissions**: Write access to the installation directories

### Installation

```bash
# Install liteagents globally
npm install -g liteagents

# Run the interactive installer
liteagents
```

`liteag` is a short alias for the same installer.

The installer walks you through three steps:

1. **Select tools** (Claude, Opencode, Ampcode, Droid)
2. **Configure paths** (use defaults or customize)
3. **Confirm and install** (watch real-time progress)

---

## Installation Process

### Step 1: Launch the Installer

```bash
liteagents
```

You'll see the welcome banner and a menu:

```
                  AGENTIC KIT
        v2.8.1 | 10 agents + 23 commands per tool

What would you like to do?

  1. Install tools
  2. Uninstall tools
  3. Exit

Enter choice (1-3): 1
```

### Step 2: Select Tools

Choose which tools to install. Use the arrow keys to move, **Space** to toggle a tool, and **Enter** to confirm:

```
Select tools to install (Space to toggle, Enter to confirm):

  [x] Claude Code   - AI-powered development assistant
  [ ] Opencode      - CLI-optimized AI codegen tool
  [ ] Ampcode       - Amplified AI development accelerator
  [ ] Droid         - Android-focused AI development companion
```

Each tool is installed independently to its own directory, so there are no conflicts between tools.

### Step 3: Configure Paths

Review the default installation paths and customize them if needed:

```
Default installation paths:

  Claude Code → ~/.claude
  Opencode    → ~/.config/opencode
  Ampcode     → ~/.config/amp
  Droid       → ~/.factory

Do you want to customize any paths? (y/N):
```

See [Custom Path Configuration](#custom-path-configuration) for when and how to change these.

### Step 4: Confirm and Install

Review your selections and confirm. If an installation already exists at a target path, the installer backs it up first (a timestamped `.backup.` copy) before installing:

```
Ready to install:

  Claude Code → ~/.claude

Proceed with installation? (Y/n): y

Installing...

  ✓ Copied agents
  ✓ Copied commands
  ✓ Copied skills
  ✓ Created manifest

Installation complete! ✓
  Backup: ~/.claude.backup.2026-05-24T10-19-22-124Z   (only if a prior install existed)
```

A log of each run is written to `~/.liteagents-install.log`.

---

## Tools

liteagents installs the **same content set into each tool**: 10 specialized agents and the full command set (23 commands). Claude Code additionally receives skills and the live-canvas plugin marketplace, which are native Claude Code features.

| Tool | Default path | Description |
|------|--------------|-------------|
| **Claude Code** | `~/.claude` | AI-powered development assistant |
| **Opencode** | `~/.config/opencode` | CLI-optimized AI codegen tool |
| **Ampcode** | `~/.config/amp` | Amplified AI development accelerator |
| **Droid** | `~/.factory` | Android-focused AI development companion |

You can install any combination of tools in a single run. Each tool's installation is fully isolated.

---

## Custom Path Configuration

### When to Use Custom Paths

The defaults above are detected automatically by each tool and are recommended. You can point a tool at a different location **within your home directory** — for example:

1. **Project-local** — install inside a project, e.g. `~/projects/my-app/.agentic/claude`
2. **Grouped** — keep tools together, e.g. `~/.config/liteagents/claude`
3. **Versioned** — multiple copies side by side under your home directory

> **Paths are confined to your home directory (or the system temp dir) for safety.** The installer rejects system directories (`/etc`, `/usr`, `/var`, `/bin`, `/root`, …) and anything outside your home, so shared locations like `/opt/...` or external mounts like `/mnt/...` are **not** accepted. Use a location under `~/` instead.

### Custom Path Flow

When you choose to customize paths, the installer prompts for each path, validates it, and asks you to confirm anything that differs from the default:

```
Enter custom path for Claude Code (or press Enter for default):
> ~/projects/my-app/.agentic/claude

Validating path: /home/user/projects/my-app/.agentic/claude
  ✓ Within your home directory
  ✓ Parent directory exists
  ✓ Write permissions verified
  ⚠ Directory does not exist (will be created)

Use this path instead of the default ~/.claude? (y/N):
```

### Path Validation Rules

**Required:**
- ✓ Resolves to a location inside your home directory (or the system temp dir)
- ✓ Not a system directory (`/etc`, `/usr`, `/var`, `/bin`, `/root`, …) and no null bytes
- ✓ Parent directory exists and is writable

**Warnings** (allowed with confirmation):
- ⚠ Directory doesn't exist (will be created)
- ⚠ Directory already exists (existing install is backed up first)

**Errors** (installation blocked):
- ✗ Path outside your home directory
- ✗ System directory
- ✗ Parent directory missing or not writable

### Tilde (~) Expansion

The installer expands `~` to your home directory:

```
You enter:  ~/.claude
Expands to: /home/user/.claude
```

### Path Examples

**Valid** (within your home directory):
```
~/.claude                              # default
~/.config/liteagents/claude            # grouped under ~/.config
~/projects/my-app/.agentic/claude      # project-local
```

**Rejected:**
```
./claude                    # relative path (must be absolute)
/opt/team/ai-tools/claude   # outside your home directory
/mnt/external/claude        # outside your home directory
/usr/bin/claude             # system directory
C:\Users\user\claude        # Windows-style path on Linux
```

---

## Common Scenarios

### Scenario 1: First-Time Installation

**Goal:** Install Claude Code with default settings.

1. Run `liteagents`
2. Choose **1. Install tools**
3. Select **Claude Code**, press Enter
4. Keep default paths (`N`)
5. Confirm (`Y`)

Result: the complete agent/command set installed to `~/.claude`.

### Scenario 2: Multi-Tool Installation

**Goal:** Install Claude Code and Opencode for different workflows.

1. Run `liteagents`
2. Choose **1. Install tools**
3. Toggle **Claude Code** and **Opencode** with Space, press Enter
4. Keep default paths (`N`)
5. Confirm (`Y`)

Result: Claude Code → `~/.claude` and Opencode → `~/.config/opencode`, fully isolated.

### Scenario 3: Team / Shared Installation

**Goal:** Install all tools to a shared directory.

1. Run `liteagents`
2. Choose **1. Install tools**
3. Toggle all four tools, press Enter
4. Customize paths (`y`) and enter a shared location for each, e.g. `/opt/team/ai-tools/claude`
5. Confirm each custom path and the install

### Scenario 4: Project-Specific Installation

**Goal:** Install within a specific project.

1. `cd /home/user/projects/my-app`
2. Run `liteagents`
3. Choose **1. Install tools**, select **Claude Code**
4. Customize the Claude path to `/home/user/projects/my-app/.agentic/claude`
5. Confirm

Result: a project-local installation you can optionally commit to version control.

---

## Uninstalling

Uninstall through the same interactive installer:

```bash
liteagents
```

1. Choose **2. Uninstall tools**
2. Select the installed tools to remove
3. Confirm

The installer **backs up the installation before removing it** (a timestamped `.uninstall-backup.` copy next to the original), then deletes the installed files and manifest.

To remove the installer itself:

```bash
npm uninstall -g liteagents
```

---

## Updating and `AGENT_RULES.md`

Updating liteagents happens in two places, and they refresh independently.

### 1. The package and the installed kit

```bash
npm i -g liteagents@latest   # updates the package
liteagents                    # copies the new kit into ~/.claude (or ~/.factory, etc.)
```

Re-running the installer **backs up your previous kit first**, to a
`.backup.<timestamp>` directory beside the install, then overwrites. Nothing is
lost; the closing message tells you where the backup went.

You do not have to remember to check: `/remember` compares your installed
version against the registry on each run and prints one line when you are
behind. It only ever advises — it never installs anything for you.

### 2. `AGENT_RULES.md` in each project

`AGENT_RULES.md` is the coding-standards document that primes every session. It
ships inside the package, the installer copies it into your kit, and `/remember`
copies *that* into each project at `.claude/remember/AGENT_RULES.md`
(`.factory/`, `.amp/`, `.opencode/` for the other tools), referenced from
`CLAUDE.md` / `AGENT.md` / `AGENTS.md` as a plain pointer.

Because it is a shipped standards document rather than generated state, it is
**kept current on every `/remember` run**, not frozen at first write. Each run
compares your project copy against the template in your installed kit:

| your copy | what happens |
|---|---|
| identical to the template | nothing at all — no write, no output |
| missing | copied in, reported |
| **different** | moved to `AGENT_RULES.md.bak`, new template copied in, both reported |

**If you edit your project's `AGENT_RULES.md`, fold your changes into the new
file after an update.** Your previous body is always preserved — but
`AGENT_RULES.md.bak` is a *single* file that each update overwrites, so a
customised body survives one release, not two. This is a deliberate trade:
liteagents does not try to merge your edits, because it cannot know which of
them matter.

If you never edit it, you will never see a `.bak` file at all — an identical
copy is not rewritten.

---

## Troubleshooting

### Issue: "Permission Denied"

```
✗ Permission denied: Cannot write to /opt/liteagents/claude
```

**Cause:** insufficient write permissions for the chosen directory.

**Solutions:**
- Use a default path in your home directory (run `liteagents`, keep defaults).
- Choose a writable location when prompted to customize paths, e.g. `~/liteagents/claude`.
- Fix ownership of the target, then re-run: `sudo chown -R $USER:$USER /opt/liteagents`.

### Issue: "Insufficient Disk Space"

```
✗ Insufficient disk space: Only 30 MB available, need at least 50 MB
```

**Solutions:**
- Free space: `df -h`, then `npm cache clean --force` and remove old data.
- Install to a different drive by customizing the path to e.g. `/mnt/external/.claude`.

### Issue: "Package Not Found / variants.json not found"

```
✗ Package validation failed: variants.json not found
```

**Cause:** a corrupted or incomplete npm install.

**Solutions:**
```bash
npm uninstall -g liteagents
npm cache clean --force
npm install -g liteagents
npm list -g liteagents      # verify
node --version              # must be 14.0.0+
```

### Issue: "Installation Stuck / Frozen"

**Solutions:**
- Wait a little longer on slow filesystems.
- Cancel with `Ctrl+C` and re-run `liteagents`.
- Check system load (`top`) and disk I/O (`iostat -x 1`); prefer a local disk over a network drive.

### Issue: "Tool Not Detecting Installation"

**Solutions:**
- Verify the install: `ls -la ~/.claude` and `cat ~/.claude/manifest.json`.
- Restart the tool if it was running.
- Re-run `liteagents` with default paths if you installed to a custom location the tool doesn't scan.

### Issue: "ANSI Colors Not Displaying"

Strange characters like `[32m` mean the terminal doesn't support ANSI colors.

**Solutions:**
- Use a modern terminal (Windows Terminal, iTerm2, gnome-terminal, konsole).
- Disable colors: `NO_COLOR=1 liteagents`.

### Getting Help

1. Check the log: `cat ~/.liteagents-install.log`
2. File an issue (include OS, Node.js version, the error, and the log): https://github.com/hamr0/liteagents/issues
3. Discussions: https://github.com/hamr0/liteagents/discussions

---

## FAQ

### General

**Q: What is liteagents?**
A collection of AI agents, commands, and skills that enhance AI-powered development tools (Claude Code, Opencode, Ampcode, Droid). It installs pre-built agents and commands for common development tasks.

**Q: Are there different editions or variants?**
No. Each tool receives the full package — 10 agents and 23 commands (Claude Code also gets skills and the live-canvas plugin marketplace as native features). There are no Lite/Standard/Pro variants.

**Q: Can I install multiple tools?**
Yes. Select any combination in one run. Each tool is installed to its own directory with no conflicts.

**Q: How much disk space do I need?**
A few MB per tool, plus at least 50 MB free recommended for the install and backups.

### Installation

**Q: Where are tools installed by default?**
- Claude Code: `~/.claude`
- Opencode: `~/.config/opencode`
- Ampcode: `~/.config/amp`
- Droid: `~/.factory`

**Q: Can I install to a custom location?**
Yes. When asked "Do you want to customize any paths? (y/N)", answer `y` and enter your path. The installer validates it.

**Q: Does the installer take command-line flags (silent/CI mode)?**
No. The installer is interactive only — run `liteagents` and answer the prompts.

**Q: Do I need sudo/admin permissions?**
Not for the default paths in your home directory. You only need elevated permissions for system directories like `/opt` or `/usr/local`.

### Tools

**Q: Which tool should I use?**
Install the agents into whichever AI development tool(s) you already use — Claude Code, Opencode, Ampcode, or Droid.

**Q: Do tools share agents and commands?**
No. Each tool has its own isolated installation, which allows tool-specific layouts.

### Uninstall

**Q: How do I uninstall a tool?**
Run `liteagents`, choose **2. Uninstall tools**, and select the tools to remove. The installer backs up before removing.

**Q: Will uninstalling remove my own settings?**
The installer creates a timestamped backup before removing files, so you can recover anything you need from it.

**Q: Does uninstall remove the installer itself?**
No. Remove the installer with `npm uninstall -g liteagents`.

### Technical

**Q: What Node.js version is required?**
14.0.0 or higher (`node --version`).

**Q: Can I install on Windows?**
Yes. Windows, macOS, and Linux are supported; paths are adjusted per platform.

**Q: Is internet required during installation?**
No. Once the npm package is installed, the installer works offline — all content is bundled.

**Q: How do I migrate from an old installation?**
Just run the installer again. If an existing installation is detected at the target path, it is backed up before the new one is installed.

**Q: How do I install a beta version?**
```bash
npm install -g liteagents@beta
liteagents
```

**Q: How do I contribute new agents or skills?**
Open an issue or pull request at https://github.com/hamr0/liteagents.

---

## Additional Resources

- **Main README**: [../README.md](../README.md) — project overview, usage, and example workflows

---

## Support

1. **Documentation**: this guide and the related docs above
2. **Issues**: https://github.com/hamr0/liteagents/issues
3. **Discussions**: https://github.com/hamr0/liteagents/discussions

---

**Last Updated**: 2026-05-24
**Installer Version**: 2.8.1
**Maintainer**: @hamr0
