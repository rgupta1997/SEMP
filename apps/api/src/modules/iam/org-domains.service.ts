import { PUBLIC_EMAIL_DOMAINS } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';

// Resolving an email address to the organisation that claimed its domain. This is
// what makes email-first sign-in (FR-AUTH-1) possible: one domain maps to at most
// one organisation - enforced by the unique index on lower(domain) - so the answer
// is deterministic and needs no disambiguation step.

export const domainOf = (email: string): string => email.trim().toLowerCase().split('@')[1] ?? '';

export const isPublicMailbox = (domain: string): boolean =>
  (PUBLIC_EMAIL_DOMAINS as readonly string[]).includes(domain.toLowerCase());

export interface ResolvedOrg {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  city: string | null;
  kind: string;
  verified: boolean;
  settings: unknown;
}

// Returns the organisation for an address, or null. Only VERIFIED domains route
// sign-in, so an unverified claim can sit in the table without any effect.
//
// Reads `org_domains` and `organizations` only - never `users`. That is deliberate:
// callers surface this result to unauthenticated visitors, and it must be
// impossible to tell from the answer whether an account exists.
export async function resolveOrgByEmail(prisma: Prisma, email: string): Promise<ResolvedOrg | null> {
  const domain = domainOf(email);
  if (!domain || isPublicMailbox(domain)) return null;

  const row = await prisma.org_domains.findFirst({
    where: { domain: { equals: domain, mode: 'insensitive' }, verified: true },
    include: {
      organizations: {
        select: {
          id: true, name: true, short_name: true, logo_url: true, city: true,
          kind: true, verified: true, settings: true,
        },
      },
    },
  });
  return row?.organizations ?? null;
}
