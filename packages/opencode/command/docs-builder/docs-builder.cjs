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
//   index-flat                                     -> index.md       (flat, no labels needed)
//   search   <outline.json> <query words...>       -> ranked sections (BM25, zero deps)
//   archive  <src.md> [dest.md]                    -> verified MOVE into docs/archive/
//   ledger                                         -> record the current state of docs/
//   due                                            -> what changed since the ledger, and how much
//   lint     <file.md...>                          -> lint.json      (declared-only checks)
//   discover [root]                                -> reorg-plan.json (classify, NEVER moves)
//   apply-reorg [plan.json]                        -> executes the plan's product/archive moves
//
// Env: REPO (default cwd), OUT (output path), INDEX (default docs/index.md, validate's
// link check), PAGES (default docs/wiki, validate's citations + plan), TASKS (default
// docs/.docs-builder/tasks, validate's citations reader-side match for plan's OUT), N
// (search count, default 10), OVERSIZED_LINES (default 500, discover's oversized ceiling).

// Extension is `.cjs`, not `.js`, ON PURPOSE. Installed project-locally into a repo whose
// package.json declares "type": "module", a `.js` file is loaded as an ES module and every
// `require` below throws before the first line of work. `.cjs` pins CommonJS regardless of
// the host project. Found the hard way: bareloop is such a project.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = process.env.REPO || process.cwd();
const clean = s => s.replace(/\s+/g, ' ').trim();
// Source .md paths are repo-relative; JSON artifacts the pipeline itself produced are
// cwd-relative. Keeping these separate stops `plan` looking for outline.json inside the
// repo being documented.
const repoPath = f => path.isAbsolute(f) ? f : path.join(REPO, f);
const read = f => fs.readFileSync(repoPath(f), 'utf8');
const die = m => { console.error(m); process.exit(1); };
// Guarded chokepoint for every JSON pipeline artifact this script reads. Used to be TWO
// readers: a guarded one (2 callers) and 5 bare `JSON.parse(fs.readFileSync(...))` sites
// that dumped a raw node stack trace on a hand-edited or truncated file. Core THROWS, never
// exits (same split as doArchive()/archive() below) so rewriteArchivedPath() can catch a
// malformed-JSON failure and report it alongside "the git mv already succeeded" instead of
// a bare die(). `parseJSONFile` is the die-on-throw convenience wrapper most callers want.
// `sha()` reads raw bytes for hashing, a different job, and stays outside this.
const parseJSONFileOrThrow = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { throw new Error(`malformed JSON in ${f}: ${e.message}`); }
};
const parseJSONFile = f => {
  try { return parseJSONFileOrThrow(f); }
  catch (e) { die(e.message); }
};
const readArtifactJSON = f => {
  if (!fs.existsSync(f)) die(`no such file: ${f} — did an earlier pipeline step not run yet?`);
  return parseJSONFile(f);
};

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

// Fence-awareness used to be FOUR implementations: this mask, snippet()'s own lone
// `startsWith('```')` check (caught the marker but let CODE inside it leak into a snippet as
// prose), sentences()'s own regex strip, and checkCitations/checkLinks doing none at all — so
// a page documenting the citation/link syntax INSIDE a fence got its own example flagged as
// a real violation. One mechanism: mask with fenceMask(), drop the masked lines.
function stripFences(text) {
  const lines = text.split('\n');
  const mask = fenceMask(lines);
  return lines.filter((_, i) => !mask[i]).join('\n');
}

const ID_RE = /^([A-Z]{1,4}\d{1,4}(?:[-–][A-Z]?\d{1,4})?)\b/;

// THE KEY. The model echoes this string back verbatim; the validator checks that same
// string. One function, so the two can never disagree — the POC scored "86/86 byte-exact"
// against keys the prompt had silently truncated at 110 chars while the source headings
// ran longer, which is only a pass because both sides shared the same truncation by luck.
// Uniqueness is GUARANTEED here, not assumed: bareloop's PRD has 0 collisions, but a repo
// with "## Cache Invalidation" in three files has three.
const KEY_WIDTH = 110;
// The `${r.file} :: ` prefix is ALWAYS applied, never conditional on batch size. MEASURED
// bug: scanning one file alone vs. alongside a second file used to produce different keys
// for the same heading ("The core mappings" vs "docs/00-context/CYBERNETICS.md :: The core
// mappings"), so a labels.json made from a single-doc cleanup silently stopped matching the
// same file's key the moment it was rescanned as part of a corpus-wide reconcile. Key format
// must not depend on scan batch size.
function makeKeys(records) {
  const seen = new Map();
  for (const r of records) {
    // .trim() is load-bearing: truncating at a fixed width lands mid-space often enough
    // (9 of 86 headings on the bareloop PRD), and no model will faithfully echo back a key
    // with a trailing space. Never ask a model to reproduce something it cannot see.
    const head = (r.id || (r.h2.length > KEY_WIDTH ? r.h2.slice(0, KEY_WIDTH) : r.h2)).trim();
    const base = `${r.file} :: ${head}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.key = n === 1 ? base : `${base} #${n}`;
    if (n > 1) console.error(`WARN: key collision disambiguated -> ${r.key}`);
  }
  return records;
}

// `mask` is fenceMask(lines), computed once per file in scan() and shared with snippet().
function headings(lines, mask) {
  const h1 = (lines.find((l, i) => !mask[i] && l.startsWith('# ')) || '').slice(2).trim();
  const heads = [];
  lines.forEach((l, i) => {
    if (mask[i]) return;
    const m = l.match(/^(#{2,4})\s+(.+)$/);
    if (m) heads.push({ lvl: m[1].length, text: clean(m[2]), line: i + 1 });
  });
  return { h1, heads };
}

// First two prose lines under a heading. `mask[i]` now excludes fence CODE lines too, not
// just the opening marker — the old `startsWith('```')` check let fenced content leak in.
function snippet(lines, mask, from, to, cap) {
  const out = [];
  for (let i = from; i < to && out.length < 2; i++) {
    if (mask[i]) continue;
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || /^[|>-]{3,}$/.test(t)) continue;
    out.push(t);
  }
  return clean(out.join(' ')).slice(0, cap);
}

// ---------------------------------------------------------------- scan (Layer 1)

function scan(files) {
  if (!files.length) die('usage: docs-builder.cjs scan <file.md...>');
  const records = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    const mask = fenceMask(lines);
    const { h1, heads } = headings(lines, mask);
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
        snip: snippet(lines, mask, s, h3.length ? h3[0].s - 1 : e, 300),
        h3
      });
    });
  }
  makeKeys(records);
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
  if (!r.key) die('outline.json has no records[].key — re-run `docs-builder.cjs scan`');
  return r.key;
}

function loadPair(outlineF, labelsF) {
  const o = readArtifactJSON(outlineF), l = readArtifactJSON(labelsF);
  if (!Array.isArray(o.records)) die('outline.json has no records[]');
  if (!Array.isArray(l.labels)) die('labels.json has no labels[]');
  // Without a theme list the "none off-list" check silently passes anything. A gate that
  // quietly stops checking is worse than no gate.
  if (!Array.isArray(l.themes) || !l.themes.length)
    die('labels.json has no themes[] — the off-list check cannot run. Emit the propose '
      + 'pass output alongside the labels.');
  return [o, l];
}

// (a) every outline record's source file must still exist. Catches an outline gone stale
// after a move that bypassed `archive` (Change 2 keeps `archive` itself in sync).
function checkPaths(o) {
  return [...new Set(o.records.map(r => r.file))].filter(f => !fs.existsSync(repoPath(f)));
}

// `index` (writer) and `checkLinks` (reader) must agree on exactly where PAGES sits relative
// to INDEX's own directory — that link is read from inside index.md, so it has to be relative
// to index.md, not to the repo root. Hardcoding 'wiki' in either end breaks the moment PAGES
// points somewhere else; one function, called from both ends, so they can't drift apart again.
// With both left at their defaults (INDEX=docs/index.md, PAGES=docs/wiki) this still resolves
// to exactly 'wiki' — the normal case is unchanged.
function pagesLinkPrefix(indexRel) {
  const pagesDir = process.env.PAGES || 'docs/wiki';
  return path.relative(path.dirname(repoPath(indexRel)), repoPath(pagesDir)).split(path.sep).join('/');
}

// (b) every markdown link inside index.md that points into the pages dir must resolve to a
// real file. Loud skip, not a silent pass, when index.md itself is missing — same law as the
// themes[] guard in loadPair() above: a gate that quietly stops checking is worse than no gate.
function checkLinks() {
  const rel = process.env.INDEX || 'docs/index.md';
  if (!fs.existsSync(repoPath(rel))) { console.error(`LOUD-SKIP: links check did not run — no ${rel}`); return { checked: false, bad: [] }; }
  const text = stripFences(fs.readFileSync(repoPath(rel), 'utf8'));
  const prefix = pagesLinkPrefix(rel);
  // Only links under the pages-dir prefix are checked — same scope as before (previously a
  // literal 'wiki/' prefix), just resolved dynamically instead of hardcoded, so a link
  // elsewhere in index.md (or anywhere else) that was never in scope stays out of scope.
  const escPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Old regex required the capture to end `.md)` literally, so `(wiki/x.md#anchor)` never
  // matched — a broken link went unchecked. And `%20` in a correct link false-positived
  // against the real (unencoded) path. Fix: strip `#anchor` before the `.md` filter, decode
  // before the existence check.
  const links = new Set([...text.matchAll(new RegExp(`\\(${escPrefix}/([^)]+)\\)`, 'g'))]
    .map(m => decodeURIComponent(m[1].split('#')[0]))
    .filter(l => l.endsWith('.md'))
    .map(l => `${prefix}/${l}`));
  const bad = [...links].filter(link => !fs.existsSync(repoPath(path.join(path.dirname(rel), link))));
  return { checked: true, bad };
}

