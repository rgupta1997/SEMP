/*
 * READING A WORKBOOK GRID — the mechanical half of the validator.
 *
 * Nothing here knows what an event is. It finds sheets, finds the header row, maps
 * a client's headers onto the template's columns, and turns cells into dates, times,
 * numbers, mobiles and emails. Every judgement about what the values MEAN lives in
 * validate.ts.
 */
import { isPlaceholderEmail, isPlaceholderPhone } from '../placeholder-contact.js';
import type { SetupEventType } from './blueprint.js';
import {
  SETUP_TEMPLATE_SHEETS, setupColumnRequired, setupColumnsFor, setupHeaderKey,
  type SetupIssue, type SetupSheetName, type SetupTemplateColumn, type SetupTemplateSheet,
} from './template.js';

export type IssueSink = (issue: SetupIssue) => void;

// ---------------------------------------------------------------------------
// cells
// ---------------------------------------------------------------------------
/** The words sheets use for "nothing here". */
const BLANK = /^(?:null|nil|none|na|n\/a|n\.a\.?|tbd|tba|-+|–|—)$/i;

/** A cell as text: trimmed, whitespace collapsed, and the blank-ish words read as empty. */
export function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/[   ​]/g, ' ').replace(/\s+/g, ' ').trim();
  return BLANK.test(s) ? '' : s;
}

export const isBlankRow = (row: unknown[] | undefined) => !row || row.every((c) => cleanCell(c) === '');

export const templateSheet = (name: SetupSheetName): SetupTemplateSheet =>
  SETUP_TEMPLATE_SHEETS.find((s) => s.name === name)!;

// ---------------------------------------------------------------------------
// sheets
// ---------------------------------------------------------------------------
/** Other tab names clients use for the same sheet. Exact names win over these. */
const SHEET_ALIASES: Record<SetupSheetName, string[]> = {
  Event: ['Event details', 'Settings'],
  Draws: ['Draw', 'Sports'],
  Squads: ['Squad', 'Teams'],
  People: ['Players', 'Roster'],
  Staff: ['Officials', 'Roles'],
  Schedule: ['Fixtures', 'Matches', 'Master schedule'],
};

