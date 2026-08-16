// Spreadsheet/paste import helpers shared by the bulk-import flows (users, roster).
// CSV/paste is parsed locally; .xlsx is parsed with SheetJS, dynamically imported
// so the (heavy) library never lands in the main bundle.

export interface ImportColumn {
  key: string;            // canonical field name on the produced object
  aliases?: string[];     // accepted header spellings (lowercased)
}

// Auto-detect the delimiter from the header line (comma / tab / semicolon).
function detectDelimiter(line: string): string {
  const counts = [',', '\t', ';'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

// Minimal RFC-4180-ish parser: quoted fields, embedded delimiters and newlines.
export function parseDelimitedText(text: string): string[][] {
  const clean = text.replace(/^﻿/, ''); // strip BOM
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  // Drop fully-empty rows.
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// Read a picked file (.csv / .xlsx / .xls / .txt) into a string matrix.
export async function readFileToMatrix(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: '' });
    return matrix.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c !== ''));
  }
  return parseDelimitedText(await file.text());
}

// Map a header-led matrix onto typed objects using column definitions. Unknown
// headers are ignored; missing columns yield '' for that key.
export function matrixToRows<T extends Record<string, string>>(
  matrix: string[][], columns: ImportColumn[],
): T[] {
  if (matrix.length < 1) return [];
  const header = matrix[0].map((h) => h.toLowerCase().trim());
  const idxFor = (c: ImportColumn) => header.findIndex((h) => h === c.key || (c.aliases ?? []).includes(h));
  const mapped = columns.map((c) => ({ key: c.key, idx: idxFor(c) }));
  return matrix.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (const { key, idx } of mapped) obj[key] = idx >= 0 ? (r[idx] ?? '') : '';
    return obj as T;
  });
}

// A filled-in sample of the championship setup matrix, as a real .xlsx.
//
// Excel rather than CSV on purpose: the layout's whole shape is MERGED cells - one
// section name spanning its Name/Phone pair, one sport spanning its Captain and POC
// rows - and that is exactly what the parser forward-fills. A CSV sample would
// teach the flattened version and leave people guessing what their own merged
// sheet is supposed to look like.
//
// SheetJS is imported dynamically, as it is for reading, so the (heavy) library
// stays out of the main bundle.
export async function downloadMatrixTemplate(filename = 'championship-setup-sample.xlsx'): Promise<void> {
  const XLSX = await import('xlsx');

  // Two institutions across, two sports down, plus the "Overall" block the parser
  // reads section-level POCs from.
  const aoa: string[][] = [
    ['', '', 'IIM Bangalore', '', 'IIM Ahmedabad', ''],
    ['', '', 'Name', 'Phone Number', 'Name', 'Phone Number'],
    ['Overall', 'Overall POC', 'Asha Rao', '9876543210', 'Ravi Kumar', '9876500011'],
    ['Basketball (Men)', 'Captain', 'Neha Mishra', '9876500022', 'Arjun Nair', '9876500033'],
    ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
    ['Basketball (Women)', 'Captain', 'Priya Menon', '9876500066', 'Sana Khan', '9876500077'],
    ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
    ['Badminton', 'Captain', 'Rahul Verma', '9876500088', 'Dev Patel', '9876500099'],
    ['', 'POC', 'Kiran Shah', '9876500044', 'Meera Iyer', '9876500055'],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!merges'] = [
    // Each section name spans its own Name + Phone Number pair.
    { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
    // Each sport spans its Captain and POC rows.
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
    { s: { r: 7, c: 0 }, e: { r: 8, c: 0 } },
  ];
  sheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Setup');
  XLSX.writeFile(wb, filename);
}

// Trigger a browser download of a CSV template (headers + optional sample rows).
export function downloadCsvTemplate(filename: string, headers: string[], sample: string[][] = []): void {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [headers, ...sample].map((r) => r.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
