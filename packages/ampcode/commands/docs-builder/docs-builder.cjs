#!/usr/bin/env node
'use strict';
// docs-builder — every mechanical step of the pipeline. Vanilla Node, zero deps, NO MODEL.
// The model is used for exactly two things (propose themes, write pages); everything else
// lives here, because bookkeeping done by a script is 100% and done by a model is 27%.
//
//   scan     <file.md...>                          -> outline.json   (Layer 1)
//   validate <outline.json> <labels.json>          -> PASS/FAIL      (Layer 2 gate)
//   plan     <outline.json> <labels.json>          -> task-<theme>.json per page (resumes)
//   index-flat                                     -> index.md       (the ONE index: whole
//                                                       corpus, no labels needed, rebuilt on
//                                                       every reorg AND after every split)
//   search   <outline.json> <query words...>       -> ranked sections (BM25, zero deps)
//   archive  <src.md> [dest.md]                    -> verified MOVE into docs/archive/
//   ledger                                         -> record the current state of docs/
//   due                                            -> what changed since the ledger, and how much
//   lint     <file.md...>                          -> lint.json      (declared-only checks)
//   discover [root]                                -> reorg-plan.json (enriches + PROPOSES a
//                                                       bucket per row via `suggested`; NEVER
//                                                       moves, NEVER decides `bucket`)
//   apply-reorg [plan.json]                        -> executes an ALREADY-CLASSIFIED plan
//                                                       (refuses if any row's `bucket` is
//                                                       empty), then re-scans the WHOLE corpus
//                                                       (product/ + logs/ + archive/) into
//                                                       outline.json — search's only database
//   reorg                                          -> discover, STOPS for the classification
//                                                       interview if any `bucket` is unfilled,
//                                                       else apply-reorg + lint, plus `due`'s
//                                                       drift summary if a ledger stamp exists
//                                                       — the single front door
//   cleanup  <file.md>                             -> ONE named file: cost estimate, scan, a
//                                                       heading-SHAPE report (cleanup-shape.json)
//                                                       -- then STOPS, awaiting the interview.
//                                                       (the ONLY entry point to the split pipeline)
//   cleanup-apply <file.md> <outline.json> <labels.json>
//                                                   -> post-approval half: refuses unless
//                                                       labels.json has one core:true theme,
//                                                       else plan -> (pages, written by the
//                                                       model, outside this script) -> once all
//                                                       pages exist, archive + rebuild index
//
// Env: REPO (default cwd), OUT (output path), INDEX (default docs/index.md, validate's link
// check — the same file index-flat writes), PAGES (default docs/wiki, validate's citations +
// plan), TASKS (default docs/.docs-builder/tasks, validate's citations reader-side match for
// plan's OUT), N (search count, default 10), OVERSIZED_LINES (default 500, discover's
// oversized ceiling).

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

// Same mask, a different use: `text.replace(regex, replacer)` but skipping any line inside a
// fenced code block entirely, so a match never touches CODE. Every regex this is used with
// (INLINE_LINK_RE, REF_LINK_RE, the exact repo-rooted path matcher in rewriteLinks) excludes
// whitespace/newline from what it captures, so a match can never span two lines — line-at-a-
// time masking is exact, not an approximation. MEASURED, real: `INLINE_LINK_RE` used to run
// fence-blind and rewrote `](cleanAction.args)` — a JS property-access expression inside a
// fenced ASCII-diagram code sample, not a markdown link at all — into a broken link target.
// A fenced block is not the only way a doc shows code. FIELD BUG (real, reproduced on a
// fresh repo the day fence-awareness shipped): an INLINE span, `map[key](arg)`, came out of
// a reorg as `map[key](../arg)` — the identical corruption one syntax down, because masking
// stopped at fences. A span is delimited by a matching backtick run on the SAME line (CommonMark
// allows spans to wrap, but a wrapped span cannot be confused for a link target by any regex
// here, all of which are single-line), so the same line-at-a-time treatment is exact here too.
const CODE_SPAN_RE = /(`+)(?:(?!\1)[\s\S])*?\1/g;

// Splits one line into alternating [outside, code, outside, code, ...] segments. Odd indices
// are code spans and are never handed to a replacer.
function codeSpanSegments(line) {
  const segs = [];
  let last = 0;
  CODE_SPAN_RE.lastIndex = 0;
  for (let m; (m = CODE_SPAN_RE.exec(line)) !== null;) {
    segs.push(line.slice(last, m.index), m[0]);
    last = m.index + m[0].length;
  }
  segs.push(line.slice(last));
  return segs;
}

// `spans` says whether an inline `code span` is also off-limits. The two callers deliberately
// differ:
//   - the RELATIVE-link passes (INLINE_LINK_RE / REF_LINK_RE) INFER a link from `](...)`
//     syntax, so a span holding `map[key](arg)` is code being misread as a link. spans: true.
//   - the EXACT repo-rooted path matcher matches a literal, unambiguous path. A backticked
//     `docs/GUIDE.md` in prose is how docs render a filename inline — it is a real reference
//     to the moved file, and NOT rewriting it leaves a dead reference (asserted by the
//     move-repair tests since v2). spans: false. A FENCE still means code for both: there the
//     path is part of a snippet the reader copies verbatim.
function replaceOutsideFences(text, regex, replacer, { spans = true } = {}) {
  const lines = text.split('\n');
  const mask = fenceMask(lines);
  // A `^`-anchored regex (REF_LINK_RE) may only ever match at a real line start, so it is
  // applied to the FIRST segment alone — segment 2 onward begins mid-line, and letting `^`
  // re-anchor there would rewrite a target that is not a reference definition at all.
  const anchored = regex.source.startsWith('^');
  return lines.map((line, i) => {
    if (mask[i]) return line;
    if (!spans) return line.replace(regex, replacer);
    const segs = codeSpanSegments(line);
    if (segs.length === 1) return line.replace(regex, replacer);
    return segs.map((seg, j) => {
      if (j % 2 === 1) return seg;              // a code span: never a rewrite target
      if (anchored && j !== 0) return seg;
      return seg.replace(regex, replacer);
    }).join('');
  }).join('\n');
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

// (b) every markdown link inside the (one, whole-corpus) index must resolve to a real file.
// Loud skip, not a silent pass, when that file is missing — same law as the themes[] guard in
// loadPair() above: a gate that quietly stops checking is worse than no gate.
//
// v3 scope change (2026-08-24): the themed per-split index (docs/wiki-index.md) is gone —
// see the removal note where its `index()` function used to be. This now checks the SAME
// single index index-flat writes (`docs/index.md` by default), and checks EVERY link in it,
// not just ones under a PAGES-relative prefix: the old scoping existed only because the
// themed index's links were ALWAYS PAGES-relative by construction; the one index links into
// product/, logs/, archive/ and PAGES/ all in the same file, so a prefix-scoped check would
// silently stop covering most of it. This also means a core-theme page — settled 2026-08-23,
// docs-builder-v3-spec.md "cleanup": lives in its own document's original directory, not
// PAGES — is checked exactly like any other row, with no special case needed here at all.
function checkLinks() {
  const rel = process.env.INDEX || 'docs/index.md';
  if (!fs.existsSync(repoPath(rel))) { console.error(`LOUD-SKIP: links check did not run — no ${rel}`); return { checked: false, bad: [] }; }
  const text = stripFences(fs.readFileSync(repoPath(rel), 'utf8'));
  const dir = path.dirname(rel);
  // Old regex required the capture to end `.md)` literally, so `(x.md#anchor)` never matched
  // — a broken link went unchecked. And `%20` in a correct link false-positived against the
  // real (unencoded) path. Fix: strip `#anchor` before the `.md` filter, decode before the
  // existence check. Absolute/external targets (a URL, a leading `/`) are never in scope —
  // this only ever checks relative links, the only kind indexRow() ever writes.
  const links = new Set([...text.matchAll(/\]\(([^()\s]+)\)/g)]
    .map(m => decodeURIComponent(m[1].split('#')[0]))
    .filter(l => l.endsWith('.md') && !/^[a-z][a-z0-9+.-]*:/i.test(l) && !l.startsWith('/')));
  const bad = [...links].filter(link => !fs.existsSync(repoPath(path.join(dir, link))));
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
  const rel = 'docs/log.md';
  const f = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `## [${new Date().toISOString().slice(0, 10)}] ${op} | ${desc}\n`);
  // FIELD BUG (privcloud, real first run): the commit recipe omitted this file — which THIS
  // RUN had just created, holding this run's own audit lines. Following the recipe verbatim
  // committed a reorg and left its log untracked. Same class as omitting the index.
  noteGenerated(rel);
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

// Cost law measured over 10 pages, R^2 = 0.96. 42% of the write bill is per-page fixed. One
// function so `plan` (real page count, from labels.json) and `cleanup` (a 1-page floor,
// printed before any grouping has happened) can never disagree on the formula itself.
function writeCostEstimate(pages, lines) { return pages * 0.083 + lines / 1000 * 0.200; }

// settled 2026-08-23 (docs-builder-v3-spec.md, "cleanup" — "Everything cleanup produces is
// a new file"): the core theme's page carries the ORIGINAL file's basename, not a slugified
// theme name. Exactly one theme may claim it — two would mean two pages both wanting to own
// the source's identity. Zero is fine: most callers of `plan` (tests, and any labels.json
// hand-written without a split in mind) never set one at all.
function coreThemeName(themes) {
  const cores = (themes || []).filter(t => t.core === true);
  if (cores.length > 1)
    die(`labels.json marks ${cores.length} themes core:true (${cores.map(t => t.name).join(', ')}) `
      + '— exactly one theme may be core (docs-builder-v3-spec.md, "cleanup").');
  return cores[0] ? cores[0].name : null;
}

