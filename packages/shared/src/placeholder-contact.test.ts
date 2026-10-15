import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_EMAIL_DOMAIN, hasPlaceholderContact, isPlaceholderEmail, isPlaceholderPhone,
  placeholderEmail, placeholderPhone,
} from './placeholder-contact.js';
import { updateUserSchema } from './schemas.js';

describe('placeholderPhone', () => {
  it('pads the seq into the 50000xxxxx range', () => {
    expect(placeholderPhone(0)).toBe('5000000000');
    expect(placeholderPhone(17)).toBe('5000000017');
    expect(placeholderPhone(99999)).toBe('5000099999');
  });

  it('refuses a seq that would leave the range or is not a whole number', () => {
    expect(() => placeholderPhone(-1)).toThrow(RangeError);
    expect(() => placeholderPhone(100000)).toThrow(RangeError);
    expect(() => placeholderPhone(1.5)).toThrow(RangeError);
  });

  it('builds numbers the phone validator accepts, so provisioning can store them', () => {
    expect(updateUserSchema.safeParse({ phone: placeholderPhone(390) }).success).toBe(true);
  });
});

describe('isPlaceholderPhone', () => {
  it('matches on the last 10 digits, whatever the formatting or country code', () => {
    expect(isPlaceholderPhone('5000000017')).toBe(true);
    expect(isPlaceholderPhone('+91 50000 00017')).toBe(true);
    expect(isPlaceholderPhone('91-5000000017')).toBe(true);
  });

  it('does not flag real numbers, short numbers or nothing', () => {
    expect(isPlaceholderPhone('9876543210')).toBe(false);
    expect(isPlaceholderPhone('+91 98765 43210')).toBe(false);
    expect(isPlaceholderPhone('5000012')).toBe(false); // too short to be a login phone
    expect(isPlaceholderPhone('5001234567')).toBe(false); // 5-prefixed but outside 50000
    expect(isPlaceholderPhone(null)).toBe(false);
    expect(isPlaceholderPhone(undefined)).toBe(false);
    expect(isPlaceholderPhone('')).toBe(false);
  });
});

describe('placeholderEmail', () => {
  it('slugs anything into a valid address on the placeholder domain', () => {
    expect(placeholderEmail('Rohit Gupta #17')).toBe('rohit-gupta-17@placeholder.invalid');
    expect(placeholderEmail('  Zoë  Ångström ')).toBe('zoe-angstrom@placeholder.invalid');
    expect(placeholderEmail(9876543210)).toBe('9876543210@placeholder.invalid');
  });

  it('matches the address the roster import already writes', () => {
    // people.routes / teams.routes build `${phoneLast10}@placeholder.invalid`.
    expect(placeholderEmail('9876543210')).toBe(`9876543210@${PLACEHOLDER_EMAIL_DOMAIN}`);
  });

  it('caps the local part at 64 without leaving a trailing dash', () => {
    const local = placeholderEmail(`${'a'.repeat(63)} b`).split('@')[0];
    expect(local.length).toBeLessThanOrEqual(64);
    expect(local.endsWith('-')).toBe(false);
  });

  it('refuses a slug with nothing usable in it', () => {
    expect(() => placeholderEmail('  #!  ')).toThrow(RangeError);
  });

  it('builds addresses the email validator accepts', () => {
    expect(updateUserSchema.safeParse({ email: placeholderEmail('Rohit Gupta') }).success).toBe(true);
  });
});

describe('isPlaceholderEmail / hasPlaceholderContact', () => {
  it('matches the domain case- and padding-insensitively', () => {
    expect(isPlaceholderEmail('rohit@placeholder.invalid')).toBe(true);
    expect(isPlaceholderEmail(' Rohit@Placeholder.INVALID ')).toBe(true);
    expect(isPlaceholderEmail('rohit@placeholder.invalid.com')).toBe(false);
    expect(isPlaceholderEmail('rohit@notplaceholder.invalid')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  it('flags an account when either half is a stand-in, but not a missing phone', () => {
    expect(hasPlaceholderContact({ email: 'a@placeholder.invalid', phone: '9876543210' })).toBe(true);
    expect(hasPlaceholderContact({ email: 'a@sportagon.in', phone: '5000000001' })).toBe(true);
    expect(hasPlaceholderContact({ email: 'a@sportagon.in', phone: null })).toBe(false);
    expect(hasPlaceholderContact({ email: 'a@sportagon.in', phone: '9876543210' })).toBe(false);
    expect(hasPlaceholderContact(null)).toBe(false);
  });
});

describe('updateUserSchema.email', () => {
  it('trims and lowercases on the way in', () => {
    const r = updateUserSchema.parse({ email: '  Asha.Rao@IIMB.ac.in ' });
    expect(r.email).toBe('asha.rao@iimb.ac.in');
  });

  it('is optional, and rejects a malformed address', () => {
    expect(updateUserSchema.parse({ name: 'Asha' }).email).toBeUndefined();
    expect(updateUserSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ email: '   ' }).success).toBe(false);
  });
});
