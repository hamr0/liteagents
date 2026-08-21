#!/usr/bin/env node
'use strict';
// docs-builder — every mechanical step of the pipeline. Vanilla Node, zero deps, NO MODEL.
// The model is used for exactly two things (propose themes, write pages); everything else
// lives here, because bookkeeping done by a script is 100% and done by a model is 27%.
//
//   scan     <file.md...>                          -> outline.json   (Layer 1)
//   validate <outline.json> <labels.json>          -> PASS/FAIL      (Layer 2 gate)
//   plan     <outline.json> <labels.json>          -> task-<theme>.json per page (resumes)
//   index    <outline.json> <labels.json>          -> index.md       (coarse reader index)
//   archive  <src.md> [dest.md]                    -> verified MOVE into docs/archive/
//   ledger                                         -> record the current state of docs/
//   due                                            -> what changed since the ledger, and how much
//   lint     <file.md...>                          -> lint.json      (declared-only checks)
//
// Env: REPO (default cwd), OUT (output path override).

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = process.env.REPO || process.cwd();
const clean = s => s.replace(/\s+/g, ' ').trim();
// Source .md paths are repo-relative; JSON artifacts the pipeline itself produced are
// cwd-relative. Keeping these separate stops `plan` looking for outline.json inside the
// repo being documented.
const read = f => fs.readFileSync(path.isAbsolute(f) ? f : path.join(REPO, f), 'utf8');
const readArtifact = f => fs.readFileSync(f, 'utf8');
const die = m => { console.error(m); process.exit(1); };

// ---------------------------------------------------------------- shared parsing

// Headings inside ``` or ~~~ fences are not headings.
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = false, marker = null;
  lines.forEach((ln, i) => {
    const t = ln.trimStart();
    if (t.startsWith('```') || t.startsWith('~~~')) {
      const m = t.slice(0, 3);
      if (!open) { open = true; marker = m; mask[i] = true; }
      else if (m === marker) { mask[i] = true; open = false; marker = null; }
      else mask[i] = true;
    } else mask[i] = open;
  });
  return mask;
}

const ID_RE = /^([A-Z]{1,4}\d{1,4}(?:[-–][A-Z]?\d{1,4})?)\b/;

// THE KEY. The model echoes this string back verbatim; the validator checks that same
// string. One function, so the two can never disagree — the POC scored "86/86 byte-exact"
// against keys the prompt had silently truncated at 110 chars while the source headings
// ran longer, which is only a pass because both sides shared the same truncation by luck.
// Uniqueness is GUARANTEED here, not assumed: bareloop's PRD has 0 collisions, but a repo
// with "## Cache Invalidation" in three files has three.
const KEY_WIDTH = 110;
function makeKeys(records, multiFile) {
  const seen = new Map();
  for (const r of records) {
    let base = r.id || (r.h2.length > KEY_WIDTH ? r.h2.slice(0, KEY_WIDTH) : r.h2);
    if (multiFile) base = `${r.file} :: ${base}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.key = n === 1 ? base : `${base} #${n}`;
    if (n > 1) console.error(`WARN: key collision disambiguated -> ${r.key}`);
  }
  return records;
}

