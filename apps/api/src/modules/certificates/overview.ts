import type { Prisma } from '../../infra/prisma.js';
import { alreadyIssued, candidateKey, candidatesFor, RECIPIENT_CATEGORIES } from './recipients.js';

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

/**
 * Pending-generation count, per championship this org hosts.
 *
 * The single source of truth for "how many honours has this host not yet
 * certified" - `certificateOverview`'s one-number KPI just sums this, and the
 * Generate-certificates picker uses it to put a count beside each event's
 * name, so the two can never quietly disagree with each other.
 *
 * Summed across every recipient category (winners, awards, participation,
 * organising, officials, coaches) via the exact same `candidatesFor` +
 * `alreadyIssued` pair the Recipients step's per-category pills use - not just
 * achievements from locked results - so this number always matches what a run
 * covering every category would actually issue.
 */
export async function certificatePendingByEvent(prisma: Prisma, organizationId: string) {
  const hosted = await prisma.championships.findMany({
    where: { host_organization_id: organizationId },
    select: { id: true, name: true },
    orderBy: { start_date: 'desc' },
  });
  if (!hosted.length) return [];

  // Championships run in parallel, but each one's six categories run one at a time -
  // 6 championships x 6 categories x 2 queries at once blew through Supabase's
  // pooled connection limit (9) and the whole dashboard load timed out (P2024).
  return Promise.all(hosted.map(async (c) => {
    let pending = 0;
    for (const category of RECIPIENT_CATEGORIES) {
      const [candidates, already] = await Promise.all([
        candidatesFor(prisma, c.id, category, {}),
        alreadyIssued(prisma, organizationId, c.id, category),
      ]);
      pending += candidates.filter((cand) => !already.has(candidateKey(cand))).length;
    }
    return { id: c.id, name: c.name, pending };
  }));
}

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

  // "Pending generation" is a real number, not a queue: honours from locked
  // results, across every championship this org hosts, that nobody has issued
  // a certificate for yet - summed from the same per-event breakdown the
  // Generate-certificates picker shows, so the tile and the picker can never
  // quietly disagree about what "pending" means.
  const pending = (await certificatePendingByEvent(prisma, organizationId))
    .reduce((sum, e) => sum + e.pending, 0);

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
