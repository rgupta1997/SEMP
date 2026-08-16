import { describe, it, expect } from 'vitest';
import { parseDob, parseGender, parseScholarship, validateRoster, type RosterContext, type RosterRow } from './roster-import.js';

// The dry run IS the feature (J1-E5-S1): a coordinator uploads 2,000 rows and
// has to be told what will happen before anything happens. Every rejection below
// is a rejection rather than a silent fix, because a roll silently "corrected"
// on import is one nobody can reconcile against their own records afterwards.

const ctx = (over: Partial<RosterContext> = {}): RosterContext => ({
  usersByPhone: new Map(),
  usersByEmail: new Map(),
  unitsByName: new Map([
    ['computer science', { id: 'unit-cs', type: 'programme' }],
    ['2024', { id: 'unit-2024', type: 'batch' }],
  ]),
  memberUserIds: new Set(),
  memberCodeOwner: new Map(),
  ...over,
});

const row = (o: Partial<RosterRow> = {}): RosterRow => ({ name: 'Asha Rao', phone: '9876543210', ...o });

describe('validateRoster · resolution', () => {
  it('creates when nobody matches', () => {
    const r = validateRoster([row()], ctx()).rows[0];
    expect(r.verdict).toBe('create');
    expect(r.user_id).toBeNull();
  });

  it('matches by phone before email', () => {
    const c = ctx({
      usersByPhone: new Map([['9876543210', { id: 'u-phone', name: 'By Phone' }]]),
      usersByEmail: new Map([['asha@iimb.ac.in', { id: 'u-email', name: 'By Email' }]]),
    });
    const r = validateRoster([row({ email: 'asha@iimb.ac.in' })], c).rows[0];
    expect(r.verdict).toBe('match');
    expect(r.user_id).toBe('u-phone');
  });

  it('falls back to email when there is no phone', () => {
    const c = ctx({ usersByEmail: new Map([['asha@iimb.ac.in', { id: 'u-email', name: 'By Email' }]]) });
    const r = validateRoster([{ name: 'Asha Rao', email: 'Asha@IIMB.ac.in' }], c).rows[0];
    expect(r.user_id).toBe('u-email');
  });

  it('reports an existing member as an update, not a second add', () => {
    const c = ctx({
      usersByPhone: new Map([['9876543210', { id: 'u1', name: 'Asha' }]]),
      memberUserIds: new Set(['u1']),
    });
    expect(validateRoster([row()], c).rows[0].verdict).toBe('update');
  });
});

describe('validateRoster · rejections', () => {
  it('needs a name and at least one way to reach them', () => {
    expect(validateRoster([{ name: '' }], ctx()).rows[0].message).toMatch(/name is required/i);
    expect(validateRoster([{ name: 'Asha' }], ctx()).rows[0].message).toMatch(/email or a 10-digit phone/i);
  });

  it('refuses a malformed email or phone rather than dropping the field', () => {
    expect(validateRoster([row({ phone: '12345' })], ctx()).rows[0].message).toMatch(/10-digit/);
    expect(validateRoster([row({ email: 'not-an-email' })], ctx()).rows[0].message).toMatch(/not a valid email/i);
  });

  // The epic calls this one out by name: BOTH rows must be flagged, not just
  // the second - otherwise the coordinator is hunting for the other half.
  it('flags both halves of a duplicate phone pair', () => {
    const report = validateRoster([row(), row({ name: 'Someone Else' })], ctx());
    expect(report.rows.map((r) => r.verdict)).toEqual(['reject', 'reject']);
    expect(report.rows[0].message).toMatch(/more than one row/i);
    expect(report.summary.reject).toBe(2);
  });

  it('flags duplicate emails and duplicate member codes in the file too', () => {
    const dupEmail = validateRoster(
      [{ name: 'A', email: 'x@y.com' }, { name: 'B', email: 'X@Y.com' }], ctx(),
    );
    expect(dupEmail.summary.reject).toBe(2);

    const dupCode = validateRoster(
      [row({ member_code: 'CS-1' }), row({ phone: '9000000000', member_code: 'cs-1' })], ctx(),
    );
    expect(dupCode.rows.every((r) => r.message.match(/member code appears on more than one row/i))).toBe(true);
  });

  // No org unit is ever created implicitly - a typo would found a department.
  it('rejects a programme or batch that does not exist', () => {
    const r = validateRoster([row({ programme: 'Compter Science' })], ctx()).rows[0];
    expect(r.verdict).toBe('reject');
    expect(r.message).toMatch(/no programme called "Compter Science" exists/i);
  });

  it('resolves a known programme, and lets batch win when both are given', () => {
    const prog = validateRoster([row({ programme: 'Computer Science' })], ctx()).rows[0];
    expect(prog.org_unit_id).toBe('unit-cs');
    const both = validateRoster([row({ programme: 'Computer Science', batch: '2024' })], ctx()).rows[0];
    expect(both.org_unit_id).toBe('unit-2024');
  });

  it('refuses a member code already held by somebody else here', () => {
    const c = ctx({ memberCodeOwner: new Map([['cs-1', 'someone-else']]) });
    expect(validateRoster([row({ member_code: 'CS-1' })], c).rows[0].message).toMatch(/already belongs to someone else/i);
  });

  it('allows a person to keep their own member code on re-import', () => {
    const c = ctx({
      usersByPhone: new Map([['9876543210', { id: 'u1', name: 'Asha' }]]),
      memberUserIds: new Set(['u1']),
      memberCodeOwner: new Map([['cs-1', 'u1']]),
    });
    expect(validateRoster([row({ member_code: 'CS-1' })], c).rows[0].verdict).toBe('update');
  });
});