// (c)/(d) citations. Format `(<file>:<start>-<end>)` or `(<file>:<line>)`, pinned in
// docs-builder.md step 5. A page may only cite inside its OWN task's source ranges — anything
// else (wrong file, out-of-range, ambiguous basename) is the exact failure class `plan`'s
// per-page context isolation exists to prevent, so it is a gate, not a proposal. Uncited
// sections (d) are the mirror check — flagged, never blocking (see docstring at call site).
const CITE_RE = /\(([\w./-]+\.\w+):(\d+)(?:-(\d+))?\)/g;

// `plan` writes task-*.json into `process.env.OUT || <default>`; checkCitations used to
// hardcode the default only, so a `plan` run against a custom OUT left it silently checking
// whatever stale content still sat at the default path instead of LOUD-SKIPping. Fixed with
// a reader-side var of its own (TASKS), not by reading OUT directly here: OUT is already
// doValidate's own var for `write(res, 'validate.json')`, and MEASURED, reusing it made
// `write()` crash (EISDIR) the moment OUT pointed at an existing directory. Same shape as
// INDEX/OUT for index.md/checkLinks — writer and reader share one default, each through its
// own var — so a caller must pass TASKS= to match a non-default `plan` OUT=, same as it
// already has to pass INDEX= to match a non-default `index` OUT=.
// A function, not a top-level const: ARTIFACTS itself is declared further down the file (near
// `write()`), and every OTHER site that reads it the same way (e.g. rewriteArchivedPath above)
// only ever does so from inside a function body, run after the whole module has loaded.
function tasksDirDefault() { return path.join(ARTIFACTS, 'tasks'); }

function checkCitations() {
  const pagesDir = process.env.PAGES || 'docs/wiki';
  const tasksDir = process.env.TASKS || tasksDirDefault();
  if (!fs.existsSync(repoPath(pagesDir)) || !fs.existsSync(tasksDir)) {
    console.error(`LOUD-SKIP: citations check did not run — missing ${pagesDir} or ${tasksDir}`);
    return { checked: false, violations: [], uncited: [] };
  }
  const violations = [], uncited = [];
  for (const pageFile of fs.readdirSync(repoPath(pagesDir)).filter(f => f.endsWith('.md'))) {
    const taskF = path.join(tasksDir, `task-${pageFile.slice(0, -3)}.json`);
    if (!fs.existsSync(taskF)) { console.error(`WARN: no task file for ${pageFile} — citations not checked`); continue; }
    // Per-page isolation: a truncated task-*.json — exactly what a crashed page-writer leaves
    // behind — must not stop every OTHER page's citations from being checked, and must not
    // stop validate.json from being written at all. A file this broken IS a real gate failure
    // (silently skipping it would hide a genuine problem), so it counts as a violation rather
    // than a WARN-and-skip.
    let task;
    try { task = parseJSONFileOrThrow(taskF); }
    catch (e) {
      violations.push({ page: pageFile, cite: '(task file)', reason: `malformed task file ${taskF}: ${e.message}` });
      continue;
    }
    const byFile = new Map();
    for (const sec of task.sections || []) {
      if (!byFile.has(sec.file)) byFile.set(sec.file, []);
      byFile.get(sec.file).push({ s: sec.s, e: sec.e });
    }
    const text = stripFences(fs.readFileSync(repoPath(path.join(pagesDir, pageFile)), 'utf8'));
    const cited = [];
    for (const m of text.matchAll(CITE_RE)) {
      const raw = m[1], s = +m[2], e = m[3] ? +m[3] : +m[2];
      const tag = `${raw}:${m[2]}${m[3] ? '-' + m[3] : ''}`;
      // MEASURED: a reversed range like `(CYBERNETICS.md:97-28)` passed silently — `s >= r.s
      // && e <= r.e` below can hold even with s > e, since neither half alone catches it.
      if (s < 1 || e < 1 || s > e) {
        violations.push({ page: pageFile, cite: tag, reason: 'invalid line range (must be 1-based, start <= end)' });
        continue;
      }
      const bases = [...byFile.keys()].filter(f => path.basename(f) === path.basename(raw));
      if (!byFile.has(raw) && bases.length > 1) {
        violations.push({ page: pageFile, cite: tag, reason: `ambiguous basename across this page's sources: ${bases.join(', ')}` });
        continue;
      }
      const file = byFile.has(raw) ? raw : bases[0];
      if (!file) { violations.push({ page: pageFile, cite: tag, reason: "file not among this page's sources" }); continue; }
      const ranges = byFile.get(file);
      if (!ranges.some(r => s >= r.s && e <= r.e)) {
        violations.push({ page: pageFile, cite: tag, reason: `outside allowed ranges ${ranges.map(r => `${r.s}-${r.e}`).join(', ')}` });
        continue;
      }
      cited.push({ file, s, e });
    }
    for (const sec of task.sections || [])
      if (!cited.some(c => c.file === sec.file && c.s <= sec.e && c.e >= sec.s))
        uncited.push({ page: pageFile, file: sec.file, h2: sec.h2 });
  }
  return { checked: true, violations, uncited };
}

// `docs/.docs-builder/failures.json` — a LIVE count of current gate failures, keyed
// `<check>:<target>`, not a graveyard: a key that stops failing is deleted. Never called
// for uncited sections — that check is propose-only by design, never a failure count.
function reconcileFailures(ledger, check, targets, detailOf) {
  const prefix = `${check}:`, now = new Date().toISOString();
  for (const key of Object.keys(ledger))
    if (key.startsWith(prefix) && !targets.has(key.slice(prefix.length))) delete ledger[key];
  for (const t of targets) {
    const e = ledger[prefix + t] || (ledger[prefix + t] = { count: 0, firstSeen: now });
    e.count++; e.lastSeen = now; e.lastDetail = detailOf(t);
  }
}

