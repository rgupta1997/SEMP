import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageOffError, makeFileStorage, publicUrlFor, type StorageConfig } from './file-storage.js';

const SUPA: StorageConfig = { transport: 'supabase', bucket: 'event-photos', supabaseUrl: 'https://abc.supabase.co/', supabaseServiceKey: 'svc' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('publicUrlFor', () => {
  it('builds the Supabase public link', () => {
    expect(publicUrlFor(SUPA, 'events/e1/p 1.jpg')).toBe('https://abc.supabase.co/storage/v1/object/public/event-photos/events/e1/p%201.jpg');
  });
  it('builds the S3 link from the region', () => {
    expect(publicUrlFor({ transport: 's3', bucket: 'sportagon-photos', s3Region: 'ap-south-1' }, 'events/e1/p.jpg'))
      .toBe('https://sportagon-photos.s3.ap-south-1.amazonaws.com/events/e1/p.jpg');
  });
  it('prefers a configured public base (CDN)', () => {
    expect(publicUrlFor({ transport: 's3', bucket: 'b', publicBaseUrl: 'https://cdn.sportagon.in/' }, 'events/e1/p.jpg'))
      .toBe('https://cdn.sportagon.in/events/e1/p.jpg');
  });
});

describe('makeFileStorage', () => {
  it('refuses uploads plainly while storage is off', async () => {
    const s = makeFileStorage({ transport: 'off' });
    await expect(s.put('k', Buffer.from('x'), 'image/jpeg')).rejects.toBeInstanceOf(StorageOffError);
    await expect(s.remove('k')).rejects.toBeInstanceOf(StorageOffError);
  });

  it('uploads to Supabase with the service key and returns the public link', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = await makeFileStorage(SUPA).put('events/e1/p.jpg', Buffer.from('img'), 'image/jpeg');
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/public/event-photos/events/e1/p.jpg');
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('https://abc.supabase.co/storage/v1/object/event-photos/events/e1/p.jpg');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
  });

  it('reports a Supabase refusal instead of storing a dead link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bucket not found', { status: 404 })));
    await expect(makeFileStorage(SUPA).put('k.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/refused the upload \(404\)/);
  });

  it('deletes from Supabase by prefix and tolerates an already-missing file', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await makeFileStorage(SUPA).remove('events/e1/p.jpg');
    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('https://abc.supabase.co/storage/v1/object/event-photos');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ prefixes: ['events/e1/p.jpg'] });
  });
});
