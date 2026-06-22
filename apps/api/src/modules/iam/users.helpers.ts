import bcrypt from 'bcryptjs';
import type { Prisma } from '../../infra/prisma.js';

// Shared default for provisioned logins - they're forced to set their own on
// first sign-in (see users.must_change_password).
export const DEFAULT_PASSWORD = 'demo123';

export const phoneDigits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
export const phoneLast10 = (s?: string | null) => phoneDigits(s).slice(-10);

// Mask all but the last two digits for display, e.g. "+91 98765 43210" -> "••••••••10".
export function maskPhone(s?: string | null): string {
  const d = phoneDigits(s);
  if (!d) return '';
  if (d.length <= 2) return '••';
  return `${'•'.repeat(d.length - 2)}${d.slice(-2)}`;
}

// Mask an email's local part, keeping the first two chars and the domain.
export function maskEmail(e?: string | null): string {
  if (!e) return '';
  const [local, domain] = e.split('@');
  if (!domain) return e;
  const shown = local.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

// Exact match on the last 10 digits (ignores formatting / country prefix).
// Returns null for an incomplete number so callers never leak partial matches.
export async function findUserByPhone(prisma: Prisma, phone?: string | null) {
  const last10 = phoneLast10(phone);
  if (last10.length < 10) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; email: string; phone: string | null }>>`
    select id, name, email, phone from users
    where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}
    limit 1`;
  return rows[0] ?? null;
}

// Hash a provisioned login's password, returning the plaintext so the caller can
// surface it once (to copy/share for first-time login).
export async function hashProvisionedPassword(password?: string | null) {
  const tempPassword = (password && password.trim()) || DEFAULT_PASSWORD;
  const password_hash = await bcrypt.hash(tempPassword, 10);
  return { tempPassword, password_hash };
}
