import { describe, expect, it } from 'vitest';
// A static import is fine in a test: tests are never bundled. The app itself only
// ever reaches SheetJS through the dynamic import inside xlsx.ts.
import * as XLSX from 'xlsx';
import {
  columnWidths, gridsToWorkbook, readWorkbookFile, safeSheetName, sampleFileName, sheetRowCounts,
  setupFileName, templateFileName, usedRange, validatePayload, WORKBOOK_LIMITS, workbookLimitProblem, workbookToSheets,
} from './xlsx';
import { SETUP_XLSX_READ_OPTS } from '@semp/shared';

const roundTrip = (wb: XLSX.WorkBook) =>
  XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });

describe('columnWidths', () => {
  it('fits the longest cell per column plus air, within bounds', () => {
    expect(columnWidths([['Squad name', 'ID'], ['Acme Strikers FC', '1']])).toEqual([18, 8]);
  });

  it('caps a long sentence and measures multi-line cells by their longest line', () => {
    const long = 'x'.repeat(300);
    expect(columnWidths([[long]])).toEqual([60]);
    expect(columnWidths([[long]], { max: 80 })).toEqual([80]);
    expect(columnWidths([['short\n' + 'y'.repeat(20)]])).toEqual([22]);
  });

  it('copes with ragged rows', () => {
    expect(columnWidths([['a'], ['b', 'cccccccccccc']])).toEqual([8, 14]);
  });
});

describe('file names', () => {
  it('follows the agreed pattern', () => {
    expect(templateFileName('intra')).toBe('sportagon-event-template-intra.xlsx');
    expect(sampleFileName('campus')).toBe('sportagon-event-sample-campus.xlsx');
  });

  it('keeps sheet names Excel will accept', () => {
    expect(safeSheetName('A/B:C')).toBe('A B C');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
  });
});

describe('gridsToWorkbook -> workbookToSheets', () => {
  it('round-trips every sheet as strings, in order, with column widths', () => {
    const grids = [
      { name: 'Instructions', rows: [['Sheet', 'Purpose'], ['Event', 'One row per setting']] },
      { name: 'Event', rows: [['Field', 'Value'], ['Event name', ''], ['Start date', '']] },
      { name: 'Squads', rows: [['Squad name', 'Captain mobile', 'Player 1']] },
    ];
    const wb = gridsToWorkbook(XLSX, grids);
    expect(wb.SheetNames).toEqual(['Instructions', 'Event', 'Squads']);
    expect(wb.Sheets.Squads['!cols']).toEqual([{ wch: 12 }, { wch: 16 }, { wch: 10 }]);

    const sheets = workbookToSheets(XLSX, roundTrip(wb));
    expect(Object.keys(sheets)).toEqual(['Instructions', 'Event', 'Squads']);
    expect(sheets.Event).toEqual([['Field', 'Value'], ['Event name', ''], ['Start date', '']]);
    expect(sheets.Squads).toEqual([['Squad name', 'Captain mobile', 'Player 1']]);
  });

  it('keeps grid row i aligned with Excel row i+1 when the data starts below A1', () => {
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [['Squad name', 'Sport'], ['Acme', 'Football']], { origin: 'B3' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Squads');
    const grid = workbookToSheets(XLSX, roundTrip(wb)).Squads;
    expect(grid).toHaveLength(4);
    expect(grid[0]).toEqual(['', '', '']);
    expect(grid[2]).toEqual(['', 'Squad name', 'Sport']);
    expect(grid[3]).toEqual(['', 'Acme', 'Football']);
  });

  it('reads numbers as the text Excel shows, not as numbers', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Captain mobile'], [9876543210]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Squads');
    expect(workbookToSheets(XLSX, roundTrip(wb)).Squads).toEqual([['Captain mobile'], ['9876543210']]);
  });

  it('reads an empty sheet as an empty grid', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'People');
    expect(workbookToSheets(XLSX, roundTrip(wb)).People).toEqual([]);
  });
});

describe('usedRange', () => {
  it('ignores a claimed range far larger than the cells that hold something', () => {
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], ['c', '']]);
    ws['!ref'] = 'A1:Z100000';
    expect(usedRange(XLSX, ws)).toBe('A1:B2');
  });

  it('is null for a sheet with nothing in it', () => {
    expect(usedRange(XLSX, XLSX.utils.aoa_to_sheet([['', '  ']]))).toBeNull();
  });
});