/** A sheet by name, any case or spacing; then by a common alternative name. */
export function findSheet(
  sheets: Record<string, unknown>, name: SetupSheetName,
): { name: string; grid: unknown[][] } | null {
  const entries = Object.entries(sheets ?? {});
  const grid = (v: unknown): unknown[][] =>
    (Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? r : [r])) : []);
  for (const want of [name, ...SHEET_ALIASES[name]]) {
    const key = setupHeaderKey(want);
    const hit = entries.find(([k]) => setupHeaderKey(k) === key);
    if (hit) return { name: hit[0], grid: grid(hit[1]) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// table sheets
// ---------------------------------------------------------------------------
export interface TableRow {
  /** 1-based, as Excel shows it. */
  row: number;
  get(key: string): string;
}

export interface TableRead {
  /** Column key -> the header the client actually wrote. */
  headers: Map<string, string>;
  has(key: string): boolean;
  rows: TableRow[];
  headerRow: number;
  /** Required columns (keys) this sheet lacks. */
  missing: string[];
}

const quoteList = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ');

/**
 * Read a 'table' sheet. The header row is the first non-empty row — unless that row
 * is a title (fewer than two known headers) and one of the next few rows is the real
 * header row. `extra` maps headers the template does not list (Player 13, Player 1
 * mobile) onto keys of the caller's own.
 */
export function readTable(
  grid: unknown[][], sheet: SetupTemplateSheet, type: SetupEventType, sink: IssueSink,
  extra?: (headerKey: string) => string | null,
  /** An optional sheet with headers but no rows is not checked for missing columns. */
  optional = false,
  /** The columns this setup needs (setupWorkbookLayout); default: the template's own rule. */
  required?: ReadonlySet<string>,
): TableRead {
  const own = setupColumnsFor(sheet, type);
  const lookup = new Map<string, string>();
  for (const c of own) for (const h of [c.header, ...(c.aliases ?? [])]) {
    const k = setupHeaderKey(h);
    if (k && !lookup.has(k)) lookup.set(k, c.key);
  }
  const otherType = new Map<string, SetupTemplateColumn>();
  for (const c of sheet.columns) if (!own.includes(c)) {
    for (const h of [c.header, ...(c.aliases ?? [])]) otherType.set(setupHeaderKey(h), c);
  }
  const keyOf = (header: string): string | null => {
    const hk = setupHeaderKey(header);
    if (!hk) return null;
    // "Captain Mobile No." / "Mobile Number": a trailing no / number, when the rest is a known column.
    const bare = hk.replace(/(?:no|num|number)$/, '');
    return lookup.get(hk) ?? extra?.(hk) ?? (bare && bare !== hk ? lookup.get(bare) ?? null : null);
  };

  const nonEmpty: number[] = [];
  for (let i = 0; i < grid.length && nonEmpty.length < 6; i++) if (!isBlankRow(grid[i])) nonEmpty.push(i);
  const score = (i: number) => (grid[i] ?? []).filter((c) => keyOf(cleanCell(c)) !== null).length;
  let headerIdx = nonEmpty[0] ?? -1;
  if (headerIdx >= 0 && score(headerIdx) < 2) {
    const better = nonEmpty.slice(1).find((i) => score(i) >= 2 && score(i) > score(headerIdx));
    if (better !== undefined) {
      sink({
        severity: 'info', code: 'title_rows_skipped', sheet: sheet.name, row: better + 1,
        message: `${sheet.name}: the first ${better === 1 ? 'row was' : `${better} rows were`} read as a title and skipped; the column headers are on row ${better + 1}.`,
      });
      headerIdx = better;
    }
  }

  const headers = new Map<string, string>();
  const index = new Map<string, number>();
  const unknown: string[] = [];
  const notForType: string[] = [];
  const dupes: string[] = [];
  const headerCells = headerIdx >= 0 ? grid[headerIdx] : [];
  headerCells.forEach((cell, i) => {
    const h = cleanCell(cell);
    if (!h) return;
    const key = keyOf(h);
    if (key === null) {
      (otherType.has(setupHeaderKey(h)) ? notForType : unknown).push(h);
      return;
    }
    if (index.has(key)) { dupes.push(`"${h}" (same as "${headers.get(key)}")`); return; }
    index.set(key, i);
    headers.set(key, h);
  });

  if (unknown.length) {
    sink({
      severity: 'info', code: 'unknown_columns', sheet: sheet.name, row: headerIdx + 1,
      message: `${sheet.name}: ${unknown.length === 1 ? 'this column is' : 'these columns are'} not part of the template and ${unknown.length === 1 ? 'was' : 'were'} ignored: ${quoteList(unknown)}. If one holds data you need, rename its header to the template's.`,
    });
  }
  if (notForType.length) {
    sink({
      severity: 'info', code: 'column_not_used', sheet: sheet.name, row: headerIdx + 1,
      message: `${sheet.name}: ${quoteList(notForType)} ${notForType.length === 1 ? 'is' : 'are'} not used for a ${type} event and ${notForType.length === 1 ? 'was' : 'were'} ignored.`,
    });
  }
  if (dupes.length) {
    sink({
      severity: 'warning', code: 'duplicate_column', sheet: sheet.name, row: headerIdx + 1,
      message: `${sheet.name}: ${dupes.join(', ')} ${dupes.length === 1 ? 'reads' : 'read'} as a column that is already there, so only the first one is used. Delete or rename the extra column.`,
    });
  }

  const rows: TableRow[] = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const cells = grid[i];
      if (isBlankRow(cells)) continue;
      rows.push({
        row: i + 1,
        get: (key) => { const at = index.get(key); return at === undefined ? '' : cleanCell(cells[at]); },
      });
    }
  }

  const missing: string[] = [];
  if (headerIdx >= 0 && !(optional && rows.length === 0)) {
    for (const c of own) {
      if ((required ? required.has(c.key) : setupColumnRequired(c, type)) && !index.has(c.key)) {
        missing.push(c.key);
        sink({
          severity: 'error', code: 'missing_column', sheet: sheet.name, column: c.header,
          message: `The ${sheet.name} sheet has no "${c.header}" column. Add a column headed "${c.header}" (or rename yours to it)${c.hint ? ` — ${c.hint}` : '.'}`,
        });
      }
    }
  }
  return { headers, has: (k) => index.has(k), rows, headerRow: headerIdx + 1, missing };
}

