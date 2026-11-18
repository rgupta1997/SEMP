// Uploaded files: Supabase Storage on beta, an S3 bucket on prod - picked by
// STORAGE_TRANSPORT, the same if/else as REALTIME_TRANSPORT. Buckets are public-read,
// so a stored file's link is permanent and needs no signing.
import type { StorageTransport } from '@semp/shared';
import { DomainError } from '../shared/errors.js';

export interface FileStorage {
  /** Store a file and return the public link to it. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
}

export interface StorageConfig {
  transport: StorageTransport;
  bucket?: string;
  s3Region?: string;
  publicBaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
}

/** Thrown when uploads are switched off, so the screen can say so plainly. */
export class StorageOffError extends DomainError {
  constructor() {
    super('STORAGE_OFF', 'Photo storage is not set up on this server yet (STORAGE_TRANSPORT is off).', 400);
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** Public link for a stored file: a CDN address when configured, else the bucket's own. */
export function publicUrlFor(cfg: StorageConfig, key: string): string {
  if (cfg.publicBaseUrl) return `${trimSlash(cfg.publicBaseUrl)}/${encodeKey(key)}`;
  if (cfg.transport === 'supabase') return `${trimSlash(cfg.supabaseUrl!)}/storage/v1/object/public/${cfg.bucket}/${encodeKey(key)}`;
  const region = cfg.s3Region ?? process.env.AWS_REGION ?? 'ap-south-1';
  return `https://${cfg.bucket}.s3.${region}.amazonaws.com/${encodeKey(key)}`;
}

function supabaseStorage(cfg: StorageConfig): FileStorage {
  const base = `${trimSlash(cfg.supabaseUrl!)}/storage/v1/object`;
  const auth = { Authorization: `Bearer ${cfg.supabaseServiceKey}`, apikey: cfg.supabaseServiceKey! };
  return {
    async put(key, bytes, contentType) {
      const res = await fetch(`${base}/${cfg.bucket}/${encodeKey(key)}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new DomainError('STORAGE_FAILED', `Supabase Storage refused the upload (${res.status}): ${(await res.text()).slice(0, 200)}`, 502);
      return publicUrlFor(cfg, key);
    },
    async remove(key) {
      const res = await fetch(`${base}/${cfg.bucket}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [key] }),
      });
      if (!res.ok && res.status !== 404) throw new DomainError('STORAGE_FAILED', `Supabase Storage refused the delete (${res.status})`, 502);
    },
  };
}

function s3Storage(cfg: StorageConfig): FileStorage {
  // Loaded on first use: the Lambda runtime ships the SDK, and nothing else needs it.
  const client = (async () => {
    const sdk = await import('@aws-sdk/client-s3');
    return { sdk, s3: new sdk.S3Client(cfg.s3Region ? { region: cfg.s3Region } : {}) };
  })();
  return {
    async put(key, bytes, contentType) {
      const { sdk, s3 } = await client;
      await s3.send(new sdk.PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: 'max-age=31536000',
      }));
      return publicUrlFor(cfg, key);
    },
    async remove(key) {
      const { sdk, s3 } = await client;
      await s3.send(new sdk.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}

/** The storage for this deploy; uploads throw StorageOffError while it is off. */
export function makeFileStorage(cfg: StorageConfig): FileStorage {
  if (cfg.transport === 'supabase') return supabaseStorage(cfg);
  if (cfg.transport === 's3') return s3Storage(cfg);
  return { put: async () => { throw new StorageOffError(); }, remove: async () => { throw new StorageOffError(); } };
}