describe('readWorkbookFile', () => {
  it('reads a picked .xlsx through the lazy import, dates as ISO', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ['Start date', new Date(2026, 9, 17)]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Event');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([bytes], 'client.xlsx');
    const read = await readWorkbookFile(file);
    expect(read.fileName).toBe('client.xlsx');
    expect(read.sheets.Event).toEqual([['Field', 'Value'], ['Start date', '2026-10-17']]);
  });
});

describe('workbook limits (mirroring the API)', () => {
  const wb = (sheets: Record<string, string[][]>) => ({ fileName: 'w.xlsx', sheets });
  const check = (sheets: Record<string, string[][]>) => {
    const w = wb(sheets);
    return workbookLimitProblem(w, validatePayload(w).bytes);
  };

  it('passes an ordinary workbook', () => {
    expect(check({ Event: [['Field', 'Value']], Squads: [['Squad name'], ['Acme']] })).toBeNull();
  });

  it('names the sheet that has too many rows or columns', () => {
    const tall = Array.from({ length: WORKBOOK_LIMITS.rows + 1 }, () => ['x']);
    expect(check({ Squads: tall })).toMatch(/Sheet "Squads" runs to row/);
    const wide = [Array.from({ length: WORKBOOK_LIMITS.columns + 1 }, () => 'x')];
    expect(check({ People: wide })).toMatch(/Sheet "People" runs to column/);
  });

  it('refuses too many sheets, and too many bytes', () => {
    const many = Object.fromEntries(Array.from({ length: WORKBOOK_LIMITS.sheets + 1 }, (_, i) => [`S${i}`, []]));
    expect(check(many)).toMatch(/sheets/);
    const big = { Squads: Array.from({ length: 4000 }, () => Array.from({ length: 60 }, () => 'abcdefghij')) };
    expect(check(big)).toMatch(/MB/);
  });

  it('caps the file name at the API limit', () => {
    expect(validatePayload(wb({ A: [] })).body.file_name).toBe('w.xlsx');
    expect(validatePayload({ fileName: 'n'.repeat(300), sheets: {} }).body.file_name).toHaveLength(255);
  });
});

describe('sheetRowCounts', () => {
  it('counts data rows below the header, ignoring blank rows', () => {
    expect(sheetRowCounts({ Squads: [['h'], ['a'], [''], ['b']], People: [['h']], Empty: [] })).toEqual([
      { name: 'Squads', rows: 2 }, { name: 'People', rows: 0 }, { name: 'Empty', rows: 0 },
    ]);
  });
});

describe('real Excel date cells', () => {
  // 11 October 2026 as an Excel serial, under display formats that read both ways.
  const serial = (Date.UTC(2026, 9, 11) - Date.UTC(1899, 11, 30)) / 864e5;
  const readBack = (z: string, v = serial) => {
    const ws = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ['Start date', '']]);
    ws.B2 = { t: 'n', v, z };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Event');
    const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', ...SETUP_XLSX_READ_OPTS });
    return workbookToSheets(XLSX, back).Event[1][1];
  };

  it.each(['mm/dd/yyyy', 'dd/mm/yyyy', 'm/d/yy', 'dd-mmm-yy', 'd mmmm yyyy'])('reads a %s cell from its value as YYYY-MM-DD', (z) => {
    expect(readBack(z)).toBe('2026-10-11');
  });

  it('keeps the time on a date-and-time cell, and leaves a time-only cell as shown', () => {
    expect(readBack('mm/dd/yyyy hh:mm', serial + 0.6)).toBe('2026-10-11 14:24');
    expect(readBack('h:mm AM/PM', 0.375)).toBe('9:00 AM');
  });
});

describe('setupFileName', () => {
  it('names the download of a setup after the setup', () => {
    expect(setupFileName('sportagon-event-template-intra.xlsx', 'WNS Football Championship 2026'))
      .toBe('sportagon-event-template-intra-wns-football-championship-2026.xlsx');
    expect(setupFileName('sportagon-event-sample-inter.xlsx', '  Inter IIM — 2026 ')).toBe('sportagon-event-sample-inter-inter-iim-2026.xlsx');
    expect(setupFileName('sportagon-event-template-campus.xlsx', '!!!')).toBe('sportagon-event-template-campus.xlsx');
  });
});
