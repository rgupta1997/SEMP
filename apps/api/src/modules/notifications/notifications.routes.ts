import { Router } from 'express';
import { Prisma as PrismaNS } from '@prisma/client';
import { createNotificationSchema, reactNotificationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { parsePaging } from '../../http/paging.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import {
  canPostToEvent, canSeeNotification, parseAudienceRule,
  getUserEventScopes, visibilitySql,
} from './audience.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { markSeen, getUnreadCountByCursor } from './cursor.js';
import { mintRealtimeToken } from './realtime-token.js';
import { assertNotArchived } from '../championships/championship-archive.service.js';
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

    // A malformed id can match nothing - answer that rather than let the ::uuid cast 500.
    if (eventId && !UUID_RE.test(eventId)) { res.json([]); return; }

    // Page the ids in SQL (visibilitySql can use the audience index), then hydrate
    // just that page with Prisma's includes.
    const page = await prisma.$queryRaw<{ id: string }[]>(PrismaNS.sql`
      select n.id from notifications n
      where ${visibilitySql(scopes)}
        ${eventId ? PrismaNS.sql`and n.championship_id = ${eventId}::uuid` : PrismaNS.empty}
        ${unreadOnly ? PrismaNS.sql`and not exists (select 1 from notification_reads r where r.notification_id = n.id and r.user_id = ${user.id}::uuid)` : PrismaNS.empty}
      order by n.created_at desc, n.id desc
      limit ${take ?? 50} offset ${skip ?? 0}`);
    const order = new Map(page.map((p, i) => [p.id, i]));

    const rows = (await prisma.notifications.findMany({
      where: { id: { in: page.map((p) => p.id) } },
      include: {
        championships: { select: { id: true, name: true, slug: true } },
        users: { select: { id: true, name: true } }, // sender (nullable for system)
        notification_reactions: { select: { reaction: true, user_id: true } },
        notification_reads: { where: { user_id: user.id }, select: { id: true } },
      },
    })).sort((a, b) => order.get(a.id)! - order.get(b.id)!);

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
  // Cursor-based: cheap range scan against notification_deliveries, compared
  // to this user's notification_cursors.last_seen_at. See cursor.ts.
  router.get('/notifications/unread-count', asyncHandler(async (req, res) => {
    const user = req.user!;
    const scopes = await getUserEventScopes(prisma, user);
    const count = await getUnreadCountByCursor(prisma, user.id, scopes);
    res.json({ count });
  }));

  // ----- Mark the bell/drawer as seen (updates the cursor only) -----
  // Kept separate from /notifications/read-all: that route still writes
  // per-item notification_reads rows for feed-list state. This route only
  // moves the last_seen_at watermark that powers the badge count.
  router.post('/notifications/mark-seen', asyncHandler(async (req, res) => {
    const user = req.user!;
    await markSeen(prisma, user.id);
    res.status(204).send();
  }));

  // ----- Mint a short-lived token for the AppSync Events connection only.
  //
  // Unrelated to this app's own session auth, and deliberately incapable of acting
  // as one: it is signed with an HKDF-derived key and carries aud:'appsync-events',
  // either of which is enough for parseAuth to refuse it. See realtime-token.ts.
  //
  // The response also carries the endpoint and the channel, so the browser never
  // builds a channel path or learns an AppSync hostname at build time. The frontend
  // refetches before expiry, so a long-open tab keeps its connection with no gap.
  router.post('/notifications/realtime-token', asyncHandler(async (req, res) => {
    const user = req.user!;
    const result = mintRealtimeToken(user.id);
    res.json(result);
  }));

  // ----- Championships the current user may post into (fills the compose dropdown) -----
  router.get('/notifications/postable-championships', asyncHandler(async (req, res) => {
    const scopes = await getUserEventScopes(prisma, req.user!);
    // Archived events take no announcements, so they are not offered to post into.
    if (scopes.isSuper) {
      const championships = await prisma.championships.findMany({
        where: { archived_at: null }, select: { id: true, name: true }, orderBy: { created_at: 'desc' },
      });
      res.json(championships);
      return;
    }
    const ids = [...scopes.postableEventIds];
    if (ids.length === 0) { res.json([]); return; }
    const championships = await prisma.championships.findMany({
      where: { id: { in: ids }, archived_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' },
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
    // An announcement is a change to the event, and an archived event takes none.
    await assertNotArchived(prisma, req.body.championship_id);

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
    // One statement instead of loading every unread id into the API and sending
    // them back. ON CONFLICT plays the part createMany's skipDuplicates did.
    const marked = await prisma.$executeRaw(PrismaNS.sql`
      insert into notification_reads (notification_id, user_id)
      select n.id, ${user.id}::uuid from notifications n
      where ${visibilitySql(scopes)}
        and not exists (select 1 from notification_reads r where r.notification_id = n.id and r.user_id = ${user.id}::uuid)
      on conflict (notification_id, user_id) do nothing`);
    res.json({ marked });
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

  // ----- Test compose audience ----

  router.post('/notifications/compose', asyncHandler(async (req, res) => {
    const {
      championship_id,
      audience,
      title,
      body,
    } = req.body;

    const scopes = await getUserEventScopes(prisma, req.user!);
    const parsedAudience = parseAudienceRule(audience);

    if (!championship_id || !canPostToEvent(scopes, championship_id)) {
      throw new ForbiddenError('You cannot post notifications for this championship');
    }
    // The compose modal's send path - the one announcements actually go through.
    await assertNotArchived(prisma, championship_id);

    // This endpoint is used by the new audience picker. Do not accept an
    // arbitrary JSON payload that could bypass the audience rule engine.
    if (!parsedAudience) {
      throw new BusinessRuleError('Invalid notification audience');
    }

    const belongsToChampionship = (rule: AudienceRule): boolean => {
      switch (rule.kind) {
        case 'everyone':
        case 'role':
          return rule.championshipId === championship_id;
        case 'compose':
          return rule.rules.length > 0 && rule.rules.every(belongsToChampionship);
        default:
          return false;
      }
    };

    if (!belongsToChampionship(parsedAudience)) {
      throw new BusinessRuleError('Audience must belong to the selected championship');
    }

    const n = await notify(prisma, {
      type: 'manual',
      championshipId: championship_id,
      senderId: req.user!.id,
      audience: parsedAudience,
      data: {
        title: title ?? 'NOTIFICATION TEST',
        body: body ?? null,
      },
    });

    res.status(201).json(n);
  }));

  return router;
}