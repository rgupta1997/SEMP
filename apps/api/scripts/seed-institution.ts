/**
 * Seeds a verified institution with a claimed email domain, so the email-first
 * sign-in flow can be exercised locally end to end:
 *
 *   /login -> "akash@iimb.ac.in" -> "IIM Bangalore" recognised -> code -> Member.
 *
 * Idempotent: re-running updates the existing rows rather than creating duplicates.
 * It creates no users - the whole point is that a person arrives with an address on
 * the domain and the product does the rest.
 *
 *   npx tsx scripts/seed-institution.ts
 *   npx tsx scripts/seed-institution.ts "Christ University" christuniversity.in Bengaluru
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const [, , argName, argDomain, argCity] = process.argv;
const NAME = argName ?? 'IIM Bangalore';
const DOMAIN = (argDomain ?? 'iimb.ac.in').toLowerCase();
const CITY = argCity ?? 'Bengaluru';
const SHORT = NAME.split(/\s+/).map((w) => w[0]).join('').toUpperCase();

async function main() {
  const existing = await prisma.organizations.findFirst({ where: { name: NAME } });

  const org = existing
    ? await prisma.organizations.update({
      where: { id: existing.id },
      data: { kind: 'institution', verified: true, city: CITY },
    })
    : await prisma.organizations.create({
      data: {
        name: NAME, short_name: SHORT, city: CITY, country: 'India', status: true,
        kind: 'institution', verified: true,
      },
    });

  console.log(`${existing ? 'Updated' : 'Created'} institution ${org.name} (${org.id})`);

  // The unique index is on lower(domain) across the whole table, so check by domain
  // rather than by (org, domain) - the row may already belong to someone else.
  const claimed = await prisma.org_domains.findFirst({
    where: { domain: { equals: DOMAIN, mode: 'insensitive' } },
    include: { organizations: { select: { name: true } } },
  });

  if (claimed && claimed.organization_id !== org.id) {
    console.error(`Domain ${DOMAIN} is already claimed by ${claimed.organizations.name}. Nothing changed.`);
    process.exitCode = 1;
    return;
  }

  const domain = claimed
    ? await prisma.org_domains.update({ where: { id: claimed.id }, data: { verified: true } })
    : await prisma.org_domains.create({ data: { organization_id: org.id, domain: DOMAIN, verified: true } });

  console.log(`Domain ${domain.domain} -> ${org.name}, verified=${domain.verified}`);
  console.log(`\nTry it: sign in at /login with anything@${domain.domain}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
