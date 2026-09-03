import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit } from '../iam/audit.service.js';

// Championship templates - all of them, in one table.
//
// Two kinds, one shape, one code path:
//   * SYSTEM (is_system) - the built-ins that used to live in a TypeScript const.
//     Visible to everybody, owned by nobody, not deletable from the product.
//   * SAVED - captured from a championship somebody actually ran, and belonging to
//     that person or to their organisation.
//
// The saved kind is the point: an organiser builds an event once, the product offers to
// remember its shape under a name of their choosing, and from then on it is theirs to
// start from. That beats a guess made at build time, and a new shape never needs a
// deploy.
//
// The shape holds NAMES, not ids, so a template outlives the championship it came from
// and survives a discipline being renamed away underneath it. Names are matched
// against the catalogue when applied, and anything unmatched is reported rather than
// invented - a template must never quietly add a sport to the global catalogue.

export interface TemplateDraw {
  sport: string;
  /** Catalogue name of the fixture format, e.g. "Knockout". */
  format: string | null;
  /** Named sub-disciplines; empty means one sport-level draw. */
  disciplines: string[];
}

export interface TemplateShape {
  type: string | null;
  scheme: string | null;
  draws: TemplateDraw[];
}

const summarise = (shape: TemplateShape) => ({
  sports: shape.draws.length,
  draws: shape.draws.reduce((n, d) => n + Math.max(1, d.disciplines.length), 0),
  formats: [...new Set(shape.draws.map((d) => d.format).filter(Boolean))] as string[],
});

// Read a championship's setup back out as a reusable shape.
export async function captureShape(prisma: Prisma, championshipId: string): Promise<TemplateShape> {
  const championship = await prisma.championships.findUnique({
    where: { id: championshipId },
    select: { id: true, type: true },
  });
  if (!championship) throw new NotFoundError('Championship');

  const sports = await prisma.tournament_sports.findMany({
    where: { tournaments: { championship_id: championshipId } },
    select: {
      sports: { select: { name: true } },
      tournament_formats: { select: { name: true } },
      tournament_disciplines: {
        select: { disciplines: { select: { name: true } } },
        orderBy: { display_order: 'asc' },
      },
    },
  });

  const rule = await prisma.standings_rules.findFirst({
    where: { championship_id: championshipId, scope_type: 'championship' },
    select: { config: true },
  });

  return {
    type: championship.type,
    scheme: (rule?.config as any)?.scheme ?? null,
    draws: sports.map((s) => ({
      sport: s.sports?.name ?? '',
      format: s.tournament_formats?.name ?? null,
      // A draw with no discipline is the sport-level draw; it is represented by the
      // absence of names rather than by a placeholder, so applying re-creates it.
      disciplines: s.tournament_disciplines
        .map((d) => d.disciplines?.name)
        .filter((n): n is string => !!n),
    })).filter((d) => d.sport),
  };
}

// Everything the caller may start from: the system set, their own, and their
// organisations'.
export async function listTemplates(prisma: Prisma, userId: string) {
  const memberships = await prisma.organization_members.findMany({
    where: { user_id: userId, status: 'active' },
    select: { organization_id: true },
  });
  const orgIds = memberships.map((m) => m.organization_id);

  const rows = await prisma.championship_templates.findMany({
    where: {
      OR: [
        { is_system: true },
        { created_by: userId },
        ...(orgIds.length ? [{ organization_id: { in: orgIds } }] : []),
      ],
    },
    include: {
      organizations: { select: { id: true, name: true } },
      users: { select: { id: true, name: true } },
    },
    // Saved templates first: somebody who has captured their own shape wants that one,
    // and the system set is the fallback rather than the headline.
    orderBy: [{ is_system: 'asc' }, { created_at: 'desc' }],
  });

  return rows.map((r) => {
    const shape = r.shape as unknown as TemplateShape;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      is_system: r.is_system,
      organization: r.organizations,
      created_by: r.users,
      created_at: r.created_at,
      // The picker shows the sports themselves on hover, so the shape travels with the
      // list rather than needing a second call per card.
      shape,
      summary: summarise(shape),
    };
  });
}