function headings(lines) {
  const mask = fenceMask(lines);
  const h1 = (lines.find((l, i) => !mask[i] && l.startsWith('# ')) || '').slice(2).trim();
  const heads = [];
  lines.forEach((l, i) => {
    if (mask[i]) return;
    const m = l.match(/^(#{2,4})\s+(.+)$/);
    if (m) heads.push({ lvl: m[1].length, text: clean(m[2]), line: i + 1 });
  });
  return { h1, heads };
}

// First two prose lines under a heading — enough for a model to tell sections apart.
function snippet(lines, from, to, cap) {
  const out = [];
  for (let i = from; i < to && out.length < 2; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t.startsWith('```') || /^[|>-]{3,}$/.test(t)) continue;
    out.push(t);
  }
  return clean(out.join(' ')).slice(0, cap);
}

// ---------------------------------------------------------------- scan (Layer 1)

function scan(files) {
  if (!files.length) die('usage: docs-builder.js scan <file.md...>');
  const records = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    const { h1, heads } = headings(lines);
    const h2s = heads.filter(h => h.lvl === 2);
    h2s.forEach((h2, k) => {
      const s = h2.line;
      const e = k + 1 < h2s.length ? h2s[k + 1].line - 1 : lines.length;
      const kids = heads.filter(h => h.lvl >= 3 && h.line > s && h.line <= e);
      // Every H3 carries its OWN start/end so a page writer can read it alone.
      const h3 = kids.map((c, ci) => ({
        t: c.t || c.text, lvl: c.lvl, s: c.line,
        e: ci + 1 < kids.length ? kids[ci + 1].line - 1 : e
      }));
      const idm = h2.text.match(ID_RE);
      records.push({
        h1, file: f, h2: h2.text, id: idm ? idm[1] : null, s, e,
        lines: e - s + 1,
        chars: lines.slice(s - 1, e).join('\n').length,
        snip: snippet(lines, s, h3.length ? h3[0].s - 1 : e, 300),
        h3
      });
    });
  }
  makeKeys(records, files.length > 1);
  const out = {
    generated: new Date().toISOString(), repo: REPO, files,
    totals: {
      records: records.length,
      h3Rows: records.reduce((a, r) => a + r.h3.length, 0),
      withId: records.filter(r => r.id).length,
      truncatedKeys: records.filter(r => !r.id && r.h2.length > KEY_WIDTH).length
    },
    records
  };
  write(out, 'outline.json');
  console.log(JSON.stringify(out.totals, null, 1));
  // Say the contract out loud so a caller cannot get it wrong.
  console.log('key: echo records[].key back VERBATIM. Never emit a positional index.');
}

// ---------------------------------------------------------------- validate (Layer 2 gate)

// labels.json: { themes: [{name, gloss}], labels: [{key, theme}] }
// This is the gate that catches the POC A failure class: positional drift producing
// dropped, shifted and duplicated keys inside confident-looking output.
function keyOf(r) {
  if (!r.key) die('outline.json has no records[].key — re-run `docs-builder.js scan`');
  return r.key;
}

function loadPair(outlineF, labelsF) {
  const o = JSON.parse(readArtifact(outlineF)), l = JSON.parse(readArtifact(labelsF));
  if (!Array.isArray(o.records)) die('outline.json has no records[]');
  if (!Array.isArray(l.labels)) die('labels.json has no labels[]');
  // Without a theme list the "none off-list" check silently passes anything. A gate that
  // quietly stops checking is worse than no gate.
  if (!Array.isArray(l.themes) || !l.themes.length)
    die('labels.json has no themes[] — the off-list check cannot run. Emit the propose '
      + 'pass output alongside the labels.');
  return [o, l];
}

function validate(outlineF, labelsF) {
  if (!outlineF || !labelsF) die('usage: docs-builder.js validate <outline.json> <labels.json>');
  const [o, l] = loadPair(outlineF, labelsF);
  const expect = new Map(o.records.map(r => [keyOf(r), r]));
  const themes = new Set((l.themes || []).map(t => t.name));
  const seen = new Map();
  const invented = [], offTheme = [], dupes = [];
  for (const row of l.labels) {
    if (!expect.has(row.key)) { invented.push(row.key); continue; }
    if (seen.has(row.key)) dupes.push(row.key); else seen.set(row.key, row.theme);
    if (themes.size && !themes.has(row.theme)) offTheme.push(`${row.key} -> ${row.theme}`);
  }
  const missing = [...expect.keys()].filter(k => !seen.has(k));
  const covered = [...seen.keys()].reduce((a, k) => a + expect.get(k).lines, 0);
  const total = o.records.reduce((a, r) => a + r.lines, 0);
  const pass = !invented.length && !offTheme.length && !dupes.length && !missing.length;
  const res = {
    sections: o.records.length, labels: l.labels.length,
    invented, offTheme, dupes, missing,
    linesCovered: covered, linesTotal: total,
    verdict: pass ? 'PASS' : 'FAIL'
  };
  console.log(JSON.stringify({
    ...res, invented: invented.length, offTheme: offTheme.length,
    dupes: dupes.length, missing: missing.length
  }, null, 1));
  if (!pass) {
    for (const [k, v] of [['invented', invented], ['off-theme', offTheme],
                          ['duplicate', dupes], ['missing', missing]])
      if (v.length) console.error(`\n${k} (${v.length}):\n  ` + v.slice(0, 20).join('\n  '));
  }
  write(res, 'validate.json');
  process.exit(pass ? 0 : 1);
}

