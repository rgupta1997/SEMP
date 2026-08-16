// Builds epics.xlsx — a colour-coded, spaced, human-readable view of the backlog —
// from epics.csv. Run AFTER build-csv.mjs:
//
//   node docs/eos/epics/build-csv.mjs && node docs/eos/epics/build-xlsx.mjs
//
// Why hand-rolled: an .xlsx is a ZIP of XML parts, and writing it directly avoids adding
// a dependency. The `xlsx` (SheetJS) package already in the repo cannot help here — cell
// fills are a Pro-only feature in the community build, and colour is the whole point.
//
// Division of labour:
//   epics.csv   -> machine-readable, no blank rows, for Jira/Linear bulk import
//   epics.xlsx  -> human-readable, colour-coded by wave, blank row between epics
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- CSV in
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip the BOM we write
  const rows = []; let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const csv = parseCsv(readFileSync(path.join(dir, 'epics.csv'), 'utf8'));
const header = csv[0];
const data = csv.slice(1);
const COL = Object.fromEntries(header.map((h, i) => [h, i]));

// ---------------------------------------------------------------- palette
// One hue per wave: a strong fill for the epic row, a tint for its stories.
const WAVES = {
  '0':    { name: 'Unblock',     epic: 'FFB91C1C', story: 'FFFEE2E2' },
  '1':    { name: 'Foundations', epic: 'FFC2410C', story: 'FFFFEDD5' },
  '2':    { name: 'Propagate',   epic: 'FFB45309', story: 'FFFEF3C7' },
  '3':    { name: 'Records',     epic: 'FF15803D', story: 'FFDCFCE7' },
  '4':    { name: 'Surface',     epic: 'FF1D4ED8', story: 'FFDBEAFE' },
  '5':    { name: 'Artefacts',   epic: 'FF6D28D9', story: 'FFEDE9FE' },
  'held': { name: 'Held',        epic: 'FF475569', story: 'FFF1F5F9' },
};
const WAVE_KEYS = Object.keys(WAVES);
const HEADER_FILL = 'FF0F172A';

// Style indices: 0 default · 1 header · 2..8 epic-by-wave · 9..15 story-by-wave
const epicStyle  = (w) => 2 + WAVE_KEYS.indexOf(w);
const storyStyle = (w) => 2 + WAVE_KEYS.length + WAVE_KEYS.indexOf(w);

// ---------------------------------------------------------------- sheet rows
const COLS = ['Issue Type', 'Key', 'Epic Link', 'Journey', 'Wave', 'Summary', 'Description',
  'Acceptance Criteria', 'Personas', 'Modules', 'Priority', 'T-Shirt', 'Depends On', 'Flags'];
const WIDTHS = [11, 12, 11, 26, 7, 42, 62, 88, 34, 12, 9, 9, 18, 20];

const sheetRows = [{ cells: COLS, style: 1 }];
let prevEpic = null;
for (const r of data) {
  const wave = r[COL.Wave] || 'held';
  const isEpic = r[COL['Issue Type']] === 'Epic';
  const epicKey = r[COL['Epic Link']] || r[COL.Key];
  // Blank spacer between epic blocks, so the sheet reads as blocks not a wall of rows.
  if (isEpic && prevEpic !== null) sheetRows.push({ cells: COLS.map(() => ''), style: 0 });
  sheetRows.push({ cells: COLS.map((c) => r[COL[c]] ?? ''), style: isEpic ? epicStyle(wave) : storyStyle(wave) });
  prevEpic = epicKey;
}

// ---------------------------------------------------------------- XML helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colName = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };

// A second sheet explaining the colour coding, so the workbook is self-describing when
// it is forwarded to someone who has never seen the docs.
const WAVE_GOAL = {
  '0': 'Nothing depends on anything. All of it unblocks something. Start here.',
  '1': 'The spine and the tenant. Lock scorecards; make an institution real.',
  '2': 'The lock fans out; the access model lands.',
  '3': 'People become first-class; results become permanent history.',
  '4': 'The things users actually see — shell, verification, reports.',
  '5': 'Certificates and the annual report.',
  'held': 'Blocked on a decision, not on engineering.',
};
const legendRows = [
  { cells: ['Wave', 'Name', 'Colour', 'Epics', 'What becomes true'], style: 1 },
  ...WAVE_KEYS.map((w) => ({
    cells: [w === 'held' ? 'held' : `W${w}`, WAVES[w].name, '',
      String(data.filter((r) => r[COL['Issue Type']] === 'Epic' && (r[COL.Wave] || 'held') === w).length),
      WAVE_GOAL[w]],
    style: epicStyle(w),
  })),
  { cells: ['', '', '', '', ''], style: 0 },
  { cells: ['Reading this file', '', '', '', ''], style: 1 },
  { cells: ['', 'Rows are in execution order: wave, then epic, each epic directly above its stories.', '', '', ''], style: 0 },
  { cells: ['', 'A strong fill is an epic; the tint beneath it is that epic’s stories.', '', '', ''], style: 0 },
  { cells: ['', 'Blank rows separate epic blocks. They are cosmetic — epics.csv has none.', '', '', ''], style: 0 },
  { cells: ['', 'Import into Jira/Linear from epics.csv, not from this workbook.', '', '', ''], style: 0 },
  { cells: ['', 'Both files are generated. Edit the markdown and re-run the build scripts.', '', '', ''], style: 0 },
];

