import type { CredentialRow } from './types';

// CSV for the two files this dashboard hands to people outside the product: the
// issues list that goes back to the client, and the credentials that go to the
// organiser. Both are opened in Excel, which is what shapes the two rules below.

/**
 * A cell Excel would read as a formula is neutralised with a leading apostrophe.
 * Names and messages come from a client's sheet, so "=HYPERLINK(...)" in a squad
 * name must not become a live link in the organiser's credentials file. A plain
 * signed number ("+919876543210", "-5") is left alone: it is data, not a formula,
 * and mangling every phone number would be its own bug.
 */
export function csvSafe(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-]?\d[\d\s.]*$/.test(value)) return `'${value}`;
  return value;
}

const quote = (v: string) => (/[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((r) => r.map((c) => quote(csvSafe(c == null ? '' : String(c)))).join(','))
    .join('\r\n');
}

/**
 * Save text as a file. The BOM is what makes Excel open a UTF-8 CSV as UTF-8: a
 * client's sheet is full of names Excel would otherwise render as mojibake.
 */
export function downloadText(fileName: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download asynchronously and
  // a URL revoked in the same tick downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const downloadCsv = (fileName: string, rows: Array<Array<string | number | null | undefined>>) =>
  downloadText(fileName, toCsv(rows));

export function credentialsCsvRows(rows: CredentialRow[]): string[][] {
  return [
    ['Name', 'Role', 'Contact', 'Phone', 'Email', 'Password'],
    ...rows.map((r) => [r.name, r.role, r.contact, r.phone, r.email, r.password ?? '']),
  ];
}

/** "WNS Football 2026!" -> "wns-football-2026", for file names. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'setup';
}
