import type { WorkBook, WorkSheet } from 'xlsx';
import {
  SETUP_WORKBOOK_LIMITS, SETUP_XLSX_READ_OPTS, setupSampleGrids, setupSheetsFromWorkbook, setupTemplateGrids, setupUsedRange,
  type SetupEventType, type SetupGrid, type SetupSteps,
} from '@semp/shared';
import type { ReadWorkbook } from './types';

// SheetJS, reached only through `await import('xlsx')` so it stays in its own lazy
// chunk (as lib/import.ts does) and never lands in the main bundle. The pure
// functions below take the module as an argument, which is what lets the tests
// drive them with a static import while the app never makes one. The type import
// above is erased at build time.

type XLSXModule = typeof import('xlsx');
const loadXlsx = (): Promise<XLSXModule> => import('xlsx');

export const templateFileName = (type: SetupEventType) => `sportagon-event-template-${type}.xlsx`;
export const sampleFileName = (type: SetupEventType) => `sportagon-event-sample-${type}.xlsx`;

/**
 * A column width per column, in characters: the longest line in the column plus a
 * little air, held between `min` and `max`. The Instructions sheet carries a
 * sentence per row, so the cap is what keeps one hint from making a column 200
 * characters wide.
 */
export function columnWidths(rows: string[][], { min = 8, max = 60 }: { min?: number; max?: number } = {}): number[] {
  const n = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths: number[] = [];
  for (let c = 0; c < n; c++) {
    let longest = 0;
    for (const r of rows) {
      const cell = r[c] ?? '';
      for (const line of cell.split(/\r?\n/)) longest = Math.max(longest, line.length);
    }
    widths.push(Math.min(max, Math.max(min, longest + 2)));
  }
  return widths;
}

/** Excel refuses sheet names over 31 characters or containing : \ / ? * [ ]. */
export const safeSheetName = (name: string) => name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet';

export function gridsToWorkbook(XLSX: XLSXModule, grids: SetupGrid[]): WorkBook {
  const wb = XLSX.utils.book_new();
  for (const g of grids) {
    const ws = XLSX.utils.aoa_to_sheet(g.rows.length ? g.rows : [[]]);
    ws['!cols'] = columnWidths(g.rows).map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(g.name));
  }
  return wb;
}

/** The cells that actually hold something, as a range from A1 (see @semp/shared setupUsedRange). */
export const usedRange = (XLSX: XLSXModule, ws: WorkSheet): string | null => setupUsedRange(XLSX, ws);

/**
 * Every sheet of a workbook as a grid of strings, keyed by the sheet's own name.
 * The shared reader is the one the CLI uses too, so the dashboard and the CLI can
 * never read one file differently — including real date cells, which it writes as
 * YYYY-MM-DD from the cell's value whatever their display format.
 */
export const workbookToSheets = (XLSX: XLSXModule, wb: WorkBook): Record<string, string[][]> =>
  setupSheetsFromWorkbook(XLSX, wb);

export async function readWorkbookFile(file: File): Promise<ReadWorkbook> {
  const XLSX = await loadXlsx();
  // The shared read options keep each cell's number format, so real date cells are
  // read from their value as YYYY-MM-DD whatever their display format.
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', ...SETUP_XLSX_READ_OPTS });
  return { fileName: file.name, sheets: workbookToSheets(XLSX, wb) };
}

export async function downloadGridsXlsx(grids: SetupGrid[], fileName: string): Promise<void> {
  const XLSX = await loadXlsx();
  XLSX.writeFile(gridsToWorkbook(XLSX, grids), fileName, { compression: true });
}

/** The blank template, or the filled-in sample, for an event type. */
/**
 * The blank template, or the filled-in sample, for an event type. Given a setup's
 * switches it is built for them (the same layout the validator reads by), and the
 * file is named after the setup so a client is never sent the generic one by mistake.
 */
export async function downloadSetupWorkbook(
  type: SetupEventType, kind: 'template' | 'sample',
  forSetup?: { steps: SetupSteps; label: string },
): Promise<void> {
  const grids = kind === 'template' ? setupTemplateGrids(type, forSetup?.steps) : setupSampleGrids(type, forSetup?.steps);
  const base = kind === 'template' ? templateFileName(type) : sampleFileName(type);
  await downloadGridsXlsx(grids, forSetup ? setupFileName(base, forSetup.label) : base);
}

/** "sportagon-event-template-intra.xlsx" + "WNS Football 2026" -> "sportagon-event-template-intra-wns-football-2026.xlsx" */
export function setupFileName(base: string, label: string): string {
  const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug ? base.replace(/\.xlsx$/, `-${slug}.xlsx`) : base;
}

/**
 * The API's upload caps, from @semp/shared so the two cannot drift. Checked here
 * first so the admin gets a sentence naming the sheet, not a bare 400/413.
 */
export const WORKBOOK_LIMITS = SETUP_WORKBOOK_LIMITS;

/** The JSON body /validate will receive, and its size in bytes. */
export function validatePayload(wb: ReadWorkbook): { body: { file_name: string; sheets: Record<string, string[][]> }; bytes: number } {
  const body = { file_name: wb.fileName.slice(0, 255), sheets: wb.sheets };
  return { body, bytes: new TextEncoder().encode(JSON.stringify(body)).length };
}

/** Why this workbook would be refused by the API, or null when it would not. */
export function workbookLimitProblem(wb: ReadWorkbook, bytes: number): string | null {
  const names = Object.keys(wb.sheets);
  if (names.length > WORKBOOK_LIMITS.sheets) {
    return `It has ${names.length} sheets; at most ${WORKBOOK_LIMITS.sheets} are read. Delete the sheets that are not part of the template.`;
  }
  for (const name of names) {
    const rows = wb.sheets[name];
    if (rows.length > WORKBOOK_LIMITS.rows) {
      return `Sheet "${name}" runs to row ${rows.length.toLocaleString()}; at most ${WORKBOOK_LIMITS.rows.toLocaleString()} rows are read. Delete stray cells far below the data, or split the sheet.`;
    }
    const wide = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (wide > WORKBOOK_LIMITS.columns) {
      return `Sheet "${name}" runs to column ${wide}; at most ${WORKBOOK_LIMITS.columns} columns are read. Delete stray cells far to the right of the data.`;
    }
  }
  if (bytes > WORKBOOK_LIMITS.bytes) {
    return `It reads to ${(bytes / (1024 * 1024)).toFixed(1)} MB; at most 2 MB is accepted. Remove sheets that are not part of the template, or split it.`;
  }
  return null;
}

/** Rows per sheet, for the "what was read" line under the upload box. */
export function sheetRowCounts(sheets: Record<string, string[][]>): Array<{ name: string; rows: number }> {
  return Object.entries(sheets).map(([name, rows]) => ({
    name,
    // Minus the header row; a sheet that is only a header has nothing in it.
    rows: Math.max(0, rows.filter((r) => r.some((c) => c.trim() !== '')).length - 1),
  }));
}