describe('demographics parsing (J1-E5-S4)', () => {
  it('reads the spellings a spreadsheet actually contains', () => {
    expect(parseGender('F')).toBe('female');
    expect(parseGender('Male')).toBe('male');
    expect(parseGender('Non-Binary')).toBe('other');
  });

  // Non-disclosure is its own category. Collapsing it to null makes the
  // diversity report silently exclude the people it is meant to measure.
  it('keeps "prefer not to say" as a value, distinct from absent', () => {
    expect(parseGender('Prefer not to say')).toBe('prefer_not_to_say');
    expect(parseGender('Not disclosed')).toBe('prefer_not_to_say');
    expect(parseGender('')).toBeNull();
    expect(parseGender(null)).toBeNull();
  });

  it('rejects an unrecognised gender rather than guessing', () => {
    expect(parseGender('male-ish')).toBe('invalid');
    expect(validateRoster([row({ gender: 'male-ish' })], ctx()).rows[0].message).toMatch(/not a recognised gender/i);
  });

  it('takes ISO dates only - an ambiguous 03/04/2005 is refused, not guessed', () => {
    expect(parseDob('2005-04-03')).toBe('2005-04-03');
    expect(parseDob('03/04/2005')).toBe('invalid');
    expect(parseDob('2005-02-30')).toBe('invalid');
    expect(parseDob('3005-01-01')).toBe('invalid');   // in the future
    expect(parseDob('')).toBeNull();
  });

  it('reads yes/no scholarship values and refuses anything else', () => {
    expect(parseScholarship('Yes')).toBe(true);
    expect(parseScholarship('N')).toBe(false);
    expect(parseScholarship(true)).toBe(true);
    expect(parseScholarship(null)).toBeNull();
    expect(parseScholarship('maybe')).toBe('invalid');
  });

  it('carries the parsed demographics onto the row result', () => {
    const r = validateRoster([row({ gender: 'F', date_of_birth: '2005-04-03', scholarship: 'yes' })], ctx()).rows[0];
    expect(r).toMatchObject({ gender: 'female', date_of_birth: '2005-04-03', scholarship: true });
  });
});

describe('the report as a whole', () => {
  it('counts every verdict and keeps rows in file order', () => {
    const report = validateRoster([
      row({ name: 'New Person' }),
      { name: 'No contact details' },
      row({ name: 'Existing', phone: '9000000001' }),
    ], ctx({ usersByPhone: new Map([['9000000001', { id: 'u1', name: 'Existing' }]]) }));

    expect(report.rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(report.summary).toEqual({ total: 3, create: 1, match: 1, update: 0, reject: 1 });
  });
});