function legendXml() {
  const body = legendRows.map((row, ri) => {
    const cells = row.cells.map((v, ci) => v === '' ? `<c r="${colName(ci)}${ri + 1}" s="${row.style}"/>`
      : `<c r="${colName(ci)}${ri + 1}" s="${row.style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = [8, 18, 10, 8, 78].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
</worksheet>`;
}

function sheetXml() {
  const body = sheetRows.map((row, ri) => {
    const cells = row.cells.map((v, ci) => {
      if (v === '' || v == null) return `<c r="${colName(ci)}${ri + 1}" s="${row.style}"/>`;
      return `<c r="${colName(ci)}${ri + 1}" s="${row.style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" tabSelected="1">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
<autoFilter ref="A1:${colName(COLS.length - 1)}${sheetRows.length}"/>
</worksheet>`;
}

function stylesXml() {
  // fills: 0 none, 1 gray125 (both required by the spec), 2 header, then epic+story fills
  const fillList = [HEADER_FILL, ...WAVE_KEYS.map((w) => WAVES[w].epic), ...WAVE_KEYS.map((w) => WAVES[w].story)];
  const fills = `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
    + fillList.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  const HEADER_FILL_IDX = 2;
  const EPIC_FILL_0 = 3;
  const STORY_FILL_0 = 3 + WAVE_KEYS.length;

  const fonts = `<font><sz val="10"/><name val="Calibri"/><color rgb="FF1E293B"/></font>`      // 0 body
    + `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>`            // 1 bold white
    + `<font><sz val="10"/><name val="Calibri"/><color rgb="FF334155"/></font>`;               // 2 story

  const align = `<alignment vertical="top" wrapText="1"/>`;
  const xfs = [
    `<xf xfId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1">${align}</xf>`,                              // 0 default
    `<xf xfId="0" fontId="1" fillId="${HEADER_FILL_IDX}" borderId="0" applyFont="1" applyFill="1" applyAlignment="1">${align}</xf>`, // 1 header
    ...WAVE_KEYS.map((_, i) => `<xf xfId="0" fontId="1" fillId="${EPIC_FILL_0 + i}" borderId="0" applyFont="1" applyFill="1" applyAlignment="1">${align}</xf>`),
    ...WAVE_KEYS.map((_, i) => `<xf xfId="0" fontId="2" fillId="${STORY_FILL_0 + i}" borderId="0" applyFont="1" applyFill="1" applyAlignment="1">${align}</xf>`),
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">${fonts}</fonts>
<fills count="${2 + fillList.length}">${fills}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${2 + WAVE_KEYS.length * 2}">${xfs}</cellXfs>
</styleSheet>`;
}

// ---------------------------------------------------------------- minimal ZIP
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(data, 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);          // deflate
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x2821, 12);   // fixed timestamp -> reproducible output
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x2821, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---------------------------------------------------------------- assemble
const parts = [
  { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
  { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
  { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Backlog" sheetId="1" r:id="rId1"/><sheet name="Key" sheetId="2" r:id="rId3"/></sheets>
</workbook>` },
  { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>` },
  { name: 'xl/styles.xml', data: stylesXml() },
  { name: 'xl/worksheets/sheet1.xml', data: sheetXml() },
  { name: 'xl/worksheets/sheet2.xml', data: legendXml() },
];

writeFileSync(path.join(dir, 'epics.xlsx'), zip(parts));

const epics = data.filter((r) => r[COL['Issue Type']] === 'Epic').length;
const stories = data.length - epics;
const spacers = sheetRows.filter((r) => r.style === 0).length;
console.log(`epics.xlsx written: ${epics} epics, ${stories} stories, ${spacers} spacer rows, ${sheetRows.length} sheet rows`);
console.log('  colour key: ' + WAVE_KEYS.map((w) => `W${w}=${WAVES[w].name}`).join(' · '));