export async function saveTemplate(
  prisma: Prisma, req: Request,
  { championshipId, name, description, organizationId }:
  { championshipId: string; name: string; description?: string | null; organizationId?: string | null },
) {
  const shape = await captureShape(prisma, championshipId);
  if (shape.draws.length === 0) {
    throw new BusinessRuleError('There is nothing to save yet - add at least one sport first');
  }

  const championship = await prisma.championships.findUnique({
    where: { id: championshipId }, select: { name: true },
  });

  // Saving to an organisation makes it the sports office's asset rather than one
  // person's, so it has to be an organisation they actually administer.
  if (organizationId) {
    const member = await prisma.organization_members.findFirst({
      where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { id: true },
    });
    if (!member && !req.user!.isSuperAdmin) {
      throw new ForbiddenError('Only an owner or admin can save a template for that organisation');
    }
  }

  // Same name from the same owner updates rather than duplicating - "save it again
  // after tweaking" is the common case, not a new template.
  const existing = await prisma.championship_templates.findFirst({
    where: {
      name: { equals: name.trim(), mode: 'insensitive' },
      ...(organizationId ? { organization_id: organizationId } : { created_by: req.user!.id, organization_id: null }),
    },
    select: { id: true },
  });

  const data = {
    name: name.trim(),
    description: description?.trim() || null,
    organization_id: organizationId ?? null,
    created_by: req.user!.id,
    source_championship_id: championshipId,
    shape: shape as any,
    updated_at: new Date(),
  };

  const row = existing
    ? await prisma.championship_templates.update({ where: { id: existing.id }, data })
    : await prisma.championship_templates.create({ data });

  const summary = summarise(shape);
  await audit(prisma, req, {
    action: existing ? 'championship.template_updated' : 'championship.template_saved',
    target: { type: 'championship_templates', id: row.id, label: row.name },
    organizationId: organizationId ?? null,
    championshipId,
    summary: `Saved the setup of ${championship?.name ?? 'a championship'} as the template "${row.name}"`,
    diff: { sports: { from: null, to: summary.sports }, draws: { from: null, to: summary.draws } },
  });

  return { ...row, summary };
}

export async function deleteTemplate(prisma: Prisma, req: Request, templateId: string) {
  const row = await prisma.championship_templates.findUnique({ where: { id: templateId } });
  if (!row) throw new NotFoundError('Template');
  // The built-ins belong to the platform, not to whoever happens to be a super admin
  // today. Removing one is a migration, not a click.
  if (row.is_system) throw new ForbiddenError('Built-in templates cannot be deleted');

  const mayDelete = req.user!.isSuperAdmin
    || row.created_by === req.user!.id
    || (row.organization_id
      ? !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: row.organization_id, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      }))
      : false);
  if (!mayDelete) throw new ForbiddenError('You can only delete your own templates');

  await prisma.championship_templates.delete({ where: { id: row.id } });
  await audit(prisma, req, {
    action: 'championship.template_deleted',
    target: { type: 'championship_templates', id: row.id, label: row.name },
    organizationId: row.organization_id,
    summary: `Deleted the template "${row.name}"`,
  });
  return { ok: true };
}

// Read a template the caller is entitled to use.
export async function loadTemplateFor(prisma: Prisma, userId: string, templateId: string) {
  const row = await prisma.championship_templates.findUnique({ where: { id: templateId } });
  if (!row) throw new NotFoundError('Template');

  if (!row.is_system && row.created_by !== userId) {
    if (!row.organization_id) throw new ForbiddenError('That template belongs to someone else');
    const member = await prisma.organization_members.findFirst({
      where: { user_id: userId, organization_id: row.organization_id, status: 'active' },
      select: { id: true },
    });
    if (!member) throw new ForbiddenError('That template belongs to another organisation');
  }
  return { row, shape: row.shape as unknown as TemplateShape };
}