// Shared by `plan` and `index` so the page `plan` writes and the link `index` prints can
// never name the core theme two different ways. Every other theme keeps the existing
// collision-safe slugOf() behaviour (slugMap); only the core theme, if any, is overridden to
// the source file's own basename.
function buildThemeSlugs(names, l, o) {
  const coreName = coreThemeName(l.themes);
  const slugs = slugMap(names.filter(n => n !== coreName));
  if (coreName) {
    const bases = [...new Set(o.records.map(r => r.file))].map(f => path.basename(f));
    if (new Set(bases).size !== 1)
      die('a core theme requires an outline scanned from exactly one source file, but this '
        + `outline covers ${new Set(bases).size} (${[...new Set(bases)].join(', ')}) — core `
        + "naming only makes sense for cleanup's one-file split.");
    const coreSlug = bases[0].replace(/\.md$/, '');
    if ([...slugs.values()].includes(coreSlug))
      console.error(`WARN: core page name "${coreSlug}" collides with another theme's slug`);
    slugs.set(coreName, coreSlug);
  }
  return slugs;
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
function unarchivedSplits(o, l, pages, slugs) {
  const g = [...group(o, l)];
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

function warnUnarchivedSplits(o, l, pages, slugs) {
  for (const w of unarchivedSplits(o, l, pages, slugs))
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
  const slugs = buildThemeSlugs(grouped.map(([t]) => t), l, o);
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
  warnUnarchivedSplits(o, l, pages, slugs);
  const tot = todo.reduce((a, r) => a + r.lines, 0);
  console.table(rows);
  if (todo.length < rows.length)
    console.log(`resuming: ${rows.length - todo.length} of ${rows.length} pages already in ${pages}/`);
  // Returned, not just printed: `cleanup-apply` (below) needs `todo` to know whether it may
  // move on to archive+index, or must stop and wait for the model to write more pages.
  if (!todo.length) { console.log('all pages written — nothing to do.'); return { rows, todo, pages }; }
  const est = writeCostEstimate(todo.length, tot);
  console.log(`pages to write: ${todo.length}  lines: ${tot}  est. write cost: $${est.toFixed(2)} (mid tier)`);
  if (todo.length > 3) console.log('launch page writers 3 at a time; each finished page is a checkpoint — re-run `plan` to resume.');
  return { rows, todo, pages };
}

// ---------------------------------------------------------------- (themed index — removed)

// REMOVED 2026-08-24 (user decision, explicit spec: "ONE index... rewritten on every reorg...
// also runs after splitting"). This used to be a SECOND index — a themed, per-split view at
// `docs/wiki-index.md`, written by a subcommand called `index` — sitting alongside index-
// flat's whole-corpus `docs/index.md`. It was never asked for, and it was the direct cause of
// three separate defects: (1) an early version of it defaulted to the SAME file index-flat
// writes, so the last writer silently clobbered the other's rows; (2) even split apart into
// its own file, its own `scan` step still clobbered outline.json across concurrent splits
// (see inFlightSplit(), which now refuses that instead); (3) its slug-based lookup
// (slugOf()'s lowercasing) could report an existing page as "pending" for a heading like
// "RLM_PRD" whose slug and file didn't round-trip. index-flat's whole-corpus `docs/index.md`
// already covers everything this indexed (verified: it lists every PAGES/ page, at whatever
// grain it exists in `## Product`) at the row-count grain MEASURED to actually help (16 rows
// fine, 97 won, 364 lost — indexing every PAGES page a second time at section grain was
// already trending toward the losing arm). `docs-builder.cjs search` remains the fallback
// once a corpus outgrows a flat index — see its own comment below.

// ---------------------------------------------------------------- index-flat (no labels)

// v3: ONE index for the WHOLE corpus, three sections — `## Product`, `## Logs`, `## Archive`.
// `search` reads outline.json, never index.md, so index.md is purely a human/agent map.
//
// docs/index.md is THIS function's file, and only this function's: `index-flat` (called
// directly, and from `apply-reorg`/`cleanup-apply`) is the sole writer of the default OUT
// path. A real defect on bareloop is why that line is load-bearing, not decoration: a themed
// `index` subcommand used to write a SECOND index (`docs/wiki-index.md`) that briefly
// defaulted to this SAME file — a PRD split's 7-row themed index silently overwrote the
// 37-row whole-corpus map the moment it ran, 30 files vanishing from a file that still
// claimed completeness. Rather than keep giving the two index files their own defaults
// forever, the themed one was removed outright 2026-08-24 (see the removal note where its
// `index()` function used to live) — `docs/index.md` is now the ONE index there is to
// collide with.
//
// `## Product` covers three things, using the SAME partition scanWholeCorpus() already
// established (wholeCorpusFiles()) — not a fourth enumeration of the corpus:
//   - every file under docs/product/
//   - every page under PAGES (docs/wiki by default), if any exist
//   - every doc still sitting in place elsewhere in the corpus — e.g. an oversized file
//     apply-reorg deliberately left untouched, since splitting spends real model budget and
//     must never fire unprompted (see docs-builder-v3-spec.md, "The three rules").
// `## Archive` is one row per file under docs/archive/.
//
// Nothing in this pipeline prunes archive/ — the one command that used to (it was the only
// destructive one in the whole tool) was removed outright; pruning is just `git rm`, the
// user's own call — so left alone it only grows. ARCHIVE_WARN_ROWS below is a console-only
// tripwire, never a prune, never a collapse, never a delete.
const ARCHIVE_WARN_ROWS = 100; // stated default, not measured — see docs-builder-v3-spec.md

function indexRow(rel, dest) {
  const text = read(rel);
  const h1 = (text.split('\n').find(l => l.startsWith('# ')) || '').slice(2).trim();
  const lines = text.split('\n').length;
  // Read from INSIDE index.md, so the link must resolve relative to index.md's own
  // directory, not the repo root.
  const relLink = path.relative(path.dirname(dest), repoPath(rel)).split(path.sep).join('/');
  return `- [${h1 || path.basename(rel)}](${relLink}) — ${lines} lines\n`;
}

function renderSection(title, rows) {
  let s = `## ${title}\n\n`;
  s += rows.length ? rows.map(r => r.row).join('') : '_(none)_\n';
  return s + '\n';
}

function indexFlat() {
  const archiveRel = 'docs/archive/';
  const logsRel = 'docs/logs/';
  const corpus = wholeCorpusFiles(); // product/, logs/, archive/, and anything left in place
  const archiveFiles = corpus.filter(f => f.startsWith(archiveRel));
  const logsFiles = corpus.filter(f => f.startsWith(logsRel));
  const productFiles = corpus.filter(f => !f.startsWith(archiveRel) && !f.startsWith(logsRel));

  const pagesRel = process.env.PAGES || 'docs/wiki';
  const pagesAbs = repoPath(pagesRel);
  const pageFiles = fs.existsSync(pagesAbs)
    ? fs.readdirSync(pagesAbs).filter(f => f.endsWith('.md'))
        .map(f => path.join(pagesRel, f).split(path.sep).join('/'))
    : [];

  if (!productFiles.length && !logsFiles.length && !archiveFiles.length && !pageFiles.length) {
    console.log('nothing to index — run `discover` + `apply-reorg` first.');
    return false; // caller (applyReorg) uses this to skip the config pointer — no index.md was written
  }

  const outRel = process.env.OUT || 'docs/index.md';
  const dest = repoPath(outRel);
  const productRows = [...productFiles, ...pageFiles].sort()
    .map(f => ({ file: f, row: indexRow(f, dest) }));
  const logsRows = logsFiles.sort().map(f => ({ file: f, row: indexRow(f, dest) }));
  const archiveRows = archiveFiles.sort().map(f => ({ file: f, row: indexRow(f, dest) }));

  let s = '# Index\n\n';
  // Unconditional — not gated on row count, unlike ARCHIVE_WARN_ROWS below: a reader should
  // reach for `search` on instinct, not only once a corpus is already large.
  s += '> Search this corpus instead of reading it whole: `/docs-builder search <query words>`\n\n';
  s += '**Completeness guarantee:** every file under `docs/product/`, every page under '
     + `\`${pagesRel}/\` (if any), every doc left in place after a reorg, every file under `
     + '`docs/logs/`, and every file under `docs/archive/` appears in exactly one row below.\n\n';
  s += '_Generated by `docs-builder.cjs index-flat` — the ONE index, rebuilt every reorg and '
     + 'after every split (`cleanup-apply`). No theme grouping, no model call. Never '
     + 'hand-edit._\n\n';
  s += renderSection('Product', productRows);
  s += renderSection('Logs', logsRows);
  s += renderSection('Archive', archiveRows);
  const total = productRows.length + logsRows.length + archiveRows.length;
  s += `---\n\nTotal: ${total} row(s) — ${productRows.length} product, `
     + `${logsRows.length} logs, ${archiveRows.length} archive.\n`;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, s);
  noteGenerated(outRel);
  console.log(`wrote ${dest}: ${total} rows (${productRows.length} product, `
    + `${logsRows.length} logs, ${archiveRows.length} archive)`);
  logOp('index-flat', `${total} row(s) (${productRows.length} product, `
    + `${logsRows.length} logs, ${archiveRows.length} archive)`);

  // Console-only tripwire. Nothing in this run prunes archive/ automatically — pruning is
  // `git rm`, the user's own call (see the ARCHIVE_WARN_ROWS comment above). This never
  // prunes, never collapses the section, never deletes; it only warns.
  if (archiveRows.length > ARCHIVE_WARN_ROWS)
    console.log(`WARN: archive/ is ${archiveRows.length} rows and growing — nothing prunes it `
      + `automatically.\n      Review ${outRel} ## Archive and \`git rm\` what you no longer `
      + 'need.');
}

// ---------------------------------------------------------------- search (BM25, zero deps)

// The fallback once a corpus outgrows a flat index-md's row ceiling (MEASURED against the
// now-removed themed index: 16 rows fine, 97 rows won, 364 rows lost): a reader who can't
// hold the whole index in one read needs ranked results instead. This reuses outline.json
// (already on disk from `scan` — no second index to build or drift)
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
// again. Whether it can later be pruned is the user's own call — `git rm` — not this
// pipeline's; the command that used to do that was removed outright (see the ARCHIVE_WARN_ROWS
// comment in indexFlat() above).
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Both endpoints of every move must resolve INSIDE the repo. REPO may be relative (the test
// harness runs with REPO='.'), so resolve both sides before comparing — a `path.join` alone
// happily produces `../secret.txt` and reports no error.
// REPRODUCED 2026-08-24: a `"file": "../secret.txt"` row in reorg-plan.json reached doArchive
// through applyReorg -> moveDoc. `git mv` refused it (source outside the work tree), and the
// copy+unlink FALLBACK below then did exactly what it says — copied that file into the repo
// and unlinked the original. A traversal in a plan row is not hypothetical: plan rows pass
// through a model-driven classification interview, on corpora cloned from elsewhere.
// A string check alone is not enough: path.resolve() does NOT dereference symlinks, so
// `docs/evil.md -> /etc/passwd` passes confinement and the copy+unlink fallback then reads
// through the link and writes its TARGET's bytes into the repo. REPRODUCED 2026-08-24:
// `archive docs/evil-link.md docs/archive/evil.md` exited 0 having copied /etc/passwd in.
// Same threat model as the traversal above — a planted link in a cloned corpus needs nobody
// to type anything. So: resolve the string first (catches `../x` on a path that does not
// exist yet, which realpath cannot), then realpath what actually exists and re-check.
// The DESTINATION is checked as a string only — it is not supposed to exist yet, and its
// parent is created by doArchive itself.
function confined(p, what, { deref = false } = {}) {
  const inside = (root, a) => {
    const rel = path.relative(root, a);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const root = path.resolve(REPO);
  const abs = path.resolve(root, p);            // absolute p wins; relative p joins onto REPO
  if (!inside(root, abs))
    throw new Error(`refusing to ${what} outside the repo: ${p}`);
  if (!deref) return abs;
  let real;
  try { real = fs.realpathSync(abs); }
  catch { return abs; }                         // does not exist yet — the caller reports that
  // Compare real against a REAL root: the repo itself may sit under a symlinked path
  // (/tmp -> /private/tmp on macOS, and mkdtemp under it), which would otherwise read as
  // an escape for every legitimate file.
  if (!inside(fs.realpathSync(root), real))
    throw new Error(`refusing to ${what} outside the repo: ${p} is a symlink to ${real}`);
  return real;
}

// Core logic THROWS, never exits — so a caller doing many moves in a loop (apply-reorg)
// can catch one bad file and keep going. `archive()` below is the CLI-facing wrapper that
// turns a throw into a `die()` for a single direct invocation.
//
// Both guards below live HERE, at the chokepoint, and not at the call sites that happen to
// need them today. That is the whole point of moveDoc being the one path a doc moves
// through: a guard placed at a caller is a guard the next caller forgets. PROTECTED_NAMES
// used to be enforced in walkMd and cleanup only — so `archive README.md` moved the repo's
// README into docs/archive/ without a word (REPRODUCED 2026-08-24). Those two call-site
// checks are kept: they fail earlier and with a message aimed at what the user actually ran.
function doArchive(src, dest) {
  const s = confined(src, 'move a doc from', { deref: true });
  if (!fs.existsSync(s)) throw new Error(`no such file: ${src}`);
  if (PROTECTED_NAMES.has(path.basename(src)))
    throw new Error(`refusing to move ${src}: ${path.basename(src)} is an entry-point/contract `
      + 'doc (README, CLAUDE.md, CHANGELOG, the index, the log, ...) and is never moved, at '
      + 'any depth — every human and agent reads it first.');
  const rel = dest || path.join('docs/archive', path.basename(src));
  const d = confined(rel, 'move a doc to');
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
// pipeline's own JSON (rewriteArchivedPath owns those); never a file RESIDENT under
// docs/archive/ (same rationale, one directory further — see isRewriteExempt below).
const LINK_EXTS = new Set(['.md', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml']);
const LINK_SKIP = /(^|\/)(CHANGELOG\.md|log\.md)$/;

// docs/archive/ exists to hold frozen originals — its whole purpose is a record of where a
// file WAS, exactly the CHANGELOG.md/log.md rationale above, one directory further. A file
// RESIDENT under it (REORG_DEST.archive, not a literal — one constant, so a future path
// change can't desync this from where `apply-reorg` actually moves files) is never a rewrite
// TARGET: not an inbound link inside it, and — the edge case that bites during a reorg, when
// a run moves many files INTO archive in one pass — not its OWN outbound links either, so a
// doc landing in archive comes out byte-identical to what it carried in (a pure git rename,
// R100). This does NOT stop other files' links TO an archived path from being rewritten
// (rewriteLinks' exact-path and relative-link passes below still walk every other file) —
// only archive-resident files are exempt from being edited themselves.
//
// "Resident under archive/" alone is a moment-in-time test, and apply-reorg moves its plan's
// rows ONE AT A TIME — MEASURED in the wild: row A (bucket product) moves first and its
// sweep edits row B's CURRENT (pre-move) content, because B (bucket archive) is still sitting
// at its OLD path at that instant and so reads as NOT resident yet. B then moves into archive
// one iteration later, carrying A's edit in with it — frozen-on-arrival in name only. The fix
// is to test where a file WILL BE by the end of THIS run, not only where it is right now:
// plannedArchiveSrc holds the pre-move path of every row apply-reorg's plan already commits
// to bucket:'archive', set once before its move loop starts (below). `archive` (the
// standalone, single-file path) has no plan — it doesn't need one, since the one file it
// moves is already covered by the resident check the instant its own git mv lands, before
// rewriteLinks ever runs for it.
let plannedArchiveSrc = new Set();
// One predicate, called from the one place rewriteLinks() loops over candidate files, so the
// exemption can never desync across callers the way moveDoc's follow-ups almost did.
function isRewriteExempt(f) {
  return LINK_SKIP.test(f) || f.startsWith(REORG_DEST.archive + '/') || plannedArchiveSrc.has(f);
}

// A real corpus (astral-sh/uv) cross-links its docs with RELATIVE paths — `../concepts/x.md`,
// `./tools.md`, `guides/install.md` — never the repo-rooted form the exact-path match above
// looks for. A move that only fixes repo-rooted links leaves every one of those dead. Scope
// is deliberately narrow: only inside actual markdown link syntax (`](target)` or a
// reference-style `]: target` definition), never bare prose — "tools.md" on its own is too
// ambiguous to touch safely. FENCE-AWARE (via rewriteRelativeLinks -> replaceOutsideFences,
// same mask as everywhere else in the file): a fenced code sample showing this exact syntax,
// e.g. `](cleanAction.args)` inside a JS snippet, is source CODE, not a markdown link — this
// used to rewrite it into a broken link target anyway (MEASURED, real: it happened inside a
// real doc's ASCII-diagram code fence). The exact-path matcher just below shares the same
// fence-aware treatment now, for the same reason — see its own comment.
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
  let out = replaceOutsideFences(text, INLINE_LINK_RE, (full, target) => {
    if (!isRelativeTarget(target)) return full;
    const [pathPart, frag] = splitFragment(target);
    if (!pathPart) return full;
    const rewritten = build(pathPart, frag);
    return rewritten == null ? full : `](${rewritten})`;
  });
  out = replaceOutsideFences(out, REF_LINK_RE, (full, prefix, target) => {
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
  //
  // Scope decision (same hazard class as INLINE_LINK_RE above, resolved the same way): this
  // is an EXACT repo-rooted path, not an inferred one, so rewriting a real path fragment
  // shown inside a fenced code sample is still often desirable (e.g. a doc's own worked
  // example literally naming `docs/A.md`). But a path fragment inside code — `require('docs/
  // A.md')`, a CLI invocation, a JSON snippet — is exactly the same hazard the relative-link
  // fix above exists to prevent: unlike a markdown link target, this regex isn't scoped to
  // link syntax at all, so it is the MORE exposed of the two, not the less. Consistency wins:
  // both passes now share the one fence-aware mechanism (replaceOutsideFences), so a fence
  // means the same thing everywhere in this file — code inside it is never a rewrite target.
  const re = new RegExp(`(?<![\\w./-])${esc}(?![\\w-]|\\.[A-Za-z0-9])`, 'g');
  // Returns what it did; prints nothing. `archive` and `apply-reorg` format their output
  // differently, and a helper that prints straight to stdout cannot be reused by both.
  const result = { total: 0, files: [], skipped: null };
  // `archive` is documented as usable STANDALONE, and doArchive already falls back to
  // copy+unlink outside a git repo — so "there is no git repo here" means there are no
  // tracked files to rewrite, which is a SKIP, not a failed follow-up. Reporting it as a
  // failure made a fully successful `archive` exit 2 and tell the user to hand-fix something
  // that had never broken. A REAL git failure inside a real repo still throws.
  let candidates;
  try {
    // TRACKED PLUS UNTRACKED-BUT-NOT-IGNORED. FIELD BUG (real, reproduced): this listed
    // tracked files only, so every page a split had just written — brand new, never added —
    // was invisible to the rewriter. Relocating the core page out of PAGES then left its
    // sibling pages pointing at a path that no longer existed. A doc on disk with a broken
    // link is broken whether or not git happens to know about it yet. `--exclude-standard`
    // keeps .gitignore'd paths (build output, vendored trees) out, same as before.
    const tracked = gitOrThrow(['ls-files'], 'listing tracked files');
    const untracked = gitOrThrow(['ls-files', '--others', '--exclude-standard'],
      'listing untracked files');
    candidates = [...new Set((tracked + '\n' + untracked).split('\n'))];
  } catch (e) {
    if (!/not a git repository/i.test(e.message)) throw e;
    result.skipped = 'inbound links: not a git repository — nothing tracked to rewrite';
    return result;
  }
  for (const f of candidates) {
    if (!f || !LINK_EXTS.has(path.extname(f))) continue;
    if (isRewriteExempt(f) || f.startsWith('docs/.docs-builder/')) continue;
    let text;
    try { text = fs.readFileSync(repoPath(f), 'utf8'); } catch { continue; }
    let n = 0;
    let out = replaceOutsideFences(text, re, () => (n++, newPath), { spans: false });
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

// Crash-isolated closing advisory, same spirit as the config-file injection in apply-reorg
// below: a failure here must never make a moved file look unmoved. moveDoc's `git mv`
// STAGES the rename immediately (that's what preserves history) but nothing else in this
// tool's output ever said so — confirmed TWICE in the wild, in two different repos, where
// another session's `git add -A` / `git commit -a` silently absorbed the staged renames
// into an unrelated commit. The link rewrites moveDoc also makes are UNSTAGED and touch
// files outside docs/ too, so the two must land in ONE commit — never `-- docs` alone,
// which would commit moved files without their repaired inbound links (a broken tree).
//
// FIXED 2026-08-24: this used to recommend `git add -u && git commit`. `git add -u` stages
// EVERY tracked modification in the tree, not just this run's — the exact absorption hazard
// this whole advisory exists to warn about, printed as the recipe. MEASURED, real: an
// operator read it, recognised the hazard, refused the recipe and staged by explicit path
// instead. The recipe now names only what THIS run actually touched: the moved path(s)
// (`movedPaths` — git mv usually stages these already, but the copy+unlink fallback used
// outside a git repo does not, so they're listed explicitly rather than assumed) plus every
// file whose inbound links were rewritten (`linkFiles`). Skipped entirely when nothing moved:
// no noise on a no-op re-run.
// FIELD BUG (real, reproduced): this used to PRINT immediately, from wherever it was called
// — so one `cleanup-apply` emitted several separate recipes (archive's, then the core-page
// relocation's), each naming only its own step. An operator running the last one printed
// staged the core page and silently dropped the archive move. It now ACCUMULATES across the
// whole run and prints exactly once, from the dispatcher.
//
// FIELD BUG (real, reproduced): the recipe also named files at their PRE-move path — a file
// whose inbound links were rewritten and which then moved itself was listed at a path that no
// longer exists. `git add` is atomic: one stale pathspec makes the whole command exit 128 and
// stage NOTHING, so following the printed recipe committed nothing at all. flush() drops
// anything not on disk (it moved; its destination is already in `moved`).
const RUN = { moved: [], links: [], generated: [] };
const noteMoved = (...paths) => RUN.moved.push(...paths);
const noteLinks = files => RUN.links.push(...files);
// Files this run CREATED or REWROTE that no move produced — the rebuilt index, the config
// file's pointer block, the pages a split wrote. Omitting them meant following the recipe
// committed a reorg with no index and no pointer.
const noteGenerated = (...paths) => RUN.generated.push(...paths);

function flushCommitAdvisory() {
  if (!RUN.moved.length) return;
  try {
    const onDisk = f => { try { return fs.existsSync(repoPath(f)); } catch { return false; } };
    const moveSet = Array.from(new Set(RUN.moved)).filter(onDisk);
    const linkSet = Array.from(new Set(RUN.links)).filter(onDisk);
    const genSet = Array.from(new Set(RUN.generated)).filter(onDisk);
    const allFiles = Array.from(new Set([...moveSet, ...linkSet, ...genSet]));
    // The failure mode this must break: an operator reads `git status`, sees only the
    // STAGED block (the smaller, docs-shaped half), and scopes their commit to `docs/` —
    // silently dropping every link repair outside it. A bare count doesn't fight that
    // ("35 link rewrites" still reads as "docs stuff"); naming the actual non-docs
    // locations does. Derived from moveDoc's own linkFiles paths — no hardcoded dir names.
    // Count FILES outside docs/, but list the distinct top-level LOCATIONS. Reporting the
    // location count instead understates the trap: 19 files across 6 dirs printed as "6"
    // reads as a rounding error rather than most of the change set.
    const outsideFiles = linkSet.filter(f => f.split('/')[0] !== 'docs');
    const outsideDocs = Array.from(new Set(outsideFiles.map(f => f.split('/')[0]))).sort();
    console.log(`\n${moveSet.length} rename(s) this run (git mv stages these automatically; `
      + 'the copy+unlink fallback used outside a git repo does not)');
    console.log(linkSet.length
      ? `${linkSet.length} link rewrite(s) UNSTAGED` + (outsideFiles.length
        ? `, ${outsideFiles.length} outside docs/: ${outsideDocs.join(', ')}`
        : ' (all inside docs/)')
      : 'no inbound-link rewrites this run.');
    console.log('A blanket `git add -A` / `git add -u` / `git commit -a` would ALSO absorb any');
    console.log('unrelated in-flight work in the tree — this tool never suggests one (it does');
    console.log('NOT auto-commit either: you may want these moves bundled with other work).');
    console.log('Stage exactly what this run touched (renames + link rewrites), then commit:');
    const quote = f => `'${f.replace(/'/g, `'\\''`)}'`;
    const SHOWN = 20;
    if (allFiles.length <= SHOWN) {
      console.log(`  git add -- ${allFiles.map(quote).join(' ')}`);
    } else {
      const listRel = path.join(ARTIFACTS, 'commit-files.txt');
      fs.mkdirSync(path.dirname(repoPath(listRel)), { recursive: true });
      fs.writeFileSync(repoPath(listRel), allFiles.join('\n') + '\n');
      console.log(`  ${allFiles.length} files touched — full list written to ${listRel}`);
      console.log(`  git add -- ${allFiles.slice(0, SHOWN).map(quote).join(' ')}  # + `
        + `${allFiles.length - SHOWN} more, see ${listRel}`);
      console.log(`  cat ${listRel} | xargs git add --`);
    }
    console.log('  git commit -m "docs: reorg"');
  } catch (e) {
    console.error(`  WARN could not print the commit advisory: ${e.message}`);
  }
}

// Core THROWS on a follow-up failure, never exits (same split as doArchive()/archive() and
// gitOrThrow()/git()). cleanupApply() calls this IN-PROCESS and still has work to do after it
// — relocating the core page and rebuilding docs/index.md — so it must be able to catch the
// failure and say what its own run is skipping. A bare process.exit(2) in here killed that
// run mid-flight and printed only archive's message, naming neither of the two skipped steps.
function archiveOrThrow(src, dest) {
  // A throw and a `failures` entry mean different things and must be reported differently:
  // a throw means NOTHING moved and retrying is correct; a failure means the file DID move
  // and telling the user to re-run `archive` would be actively wrong. MEASURED: a malformed
  // outline.json used to crash here with a bare stack trace naming neither the artifact nor
  // the fact that the file had already moved.
  // Move failure propagates as a plain throw (no `followUpFailed`): NOTHING moved, retrying
  // is correct. archive() below turns it back into die()'s clean exit-1 message for the CLI.
  const r = moveDoc(src, dest);
  console.log(`archived ${src} -> ${r.rel}  ${r.size} bytes  sha256 ${r.sha.slice(0, 16)} MATCH  (${r.how})`);
  for (const m of r.artifactNotes) console.log(`  ${m}`);
  for (const { file, n } of r.linkFiles) console.log(`  ${file}: ${n} link(s) -> ${r.rel}`);
  // Logged BEFORE the exit-2 branch below: the move itself SUCCEEDED in both branches, and
  // docs/log.md is the record of what moved. Logging only on the clean path left the one case
  // a human most needs to find later — a move whose follow-up failed — absent from the log.
  logOp('archive', `${src} -> ${r.rel}`
    + (r.links ? `, ${r.links} link(s) rewritten` : '')
    + (r.failures.length ? `, FOLLOW-UP FAILED: ${r.failures.join('; ')}` : ''));
  noteMoved(r.rel); noteLinks(r.linkFiles.map(x => x.file));
  if (r.failures.length) {
    const e = new Error(`the move above SUCCEEDED — ${src} is now at ${r.rel}. But ${r.failures.join('; ')}\n`
      + `Fix that, then re-run \`scan\` (and redo labels) — do NOT re-run \`archive\` for `
      + `${src}, it has already moved.`);
    e.followUpFailed = true; // the move LANDED; only a follow-up failed. See archive() below.
    throw e;
  }
}

function archive(src, dest) {
  if (!src) die('usage: docs-builder.cjs archive <src.md> [dest.md]');
  try { archiveOrThrow(src, dest); }
  catch (e) {
    if (!e.followUpFailed) die(e.message); // nothing moved — exit 1, retry `archive`
    // Exit 2, not 1: 1 means "nothing moved, retry `archive`" and this is the OPPOSITE —
    // the file DID move and re-running `archive` would be wrong, exactly as the message says.
    // A caller branching on exit code alone must be able to tell these two outcomes apart.
    console.error(e.message);
    flushCommitAdvisory();
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
    ? `${n} docs changed since ${L.sha.slice(0, 8)} (threshold ${DUE_THRESHOLD}) — REORG IS DUE.`
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
// around) SHOUTS a genuine status declaration — "Status: CLOSED", "(ARCHIVAL 2026-07-25,
// before any number)" — while narrative mentions of the same word stay lowercase or Title
// Case. FROZEN was in this list once and got dropped 2026-08-23: on bareloop's real corpus
// (37 files) it caused ~10 of 12 archive calls to be false positives — in that corpus's own
// convention FROZEN means "locked, do not edit, still current" (a live spec or
// pre-registration), not "retired". That's the one failure this design promised never to
// make, so the word is gone with no replacement heuristic — precision over recall.
const ARCHIVAL_STATUS_RE = /\b(CLOSED|ARCHIVAL|ARCHIVED|SUPERSEDED|WITHDRAWN|RETRACTED|REFUTED|DEPRECATED)\b/;

// v3 reorg (docs-builder-v3-spec.md, "four buckets"): a fourth mechanical prior, `logs`.
// Measured on bareloop's real product/ (27 files): 11 were experiment records (8 *-PREREG,
// 2 *-LEARNINGS, others) sitting alongside 14 actual specs/designs — 41% of the bucket was
// run history, not product. Same discipline as ARCHIVE_FILENAME_RE: case-sensitive, so a
// SHOUTED token in the filename is a real author signal and lowercase prose elsewhere is
// not. Unanchored (word-boundary, not prefix) — real filenames carry the token as a suffix
// (`REUSE-PREPROBE-PREREG.md`), not always a prefix.
const LOGS_FILENAME_RE = /\b(PREREG|LEARNINGS|REPORT|RESULTS|POSTMORTEM|RETRO)\b/;

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

// v3 reorg (docs-builder-v3-spec.md, "four buckets, and the model does the sorting"): this
// no longer JUDGES — it ENRICHES and PROPOSES. `bucket` is gone from this function's output;
// callers get `suggested`+`reason` (a prior the interview shows the model, never an
// authority) plus `h1`/`snip` (reusing headings()/snippet()/fenceMask(), the same shared
// parsers scan() already uses — no second extraction path) and `oversized` as a plain
// boolean. Size used to BE a bucket (`oversized`), which left a file in a third state the
// layout had no home for — LAYERS.md (958 lines) sat unsorted in 01-product/ for no reason
// but its size. Oversized is now orthogonal to sorting: a product doc that's too big is
// still a product doc.
function classifyDoc(rel, text) {
  const lines = text.split('\n');
  const mask = fenceMask(lines);
  const { h1 } = headings(lines, mask);
  const snip = snippet(lines, mask, 0, lines.length, 200);
  const opening = lines.slice(0, 20).join(' ').slice(0, 2000);
  const ceiling = +process.env.OVERSIZED_LINES || DEFAULT_OVERSIZED_LINES;
  const oversized = lines.length > ceiling;
  const row = (suggested, reason) =>
    ({ file: rel, h1, snip, lines: lines.length, oversized, suggested, reason });

  if (ARCHIVE_PATH_RE.test(rel))
    return row('archive', 'path already under archive/old/reports/phases');
  if (ARCHIVAL_STATUS_RE.test(opening))
    return row('archive', 'doc declares its own status in the opening (e.g. CLOSED, ARCHIVED, deprecated)');
  if (ARCHIVE_FILENAME_RE.test(path.basename(rel)))
    return row('archive', 'filename matches an archive-shaped pattern (weak signal, no content confirmation)');
  if (LOGS_FILENAME_RE.test(path.basename(rel)))
    return row('logs', 'filename matches an experiment-record pattern (PREREG/LEARNINGS/REPORT/RESULTS/POSTMORTEM/RETRO) — weak signal, no content confirmation');
  if (!h1) {
    if (isIncludeStub(lines))
      return row('product', 'include stub');
    // v3: `review` is gone as a bucket. A no-H1 file with no strong signal is not special —
    // it's just a row with an empty h1 the interview classifies like any other, same as
    // every row. The old special-casing defaulted this straight to archive in apply-reorg;
    // that default is gone with it — nothing moves until the interview says so.
    return row('product', 'no H1 — no strong signal, model decides');
  }
  return row('product', 'structured (has an H1), no archive/logs signal');
}

function walkMd(dir, base, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, name.name), rel = path.join(base, name.name);
    if (name.isDirectory()) {
      // Idempotent: never reclassify what discover/apply already placed. Any dot-dir is
      // machine/tool state (.git, .github, .claude, .factory, .opencode, .amp, .docs-builder)
      // and node_modules is vendored — moving a .md out of those is never wanted.
      if (name.name.startsWith('.') || name.name === 'node_modules') continue;
      if (['wiki', 'archive', 'product', 'logs'].includes(name.name)) continue;
      walkMd(abs, rel, out);
    } else if (name.isFile() && name.name.endsWith('.md')) {
      // Entry-point/contract docs are never subject to reorg, wherever they sit.
      if (PROTECTED_NAMES.has(name.name)) continue;
      out.push(rel);
    }
  }
}

// v3: `discover` no longer classifies — it enriches and PROPOSES, then stops. Each row gets
// `suggested`+`reason` (classifyDoc's mechanical prior) and an empty `bucket` for the
// classification interview (docs-builder.md) to fill: feed the model this whole plan table
// in one call, get a bucket+reason per row, show the user the result via AskUserQuestion,
// only then run `apply-reorg`. Nothing here moves a file — same guarantee as before, now
// enforced by apply-reorg refusing an empty bucket rather than by this function's caution.
//
// Re-running discover MUST NOT re-litigate a decision the interview already made — `reorg`
// (the composed front door) calls discover() every time it runs, and its own contract is
// "STOP if any bucket is empty, else apply". If discover blanked `bucket` on every call,
// that second half could never be reached: the interview fills the plan, then the very next
// `reorg` invocation would discover() its way right back to all-empty. So an existing plan's
// already-classified rows carry their `bucket` forward for any file discover still sees —
// discover's job is keeping the plan CURRENT (fresh suggested/h1/snip/lines), not re-asking a
// question that's already been answered. Only a file discover has never classified before
// (new, or reappeared after a manual revert) starts unclassified, same as day one. Carry-forward
// only accepts a currently-VALID bucket — a legacy pre-v3 value (e.g. 'oversized', 'review')
// is dropped, not carried, so it starts unclassified instead of failing apply-reorg's schema check.
function discover(root) {
  const rootRel = root || 'docs';
  const rootAbs = path.join(REPO, rootRel);
  if (!fs.existsSync(rootAbs)) die(`no such directory: ${rootRel}`);
  const files = [];
  walkMd(rootAbs, rootRel, files);
  const planFile = path.join(ARTIFACTS, 'reorg-plan.json');
  const prevBuckets = new Map();
  if (fs.existsSync(planFile)) {
    try {
      const prev = parseJSONFileOrThrow(planFile);
      for (const row of (prev.rows || [])) if (VALID_BUCKETS.has(row.bucket)) prevBuckets.set(row.file, row.bucket);
    } catch (e) {
      console.error(`WARN: could not read the existing plan to preserve prior classifications `
        + `(${e.message}) — every row starts unclassified this run.`);
    }
  }
  const rows = files.map(rel =>
    ({ ...classifyDoc(rel, read(rel)), bucket: prevBuckets.get(rel) || '' }));
  const bySuggested = { product: 0, logs: 0, archive: 0 };
  for (const r of rows) bySuggested[r.suggested]++;
  const oversizedCount = rows.filter(r => r.oversized).length;
  write({ generated: new Date().toISOString(), root: rootRel, rows }, 'reorg-plan.json');
  // `bucket` is shown because it is the one column that says whether the interview has
  // happened. FIELD BUG (privcloud): without it, an operator who had just written buckets into
  // the plan had no confirmation from the table that their writes landed, and went back to
  // re-read the JSON by hand.
  console.table(rows.map(r => ({ file: r.file, h1: r.h1, suggested: r.suggested,
    bucket: r.bucket || '—', oversized: r.oversized, lines: r.lines })));
  console.log(JSON.stringify({ ...bySuggested, oversized: oversizedCount }, null, 1));
  // FIELD BUG (privcloud, real first run): this used to assert "`bucket` is empty"
  // unconditionally — including on a re-run where the buckets were filled and `apply-reorg`
  // then ran fine seconds later. Output that contradicts the state it just wrote is worse
  // than no output: it sent the operator back to read the JSON by hand to check their own
  // writes had persisted. Carry-forward (above) is exactly why a re-run can arrive here with
  // buckets already set, so this has to report what is actually in the plan.
  const filled = rows.filter(r => r.bucket).length;
  if (!rows.length) {
    console.log(`plan written to docs/.docs-builder/reorg-plan.json — 0 rows. Nothing outside `
      + 'product/, logs/ and archive/ is left to classify — the corpus is already sorted. '
      + '`apply-reorg` will only rescan and rebuild the index.');
  } else if (!filled) {
    console.log(`plan written to docs/.docs-builder/reorg-plan.json — every row's \`suggested\` `
      + 'is a PRIOR, not a verdict, and `bucket` is empty. Run the classification interview '
      + '(docs-builder.md): feed the model the plan, get bucket+reason per row, get the user\'s '
      + 'approval, then run `apply-reorg` — it refuses to run while any `bucket` is empty.');
  } else if (filled === rows.length) {
    console.log(`plan written to docs/.docs-builder/reorg-plan.json — all ${rows.length} row(s) `
      + 'already carry a `bucket`, carried forward from an earlier interview. Nothing further is '
      + 'needed before `apply-reorg`; edit the plan first only if you want to reclassify.');
  } else {
    console.log(`plan written to docs/.docs-builder/reorg-plan.json — ${filled} of ${rows.length} `
      + 'row(s) already carry a `bucket` (carried forward); the rest are still unclassified and '
      + '`apply-reorg` refuses to run while any is empty. Run the classification interview '
      + '(docs-builder.md) for the remainder, then re-run.');
  }
  if (oversizedCount)
    console.log(`\n${oversizedCount} file(s) are oversized — they still get sorted into a `
      + 'bucket like everything else; splitting stays separate and opt-in (`cleanup <file>` '
      + 'after they\'ve moved).');
}

// MEASURED, real (bareloop, 37 docs): outline.json — the database `search` reads — held
// records for only 12 files, because `scan` had only ever run over whatever a caller happened
// to hand it (the files bound for a split). All 24 docs/product/ files had ZERO records, so
// `search` was structurally blind to every one of them — not a ranking problem, a coverage
// problem: a file with no records at all cannot rank.
//
// Fix, round 1: `apply-reorg` runs `scan` itself, once, over the WHOLE corpus, right after the
// move — not before (moving changes paths, not content, so a pre-move scan would just be
// redone) and not partially (scanning only the split-bound files IS the bug). Round 1 walked
// only docs/product/ and docs/archive/ (the dirs apply-reorg moves files INTO) and that was
// still incomplete: apply-reorg deliberately leaves `oversized` docs exactly where discover
// found them — splitting spends model budget and must never fire unprompted — so on bareloop's
// real corpus the 12 biggest, most-cited docs (PRD.md, FINDINGS.md, LAYERS.md, all oversized,
// all left in place under their original subdirs) still had zero outline records. "12 of 37
// searchable" narrowed to "24 of 37 searchable" — same bug, smaller miss.
//
// Fix, round 2: reuse discover's own walk. walkMd(docsRoot, 'docs', files) covers every file
// discover would have classified, WHEREVER it now lives — including an oversized doc still
// sitting at its pre-move path — because walkMd's per-child skip only fires on a directory
// literally named 'wiki'/'archive'/'product', so this call never descends into docs/product/
// or docs/archive/ (no duplicates) while still reaching every other subdir (the in-place
// oversized files). The two explicit calls below then add back exactly what that root walk
// skipped: the contents of docs/product/ and docs/archive/ themselves. Together the three
// calls are a complete, non-overlapping partition of "every doc discover would classify, at
// its final location" — not a fourth, independent enumeration.
// Shared by `scan` (via scanWholeCorpus) and `index-flat`: the one partition of "every doc
// discover would classify, at its final location" — product/, archive/, and anything left
// in place elsewhere (e.g. an oversized doc apply-reorg deliberately didn't move). Do not
// add a second, independent enumeration of the corpus — this is the one.
// v3: `logs/` joins `product/` and `archive/` as a fourth explicit call, same reasoning —
// walkMd's root walk skips it by literal name, so this adds back exactly what that skip left out.
function wholeCorpusFiles() {
  const files = [];
  const docsRoot = path.join(REPO, 'docs');
  if (fs.existsSync(docsRoot)) walkMd(docsRoot, 'docs', files);
  const productDir = path.join(REPO, 'docs/product');
  const archiveDir = path.join(REPO, 'docs/archive');
  const logsDir = path.join(REPO, 'docs/logs');
  if (fs.existsSync(productDir)) walkMd(productDir, 'docs/product', files);
  if (fs.existsSync(archiveDir)) walkMd(archiveDir, 'docs/archive', files);
  if (fs.existsSync(logsDir)) walkMd(logsDir, 'docs/logs', files);
  // Defensive, same exclusion reconcile() already applies: a non-default PAGES dir nested
  // under product/ or archive/ (not caught by walkMd's bare 'wiki' name check) still must not
  // round-trip generated pages back into the outline.
  const pagesPrefix = (process.env.PAGES || 'docs/wiki').replace(/\/*$/, '/');
  return files.filter(f => !f.startsWith(pagesPrefix)).sort();
}

function scanWholeCorpus() {
  const corpus = wholeCorpusFiles();
  if (!corpus.length) {
    console.log('\nscan: the docs/ corpus is empty — nothing to scan.');
    return 0;
  }
  console.log(`\n== scan (whole corpus: ${corpus.length} file(s)) ==`);
  scan(corpus);
  return corpus.length;
}

const REORG_DEST = { product: 'docs/product', logs: 'docs/logs', archive: 'docs/archive' };
const VALID_BUCKETS = new Set(Object.keys(REORG_DEST));
// bucket values a PRE-v3 reorg-plan.json could hold — neither exists any more ('oversized'
// was a bucket, now a boolean; 'review' is gone outright, see classifyDoc). Distinguishing
// this from "the interview just hasn't run yet" (bucket === '') earns a different message:
// re-running discover fixes a stale plan; filling `bucket` fixes a fresh one.
const STALE_BUCKETS = new Set(['oversized', 'review']);

// Depth-first empty-dir sweep, scoped to directories a file actually moved OUT of this run.
// `dirs` are absolute paths; `rootAbs` is never itself a candidate (walking stops there) so
// the reorg root (docs/ by default) can never be removed even if every file under it moved.
// Sorting by path-segment count (not string length) before removing is what makes "nested
// empties collapse" correct: a child directory is always tested — and, if empty, removed —
// before its parent gets its turn, so a parent that only became empty because its last child
// dir was just removed still gets caught in the same pass.
function collectEmptyDirs(rootAbs, dirs) {
  const candidates = new Set();
  for (const d of dirs) {
    let cur = d;
    while (cur.startsWith(rootAbs + path.sep)) { candidates.add(cur); cur = path.dirname(cur); }
  }
  const ordered = [...candidates].sort((a, b) =>
    b.split(path.sep).length - a.split(path.sep).length);
  const removed = [];
  for (const dir of ordered) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      removed.push(dir);
    }
  }
  return removed;
}

// Same job `/remember` step 5 does for MEMORY.md, applied to the docs map: a marker-wrapped
// pointer block in the repo's agent config file so a session finds docs/index.md without
// being told. A PLAIN backticked path, never an `@`-reference — `@docs/index.md` would
// hot-load the whole index into every session, which is exactly what index-flat's own search
// hint above exists to avoid. The block is static (never varies with row count), so a re-run
// rewrites it to identical bytes. THROWS on failure — same throwing-core convention as
// moveDoc() — so the caller (applyReorg) decides how to report it; this never exits the
// process itself.
//
// The target FILENAME differs per tool even though this script is byte-identical across all
// 4 packages: claude -> CLAUDE.md, droid -> AGENTS.md, ampcode -> AGENT.md, opencode ->
// AGENTS.md. Same escape hatch as REPO/OUT/PAGES/INDEX/N elsewhere in this file — an env var,
// so the packaged command docs can pass their own tool's filename without a code fork.
// Default stays CLAUDE.md so the claude package needs no env var set at all.
const DOCS_INDEX_START = '<!-- DOCS_INDEX:START -->';
const DOCS_INDEX_END = '<!-- DOCS_INDEX:END -->';
function docsIndexBlock() {
  return `${DOCS_INDEX_START}\n`
    + 'Docs map: `docs/index.md` — every doc in this project, with line counts.\n'
    + 'Too many rows to read whole? Search instead: `/docs-builder search <query words>`\n'
    + `${DOCS_INDEX_END}`;
}
function injectClaudeMdPointer() {
  const rel = process.env.CONFIG || 'CLAUDE.md';
  const f = repoPath(rel);
  const block = docsIndexBlock();
  noteGenerated(rel);
  const startRe = new RegExp(`${DOCS_INDEX_START}[\\s\\S]*?${DOCS_INDEX_END}`);
  if (!fs.existsSync(f)) { fs.writeFileSync(f, block + '\n'); return; }
  const cur = fs.readFileSync(f, 'utf8');
  if (startRe.test(cur)) fs.writeFileSync(f, cur.replace(startRe, block));
  else fs.writeFileSync(f, cur.replace(/\n*$/, '\n\n') + block + '\n');
}

// v3 reorg (docs-builder-v3-spec.md, "four buckets"): the interview, not this function, does
// the classifying — this only executes an ALREADY-approved plan. It refuses outright if any
// row's `bucket` isn't one of the three real buckets: an empty bucket means the interview
// hasn't happened, and a stale 'oversized'/'review' bucket means the plan predates this
// version's schema. Oversized rows are no longer skipped — they move like everything else
// (size decides splittable, not sorted) and come back as split candidates at their NEW path.
function applyReorg(planFile) {
  const f = planFile || path.join(ARTIFACTS, 'reorg-plan.json');
  if (!fs.existsSync(f)) die(`no plan at ${planFile || 'docs/.docs-builder/reorg-plan.json'} — run \`discover\` first`);
  const plan = parseJSONFile(f);
  const unclassified = plan.rows.filter(r => !VALID_BUCKETS.has(r.bucket));
  if (unclassified.length) {
    const stale = plan.rows.some(r => STALE_BUCKETS.has(r.bucket));
    die(`refusing to apply: the classification interview has not happened `
      + `(${unclassified.length} of ${plan.rows.length} row(s) have no valid \`bucket\`).`
      + (stale
        ? ` This plan predates v3's four-bucket schema ('oversized'/'review' no longer `
          + 'exist as buckets) — re-run `discover` to regenerate it, then classify.'
        : ' Run the classification interview (docs-builder.md): fill every row\'s `bucket` '
          + '(product/logs/archive), get the user\'s approval, then re-run.'));
  }
  const results = { moved: 0, skipped: 0, artifactsSynced: 0, linksRewritten: 0,
                    syncFailed: 0, dirsRemoved: 0, claudeMdUpdated: false };
  // Set once, up front, from the SAME plan the loop below reads row.file from — every row
  // this run already commits to bucket:'archive' is exempt from every rewrite the run makes,
  // from the very first move, not only once it has actually landed there. See
  // plannedArchiveSrc's definition next to isRewriteExempt for the ordering bug this closes.
  plannedArchiveSrc = new Set(plan.rows.filter(r => r.bucket === 'archive').map(r => r.file));
  const usedNames = new Map(); // collision guard, same defensive pattern as theme slugs
  const splitCandidates = []; // oversized rows, at their NEW path — ordered logs-last below
  const sourceDirs = [];
  const linkFilesTouched = []; // dedup'd by flushCommitAdvisory() at the end of the run
  const movedDestPaths = []; // every successful move's NEW path, same accumulator
  for (const row of plan.rows) {
    const destDir = REORG_DEST[row.bucket];
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
    movedDestPaths.push(r.rel);
    results.artifactsSynced += r.artifacts;
    results.linksRewritten += r.links;
    sourceDirs.push(path.dirname(path.join(REPO, row.file)));
    if (row.oversized) splitCandidates.push({ file: r.rel, bucket: row.bucket, lines: row.lines });
    for (const { file, n } of r.linkFiles) { console.log(`    ${file}: ${n} link(s) -> ${r.rel}`); linkFilesTouched.push(file); }
    for (const f of r.failures) {
      console.error(`  WARN ${row.file} MOVED, but ${f}`);
      results.syncFailed++;
    }
  }
  // Only directories the moves THIS RUN emptied are candidates — never a dir this run never
  // touched, even if it happens to be empty already (that's not ours to remove).
  const rootAbs = path.join(REPO, plan.root || 'docs');
  const removedDirs = sourceDirs.length ? collectEmptyDirs(rootAbs, sourceDirs) : [];
  results.dirsRemoved = removedDirs.length;
  for (const dir of removedDirs)
    console.log(`  removed empty dir: ${path.relative(REPO, dir).split(path.sep).join('/')}`);
  // Runs regardless of whether anything moved THIS run — apply-reorg is also the thing that
  // (re)builds outline.json for a corpus that already sat in docs/product/docs/archive/docs/logs
  // from a previous run, e.g. after a manual git mv or a re-run with nothing left to do.
  scanWholeCorpus();
  if (splitCandidates.length) {
    // Ranked, logs last (spec §5): a prereg is a legitimate split target but rarely the best
    // NEXT one. Array.prototype.sort is stable in Node, so this only reorders logs to the
    // tail — it does not reshuffle the rest of the list.
    splitCandidates.sort((a, b) => (a.bucket === 'logs') - (b.bucket === 'logs'));
    console.log(`\n${splitCandidates.length} oversized doc(s) — never auto-split (that spends `
      + 'model budget); run `cleanup <file>` on each, by hand, one at a time:');
    for (const r of splitCandidates) console.log(`  cleanup ${r.file}  (${r.lines} lines)`);
  }
  // v3: apply-reorg writes docs/index.md itself — a reorg-only corpus ends up indexed
  // without a second command. Runs unconditionally — oversized docs are sorted like anything
  // else now, so this was never conditional on them.
  const indexed = indexFlat() !== false;
  const configName = process.env.CONFIG || 'CLAUDE.md';
  if (!indexed) {
    console.log(`  skipped the ${configName} pointer — no docs/index.md was written`);
  } else {
    // Crash-isolated, same spirit as the moveDoc() follow-up failures collected above: a
    // failure to write the config file is a WARN, never a thrown error — it must not make an
    // already-moved file look unmoved or fail the run.
    try {
      injectClaudeMdPointer();
      results.claudeMdUpdated = true;
      console.log(`  updated ${configName} with the docs/index.md pointer`);
    } catch (e) {
      console.error(`  WARN could not update ${configName} with the docs/index.md pointer: ${e.message}`);
    }
  }
  console.log(JSON.stringify(results, null, 1));
  logOp('apply-reorg', `moved ${results.moved}, skipped ${results.skipped}, `
    + `${splitCandidates.length} oversized split candidate(s), `
    + `${results.linksRewritten} link(s) rewritten, ${results.syncFailed} sync failure(s), `
    + `${results.dirsRemoved} empty dir(s) removed, ${configName} updated: ${results.claudeMdUpdated}`);
  // Accumulated here; the dispatcher prints the run's ONE recipe last, after every step.
  noteMoved(...movedDestPaths); noteLinks(linkFilesTouched);
}

// ---------------------------------------------------------------- reorg (single front door)

// v3: `reorg` folds the old `reconcile` and `due` into one front door. "First run" (nothing
// under product/archive yet) and "since last time" (a ledger stamp already exists) are the
// same job with different starting state — two commands only made users guess which to run.
// `due` stays individually runnable, unchanged: `/remember` step 7 shells out to it directly
// and its output/exit code/threshold must not move. `reorg` calls that SAME due() in-process,
// only when a ledger stamp exists, so its drift summary is additive, never a rewrite of it.
//
// What reconcile did that has no home here, and why that's not a loss: reconcile's
// validate+index steps needed labels.json (a model-produced theme assignment), which only the
// split pipeline (`cleanup`) ever creates. `reorg` never splits (rule 1) and never calls a
// model by default, so it never has labels.json to validate against — that capability didn't
// move, it stayed exactly where it already lived: the standalone `validate`/`index` commands,
// unchanged, still runnable by hand once labels.json exists.
function reorg() {
  // discover/apply-reorg/lint/due each write a DIFFERENT artifact, and every one of them
  // honours the same `OUT` override — same trap reconcile's own OUT guard existed to catch.
  if (process.env.OUT) {
    console.error(`WARN: ignoring OUT=${process.env.OUT} — reorg writes several artifacts `
      + '(reorg-plan.json, outline.json, index.md, lint.json) and each goes to its own default path.');
    delete process.env.OUT;
  }
  // due() reads git HEAD and the CURRENT working tree — `apply-reorg`'s `git mv` runs
  // uncommitted, so calling due() AFTER apply-reorg would see this run's own in-flight moves
  // and misreport them as deletions (the moved file no longer exists at its pre-move path,
  // and due() has no way to tell "moved by this very run" from "actually gone"). due() runs
  // FIRST, against whatever the tree looked like coming in, so its drift summary reflects
  // real external changes since the stamp, not reorg's own not-yet-committed side effects.
  const ledgerF = path.join(REPO, process.env.OUT || LEDGER);
  const hadLedger = fs.existsSync(ledgerF);
  if (hadLedger) {
    console.log('== due (drift since the last ledger stamp) ==');
    due();
    console.log('');
  }
  console.log('== discover ==');
  discover();
  // v3: classification is the model's job, behind an approval gate (docs-builder-v3-spec.md
  // §4). `reorg` must not silently proceed past a plan the interview hasn't touched yet —
  // that would be the exact failure the gate exists to prevent, just moved one layer up.
  // applyReorg() would refuse anyway, but refusing HERE means `reorg` stops with instructions
  // instead of a die()'d stack-shaped error from a step the user didn't know was next.
  const planFile = path.join(ARTIFACTS, 'reorg-plan.json');
  const plan = parseJSONFile(planFile);
  const unclassified = plan.rows.filter(r => !VALID_BUCKETS.has(r.bucket));
  if (unclassified.length) {
    console.log(`\n${unclassified.length} of ${plan.rows.length} row(s) still need `
      + `classification — the interview hasn't happened yet. Run it (docs-builder.md): feed `
      + `the model ${planFile}, get bucket+reason `
      + 'per row, get the user\'s approval, write the approved buckets back into the plan, '
      + 'then re-run `reorg` (or `apply-reorg` directly).');
    logOp('reorg', `discover only — ${unclassified.length} of ${plan.rows.length} row(s) `
      + 'await the classification interview');
    return;
  }
  console.log('\n== apply-reorg ==');
  applyReorg();
  const corpus = wholeCorpusFiles();
  console.log('\n== lint ==');
  if (corpus.length) lint(corpus);
  else console.log('LOUD-SKIP: lint did not run — the corpus is empty');
  logOp('reorg', `discover+apply-reorg+lint over ${corpus.length} doc(s)`
    + (hadLedger ? ', due reported' : ', no ledger stamp yet'));
}

// ---------------------------------------------------------------- cleanup (Mode 1 entry point)

// Mechanical heading-shape grouper for the interview's proposal. NO semantics — the script
// must never guess what a document "is about"; it only measures. Rule: walk a heading's
// tokens left to right; the group KEY is every token up to and including the first one that
// contains a digit, with digit runs replaced by "#" (so "Addendum v1.01" and "Addendum
// v1.42" fall in the same group, and "§1 Scope"/"§2 Goals" both key to "§#"). A heading with
// no digit at all keys on its own full (unchanged) text — verbatim duplicates still group,
// anything else stays a singleton until the group-size cutoff below folds it into "other".
// Verified against bareloop's real docs/01-product/PRD.md: 75 `Addendum v1.NN — <date>`
// headings and 11 `§N ...` headings resolve to exactly two groups — see the bareloop run
// pasted in the PR description.
function shapeKey(text) {
  const tokens = clean(text).split(' ').filter(Boolean);
  const key = [];
  for (const tok of tokens) {
    key.push(tok.replace(/\d+/g, '#'));
    if (/\d/.test(tok)) break;
  }
  return key.join(' ') || '(untitled)';
}

// A "group" of 1 shares no pattern with anything else — it is folded into one "other" bucket
// instead of printed as its own row, so the report stays a SHAPE summary, not a heading dump.
const SHAPE_MIN_GROUP = 2;

function buildShape(file, records) {
  const totalLines = records.reduce((a, r) => a + r.lines, 0);
  const byKey = new Map();
  for (const r of records) {
    const k = shapeKey(r.h2);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const groups = [], other = [];
  for (const [k, recs] of byKey) {
    if (recs.length >= SHAPE_MIN_GROUP)
      groups.push({ key: k, sections: recs.length, lines: recs.reduce((a, r) => a + r.lines, 0) });
    else other.push(...recs);
  }
  if (other.length)
    groups.push({ key: 'other', sections: other.length, lines: other.reduce((a, r) => a + r.lines, 0) });
  groups.sort((a, b) => b.lines - a.lines);
  for (const g of groups) g.pct = totalLines ? Math.round(g.lines / totalLines * 1000) / 10 : 0;
  return { file, totalLines, totalSections: records.length, groups };
}

function printShape(shape) {
  console.log(`\n${shape.totalLines} lines. ${shape.totalSections} sections.`);
  for (const g of shape.groups) {
    const label = g.key === 'other' ? 'other' : g.key.replace(/#/g, 'N');
    console.log(`    ${label}`.padEnd(32) + `${g.sections} sections, ${g.lines} lines  (${g.pct}%)`);
  }
}

// `docs/.docs-builder/` is shared, not per-file: `cleanup`'s own `scan` OVERWRITES
// outline.json with only ITS file's records (scan() has always worked this way — see its own
// comment on batch-size-independent keys). MEASURED, real: running `cleanup` on a SECOND file
// while a FIRST split still sat between `plan` and `archive` clobbered outline.json out from
// under the first split (its labels.json now referenced keys the outline no longer had),
// leaving `docs/wiki-index.md` at 0 rows with no error at all — the real defect was that
// nothing failed; the artifacts were just silently wrong. Two ways to close this were
// weighed: (a) make `scan` MERGE instead of overwrite, or (b) refuse to start a second split
// while an earlier one is in flight. (a) was rejected: `validate` compares outline.json's
// FULL record set against labels.json 1:1 (`doValidate`'s `missing` check) — a merged,
// corpus-wide outline would make every OTHER file's sections show up as "missing" from a
// single-file split's labels.json, trading this bug for a new false-positive gate failure in
// a command this pipeline still ships standalone. (b) is chosen: safer, and the workflow it
// blocks (two splits genuinely in flight at once) was never the documented one anyway —
// cleanup-apply's own resumability already means "finish this split, then start the next".
function inFlightSplit(file) {
  const labelsF = path.join(ARTIFACTS, 'labels.json');
  const outlineF = path.join(ARTIFACTS, 'outline.json');
  if (!fs.existsSync(labelsF) || !fs.existsSync(outlineF)) return null;
  let l, o;
  try { l = parseJSONFileOrThrow(labelsF); o = parseJSONFileOrThrow(outlineF); }
  catch { return null; } // a malformed artifact is not this check's job to diagnose
  if (!coreThemeName(l.themes)) return null; // no core theme -> not a cleanup split at all
  const other = [...new Set((o.records || []).map(r => r.file))].find(f => f !== file);
  if (!other) return null;
  // Archived -> that split is DONE: `archive()` rewrites outline.json's records[].file to
  // the docs/archive/ path the instant the move lands (rewriteArchivedPath), so a finished
  // split's record permanently exists on disk at its archive path — checking existence alone
  // would misread a COMPLETED split as still in flight forever. Still at its pre-archive
  // location -> genuinely in flight (plan ran, archive hasn't). Gone entirely -> archived
  // (same as above) or a stale artifact; a leftover labels.json/outline.json is not a live
  // conflict — a second, unrelated cleanup is exactly the normal, supported next step.
  if (other.startsWith(REORG_DEST.archive + '/')) return null;
  return fs.existsSync(repoPath(other)) ? other : null;
}

// v3 rule 1: `reorg` never splits. `cleanup` is the ONLY door into the split pipeline, and it
// is now a MEASURE step only: cost estimate, scan, a mechanical heading-shape report — then
// it STOPS. Settled 2026-08-23 (docs-builder-v3-spec.md, "cleanup"): the proposal (what this
// document is mainly about, what other themes it holds) comes from a model's cheap-tier read,
// driven by docs-builder.md, never guessed here; the verdict comes from the user via
// AskUserQuestion. Nothing past this function runs — no page, no archive move, no further
// model call — until that interview is answered. `cleanup-apply` (below) is the door back in.
function cleanup(files) {
  if (!files.length) die('usage: docs-builder.cjs cleanup <file.md>');
  if (files.length > 1)
    die(`cleanup takes exactly ONE file, not ${files.length} (${files.join(', ')}) — `
      + 'splitting spends real model budget, so it only ever runs on a single file you '
      + 'named. Run it once per file.');
  const [file] = files;
  if (path.extname(file) !== '.md') die(`cleanup: ${file} is not a .md file`);
  if (PROTECTED_NAMES.has(path.basename(file)))
    die(`cleanup: ${file} is a protected entry-point doc (README/CLAUDE.md/etc.) and is `
      + 'never split');
  if (!fs.existsSync(repoPath(file))) die(`cleanup: no such file: ${file}`);
  const inFlight = inFlightSplit(file);
  if (inFlight)
    die(`cleanup: refusing to start — ${inFlight} looks like an in-progress split `
      + '(docs/.docs-builder/labels.json has a core:true theme and its source file still '
      + `exists, meaning \`plan\` has run but \`archive\` has not). A second cleanup here `
      + `would overwrite that split's still-in-flight outline.json/labels.json. Finish it `
      + `first: write its remaining pages, then re-run \`cleanup-apply ${inFlight} ...\` until `
      + `it archives — THEN run \`cleanup ${file}\`.`);
  const lines = read(file).split('\n').length;
  const est = writeCostEstimate(1, lines);
  console.log(`${file}: ${lines} lines`);
  console.log(`est. write cost: $${est.toFixed(2)} (mid tier, floor assuming 1 page — the `
    + "real page count depends on the model's grouping step; `plan` reports the precise "
    + 'figure once labels.json exists)');
  console.log('\n== scan ==');
  scan([file]);

  // Same dest scan() itself just wrote to (write()'s own OUT-or-default), so this always
  // reads back exactly the outline scan produced, whether OUT was overridden or not.
  const outlineDest = process.env.OUT || path.join(ARTIFACTS, 'outline.json');
  const o = readArtifactJSON(outlineDest);
  const shape = buildShape(file, o.records);
  const shapeDest = path.join(ARTIFACTS, 'cleanup-shape.json');
  fs.mkdirSync(path.dirname(shapeDest), { recursive: true });
  fs.writeFileSync(shapeDest, JSON.stringify(shape, null, 1));
  console.log('\n== shape ==');
  printShape(shape);
  console.log(`\nwrote ${shapeDest}`);
  console.log('\nawaiting the interview — cleanup stops here. Not the archive move, not a '
    + 'page, not a model call beyond the scan above. Read the shape, propose what this '
    + 'document is mainly about and what other themes it holds, and ask the user via '
    + 'AskUserQuestion before anything else runs (docs-builder.md, Mode 1, step 1b). Once the '
    + 'themes are confirmed, propose+assign (step 2a/2b) writes labels.json with exactly one '
    + 'theme marked core:true, then run:\n'
    + `  docs-builder.cjs cleanup-apply ${file} ${outlineDest} ${path.join(ARTIFACTS, 'labels.json')}`);
}

// ---------------------------------------------------------------- cleanup-apply (post-approval)

// The interview settles the themes; this is the first script step allowed to run after it.
// A new subcommand rather than a `cleanup --apply` flag: this file has no flag parser
// anywhere (every subcommand is positional, on purpose — see the dispatch table below), and
// a one-off flag here would be a new parsing convention for one caller. It is also a
// SEPARATE command from `plan`/`archive`/`index-flat` rather than a wrapper that always
// chains all three: a human/model page-writing step sits between `plan` and `archive` that
// this script cannot run, so `cleanup-apply` is deliberately re-runnable — call it once and
// it reports pages still to write (same resumability `plan` already has); call it again once
// every page exists and THAT run archives the original and rebuilds the index. It refuses
// outright, before doing anything, if the interview clearly has not happened: no labels.json,
// or a labels.json with no theme marked core:true.
//
// The core page's REAL destination (its own document's original directory, not PAGES —
// settled 2026-08-23, docs-builder-v3-spec.md "cleanup") must be read from outline.json
// BEFORE archiving: `archive(file)` runs moveDoc -> rewriteArchivedPath, which rewrites
// outline.json's records[].file to the ARCHIVE path the instant the move lands, so the
// original directory can only be recovered here, one line before that happens.
function coreFileInfo(o, l) {
  const coreName = coreThemeName(l.themes);
  if (!coreName) return null;
  const files = [...new Set((o.records || []).map(r => r.file))];
  if (files.length !== 1) return null; // buildThemeSlugs (via plan(), already run) validates this
  return { coreName, dir: path.posix.dirname(files[0]), base: path.basename(files[0]) };
}

function cleanupApply(file, outlineF, labelsF) {
  if (!file || !outlineF || !labelsF)
    die('usage: docs-builder.cjs cleanup-apply <file.md> <outline.json> <labels.json>');
  if (!fs.existsSync(labelsF))
    die(`cleanup-apply: no labels.json at ${labelsF} — the interview has not happened yet. `
      + 'Run `cleanup <file>`, answer the interview it prints, then have the model '
      + 'propose+assign themes (labels.json, with exactly one theme marked core:true) before '
      + 'calling cleanup-apply.');
  const l = parseJSONFile(labelsF);
  if (!coreThemeName(l.themes))
    die('cleanup-apply: labels.json has no theme marked core:true — the interview has not '
      + "happened yet. Mark exactly one theme core:true (the document's main subject, from "
      + 'the interview\'s answer), then re-run cleanup-apply.');
  const { rows, todo, pages } = plan(outlineF, labelsF);
  if (todo.length) {
    console.log(`\n${todo.length} page(s) still to write — write them (mid tier, one agent `
      + 'per page, docs-builder.md step 5), then re-run `cleanup-apply` to archive the '
      + 'original and rebuild the index.');
    return;
  }
  console.log('\nall pages written — archiving the original and rebuilding the index.');
  // Every page this split produced is a brand-new, untracked file. Nothing MOVED them, so
  // only this knows they exist — and a commit recipe that omits them stages an archived
  // original whose replacement content is nowhere in the commit.
  noteGenerated(...rows.map(r => path.posix.join(pages, `${r.theme}.md`)));
  const core = coreFileInfo(readArtifactJSON(outlineF), l);
  try { archiveOrThrow(file); }
  catch (e) {
    if (!e.followUpFailed) die(e.message); // nothing moved — the original is untouched
    // The original DID move, so this run cannot be resumed by re-running `cleanup-apply`:
    // that would call archiveOrThrow on a file that is no longer there. Name the two steps
    // this run is dropping and how to finish them by hand — exiting silently left an
    // operator with a half-applied split and no idea the index was still stale.
    console.error(e.message);
    console.error(`\ncleanup-apply STOPPED here. Two steps did NOT run: the core page was not `
      + `relocated out of ${pages}/ into the original document's directory, and docs/index.md `
      + `was not rebuilt (it still describes the pre-split shape). Do NOT re-run `
      + `\`cleanup-apply\` — ${file} has already moved. Fix the failure above, move the core `
      + `page yourself, then run \`docs-builder.cjs index-flat\` to rebuild the index.`);
    flushCommitAdvisory();
    process.exit(2);
  }
  // The model writes every page — core included — under PAGES (docs-builder.md's documented
  // convention; unchanged, since the model can't write there directly: until the line above
  // runs, the ORIGINAL still occupies that exact path, and overwriting a live, not-yet-
  // archived source would violate "the original is never rewritten"). Once archiving frees
  // that path, the core page is relocated from its interim PAGES location into the original
  // document's own directory — only NON-core theme pages stay under PAGES for good.
  if (core) {
    const from = path.join(pages, core.base);
    const to = path.join(core.dir, core.base);
    if (from === to) {
      console.log(`  core page ${from} already lives in the original document's own directory.`);
    } else if (!fs.existsSync(repoPath(from))) {
      console.error(`  WARN: expected the core page at ${from} (the model's page-writing step `
        + `should have written it there) but it is missing — cannot relocate it into `
        + `${core.dir}/. The index below will not show a core page for this split.`);
    } else {
      try {
        const r = moveDoc(from, to);
        console.log(`  relocated core page: ${from} -> ${to} (its own document's original `
          + `directory — only non-core theme pages stay under ${pages}/)`);
        for (const m of r.artifactNotes) console.log(`    ${m}`);
        if (r.failures.length) console.error(`  WARN core page relocated, but ${r.failures.join('; ')}`);
        noteMoved(r.rel); noteLinks(r.linkFiles.map(x => x.file));
      } catch (e) {
        console.error(`  WARN could not relocate the core page from ${from} to ${to}: `
          + `${e.message} — it remains at ${from}.`);
      }
    }
  }
  // v3 scope change (2026-08-24): the themed per-split index (docs/wiki-index.md) is gone —
  // it was the direct cause of three separate defects (a corpus-map clobber, the multi-split
  // outline.json clobber inFlightSplit() above now refuses, and a slugOf() lowercasing bug
  // that rendered a real page as "pending"). ONE index now: index-flat's whole-corpus
  // docs/index.md, rebuilt here so it captures the split's new shape (the archived original,
  // the relocated core page at its real path, and the remaining PAGES/ pages) same as it
  // already is after every reorg.
  indexFlat();
}

// ---------------------------------------------------------------- dispatch

// Machine state has one home. Callers can override with OUT, but the default must never
// scatter JSON into whatever directory the user happened to be standing in.
const ARTIFACTS = path.join(REPO, 'docs/.docs-builder');
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
  case 'index-flat':  indexFlat(); break;
  case 'search':      search(rest[0], rest.slice(1)); break;
  case 'archive':     archive(rest[0], rest[1]); break;
  case 'ledger':      ledger(); break;
  case 'due':         due(); break;
  case 'lint':        lint(rest); break;
  case 'discover':    discover(rest[0]); break;
  case 'apply-reorg': applyReorg(rest[0]); break;
  case 'reorg':       reorg(); break;
  case 'cleanup':       cleanup(rest); break;
  case 'cleanup-apply': cleanupApply(rest[0], rest[1], rest[2]); break;
  default:
    die('usage: docs-builder.cjs <scan|validate|plan|index-flat|search|archive|ledger|due|lint|'
      + 'discover|apply-reorg|reorg|cleanup|cleanup-apply> [args]\n'
      + '  scan        <file.md...>                 -> outline.json\n'
      + '  validate    <outline.json> <labels.json> -> PASS/FAIL (exit 1 on FAIL)\n'
      + '  plan        <outline.json> <labels.json> -> task-<theme>.json per page\n'
      + '  index-flat                                -> index.md, the ONE index (whole corpus, no labels needed)\n'
      + '  search      <outline.json> <query...>     -> ranked sections (BM25, no deps)\n'
      + '  archive     <src.md> [dest.md]            -> verified MOVE into docs/archive/\n'
      + '  ledger                                    -> record current state of docs/\n'
      + '  due                                       -> what changed since the ledger\n'
      + '  lint        <file.md...>                  -> lint.json\n'
      + '  discover    [root=docs]                   -> reorg-plan.json (proposes `suggested`, never moves, never CLASSIFIES — carries forward already-approved buckets)\n'
      + '  apply-reorg [plan.json]                    -> executes the plan; refuses if any row\'s `bucket` is empty\n'
      + '  reorg                                     -> discover+apply-reorg+lint, plus `due`\'s '
      + 'drift summary if a ledger stamp exists (the single front door)\n'
      + '  cleanup     <file.md>                     -> ONE named file: cost estimate, then scan\n'
      + '                                                 (the ONLY entry point to the split pipeline)\n'
      + '  cleanup-apply <file.md> [outline] [labels] -> plan + pages + archive, after the cleanup interview\n'
      + 'env: REPO (default cwd), OUT (output path), INDEX (default docs/index.md), '
      + 'PAGES (default docs/wiki), TASKS (default docs/.docs-builder/tasks), '
      + 'N (search result count, default 10), OVERSIZED_LINES (default 500)');
}

// The run's ONE commit recipe, printed last, after every step of whichever subcommand ran.
// Here rather than inside each subcommand precisely because a subcommand can call another
// (cleanup-apply calls archive) — a per-function print is what produced several partial
// recipes for one run. `die()`/`process.exit()` paths never reach this, which is correct:
// a run that failed has nothing to stage. archive's exit-2 branch flushes explicitly, since
// there the move DID land.
flushCommitAdvisory();