// `docs/log.md` is documented (Layout, Mode 3) as append-only — `## [DATE] operation |
// description` — but nothing wrote it before this.
function logOp(op, desc) {
  const f = path.join(REPO, 'docs/log.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `## [${new Date().toISOString().slice(0, 10)}] ${op} | ${desc}\n`);
}

// Core THROWS-free / exit-free — same split as doArchive()/archive() and gitOrThrow()/git()
// above, for the same reason: `reconcile` calls this IN-PROCESS and must survive a FAIL
// verdict to still run index + lint, which no caller can do once `process.exit` has fired.
// `validate()` below is the CLI-facing wrapper that turns the verdict into an exit code for a
// single direct invocation — its own hard-gate behaviour (exit 1 on FAIL) is UNCHANGED.
function doValidate(outlineF, labelsF) {
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
  const missingFiles = checkPaths(o);
  const links = checkLinks();
  const citations = checkCitations();
  // Uncited sections are FLAG ONLY — deliberately excluded from `pass`, per docs-builder.md.
  const pass = !invented.length && !offTheme.length && !dupes.length && !missing.length
    && !missingFiles.length && !links.bad.length && !citations.violations.length;
  const res = {
    sections: o.records.length, labels: l.labels.length,
    invented, offTheme, dupes, missing,
    linesCovered: covered, linesTotal: total,
    paths: { missingFiles },
    links,
    citations: { checked: citations.checked, violations: citations.violations, uncited: citations.uncited },
    verdict: pass ? 'PASS' : 'FAIL'
  };
  console.log(JSON.stringify({
    ...res, invented: invented.length, offTheme: offTheme.length,
    dupes: dupes.length, missing: missing.length, missingFiles: missingFiles.length,
    badLinks: links.bad.length, citationViolations: citations.violations.length,
    uncitedSections: citations.uncited.length
  }, null, 1));
  if (!pass) {
    for (const [k, v] of [['invented', invented], ['off-theme', offTheme],
                          ['duplicate', dupes], ['missing', missing],
                          ['missing source file', missingFiles], ['bad index link', links.bad],
                          ['citation violation', citations.violations.map(v => `${v.page} (${v.cite}) — ${v.reason}`)]])
      if (v.length) console.error(`\n${k} (${v.length}):\n  ` + v.slice(0, 20).join('\n  '));
  }
  if (citations.uncited.length)
    console.error(`\nuncited sections (${citations.uncited.length}, flag only — does not affect verdict):\n  `
      + citations.uncited.slice(0, 20).map(u => `${u.page}: ${u.file} — ${u.h2}`).join('\n  '));
  const ledgerF = path.join(ARTIFACTS, 'failures.json');
  const failLedger = fs.existsSync(ledgerF) ? parseJSONFile(ledgerF) : {};
  reconcileFailures(failLedger, 'paths', new Set(missingFiles), () => 'missing source file');
  // `checked: false` = LOUD-SKIPPED, not passed — reconciling against [] then would delete
  // real prior failures the check never actually re-ran to confirm fixed.
  if (links.checked) reconcileFailures(failLedger, 'links', new Set(links.bad), () => 'broken index link');
  if (citations.checked) {
    const failingPages = new Set(citations.violations.map(v => v.page));
    reconcileFailures(failLedger, 'citations', failingPages, t => citations.violations
      .filter(v => v.page === t).map(v => `(${v.cite}) ${v.reason}`).join('; '));
  }
  fs.mkdirSync(path.dirname(ledgerF), { recursive: true });
  fs.writeFileSync(ledgerF, JSON.stringify(failLedger, null, 1));
  // Recurrence, not severity, decides this — message ONLY, never the verdict or exit code.
  for (const [key, e] of Object.entries(failLedger))
    if (e.count >= 3) console.error(`STRUCTURAL (${e.count}x since ${e.firstSeen.slice(0, 10)}): `
      + `${key} — likely not a one-off. Stop retrying, escalate to a human.`);
  write(res, 'validate.json');
  logOp('validate', `${res.verdict} — ${missingFiles.length + links.bad.length + citations.violations.length} gate failure(s)`);
  return res;
}

function validate(outlineF, labelsF) {
  if (!outlineF || !labelsF) die('usage: docs-builder.cjs validate <outline.json> <labels.json>');
  const res = doValidate(outlineF, labelsF);
  process.exit(res.verdict === 'PASS' ? 0 : 1);
}

// ---------------------------------------------------------------- plan (page writer inputs)

// A checkpoint you do not validate is not a checkpoint. MEASURED the hard way: a page
// writer that died on a 429 left the error string as the page body, and `plan` reported
// "all pages written — nothing to do" while two themes (2,238 source lines) had no page at
// all. Existence is not completion — a resumable step must be able to tell a finished
// artifact from the wreckage of a failed one.
const MIN_PAGE_LINES = 10;
function pageStatus(file) {
  if (!fs.existsSync(file)) return 'TODO';
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split('\n');
  const hasFrontmatter = lines[0].trim() === '---' && lines.slice(1).some(l => l.trim() === '---');
  return hasFrontmatter && lines.length >= MIN_PAGE_LINES ? 'done' : 'PARTIAL';
}

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

// A half-finished Mode 1 split: the model wrote one or more DONE pages under PAGES/, but
// `archive` was never run on the source — so the same content now sits at its original path
// AND in docs/wiki/, which the doc calls "duplication, not cleanup". Derived entirely from
// artifacts that already exist (outline.json's records[].file, labels.json's theme
// assignment, and the same slug/pageStatus logic `plan` already uses to report a page
// "done") — no new state file, because the finished page already IS the checkpoint. Flag
// only, never a gate: callers print this as a WARNING and never change their exit code on it.
function unarchivedSplits(o, l, pages) {
  const g = [...group(o, l)];
  const slugs = slugMap(g.map(([t]) => t));
  const bySrc = new Map();
  for (const [theme, recs] of g) {
    const slug = slugs.get(theme);
    if (pageStatus(path.join(REPO, pages, `${slug}.md`)) !== 'done') continue;
    for (const f of new Set(recs.map(r => r.file))) {
      if (!bySrc.has(f)) bySrc.set(f, new Set());
      bySrc.get(f).add(slug);
    }
  }
  const flagged = [];
  for (const [file, slugSet] of bySrc)
    if (fs.existsSync(repoPath(file)) && !file.startsWith('docs/archive/'))
      flagged.push({ file, pages: [...slugSet] });
  return flagged;
}

function warnUnarchivedSplits(o, l, pages) {
  for (const w of unarchivedSplits(o, l, pages))
    console.error(`WARN: half-finished split — ${w.file} has finished page(s) `
      + `(${w.pages.join(', ')}) in ${pages}/, but the source is still at ${w.file}. `
      + `Run \`archive ${w.file}\` to finish the split.`);
}

function plan(outlineF, labelsF) {
  if (!outlineF || !labelsF) die('usage: docs-builder.cjs plan <outline.json> <labels.json>');
  const [o, l] = loadPair(outlineF, labelsF);
  const gloss = new Map((l.themes || []).map(t => [t.name, t.gloss || '']));
  const dir = process.env.OUT || tasksDirDefault();
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
    rows.push({ theme: slug, sections: task.n, lines: task.lines,
                status: pageStatus(path.join(REPO, pages, `${slug}.md`)) });
  }
  const todo = rows.filter(r => r.status !== 'done');
  const partial = rows.filter(r => r.status === 'PARTIAL');
  if (partial.length)
    console.error(`WARN: ${partial.length} page(s) exist but are not a finished page `
      + '(no frontmatter, or too short) — they will be rewritten: '
      + partial.map(r => r.theme).join(', '));
  warnUnarchivedSplits(o, l, pages);
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
  if (!outlineF || !labelsF) die('usage: docs-builder.cjs index <outline.json> <labels.json>');
  const [o, l] = loadPair(outlineF, labelsF);
  const gloss = new Map((l.themes || []).map(t => [t.name, t.gloss || '']));
  const g = [...group(o, l)].sort((a, b) => b[1].length - a[1].length);
  const slugs = slugMap(g.map(([t]) => t));
  // Same PAGES var and default the rest of the file uses (plan, checkCitations) — a theme
  // only gets a hyperlink once its page is actually on disk there. Hardcoding 'docs/wiki'
  // here was the exact bug fixed one commit ago; don't reintroduce it.
  const pagesDir = process.env.PAGES || 'docs/wiki';
  // Resolved once, up front, same default STRING as checkLinks()'s `INDEX` default (see the
  // comment at `dest` below) — needed here already because the LINK TEXT below must be
  // relative to where OUT is actually landing, not to the repo root. Getting the existence
  // check right (pagesDir above) while leaving this hardcoded 'wiki' was the same bug half-
  // fixed: PAGES honoured for "does the page exist" but not for "what does the link say".
  const outRel = process.env.OUT || 'docs/index.md';
  const linkPrefix = pagesLinkPrefix(outRel);
  let rows = 0, pending = 0;
  let s = '# Index\n\n';
  s += '**Completeness guarantee:** every section of the source appears in exactly one row '
     + 'below. If it is not listed here, it does not exist — do not sweep other files to '
     + 'check for stragglers, this table IS the check.\n\n';
  s += 'To answer a question: read the rows that match, open only those pages, and stop.\n\n';
  s += '_Generated by `docs-builder.cjs index`. Never hand-edit — it is rebuilt every reconcile._\n\n';
  for (const [theme, recs] of g) {
    const slug = slugs.get(theme);
    const written = fs.existsSync(repoPath(path.join(pagesDir, `${slug}.md`)));
    // Completeness requires every theme to appear here even before its page exists, but a
    // link to a file that isn't there is exactly what checkLinks()'s validate gate flags as
    // FAIL — so an unwritten page gets a plain-text row with a visible pending marker
    // instead of a hyperlink. The marker lives in the row itself (not just the trailer)
    // because a reader scanning the table by eye is unlikely to notice "no [] brackets" —
    // an explicit word does not require noticing an absence.
    if (written) s += `## [${theme}](${linkPrefix}/${slug}.md)\n\n`;
    else { pending++; s += `## ${theme} _(pending — page not yet written)_\n\n`; }
    if (gloss.get(theme)) s += `${gloss.get(theme)}\n\n`;
    s += `${recs.length} sections.\n\n`;
    for (const r of recs) {
      rows++;
      const t = r.h2.length > 110 ? r.h2.slice(0, 107) + '...' : r.h2;
      s += `- ${r.id ? `**${r.id}** — ` : ''}${t}\n`;
    }
    s += '\n';
  }
  s += `---\n\nTotal: ${rows} rows across ${g.length} pages`
     + (pending ? ` (${pending} pending)` : '') + '.\n';
  // Same default STRING as checkLinks()'s `INDEX` default above, resolved the same
  // REPO-relative way (repoPath) — not cwd-relative like the other pipeline JSON artifacts
  // (see the cwd-vs-repo comment on `read`/`repoPath` near the top of the file). index.md is
  // a DELIVERABLE that lives in the target repo's docs/ tree (Layout, docs-builder.md), not
  // throwaway pipeline state, so it must land where validate's link check will actually look
  // for it. MEASURED the disagreement: with no env vars set — exactly how `reconcile` calls
  // this — the old cwd-relative `'index.md'` default and checkLinks' `docs/index.md` default
  // never pointed at the same file, so the link gate could only ever LOUD-SKIP or check a
  // stale file from an unrelated earlier run.
  const dest = repoPath(outRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, s);
  console.log(`wrote ${dest}: ${rows} rows / ${g.length} pages / ${s.length} chars`);
  if (pending)
    console.log(`${pending} of ${g.length} theme(s) have no page yet — listed without a link. `
      + 'Run `plan` to see which.');
  if (rows > ROW_CEILING)
    console.log(`WARNING: ${rows} rows exceeds the ${ROW_CEILING}-row ceiling. MEASURED: a `
      + '364-row index was the losing arm. Merge themes or index at page grain, not section '
      + 'grain — and past this point, use `docs-builder.cjs search <outline.json> <query>` to '
      + 'look sections up directly instead of reading index.md whole.');
}

// ---------------------------------------------------------------- index-flat (no labels)

