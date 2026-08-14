import { Router } from 'express';
import { createNotificationSchema, reactNotificationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { parsePaging } from '../../http/paging.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import {
  canPostToEvent, canSeeNotification,
  getUserEventScopes, visibilityWhere,
} from './audience.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules, type AudienceRule } from '@semp/notifications/core/rules.js';

// Group raw reaction rows into { emoji, count, mine } for the current user.
function summarizeReactions(rows: { reaction: string; user_id: string }[], userId: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of rows) {
    const e = map.get(r.reaction) ?? { emoji: r.reaction, count: 0, mine: false };
    e.count++;
    if (r.user_id === userId) e.mine = true;
    map.set(r.reaction, e);
  }
  return [...map.values()];
}

export function makeNotificationsRouter(prisma: Prisma): Router {
  const router = Router();

  // ----- Global feed for the current user (across every championship they belong to) -----
  router.get('/notifications', asyncHandler(async (req, res) => {
    const user = req.user!;
    const scopes = await getUserEventScopes(prisma, user);
    const { take, skip } = parsePaging(req.query);
    const eventId = typeof req.query.championship_id === 'string' ? req.query.championship_id : undefined;
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';

    const rows = await prisma.notifications.findMany({
      where: {
        ...visibilityWhere(scopes),
        ...(eventId ? { championship_id: eventId } : {}),
        ...(unreadOnly ? { notification_reads: { none: { user_id: user.id } } } : {}),
      },
      include: {
        championships: { select: { id: true, name: true, slug: true } },
        users: { select: { id: true, name: true } }, // sender (nullable for system)
        notification_reactions: { select: { reaction: true, user_id: true } },
        notification_reads: { where: { user_id: user.id }, select: { id: true } },
      },
      orderBy: { created_at: 'desc' },
      take: take ?? 50,
      skip,
    });

    res.json(rows.map((n) => ({
      id: n.id,
      type: n.type,
      audience: n.audience,
      title: n.title,
      body: n.body,
      created_at: n.created_at,
      championship: n.championships ? { id: n.championships.id, name: n.championships.name, slug: n.championships.slug } : null,
      sender: n.users ? { id: n.users.id, name: n.users.name } : null,
      is_mine: n.sender_id === user.id,
      unread: n.notification_reads.length === 0,
      reactions: summarizeReactions(n.notification_reactions, user.id),
    })));
  }));

  // ----- Unread badge count -----
  router.get('/notifications/unread-count', asyncHandler(async (req, res) => {
    const user = req.user!;
    const scopes = await getUserEventScopes(prisma, user);
    const count = await prisma.notifications.count({
      where: { ...visibilityWhere(scopes), notification_reads: { none: { user_id: user.id } } },
    });
    res.json({ count });
  }));

  // ----- Championships the current user may post into (fills the compose dropdown) -----
  router.get('/notifications/postable-championships', asyncHandler(async (req, res) => {
    const scopes = await getUserEventScopes(prisma, req.user!);
    if (scopes.isSuper) {
      const championships = await prisma.championships.findMany({
        select: { id: true, name: true }, orderBy: { created_at: 'desc' },
      });
      res.json(championships);
      return;
    }
    const ids = [...scopes.postableEventIds];
    if (ids.length === 0) { res.json([]); return; }
    const championships = await prisma.championships.findMany({
      where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
    res.json(championships);
  }));

  // ----- Push a manual notification -----
  router.post('/notifications', validateBody(createNotificationSchema), asyncHandler(async (req, res) => {
    const user = req.user!;
    const scopes = await getUserEventScopes(prisma, user);

    if (!canPostToEvent(scopes, req.body.championship_id)) {
      throw new ForbiddenError('You cannot post notifications for this championship');
    }

    let audience: AudienceRule;

    switch (req.body.audience) {
      case 'all':
        audience = Rules.everyone(req.body.championship_id);
        break;

      case 'organizations_captains':
        audience = Rules.role('captain', req.body.championship_id);
        break;

      default:
        throw new BusinessRuleError('Unsupported notification audience');
    }

    const n = await notify(prisma, {
      type: 'manual',
      championshipId: req.body.championship_id,
      senderId: user.id,
      audience,
      data: {
        title: req.body.title,
        body: req.body.body,
      },
    });

    res.status(201).json(n);
  }));

  // ----- Mark a single notification read (idempotent) -----
  router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
    const user = req.user!;
    await prisma.notification_reads.upsert({
      where: { notification_id_user_id: { notification_id: req.params.id, user_id: user.id } },
      update: {},
      create: { notification_id: req.params.id, user_id: user.id },
    });
    res.status(204).send();
  }));

  // ----- Mark all currently-visible notifications read (drawer open) -----
  router.post('/notifications/read-all', asyncHandler(async (req, res) => {
    const user = req.user!;
    const scopes = await getUserEventScopes(prisma, user);
    const unread = await prisma.notifications.findMany({
      where: { ...visibilityWhere(scopes), notification_reads: { none: { user_id: user.id } } },
      select: { id: true },
    });
    if (unread.length > 0) {
      await prisma.notification_reads.createMany({
        data: unread.map((n) => ({ notification_id: n.id, user_id: user.id })),
        skipDuplicates: true,
      });
    }
    res.json({ marked: unread.length });
  }));

  // ----- Toggle an emoji reaction (recipients only; never the author) -----
  router.post('/notifications/:id/reactions', validateBody(reactNotificationSchema), asyncHandler(async (req, res) => {
    const user = req.user!;
    const n = await prisma.notifications.findUnique({
      where: { id: req.params.id },
      select: { id: true, championship_id: true, audience: true, sender_id: true, organization_id: true, target_user_id: true },
    });
    if (!n) throw new NotFoundError('Notification');

    const scopes = await getUserEventScopes(prisma, user);
    if (!canSeeNotification(scopes, n)) throw new ForbiddenError('You cannot react to this notification');
    if (n.sender_id === user.id) throw new ForbiddenError('You cannot react to your own notification');

    const existing = await prisma.notification_reactions.findUnique({
      where: {
        notification_id_user_id_reaction: {
          notification_id: n.id, user_id: user.id, reaction: req.body.reaction,
        },
      },
      select: { id: true },
    });
    if (existing) await prisma.notification_reactions.delete({ where: { id: existing.id } });
    else await prisma.notification_reactions.create({
      data: { notification_id: n.id, user_id: user.id, reaction: req.body.reaction },
    });

    const all = await prisma.notification_reactions.findMany({
      where: { notification_id: n.id }, select: { reaction: true, user_id: true },
    });
    res.json({ reactions: summarizeReactions(all, user.id) });
  }));
  
  // ----- Test compose audience -----

  router.post('/notifications/test-compose', asyncHandler(async (req, res) => {
    const {
      championship_id,
      audience,
      title,
      body,
    } = req.body;

    const n = await notify(prisma, {
      type: 'manual',
      championshipId: championship_id,
      senderId: req.user!.id,
      audience,
      data: {
        title: title ?? 'NOTIFICATION TEST',
        body: body ?? null,
      },
    });

    res.status(201).json(n);
  }));

  return router;
}


