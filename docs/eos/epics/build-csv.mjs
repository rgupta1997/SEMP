// Generates epics.csv from the journey docs, so the tracker import can never drift
// from the markdown. Run: node docs/eos/epics/build-csv.mjs
//
// Sources:
//   00-journey-map.md  -> the epic index tables (personas, modules, priority, size)
//   J*.md              -> epic goals, stories, and Gherkin acceptance criteria
//
// Output: epics.csv (RFC 4180 - quoted fields, "" escaping, multi-line AC preserved).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/[★⚠]/g, '').replace(/\s+/g, ' ').trim();

// ---------- 1. epic metadata from the index tables in the journey map ----------
// Row shape: | J1-E1 | Title | SS FC | 01, 02 | P0 | M |
const meta = new Map();
for (const line of readFileSync(path.join(dir, '00-journey-map.md'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\|\s*(J\d-E\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/);
  if (!m) continue;
  meta.set(m[1], {
    title: strip(m[2]),
    personas: strip(m[3]),
    modules: strip(m[4]),
    priority: strip(m[5]),
    size: strip(m[6]),
  });
}

// ---------- 1b. wave + dependencies from the execution-order table ----------
// Row shape: | J1-E1 | 1 | J6-E3, J2-E7 | reason |
const seq = new Map();
for (const line of readFileSync(path.join(dir, '01-execution-order.md'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\|\s*(J\d-E\d+)\s*\|\s*([0-9]+|held)\s*\|([^|]*)\|([^|]*)\|/);
  if (!m) continue;
  // A lone dash means "no dependencies". Only treat the cell as empty when it is
  // entirely a dash - a blanket dash-strip would also eat the hyphen in "J6-E3".
  const raw = strip(m[3]);
  const deps = /^[—–-]?$/.test(raw) ? '' : raw;
  seq.set(m[1], { wave: m[2].trim(), deps, reason: strip(m[4]) });
}
for (const key of meta.keys()) {
  if (!seq.has(key)) console.log(`  WARNING: ${key} has no row in the execution-order table`);
}

// Validate the sequencing. A dependency in a LATER wave is a planning error and must
// fail loudly. A dependency in the SAME wave is legal but means the wave is not fully
// parallel, so it is reported - the execution-order doc has to say so explicitly.
const waveOf = (k) => (seq.get(k)?.wave === 'held' ? 99 : Number(seq.get(k)?.wave));
const intraWave = [];
let seqErrors = 0;
for (const [key, { wave, deps }] of seq) {
  if (!deps) continue;
  const w = wave === 'held' ? 99 : Number(wave);
  for (const dep of deps.split(',').map((d) => d.trim()).filter(Boolean)) {
    if (!seq.has(dep)) { console.log(`  ERROR: ${key} depends on unknown epic ${dep}`); seqErrors++; continue; }
    if (waveOf(dep) > w) {
      console.log(`  ERROR: ${key} (W${wave}) depends on ${dep} (W${seq.get(dep).wave}) - a later wave`);
      seqErrors++;
    } else if (waveOf(dep) === w) {
      intraWave.push(`${dep} -> ${key} (W${wave})`);
    }
  }
}
if (intraWave.length) console.log(`  intra-wave ordering (${intraWave.length}): ${intraWave.join(', ')}`);
if (seqErrors) { console.error(`\n${seqErrors} sequencing error(s) - fix 01-execution-order.md`); process.exit(1); }

// ---------- 2. epics + stories from each journey doc ----------
const rows = [];
const journeyTitles = {
  J1: 'Institution Onboarding', J2: 'Run a Championship', J3: 'Enter & Compete',
  J4: 'The Verified Record', J5: 'Leadership Reporting', J6: 'Govern & Administer',
};

for (const file of readdirSync(dir).filter((f) => /^J\d-.*\.md$/.test(f)).sort()) {
  // Split CRLF-safe: a stray \r left by a Windows editor would defeat every $-anchored
  // regex below and silently drop the whole file from the export.
  const lines = readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
  const journey = file.slice(0, 2);
  let epicKey = null;
  let story = null;               // { key, epic, summary, narrative, ac[] }
  let inGherkin = false;

  const flushStory = () => {
    if (!story) return;
    const m = meta.get(story.epic) ?? {};
    rows.push({
      'Issue Type': 'Story',
      Key: story.key,
      'Epic Link': story.epic,
      Journey: `${journey} ${journeyTitles[journey]}`,
      Summary: story.summary,
      Description: story.narrative,
      'Acceptance Criteria': story.ac.join('\n\n').trim(),
      Personas: m.personas ?? '',
      Modules: m.modules ?? '',
      Priority: m.priority ?? '',
      'T-Shirt': '',                 // sized at epic level only, by design
      Wave: seq.get(story.epic)?.wave ?? '',
      'Depends On': '',              // dependencies are tracked at epic level
      Flags: story.flag,
    });
    story = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ``` fences: capture Gherkin blocks into the current story
    if (/^```/.test(line)) {
      if (inGherkin) { inGherkin = false; continue; }
      if (/^```gherkin/.test(line) && story) {
        const block = [];
        for (let j = i + 1; j < lines.length && !/^```/.test(lines[j]); j++) block.push(lines[j]);
        story.ac.push(block.join('\n').trim());
        inGherkin = true;
      }
      continue;
    }
    if (inGherkin) continue;

    // ## Epic J1-E1 · Title
    const epic = line.match(/^##\s+Epic\s+(J\d-E\d+)\s*·\s*(.+)$/);
    if (epic) {
      flushStory();
      epicKey = epic[1];
      const m = meta.get(epicKey) ?? {};
      // The epic goal is the "**Goal:**" paragraph if present — it wraps across lines,
      // so keep consuming until a blank line or the next bold field (e.g. "**Modules:**").
      let goal = '';
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const g = lines[j].match(/^\*\*Goal:\*\*\s*(.+)$/);
        if (!g) continue;
        const buf = [g[1]];
        for (let k = j + 1; k < lines.length; k++) {
          const nxt = lines[k];
          if (nxt.trim() === '' || /^\*\*/.test(nxt) || /^#/.test(nxt)) break;
          buf.push(nxt);
        }
        goal = strip(buf.join(' '));
        break;
      }
      rows.push({
        'Issue Type': 'Epic',
        Key: epicKey,
        'Epic Link': '',
        Journey: `${journey} ${journeyTitles[journey]}`,
        Summary: m.title || strip(epic[2]),
        Description: goal,
        'Acceptance Criteria': '',
        Personas: m.personas ?? '',
        Modules: m.modules ?? '',
        Priority: m.priority ?? '',
        'T-Shirt': m.size ?? '',
        Wave: seq.get(epicKey)?.wave ?? '',
        'Depends On': seq.get(epicKey)?.deps ?? '',
        Flags: /★/.test(epic[2]) ? 'high-leverage' : (/⚠/.test(epic[2]) ? 'blocked-on-decision' : ''),
      });
      continue;
    }

    // ### J1-E1-S1 — Story summary
    const st = line.match(/^###\s+(J\d-E\d+-S\d+)\s*[—-]\s*(.+)$/);
    if (st) {
      flushStory();
      story = {
        key: st[1], epic: epicKey, summary: strip(st[2]), narrative: '', ac: [],
        flag: /⚠/.test(st[2]) ? 'blocked-on-decision' : '',
      };
      continue;
    }

    // > **As** X, **I want** Y, **so that** Z.  (may wrap across blockquote lines)
    if (story && !story.narrative && /^>\s*\*\*As\*\*/.test(line)) {
      const buf = [line];
      for (let j = i + 1; j < lines.length && /^>/.test(lines[j]) && lines[j].trim() !== '>'; j++) buf.push(lines[j]);
      // Strip the blockquote marker per line BEFORE joining - a /^>/m replace after
      // joining would leave the markers of every continuation line embedded mid-string.
      story.narrative = strip(buf.map((l) => l.replace(/^>\s?/, '')).join(' ').replace(/\*\*/g, ''));
    }
  }
  flushStory();
}

// ---------- 3. emit RFC 4180 CSV ----------
const cols = ['Issue Type', 'Key', 'Epic Link', 'Journey', 'Wave', 'Summary', 'Description',
  'Acceptance Criteria', 'Personas', 'Modules', 'Priority', 'T-Shirt', 'Depends On', 'Flags'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Emit in execution order - wave, then epic, with each epic immediately above its
// stories - so the CSV reads as the build sequence rather than as journey documentation.
const waveNum = (w) => (w === 'held' ? 99 : (w === '' || w == null ? 98 : Number(w)));
rows.sort((a, b) => {
  const ea = a['Epic Link'] || a.Key, eb = b['Epic Link'] || b.Key;
  if (waveNum(a.Wave) !== waveNum(b.Wave)) return waveNum(a.Wave) - waveNum(b.Wave);
  if (ea !== eb) return ea.localeCompare(eb);
  if (a['Issue Type'] !== b['Issue Type']) return a['Issue Type'] === 'Epic' ? -1 : 1;
  return a.Key.localeCompare(b.Key, undefined, { numeric: true });
});

const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');

// UTF-8 BOM. Excel on Windows assumes the system ANSI codepage for a .csv without one,
// which mangles the em-dashes, en-dashes, arrows and middots this file contains. Jira
// and Linear both tolerate the BOM; a naive parser may read the first header as
// "﻿Issue Type", so strip ﻿ when reading this file programmatically.
writeFileSync(path.join(dir, 'epics.csv'), '﻿' + csv + '\r\n', 'utf8');

const epics = rows.filter((r) => r['Issue Type'] === 'Epic').length;
const stories = rows.length - epics;
const noAc = rows.filter((r) => r['Issue Type'] === 'Story' && !r['Acceptance Criteria']).length;
const noNarr = rows.filter((r) => r['Issue Type'] === 'Story' && !r.Description).length;
console.log(`epics.csv written: ${epics} epics, ${stories} stories`);
if (noAc) console.log(`  WARNING: ${noAc} stories have no acceptance criteria`);
if (noNarr) console.log(`  WARNING: ${noNarr} stories have no As-a narrative`);
const orphan = rows.filter((r) => r['Issue Type'] === 'Epic' && !meta.has(r.Key)).map((r) => r.Key);
if (orphan.length) console.log(`  WARNING: epics missing from the journey-map index: ${orphan.join(', ')}`);
const noWave = rows.filter((r) => r['Issue Type'] === 'Epic' && !r.Wave).map((r) => r.Key);
if (noWave.length) console.log(`  WARNING: epics with no wave assigned: ${noWave.join(', ')}`);
const byWave = {};
for (const r of rows.filter((x) => x['Issue Type'] === 'Epic')) byWave[r.Wave] = (byWave[r.Wave] ?? 0) + 1;
console.log('  epics per wave:', Object.entries(byWave).map(([w, n]) => `W${w}=${n}`).join(' '));