// `index` can only ever run off labels.json, and only the model's theme-propose step writes
// one. A corpus that only ever went through `discover` + `apply-reorg` — nothing oversized,
// nothing split — has no labels.json and never will, so nothing indexes docs/product/, and
// `reconcile` LOUD-SKIPs both validate and index for the same reason. This is that corpus's
// fallback: one row per FILE under docs/product/, no theme grouping, no model call. Same
// OUT/INDEX default (docs/index.md) as `index`, so it lands where validate's link check and
// a later real `index` both expect it.
function indexFlat() {
  const productRel = 'docs/product';
  const productAbs = repoPath(productRel);
  if (!fs.existsSync(productAbs)) {
    console.log(`no ${productRel}/ — nothing to index. Run \`discover\` + \`apply-reorg\` first.`);
    return;
  }
  const files = [];
  walkMd(productAbs, productRel, files);
  if (!files.length) {
    console.log(`${productRel}/ is empty — nothing to index.`);
    return;
  }
  files.sort();
  const outRel = process.env.OUT || 'docs/index.md';
  const dest = repoPath(outRel);
  // Same relative-link convention as `index`'s pagesLinkPrefix: the link is read from INSIDE
  // index.md, so it must resolve relative to index.md's own directory, not the repo root.
  const linkPrefix = path.relative(path.dirname(dest), productAbs).split(path.sep).join('/');
  let s = '# Index\n\n';
  s += '**Completeness guarantee:** every file under `docs/product/` appears in exactly one '
     + 'row below.\n\n';
  s += '_Generated by `docs-builder.cjs index-flat` — no `labels.json` was available, so this '
     + 'is a flat, one-row-per-file fallback (no theme grouping, no model call). Run the split '
     + 'pipeline and `index` for a themed index once one exists. Never hand-edit — rebuilt '
     + 'every run._\n\n';
  for (const f of files) {
    const text = read(f);
    const h1 = (text.split('\n').find(l => l.startsWith('# ')) || '').slice(2).trim();
    const lines = text.split('\n').length;
    const relLink = `${linkPrefix}/${path.relative(productRel, f).split(path.sep).join('/')}`;
    s += `- [${h1 || path.basename(f)}](${relLink}) — ${lines} lines\n`;
  }
  s += `\n---\n\nTotal: ${files.length} row(s) across ${productRel}/.\n`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, s);
  console.log(`wrote ${dest}: ${files.length} rows`);
  logOp('index-flat', `${files.length} row(s) from ${productRel}/`);
}

// ---------------------------------------------------------------- search (BM25, zero deps)

// The fallback once a corpus outgrows the index.md row ceiling (see ROW_CEILING above): a
// reader who can't hold the whole index in one read needs ranked results instead. This
// reuses outline.json (already on disk from `scan` — no second index to build or drift)
// and scores with plain BM25 over each section's own text. No SQLite, no external search
// tool: at doc-corpus scale (tens to low hundreds of sections) a linear scan in vanilla JS
// is sub-millisecond, so a database buys nothing here — see dependency hierarchy in
// AGENT_RULES.md, vanilla language before stdlib before external.
const BM25_K1 = 1.5, BM25_B = 0.75;

const tokenize = s => (s.toLowerCase().match(/[a-z0-9]+/g) || []);

// The 300-char `snip` on each record is enough to tell sections apart for theme
// classification (its designed job) but starves search: it's only the prose BEFORE the
// first H3, often empty, and never reaches an H3's own body. MEASURED the hard way — a
// query for words that only appear inside an H3's body (not its title, not the H2's lead-in)
// ranked the right H2 record near-last, buried under 7 sibling H3 titles. Fix: read the
// FULL section body straight from source using the s/e line numbers scan() already recorded,
// one read per file (cached), same repo-relative resolution the rest of the script uses.
function bm25Rank(records, queryText, n) {
  const bodyCache = new Map();
  const bodyOf = r => {
    if (!bodyCache.has(r.file)) {
      // A stale outline.json can name a file that has since moved or been deleted (exactly
      // what validate's `paths` check exists to catch). Skip it with a named warning rather
      // than dying on a raw ENOENT stack halfway through a search.
      try { bodyCache.set(r.file, read(r.file).split('\n')); }
      catch { console.error(`WARN: ${r.file} is gone — skipped (re-run \`scan\`)`); bodyCache.set(r.file, null); }
    }
    if (!bodyCache.get(r.file)) return '';
    return bodyCache.get(r.file).slice(r.s - 1, r.e).join(' ');
  };
  const docs = records.map(r => ({ r, tokens: tokenize(bodyOf(r)) }));
  docs.forEach(d => { d.len = d.tokens.length; });
  const N = docs.length;
  const avgdl = docs.reduce((a, d) => a + d.len, 0) / (N || 1);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const qTerms = [...new Set(tokenize(queryText))];
  // +1 inside the log keeps IDF non-negative for a term that appears in every section —
  // the textbook Robertson-Sparck-Jones form can go negative there, which would let a
  // common word actively PENALIZE a match instead of just contributing nothing.
  const idf = new Map(qTerms.map(t => {
    const nt = df.get(t) || 0;
    return [t, Math.log((N - nt + 0.5) / (nt + 0.5) + 1)];
  }));
  const scored = docs.map(d => {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of qTerms) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      score += idf.get(t) * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * d.len / avgdl));
    }
    return { score, r: d.r };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
}

function search(outlineF, queryWords) {
  if (!outlineF || !queryWords.length)
    die('usage: docs-builder.cjs search <outline.json> <query words...>');
  const o = readArtifactJSON(outlineF);
  if (!Array.isArray(o.records) || !o.records.length) die('outline.json has no records[]');
  const query = queryWords.join(' ');
  const n = Math.trunc(+process.env.N);
  const hits = bm25Rank(o.records, query, n > 0 ? n : 10);
  if (!hits.length) { console.log(`no matches for "${query}"`); return; }
  console.table(hits.map(h => ({
    score: h.score.toFixed(2), file: h.r.file, lines: `${h.r.s}-${h.r.e}`,
    h2: h.r.h2.length > 70 ? h.r.h2.slice(0, 67) + '...' : h.r.h2
  })));
  console.log(`top ${hits.length} of ${o.records.length} sections for "${query}". `
    + 'Open the file at the given line range yourself — this ranks, it does not read for you.');
}

// ---------------------------------------------------------------- archive (a real move)

// The original is NEVER rewritten and NEVER edited — but it does not stay where it was
// either, or the cleanup leaves the same content in three places (old path, archive, and
// the synthesised pages). Verified move: hash first, `git mv` so history follows, hash
// again. archive-cleanup decides later whether it can be pruned; that is a separate,
// destructive, opt-in invocation.
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Core logic THROWS, never exits — so a caller doing many moves in a loop (apply-reorg)
// can catch one bad file and keep going. `archive()` below is the CLI-facing wrapper that
// turns a throw into a `die()` for a single direct invocation.
function doArchive(src, dest) {
  const s = path.isAbsolute(src) ? src : path.join(REPO, src);
  if (!fs.existsSync(s)) throw new Error(`no such file: ${src}`);
  const rel = dest || path.join('docs/archive', path.basename(src));
  const d = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
  if (fs.existsSync(d)) throw new Error(`refusing to overwrite ${rel}`);
  const before = sha(s), size = fs.statSync(s).size;
  fs.mkdirSync(path.dirname(d), { recursive: true });
  let how = 'git mv';
  try { execFileSync('git', ['-C', REPO, 'mv', src, rel], { stdio: 'pipe' }); }
  catch { how = 'copy+unlink'; fs.copyFileSync(s, d); fs.unlinkSync(s); }
  if (!fs.existsSync(d)) throw new Error('FAIL: destination missing after move');
  const after = sha(d);
  if (before !== after) throw new Error(`FAIL: content changed in transit (${before} != ${after})`);
  if (fs.existsSync(s)) throw new Error(`FAIL: original still present at ${src}`);
  return { rel, size, sha: before, how };
}

