import { createHash, randomInt } from 'node:crypto';
import type { AuthTokenKind } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';

// Single-use auth tokens: one-time sign-in codes today, password resets and
// invitations once module 02 wires real email delivery.
//
// Two rules the rest of the codebase depends on:
//   1. Only the sha256 hash of the code is ever persisted, so reading auth_tokens
//      does not let anyone sign in as somebody else.
//   2. Tokens are keyed by EMAIL, not user_id - a first-time visitor verifies a
//      code before their `users` row exists.

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// A phone is normalised to its last ten digits, matching idx_users_phone_last10:
// "+91 98765 43210" and "9876543210" are one number, and a code issued to either
// spelling has to be findable by the other.
export const normalizePhone = (phone: string) => phone.replace(/[^0-9]/g, '').slice(-10);

/**
 * Who a code was issued to. Under Option B a phone can belong to several accounts,
 * so a phone-keyed token deliberately carries NO user_id - the token proves
 * ownership of the NUMBER, and which account it opens is chosen afterwards.
 */
export type TokenSubject = { email: string; phone?: never } | { phone: string; email?: never };

/** The `where` that finds a subject's tokens, whichever kind of subject it is. */
export function subjectWhere(subject: TokenSubject): { email: string } | { phone: string } {
  return 'phone' in subject && subject.phone !== undefined
    ? { phone: normalizePhone(subject.phone) }
    : { email: normalizeEmail((subject as { email: string }).email) };
}

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

// 6 digits, uniformly random, zero-padded. randomInt is CSPRNG-backed - Math.random
// is not, and a guessable sign-in code is a sign-in bypass.
const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export interface IssuedToken {
  /** The plaintext code. Returned to the caller once and never stored. */
  code: string;
  expires_at: Date;
}

// Issues a fresh code, invalidating any live one for the same address+kind so a
// resend cannot leave two valid codes in circulation.
export async function issueToken(
  prisma: Prisma,
  { kind, userId, ...subject }: TokenSubject & { kind: AuthTokenKind; userId?: string | null },
): Promise<IssuedToken> {
  const addr = subjectWhere(subject as TokenSubject);
  const now = new Date();
  const expires_at = new Date(now.getTime() + env.OTP_TTL_MIN * 60_000);
  const code = generateCode();

  await prisma.auth_tokens.updateMany({
    where: { ...addr, kind, consumed_at: null },
    data: { consumed_at: now },
  });

  await prisma.auth_tokens.create({
    data: { ...addr, kind, token_hash: hashCode(code), expires_at, user_id: userId ?? null },
  });

  return { code, expires_at };
}

export type ConsumeResult =
  | { ok: true; token: { id: string; user_id: string | null } }
  | { ok: false; reason: 'not_found' | 'expired' | 'too_many_attempts' | 'mismatch' };

// Checks a code WITHOUT burning it. A wrong code still costs an attempt, so this is
// not a free oracle - but a right one leaves the token live.
//
// Why the split: proving you own an address and finishing what that proof unlocks
// (choosing a password) are two requests. Burning the code on the first would mean
// the second is guarded by nothing, so instead the first hands back a short-lived
// ticket naming this token, and the second is what finally consumes it.
export async function verifyToken(
  prisma: Prisma,
  { kind, code, ...subject }: TokenSubject & { kind: AuthTokenKind; code: string },
): Promise<ConsumeResult> {
  const addr = subjectWhere(subject as TokenSubject);
  const token = await prisma.auth_tokens.findFirst({
    where: { ...addr, kind, consumed_at: null },
    orderBy: { created_at: 'desc' },
  });
  if (!token) return { ok: false, reason: 'not_found' };

  if (token.expires_at.getTime() < Date.now()) {
    await prisma.auth_tokens.update({ where: { id: token.id }, data: { consumed_at: new Date() } });
    return { ok: false, reason: 'expired' };
  }

  if (token.attempts >= env.OTP_MAX_ATTEMPTS) {
    await prisma.auth_tokens.update({ where: { id: token.id }, data: { consumed_at: new Date() } });
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (token.token_hash !== hashCode(code)) {
    const updated = await prisma.auth_tokens.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    // Spending the last attempt kills the token there and then.
    if (updated.attempts >= env.OTP_MAX_ATTEMPTS) {
      await prisma.auth_tokens.update({ where: { id: token.id }, data: { consumed_at: new Date() } });
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'mismatch' };
  }

  // Deliberately NOT consumed - see the note above.
  return { ok: true, token: { id: token.id, user_id: token.user_id } };
}

// Burns a token by id, once. Returns false if it was already used or has expired
// since it was verified, which is what makes a replayed ticket useless.
export async function consumeById(prisma: Prisma, id: string): Promise<boolean> {
  const { count } = await prisma.auth_tokens.updateMany({
    where: { id, consumed_at: null, expires_at: { gt: new Date() } },
    data: { consumed_at: new Date() },
  });
  return count === 1;
}

// How many codes have been issued to this address recently. This is the *real*
// per-address rate limit: the in-process IP limiter is per-Lambda-container and
// therefore best-effort, whereas this counts rows every container can see.
export async function recentTokenCount(
  prisma: Prisma,
  { kind, windowMin, ...subject }: TokenSubject & { kind: AuthTokenKind; windowMin: number },
): Promise<number> {
  return prisma.auth_tokens.count({
    where: {
      ...subjectWhere(subject as TokenSubject),
      kind,
      created_at: { gte: new Date(Date.now() - windowMin * 60_000) },
    },
  });
}
