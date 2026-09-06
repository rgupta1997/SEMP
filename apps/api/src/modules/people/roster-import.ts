import { phoneLast10 } from '../iam/users.helpers.js';

// Validating a student roll before a single row is written (J1-E5-S1).
//
// Pure: rows in, a per-row verdict out. The database is consulted by the caller
// and handed in as `existing`; nothing here reads or writes anything. That is
// what lets the validate endpoint and the apply endpoint reach the same verdict
// from the same code, which is the whole point of a dry run - a report that
// disagrees with what the import then does is worse than no report.
//
// Three rules the epic is explicit about, and each is a rejection rather than a
// silent fix:
//
//   * a programme or batch that does not exist is REJECTED. No org unit is ever
//     created implicitly - a typo would otherwise quietly found a new department.
//   * two rows sharing a phone are BOTH flagged, before import, as a pair.
//   * a member code already used by someone else in this institution is rejected;
//     roll numbers are the institution's own key and two people cannot share one.

export const IMPORT_VERDICTS = ['create', 'match', 'update', 'reject'] as const;
export type ImportVerdict = (typeof IMPORT_VERDICTS)[number];

export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export type Gender = (typeof GENDERS)[number];

export interface RosterRow {
  /**
   * A SPECIFIC account, already disambiguated by the caller (the search-and-link
   * picker), rather than left for phone/email matching to guess at. Necessary
   * because a phone number is not an identity here - Option B (see
   * accounts.service.ts) lets one number back several accounts with different
   * emails, and `usersByPhone` below can only ever hold one of them. When this is
   * set it wins outright: name/email/phone on the row are ignored for matching
   * purposes (though harmless if a manual row also happens to carry them).
   */
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Names of existing org units - NOT created if absent. */
  campus?: string | null;
  department?: string | null;
  /** Accepted aliases for campus/department - see the note on the request schema. */
  programme?: string | null;
  batch?: string | null;
  member_code?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  scholarship?: boolean | string | null;
}

/** What the caller looked up in the database so this can stay pure. */
export interface RosterContext {
  /** Existing accounts, by last-10 phone digits. Collapses to ONE per number even
   * when several accounts share it (Option B) - which is exactly why a row that
   * already knows which account it means should carry `user_id` instead of
   * relying on this. */
  usersByPhone: Map<string, { id: string; name: string }>;
  /** Existing accounts, by lowercased email. */
  usersByEmail: Map<string, { id: string; name: string }>;
  /** Accounts explicitly referenced by a row's `user_id`, keyed by that id. */
  usersById: Map<string, { id: string; name: string; email: string }>;
  /** Org units of this institution: lowercased name -> { id, type }. */
  unitsByName: Map<string, { id: string; type: string }>;
  /** Members already in this institution, by user id. */
  memberUserIds: Set<string>;
  /** member_code (lowercased) -> the user id already holding it here. */
  memberCodeOwner: Map<string, string>;
}

export interface RosterRowResult {
  index: number;
  verdict: ImportVerdict;
  /** Why it was rejected, or what will happen. One sentence, shown per row. */
  message: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Resolved on a match; null when the person will be created. */
  user_id: string | null;
  /** Every unit this row named, resolved - a row can place someone in both a
   * campus and a department at once. Empty when it named none. */
  org_unit_ids: string[];
  member_code: string | null;
  gender: Gender | null;
  date_of_birth: string | null;
  scholarship: boolean | null;
}

export interface RosterReport {
  rows: RosterRowResult[];
  summary: { total: number; create: number; match: number; update: number; reject: number };
}

const norm = (s?: string | null) => (s ?? '').trim();
const lower = (s?: string | null) => norm(s).toLowerCase();

// Accepts what a spreadsheet actually contains. 'Prefer not to say', 'F',
// 'Female' all land on the same value; anything unrecognised is a rejection
// rather than a guess, because guessing here corrupts a diversity report.
const GENDER_ALIASES: Record<string, Gender> = {
  m: 'male', male: 'male', man: 'male',
  f: 'female', female: 'female', woman: 'female',
  o: 'other', other: 'other', nonbinary: 'other', 'non-binary': 'other',
  'prefer not to say': 'prefer_not_to_say', prefer_not_to_say: 'prefer_not_to_say',
  'not disclosed': 'prefer_not_to_say', undisclosed: 'prefer_not_to_say', na: 'prefer_not_to_say',
};

export function parseGender(raw?: string | null): Gender | null | 'invalid' {
  const key = lower(raw).replace(/\s+/g, ' ');
  if (!key) return null;
  return GENDER_ALIASES[key] ?? 'invalid';
}

const TRUTHY = new Set(['true', 'yes', 'y', '1']);
const FALSY = new Set(['false', 'no', 'n', '0', '']);

export function parseScholarship(raw?: boolean | string | null): boolean | null | 'invalid' {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw;
  const key = lower(raw);
  if (!key) return null;
  if (TRUTHY.has(key)) return true;
  if (FALSY.has(key)) return false;
  return 'invalid';
}

