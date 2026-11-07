import { z } from 'zod';

// Event photo carousel (public Overview page). Super admins add the photos; anyone with
// the link sees them. One set of limits, read by the API and the upload screen alike.

/** Where photos are stored: off (not set up), Supabase Storage (beta) or S3 (prod). */
export const STORAGE_TRANSPORTS = ['off', 'supabase', 's3'] as const;
export type StorageTransport = (typeof STORAGE_TRANSPORTS)[number];

export const EVENT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type EventPhotoType = (typeof EVENT_PHOTO_TYPES)[number];
/** File extension per type, for the stored file's name. */
export const EVENT_PHOTO_EXT: Record<EventPhotoType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The browser shrinks a photo to this longest side before sending it. */
export const EVENT_PHOTO_MAX_EDGE = 1920;
/** Largest photo the API accepts, after that shrink. Its base64 stays inside the 5 MB request limit. */
export const EVENT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
/** Largest original a super admin may pick, before shrinking. */
export const EVENT_PHOTO_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const EVENT_PHOTO_MAX_COUNT = 20;
export const EVENT_PHOTO_CAPTION_MAX = 140;

const caption = z.string().trim().max(EVENT_PHOTO_CAPTION_MAX);

export const eventPhotoUploadSchema = z.object({
  /** The image, base64 (no data: prefix). */
  data: z.string().min(1),
  contentType: z.enum(EVENT_PHOTO_TYPES),
  caption: caption.optional(),
});
export type EventPhotoUpload = z.infer<typeof eventPhotoUploadSchema>;

export const eventPhotoUpdateSchema = z.object({ caption: caption.nullable() });

export const eventPhotoOrderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(EVENT_PHOTO_MAX_COUNT) });

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
  const clean = data.replace(/\s/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/** A photo as the public page and the manage screen receive it. */
export interface EventPhoto { id: string; url: string; caption: string | null; sort_order: number }
