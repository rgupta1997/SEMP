import bcrypt from 'bcryptjs';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { normalizeEmail, normalizePhone, type TokenSubject } from './auth-tokens.service.js';

// Resolving a subject to the account (or accounts) it opens.
//
// This is where Option B actually lives. An email is unique and names exactly one
// account; a phone may name several, because one person keeps a personal and a work
// identity on the same number. Every sign-in path therefore has to be able to end in
// a chooser - including the password path, since two accounts can share a password.

/** The shape the chooser renders. Deliberately thin: enough to recognise yourself, nothing more. */
export interface AccountChoice {
  id: string;
  name: string;
  email: string;
  sportagon_id: string | null;
  /** Whichever organisation this account belongs to, for the "work vs personal" cue. */
  organization: { id: string; name: string; logo_url: string | null } | null;
  email_verified: boolean;
  phone_verified: boolean;
}

const CHOICE_SELECT = {
  id: true, name: true, email: true, sportagon_id: true,
  email_verified_at: true, phone_verified_at: true,
  organizations: { select: { id: true, name: true, logo_url: true } },
} as const;

type ChoiceRow = {
  id: string; name: string; email: string; sportagon_id: string | null;
  email_verified_at: Date | null; phone_verified_at: Date | null;
  organizations: { id: string; name: string; logo_url: string | null } | null;
};

const toChoice = (u: ChoiceRow): AccountChoice => ({
  id: u.id,
  name: u.name,
  email: u.email,
  sportagon_id: u.sportagon_id,
  organization: u.organizations,
  email_verified: u.email_verified_at != null,
  phone_verified: u.phone_verified_at != null,
});

/**
 * Every active account reachable from a subject.
 *
 * The phone lookup matches `idx_users_phone_last10` - the last ten digits - so a
 * number stored as "+91 98765 43210" is found by "9876543210" and the reverse.
 * Ordered oldest first so the chooser is stable between visits rather than
 * reshuffling as rows are touched.
 */
export async function accountsForSubject(prisma: Prisma, subject: TokenSubject): Promise<AccountChoice[]> {
  if ('phone' in subject && subject.phone !== undefined) {
    const last10 = normalizePhone(subject.phone);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `select id from users
       where is_active
         and phone is not null
         and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
       order by created_at asc`,
      last10,
    );
    if (rows.length === 0) return [];
    const users = await prisma.users.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: CHOICE_SELECT,
    });
    // Preserve the SQL ordering: findMany does not promise the `in` order.
    const byId = new Map(users.map((u) => [u.id, u as ChoiceRow]));
    return rows.map((r) => byId.get(r.id)).filter(Boolean).map((u) => toChoice(u as ChoiceRow));
  }

  const email = normalizeEmail((subject as { email: string }).email);
  const user = await prisma.users.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, is_active: true },
    select: CHOICE_SELECT,
  });
  return user ? [toChoice(user as ChoiceRow)] : [];
}

/**
 * The subset of those accounts whose password matches.
 *
 * On the phone path this is what disambiguates - but only when the accounts have
 * different passwords. Someone reusing one password across both still lands on the
 * chooser, which is correct: the password proved they own them, not which they meant.
 *
 * Every candidate is checked even after a match, so the work done does not depend on
 * which account matched and cannot be timed to learn the order.
 */
export async function accountsMatchingPassword(
  prisma: Prisma,
  subject: TokenSubject,
  password: string,
): Promise<AccountChoice[]> {
  const candidates = await accountsForSubject(prisma, subject);
  if (candidates.length === 0) return [];

  const hashes = await prisma.users.findMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    select: { id: true, password_hash: true },
  });
  const hashById = new Map(hashes.map((h) => [h.id, h.password_hash]));

  const matched: AccountChoice[] = [];
  for (const c of candidates) {
    const hash = hashById.get(c.id);
    const ok = hash ? await bcrypt.compare(password, hash) : false;
    if (ok) matched.push(c);
  }
  return matched;
}

/**
 * Whether another account may be created on this number.
 *
 * Option B exists so one person can keep work and personal apart; it is not an
 * invitation to farm accounts on a single number. Without a cap, one number mints
 * codes through arbitrarily many accounts.
 */
export async function phoneHasCapacity(prisma: Prisma, phone: string): Promise<boolean> {
  const existing = await accountsForSubject(prisma, { phone });
  return existing.length < env.MAX_ACCOUNTS_PER_PHONE;
}