/** ISO date only. A spreadsheet's ambiguous 03/04/2005 is refused, not guessed. */
export function parseDob(raw?: string | null): string | null | 'invalid' {
  const s = norm(raw);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'invalid';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return 'invalid';
  if (d.getTime() > Date.now()) return 'invalid';
  return s;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRoster(rows: RosterRow[], ctx: RosterContext): RosterReport {
  // Duplicate detection runs over the WHOLE file first, so both halves of a
  // duplicate pair are flagged - reporting only the second occurrence leaves the
  // coordinator hunting for the first.
  const phoneCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  const userIdCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.user_id) userIdCounts.set(r.user_id, (userIdCounts.get(r.user_id) ?? 0) + 1);
    const p = phoneLast10(r.phone);
    if (p.length === 10) phoneCounts.set(p, (phoneCounts.get(p) ?? 0) + 1);
    const e = lower(r.email);
    if (e) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
    const c = lower(r.member_code);
    if (c) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
  }

  const results = rows.map((r, index): RosterRowResult => {
    // A row that already names its account (the search-and-link picker) skips
    // phone/email matching entirely - see the note on RosterRow.user_id.
    const linked = r.user_id ? ctx.usersById.get(r.user_id) : undefined;
    const name = linked ? linked.name : (norm(r.name) || null);
    const email = linked ? linked.email.toLowerCase() : (lower(r.email) || null);
    const phone = phoneLast10(r.phone);
    const memberCode = norm(r.member_code) || null;

    const base = {
      index, name, email, phone: norm(r.phone) || null,
      user_id: null as string | null, org_unit_ids: [] as string[],
      member_code: memberCode, gender: null as Gender | null,
      date_of_birth: null as string | null, scholarship: null as boolean | null,
    };
    const reject = (message: string): RosterRowResult => ({ ...base, verdict: 'reject', message });

    if (r.user_id && !linked) return reject('That account could not be found.');
    if (r.user_id && (userIdCounts.get(r.user_id) ?? 0) > 1) {
      return reject('This account appears more than once in this batch.');
    }
    if (!linked) {
      if (!name) return reject('Name is required.');
      if (!email && phone.length !== 10) return reject('Give an email or a 10-digit phone number.');
      if (email && !EMAIL.test(email)) return reject(`"${r.email}" is not a valid email address.`);
      if (norm(r.phone) && phone.length !== 10) return reject(`"${r.phone}" is not a 10-digit phone number.`);

      if (phone.length === 10 && (phoneCounts.get(phone) ?? 0) > 1) {
        return reject('This phone number appears on more than one row in the file.');
      }
      if (email && (emailCounts.get(email) ?? 0) > 1) {
        return reject('This email appears on more than one row in the file.');
      }
      if (memberCode && (codeCounts.get(lower(memberCode)) ?? 0) > 1) {
        return reject('This member code appears on more than one row in the file.');
      }
    }

    const gender = parseGender(r.gender);
    if (gender === 'invalid') return reject(`"${r.gender}" is not a recognised gender value.`);
    const dob = parseDob(r.date_of_birth);
    if (dob === 'invalid') return reject(`"${r.date_of_birth}" is not a valid date of birth - use YYYY-MM-DD.`);
    const scholarship = parseScholarship(r.scholarship);
    if (scholarship === 'invalid') return reject(`"${r.scholarship}" is not a yes/no value.`);

    // The campus and department must already exist. Creating them implicitly is how
    // a typo becomes a department nobody meant to found - and, now that units are
    // what compete in an intra-organisation championship, how a typo becomes an
    // entrant in one.
    //
    // BOTH are kept, not just the more specific one: a row naming a campus AND a
    // department means exactly that - place this person in both. An earlier version
    // of this loop resolved them into a single id and let the department silently
    // overwrite the campus, so a sheet that named both ended up placing the person
    // in only one of them with no error. The alias columns fold in beside their
    // current names, so a sheet with either header lands in the same place.
    const unitIds: string[] = [];
    const placements = [
      ['campus', r.campus ?? r.programme],
      ['department', r.department ?? r.batch],
    ] as const;
    for (const [label, raw] of placements) {
      const key = lower(raw);
      if (!key) continue;
      const unit = ctx.unitsByName.get(key);
      if (!unit) return reject(`No ${label} called "${norm(raw)}" exists - create it under Structure first.`);
      unitIds.push(unit.id);
    }

    // Resolution order, per J1-E5-S2: an explicit link, then phone, then email,
    // then create. `linked` wins outright - it is what the search-and-link picker
    // used to remove the exact ambiguity phone/email matching cannot resolve on
    // its own (Option B: several accounts can share one number).
    const matched = linked
      ?? (phone.length === 10 ? ctx.usersByPhone.get(phone) : undefined)
      ?? (email ? ctx.usersByEmail.get(email) : undefined)
      ?? null;

    if (memberCode) {
      const owner = ctx.memberCodeOwner.get(lower(memberCode));
      if (owner && owner !== matched?.id) {
        return reject(`Member code "${memberCode}" already belongs to someone else in this institution.`);
      }
    }

    const resolved = {
      ...base,
      user_id: matched?.id ?? null,
      org_unit_ids: [...new Set(unitIds)],
      gender: gender ?? null,
      date_of_birth: dob ?? null,
      scholarship: scholarship ?? null,
    };

    if (!matched) return { ...resolved, verdict: 'create', message: 'A new account will be created and added to your institution.' };
    if (ctx.memberUserIds.has(matched.id)) {
      return { ...resolved, verdict: 'update', message: `Already in your institution - their placement and details will be updated.` };
    }
    return {
      ...resolved,
      verdict: 'match',
      message: linked
        ? `Linked to ${matched.name}'s account - they will be added to your institution.`
        : `Matched to an existing account (${matched.name}) - they will be added to your institution.`,
    };
  });

  const summary = { total: results.length, create: 0, match: 0, update: 0, reject: 0 };
  for (const r of results) summary[r.verdict] += 1;
  return { rows: results, summary };
}
