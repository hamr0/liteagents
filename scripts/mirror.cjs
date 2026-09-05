#!/usr/bin/env node
/**
 * Mirror packages/claude out to the droid / ampcode / opencode kits.
 *
 * Ownership, one writer per piece of state:
 *   - packages/claude owns every BODY (and whole file, for bundled assets).
 *   - each target file owns its OWN frontmatter — never generated, never
 *     overwritten. That is where the per-kit shape lives (tools arrays vs
 *     permission maps, `Bash(x:*)` vs `Bash(x *)`).
 *   - this script owns the path substitutions between them.
 *
 * Usage:  node scripts/mirror.cjs check    (default — exits 1 on drift)
 *         node scripts/mirror.cjs diff     (show what sync would change)
 *         node scripts/mirror.cjs sync     (writes)
 *         node scripts/mirror.cjs shapes   (rewrite scripts/frontmatter.json
 *                                           from what the files actually say)
 *
 * `check` verifies TWO things: bodies match claude after path substitution,
 * AND every file's frontmatter matches its kit's shape in frontmatter.json.
 * The mirror preserves frontmatter but cannot judge it — frontmatter.json is
 * what judges it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const J = (...p) => path.join(ROOT, ...p);

// Ordered longest-match-first: substitute() applies every pair in order via
// reduce, so an earlier pair can affect what a later pair matches.
const KITS = {
  droid: {
    dir: 'packages/droid', cmd: 'commands', agent: 'droids',
    subs: [
      ['~/.claude/agents/', '~/.factory/droids/'],
      ['~/.claude/skills/', '~/.factory/commands/'],
      ['~/.claude/', '~/.factory/'],
      ['.claude/', '.factory/'],
      ["'.claude'", "'.factory'"],
      ['CLAUDE.md', 'AGENTS.md'],
    ],
  },
  ampcode: {
    // Amp removed custom commands in favour of skills, so every capability
    // ships as skills/<name>/SKILL.md — the same shape claude uses.
    dir: 'packages/ampcode', cmd: 'skills', agent: 'agents', cmdLayout: 'skill',
    subs: [
      ['~/.claude/skills/', '~/.config/amp/skills/'],
      ['~/.claude/commands/', '~/.config/amp/skills/'],
      ['~/.claude/', '~/.config/amp/'],
      ['.claude/', '.amp/'],
      ["'.claude'", "'.amp'"],
      ['CLAUDE.md', 'AGENT.md'],
    ],
  },
  opencode: {
    dir: 'packages/opencode', cmd: 'command', agent: 'agent',
    subs: [
      ['~/.claude/skills/', '~/.config/opencode/command/'],
      ['~/.claude/commands/', '~/.config/opencode/command/'],
      ['~/.claude/agents/', '~/.config/opencode/agent/'],
      ['~/.claude/', '~/.config/opencode/'],
      ['.claude/', '.opencode/'],
      ["'.claude'", "'.opencode'"],
      ['CLAUDE.md', 'AGENTS.md'],
    ],
  },
};

// Files whose body genuinely differs per kit, beyond path substitution.
// orchestrator.md: droid has no skills folder, so it drops a whole table row.
// Keep this list as short as it can possibly be — every entry is a file no
// longer covered by the drift check.
const EXEMPT = new Set([
  // droid has no skills folder, so it drops a whole table row.
  'agent:orchestrator.md',
  // Kit-agnostic by design: it reads its config filename from an env var and
  // carries a protected-names list that must contain CLAUDE.md, AGENTS.md and
  // AGENT.md all three. Substituting would collapse that list. Byte-identical
  // in all four kits today, and must stay that way.
  'cmd:docs-builder/docs-builder.cjs',
  // Owned by sync-rules.cjs at runtime, and its heading anchors do not survive
  // a plain find-and-replace (#claudemd-stub).
  'cmd:remember/AGENT_RULES.md',
  // Same protected-names list as the script it documents, plus a CONFIG= line
  // whose default and whose per-kit value are both spelled out.
  'cmd:docs-builder.md',
  // Carries two different per-kit constants that a single table cannot tell
  // apart: the install dir (~/.config/amp) and the in-repo dir (.amp).
  'cmd:remember/version-check.cjs',
]);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

/** Every claude file that should exist in the other kits, and where. */
function sources() {
  const out = [];
  // Claude ships every capability as a skill. Droid and opencode still use
  // commands, so a skill's SKILL.md becomes <name>.md there and its bundled
  // files keep their <name>/ directory.
  const skillDir = J('packages/claude/skills');
  for (const d of fs.readdirSync(skillDir)) {
    const base = path.join(skillDir, d);
    for (const f of walk(base)) {
      const r = path.relative(base, f);
      out.push({ src: f, kind: 'cmd', rel: r === 'SKILL.md' ? `${d}.md` : path.join(d, r) });
    }
  }
  const agentDir = J('packages/claude/agents');
  for (const f of fs.readdirSync(agentDir)) {
    if (f.endsWith('.md')) out.push({ src: path.join(agentDir, f), kind: 'agent', rel: f });
  }
  return out;
}

