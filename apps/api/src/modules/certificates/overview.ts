import type { Prisma } from '../../infra/prisma.js';

// What the Certificates Manager dashboard and register need (the Figma screens).
//
// Two mappings are worth stating, because the designs imply a lifecycle this product
// deliberately does not have:
//
//   - The mock's audit trail reads Generated → Approved → Issued → Verified. There is
//     no approval step here and inventing one would be a fabricated workflow: a
//     certificate is derived from a LOCKED result, and the lock IS the approval. The
//     trail therefore shows what actually happened - generated, issued, scanned,
//     withdrawn - each from a real row.
//   - The register's VERIFIED / PENDING chips are read the same way: "verified" means
//     somebody has actually scanned the QR and the signature held, not that an
//     administrator ticked a box. A certificate nobody has checked yet is "Issued".

export interface Delta { value: number; delta_pct: number | null }

const pct = (now: number, before: number): number | null =>
  before === 0 ? null : Math.round(((now - before) / before) * 100);

/** KPI tiles, each against the previous calendar month. */
export async function certificateOverview(prisma: Prisma, organizationId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [total, totalBefore, thisMonth, lastMonth, scans, scansBefore, revoked] = await Promise.all([
    prisma.certificates.count({ where: { organization_id: organizationId } }),
    prisma.certificates.count({ where: { organization_id: organizationId, issued_at: { lt: monthStart } } }),
    prisma.certificates.count({ where: { organization_id: organizationId, issued_at: { gte: monthStart } } }),
    prisma.certificates.count({ where: { organization_id: organizationId, issued_at: { gte: prevStart, lt: monthStart } } }),
    prisma.certificate_verifications.count({ where: { certificates: { organization_id: organizationId }, verified_at: { gte: monthStart } } }),
    prisma.certificate_verifications.count({ where: { certificates: { organization_id: organizationId }, verified_at: { gte: prevStart, lt: monthStart } } }),
    prisma.certificates.count({ where: { organization_id: organizationId, revoked_at: { not: null } } }),
  ]);

  // "Pending generation" is a real number, not a queue: honours from locked results
  // that nobody has issued a certificate for yet. That is what the tile's "needs
  // action" is actually pointing at.
  const issuedFor = await prisma.certificates.findMany({
    where: { organization_id: organizationId, revoked_at: null, superseded_at: null },
    select: { user_id: true, fixture_id: true },
  });
  const already = new Set(issuedFor.map((c) => `${c.user_id}:${c.fixture_id}`));
  const lockedIds = (await prisma.fixtures.findMany({ where: { locked_at: { not: null } }, select: { id: true } })).map((f) => f.id);
  const eligible = lockedIds.length
    ? await prisma.achievements.findMany({
      where: { organization_id: organizationId, superseded_at: null, user_id: { not: null }, fixture_id: { in: lockedIds } },
      select: { user_id: true, fixture_id: true },
    })
    : [];
  const pending = eligible.filter((a) => !already.has(`${a.user_id}:${a.fixture_id}`)).length;

  return {
    kpis: {
      issued: { value: total, delta_pct: pct(total, totalBefore) } as Delta,
      pending_generation: { value: pending, delta_pct: null } as Delta,
      this_month: { value: thisMonth, delta_pct: pct(thisMonth, lastMonth) } as Delta,
      verification_scans: { value: scans, delta_pct: pct(scans, scansBefore) } as Delta,
    },
    revoked,
  };
}

/** The Recent Activity feed - real events only, newest first. */
export async function certificateActivity(prisma: Prisma, organizationId: string, take = 8) {
  const [batches, scans] = await Promise.all([
    prisma.audit_log.findMany({
      where: { organization_id: organizationId, action: { startsWith: 'certificate.' } },
      orderBy: { at: 'desc' }, take,
      select: { id: true, at: true, action: true, summary: true, target_label: true, actor_label: true, diff: true },
    }),
    prisma.certificate_verifications.findMany({
      where: { certificates: { organization_id: organizationId } },
      orderBy: { verified_at: 'desc' }, take,
      select: { id: true, verified_at: true, outcome: true, certificates: { select: { recipient_name: true, serial: true } } },
    }),
  ]);

  const items = [
    ...batches.map((b) => ({
      id: `a${b.id}`, at: b.at, kind: b.action,
      title: b.summary ?? b.action,
      detail: b.actor_label ?? null,
      // A failed batch has to look different from a successful one - that is the whole
      // value of the row in the mock that is coloured red.
      tone: b.action === 'certificate.revoked' ? 'warning' : 'normal',
    })),
    ...scans.map((s) => ({
      id: `v${s.id}`, at: s.verified_at, kind: 'certificate.verified',
      title: `${s.certificates?.recipient_name}'s certificate was ${s.outcome === 'authentic' ? 'verified' : s.outcome}`,
      detail: `QR scan · ${s.certificates?.serial}`,
      tone: s.outcome === 'authentic' ? 'normal' : 'warning',
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, take);

  return items;
}

/** One certificate's own timeline, for the detail view. */
export async function certificateTrail(prisma: Prisma, certificateId: string) {
  const cert = await prisma.certificates.findUnique({
    where: { id: certificateId },
    select: {
      id: true, serial: true, issued_at: true, revoked_at: true, revoked_reason: true, superseded_at: true,
      users_certificates_user_idTousers: { select: { name: true } },
      users_certificates_issued_byTousers: { select: { name: true } },
      users_certificates_revoked_byTousers: { select: { name: true } },
    },
  });
  if (!cert) return [];

  const scans = await prisma.certificate_verifications.findMany({
    where: { certificate_id: certificateId }, orderBy: { verified_at: 'asc' }, take: 50,
    select: { verified_at: true, outcome: true },
  });

  const trail: Array<{ at: Date; label: string; detail: string; tone?: string }> = [
    {
      at: cert.issued_at,
      label: 'Certificate generated',
      // The lock is the approval: this row exists because a result was made official.
      detail: `by ${cert.users_certificates_issued_byTousers?.name ?? 'the system'} from a locked result`,
    },
  ];
  for (const s of scans) {
    trail.push({
      at: s.verified_at,
      label: s.outcome === 'authentic' ? 'Verified' : `Checked — ${s.outcome}`,
      detail: 'QR scan',
      tone: s.outcome === 'authentic' ? undefined : 'warning',
    });
  }
  if (cert.revoked_at) {
    trail.push({
      at: cert.revoked_at,
      label: 'Withdrawn',
      detail: `${cert.revoked_reason ?? ''}${cert.users_certificates_revoked_byTousers?.name ? ` — ${cert.users_certificates_revoked_byTousers.name}` : ''}`.trim(),
      tone: 'warning',
    });
  }
  return trail.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** VERIFIED / ISSUED / WITHDRAWN - derived from what happened, never from a flag. */
export const statusOf = (c: { revoked_at: Date | null; superseded_at: Date | null; _scans?: number }) =>
  c.revoked_at ? 'withdrawn' : c.superseded_at ? 'superseded' : (c._scans ?? 0) > 0 ? 'verified' : 'issued';
