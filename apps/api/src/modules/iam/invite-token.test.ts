import { describe, it, expect } from 'vitest';
import { INVITE_TTL_DAYS, hashInviteToken, inviteAcceptUrl, issueInviteToken } from './invite-token.js';

describe('issueInviteToken', () => {
  it('stores only the hash - the plaintext token is never recoverable from the row', () => {
    const { token, token_hash } = issueInviteToken();

    expect(token_hash).not.toContain(token);
    expect(token_hash).toBe(hashInviteToken(token));
    expect(token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // A six-digit code is protected by an attempt counter and a ten-minute life. A link
  // has neither and must answer strangers, so the token itself has to carry the
  // entropy - 32 bytes, not 10^6.
  it('is long enough that guessing is not a strategy', () => {
    const { token } = issueInviteToken();

    // 32 bytes of base64url, unpadded.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('is URL-safe, so it survives being a path segment untouched', () => {
    for (let i = 0; i < 50; i++) {
      const { token } = issueInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueInviteToken().token));

    expect(seen.size).toBe(200);
  });

  it('expires, and by default on the same day count the mail promises', () => {
    const before = Date.now();
    const { expires_at } = issueInviteToken();

    const days = (expires_at.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(INVITE_TTL_DAYS - 0.01);
    expect(days).toBeLessThan(INVITE_TTL_DAYS + 0.01);
  });

  it('honours an explicit lifetime', () => {
    const { expires_at } = issueInviteToken(1);

    expect((expires_at.getTime() - Date.now()) / 86_400_000).toBeLessThan(1.01);
  });
});

describe('hashInviteToken', () => {
  it('is stable, so a link issued today still resolves tomorrow', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
  });

  it('separates two tokens that differ by one character', () => {
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
  });
});

describe('inviteAcceptUrl', () => {
  it('builds the link the mail carries', () => {
    expect(inviteAcceptUrl('https://app.sportagon.in', 'tok')).toBe('https://app.sportagon.in/invites/tok');
  });

  // env.WEB_APP_URL is stripped of trailing slashes at parse time; this proves the
  // join does not reintroduce a double slash if that ever changes.
  it('does not produce a double slash', () => {
    expect(inviteAcceptUrl('https://app.sportagon.in', 'tok')).not.toContain('//invites');
  });
});