/**
 * Where an entry lands inside a kit. Most kits keep claude's flat command
 * layout; amp ships every capability as skills/<name>/SKILL.md, so a
 * top-level `foo.md` becomes `foo/SKILL.md` and bundled assets are already
 * under `foo/`.
 */
function relFor(entry, kit) {
  if (entry.kind !== 'cmd' || kit.cmdLayout !== 'skill') return entry.rel;
  return entry.rel.includes(path.sep) ? entry.rel : `${entry.rel.replace(/\.md$/, '')}/SKILL.md`;
}

/** Split off YAML frontmatter. Returns ['', text] when there is none. */
function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return ['', text];
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) return ['', text];
  return [text.slice(0, end + 5), text.slice(end + 5)];
}

/**
 * Path substitution, skipping any region a source file fences off with
 * `mirror:literal:start` / `mirror:literal:end`. A few blocks — the
 * cross-tool sessions-root probe list, for one — name every tool's real path
 * on purpose and must read the same in all four kits.
 */
function substitute(text, subs) {
  let literal = false;
  return text.split('\n').map((line) => {
    if (line.includes('mirror:literal:start')) { literal = true; return line; }
    if (line.includes('mirror:literal:end')) { literal = false; return line; }
    return literal ? line : subs.reduce((t, [a, b]) => t.split(a).join(b), line);
  }).join('\n');
}

/** What the target file's content should be. */
function expected(entry, kit, dstPath) {
  const src = fs.readFileSync(entry.src, 'utf8');
  if (!entry.src.endsWith('.md')) return substitute(src, kit.subs);
  const [, body] = splitFrontmatter(src);
  let fm = splitFrontmatter(src)[0];
  if (fs.existsSync(dstPath)) {
    const own = splitFrontmatter(fs.readFileSync(dstPath, 'utf8'))[0];
    if (own) fm = own; // the target keeps its own frontmatter
  }
  return fm + substitute(body, kit.subs);
}

const SHAPE_FILE = J('scripts/frontmatter.json');

// Each tool supports a different set of frontmatter keys, so they are judged
// separately. Amp removed custom commands, so its capabilities are skills.
const DIRS = {
  subagent: { claude: 'packages/claude/agents', droid: 'packages/droid/droids',
              ampcode: 'packages/ampcode/agents', opencode: 'packages/opencode/agent' },
  command:  { droid: 'packages/droid/commands', opencode: 'packages/opencode/command' },
  skill:    { claude: 'packages/claude/skills', ampcode: 'packages/ampcode/skills' },
};

/** The frontmatter-bearing files for one kind in one kit. */
function frontmatterFiles(kind, kit, dir) {
  if (kind === 'skill') {
    return fs.readdirSync(J(dir)).map((d) => J(dir, d, 'SKILL.md')).filter((f) => fs.existsSync(f));
  }
  return fs.readdirSync(J(dir)).filter((f) => f.endsWith('.md')).map((f) => J(dir, f));
}

const fmKeys = (text) =>
  splitFrontmatter(text)[0].split('\n')
    .map((l) => (l.match(/^([A-Za-z_-]+):/) || [])[1]).filter(Boolean);

/** 'colon' = Bash(git diff:*), 'space' = Bash(git diff *), null = no Bash entries. */
function bashStyle(text) {
  const line = splitFrontmatter(text)[0].split('\n').find((l) => l.startsWith('allowed-tools:'));
  if (!line || !line.includes('Bash(')) return null;
  return /Bash\([^)]*:\*\)/.test(line) ? 'colon' : 'space';
}

