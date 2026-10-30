/*
 * READING AN UPLOADED WORKBOOK INTO GRIDS - the one way both the dashboard (in the
 * browser) and the CLI (in node) turn a SheetJS workbook into the string grids the
 * validator reads, so the two can never read the same file differently.
 *
 * SheetJS itself is passed in, never imported: the browser loads it lazily in its own
 * chunk, and this package does not depend on it.
 */

/** The upload caps the API enforces on /event-setups/:id/validate. The dashboard checks them first. */
export const SETUP_WORKBOOK_LIMITS = { bytes: 2 * 1024 * 1024, sheets: 20, rows: 5000, columns: 200 } as const;

/**
 * How to `XLSX.read` an uploaded workbook before `setupSheetsFromWorkbook`.
 * `cellNF` keeps each cell's number format - without it a date cell is a bare
 * number and its date-ness is lost, so a cell formatted mm/dd/yyyy could only be read
 * from its display text, month-first. `dateNF` covers the locale short date (format 14).
 */
export const SETUP_XLSX_READ_OPTS = { cellNF: true, dateNF: 'yyyy-mm-dd' } as const;

/** A setup stuck in 'applying' this long, with no job running, may be recovered. */
export const SETUP_STALE_APPLY_MS = 10 * 60 * 1000;

interface Cell { t?: string; v?: unknown; w?: string; z?: string | number }
type Sheet = Record<string, unknown>;

/** The slice of the SheetJS module this file uses. `typeof import('xlsx')` satisfies it. */
export interface SetupXlsxLike {
  utils: {
    decode_cell(address: string): { r: number; c: number };
    encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
    sheet_to_json<T>(sheet: any, opts?: any): T[];
  };
  SSF: any;
}

export interface SetupWorkbookLike {
  SheetNames: string[];
  Sheets: Record<string, any>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A real Excel date cell, as the template asks for it: YYYY-MM-DD (plus HH:MM when
 * it also carries a time). Taken from the cell's VALUE, never its display text - a
 * cell formatted mm/dd/yyyy shows "10/11/2026" for 11 October, which a day-first
 * reader would take for 10 November. Time-only cells (a kickoff typed as 9:00 AM)
 * are left as Excel shows them; the validator reads those.
 */
function isoDateText(XLSX: SetupXlsxLike, cell: Cell): string | null {
  let serial: number | null = null;
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v;
    const time = d.getHours() * 60 + d.getMinutes();
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return time ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
  }
  if (cell.t === 'n' && typeof cell.v === 'number' && cell.z != null) {
    let isDate = false;
    try { isDate = !!XLSX.SSF?.is_date?.(cell.z); } catch { isDate = false; }
    if (isDate) serial = cell.v;
  }
  if (serial == null || serial < 1) return null; // time-only (0 <= v < 1) or not a date
  const p = XLSX.SSF?.parse_date_code?.(serial) as { y: number; m: number; d: number; H: number; M: number } | null | undefined;
  if (!p || !p.y) return null;
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return p.H || p.M ? `${date} ${pad(p.H)}:${pad(p.M)}` : date;
}

/**
 * The cells that actually hold something, as a range from A1.
 *
 * From A1, not the sheet's own `!ref`, so grid row i is always Excel row i+1 - the
 * validator reports issues by Excel row number, and a sheet whose data starts at B3
 * would otherwise be off by two in every message. And from the cells, not `!ref`,
 * because a sheet formatted down to row 1,048,576 claims a range a million rows long.
 */
export function setupUsedRange(XLSX: SetupXlsxLike, ws: Sheet): string | null {
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const cell = ws[key] as Cell | undefined;
    const text = cell?.w ?? (cell?.v == null ? '' : String(cell.v));
    if (!String(text).trim()) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) return null;
  return XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
}

/** Every sheet of a workbook as a grid of strings, keyed by the sheet's own name. */
export function setupSheetsFromWorkbook(XLSX: SetupXlsxLike, wb: SetupWorkbookLike): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name] as Sheet | undefined;
    const range = ws ? setupUsedRange(XLSX, ws) : null;
    if (!ws || !range) { out[name] = []; continue; }
    for (const key of Object.keys(ws)) {
      if (key.startsWith('!')) continue;
      const cell = ws[key] as Cell;
      const iso = isoDateText(XLSX, cell);
      if (iso) cell.w = iso;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', range });
    out[name] = rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
  }
  return out;
}
