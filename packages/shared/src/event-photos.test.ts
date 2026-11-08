import { describe, expect, it } from 'vitest';
import { base64Bytes, eventPhotoUploadSchema, EVENT_PHOTO_CAPTION_MAX } from './event-photos.js';

describe('base64Bytes', () => {
  it('matches the decoded length for every padding case', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'hello world!']) {
      const b64 = Buffer.from(s).toString('base64');
      expect(base64Bytes(b64)).toBe(Buffer.byteLength(s));
    }
  });
});

describe('eventPhotoUploadSchema', () => {
  it('trims captions and caps their length', () => {
    expect(eventPhotoUploadSchema.parse({ data: 'aGk=', contentType: 'image/png', caption: '  Finals  ' }).caption).toBe('Finals');
    expect(eventPhotoUploadSchema.safeParse({ data: 'aGk=', contentType: 'image/png', caption: 'x'.repeat(EVENT_PHOTO_CAPTION_MAX + 1) }).success).toBe(false);
  });
});
