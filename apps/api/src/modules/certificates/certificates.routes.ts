import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { can } from '../../http/middleware/can.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import {
  allocateNumber, codeFor, formatSerial, newToken, signCertificate, type CertificateFacts,
} from './certificates.service.js';

// Certificates: templates (J4-E6), bulk issue (J4-E7), and the register behind them.
// Public verification lives in the public router - it must be reachable with no account.

const templateSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().max(8).nullish(),
  design: z.record(z.unknown()).default({}),
  is_default: z.boolean().optional(),
});

const generateSchema = z.object({
  championship_id: z.string().uuid(),
  template_id: z.string().uuid().nullish(),
  // Which honours to certify. Left open rather than "everyone who took part": a
  // certificate for turning up devalues the one for winning, and an institution that
  // wants participation certificates can say so.
  kinds: z.array(z.enum(['medal', 'placement', 'award'])).min(1).default(['medal']),
  // Capped at one championship's worth. The 15s Lambda ceiling is the reason this is
  // chunked by the caller rather than run as one unbounded job (see DEPLOYMENT.md).
  limit: z.number().int().min(1).max(500).optional(),
});

export function makeCertificatesRouter(prisma: Prisma): Router {
  const router = Router();

  const assertIssuer = async (req: any, organizationId: string) => {
    const allowed = await can(prisma, 'certificate.issue', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to issue certificates for this institution.');
  };

  // ---- templates (J4-E6) -----------------------------------------------------
  router.get('/organizations/:id/certificate-templates', asyncHandler(async (req, res) => {
    await assertIssuer(req, req.params.id);
    const rows = await prisma.certificate_templates.findMany({
      where: { organization_id: req.params.id, archived_at: null },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    res.json({ rows });
  }));

  router.post('/organizations/:id/certificate-templates', validateBody(templateSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const body = req.body as z.infer<typeof templateSchema>;

    const row = await prisma.$transaction(async (tx) => {
      // One default, enforced by a partial unique index - so stand the old one down
      // first rather than letting the insert fail on a race.
      if (body.is_default) {
        await tx.certificate_templates.updateMany({
          where: { organization_id: organizationId, is_default: true }, data: { is_default: false },
        });
      }
      const count = await tx.certificate_templates.count({ where: { organization_id: organizationId, archived_at: null } });
      return tx.certificate_templates.create({
        data: {
          organization_id: organizationId,
          name: body.name,
          code: (body.code ?? codeFor(body.name)).toUpperCase().slice(0, 8),
          design: body.design as object,
          // The first template an institution creates is its default, because a
          // generator with no default to fall back on is a dead end.
          is_default: body.is_default ?? count === 0,
          created_by: req.user!.id,
        },
      });
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificateTemplateCreated,
      target: { type: 'certificate_templates', id: row.id, label: row.name },
      organizationId,
      summary: `Created the certificate template ${row.name}`,
    });
    res.status(201).json(row);
  }));

  router.patch('/certificate-templates/:templateId', validateBody(templateSchema.partial()), asyncHandler(async (req, res) => {
    const existing = await prisma.certificate_templates.findUnique({ where: { id: req.params.templateId } });
    if (!existing) throw new NotFoundError('Template');
    await assertIssuer(req, existing.organization_id);
    const body = req.body as Partial<z.infer<typeof templateSchema>>;

    const row = await prisma.$transaction(async (tx) => {
      if (body.is_default) {
        await tx.certificate_templates.updateMany({
          where: { organization_id: existing.organization_id, is_default: true }, data: { is_default: false },
        });
      }
      return tx.certificate_templates.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.code !== undefined ? { code: (body.code ?? '').toUpperCase().slice(0, 8) } : {}),
          ...(body.design !== undefined ? { design: body.design as object } : {}),
          ...(body.is_default !== undefined ? { is_default: body.is_default } : {}),
          updated_at: new Date(),
        },
      });
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificateTemplateUpdated,
      target: { type: 'certificate_templates', id: row.id, label: row.name },
      organizationId: existing.organization_id,
      summary: `Updated the certificate template ${row.name}`,
    });
    res.json(row);
  }));

  // Archived, never deleted: a certificate names the template it was issued from, and
  // a register that points at a missing template cannot explain its own artefacts.
  router.delete('/certificate-templates/:templateId', asyncHandler(async (req, res) => {
    const existing = await prisma.certificate_templates.findUnique({ where: { id: req.params.templateId } });
    if (!existing) throw new NotFoundError('Template');
    await assertIssuer(req, existing.organization_id);
    await prisma.certificate_templates.update({ where: { id: existing.id }, data: { archived_at: new Date(), is_default: false } });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificateTemplateArchived,
      target: { type: 'certificate_templates', id: existing.id, label: existing.name },
      organizationId: existing.organization_id,
      summary: `Archived the certificate template ${existing.name}`,
    });
    res.status(204).send();
  }));

  // ---- bulk issue (J4-E7) ----------------------------------------------------
  router.post('/organizations/:id/certificates/generate', validateBody(generateSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const body = req.body as z.infer<typeof generateSchema>;

    const [org, champ, template] = await Promise.all([
      prisma.organizations.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.championships.findUnique({ where: { id: body.championship_id }, select: { id: true, name: true } }),
      body.template_id
        ? prisma.certificate_templates.findUnique({ where: { id: body.template_id } })
        : prisma.certificate_templates.findFirst({ where: { organization_id: organizationId, is_default: true, archived_at: null } }),
    ]);
    if (!org) throw new NotFoundError('Organisation');
    if (!champ) throw new NotFoundError('Championship');
    if (!template) throw new BusinessRuleError('Create a certificate template before generating - there is nothing to issue from.');
    if (template.organization_id !== organizationId) throw new ForbiddenError('That template belongs to another institution.');

    // ONLY from locked results. An achievement whose scorecard can still change is not
    // something to print and hand over, and this is the same rule the reports use.
    // `achievements.fixture_id` is a plain column with no relation, so the locked set
    // is resolved first rather than joined - which also keeps the honour rows that
    // carry no fixture at all (an org placement) out of the batch.
    const lockedFixtures = await prisma.fixtures.findMany({
      where: {
        locked_at: { not: null },
        tournament_disciplines: { tournament_sports: { tournaments: { championship_id: champ.id } } },
      },
      select: { id: true },
    });
    const lockedIds = lockedFixtures.map((f) => f.id);
    if (!lockedIds.length) {
      return void res.json({ issued: 0, skipped: 0, results: [], note: 'Nothing is locked in this championship yet, so there is nothing to certify.' });
    }

    const achievements = await prisma.achievements.findMany({
      where: {
        organization_id: organizationId, championship_id: champ.id,
        superseded_at: null, user_id: { not: null }, kind: { in: body.kinds },
        fixture_id: { in: lockedIds },
      },
      select: { id: true, user_id: true, fixture_id: true, title: true, medal: true, sport_id: true, occurred_on: true, lock_version: true },
      orderBy: { occurred_on: 'asc' },
      take: body.limit ?? 500,
    });
    if (!achievements.length) {
      return void res.json({ issued: 0, skipped: 0, results: [], note: 'No locked, unsuperseded honours to certify for this championship.' });
    }

    const userIds = [...new Set(achievements.map((a) => a.user_id!))];
    const sportIds = [...new Set(achievements.map((a) => a.sport_id).filter((s): s is string => !!s))];
    const [users, sports] = await Promise.all([
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      sportIds.length ? prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } }) : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const sportName = new Map(sports.map((s) => [s.id, s.name]));

    const year = new Date().getUTCFullYear();
    const results: Array<{ achievement_id: string; ok: boolean; serial?: string; reason?: string }> = [];
    let issued = 0;
    let skipped = 0;

    // One transaction PER certificate, not one for the batch. Three hundred rows in a
    // single transaction holds the counter lock for the whole run and blows the 15s
    // Lambda ceiling; and a failure at row 299 would throw away 298 good certificates.
    // Per-row means a bad row is reported and the rest still issue - the same shape as
    // bulk lock (J4-E1-S2).
    for (const a of achievements) {
      const code = (template.code || codeFor(sportName.get(a.sport_id ?? '') ?? null)).toUpperCase().slice(0, 8);
      try {
        const cert = await prisma.$transaction(async (tx) => {
          const seq = await allocateNumber(tx, organizationId, year, code);
          const serial = formatSerial(year, code, seq);
          const facts: CertificateFacts = {
            serial,
            recipient_name: userName.get(a.user_id!) ?? 'Unknown',
            organization_name: org.name,
            championship_name: champ.name,
            sport: a.sport_id ? (sportName.get(a.sport_id) ?? null) : null,
            title: a.title,
            issued_on: new Date().toISOString().slice(0, 10),
          };
          return tx.certificates.create({
            data: {
              organization_id: organizationId, template_id: template.id, championship_id: champ.id,
              fixture_id: a.fixture_id, user_id: a.user_id, recipient_name: facts.recipient_name,
              serial, seq, year, code,
              payload: facts as unknown as object,
              signature: signCertificate(facts),
              token: newToken(),
              issued_by: req.user!.id,
              lock_version: a.lock_version ?? null,
            },
          });
        });
        issued++;
        results.push({ achievement_id: a.id, ok: true, serial: cert.serial });
      } catch (e: any) {
        // The partial unique index catches a re-run: somebody already has this
        // certificate, which is a skip and not an error.
        const dupe = e?.code === 'P2002';
        skipped++;
        results.push({ achievement_id: a.id, ok: false, reason: dupe ? 'already issued' : (e?.message ?? 'failed').slice(0, 120) });
      }
    }

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificatesGenerated,
      target: { type: 'championships', id: champ.id, label: champ.name },
      organizationId, championshipId: champ.id,
      summary: `Generated ${issued} certificate${issued === 1 ? '' : 's'} for ${champ.name}`,
      diff: { issued: { from: 0, to: issued }, skipped: { from: 0, to: skipped } },
    });

    res.json({ issued, skipped, template: { id: template.id, name: template.name }, results });
  }));

  // ---- the register ----------------------------------------------------------
  router.get('/organizations/:id/certificates', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const { championship_id: championshipId, q } = req.query as Record<string, string | undefined>;

    const rows = await prisma.certificates.findMany({
      where: {
        organization_id: organizationId,
        ...(championshipId ? { championship_id: championshipId } : {}),
        ...(q ? { OR: [{ recipient_name: { contains: q, mode: 'insensitive' } }, { serial: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ issued_at: 'desc' }],
      take: 500,
      select: {
        id: true, serial: true, recipient_name: true, issued_at: true, revoked_at: true,
        revoked_reason: true, superseded_at: true, token: true, payload: true,
        championships: { select: { id: true, name: true } },
      },
    });

    const [total, revoked, scans] = await Promise.all([
      prisma.certificates.count({ where: { organization_id: organizationId } }),
      prisma.certificates.count({ where: { organization_id: organizationId, revoked_at: { not: null } } }),
      prisma.certificate_verifications.count({ where: { certificates: { organization_id: organizationId } } }),
    ]);

    res.json({ rows, summary: { total, revoked, live: total - revoked, verification_scans: scans } });
  }));

  router.post('/certificates/:certId/revoke', validateBody(z.object({ reason: z.string().min(5).max(500) })), asyncHandler(async (req, res) => {
    const cert = await prisma.certificates.findUnique({ where: { id: req.params.certId } });
    if (!cert) throw new NotFoundError('Certificate');
    await assertIssuer(req, cert.organization_id);
    if (cert.revoked_at) throw new BusinessRuleError('This certificate has already been withdrawn.');

    const row = await prisma.certificates.update({
      where: { id: cert.id },
      data: { revoked_at: new Date(), revoked_by: req.user!.id, revoked_reason: req.body.reason },
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificateRevoked,
      target: { type: 'certificates', id: cert.id, label: cert.serial },
      organizationId: cert.organization_id,
      summary: `Withdrew certificate ${cert.serial} - ${req.body.reason}`,
      diff: { revoked: { from: false, to: true } },
    });
    res.json(row);
  }));

  return router;
}