// ---------------------------------------------------------------------------
// 'fields' sheets (Event): Field | Value, one setting per row
// ---------------------------------------------------------------------------
export interface FieldsRead {
  /** Field key -> its value (blank-cleaned) and the row it is on. */
  get(key: string): { value: string; row: number } | undefined;
}

export function readFields(
  grid: unknown[][], sheet: SetupTemplateSheet, type: SetupEventType, sink: IssueSink,
): FieldsRead {
  const own = setupColumnsFor(sheet, type);
  const lookup = new Map<string, string>();
  for (const c of own) for (const h of [c.header, ...(c.aliases ?? [])]) lookup.set(setupHeaderKey(h), c.key);
  const other = new Set(sheet.columns.filter((c) => !own.includes(c)).map((c) => setupHeaderKey(c.header)));
  const values = new Map<string, { value: string; row: number }>();
  const unknown: string[] = [];
  const notForType: string[] = [];

  // A client who filled the Event sheet as a table (headers across row 1, values on
  // row 2) is read that way rather than refused.
  const first = grid.findIndex((r) => !isBlankRow(r));
  const across = first >= 0 ? grid[first].filter((c) => lookup.has(setupHeaderKey(cleanCell(c)))).length : 0;
  if (across >= 3) {
    const valuesRow = grid.findIndex((r, i) => i > first && !isBlankRow(r));
    grid[first].forEach((cell, i) => {
      const key = lookup.get(setupHeaderKey(cleanCell(cell)));
      if (key && !values.has(key)) {
        values.set(key, { value: valuesRow >= 0 ? cleanCell(grid[valuesRow][i]) : '', row: valuesRow >= 0 ? valuesRow + 1 : first + 1 });
      }
    });
    sink({
      severity: 'info', code: 'event_read_across', sheet: sheet.name, row: first + 1,
      message: 'The Event sheet has its fields across the top row rather than down column A; it was read that way.',
    });
    return { get: (k) => values.get(k) };
  }

  grid.forEach((r, i) => {
    if (isBlankRow(r)) return;
    const label = cleanCell(r[0]);
    const lk = setupHeaderKey(label);
    if (!lk) return;
    if ((lk === 'field' || lk === 'setting') && setupHeaderKey(cleanCell(r[1])) === 'value') return;
    const key = lookup.get(lk);
    if (!key) { (other.has(lk) ? notForType : unknown).push(label); return; }
    const value = r.slice(1).map(cleanCell).find((v) => v !== '') ?? '';
    const had = values.get(key);
    if (had && had.value && value && had.value !== value) {
      sink({
        severity: 'warning', code: 'duplicate_field', sheet: sheet.name, row: i + 1, column: label,
        message: `"${label}" is on the Event sheet twice (rows ${had.row} and ${i + 1}); row ${had.row} ("${had.value}") is used. Delete the other row.`,
      });
      return;
    }
    if (!had || (!had.value && value)) values.set(key, { value, row: i + 1 });
  });
  if (unknown.length) {
    sink({
      severity: 'info', code: 'unknown_fields', sheet: sheet.name,
      message: `Event: ${unknown.length === 1 ? 'this row is' : 'these rows are'} not part of the template and ${unknown.length === 1 ? 'was' : 'were'} ignored: ${quoteList(unknown)}.`,
    });
  }
  if (notForType.length) {
    sink({
      severity: 'info', code: 'field_not_used', sheet: sheet.name,
      message: `Event: ${quoteList(notForType)} ${notForType.length === 1 ? 'is' : 'are'} not used for a ${type} event and ${notForType.length === 1 ? 'was' : 'were'} ignored.`,
    });
  }
  return { get: (k) => values.get(k) };
}

// ---------------------------------------------------------------------------
// dates and times
// ---------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (word: string) => {
  const w = word.toLowerCase().slice(0, 3);
  const i = MONTHS.indexOf(w === 'sep' || word.toLowerCase().startsWith('sept') ? 'sep' : w);
  return i < 0 ? null : i + 1;
};
const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A calendar date as YYYY-MM-DD, or null. Reads YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY
 * (M/D only when the day cannot be the month: 10/17/2026), "17 Oct 2026",
 * "Oct 17, 2026", a weekday in front of any of those, and an Excel serial number.
 */
