import { describe, expect, it } from 'vitest';
import { credentialsCsvRows, csvSafe, slug, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes cells holding a comma, quote or newline, and doubles inner quotes', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'two\nlines']])).toBe('a,"b,c","say ""hi""","two\nlines"');
  });

  it('joins rows with CRLF and writes null/undefined as empty', () => {
    expect(toCsv([['h1', 'h2'], [null, undefined], [1, 'x']])).toBe('h1,h2\r\n,\r\n1,x');
  });

  it('quotes cells with leading or trailing spaces so Excel keeps them', () => {
    expect(toCsv([[' padded ']])).toBe('" padded "');
  });
});

describe('csvSafe', () => {
  it('neutralises cells Excel would run as formulas', () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(csvSafe('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvSafe('+cmd|x')).toBe(`'+cmd|x`);
    expect(csvSafe('-2+3')).toBe(`'-2+3`);
  });

  it('leaves phone numbers, signed numbers and ordinary text alone', () => {
    expect(csvSafe('+919876543210')).toBe('+919876543210');
    expect(csvSafe('-5')).toBe('-5');
    expect(csvSafe('9876543210')).toBe('9876543210');
    expect(csvSafe('Aarav Shah')).toBe('Aarav Shah');
    expect(csvSafe('')).toBe('');
  });

  it('applies inside toCsv', () => {
    expect(toCsv([['=1+1', 'ok']])).toBe(`'=1+1,ok`);
  });
});

describe('credentialsCsvRows', () => {
  it('writes the header and every login, blank where there is no password', () => {
    const rows = credentialsCsvRows([
      { name: 'Aarav Shah', role: 'Captain', contact: 'real', phone: '9876543210', email: 'a@acme.com', password: 'aarav@3210' },
      { name: 'Dev Joshi', role: 'Player', contact: 'placeholder', phone: '5000000001', email: 'dev-x-1@placeholder.invalid', password: null },
    ]);
    expect(rows).toEqual([
      ['Name', 'Role', 'Contact', 'Phone', 'Email', 'Password'],
      ['Aarav Shah', 'Captain', 'real', '9876543210', 'a@acme.com', 'aarav@3210'],
      ['Dev Joshi', 'Player', 'placeholder', '5000000001', 'dev-x-1@placeholder.invalid', ''],
    ]);
  });
});

describe('slug', () => {
  it('makes a file-name-safe slug', () => {
    expect(slug('WNS Football 2026!')).toBe('wns-football-2026');
    expect(slug('  ***  ')).toBe('setup');
  });
});