// A `git mv` moves the file but not the pipeline's memory of it: outline.json and
// labels.json both embed the OLD path (in `records[].file`, and — since Change 1 made the
// `<file> :: ` prefix unconditional — inside every `records[].key` / `labels[].key` too), so
// a `git mv` alone silently invalidates every key the moved file's sections ever had.
// Rewrite is EXACT-match only (a whole `file` field, or the `<oldPath> :: ` key prefix) —
// never a substring replace, which could corrupt an unrelated path that merely contains this
// one as a substring. Missing artifacts are not an error: `archive` is documented as usable
// standalone, before `scan` has ever run.
function rewriteArchivedPath(oldPath, newPath) {
  // Collects its notes instead of printing them. It runs INSIDE moveDoc, before the caller
  // has printed the move itself, so printing here put the follow-up above the thing it
  // followed. `archive` replays these after its header; `apply-reorg` counts them instead,
  // because per-file chatter across N moves drowns the summary.
  const totals = { outline: 0, labels: 0, messages: [] };
  const log = m => totals.messages.push(m);
  const oldPrefix = `${oldPath} :: `, newPrefix = `${newPath} :: `;
  const outlineF = path.join(ARTIFACTS, 'outline.json');
  if (!fs.existsSync(outlineF)) log('outline.json: not present — skipped');
  else {
    const o = parseJSONFileOrThrow(outlineF);
    let files = 0, recFiles = 0, keys = 0;
    if (Array.isArray(o.files)) o.files = o.files.map(f => f === oldPath ? (files++, newPath) : f);
    for (const r of (o.records || [])) {
      if (r.file === oldPath) { r.file = newPath; recFiles++; }
      if (typeof r.key === 'string' && r.key.startsWith(oldPrefix)) { r.key = newPrefix + r.key.slice(oldPrefix.length); keys++; }
    }
    if (!files && !recFiles && !keys) log(`outline.json: no references to ${oldPath} — nothing to update`);
    else {
      fs.writeFileSync(outlineF, JSON.stringify(o, null, 1));
      log(`outline.json: updated files[] x${files}, records[].file x${recFiles}, records[].key x${keys}`);
      totals.outline = files + recFiles + keys;
    }
  }
  const labelsF = path.join(ARTIFACTS, 'labels.json');
  if (!fs.existsSync(labelsF)) log('labels.json: not present — skipped');
  else {
    const l = parseJSONFileOrThrow(labelsF);
    let keys = 0;
    for (const row of (l.labels || []))
      if (typeof row.key === 'string' && row.key.startsWith(oldPrefix)) { row.key = newPrefix + row.key.slice(oldPrefix.length); keys++; }
    if (!keys) log(`labels.json: no references to ${oldPath} — nothing to update`);
    else {
      fs.writeFileSync(labelsF, JSON.stringify(l, null, 1));
      log(`labels.json: updated labels[].key x${keys}`);
      totals.labels = keys;
    }
  }
  return totals;
}

