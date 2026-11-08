import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  EVENT_PHOTO_ALL_SCOPE, EVENT_PHOTO_EXT, EVENT_PHOTO_MAX_BYTES, EVENT_PHOTO_MAX_COUNT,
  base64Bytes, eventPhotoOrderSchema, eventPhotoUpdateSchema, eventPhotoUploadSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { makeFileStorage, type FileStorage } from '../../infra/file-storage.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { PHOTO_SELECT, listEventPhotos } from './event-photos.service.js';

export function storageFromEnv(): FileStorage {
  return makeFileStorage({
    transport: env.STORAGE_TRANSPORT,
    bucket: env.STORAGE_BUCKET,
    s3Region: env.STORAGE_S3_REGION,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

// Event photo carousel on the public Overview page: one event's photos, or all events'. Super admins only.
export function makeEventPhotosRouter(prisma: Prisma, storage: FileStorage = storageFromEnv()): Router {
  const router = Router();
  router.use(requireSuperAdmin);

  // A scope is an event id, or EVENT_PHOTO_ALL_SCOPE for photos shown on every event.
  const loadScope = async (param: string) => {
    if (param === EVENT_PHOTO_ALL_SCOPE) {
      return { id: null as string | null, name: 'All events', target: { type: 'platform', id: 'all-events', label: 'All events' } };
    }
    const champ = await prisma.championships.findUnique({ where: { id: param }, select: { id: true, name: true } });
    if (!champ) throw new NotFoundError('Event');
    return { id: champ.id as string | null, name: champ.name, target: { type: 'championships', id: champ.id, label: champ.name } };
  };
  const loadPhoto = async (championshipId: string | null, photoId: string) => {
    const photo = await prisma.championship_photos.findFirst({ where: { id: photoId, championship_id: championshipId } });
    if (!photo) throw new NotFoundError('Photo');
    return photo;
  };
  const carousel = (scope: { id: string | null; name: string }) => (scope.id ? `"${scope.name}" carousel` : 'all-events carousel');

  router.get('/:scope', asyncHandler(async (req, res) => {
    const scope = await loadScope(req.params.scope);
    res.json({ photos: await listEventPhotos(prisma, scope.id), storage: env.STORAGE_TRANSPORT });
  }));

  router.post('/:scope', validateBody(eventPhotoUploadSchema), asyncHandler(async (req, res) => {
    const scope = await loadScope(req.params.scope);
    const body = req.body as ReturnType<typeof eventPhotoUploadSchema.parse>;
    if (base64Bytes(body.data) > EVENT_PHOTO_MAX_BYTES) {
      throw new ValidationError(`Photo is larger than ${EVENT_PHOTO_MAX_BYTES / (1024 * 1024)} MB`);
    }
    const bytes = Buffer.from(body.data, 'base64');
    if (bytes.length === 0) throw new ValidationError('Photo data is empty or not base64');

    const agg = await prisma.championship_photos.aggregate({
      where: { championship_id: scope.id }, _count: { _all: true }, _max: { sort_order: true },
    });
    if (agg._count._all >= EVENT_PHOTO_MAX_COUNT) {
      throw new BusinessRuleError(`${scope.id ? 'An event' : 'The all-events set'} can have up to ${EVENT_PHOTO_MAX_COUNT} photos - remove one first`);
    }

    const id = randomUUID();
    const key = `events/${scope.id ?? EVENT_PHOTO_ALL_SCOPE}/${id}.${EVENT_PHOTO_EXT[body.contentType]}`;
    const url = await storage.put(key, bytes, body.contentType);
    const photo = await prisma.championship_photos.create({
      data: {
        id, championship_id: scope.id, storage_key: key, url,
        caption: body.caption || null,
        sort_order: (agg._max.sort_order ?? -1) + 1,
        created_by: req.user!.id,
      },
      select: PHOTO_SELECT,
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoAdded, target: scope.target,
      summary: `Added a photo to the ${carousel(scope)}`,
    });
    res.status(201).json(photo);
  }));

  // Before /:photoId so "order" isn't read as a photo id.
  router.put('/:scope/order', validateBody(eventPhotoOrderSchema), asyncHandler(async (req, res) => {
    const scope = await loadScope(req.params.scope);
    const ids = (req.body as { ids: string[] }).ids;
    const current = await prisma.championship_photos.findMany({ where: { championship_id: scope.id }, select: { id: true } });
    const known = new Set(current.map((p) => p.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i))) {
      throw new ValidationError('The order must list every photo in this set exactly once');
    }
    await prisma.$transaction(ids.map((id, i) => prisma.championship_photos.update({ where: { id }, data: { sort_order: i } })));
    res.json({ photos: await listEventPhotos(prisma, scope.id) });
  }));

  router.patch('/:scope/:photoId', validateBody(eventPhotoUpdateSchema), asyncHandler(async (req, res) => {
    const scope = await loadScope(req.params.scope);
    const before = await loadPhoto(scope.id, req.params.photoId);
    const caption = (req.body as { caption: string | null }).caption || null;
    const photo = await prisma.championship_photos.update({ where: { id: before.id }, data: { caption }, select: PHOTO_SELECT });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoUpdated, target: scope.target,
      summary: `Changed a photo caption on the ${carousel(scope)}`,
      diff: { caption: { from: before.caption, to: caption } },
    });
    res.json(photo);
  }));

  router.delete('/:scope/:photoId', asyncHandler(async (req, res) => {
    const scope = await loadScope(req.params.scope);
    const photo = await loadPhoto(scope.id, req.params.photoId);
    // File first: if storage fails the row stays, so the photo can be removed again.
    await storage.remove(photo.storage_key);
    await prisma.championship_photos.delete({ where: { id: photo.id } });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoRemoved, target: scope.target,
      summary: `Removed a photo from the ${carousel(scope)}`,
    });
    res.status(204).end();
  }));

  return router;
}
