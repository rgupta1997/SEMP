import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../../infra/prisma.js';
import { env } from '../../config/env.js';

// What makes a certificate worth anything (J4-E7, J4-E8).
//
// Anyone can produce a PDF that says somebody won something. The only thing that
// distinguishes this from that is the ability of a STRANGER - an employer, another
// institution, a selector - to check it without an account and without trusting the
// document in front of them. That is what the signature and the public token are for,
// and it is why both are computed over the facts rather than over the rendered file.

/** The facts a certificate asserts. The signature covers exactly this and nothing else. */
export interface CertificateFacts {
  serial: string;
  recipient_name: string;
  organization_name: string;
  championship_name: string | null;
  sport: string | null;
  title: string;
  issued_on: string;
}

/**
 * A signature over the canonical facts.
 *
 * Canonical means the key order cannot change the result: JSON.stringify over an
 * object literal would make the signature depend on declaration order, and a later
 * refactor that reorders the interface would silently invalidate every certificate
 * ever issued.
 */
export function signCertificate(facts: CertificateFacts): string {
  const asRecord = facts as unknown as Record<string, unknown>;
  const canonical = Object.keys(asRecord).sort()
    .map((k) => `${k}=${asRecord[k] ?? ''}`)
    .join('\n');
  return createHmac('sha256', env.JWT_SECRET).update(canonical).digest('hex').slice(0, 64);
}

/** Constant-time, so a caller cannot narrow the signature a byte at a time. */
export function verifySignature(facts: CertificateFacts, signature: string): boolean {
  const expected = Buffer.from(signCertificate(facts));
  const given = Buffer.from(signature ?? '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The public handle. Separate from the serial because the serial is PRINTED on the
 * artefact: if the serial were the lookup key, photographing a certificate would let
 * you enumerate its neighbours, and a register you can walk is a register you can mine.
 */
export const newToken = () => randomBytes(24).toString('base64url');

/** CERT-26-FOOT-0001 - year, template code, then the gapless number. */
export const formatSerial = (year: number, code: string, seq: number) =>
  `CERT-${String(year).slice(-2)}-${code.toUpperCase()}-${String(seq).padStart(4, '0')}`;

/** A stable 4-letter code from a sport name, for institutions that never set one. */
export function codeFor(name: string | null | undefined, fallback = 'GEN'): string {
  const letters = (name ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return letters.length >= 3 ? letters.slice(0, 4) : fallback;
}

/**
 * Allocate the next number for (org, year, code).
 *
 * MUST run inside the same transaction as the certificate insert. The counter is a row
 * we increment rather than a Postgres sequence precisely because sequences are not
 * gapless - a rolled-back transaction burns its value and leaves a hole, which is the
 * one thing a certificate register cannot have.
 */
export async function allocateNumber(tx: Db, organizationId: string, year: number, code: string): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ next_certificate_number: number }>>(
    'select next_certificate_number($1::uuid, $2::smallint, $3::varchar)',
    organizationId, year, code,
  );
  const n = rows[0]?.next_certificate_number;
  if (!n) throw new Error('Could not allocate a certificate number');
  return n;
}
