import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  EVENT_PHOTO_EXT, EVENT_PHOTO_MAX_BYTES, EVENT_PHOTO_MAX_COUNT,
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

// Event photo carousel on the public Overview page. Super admins only.
export function makeEventPhotosRouter(prisma: Prisma, storage: FileStorage = storageFromEnv()): Router {
  const router = Router();
  router.use(requireSuperAdmin);

  const loadEvent = async (id: string) => {
    const champ = await prisma.championships.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!champ) throw new NotFoundError('Event');
    return champ;
  };
  const loadPhoto = async (championshipId: string, photoId: string) => {
    const photo = await prisma.championship_photos.findFirst({ where: { id: photoId, championship_id: championshipId } });
    if (!photo) throw new NotFoundError('Photo');
    return photo;
  };

  router.get('/:championshipId', asyncHandler(async (req, res) => {
    await loadEvent(req.params.championshipId);
    res.json({ photos: await listEventPhotos(prisma, req.params.championshipId), storage: env.STORAGE_TRANSPORT });
  }));

  router.post('/:championshipId', validateBody(eventPhotoUploadSchema), asyncHandler(async (req, res) => {
    const champ = await loadEvent(req.params.championshipId);
    const body = req.body as ReturnType<typeof eventPhotoUploadSchema.parse>;
    if (base64Bytes(body.data) > EVENT_PHOTO_MAX_BYTES) {
      throw new ValidationError(`Photo is larger than ${EVENT_PHOTO_MAX_BYTES / (1024 * 1024)} MB`);
    }
    const bytes = Buffer.from(body.data, 'base64');
    if (bytes.length === 0) throw new ValidationError('Photo data is empty or not base64');

    const agg = await prisma.championship_photos.aggregate({
      where: { championship_id: champ.id }, _count: { _all: true }, _max: { sort_order: true },
    });
    if (agg._count._all >= EVENT_PHOTO_MAX_COUNT) {
      throw new BusinessRuleError(`An event can have up to ${EVENT_PHOTO_MAX_COUNT} photos - remove one first`);
    }

    const id = randomUUID();
    const key = `events/${champ.id}/${id}.${EVENT_PHOTO_EXT[body.contentType]}`;
    const url = await storage.put(key, bytes, body.contentType);
    const photo = await prisma.championship_photos.create({
      data: {
        id, championship_id: champ.id, storage_key: key, url,
        caption: body.caption || null,
        sort_order: (agg._max.sort_order ?? -1) + 1,
        created_by: req.user!.id,
      },
      select: PHOTO_SELECT,
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoAdded,
      target: { type: 'championships', id: champ.id, label: champ.name },
      summary: `Added a photo to the "${champ.name}" carousel`,
    });
    res.status(201).json(photo);
  }));

  // Before /:photoId so "order" isn't read as a photo id.
  router.put('/:championshipId/order', validateBody(eventPhotoOrderSchema), asyncHandler(async (req, res) => {
    const champ = await loadEvent(req.params.championshipId);
    const ids = (req.body as { ids: string[] }).ids;
    const current = await prisma.championship_photos.findMany({ where: { championship_id: champ.id }, select: { id: true } });
    const known = new Set(current.map((p) => p.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i))) {
      throw new ValidationError('The order must list every photo of this event exactly once');
    }
    await prisma.$transaction(ids.map((id, i) => prisma.championship_photos.update({ where: { id }, data: { sort_order: i } })));
    res.json({ photos: await listEventPhotos(prisma, champ.id) });
  }));

  router.patch('/:championshipId/:photoId', validateBody(eventPhotoUpdateSchema), asyncHandler(async (req, res) => {
    const champ = await loadEvent(req.params.championshipId);
    const before = await loadPhoto(champ.id, req.params.photoId);
    const caption = (req.body as { caption: string | null }).caption || null;
    const photo = await prisma.championship_photos.update({ where: { id: before.id }, data: { caption }, select: PHOTO_SELECT });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoUpdated,
      target: { type: 'championships', id: champ.id, label: champ.name },
      summary: `Changed a photo caption on the "${champ.name}" carousel`,
      diff: { caption: { from: before.caption, to: caption } },
    });
    res.json(photo);
  }));

  router.delete('/:championshipId/:photoId', asyncHandler(async (req, res) => {
    const champ = await loadEvent(req.params.championshipId);
    const photo = await loadPhoto(champ.id, req.params.photoId);
    // File first: if storage fails the row stays, so the photo can be removed again.
    await storage.remove(photo.storage_key);
    await prisma.championship_photos.delete({ where: { id: photo.id } });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.eventPhotoRemoved,
      target: { type: 'championships', id: champ.id, label: champ.name },
      summary: `Removed a photo from the "${champ.name}" carousel`,
    });
    res.status(204).end();
  }));

  return router;
}