/** What the files actually say today — the candidate shape. */
function computeShapes() {
  const out = {};
  for (const [kind, dirs] of Object.entries(DIRS)) {
    out[kind] = {};
    for (const [kit, dir] of Object.entries(dirs)) {
      const files = frontmatterFiles(kind, kit, dir);
      const counts = new Map();
      let style = null;
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        for (const k of new Set(fmKeys(text))) counts.set(k, (counts.get(k) || 0) + 1);
        style = bashStyle(text) || style;
      }
      out[kind][kit] = {
        required: [...counts.entries()].filter(([, n]) => n === files.length).map(([k]) => k).sort(),
        optional: [...counts.entries()].filter(([, n]) => n < files.length).map(([k]) => k).sort(),
        bashStyle: style,
      };
    }
  }
  return out;
}

/**
 * Compare a frozen shape against a freshly computed one. Anything that makes
 * the check WEAKER (a required key demoted to optional or dropped entirely,
 * or a bashStyle relaxed to null) is flagged as WEAKENING; everything else
 * (a key added, an optional key dropped) is reported as a plain change.
 */
function diffShapes(old, neu) {
  const lines = [];
  for (const kind of new Set([...Object.keys(old), ...Object.keys(neu)])) {
    const oldKits = old[kind] || {};
    const newKits = neu[kind] || {};
    for (const kit of new Set([...Object.keys(oldKits), ...Object.keys(newKits)])) {
      const o = oldKits[kit] || { required: [], optional: [], bashStyle: null };
      const n = newKits[kit] || { required: [], optional: [], bashStyle: null };
      for (const k of o.required) {
        if (n.required.includes(k)) continue;
        lines.push(n.optional.includes(k)
          ? `WEAKENING ${kind}/${kit}: '${k}' demoted from required to optional`
          : `WEAKENING ${kind}/${kit}: required key '${k}' disappeared entirely`);
      }
      for (const k of n.required) if (!o.required.includes(k)) lines.push(`  ${kind}/${kit}: '${k}' added to required`);
      for (const k of o.optional) if (!n.optional.includes(k) && !n.required.includes(k)) lines.push(`  ${kind}/${kit}: optional key '${k}' disappeared`);
      for (const k of n.optional) if (!o.optional.includes(k) && !o.required.includes(k)) lines.push(`  ${kind}/${kit}: '${k}' added to optional`);
      if (o.bashStyle !== n.bashStyle) {
        lines.push(`${n.bashStyle === null && o.bashStyle ? 'WEAKENING ' : '  '}${kind}/${kit}: bashStyle changed from ${o.bashStyle} to ${n.bashStyle}`);
      }
    }
  }
  return lines;
}

/**
 * scripts/frontmatter.json freezes the shape recorded the day it was last
 * deliberately (re-)recorded — it is the truth `check` judges files against,
 * not a rolling derivation from today's files. Without freezing, dropping a
 * key from every file of a kit and re-running `shapes` makes the key silently
 * stop being required: a circular, useless check. The top-level `frozen` date
 * lives alongside the per-kind keys (subagent/command/skill); checkFrontmatter
 * only ever reads shape[kind] for kind in DIRS, so it already ignores `frozen`
 * without needing a special case.
 */