// ---------------------------------------------------------------- plan (page writer inputs)

function slugOf(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
}

// Two different theme names can slug identically ("A/B testing" and "A-B testing" both give
// `a-b-testing`), which silently overwrote one theme's task file and pointed two index
// entries at one page — a whole page of content vanishing with no error. Slugs are assigned
// once, for all themes together, and disambiguated on collision.
function slugMap(themes) {
  const used = new Map(), out = new Map();
  for (const t of themes) {
    const base = slugOf(t);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const slug = n === 1 ? base : `${base}-${n}`;
    if (n > 1) console.error(`WARN: theme slug collision — "${t}" -> ${slug}`);
    out.set(t, slug);
  }
  return out;
}

function group(o, l) {
  const by = new Map(o.records.map(r => [keyOf(r), r]));
  const g = new Map();
  for (const row of l.labels) {
    const r = by.get(row.key); if (!r) continue;
    if (!g.has(row.theme)) g.set(row.theme, []);
    g.get(row.theme).push(r);
  }
  for (const v of g.values()) v.sort((a, b) => a.file.localeCompare(b.file) || a.s - b.s);
  return g;
}

function plan(outlineF, labelsF) {
  if (!outlineF || !labelsF) die('usage: docs-builder.js plan <outline.json> <labels.json>');
  const [o, l] = loadPair(outlineF, labelsF);
  const gloss = new Map((l.themes || []).map(t => [t.name, t.gloss || '']));
  const dir = process.env.OUT || path.join(ARTIFACTS, 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const grouped = [...group(o, l)];
  const slugs = slugMap(grouped.map(([t]) => t));
  // Resume is not advice, it is behaviour: a page already written in PAGES is reported
  // `done` and left out of the cost estimate, so re-running `plan` after a crash relaunches
  // only what is missing. A cleanup that dies halfway and cannot resume is worse than a
  // slow one.
  const pages = process.env.PAGES || 'docs/wiki';
  const rows = [];
  for (const [theme, recs] of grouped) {
    const slug = slugs.get(theme);
    const task = {
      theme, slug, gloss: gloss.get(theme) || '',
      sources: [...new Set(recs.map(r => r.file))],
      n: recs.length,
      lines: recs.reduce((a, r) => a + r.lines, 0),
      chars: recs.reduce((a, r) => a + r.chars, 0),
      sections: recs.map(r => ({ file: r.file, h2: r.h2, s: r.s, e: r.e, lines: r.lines, sub: r.h3.length }))
    };
    fs.writeFileSync(path.join(dir, `task-${slug}.json`), JSON.stringify(task, null, 1));
    const done = fs.existsSync(path.join(REPO, pages, `${slug}.md`));
    rows.push({ theme: slug, sections: task.n, lines: task.lines, status: done ? 'done' : 'TODO' });
  }
  const todo = rows.filter(r => r.status === 'TODO');
  const tot = todo.reduce((a, r) => a + r.lines, 0);
  console.table(rows);
  if (todo.length < rows.length)
    console.log(`resuming: ${rows.length - todo.length} of ${rows.length} pages already in ${pages}/`);
  if (!todo.length) { console.log('all pages written — nothing to do.'); return; }
  // Cost law measured over 10 pages, R^2 = 0.96. 42% of the write bill is per-page fixed.
  const est = todo.length * 0.083 + tot / 1000 * 0.200;
  console.log(`pages to write: ${todo.length}  lines: ${tot}  est. write cost: $${est.toFixed(2)} (mid tier)`);
  if (todo.length > 3) console.log('launch page writers 3 at a time; each finished page is a checkpoint — re-run `plan` to resume.');
}

// ---------------------------------------------------------------- index (coarse, reader-facing)

// MEASURED: row count is the variable that decides whether an index helps or hurts.
// 16 rows fine, 97 rows won, 364 rows lost. H3 grain is the WORST arm tested — internal only.
const ROW_CEILING = 100;

function index(outlineF, labelsF) {
  if (!outlineF || !labelsF) die('usage: docs-builder.js index <outline.json> <labels.json>');
  const [o, l] = loadPair(outlineF, labelsF);
  const gloss = new Map((l.themes || []).map(t => [t.name, t.gloss || '']));
  const g = [...group(o, l)].sort((a, b) => b[1].length - a[1].length);
  const slugs = slugMap(g.map(([t]) => t));
  let rows = 0;
  let s = '# Index\n\n';
  s += '**Completeness guarantee:** every section of the source appears in exactly one row '
     + 'below. If it is not listed here, it does not exist — do not sweep other files to '
     + 'check for stragglers, this table IS the check.\n\n';
  s += 'To answer a question: read the rows that match, open only those pages, and stop.\n\n';
  s += '_Generated by `docs-builder.js index`. Never hand-edit — it is rebuilt every reconcile._\n\n';
  for (const [theme, recs] of g) {
    const slug = slugs.get(theme);
    s += `## [${theme}](wiki/${slug}.md)\n\n`;
    if (gloss.get(theme)) s += `${gloss.get(theme)}\n\n`;
    s += `${recs.length} sections.\n\n`;
    for (const r of recs) {
      rows++;
      const t = r.h2.length > 110 ? r.h2.slice(0, 107) + '...' : r.h2;
      s += `- ${r.id ? `**${r.id}** — ` : ''}${t}\n`;
    }
    s += '\n';
  }
  s += `---\n\nTotal: ${rows} rows across ${g.length} pages.\n`;
  const dest = process.env.OUT || 'index.md';
  fs.writeFileSync(dest, s);
  console.log(`wrote ${dest}: ${rows} rows / ${g.length} pages / ${s.length} chars`);
  if (rows > ROW_CEILING)
    console.log(`WARNING: ${rows} rows exceeds the ${ROW_CEILING}-row ceiling. MEASURED: a `
      + '364-row index was the losing arm. Merge themes or index at page grain, not section grain.');
}

// ---------------------------------------------------------------- archive (a real move)

// The original is NEVER rewritten and NEVER edited — but it does not stay where it was
// either, or the cleanup leaves the same content in three places (old path, archive, and
// the synthesised pages). Verified move: hash first, `git mv` so history follows, hash
// again. archive-cleanup decides later whether it can be pruned; that is a separate,
// destructive, opt-in invocation.
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function archive(src, dest) {
  if (!src) die('usage: docs-builder.js archive <src.md> [dest.md]');
  const s = path.isAbsolute(src) ? src : path.join(REPO, src);
  if (!fs.existsSync(s)) die(`no such file: ${src}`);
  const rel = dest || path.join('docs/archive', path.basename(src));
  const d = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
  if (fs.existsSync(d)) die(`refusing to overwrite ${rel}`);
  const before = sha(s), size = fs.statSync(s).size;
  fs.mkdirSync(path.dirname(d), { recursive: true });
  let how = 'git mv';
  try { execFileSync('git', ['-C', REPO, 'mv', src, rel], { stdio: 'pipe' }); }
  catch { how = 'copy+unlink'; fs.copyFileSync(s, d); fs.unlinkSync(s); }
  if (!fs.existsSync(d)) die('FAIL: destination missing after move');
  const after = sha(d);
  if (before !== after) die(`FAIL: content changed in transit (${before} != ${after})`);
  if (fs.existsSync(s)) die(`FAIL: original still present at ${src}`);
  console.log(`archived ${src} -> ${rel}  ${size} bytes  sha256 ${before.slice(0, 16)} MATCH  (${how})`);
}

// ---------------------------------------------------------------- ledger + due

// git IS the diff engine. The ledger stores only what git cannot: WHEN we last
// consolidated. Everything else -- new / moved / changed-and-by-how-much / deleted --
// is derived from `git diff -M`, so it can never drift out of sync with the tree.
const LEDGER = 'docs/.docs-builder/ledger.json';  // == path.join(ARTIFACTS,'ledger.json')
const DUE_THRESHOLD = 5;

// One guarded entry point for git. Two things it must never do: dump a Node stack trace at
// the user, and truncate on a large repo (execFileSync defaults to a 1 MB buffer, which
// `ls-files` can exceed on a big tree).
function git(args, what) {
  try {
    return execFileSync('git', ['-C', REPO, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const msg = (e.stderr || '').toString().trim().split('\n')[0] || e.message;
    die(`git failed while ${what}: ${msg}`);
  }
}

function docFiles() {
  return git(['ls-files', 'docs/'], 'listing tracked docs').split('\n')
    .filter(f => f.endsWith('.md') && !f.startsWith('docs/.docs-builder/'));
}

function ledger() {
  const head = git(['rev-parse', 'HEAD'], 'reading HEAD (is this a git repo?)');
  const docs = docFiles().map(f => ({
    path: f,
    lines: read(f).split('\n').length,
    sha256: sha(path.join(REPO, f)).slice(0, 16)
  }));
  const out = { sha: head, at: new Date().toISOString(),
                docs: docs.sort((a, b) => a.path.localeCompare(b.path)) };
  const dest = path.join(REPO, process.env.OUT || LEDGER);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  console.log(`ledger: ${docs.length} docs / ${docs.reduce((a, d) => a + d.lines, 0)} lines @ ${head.slice(0, 8)}`);
}

function due() {
  const f = path.join(REPO, process.env.OUT || LEDGER);
  if (!fs.existsSync(f)) {
    console.log('no ledger yet — run `docs-builder.js ledger` to start tracking. NOT due.');
    return;
  }
  const L = JSON.parse(fs.readFileSync(f, 'utf8'));
  const known = new Map(L.docs.map(d => [d.path, d]));
  // -M turns a delete+add pair into a rename, which is what makes "moved" distinguishable
  // from "deleted and rewritten". Without it every move looks like a total rewrite.
  // A rebase, amend or GC can leave the stamped SHA unreachable. That is a re-stamp
  // situation, not a crash.
  try {
    execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${L.sha}^{commit}`], { stdio: 'ignore' });
  } catch {
    die(`ledger SHA ${L.sha.slice(0, 8)} is not in this repository (rebased, amended or \n`
      + 'garbage-collected). Re-stamp with `docs-builder.js ledger`.');
  }
  const raw = git(['diff', '--numstat', '-M', `${L.sha}..HEAD`, '--', 'docs/'],
                  'diffing docs against the ledger SHA');
  const rows = [], accountedFor = new Set();
  for (const line of raw ? raw.split('\n') : []) {
    const [add, del, ...pathBits] = line.split('\t');
    const p = pathBits.join('\t');
    // Parse the rename form FIRST. git writes it as `docs/{old.md => new.md}`, which does
    // not end in `.md` — filtering on the raw path silently drops every move.
    const ren = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    const was = ren ? `${ren[1]}${ren[2]}${ren[4]}`
              : p.includes(' => ') ? p.split(' => ')[0] : null;
    const now = ren ? `${ren[1]}${ren[3]}${ren[4]}`
              : p.includes(' => ') ? p.split(' => ')[1] : p;
    if (!now.endsWith('.md') || now.startsWith('docs/.docs-builder/')) continue;
    if (was) accountedFor.add(was);
    accountedFor.add(now);
    const a = add === '-' ? null : +add, d = del === '-' ? null : +del;
    const prev = known.get(was || now);
    const gone = !fs.existsSync(path.join(REPO, now));
    let kind, detail;
    if (gone) { kind = 'deleted'; detail = prev ? `was ${prev.lines} lines` : ''; }
    else if (a === null) { kind = 'binary'; detail = ''; }
    else if (was && !a && !d) { kind = 'moved'; detail = `from ${was}`; }
    else if (was) { kind = 'moved+changed'; detail = `from ${was}, +${a}/-${d}`; }
    else if (!prev) { kind = 'new'; detail = `${a} lines`; }
    else {
      kind = 'changed';
      const pct = prev.lines ? Math.round((a + d) / prev.lines * 100) : 0;
      detail = `+${a}/-${d} of ${prev.lines} lines (~${pct}%)`;
    }
    rows.push({ doc: now, kind, detail });
  }
  // A doc the ledger knew, gone from the tree, and not explained by any diff row above.
  for (const g of L.docs)
    if (!accountedFor.has(g.path) && !fs.existsSync(path.join(REPO, g.path)))
      rows.push({ doc: g.path, kind: 'deleted', detail: `was ${g.lines} lines` });

  if (!rows.length) { console.log(`docs unchanged since ${L.sha.slice(0, 8)}. NOT due.`); return; }
  console.table(rows);
  const n = rows.length;
  console.log(n >= DUE_THRESHOLD
    ? `${n} docs changed since ${L.sha.slice(0, 8)} (threshold ${DUE_THRESHOLD}) — RECONCILE IS DUE.`
    : `${n} doc(s) changed since ${L.sha.slice(0, 8)} (threshold ${DUE_THRESHOLD}). Not due yet.`);
}

// ---------------------------------------------------------------- lint (declared only)

// Every term here is something a doc SAYS ABOUT ITSELF. Nothing is inferred from
// similarity. MEASURED: declared 100% precision, inferred 4-25%.
// `invalidat\w*` was REMOVED after it matched the ordinary heading "Cache Invalidation"
// 3x in a second repo — 3 false positives to buy 2 true ones. Precision over recall.
const SUP = /\b(recurred|superseded|supersedes|withdrawn|retracted|refuted|obsolete|replaced by|deprecat\w*|was wrong|turned out to be false)\b/i;
const ID_ANY = /\b([A-Z]{1,4}\d{1,4})\b/g;

function sentences(t) {
  return t.replace(/```[\s\S]*?```/g, ' ').replace(/\|/g, ' ')
    .split(/(?<=[.!?])\s+|\n\s*\n/)
    .map(x => x.replace(/[*_`>#-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(x => x.length >= 80);
}

function lint(files) {
  if (!files.length) die('usage: docs-builder.js lint <file.md...>');
  const sections = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    const mask = fenceMask(lines);
    let cur = null;
    const close = i => { if (cur) { cur.e = i; cur.body = lines.slice(cur.s, i).join('\n'); } };
    lines.forEach((ln, i) => {
      if (mask[i]) return;
      const m = ln.match(/^(#{1,3})\s+(.*)$/);
      if (!m) return;
      close(i);
      const idm = m[2].match(ID_RE);
      cur = { file: f, heading: clean(m[2]), id: idm ? idm[1] : null,
              qid: idm ? f + '#' + idm[1] : null, s: i + 1, e: null, body: '' };
      sections.push(cur);
    });
    close(lines.length);
  }

  // (1) supersession the doc declares about itself — heading grain is the shippable one
  const supersession = sections.filter(s => SUP.test(s.heading))
    .map(s => ({ file: s.file, line: s.s, heading: s.heading.slice(0, 160) }));
  const supersessionInBody = sections.filter(s => !SUP.test(s.heading) && SUP.test(s.body)).length;

  // (2) UNCITED — MUST be repo-wide. Scoped to the doc corpus it proposes deleting live
  //     docs (measured: 2 false flags, both cited from a logs file and CHANGELOG.md).
  //     Called "uncited", not "orphan", on purpose: uncited is a FACT, deletable is a
  //     JUDGEMENT. bareloop's O2/O3/O4 are genuinely uncited and must NOT be removed —
  //     they are the middle of a coherent O1-O5 series whose O1 is cited. PROPOSE ONLY.
  let repoFiles = [], uncited = [];
  try {
    repoFiles = execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { console.error('WARN: git ls-files failed — uncited check DISABLED (loud, not silent)'); }
  if (repoFiles.length) {
    const inbound = new Set();
    const own = new Set(files);
    for (const f of repoFiles) {
      if (own.has(f)) continue;
      let txt; try { txt = read(f); } catch { continue; }
      for (const m of txt.matchAll(ID_ANY)) inbound.add(m[1]);
    }
    const defined = sections.filter(s => s.id);
    for (const s of defined) {
      const citedInCorpus = sections.some(o => o !== s && new RegExp(`\\b${s.id}\\b`).test(o.body));
      if (!citedInCorpus && !inbound.has(s.id))
        uncited.push({ file: s.file, line: s.s, id: s.id, heading: s.heading.slice(0, 120) });
    }
  }

  // (3) redundancy — shared VERBATIM sentences. 1/4 precision: PROPOSE ONLY, never act.
  const sentMap = {};
  sections.forEach((s, si) => {
    for (const sent of new Set(sentences(s.body))) {
      const h = crypto.createHash('sha1').update(sent).digest('hex').slice(0, 12);
      (sentMap[h] = sentMap[h] || { text: sent, at: [] }).at.push(si);
    }
  });
  const pairs = {};
  for (const h of Object.keys(sentMap)) {
    const at = [...new Set(sentMap[h].at)];
    if (at.length < 2) continue;
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const k = at[i] + '|' + at[j];
      (pairs[k] = pairs[k] || { n: 0, chars: 0, sample: '' }).n++;
      pairs[k].chars += sentMap[h].text.length;
      if (!pairs[k].sample) pairs[k].sample = sentMap[h].text.slice(0, 150);
    }
  }
  const redundant = Object.entries(pairs).map(([k, v]) => {
    const [i, j] = k.split('|').map(Number);
    return { sharedSentences: v.n, sharedChars: v.chars, sample: v.sample,
             a: { f: sections[i].file, l: sections[i].s, h: sections[i].heading.slice(0, 80) },
             b: { f: sections[j].file, l: sections[j].s, h: sections[j].heading.slice(0, 80) } };
  }).sort((x, y) => y.sharedChars - x.sharedChars).slice(0, 40);

  const out = {
    generated: new Date().toISOString(), repo: REPO, files,
    totals: { sections: sections.length, ids: sections.filter(s => s.id).length,
              repoFilesScanned: repoFiles.length },
    supersession, supersessionInBody, uncited, redundant,
    note: 'Every flag is a PROPOSAL, never an action. Only `supersession` is high enough '
        + 'precision to act on unreviewed (24/24 across 4 repos). `uncited` and `redundant` '
        + 'are surfaced for a human. Record confirmation in the file\'s own `verified:` frontmatter.'
  };
  write(out, 'lint.json');
  console.log(JSON.stringify({ ...out.totals, supersession: supersession.length,
    supersessionInBody, uncited: uncited.length, redundantPairs: redundant.length }, null, 1));
}

// ---------------------------------------------------------------- dispatch

// Machine state has one home. Callers can override with OUT, but the default must never
// scatter JSON into whatever directory the user happened to be standing in.
const ARTIFACTS = 'docs/.docs-builder';
function write(obj, fallback) {
  const dest = process.env.OUT || path.join(ARTIFACTS, fallback);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(obj, null, 1));
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'scan':     scan(rest); break;
  case 'validate': validate(rest[0], rest[1]); break;
  case 'plan':     plan(rest[0], rest[1]); break;
  case 'index':    index(rest[0], rest[1]); break;
  case 'archive':  archive(rest[0], rest[1]); break;
  case 'ledger':   ledger(); break;
  case 'due':      due(); break;
  case 'lint':     lint(rest); break;
  default:
    die('usage: docs-builder.js <scan|validate|plan|index|archive|ledger|due|lint> [args]\n'
      + '  scan     <file.md...>                 -> outline.json\n'
      + '  validate <outline.json> <labels.json> -> PASS/FAIL (exit 1 on FAIL)\n'
      + '  plan     <outline.json> <labels.json> -> task-<theme>.json per page\n'
      + '  index    <outline.json> <labels.json> -> index.md\n'
      + '  archive  <src.md> [dest.md]           -> verified MOVE into docs/archive/\n'
      + '  ledger                                -> record current state of docs/\n'
      + '  due                                   -> what changed since the ledger\n'
      + '  lint     <file.md...>                 -> lint.json\n'
      + 'env: REPO (default cwd), OUT (output path)');
}