// `apply-reorg` is the only command in this pipeline that changes a doc's PATH, so it is the
// only one that can break an inbound link. Both the old and the new path are in hand at the
// moment of the move: this is an exact mechanical swap, not an inferred one — which is why it
// is safe to do here even though the *inferred* dangling-reference lint was cut outright
// (1/27 precision). Bounded on purpose: git-tracked text files only; never CHANGELOG.md or
// log.md (append-only history — a record of where a file WAS is not a broken link); never the
// pipeline's own JSON (rewriteArchivedPath owns those).
const LINK_EXTS = new Set(['.md', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml']);
const LINK_SKIP = /(^|\/)(CHANGELOG\.md|log\.md)$/;

// A real corpus (astral-sh/uv) cross-links its docs with RELATIVE paths — `../concepts/x.md`,
// `./tools.md`, `guides/install.md` — never the repo-rooted form the exact-path match above
// looks for. A move that only fixes repo-rooted links leaves every one of those dead. Scope
// is deliberately narrow: only inside actual markdown link syntax (`](target)` or a
// reference-style `]: target` definition), never bare prose — "tools.md" on its own is too
// ambiguous to touch safely. Not fence-aware, on purpose: the exact-path matcher above never
// was either, and a link inside a fenced block still gets rewritten the same way.
const INLINE_LINK_RE = /\]\(([^()\s]+)\)/g;
const REF_LINK_RE = /^(\s{0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm;
const isRelativeTarget = t => !/^([a-z][a-z0-9+.-]*:)|^[#/]/i.test(t);
const splitFragment = t => { const i = t.indexOf('#'); return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i)]; };

// Rewrites every RELATIVE markdown link target in `text` via `transform(pathPart)`, which
// returns the new repo-relative path-part (forward-slash, no fragment) or null/unchanged to
// leave the link alone. `./` is kept on the new target only if the ORIGINAL had it —
// path.relative() never produces one on its own, so blindly adding it back would put a
// prefix on links that never had one.
function rewriteRelativeLinks(text, transform) {
  let n = 0;
  const build = (pathPart, frag) => {
    const next = transform(pathPart);
    if (next == null || next === pathPart) return null;
    n++;
    return (pathPart.startsWith('./') && !next.startsWith('.') ? './' + next : next) + frag;
  };
  let out = text.replace(INLINE_LINK_RE, (full, target) => {
    if (!isRelativeTarget(target)) return full;
    const [pathPart, frag] = splitFragment(target);
    if (!pathPart) return full;
    const rewritten = build(pathPart, frag);
    return rewritten == null ? full : `](${rewritten})`;
  });
  out = out.replace(REF_LINK_RE, (full, prefix, target) => {
    if (!isRelativeTarget(target)) return full;
    const [pathPart, frag] = splitFragment(target);
    if (!pathPart) return full;
    const rewritten = build(pathPart, frag);
    return rewritten == null ? full : `${prefix}${rewritten}`;
  });
  return { text: out, n };
}

function rewriteLinks(oldPath, newPath) {
  const esc = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Exact-path match. The lookbehind stops `xdocs/A.md` and `./docs/A.md` counting as this
  // path; the lookahead stops `docs/A.md.bak` and `docs/A.md-old`, while still allowing a
  // sentence-final `docs/A.md.` — a plain substring replace corrupts all four.
  const re = new RegExp(`(?<![\\w./-])${esc}(?![\\w-]|\\.[A-Za-z0-9])`, 'g');
  // Returns what it did; prints nothing. `archive` and `apply-reorg` format their output
  // differently, and a helper that prints straight to stdout cannot be reused by both.
  const result = { total: 0, files: [], skipped: null };
  // `archive` is documented as usable STANDALONE, and doArchive already falls back to
  // copy+unlink outside a git repo — so "there is no git repo here" means there are no
  // tracked files to rewrite, which is a SKIP, not a failed follow-up. Reporting it as a
  // failure made a fully successful `archive` exit 2 and tell the user to hand-fix something
  // that had never broken. A REAL git failure inside a real repo still throws.
  let tracked;
  try { tracked = gitOrThrow(['ls-files'], 'listing tracked files'); }
  catch (e) {
    if (!/not a git repository/i.test(e.message)) throw e;
    result.skipped = 'inbound links: not a git repository — nothing tracked to rewrite';
    return result;
  }
  for (const f of tracked.split('\n')) {
    if (!f || !LINK_EXTS.has(path.extname(f))) continue;
    if (LINK_SKIP.test(f) || f.startsWith('docs/.docs-builder/')) continue;
    let text;
    try { text = fs.readFileSync(repoPath(f), 'utf8'); } catch { continue; }
    let n = 0;
    let out = text.replace(re, () => (n++, newPath));
    if (path.extname(f) === '.md') {
      let rel;
      if (f === newPath) {
        // This is the file that JUST moved. Its OWN relative links were authored to resolve
        // from its OLD directory — re-express each one from its NEW directory so it still
        // resolves to the exact same target, whether or not that target ever moves too. This
        // is what makes ordering irrelevant when a link's source AND its target both move in
        // the same apply-reorg run: whichever moves first, this keeps ITS outbound link
        // correct as of ITS OWN move, so the other file's move (whenever it happens) finds a
        // link that already resolves correctly against this file's current directory.
        const oldDir = path.posix.dirname(oldPath), newDir = path.posix.dirname(newPath);
        rel = rewriteRelativeLinks(out, pathPart =>
          path.posix.relative(newDir, path.posix.normalize(path.posix.join(oldDir, pathPart))));
      } else {
        const dir = path.posix.dirname(f);
        rel = rewriteRelativeLinks(out, pathPart => {
          const resolved = path.posix.normalize(path.posix.join(dir, pathPart));
          return resolved === oldPath ? path.posix.relative(dir, newPath) : null;
        });
      }
      out = rel.text; n += rel.n;
    }
    if (!n) continue;
    fs.writeFileSync(repoPath(f), out);
    result.files.push({ file: f, n });
    result.total += n;
  }
  return result;
}

// THE single path through which a doc changes location. Every follow-up a move requires
// lives here, and nowhere else.
//
// It exists because the same defect shipped three times running: a follow-up was added to
// one caller and missed by the other. Round 1 fixed repo-vs-cwd path resolution; round 4
// found eight more sites of it. Round 4 fixed the artifact key-sync inside `archive`, but
// `apply-reorg` had never called it at all. Adding link rewriting to `apply-reorg` then left
// `archive` behind in exactly the same way. The two callers differ ONLY in how they report —
// never in what a move entails — so reporting is the parameter and the follow-up list is not.
//
// THROWS only if the move itself failed, in which case nothing on disk has changed. A
// follow-up that fails is collected in `failures` instead, so it can never be mistaken for a
// failed move: the file HAS moved, and telling the caller to retry would be wrong.
function moveDoc(src, dest) {
  const r = doArchive(src, dest);
  const out = { ...r, artifacts: 0, artifactNotes: [], links: 0, linkFiles: [], failures: [] };
  try {
    const t = rewriteArchivedPath(src, r.rel);
    out.artifacts = t.outline + t.labels;
    out.artifactNotes = t.messages;
  } catch (e) { out.failures.push(`syncing outline/labels failed: ${e.message}`); }
  try {
    const l = rewriteLinks(src, r.rel);
    out.links = l.total; out.linkFiles = l.files;
    if (l.skipped) out.artifactNotes.push(l.skipped);
  } catch (e) { out.failures.push(`rewriting inbound links failed: ${e.message}`); }
  return out;
}

function archive(src, dest) {
  if (!src) die('usage: docs-builder.cjs archive <src.md> [dest.md]');
  // A throw and a `failures` entry mean different things and must be reported differently:
  // a throw means NOTHING moved and retrying is correct; a failure means the file DID move
  // and telling the user to re-run `archive` would be actively wrong. MEASURED: a malformed
  // outline.json used to crash here with a bare stack trace naming neither the artifact nor
  // the fact that the file had already moved.
  let r;
  try { r = moveDoc(src, dest); }
  catch (e) { die(e.message); }
  console.log(`archived ${src} -> ${r.rel}  ${r.size} bytes  sha256 ${r.sha.slice(0, 16)} MATCH  (${r.how})`);
  for (const m of r.artifactNotes) console.log(`  ${m}`);
  for (const { file, n } of r.linkFiles) console.log(`  ${file}: ${n} link(s) -> ${r.rel}`);
  // Logged BEFORE the exit-2 branch below: the move itself SUCCEEDED in both branches, and
  // docs/log.md is the record of what moved. Logging only on the clean path left the one case
  // a human most needs to find later — a move whose follow-up failed — absent from the log.
  logOp('archive', `${src} -> ${r.rel}`
    + (r.links ? `, ${r.links} link(s) rewritten` : '')
    + (r.failures.length ? `, FOLLOW-UP FAILED: ${r.failures.join('; ')}` : ''));
  if (r.failures.length) {
    // Exit 2, not 1: 1 means "nothing moved, retry `archive`" and this is the OPPOSITE —
    // the file DID move and re-running `archive` would be wrong, exactly as the message says.
    // A caller branching on exit code alone must be able to tell these two outcomes apart.
    console.error(`the move above SUCCEEDED — ${src} is now at ${r.rel}. But ${r.failures.join('; ')}\n`
      + `Fix that, then re-run \`scan\` (and redo labels) — do NOT re-run \`archive\` for `
      + `${src}, it has already moved.`);
    process.exit(2);
  }
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
// Core THROWS; the wrapper below turns that into process.exit for top-level callers. The
// split is load-bearing, not tidiness: `die` runs process.exit, which NO try/catch can
// intercept. A caller that must SURVIVE a git failure — rewriteLinks, running mid-loop in
// `apply-reorg` after files have already moved — has to call gitOrThrow, or one bad git
// invocation kills the run partway through and prints neither a summary nor a log line.
function gitOrThrow(args, what) {
  try {
    return execFileSync('git', ['-C', REPO, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const msg = (e.stderr || '').toString().trim().split('\n')[0] || e.message;
    throw new Error(`git failed while ${what}: ${msg}`);
  }
}
function git(args, what) {
  try { return gitOrThrow(args, what); }
  catch (e) { die(e.message); }
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
    console.log('no ledger yet — run `docs-builder.cjs ledger` to start tracking. NOT due.');
    return;
  }
  const L = parseJSONFile(f);
  const known = new Map(L.docs.map(d => [d.path, d]));
  // -M turns a delete+add pair into a rename, which is what makes "moved" distinguishable
  // from "deleted and rewritten". Without it every move looks like a total rewrite.
  // A rebase, amend or GC can leave the stamped SHA unreachable. That is a re-stamp
  // situation, not a crash.
  try {
    execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${L.sha}^{commit}`], { stdio: 'ignore' });
  } catch {
    die(`ledger SHA ${L.sha.slice(0, 8)} is not in this repository (rebased, amended or \n`
      + 'garbage-collected). Re-stamp with `docs-builder.cjs ledger`.');
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
  return stripFences(t).replace(/\|/g, ' ')
    .split(/(?<=[.!?])\s+|\n\s*\n/)
    .map(x => x.replace(/[*_`>#-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(x => x.length >= 80);
}

function lint(files) {
  if (!files.length) die('usage: docs-builder.cjs lint <file.md...>');
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

// ---------------------------------------------------------------- discover + apply-reorg
//
// Mode 0: full-corpus reorg. v1 (the old skill) did this whole job by handing an agent a
// file list and a prose rulebook ("KEEP/CONSOLIDATE/ARCHIVE", "when uncertain -> ARCHIVE")
// and letting it read, judge and `mv` everything itself — the exact shape that measured
// 27% correct on bookkeeping elsewhere in this pipeline. This does the same JOB with the
// same discipline as the rest of the file: classification is mechanical and script-run;
// only genuinely unclear cases are surfaced, never silently decided; nothing moves until
// a human (or a caller) looks at the plan and asks for `apply-reorg`.
//
// NOT rebuilt here: v1's CONSOLIDATE (merge two docs' content into one). That is a content
// rewrite, not a move — a different, higher-risk operation than anything measured so far.
// Descoped on purpose, not dropped silently.

// Filename hints alone are WEAK — kept only because v1 used them and they don't false-flag
// on real data (checked against 40 files across 4 repos). The dated-filename rule from v1
// ("2024-01-15-x.md is stale") was tested and DROPPED: on a real corpus, dated filenames are
// how current, un-stale design docs are named (`2026-07-28-p-palette-design.md`), so that
// signal alone would file live specs into archive/. A dated name proves nothing about
// staleness on its own.
const ARCHIVE_FILENAME_RE = /^(REPORT|STATUS|SUMMARY|FIX_|PHASE_|SPRINT_|DRAFT|WIP|OLD|TEMP)[-_]/i;
const ARCHIVE_PATH_RE = /(^|\/)(archive|old|reports?|phases?)\//i;

// STRONG signal: the doc says about ITSELF, in its own opening, that it is done.
//
// MEASURED, not assumed, and case-sensitivity is load-bearing. A case-INsensitive version
// of this regex was tried first against a real, uncrafted corpus (bareloop's docs/) and
// false-positived on real files: "Supersedes **nothing**" (negation), "this rung BUILDS
// three frozen records" (describing an input, not itself), "archived spines" (data the doc
// references, not the doc). Same failure species as the lint fix in §10 — a word that means
// one thing in isolation matches unrelated prose. Restricting to the ALL-CAPS form fixes
// every one of those, because this corpus's own convention (independently, not designed
// around) SHOUTS a genuine status declaration — "Status: CLOSED", "(FROZEN 2026-07-25,
// before any number; archival)" — while narrative mentions of the same word stay lowercase
// or Title Case. Traded away: 2 real misses ("Frozen 2026-07-26" / "job #4 ... (frozen)"),
// consistent with this project's precision-over-recall law. Neither miss is dangerous —
// `discover` only classifies, `apply-reorg` requires a human to have looked at the plan.
const ARCHIVAL_STATUS_RE = /\b(CLOSED|FROZEN|ARCHIVAL|ARCHIVED|SUPERSEDED|WITHDRAWN|RETRACTED|REFUTED|DEPRECATED)\b/;

// Never reorged, at ANY depth: the repo's entry-point/contract docs. Moving a README or a
// CLAUDE.md into archive/ breaks the thing every human and agent reads first. Bare LICENSE /
// NOTICE have no .md extension and are already excluded by walkMd's extension filter.
const PROTECTED_NAMES = new Set([
  'README.md', 'index.md', 'log.md',
  'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
  'CLAUDE.md', 'AGENTS.md', 'AGENT.md',
]);

const DEFAULT_OVERSIZED_LINES = 500; // a starting default, UNMEASURED — see docs-builder.md

// A no-H1 file is not always an unknown doc: uv's real `docs/reference/contributing.md` is
// two lines — `--8<-- "CONTRIBUTING.md"` (an mkdocs snippet include) — a live pointer, not
// prose. Narrow on purpose, same precision-over-recall law as the rest of this classifier:
// only a file whose ENTIRE non-blank content is 1-3 lines, and every one of those lines is
// itself an include directive or a markdown link, counts. Anything else with no H1 — real
// unclassifiable prose — still falls through to `review`.
const INCLUDE_DIRECTIVE_RE = /^(-{2,}8<-{2,}|\{%\s*include\b|\{\{.*\}\}|<!--\s*include\b)/i;
const MD_LINK_LINE_RE = /^\[[^\]]*\]\([^)]+\)$/;
function isIncludeStub(lines) {
  const nonBlank = lines.map(l => l.trim()).filter(Boolean);
  if (!nonBlank.length || nonBlank.length > 3) return false;
  return nonBlank.every(l => INCLUDE_DIRECTIVE_RE.test(l) || MD_LINK_LINE_RE.test(l));
}

function classifyDoc(rel, text) {
  const lines = text.split('\n');
  const h1 = lines.find(l => l.startsWith('# '));
  const opening = lines.slice(0, 20).join(' ').slice(0, 2000);

  if (ARCHIVE_PATH_RE.test(rel))
    return { file: rel, bucket: 'archive', reason: 'path already under archive/old/reports/phases', lines: lines.length };
  if (ARCHIVAL_STATUS_RE.test(opening))
    return { file: rel, bucket: 'archive', reason: 'doc declares its own status in the opening (e.g. CLOSED, FROZEN, deprecated)', lines: lines.length };
  if (ARCHIVE_FILENAME_RE.test(path.basename(rel)))
    return { file: rel, bucket: 'archive', reason: 'filename matches an archive-shaped pattern (weak signal, no content confirmation)', lines: lines.length };
  if (!h1) {
    if (isIncludeStub(lines))
      return { file: rel, bucket: 'product', reason: 'include stub', lines: lines.length };
    return { file: rel, bucket: 'review', reason: 'no H1 — cannot tell what this doc is', lines: lines.length };
  }

  const ceiling = +process.env.OVERSIZED_LINES || DEFAULT_OVERSIZED_LINES;
  if (lines.length > ceiling)
    return { file: rel, bucket: 'oversized', reason: `${lines.length} lines > ${ceiling}-line ceiling — run the split pipeline (scan/propose/assign/validate/plan/write), then archive the original`, lines: lines.length };

  return { file: rel, bucket: 'product', reason: 'structured (has an H1), current size, no archive signal', lines: lines.length };
}

function walkMd(dir, base, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, name.name), rel = path.join(base, name.name);
    if (name.isDirectory()) {
      // Idempotent: never reclassify what discover/apply already placed. Any dot-dir is
      // machine/tool state (.git, .github, .claude, .factory, .opencode, .amp, .docs-builder)
      // and node_modules is vendored — moving a .md out of those is never wanted.
      if (name.name.startsWith('.') || name.name === 'node_modules') continue;
      if (['wiki', 'archive', 'product'].includes(name.name)) continue;
      walkMd(abs, rel, out);
    } else if (name.isFile() && name.name.endsWith('.md')) {
      // Entry-point/contract docs are never subject to reorg, wherever they sit.
      if (PROTECTED_NAMES.has(name.name)) continue;
      out.push(rel);
    }
  }
}

function discover(root) {
  const rootRel = root || 'docs';
  const rootAbs = path.join(REPO, rootRel);
  if (!fs.existsSync(rootAbs)) die(`no such directory: ${rootRel}`);
  const files = [];
  walkMd(rootAbs, rootRel, files);
  const rows = files.map(rel => classifyDoc(rel, read(rel)));
  const byBucket = { product: 0, oversized: 0, archive: 0, review: 0 };
  for (const r of rows) byBucket[r.bucket]++;
  write({ generated: new Date().toISOString(), root: rootRel, rows }, 'reorg-plan.json');
  console.table(rows.map(r => ({ file: r.file, bucket: r.bucket, lines: r.lines })));
  console.log(JSON.stringify(byBucket, null, 1));
  console.log(`plan written to docs/.docs-builder/reorg-plan.json — review it, then run `
    + '`apply-reorg` to move product/ and archive/ candidates. `oversized` files are NOT '
    + 'auto-split (that spends model budget); run the normal pipeline on each, by hand.');
  if (byBucket.review)
    console.log(`WARN: ${byBucket.review} file(s) had no clear signal at all (no H1). `
      + 'apply-reorg treats these as archive candidates too — check the plan first.');
}

function applyReorg(planFile) {
  const f = planFile || path.join(ARTIFACTS, 'reorg-plan.json');
  if (!fs.existsSync(f)) die(`no plan at ${planFile || 'docs/.docs-builder/reorg-plan.json'} — run \`discover\` first`);
  const plan = parseJSONFile(f);
  const results = { moved: 0, skipped: 0, oversizedLeftAlone: 0,
                    artifactsSynced: 0, linksRewritten: 0, syncFailed: 0 };
  const usedNames = new Map(); // collision guard, same defensive pattern as theme slugs
  for (const row of plan.rows) {
    if (row.bucket === 'oversized') { results.oversizedLeftAlone++; continue; }
    const destDir = row.bucket === 'product' ? 'docs/product' : 'docs/archive';
    let base = path.basename(row.file);
    const n = (usedNames.get(destDir + '/' + base) || 0) + 1;
    usedNames.set(destDir + '/' + base, n);
    if (n > 1) { const ext = path.extname(base); base = base.slice(0, -ext.length) + `-${n}` + ext; }
    // Only a failed MOVE skips the file. A failed follow-up is a warning on a file that has
    // already moved — counting it as skipped would be a lie, and stopping the loop would
    // strand the rest of the plan half-applied.
    let r;
    try {
      r = moveDoc(row.file, path.join(destDir, base));
    } catch (e) {
      console.error(`SKIP ${row.file}: ${e.message}`);
      results.skipped++;
      continue;
    }
    console.log(`  ${row.file} -> ${r.rel}`);
    results.moved++;
    results.artifactsSynced += r.artifacts;
    results.linksRewritten += r.links;
    for (const { file, n } of r.linkFiles) console.log(`    ${file}: ${n} link(s) -> ${r.rel}`);
    for (const f of r.failures) {
      console.error(`  WARN ${row.file} MOVED, but ${f}`);
      results.syncFailed++;
    }
  }
  console.log(JSON.stringify(results, null, 1));
  if (results.oversizedLeftAlone)
    console.log(`${results.oversizedLeftAlone} oversized doc(s) left in place — run the split `
      + 'pipeline on each, then `archive` the original.');
  // Nothing was left oversized, so nothing needs the split pipeline — but nothing indexes
  // docs/product/ either, since that only ever happens via `index`, which needs a labels.json
  // only the split flow's theme step produces. `index-flat` is the no-model fallback.
  else if (results.moved > 0)
    console.log('No oversized docs — run `index-flat` to build a flat docs/index.md now '
      + '(one row per file, no split/labels needed).');
  logOp('apply-reorg', `moved ${results.moved}, skipped ${results.skipped}, `
    + `${results.oversizedLeftAlone} oversized left in place, `
    + `${results.linksRewritten} link(s) rewritten, ${results.syncFailed} sync failure(s)`);
}

// ---------------------------------------------------------------- reconcile + prune

// `reconcile` was specified as a MODE but never existed as a subcommand — it lived as prose
// telling the model to run four commands in order. That is the v1 shape this rebuild exists
// to remove (model-driven bookkeeping measured 27%; script-driven measured ~100%), so the
// order is code now. It never writes docs/product/; it owns docs/wiki/.
function reconcile() {
  // reconcile drives four steps that each write a DIFFERENT artifact, and every one of them
  // honours the same `OUT` override — so OUT would point outline.json, validate.json,
  // index.md and lint.json at one file, while reconcile reads outline.json back from the
  // DEFAULT path regardless and silently validates a stale one. OUT is a per-step override;
  // reconcile is not a step.
  if (process.env.OUT) {
    console.error(`WARN: ignoring OUT=${process.env.OUT} — reconcile writes four artifacts `
      + '(outline.json, validate.json, index.md, lint.json) and each goes to its own default path.');
    delete process.env.OUT;
  }
  // Everything reconcile itself GENERATES is excluded from its own scan corpus — pulling any
  // of it back in makes validate's `missing` check fail on headings a product-only
  // labels.json can never cover, and re-fails on every subsequent run:
  //   - PAGES (docs/wiki by default) — the synthesised pages, reconcile's output, not source.
  //     Read from PAGES, not hardcoded, so a non-default pages dir is excluded too.
  //   - INDEX (docs/index.md by default) — written by `index` below; its `## [theme](...)`
  //     rows would become outline records on the next run.
  //   - docs/log.md — append-only, one `## [DATE] op | desc` H2 per operation, so it grows a
  //     new unlabelled record (and duplicate-key collisions) every single time reconcile runs.
  const pages = process.env.PAGES || 'docs/wiki';
  const pagesPrefix = pages.replace(/\/*$/, '/');
  const indexF = process.env.INDEX || 'docs/index.md';
  const files = docFiles().filter(f => !f.startsWith('docs/archive/')
    && !f.startsWith(pagesPrefix) && f !== indexF && f !== 'docs/log.md');
  if (!files.length) die('no docs to reconcile — docs/ has no tracked .md outside archive/');
  console.log(`reconcile: ${files.length} doc(s)\n`);
  console.log('== scan =='); scan(files);
  const outlineF = path.join(ARTIFACTS, 'outline.json');
  const labelsF = path.join(ARTIFACTS, 'labels.json');
  // validate/index need a theme assignment, which only a model can produce. Reconcile is the
  // CHEAP path and never calls a model, so with no labels.json it says so and skips — loudly,
  // never silently, and never by inventing labels of its own.
  let validateFailed = false;
  if (fs.existsSync(labelsF)) {
    console.log('\n== validate ==');
    const res = doValidate(outlineF, labelsF);
    // A FAIL must NOT abort reconcile: reconcile is the cheap, read-only-ish path, and lint is
    // the part most likely to be useful when validate is unhappy. So it's reported loudly here
    // and reconcile still runs index + lint, then exits non-zero at the very end. The standalone
    // `validate` subcommand keeps its own hard-gate behaviour unchanged (see validate() above).
    if (res.verdict !== 'PASS') {
      validateFailed = true;
      console.error(`\nreconcile: validate FAILED — continuing to index + lint anyway `
        + '(a FAIL does not abort reconcile); exiting non-zero once everything below has run.');
    }
    console.log('\n== index ==');    index(outlineF, labelsF);
    const [o, l] = loadPair(outlineF, labelsF);
    warnUnarchivedSplits(o, l, pages);
  } else {
    console.log(`\nLOUD-SKIP: validate + index need ${labelsF}, which only the grouping step`
      + ' can write. Run the split flow on a doc first, or pass labels.json by hand.');
  }
  console.log('\n== lint =='); lint(files);
  logOp('reconcile', `${files.length} doc(s) scanned` + (validateFailed ? ', validate FAILED' : ''));
  if (validateFailed) process.exit(1);
}

// `archive-cleanup` DELETES files from docs/archive/. It is the only destructive command in
// the pipeline, so the gate is the user's explicit confirmation, obtained BEFORE this runs:
// bare `archive-cleanup` only reports, and `--apply` deletes exactly the files it is handed
// by name. There is deliberately no `--all` and no age heuristic — nothing here decides on
// the user's behalf what is worth keeping.
//
// A tracked file goes via `git rm`, so it is gone from the tree but recoverable from history.
// An UNTRACKED file has no history to recover from: it is unlinked and gone for good, and
// that is called out per file rather than quietly treated as the same operation.
//
// It will not choose FOR you. A file is only ever a CANDIDATE, because this pipeline already
// settled that uncited is a fact and deletable is a judgement (bareloop's O2-O4 are genuinely
// uncited and must stay — they are the middle of a coherent series). So: no bulk prune, no
// --all, no age heuristic. Bare `archive-cleanup` reports; pruning requires naming each file.
function archiveCleanup(args) {
  const files = args.filter(a => a !== '--apply');
  const apply = args.includes('--apply');
  const tracked = new Set(docFiles().filter(f => f.startsWith('docs/archive/')));
  // Can't reuse walkMd here: it deliberately skips any directory named `archive` (reorg's
  // idempotency guard), so it would never descend into docs/archive/ at all. This is a plain
  // recursive listing of every .md under docs/archive/, tracked or not — archive-cleanup is
  // the one place that must see untracked files too, since those are the ones with no git
  // history to fall back on.
  const archiveDir = path.join(REPO, 'docs/archive');
  const untracked = [];
  (function walk(dir, base) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, name.name), rel = base ? `${base}/${name.name}` : name.name;
      if (name.isDirectory()) walk(abs, rel);
      else if (name.isFile() && name.name.endsWith('.md')) untracked.push(`docs/archive/${rel}`);
    }
  })(archiveDir, '');
  const archived = [...new Set([...tracked, ...untracked])].sort();
  if (!archived.length) { console.log('docs/archive/ is empty — nothing to clean up.'); return; }

  // Referrer scan mirrors rewriteLinks: same file types, same exclusions. A doc's own text
  // never counts as a reference to itself.
  // archiveCleanup is a top-level CLI command, so a git failure here is guarded the same way
  // as everywhere else in this file: caught and die()'d cleanly, never left to throw past this
  // function and dump a raw Node stack trace.
  let scanned;
  try {
    scanned = gitOrThrow(['ls-files'], 'listing tracked files').split('\n')
      .filter(f => f && LINK_EXTS.has(path.extname(f)) && !LINK_SKIP.test(f)
                   && !f.startsWith('docs/.docs-builder/'));
  } catch (e) { die(e.message); }
  const rows = archived.map(a => {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w./-])${esc}(?![\\w-]|\\.[A-Za-z0-9])`);
    const by = scanned.filter(f => {
      if (f === a) return false;
      try { return re.test(fs.readFileSync(repoPath(f), 'utf8')); } catch { return false; }
    });
    return { file: a, referrers: by.length, by, tracked: tracked.has(a) };
  });

  if (!apply) {
    // Naming files without --apply used to be silently ignored, which reads exactly like a
    // delete that ran and found nothing. Say plainly that this run is the report.
    if (files.length) console.error(`NOTE: ${files.length} file(s) named without --apply — `
      + 'nothing is deleted. This run is the report; re-run with --apply to delete them.');
    console.table(rows.map(r => ({ file: r.file, referrers: r.referrers,
      candidate: r.referrers === 0 ? 'yes — uncited' : 'no',
      recoverable: r.tracked ? 'git history' : 'NO — untracked' })));
    const cand = rows.filter(r => !r.referrers);
    console.log(`\n${archived.length} archived, ${cand.length} uncited.`);
    console.log('UNCITED IS NOT DELETABLE BY ITSELF. An uncited doc can be the middle of a'
      + ' coherent series and must stay. Nothing has been removed. Confirm with the user'
      + ' which of these to delete before going further.');
    if (cand.length) console.log('\nTo delete, name the confirmed files explicitly:\n  '
      + `docs-builder.cjs archive-cleanup --apply ${cand[0].file}`);
    return;
  }

  if (!files.length) die('archive-cleanup --apply needs one or more files to delete, by name. '
    + 'Run it bare first to see candidates, and confirm with the user before deleting. '
    + 'There is no --all, on purpose.');
  // Destructive and irreversible-looking to the user, so it refuses to run on top of work
  // that is not committed: `git checkout` has to be able to bring the file back. An untracked
  // ARCHIVE CANDIDATE named on this very --apply is the one exception: it has no history to
  // protect either way, and it will always show as `??` in porcelain, so treating it as
  // "dirty" would make the untracked-delete path this function documents above permanently
  // unreachable. The exception is scoped tight on purpose: `?? path` only excuses a line when
  // `path` is (a) named on this --apply AND (b) a real, untracked row under docs/archive/ —
  // an arbitrary untracked path (e.g. unrelated scratch file) named alongside a real candidate
  // must NOT be able to buy the whole run an exemption from the clean-tree gate.
  //
  // Two known misses, both fail-safe (they block instead of wrongly excusing), left as-is:
  //   - porcelain quotes a path containing spaces/non-ASCII (`?? "docs/archive/a b.md"`), so
  //     `l.slice(3)` won't match the plain name and the run refuses rather than proceeds.
  //   - an untracked file inside an untracked DIRECTORY shows as one directory line with a
  //     trailing slash (`?? docs/archive/sub/`), not a per-file line, so it can never match
  //     and can never be deleted via this exception either.
  const deletable = new Set(rows.filter(r => files.includes(r.file) && !r.tracked)
    .map(r => r.file));
  let dirty;
  try {
    dirty = gitOrThrow(['status', '--porcelain'], 'checking the tree is clean').split('\n')
      .filter(l => !(l.startsWith('?? ') && deletable.has(l.slice(3)))).join('\n');
  } catch (e) { die(e.message); }
  if (dirty) die('archive-cleanup needs a clean git tree — commit or stash first, so a '
    + 'pruned file can be restored with `git checkout`.\n' + dirty);
  let deleted = 0, unrecoverable = 0;
  for (const f of files) {
    const row = rows.find(r => r.file === f);
    if (!row) { console.error(`SKIP ${f}: not a file under docs/archive/`); continue; }
    if (row.referrers) { console.error(`SKIP ${f}: still referenced by ${row.by.join(', ')}`); continue; }
    try {
      if (row.tracked) { gitOrThrow(['rm', '-q', f], `deleting ${f}`); console.log(`  deleted ${f}`); }
      else { fs.unlinkSync(repoPath(f)); unrecoverable++; console.log(`  deleted ${f}  (UNTRACKED — no history, gone for good)`); }
      deleted++;
    } catch (e) { console.error(`SKIP ${f}: ${e.message}`); }
  }
  console.log(`\ndeleted ${deleted} of ${files.length}.`
    + (deleted - unrecoverable ? ' Tracked ones are recoverable with `git checkout HEAD -- <path>` until you commit.' : '')
    + (unrecoverable ? ` ${unrecoverable} were untracked and are NOT recoverable.` : ''));
  if (deleted) logOp('archive-cleanup', `deleted ${deleted}: ${files.slice(0, 5).join(', ')}`);
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
  case 'scan':        scan(rest); break;
  case 'validate':    validate(rest[0], rest[1]); break;
  case 'plan':        plan(rest[0], rest[1]); break;
  case 'index':       index(rest[0], rest[1]); break;
  case 'index-flat':  indexFlat(); break;
  case 'search':      search(rest[0], rest.slice(1)); break;
  case 'archive':     archive(rest[0], rest[1]); break;
  case 'ledger':      ledger(); break;
  case 'due':         due(); break;
  case 'lint':        lint(rest); break;
  case 'discover':    discover(rest[0]); break;
  case 'apply-reorg': applyReorg(rest[0]); break;
  case 'reconcile':   reconcile(); break;
  case 'archive-cleanup': archiveCleanup(rest); break;
  default:
    die('usage: docs-builder.cjs <scan|validate|plan|index|index-flat|search|archive|ledger|due|lint|'
      + 'discover|apply-reorg|reconcile|archive-cleanup> [args]\n'
      + '  scan        <file.md...>                 -> outline.json\n'
      + '  validate    <outline.json> <labels.json> -> PASS/FAIL (exit 1 on FAIL)\n'
      + '  plan        <outline.json> <labels.json> -> task-<theme>.json per page\n'
      + '  index       <outline.json> <labels.json> -> index.md\n'
      + '  index-flat                                -> index.md, one row per docs/product/ file, no labels\n'
      + '  search      <outline.json> <query...>     -> ranked sections (BM25, no deps)\n'
      + '  archive     <src.md> [dest.md]            -> verified MOVE into docs/archive/\n'
      + '  ledger                                    -> record current state of docs/\n'
      + '  due                                       -> what changed since the ledger\n'
      + '  lint        <file.md...>                  -> lint.json\n'
      + '  discover    [root=docs]                   -> reorg-plan.json (classify, never moves)\n'
      + '  apply-reorg [plan.json]                    -> executes the plan\n'
      + '  reconcile                                 -> scan+validate+index+lint over docs/\n'
      + '  archive-cleanup [--apply <f>...]          -> report, or prune NAMED archived files\n'
      + 'env: REPO (default cwd), OUT (output path), INDEX (default docs/index.md), '
      + 'PAGES (default docs/wiki), TASKS (default docs/.docs-builder/tasks), '
      + 'N (search result count, default 10), OVERSIZED_LINES (default 500)');
}
