#!/usr/bin/env node

/**
 * installer/package-manager.js behavioural tests
 *
 * Rewritten from scratch. The previous version of this file (1025 lines, 44
 * tests) asserted a three-variant ('lite', 'standard', 'pro') installer that
 * no longer exists — every packages/<tool>/variants.json now ships exactly
 * one variant, 'pro'. Standalone it scored 22 pass / 22 fail, and it was never wired into
 * tests/run-all-tests.js, so none of that ever ran in CI. It also wrote
 * fixtures directly under packages/ (the real tool-package tree the
 * installer enumerates), which a crash mid-test could strand there.
 *
 * This version:
 *  - asserts only the single-variant ('pro') reality; an old test whose
 *    intent still applies (e.g. "throws for an unknown variant") is kept
 *    with a variant name that is actually unknown ('lite'/'standard'
 *    instead of pretending they should exist);
 *  - never writes inside the repo — every fixture is an fs.mkdtemp() dir
 *    under os.tmpdir(), cleaned up in `finally` (KEEP_TMP=1 to inspect);
 *  - where a method needs a fixture, it does so by pointing a fresh
 *    PackageManager instance's own `packagesDir` field at the tmpdir
 *    (a plain instance property, not a source-code change) rather than
 *    writing into the real packages/ tree;
 *  - exercises real packages/* content directly wherever that is enough
 *    (no fixture needed, no risk of drifting from reality);
 *  - does NOT test getAvailableContent's dedup behaviour — that is fully
 *    covered by tests/installer/package-manager-dedup.test.js (7 tests).
 *
 * Conventions follow tests/installer/package-manager-dedup.test.js and
 * tests/installer/closing-note.test.js: self-contained, no network/TTY,
 * isolated tmpdirs, negative controls / real-data checks so each test is
 * provably able to FAIL rather than passing vacuously.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PM_PATH = path.join(__dirname, '..', '..', 'installer', 'package-manager.js');
const PackageManager = require(PM_PATH);

const REPO_ROOT = path.join(__dirname, '..', '..');
const REAL_PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bright: '\x1b[1m' };

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ${colors.green}PASS${colors.reset} ${name}`); }
  else {
    failed++; failures.push({ name, detail });
    console.log(`  ${colors.red}FAIL${colors.reset} ${name}`);
    if (detail) console.log(`       ${colors.yellow}${detail}${colors.reset}`);
  }
}

async function checkThrows(name, fn, matcher) {
  try {
    await fn();
    check(name, false, 'expected a throw, none occurred');
  } catch (err) {
    const ok = matcher(err.message);
    check(name, ok, `unexpected message: ${err.message}`);
  }
}

// KEEP_TMP=1 leaves the fixture behind for debugging; otherwise every run
// cleans up, since leftover mkdtemp dirs exhaust inodes rather than bytes.
async function withFixture(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pm-'));
  try {
    return await fn(dir);
  } finally {
    if (!process.env.KEEP_TMP) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}

// Builds a fixture "packages" root: <root>/<toolId>/variants.json (+ agents).
// Returns a PackageManager whose packagesDir is repointed at the fixture
// root — an instance-property override, not a change to package-manager.js.
function pmOverPackagesDir(packagesDir) {
  const pm = new PackageManager();
  pm.packagesDir = packagesDir;
  return pm;
}

async function writeVariantsJson(root, toolId, obj) {
  const toolDir = path.join(root, toolId);
  await fs.promises.mkdir(toolDir, { recursive: true });
  await fs.promises.writeFile(path.join(toolDir, 'variants.json'), JSON.stringify(obj, null, 2));
  return toolDir;
}

async function main() {
  console.log(`${colors.bright}${colors.cyan}installer/package-manager.js${colors.reset}\n`);

  // ---- loadVariantConfig -------------------------------------------------

  {
    const pm = new PackageManager();
    const config = await pm.loadVariantConfig('claude');
    check('loadVariantConfig: real claude variants.json has exactly one variant, pro',
      Object.keys(config).length === 1 && !!config.pro,
      `keys: ${JSON.stringify(Object.keys(config))}`);
    check('loadVariantConfig: pro carries the required fields',
      typeof config.pro.name === 'string' && typeof config.pro.description === 'string' && !!config.pro.agents,
      JSON.stringify(config.pro));
  }

  await checkThrows('loadVariantConfig: throws for a tool with no packages/<id> dir',
    () => new PackageManager().loadVariantConfig('not-a-real-tool'),
    (msg) => /Variants file not found/.test(msg));

  await withFixture(async (root) => {
    const pm = pmOverPackagesDir(root);
    await fs.promises.mkdir(path.join(root, 'ghost'), { recursive: true });
    await checkThrows('loadVariantConfig: throws when variants.json itself is missing',
      () => pm.loadVariantConfig('ghost'),
      (msg) => /Variants file not found/.test(msg));
  });

  await withFixture(async (root) => {
    const toolDir = path.join(root, 'badjson');
    await fs.promises.mkdir(toolDir, { recursive: true });
    await fs.promises.writeFile(path.join(toolDir, 'variants.json'), '{ this is not json');
    const pm = pmOverPackagesDir(root);
    await checkThrows('loadVariantConfig: throws with a clear message for malformed JSON',
      () => pm.loadVariantConfig('badjson'),
      (msg) => /Invalid JSON in variants\.json for tool badjson/.test(msg));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 'novariant', { notpro: { name: 'X', description: 'Y', agents: '*' } });
    const pm = pmOverPackagesDir(root);
    await checkThrows("loadVariantConfig: throws when the required 'pro' variant is absent",
      () => pm.loadVariantConfig('novariant'),
      (msg) => /Required variant 'pro' not found/.test(msg));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 'missingfield', { pro: { name: 'Pro', description: 'desc' /* no agents */ } });
    const pm = pmOverPackagesDir(root);
    await checkThrows("loadVariantConfig: throws when a required field ('agents') is missing from pro",
      () => pm.loadVariantConfig('missingfield'),
      (msg) => /Required field 'agents' missing/.test(msg));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 'cached', { pro: { name: 'Before', description: 'd', agents: '*' } });
    const pm = pmOverPackagesDir(root);
    const first = await pm.loadVariantConfig('cached');
    // Mutate on disk after the first load; a cache hit must not see this.
    await writeVariantsJson(root, 'cached', { pro: { name: 'After', description: 'd', agents: '*' } });
    const second = await pm.loadVariantConfig('cached');
    check('loadVariantConfig: caches per toolId (a later on-disk edit is not re-read)',
      first.pro.name === 'Before' && second.pro.name === 'Before',
      `first=${first.pro.name}, second=${second.pro.name}`);
  });

  // ---- getVariantMetadata -------------------------------------------------

  {
    const pm = new PackageManager();
    const meta = await pm.getVariantMetadata('claude', 'pro');
    check("getVariantMetadata: real claude 'pro' has name 'Pro'", meta.name === 'Pro', meta.name);
  }

  await checkThrows("getVariantMetadata: throws for 'lite', which no longer exists",
    () => new PackageManager().getVariantMetadata('claude', 'lite'),
    (msg) => /Variant 'lite' not found for tool claude/.test(msg));

  await checkThrows("getVariantMetadata: throws for 'standard', which no longer exists",
    () => new PackageManager().getVariantMetadata('claude', 'standard'),
    (msg) => /Variant 'standard' not found for tool claude/.test(msg));

  // ---- selectVariantContent -----------------------------------------------

  {
    const pm = new PackageManager();
    const available = await pm.getAvailableContent(REAL_PACKAGES_DIR + '/claude');
    const selected = await pm.selectVariantContent('claude', 'pro', available);
    check("selectVariantContent: wildcard '*' selects every available agent",
      selected.agents.length === available.agents.length &&
        available.agents.every((a) => selected.agents.includes(a)),
      `available=${available.agents.length}, selected=${selected.agents.length}`);
  }

  await withFixture(async (root) => {
    await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: ['keep'] } });
    const pm = pmOverPackagesDir(root);
    const selected = await pm.selectVariantContent('t', 'pro', { agents: ['keep', 'drop'] });
    check('selectVariantContent: an explicit array selects only the named items',
      selected.agents.length === 1 && selected.agents[0] === 'keep',
      JSON.stringify(selected.agents));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: ['ghost'] } });
    const pm = pmOverPackagesDir(root);
    await checkThrows('selectVariantContent: an item that does not exist in availableContent throws',
      () => pm.selectVariantContent('t', 'pro', { agents: [] }),
      (msg) => /Item 'ghost' specified in pro variant agents not found/.test(msg));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: '*', commands: ['gone', 'stay'] } });
    const pm = pmOverPackagesDir(root);
    const selected = await pm.selectVariantContent('t', 'pro', { agents: [], commands: ['stay'] });
    check('selectVariantContent: commands silently skip missing items (skipMissing=true)',
      selected.commands.length === 1 && selected.commands[0] === 'stay',
      JSON.stringify(selected.commands));
  });

  await withFixture(async (root) => {
    await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: [] } });
    const pm = pmOverPackagesDir(root);
    const selected = await pm.selectVariantContent('t', 'pro', { agents: ['a', 'b'] });
    check('selectVariantContent: an empty array selection yields no items',
      Array.isArray(selected.agents) && selected.agents.length === 0,
      JSON.stringify(selected.agents));
  });

  // ---- getAvailableVariants ------------------------------------------------
  // NOTE: this method checks for a subdirectory literally named after the
  // variant (packages/<tool>/<variant>/) — a layout left over from a
  // pre-single-variant installer. No such subdirectory exists anywhere in
  // packages/ today (see the bug reported at the end of this file), so this
  // is exercised against a fixture that reproduces the historical shape it
  // still assumes. Deliberately NOT asserted against real packages/: pinning
  // the current [] result would bake the bug's own output in as expected, so
  // fixing the bug would read as a regression.

  await withFixture(async (root) => {
    const toolDir = await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: '*' } });
    await fs.promises.mkdir(path.join(toolDir, 'pro'), { recursive: true });
    const pm = pmOverPackagesDir(root);
    check("getAvailableVariants: lists 'pro' when packages/<tool>/pro/ exists",
      JSON.stringify(pm.getAvailableVariants('t')) === JSON.stringify(['pro']),
      JSON.stringify(pm.getAvailableVariants('t')));
  });

  // ---- getAvailableContent: dynamic directory-name resolution --------------
  // (Not the dedup behaviour — that suite owns this method's dedup contract.)

  {
    const pm = new PackageManager();
    const droid = await pm.getAvailableContent(path.join(REAL_PACKAGES_DIR, 'droid'));
    check("getAvailableContent: resolves droid's agents directory as 'droids'",
      droid.agentsDir === 'droids' && droid.agents.length > 0,
      `agentsDir=${droid.agentsDir}, count=${droid.agents.length}`);

    const opencode = await pm.getAvailableContent(path.join(REAL_PACKAGES_DIR, 'opencode'));
    check("getAvailableContent: resolves opencode's agents/commands dirs as singular 'agent'/'command'",
      opencode.agentsDir === 'agent' && opencode.commandsDir === 'command' &&
        opencode.agents.length > 0 && opencode.commands.length > 0,
      `agentsDir=${opencode.agentsDir}, commandsDir=${opencode.commandsDir}`);
  }

  // ---- getPackageContents --------------------------------------------------

  {
    const pm = new PackageManager();
    const contents = await pm.getPackageContents('claude', 'pro');
    const sum = contents.agents.length + contents.skills.length + contents.commands.length +
      contents.resources.length + contents.hooks.length + contents.plugins.length;
    check('getPackageContents: real claude/pro resolves a non-empty set of agents and skills',
      contents.agents.length > 0 && contents.skills.length > 0,
      `agents=${contents.agents.length}, skills=${contents.skills.length}`);
    check('getPackageContents: totalFiles equals the sum of every category',
      contents.totalFiles === sum,
      `totalFiles=${contents.totalFiles}, sum=${sum}`);
  }

  await checkThrows('getPackageContents: throws for an unknown tool',
    () => new PackageManager().getPackageContents('not-a-real-tool', 'pro'),
    (msg) => /Package not found: not-a-real-tool/.test(msg));

  await checkThrows("getPackageContents: throws for an unknown variant ('standard') on a real tool",
    () => new PackageManager().getPackageContents('claude', 'standard'),
    (msg) => /Variant 'standard' not found for tool claude/.test(msg));

  // ---- countFiles -----------------------------------------------------------

  await withFixture(async (root) => {
    await fs.promises.mkdir(path.join(root, 'nested', 'deeper'), { recursive: true });
    await fs.promises.writeFile(path.join(root, 'a.txt'), 'a');
    await fs.promises.writeFile(path.join(root, 'nested', 'b.txt'), 'b');
    await fs.promises.writeFile(path.join(root, 'nested', 'deeper', 'c.txt'), 'c');
    const pm = new PackageManager();
    const files = await pm.countFiles(root);
    check('countFiles: recurses into nested directories and counts only files',
      files.length === 3 && files.every((f) => f.endsWith('.txt')),
      JSON.stringify(files));
  });

  // ---- formatBytes -----------------------------------------------------------

  {
    const pm = new PackageManager();
    check("formatBytes(0) === '0 Bytes'", pm.formatBytes(0) === '0 Bytes', pm.formatBytes(0));
    check("formatBytes(1024) === '1 KB'", pm.formatBytes(1024) === '1 KB', pm.formatBytes(1024));
    check("formatBytes(1536) === '1.5 KB'", pm.formatBytes(1536) === '1.5 KB', pm.formatBytes(1536));
    check("formatBytes(1048576) === '1 MB'", pm.formatBytes(1048576) === '1 MB', pm.formatBytes(1048576));
  }

  // ---- getPackageSize ---------------------------------------------------------

  {
    const pm = new PackageManager();
    const { size, formattedSize } = await pm.getPackageSize('claude', 'pro');
    check('getPackageSize: real claude/pro has a positive total size', size > 0, size);
    check("getPackageSize: formattedSize matches formatBytes(size)",
      formattedSize === pm.formatBytes(size), `${formattedSize} vs ${pm.formatBytes(size)}`);
  }

  // ---- validatePackage ---------------------------------------------------------

  {
    const pm = new PackageManager();
    const result = await pm.validatePackage('claude', 'pro');
    check('validatePackage: real claude/pro is valid with zero issues',
      result.valid === true && result.issues.length === 0,
      JSON.stringify(result));
  }

  await withFixture(async (root) => {
    // A variant that selects an agent no available agent provides. Since
    // getAvailableContent only ever lists names that exist on disk,
    // selectVariantContent's own existence check rejects 'ghost' before
    // validatePackage's per-item file check ever runs — the result is still
    // an invalid package, just reported via the catch-and-report path (see
    // Check 6 in validatePackage) rather than the missingFiles counter.
    const toolDir = await writeVariantsJson(root, 't', { pro: { name: 'P', description: 'd', agents: ['ghost'] } });
    await fs.promises.mkdir(path.join(toolDir, 'agents'), { recursive: true });
    // Note: nothing named ghost.md is written, so 'ghost' never appears in
    // availableContent either.
    const pm = pmOverPackagesDir(root);
    const result = await pm.validatePackage('t', 'pro');
    check('validatePackage: reports an unresolvable selected agent as invalid',
      result.valid === false && /ghost/.test(result.error),
      JSON.stringify(result));
  });

  {
    // validatePackage never throws for a bad variant name — it catches the
    // error from selectVariantContent and returns an invalid result instead.
    const pm = new PackageManager();
    const result = await pm.validatePackage('claude', 'standard');
    check("validatePackage: reports (never throws) invalid for an unknown variant ('standard')",
      result.valid === false && /Variant 'standard' not found for tool claude/.test(result.error),
      JSON.stringify(result));
  }

  {
    const pm = new PackageManager();
    const result = await pm.validatePackage('not-a-real-tool', 'pro');
    check('validatePackage: reports a missing package directory as invalid rather than throwing',
      result.valid === false && /Package directory not found/.test(result.error),
      JSON.stringify(result));
  }

  // ---- getManifestTemplate ---------------------------------------------------------

  {
    const pm = new PackageManager();
    for (const tool of ['claude', 'ampcode', 'droid', 'opencode']) {
      const template = pm.getManifestTemplate(tool);
      check(`getManifestTemplate: real ${tool} template parses with its own 'tool' field intact`,
        template && template.tool === tool,
        JSON.stringify(template));

      // There is one install: everything. installation-engine.generateManifest
      // spreads this template wholesale into the manifest.json written to the
      // user's machine, so any field here ships to disk — and a
      // `supported_variants` list would advertise a choice that does not exist
      // and that nothing reads.
      check(`getManifestTemplate: ${tool} advertises no variant choice`,
        template && !('supported_variants' in template),
        JSON.stringify(template && template.supported_variants));
    }
  }

  await checkThrows('getManifestTemplate: throws for a tool with no manifest template',
    () => new PackageManager().getManifestTemplate('not-a-real-tool'),
    (msg) => /Manifest template not found for tool: not-a-real-tool/.test(msg));
}

main().then(() => {
  // Summary format is a contract with tests/run-all-tests.js, which parses
  // /Total tests:\s+(\d+)/, /Passed:\s+(\d+)/ and /Failed:\s+(\d+)/. Emit
  // anything else and the runner reads 0 tests and fails the count floor.
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`Total tests: ${passed + failed}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  if (failed) {
    console.log(`\n${colors.red}Failures:${colors.reset}`);
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error(`${colors.red}Suite crashed:${colors.reset} ${err && err.stack || err}`);
  console.log(`\nTotal tests: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed + 1}`);
  process.exit(1);
});