function shapes() {
  const force = process.argv.includes('--force');
  const computed = computeShapes();
  if (fs.existsSync(SHAPE_FILE) && !force) {
    const { frozen, ...existing } = JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8'));
    const diffs = diffShapes(existing, computed);
    if (diffs.length) {
      console.error(`${path.relative(ROOT, SHAPE_FILE)} is frozen as of ${frozen || 'unknown'} — refusing to overwrite it.`);
      console.error('Re-run with --force to deliberately re-record it (this updates the frozen date).\n');
      console.error(diffs.join('\n'));
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, SHAPE_FILE)} already matches the frozen shape (frozen ${frozen}); nothing to do.`);
    return;
  }
  const frozen = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(SHAPE_FILE, `${JSON.stringify({ frozen, ...computed }, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, SHAPE_FILE)} (frozen ${frozen})`);
}

// A path that belongs to a different tool. Each kit's own dirs are stripped
// from its list below, so only foreign ones are flagged.
const KIT_PATHS = {
  claude:   ['.claude/', 'CLAUDE.md'],
  droid:    ['.factory/', 'AGENTS.md'],
  ampcode:  ['.amp/', '~/.config/amp/', 'AGENT.md'],
  opencode: ['.opencode/', '~/.config/opencode/', 'AGENTS.md'],
};

/**
 * A package must not tell its users to look in another tool's directory. This
 * is the class of bug the hand-mirroring kept shipping: droid's /refactor
 * pointing at `.claude/remember/`. Files fenced with `mirror:literal` and
 * files in EXEMPT are skipped — those name every tool on purpose.
 */
function checkPaths() {
  const problems = [];
  // An exempt file keeps its exemption under amp's skills/<name>/SKILL.md
  // layout too, where its basename no longer appears in the path.
  const exemptSuffixes = [...EXEMPT].flatMap((e) => {
    const rel = e.split(':')[1];
    return [rel, rel.replace(/([^/]+)\.md$/, '$1/SKILL.md')];
  });
  const dirs = { claude: 'packages/claude', droid: 'packages/droid',
                 ampcode: 'packages/ampcode', opencode: 'packages/opencode' };
  for (const [kit, base] of Object.entries(dirs)) {
    const own = new Set(KIT_PATHS[kit]);
    const foreign = Object.entries(KIT_PATHS)
      .filter(([k]) => k !== kit).flatMap(([, v]) => v);
    const foreignSet = [...new Set(foreign)].filter((t) => !own.has(t));
    for (const f of walk(J(base))) {
      if (!f.endsWith('.md')) continue;
      const rel = path.relative(ROOT, f);
      if (exemptSuffixes.some((e) => rel.endsWith(e))) continue;
      let literal = false;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('mirror:literal:start')) literal = true;
        else if (line.includes('mirror:literal:end')) literal = false;
        else if (!literal) {
          for (const t of foreignSet) {
            if (line.includes(t)) problems.push(`PATH    ${rel}:${i + 1}: names '${t}', which belongs to another tool`);
          }
        }
      });
    }
  }
  return problems;
}

// Install roots, so a documented `~/.claude/skills/x` can be resolved back to
// the file this repo actually ships at packages/claude/skills/x.
const INSTALL_ROOTS = [
  ['~/.config/opencode/', 'packages/opencode'],
  ['~/.config/amp/', 'packages/ampcode'],
  ['~/.factory/', 'packages/droid'],
  ['~/.claude/', 'packages/claude'],
];

/**
 * A package must not document an install path it does not ship. This is what
 * broke when commands became skills: remember/SKILL.md still said
 * `node ~/.claude/commands/remember/version-check.cjs`, a path that no longer
 * exists. Glob segments are checked as far as their parent directory.
 */
function checkInstallPaths() {
  const problems = [];
  const exemptSuffixes = [...EXEMPT].flatMap((e) => {
    const rel = e.split(':')[1];
    return [rel, rel.replace(/([^/]+)\.md$/, '$1/SKILL.md')];
  });
  for (const [, base] of INSTALL_ROOTS) {
    for (const f of walk(J(base))) {
      if (!f.endsWith('.md')) continue;
      const rel = path.relative(ROOT, f);
      if (exemptSuffixes.some((e) => rel.endsWith(e))) continue;
      let literal = false;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('mirror:literal:start')) { literal = true; return; }
        if (line.includes('mirror:literal:end')) { literal = false; return; }
        if (literal) return;
        for (const m of line.matchAll(/~\/(?:\.config\/[a-z]+|\.[a-z]+)\/[A-Za-z0-9_./*-]+/g)) {
          const hit = m[0].replace(/[.,)`]+$/, '');
          const root = INSTALL_ROOTS.find(([r]) => hit.startsWith(r));
          if (!root) continue;
          let sub = hit.slice(root[0].length);
          if (sub.includes('*')) sub = sub.slice(0, sub.indexOf('*')).replace(/\/$/, '');
          if (!sub) continue;
          if (!fs.existsSync(J(root[1], sub))) {
            problems.push(`INSTALL ${rel}:${i + 1}: documents '${hit}', not shipped at ${root[1]}/${sub}`);
          }
        }
      });
    }
  }
  return problems;
}

