import { describe, it, expect } from 'vitest';
import { notificationChannelPath, NOTIFICATION_CHANNEL_NAMESPACE } from './channels.js';

// These assertions look trivial. They are here because the value they protect is a
// STRING SHARED ACROSS THREE SEPARATELY-DEPLOYED PROCESSES, and every way it can go
// wrong is silent - see the file comment in channels.ts. Pinning the literal shape
// means a "harmless" refactor of the template string fails here rather than in
// production, where the only symptom is a bell that stopped ringing.

const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('notificationChannelPath', () => {
  it('is the exact literal both halves must agree on', () => {
    expect(notificationChannelPath(UUID)).toBe(
      '/notifications/user/7c9e6679-7425-40de-944b-e07fc1f90ae7',
    );
  });

  it('starts with the namespace segment AppSync is configured with', () => {
    expect(notificationChannelPath(UUID)).toMatch(
      new RegExp(`^/${NOTIFICATION_CHANNEL_NAMESPACE}/`),
    );
  });

  // AppSync caps a channel at 5 segments and 50 characters per segment. A UUID is
  // 36, so there is headroom - but the check is cheap and the failure mode if a
  // future id format is longer is a rejected subscribe with no obvious cause.
  it('stays inside AppSync channel limits', () => {
    const segments = notificationChannelPath(UUID).split('/').filter(Boolean);
    expect(segments.length).toBeLessThanOrEqual(5);
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(50);
  });

  // The hazard, asserted rather than assumed - this is WHY the authorizer compares
  // with exact equality and never with startsWith.
  //
  // The user id is the last segment, so one user's channel is a genuine string
  // prefix of another's whenever one id is a prefix of the other. A `startsWith`
  // check in the authorizer would therefore hand user "abc" every ping addressed to
  // "abcdef". Real ids are fixed-length UUIDs, so this cannot bite today - which is
  // exactly the kind of reasoning that makes a prefix check look safe right up until
  // the id format changes. The test states the danger so the rule has a reason
  // attached to it.
  it('lets one user\'s channel prefix another\'s - so only exact equality is safe', () => {
    const shorter = notificationChannelPath('abc');
    const longer = notificationChannelPath('abcdef');
    expect(longer.startsWith(shorter)).toBe(true);
    expect(longer).not.toBe(shorter);
  });
});
