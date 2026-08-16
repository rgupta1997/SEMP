import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError } from '../../shared/errors.js';

// Reading the audit trail (J6-E3-S3). Two scopes, each gated by the authority over
// the thing being audited: an organisation's timeline for its owners/admins, a
// championship's for its organiser.
//
// There is no write route here and there never will be - `audit_log` is append-only,
// enforced by a database trigger. Entries are only ever produced by audit() at the
// site of the action it describes.

// audit_log.id is a bigserial, and BigInt has no JSON representation - serialise it
// as a string rather than letting res.json() throw on the first row.
function serialise(row: any) {
  return { ...row, id: String(row.id) };
}

export function makeAuditRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // Free text matches the denormalised labels the timeline actually renders, so what
  // the reader searches for is what they can see on the line.
  const like = (text: string) => ({ contains: text, mode: 'insensitive' as const });

  // Shared filter parsing. Everything is optional; an unfiltered call is the plain
  // reverse-chronological timeline.
  function filters(req: any) {
    const { actor, action, target_type, target_id, from, to, q } = req.query as Record<string, string | undefined>;
    const at: { gte?: Date; lte?: Date } = {};
    if (from && !Number.isNaN(Date.parse(from))) at.gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) at.lte = new Date(to);
    const text = (q ?? '').trim();
    return {
      ...(actor ? { actor_user_id: actor } : {}),
      // Prefix match, so 'org.member' selects the whole family of member actions.
      ...(action ? { action: { startsWith: action } } : {}),
      ...(target_type ? { target_type } : {}),
      ...(target_id ? { target_id } : {}),
      ...(at.gte || at.lte ? { at } : {}),
      // Searching has to happen here rather than over the page the client holds -
      // a page is a window onto the trail, not the trail.
      ...(text
        ? {
            OR: [
              { summary: like(text) },
              { actor_label: like(text) },
              { target_label: like(text) },
              { action: like(text) },
            ],
          }
        : {}),
    };
  }

  function paging(req: any) {
    const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.offset) || 0, 0);
    return { take, skip };
  }

  // Organisation timeline. Gated on the `audit.view` permission, with owner/admin as
  // the fallback - not on the membership role alone. The role check on its own made
  // the catalogue entry decorative: an institution could grant `audit.view` to a role,
  // assign it, and the holder would still be refused, which is precisely the failure
  // the permission engine exists to remove (J6-E1-S2). Going through `can()` also puts
  // the trail behind the Administration module switch, the same way its screen is.
  router.get('/organizations/:id/audit', asyncHandler(async (req, res) => {
    const u = req.user!;
    const allowed = await can(prisma, 'audit.view', {
      user: { id: u.id, isSuperAdmin: u.isSuperAdmin },
      scope: { organizationId: req.params.id },
      fallback: async () => guards.orgRole(u.id, req.params.id, ['owner', 'admin']),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to read this organisation\'s audit trail');
    const where = { organization_id: req.params.id, ...filters(req) };
    const { take, skip } = paging(req);
    const [rows, total] = await Promise.all([
      prisma.audit_log.findMany({ where, orderBy: { at: 'desc' }, take, skip }),
      prisma.audit_log.count({ where }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ rows: rows.map(serialise), total });
  }));

  // Championship timeline - the championship's organiser, or a super admin. Reuses
  // the same guard the rest of the championship management surface is behind.
  const championshipOrganiser = guards.championshipManager(async (req) => req.params.eventId);

  router.get('/championships/:eventId/audit', championshipOrganiser, asyncHandler(async (req, res) => {
    const where = { championship_id: req.params.eventId, ...filters(req) };
    const { take, skip } = paging(req);
    const [rows, total] = await Promise.all([
      prisma.audit_log.findMany({ where, orderBy: { at: 'desc' }, take, skip }),
      prisma.audit_log.count({ where }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ rows: rows.map(serialise), total });
  }));

  return router;
}
