import { describe, it, expect } from 'vitest';
import { escapeLike, equalsIgnoreCase, inIgnoreCase } from './exact-ci.js';

// What Postgres' ILIKE does with the escaped pattern (backslash is its default
// escape), so the test checks behaviour rather than just the string we built.
function ilike(value: string, pattern: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    re += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is').test(value);
}

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
    expect(escapeLike('plain@x.in')).toBe('plain@x.in');
  });

  it('turns ILIKE into an exact, case-insensitive match', () => {
    const p = escapeLike('_kash@x.in');
    expect(ilike('akash@x.in', p)).toBe(false); // the wrong-account match this prevents
    expect(ilike('_kash@x.in', p)).toBe(true);
    expect(ilike('_KASH@X.IN', p)).toBe(true);
    expect(ilike('anything', escapeLike('%'))).toBe(false);
    expect(ilike('%', escapeLike('%'))).toBe(true);
    expect(ilike('a\\b', escapeLike('a\\b'))).toBe(true);
  });
});

describe('Prisma filter builders', () => {
  it('keep insensitive mode and escape every value', () => {
    expect(equalsIgnoreCase('a_b@x.in')).toEqual({ equals: 'a\\_b@x.in', mode: 'insensitive' });
    expect(inIgnoreCase(['a_b@x.in', 'c@x.in'])).toEqual({ in: ['a\\_b@x.in', 'c@x.in'], mode: 'insensitive' });
  });

  it('passes null and undefined through, keeping their Prisma meaning', () => {
    expect(equalsIgnoreCase(undefined)).toEqual({ equals: undefined, mode: 'insensitive' });
    expect(equalsIgnoreCase(null)).toEqual({ equals: null, mode: 'insensitive' });
  });
});