/**
 * A TEXT date that reads both ways — "10/11/2026" is 10 November day-first and 11
 * October month-first. parseDate reads it day-first (the Indian convention); the
 * caller warns, because the sheet cannot say which was meant. Real Excel date cells
 * never get here ambiguous: the shared reader turns them into YYYY-MM-DD.
 */
export function dateIsAmbiguous(raw: string): boolean {
  const m = cleanCell(raw).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[ T].*)?$/);
  if (!m) return false;
  const a = +m[1]; const b = +m[2];
  return a !== b && a >= 1 && a <= 12 && b >= 1 && b <= 12;
}

export function parseDate(raw: string): string | null {
  let s = cleanCell(raw);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[ T].*)?$/);
  if (m) {
    const a = +m[1]; const b = +m[2];
    return b > 12 && a <= 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a);
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 20000 || serial > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  s = s.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3,9})\.?,?[\s\-/]+(\d{4}|\d{2})$/);
  if (m) { const mo = monthOf(m[2]); return mo ? ymd(+m[3], mo, +m[1]) : null; }
  m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/]+(\d{4})$/);
  if (m) { const mo = monthOf(m[1]); return mo ? ymd(+m[3], mo, +m[2]) : null; }
  return null;
}

/** Minutes after midnight, or null. Reads 09:00, 9.00, 0900, 9:00 AM, 9 pm, 9:00:00 AM, noon. */
export function parseTime(raw: string): number | null {
  const s = cleanCell(raw).toLowerCase();
  if (!s) return null;
  if (s === 'noon' || s === '12 noon') return 720;
  let m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/);
  if (m) {
    const h = +m[1]; const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    return ((h % 12) + (m[4] === 'p' ? 12 : 0)) * 60 + min;
  }
  m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/) ?? s.match(/^(\d{1,2})(\d{2})$/);
  if (m) {
    const h = +m[1]; const min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  m = s.match(/^0?\.(\d{3,})$/);
  if (m) return Math.round(Number(`0.${m[1]}`) * 1440) % 1440;
  return null;
}

export const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// ---------------------------------------------------------------------------
// numbers and yes/no
// ---------------------------------------------------------------------------
/** A whole number >= 0, or null. "10" and "10.0" read; "ten", "-1" and "2.5" do not. */
export function parseWhole(raw: string): number | null {
  const s = cleanCell(raw).replace(/,/g, '');
  if (!/^\d+(?:\.0+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

/** A number >= 0 (decimals allowed), or null. */
export function parseAmount(raw: string): number | null {
  const s = cleanCell(raw).replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function parseYesNo(raw: string): boolean | null {
  const s = cleanCell(raw).toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------
/**
 * The first valid 10-digit Indian mobile in a cell ("+91 98765 43210",
 * "09876543210", "98765... / 91234..."). `bad` when the cell has text but no
 * valid mobile. A placeholder number reads as no mobile.
 */
export function parseMobile(raw: string): { phone?: string; bad?: boolean } {
  const s = cleanCell(raw);
  if (!s) return {};
  const parts = s.split(/[/,;|&]|\bor\b/i).map((p) => p.trim()).filter(Boolean);
  // A placeholder (50000xxxxx) from a re-uploaded export is no mobile at all.
  const real = parts.filter((p) => !isPlaceholderPhone(p));
  if (!real.length) return {};
  for (const part of real) {
    let d = part.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    else if (d.length === 20) d = d.slice(0, 10);
    if (/^[6-9]\d{9}$/.test(d)) return { phone: d };
  }
  return { bad: true };
}

const EMAIL = /^[^\s@,;/]+@[^\s@,;/]+\.[a-z]{2,}$/i;

/** The first well-formed email in a cell, lowercased. `bad` when the cell has text but no usable email; a placeholder address reads as none. */
export function parseEmail(raw: string): { email?: string; bad?: boolean } {
  const s = cleanCell(raw);
  if (!s) return {};
  const parts = s.split(/[\s,;/]+/)
    .map((part) => part.replace(/^mailto:/i, '').replace(/^[<(]+|[>)]+$/g, '').toLowerCase())
    .filter(Boolean);
  const real = parts.filter((e) => !isPlaceholderEmail(e));
  if (!real.length) return {};
  for (const e of real) if (EMAIL.test(e)) return { email: e };
  return { bad: true };
}

export const maskPhone = (p: string) => `${p.slice(0, 2)}xxxxxx${p.slice(-2)}`;
