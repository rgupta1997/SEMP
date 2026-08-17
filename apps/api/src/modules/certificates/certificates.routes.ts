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
import { renderCertificateHtml, sampleFacts } from './render.js';
import { CERTIFICATE_PRESETS, presetById } from './presets.js';
import { certificateActivity, certificateOverview, certificateTrail, statusOf } from './overview.js';
import { env } from '../../config/env.js';

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

  // ---- the manager's dashboard ------------------------------------------------
  router.get('/organizations/:id/certificates/overview', asyncHandler(async (req, res) => {
    await assertIssuer(req, req.params.id);
    const [stats, activity] = await Promise.all([
      certificateOverview(prisma, req.params.id),
      certificateActivity(prisma, req.params.id),
    ]);
    res.json({ ...stats, activity });
  }));

  // ---- templates (J4-E6) -----------------------------------------------------
  router.get('/organizations/:id/certificate-templates', asyncHandler(async (req, res) => {
    await assertIssuer(req, req.params.id);
    const rows = await prisma.certificate_templates.findMany({
      where: { organization_id: req.params.id, archived_at: null },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    // "Used N times" on the gallery card, counted rather than stored - a denormalised
    // counter here would drift the first time a certificate is deleted.
    const used = await prisma.certificates.groupBy({
      by: ['template_id'],
      where: { organization_id: req.params.id },
      _count: { _all: true },
    });
    const byTemplate = new Map(used.map((u) => [u.template_id, u._count._all]));
    res.json({ rows: rows.map((r) => ({ ...r, used_count: byTemplate.get(r.id) ?? 0 })) });
  }));

  /** The starter designs. Not rows yet - an institution copies the one it wants. */
  router.get('/organizations/:id/certificate-presets', asyncHandler(async (req, res) => {
    await assertIssuer(req, req.params.id);
    const mine = await prisma.certificate_templates.findMany({
      where: { organization_id: req.params.id, archived_at: null },
      select: { design: true },
    });
    const taken = new Set(mine.map((t) => (t.design as any)?.layout).filter(Boolean));
    res.json({
      rows: CERTIFICATE_PRESETS.map((p) => ({
        id: p.id, name: p.name, category: p.category, blurb: p.blurb, design: p.design,
        // Already copied? Say so, rather than letting somebody make five Classic Laurels.
        in_use: taken.has(p.id),
      })),
    });
  }));

  router.post('/organizations/:id/certificate-templates/from-preset', validateBody(z.object({
    preset_id: z.string().min(1), name: z.string().min(1).max(160).optional(), is_default: z.boolean().optional(),
  })), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const preset = presetById(req.body.preset_id);
    if (!preset) throw new NotFoundError('Certificate design');

    const name = req.body.name ?? preset.name;
    const row = await prisma.$transaction(async (tx) => {
      if (req.body.is_default) {
        await tx.certificate_templates.updateMany({
          where: { organization_id: organizationId, is_default: true }, data: { is_default: false },
        });
      }
      const count = await tx.certificate_templates.count({ where: { organization_id: organizationId, archived_at: null } });
      return tx.certificate_templates.create({
        data: {
          organization_id: organizationId,
          name,
          code: codeFor(name).toUpperCase().slice(0, 8),
          // Copied, not referenced: editing the wording later must not require us to
          // ship a release, and a preset changing upstream must not silently restyle
          // certificates an institution has already approved.
          design: preset.design as object,
          is_default: req.body.is_default ?? count === 0,
          created_by: req.user!.id,
        },
      });
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.certificateTemplateCreated,
      target: { type: 'certificate_templates', id: row.id, label: row.name },
      organizationId,
      summary: `Added the certificate template ${row.name} from the ${preset.name} design`,
    });
    res.status(201).json(row);
  }));

  /** What a design actually looks like, on sample facts. Powers the gallery tiles
   *  and the full-size preview screen - the thumbnail IS the template, so it can
   *  never drift from what gets printed. */
  const previewHtml = async (res: any, organizationName: string, design: any, bare: boolean) => {
    const html = await renderCertificateHtml({
      facts: sampleFacts(organizationName),
      verifyUrl: `${env.WEB_ORIGIN}/verify/sample`,
      design, bare,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  };

  router.get('/organizations/:id/certificate-presets/:presetId/preview', asyncHandler(async (req, res) => {
    await assertIssuer(req, req.params.id);
    const preset = presetById(req.params.presetId);
    if (!preset) throw new NotFoundError('Certificate design');
    const org = await prisma.organizations.findUnique({ where: { id: req.params.id }, select: { name: true } });
    await previewHtml(res, org?.name ?? 'Your institution', preset.design, req.query.bare === '1');
  }));

  router.get('/certificate-templates/:templateId/preview', asyncHandler(async (req, res) => {
    const tpl = await prisma.certificate_templates.findUnique({
      where: { id: req.params.templateId },
      include: { organizations: { select: { name: true } } },
    });
    if (!tpl) throw new NotFoundError('Certificate template');
    await assertIssuer(req, tpl.organization_id);
    await previewHtml(res, tpl.organizations?.name ?? 'Your institution', tpl.design, req.query.bare === '1');
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

  // ---- the issued register -----------------------------------------------------
  const registerWhere = (organizationId: string, query: Record<string, string | undefined>) => {
    const { championship_id: championshipId, sport, status, q } = query;
    return {
      organization_id: organizationId,
      ...(championshipId ? { championship_id: championshipId } : {}),
      // Sport lives in the frozen payload, not a column - the certificate says what it
      // said on the day, even if the discipline is renamed afterwards.
      ...(sport ? { payload: { path: ['sport'], equals: sport } } : {}),
      ...(status === 'withdrawn' ? { revoked_at: { not: null } } : {}),
      ...(status === 'live' ? { revoked_at: null, superseded_at: null } : {}),
      ...(status === 'superseded' ? { superseded_at: { not: null } } : {}),
      ...(q ? {
        OR: [
          { recipient_name: { contains: q, mode: 'insensitive' as const } },
          { serial: { contains: q, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
  };

  const REGISTER_SELECT = {
    id: true, serial: true, recipient_name: true, issued_at: true, revoked_at: true,
    revoked_reason: true, superseded_at: true, token: true, payload: true,
    championships: { select: { id: true, name: true } },
    certificate_templates: { select: { id: true, name: true } },
  } as const;

  /** Scans per certificate, so the register can show VERIFIED rather than guess it. */
  const scanCounts = async (ids: string[]) => {
    if (!ids.length) return new Map<string, number>();
    const g = await prisma.certificate_verifications.groupBy({
      by: ['certificate_id'], where: { certificate_id: { in: ids }, outcome: 'authentic' }, _count: { _all: true },
    });
    return new Map(g.map((r) => [r.certificate_id, r._count._all]));
  };

  router.get('/organizations/:id/certificates', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const query = req.query as Record<string, string | undefined>;
    const where = registerWhere(organizationId, query) as any;

    const pageSize = Math.min(Math.max(Number(query.page_size) || 25, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);

    const [rows, matching, total, revoked, scans] = await Promise.all([
      prisma.certificates.findMany({
        where, orderBy: [{ issued_at: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize, select: REGISTER_SELECT,
      }),
      prisma.certificates.count({ where }),
      prisma.certificates.count({ where: { organization_id: organizationId } }),
      prisma.certificates.count({ where: { organization_id: organizationId, revoked_at: { not: null } } }),
      prisma.certificate_verifications.count({ where: { certificates: { organization_id: organizationId } } }),
    ]);

    const byCert = await scanCounts(rows.map((r) => r.id));
    res.json({
      rows: rows.map((r) => ({
        ...r,
        sport: (r.payload as any)?.sport ?? null,
        title: (r.payload as any)?.title ?? null,
        scans: byCert.get(r.id) ?? 0,
        status: statusOf({ ...r, _scans: byCert.get(r.id) ?? 0 }),
      })),
      page: { page, page_size: pageSize, matching, pages: Math.max(Math.ceil(matching / pageSize), 1) },
      summary: { total, revoked, live: total - revoked, verification_scans: scans },
    });
  }));

  /** The register's Export button. CSV, because the next stop is always a spreadsheet. */
  router.get('/organizations/:id/certificates/export', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertIssuer(req, organizationId);
    const where = registerWhere(organizationId, req.query as Record<string, string | undefined>) as any;

    const rows = await prisma.certificates.findMany({
      where, orderBy: [{ issued_at: 'desc' }], take: 5000, select: REGISTER_SELECT,
    });
    const byCert = await scanCounts(rows.map((r) => r.id));

    // Quote everything: a recipient called "Rao, Meera" must not become two columns.
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Certificate ID', 'Recipient', 'Event', 'Sport', 'Achievement', 'Issue Date', 'Status', 'Verification scans', 'Verify URL'];
    const body = rows.map((r) => [
      r.serial, r.recipient_name, r.championships?.name ?? '', (r.payload as any)?.sport ?? '',
      (r.payload as any)?.title ?? '', r.issued_at.toISOString().slice(0, 10),
      statusOf({ ...r, _scans: byCert.get(r.id) ?? 0 }), byCert.get(r.id) ?? 0,
      `${env.WEB_ORIGIN}/verify/${r.token}`,
    ].map(cell).join(','));

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="certificates-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel opens UTF-8 names correctly rather than mangling them.
    res.send(`﻿${[header.map(cell).join(','), ...body].join('\r\n')}`);
  }));

  /** One certificate, with its own timeline - the detail screen. */
  router.get('/certificates/:certId', asyncHandler(async (req, res) => {
    const cert = await prisma.certificates.findUnique({
      where: { id: req.params.certId },
      select: {
        ...REGISTER_SELECT, organization_id: true, championship_id: true, user_id: true,
        fixture_id: true, signature: true, lock_version: true,
        organizations: { select: { id: true, name: true } },
        users_certificates_issued_byTousers: { select: { id: true, name: true } },
      },
    });
    if (!cert) throw new NotFoundError('Certificate');
    await assertIssuer(req, cert.organization_id);

    const [trail, byCert, team] = await Promise.all([
      certificateTrail(prisma, cert.id),
      scanCounts([cert.id]),
      // "Team" on the design's information panel - real if the honour came from one.
      cert.user_id && cert.championship_id
        ? prisma.team_members.findFirst({
          where: { user_id: cert.user_id, teams: { team_entries: { some: { championship_id: cert.championship_id } } } },
          select: { teams: { select: { id: true, name: true } } },
        })
        : null,
    ]);

    res.json({
      ...cert,
      sport: (cert.payload as any)?.sport ?? null,
      title: (cert.payload as any)?.title ?? null,
      scans: byCert.get(cert.id) ?? 0,
      status: statusOf({ ...cert, _scans: byCert.get(cert.id) ?? 0 }),
      team: team?.teams ?? null,
      issued_by_name: cert.users_certificates_issued_byTousers?.name ?? null,
      verify_url: `${env.WEB_ORIGIN}/verify/${cert.token}`,
      trail,
    });
  }));

  // ---- the artefact -----------------------------------------------------------
  //
  // Two doors to the same document. The recipient reaches their own without needing
  // anyone's permission - a certificate you have to ask an administrator for every
  // time is not really yours - and staff reach any of their institution's.
  const renderFor = async (req: any, res: any, certId: string, opts: { asOwner: boolean }) => {
    const cert = await prisma.certificates.findUnique({
      where: { id: certId },
      include: { certificate_templates: { select: { design: true } } },
    });
    if (!cert) throw new NotFoundError('Certificate');

    if (opts.asOwner) {
      if (cert.user_id !== req.user!.id) throw new ForbiddenError('This certificate belongs to somebody else.');
    } else {
      await assertIssuer(req, cert.organization_id);
    }

    const html = await renderCertificateHtml({
      facts: cert.payload as unknown as CertificateFacts,
      verifyUrl: `${env.WEB_ORIGIN}/verify/${cert.token}`,
      design: (cert.certificate_templates?.design ?? null) as any,
      // A withdrawn certificate still renders - so the holder can see what happened -
      // but it is stamped, because handing back a clean copy of a revoked document is
      // exactly how a revoked document keeps circulating.
      invalid: cert.revoked_at ? 'withdrawn' : cert.superseded_at ? 'superseded' : null,
    });

    res.set('Content-Type', 'text/html; charset=utf-8');
    // Inline so "Print → Save as PDF" works in one step; ?download=1 for the file.
    if (req.query.download === '1') {
      res.set('Content-Disposition', `attachment; filename="${cert.serial}.html"`);
    }
    res.send(html);
  };

  router.get('/certificates/:certId/render', asyncHandler(async (req, res) => {
    await renderFor(req, res, req.params.certId, { asOwner: false });
  }));

  /** A recipient's own certificates - the only list they need and the only one they get. */
  router.get('/me/certificates', asyncHandler(async (req, res) => {
    const rows = await prisma.certificates.findMany({
      where: { user_id: req.user!.id },
      orderBy: { issued_at: 'desc' },
      select: {
        id: true, serial: true, issued_at: true, revoked_at: true, superseded_at: true, token: true,
        payload: true, organizations: { select: { name: true } }, championships: { select: { name: true } },
      },
    });
    res.json({ rows });
  }));

  router.get('/me/certificates/:certId/render', asyncHandler(async (req, res) => {
    await renderFor(req, res, req.params.certId, { asOwner: true });
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