/** Judge every file's frontmatter against the recorded shape. */
function checkFrontmatter() {
  if (!fs.existsSync(SHAPE_FILE)) {
    return [`MISSING ${path.relative(ROOT, SHAPE_FILE)} — run: node scripts/mirror.cjs shapes`];
  }
  const shape = JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8'));
  const problems = [];
  for (const [kind, dirs] of Object.entries(DIRS)) {
    for (const [kit, dir] of Object.entries(dirs)) {
      const want = shape[kind] && shape[kind][kit];
      if (!want) { problems.push(`FM      no recorded shape for ${kind}/${kit}`); continue; }
      const allowed = new Set([...want.required, ...want.optional]);
      for (const f of frontmatterFiles(kind, kit, dir)) {
        const rel = path.relative(ROOT, f);
        const text = fs.readFileSync(f, 'utf8');
        const keys = fmKeys(text);
        if (!keys.length) { problems.push(`FM      ${rel}: no frontmatter`); continue; }
        for (const k of want.required) if (!keys.includes(k)) problems.push(`FM      ${rel}: missing required key '${k}'`);
        for (const k of keys) if (!allowed.has(k)) problems.push(`FM      ${rel}: key '${k}' is not part of the ${kit} ${kind} shape`);
        const style = bashStyle(text);
        if (style && want.bashStyle && style !== want.bashStyle) {
          problems.push(`FM      ${rel}: allowed-tools uses '${style}' Bash style, ${kit} uses '${want.bashStyle}'`);
        }
      }
    }
  }
  return problems;
}

/**
 * A file present under a kit's cmd/agent dir with no matching packages/claude
 * source is a stale orphan left behind when a capability moves or is removed.
 * The expected set is built the same way the writer builds a destination path
 * (sources() mapped through relFor), which naturally covers bundled asset
 * files too since sources() already walks each skill directory recursively.
 * An EXEMPT entry's path is still included here — EXEMPT only excuses the
 * writer from judging that file's BODY, the file itself is still expected to
 * exist, so it must never be reported as an orphan.
 */
function checkOrphans() {
  const problems = [];
  const src = sources();
  for (const kit of Object.values(KITS)) {
    const expected = new Set(src.map((e) => J(kit.dir, e.kind === 'cmd' ? kit.cmd : kit.agent, relFor(e, kit))));
    for (const sub of [kit.cmd, kit.agent]) {
      const dir = J(kit.dir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const f of walk(dir)) {
        if (!expected.has(f)) problems.push(`ORPHAN  ${path.relative(ROOT, f)}: no matching packages/claude source`);
      }
    }
  }
  return problems;
}

function main() {
  const mode = process.argv[2] || 'check';
  if (mode === 'shapes') return shapes();
  if (!['check', 'sync', 'diff'].includes(mode)) {
    console.error('usage: mirror.cjs [check|diff|sync|shapes]');
    process.exit(2);
  }
  const problems = mode === 'check'
    ? [...checkFrontmatter(), ...checkPaths(), ...checkInstallPaths(), ...checkOrphans()] : [];
  let written = 0;
  let checked = 0;

  for (const entry of sources()) {
    if (EXEMPT.has(`${entry.kind}:${entry.rel}`)) continue;
    for (const [name, kit] of Object.entries(KITS)) {
      const dst = J(kit.dir, entry.kind === 'cmd' ? kit.cmd : kit.agent, relFor(entry, kit));
      const want = expected(entry, kit, dst);
      checked++;
      const have = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
      if (have === want) continue;
      if (mode === 'diff') {
        console.log(`\n=== ${path.relative(ROOT, dst)}`);
        if (have === null) { console.log('(missing — sync would create it)'); problems.push(dst); continue; }
        const h = have.split('\n'); const w = want.split('\n');
        for (let i = 0; i < Math.max(h.length, w.length); i++) {
          if (h[i] !== w[i]) {
            if (h[i] !== undefined) console.log(`  ${i + 1}- ${h[i]}`);
            if (w[i] !== undefined) console.log(`  ${i + 1}+ ${w[i]}`);
          }
        }
        problems.push(dst);
        continue;
      }
      if (mode === 'sync') {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, want);
        console.log(`${have === null ? 'created' : 'updated'} ${path.relative(ROOT, dst)}`);
        written++;
      } else {
        problems.push(`${have === null ? 'MISSING ' : 'DRIFT   '} ${path.relative(ROOT, dst)}`);
      }
    }
  }

  if (mode === 'sync') {
    console.log(`\n${written} file(s) written, ${checked} checked.`);
    return;
  }
  if (mode === 'diff') {
    console.log(`\n${problems.length} of ${checked} mirrored file(s) would change.`);
    return;
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problem(s). DRIFT/MISSING → node scripts/mirror.cjs sync. FM → fix the file, or re-record with: node scripts/mirror.cjs shapes`);
    process.exit(1);
  }
  console.log(`mirror: ${checked} bodies in sync across 3 kits (${EXEMPT.size} exempt); frontmatter matches ${path.relative(ROOT, SHAPE_FILE)}; no cross-tool paths; every documented install path ships.`);
}

main();
