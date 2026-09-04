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
 *         node scripts/mirror.cjs shapes   (record the per-kit frontmatter
 *                                           shape, read from the real files)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const J = (...p) => path.join(ROOT, ...p);

// Ordered longest-match-first: the first pair that matches a substring wins.
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
    dir: 'packages/ampcode', cmd: 'commands', agent: 'agents',
    subs: [
      ['~/.claude/skills/', '~/.config/amp/commands/'],
      ['~/.claude/', '~/.config/amp/'],
      ['.claude/', '.amp/'],
      ["'.claude'", "'.amp'"],
      ['CLAUDE.md', 'AGENT.md'],
    ],
  },
  opencode: {
    dir: 'packages/opencode', cmd: 'command', agent: 'agent',
    subs: [
      ['~/.claude/commands/', '~/.config/opencode/command/'],
      ['~/.claude/agents/', '~/.config/opencode/agent/'],
      ['~/.claude/skills/', '~/.config/opencode/command/'],
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
  const cmdDir = J('packages/claude/commands');
  for (const e of fs.readdirSync(cmdDir, { withFileTypes: true })) {
    const p = path.join(cmdDir, e.name);
    if (e.isDirectory()) {
      for (const f of walk(p)) out.push({ src: f, kind: 'cmd', rel: path.relative(cmdDir, f) });
    } else if (e.name.endsWith('.md')) {
      out.push({ src: p, kind: 'cmd', rel: e.name });
    }
  }
  // Claude ships these as skills; the other kits fold them into commands.
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

/**
 * Print the frontmatter shape each kit actually uses, read from the files
 * themselves rather than from a table in this script. Subagent frontmatter is
 * correct per kit and is the reference; commands/skills are compared to it.
 */
function shapes() {
  const groups = [
    ['subagents', { claude: 'packages/claude/agents', droid: 'packages/droid/droids',
                    ampcode: 'packages/ampcode/agents', opencode: 'packages/opencode/agent' }],
    ['commands',  { claude: 'packages/claude/commands', droid: 'packages/droid/commands',
                    ampcode: 'packages/ampcode/commands', opencode: 'packages/opencode/command' }],
  ];
  for (const [label, dirs] of groups) {
    console.log(`\n## ${label}`);
    for (const [kit, dir] of Object.entries(dirs)) {
      const counts = new Map();
      let total = 0;
      for (const f of fs.readdirSync(J(dir))) {
        if (!f.endsWith('.md')) continue;
        total++;
        const fm = splitFrontmatter(fs.readFileSync(J(dir, f), 'utf8'))[0];
        for (const line of fm.split('\n')) {
          const m = line.match(/^([A-Za-z_-]+):/);
          if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
        }
      }
      const keys = [...counts.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (n === total ? k : `${k}(${n}/${total})`));
      console.log(`${kit.padEnd(9)} ${total} files: ${keys.join(', ')}`);
    }
  }
  // Claude ships four of its commands as skills; report those separately.
  console.log('\n## claude skills');
  for (const d of fs.readdirSync(J('packages/claude/skills'))) {
    const fm = splitFrontmatter(fs.readFileSync(J('packages/claude/skills', d, 'SKILL.md'), 'utf8'))[0];
    const keys = fm.split('\n').map((l) => (l.match(/^([A-Za-z_-]+):/) || [])[1]).filter(Boolean);
    console.log(`${d.padEnd(14)} ${keys.join(', ')}`);
  }
}

function main() {
  const mode = process.argv[2] || 'check';
  if (mode === 'shapes') return shapes();
  if (!['check', 'sync', 'diff'].includes(mode)) {
    console.error('usage: mirror.cjs [check|diff|sync|shapes]');
    process.exit(2);
  }
  const problems = [];
  let written = 0;
  let checked = 0;

  for (const entry of sources()) {
    if (EXEMPT.has(`${entry.kind}:${entry.rel}`)) continue;
    for (const [name, kit] of Object.entries(KITS)) {
      const dst = J(kit.dir, entry.kind === 'cmd' ? kit.cmd : kit.agent, entry.rel);
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
    console.error(`\n${problems.length} of ${checked} mirrored file(s) out of sync. Run: node scripts/mirror.cjs sync`);
    process.exit(1);
  }
  console.log(`mirror: ${checked} file(s) in sync across 3 kits (${EXEMPT.size} exempt).`);
}

main();
